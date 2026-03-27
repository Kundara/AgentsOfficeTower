import { filterThreadsForProject } from "./project-paths";
import type { CodexThread } from "./types";

function parentThreadIdForThread(thread: CodexThread): string | null {
  if (typeof thread.source === "string") {
    return null;
  }
  const subAgentSource =
    typeof thread.source === "object"
      ? (thread.source as Record<string, unknown>).subAgent
      : null;
  const threadSpawn =
    typeof subAgentSource === "object" && subAgentSource
      ? (subAgentSource as Record<string, unknown>).thread_spawn
      : null;

  return typeof threadSpawn === "object" && threadSpawn
    && typeof (threadSpawn as Record<string, unknown>).parent_thread_id === "string"
    ? ((threadSpawn as Record<string, unknown>).parent_thread_id as string)
    : null;
}

function prioritizedProjectThreads(projectThreads: CodexThread[], localLimit: number): CodexThread[] {
  const activeThreads = projectThreads.filter((thread) => thread.status.type === "active");
  const activeIds = new Set(activeThreads.map((thread) => thread.id));
  const remainingThreads = projectThreads.filter((thread) => !activeIds.has(thread.id));

  return [
    ...activeThreads,
    ...remainingThreads.slice(0, Math.max(localLimit - activeThreads.length, 0))
  ];
}

export function selectProjectThreadsWithParents(
  projectRoot: string,
  allThreads: CodexThread[],
  localLimit: number
): CodexThread[] {
  const projectThreads = filterThreadsForProject(projectRoot, allThreads);
  const availableThreadsById = new Map(allThreads.map((thread) => [thread.id, thread]));
  const trackedThreads = new Map(
    prioritizedProjectThreads(projectThreads, localLimit).map((thread) => [thread.id, thread])
  );
  const pendingParents = [...trackedThreads.values()];

  while (pendingParents.length > 0) {
    const thread = pendingParents.shift();
    if (!thread) {
      continue;
    }
    const parentThreadId = parentThreadIdForThread(thread);
    if (!parentThreadId || trackedThreads.has(parentThreadId)) {
      continue;
    }
    const parentThread = availableThreadsById.get(parentThreadId);
    if (!parentThread) {
      continue;
    }
    trackedThreads.set(parentThread.id, parentThread);
    pendingParents.push(parentThread);
  }

  return [...trackedThreads.values()];
}
