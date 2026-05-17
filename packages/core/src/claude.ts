import { open, readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";

import { ensureAgentAppearance } from "./appearance";
import { getClaudeSdkSessionRecords, listClaudeSdkSessions, resolveReadableClaudeHooksFilePath } from "./claude-agent-sdk";
import { sameProjectPath, type DiscoveredProject } from "./project-paths";
import type { AgentActivityEvent, ActivityState, AgentConfidence, DashboardAgent, DashboardEvent, NeedsUserQuestion, NeedsUserState } from "./types";

const CLAUDE_PROJECTS_DIR = join(homedir(), ".claude", "projects");
const CLAUDE_TEAMS_DIR = join(homedir(), ".claude", "teams");
const CLAUDE_COWORK_LOCAL_AGENT_DIR_NAME = "local-agent-mode-sessions";
const LOG_HEAD_BYTES = 4096;
const LOG_TAIL_BYTES = 65536;
const RECENT_CLAUDE_HOOK_ACTIVE_WINDOW_MS = 2 * 60 * 1000;
const RECENT_MESSAGE_WINDOW_MS = 5 * 60 * 1000;
const RECENT_DONE_WINDOW_MS = 15 * 60 * 1000;
const RECENT_CLAUDE_TEAM_DISCOVERY_WINDOW_MS = 24 * 60 * 60 * 1000;
const ACTIVE_CLAUDE_TEAM_DISCOVERY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const RECENT_CLAUDE_COWORK_DISCOVERY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const CLAUDE_COWORK_SCAN_FILE_LIMIT = 200;

interface ClaudeProjectDir {
  root: string;
  dirPath: string;
  updatedAt: number;
  count: number;
  files: Array<{ path: string; updatedAt: number }>;
}

interface ClaudeSdkProject {
  root: string;
  updatedAt: number;
  count: number;
}

interface ClaudeSdkSessionEntry {
  sessionId: string;
  updatedAt: number;
  cwd: string;
  gitBranch: string | null;
  records: Array<Record<string, unknown>>;
}

interface ClaudeLoadedSession {
  sessionId: string;
  cwd: string;
  gitBranch: string | null;
  updatedAt: number;
  records: Array<Record<string, unknown>>;
  hookRecords: Array<Record<string, unknown>>;
  summary: ClaudeActivitySummary;
}

export interface ClaudeTeamMember {
  agentId: string;
  name: string;
  agentType: string | null;
  model: string | null;
  prompt: string | null;
  color: string | null;
  joinedAt: number | null;
  tmuxPaneId: string | null;
  cwd: string;
  worktreePath: string | null;
  sessionId: string | null;
  subscriptions: string[];
  backendType: string | null;
  isActive: boolean;
  mode: string | null;
}

export interface ClaudeTeamSnapshot {
  name: string;
  description: string | null;
  leadAgentId: string | null;
  leadSessionId: string | null;
  updatedAt: number;
  members: ClaudeTeamMember[];
}

interface ClaudeTeamMemberContext {
  team: ClaudeTeamSnapshot;
  member: ClaudeTeamMember;
  leadSessionId: string | null;
}

interface ClaudeTeamIndex {
  bySessionId: Map<string, ClaudeTeamMemberContext>;
  byLeadAndAgentId: Map<string, ClaudeTeamMemberContext>;
  contexts: ClaudeTeamMemberContext[];
}

export interface ClaudeCoworkSpace {
  id: string | null;
  name: string;
  root: string;
  instructions: string | null;
  updatedAt: number;
}

export interface ClaudeCoworkSession {
  sessionId: string;
  cliSessionId: string | null;
  processName: string | null;
  vmProcessName: string | null;
  title: string | null;
  initialMessage: string | null;
  model: string | null;
  spaceId: string | null;
  roots: string[];
  filePaths: string[];
  createdAt: number;
  updatedAt: number;
  isArchived: boolean;
}

const CLAUDE_EVENT_WINDOW_MS = 2 * 60 * 1000;

interface ClaudeActivitySummary {
  label: string;
  sourceKind: string;
  state: ActivityState;
  detail: string;
  updatedAt: string;
  paths: string[];
  activityEvent: AgentActivityEvent | null;
  gitBranch: string | null;
  confidence: AgentConfidence;
  needsUser: NeedsUserState | null;
  latestMessage: string | null;
  isOngoing: boolean;
}

function isTransientClaudeState(state: ActivityState): boolean {
  return [
    "planning",
    "scanning",
    "thinking",
    "editing",
    "running",
    "validating",
    "delegating"
  ].includes(state);
}

function ageClaudeSummary(summary: ClaudeActivitySummary, now = Date.now()): ClaudeActivitySummary {
  if (summary.needsUser !== null || summary.state === "waiting" || summary.state === "blocked") {
    return summary;
  }

  if (!isTransientClaudeState(summary.state)) {
    return summary;
  }

  const updatedAtMs = Date.parse(summary.updatedAt);
  if (!Number.isFinite(updatedAtMs)) {
    return summary;
  }

  const ageMs = now - updatedAtMs;
  if (ageMs <= RECENT_CLAUDE_HOOK_ACTIVE_WINDOW_MS) {
    return summary;
  }

  if (ageMs <= RECENT_DONE_WINDOW_MS) {
    return {
      ...summary,
      state: "done",
      isOngoing: false,
      activityEvent: null
    };
  }

  return {
    ...summary,
    state: "idle",
    detail: "Idle",
    isOngoing: false,
    activityEvent: null,
    latestMessage: null
  };
}

function claudeEventKindFromActivityEvent(event: AgentActivityEvent | null): DashboardEvent["kind"] {
  if (!event) {
    return "other";
  }
  if (event.type === "collabAgentToolCall" || event.type === "collabToolCall") {
    return "subagent";
  }
  if (event.type === "mcpToolCall" || event.type === "dynamicToolCall") {
    return "tool";
  }
  if (event.type === "fileChange") {
    return "fileChange";
  }
  if (event.type === "commandExecution") {
    return "command";
  }
  if (event.type === "userMessage" || event.type === "agentMessage") {
    return "message";
  }
  return "other";
}

function claudeCollabActivityEvent(input: {
  detail: string;
  path: string | null;
}): AgentActivityEvent {
  return {
    type: "collabAgentToolCall",
    action: "updated",
    path: input.path,
    title: shorten(input.detail, 88),
    isImage: false
  };
}

function claudeLeadAgentId(sessionId: string): string {
  return `claude:${sessionId}`;
}

function claudeChildAgentId(sessionId: string, agentId: string): string {
  return `${claudeLeadAgentId(sessionId)}:agent:${agentId}`;
}

function claudeTeamFallbackAgentId(teamName: string, agentId: string): string {
  return `claude:team:${teamName}:agent:${agentId}`;
}

function claudeTeamMemberContextKey(leadSessionId: string, agentId: string): string {
  return `${leadSessionId}\u0000${agentId}`;
}

function claudeTeamAgentId(context: ClaudeTeamMemberContext): string {
  if (context.member.sessionId) {
    return claudeLeadAgentId(context.member.sessionId);
  }
  if (context.leadSessionId) {
    return claudeChildAgentId(context.leadSessionId, context.member.agentId);
  }
  return claudeTeamFallbackAgentId(context.team.name, context.member.agentId);
}

function claudeTeamParentAgentId(context: ClaudeTeamMemberContext): string | null {
  return context.leadSessionId ? claudeLeadAgentId(context.leadSessionId) : null;
}

function claudeTeamMemberPrimaryCwd(member: ClaudeTeamMember): string {
  return member.worktreePath ?? member.cwd;
}

function claudeHookAgentId(record: Record<string, unknown>): string | null {
  return stringValue(record, "agent_id", "agentId");
}

function claudeHookAgentType(record: Record<string, unknown>): string | null {
  return stringValue(record, "agent_type", "agentType");
}

function claudeHookChildThreadId(input: {
  sessionId: string;
  record: Record<string, unknown>;
  teamIndex?: ClaudeTeamIndex;
}): string {
  const agentId = claudeHookAgentId(input.record);
  if (!agentId) {
    return input.sessionId;
  }
  const context = input.teamIndex?.byLeadAndAgentId.get(claudeTeamMemberContextKey(input.sessionId, agentId));
  return context?.member.sessionId ?? claudeChildAgentId(input.sessionId, agentId);
}

function claudeCoworkAgentId(sessionId: string): string {
  return `claude:cowork:${sessionId}`;
}

function uniqueCanonicalPaths(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => canonicalizeProjectPath(value))
        .filter((value): value is string => Boolean(value))
    )
  );
}

function appDataClaudeDirs(): string[] {
  const candidates = [
    process.env.APPDATA ? join(process.env.APPDATA, "Claude") : null,
    join(homedir(), "AppData", "Roaming", "Claude"),
    join(homedir(), "Library", "Application Support", "Claude"),
    join(homedir(), ".config", "Claude")
  ];
  return Array.from(new Set(candidates.filter((candidate): candidate is string => Boolean(candidate))));
}

function claudeCoworkLocalAgentDirs(): string[] {
  return appDataClaudeDirs().map((dir) => join(dir, CLAUDE_COWORK_LOCAL_AGENT_DIR_NAME));
}

