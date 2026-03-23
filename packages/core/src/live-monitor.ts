import { EventEmitter } from "node:events";
import { watch, watchFile, unwatchFile, type FSWatcher } from "node:fs";
import { getRoomsFilePath } from "./room-config";

import { type AppServerNotification, CodexAppServerClient } from "./app-server";
import { listCloudTasks } from "./cloud";
import { canonicalizeProjectPath, filterThreadsForProject } from "./project-paths";
import { buildDashboardSnapshotFromState, filterProjectCloudTasks } from "./snapshot";
import type { CloudTask, CodexThread, DashboardEvent, DashboardSnapshot } from "./types";

const DISCOVERY_INTERVAL_MS = 4000;
const CLOUD_REFRESH_INTERVAL_MS = 30000;
const FILE_WATCH_INTERVAL_MS = 1000;
const SNAPSHOT_DEBOUNCE_MS = 150;
const THREAD_READ_DEBOUNCE_MS = 250;
const MAX_RECENT_EVENTS = 64;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value ? (value as Record<string, unknown>) : null;
}

function collectThreadIds(value: unknown, output = new Set<string>()): Set<string> {
  if (typeof value === "string" && /^[0-9a-f-]{16,}$/i.test(value)) {
    output.add(value);
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectThreadIds(entry, output));
    return output;
  }
  const record = asRecord(value);
  if (!record) {
    return output;
  }
  for (const [key, entry] of Object.entries(record)) {
    if (/thread/i.test(key)) {
      collectThreadIds(entry, output);
      continue;
    }
    if (typeof entry === "object" && entry) {
      collectThreadIds(entry, output);
    }
  }
  return output;
}

function collectPaths(value: unknown, output = new Set<string>()): Set<string> {
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
    if (/(path|cwd|file)/i.test(key)) {
      collectPaths(entry, output);
      continue;
    }
    if (typeof entry === "object" && entry) {
      collectPaths(entry, output);
    }
  }
  return output;
}

function buildEventId(projectRoot: string, notification: AppServerNotification, createdAt: string, threadId: string | null): string {
  return [projectRoot, notification.method, threadId ?? "", createdAt].join("::");
}

