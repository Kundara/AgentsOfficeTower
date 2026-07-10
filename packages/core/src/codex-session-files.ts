import { open, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { canonicalizeProjectPath, sameProjectPath } from "./project-paths";
import type { CodexThread, CodexTurn, ThreadItem } from "./types";

const DEFAULT_MAX_SESSION_FILES = 240;
const DEFAULT_SESSION_LOOKBACK_DAYS = 2;
const SESSION_FILE_RECENCY_MS = 24 * 60 * 60 * 1000;
const SESSION_META_PREFIX_BYTES = 64 * 1024;
const SESSION_META_CACHE_LIMIT = 512;
const SESSION_META_READ_CONCURRENCY = 12;
const SESSION_FULL_READ_CONCURRENCY = 3;

type RecentSessionFile = {
  filePath: string;
  mtimeMs: number;
  size: number;
};

type SessionMetaProbe =
  | { kind: "known"; cwd: string | null; isSubagent: boolean }
  | { kind: "unknown" };

type SessionMetaCacheEntry = {
  signature: string;
  promise: Promise<SessionMetaProbe>;
};

const sessionMetaCache = new Map<string, SessionMetaCacheEntry>();
const fullSessionReadInFlight = new Map<string, Promise<CodexThread | null>>();
const fullSessionReadWaiters: Array<() => void> = [];
let activeFullSessionReads = 0;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function unixSecondsFromIso(value: string | null, fallbackMs: number): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Math.floor((Number.isFinite(parsed) ? parsed : fallbackMs) / 1000);
}