function titleCaseIdentifier(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function parseClaudeSchemaOptions(schema: Record<string, unknown>): NeedsUserQuestion["options"] {
  const enumValues = stringArray(schema.enum);
  if (enumValues.length > 0) {
    return enumValues.map((value) => ({
      label: value,
      description: value
    }));
  }

  const oneOf = Array.isArray(schema.oneOf) ? schema.oneOf : [];
  const options = oneOf
    .map((entry) => {
      const option = asRecord(entry);
      if (!option) {
        return null;
      }
      const constValue = typeof option.const === "string" ? option.const : null;
      if (!constValue) {
        return null;
      }
      return {
        label: typeof option.title === "string" && option.title.trim().length > 0 ? option.title : constValue,
        description: typeof option.description === "string" && option.description.trim().length > 0 ? option.description : constValue
      };
    })
    .filter((option): option is NonNullable<typeof option> => Boolean(option));
  return options.length > 0 ? options : null;
}

function parseClaudeElicitationQuestions(record: Record<string, unknown>): NeedsUserQuestion[] | null {
  const requestedSchema = asRecord(record.requested_schema);
  if (!requestedSchema) {
    return null;
  }
  const properties = asRecord(requestedSchema.properties);
  if (!properties) {
    return null;
  }
  const required = new Set(stringArray(requestedSchema.required));
  const questions = Object.entries(properties)
    .map(([id, rawSchema]) => {
      const schema = asRecord(rawSchema);
      if (!schema) {
        return null;
      }
      const header =
        typeof schema.title === "string" && schema.title.trim().length > 0
          ? schema.title.trim()
          : titleCaseIdentifier(id);
      const question =
        typeof schema.description === "string" && schema.description.trim().length > 0
          ? schema.description.trim()
          : header;
      return {
        header,
        id,
        question,
        required: required.has(id),
        isSecret: schema.writeOnly === true || schema.format === "password",
        options: parseClaudeSchemaOptions(schema)
      } satisfies NeedsUserQuestion;
    })
    .filter((question) => question !== null);
  return questions.length > 0 ? questions : null;
}

function claudeEventFromSummary(input: {
  threadId: string;
  createdAt: string;
  summary: ClaudeActivitySummary;
  confidence: AgentConfidence;
  id: string;
}): DashboardEvent | null {
  const createdAtMs = Date.parse(input.createdAt);
  if (!Number.isFinite(createdAtMs) || Date.now() - createdAtMs > CLAUDE_EVENT_WINDOW_MS) {
    return null;
  }

  const event = input.summary.activityEvent;
  if (!event && input.summary.needsUser === null && !input.summary.latestMessage) {
    return null;
  }

  return {
    id: input.id,
    source: "claude",
    confidence: input.confidence,
    threadId: input.threadId,
    createdAt: input.createdAt,
    method:
      event?.type === "fileChange" ? "claude/fileChange"
      : event?.type === "commandExecution" ? "claude/commandExecution"
      : event?.type === "collabAgentToolCall" || event?.type === "collabToolCall" ? "claude/collabAgentToolCall"
      : event?.type === "mcpToolCall" || event?.type === "dynamicToolCall" ? "claude/toolCall"
      : event?.type === "userMessage" ? "claude/userMessage"
      : event?.type === "agentMessage" ? "claude/agentMessage"
      : input.summary.needsUser?.kind === "approval" ? "claude/permissionRequest"
      : input.summary.needsUser?.kind === "input" ? "claude/inputRequest"
      : "claude/activity",
    kind:
      input.summary.needsUser?.kind === "approval" ? "approval"
      : input.summary.needsUser?.kind === "input" ? "input"
      : claudeEventKindFromActivityEvent(event),
    phase:
      input.summary.state === "blocked" ? "failed"
      : input.summary.state === "waiting" ? "waiting"
      : input.summary.state === "done" ? "completed"
      : "updated",
    title: input.summary.detail,
    detail: input.summary.latestMessage ?? input.summary.detail,
    path: event?.path ?? input.summary.paths[0] ?? null,
    action: event?.action,
    isImage: event?.isImage,
    command: input.summary.needsUser?.command,
    cwd: input.summary.paths[0] ?? null,
    grantRoot: input.summary.needsUser?.grantRoot
  };
}

function buildClaudeSessionEvents(input: {
  sessionId: string;
  fallbackCwd: string;
  records: Array<Record<string, unknown>>;
  fallbackUpdatedAt: number;
  hookRecords: Array<Record<string, unknown>>;
  teamIndex?: ClaudeTeamIndex;
}): DashboardEvent[] {
  const events = new Map<string, DashboardEvent>();

  for (const [index, record] of input.hookRecords.entries()) {
    const summary = summariseClaudeHookRecord({
      sessionId: input.sessionId,
      model: null,
      fallbackCwd: input.fallbackCwd,
      gitBranch: null,
      record,
      fallbackUpdatedAt: input.fallbackUpdatedAt
    });
    if (!summary) {
      continue;
    }
    const createdAt = new Date(recordTimestampMs(record, input.fallbackUpdatedAt)).toISOString();
    const threadId = claudeHookChildThreadId({
      sessionId: input.sessionId,
      record,
      teamIndex: input.teamIndex
    });
    const event = claudeEventFromSummary({
      threadId,
      createdAt,
      summary,
      confidence: "typed",
      id: `${input.sessionId}:hook:${index}:${createdAt}:${record.hook_event_name ?? "activity"}`
    });
    if (event) {
      events.set(event.id, event);
    }
  }

  for (const [index, record] of input.records.entries()) {
    const createdAtMs = recordTimestampMs(record, input.fallbackUpdatedAt);
    if (!Number.isFinite(createdAtMs) || Date.now() - createdAtMs > CLAUDE_EVENT_WINDOW_MS) {
      continue;
    }

    const assistantText = extractAssistantText(record);
    if (assistantText) {
      const createdAt = new Date(createdAtMs).toISOString();
      events.set(`${input.sessionId}:assistant:${index}:${createdAt}`, {
        id: `${input.sessionId}:assistant:${index}:${createdAt}`,
        source: "claude",
        confidence: "inferred",
        threadId: input.sessionId,
        createdAt,
        method: "claude/agentMessage",
        kind: "message",
        phase: "updated",
        title: shorten(assistantText, 88),
        detail: shorten(assistantText, 240),
        path: extractPathsFromText(assistantText)[0] ?? input.fallbackCwd,
        action: "said",
        isImage: false
      });
    }

    const tool = extractAssistantTool(record);
    if (!tool) {
      continue;
    }
    const summary = claudeToolSummary({
      sessionId: input.sessionId,
      model: null,
      fallbackCwd: input.fallbackCwd,
      gitBranch: null,
      updatedAt: new Date(createdAtMs).toISOString(),
      toolName: tool.name,
      toolInput: tool.input,
      failed: false
    });
    if (!summary) {
      continue;
    }
    const createdAt = new Date(createdAtMs).toISOString();
    const event = claudeEventFromSummary({
      threadId: input.sessionId,
      createdAt,
      summary,
      confidence: "inferred",
      id: `${input.sessionId}:tool:${index}:${createdAt}:${tool.name}`
    });
    if (event) {
      events.set(event.id, event);
    }
  }

  return [...events.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function buildClaudeSessionEventsForTest(input: {
  sessionId: string;
  fallbackCwd: string;
  records: Array<Record<string, unknown>>;
  fallbackUpdatedAt: number;
  hookRecords: Array<Record<string, unknown>>;
  teamIndex?: ClaudeTeamIndex;
}): DashboardEvent[] {
  return buildClaudeSessionEvents(input);
}

function mergeClaudeAssistantTextSummary(input: {
  base: ClaudeActivitySummary;
  latestAssistantTextRecord: Record<string, unknown> | null;
  fallbackUpdatedAt: number;
  fallbackCwd: string;
}): ClaudeActivitySummary {
  if (!input.latestAssistantTextRecord) {
    return input.base;
  }

  const baseUpdatedAtMs = Date.parse(input.base.updatedAt);
  const assistantUpdatedAtMs = recordTimestampMs(input.latestAssistantTextRecord, input.fallbackUpdatedAt);
  if (!Number.isFinite(assistantUpdatedAtMs)) {
    return input.base;
  }

  const assistantText = extractAssistantText(input.latestAssistantTextRecord);
  if (!assistantText) {
    return input.base;
  }

  const textPaths = extractPathsFromText(assistantText);
  const ageMs = Date.now() - assistantUpdatedAtMs;
  const assistantState =
    ageMs <= 2 * 60 * 1000 ? "thinking"
    : ageMs <= RECENT_DONE_WINDOW_MS ? "done"
    : "idle";
  const mergedUpdatedAtMs =
    Number.isFinite(baseUpdatedAtMs) ? Math.max(baseUpdatedAtMs, assistantUpdatedAtMs)
    : assistantUpdatedAtMs;

  if (assistantUpdatedAtMs >= baseUpdatedAtMs && input.base.needsUser === null && input.base.state !== "waiting" && input.base.state !== "blocked") {
    return {
      ...input.base,
      state: assistantState,
      detail: shorten(assistantText, 88),
      updatedAt: new Date(mergedUpdatedAtMs).toISOString(),
      paths: textPaths.length > 0 ? textPaths : input.base.paths,
      activityEvent:
        ageMs <= RECENT_MESSAGE_WINDOW_MS
          ? {
              type: "agentMessage",
              action: "said",
              path: textPaths[0] ?? input.fallbackCwd,
              title: shorten(assistantText, 88),
              isImage: false
            }
          : null,
      latestMessage: assistantText,
      isOngoing: assistantState !== "done" && assistantState !== "idle" ? input.base.isOngoing : false
    };
  }

  if (input.base.latestMessage || input.base.activityEvent) {
    return input.base;
  }

  return {
    ...input.base,
    latestMessage: assistantText,
    activityEvent:
      ageMs <= RECENT_MESSAGE_WINDOW_MS
        ? {
            type: "agentMessage",
            action: "said",
            path: textPaths[0] ?? input.fallbackCwd,
            title: shorten(assistantText, 88),
            isImage: false
          }
        : input.base.activityEvent
  };
}

function trimTrailingSlash(value: string): string {
  return value.replace(/[\\/]+$/, "");
}

function canonicalizeProjectPath(input: string | null | undefined): string | null {
  if (typeof input !== "string") {
    return null;
  }

  const raw = input.trim();
  if (!raw) {
    return null;
  }

  const windowsDriveMatch = raw.match(/^([a-zA-Z]):[\\/](.*)$/);
  if (windowsDriveMatch) {
    const drive = windowsDriveMatch[1].toLowerCase();
    const rest = windowsDriveMatch[2].replace(/\\/g, "/");
    return trimTrailingSlash(`/mnt/${drive}/${rest}`);
  }

  if (raw.startsWith("/")) {
    return trimTrailingSlash(raw.replace(/\\/g, "/"));
  }

  return trimTrailingSlash(raw.replace(/\\/g, "/"));
}

function shorten(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function isMeaningfulTranscriptText(text: string | null | undefined): text is string {
  if (typeof text !== "string") {
    return false;
  }
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return false;
  }
  return !/^[.\-_~`"'!,;:|/\\()[\]{}]+$/.test(normalized);
}

function isSyntheticClaudeUserText(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  return (
    /^<local-command-stdout>[\s\S]*<\/local-command-stdout>$/i.test(normalized)
    || /^<command-name>[\s\S]*<\/command-name>/i.test(normalized)
    || /^<command-message>[\s\S]*<\/command-message>/i.test(normalized)
    || /^<command-args>[\s\S]*<\/command-args>/i.test(normalized)
  );
}

function parseJsonLines(text: string, dropFirstPartial = false): Array<Record<string, unknown>> {
  const lines = text.split(/\r?\n/);
  const usable = dropFirstPartial ? lines.slice(1) : lines;
  const records: Array<Record<string, unknown>> = [];

  for (const line of usable) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as unknown;
      if (typeof parsed === "object" && parsed) {
        records.push(parsed as Record<string, unknown>);
      }
    } catch {
      continue;
    }
  }

  return records;
}

async function readSegment(path: string, start: number, length: number): Promise<string> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.toString("utf8", 0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function readLogSample(path: string): Promise<{
  mtimeMs: number;
  headRecords: Array<Record<string, unknown>>;
  tailRecords: Array<Record<string, unknown>>;
}> {
  const handle = await open(path, "r");
  try {
    const stats = await handle.stat();
    const headLength = Math.min(Number(stats.size), LOG_HEAD_BYTES);
    const tailLength = Math.min(Number(stats.size), LOG_TAIL_BYTES);
    const tailStart = Math.max(0, Number(stats.size) - tailLength);
    const [head, tail] = await Promise.all([
      readSegment(path, 0, headLength),
      readSegment(path, tailStart, tailLength)
    ]);
    return {
      mtimeMs: stats.mtimeMs,
      headRecords: parseJsonLines(head),
      tailRecords: parseJsonLines(tail, tailStart > 0)
    };
  } finally {
    await handle.close();
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value ? (value as Record<string, unknown>) : null;
}

function parseTimestampMs(value: unknown): number {
  if (typeof value !== "string") {
    return Number.NaN;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function messageObject(record: Record<string, unknown>): Record<string, unknown> | null {
  return asRecord(record.message);
}

function recordTimestampMs(record: Record<string, unknown>, fallback: number): number {
  const parsed = parseTimestampMs(record.timestamp);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function extractTextEntries(content: unknown): string[] {
  if (typeof content === "string") {
    return [content];
  }
  if (!Array.isArray(content)) {
    return [];
  }

  return content.flatMap((entry) => {
    const record = asRecord(entry);
    if (!record) {
      return [];
    }

    if (record.type === "text" && typeof record.text === "string") {
      return [record.text];
    }

    if (record.type === "tool_result" && typeof record.content === "string") {
      return [record.content];
    }

    return [];
  });
}

function extractUserText(record: Record<string, unknown>): string | null {
  if (record.type !== "user") {
    return null;
  }

  const message = messageObject(record);
  if (!message) {
    return null;
  }

  if (typeof message.content === "string") {
    return isMeaningfulTranscriptText(message.content) && !isSyntheticClaudeUserText(message.content) ? message.content : null;
  }

  const text = extractTextEntries(message.content).find(
    (entry) => isMeaningfulTranscriptText(entry) && !isSyntheticClaudeUserText(entry)
  );
  return text ?? null;
}

function extractAssistantText(record: Record<string, unknown>): string | null {
  if (record.type !== "assistant") {
    return null;
  }

  const message = messageObject(record);
  if (!message) {
    return null;
  }

  const text = extractTextEntries(message.content).find((entry) => isMeaningfulTranscriptText(entry));
  return text ?? null;
}

function extractAssistantTool(record: Record<string, unknown>): { name: string; input: Record<string, unknown> } | null {
  if (record.type !== "assistant") {
    return null;
  }

  const message = messageObject(record);
  if (!message || !Array.isArray(message.content)) {
    return null;
  }

  for (const entry of [...message.content].reverse()) {
    const item = asRecord(entry);
    if (!item || item.type !== "tool_use" || typeof item.name !== "string") {
      continue;
    }
    return {
      name: item.name,
      input: asRecord(item.input) ?? {}
    };
  }

  return null;
}

function extractPathsFromText(text: string): string[] {
  const matches = text.match(/(?:[A-Za-z]:[\\/][^\s`'"]+|\/[^\s`'"]+)/g) ?? [];
  return Array.from(new Set(matches.map((entry) => canonicalizeProjectPath(entry) ?? entry)));
}

function extractToolPaths(input: Record<string, unknown>): string[] {
  const values: string[] = [];
  const directKeys = ["file_path", "path", "cwd"];

  for (const key of directKeys) {
    const value = input[key];
    if (typeof value === "string") {
      values.push(value);
    }
  }

  for (const key of ["paths", "files"]) {
    const value = input[key];
    if (!Array.isArray(value)) {
      continue;
    }
    for (const entry of value) {
      if (typeof entry === "string") {
        values.push(entry);
        continue;
      }
      const record = asRecord(entry);
      if (!record) {
        continue;
      }
      for (const nestedKey of ["file_path", "path"]) {
        if (typeof record[nestedKey] === "string") {
          values.push(record[nestedKey] as string);
        }
      }
    }
  }

  return Array.from(
    new Set(
      values
        .map((value) => canonicalizeProjectPath(value) ?? value)
        .filter((value) => typeof value === "string" && value.length > 0)
    )
  );
}

function looksLikeValidationCommand(command: string): boolean {
  return /\b(test|tests|lint|build|check|verify|pytest|cargo test|go test|npm test|pnpm test|vitest|jest)\b/i.test(
    command
  );
}

function isImagePath(path: string | null): boolean {
  return Boolean(path && /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(path));
}

function stringValue(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }
  return null;
}

function numberValue(record: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
      continue;
    }
    return candidate < 10_000_000_000 ? candidate * 1000 : candidate;
  }
  return null;
}

function booleanValue(record: Record<string, unknown>, key: string, fallback: boolean): boolean {
  return typeof record[key] === "boolean" ? record[key] : fallback;
}

function normalizeClaudeTeamMember(value: unknown): ClaudeTeamMember | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const agentId = stringValue(record, "agentId", "agent_id");
  const name = stringValue(record, "name");
  const cwd = canonicalizeProjectPath(stringValue(record, "cwd"));
  if (!agentId || !name || !cwd) {
    return null;
  }

  return {
    agentId,
    name,
    agentType: stringValue(record, "agentType", "agent_type"),
    model: stringValue(record, "model"),
    prompt: stringValue(record, "prompt"),
    color: stringValue(record, "color"),
    joinedAt: numberValue(record, "joinedAt", "joined_at"),
    tmuxPaneId: stringValue(record, "tmuxPaneId", "tmux_pane_id"),
    cwd,
    worktreePath: canonicalizeProjectPath(stringValue(record, "worktreePath", "worktree_path")),
    sessionId: stringValue(record, "sessionId", "session_id"),
    subscriptions: stringArray(record.subscriptions),
    backendType: stringValue(record, "backendType", "backend_type"),
    isActive: booleanValue(record, "isActive", true),
    mode: stringValue(record, "mode")
  };
}

