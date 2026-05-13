import { canonicalizeProjectPath } from "../project-paths";
import { summarizeWebSearch } from "../web-search";
import type { AppServerNotification, AppServerServerRequest } from "../app-server";
import type {
  CodexThread,
  DashboardEvent,
  NeedsUserQuestion,
  NeedsUserQuestionOption,
  NeedsUserState
} from "../types";

export interface PendingUserRequest extends NeedsUserState {
  threadId: string;
  createdAt: string;
  requestMethod?: string;
  responseKind?: "approvalDecision" | "legacyReview" | "permissionsApproval" | "toolInput" | "mcpElicitation";
  availableDecisions?: string[];
  requestedPermissions?: Record<string, unknown> | null;
  requestedSchema?: Record<string, unknown> | null;
  networkApprovalContext?: Record<string, unknown> | null;
}

export interface DashboardEventContext {
  projectRoot: string;
  createdAt?: string;
  pendingRequest?: PendingUserRequest | null;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value ? (value as Record<string, unknown>) : null;
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function asNeedsUserQuestionOption(value: unknown): NeedsUserQuestionOption | null {
  const record = asRecord(value);
  const label = asString(record?.label);
  const description = asString(record?.description);
  if (!label || !description) {
    return null;
  }
  return { label, description };
}

function asNeedsUserQuestion(value: unknown): NeedsUserQuestion | null {
  const record = asRecord(value);
  const header = asString(record?.header);
  const id = asString(record?.id);
  const question = asString(record?.question);
  if (!header || !id || !question) {
    return null;
  }

  const rawOptions = Array.isArray(record?.options) ? record.options : null;
  const options =
    rawOptions
      ? rawOptions
        .map((entry) => asNeedsUserQuestionOption(entry))
        .filter((entry): entry is NeedsUserQuestionOption => Boolean(entry))
      : null;

  return {
    header,
    id,
    question,
    required: record?.required === false ? false : undefined,
    isOther: record?.isOther === true,
    isSecret: record?.isSecret === true,
    options
  };
}

function asNeedsUserQuestions(value: unknown): NeedsUserQuestion[] {
  return Array.isArray(value)
    ? value
      .map((entry) => asNeedsUserQuestion(entry))
      .filter((entry): entry is NeedsUserQuestion => Boolean(entry))
    : [];
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

function parseSchemaOptions(schema: Record<string, unknown>): NeedsUserQuestionOption[] | null {
  const enumValues = asStringArray(schema.enum);
  if (enumValues.length > 0) {
    return enumValues.map((value) => ({
      label: value,
      description: value
    }));
  }

  const oneOf = Array.isArray(schema.oneOf) ? schema.oneOf : [];
  const oneOfOptions = oneOf
    .map((entry) => {
      const option = asRecord(entry);
      const constValue = asString(option?.const);
      if (!constValue) {
        return null;
      }
      return {
        label: constValue,
        description: asString(option?.title) ?? asString(option?.description) ?? constValue
      };
    })
    .filter((option): option is NeedsUserQuestionOption => Boolean(option));
  if (oneOfOptions.length > 0) {
    return oneOfOptions;
  }

  const items = asRecord(schema.items);
  const itemEnumValues = asStringArray(items?.enum);
  if (itemEnumValues.length > 0) {
    return itemEnumValues.map((value) => ({
      label: value,
      description: value
    }));
  }

  const nestedItems = asRecord(items?.items);
  const anyOf: unknown[] = Array.isArray(nestedItems?.anyOf)
    ? nestedItems.anyOf
    : Array.isArray(items?.anyOf)
      ? items.anyOf
      : [];
  const anyOfOptions = anyOf
    .map((entry) => {
      const option = asRecord(entry);
      const constValue = asString(option?.const);
      if (!constValue) {
        return null;
      }
      return {
        label: constValue,
        description: asString(option?.title) ?? asString(option?.description) ?? constValue
      };
    })
    .filter((option): option is NeedsUserQuestionOption => Boolean(option));
  return anyOfOptions.length > 0 ? anyOfOptions : null;
}

function parseMcpElicitationQuestions(schema: Record<string, unknown> | null): NeedsUserQuestion[] {
  const properties = asRecord(schema?.properties);
  if (!properties) {
    return [];
  }
  const required = new Set(asStringArray(schema?.required));
  return Object.entries(properties)
    .map((entry): NeedsUserQuestion | null => {
      const [id, rawSchema] = entry;
      const propertySchema = asRecord(rawSchema);
      if (!propertySchema) {
        return null;
      }
      const header = asString(propertySchema.title) ?? titleCaseIdentifier(id);
      const type = asString(propertySchema.type);
      const question = asString(propertySchema.description) ?? header;
      const options =
        type === "boolean"
          ? [
            { label: "true", description: "True" },
            { label: "false", description: "False" }
          ]
          : parseSchemaOptions(propertySchema);
      return {
        header,
        id,
        question,
        required: required.has(id),
        isSecret: propertySchema.format === "password",
        options
      } satisfies NeedsUserQuestion;
    })
    .filter((question): question is NeedsUserQuestion => Boolean(question));
}

function shorten(text: string, maxLength = 88): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function summarizePlanUpdate(params: Record<string, unknown>): string {
  const explanation = asString(params.explanation);
  if (explanation) {
    return shorten(explanation);
  }

  const plan = Array.isArray(params.plan) ? params.plan : [];
  const entries = plan
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => ({
      step: asString(entry.step),
      status: asString(entry.status)
    }))
    .filter((entry) => entry.step);

  if (entries.length === 0) {
    return "Plan";
  }

  const current =
    entries.find((entry) => entry.status === "inProgress")
    ?? entries.find((entry) => entry.status === "pending")
    ?? entries.at(-1)
    ?? null;

  if (!current?.step) {
    return "Plan";
  }

  const statusLabel =
    current.status === "inProgress" ? "In progress"
    : current.status === "pending" ? "Pending"
    : current.status === "completed" ? "Completed"
    : null;

  return shorten(statusLabel ? `${statusLabel}: ${current.step}` : current.step);
}

function summarizeDiffUpdate(params: Record<string, unknown>): string {
  const diff = asString(params.diff);
  if (!diff) {
    return "Diff";
  }

  const files = new Set<string>();
  for (const line of diff.split(/\r?\n/)) {
    const gitMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (gitMatch) {
      files.add(gitMatch[2] || gitMatch[1]);
      continue;
    }
    const plusMatch = line.match(/^\+\+\+ b\/(.+)$/);
    if (plusMatch && plusMatch[1] !== "/dev/null") {
      files.add(plusMatch[1]);
    }
  }

  if (files.size === 1) {
    return shorten(Array.from(files)[0] || "Diff");
  }
  if (files.size > 1) {
    return `${files.size} files changed`;
  }
  return shorten(diff);
}

function isMeaningfulAgentText(text: string | null | undefined): text is string {
  if (typeof text !== "string") {
    return false;
  }
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return false;
  }
  return !/^[.\-_~`"'!,;:|/\\()[\]{}]+$/.test(normalized);
}

function extractNumberValue(value: unknown, ...keys: string[]): number | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

export function extractThreadId(value: unknown): string | null {
  const record = asRecord(value);
  const direct = record ? asString(record.threadId ?? record.thread_id ?? record.conversationId ?? record.conversation_id) : undefined;
  return direct ?? null;
}

function extractTurnId(value: unknown): string | undefined {
  const record = asRecord(value);
  return record ? asString(record.turnId ?? record.turn_id) : undefined;
}

function extractItemId(value: unknown): string | undefined {
  const record = asRecord(value);
  return record ? asString(record.itemId ?? record.item_id ?? record.callId ?? record.call_id ?? record.id) : undefined;
}

export function collectPaths(value: unknown, output = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    const normalized = canonicalizeProjectPath(value);
    if (normalized) {
      output.add(normalized);
    }
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectPaths(entry, output));
    return output;
  }
  const record = asRecord(value);
  if (!record) {
    return output;
  }
  for (const [key, entry] of Object.entries(record)) {
    if (/^(\/|[A-Za-z]:[\\/])/.test(key)) {
      collectPaths(key, output);
    }
    if (/(path|cwd|file|grantRoot)/i.test(key)) {
      collectPaths(entry, output);
      continue;
    }
    if (typeof entry === "object" && entry) {
      collectPaths(entry, output);
    }
  }
  return output;
}

function primaryPath(value: unknown): string | null {
  return [...collectPaths(value)][0] ?? null;
}

export function latestThreadAgentMessage(thread: CodexThread): {
  turnId?: string;
  itemId?: string;
  phase?: string;
  text: string;
} | null {
  for (const turn of [...thread.turns].reverse()) {
    for (const item of [...turn.items].reverse()) {
      const record = asRecord(item);
      if (!record || asString(record.type) !== "agentMessage") {
        continue;
      }
      const text = asString(record.text);
      if (!isMeaningfulAgentText(text)) {
        continue;
      }
      return {
        turnId: asString(record.turnId ?? record.turn_id) ?? turn.id,
        itemId: extractItemId(record),
        phase: asString(record.phase) ?? undefined,
        text
      };
    }
  }
  return null;
}

function isLiveAppServerMethod(method: string): boolean {
  return (
    method === "thread/started"
    || method === "thread/unarchived"
    || method === "turn/started"
    || method === "item/started"
    || method === "item/agentMessage/delta"
    || method === "item/plan/delta"
    || method === "item/reasoning/summaryTextDelta"
    || method === "item/reasoning/summaryPartAdded"
    || method === "item/reasoning/textDelta"
    || method === "item/commandExecution/outputDelta"
    || method === "item/commandExecution/terminalInteraction"
    || method === "item/fileChange/outputDelta"
    || method === "item/fileChange/patchUpdated"
    || method === "item/mcpToolCall/progress"
    || method === "item/commandExecution/requestApproval"
    || method === "item/fileChange/requestApproval"
    || method === "item/tool/requestUserInput"
    || method === "item/tool/call"
    || method === "item/autoApprovalReview/started"
    || method === "item/autoApprovalReview/completed"
    || method === "hook/started"
    || method === "hook/completed"
    || method === "model/rerouted"
    || method === "model/verification"
    || method === "turn/plan/updated"
    || method === "turn/diff/updated"
  );
}

function isTurnTerminalAppServerMethod(method: string): boolean {
  return method === "turn/failed";
}

export function isFinalAgentMessageNotification(message: AppServerNotification): boolean {
  if (message.method !== "item/completed") {
    return false;
  }
  const item = asRecord(message.params?.item);
  return asString(item?.type) === "agentMessage" && asString(item?.phase) === "final_answer";
}

export function shouldMarkThreadLiveFromAppServerNotification(
  method: string,
  statusType?: string | null
): boolean {
  return isLiveAppServerMethod(method) || (method === "thread/status/changed" && statusType === "active");
}

export function shouldMarkThreadStoppedFromAppServerNotification(
  method: string,
  statusType?: string | null
): boolean {
  return (
    method === "thread/archived"
    || isTurnTerminalAppServerMethod(method)
    || (method === "thread/status/changed" && statusType === "systemError")
  );
}

function shouldStopDormantThreadAfterNotification(input: {
  method: string;
  statusType?: string | null;
  wasOngoing: boolean;
}): boolean {
  if (!input.wasOngoing) {
    return false;
  }
  return input.method === "thread/status/changed" && input.statusType === "notLoaded";
}

export function hasEquivalentRecentMessageEvent(
  recentEvents: DashboardEvent[],
  candidate: DashboardEvent
): boolean {
  if (candidate.kind !== "message") {
    return false;
  }
  return recentEvents.some((event) => {
    if (event.kind !== "message") {
      return false;
    }
    if (event.threadId !== candidate.threadId) {
      return false;
    }
    if (event.itemId && candidate.itemId && event.itemId === candidate.itemId) {
      return true;
    }
    const left = event.detail.trim();
    const right = candidate.detail.trim();
    return left === right || left.startsWith(right) || right.startsWith(left);
  });
}

function buildEventId(input: {
  projectRoot: string;
  method: string;
  threadId?: string | null;
  turnId?: string;
  itemId?: string;
  requestId?: string;
  path?: string | null;
}): string {
  return [
    input.projectRoot,
    input.method,
    input.threadId ?? "",
    input.turnId ?? "",
    input.itemId ?? "",
    input.requestId ?? "",
    input.path ?? ""
  ].join("::");
}

function summarizeFileChange(item: Record<string, unknown>, fallbackPath: string | null) {
  const changes = Array.isArray(item.changes) ? item.changes : [];
  const primaryChange = changes.find((entry) => {
    const record = asRecord(entry);
    return Boolean(record && typeof record.path === "string");
  });
  const changeRecord = asRecord(primaryChange);
  const rawPath = asString(changeRecord?.path) ?? fallbackPath ?? null;
  const path = rawPath ? canonicalizeProjectPath(rawPath) ?? rawPath : null;
  const changeKind = asString(changeRecord?.kind) ?? "edit";
  const action: DashboardEvent["action"] =
    changeKind === "create" ? "created"
    : changeKind === "delete" ? "deleted"
    : changeKind === "move" || changeKind === "rename" ? "moved"
    : "edited";

  return {
    path,
    action,
    title:
      action === "created" ? "File created"
      : action === "deleted" ? "File deleted"
      : action === "moved" ? "File moved"
      : "File edited",
    detail: path ?? "Files",
    isImage: Boolean(path && /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(path)),
    linesAdded:
      extractNumberValue(changeRecord, "linesAdded", "lines_added", "added")
      ?? extractNumberValue(item, "linesAdded", "lines_added"),
    linesRemoved:
      extractNumberValue(changeRecord, "linesRemoved", "lines_removed", "removed")
      ?? extractNumberValue(item, "linesRemoved", "lines_removed")
  };
}

function summarizeCommand(item: Record<string, unknown>, method: string) {
  const command = asString(item.command) ?? method;
  const cwd = asString(item.cwd) ?? null;
  const status = asString(item.status) ?? "inProgress";
  const phase =
    status === "failed" || status === "declined" ? "failed"
    : status === "completed" || status === "success" ? "completed"
    : "started";
  return { command, cwd, phase };
}

function summarizeTool(item: Record<string, unknown>, fallbackLabel = "MCP tool") {
  const tool =
    asString(item.tool)
    ?? asString(item.name)
    ?? asString(item.server)
    ?? fallbackLabel;
  const status = asString(item.status) ?? "inProgress";
  const phase =
    status === "failed" || status === "declined" ? "failed"
    : status === "completed" || status === "success" ? "completed"
    : "started";
  return {
    tool,
    phase,
    detail: shorten(tool)
  };
}

function summarizeDynamicTool(params: Record<string, unknown>): string {
  const namespace = asString(params.namespace);
  const tool = asString(params.tool) ?? asString(params.name) ?? "Tool";
  return namespace ? `${namespace}.${tool}` : tool;
}

function summarizeHookRun(params: Record<string, unknown>): string {
  const run = asRecord(params.run);
  return shorten(
    asString(run?.statusMessage)
    ?? asString(run?.eventName)
    ?? asString(run?.sourcePath)
    ?? "Hook"
  );
}

function summarizeGuardianAction(action: unknown): string {
  const record = asRecord(action);
  const type = asString(record?.type);
  if (!record || !type) {
    return "Approval review";
  }
  if (type === "command") {
    return shorten(asString(record.command) ?? "Command approval review");
  }
  if (type === "execve") {
    const argv = Array.isArray(record.argv)
      ? record.argv.filter((entry): entry is string => typeof entry === "string")
      : [];
    return shorten([asString(record.program), ...argv].filter(Boolean).join(" ") || "Exec approval review");
  }
  if (type === "applyPatch") {
    const files = Array.isArray(record.files)
      ? record.files.filter((entry): entry is string => typeof entry === "string")
      : [];
    return files.length === 1 ? shorten(files[0]) : `${files.length || "Patch"} file approval review`;
  }
  if (type === "networkAccess") {
    return shorten(asString(record.target) ?? asString(record.host) ?? "Network approval review");
  }
  if (type === "mcpToolCall") {
    const server = asString(record.server);
    const tool = asString(record.toolTitle) ?? asString(record.toolName);
    return shorten([server, tool].filter(Boolean).join(".") || "MCP tool approval review");
  }
  if (type === "requestPermissions") {
    return shorten(asString(record.reason) ?? "Permission approval review");
  }
  return titleCaseIdentifier(type);
}

function summarizeRawResponseItem(item: Record<string, unknown> | null): string {
  if (!item) {
    return "Raw response item";
  }
  const type = asString(item.type) ?? "response item";
  const text =
    asString(item.text)
    ?? asString(item.output_text)
    ?? asString(item.name)
    ?? asString(item.call_id)
    ?? asString(item.id);
  return shorten(text ?? titleCaseIdentifier(type));
}

function rateLimitDetail(params: Record<string, unknown>): string {
  const rateLimits = asRecord(params.rateLimits);
  const reached = asString(rateLimits?.rateLimitReachedType);
  const limitName = asString(rateLimits?.limitName);
  if (reached && limitName) {
    return `${limitName}: ${reached}`;
  }
  return reached ?? limitName ?? "Rate limits updated";
}

function diagnosticMessage(params: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = asString(params[key]);
    if (value) {
      return value;
    }
  }
  return "";
}

function eventBase(
  context: DashboardEventContext,
  method: string,
  params: Record<string, unknown>,
  overrides: Partial<DashboardEvent>
): DashboardEvent {
  const threadId = overrides.threadId ?? extractThreadId(params) ?? null;
  const turnId = overrides.turnId ?? extractTurnId(params);
  const itemId = overrides.itemId ?? extractItemId(params.item ?? params);
  const requestId = overrides.requestId;
  const path = overrides.path ?? primaryPath(params);
  return {
    id: buildEventId({
      projectRoot: context.projectRoot,
      method,
      threadId,
      turnId,
      itemId,
      requestId,
      path
    }),
    source: "codex",
    confidence: "typed",
    threadId,
    createdAt: context.createdAt ?? new Date().toISOString(),
    method,
    turnId,
    itemId,
    itemType: overrides.itemType,
    requestId,
    kind: "other",
    phase: "updated",
    title: method,
    detail: method,
    path,
    ...overrides
  };
}

export function buildThreadReadAgentMessageEvent(
  context: DashboardEventContext,
  thread: CodexThread
): DashboardEvent | null {
  const latestMessage = latestThreadAgentMessage(thread);
  if (!latestMessage) {
    return null;
  }

  const path = canonicalizeProjectPath(thread.cwd) ?? thread.cwd;
  const isFinalAnswer = latestMessage.phase === "final_answer";
  return {
    id: buildEventId({
      projectRoot: context.projectRoot,
      method: "thread/read/agentMessage",
      threadId: thread.id,
      turnId: latestMessage.turnId,
      itemId: latestMessage.itemId,
      path
    }),
    source: "codex",
    confidence: "typed",
    threadId: thread.id,
    createdAt: context.createdAt ?? new Date().toISOString(),
    method: "thread/read/agentMessage",
    turnId: latestMessage.turnId,
    itemId: latestMessage.itemId,
    kind: "message",
    phase: isFinalAnswer ? "completed" : "updated",
    title: isFinalAnswer ? "Reply completed" : "Reply updated",
    detail: shorten(latestMessage.text),
    path
  };
}

function buildEventFromItem(
  context: DashboardEventContext,
  method: string,
  params: Record<string, unknown>
): DashboardEvent | null {
  const item = asRecord(params.item);
  if (!item) {
    return eventBase(context, method, params, {
      kind: "item",
      title: "Item updated",
      detail: method
    });
  }

  const itemType = asString(item.type) ?? "item";
  const itemId = extractItemId(item);
  const phase =
    method === "item/started" ? "started"
    : method === "item/completed"
      ? (asString(item.status) === "failed" || asString(item.status) === "declined" ? "failed" : "completed")
      : "updated";

  if (itemType === "fileChange") {
    const change = summarizeFileChange(item, primaryPath(params));
    return eventBase(context, method, params, {
      itemId,
      kind: "fileChange",
      phase,
      title: change.title,
      detail: change.detail,
      path: change.path,
      action: change.action,
      isImage: change.isImage,
      linesAdded: change.linesAdded,
      linesRemoved: change.linesRemoved
    });
  }

  if (itemType === "commandExecution") {
    const summary = summarizeCommand(item, method);
    return eventBase(context, method, params, {
      itemId,
      itemType,
      kind: "command",
      phase,
      title:
        phase === "failed" ? "Command failed"
        : phase === "completed" ? "Command completed"
        : "Command started",
      detail: summary.command,
      command: summary.command,
      cwd: summary.cwd ?? undefined,
      path: summary.cwd
    });
  }

  if (itemType === "enteredReviewMode" || itemType === "exitedReviewMode") {
    return eventBase(context, method, params, {
      itemId,
      itemType,
      kind: "item",
      phase,
      title: itemType === "enteredReviewMode" ? "Review started" : "Review finished",
      detail: shorten(asString(item.review) ?? itemType)
    });
  }

  if (itemType === "collabToolCall" || itemType === "collabAgentToolCall") {
    return eventBase(context, method, params, {
      itemId,
      itemType,
      kind: "subagent",
      phase,
      title: phase === "completed" ? "Subagent updated" : "Subagent started",
      detail: shorten(asString(item.tool) ?? itemType)
    });
  }

  if (itemType === "agentMessage") {
    const messageText = asString(item.text);
    if (!isMeaningfulAgentText(messageText)) {
      return null;
    }
    return eventBase(context, method, params, {
      itemId,
      itemType,
      kind: "message",
      phase,
      title: phase === "completed" ? "Reply completed" : "Reply updated",
      detail: shorten(messageText)
    });
  }

  if (itemType === "plan") {
    return eventBase(context, method, params, {
      itemId,
      itemType,
      kind: "turn",
      phase: "updated",
      title: "Plan updated",
      detail: shorten(asString(item.text) ?? "Plan")
    });
  }

  if (itemType === "dynamicToolCall" || itemType === "mcpToolCall") {
    return eventBase(context, method, params, {
      itemId,
      itemType,
      kind: "tool",
      phase,
      title:
        itemType === "dynamicToolCall"
          ? (phase === "failed" ? "Tool failed" : phase === "completed" ? "Tool completed" : "Tool started")
          : (phase === "failed" ? "MCP tool failed" : phase === "completed" ? "MCP tool completed" : "MCP tool started"),
      detail: summarizeTool(item).detail
    });
  }

  if (itemType === "webSearch") {
    return eventBase(context, method, params, {
      itemId,
      itemType,
      kind: "tool",
      phase,
      title:
        phase === "failed" ? "Web search failed"
        : phase === "completed" ? "Web search completed"
        : "Web search started",
      detail: shorten(summarizeWebSearch(item))
    });
  }

  if (itemType === "imageView") {
    return eventBase(context, method, params, {
      itemId,
      itemType,
      kind: "item",
      phase,
      title: phase === "completed" ? "Image viewed" : "Viewing image",
      detail: shorten(asString(item.path) ?? "Image")
    });
  }

  if (itemType === "reasoning") {
    return eventBase(context, method, params, {
      itemId,
      itemType,
      kind: "item",
      phase,
      title: "Reasoning updated",
      detail: shorten(asString(item.text) ?? asString(item.summary) ?? "Reasoning")
    });
  }

  if (itemType === "contextCompaction") {
    return eventBase(context, method, params, {
      itemId,
      itemType,
      kind: "item",
      phase,
      title: "Context compacted",
      detail: "Conversation history compacted"
    });
  }

  return eventBase(context, method, params, {
    itemId,
    itemType,
    kind: "item",
    phase,
    title: `Item ${phase}`,
    detail: itemType
  });
}

export function buildDashboardEventFromAppServerMessage(
  context: DashboardEventContext,
  message: AppServerNotification | AppServerServerRequest
): DashboardEvent | null {
  const method = message.method;
  const params = asRecord(message.params) ?? {};
  const requestId = "id" in message ? String(message.id) : undefined;

  switch (method) {
    case "error": {
      const detail = diagnosticMessage(params, "message", "error") || "Codex app-server error";
      return eventBase(context, method, params, {
        kind: "item",
        phase: "failed",
        title: "Codex error",
        detail: shorten(detail)
      });
    }
    case "warning":
    case "guardianWarning": {
      const detail = diagnosticMessage(params, "message") || "Codex warning";
      return eventBase(context, method, params, {
        kind: "item",
        phase: "failed",
        title: method === "guardianWarning" ? "Guardian warning" : "Codex warning",
        detail: shorten(detail)
      });
    }
    case "configWarning": {
      const detail = diagnosticMessage(params, "details", "summary") || "Configuration warning";
      return eventBase(context, method, params, {
        kind: "item",
        phase: "failed",
        title: "Config warning",
        detail: shorten(detail),
        path: asString(params.path) ?? null
      });
    }
    case "deprecationNotice": {
      const detail = diagnosticMessage(params, "details", "summary") || "Deprecation notice";
      return eventBase(context, method, params, {
        kind: "item",
        phase: "updated",
        title: "Deprecation notice",
        detail: shorten(detail)
      });
    }
    case "thread/started":
    case "thread/archived":
    case "thread/unarchived":
    case "thread/closed":
      return eventBase(context, method, params, {
        kind: "status",
        phase:
          method === "thread/started" ? "started"
          : method === "thread/archived" || method === "thread/closed" ? "completed"
          : "updated",
        title:
          method === "thread/started" ? "Thread started"
          : method === "thread/archived" ? "Thread archived"
          : method === "thread/unarchived" ? "Thread unarchived"
          : "Thread closed",
        detail: extractThreadId(params) ?? method
      });
    case "thread/tokenUsage/updated":
      return eventBase(context, method, params, {
        kind: "status",
        phase: "updated",
        title: "Token usage updated",
        detail: "Token usage updated"
      });
    case "thread/status/changed": {
      const status = asRecord(params.status);
      const type = asString(status?.type) ?? "unknown";
      const activeFlags = asStringArray(status?.activeFlags);
      return eventBase(context, method, params, {
        kind: "status",
        phase:
          activeFlags.includes("waitingOnApproval") || activeFlags.includes("waitingOnUserInput")
            ? "waiting"
            : "updated",
        title:
          activeFlags.includes("waitingOnApproval") ? "Waiting on approval"
          : activeFlags.includes("waitingOnUserInput") ? "Waiting on input"
          : `Thread ${type}`,
        detail: activeFlags.length > 0 ? activeFlags.join(", ") : type
      });
    }
    case "turn/started": {
      const turn = asRecord(params.turn);
      const turnId = extractTurnId(turn ?? params);
      return eventBase(context, method, params, {
        turnId,
        kind: "turn",
        phase: "started",
        title: "Turn started",
        detail: turnId ?? method
      });
    }
    case "turn/completed": {
      const turn = asRecord(params.turn);
      const turnId = extractTurnId(turn ?? params);
      const turnStatus = asString(turn?.status) ?? "completed";
      const phase =
        turnStatus === "failed" ? "failed"
        : turnStatus === "interrupted" ? "interrupted"
        : "completed";
      const error = asRecord(turn?.error);
      return eventBase(context, method, params, {
        turnId,
        kind: "turn",
        phase,
        title:
          phase === "failed" ? "Turn failed"
          : phase === "interrupted" ? "Turn interrupted"
          : "Turn completed",
        detail:
          phase === "failed"
            ? shorten(asString(error?.message) ?? turnId ?? method)
            : turnId ?? method
      });
    }
    case "turn/interrupted":
      return eventBase(context, method, params, {
        kind: "turn",
        phase: "interrupted",
        title: "Turn interrupted",
        detail: extractTurnId(params) ?? method
      });
    case "turn/failed":
      return eventBase(context, method, params, {
        kind: "turn",
        phase: "failed",
        title: "Turn failed",
        detail: shorten(asString(params.message) ?? extractTurnId(params) ?? method)
      });
    case "turn/plan/updated":
      return eventBase(context, method, params, {
        kind: "turn",
        phase: "updated",
        title: "Plan updated",
        detail: summarizePlanUpdate(params)
      });
    case "turn/diff/updated":
      return eventBase(context, method, params, {
        kind: "turn",
        phase: "updated",
        title: "Diff updated",
        detail: summarizeDiffUpdate(params)
      });
    case "item/started":
    case "item/completed":
      return buildEventFromItem(context, method, params);
    case "item/agentMessage/delta":
      return eventBase(context, method, params, {
        itemId: extractItemId(params),
        kind: "message",
        phase: "updated",
        title: "Reply updated",
        detail: shorten(asString(params.delta) ?? asString(params.textDelta) ?? "Reply")
      });
    case "item/plan/delta":
      return eventBase(context, method, params, {
        itemId: extractItemId(params),
        kind: "turn",
        phase: "updated",
        title: "Plan streaming",
        detail: shorten(asString(params.delta) ?? asString(params.textDelta) ?? "Plan")
      });
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/summaryPartAdded":
    case "item/reasoning/textDelta":
      return eventBase(context, method, params, {
        itemId: extractItemId(params),
        kind: "message",
        phase: "updated",
        title: "Reasoning updated",
        detail: shorten(asString(params.delta) ?? asString(params.textDelta) ?? "Reasoning")
      });
    case "item/commandExecution/outputDelta":
      return eventBase(context, method, params, {
        itemId: extractItemId(params),
        kind: "command",
        phase: "updated",
        title: "Command output",
        detail: shorten(asString(params.delta) ?? asString(params.textDelta) ?? "Command output")
      });
    case "item/commandExecution/terminalInteraction":
      return eventBase(context, method, params, {
        itemId: extractItemId(params),
        kind: "command",
        phase: "updated",
        title: "Terminal input",
        detail: shorten(asString(params.stdin) ?? "Terminal input"),
        command: asString(params.stdin)
      });
    case "item/fileChange/outputDelta":
      return eventBase(context, method, params, {
        itemId: extractItemId(params),
        kind: "fileChange",
        phase: "updated",
        title: "Patch updated",
        detail: shorten(asString(params.delta) ?? asString(params.textDelta) ?? "Patch output")
      });
    case "item/fileChange/patchUpdated": {
      const change = summarizeFileChange({ changes: params.changes }, primaryPath(params));
      return eventBase(context, method, params, {
        itemId: extractItemId(params),
        kind: "fileChange",
        phase: "updated",
        title: "Patch updated",
        detail: change.detail,
        path: change.path,
        action: change.action,
        isImage: change.isImage,
        linesAdded: change.linesAdded,
        linesRemoved: change.linesRemoved
      });
    }
    case "item/mcpToolCall/progress":
      return eventBase(context, method, params, {
        itemId: extractItemId(params),
        itemType: "mcpToolCall",
        kind: "tool",
        phase: "updated",
        title: "MCP tool progress",
        detail: shorten(asString(params.message) ?? "MCP tool progress")
      });
    case "hook/started":
    case "hook/completed":
      return eventBase(context, method, params, {
        itemType: "hook",
        kind: "tool",
        phase: method === "hook/completed" ? "completed" : "started",
        title: method === "hook/completed" ? "Hook completed" : "Hook started",
        detail: summarizeHookRun(params),
        path: primaryPath(params.run)
      });
    case "item/autoApprovalReview/started":
    case "item/autoApprovalReview/completed": {
      const review = asRecord(params.review);
      const actionDetail = summarizeGuardianAction(params.action);
      const riskLevel = asString(review?.riskLevel);
      return eventBase(context, method, params, {
        itemId: extractItemId(params),
        kind: "item",
        phase: method.endsWith("/completed") ? "completed" : "started",
        title: method.endsWith("/completed") ? "Approval review completed" : "Approval review started",
        detail: shorten(riskLevel ? `${actionDetail} (${riskLevel})` : actionDetail)
      });
    }
    case "item/commandExecution/requestApproval": {
      const networkApprovalContext = asRecord(params.networkApprovalContext) ?? null;
      return eventBase(context, method, params, {
        requestId,
        itemId: extractItemId(params),
        kind: "approval",
        phase: "waiting",
        title: networkApprovalContext ? "Network approval requested" : "Command approval requested",
        detail: shorten(asString(params.command) ?? asString(params.reason) ?? "Approval requested"),
        command: asString(params.command),
        cwd: asString(params.cwd),
        reason: asString(params.reason),
        availableDecisions: asStringArray(params.availableDecisions),
        networkApprovalContext
      });
    }
    case "item/fileChange/requestApproval":
      return eventBase(context, method, params, {
        requestId,
        itemId: extractItemId(params),
        kind: "approval",
        phase: "waiting",
        title: "File approval requested",
        detail: shorten(asString(params.reason) ?? primaryPath(params) ?? "Approval requested"),
        reason: asString(params.reason),
        grantRoot: asString(params.grantRoot),
        availableDecisions: asStringArray(params.availableDecisions)
      });
    case "item/permissions/requestApproval":
      return eventBase(context, method, params, {
        requestId,
        itemId: extractItemId(params),
        kind: "approval",
        phase: "waiting",
        title: "Permission approval requested",
        detail: shorten(asString(params.reason) ?? "Permission approval requested"),
        cwd: asString(params.cwd),
        reason: asString(params.reason),
        availableDecisions: ["accept", "acceptForSession"]
      });
    case "item/tool/requestUserInput":
      return eventBase(context, method, params, {
        requestId,
        itemId: extractItemId(params),
        kind: "input",
        phase: "waiting",
        title: "User input requested",
        detail: shorten(asString(params.reason) ?? asString(params.prompt) ?? "Needs input"),
        reason: asString(params.reason),
        availableDecisions: asStringArray(params.availableDecisions)
      });
    case "mcpServer/elicitation/request":
      return eventBase(context, method, params, {
        requestId,
        kind: "input",
        phase: "waiting",
        title: "MCP input requested",
        detail: shorten(asString(params.message) ?? "MCP server needs input"),
        reason: asString(params.message)
      });
    case "applyPatchApproval":
      return eventBase(context, method, params, {
        requestId,
        kind: "approval",
        phase: "waiting",
        title: "Patch approval requested",
        detail: shorten(asString(params.reason) ?? primaryPath(params) ?? "Patch approval requested"),
        reason: asString(params.reason),
        grantRoot: asString(params.grantRoot),
        availableDecisions: ["accept", "acceptForSession", "decline", "cancel"]
      });
    case "execCommandApproval": {
      const command = Array.isArray(params.command)
        ? params.command.filter((entry): entry is string => typeof entry === "string").join(" ")
        : undefined;
      return eventBase(context, method, params, {
        requestId,
        kind: "approval",
        phase: "waiting",
        title: "Command approval requested",
        detail: shorten(command ?? asString(params.reason) ?? "Command approval requested"),
        command,
        cwd: asString(params.cwd),
        reason: asString(params.reason),
        availableDecisions: ["accept", "acceptForSession", "decline", "cancel"]
      });
    }
    case "item/tool/call":
      return eventBase(context, method, params, {
        requestId,
        itemId: extractItemId(params),
        itemType: "dynamicToolCall",
        kind: "tool",
        phase: "started",
        title: "Tool call requested",
        detail: shorten(summarizeDynamicTool(params))
      });
    case "rawResponseItem/completed": {
      const item = asRecord(params.item);
      return eventBase(context, method, params, {
        itemId: extractItemId(item ?? params),
        itemType: asString(item?.type) ?? "responseItem",
        kind: "item",
        phase: "completed",
        title: "Response item completed",
        detail: summarizeRawResponseItem(item)
      });
    }
    case "model/rerouted":
      return eventBase(context, method, params, {
        kind: "item",
        phase: "updated",
        title: "Model rerouted",
        detail: shorten(`${asString(params.fromModel) ?? "model"} -> ${asString(params.toModel) ?? "model"}`)
      });
    case "model/verification":
      return eventBase(context, method, params, {
        kind: "item",
        phase: "updated",
        title: "Model verification",
        detail: asStringArray(params.verifications).join(", ") || "Model verification"
      });
    case "mcpServer/startupStatus/updated": {
      const status = asString(params.status) ?? "updated";
      return eventBase(context, method, params, {
        kind: "tool",
        phase:
          status === "failed" || status === "cancelled" ? "failed"
          : status === "ready" ? "completed"
          : "started",
        title:
          status === "failed" ? "MCP server failed"
          : status === "ready" ? "MCP server ready"
          : "MCP server starting",
        detail: shorten(asString(params.error) ?? asString(params.name) ?? status)
      });
    }
    case "mcpServer/oauthLogin/completed": {
      const success = params.success === true;
      return eventBase(context, method, params, {
        kind: "tool",
        phase: success ? "completed" : "failed",
        title: success ? "MCP login completed" : "MCP login failed",
        detail: shorten(asString(params.error) ?? asString(params.name) ?? "MCP OAuth")
      });
    }
    case "account/rateLimits/updated":
      return eventBase(context, method, params, {
        kind: "status",
        phase: "updated",
        title: "Rate limits updated",
        detail: rateLimitDetail(params)
      });
    case "windows/worldWritableWarning": {
      const sampleCount = Array.isArray(params.samplePaths) ? params.samplePaths.length : 0;
      const extraCount = typeof params.extraCount === "number" && Number.isFinite(params.extraCount) ? params.extraCount : 0;
      return eventBase(context, method, params, {
        kind: "item",
        phase: "failed",
        title: "Windows permission warning",
        detail: `${sampleCount + extraCount} world-writable path${sampleCount + extraCount === 1 ? "" : "s"} found`
      });
    }
    case "windowsSandbox/setupCompleted": {
      const success = params.success === true;
      return eventBase(context, method, params, {
        kind: "item",
        phase: success ? "completed" : "failed",
        title: success ? "Windows sandbox ready" : "Windows sandbox failed",
        detail: shorten(asString(params.error) ?? asString(params.mode) ?? "Windows sandbox setup")
      });
    }
    case "serverRequest/resolved": {
      const pending = context.pendingRequest ?? null;
      const resolvedRequestId = asString(params.requestId) ?? requestId;
      if (pending) {
        return eventBase(context, method, params, {
          requestId: resolvedRequestId ?? pending.requestId,
          threadId: pending.threadId,
          turnId: pending.turnId,
          itemId: pending.itemId,
          kind: pending.kind === "approval" ? "approval" : "input",
          phase: "completed",
          title: pending.kind === "approval" ? "Approval resolved" : "Input resolved",
          detail: pending.reason ?? pending.command ?? pending.kind
        });
      }
      return eventBase(context, method, params, {
        requestId: resolvedRequestId,
        kind: "other",
        phase: "completed",
        title: "Request resolved",
        detail: resolvedRequestId ?? method
      });
    }
    default:
      return null;
  }
}

export function appServerDiagnosticNotePrefix(method: string): string {
  switch (method) {
    case "error":
      return "Codex app-server error:";
    case "warning":
      return "Codex warning:";
    case "guardianWarning":
      return "Codex guardian warning:";
    case "configWarning":
      return "Codex config warning:";
    case "deprecationNotice":
      return "Codex deprecation notice:";
    case "mcpServer/startupStatus/updated":
      return "Codex MCP server status:";
    case "mcpServer/oauthLogin/completed":
      return "Codex MCP login:";
    case "account/rateLimits/updated":
      return "Codex rate limit:";
    case "windows/worldWritableWarning":
      return "Codex Windows permission warning:";
    case "windowsSandbox/setupCompleted":
      return "Codex Windows sandbox:";
    default:
      return `Codex ${method}:`;
  }
}

export function buildAppServerDiagnosticNote(message: AppServerNotification): string | null {
  const params = asRecord(message.params) ?? {};
  const prefix = appServerDiagnosticNotePrefix(message.method);
  switch (message.method) {
    case "error": {
      const detail = diagnosticMessage(params, "message", "error") || "Unknown app-server error";
      return `${prefix} ${shorten(detail, 160)}`;
    }
    case "warning": {
      const detail = diagnosticMessage(params, "message") || "Warning";
      return `${prefix} ${shorten(detail, 160)}`;
    }
    case "guardianWarning": {
      const detail = diagnosticMessage(params, "message") || "Guardian warning";
      return `${prefix} ${shorten(detail, 160)}`;
    }
    case "configWarning": {
      const summary = diagnosticMessage(params, "summary") || "Configuration warning";
      const details = diagnosticMessage(params, "details");
      return `${prefix} ${shorten(details ? `${summary}: ${details}` : summary, 160)}`;
    }
    case "deprecationNotice": {
      const summary = diagnosticMessage(params, "summary") || "Deprecation notice";
      const details = diagnosticMessage(params, "details");
      return `${prefix} ${shorten(details ? `${summary}: ${details}` : summary, 160)}`;
    }
    case "mcpServer/startupStatus/updated": {
      const status = asString(params.status);
      if (status !== "failed" && status !== "cancelled") {
        return null;
      }
      const name = asString(params.name) ?? "MCP server";
      const error = asString(params.error);
      return `${prefix} ${shorten(error ? `${name} ${status}: ${error}` : `${name} ${status}`, 160)}`;
    }
    case "mcpServer/oauthLogin/completed": {
      if (params.success === true) {
        return null;
      }
      const name = asString(params.name) ?? "MCP server";
      const error = asString(params.error);
      return `${prefix} ${shorten(error ? `${name}: ${error}` : `${name} failed`, 160)}`;
    }
    case "account/rateLimits/updated": {
      const detail = rateLimitDetail(params);
      return detail === "Rate limits updated" ? null : `${prefix} ${shorten(detail, 160)}`;
    }
    case "windows/worldWritableWarning": {
      const sampleCount = Array.isArray(params.samplePaths) ? params.samplePaths.length : 0;
      const extraCount = typeof params.extraCount === "number" && Number.isFinite(params.extraCount) ? params.extraCount : 0;
      if (sampleCount + extraCount <= 0 && params.failedScan !== true) {
        return null;
      }
      const scanDetail = params.failedScan === true ? " scan incomplete" : "";
      return `${prefix} ${sampleCount + extraCount} world-writable path${sampleCount + extraCount === 1 ? "" : "s"} found${scanDetail}`;
    }
    case "windowsSandbox/setupCompleted": {
      if (params.success === true) {
        return null;
      }
      return `${prefix} ${shorten(asString(params.error) ?? "setup failed", 160)}`;
    }
    default:
      return null;
  }
}

export function buildNeedsUserStateFromServerRequest(message: AppServerServerRequest): PendingUserRequest | null {
  const params = asRecord(message.params) ?? {};
  const threadId = extractThreadId(params);
  if (!threadId) {
    return null;
  }

  const requestId = String(message.id);
  if (message.method === "item/commandExecution/requestApproval") {
    return {
      kind: "approval",
      requestId,
      threadId,
      createdAt: new Date().toISOString(),
      requestMethod: message.method,
      responseKind: "approvalDecision",
      turnId: extractTurnId(params),
      itemId: extractItemId(params),
      reason: asString(params.reason),
      command: asString(params.command),
      cwd: asString(params.cwd),
      availableDecisions: asStringArray(params.availableDecisions),
      networkApprovalContext: asRecord(params.networkApprovalContext) ?? null
    };
  }

  if (message.method === "item/fileChange/requestApproval") {
    return {
      kind: "approval",
      requestId,
      threadId,
      createdAt: new Date().toISOString(),
      requestMethod: message.method,
      responseKind: "approvalDecision",
      turnId: extractTurnId(params),
      itemId: extractItemId(params),
      reason: asString(params.reason),
      grantRoot: asString(params.grantRoot),
      availableDecisions: asStringArray(params.availableDecisions)
    };
  }

  if (message.method === "item/tool/requestUserInput") {
    return {
      kind: "input",
      requestId,
      threadId,
      createdAt: new Date().toISOString(),
      requestMethod: message.method,
      responseKind: "toolInput",
      turnId: extractTurnId(params),
      itemId: extractItemId(params),
      reason: asString(params.reason) ?? asString(params.prompt),
      questions: asNeedsUserQuestions(params.questions),
      availableDecisions: asStringArray(params.availableDecisions)
    };
  }

  if (message.method === "mcpServer/elicitation/request") {
    const schema = asRecord(params.requestedSchema);
    return {
      kind: "input",
      requestId,
      threadId,
      createdAt: new Date().toISOString(),
      requestMethod: message.method,
      responseKind: "mcpElicitation",
      turnId: extractTurnId(params),
      reason: asString(params.message),
      questions: parseMcpElicitationQuestions(schema),
      requestedSchema: schema
    };
  }

  if (message.method === "item/permissions/requestApproval") {
    return {
      kind: "approval",
      requestId,
      threadId,
      createdAt: new Date().toISOString(),
      requestMethod: message.method,
      responseKind: "permissionsApproval",
      turnId: extractTurnId(params),
      itemId: extractItemId(params),
      reason: asString(params.reason),
      cwd: asString(params.cwd),
      availableDecisions: ["accept", "acceptForSession"],
      requestedPermissions: asRecord(params.permissions)
    };
  }

  if (message.method === "applyPatchApproval") {
    return {
      kind: "approval",
      requestId,
      threadId,
      createdAt: new Date().toISOString(),
      requestMethod: message.method,
      responseKind: "legacyReview",
      reason: asString(params.reason),
      grantRoot: asString(params.grantRoot),
      availableDecisions: ["accept", "acceptForSession", "decline", "cancel"]
    };
  }

  if (message.method === "execCommandApproval") {
    const command = Array.isArray(params.command)
      ? params.command.filter((entry): entry is string => typeof entry === "string").join(" ")
      : undefined;
    return {
      kind: "approval",
      requestId,
      threadId,
      createdAt: new Date().toISOString(),
      requestMethod: message.method,
      responseKind: "legacyReview",
      reason: asString(params.reason),
      command,
      cwd: asString(params.cwd),
      availableDecisions: ["accept", "acceptForSession", "decline", "cancel"]
    };
  }

  return null;
}

export function shouldStopDormantThreadAfterAppServerNotification(input: {
  method: string;
  statusType?: string | null;
  wasOngoing: boolean;
}): boolean {
  return shouldStopDormantThreadAfterNotification(input);
}
