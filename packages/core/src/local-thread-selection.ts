import { filterThreadsForProject } from "./project-paths";
import { parentThreadIdForThread } from "./snapshot-lib/thread-summary";
import type { CodexThread } from "./types";

function prioritizedProjectThreads(projectThreads: CodexThread[], localLimit: number): CodexThread[] {
  const activeThreads = projectThreads.filter((thread) => thread.status.type === "active");
  const activeIds = new Set(activeThreads.map((thread) => thread.id));
  const remainingThreads = projectThreads.filter((thread) => !activeIds.has(thread.id));

  return [
    ...activeThreads,
    ...remainingThreads.slice(0, Math.max(localLimit - activeThreads.length, 0))
  ];
}

function childThreadsByParent(threads: CodexThread[]): Map<string, CodexThread[]> {
  const byParent = new Map<string, CodexThread[]>();
  for (const thread of threads) {
    const parentThreadId = parentThreadIdForThread(thread);
    if (!parentThreadId) {
      continue;
    }
    const children = byParent.get(parentThreadId) ?? [];
    children.push(thread);
    byParent.set(parentThreadId, children);
  }
  return byParent;
}

export function selectProjectThreadsWithParents(
  projectRoot: string,
  allThreads: CodexThread[],
  localLimit: number
): CodexThread[] {
  const projectThreads = filterThreadsForProject(projectRoot, allThreads);
  const availableThreadsById = new Map(allThreads.map((thread) => [thread.id, thread]));
  const availableChildrenByParent = childThreadsByParent(allThreads);
  const trackedThreads = new Map(
    prioritizedProjectThreads(projectThreads, localLimit).map((thread) => [thread.id, thread])
  );
  const pendingRelatedThreads = [...trackedThreads.values()];

  while (pendingRelatedThreads.length > 0) {
    const thread = pendingRelatedThreads.shift();
    if (!thread) {
      continue;
    }

    const parentThreadId = parentThreadIdForThread(thread);
    if (parentThreadId && !trackedThreads.has(parentThreadId)) {
      const parentThread = availableThreadsById.get(parentThreadId);
      if (parentThread) {
        trackedThreads.set(parentThread.id, parentThread);
        pendingRelatedThreads.push(parentThread);
      }
    }

    const childThreads = availableChildrenByParent.get(thread.id) ?? [];
    for (const childThread of childThreads) {
      if (trackedThreads.has(childThread.id)) {
        continue;
      }
      trackedThreads.set(childThread.id, childThread);
      pendingRelatedThreads.push(childThread);
    }
  }

  return [...trackedThreads.values()];
}