async function findClaudeCoworkFiles(input: {
  fileNamePattern: RegExp;
  limit?: number;
}): Promise<string[]> {
  const limit = input.limit ?? CLAUDE_COWORK_SCAN_FILE_LIMIT;
  const results: string[] = [];
  const roots = claudeCoworkLocalAgentDirs();

  for (const root of roots) {
    const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
    while (queue.length > 0 && results.length < limit) {
      const current = queue.shift();
      if (!current) {
        break;
      }

      const entries = await readdir(current.dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const path = join(current.dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "skills-plugin") {
            continue;
          }
          if (current.depth < 4) {
            queue.push({ dir: path, depth: current.depth + 1 });
          }
          continue;
        }
        if (!entry.isFile() || !input.fileNamePattern.test(entry.name)) {
          continue;
        }
        results.push(path);
        if (results.length >= limit) {
          break;
        }
      }
    }
  }

  return Array.from(new Set(results));
}

function normalizeClaudeCoworkFolderPaths(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  const paths = values.flatMap((entry) => {
    if (typeof entry === "string") {
      return [entry];
    }
    const record = asRecord(entry);
    if (!record) {
      return [];
    }
    return [
      stringValue(record, "path", "root", "rootPath", "hostPath"),
      stringValue(record, "folder", "folderPath")
    ];
  });
  return uniqueCanonicalPaths(paths);
}

function normalizeClaudeCoworkSpaces(value: unknown, fallbackUpdatedAt: number): ClaudeCoworkSpace[] {
  const record = asRecord(value);
  const rawSpaces = Array.isArray(record?.spaces) ? record.spaces : [];
  const spaces: ClaudeCoworkSpace[] = [];

  for (const rawSpace of rawSpaces) {
    const space = asRecord(rawSpace);
    if (!space) {
      continue;
    }
    const roots = uniqueCanonicalPaths([
      ...normalizeClaudeCoworkFolderPaths(space.folders),
      ...normalizeClaudeCoworkFolderPaths(space.projects)
    ]);
    if (roots.length === 0) {
      continue;
    }

    const name = stringValue(space, "name") ?? "Claude Cowork";
    const updatedAt = Math.max(
      fallbackUpdatedAt,
      numberValue(space, "updatedAt", "updated_at") ?? 0,
      numberValue(space, "createdAt", "created_at") ?? 0
    );
    for (const root of roots) {
      spaces.push({
        id: stringValue(space, "id"),
        name,
        root,
        instructions: stringValue(space, "instructions"),
        updatedAt
      });
    }
  }

  return spaces;
}

async function readClaudeCoworkSpaces(limit = 50): Promise<ClaudeCoworkSpace[]> {
  const files = await findClaudeCoworkFiles({
    fileNamePattern: /^spaces\.json$/i,
    limit: Math.max(limit * 4, 20)
  });
  const spaces = await Promise.all(
    files.map(async (file) => {
      try {
        const [content, fileStats] = await Promise.all([
          readFile(file, "utf8"),
          stat(file)
        ]);
        return normalizeClaudeCoworkSpaces(JSON.parse(content) as unknown, fileStats.mtimeMs);
      } catch {
        return [];
      }
    })
  );
  const now = Date.now();
  return spaces
    .flat()
    .filter((space) => now - space.updatedAt <= RECENT_CLAUDE_COWORK_DISCOVERY_WINDOW_MS)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, limit);
}

function normalizeClaudeCoworkSession(value: unknown, fallbackUpdatedAt: number): ClaudeCoworkSession | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const sessionId = stringValue(record, "sessionId", "session_id");
  if (!sessionId) {
    return null;
  }

  const selectedRoots = normalizeClaudeCoworkFolderPaths(record.userSelectedFolders);
  const detectedFiles = Array.isArray(record.fsDetectedFiles)
    ? record.fsDetectedFiles
    : record.fsDetectedFiles ? [record.fsDetectedFiles] : [];
  const filePaths = uniqueCanonicalPaths(detectedFiles.flatMap((entry) => {
    const file = asRecord(entry);
    return file ? [stringValue(file, "hostPath", "path", "filePath")] : [];
  }));
  const fileRoots = uniqueCanonicalPaths(filePaths.map((path) => path ? dirname(path) : null));
  const roots = uniqueCanonicalPaths([
    ...selectedRoots,
    ...fileRoots
  ]);
  if (roots.length === 0) {
    return null;
  }

  const createdAt = numberValue(record, "createdAt", "created_at") ?? fallbackUpdatedAt;
  const updatedAt = Math.max(
    fallbackUpdatedAt,
    numberValue(record, "lastActivityAt", "last_activity_at") ?? 0,
    numberValue(record, "updatedAt", "updated_at") ?? 0,
    createdAt
  );

  return {
    sessionId,
    cliSessionId: stringValue(record, "cliSessionId", "cli_session_id"),
    processName: stringValue(record, "processName", "process_name"),
    vmProcessName: stringValue(record, "vmProcessName", "vm_process_name"),
    title: stringValue(record, "title"),
    initialMessage: stringValue(record, "initialMessage", "initial_message"),
    model: stringValue(record, "model"),
    spaceId: stringValue(record, "spaceId", "space_id"),
    roots,
    filePaths,
    createdAt,
    updatedAt,
    isArchived: booleanValue(record, "isArchived", false)
  };
}

async function readClaudeCoworkSessions(limit = 50): Promise<ClaudeCoworkSession[]> {
  const files = await findClaudeCoworkFiles({
    fileNamePattern: /^local_[^.]+\.json$/i,
    limit: Math.max(limit * 4, 20)
  });
  const sessions = await Promise.all(
    files.map(async (file) => {
      try {
        const [content, fileStats] = await Promise.all([
          readFile(file, "utf8"),
          stat(file)
        ]);
        return normalizeClaudeCoworkSession(JSON.parse(content) as unknown, fileStats.mtimeMs);
      } catch {
        return null;
      }
    })
  );
  const now = Date.now();
  return sessions
    .filter((session): session is ClaudeCoworkSession => Boolean(session))
    .filter((session) => now - session.updatedAt <= RECENT_CLAUDE_COWORK_DISCOVERY_WINDOW_MS)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, limit);
}

function normalizeClaudeTeamSnapshot(value: unknown, fallbackName: string, updatedAt: number): ClaudeTeamSnapshot | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const name = stringValue(record, "name") ?? fallbackName;
  const members = (Array.isArray(record.members) ? record.members : [])
    .map(normalizeClaudeTeamMember)
    .filter((member): member is ClaudeTeamMember => Boolean(member));
  if (members.length === 0) {
    return null;
  }

  const memberUpdatedAt = Math.max(0, ...members.map((member) => member.joinedAt ?? 0));
  return {
    name,
    description: stringValue(record, "description"),
    leadAgentId: stringValue(record, "leadAgentId", "lead_agent_id"),
    leadSessionId: stringValue(record, "leadSessionId", "lead_session_id"),
    updatedAt: Math.max(updatedAt, numberValue(record, "createdAt", "created_at") ?? 0, memberUpdatedAt),
    members
  };
}

function isVisibleClaudeTeam(team: ClaudeTeamSnapshot, now = Date.now()): boolean {
  const ageMs = now - team.updatedAt;
  if (ageMs <= RECENT_CLAUDE_TEAM_DISCOVERY_WINDOW_MS) {
    return true;
  }
  return ageMs <= ACTIVE_CLAUDE_TEAM_DISCOVERY_WINDOW_MS
    && team.members.some((member) => member.name !== "team-lead" && member.isActive);
}

async function readClaudeTeamSnapshotsFromDir(teamsDir: string, limit = 50): Promise<ClaudeTeamSnapshot[]> {
  const entries = await readdir(teamsDir, { withFileTypes: true }).catch(() => []);
  const teams = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const configPath = join(teamsDir, entry.name, "config.json");
        try {
          const [content, fileStats] = await Promise.all([
            readFile(configPath, "utf8"),
            stat(configPath)
          ]);
          return normalizeClaudeTeamSnapshot(JSON.parse(content) as unknown, entry.name, fileStats.mtimeMs);
        } catch {
          return null;
        }
      })
  );

  return teams
    .filter((team): team is ClaudeTeamSnapshot => Boolean(team))
    .filter((team) => isVisibleClaudeTeam(team))
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, limit);
}

async function readClaudeTeamSnapshots(limit = 50): Promise<ClaudeTeamSnapshot[]> {
  return readClaudeTeamSnapshotsFromDir(CLAUDE_TEAMS_DIR, limit);
}

function inferClaudeTeamLeadSessionIds(teams: ClaudeTeamSnapshot[], sessions: ClaudeLoadedSession[]): Map<string, string> {
  const inferred = new Map<string, { sessionId: string; updatedAt: number }>();
  for (const team of teams) {
    if (team.leadSessionId) {
      inferred.set(team.name, { sessionId: team.leadSessionId, updatedAt: team.updatedAt });
      continue;
    }

    for (const session of sessions) {
      for (const record of session.hookRecords) {
        if (stringValue(record, "team_name", "teamName") !== team.name) {
          continue;
        }
        const updatedAt = recordTimestampMs(record, session.updatedAt);
        const existing = inferred.get(team.name);
        if (!existing || updatedAt > existing.updatedAt) {
          inferred.set(team.name, { sessionId: session.sessionId, updatedAt });
        }
      }
    }
  }
  return new Map([...inferred.entries()].map(([teamName, value]) => [teamName, value.sessionId]));
}