function sessionDateDirectories(now = new Date(), lookbackDays = DEFAULT_SESSION_LOOKBACK_DAYS): string[] {
  const root = join(homedir(), ".codex", "sessions");
  const directories: string[] = [];
  for (let offset = 0; offset < lookbackDays; offset += 1) {
    const date = new Date(now.getTime() - offset * 24 * 60 * 60 * 1000);
    const year = String(date.getFullYear()).padStart(4, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    directories.push(join(root, year, month, day));
  }
  return directories;
}

async function listRecentSessionFiles(input: {
  now?: Date;
  maxFiles?: number;
  lookbackDays?: number;
  sessionDirectories?: string[];
}): Promise<RecentSessionFile[]> {
  const nowMs = (input.now ?? new Date()).getTime();
  const directories = input.sessionDirectories ?? sessionDateDirectories(input.now, input.lookbackDays);
  const files = (
    await Promise.all(directories.map(async (directory) => {
      try {
        const entries = await readdir(directory, { withFileTypes: true });
        return await Promise.all(entries
          .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
          .map(async (entry) => {
            const filePath = join(directory, entry.name);
            try {
              const entryStat = await stat(filePath);
              if (nowMs - entryStat.mtimeMs > SESSION_FILE_RECENCY_MS) {
                return null;
              }
              return { filePath, mtimeMs: entryStat.mtimeMs, size: entryStat.size };
            } catch {
              return null;
            }
          }));
      } catch {
        return [];
      }
    }))
  ).flat().filter((entry): entry is RecentSessionFile => Boolean(entry));

  return files
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, input.maxFiles ?? DEFAULT_MAX_SESSION_FILES);
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>
): Promise<R[]> {
  if (values.length === 0) {
    return [];
  }
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(values.length, Math.max(1, concurrency)) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(values[index], index);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

function sessionFileSignature(file: RecentSessionFile): string {
  return `${file.mtimeMs}:${file.size}`;
}

function fullSessionReadKey(file: RecentSessionFile): string {
  return `${file.filePath}\u0000${sessionFileSignature(file)}`;
}

function pruneSessionMetaCache(): void {
  while (sessionMetaCache.size > SESSION_META_CACHE_LIMIT) {
    const oldestKey = sessionMetaCache.keys().next().value as string | undefined;
    if (!oldestKey) {
      return;
    }
    sessionMetaCache.delete(oldestKey);
  }
}

async function readSessionMetaPrefix(file: RecentSessionFile): Promise<SessionMetaProbe> {
  const handle = await open(file.filePath, "r");
  try {
    const length = Math.min(file.size, SESSION_META_PREFIX_BYTES);
    if (length <= 0) {
      return { kind: "unknown" };
    }
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    const prefix = buffer.subarray(0, bytesRead).toString("utf8").replace(/^\uFEFF/, "");
    const newlineIndex = prefix.search(/\r?\n/);
    if (newlineIndex < 0 && file.size > bytesRead) {
      return { kind: "unknown" };
    }
    const firstLine = (newlineIndex >= 0 ? prefix.slice(0, newlineIndex) : prefix).trim();
    const entry = parseJsonLine(firstLine);
    const payload = asRecord(entry?.payload);
    if (!entry || entry.type !== "session_meta" || !payload) {
      return { kind: "unknown" };
    }
    return {
      kind: "known",
      cwd: asString(payload.cwd),
      isSubagent: sessionSourceIsSubagent(payload.source, asString(payload.thread_source))
    };
  } finally {
    await handle.close();
  }
}

function getSessionMetaProbe(file: RecentSessionFile): Promise<SessionMetaProbe> {
  const signature = sessionFileSignature(file);
  const cached = sessionMetaCache.get(file.filePath);
  if (cached?.signature === signature) {
    sessionMetaCache.delete(file.filePath);
    sessionMetaCache.set(file.filePath, cached);
    return cached.promise;
  }

  const promise = readSessionMetaPrefix(file).catch((): SessionMetaProbe => ({ kind: "unknown" }));
  sessionMetaCache.set(file.filePath, { signature, promise });
  pruneSessionMetaCache();
  return promise;
}

async function acquireFullSessionReadSlot(): Promise<void> {
  if (activeFullSessionReads < SESSION_FULL_READ_CONCURRENCY) {
    activeFullSessionReads += 1;
    return;
  }
  await new Promise<void>((resolve) => fullSessionReadWaiters.push(resolve));
}

function releaseFullSessionReadSlot(): void {
  const next = fullSessionReadWaiters.shift();
  if (next) {
    // Transfer the occupied slot directly to the next reader.
    next();
    return;
  }
  activeFullSessionReads = Math.max(0, activeFullSessionReads - 1);
}

async function readAndParseSessionFile(file: RecentSessionFile): Promise<CodexThread | null> {
  const key = fullSessionReadKey(file);
  const existing = fullSessionReadInFlight.get(key);
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    await acquireFullSessionReadSlot();
    try {
      const contents = await readFile(file.filePath, "utf8");
      const thread = parseCodexSessionThreadFromJsonl(file.filePath, contents, file.mtimeMs);
      if (thread) {
        sessionMetaCache.set(file.filePath, {
          signature: sessionFileSignature(file),
          promise: Promise.resolve({ kind: "known", cwd: thread.cwd, isSubagent: true })
        });
        pruneSessionMetaCache();
      }
      return thread;
    } catch {
      return null;
    } finally {
      releaseFullSessionReadSlot();
    }
  })();
  fullSessionReadInFlight.set(key, promise);
  void promise.finally(() => {
    if (fullSessionReadInFlight.get(key) === promise) {
      fullSessionReadInFlight.delete(key);
    }
  });
  return promise;
}

function parseJsonLine(line: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(line));
  } catch {
    return null;
  }
}

function contentText(content: unknown): string | null {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return null;
  }
  const text = content
    .map((entry) => asRecord(entry))
    .map((entry) => asString(entry?.text))
    .filter((entry): entry is string => Boolean(entry))
    .join("\n")
    .trim();
  return text.length > 0 ? text : null;
}

function parseNestedAgentEnvelope(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) {
    return text;
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const content = asString(parsed.content);
    return content ?? text;
  } catch {
    return text;
  }
}

function parseCommandArguments(argumentsText: string | null): { command: string; cwd?: string } | null {
  if (!argumentsText) {
    return null;
  }
  try {
    const parsed = JSON.parse(argumentsText) as Record<string, unknown>;
    const command = asString(parsed.cmd);
    if (!command) {
      return null;
    }
    return {
      command,
      cwd: asString(parsed.workdir) ?? undefined
    };
  } catch {
    return null;
  }
}

function outputSucceeded(output: string | null): boolean {
  if (!output) {
    return true;
  }
  const exitMatch = output.match(/Process exited with code\s+(\d+)/);
  return !exitMatch || exitMatch[1] === "0";
}

function sessionSourceIsSubagent(source: unknown, threadSource: string | null): boolean {
  if (threadSource?.toLowerCase() === "subagent") {
    return true;
  }
  const record = asRecord(source);
  return Boolean(record?.subagent || record?.subAgent || record?.sub_agent);
}

