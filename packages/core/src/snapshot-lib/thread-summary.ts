import { looksLikeValidationCommand, shortenText, isMeaningfulText } from "../utils/text";
import { summarizeWebSearch } from "../web-search";
import { turnHasFinalAnswer, turnHasNonFinalWorkSignal } from "../domain/codex-turn-semantics";
import type {
  AgentActivityEvent,
  ActivityState,
  CodexThread,
  CodexTurn,
  DashboardEvent,
  ThreadItem
} from "../types";

const DONE_WINDOW_MS = 15 * 60 * 1000;
const USER_PROMPT_ACTIVE_WINDOW_MS = 30 * 1000;
const EVENT_ACTIVITY_WINDOW_MS = 90 * 1000;

function isFreshActivityEvent(event: DashboardEvent, threadUpdatedAtMs: number, nowMs = Date.now()): boolean {
  const createdAtMs = Date.parse(event.createdAt);
  return Number.isFinite(createdAtMs)
    && createdAtMs >= threadUpdatedAtMs - EVENT_ACTIVITY_WINDOW_MS
    && createdAtMs >= nowMs - EVENT_ACTIVITY_WINDOW_MS;
}

function recentActivityEventPriority(event: DashboardEvent): number {
  if (event.kind === "subagent") {
    return 48;
  }
  if (event.kind === "message") {
    if (event.method === "item/completed" && event.itemType === "agentMessage") {
      return 40;
    }
    if (event.method === "item/agentMessage/delta") {
      return 35;
    }
    if (event.method === "item/started" && event.itemType === "agentMessage") {
      return 30;
    }
    if (event.method === "thread/read/agentMessage") {
      return 10;
    }
    return 20;
  }
  if (event.kind === "fileChange") {
    return 50;
  }
  if (event.kind === "command") {
    return 45;
  }
  return 0;
}

function compareRecentActivityEvents(left: DashboardEvent, right: DashboardEvent): number {
  const priorityDelta = recentActivityEventPriority(right) - recentActivityEventPriority(left);
  if (priorityDelta !== 0) {
    return priorityDelta;
  }
  return right.createdAt.localeCompare(left.createdAt);
}

function threadTurns(thread: CodexThread): CodexTurn[] {
  return Array.isArray(thread.turns) ? thread.turns : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value ? value as Record<string, unknown> : null;
}

function sourceRecord(thread: CodexThread): Record<string, unknown> | null {
  return asRecord(thread.source);
}

