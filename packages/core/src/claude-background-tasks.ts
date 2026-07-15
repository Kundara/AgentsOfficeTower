import { constants, createReadStream } from "node:fs";
import { lstat, open, stat } from "node:fs/promises";

import { ensureAgentAppearance } from "./appearance";
import { inferredGoalFromText } from "./goal";
import type { ActivityState, DashboardAgent } from "./types";

const OUTPUT_TAIL_BYTES = 16 * 1024;
const ORPHANED_TASK_WINDOW_MS = 30 * 60 * 1000;
const RECENT_TASK_WINDOW_MS = 15 * 60 * 1000;
const MAX_VISIBLE_TASKS = 24;
const MAX_CACHED_BACKGROUND_RECORDS = 512;
const MAX_TRANSCRIPT_CACHE_ENTRIES = 64;

interface RawTranscriptCacheEntry {
  device: number;
  inode: number;
  offset: number;
  pending: string;
  records: Array<Record<string, unknown>>;
}

const rawTranscriptCache = new Map<string, RawTranscriptCacheEntry>();

function rememberRawTranscriptCache(path: string, entry: RawTranscriptCacheEntry): void {
  rawTranscriptCache.delete(path);
  rawTranscriptCache.set(path, entry);
  while (rawTranscriptCache.size > MAX_TRANSCRIPT_CACHE_ENTRIES) {
    const oldestPath = rawTranscriptCache.keys().next().value;
    if (typeof oldestPath !== "string") {
      break;
    }
    rawTranscriptCache.delete(oldestPath);
  }
}

export interface ClaudeTranscriptBackgroundTask {
  taskId: string;
  toolUseId: string | null;
  description: string | null;
  command: string | null;
  outputFile: string | null;
  state: ActivityState;
  detail: string;
  latestMessage: string | null;
  updatedAtMs: number;
  startedAtMs: number;
  isOngoing: boolean;
}

interface MutableBackgroundTask {
  taskId: string;
  toolUseId: string | null;
  description: string | null;
  command: string | null;
  outputFile: string | null;
  status: string | null;
  summary: string | null;
  updatedAtMs: number;
  startedAtMs: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value ? value as Record<string, unknown> : null;
}

function timestampMs(record: Record<string, unknown>, fallback: number): number {
  const parsed = typeof record.timestamp === "string" ? Date.parse(record.timestamp) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function xmlValue(text: string, tag: string): string | null {
  const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1]?.trim() || null;
}

function taskNotificationText(record: Record<string, unknown>): string | null {
  if (record.type === "queue-operation"
    && typeof record.content === "string"
    && record.content.includes("<task-notification>")) {
    return record.content;
  }
  const attachment = asRecord(record.attachment);
  if (attachment?.commandMode === "task-notification"
    && typeof attachment.prompt === "string"
    && attachment.prompt.includes("<task-notification>")) {
    return attachment.prompt;
  }
  const message = asRecord(record.message);
  const origin = asRecord(record.origin);
  return origin?.kind === "task-notification"
    && typeof message?.content === "string"
    && message.content.includes("<task-notification>")
    ? message.content
    : null;
}

function descriptionFromSummary(summary: string | null): string | null {
  return summary?.match(/^Background command ["“]([\s\S]*?)["”] (?:completed|failed|stopped)\b/i)?.[1]?.trim() || null;
}

function taskState(status: string | null, summary: string | null, isOngoing: boolean): ActivityState {
  const combined = `${status ?? ""} ${summary ?? ""}`.toLowerCase();
  if (/\b(fail|failed|error|blocked|denied)\b/.test(combined)) {
    return "blocked";
  }
  if (!isOngoing) {
    return "done";
  }
  return "running";
}

function cleanOutputLine(text: string): string | null {
  const ansiEscape = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g");
  const lines = text
    .replace(ansiEscape, "")
    .split(/\r?\n/)
    .map((line) => [...line]
      .filter((character) => {
        const code = character.charCodeAt(0);
        return code === 9 || code >= 32 && code !== 127;
      })
      .join("")
      .trim())
    .filter(Boolean);
  return [...lines].reverse().find((line) => /[A-Za-z]/.test(line) || line.length > 2)?.slice(0, 500)
    ?? lines.at(-1)?.slice(0, 500)
    ?? null;
}