function buildClaudeTeamIndex(teams: ClaudeTeamSnapshot[], inferredLeadSessionIds = new Map<string, string>()): ClaudeTeamIndex {
  const bySessionId = new Map<string, ClaudeTeamMemberContext>();
  const byLeadAndAgentId = new Map<string, ClaudeTeamMemberContext>();
  const contexts: ClaudeTeamMemberContext[] = [];

  for (const team of teams) {
    const leadSessionId = team.leadSessionId ?? inferredLeadSessionIds.get(team.name) ?? null;
    for (const member of team.members) {
      if (member.name === "team-lead") {
        continue;
      }
      const context: ClaudeTeamMemberContext = { team, member, leadSessionId };
      contexts.push(context);
      if (member.sessionId) {
        bySessionId.set(member.sessionId, context);
      }
      if (leadSessionId) {
        byLeadAndAgentId.set(claudeTeamMemberContextKey(leadSessionId, member.agentId), context);
      }
    }
  }

  return { bySessionId, byLeadAndAgentId, contexts };
}

function claudeProjectsFromTeams(teams: ClaudeTeamSnapshot[], limit = 50): ClaudeSdkProject[] {
  const grouped = new Map<string, ClaudeSdkProject>();
  for (const team of teams) {
    for (const member of team.members) {
      if (member.name === "team-lead") {
        continue;
      }
      const root = claudeTeamMemberPrimaryCwd(member);
      if (!root) {
        continue;
      }
      const updatedAt = Math.max(team.updatedAt, member.joinedAt ?? 0);
      const existing = grouped.get(root);
      if (existing) {
        existing.count += 1;
        existing.updatedAt = Math.max(existing.updatedAt, updatedAt);
      } else {
        grouped.set(root, { root, updatedAt, count: 1 });
      }
    }
  }

  return [...grouped.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, limit);
}

function claudeProjectsFromCowork(input: {
  spaces: ClaudeCoworkSpace[];
  sessions: ClaudeCoworkSession[];
  limit?: number;
}): ClaudeSdkProject[] {
  const grouped = new Map<string, ClaudeSdkProject>();
  const addRoot = (root: string, updatedAt: number) => {
    const existing = [...grouped.values()].find((candidate) => sameProjectPath(candidate.root, root));
    if (existing) {
      existing.count += 1;
      existing.updatedAt = Math.max(existing.updatedAt, updatedAt);
      return;
    }
    grouped.set(root, { root, updatedAt, count: 1 });
  };

  for (const space of input.spaces) {
    addRoot(space.root, space.updatedAt);
  }
  for (const session of input.sessions) {
    for (const root of session.roots) {
      addRoot(root, session.updatedAt);
    }
  }

  return [...grouped.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, input.limit ?? 50);
}

function claudeToolSummary(input: {
  sessionId: string;
  model: string | null;
  fallbackCwd: string;
  gitBranch: string | null;
  updatedAt: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  failed?: boolean;
}): ClaudeActivitySummary | null {
  const toolName = input.toolName.trim();
  const toolPaths = extractToolPaths(input.toolInput);
  const primaryPath = toolPaths[0] ?? input.fallbackCwd;

  if (/(edit|write|multiedit)/i.test(toolName)) {
    return {
      label: labelFromModel(input.model, input.sessionId),
      sourceKind: sourceKindFromModel(input.model),
      state: input.failed ? "blocked" : "editing",
      detail: primaryPath ? `Editing ${primaryPath}` : "Editing files",
      updatedAt: input.updatedAt,
      paths: toolPaths.length > 0 ? toolPaths : [input.fallbackCwd],
      activityEvent: {
        type: "fileChange",
        action: "edited",
        path: primaryPath ?? null,
        title: primaryPath ? `edit ${primaryPath}` : "Editing files",
        isImage: isImagePath(primaryPath ?? null)
      },
      gitBranch: input.gitBranch,
      confidence: "typed",
      needsUser: null,
      latestMessage: null,
      isOngoing: !input.failed
    };
  }

  if (/(bash|shell)/i.test(toolName)) {
    const command =
      typeof input.toolInput.command === "string" ? input.toolInput.command
      : typeof input.toolInput.cmd === "string" ? input.toolInput.cmd
      : toolName;
    const cwd =
      canonicalizeProjectPath(typeof input.toolInput.cwd === "string" ? input.toolInput.cwd : null)
      ?? input.fallbackCwd;
    return {
      label: labelFromModel(input.model, input.sessionId),
      sourceKind: sourceKindFromModel(input.model),
      state: input.failed ? "blocked" : looksLikeValidationCommand(command) ? "validating" : "running",
      detail: command,
      updatedAt: input.updatedAt,
      paths: cwd ? [cwd] : [],
      activityEvent: {
        type: "commandExecution",
        action: "ran",
        path: cwd ?? null,
        title: command,
        isImage: false
      },
      gitBranch: input.gitBranch,
      confidence: "typed",
      needsUser: null,
      latestMessage: null,
      isOngoing: !input.failed
    };
  }

  if (/(read|grep|glob|search|ls|list)/i.test(toolName)) {
    return {
      label: labelFromModel(input.model, input.sessionId),
      sourceKind: sourceKindFromModel(input.model),
      state: input.failed ? "blocked" : "scanning",
      detail: primaryPath ? `Reading ${primaryPath}` : `Using ${toolName}`,
      updatedAt: input.updatedAt,
      paths: toolPaths.length > 0 ? toolPaths : [input.fallbackCwd],
      activityEvent: null,
      gitBranch: input.gitBranch,
      confidence: "typed",
      needsUser: null,
      latestMessage: null,
      isOngoing: !input.failed
    };
  }

  if (/(task|delegate|agent)/i.test(toolName)) {
    const description = stringValue(input.toolInput, "description", "name", "team_name");
    const subagentType = stringValue(input.toolInput, "subagent_type");
    const detail =
      input.failed ? "Delegation failed"
      : description ? `Delegating ${description}`
      : subagentType ? `Delegating to ${subagentType}`
      : "Delegating work";
    return {
      label: labelFromModel(input.model, input.sessionId),
      sourceKind: sourceKindFromModel(input.model),
      state: input.failed ? "blocked" : "delegating",
      detail: shorten(detail, 88),
      updatedAt: input.updatedAt,
      paths: [input.fallbackCwd],
      activityEvent: claudeCollabActivityEvent({
        detail,
        path: input.fallbackCwd
      }),
      gitBranch: input.gitBranch,
      confidence: "typed",
      needsUser: null,
      latestMessage: null,
      isOngoing: !input.failed
    };
  }

  return null;
}

