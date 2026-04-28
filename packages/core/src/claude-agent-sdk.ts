import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type {
  HookCallbackMatcher,
  HookEvent,
  HookInput,
  SDKSessionInfo,
  SessionMessage,
  SyncHookJSONOutput
} from "@anthropic-ai/claude-agent-sdk";
import { getProjectStoragePath, resolveReadableProjectStoragePath } from "./project-storage";
import type { NeedsUserQuestion } from "./types";

const nativeImport = new Function("specifier", "return import(specifier);") as <T>(specifier: string) => Promise<T>;
const CLAUDE_SDK_HOOK_EVENTS: HookEvent[] = [
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PostToolBatch",
  "Notification",
  "UserPromptSubmit",
  "UserPromptExpansion",
  "SessionStart",
  "SessionEnd",
  "Stop",
  "StopFailure",
  "SubagentStart",
  "SubagentStop",
  "PreCompact",
  "PostCompact",
  "PermissionRequest",
  "PermissionDenied",
  "Setup",
  "TeammateIdle",
  "TaskCreated",
  "TaskCompleted",
  "Elicitation",
  "ElicitationResult",
  "ConfigChange",
  "WorktreeCreate",
  "WorktreeRemove",
  "InstructionsLoaded",
  "CwdChanged",
  "FileChanged"
];
const CLAUDE_HOOK_RESPONSE_POLL_INTERVAL_MS = 100;

interface ClaudeHookPermissionResponseRecord {
  kind: "approval";
  requestId: string;
  decision: "accept" | "decline";
  updatedAt: string;
}

interface ClaudeHookInputResponseRecord {
  kind: "input";
  requestId: string;
  action: "accept" | "decline" | "cancel";
  content: Record<string, unknown>;
  updatedAt: string;
}

type ClaudeHookResponseRecord = ClaudeHookPermissionResponseRecord | ClaudeHookInputResponseRecord;

type ClaudeAgentSdkModule = {
  getSessionMessages: (
    sessionId: string,
    options?: {
      dir?: string;
      limit?: number;
      offset?: number;
    }
  ) => Promise<SessionMessage[]>;
  listSessions: (options?: {
    dir?: string;
    limit?: number;
    offset?: number;
    includeWorktrees?: boolean;
  }) => Promise<SDKSessionInfo[]>;
};

let claudeAgentSdkPromise: Promise<ClaudeAgentSdkModule | null> | null = null;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value ? (value as Record<string, unknown>) : null;
}

function buildClaudeHookRequestId(sessionId: string, eventName: HookEvent, hookInput: HookInput, timestamp: string): string {
  const hookInputRecord = hookInput as Record<string, unknown>;
  const rawRequestId =
    typeof hookInputRecord.request_id === "string" ? hookInputRecord.request_id
    : typeof hookInputRecord.requestId === "string" ? hookInputRecord.requestId
    : typeof hookInputRecord.elicitation_id === "string" ? hookInputRecord.elicitation_id
    : null;
  const requestId = typeof rawRequestId === "string" ? rawRequestId : null;
  return requestId && requestId.trim().length > 0
    ? requestId
    : `${sessionId}:${eventName}:${timestamp}`;
}

function encodeClaudeHookRequestId(requestId: string): string {
  return Buffer.from(requestId, "utf8").toString("base64url");
}

function claudeHookResponsesDir(projectRoot: string, sessionId: string): string {
  return getProjectStoragePath(projectRoot, "claude-hook-responses", sessionId);
}

function claudeHookResponseFilePath(projectRoot: string, sessionId: string, requestId: string): string {
  return join(claudeHookResponsesDir(projectRoot, sessionId), `${encodeClaudeHookRequestId(requestId)}.json`);
}