function sourceStringValue(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function sourceKindForThread(thread: CodexThread): string {
  if (typeof thread.source === "string") {
    return thread.source;
  }
  const source = sourceRecord(thread);
  return sourceStringValue(source, "sourceKind")
    ?? sourceStringValue(source, "source_kind")
    ?? sourceStringValue(source, "kind")
    ?? sourceStringValue(source, "type")
    ?? "unknown";
}

function subAgentSourceForThread(thread: CodexThread): unknown {
  const source = sourceRecord(thread);
  return source
    ? source.subAgent
      ?? source.subagent
      ?? source.sub_agent
      ?? source.subAgentThreadSpawn
      ?? source.subagentThreadSpawn
      ?? source.sub_agent_thread_spawn
      ?? null
    : null;
}

function recordHasThreadSpawnMetadata(record: Record<string, unknown> | null): boolean {
  return Boolean(
    record
    && (
      sourceStringValue(record, "parent_thread_id")
      || sourceStringValue(record, "parentThreadId")
      || sourceStringValue(record, "agent_nickname")
      || sourceStringValue(record, "agentNickname")
      || sourceStringValue(record, "agent_path")
      || sourceStringValue(record, "agentPath")
      || sourceStringValue(record, "agent_role")
      || sourceStringValue(record, "agentRole")
      || sourceStringValue(record, "agent_type")
      || sourceStringValue(record, "agentType")
      || typeof record.depth === "number"
    )
  );
}

function threadSpawnSourceForThread(thread: CodexThread): Record<string, unknown> | null {
  const source = sourceRecord(thread);
  const sourceThreadSpawn = asRecord(source?.thread_spawn) ?? asRecord(source?.threadSpawn);
  if (sourceThreadSpawn) {
    return sourceThreadSpawn;
  }
  if (recordHasThreadSpawnMetadata(source)) {
    return source;
  }

  const subAgentSource = subAgentSourceForThread(thread);
  const subAgentRecord = asRecord(subAgentSource);
  const threadSpawn = asRecord(subAgentRecord?.thread_spawn) ?? asRecord(subAgentRecord?.threadSpawn);
  if (threadSpawn) {
    return threadSpawn;
  }
  if (recordHasThreadSpawnMetadata(subAgentRecord)) {
    return subAgentRecord;
  }

  const threadRecord = thread as unknown as Record<string, unknown>;
  return recordHasThreadSpawnMetadata(threadRecord) ? threadRecord : null;
}

function sourceAgentNickname(thread: CodexThread): string | null {
  const threadSpawn = threadSpawnSourceForThread(thread);
  return sourceStringValue(threadSpawn, "agent_nickname") ?? sourceStringValue(threadSpawn, "agentNickname");
}

function sourceAgentRole(thread: CodexThread): string | null {
  const threadSpawn = threadSpawnSourceForThread(thread);
  return sourceStringValue(threadSpawn, "agent_role")
    ?? sourceStringValue(threadSpawn, "agentRole")
    ?? sourceStringValue(threadSpawn, "agent_type")
    ?? sourceStringValue(threadSpawn, "agentType");
}

function sourceAgentPath(thread: CodexThread): string | null {
  const threadSpawn = threadSpawnSourceForThread(thread);
  return sourceStringValue(threadSpawn, "agent_path") ?? sourceStringValue(threadSpawn, "agentPath");
}

export function formatGoalCommandLabel(value: string): string {
  return value.replace(/(^|[\s(\x5B\x7B<"'])\/goal(?=$|[\s)\]\x7D,.!?:;"'>])/g, "$1🎯");
}

export function pickThreadLabel(thread: CodexThread): string {
  const agentNickname = thread.agentNickname ?? sourceAgentNickname(thread);
  const agentPath = sourceAgentPath(thread);
  const agentPathName = agentPath?.split("/").filter(Boolean).at(-1) ?? null;
  const label = (
    agentNickname ??
    agentPathName ??
    thread.name ??
    shortenText(thread.preview || thread.id, 42)
  );
  return formatGoalCommandLabel(label);
}

function extractStringArray(value: unknown, key: string): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === "object" && entry && typeof (entry as Record<string, unknown>)[key] === "string"
      ? ((entry as Record<string, unknown>)[key] as string)
      : null))
    .filter((entry): entry is string => Boolean(entry));
}

function extractNumberValue(value: unknown, ...keys: string[]): number | undefined {
  if (typeof value !== "object" || !value) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function extractReceiverThreadIds(item: ThreadItem): string[] {
  const receiverThreadIds = item.receiverThreadIds ?? item.receiver_thread_ids;
  if (Array.isArray(receiverThreadIds)) {
    return receiverThreadIds.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  }
  const receiverThreadId = item.receiverThreadId ?? item.receiver_thread_id;
  return typeof receiverThreadId === "string" && receiverThreadId.length > 0 ? [receiverThreadId] : [];
}

function normalizeCollabToolName(tool: string): string {
  const normalized = tool.replace(/[_\s-]+/g, "").toLowerCase();
  if (normalized === "spawnagent" || normalized === "spawnagents") {
    return "spawn";
  }
  if (normalized === "waitagent" || normalized === "wait") {
    return "wait";
  }
  if (normalized === "sendinput" || normalized === "sendmessage" || normalized === "followuptask") {
    return "send";
  }
  if (normalized === "closeagent") {
    return "close";
  }
  if (normalized === "resumeagent") {
    return "resume";
  }
  return normalized;
}

function collabToolDetail(item: ThreadItem): string {
  const rawTool = typeof item.tool === "string" ? item.tool : "subagent";
  const receiverCount = extractReceiverThreadIds(item).length;
  switch (normalizeCollabToolName(rawTool)) {
    case "spawn":
      return receiverCount > 0
        ? `Spawning ${receiverCount} subagent${receiverCount === 1 ? "" : "s"}`
        : "Spawning subagent";
    case "wait":
      return receiverCount > 1 ? `Waiting on ${receiverCount} subagents` : "Waiting on subagents";
    case "send":
      return receiverCount > 1 ? `Messaging ${receiverCount} subagents` : "Messaging subagent";
    case "close":
      return receiverCount > 1 ? `Closing ${receiverCount} subagents` : "Closing subagent";
    case "resume":
      return receiverCount > 1 ? `Resuming ${receiverCount} subagents` : "Resuming subagent";
    default:
      return rawTool;
  }
}

function summarizeFileChange(item: ThreadItem): {
  action: AgentActivityEvent["action"];
  path: string | null;
  title: string;
  isImage: boolean;
  linesAdded?: number;
  linesRemoved?: number;
  paths: string[];
} {
  const primaryChange = Array.isArray(item.changes)
    ? item.changes.find((entry) => typeof entry === "object" && entry && typeof (entry as Record<string, unknown>).path === "string") as Record<string, unknown> | undefined
    : undefined;
  const paths = extractStringArray(item.changes, "path");
  const primaryPath = paths[0] ?? null;
  const changeKind = typeof primaryChange?.kind === "string" ? primaryChange.kind : "edit";
  const action =
    changeKind === "create" ? "created"
    : changeKind === "delete" ? "deleted"
    : changeKind === "move" || changeKind === "rename" ? "moved"
    : "edited";

  return {
    action,
    path: primaryPath,
    title: primaryPath ? `${changeKind} ${primaryPath}` : "Editing files",
    isImage: Boolean(primaryPath && /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(primaryPath)),
    linesAdded: extractNumberValue(primaryChange, "linesAdded", "lines_added", "added") ?? extractNumberValue(item, "linesAdded", "lines_added"),
    linesRemoved: extractNumberValue(primaryChange, "linesRemoved", "lines_removed", "removed") ?? extractNumberValue(item, "linesRemoved", "lines_removed"),
    paths
  };
}

function extractTextContent(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (
        typeof entry === "object"
        && entry
        && typeof (entry as Record<string, unknown>).text === "string"
      ) {
        return (entry as Record<string, unknown>).text as string;
      }
      return null;
    })
    .filter((entry): entry is string => Boolean(entry));
}

function extractPathsFromText(text: string): string[] {
  const matches = text.match(/(?:[A-Za-z]:[\\/][^\s`'"]+|\/[^\s`'"]+)/g) ?? [];
  return Array.from(new Set(matches));
}

function summarizePlanItem(item: ThreadItem): string {
  const explanation = typeof item.explanation === "string" ? item.explanation : null;
  if (isMeaningfulText(explanation)) {
    return shortenText(explanation, 88);
  }

  const summary = typeof item.summary === "string" ? item.summary : null;
  if (isMeaningfulText(summary)) {
    return shortenText(summary, 88);
  }

  const text = typeof item.text === "string" ? item.text : null;
  if (isMeaningfulText(text)) {
    return shortenText(text, 88);
  }

  const plan = Array.isArray(item.plan) ? item.plan : [];
  const entries = plan
    .map((entry) => (typeof entry === "object" && entry ? entry as Record<string, unknown> : null))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => ({
      step: typeof entry.step === "string" ? entry.step : null,
      status: typeof entry.status === "string" ? entry.status : null
    }))
    .filter((entry) => isMeaningfulText(entry.step));

  const current =
    entries.find((entry) => entry.status === "inProgress")
    ?? entries.find((entry) => entry.status === "pending")
    ?? entries.at(-1)
    ?? null;

  if (!current?.step) {
    return "Planning";
  }

  if (current.status === "inProgress") {
    return shortenText(`Planning: ${current.step}`, 88);
  }
  if (current.status === "pending") {
    return shortenText(`Queued: ${current.step}`, 88);
  }
  return shortenText(current.step, 88);
}

function summarizeFailedItemDetail(item: ThreadItem, fallback: string): string {
  const errorRecord = typeof item.error === "object" && item.error ? item.error as Record<string, unknown> : null;
  const errorMessage =
    (errorRecord && typeof errorRecord.message === "string" ? errorRecord.message : null)
    || (errorRecord && typeof errorRecord.text === "string" ? errorRecord.text : null)
    || (typeof item.error_message === "string" ? item.error_message : null)
    || (typeof item.reason === "string" ? item.reason : null)
    || (typeof item.message === "string" ? item.message : null);
  if (isMeaningfulText(errorMessage)) {
    return shortenText(errorMessage, 88);
  }
  return fallback;
}

function describeAgentMessage(item: ThreadItem): { detail: string; paths: string[] } {
  const candidateText = typeof item.text === "string" ? item.text : null;
  const text = isMeaningfulText(candidateText)
    ? candidateText
    : "Responding";
  return {
    detail: shortenText(text, 88),
    paths: extractPathsFromText(text)
  };
}

export function latestAgentMessageForThread(thread: CodexThread): string | null {
  const turns = threadTurns(thread);
  for (const turn of [...turns].reverse()) {
    for (const item of [...turn.items].reverse()) {
      if (item.type !== "agentMessage" || typeof item.text !== "string") {
        continue;
      }
      const text = shortenText(item.text, 240);
      if (isMeaningfulText(text)) {
        return text;
      }
    }
  }
  if (turns.length === 0) {
    const preview = shortenText(thread.preview || "", 240);
    return isMeaningfulText(preview) ? preview : null;
  }
  return null;
}

export function syncSummaryWithLatestThreadMessage(
  thread: CodexThread,
  summary: ReturnType<typeof summariseThread>,
  recentEvents: DashboardEvent[] = []
): {
  latestMessage: string | null;
  summary: ReturnType<typeof summariseThread>;
} {
  const latestMessage = latestAgentMessageForThread(thread);
  if (!latestMessage || summary.activityEvent?.type !== "agentMessage") {
    return { latestMessage, summary };
  }

  if (summary.detail === latestMessage && summary.activityEvent.title === latestMessage) {
    return { latestMessage, summary };
  }

  const latestRecentMessageEvent = recentEvents
    .filter((event) => event.threadId === thread.id && event.kind === "message")
    .sort(compareRecentActivityEvents)[0] ?? null;
  const latestRecentMessageCreatedAtMs = latestRecentMessageEvent
    ? Date.parse(latestRecentMessageEvent.createdAt)
    : Number.NaN;
  const summaryUsesRecentMessage =
    latestRecentMessageEvent
    && (
      summary.detail === latestRecentMessageEvent.detail
      || summary.activityEvent.title === latestRecentMessageEvent.detail
    );
  if (
    summaryUsesRecentMessage
    && Number.isFinite(latestRecentMessageCreatedAtMs)
    && latestRecentMessageCreatedAtMs > thread.updatedAt * 1000
  ) {
    return { latestMessage, summary };
  }

  return {
    latestMessage,
    summary: {
      ...summary,
      detail: latestMessage,
      activityEvent: {
        ...summary.activityEvent,
        title: latestMessage
      }
    }
  };
}

function extractPromptRole(text: string | null | undefined): string | null {
  if (typeof text !== "string" || text.length === 0) {
    return null;
  }
  const explicitRoleMatch = text.match(/(?:^|\n)\s*Role:\s*([A-Za-z][A-Za-z0-9_-]*)/i);
  if (explicitRoleMatch) {
    return explicitRoleMatch[1].trim().toLowerCase();
  }
  const impliedRoleMatch = text.match(/\bAct as (?:an?|the)?\s*([A-Za-z][A-Za-z0-9_-]*)\s+subagent\b/i);
  return impliedRoleMatch ? impliedRoleMatch[1].trim().toLowerCase() : null;
}

export function parseThreadSourceMeta(thread: CodexThread): {
  sourceKind: string;
  parentThreadId: string | null;
  depth: number;
  agentNickname: string | null;
  agentRole: string | null;
} {
  const subAgentSource = subAgentSourceForThread(thread);
  const threadSpawn = threadSpawnSourceForThread(thread);
  const sourceKind = sourceKindForThread(thread);

  if (typeof threadSpawn === "object" && threadSpawn) {
    return {
      sourceKind: "subAgent",
      parentThreadId:
        typeof threadSpawn.parent_thread_id === "string"
          ? threadSpawn.parent_thread_id
          : typeof threadSpawn.parentThreadId === "string"
            ? threadSpawn.parentThreadId
          : null,
      depth:
        typeof threadSpawn.depth === "number"
          ? threadSpawn.depth
          : 1,
      agentNickname: sourceAgentNickname(thread),
      agentRole: sourceAgentRole(thread)
    };
  }

  if (typeof thread.source === "string") {
    return {
      sourceKind,
      parentThreadId: null,
      depth: sourceKind.startsWith("subAgent") ? 1 : 0,
      agentNickname: null,
      agentRole: null
    };
  }

  if (subAgentSource === "review" || subAgentSource === "compact") {
    return {
      sourceKind: subAgentSource === "review" ? "subAgentReview" : "subAgentCompact",
      parentThreadId: null,
      depth: 1,
      agentNickname: null,
      agentRole: null
    };
  }

  if (subAgentSource === "memory_consolidation" || typeof subAgentSource === "object") {
    return {
      sourceKind: "subAgentOther",
      parentThreadId: null,
      depth: 1,
      agentNickname: null,
      agentRole: null
    };
  }

  return {
    sourceKind,
    parentThreadId: null,
    depth: 0,
    agentNickname: null,
    agentRole: null
  };
}

export function parentThreadIdForThread(thread: CodexThread): string | null {
  return parseThreadSourceMeta(thread).parentThreadId;
}

const ACTIVE_SUBAGENT_THREAD_WINDOW_MS = 20 * 60 * 1000;

export function isStaleActiveSubagentThread(thread: CodexThread, nowMs = Date.now()): boolean {
  if (thread.status.type !== "active" || !parentThreadIdForThread(thread)) {
    return false;
  }
  if (threadTurns(thread).some((turn) => turn.status === "inProgress")) {
    return false;
  }
  const updatedAtMs = thread.updatedAt * 1000;
  return Number.isFinite(updatedAtMs) && nowMs - updatedAtMs > ACTIVE_SUBAGENT_THREAD_WINDOW_MS;
}

export function inferThreadAgentRole(thread: CodexThread, sourceKind: string): string | null {
  if (sourceKind === "subAgent") {
    const previewRole = extractPromptRole(thread.preview);
    if (previewRole && previewRole !== "default") {
      return previewRole;
    }
    const userMessageRole = [...threadTurns(thread)]
      .reverse()
      .flatMap((turn) => [...turn.items].reverse())
      .find((item) => item.type === "userMessage");
    const extractedUserRole = userMessageRole
      ? extractPromptRole(extractTextContent((userMessageRole as Record<string, unknown>).content)[0] ?? null)
      : null;
    if (extractedUserRole && extractedUserRole !== "default") {
      return extractedUserRole;
    }
  }
  return thread.agentRole ?? sourceAgentRole(thread);
}

const FRESH_SPAWNED_THREAD_WINDOW_MS = 2 * 60 * 1000;
// Just-sent desktop prompts can appear as notLoaded/no-turn rows before hydration catches up.
const FRESH_NOT_LOADED_THREAD_UPDATE_WINDOW_MS = 8 * 1000;
const QUIET_LIVE_THREAD_WINDOW_MS = 3 * 60 * 1000;

function isFreshSpawnedDetachedThread(thread: CodexThread): boolean {
  if (thread.status.type !== "notLoaded") {
    return false;
  }
  if (threadTurns(thread).length > 0) {
    return false;
  }
  if (thread.source !== "exec" && typeof thread.source !== "object") {
    return false;
  }
  const createdAtMs = thread.createdAt * 1000;
  if (!Number.isFinite(createdAtMs)) {
    return false;
  }
  return Date.now() - createdAtMs <= FRESH_SPAWNED_THREAD_WINDOW_MS;
}

function isFreshNotLoadedUnhydratedThread(thread: CodexThread): boolean {
  if (thread.status.type !== "notLoaded") {
    return false;
  }
  if (threadTurns(thread).length > 0) {
    return false;
  }
  const updatedAtMs = thread.updatedAt * 1000;
  if (!Number.isFinite(updatedAtMs)) {
    return false;
  }
  return Date.now() - updatedAtMs <= FRESH_NOT_LOADED_THREAD_UPDATE_WINDOW_MS;
}

function isFreshNotLoadedNonFinalWorkThread(
  thread: CodexThread,
  lastTurn: CodexTurn | null | undefined = threadTurns(thread).at(-1),
  nowMs = Date.now()
): boolean {
  if (thread.status.type !== "notLoaded" || !lastTurn) {
    return false;
  }
  if (parentThreadIdForThread(thread)) {
    return false;
  }
  if (lastTurn.status === "failed" || turnHasFinalAnswer(lastTurn)) {
    return false;
  }
  const updatedAtMs = thread.updatedAt * 1000;
  if (!Number.isFinite(updatedAtMs) || nowMs - updatedAtMs > QUIET_LIVE_THREAD_WINDOW_MS) {
    return false;
  }
  return lastTurn.status === "inProgress" || turnHasNonFinalWorkSignal(lastTurn);
}

export function isOngoingThread(thread: CodexThread): boolean {
  if (thread.status.type === "active") {
    const lastTurn = threadTurns(thread).at(-1);
    if (lastTurn && turnHasFinalAnswer(lastTurn)) {
      return false;
    }
    return !isStaleActiveSubagentThread(thread);
  }
  if (isFreshSpawnedDetachedThread(thread) || isFreshNotLoadedUnhydratedThread(thread)) {
    return true;
  }
  const turns = threadTurns(thread);
  const lastTurn = turns.at(-1);
  return Boolean(
    lastTurn
    && (
      lastTurn.status === "inProgress"
      || isFreshNotLoadedNonFinalWorkThread(thread, lastTurn)
    )
  );
}

function selectRelevantItem(items: ThreadItem[]): ThreadItem | null {
  const priority: ThreadItem["type"][] = [
    "fileChange",
    "commandExecution",
    "dynamicToolCall",
    "mcpToolCall",
    "webSearch",
    "imageView",
    "collabToolCall",
    "collabAgentToolCall",
    "enteredReviewMode",
    "exitedReviewMode",
    "plan",
    "reasoning",
    "contextCompaction",
    "agentMessage",
    "userMessage"
  ];

  for (const type of priority) {
    const match = [...items].reverse().find((item) => item.type === type);
    if (match) {
      return match;
    }
  }

  return items.at(-1) ?? null;
}

export function summariseThread(thread: CodexThread): {
  state: ActivityState;
  detail: string;
  paths: string[];
  activityEvent: AgentActivityEvent | null;
} {
  const ageMs = Date.now() - thread.updatedAt * 1000;
  const settledRecentState = ageMs <= DONE_WINDOW_MS ? "done" : "idle";

  if (thread.status.type === "systemError") {
    return {
      state: "blocked",
      detail: "System error",
      paths: [thread.cwd],
      activityEvent: null
    };
  }

  if (thread.status.type === "active" && thread.status.activeFlags?.includes("waitingOnApproval")) {
    return {
      state: "blocked",
      detail: "Waiting on approval",
      paths: [thread.cwd],
      activityEvent: null
    };
  }

  if (thread.status.type === "active" && thread.status.activeFlags?.includes("waitingOnUserInput")) {
    return {
      state: "waiting",
      detail: "Waiting on user input",
      paths: [thread.cwd],
      activityEvent: null
    };
  }

  const turns = threadTurns(thread);
  const lastTurn = turns.at(-1);
  if (!lastTurn) {
    const preview = shortenText(thread.preview || "", 88);
    const freshSpawnedDetached = isFreshSpawnedDetachedThread(thread);
    const freshNotLoadedUnhydrated = isFreshNotLoadedUnhydratedThread(thread);
    const recentState = ageMs <= DONE_WINDOW_MS ? "done" : "idle";
    return {
      state:
        thread.status.type === "active" || freshSpawnedDetached || freshNotLoadedUnhydrated ? "planning"
        : recentState,
      detail:
        preview
        || (thread.status.type === "active" || freshSpawnedDetached || freshNotLoadedUnhydrated
          ? "No turns yet"
          : recentState === "done"
            ? "Finished recently"
            : "Idle"),
      paths: [thread.cwd],
      activityEvent: null
    };
  }

  const interruptedWithoutFinalAnswer =
    lastTurn.status === "interrupted" && !turnHasFinalAnswer(lastTurn);
  const freshNotLoadedNonFinalWork = isFreshNotLoadedNonFinalWorkThread(thread, lastTurn);
  const activeTopLevelWithoutFinalAnswer =
    thread.status.type === "active"
    && !parentThreadIdForThread(thread)
    && !turnHasFinalAnswer(lastTurn);
  const treatAsInProgress =
    lastTurn.status === "inProgress"
    || freshNotLoadedNonFinalWork
    || activeTopLevelWithoutFinalAnswer;

  if (lastTurn.status === "failed") {
    return {
      state: "blocked",
      detail: lastTurn.error?.message ?? "Turn failed",
      paths: [thread.cwd],
      activityEvent: null
    };
  }

  const item = selectRelevantItem(lastTurn.items);
  if (!item) {
    return {
      state:
        treatAsInProgress ? "planning"
        : interruptedWithoutFinalAnswer ? (ageMs <= DONE_WINDOW_MS ? "done" : "idle")
        : "idle",
      detail:
        treatAsInProgress ? "Planning"
        : interruptedWithoutFinalAnswer ? (ageMs <= DONE_WINDOW_MS ? "Interrupted" : "Idle")
        : "Idle",
      paths: [thread.cwd],
      activityEvent: null
    };
  }

  switch (item.type) {
    case "fileChange": {
      const change = summarizeFileChange(item);
      const status = typeof item.status === "string" ? item.status : "inProgress";
      const state =
        status === "failed" || status === "declined" ? "blocked"
        : !treatAsInProgress && status === "completed" ? settledRecentState
        : "editing";
      const editingDetail = change.path ? `Editing ${change.path}` : "Editing files";
      return {
        state,
        detail:
          state === "blocked" ? summarizeFailedItemDetail(item, editingDetail)
          : state === "done" || state === "idle"
            ? change.path ? `Edited ${change.path}` : "Edited files"
            : editingDetail,
        paths: change.paths.length > 0 ? change.paths : [thread.cwd],
        activityEvent: {
          type: "fileChange",
          action: change.action,
          path: change.path,
          title: change.title,
          isImage: change.isImage,
          linesAdded: change.linesAdded,
          linesRemoved: change.linesRemoved
        }
      };
    }
    case "commandExecution": {
      const command = typeof item.command === "string" ? item.command : "Command";
      const cwd = typeof item.cwd === "string" ? item.cwd : thread.cwd;
      const status = typeof item.status === "string" ? item.status : "inProgress";
      if (status === "failed" || status === "declined") {
        return {
          state: "blocked",
          detail: summarizeFailedItemDetail(item, command),
          paths: [cwd],
          activityEvent: {
            type: "commandExecution",
            action: "ran",
            path: cwd,
            title: command,
            isImage: false
          }
        };
      }
      return {
        state:
          !treatAsInProgress && status === "completed"
            ? settledRecentState
            : looksLikeValidationCommand(command) ? "validating" : "running",
        detail: command,
        paths: [cwd],
        activityEvent: {
          type: "commandExecution",
          action: "ran",
          path: cwd,
          title: command,
          isImage: false
        }
      };
    }
    case "webSearch": {
      const query = summarizeWebSearch(item);
      return {
        state: "scanning",
        detail: query,
        paths: [thread.cwd],
        activityEvent: {
          type: "webSearch",
          action: "updated",
          path: thread.cwd,
          title: query,
          isImage: false
        }
      };
    }
    case "dynamicToolCall":
    case "mcpToolCall": {
      const server = typeof item.server === "string" ? item.server : "mcp";
      const tool = typeof item.tool === "string" ? item.tool : server;
      const status = typeof item.status === "string" ? item.status : "inProgress";
      return {
        state:
          status === "failed" || status === "declined" ? "blocked"
          : !treatAsInProgress && status === "completed" ? settledRecentState
          : "planning",
        detail: status === "failed" || status === "declined" ? summarizeFailedItemDetail(item, tool) : tool,
        paths: [thread.cwd],
        activityEvent: {
          type: item.type,
          action: "updated",
          path: thread.cwd,
          title: tool,
          isImage: false
        }
      };
    }
    case "collabToolCall":
    case "collabAgentToolCall": {
      const detail = collabToolDetail(item);
      const status = typeof item.status === "string" ? item.status : "inProgress";
      return {
        state:
          status === "failed" || status === "declined" ? "blocked"
          : !treatAsInProgress && status === "completed" ? settledRecentState
          : "delegating",
        detail: status === "failed" || status === "declined" ? summarizeFailedItemDetail(item, detail) : detail,
        paths: [thread.cwd],
        activityEvent: {
          type: item.type,
          action: "updated",
          path: thread.cwd,
          title: detail,
          isImage: false
        }
      };
    }
    case "plan":
      return {
        state:
          !treatAsInProgress && item.status === "completed" ? settledRecentState : "planning",
        detail: summarizePlanItem(item),
        paths: [thread.cwd],
        activityEvent: {
          type: "plan",
          action: "updated",
          path: thread.cwd,
          title: summarizePlanItem(item),
          isImage: false
        }
      };
    case "reasoning": {
      const text = typeof item.summary === "string" ? item.summary : typeof item.text === "string" ? item.text : "Reasoning";
      return {
        state:
          !treatAsInProgress && item.status === "completed" ? settledRecentState : "thinking",
        detail: shortenText(text, 88),
        paths: [thread.cwd],
        activityEvent: null
      };
    }
    case "contextCompaction":
      return {
        state: treatAsInProgress ? "thinking" : settledRecentState,
        detail: treatAsInProgress ? "Compacting context" : "Compacted context",
        paths: [thread.cwd],
        activityEvent: null
      };
    case "agentMessage": {
      const message = describeAgentMessage(item);
      const interruptedCommentary =
        interruptedWithoutFinalAnswer
        && (item.phase === "commentary" || item.phase === "assistant_response");
      return {
        state:
          treatAsInProgress || (interruptedCommentary && ageMs <= DONE_WINDOW_MS) ? "thinking"
          : interruptedCommentary || ageMs <= DONE_WINDOW_MS ? "done"
          : "idle",
        detail: message.detail,
        paths: message.paths.length > 0 ? message.paths : [thread.cwd],
        activityEvent: {
          type: "agentMessage",
          action: "said",
          path: message.paths[0] ?? thread.cwd,
          title: message.detail,
          isImage: false
        }
      };
    }
    case "userMessage": {
      const text = typeof item.text === "string" ? shortenText(item.text, 88) : "Prompt";
      return {
        state:
          treatAsInProgress || ageMs <= USER_PROMPT_ACTIVE_WINDOW_MS ? "planning"
          : ageMs <= DONE_WINDOW_MS ? "done"
          : "idle",
        detail: text,
        paths: extractPathsFromText(text).length > 0 ? extractPathsFromText(text) : [thread.cwd],
        activityEvent: {
          type: "userMessage",
          action: "said",
          path: thread.cwd,
          title: text,
          isImage: false
        }
      };
    }
    default:
      return {
        state:
          treatAsInProgress ? "planning"
          : interruptedWithoutFinalAnswer ? (ageMs <= DONE_WINDOW_MS ? "done" : "idle")
          : ageMs <= DONE_WINDOW_MS ? "done"
          : "idle",
        detail:
          treatAsInProgress ? "Planning"
          : interruptedWithoutFinalAnswer ? (ageMs <= DONE_WINDOW_MS ? "Interrupted" : "Idle")
          : ageMs <= DONE_WINDOW_MS ? "Finished recently"
          : "Idle",
        paths: [thread.cwd],
        activityEvent: null
      };
  }
}

export function buildActivityEventFromDashboardEvent(event: DashboardEvent): AgentActivityEvent | null {
  switch (event.kind) {
    case "fileChange":
      return {
        type: "fileChange",
        action: event.action ?? "edited",
        path: event.path,
        title: event.title,
        isImage: Boolean(event.isImage),
        linesAdded: event.linesAdded,
        linesRemoved: event.linesRemoved
      };
    case "command":
      return {
        type: "commandExecution",
        action: "ran",
        path: event.path,
        title: event.command ?? event.detail ?? event.title,
        isImage: false
      };
    case "subagent":
      return {
        type: "collabAgentToolCall",
        action: "updated",
        path: event.path,
        title: event.detail || event.title,
        isImage: false
      };
    case "message":
      return {
        type: "agentMessage",
        action: "said",
        path: event.path,
        title: event.detail || event.title,
        isImage: false
      };
    default:
      return null;
  }
}

export function applyRecentActivityEvent(
  thread: CodexThread,
  summary: ReturnType<typeof summariseThread>,
  recentEvents: DashboardEvent[]
): ReturnType<typeof summariseThread> {
  if (recentEvents.length === 0) {
    return summary;
  }

  const updatedAtMs = thread.updatedAt * 1000;
  const preferredEvent = recentEvents
    .filter((event) => {
      if (event.threadId !== thread.id) {
        return false;
      }
      if (!["fileChange", "command", "subagent", "message"].includes(event.kind)) {
        return false;
      }
      return isFreshActivityEvent(event, updatedAtMs);
    })
    .sort(compareRecentActivityEvents)
    .find((event) =>
      event.kind === "fileChange"
      || event.kind === "command"
      || event.kind === "subagent"
      || event.kind === "message"
    );

  if (!preferredEvent) {
    return summary;
  }

  if (summary.state === "waiting" || summary.state === "blocked") {
    return summary;
  }

  const activityEvent = buildActivityEventFromDashboardEvent(preferredEvent);
  if (!activityEvent) {
    return summary;
  }

  const nextPaths = preferredEvent.path
    ? Array.from(new Set([preferredEvent.path, ...summary.paths.filter(Boolean)]))
    : summary.paths;

  if (preferredEvent.kind === "message") {
    return {
      state: summary.state,
      detail: preferredEvent.detail || summary.detail,
      paths: nextPaths,
      activityEvent
    };
  }
  if (preferredEvent.kind === "command" && (summary.state === "done" || summary.state === "idle")) {
    return summary;
  }
  if (preferredEvent.kind === "subagent") {
    return {
      state: preferredEvent.phase === "failed" ? "blocked" : "delegating",
      detail: preferredEvent.detail || preferredEvent.title,
      paths: nextPaths,
      activityEvent
    };
  }
  const commandText = preferredEvent.command ?? preferredEvent.detail ?? preferredEvent.title;
  const nextState =
    preferredEvent.kind === "fileChange"
      ? (
        preferredEvent.phase === "failed" ? "blocked"
        : preferredEvent.phase === "started" || preferredEvent.phase === "updated" ? "editing"
        : summary.state
      )
      : preferredEvent.kind === "command"
        ? (
          preferredEvent.phase === "failed" ? "blocked"
          : preferredEvent.phase === "started" || preferredEvent.phase === "updated"
            ? (looksLikeValidationCommand(commandText) ? "validating" : "running")
            : summary.state
        )
        : summary.state;

  return {
    state: nextState,
    detail:
      preferredEvent.kind === "fileChange"
        ? preferredEvent.path ? `Edited ${preferredEvent.path}` : preferredEvent.title
        : commandText,
    paths: nextPaths,
    activityEvent
  };
}