export function summariseClaudeHookRecord(input: {
  sessionId: string;
  model: string | null;
  fallbackCwd: string;
  gitBranch: string | null;
  record: Record<string, unknown>;
  fallbackUpdatedAt: number;
}): ClaudeActivitySummary | null {
  const hookEventName = typeof input.record.hook_event_name === "string" ? input.record.hook_event_name : null;
  if (!hookEventName) {
    return null;
  }

  const cwd =
    canonicalizeProjectPath(typeof input.record.cwd === "string" ? input.record.cwd : null)
    ?? input.fallbackCwd;
  const updatedAt = new Date(recordTimestampMs(input.record, input.fallbackUpdatedAt)).toISOString();
  const toolName = typeof input.record.tool_name === "string" ? input.record.tool_name : "";
  const toolInput = asRecord(input.record.tool_input) ?? {};
  const requestId =
    stringValue(input.record, "request_id", "requestId")
    ?? `${input.sessionId}:${hookEventName}:${updatedAt}`;
  const browserActionable = input.record.hook_source === "claude-agent-sdk";

  if (hookEventName === "PermissionRequest") {
    const detail =
      typeof toolInput.command === "string" ? toolInput.command
      : extractToolPaths(toolInput)[0]
      ?? toolName
      ?? "Permission requested";
    return {
      label: labelFromModel(input.model, input.sessionId),
      sourceKind: sourceKindFromModel(input.model),
      state: "blocked",
      detail: shorten(detail, 88),
      updatedAt,
      paths: extractToolPaths(toolInput).length > 0 ? extractToolPaths(toolInput) : [cwd],
      activityEvent: null,
      gitBranch: input.gitBranch,
      confidence: "typed",
      needsUser: {
        kind: "approval",
        requestId,
        reason: stringValue(input.record, "reason", "message") ?? shorten(detail, 88),
        command: stringValue(toolInput, "command", "cmd") ?? undefined,
        cwd,
        grantRoot: extractToolPaths(toolInput)[0] ?? undefined,
        ...(browserActionable ? { availableDecisions: ["accept", "decline"] } : {})
      },
      latestMessage: null,
      isOngoing: true
    };
  }

  if (hookEventName === "Elicitation") {
    const detail =
      typeof input.record.prompt === "string" ? input.record.prompt
      : typeof input.record.message === "string" ? input.record.message
      : "Waiting on input";
    return {
      label: labelFromModel(input.model, input.sessionId),
      sourceKind: sourceKindFromModel(input.model),
      state: "waiting",
      detail: shorten(detail, 88),
      updatedAt,
      paths: [cwd],
      activityEvent: null,
      gitBranch: input.gitBranch,
      confidence: "typed",
      needsUser: {
        kind: "input",
        requestId,
        reason: shorten(detail, 88),
        cwd,
        ...(browserActionable
          ? (() => {
            const questions = parseClaudeElicitationQuestions(input.record);
            return questions ? { questions } : {};
          })()
          : {})
      },
      latestMessage: null,
      isOngoing: true
    };
  }

  if (hookEventName === "AgentsOfficePermissionDecision") {
    const action = stringValue(input.record, "action") ?? "accept";
    return {
      label: labelFromModel(input.model, input.sessionId),
      sourceKind: sourceKindFromModel(input.model),
      state: "planning",
      detail: action === "decline" ? "Permission denied" : "Permission approved",
      updatedAt,
      paths: [cwd],
      activityEvent: null,
      gitBranch: input.gitBranch,
      confidence: "typed",
      needsUser: null,
      latestMessage: null,
      isOngoing: true
    };
  }

  if (hookEventName === "AgentsOfficeElicitationResponse") {
    const action = stringValue(input.record, "action") ?? "accept";
    return {
      label: labelFromModel(input.model, input.sessionId),
      sourceKind: sourceKindFromModel(input.model),
      state: "planning",
      detail:
        action === "decline" ? "Input request declined"
        : action === "cancel" ? "Input request cancelled"
        : "Input submitted",
      updatedAt,
      paths: [cwd],
      activityEvent: null,
      gitBranch: input.gitBranch,
      confidence: "typed",
      needsUser: null,
      latestMessage: null,
      isOngoing: true
    };
  }

  if (hookEventName === "UserPromptSubmit" || hookEventName === "UserPromptExpansion") {
    const detail = stringValue(input.record, "prompt", "message", "text") ?? "Updated plan";
    const paths = extractPathsFromText(detail);
    return {
      label: labelFromModel(input.model, input.sessionId),
      sourceKind: sourceKindFromModel(input.model),
      state: "planning",
      detail: shorten(detail, 88),
      updatedAt,
      paths: paths.length > 0 ? paths : [cwd],
      activityEvent: {
        type: "userMessage",
        action: "said",
        path: paths[0] ?? cwd,
        title: shorten(detail, 88),
        isImage: false
      },
      gitBranch: input.gitBranch,
      confidence: "typed",
      needsUser: null,
      latestMessage: null,
      isOngoing: true
    };
  }

  if (hookEventName === "SessionStart") {
    return {
      label: labelFromModel(input.model, input.sessionId),
      sourceKind: sourceKindFromModel(input.model),
      state: "planning",
      detail: "Session started",
      updatedAt,
      paths: [cwd],
      activityEvent: null,
      gitBranch: input.gitBranch,
      confidence: "typed",
      needsUser: null,
      latestMessage: null,
      isOngoing: true
    };
  }

  if (hookEventName === "SessionEnd") {
    return {
      label: labelFromModel(input.model, input.sessionId),
      sourceKind: sourceKindFromModel(input.model),
      state: "done",
      detail: "Session ended",
      updatedAt,
      paths: [cwd],
      activityEvent: null,
      gitBranch: input.gitBranch,
      confidence: "typed",
      needsUser: null,
      latestMessage: null,
      isOngoing: false
    };
  }

  if (hookEventName === "PreCompact") {
    return {
      label: labelFromModel(input.model, input.sessionId),
      sourceKind: sourceKindFromModel(input.model),
      state: "thinking",
      detail: "Compacting context",
      updatedAt,
      paths: [cwd],
      activityEvent: null,
      gitBranch: input.gitBranch,
      confidence: "typed",
      needsUser: null,
      latestMessage: null,
      isOngoing: true
    };
  }

  if (hookEventName === "PostCompact") {
    return {
      label: labelFromModel(input.model, input.sessionId),
      sourceKind: sourceKindFromModel(input.model),
      state: "thinking",
      detail: "Context compacted",
      updatedAt,
      paths: [cwd],
      activityEvent: null,
      gitBranch: input.gitBranch,
      confidence: "typed",
      needsUser: null,
      latestMessage: null,
      isOngoing: true
    };
  }

  if (hookEventName === "Setup") {
    const detail =
      input.record.trigger === "maintenance" ? "Running Claude maintenance"
      : "Initializing Claude session";
    return {
      label: labelFromModel(input.model, input.sessionId),
      sourceKind: sourceKindFromModel(input.model),
      state: "planning",
      detail,
      updatedAt,
      paths: [cwd],
      activityEvent: null,
      gitBranch: input.gitBranch,
      confidence: "typed",
      needsUser: null,
      latestMessage: null,
      isOngoing: true
    };
  }

  if (hookEventName === "SubagentStart") {
    const detail =
      typeof input.record.agent_type === "string" ? `Spawning ${input.record.agent_type} subagent`
      : "Spawning subagent";
    return {
      label: labelFromModel(input.model, input.sessionId),
      sourceKind: sourceKindFromModel(input.model),
      state: "delegating",
      detail,
      updatedAt,
      paths: [cwd],
      activityEvent: claudeCollabActivityEvent({
        detail,
        path: cwd
      }),
      gitBranch: input.gitBranch,
      confidence: "typed",
      needsUser: null,
      latestMessage: null,
      isOngoing: true
    };
  }

  if (hookEventName === "SubagentStop") {
    const detail =
      typeof input.record.agent_type === "string" ? `${input.record.agent_type} subagent finished`
      : "Subagent finished";
    const lastAssistantMessage = stringValue(input.record, "last_assistant_message", "message");
    return {
      label: labelFromModel(input.model, input.sessionId),
      sourceKind: sourceKindFromModel(input.model),
      state: "done",
      detail,
      updatedAt,
      paths: [cwd],
      activityEvent: claudeCollabActivityEvent({
        detail,
        path: cwd
      }),
      gitBranch: input.gitBranch,
      confidence: "typed",
      needsUser: null,
      latestMessage: lastAssistantMessage,
      isOngoing: false
    };
  }

  if (hookEventName === "StopFailure") {
    const detail =
      typeof input.record.error === "string" ? input.record.error
      : typeof input.record.reason === "string" ? input.record.reason
      : "Claude turn failed";
    return {
      label: labelFromModel(input.model, input.sessionId),
      sourceKind: sourceKindFromModel(input.model),
      state: "blocked",
      detail: shorten(detail, 88),
      updatedAt,
      paths: [cwd],
      activityEvent: null,
      gitBranch: input.gitBranch,
      confidence: "typed",
      needsUser: null,
      latestMessage: null,
      isOngoing: false
    };
  }

  if (hookEventName === "Stop" || hookEventName === "TaskCompleted") {
    const detail =
      hookEventName === "TaskCompleted"
        ? stringValue(input.record, "task_subject", "task_description", "message") ?? "Task completed"
        : stringValue(input.record, "last_assistant_message") ?? "Finished recently";
    return {
      label: labelFromModel(input.model, input.sessionId),
      sourceKind: sourceKindFromModel(input.model),
      state: "done",
      detail: shorten(detail, 88),
      updatedAt,
      paths: [cwd],
      activityEvent: null,
      gitBranch: input.gitBranch,
      confidence: "typed",
      needsUser: null,
      latestMessage: hookEventName === "Stop" ? stringValue(input.record, "last_assistant_message") : null,
      isOngoing: false
    };
  }

  if (hookEventName === "Notification") {
    const title = stringValue(input.record, "title");
    const message = stringValue(input.record, "message") ?? title ?? "Claude notification";
    const notificationType = stringValue(input.record, "notification_type");
    const state =
      notificationType && /(error|fail|denied|blocked)/i.test(notificationType) ? "blocked"
      : notificationType && /(wait|input|approval)/i.test(notificationType) ? "waiting"
      : "thinking";
    return {
      label: labelFromModel(input.model, input.sessionId),
      sourceKind: sourceKindFromModel(input.model),
      state,
      detail: shorten(message, 88),
      updatedAt,
      paths: [cwd],
      activityEvent: {
        type: "agentMessage",
        action: "said",
        path: cwd,
        title: shorten(title ? `${title}: ${message}` : message, 88),
        isImage: false
      },
      gitBranch: input.gitBranch,
      confidence: "typed",
      needsUser: null,
      latestMessage: message,
      isOngoing: state !== "blocked"
    };
  }

  if (hookEventName === "TeammateIdle") {
    const teammate = stringValue(input.record, "teammate_name") ?? "Teammate";
    const teamName = stringValue(input.record, "team_name");
    const detail = teamName ? `${teammate} is idle in ${teamName}` : `${teammate} is idle`;
    return {
      label: labelFromModel(input.model, input.sessionId),
      sourceKind: sourceKindFromModel(input.model),
      state: "waiting",
      detail,
      updatedAt,
      paths: [cwd],
      activityEvent: null,
      gitBranch: input.gitBranch,
      confidence: "typed",
      needsUser: null,
      latestMessage: null,
      isOngoing: true
    };
  }

  if (hookEventName === "TaskCreated") {
    const detail = stringValue(input.record, "task_subject", "task_description", "message") ?? "Task created";
    return {
      label: labelFromModel(input.model, input.sessionId),
      sourceKind: sourceKindFromModel(input.model),
      state: "delegating",
      detail: shorten(detail, 88),
      updatedAt,
      paths: [cwd],
      activityEvent: claudeCollabActivityEvent({
        detail,
        path: cwd
      }),
      gitBranch: input.gitBranch,
      confidence: "typed",
      needsUser: null,
      latestMessage: null,
      isOngoing: true
    };
  }

  if (hookEventName === "PermissionDenied") {
    const detail = stringValue(input.record, "reason", "message") ?? "Permission denied";
    return {
      label: labelFromModel(input.model, input.sessionId),
      sourceKind: sourceKindFromModel(input.model),
      state: "blocked",
      detail: shorten(detail, 88),
      updatedAt,
      paths: [cwd],
      activityEvent: null,
      gitBranch: input.gitBranch,
      confidence: "typed",
      needsUser: null,
      latestMessage: null,
      isOngoing: false
    };
  }

  if (hookEventName === "ElicitationResult") {
    const action = stringValue(input.record, "action") ?? "accept";
    return {
      label: labelFromModel(input.model, input.sessionId),
      sourceKind: sourceKindFromModel(input.model),
      state: "planning",
      detail:
        action === "decline" ? "Input request declined"
        : action === "cancel" ? "Input request cancelled"
        : "Input submitted",
      updatedAt,
      paths: [cwd],
      activityEvent: null,
      gitBranch: input.gitBranch,
      confidence: "typed",
      needsUser: null,
      latestMessage: null,
      isOngoing: true
    };
  }

  if (hookEventName === "ConfigChange") {
    const source = stringValue(input.record, "source") ?? "settings";
    const changedPath = stringValue(input.record, "file_path");
    return {
      label: labelFromModel(input.model, input.sessionId),
      sourceKind: sourceKindFromModel(input.model),
      state: "planning",
      detail: changedPath ? `Updated ${source} via ${changedPath}` : `Updated ${source}`,
      updatedAt,
      paths: changedPath ? [canonicalizeProjectPath(changedPath) ?? changedPath, cwd] : [cwd],
      activityEvent: null,
      gitBranch: input.gitBranch,
      confidence: "typed",
      needsUser: null,
      latestMessage: null,
      isOngoing: true
    };
  }

  if (hookEventName === "InstructionsLoaded") {
    const memoryType = stringValue(input.record, "memory_type") ?? "Project";
    const filePath = stringValue(input.record, "file_path");
    return {
      label: labelFromModel(input.model, input.sessionId),
      sourceKind: sourceKindFromModel(input.model),
      state: "planning",
      detail: filePath ? `Loaded ${memoryType} instructions from ${filePath}` : `Loaded ${memoryType} instructions`,
      updatedAt,
      paths: filePath ? [canonicalizeProjectPath(filePath) ?? filePath, cwd] : [cwd],
      activityEvent: null,
      gitBranch: input.gitBranch,
      confidence: "typed",
      needsUser: null,
      latestMessage: null,
      isOngoing: true
    };
  }

  if (hookEventName === "CwdChanged") {
    const nextCwd =
      canonicalizeProjectPath(stringValue(input.record, "new_cwd"))
      ?? cwd;
    return {
      label: labelFromModel(input.model, input.sessionId),
      sourceKind: sourceKindFromModel(input.model),
      state: "planning",
      detail: `Moved to ${nextCwd}`,
      updatedAt,
      paths: [nextCwd],
      activityEvent: null,
      gitBranch: input.gitBranch,
      confidence: "typed",
      needsUser: null,
      latestMessage: null,
      isOngoing: true
    };
  }

  if (hookEventName === "FileChanged") {
    const filePath = stringValue(input.record, "file_path");
    const normalizedPath = canonicalizeProjectPath(filePath) ?? filePath ?? cwd;
    const fileEvent = stringValue(input.record, "event") ?? "change";
    const action =
      fileEvent === "add" ? "created"
      : fileEvent === "unlink" ? "deleted"
      : "edited";
    return {
      label: labelFromModel(input.model, input.sessionId),
      sourceKind: sourceKindFromModel(input.model),
      state: "editing",
      detail: normalizedPath ? `${action[0].toUpperCase()}${action.slice(1)} ${normalizedPath}` : "Changed files",
      updatedAt,
      paths: normalizedPath ? [normalizedPath, cwd] : [cwd],
      activityEvent: {
        type: "fileChange",
        action,
        path: normalizedPath ?? null,
        title: normalizedPath ? `${action} ${normalizedPath}` : "Changed files",
        isImage: isImagePath(normalizedPath ?? null)
      },
      gitBranch: input.gitBranch,
      confidence: "typed",
      needsUser: null,
      latestMessage: null,
      isOngoing: true
    };
  }

  if (hookEventName === "WorktreeCreate" || hookEventName === "WorktreeRemove") {
    const worktreePath =
      canonicalizeProjectPath(stringValue(input.record, "worktree_path"))
      ?? canonicalizeProjectPath(stringValue(input.record, "name"))
      ?? cwd;
    return {
      label: labelFromModel(input.model, input.sessionId),
      sourceKind: sourceKindFromModel(input.model),
      state: "planning",
      detail:
        hookEventName === "WorktreeCreate" ? `Created worktree ${worktreePath}`
        : `Removed worktree ${worktreePath}`,
      updatedAt,
      paths: [worktreePath],
      activityEvent: null,
      gitBranch: input.gitBranch,
      confidence: "typed",
      needsUser: null,
      latestMessage: null,
      isOngoing: hookEventName === "WorktreeCreate"
    };
  }

  if (hookEventName === "PostToolBatch") {
    return {
      label: labelFromModel(input.model, input.sessionId),
      sourceKind: sourceKindFromModel(input.model),
      state: "thinking",
      detail: "Tool batch completed",
      updatedAt,
      paths: [cwd],
      activityEvent: null,
      gitBranch: input.gitBranch,
      confidence: "typed",
      needsUser: null,
      latestMessage: null,
      isOngoing: true
    };
  }

  if (hookEventName === "PreToolUse" || hookEventName === "PostToolUse" || hookEventName === "PostToolUseFailure") {
    return claudeToolSummary({
      sessionId: input.sessionId,
      model: input.model,
      fallbackCwd: cwd,
      gitBranch: input.gitBranch,
      updatedAt,
      toolName,
      toolInput,
      failed: hookEventName === "PostToolUseFailure"
    });
  }

  return null;
}

