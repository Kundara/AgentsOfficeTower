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
    const { child } = await spawnCodexProcess(["app-server"]);
    const client = new CodexAppServerClient(child);
    try {
      await withTimeout(client.request("initialize", {
        clientInfo: {
          name: "codex_agents_office",
          title: "Codex Agents Office",
          version: "0.1.0"
        },
        capabilities: {
          experimentalApi: true
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
    const { child, candidate } = await spawnCodexProcess(["app-server"]);
    const client = new CodexAppServerClient(child);
    try {
      await withTimeout(client.request("initialize", {
        clientInfo: {
          name: "codex_agents_office",
          title: "Codex Agents Office",
          version: "0.1.0"
        },
        capabilities: {
          experimentalApi: true
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
    const result = await this.request<ThreadListResult>("thread/list", {
      cwd: appServerCwdParam(params.cwd),
      limit: params.limit ?? 12,
      sortKey: params.sortKey ?? "updated_at",
      sortDirection: params.sortDirection ?? "desc",
      sourceKinds: params.sourceKinds ?? [
        "cli",
        "vscode",
        "exec",
        "appServer",
        "subAgent",
        "subAgentReview",
        "subAgentCompact",
        "subAgentThreadSpawn",
        "subAgentOther"
      ],
      archived: false
    });
    return result.data ?? [];
  }

  async readThread(threadId: string): Promise<CodexThread> {
    const result = await this.request<{ thread: CodexThread }>("thread/read", {
      threadId,
      includeTurns: true
    });
    return result.thread;
  }

  async resumeThread(threadId: string): Promise<CodexThread> {
    const result = await this.request<{ thread: CodexThread }>("thread/resume", {
      threadId
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
