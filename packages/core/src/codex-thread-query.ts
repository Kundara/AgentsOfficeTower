import type { CodexAppServerClient } from "./app-server";
import { filterThreadsForProject } from "./project-paths";
import { selectProjectThreadsWithParents } from "./local-thread-selection";
import type { CodexThread } from "./types";

const APP_SERVER_THREAD_LIST_TIMEOUT_MS = 15000;
const APP_SERVER_THREAD_READ_TIMEOUT_MS = 15000;

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
  const scopedProjectThreads = filterThreadsForProject(input.projectRoot, scopedThreads);
  const scopedTrackedThreads = selectProjectThreadsWithParents(input.projectRoot, scopedThreads, input.localLimit);
  if (scopedTrackedThreads.length > 0) {
    return {
      allThreads: scopedThreads,
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
  const fallbackProjectThreads = filterThreadsForProject(input.projectRoot, unscopedThreads);
  const fallbackTrackedThreads = selectProjectThreadsWithParents(input.projectRoot, unscopedThreads, input.localLimit);
  if (fallbackTrackedThreads.length === 0) {
    return {
      allThreads: scopedThreads,
      projectThreads: scopedProjectThreads,
      trackedThreads: scopedTrackedThreads,
      usedUnscopedFallback: false
    };
  }

  return {
    allThreads: unscopedThreads,
    projectThreads: fallbackProjectThreads,
    trackedThreads: fallbackTrackedThreads,
    usedUnscopedFallback: true
  };
}

export async function readCodexThreadWithTimeout(
  client: CodexAppServerClient,
  threadId: string
): Promise<CodexThread> {
  return await withTimeout(
    client.readThread(threadId),
    APP_SERVER_THREAD_READ_TIMEOUT_MS,
    "thread/read"
  );
}