function isSessionTaskOutputPath(path: string, sessionId: string, taskId: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  return normalized.endsWith(`/${sessionId}/tasks/${taskId}.output`);
}

async function readOutputTail(
  path: string,
  sessionId: string,
  taskId: string
): Promise<{ mtimeMs: number; latestMessage: string | null } | null> {
  if (!isSessionTaskOutputPath(path, sessionId, taskId)) {
    return null;
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW).catch(() => null);
  if (!handle) {
    return null;
  }
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) {
      return null;
    }
    const length = Math.min(Number(stats.size), OUTPUT_TAIL_BYTES);
    if (length === 0) {
      return { mtimeMs: stats.mtimeMs, latestMessage: null };
    }
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, Math.max(0, Number(stats.size) - length));
    return { mtimeMs: stats.mtimeMs, latestMessage: cleanOutputLine(buffer.toString("utf8", 0, bytesRead)) };
  } catch {
    return null;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function outputUpdatedAt(
  path: string | null,
  sessionId: string,
  taskId: string
): Promise<number> {
  if (!path || !isSessionTaskOutputPath(path, sessionId, taskId)) {
    return 0;
  }
  const entryStats = await lstat(path).catch(() => null);
  return entryStats?.isFile() && !entryStats.isSymbolicLink() ? entryStats.mtimeMs : 0;
}

function assistantToolUses(record: Record<string, unknown>): Array<Record<string, unknown>> {
  if (record.type !== "assistant") {
    return [];
  }
  const message = asRecord(record.message);
  return Array.isArray(message?.content)
    ? message.content.map(asRecord).filter((entry): entry is Record<string, unknown> => Boolean(entry?.type === "tool_use"))
    : [];
}

async function readRawBackgroundTaskRecords(transcriptPath: string | null | undefined): Promise<Array<Record<string, unknown>>> {
  const stats = transcriptPath ? await stat(transcriptPath).catch(() => null) : null;
  if (!transcriptPath || !stats?.isFile()) {
    return [];
  }
  const cached = rawTranscriptCache.get(transcriptPath);
  const canAppend = cached
    && cached.device === stats.dev
    && cached.inode === stats.ino
    && stats.size >= cached.offset;
  const entry: RawTranscriptCacheEntry = canAppend ? cached : {
    device: stats.dev,
    inode: stats.ino,
    offset: 0,
    pending: "",
    records: []
  };
  if (stats.size === entry.offset) {
    rememberRawTranscriptCache(transcriptPath, entry);
    return entry.records;
  }

  let pending = entry.pending;
  const records = [...entry.records];
  try {
    const stream = createReadStream(transcriptPath, {
      encoding: "utf8",
      start: entry.offset,
      end: Math.max(entry.offset, stats.size - 1)
    });
    for await (const chunk of stream) {
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        appendRawBackgroundTaskRecord(records, line);
      }
    }
  } catch {
    if (canAppend) {
      rememberRawTranscriptCache(transcriptPath, entry);
      return entry.records;
    }
    rawTranscriptCache.delete(transcriptPath);
    return [];
  }
  if (records.length > MAX_CACHED_BACKGROUND_RECORDS) {
    records.splice(0, records.length - MAX_CACHED_BACKGROUND_RECORDS);
  }
  const nextEntry = { ...entry, offset: stats.size, pending, records };
  rememberRawTranscriptCache(transcriptPath, nextEntry);
  return records;
}

function appendRawBackgroundTaskRecord(records: Array<Record<string, unknown>>, line: string): void {
    if (!line.includes("run_in_background")
      && !line.includes("backgroundTaskId")
      && !line.includes("<task-notification>")
      && !line.includes("Successfully stopped task:")) {
      return;
    }
    try {
      const record = asRecord(JSON.parse(line));
      if (record) {
        records.push(record);
      }
    } catch {
      // Ignore partial or malformed transcript records while Claude is writing.
    }
}

function toolResults(record: Record<string, unknown>): Array<Record<string, unknown>> {
  const message = asRecord(record.message);
  return Array.isArray(message?.content)
    ? message.content.map(asRecord).filter((entry): entry is Record<string, unknown> => Boolean(entry?.type === "tool_result"))
    : [];
}

