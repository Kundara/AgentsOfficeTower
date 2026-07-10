import { EventEmitter } from "node:events";
import { watch, watchFile, unwatchFile, type FSWatcher } from "node:fs";

import {
  type AppServerNotification,
  type AppServerServerRequest,
  CodexAppServerClient,
  type ToolRequestUserInputResponse
} from "./app-server";
import {
  listCodexProjectThreadCandidates,
  readCodexThreadWithTimeout
} from "./codex-thread-query";
import { listCloudTasks } from "./cloud";
import { codexGoalToAgentGoal } from "./goal";
import { canonicalizeProjectPath } from "./project-paths";
import {
  turnHasFinalAnswer,
  turnHasNonFinalWorkSignal,
  turnHasOpenWorkSignal
} from "./domain/codex-turn-semantics";
import { getRoomsFilePath, resolveReadableRoomsFilePath } from "./room-config";
import {
  filterProjectCloudTasks,
  isOngoingThread,
  isStaleActiveSubagentThread,
  parentThreadIdForThread,
  parseThreadSourceMeta,
  summariseThread
} from "./snapshot";
import type {
  CloudTask,
  CodexThread,
  DashboardEvent,
  DashboardSnapshot,
  AgentGoalState,
  NeedsUserState
} from "./types";
import {
  asRecord,
  asString,
  appServerDiagnosticNotePrefix,
  buildAppServerDiagnosticNote,
  buildDashboardEventFromAppServerMessage,
  buildNeedsUserStateFromServerRequest,
  buildThreadReadAgentMessageEvent,
  collectPaths,
  extractCollabReceiverThreadIds,
  extractThreadId,
  hasEquivalentRecentMessageEvent,
  isFinalAgentMessageNotification,
  latestThreadAgentMessageIsInLastTurn,
  latestThreadAgentMessage,
  type PendingUserRequest,
  shouldMarkThreadLiveFromAppServerNotification,
  shouldMarkThreadStoppedFromAppServerNotification,
  shouldStopDormantThreadAfterAppServerNotification
} from "./live-monitor-lib/events";
import {
  buildRolloutHookEvent,
  parseApplyPatchInput,
  readRecentRolloutHookEvents
} from "./live-monitor-lib/rollout-hooks";
import { RECENT_DONE_GRACE_MS } from "./workload";
import type { ProjectSnapshotCoordinator } from "./services/project-snapshot-coordinator";

export {
  buildAppServerDiagnosticNote,
  buildDashboardEventFromAppServerMessage,
  buildThreadReadAgentMessageEvent,
  extractCollabReceiverThreadIds,
  hasEquivalentRecentMessageEvent,
  parseApplyPatchInput,
  buildRolloutHookEvent,
  shouldMarkThreadLiveFromAppServerNotification,
  shouldMarkThreadStoppedFromAppServerNotification
};

const DISCOVERY_INTERVAL_MS = 4000;
const CLOUD_REFRESH_INTERVAL_MS = 30000;
const FILE_WATCH_INTERVAL_MS = 250;
const SNAPSHOT_DEBOUNCE_MS = 60;
const THREAD_READ_DEBOUNCE_MS = 80;
const ACTIVE_SUBSCRIPTION_WINDOW_MS = 10 * 60 * 1000;
const MAX_SUBSCRIBED_THREADS = 8;
const MAX_RECENT_EVENTS = 240;
const RECENT_EVENT_RETENTION_MS = 45 * 60 * 1000;
// Desktop-backed threads can take noticeably longer to resume than simple CLI
// sessions, and a too-short timeout drops the live item stream we need for
// `item/agentMessage/*` notifications.
// Desktop-backed thread attaches can easily take 20s+ on large rollouts.
// Keep a wider budget so live subscriptions don't flap back to read-only.
const APP_SERVER_SUBSCRIPTION_TIMEOUT_MS = 60000;
const CLOUD_NOTE_LEGACY_PREFIX = "Codex cloud list unavailable:";
const CLOUD_NOTE_PREFIX = "Codex cloud ";
const STOPPED_THREAD_REMOVAL_BUFFER_MS = 1000;
const NOT_LOADED_STOP_DEBOUNCE_MS = 3000;
const DEFAULT_LOCAL_THREAD_LIMIT = 24;
const APPROVAL_DECISIONS = new Set(["accept", "acceptForSession", "decline", "cancel"]);

export type ApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";
export type UserInputAnswers = ToolRequestUserInputResponse["answers"];

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

function latestInProgressTurn(thread: CodexThread): CodexThread["turns"][number] | null {
  return [...thread.turns].reverse().find((turn) => turn.status === "inProgress") ?? null;
}