function ensureTurn(turnsById: Map<string, CodexTurn>, turnId: string): CodexTurn {
  const existing = turnsById.get(turnId);
  if (existing) {
    return existing;
  }
  const turn: CodexTurn = {
    id: turnId,
    status: "inProgress",
    error: null,
    items: []
  };
  turnsById.set(turnId, turn);
  return turn;
}

function pushResponseItem(input: {
  payload: Record<string, unknown>;
  turn: CodexTurn;
  itemIndex: number;
  pendingToolItems: Map<string, ThreadItem>;
}): void {
  const type = asString(input.payload.type);
  if (!type) {
    return;
  }

  if (type === "message") {
    const text = contentText(input.payload.content);
    if (!text) {
      return;
    }
    const role = asString(input.payload.role);
    const normalizedText = parseNestedAgentEnvelope(text);
    if (normalizedText.trim().startsWith("<turn_aborted>")) {
      return;
    }
    input.turn.items.push({
      type: role === "user" ? "userMessage" : "agentMessage",
      id: `session-item-${input.itemIndex}`,
      text: normalizedText,
      phase: asString(input.payload.phase) ?? (role === "assistant" ? "commentary" : "updated")
    });
    return;
  }

  if (type === "reasoning") {
    const summary = contentText(input.payload.summary) ?? asString(input.payload.text) ?? "Reasoning";
    input.turn.items.push({
      type: "reasoning",
      id: `session-item-${input.itemIndex}`,
      summary,
      status: "completed"
    });
    return;
  }

  if (type === "function_call") {
    const callId = asString(input.payload.call_id) ?? `session-call-${input.itemIndex}`;
    const toolName = asString(input.payload.name) ?? "tool";
    const command = toolName === "exec_command"
      ? parseCommandArguments(asString(input.payload.arguments))
      : null;
    const item: ThreadItem = command
      ? {
        type: "commandExecution",
        id: callId,
        command: command.command,
        cwd: command.cwd,
        status: "inProgress"
      }
      : {
        type: "dynamicToolCall",
        id: callId,
        tool: toolName,
        status: "inProgress"
      };
    input.pendingToolItems.set(callId, item);
    input.turn.items.push(item);
    return;
  }

  if (type === "function_call_output") {
    const callId = asString(input.payload.call_id);
    const item = callId ? input.pendingToolItems.get(callId) : null;
    if (item) {
      item.status = outputSucceeded(asString(input.payload.output)) ? "completed" : "failed";
    }
  }
}

