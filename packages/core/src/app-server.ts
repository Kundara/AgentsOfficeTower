import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { platform } from "node:process";

import type { CodexThread } from "./types";
import { spawnCodexProcess } from "./codex-command";

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

interface ThreadListResult {
  data: CodexThread[];
  nextCursor?: string | null;
}

type ThreadListSortKey = "created_at" | "updated_at";
type SortDirection = "asc" | "desc";

interface TurnStartResult {
  turn: {
    id: string;
    status: string;
    items: unknown[];
    error: unknown;
  };
}

interface TurnSteerResult {
  turnId: string;
}

interface TextUserInput {
  type: "text";
  text: string;
  text_elements: unknown[];
}

interface DynamicToolCallResponse {
  contentItems: Array<{ type: "inputText"; text: string }>;
  success: boolean;
}

export interface AppServerThreadGoal {
  threadId: string;
  objective: string;
  status: string;
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: number;
  updatedAt: number;
}

interface ThreadGoalGetResponse {
  goal: AppServerThreadGoal | null;
}

export function appServerCwdParam(cwd: string | null | undefined): string | null {
  if (!cwd) {
    return null;
  }

  const match = cwd.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
  if (platform !== "win32" || !match) {
    return cwd;
  }

  const drive = match[1].toUpperCase();
  const rest = match[2].replace(/\//g, "\\");
  return `${drive}:\\${rest}`;
}

export interface ToolRequestUserInputAnswer {
  answers: string[];
}

export interface ToolRequestUserInputResponse {
  answers: Record<string, ToolRequestUserInputAnswer>;
}

export interface AppServerNotification {
  method: string;
  params?: Record<string, unknown>;
}

export interface AppServerServerRequest {
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface AppServerResponseMessage {
  id: number;
  result?: unknown;
  error?: { message?: string };
}

type ParsedAppServerMessage =
  | { kind: "response"; message: AppServerResponseMessage }
  | { kind: "notification"; message: AppServerNotification }
  | { kind: "serverRequest"; message: AppServerServerRequest }
  | { kind: "unknown" };

const MAX_APP_SERVER_LINE_BYTES = 8 * 1024 * 1024;
const APP_SERVER_INITIALIZE_TIMEOUT_MS = 15000;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`${label} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      timer.unref?.();
      promise.finally(() => clearTimeout(timer)).catch(() => clearTimeout(timer));
    })
  ]);
}

function messageIdFromOversizedLine(line: string): number | null {
  const prefix = line.slice(0, 256);
  const match = prefix.match(/"id"\s*:\s*(\d+)/);
  return match ? Number(match[1]) : null;
}

export function parseAppServerMessage(line: string): ParsedAppServerMessage {
  let message: {
    id?: number;
    method?: string;
    params?: Record<string, unknown>;
    result?: unknown;
    error?: { message?: string };
  };
  try {
    message = JSON.parse(line) as typeof message;
  } catch {
    return { kind: "unknown" };
  }

  if (typeof message.id === "number" && typeof message.method === "string") {
    return {
      kind: "serverRequest",
      message: {
        id: message.id,
        method: message.method,
        params: message.params
      }
    };
  }

  if (typeof message.method === "string") {
    return {
      kind: "notification",
      message: {
        method: message.method,
        params: message.params
      }
    };
  }

  if (typeof message.id === "number") {
    return {
      kind: "response",
      message: {
        id: message.id,
        result: message.result,
        error: message.error
      }
    };
  }

  return { kind: "unknown" };
}

export class CodexAppServerClient {
  private child: ChildProcessWithoutNullStreams;
  private buffer = "";
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private stderr = "";
  private notificationListeners = new Set<(message: AppServerNotification) => void>();
  private serverRequestListeners = new Set<(message: AppServerServerRequest) => void>();

  private constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child;
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.onStdout(chunk));
    this.child.stderr.on("data", (chunk) => {
      this.stderr += chunk;
    });
    this.child.on("error", (error) => {
      for (const pending of this.pending.values()) {
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      }
      this.pending.clear();
    });
    this.child.on("exit", (code, signal) => {
      const reason =
        code === 0 || signal === "SIGTERM"
          ? null
          : new Error(`codex app-server exited unexpectedly (${code ?? signal ?? "unknown"}).`);

      if (!reason) {
        return;
      }

      for (const pending of this.pending.values()) {
        pending.reject(reason);
      }
      this.pending.clear();
    });
  }

  static async create(): Promise<CodexAppServerClient> {
    const { child } = await spawnCodexProcess(codexObserverAppServerArgs());
    const client = new CodexAppServerClient(child);
    try {
      await withTimeout(client.request("initialize", {
        clientInfo: {
          name: "codex_agents_office",
          title: "Codex Agents Office",
          version: "0.1.0"
        },
        capabilities: {
          experimentalApi: true,
          requestAttestation: false
        }
      }), APP_SERVER_INITIALIZE_TIMEOUT_MS, "app-server initialize");
    } catch (error) {
      client.close();
      throw error;
    }
    client.notify("initialized");
    return client;
  }

  static async createWithCandidateLabel(): Promise<{ client: CodexAppServerClient; candidateLabel: string }> {
    const { child, candidate } = await spawnCodexProcess(codexObserverAppServerArgs());
    const client = new CodexAppServerClient(child);
    try {
      await withTimeout(client.request("initialize", {
        clientInfo: {
          name: "codex_agents_office",
          title: "Codex Agents Office",
          version: "0.1.0"
        },
        capabilities: {
          experimentalApi: true,
          requestAttestation: false
        }
      }), APP_SERVER_INITIALIZE_TIMEOUT_MS, "app-server initialize");
    } catch (error) {
      client.close();
      throw error;
    }
    client.notify("initialized");
    return { client, candidateLabel: candidate.label };
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    while (true) {
      const newlineIndex = this.buffer.indexOf("\n");
      if (newlineIndex === -1) {
        return;
      }

      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }

      if (line.length > MAX_APP_SERVER_LINE_BYTES) {
        const requestId = messageIdFromOversizedLine(line);
        if (requestId !== null) {
          const pending = this.pending.get(requestId);
          if (pending) {
            this.pending.delete(requestId);
            pending.reject(new Error(`app-server message exceeded ${MAX_APP_SERVER_LINE_BYTES} bytes`));
          }
        }
        continue;
      }

      const parsed = parseAppServerMessage(line);
      if (parsed.kind === "notification") {
        for (const listener of this.notificationListeners) {
          listener(parsed.message);
        }
        continue;
      }

      if (parsed.kind === "serverRequest") {
        for (const listener of this.serverRequestListeners) {
          listener(parsed.message);
        }
        continue;
      }

      if (parsed.kind !== "response") {
        continue;
      }

      const pending = this.pending.get(parsed.message.id);
      if (!pending) {
        continue;
      }

      this.pending.delete(parsed.message.id);
      if (parsed.message.error) {
        pending.reject(new Error(parsed.message.error.message ?? "app-server request failed"));
      } else {
        pending.resolve(parsed.message.result);
      }
    }
  }

  private send(payload: Record<string, unknown>): void {
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  notify(method: string, params?: Record<string, unknown>): void {
    this.send(params ? { method, params } : { method });
  }

  onNotification(listener: (message: AppServerNotification) => void): () => void {
    this.notificationListeners.add(listener);
    return () => {
      this.notificationListeners.delete(listener);
    };
  }

  onServerRequest(listener: (message: AppServerServerRequest) => void): () => void {
    this.serverRequestListeners.add(listener);
    return () => {
      this.serverRequestListeners.delete(listener);
    };
  }

  request<TResult>(method: string, params?: Record<string, unknown>): Promise<TResult> {
    const id = this.nextId++;
    return new Promise<TResult>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as TResult), reject });
      this.send(params ? { id, method, params } : { id, method });
    });
  }

  requestNoWait(method: string, params?: Record<string, unknown>): number {
    const id = this.nextId++;
    this.send(params ? { id, method, params } : { id, method });
    return id;
  }

  respondToServerRequest(requestId: number, result: unknown): void {
    this.send({ id: requestId, result });
  }

  respondToToolRequestUserInput(requestId: number, response: ToolRequestUserInputResponse): void {
    this.respondToServerRequest(requestId, response);
  }

  respondToApprovalRequest(requestId: number, decision: string): void {
    this.respondToServerRequest(requestId, { decision });
  }

  respondToDynamicToolCallUnsupported(requestId: number, tool: string | null | undefined): void {
    const toolLabel = tool && tool.trim().length > 0 ? tool.trim() : "dynamic tool";
    const response: DynamicToolCallResponse = {
      success: false,
      contentItems: [
        {
          type: "inputText",
          text: `Agents Office observes Codex workload but does not execute ${toolLabel} dynamic tool requests.`
        }
      ]
    };
    this.respondToServerRequest(requestId, response);
  }

  async listThreads(params: {
    cwd?: string;
    limit?: number;
    sourceKinds?: string[];
    sortKey?: ThreadListSortKey;
    sortDirection?: SortDirection;
  }): Promise<CodexThread[]> {
    const requestedLimit = Math.max(0, params.limit ?? 12);
    const sourceKinds = params.sourceKinds ?? [
      "cli",
      "vscode",
      "exec",
      "appServer",
      "subAgent",
      "subAgentReview",
      "subAgentCompact",
      "subAgentThreadSpawn",
      "subAgentOther",
      "unknown"
    ];
    const threads: CodexThread[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | null = null;

    while (threads.length < requestedLimit) {
      const result: ThreadListResult = await this.request<ThreadListResult>("thread/list", {
        cwd: appServerCwdParam(params.cwd),
        cursor,
        limit: Math.min(100, requestedLimit - threads.length),
        sortKey: params.sortKey ?? "updated_at",
        sortDirection: params.sortDirection ?? "desc",
        sourceKinds,
        archived: false
      });
      const page = result.data ?? [];
      threads.push(...page);

      const nextCursor: string | null = result.nextCursor ?? null;
      if (page.length === 0 || !nextCursor || seenCursors.has(nextCursor)) {
        break;
      }
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    }

    return threads.slice(0, requestedLimit);
  }

  async readThread(threadId: string, options: { history?: "full" | "workload" } = {}): Promise<CodexThread> {
    const result = await this.request<{ thread: CodexThread }>("thread/read", {
      threadId,
      includeTurns: false
    });
    const workload = options.history === "workload";
    const turns: CodexThread["turns"] = [];
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; ; page++) {
      if (page >= 100) throw new Error("thread/turns/list exceeded 100 pages; full history is incomplete");
      const response: {
        data: Array<CodexThread["turns"][number] & { itemsView: string }>;
        nextCursor: string | null;
      } = await this.request("thread/turns/list", {
        threadId, cursor, limit: workload ? 4 : 100,
        sortDirection: workload ? "desc" : "asc",
        itemsView: workload ? "summary" : "notLoaded"
      });
      if (!Array.isArray(response.data) || response.data.some(turn => !Array.isArray(turn.items))) {
        throw new Error("thread/turns/list returned malformed turns; history is incomplete");
      }
      turns.push(...response.data);
      if (workload) { turns.reverse(); break; }
      if (response.nextCursor === null) break;
      cursor = this.nextHistoryCursor(response.nextCursor, seenCursors, "thread/turns/list");
    }
    if (turns.length === 0) return { ...result.thread, turns };

    // Live occupancy needs recent state and actions, not every historical image/tool result.
    // Full history uses independent item pages so one long turn cannot form an enormous response.
    const entries: Array<{ turnId: string; item: CodexThread["turns"][number]["items"][number] }> = [];
    const itemCursors = new Set<string>();
    cursor = null;
    const maxPages = workload ? 4 : 2000;
    for (let page = 0; page < maxPages; page++) {
      const response = await this.readThreadItemPage(threadId, cursor, workload ? turns[turns.length - 1].id : null, workload ? "desc" : "asc");
      if (!Array.isArray(response.data) || response.data.some(entry => !entry.item || typeof entry.turnId !== "string")) {
        throw new Error("thread/items/list returned malformed items; history is incomplete");
      }
      entries.push(...response.data);
      if (response.nextCursor === null) break;
      cursor = this.nextHistoryCursor(response.nextCursor, itemCursors, "thread/items/list");
      if (!workload && page === maxPages - 1) {
        throw new Error(`thread/items/list exceeded ${maxPages} pages; full history is incomplete`);
      }
    }
    if (workload) entries.reverse();
    const byTurn = new Map(turns.map(turn => [turn.id, turn]));
    if (!workload) for (const turn of turns) turn.items = [];
    for (const entry of entries) {
      const turn = byTurn.get(entry.turnId);
      if (!turn) {
        if (workload) continue;
        throw new Error("thread/items/list returned an unknown turn; history changed during the read");
      }
      // Summary messages stay available if outside the recent action window.
      turn.items = turn.items.filter(item => item.id !== entry.item.id);
      turn.items.push(entry.item);
    }
    if (!workload) for (const turn of turns) turn.itemsView = "full";
    return { ...result.thread, turns };
  }

  private nextHistoryCursor(value: unknown, seen: Set<string>, method: string): string {
    if (typeof value !== "string" || !value || seen.has(value)) {
      throw new Error(`${method} returned an invalid or repeated cursor; full history is incomplete`);
    }
    seen.add(value);
    return value;
  }

  private async readThreadItemPage(threadId: string, cursor: string | null, turnId: string | null, sortDirection: SortDirection): Promise<{
    data: Array<{ turnId: string; item: CodexThread["turns"][number]["items"][number] }>;
    nextCursor: string | null;
  }> {
    for (let limit = 5; ; limit = Math.max(1, Math.floor(limit / 2))) {
      try {
        return await this.request("thread/items/list", { threadId, turnId, cursor, limit, sortDirection });
      } catch (error) {
        if (limit === 1 || !(error instanceof Error) || !error.message.startsWith("app-server message exceeded ")) throw error;
      }
    }
  }

  async getThreadGoal(threadId: string): Promise<AppServerThreadGoal | null> {
    const result = await this.request<ThreadGoalGetResponse>("thread/goal/get", { threadId });
    return result.goal ?? null;
  }

  async resumeThread(threadId: string, excludeTurns = false): Promise<CodexThread> {
    const result = await this.request<{ thread: CodexThread }>("thread/resume", {
      excludeTurns, threadId
    });
    return result.thread;
  }

  async startTurn(threadId: string, text: string, cwd?: string): Promise<string> {
    const result = await this.request<TurnStartResult>("turn/start", {
      threadId,
      input: [textUserInput(text)],
      cwd: cwd ?? null
    });
    return result.turn?.id ?? "";
  }

  startTurnNoWait(threadId: string, text: string, cwd?: string): number {
    return this.requestNoWait("turn/start", {
      threadId,
      input: [textUserInput(text)],
      cwd: cwd ?? null
    });
  }

  async steerTurn(threadId: string, expectedTurnId: string, text: string): Promise<string> {
    const result = await this.request<TurnSteerResult>("turn/steer", {
      threadId,
      input: [textUserInput(text)],
      expectedTurnId
    });
    return result.turnId ?? "";
  }

  steerTurnNoWait(threadId: string, expectedTurnId: string, text: string): number {
    return this.requestNoWait("turn/steer", {
      threadId,
      input: [textUserInput(text)],
      expectedTurnId
    });
  }

  async unsubscribeThread(threadId: string): Promise<"unsubscribed" | "notSubscribed" | "notLoaded"> {
    const result = await this.request<{ status: "unsubscribed" | "notSubscribed" | "notLoaded" }>("thread/unsubscribe", {
      threadId
    });
    return result.status;
  }

  async listLoadedThreads(): Promise<string[]> {
    const result = await this.request<{ data: string[] }>("thread/loaded/list", {});
    return Array.isArray(result.data) ? result.data : [];
  }

  close(): void {
    if (!this.child.killed) {
      this.child.kill();
    }
  }
}

export function codexObserverAppServerArgs(): string[] {
  return [
    "-c",
    "mcp_servers={}",
    "-c",
    "plugins={}",
    "app-server"
  ];
}

function textUserInput(text: string): TextUserInput {
  return {
    type: "text",
    text,
    text_elements: []
  };
}

export async function withAppServerClient<T>(
  fn: (client: CodexAppServerClient) => Promise<T>
): Promise<T> {
  const client = await CodexAppServerClient.create();
  try {
    return await fn(client);
  } finally {
    client.close();
  }
}