function buildDashboardEvent(
  projectRoot: string,
  notification: AppServerNotification,
  threadId: string | null
): DashboardEvent | null {
  const method = notification.method.toLowerCase();
  const params = asRecord(notification.params) ?? {};
  const item = asRecord(params.item) ?? params;
  const itemType = typeof item.type === "string" ? item.type : null;
  const createdAt = new Date().toISOString();
  const path = [...collectPaths(params)][0] ?? null;

  if (/approval/.test(method)) {
    return {
      id: buildEventId(projectRoot, notification, createdAt, threadId),
      source: "codex",
      confidence: "typed",
      threadId,
      createdAt,
      kind: "approval",
      phase: "waiting",
      title: "Needs approval",
      detail: "Approval requested",
      path
    };
  }

  if (/user.?input|input/.test(method) && /wait|request|needed|need/.test(method)) {
    return {
      id: buildEventId(projectRoot, notification, createdAt, threadId),
      source: "codex",
      confidence: "typed",
      threadId,
      createdAt,
      kind: "input",
      phase: "waiting",
      title: "Needs input",
      detail: "User input requested",
      path
    };
  }

  if (method.includes("turn")) {
    const phase =
      /fail/.test(method) ? "failed"
      : /interrupt/.test(method) ? "interrupted"
      : /complete|finish/.test(method) ? "completed"
      : "started";
    return {
      id: buildEventId(projectRoot, notification, createdAt, threadId),
      source: "codex",
      confidence: "typed",
      threadId,
      createdAt,
      kind: "turn",
      phase,
      title:
        phase === "failed" ? "Turn failed"
        : phase === "interrupted" ? "Turn interrupted"
        : phase === "completed" ? "Turn completed"
        : "Turn started",
      detail: typeof params.turnId === "string" ? params.turnId : notification.method,
      path
    };
  }

  if (itemType === "fileChange") {
    return {
      id: buildEventId(projectRoot, notification, createdAt, threadId),
      source: "codex",
      confidence: "typed",
      threadId,
      createdAt,
      kind: "fileChange",
      phase: "updated",
      title: "File changed",
      detail: typeof item.status === "string" ? item.status : "updated",
      path
    };
  }

  if (itemType === "commandExecution") {
    const phase =
      typeof item.status === "string" && /failed|declined/i.test(item.status)
        ? "failed"
        : typeof item.status === "string" && /completed|success/i.test(item.status)
        ? "completed"
        : "started";
    return {
      id: buildEventId(projectRoot, notification, createdAt, threadId),
      source: "codex",
      confidence: "typed",
      threadId,
      createdAt,
      kind: "command",
      phase,
      title: phase === "failed" ? "Command failed" : phase === "completed" ? "Command finished" : "Command started",
      detail: typeof item.command === "string" ? item.command : notification.method,
      path
    };
  }

  if (itemType === "collabToolCall" || itemType === "collabAgentToolCall") {
    return {
      id: buildEventId(projectRoot, notification, createdAt, threadId),
      source: "codex",
      confidence: "typed",
      threadId,
      createdAt,
      kind: "subagent",
      phase: "started",
      title: "Subagent activity",
      detail: notification.method,
      path
    };
  }

  if (itemType === "agentMessage") {
    return {
      id: buildEventId(projectRoot, notification, createdAt, threadId),
      source: "codex",
      confidence: "typed",
      threadId,
      createdAt,
      kind: "message",
      phase: "updated",
      title: "Agent update",
      detail: notification.method,
      path
    };
  }

  if (method.includes("item")) {
    return {
      id: buildEventId(projectRoot, notification, createdAt, threadId),
      source: "codex",
      confidence: "typed",
      threadId,
      createdAt,
      kind: "item",
      phase: "updated",
      title: itemType ? `Item: ${itemType}` : "Item updated",
      detail: notification.method,
      path
    };
  }

  return null;
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
  private readonly threadPaths = new Map<string, string>();
  private readonly notes = new Set<string>();
  private readonly roomConfigPath: string;
  private roomWatcher: FSWatcher | null = null;
  private snapshot: DashboardSnapshot | null = null;
  private cloudTasks: CloudTask[] = [];
  private client: CodexAppServerClient | null = null;
  private discoveryTimer: NodeJS.Timeout | null = null;
  private cloudTimer: NodeJS.Timeout | null = null;
  private snapshotTimer: NodeJS.Timeout | null = null;
  private recentEvents: DashboardEvent[] = [];
  private unsubscribeNotifications: (() => void) | null = null;

  constructor(options: ProjectLiveMonitorOptions) {
    super();
    this.projectRoot = options.projectRoot;
    this.localLimit = options.localLimit ?? 24;
    this.includeCloud = options.includeCloud !== false;
    this.roomConfigPath = getRoomsFilePath(this.projectRoot);
  }

  getSnapshot(): DashboardSnapshot | null {
    return this.snapshot;
  }

  async start(): Promise<void> {
    await this.ensureClient();
    await this.refreshCloudTasks();
    await this.discoverThreads();
    this.watchRoomsFile();
    this.discoveryTimer = setInterval(() => {
      void this.discoverThreads();
    }, DISCOVERY_INTERVAL_MS);

    if (this.includeCloud) {
      this.cloudTimer = setInterval(() => {
        void this.refreshCloudTasks();
      }, CLOUD_REFRESH_INTERVAL_MS);
    }

    await this.rebuildSnapshot();
  }

  async refreshNow(): Promise<void> {
    await this.refreshCloudTasks();
    await this.discoverThreads();
    await this.rebuildSnapshot();
  }

  async stop(): Promise<void> {
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
    this.client?.close();
    this.client = null;
  }

  private async ensureClient(): Promise<void> {
    if (this.client) {
      return;
    }

    try {
      this.client = await CodexAppServerClient.create();
      this.unsubscribeNotifications?.();
      this.unsubscribeNotifications = this.client.onNotification((notification) => {
        this.handleAppServerNotification(notification);
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

  private async discoverThreads(): Promise<void> {
    await this.ensureClient();
    if (!this.client) {
      return;
    }

    try {
      const allThreads = await this.client.listThreads({
        limit: Math.max(this.localLimit * 4, 50)
      });
      const listedThreads = filterThreadsForProject(this.projectRoot, allThreads).slice(0, this.localLimit);
      this.clearMatchingNote("Local Codex app-server unavailable:");
      const listedIds = new Set(listedThreads.map((thread) => thread.id));

      await Promise.all(
        listedThreads.map(async (listedThread) => {
          const known = this.threads.get(listedThread.id);
          if (!known || known.updatedAt !== listedThread.updatedAt || known.path !== listedThread.path) {
            await this.refreshThread(listedThread.id);
            return;
          }

          this.threads.set(listedThread.id, {
            ...known,
            status: listedThread.status,
            updatedAt: listedThread.updatedAt,
            path: listedThread.path ?? known.path
          });
          this.ensureThreadWatcher(listedThread.id, listedThread.path ?? known.path);
        })
      );

      for (const threadId of Array.from(this.threads.keys())) {
        if (!listedIds.has(threadId)) {
          this.removeThread(threadId);
        }
      }

      this.scheduleSnapshot();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.addNote(`Local Codex app-server unavailable: ${message}`);
      this.client?.close();
      this.client = null;
      this.scheduleSnapshot();
    }
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
      const watcher = watch(path, () => {
        this.scheduleThreadRefresh(threadId);
      });
      this.threadWatchers.set(threadId, watcher);
    } catch {
      /* ignore and rely on watchFile below */
    }

    watchFile(
      path,
      { interval: FILE_WATCH_INTERVAL_MS },
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
  }

  private belongsToProject(notification: AppServerNotification, threadIds: string[]): boolean {
    if (threadIds.some((threadId) => this.threads.has(threadId))) {
      return true;
    }
    const projectPaths = [...collectPaths(notification.params)];
    return projectPaths.some((path) => path === this.projectRoot || path.startsWith(`${this.projectRoot}/`));
  }

  private pushRecentEvent(event: DashboardEvent): void {
    this.recentEvents.unshift(event);
    const seen = new Set<string>();
    this.recentEvents = this.recentEvents.filter((entry) => {
      if (seen.has(entry.id)) {
        return false;
      }
      seen.add(entry.id);
      return true;
    }).slice(0, MAX_RECENT_EVENTS);
  }

  private handleAppServerNotification(notification: AppServerNotification): void {
    const threadIds = [...collectThreadIds(notification.params)];
    if (!this.belongsToProject(notification, threadIds)) {
      return;
    }

    const event = buildDashboardEvent(this.projectRoot, notification, threadIds[0] ?? null);
    if (event) {
      this.pushRecentEvent(event);
    }

    if (threadIds.length > 0) {
      threadIds.forEach((threadId) => this.scheduleThreadRefresh(threadId));
    } else {
      void this.discoverThreads();
    }
    this.scheduleSnapshot();
  }

  private async refreshThread(threadId: string): Promise<void> {
    if (!this.client) {
      return;
    }

    try {
      const thread = await this.client.readThread(threadId);
      this.clearMatchingNote(`Thread refresh failed (${threadId.slice(0, 8)}):`);
      this.threads.set(threadId, thread);
      this.ensureThreadWatcher(threadId, thread.path);
      this.scheduleSnapshot();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.addNote(`Thread refresh failed (${threadId.slice(0, 8)}): ${message}`);
      this.scheduleSnapshot();
    }
  }

  private watchRoomsFile(): void {
    try {
      this.roomWatcher = watch(this.roomConfigPath, () => {
        this.scheduleSnapshot();
      });
    } catch {
      this.roomWatcher = null;
    }

    watchFile(
      this.roomConfigPath,
      { interval: FILE_WATCH_INTERVAL_MS },
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
      this.clearMatchingNote("Codex cloud list unavailable:");
      this.scheduleSnapshot();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.addNote(`Codex cloud list unavailable: ${message}`);
      this.scheduleSnapshot();
    }
  }

  private scheduleSnapshot(): void {
    if (this.snapshotTimer) {
      clearTimeout(this.snapshotTimer);
    }

    this.snapshotTimer = setTimeout(() => {
      void this.rebuildSnapshot();
    }, SNAPSHOT_DEBOUNCE_MS);
  }

  private async rebuildSnapshot(): Promise<void> {
    this.snapshotTimer = null;
    this.snapshot = await buildDashboardSnapshotFromState({
      projectRoot: this.projectRoot,
      threads: Array.from(this.threads.values()),
      cloudTasks: this.cloudTasks,
      events: this.recentEvents,
      notes: Array.from(this.notes)
    });
    this.emit("snapshot", this.snapshot);
  }
}