async function waitForClaudeHookResponse(
  projectRoot: string,
  sessionId: string,
  requestId: string,
  signal?: AbortSignal
): Promise<ClaudeHookResponseRecord | null> {
  const filePath = claudeHookResponseFilePath(projectRoot, sessionId, requestId);
  while (!signal?.aborted) {
    const raw = await readFile(filePath, "utf8").catch(() => null);
    if (typeof raw === "string") {
      await rm(filePath, { force: true }).catch(() => undefined);
      const parsed = asRecord(JSON.parse(raw));
      if (!parsed || typeof parsed.kind !== "string" || typeof parsed.requestId !== "string") {
        return null;
      }
      if (parsed.kind === "approval" && (parsed.decision === "accept" || parsed.decision === "decline")) {
        return {
          kind: "approval",
          requestId: parsed.requestId,
          decision: parsed.decision,
          updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString()
        };
      }
      if (
        parsed.kind === "input"
        && (parsed.action === "accept" || parsed.action === "decline" || parsed.action === "cancel")
        && asRecord(parsed.content)
      ) {
        return {
          kind: "input",
          requestId: parsed.requestId,
          action: parsed.action,
          content: asRecord(parsed.content) ?? {},
          updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString()
        };
      }
      return null;
    }

    await new Promise((resolve) => {
      const timer = setTimeout(resolve, CLAUDE_HOOK_RESPONSE_POLL_INTERVAL_MS);
      if (signal) {
        const onAbort = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", onAbort);
          resolve(undefined);
        };
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }

  return null;
}

function firstAnswerValue(questionId: string, answers: Record<string, { answers: string[] }>): string | null {
  const entry = answers[questionId];
  if (!entry || !Array.isArray(entry.answers)) {
    return null;
  }
  const value = entry.answers.find((candidate) => typeof candidate === "string" && candidate.trim().length > 0) ?? null;
  return value ? value.trim() : null;
}

function normalizeClaudeHookInputContent(
  questions: NeedsUserQuestion[],
  answers: Record<string, { answers: string[] }>
): Record<string, unknown> {
  const content: Record<string, unknown> = {};
  for (const question of questions) {
    const value = firstAnswerValue(question.id, answers);
    if (!value) {
      if (question.required === false) {
        continue;
      }
      throw new Error(`Question ${question.header} is still unanswered.`);
    }
    content[question.id] = value;
  }
  return content;
}

function watchPathsHookOutput(input: HookInput, watchPaths: string[]): SyncHookJSONOutput | null {
  if (watchPaths.length === 0) {
    return null;
  }

  if (input.hook_event_name === "SessionStart") {
    return {
      continue: true,
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        watchPaths
      }
    };
  }

  if (input.hook_event_name === "CwdChanged") {
    return {
      continue: true,
      hookSpecificOutput: {
        hookEventName: "CwdChanged",
        watchPaths
      }
    };
  }

  if (input.hook_event_name === "FileChanged") {
    return {
      continue: true,
      hookSpecificOutput: {
        hookEventName: "FileChanged",
        watchPaths
      }
    };
  }

  return null;
}

function extractSdkMessageTimestamp(message: Record<string, unknown>): string | null {
  for (const key of ["timestamp", "created_at", "createdAt"]) {
    const value = message[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

function normalizeClaudeSdkMessage(
  entry: SessionMessage,
  sessionInfo: Pick<SDKSessionInfo, "cwd" | "gitBranch">
): Record<string, unknown> {
  const entryRecord = asRecord(entry);
  const rawMessage = asRecord(entry.message);
  const message =
    rawMessage
    ?? (typeof entry.message === "string" ? { content: entry.message } : { content: [] });
  const timestamp =
    extractSdkMessageTimestamp(entryRecord ?? {})
    ?? extractSdkMessageTimestamp(message);
  return {
    type: entry.type,
    uuid: entry.uuid,
    session_id: entry.session_id,
    parent_tool_use_id: entry.parent_tool_use_id,
    cwd: sessionInfo.cwd,
    gitBranch: sessionInfo.gitBranch,
    ...(timestamp ? { timestamp } : {}),
    message
  };
}

export function normalizeClaudeSdkMessageForTest(
  entry: SessionMessage,
  sessionInfo: Pick<SDKSessionInfo, "cwd" | "gitBranch">
): Record<string, unknown> {
  return normalizeClaudeSdkMessage(entry, sessionInfo);
}

export function claudeHooksFilePath(projectRoot: string, sessionId: string): string {
  return getProjectStoragePath(projectRoot, "claude-hooks", `${sessionId}.jsonl`);
}

export async function resolveReadableClaudeHooksFilePath(projectRoot: string, sessionId: string): Promise<string> {
  return resolveReadableProjectStoragePath(projectRoot, "claude-hooks", `${sessionId}.jsonl`);
}

export async function respondToClaudeHookPermissionRequest(
  projectRoot: string,
  sessionId: string,
  requestId: string,
  decision: "accept" | "decline"
): Promise<void> {
  const updatedAt = new Date().toISOString();
  await mkdir(claudeHookResponsesDir(projectRoot, sessionId), { recursive: true });
  await writeFile(
    claudeHookResponseFilePath(projectRoot, sessionId, requestId),
    `${JSON.stringify({
      kind: "approval",
      requestId,
      decision,
      updatedAt
    } satisfies ClaudeHookPermissionResponseRecord)}\n`,
    "utf8"
  );
  await appendClaudeHookSidecarRecord(projectRoot, sessionId, {
    hook_event_name: "AgentsOfficePermissionDecision",
    hook_source: "agents-office",
    request_id: requestId,
    action: decision,
    timestamp: updatedAt
  });
}

export async function respondToClaudeHookInputRequest(
  projectRoot: string,
  sessionId: string,
  requestId: string,
  questions: NeedsUserQuestion[],
  answers: Record<string, { answers: string[] }>
): Promise<void> {
  const updatedAt = new Date().toISOString();
  const content = normalizeClaudeHookInputContent(questions, answers);
  await mkdir(claudeHookResponsesDir(projectRoot, sessionId), { recursive: true });
  await writeFile(
    claudeHookResponseFilePath(projectRoot, sessionId, requestId),
    `${JSON.stringify({
      kind: "input",
      requestId,
      action: "accept",
      content,
      updatedAt
    } satisfies ClaudeHookInputResponseRecord)}\n`,
    "utf8"
  );
  await appendClaudeHookSidecarRecord(projectRoot, sessionId, {
    hook_event_name: "AgentsOfficeElicitationResponse",
    hook_source: "agents-office",
    request_id: requestId,
    action: "accept",
    content,
    timestamp: updatedAt
  });
}

export async function loadClaudeAgentSdk(): Promise<ClaudeAgentSdkModule | null> {
  if (!claudeAgentSdkPromise) {
    claudeAgentSdkPromise = nativeImport<ClaudeAgentSdkModule>("@anthropic-ai/claude-agent-sdk").catch(() => null);
  }
  return claudeAgentSdkPromise;
}

export async function listClaudeSdkSessions(input: {
  dir?: string;
  limit?: number;
  offset?: number;
  includeWorktrees?: boolean;
} = {}): Promise<SDKSessionInfo[] | null> {
  const sdk = await loadClaudeAgentSdk();
  if (!sdk) {
    return null;
  }

  try {
    return await sdk.listSessions(input);
  } catch {
    return null;
  }
}

export async function getClaudeSdkSessionRecords(input: {
  sessionId: string;
  dir?: string;
  cwd?: string;
  gitBranch?: string;
  limit?: number;
  offset?: number;
}): Promise<Array<Record<string, unknown>> | null> {
  const sdk = await loadClaudeAgentSdk();
  if (!sdk) {
    return null;
  }

  try {
    const messages = await sdk.getSessionMessages(input.sessionId, {
      dir: input.dir,
      ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
      offset: input.offset
    });
    return messages.map((entry) => normalizeClaudeSdkMessage(entry, {
      cwd: input.cwd,
      gitBranch: input.gitBranch
    }));
  } catch {
    return null;
  }
}

export async function appendClaudeHookSidecarRecord(
  projectRoot: string,
  sessionId: string,
  record: Record<string, unknown>
): Promise<void> {
  const path = claudeHooksFilePath(projectRoot, sessionId);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
}

export function createClaudeSdkSidecarHooks(input: {
  projectRoot: string;
  watchPaths?: string[];
  onRecord?: (record: Record<string, unknown>) => void | Promise<void>;
}): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  const watchPaths = Array.from(new Set((input.watchPaths ?? []).filter((value) => value.trim().length > 0)));

  const buildHookCallback = (eventName: HookEvent): HookCallbackMatcher => ({
    hooks: [
      async (hookInput, toolUseID, options) => {
        const timestamp = new Date().toISOString();
        const requestId =
          eventName === "PermissionRequest" || eventName === "Elicitation"
            ? buildClaudeHookRequestId(hookInput.session_id, eventName, hookInput, timestamp)
            : undefined;
        const record = JSON.parse(JSON.stringify({
          ...hookInput,
          hook_event_name: eventName,
          timestamp,
          tool_use_id: toolUseID ?? undefined,
          hook_source: "claude-agent-sdk",
          request_id: requestId
        })) as Record<string, unknown>;
        await appendClaudeHookSidecarRecord(input.projectRoot, hookInput.session_id, record);
        await input.onRecord?.(record);
        if (eventName === "PermissionRequest" && requestId) {
          const response = await waitForClaudeHookResponse(input.projectRoot, hookInput.session_id, requestId, options?.signal);
          if (response?.kind === "approval") {
            return {
              continue: true,
              hookSpecificOutput: {
                hookEventName: "PermissionRequest",
                decision:
                  response.decision === "accept"
                    ? { behavior: "allow" }
                    : { behavior: "deny" }
              }
            } satisfies SyncHookJSONOutput;
          }
        }
        if (eventName === "Elicitation" && requestId) {
          const response = await waitForClaudeHookResponse(input.projectRoot, hookInput.session_id, requestId, options?.signal);
          if (response?.kind === "input") {
            return {
              continue: true,
              hookSpecificOutput: {
                hookEventName: "Elicitation",
                action: response.action,
                content: response.content
              }
            } satisfies SyncHookJSONOutput;
          }
        }
        return watchPathsHookOutput(hookInput, watchPaths) ?? { continue: true };
      }
    ]
  });

  return Object.fromEntries(
    CLAUDE_SDK_HOOK_EVENTS.map((eventName) => [eventName, [buildHookCallback(eventName)]])
  );
}
