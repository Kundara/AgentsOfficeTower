import { basename } from "node:path";

import { withAppServerClient } from "../app-server";
import {
  listCodexProjectThreadCandidates,
  readCodexThreadWithTimeout
} from "../codex-thread-query";
import { assembleProjectSnapshot } from "../services/snapshot-assembler";
import { ProjectSnapshotCoordinator } from "../services/project-snapshot-coordinator";
import type {
  AgentGoalState,
  CloudTask,
  DashboardSnapshot,
  NeedsUserState,
  SnapshotOptions,
  CodexThread,
  DashboardEvent
} from "../types";

const DEFAULT_LOCAL_THREAD_LIMIT = 24;

export function filterProjectCloudTasks(tasks: CloudTask[], projectRoot: string): CloudTask[] {
  return tasks.filter((task) => {
    const label = task.environmentLabel?.toLowerCase();
    if (!label) {
      return false;
    }
    return label.includes(basename(projectRoot).toLowerCase());
  });
}

async function buildLocalAgents(
  projectRoot: string,
  localLimit: number,
  notes: string[],
  readThreads = true
): Promise<CodexThread[]> {
  try {
    return await withAppServerClient(async (client) => {
      const query = await listCodexProjectThreadCandidates({
        client,
        projectRoot,
        localLimit
      });
      if (query.usedUnscopedFallback) {
        notes.push("Local Codex cwd filter returned no project threads; used unscoped Windows path fallback.");
      }
      const threads = query.trackedThreads;
      if (!readThreads) {
        return threads;
      }
      return Promise.all(threads.map(async (thread) =>
        mergeListedThreadMetadata(
          await readCodexThreadWithTimeout(client, thread.id).catch(() => thread),
          thread
        )
      ));
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notes.push(`Local Codex app-server unavailable: ${message}`);
    return [];
  }
}

function mergeListedThreadMetadata(thread: CodexThread, listedThread: CodexThread): CodexThread {
  return {
    ...thread,
    status: listedThread.status,
    updatedAt: Math.max(thread.updatedAt, listedThread.updatedAt),
    path: listedThread.path ?? thread.path
  };
}

export async function buildDashboardSnapshotFromState(input: {
  projectRoot: string;
  threads: CodexThread[];
  cloudTasks?: CloudTask[];
  events?: DashboardEvent[];
  notes?: string[];
  needsUserByThreadId?: Map<string, NeedsUserState>;
  goalsByThreadId?: Map<string, AgentGoalState>;
  subscribedThreadIds?: Set<string>;
  stoppedAtByThreadId?: Map<string, number>;
  ongoingThreadIds?: Set<string>;
}): Promise<DashboardSnapshot> {
  const coordinator = await createProjectSnapshotCoordinator({
    projectRoot: input.projectRoot,
    includeManagedCloud: input.cloudTasks === undefined
  });
  try {
    const snapshot = await coordinator.buildSnapshot(input);
    if (!snapshot) {
      throw new Error("One-shot snapshot build was superseded unexpectedly.");
    }
    return snapshot;
  } finally {
    await coordinator.dispose();
  }
}

export async function createProjectSnapshotCoordinator(options: {
  projectRoot: string;
  localLimit?: number;
  includeManagedCloud?: boolean;
}): Promise<ProjectSnapshotCoordinator> {
  const [
    { buildCodexLocalAdapterSnapshotFromState },
    { cloudTasksToAgents, codexCloudAdapter },
    { claudeAdapter },
    { cursorCloudAdapter },
    { cursorLocalAdapter },
    { hermesAdapter },
    { openClawAdapter },
    { presenceAdapter }
  ] = await Promise.all([
    import("../adapters/codex-local"),
    import("../adapters/codex-cloud"),
    import("../adapters/claude"),
    import("../adapters/cursor-cloud"),
    import("../adapters/cursor-local"),
    import("../adapters/hermes"),
    import("../adapters/openclaw"),
    import("../adapters/presence")
  ]);

  const staticSourceContexts = {
    projectRoot: options.projectRoot,
    localLimit: options.localLimit ?? DEFAULT_LOCAL_THREAD_LIMIT,
    readThreads: true
  };
  const secondarySources = [
    options.includeManagedCloud ? codexCloudAdapter.createSource(staticSourceContexts) : null,
    claudeAdapter.createSource(staticSourceContexts),
    cursorLocalAdapter.createSource(staticSourceContexts),
    cursorCloudAdapter.createSource(staticSourceContexts),
    hermesAdapter.createSource(staticSourceContexts),
    openClawAdapter.createSource(staticSourceContexts),
    presenceAdapter.createSource(staticSourceContexts)
  ].filter((source): source is NonNullable<typeof source> => source !== null);

  return new ProjectSnapshotCoordinator(options.projectRoot, {
    secondarySources,
    buildLocalSnapshot: buildCodexLocalAdapterSnapshotFromState,
    cloudTasksToAgents,
    assemble: assembleProjectSnapshot
  });
}

export async function buildDashboardSnapshot(
  options: SnapshotOptions
): Promise<DashboardSnapshot> {
  const notes: string[] = [];
  const threads = await buildLocalAgents(
    options.projectRoot,
    options.localLimit ?? DEFAULT_LOCAL_THREAD_LIMIT,
    notes,
    options.readThreads !== false
  );
  const initialCloudTasks = options.includeCloud === false ? [] : undefined;
  return buildDashboardSnapshotFromState({
    projectRoot: options.projectRoot,
    threads,
    cloudTasks: initialCloudTasks,
    notes
  });
}