function sourceKindFromModel(model: string | null): string {
  return model ? `claude:${model}` : "claude";
}

function normalizeClaudeDisplayModel(model: string | null): string | null {
  if (!model) {
    return null;
  }

  const raw = model.trim();
  if (!raw || /^<[^>]+>$/.test(raw)) {
    return null;
  }

  const normalized = raw
    .replace(/^claude-/i, "")
    .replace(/-\d{8}$/i, "")
    .replace(/-/g, " ")
    .trim();
  return normalized || null;
}

function labelFromModel(model: string | null, sessionId: string): string {
  const normalized = normalizeClaudeDisplayModel(model);
  if (!normalized) {
    return `Claude ${sessionId.slice(0, 4)}`;
  }
  return `Claude ${shorten(normalized, 18)}`;
}

function extractProjectRoot(records: Array<Record<string, unknown>>): string | null {
  for (const record of records) {
    const root = canonicalizeProjectPath(typeof record.cwd === "string" ? record.cwd : null);
    if (root) {
      return root;
    }
  }
  return null;
}

async function scanClaudeProjectDirs(): Promise<ClaudeProjectDir[]> {
  let projectEntries;
  try {
    projectEntries = await readdir(CLAUDE_PROJECTS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }

  const projects: ClaudeProjectDir[] = [];

  for (const entry of projectEntries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const dirPath = join(CLAUDE_PROJECTS_DIR, entry.name);
    const fileEntries = await readdir(dirPath, { withFileTypes: true }).catch(() => []);
    const files = await Promise.all(
      fileEntries
        .filter((file) => file.isFile() && file.name.endsWith(".jsonl"))
        .map(async (file) => {
          const path = join(dirPath, file.name);
          const sample = await readLogSample(path).catch(() => null);
          if (!sample) {
            return null;
          }
          return {
            path,
            updatedAt: sample.mtimeMs,
            root: extractProjectRoot([...sample.headRecords, ...sample.tailRecords])
          };
        })
    );

    const validFiles = files.filter((file): file is { path: string; updatedAt: number; root: string | null } => Boolean(file));
    if (validFiles.length === 0) {
      continue;
    }

    const newestFile = [...validFiles].sort((left, right) => right.updatedAt - left.updatedAt)[0];
    if (!newestFile.root) {
      continue;
    }

    projects.push({
      root: newestFile.root,
      dirPath,
      updatedAt: newestFile.updatedAt,
      count: validFiles.length,
      files: validFiles
        .map((file) => ({ path: file.path, updatedAt: file.updatedAt }))
        .sort((left, right) => right.updatedAt - left.updatedAt)
    });
  }

  return projects.sort((left, right) => right.updatedAt - left.updatedAt);
}

async function discoverClaudeProjectsViaSdk(limit = 50): Promise<ClaudeSdkProject[]> {
  const sessions = await listClaudeSdkSessions({ limit });
  if (!sessions || sessions.length === 0) {
    return [];
  }

  const grouped = new Map<string, ClaudeSdkProject>();
  for (const session of sessions) {
    const root = canonicalizeProjectPath(session.cwd);
    if (!root) {
      continue;
    }

    const existing = grouped.get(root);
    if (existing) {
      existing.count += 1;
      existing.updatedAt = Math.max(existing.updatedAt, session.lastModified);
      continue;
    }

    grouped.set(root, {
      root,
      updatedAt: session.lastModified,
      count: 1
    });
  }

  return [...grouped.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, limit);
}

async function loadClaudeSessionsViaSdk(projectRoot: string, limit = 12): Promise<ClaudeSdkSessionEntry[] | null> {
  const sessions = await listClaudeSdkSessions({
    dir: projectRoot,
    limit,
    includeWorktrees: true
  });
  if (!sessions || sessions.length === 0) {
    return null;
  }

  const entries = await Promise.all(
    sessions.map(async (session) => {
      const cwd = canonicalizeProjectPath(session.cwd) ?? projectRoot;
      const records = await getClaudeSdkSessionRecords({
        sessionId: session.sessionId,
        dir: projectRoot,
        cwd,
        gitBranch: session.gitBranch,
        limit: 200
      });
      if (!records || records.length === 0) {
        return null;
      }
      return {
        sessionId: session.sessionId,
        updatedAt: session.lastModified,
        cwd,
        gitBranch: session.gitBranch ?? null,
        records
      };
    })
  );

  return entries.filter((entry): entry is ClaudeSdkSessionEntry => Boolean(entry));
}

async function collectClaudeLoadedSessions(projectRoot: string, limit = 12): Promise<ClaudeLoadedSession[]> {
  const sdkSessions = await loadClaudeSessionsViaSdk(projectRoot, limit);
  if (sdkSessions && sdkSessions.length > 0) {
    return Promise.all(
      sdkSessions.map(async (session) => {
        const hookSample = await resolveReadableClaudeHooksFilePath(projectRoot, session.sessionId)
          .then((filePath) => readLogSample(filePath))
          .catch(() => null);
        const hookRecords = hookSample ? [...hookSample.headRecords, ...hookSample.tailRecords] : [];
        const updatedAt = Math.max(session.updatedAt, hookSample?.mtimeMs ?? 0);
        const summary = summariseClaudeSession(
          session.sessionId,
          session.cwd,
          session.records,
          updatedAt,
          hookRecords
        );
        return {
          sessionId: session.sessionId,
          cwd: session.cwd,
          gitBranch: session.gitBranch,
          updatedAt,
          records: session.records,
          hookRecords,
          summary
        };
      })
    );
  }

  const projects = await scanClaudeProjectDirs();
  const project = projects.find((entry) => entry.root === projectRoot);
  if (!project) {
    return [];
  }

  const sessions = await Promise.all(
    project.files.slice(0, limit).map(async (file) => {
      const sample = await readLogSample(file.path).catch(() => null);
      if (!sample) {
        return null;
      }

      const records = [...sample.headRecords, ...sample.tailRecords];
      const cwd = extractProjectRoot(records) ?? projectRoot;
      const sessionId = file.path.match(/([0-9a-f-]{36})\.jsonl$/i)?.[1] ?? file.path;
      const hookSample = await resolveReadableClaudeHooksFilePath(projectRoot, sessionId)
        .then((filePath) => readLogSample(filePath))
        .catch(() => null);
      const hookRecords = hookSample ? [...hookSample.headRecords, ...hookSample.tailRecords] : [];
      const updatedAt = Math.max(file.updatedAt, hookSample?.mtimeMs ?? 0);
      const summary = summariseClaudeSession(
        sessionId,
        cwd,
        records,
        updatedAt,
        hookRecords
      );

      return {
        sessionId,
        cwd,
        gitBranch: summary.gitBranch,
        updatedAt,
        records,
        hookRecords,
        summary
      };
    })
  );

  return sessions.filter((entry): entry is ClaudeLoadedSession => Boolean(entry));
}

function mergePathLists(...pathLists: string[][]): string[] {
  return Array.from(new Set(pathLists.flat().filter(Boolean)));
}

function maxIsoTimestamp(...timestamps: Array<string | number | null | undefined>): string {
  const ms = Math.max(
    0,
    ...timestamps
      .map((timestamp) => {
        if (typeof timestamp === "number") {
          return timestamp;
        }
        if (typeof timestamp === "string") {
          const parsed = Date.parse(timestamp);
          return Number.isFinite(parsed) ? parsed : 0;
        }
        return 0;
      })
  );
  return new Date(ms || Date.now()).toISOString();
}

function claudeAgentFromLoadedSession(
  session: ClaudeLoadedSession,
  appearance: Awaited<ReturnType<typeof ensureAgentAppearance>>,
  teamContext: ClaudeTeamMemberContext | null = null
): DashboardAgent {
  const parentThreadId = teamContext ? claudeTeamParentAgentId(teamContext) : null;
  const teamCwd = teamContext ? claudeTeamMemberPrimaryCwd(teamContext.member) : null;
  const updatedAt = teamContext
    ? maxIsoTimestamp(session.summary.updatedAt, teamContext.team.updatedAt, teamContext.member.joinedAt)
    : session.summary.updatedAt;
  const memberIsActive = teamContext?.member.isActive ?? false;
  const state =
    memberIsActive && (session.summary.state === "idle" || session.summary.state === "done")
      ? "running"
      : session.summary.state;
  const isOngoing = session.summary.isOngoing || memberIsActive;
  const detail =
    memberIsActive && (session.summary.state === "idle" || session.summary.state === "done")
      ? `${teamContext?.member.name ?? "Teammate"} active in ${teamContext?.team.name ?? "Claude team"}`
      : session.summary.detail;
  const paths = teamContext
    ? mergePathLists(
      [teamCwd ?? session.cwd, teamContext.member.cwd],
      session.summary.paths
    )
    : session.summary.paths;

  return {
    id: claudeLeadAgentId(session.sessionId),
    label: teamContext?.member.name ?? session.summary.label,
    source: "claude",
    sourceKind: teamContext ? `claude:team:${teamContext.team.name}` : session.summary.sourceKind,
    parentThreadId,
    depth: parentThreadId ? 1 : 0,
    isCurrent: false,
    isOngoing,
    statusText: teamContext ? (teamContext.member.isActive ? "running" : "idle") : "claude",
    role: teamContext?.member.agentType ?? "claude",
    nickname: teamContext?.member.name ?? null,
    isSubagent: Boolean(teamContext),
    state,
    detail,
    cwd: teamCwd ?? session.cwd,
    roomId: null,
    appearance,
    updatedAt,
    stoppedAt: !isOngoing && parentThreadId ? updatedAt : null,
    paths,
    activityEvent: session.summary.activityEvent,
    latestMessage: session.summary.latestMessage,
    threadId: session.sessionId,
    taskId: null,
    resumeCommand: null,
    url: null,
    git: {
      sha: null,
      branch: session.summary.gitBranch ?? session.gitBranch,
      originUrl: null
    },
    provenance: "claude",
    confidence: session.summary.confidence,
    needsUser: session.summary.needsUser,
    liveSubscription: "readOnly",
    network: null
  };
}

function mergeClaudeDashboardAgents(existing: DashboardAgent, incoming: DashboardAgent): DashboardAgent {
  const existingUpdatedAt = Date.parse(existing.updatedAt);
  const incomingUpdatedAt = Date.parse(incoming.updatedAt);
  const incomingIsNewer = Number.isFinite(incomingUpdatedAt)
    && (!Number.isFinite(existingUpdatedAt) || incomingUpdatedAt >= existingUpdatedAt);
  const primary = incomingIsNewer ? incoming : existing;
  const secondary = incomingIsNewer ? existing : incoming;
  const parentThreadId = primary.parentThreadId ?? secondary.parentThreadId;
  const teamStyled = incoming.sourceKind.startsWith("claude:team") ? incoming : existing.sourceKind.startsWith("claude:team") ? existing : null;

  return {
    ...primary,
    label: teamStyled?.nickname ?? teamStyled?.label ?? primary.label,
    sourceKind: teamStyled?.sourceKind ?? primary.sourceKind,
    parentThreadId,
    depth: parentThreadId ? Math.max(1, primary.depth, secondary.depth) : primary.depth,
    isOngoing: primary.isOngoing || (secondary.isOngoing && !primary.stoppedAt),
    role: teamStyled?.role ?? primary.role ?? secondary.role,
    nickname: teamStyled?.nickname ?? primary.nickname ?? secondary.nickname,
    isSubagent: primary.isSubagent || secondary.isSubagent || Boolean(parentThreadId),
    cwd: primary.cwd ?? secondary.cwd,
    paths: mergePathLists(primary.paths, secondary.paths),
    stoppedAt: primary.isOngoing || secondary.isOngoing ? null : primary.stoppedAt ?? secondary.stoppedAt,
    threadId: primary.threadId ?? secondary.threadId,
    confidence: primary.confidence === "typed" || secondary.confidence === "typed" ? "typed" : primary.confidence
  };
}

function latestClaudeTeamHookSummary(input: {
  context: ClaudeTeamMemberContext;
  sessions: ClaudeLoadedSession[];
}): { summary: ClaudeActivitySummary; updatedAtMs: number } | null {
  let latest: { summary: ClaudeActivitySummary; updatedAtMs: number } | null = null;

  for (const session of input.sessions) {
    if (
      input.context.leadSessionId
      && session.sessionId !== input.context.leadSessionId
      && session.sessionId !== input.context.member.sessionId
    ) {
      continue;
    }

    for (const record of session.hookRecords) {
      const agentId = claudeHookAgentId(record);
      const teamName = stringValue(record, "team_name", "teamName");
      const teammateName = stringValue(record, "teammate_name", "teammateName");
      const matchesAgent = agentId === input.context.member.agentId;
      const matchesTeammate = teamName === input.context.team.name && teammateName === input.context.member.name;
      if (!matchesAgent && !matchesTeammate) {
        continue;
      }

      const summary = summariseClaudeHookRecord({
        sessionId: input.context.member.sessionId ?? session.sessionId,
        model: input.context.member.model,
        fallbackCwd: claudeTeamMemberPrimaryCwd(input.context.member),
        gitBranch: session.gitBranch,
        record,
        fallbackUpdatedAt: session.updatedAt
      });
      if (!summary) {
        continue;
      }

      const updatedAtMs = recordTimestampMs(record, session.updatedAt);
      if (!latest || updatedAtMs >= latest.updatedAtMs) {
        latest = { summary: ageClaudeSummary(summary), updatedAtMs };
      }
    }
  }

  return latest;
}

function claudeTeamMemberSummary(input: {
  context: ClaudeTeamMemberContext;
  sessions: ClaudeLoadedSession[];
}): ClaudeActivitySummary {
  const primaryCwd = claudeTeamMemberPrimaryCwd(input.context.member);
  const baseUpdatedAt = Math.max(input.context.team.updatedAt, input.context.member.joinedAt ?? 0);
  const base: ClaudeActivitySummary = {
    label: input.context.member.name,
    sourceKind: `claude:team:${input.context.team.name}`,
    state: input.context.member.isActive ? "running" : "waiting",
    detail: input.context.member.isActive
      ? `${input.context.member.name} active in ${input.context.team.name}`
      : `${input.context.member.name} idle in ${input.context.team.name}`,
    updatedAt: new Date(baseUpdatedAt || Date.now()).toISOString(),
    paths: mergePathLists([primaryCwd], [input.context.member.cwd]),
    activityEvent: null,
    gitBranch: null,
    confidence: "typed",
    needsUser: null,
    latestMessage: null,
    isOngoing: true
  };
  const latestHook = latestClaudeTeamHookSummary(input);
  if (!latestHook) {
    return base;
  }

  const hookState =
    input.context.member.isActive && (latestHook.summary.state === "done" || latestHook.summary.state === "idle")
      ? "running"
      : latestHook.summary.state;
  return {
    ...base,
    state: hookState,
    detail: latestHook.summary.detail,
    updatedAt: maxIsoTimestamp(base.updatedAt, latestHook.updatedAtMs),
    paths: mergePathLists(latestHook.summary.paths, base.paths),
    activityEvent: latestHook.summary.activityEvent,
    latestMessage: latestHook.summary.latestMessage,
    needsUser: latestHook.summary.needsUser,
    isOngoing: input.context.member.isActive || latestHook.summary.isOngoing
  };
}

async function claudeAgentFromTeamMemberContext(input: {
  projectRoot: string;
  context: ClaudeTeamMemberContext;
  sessions: ClaudeLoadedSession[];
}): Promise<DashboardAgent> {
  const summary = claudeTeamMemberSummary({
    context: input.context,
    sessions: input.sessions
  });
  const id = claudeTeamAgentId(input.context);
  const parentThreadId = claudeTeamParentAgentId(input.context);
  const threadId = input.context.member.sessionId ?? id;
  const appearance = await ensureAgentAppearance(input.projectRoot, id);

  return {
    id,
    label: input.context.member.name,
    source: "claude",
    sourceKind: `claude:team:${input.context.team.name}`,
    parentThreadId,
    depth: parentThreadId ? 1 : 0,
    isCurrent: false,
    isOngoing: summary.isOngoing,
    statusText: input.context.member.isActive ? "running" : "idle",
    role: input.context.member.agentType ?? "teammate",
    nickname: input.context.member.name,
    isSubagent: true,
    state: summary.state,
    detail: summary.detail,
    cwd: claudeTeamMemberPrimaryCwd(input.context.member),
    roomId: null,
    appearance,
    updatedAt: summary.updatedAt,
    stoppedAt: summary.isOngoing ? null : summary.updatedAt,
    paths: summary.paths,
    activityEvent: summary.activityEvent,
    latestMessage: summary.latestMessage,
    threadId,
    taskId: null,
    resumeCommand: null,
    url: null,
    git: null,
    provenance: "claude",
    confidence: "typed",
    needsUser: summary.needsUser,
    liveSubscription: "readOnly",
    network: null
  };
}

async function buildClaudeSubagentAgents(input: {
  projectRoot: string;
  session: ClaudeLoadedSession;
  teamIndex: ClaudeTeamIndex;
}): Promise<DashboardAgent[]> {
  const latestById = new Map<string, {
    agentId: string;
    agentType: string | null;
    context: ClaudeTeamMemberContext | null;
    cwd: string;
    summary: ClaudeActivitySummary;
    updatedAtMs: number;
  }>();

  for (const record of input.session.hookRecords) {
    const agentId = claudeHookAgentId(record);
    if (!agentId) {
      continue;
    }
    const context = input.teamIndex.byLeadAndAgentId.get(claudeTeamMemberContextKey(input.session.sessionId, agentId)) ?? null;
    const summary = summariseClaudeHookRecord({
      sessionId: context?.member.sessionId ?? input.session.sessionId,
      model: context?.member.model ?? null,
      fallbackCwd: context ? claudeTeamMemberPrimaryCwd(context.member) : input.session.cwd,
      gitBranch: input.session.gitBranch,
      record,
      fallbackUpdatedAt: input.session.updatedAt
    });
    if (!summary) {
      continue;
    }

    const id = context ? claudeTeamAgentId(context) : claudeChildAgentId(input.session.sessionId, agentId);
    const updatedAtMs = recordTimestampMs(record, input.session.updatedAt);
    const existing = latestById.get(id);
    if (existing && existing.updatedAtMs > updatedAtMs) {
      continue;
    }

    latestById.set(id, {
      agentId,
      agentType: claudeHookAgentType(record) ?? existing?.agentType ?? context?.member.agentType ?? null,
      context,
      cwd:
        canonicalizeProjectPath(stringValue(record, "cwd"))
        ?? (context ? claudeTeamMemberPrimaryCwd(context.member) : input.session.cwd),
      summary: ageClaudeSummary(summary),
      updatedAtMs
    });
  }

  return Promise.all(
    [...latestById.entries()].map(async ([id, seed]) => {
      const parentThreadId = seed.context ? claudeTeamParentAgentId(seed.context) : claudeLeadAgentId(input.session.sessionId);
      const threadId = seed.context?.member.sessionId ?? id;
      const appearance = await ensureAgentAppearance(input.projectRoot, id);
      const label =
        seed.context?.member.name
        ?? (seed.agentType ? titleCaseIdentifier(seed.agentType) : `Claude ${seed.agentId.slice(0, 4)}`);
      const role = seed.context?.member.agentType ?? seed.agentType ?? "subagent";
      return {
        id,
        label,
        source: "claude" as const,
        sourceKind: seed.context ? `claude:team:${seed.context.team.name}` : seed.agentType ? `claude:subagent:${seed.agentType}` : "claude:subagent",
        parentThreadId,
        depth: parentThreadId ? 1 : 0,
        isCurrent: false,
        isOngoing: seed.summary.isOngoing,
        statusText: seed.summary.isOngoing ? "running" : seed.summary.state,
        role,
        nickname: seed.context?.member.name ?? seed.agentId,
        isSubagent: true,
        state: seed.summary.state,
        detail: seed.summary.detail,
        cwd: seed.cwd,
        roomId: null,
        appearance,
        updatedAt: seed.summary.updatedAt,
        stoppedAt: seed.summary.isOngoing ? null : seed.summary.updatedAt,
        paths: seed.summary.paths.length > 0 ? seed.summary.paths : [seed.cwd],
        activityEvent: seed.summary.activityEvent,
        latestMessage: seed.summary.latestMessage,
        threadId,
        taskId: null,
        resumeCommand: null,
        url: null,
        git: {
          sha: null,
          branch: seed.summary.gitBranch ?? input.session.gitBranch,
          originUrl: null
        },
        provenance: "claude" as const,
        confidence: "typed" as const,
        needsUser: seed.summary.needsUser,
        liveSubscription: "readOnly" as const,
        network: null
      } satisfies DashboardAgent;
    })
  );
}

async function buildClaudeTeamAgentsForProject(input: {
  projectRoot: string;
  sessions: ClaudeLoadedSession[];
  teamIndex: ClaudeTeamIndex;
}): Promise<DashboardAgent[]> {
  const contexts = new Map<string, ClaudeTeamMemberContext>();
  for (const context of input.teamIndex.contexts) {
    const primaryCwd = claudeTeamMemberPrimaryCwd(context.member);
    if (!sameProjectPath(primaryCwd, input.projectRoot)) {
      continue;
    }
    contexts.set(claudeTeamAgentId(context), context);
  }

  return Promise.all(
    [...contexts.values()].map((context) =>
      claudeAgentFromTeamMemberContext({
        projectRoot: input.projectRoot,
        context,
        sessions: input.sessions
      })
    )
  );
}

function claudeCoworkState(session: ClaudeCoworkSession, now = Date.now()): ActivityState {
  if (session.isArchived) {
    return "idle";
  }
  const ageMs = now - session.updatedAt;
  if (ageMs <= RECENT_CLAUDE_HOOK_ACTIVE_WINDOW_MS) {
    return "thinking";
  }
  if (ageMs <= RECENT_DONE_WINDOW_MS) {
    return "done";
  }
  return "idle";
}

function claudeCoworkDetail(session: ClaudeCoworkSession): string {
  return shorten(session.title ?? session.initialMessage ?? "Claude Cowork session", 88);
}

function claudeCoworkActivityEvent(session: ClaudeCoworkSession, projectRoot: string): AgentActivityEvent | null {
  const latestPath = session.filePaths.find((path) => sameProjectPath(dirname(path), projectRoot)) ?? session.filePaths[0] ?? null;
  if (!latestPath) {
    return null;
  }
  return {
    type: "fileChange",
    action: "updated",
    path: latestPath,
    title: `updated ${latestPath}`,
    isImage: isImagePath(latestPath)
  };
}

async function claudeAgentFromCoworkSession(input: {
  projectRoot: string;
  session: ClaudeCoworkSession;
}): Promise<DashboardAgent> {
  const id = claudeCoworkAgentId(input.session.sessionId);
  const appearance = await ensureAgentAppearance(input.projectRoot, id);
  const state = claudeCoworkState(input.session);
  const isOngoing = state === "thinking";
  const paths = mergePathLists(input.session.roots, input.session.filePaths);

  return {
    id,
    label: input.session.title ?? "Claude Cowork",
    source: "claude",
    sourceKind: input.session.model ? `claude:cowork:${input.session.model}` : "claude:cowork",
    parentThreadId: null,
    depth: 0,
    isCurrent: false,
    isOngoing,
    statusText: "cowork",
    role: "cowork",
    nickname: null,
    isSubagent: false,
    state,
    detail: claudeCoworkDetail(input.session),
    cwd: input.projectRoot,
    roomId: null,
    appearance,
    updatedAt: new Date(input.session.updatedAt).toISOString(),
    stoppedAt: isOngoing ? null : new Date(input.session.updatedAt).toISOString(),
    paths: paths.length > 0 ? paths : [input.projectRoot],
    activityEvent: claudeCoworkActivityEvent(input.session, input.projectRoot),
    latestMessage: null,
    threadId: input.session.sessionId,
    taskId: null,
    resumeCommand: null,
    url: null,
    git: null,
    provenance: "claude",
    confidence: "typed",
    needsUser: null,
    liveSubscription: "readOnly",
    network: null
  };
}

async function buildClaudeCoworkAgentsForProject(input: {
  projectRoot: string;
  sessions: ClaudeCoworkSession[];
  limit?: number;
}): Promise<DashboardAgent[]> {
  const matching = input.sessions
    .filter((session) => session.roots.some((root) => sameProjectPath(root, input.projectRoot)))
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, input.limit ?? 8);

  return Promise.all(matching.map((session) =>
    claudeAgentFromCoworkSession({
      projectRoot: input.projectRoot,
      session
    })
  ));
}