export function parseCodexSessionThreadFromJsonl(
  filePath: string,
  text: string,
  fallbackMtimeMs = Date.now()
): CodexThread | null {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return null;
  }

  let meta: Record<string, unknown> | undefined;
  let currentTurnId: string | null = null;
  let latestTimestamp: string | null = null;
  let latestTaskEvent: "started" | "complete" | "aborted" | null = null;
  const turnsById = new Map<string, CodexTurn>();
  const pendingToolItems = new Map<string, ThreadItem>();

  lines.forEach((line, lineIndex) => {
    const entry = parseJsonLine(line);
    if (!entry) {
      return;
    }
    latestTimestamp = asString(entry.timestamp) ?? latestTimestamp;
    const payload = asRecord(entry.payload);
    if (!payload) {
      return;
    }
    if (entry.type === "session_meta") {
      meta = payload;
      return;
    }
    if (entry.type === "turn_context") {
      currentTurnId = asString(payload.turn_id) ?? currentTurnId;
      if (currentTurnId) {
        ensureTurn(turnsById, currentTurnId);
      }
      return;
    }
    if (entry.type === "event_msg") {
      const payloadType = asString(payload.type);
      const turnId = asString(payload.turn_id) ?? currentTurnId;
      if (payloadType === "task_started") {
        latestTaskEvent = "started";
        currentTurnId = turnId ?? currentTurnId;
        if (currentTurnId) {
          ensureTurn(turnsById, currentTurnId).status = "inProgress";
        }
        return;
      }
      if (payloadType === "task_complete") {
        latestTaskEvent = "complete";
        if (turnId) {
          const turn = ensureTurn(turnsById, turnId);
          turn.status = "completed";
          const lastMessage = asString(payload.last_agent_message);
          if (lastMessage) {
            turn.items.push({
              type: "agentMessage",
              id: `session-item-${lineIndex}`,
              text: lastMessage,
              phase: "final_answer"
            });
          }
        }
        return;
      }
      if (payloadType === "turn_aborted") {
        latestTaskEvent = "aborted";
        if (turnId) {
          ensureTurn(turnsById, turnId).status = "interrupted";
        }
        return;
      }
      if (payloadType === "agent_message") {
        const message = asString(payload.message);
        if (message && currentTurnId) {
          ensureTurn(turnsById, currentTurnId).items.push({
            type: "agentMessage",
            id: `session-item-${lineIndex}`,
            text: parseNestedAgentEnvelope(message),
            phase: asString(payload.phase) ?? "commentary"
          });
        }
      }
      return;
    }
    if (entry.type === "response_item" && currentTurnId) {
      pushResponseItem({
        payload,
        turn: ensureTurn(turnsById, currentTurnId),
        itemIndex: lineIndex,
        pendingToolItems
      });
    }
  });

  const sessionMeta = meta as Record<string, unknown> | undefined;
  if (!sessionMeta) {
    return null;
  }

  const id = asString(sessionMeta.id);
  const cwd = asString(sessionMeta.cwd);
  if (!id || !cwd || !sessionSourceIsSubagent(sessionMeta.source, asString(sessionMeta.thread_source))) {
    return null;
  }

  const latestMs = Date.parse(latestTimestamp ?? "") || fallbackMtimeMs;
  const createdAt = unixSecondsFromIso(asString(sessionMeta.timestamp), fallbackMtimeMs);
  const updatedAt = Math.floor(latestMs / 1000);
  const turns = [...turnsById.values()];
  const lastTurn = turns.at(-1) ?? null;
  if (latestTaskEvent === "complete" && lastTurn && lastTurn.status === "inProgress") {
    lastTurn.status = "completed";
  }
  if (latestTaskEvent === "aborted" && lastTurn && lastTurn.status === "inProgress") {
    lastTurn.status = "interrupted";
  }

  const preview =
    asString(sessionMeta.agent_nickname)
    ?? asString(sessionMeta.agent_path)
    ?? asString(sessionMeta.agent_role)
    ?? "Subagent";

  return {
    id,
    preview,
    ephemeral: false,
    modelProvider: asString(sessionMeta.model_provider) ?? "openai",
    createdAt,
    updatedAt,
    status: latestTaskEvent === "started" ? { type: "active", activeFlags: [] } : { type: "notLoaded" },
    path: filePath,
    cwd,
    cliVersion: asString(sessionMeta.cli_version) ?? "",
    source: asRecord(sessionMeta.source) ?? { subagent: {} },
    agentNickname: asString(sessionMeta.agent_nickname),
    agentRole: asString(sessionMeta.agent_role),
    gitInfo: null,
    name: null,
    turns
  };
}

export async function discoverCodexSessionThreads(input: {
  projectRoot: string;
  maxFiles?: number;
  now?: Date;
  sessionDirectories?: string[];
}): Promise<CodexThread[]> {
  const sessionFiles = await listRecentSessionFiles({
    now: input.now,
    maxFiles: input.maxFiles,
    sessionDirectories: input.sessionDirectories
  });
  const canonicalProjectRoot = canonicalizeProjectPath(input.projectRoot);
  if (!canonicalProjectRoot) {
    return [];
  }

  const probes = await mapWithConcurrency(
    sessionFiles,
    SESSION_META_READ_CONCURRENCY,
    async (file) => ({ file, probe: await getSessionMetaProbe(file) })
  );
  const candidates = probes
    .filter(({ probe }) => {
      if (probe.kind === "unknown") {
        // Older or partially-written session files still get a compatibility
        // parse, but only through the bounded global full-read queue.
        return true;
      }
      return probe.isSubagent
        && Boolean(probe.cwd && sameProjectPath(probe.cwd, canonicalProjectRoot));
    })
    .map(({ file }) => file);
  const threads = await mapWithConcurrency(
    candidates,
    SESSION_FULL_READ_CONCURRENCY,
    readAndParseSessionFile
  );

  return threads
    .filter((thread): thread is CodexThread => Boolean(thread))
    .filter((thread) => sameProjectPath(thread.cwd, canonicalProjectRoot))
    .sort((left, right) => right.updatedAt - left.updatedAt);
}