function notificationTurn(params: unknown): CodexThread["turns"][number] | null {
  const turn = asRecord(asRecord(params)?.turn);
  const id = asString(turn?.id);
  const status = asString(turn?.status);
  if (!id || !status || !["completed", "interrupted", "failed", "inProgress"].includes(status)) {
    return null;
  }

  return {
    id,
    status: status as CodexThread["turns"][number]["status"],
    error: asRecord(turn?.error) as CodexThread["turns"][number]["error"],
    items: Array.isArray(turn?.items) ? turn.items as CodexThread["turns"][number]["items"] : []
  };
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

function upsertThreadTurn(thread: CodexThread, turn: CodexThread["turns"][number]): CodexThread {
  const turns = thread.turns.filter((entry) => entry.id !== turn.id);
  turns.push({
    ...turn,
    items: turn.items.length > 0
      ? turn.items
      : thread.turns.find((entry) => entry.id === turn.id)?.items ?? []
  });
  return {
    ...thread,
    turns
  };
}

function threadStillAwaitsFinalAnswer(thread: CodexThread): boolean {
  if (thread.status.type === "systemError") {
    return false;
  }
  const lastTurn = thread.turns.at(-1);
  if (!lastTurn || lastTurn.status === "failed" || turnHasFinalAnswer(lastTurn)) {
    return false;
  }
  return lastTurn.status === "inProgress" || turnHasNonFinalWorkSignal(lastTurn);
}

function isSettledDormantSubagentThread(thread: CodexThread): boolean {
  if (!parentThreadIdForThread(thread)) {
    return false;
  }
  if (thread.status.type !== "idle" && thread.status.type !== "notLoaded") {
    return false;
  }
  const lastTurn = thread.turns.at(-1);
  if (!lastTurn || lastTurn.status === "inProgress") {
    return false;
  }
  if (thread.status.type === "notLoaded" && !turnHasOpenWorkSignal(lastTurn)) {
    return true;
  }
  const summary = summariseThread(thread);
  return summary.state === "done" || summary.state === "idle";
}

function isFreshEnoughToPromoteAwaitingFinalAnswer(thread: CodexThread): boolean {
  const updatedAtMs = thread.updatedAt * 1000;
  return Number.isFinite(updatedAtMs) && Date.now() - updatedAtMs <= ACTIVE_SUBSCRIPTION_WINDOW_MS;
}

function isRecentThreadSubscriptionCandidate(thread: CodexThread, now: number): boolean {
  if (parentThreadIdForThread(thread)) {
    return false;
  }
  const updatedAtMs = thread.updatedAt * 1000;
  return Number.isFinite(updatedAtMs) && now - updatedAtMs <= ACTIVE_SUBSCRIPTION_WINDOW_MS;
}

function shouldPreserveKnownOngoingThread(thread: CodexThread, wasOngoing: boolean): boolean {
  if (isOngoingThread(thread)) {
    return true;
  }
  if (!wasOngoing || isSettledDormantSubagentThread(thread)) {
    return false;
  }
  return threadStillAwaitsFinalAnswer(thread);
}

export interface ProjectLiveMonitorOptions {
  projectRoot: string;
  localLimit?: number;
  includeCloud?: boolean;
}

export class ProjectLiveMonitor extends EventEmitter {
  private readonly projectRoot: string;
  private readonly localLimit: number;
  private readonly includeCloud: boolean;
  private readonly threads = new Map<string, CodexThread>();
  private readonly threadWatchers = new Map<string, FSWatcher>();
  private readonly threadReadTimers = new Map<string, NodeJS.Timeout>();
  private readonly threadRefreshGenerations = new Map<string, number>();
  private readonly threadPaths = new Map<string, string>();
  private readonly notes = new Set<string>();
  private roomConfigPath: string;
  private readonly pendingUserRequests = new Map<string, PendingUserRequest>();
  private readonly subscribedThreadIds = new Set<string>();
  private readonly ongoingThreadIds = new Set<string>();
  private readonly stoppedAtByThreadId = new Map<string, number>();
  private readonly hydratedThreadIds = new Set<string>();
  private readonly threadGoals = new Map<string, AgentGoalState>();
  private readonly threadRemovalTimers = new Map<string, NodeJS.Timeout>();
  private readonly pendingNotLoadedStopTimers = new Map<string, NodeJS.Timeout>();
  private roomWatcher: FSWatcher | null = null;
  private snapshot: DashboardSnapshot | null = null;
  private snapshotCoordinator: ProjectSnapshotCoordinator | null = null;
  private snapshotCoordinatorPromise: Promise<ProjectSnapshotCoordinator> | null = null;
  private cloudTasks: CloudTask[] = [];
  private client: CodexAppServerClient | null = null;
  private discoveryTimer: NodeJS.Timeout | null = null;
  private cloudTimer: NodeJS.Timeout | null = null;
  private snapshotTimer: NodeJS.Timeout | null = null;
  private discoveryPromise: Promise<void> | null = null;
  private discoveryRequested = 0;
  private discoveryCompleted = 0;
  private snapshotRebuildPromise: Promise<void> | null = null;
  private snapshotRebuildRequested = 0;
  private snapshotRebuildCompleted = 0;
  private stopping = false;
  private stopped = false;
  private stopPromise: Promise<void> | null = null;
  private recentEvents: DashboardEvent[] = [];
  private unsubscribeNotifications: (() => void) | null = null;
  private unsubscribeServerRequests: (() => void) | null = null;
  private subscriptionSyncPromise: Promise<void> | null = null;
  private subscriptionSyncQueued = false;

  constructor(options: ProjectLiveMonitorOptions) {
    super();
    this.projectRoot = options.projectRoot;
    this.localLimit = options.localLimit ?? DEFAULT_LOCAL_THREAD_LIMIT;
    this.includeCloud = options.includeCloud !== false;
    this.roomConfigPath = getRoomsFilePath(this.projectRoot);
  }

  getSnapshot(): DashboardSnapshot | null {
    return this.snapshot;
  }

  async start(): Promise<void> {
    const coordinator = await this.ensureSnapshotCoordinator();
    await Promise.all([this.ensureClient(), coordinator.warm()]);
    await this.discoverThreads();
    this.roomConfigPath = await resolveReadableRoomsFilePath(this.projectRoot);
    this.watchRoomsFile();
    this.discoveryTimer = setInterval(() => {
      void this.discoverThreads();
      void this.refreshSecondarySources();
    }, DISCOVERY_INTERVAL_MS);

    if (this.includeCloud) {
      void this.refreshCloudTasks();
      this.cloudTimer = setInterval(() => {
        void this.refreshCloudTasks();
      }, CLOUD_REFRESH_INTERVAL_MS);
    }

    await this.rebuildSnapshot();
  }

  async refreshNow(): Promise<void> {
    await Promise.all([
      this.includeCloud ? this.refreshCloudTasks() : Promise.resolve(),
      this.discoverThreads(),
      this.refreshSecondarySources("manual", 0)
    ]);
    await this.rebuildSnapshot();
  }

  async respondToApprovalRequest(requestId: string, decision: ApprovalDecision): Promise<void> {
    if (!APPROVAL_DECISIONS.has(decision)) {
      throw new Error(`Unsupported approval decision: ${decision}`);
    }

    await this.ensureClient();
    if (!this.client) {
      throw new Error("Local Codex app-server unavailable.");
    }

    const pending = this.pendingUserRequests.get(requestId) ?? null;
    if (!pending) {
      throw new Error("Approval request not found or already resolved.");
    }
    if (pending.kind !== "approval") {
      throw new Error("Only approval requests are actionable from Agents Office right now.");
    }

    const numericRequestId = Number.parseInt(requestId, 10);
    if (!Number.isFinite(numericRequestId)) {
      throw new Error(`Invalid approval request id: ${requestId}`);
    }

    if (pending.responseKind === "legacyReview") {
      this.client.respondToServerRequest(numericRequestId, {
        decision: legacyReviewDecision(decision)
      });
    } else if (pending.responseKind === "permissionsApproval") {
      if (decision !== "accept" && decision !== "acceptForSession") {
        throw new Error("Permission-profile requests only support accept or acceptForSession from Agents Office.");
      }
      this.client.respondToServerRequest(numericRequestId, {
        permissions: pending.requestedPermissions ?? { network: null, fileSystem: null },
        scope: decision === "acceptForSession" ? "session" : "turn"
      });
    } else {
      this.client.respondToApprovalRequest(numericRequestId, decision);
    }
    this.pendingUserRequests.delete(requestId);
    this.markThreadLive(pending.threadId);
    this.scheduleThreadRefresh(pending.threadId);
    await this.rebuildSnapshot();
  }

  async sendThreadReply(threadId: string, text: string): Promise<void> {
    const normalizedText = text.trim();
    if (!normalizedText) {
      throw new Error("Reply text is required.");
    }

    await this.ensureClient();
    if (!this.client) {
      throw new Error("Local Codex app-server unavailable.");
    }

    let thread = this.threads.get(threadId) ?? null;
    if (!thread || thread.status.type === "notLoaded") {
      thread = await this.client.resumeThread(threadId);
      this.threads.set(threadId, thread);
    }

    const threadProjectRoot = canonicalizeProjectPath(thread.cwd) ?? thread.cwd;
    if (!(threadProjectRoot === this.projectRoot || threadProjectRoot.startsWith(`${this.projectRoot}/`))) {
      throw new Error("Thread does not belong to this project.");
    }

    const sourceKind = parseThreadSourceMeta(thread).sourceKind;
    if (sourceKind !== "appServer") {
      throw new Error(
        "Browser replies are only supported for Codex app-server-owned threads. Continue this observed desktop/CLI thread in Codex instead."
      );
    }

    let activeTurn = latestInProgressTurn(thread);
    if (!activeTurn && thread.status.type === "active") {
      thread = await this.client.readThread(threadId);
      this.threads.set(threadId, thread);
      activeTurn = latestInProgressTurn(thread);
    }

    if (activeTurn?.id) {
      this.client.steerTurnNoWait(threadId, activeTurn.id, normalizedText);
    } else if (thread.status.type === "active") {
      throw new Error("Active Codex thread has no steerable turn yet. Wait for the live turn to load, then retry.");
    } else {
      this.client.startTurnNoWait(threadId, normalizedText, thread.cwd);
    }

    this.markThreadLive(threadId);
    this.scheduleThreadRefresh(threadId);
    this.scheduleThreadSubscriptions();
    await this.rebuildSnapshot();
  }

  async respondToInputRequest(requestId: string, answers: UserInputAnswers): Promise<void> {
    await this.ensureClient();
    if (!this.client) {
      throw new Error("Local Codex app-server unavailable.");
    }

    const pending = this.pendingUserRequests.get(requestId) ?? null;
    if (!pending) {
      throw new Error("Input request not found or already resolved.");
    }
    if (pending.kind !== "input") {
      throw new Error("Only input requests can be answered with browser input.");
    }

    const normalizedAnswers = normalizeUserInputAnswers(pending.questions ?? [], answers);
    const numericRequestId = Number.parseInt(requestId, 10);
    if (!Number.isFinite(numericRequestId)) {
      throw new Error(`Invalid input request id: ${requestId}`);
    }

    if (pending.responseKind === "mcpElicitation") {
      this.client.respondToServerRequest(numericRequestId, {
        action: "accept",
        content: normalizeMcpElicitationContent(pending.requestedSchema ?? null, normalizedAnswers),
        _meta: null
      });
    } else {
      this.client.respondToToolRequestUserInput(numericRequestId, {
        answers: normalizedAnswers
      });
    }
    this.pendingUserRequests.delete(requestId);
    this.markThreadLive(pending.threadId);
    this.scheduleThreadRefresh(pending.threadId);
    await this.rebuildSnapshot();
  }

  setSharedCloudTasks(tasks: CloudTask[], errorMessage: string | null): void {
    this.cloudTasks = filterProjectCloudTasks(tasks, this.projectRoot);
    this.setCloudErrorNote(errorMessage);
    this.scheduleSnapshot();
  }

  stop(): Promise<void> {
    if (!this.stopPromise) {
      this.stopPromise = this.performStop();
    }
    return this.stopPromise;
  }

  private async performStop(): Promise<void> {
    this.stopping = true;
    if (this.discoveryTimer) {
      clearInterval(this.discoveryTimer);
    }
    if (this.cloudTimer) {
      clearInterval(this.cloudTimer);
    }
    if (this.snapshotTimer) {
      clearTimeout(this.snapshotTimer);
    }
    if (this.roomWatcher) {
      this.roomWatcher.close();
    }
    unwatchFile(this.roomConfigPath);
    for (const timer of this.threadReadTimers.values()) {
      clearTimeout(timer);
    }
    this.threadReadTimers.clear();
    this.threadRefreshGenerations.clear();
    for (const timer of this.threadRemovalTimers.values()) {
      clearTimeout(timer);
    }
    this.threadRemovalTimers.clear();
    for (const timer of this.pendingNotLoadedStopTimers.values()) {
      clearTimeout(timer);
    }
    this.pendingNotLoadedStopTimers.clear();
    for (const [threadId, watcher] of this.threadWatchers.entries()) {
      watcher.close();
      const path = this.threadPaths.get(threadId);
      if (path) {
        unwatchFile(path);
      }
    }
    this.threadWatchers.clear();
    this.threadPaths.clear();
    this.unsubscribeNotifications?.();
    this.unsubscribeNotifications = null;
    this.unsubscribeServerRequests?.();
    this.unsubscribeServerRequests = null;
    this.client?.close();
    this.client = null;
    await this.discoveryPromise?.catch(() => undefined);
    await this.snapshotRebuildPromise?.catch((error) => {
      if (!this.stopping && !this.stopped) {
        throw error;
      }
    });
    const coordinator = this.snapshotCoordinator
      ?? await this.snapshotCoordinatorPromise?.catch(() => null)
      ?? null;
    await coordinator?.dispose();
    this.snapshotCoordinator = null;
    this.snapshotCoordinatorPromise = null;
    this.ongoingThreadIds.clear();
    this.subscribedThreadIds.clear();
    this.stopped = true;
    this.stopping = false;
  }

  private async ensureClient(): Promise<void> {
    if (this.stopping || this.stopped) {
      return;
    }
    if (this.client) {
      return;
    }

    try {
      this.client = await CodexAppServerClient.create();
      this.unsubscribeNotifications?.();
      this.unsubscribeServerRequests?.();
      this.unsubscribeNotifications = this.client.onNotification((notification) => {
        this.handleAppServerNotification(notification);
      });
      this.unsubscribeServerRequests = this.client.onServerRequest((request) => {
        this.handleAppServerServerRequest(request);
      });
      this.clearMatchingNote("Local Codex app-server unavailable:");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.addNote(`Local Codex app-server unavailable: ${message}`);
    }
  }

  private addNote(note: string): void {
    this.notes.add(note);
  }

  private clearMatchingNote(prefix: string): void {
    for (const note of this.notes) {
      if (note.startsWith(prefix)) {
        this.notes.delete(note);
      }
    }
  }

  private setCloudErrorNote(errorMessage: string | null): void {
    this.clearMatchingNote(CLOUD_NOTE_LEGACY_PREFIX);
    this.clearMatchingNote(CLOUD_NOTE_PREFIX);
    if (!errorMessage) {
      return;
    }
    this.addNote(
      errorMessage.startsWith(CLOUD_NOTE_PREFIX)
        ? errorMessage
        : `${CLOUD_NOTE_LEGACY_PREFIX} ${errorMessage}`
    );
  }

  private discoverThreads(): Promise<void> {
    if (this.stopping || this.stopped) {
      return Promise.resolve();
    }
    this.discoveryRequested += 1;
    if (!this.discoveryPromise) {
      const pump = this.runDiscoveryPump();
      this.discoveryPromise = pump.finally(() => {
        this.discoveryPromise = null;
      });
    }
    return this.discoveryPromise;
  }

  private async runDiscoveryPump(): Promise<void> {
    while (this.discoveryCompleted < this.discoveryRequested) {
      if (this.stopping || this.stopped) {
        this.discoveryCompleted = this.discoveryRequested;
        return;
      }
      const targetGeneration = this.discoveryRequested;
      await this.performThreadDiscovery();
      this.discoveryCompleted = targetGeneration;
    }
  }

  private async performThreadDiscovery(): Promise<void> {
    if (this.stopping || this.stopped) {
      return;
    }
    await this.ensureClient();
    if (!this.client) {
      return;
    }

    try {
      const query = await listCodexProjectThreadCandidates({
        client: this.client,
        projectRoot: this.projectRoot,
        localLimit: this.localLimit
      });
      if (this.stopping || this.stopped) {
        return;
      }
      if (query.usedUnscopedFallback) {
        this.addNote("Local Codex cwd filter returned no project threads; used unscoped Windows path fallback.");
      } else {
        this.clearMatchingNote("Local Codex cwd filter returned no project threads;");
      }
      const projectThreads = query.projectThreads;
      const projectThreadsById = new Map(projectThreads.map((thread) => [thread.id, thread]));
      const trackedThreads = new Map(
        query.trackedThreads
          .map((thread) => [thread.id, thread])
      );
      const listedThreadsById = new Map(query.allThreads.map((thread) => [thread.id, thread]));
      const listedChildrenByParent = childThreadsByParent(query.allThreads);
      const loadedThreadIds = await this.client.listLoadedThreads().catch(() => []);
      for (const threadId of loadedThreadIds) {
        if (projectThreadsById.has(threadId) || trackedThreads.has(threadId)) {
          continue;
        }
        let loadedThread: CodexThread | null = null;
        try {
          loadedThread = await readCodexThreadWithTimeout(this.client, threadId);
        } catch {
          loadedThread = null;
        }
        if (!loadedThread) {
          continue;
        }
        const canonicalCwd = canonicalizeProjectPath(loadedThread.cwd) ?? loadedThread.cwd;
        if (!(canonicalCwd === this.projectRoot || canonicalCwd.startsWith(`${this.projectRoot}/`))) {
          continue;
        }
        projectThreadsById.set(loadedThread.id, loadedThread);
        trackedThreads.set(loadedThread.id, loadedThread);
        listedThreadsById.set(loadedThread.id, loadedThread);
      }
      const pendingRelatedThreads = [...trackedThreads.values()];
      while (pendingRelatedThreads.length > 0) {
        const thread = pendingRelatedThreads.shift();
        if (!thread) {
          continue;
        }
        const parentThreadId = parentThreadIdForThread(thread);
        if (parentThreadId && !trackedThreads.has(parentThreadId)) {
          let parentThread = projectThreadsById.get(parentThreadId)
            ?? listedThreadsById.get(parentThreadId)
            ?? this.threads.get(parentThreadId)
            ?? null;
          if (!parentThread) {
            try {
              parentThread = await readCodexThreadWithTimeout(this.client, parentThreadId);
            } catch {
              parentThread = null;
            }
          }
          if (parentThread) {
            projectThreadsById.set(parentThread.id, parentThread);
            trackedThreads.set(parentThread.id, parentThread);
            pendingRelatedThreads.push(parentThread);
          }
        }

        for (const childThread of listedChildrenByParent.get(thread.id) ?? []) {
          if (trackedThreads.has(childThread.id)) {
            continue;
          }
          projectThreadsById.set(childThread.id, childThread);
          trackedThreads.set(childThread.id, childThread);
          pendingRelatedThreads.push(childThread);
        }
      }
      for (const threadId of Array.from(this.threads.keys())) {
        if (trackedThreads.has(threadId)) {
          continue;
        }
        const knownThread = projectThreadsById.get(threadId);
        if (knownThread) {
          trackedThreads.set(threadId, knownThread);
        }
      }
      this.clearMatchingNote("Local Codex app-server unavailable:");
      await Promise.all(
        [...trackedThreads.values()].map(async (listedThread) => {
          const known = this.threads.get(listedThread.id);
          if (!known || known.updatedAt !== listedThread.updatedAt || known.path !== listedThread.path) {
            await this.refreshThread(listedThread.id, listedThread);
            return;
          }

          const mergedThread = {
            ...known,
            status: listedThread.status,
            updatedAt: listedThread.updatedAt,
            path: listedThread.path ?? known.path
          };
          if (shouldPreserveKnownOngoingThread(mergedThread, this.ongoingThreadIds.has(listedThread.id))) {
            this.markThreadLive(listedThread.id);
          } else if (this.ongoingThreadIds.has(listedThread.id)) {
            this.markThreadStopped(listedThread.id);
          }
          this.threads.set(listedThread.id, mergedThread);
          await this.refreshThreadGoal(listedThread.id);
          this.ensureThreadWatcher(listedThread.id, listedThread.path ?? known.path);
        })
      );

      for (const threadId of Array.from(this.threads.keys())) {
        if (!projectThreadsById.has(threadId)) {
          if (this.ongoingThreadIds.has(threadId)) {
            continue;
          }
          this.markThreadStopped(threadId);
        }
      }

      this.scheduleThreadSubscriptions();
      this.scheduleSnapshot();
    } catch (error) {
      if (this.stopping || this.stopped) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.addNote(`Local Codex app-server unavailable: ${message}`);
      this.client?.close();
      this.client = null;
      this.subscribedThreadIds.clear();
      this.scheduleSnapshot();
    }
  }

  private scheduleThreadSubscriptions(): void {
    if (this.stopping || this.stopped) {
      return;
    }
    if (this.subscriptionSyncPromise) {
      this.subscriptionSyncQueued = true;
      return;
    }

    this.subscriptionSyncPromise = this.syncThreadSubscriptions()
      .catch(() => {
        /* notes are handled inside syncThreadSubscriptions */
      })
      .finally(() => {
        this.subscriptionSyncPromise = null;
        if (this.subscriptionSyncQueued) {
          this.subscriptionSyncQueued = false;
          this.scheduleThreadSubscriptions();
        }
      });
  }

  private async syncThreadSubscriptions(): Promise<void> {
    if (!this.client) {
      return;
    }

    this.clearMatchingNote("Live subscription sync degraded:");
    this.clearMatchingNote("Thread subscribe failed (");

    const now = Date.now();
    const candidates = [...this.threads.values()]
      .filter((thread) => (
        !this.stoppedAtByThreadId.has(thread.id)
        && (
          this.ongoingThreadIds.has(thread.id)
          || (thread.status.type === "active" && !isStaleActiveSubagentThread(thread, now))
          || isOngoingThread(thread)
          || isRecentThreadSubscriptionCandidate(thread, now)
        )
      ))
      .sort((left, right) => {
        const leftActive = (left.status.type === "active" && !isStaleActiveSubagentThread(left, now)) || this.ongoingThreadIds.has(left.id) ? 1 : 0;
        const rightActive = (right.status.type === "active" && !isStaleActiveSubagentThread(right, now)) || this.ongoingThreadIds.has(right.id) ? 1 : 0;
        return rightActive - leftActive || right.updatedAt - left.updatedAt;
      })
      .slice(0, MAX_SUBSCRIBED_THREADS);

    const targetIds = new Set(candidates.map((thread) => thread.id));
    const loadedThreadIds = new Set(
      await withTimeout(
        this.client.listLoadedThreads().catch(() => []),
        APP_SERVER_SUBSCRIPTION_TIMEOUT_MS,
        "thread/loaded/list"
      ).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.addNote(`Live subscription sync degraded: ${message}`);
        return [];
      })
    );

    await Promise.all(
      [...targetIds]
        .filter((candidateId) => !this.subscribedThreadIds.has(candidateId))
        .map(async (threadId) => {
          try {
            await withTimeout(
              this.client?.resumeThread(threadId) ?? Promise.reject(new Error("client unavailable")),
              APP_SERVER_SUBSCRIPTION_TIMEOUT_MS,
              `thread/resume ${threadId.slice(0, 8)}`
            );
            this.subscribedThreadIds.add(threadId);
            loadedThreadIds.add(threadId);
            await this.refreshThread(threadId);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.addNote(`Thread subscribe failed (${threadId.slice(0, 8)}): ${message}`);
          }
        })
    );

    await Promise.all(
      [...this.subscribedThreadIds]
        .filter((candidateId) => !targetIds.has(candidateId))
        .map(async (threadId) => {
          try {
            await withTimeout(
              this.client?.unsubscribeThread(threadId) ?? Promise.reject(new Error("client unavailable")),
              APP_SERVER_SUBSCRIPTION_TIMEOUT_MS,
              `thread/unsubscribe ${threadId.slice(0, 8)}`
            );
          } catch {
            /* ignore unsubscribe failures */
          }
          this.subscribedThreadIds.delete(threadId);
        })
    );

    for (const threadId of [...this.subscribedThreadIds]) {
      if (!loadedThreadIds.has(threadId)) {
        this.scheduleThreadRefresh(threadId);
      }
    }

    this.scheduleSnapshot();
  }

  private scheduleThreadRefresh(threadId: string): void {
    const existing = this.threadReadTimers.get(threadId);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.threadReadTimers.delete(threadId);
      void this.refreshThread(threadId);
    }, THREAD_READ_DEBOUNCE_MS);
    timer.unref?.();
    this.threadReadTimers.set(threadId, timer);
  }

  private ensureThreadWatcher(threadId: string, path: string | null): void {
    if (!path) {
      return;
    }

    const currentPath = this.threadPaths.get(threadId);
    if (currentPath === path) {
      return;
    }

    if (currentPath) {
      this.threadWatchers.get(threadId)?.close();
      unwatchFile(currentPath);
    }

    this.threadPaths.set(threadId, path);
    try {
      const watcher = watch(path, { persistent: false }, () => {
        this.scheduleThreadRefresh(threadId);
      });
      this.threadWatchers.set(threadId, watcher);
    } catch {
      /* ignore and rely on watchFile below */
    }

    watchFile(
      path,
      { interval: FILE_WATCH_INTERVAL_MS, persistent: false },
      () => {
        this.scheduleThreadRefresh(threadId);
      }
    );
  }

  private removeThread(threadId: string): void {
    this.threads.delete(threadId);
    const watcher = this.threadWatchers.get(threadId);
    watcher?.close();
    this.threadWatchers.delete(threadId);

    const timer = this.threadReadTimers.get(threadId);
    if (timer) {
      clearTimeout(timer);
      this.threadReadTimers.delete(threadId);
    }

    const path = this.threadPaths.get(threadId);
    if (path) {
      unwatchFile(path);
      this.threadPaths.delete(threadId);
    }

    for (const [requestId, request] of this.pendingUserRequests.entries()) {
      if (request.threadId === threadId) {
        this.pendingUserRequests.delete(requestId);
      }
    }
    const removalTimer = this.threadRemovalTimers.get(threadId);
    if (removalTimer) {
      clearTimeout(removalTimer);
      this.threadRemovalTimers.delete(threadId);
    }
    this.clearPendingNotLoadedStop(threadId);
    this.ongoingThreadIds.delete(threadId);
    this.stoppedAtByThreadId.delete(threadId);
    this.hydratedThreadIds.delete(threadId);
    this.threadGoals.delete(threadId);
    this.subscribedThreadIds.delete(threadId);
  }

  private belongsToProject(message: AppServerNotification | AppServerServerRequest): boolean {
    const threadId = extractThreadId(message.params);
    if (threadId && this.threads.has(threadId)) {
      return true;
    }

    const projectPaths = [...collectPaths(message.params)];
    return projectPaths.some((path) => path === this.projectRoot || path.startsWith(`${this.projectRoot}/`));
  }

  private pushRecentEvent(event: DashboardEvent): void {
    const now = Date.now();
    const createdAtMs = Date.parse(event.createdAt);
    if (Number.isFinite(createdAtMs) && createdAtMs < now - RECENT_EVENT_RETENTION_MS) {
      return;
    }

    this.recentEvents.unshift(event);
    const seen = new Set<string>();
    this.recentEvents = this.recentEvents.filter((entry) => {
      const entryCreatedAtMs = Date.parse(entry.createdAt);
      if (Number.isFinite(entryCreatedAtMs) && entryCreatedAtMs < now - RECENT_EVENT_RETENTION_MS) {
        return false;
      }
      if (seen.has(entry.id)) {
        return false;
      }
      seen.add(entry.id);
      return true;
    }).slice(0, MAX_RECENT_EVENTS);
  }

  private handleAppServerNotification(notification: AppServerNotification): void {
    const diagnosticNote = buildAppServerDiagnosticNote(notification);
    if (!this.belongsToProject(notification)) {
      if (!extractThreadId(notification.params) && diagnosticNote) {
        this.clearMatchingNote(appServerDiagnosticNotePrefix(notification.method));
        this.addNote(diagnosticNote);
        this.scheduleSnapshot();
      }
      return;
    }

    if (diagnosticNote) {
      this.clearMatchingNote(appServerDiagnosticNotePrefix(notification.method));
      this.addNote(diagnosticNote);
    }

    const threadId = extractThreadId(notification.params);
    if (threadId) {
      let knownThread = this.threads.get(threadId) ?? null;
      const wasOngoing =
        this.ongoingThreadIds.has(threadId)
        || (knownThread ? isOngoingThread(knownThread) : false);
      const status = notification.method === "thread/status/changed"
        ? asRecord(asRecord(notification.params)?.status)
        : null;
      const statusType = asString(status?.type);
      const hasFinalAgentMessage = isFinalAgentMessageNotification(notification);
      const turn = notification.method === "turn/started" || notification.method === "turn/completed"
        ? notificationTurn(notification.params)
        : null;
      if (knownThread && turn) {
        knownThread = upsertThreadTurn(knownThread, turn);
        this.threads.set(threadId, knownThread);
      }
      this.applyGoalNotification(threadId, notification);
      if (knownThread && notification.method === "thread/status/changed" && statusType) {
        const nextStatus =
          statusType === "active"
            ? {
              type: "active" as const,
              activeFlags: Array.isArray(status?.activeFlags)
                ? status.activeFlags.filter((flag): flag is string => typeof flag === "string")
                : knownThread.status.type === "active" ? knownThread.status.activeFlags : undefined
            }
            : statusType === "notLoaded" ? { type: "notLoaded" as const }
            : statusType === "idle" ? { type: "idle" as const }
            : statusType === "systemError" ? { type: "systemError" as const }
            : null;
        if (nextStatus) {
          this.threads.set(threadId, {
            ...knownThread,
            status: nextStatus
          });
        }
      }
      if (shouldMarkThreadLiveFromAppServerNotification(notification.method, statusType)) {
        this.markThreadLive(threadId);
      } else if (hasFinalAgentMessage) {
        this.markThreadStopped(threadId);
      } else if (shouldMarkThreadStoppedFromAppServerNotification(notification.method, statusType)) {
        this.markThreadStopped(threadId);
      } else if (shouldStopDormantThreadAfterAppServerNotification({
          method: notification.method,
          statusType,
          wasOngoing
        })) {
        if (notification.method === "thread/status/changed" && statusType === "notLoaded") {
          this.schedulePendingNotLoadedStop(threadId);
        } else {
          this.markThreadStopped(threadId);
        }
      }
      if (
        notification.method === "thread/closed"
        || (notification.method === "thread/status/changed" && statusType === "notLoaded")
      ) {
        this.scheduleThreadSubscriptions();
      }
    }

    const collabReceiverThreadIds = extractCollabReceiverThreadIds(notification);
    if (collabReceiverThreadIds.length > 0) {
      for (const receiverThreadId of collabReceiverThreadIds) {
        this.markThreadLive(receiverThreadId);
        void this.refreshCollabReceiverThread(receiverThreadId, threadId);
      }
      this.scheduleThreadSubscriptions();
    }

    if (notification.method === "serverRequest/resolved") {
      const params = asRecord(notification.params) ?? {};
      const requestId = asString(params.requestId);
      const pendingRequest = requestId ? this.pendingUserRequests.get(requestId) ?? null : null;
      if (requestId) {
        this.pendingUserRequests.delete(requestId);
      }
      const event = buildDashboardEventFromAppServerMessage(
        { projectRoot: this.projectRoot, pendingRequest },
        notification
      );
      if (event) {
        this.pushRecentEvent(event);
      }
    } else {
      const event = buildDashboardEventFromAppServerMessage({ projectRoot: this.projectRoot }, notification);
      if (event) {
        if (event.kind === "subagent" && event.threadId) {
          this.markThreadLive(event.threadId);
        }
        this.pushRecentEvent(event);
      }
    }

    if (threadId) {
      this.scheduleThreadRefresh(threadId);
    } else {
      void this.discoverThreads();
    }
    this.scheduleSnapshot();
  }

  private handleAppServerServerRequest(request: AppServerServerRequest): void {
    if (!this.belongsToProject(request)) {
      return;
    }

    if (request.method === "currentTime/read") {
      this.client?.respondToServerRequest(request.id, {
        currentTimeAt: Math.floor(Date.now() / 1000)
      });
      return;
    }

    const needsUser = buildNeedsUserStateFromServerRequest(request);
    if (needsUser) {
      this.pendingUserRequests.set(needsUser.requestId, needsUser);
    }

    const event = buildDashboardEventFromAppServerMessage(
      { projectRoot: this.projectRoot, pendingRequest: needsUser },
      request
    );
    if (event) {
      this.pushRecentEvent(event);
    }

    if (request.method === "item/tool/call") {
      const numericRequestId = request.id;
      const requestParams = asRecord(request.params);
      const tool = asString(requestParams?.tool);
      const namespace = asString(requestParams?.namespace);
      this.client?.respondToDynamicToolCallUnsupported(
        numericRequestId,
        namespace && tool ? `${namespace}.${tool}` : tool
      );
    }

    const threadId = extractThreadId(request.params);
    if (threadId) {
      this.markThreadLive(threadId);
      this.scheduleThreadRefresh(threadId);
    } else {
      void this.discoverThreads();
    }
    this.scheduleSnapshot();
  }

  private applyGoalNotification(threadId: string, notification: AppServerNotification): void {
    if (notification.method === "thread/goal/cleared") {
      this.threadGoals.delete(threadId);
      return;
    }

    if (notification.method !== "thread/goal/updated") {
      return;
    }

    const goal = codexGoalToAgentGoal(asRecord(notification.params)?.goal);
    if (goal) {
      this.threadGoals.set(threadId, goal);
    }
  }

  private async refreshThreadGoal(threadId: string): Promise<void> {
    if (!this.client) {
      return;
    }

    try {
      const goal = codexGoalToAgentGoal(await this.client.getThreadGoal(threadId));
      if (goal) {
        this.threadGoals.set(threadId, goal);
      } else {
        this.threadGoals.delete(threadId);
      }
    } catch {
      // Goal metadata is best-effort and should not disturb thread visibility.
    }
  }

  private async refreshThread(threadId: string, listedThread: CodexThread | null = null): Promise<void> {
    if (!this.client) {
      return;
    }
    const refreshGeneration = (this.threadRefreshGenerations.get(threadId) ?? 0) + 1;
    this.threadRefreshGenerations.set(threadId, refreshGeneration);

    try {
      const wasHydrated = this.hydratedThreadIds.has(threadId);
      const hasLiveSubscription = this.subscribedThreadIds.has(threadId);
      const previousThread = this.threads.get(threadId) ?? null;
      const wasOngoing =
        this.ongoingThreadIds.has(threadId)
        || (previousThread ? isOngoingThread(previousThread) : false);
      let readThread: CodexThread;
      try {
        readThread = await this.client.readThread(threadId);
      } catch (error) {
        if (!listedThread) {
          throw error;
        }
        readThread = listedThread;
      }
      if (this.threadRefreshGenerations.get(threadId) !== refreshGeneration) {
        return;
      }
      // A file-watch reread may arrive immediately after thread/list hydration.
      // Preserve the freshest known list metadata instead of letting an older
      // thread/read payload move the workload backwards in time.
      const freshestKnownThread = listedThread ?? previousThread;
      const thread = freshestKnownThread
        ? {
          ...readThread,
          status: listedThread ? listedThread.status : readThread.status,
          updatedAt: Math.max(readThread.updatedAt, freshestKnownThread.updatedAt),
          path: freshestKnownThread.path ?? readThread.path
        }
        : readThread;
      this.clearMatchingNote(`Thread refresh failed (${threadId.slice(0, 8)}):`);
      this.threads.set(threadId, thread);
      await this.refreshThreadGoal(threadId);
      const settledDormantSubagent = isSettledDormantSubagentThread(thread);
      const awaitingFinalAnswer = !settledDormantSubagent && threadStillAwaitsFinalAnswer(thread);
      const shouldPromoteAwaitingFinalAnswer =
        awaitingFinalAnswer
        && (
          hasLiveSubscription
          || wasOngoing
          || isFreshEnoughToPromoteAwaitingFinalAnswer(thread)
        );
      if (isOngoingThread(thread) || shouldPromoteAwaitingFinalAnswer) {
        this.markThreadLive(threadId);
      } else if (wasOngoing) {
        const nextMessage = latestThreadAgentMessage(thread);
        const hasFinalAnswer = nextMessage?.phase === "final_answer";
        const pendingNotLoadedStop =
          thread.status.type === "notLoaded" && this.pendingNotLoadedStopTimers.has(threadId);
        if (pendingNotLoadedStop) {
          // Wait for the scheduled reread confirmation before releasing a desk.
        } else if (isStaleActiveSubagentThread(thread)) {
          this.markThreadStopped(threadId);
        } else if (settledDormantSubagent) {
          this.markThreadStopped(threadId);
        } else if (thread.status.type === "systemError" || hasFinalAnswer) {
          this.markThreadStopped(threadId);
        } else {
          this.markThreadLive(threadId);
        }
      }
      const previousMessage = previousThread ? latestThreadAgentMessage(previousThread) : null;
      const nextMessage = latestThreadAgentMessage(thread);
      if (
        wasHydrated
        && nextMessage
        && latestThreadAgentMessageIsInLastTurn(thread)
        && (
          nextMessage.itemId !== previousMessage?.itemId
          || nextMessage.text !== previousMessage?.text
        )
      ) {
        // Even subscribed desktop sessions can miss a terminal message notification;
        // rereads backfill the toast event while equivalent live events still dedupe.
        const messageEvent = buildThreadReadAgentMessageEvent({ projectRoot: this.projectRoot }, thread);
        if (messageEvent && !hasEquivalentRecentMessageEvent(this.recentEvents, messageEvent)) {
          this.pushRecentEvent(messageEvent);
        }
      }
      this.ensureThreadWatcher(threadId, thread.path);
      const rolloutEvents = await readRecentRolloutHookEvents(this.projectRoot, threadId, thread.path, thread.updatedAt);
      for (const event of rolloutEvents) {
        this.pushRecentEvent(event);
      }
      this.hydratedThreadIds.add(threadId);
      this.scheduleSnapshot();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.addNote(`Thread refresh failed (${threadId.slice(0, 8)}): ${message}`);
      this.scheduleSnapshot();
    }
  }

  private async refreshCollabReceiverThread(threadId: string, senderThreadId: string | null): Promise<void> {
    if (!this.client) {
      return;
    }

    try {
      const thread = await this.client.readThread(threadId);
      const parentThreadId = parentThreadIdForThread(thread);
      const canonicalCwd = canonicalizeProjectPath(thread.cwd) ?? thread.cwd;
      const belongsToProject =
        canonicalCwd === this.projectRoot
        || canonicalCwd.startsWith(`${this.projectRoot}/`)
        || Boolean(parentThreadId && this.threads.has(parentThreadId))
        || Boolean(parentThreadId && senderThreadId === parentThreadId);
      if (!belongsToProject) {
        return;
      }

      this.threads.set(threadId, thread);
      await this.refreshThreadGoal(threadId);
      if (isOngoingThread(thread)) {
        this.markThreadLive(threadId);
      }
      this.ensureThreadWatcher(threadId, thread.path);
      this.scheduleThreadSubscriptions();
      this.scheduleSnapshot();
    } catch {
      this.scheduleThreadRefresh(threadId);
    }
  }

  private watchRoomsFile(): void {
    try {
      this.roomWatcher = watch(this.roomConfigPath, { persistent: false }, () => {
        this.scheduleSnapshot();
      });
    } catch {
      this.roomWatcher = null;
    }

    watchFile(
      this.roomConfigPath,
      { interval: FILE_WATCH_INTERVAL_MS, persistent: false },
      () => {
        this.scheduleSnapshot();
      }
    );
  }

  private async refreshCloudTasks(): Promise<void> {
    if (!this.includeCloud) {
      this.cloudTasks = [];
      return;
    }

    try {
      const listed = await listCloudTasks(10);
      this.cloudTasks = filterProjectCloudTasks(listed, this.projectRoot);
      this.setCloudErrorNote(null);
      this.scheduleSnapshot();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setCloudErrorNote(message);
      this.scheduleSnapshot();
    }
  }

  private scheduleSnapshot(): void {
    if (this.stopping || this.stopped) {
      return;
    }
    if (this.snapshotTimer) {
      clearTimeout(this.snapshotTimer);
    }

    this.snapshotTimer = setTimeout(() => {
      void this.rebuildSnapshot();
    }, SNAPSHOT_DEBOUNCE_MS);
    this.snapshotTimer.unref?.();
  }

  private async rebuildSnapshot(): Promise<void> {
    if (this.stopping || this.stopped) {
      return;
    }
    this.snapshotTimer = null;
    this.snapshotRebuildRequested += 1;
    if (!this.snapshotRebuildPromise) {
      const pump = this.runSnapshotRebuildPump();
      this.snapshotRebuildPromise = pump.finally(() => {
        this.snapshotRebuildPromise = null;
      });
    }
    await this.snapshotRebuildPromise;
  }

  private async runSnapshotRebuildPump(): Promise<void> {
    while (this.snapshotRebuildCompleted < this.snapshotRebuildRequested) {
      if (this.stopping || this.stopped) {
        this.snapshotRebuildCompleted = this.snapshotRebuildRequested;
        return;
      }
      const targetGeneration = this.snapshotRebuildRequested;
      try {
        await this.assembleLatestSnapshot(targetGeneration);
      } catch (error) {
        if (this.stopping || this.stopped) {
          this.snapshotRebuildCompleted = this.snapshotRebuildRequested;
          return;
        }
        throw error;
      }
      this.snapshotRebuildCompleted = targetGeneration;
    }
  }

  private async assembleLatestSnapshot(targetGeneration: number): Promise<void> {
    const needsUserByThreadId = new Map<string, NeedsUserState>();
    for (const pending of this.pendingUserRequests.values()) {
      needsUserByThreadId.set(pending.threadId, pending);
    }

    const coordinator = await this.ensureSnapshotCoordinator();
    const snapshot = await coordinator.buildSnapshot({
      threads: Array.from(this.threads.values()),
      cloudTasks: this.cloudTasks,
      events: this.recentEvents,
      notes: Array.from(this.notes),
      needsUserByThreadId,
      goalsByThreadId: this.threadGoals,
      subscribedThreadIds: this.subscribedThreadIds,
      stoppedAtByThreadId: this.stoppedAtByThreadId,
      ongoingThreadIds: this.ongoingThreadIds
    });
    if (snapshot && targetGeneration === this.snapshotRebuildRequested) {
      this.snapshot = snapshot;
      this.emit("snapshot", snapshot);
    }
  }

  private async ensureSnapshotCoordinator(): Promise<ProjectSnapshotCoordinator> {
    if (this.stopping || this.stopped) {
      throw new Error("ProjectLiveMonitor has been stopped.");
    }
    if (this.snapshotCoordinator) {
      return this.snapshotCoordinator;
    }
    if (!this.snapshotCoordinatorPromise) {
      this.snapshotCoordinatorPromise = import("./snapshot").then(async ({ createProjectSnapshotCoordinator }) => {
        const coordinator = await createProjectSnapshotCoordinator({
          projectRoot: this.projectRoot,
          localLimit: this.localLimit,
          includeManagedCloud: false
        });
        this.snapshotCoordinator = coordinator;
        return coordinator;
      });
    }
    return this.snapshotCoordinatorPromise;
  }

  private async refreshSecondarySources(
    reason: "manual" | "interval" = "interval",
    minimumAgeMs = DISCOVERY_INTERVAL_MS
  ): Promise<void> {
    if (this.stopping || this.stopped) {
      return;
    }
    try {
      const coordinator = await this.ensureSnapshotCoordinator();
      if (this.stopping || this.stopped) {
        return;
      }
      if (await coordinator.refreshIfStale(reason, minimumAgeMs)) {
        this.scheduleSnapshot();
      }
    } catch (error) {
      if (!this.stopping && !this.stopped) {
        throw error;
      }
    }
  }

  private markThreadLive(threadId: string): void {
    this.clearPendingNotLoadedStop(threadId);
    this.ongoingThreadIds.add(threadId);
    this.stoppedAtByThreadId.delete(threadId);
    const removalTimer = this.threadRemovalTimers.get(threadId);
    if (removalTimer) {
      clearTimeout(removalTimer);
      this.threadRemovalTimers.delete(threadId);
    }
  }

  private markThreadStopped(threadId: string): void {
    if (!this.threads.has(threadId)) {
      return;
    }
    if (this.stoppedAtByThreadId.has(threadId)) {
      return;
    }

    this.clearPendingNotLoadedStop(threadId);
    this.ongoingThreadIds.delete(threadId);
    this.stoppedAtByThreadId.set(threadId, Date.now());
    const removalTimer = this.threadRemovalTimers.get(threadId);
    if (removalTimer) {
      clearTimeout(removalTimer);
    }
    const timer = setTimeout(() => {
      this.threadRemovalTimers.delete(threadId);
      this.removeThread(threadId);
      this.scheduleSnapshot();
    }, RECENT_DONE_GRACE_MS + STOPPED_THREAD_REMOVAL_BUFFER_MS);
    timer.unref?.();
    this.threadRemovalTimers.set(threadId, timer);
  }

  private clearPendingNotLoadedStop(threadId: string): void {
    const timer = this.pendingNotLoadedStopTimers.get(threadId);
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    this.pendingNotLoadedStopTimers.delete(threadId);
  }

  private schedulePendingNotLoadedStop(threadId: string): void {
    if (!this.threads.has(threadId)) {
      return;
    }
    this.clearPendingNotLoadedStop(threadId);
    const timer = setTimeout(() => {
      this.pendingNotLoadedStopTimers.delete(threadId);
      void this.confirmDormantNotLoadedThread(threadId);
    }, NOT_LOADED_STOP_DEBOUNCE_MS);
    timer.unref?.();
    this.pendingNotLoadedStopTimers.set(threadId, timer);
  }

  private async confirmDormantNotLoadedThread(threadId: string): Promise<void> {
    if (!this.threads.has(threadId)) {
      return;
    }

    await this.refreshThread(threadId);
    const thread = this.threads.get(threadId) ?? null;
    if (!thread) {
      return;
    }
    if (isOngoingThread(thread)) {
      this.markThreadLive(threadId);
      return;
    }
    if (thread.status.type !== "notLoaded") {
      return;
    }

    const latestMessage = latestThreadAgentMessage(thread);
    if (isSettledDormantSubagentThread(thread) || latestMessage?.phase === "final_answer") {
      this.markThreadStopped(threadId);
    } else {
      this.markThreadLive(threadId);
    }
    this.scheduleSnapshot();
  }
}