export async function loadClaudeProjectSnapshotData(projectRoot: string, limit = 12): Promise<{
  agents: DashboardAgent[];
  events: DashboardEvent[];
}> {
  const canonicalRoot = canonicalizeProjectPath(projectRoot);
  if (!canonicalRoot) {
    return { agents: [], events: [] };
  }

  const [sessions, teams] = await Promise.all([
    collectClaudeLoadedSessions(canonicalRoot, limit),
    readClaudeTeamSnapshots(limit * 4)
  ]);
  const coworkSessions = await readClaudeCoworkSessions(limit * 4);
  const inferredLeadSessionIds = inferClaudeTeamLeadSessionIds(teams, sessions);
  const teamIndex = buildClaudeTeamIndex(teams, inferredLeadSessionIds);
  const [teamAgents, coworkAgents] = await Promise.all([
    buildClaudeTeamAgentsForProject({
      projectRoot: canonicalRoot,
      sessions,
      teamIndex
    }),
    buildClaudeCoworkAgentsForProject({
      projectRoot: canonicalRoot,
      sessions: coworkSessions,
      limit
    })
  ]);
  if (sessions.length === 0 && teamAgents.length === 0 && coworkAgents.length === 0) {
    return { agents: [], events: [] };
  }

  const agentsById = new Map<string, DashboardAgent>();
  const events = new Map<string, DashboardEvent>();
  const upsertAgent = (agent: DashboardAgent) => {
    const existing = agentsById.get(agent.id);
    agentsById.set(agent.id, existing ? mergeClaudeDashboardAgents(existing, agent) : agent);
  };

  for (const session of sessions) {
    const teamContext = teamIndex.bySessionId.get(session.sessionId) ?? null;
    const appearance = await ensureAgentAppearance(canonicalRoot, claudeLeadAgentId(session.sessionId));
    upsertAgent(claudeAgentFromLoadedSession(session, appearance, teamContext));
    for (const childAgent of await buildClaudeSubagentAgents({
      projectRoot: canonicalRoot,
      session,
      teamIndex
    })) {
      upsertAgent(childAgent);
    }
    for (const event of buildClaudeSessionEvents({
      sessionId: session.sessionId,
      fallbackCwd: session.cwd,
      records: session.records,
      fallbackUpdatedAt: session.updatedAt,
      hookRecords: session.hookRecords,
      teamIndex
    })) {
      events.set(event.id, event);
    }
  }

  for (const teamAgent of teamAgents) {
    upsertAgent(teamAgent);
  }
  for (const coworkAgent of coworkAgents) {
    upsertAgent(coworkAgent);
  }

  return {
    agents: [...agentsById.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    events: [...events.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  };
}

export function summariseClaudeSession(
  sessionId: string,
  fallbackCwd: string,
  records: Array<Record<string, unknown>>,
  fallbackUpdatedAt: number,
  hookRecords: Array<Record<string, unknown>> = []
): ClaudeActivitySummary {
  const ordered = [...records].sort((left, right) => recordTimestampMs(left, fallbackUpdatedAt) - recordTimestampMs(right, fallbackUpdatedAt));
  const latestRecord = ordered.at(-1) ?? null;
  const latestAssistant = [...ordered].reverse().find((record) => record.type === "assistant") ?? null;
  const latestToolRecord = [...ordered].reverse().find((record) => Boolean(extractAssistantTool(record))) ?? null;
  const latestUserTextRecord = [...ordered].reverse().find((record) => Boolean(extractUserText(record))) ?? null;
  const latestAssistantTextRecord = [...ordered].reverse().find((record) => Boolean(extractAssistantText(record))) ?? null;

  const latestMessage = latestAssistant ? messageObject(latestAssistant) : null;
  const model = latestMessage && typeof latestMessage.model === "string" ? latestMessage.model : null;
  const updatedAtMs = latestRecord ? recordTimestampMs(latestRecord, fallbackUpdatedAt) : fallbackUpdatedAt;
  const updatedAt = new Date(updatedAtMs).toISOString();
  const gitBranch = latestRecord && typeof latestRecord.gitBranch === "string" ? latestRecord.gitBranch : null;
  const latestHookSummary = [...hookRecords]
    .reverse()
    .map((record) => summariseClaudeHookRecord({
      sessionId,
      model,
      fallbackCwd,
      gitBranch,
      record,
      fallbackUpdatedAt
    }))
    .find((summary): summary is ClaudeActivitySummary => Boolean(summary));

  if (latestHookSummary) {
    return mergeClaudeAssistantTextSummary({
      base: ageClaudeSummary(latestHookSummary),
      latestAssistantTextRecord,
      fallbackUpdatedAt,
      fallbackCwd
    });
  }

  if (latestToolRecord) {
    const tool = extractAssistantTool(latestToolRecord);
    if (tool) {
      const toolSummary = claudeToolSummary({
        sessionId,
        model,
        fallbackCwd,
        gitBranch,
        updatedAt,
        toolName: tool.name,
        toolInput: tool.input,
        failed: false
      });
      if (toolSummary) {
        return {
          ...toolSummary,
          confidence: "inferred"
        };
      }
    }
  }

  if (latestUserTextRecord && (!latestAssistantTextRecord || recordTimestampMs(latestUserTextRecord, fallbackUpdatedAt) >= recordTimestampMs(latestAssistantTextRecord, fallbackUpdatedAt))) {
    const text = extractUserText(latestUserTextRecord) ?? "Assigned work";
    const paths = extractPathsFromText(text);
    return {
      label: labelFromModel(model, sessionId),
      sourceKind: sourceKindFromModel(model),
      state: "planning",
      detail: shorten(text, 88),
      updatedAt,
      paths: paths.length > 0 ? paths : [fallbackCwd],
      activityEvent: null,
      gitBranch,
      confidence: "inferred",
      needsUser: null,
      latestMessage: null,
      isOngoing: true
    };
  }

  if (latestAssistantTextRecord) {
    const text = extractAssistantText(latestAssistantTextRecord) ?? "Responded";
    const textPaths = extractPathsFromText(text);
    const ageMs = Date.now() - recordTimestampMs(latestAssistantTextRecord, fallbackUpdatedAt);
    const state =
      ageMs <= 2 * 60 * 1000 ? "thinking"
      : ageMs <= RECENT_DONE_WINDOW_MS ? "done"
      : "idle";
    return {
      label: labelFromModel(model, sessionId),
      sourceKind: sourceKindFromModel(model),
      state,
      detail: shorten(text, 88),
      updatedAt,
      paths: textPaths.length > 0 ? textPaths : [fallbackCwd],
      activityEvent:
        ageMs <= RECENT_MESSAGE_WINDOW_MS
          ? {
              type: "agentMessage",
              action: "said",
              path: textPaths[0] ?? fallbackCwd,
              title: shorten(text, 88),
              isImage: false
            }
          : null,
      gitBranch,
      confidence: "inferred",
      needsUser: null,
      latestMessage: text,
      isOngoing: ageMs <= RECENT_DONE_WINDOW_MS
    };
  }

  return {
    label: labelFromModel(model, sessionId),
    sourceKind: sourceKindFromModel(model),
    state: "idle",
    detail: "Idle",
    updatedAt,
    paths: [fallbackCwd],
    activityEvent: null,
    gitBranch,
    confidence: "inferred",
    needsUser: null,
    latestMessage: null,
    isOngoing: false
  };
}

export async function discoverClaudeProjects(limit = 50): Promise<DiscoveredProject[]> {
  const [sdkProjects, teams, coworkSpaces, coworkSessions] = await Promise.all([
    discoverClaudeProjectsViaSdk(limit),
    readClaudeTeamSnapshots(limit * 4),
    readClaudeCoworkSpaces(limit * 4),
    readClaudeCoworkSessions(limit * 4)
  ]);
  const fallbackProjects = sdkProjects.length > 0 ? [] : await scanClaudeProjectDirs();
  const grouped = new Map<string, ClaudeSdkProject>();

  for (const project of [
    ...sdkProjects,
    ...fallbackProjects.map((project) => ({
      root: project.root,
      updatedAt: project.updatedAt,
      count: project.count
    })),
    ...claudeProjectsFromTeams(teams, limit),
    ...claudeProjectsFromCowork({
      spaces: coworkSpaces,
      sessions: coworkSessions,
      limit
    })
  ]) {
    const existing = [...grouped.values()].find((candidate) => sameProjectPath(candidate.root, project.root));
    if (existing) {
      existing.count += project.count;
      existing.updatedAt = Math.max(existing.updatedAt, project.updatedAt);
      continue;
    }
    grouped.set(project.root, { ...project });
  }

  return [...grouped.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, limit)
    .map((project) => ({
      root: project.root,
      label: basename(project.root) || project.root,
      updatedAt: project.updatedAt,
      count: project.count
    }));
}

export function discoverClaudeProjectsFromTeamsForTest(teams: ClaudeTeamSnapshot[], limit = 50): DiscoveredProject[] {
  return claudeProjectsFromTeams(teams, limit).map((project) => ({
    root: project.root,
    label: basename(project.root) || project.root,
    updatedAt: project.updatedAt,
    count: project.count
  }));
}

export function discoverClaudeProjectsFromCoworkForTest(input: {
  spaces?: ClaudeCoworkSpace[];
  sessions?: ClaudeCoworkSession[];
  limit?: number;
}): DiscoveredProject[] {
  return claudeProjectsFromCowork({
    spaces: input.spaces ?? [],
    sessions: input.sessions ?? [],
    limit: input.limit ?? 50
  }).map((project) => ({
    root: project.root,
    label: basename(project.root) || project.root,
    updatedAt: project.updatedAt,
    count: project.count
  }));
}

export async function buildClaudeSubagentAgentsForTest(input: {
  projectRoot: string;
  sessionId: string;
  cwd: string;
  gitBranch?: string | null;
  updatedAt: number;
  records?: Array<Record<string, unknown>>;
  hookRecords: Array<Record<string, unknown>>;
  teams?: ClaudeTeamSnapshot[];
}): Promise<DashboardAgent[]> {
  const session: ClaudeLoadedSession = {
    sessionId: input.sessionId,
    cwd: canonicalizeProjectPath(input.cwd) ?? input.cwd,
    gitBranch: input.gitBranch ?? null,
    updatedAt: input.updatedAt,
    records: input.records ?? [],
    hookRecords: input.hookRecords,
    summary: summariseClaudeSession(
      input.sessionId,
      canonicalizeProjectPath(input.cwd) ?? input.cwd,
      input.records ?? [],
      input.updatedAt,
      input.hookRecords
    )
  };
  const teamIndex = buildClaudeTeamIndex(input.teams ?? [], inferClaudeTeamLeadSessionIds(input.teams ?? [], [session]));
  return buildClaudeSubagentAgents({
    projectRoot: canonicalizeProjectPath(input.projectRoot) ?? input.projectRoot,
    session,
    teamIndex
  });
}

export async function buildClaudeTeamAgentsForTest(input: {
  projectRoot: string;
  teams: ClaudeTeamSnapshot[];
}): Promise<DashboardAgent[]> {
  const sessions: ClaudeLoadedSession[] = [];
  const inferredLeadSessionIds = inferClaudeTeamLeadSessionIds(input.teams, sessions);
  const teamIndex = buildClaudeTeamIndex(input.teams, inferredLeadSessionIds);
  return buildClaudeTeamAgentsForProject({
    projectRoot: canonicalizeProjectPath(input.projectRoot) ?? input.projectRoot,
    sessions,
    teamIndex
  });
}

export async function buildClaudeCoworkAgentsForTest(input: {
  projectRoot: string;
  sessions: ClaudeCoworkSession[];
}): Promise<DashboardAgent[]> {
  return buildClaudeCoworkAgentsForProject({
    projectRoot: canonicalizeProjectPath(input.projectRoot) ?? input.projectRoot,
    sessions: input.sessions
  });
}

export async function loadClaudeAgents(projectRoot: string, limit = 12): Promise<DashboardAgent[]> {
  return (await loadClaudeProjectSnapshotData(projectRoot, limit)).agents;
}