function ensureTask(tasks: Map<string, MutableBackgroundTask>, taskId: string, updatedAtMs: number): MutableBackgroundTask {
  const existing = tasks.get(taskId);
  if (existing) {
    return existing;
  }
  const created: MutableBackgroundTask = {
    taskId,
    toolUseId: null,
    description: null,
    command: null,
    outputFile: null,
    status: null,
    summary: null,
    updatedAtMs,
    startedAtMs: updatedAtMs
  };
  tasks.set(taskId, created);
  return created;
}

export async function readClaudeTranscriptBackgroundTasks(input: {
  sessionId: string;
  records: Array<Record<string, unknown>>;
  fallbackUpdatedAt: number;
  transcriptPath?: string | null;
  now?: number;
}): Promise<ClaudeTranscriptBackgroundTask[]> {
  const now = input.now ?? Date.now();
  const startsByToolUseId = new Map<string, { description: string | null; command: string | null; startedAtMs: number }>();
  const tasks = new Map<string, MutableBackgroundTask>();
  const rawRecords = await readRawBackgroundTaskRecords(input.transcriptPath);

  for (const record of [...rawRecords, ...input.records]) {
    const updatedAtMs = timestampMs(record, input.fallbackUpdatedAt);
    for (const tool of assistantToolUses(record)) {
      const toolInput = asRecord(tool.input);
      if (tool.name === "Bash" && toolInput?.run_in_background === true && typeof tool.id === "string") {
        startsByToolUseId.set(tool.id, {
          description: typeof toolInput.description === "string" ? toolInput.description : null,
          command: typeof toolInput.command === "string" ? toolInput.command : null,
          startedAtMs: updatedAtMs
        });
      }
    }

    for (const result of toolResults(record)) {
      const content = typeof result.content === "string" ? result.content : "";
      const resultMeta = asRecord(record.toolUseResult);
      const taskId = typeof resultMeta?.backgroundTaskId === "string"
        ? resultMeta.backgroundTaskId
        : content.match(/background with ID:\s*([\w-]+)/i)?.[1] ?? null;
      const toolUseId = typeof result.tool_use_id === "string" ? result.tool_use_id : null;
      const start = toolUseId ? startsByToolUseId.get(toolUseId) : null;
      if (taskId && toolUseId && start) {
        const task = ensureTask(tasks, taskId, updatedAtMs);
        task.toolUseId = toolUseId;
        task.description = start.description ?? task.description;
        task.command = start.command ?? task.command;
        task.startedAtMs = start.startedAtMs;
        task.outputFile = content.match(/Output is being written to:\s*([^\s]+\.output)/i)?.[1] ?? task.outputFile;
        task.updatedAtMs = Math.max(task.updatedAtMs, updatedAtMs);
      }

      if (/Successfully stopped task:/i.test(content)) {
        const stoppedId = content.match(/Successfully stopped task:\s*([\w-]+)/i)?.[1] ?? null;
        const task = stoppedId ? tasks.get(stoppedId) : null;
        if (task) {
          task.status = "stopped";
          task.summary = `Background task ${stoppedId} stopped`;
          task.updatedAtMs = Math.max(task.updatedAtMs, updatedAtMs);
        }
      }
    }

    const notification = taskNotificationText(record);
    const taskId = notification ? xmlValue(notification, "task-id") : null;
    const task = taskId ? tasks.get(taskId) : null;
    if (notification && taskId && task) {
      const toolUseId = xmlValue(notification, "tool-use-id");
      const start = toolUseId ? startsByToolUseId.get(toolUseId) : null;
      task.toolUseId = toolUseId ?? task.toolUseId;
      task.description = start?.description ?? descriptionFromSummary(xmlValue(notification, "summary")) ?? task.description;
      task.command = start?.command ?? task.command;
      task.outputFile = xmlValue(notification, "output-file") ?? task.outputFile;
      task.status = xmlValue(notification, "status") ?? task.status;
      task.summary = xmlValue(notification, "summary") ?? task.summary;
      task.startedAtMs = start?.startedAtMs ?? task.startedAtMs;
      task.updatedAtMs = Math.max(task.updatedAtMs, updatedAtMs);
    }
  }

  const candidates = await Promise.all([...tasks.values()].map(async (task) => {
    const updatedAtMs = Math.max(
      task.updatedAtMs,
      await outputUpdatedAt(task.outputFile, input.sessionId, task.taskId)
    );
    const explicitlyFinished = Boolean(task.status && /^(completed|failed|error|stopped|cancelled)$/i.test(task.status));
    const isOngoing = !explicitlyFinished && now - updatedAtMs <= ORPHANED_TASK_WINDOW_MS;
    return { task, updatedAtMs, explicitlyFinished, isOngoing };
  }));
  const visible = candidates
    .filter(({ isOngoing, updatedAtMs }) => isOngoing || now - updatedAtMs <= RECENT_TASK_WINDOW_MS)
    .sort((left, right) => right.updatedAtMs - left.updatedAtMs)
    .slice(0, MAX_VISIBLE_TASKS);

  return Promise.all(visible.map(async ({ task, updatedAtMs: candidateUpdatedAtMs, explicitlyFinished }) => {
    const output = task.outputFile ? await readOutputTail(task.outputFile, input.sessionId, task.taskId) : null;
    const updatedAtMs = Math.max(candidateUpdatedAtMs, output?.mtimeMs ?? 0);
    const isOngoing = !explicitlyFinished && now - updatedAtMs <= ORPHANED_TASK_WINDOW_MS;
    const state = taskState(task.status, task.summary, isOngoing);
    const latestMessage = output?.latestMessage ?? null;
    return {
      taskId: task.taskId,
      toolUseId: task.toolUseId,
      description: task.description,
      command: task.command,
      outputFile: task.outputFile,
      state,
      detail: latestMessage ?? task.summary ?? task.description ?? `Background task ${task.taskId}`,
      latestMessage,
      updatedAtMs,
      startedAtMs: task.startedAtMs,
      isOngoing
    };
  }));
}

