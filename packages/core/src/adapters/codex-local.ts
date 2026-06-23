import { withAppServerClient } from "../app-server";
import { ensureAgentAppearance } from "../appearance";
import {
  listCodexProjectThreadCandidates,
  readCodexThreadWithTimeout
} from "../codex-thread-query";
import {
  applyRecentActivityEvent,
  inferThreadAgentRole,
  isOngoingThread,
  parseThreadSourceMeta,
  pickThreadLabel,
  summariseThread,
  syncSummaryWithLatestThreadMessage
} from "../snapshot";
import type { ProjectAdapter } from "./types";
import { emptyAdapterSnapshot } from "./helpers";
import { StaticProjectSource } from "./static-source";
import type { AgentGoalState, CloudTask, CodexThread, DashboardEvent, NeedsUserState } from "../types";

export { selectProjectThreadsWithParents } from "../local-thread-selection";

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

function latestAgentMessagePhase(thread: CodexThread): string | null {
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  for (const turn of [...turns].reverse()) {
    const items = Array.isArray(turn.items) ? turn.items : [];
    for (const item of [...items].reverse()) {
      if (!item || item.type !== "agentMessage") {
        continue;
      }
      return typeof item.phase === "string" ? item.phase : null;
    }
  }
  return null;
}

function recentWorkloadEventTimeMs(events: DashboardEvent[], latestMessagePhase: string | null): number {
  const hasNonFinalMessage = Boolean(latestMessagePhase && latestMessagePhase !== "final_answer");
  return events.reduce((latest, event) => {
    if (!event || event.kind === "status") {
      return latest;
    }
    if (event.kind === "message" && event.phase === "completed") {
      return latest;
    }
    const isWorkloadEvent = hasNonFinalMessage
      || event.kind === "subagent"
      || event.phase === "started"
      || event.phase === "updated"
      || event.phase === "waiting"
      || event.phase === "failed";
    if (!isWorkloadEvent) {
      return latest;
    }
    const createdAtMs = Date.parse(event.createdAt);
    return Number.isFinite(createdAtMs) ? Math.max(latest, createdAtMs) : latest;
  }, 0);
}

export async function buildCodexLocalAdapterSnapshotFromState(input: {
  projectRoot: string;
  threads: CodexThread[];
  events?: DashboardEvent[];
  notes?: string[];
  needsUserByThreadId?: Map<string, NeedsUserState>;
  goalsByThreadId?: Map<string, AgentGoalState>;
  subscribedThreadIds?: Set<string>;
  stoppedAtByThreadId?: Map<string, number>;
  ongoingThreadIds?: Set<string>;
  cloudTasks?: CloudTask[];
}): Promise<ReturnType<typeof emptyAdapterSnapshot>> {
  const generatedAt = new Date().toISOString();
  const recentEventsByThreadId = new Map<string, DashboardEvent[]>();
  for (const event of input.events ?? []) {
    if (!event.threadId) {
      continue;
    }
    const existing = recentEventsByThreadId.get(event.threadId) ?? [];
    existing.push(event);
    recentEventsByThreadId.set(event.threadId, existing);
  }

  const agents = await Promise.all(
    [...input.threads]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map(async (thread) => {
        const recentThreadEvents = recentEventsByThreadId.get(thread.id) ?? [];
        const needsUser = input.needsUserByThreadId?.get(thread.id) ?? null;
        const inferredOngoing =
          (input.ongoingThreadIds?.has(thread.id) ?? false)
          || isOngoingThread(thread);
        const summary = applyRecentActivityEvent(
          thread,
          needsUser
            ? {
              ...summariseThread(thread),
              state: needsUser.kind === "approval" ? "blocked" : "waiting",
              detail: needsUser.kind === "approval" ? "Waiting on approval" : "Waiting on input"
            }
            : summariseThread(thread),
          recentThreadEvents
        );
        const syncedMessageSummary = syncSummaryWithLatestThreadMessage(thread, summary, recentThreadEvents);
        const updatedAtMs = Math.max(
          thread.updatedAt * 1000,
          recentWorkloadEventTimeMs(recentThreadEvents, latestAgentMessagePhase(thread))
        );
        const stoppedAtMs =
          inferredOngoing ? null
          : input.stoppedAtByThreadId
            ? (input.stoppedAtByThreadId.get(thread.id) ?? null)
            : !input.ongoingThreadIds && thread.status.type !== "active" && (syncedMessageSummary.summary.state === "done" || syncedMessageSummary.summary.state === "idle")
              ? thread.updatedAt * 1000
              : null;
        const appearance = await ensureAgentAppearance(input.projectRoot, thread.id);
        const sourceMeta = parseThreadSourceMeta(thread);
        const resolvedRole = inferThreadAgentRole(thread, sourceMeta.sourceKind);
        return {
          id: thread.id,
          label: pickThreadLabel(thread),
          source: "local" as const,
          sourceKind: sourceMeta.sourceKind,
          parentThreadId: sourceMeta.parentThreadId,
          depth: sourceMeta.depth,
          isCurrent: false,
          isOngoing: inferredOngoing,
          statusText: thread.status.type,
          role: resolvedRole,
          nickname: thread.agentNickname ?? sourceMeta.agentNickname,
          isSubagent: Boolean(sourceMeta.parentThreadId || sourceMeta.sourceKind.startsWith("subAgent")),
          state: syncedMessageSummary.summary.state,
          detail: syncedMessageSummary.summary.detail,
          cwd: thread.cwd,
          roomId: null,
          appearance,
          updatedAt: new Date(updatedAtMs).toISOString(),
          stoppedAt: stoppedAtMs ? new Date(stoppedAtMs).toISOString() : null,
          paths: syncedMessageSummary.summary.paths,
          activityEvent: syncedMessageSummary.summary.activityEvent,
          goal: input.goalsByThreadId?.get(thread.id) ?? null,
          latestMessage: syncedMessageSummary.latestMessage,
          threadId: thread.id,
          taskId: null,
          resumeCommand: `codex resume ${thread.id}`,
          url: null,
          git: thread.gitInfo,
          provenance: "codex" as const,
          confidence: "typed" as const,
          needsUser,
          liveSubscription: input.subscribedThreadIds?.has(thread.id) ? "subscribed" as const : "readOnly" as const,
          network: null
        };
      })
  );

  return emptyAdapterSnapshot({
    adapterId: "codex-local",
    source: "local",
    generatedAt,
    agents,
    events: input.events ?? [],
    notes: input.notes ?? []
  });
}

export const codexLocalAdapter: ProjectAdapter = {
  id: "codex-local",
  source: "local",
  capabilities: {
    liveUpdates: true,
    typedNeedsUser: true
  },
  createSource(context) {
    return new StaticProjectSource(async () => {
      const notes: string[] = [];
      const threads = await buildLocalAgents(
        context.projectRoot,
        context.localLimit ?? 24,
        notes,
        context.readThreads !== false
      );
      return buildCodexLocalAdapterSnapshotFromState({
        projectRoot: context.projectRoot,
        threads,
        notes
      });
    }, emptyAdapterSnapshot({ adapterId: "codex-local", source: "local" }));
  }
};
