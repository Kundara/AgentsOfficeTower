import type { CodexAppServerClient } from "./app-server";
import { discoverCodexSessionThreads } from "./codex-session-files";
import { filterThreadsForProject } from "./project-paths";
import { selectProjectThreadsWithParents } from "./local-thread-selection";
import type { CodexThread } from "./types";

const APP_SERVER_THREAD_LIST_TIMEOUT_MS = 15000;
const APP_SERVER_THREAD_READ_TIMEOUT_MS = 15000;

export function mergeThreadLists(...threadLists: CodexThread[][]): CodexThread[] {
  const byId = new Map<string, CodexThread>();
  for (const thread of threadLists.flat()) {
    const existing = byId.get(thread.id);
    const liveSessionFallback = thread.turns.some((turn) => turn.id === `session-live-${thread.id}`);
    if (existing && liveSessionFallback) {
      byId.set(thread.id, {
        ...existing,
        status: thread.status,
        updatedAt: Math.max(existing.updatedAt, thread.updatedAt),
        path: thread.path ?? existing.path,
        turns: [
          ...existing.turns.filter((turn) => turn.id !== `session-live-${thread.id}`),
          ...thread.turns
        ]
      });
      continue;
    }
    if (
      !existing
      || thread.updatedAt > existing.updatedAt
      || (
        thread.updatedAt === existing.updatedAt
        && thread.turns.length > existing.turns.length
      )
    ) {
      byId.set(thread.id, existing
        ? {
          ...existing,
          ...thread,
          preview: existing.preview || thread.preview,
          name: existing.name ?? thread.name,
          source: existing.source ?? thread.source,
          gitInfo: existing.gitInfo ?? thread.gitInfo
        }
        : thread);
    }
  }
  return [...byId.values()].sort((left, right) => right.updatedAt - left.updatedAt);
}

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

export async function listCodexProjectThreadCandidates(input: {
  client: CodexAppServerClient;
  projectRoot: string;
  localLimit: number;
  includeSessionThreads?: boolean;
}): Promise<{
  allThreads: CodexThread[];
  projectThreads: CodexThread[];
  trackedThreads: CodexThread[];
  usedUnscopedFallback: boolean;
}> {
  const scopedLimit = Math.max(input.localLimit * 4, 40);
  const scopedThreads = await withTimeout(
    input.client.listThreads({
      cwd: input.projectRoot,
      limit: scopedLimit
    }),
    APP_SERVER_THREAD_LIST_TIMEOUT_MS,
    "thread/list"
  );
  const sessionThreads = input.includeSessionThreads === false
    ? []
    : await discoverCodexSessionThreads({
      projectRoot: input.projectRoot,
      maxFiles: Math.max(scopedLimit * 3, 120)
    });
  const scopedAllThreads = mergeThreadLists(scopedThreads, sessionThreads);
  const scopedProjectThreads = filterThreadsForProject(input.projectRoot, scopedAllThreads);
  const scopedTrackedThreads = selectProjectThreadsWithParents(input.projectRoot, scopedAllThreads, input.localLimit);
  if (scopedTrackedThreads.length > 0) {
    return {
      allThreads: scopedAllThreads,
      projectThreads: scopedProjectThreads,
      trackedThreads: scopedTrackedThreads,
      usedUnscopedFallback: false
    };
  }

  const unscopedThreads = await withTimeout(
    input.client.listThreads({
      limit: Math.max(input.localLimit * 8, 100)
    }),
    APP_SERVER_THREAD_LIST_TIMEOUT_MS,
    "thread/list fallback"
  );
  const fallbackAllThreads = mergeThreadLists(unscopedThreads, sessionThreads);
  const fallbackProjectThreads = filterThreadsForProject(input.projectRoot, fallbackAllThreads);
  const fallbackTrackedThreads = selectProjectThreadsWithParents(input.projectRoot, fallbackAllThreads, input.localLimit);
  if (fallbackTrackedThreads.length === 0) {
    return {
      allThreads: scopedAllThreads,
      projectThreads: scopedProjectThreads,
      trackedThreads: scopedTrackedThreads,
      usedUnscopedFallback: false
    };
  }

  return {
    allThreads: fallbackAllThreads,
    projectThreads: fallbackProjectThreads,
    trackedThreads: fallbackTrackedThreads,
    usedUnscopedFallback: true
  };
}

export async function readCodexThreadWithTimeout(
  client: CodexAppServerClient,
  threadId: string,
  timeoutMs = APP_SERVER_THREAD_READ_TIMEOUT_MS
): Promise<CodexThread> {
  return await withTimeout(
    client.readThread(threadId, { history: "workload" }),
    timeoutMs,
    "thread/read"
  );
}