function shorten(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`;
}

export async function buildClaudeTranscriptBackgroundTaskAgents(input: {
  projectRoot: string;
  sessionId: string;
  cwd: string;
  gitBranch: string | null;
  records: Array<Record<string, unknown>>;
  fallbackUpdatedAt: number;
  transcriptPath?: string | null;
}): Promise<DashboardAgent[]> {
  const tasks = await readClaudeTranscriptBackgroundTasks(input);
  return Promise.all(tasks.map(async (task) => {
    const id = `claude:${input.sessionId}:agent:background-task:${task.taskId}`;
    const parentThreadId = `claude:${input.sessionId}`;
    const updatedAt = new Date(task.updatedAtMs).toISOString();
    const appearance = await ensureAgentAppearance(input.projectRoot, id);
    return {
      id,
      label: task.description ?? `Background task ${task.taskId}`,
      source: "claude",
      sourceKind: "claude:background-task",
      parentThreadId,
      depth: 1,
      isCurrent: false,
      isOngoing: task.isOngoing,
      statusText: task.isOngoing ? "running" : task.state,
      role: "background task",
      nickname: task.taskId,
      isSubagent: true,
      state: task.state,
      detail: shorten(task.detail, 88),
      cwd: input.cwd,
      roomId: null,
      appearance,
      updatedAt,
      stoppedAt: task.isOngoing ? null : updatedAt,
      paths: [input.cwd],
      activityEvent: task.isOngoing ? {
        type: "commandExecution",
        action: "ran",
        path: input.cwd,
        title: task.description ?? `Background task ${task.taskId}`,
        isImage: false
      } : null,
      goal: inferredGoalFromText({
        kind: "claudeSubagent",
        objective: task.description,
        state: task.state,
        updatedAt,
        createdAt: new Date(task.startedAtMs).toISOString()
      }),
      latestMessage: task.latestMessage,
      threadId: id,
      taskId: task.taskId,
      resumeCommand: null,
      url: null,
      git: { sha: null, branch: input.gitBranch, originUrl: null },
      provenance: "claude",
      confidence: "inferred",
      needsUser: null,
      liveSubscription: "readOnly",
      network: null
    } satisfies DashboardAgent;
  }));
}
