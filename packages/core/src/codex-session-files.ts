import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { canonicalizeProjectPath, sameProjectPath } from "./project-paths";
import type { CodexThread, CodexTurn, ThreadItem } from "./types";

const DEFAULT_MAX_SESSION_FILES = 240;
const DEFAULT_SESSION_LOOKBACK_DAYS = 2;
const SESSION_FILE_RECENCY_MS = 24 * 60 * 60 * 1000;

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
}): Promise<string[]> {
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
              return { filePath, mtimeMs: entryStat.mtimeMs };
            } catch {
              return null;
            }
          }));
      } catch {
        return [];
      }
    }))
  ).flat().filter((entry): entry is { filePath: string; mtimeMs: number } => Boolean(entry));

  return files
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, input.maxFiles ?? DEFAULT_MAX_SESSION_FILES)
    .map((entry) => entry.filePath);
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
  const threads = await Promise.all(sessionFiles.map(async (filePath) => {
    try {
      const [contents, entryStat] = await Promise.all([
        readFile(filePath, "utf8"),
        stat(filePath)
      ]);
      return parseCodexSessionThreadFromJsonl(filePath, contents, entryStat.mtimeMs);
    } catch {
      return null;
    }
  }));

  const canonicalProjectRoot = canonicalizeProjectPath(input.projectRoot);
  return threads
    .filter((thread): thread is CodexThread => Boolean(thread))
    .filter((thread) => Boolean(canonicalProjectRoot && sameProjectPath(thread.cwd, canonicalProjectRoot)))
    .sort((left, right) => right.updatedAt - left.updatedAt);
}