function normalizeUserInputAnswers(
  questions: NeedsUserState["questions"],
  rawAnswers: UserInputAnswers
): UserInputAnswers {
  if (!rawAnswers || typeof rawAnswers !== "object" || Array.isArray(rawAnswers)) {
    throw new Error("Input answers must be an object keyed by question id.");
  }

  const questionsById = new Map((questions ?? []).map((question) => [question.id, question]));
  const requiredQuestions = [...questionsById.values()].filter((question) => question.required !== false);
  const answerEntries = Object.entries(rawAnswers);
  if (requiredQuestions.length > 0 && answerEntries.length === 0) {
    throw new Error("Answer at least one required question before sending input.");
  }

  const normalized: UserInputAnswers = {};
  for (const [questionId, answer] of answerEntries) {
    const question = questionsById.get(questionId) ?? null;
    const answerRecord = typeof answer === "object" && answer && !Array.isArray(answer)
      ? answer as { answers?: unknown }
      : null;
    const values = Array.isArray(answerRecord?.answers)
      ? answerRecord.answers
        .map((value) => typeof value === "string" ? value.trim() : "")
        .filter((value) => value.length > 0)
      : [];

    if (values.length === 0) {
      throw new Error(`Question ${questionId} requires at least one answer.`);
    }

    if (question?.options && question.isOther !== true) {
      const allowed = new Set(question.options.map((option) => option.label));
      const invalid = values.find((value) => !allowed.has(value));
      if (invalid) {
        throw new Error(`Question ${question.header} contains an unsupported answer.`);
      }
    }

    normalized[questionId] = { answers: values };
  }

  if (questionsById.size > 0) {
    for (const question of questionsById.values()) {
      if (question.required === false) {
        continue;
      }
      if (!normalized[question.id]) {
        throw new Error(`Question ${question.header} is still unanswered.`);
      }
    }
  }

  return normalized;
}

