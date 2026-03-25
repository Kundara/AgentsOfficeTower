import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import type {
  HookCallbackMatcher,
  HookEvent,
  HookInput,
  SDKSessionInfo,
  SessionMessage,
  SyncHookJSONOutput
} from "@anthropic-ai/claude-agent-sdk";

const nativeImport = new Function("specifier", "return import(specifier);") as <T>(specifier: string) => Promise<T>;
const CLAUDE_SDK_HOOK_EVENTS: HookEvent[] = [
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "Notification",
  "UserPromptSubmit",
  "SessionStart",
  "SessionEnd",
  "Stop",
  "StopFailure",
  "SubagentStart",
  "SubagentStop",
  "PreCompact",
  "PostCompact",
  "PermissionRequest",
  "Setup",
  "TeammateIdle",
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
const CLAUDE_SDK_MESSAGE_LIMIT = 200;

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
  return join(projectRoot, ".codex-agents", "claude-hooks", `${sessionId}.jsonl`);
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
      limit: input.limit ?? CLAUDE_SDK_MESSAGE_LIMIT,
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
  await mkdir(join(projectRoot, ".codex-agents", "claude-hooks"), { recursive: true });
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
      async (hookInput, toolUseID) => {
        const record = JSON.parse(JSON.stringify({
          ...hookInput,
          hook_event_name: eventName,
          timestamp: new Date().toISOString(),
          tool_use_id: toolUseID ?? undefined,
          hook_source: "claude-agent-sdk"
        })) as Record<string, unknown>;
        await appendClaudeHookSidecarRecord(input.projectRoot, hookInput.session_id, record);
        await input.onRecord?.(record);
        return watchPathsHookOutput(hookInput, watchPaths) ?? { continue: true };
      }
    ]
  });

  return Object.fromEntries(
    CLAUDE_SDK_HOOK_EVENTS.map((eventName) => [eventName, [buildHookCallback(eventName)]])
  );
}