function legacyReviewDecision(decision: ApprovalDecision): string {
  switch (decision) {
    case "accept":
      return "approved";
    case "acceptForSession":
      return "approved_for_session";
    case "decline":
      return "denied";
    case "cancel":
      return "abort";
  }
}

function normalizeMcpElicitationContent(
  requestedSchema: Record<string, unknown> | null,
  answers: UserInputAnswers
): Record<string, unknown> {
  const content: Record<string, unknown> = {};
  const properties =
    requestedSchema && typeof requestedSchema.properties === "object" && requestedSchema.properties && !Array.isArray(requestedSchema.properties)
      ? requestedSchema.properties as Record<string, unknown>
      : {};

  for (const [questionId, answer] of Object.entries(answers)) {
    const values = answer.answers;
    const firstValue = values[0] ?? "";
    const propertySchema =
      typeof properties[questionId] === "object" && properties[questionId] && !Array.isArray(properties[questionId])
        ? properties[questionId] as Record<string, unknown>
        : null;
    if (propertySchema?.type === "number" || propertySchema?.type === "integer") {
      const numeric = Number(firstValue);
      if (!Number.isFinite(numeric)) {
        throw new Error(`Question ${questionId} requires a numeric answer.`);
      }
      content[questionId] = propertySchema.type === "integer" ? Math.trunc(numeric) : numeric;
      continue;
    }
    if (propertySchema?.type === "boolean") {
      if (firstValue !== "true" && firstValue !== "false") {
        throw new Error(`Question ${questionId} requires true or false.`);
      }
      content[questionId] = firstValue === "true";
      continue;
    }
    if (propertySchema?.type === "array") {
      content[questionId] = values;
      continue;
    }
    content[questionId] = firstValue;
  }

  return content;
}
