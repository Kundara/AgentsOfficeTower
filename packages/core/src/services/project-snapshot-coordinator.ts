import type { AdapterRefreshReason, AdapterSnapshot, ProjectSource } from "../adapters/types";
import type {
  AgentGoalState,
  CloudTask,
  CodexThread,
  DashboardAgent,
  DashboardEvent,
  DashboardSnapshot,
  NeedsUserState
} from "../types";

export interface ProjectSnapshotState {
  threads: CodexThread[];
  cloudTasks?: CloudTask[];
  events?: DashboardEvent[];
  notes?: string[];
  needsUserByThreadId?: Map<string, NeedsUserState>;
  goalsByThreadId?: Map<string, AgentGoalState>;
  subscribedThreadIds?: Set<string>;
  stoppedAtByThreadId?: Map<string, number>;
  ongoingThreadIds?: Set<string>;
}

export interface ProjectSnapshotCoordinatorDependencies {
  secondarySources: ProjectSource[];
  buildLocalSnapshot(input: ProjectSnapshotState & { projectRoot: string }): Promise<AdapterSnapshot>;
  cloudTasksToAgents(projectRoot: string, tasks: CloudTask[]): Promise<DashboardAgent[]>;
  assemble(input: {
    projectRoot: string;
    adapterSnapshots: AdapterSnapshot[];
    currentnessNow: number;
  }): Promise<DashboardSnapshot>;
  now?: () => number;
}

function refreshPriority(reason: AdapterRefreshReason): number {
  switch (reason) {
    case "manual": return 4;
    case "event": return 3;
    case "interval": return 2;
    case "startup": return 1;
    case "warm": return 0;
  }
}

function strongerReason(left: AdapterRefreshReason, right: AdapterRefreshReason): AdapterRefreshReason {
  return refreshPriority(right) > refreshPriority(left) ? right : left;
}

export class ProjectSnapshotCoordinator {
  private readonly now: () => number;
  private warmPromise: Promise<void> | null = null;
  private refreshPump: Promise<void> | null = null;
  private refreshRequested = 0;
  private refreshCompleted = 0;
  private pendingRefreshReason: AdapterRefreshReason = "interval";
  private lastSecondaryRefreshAt = 0;
  private assemblyTail: Promise<void> = Promise.resolve();
  private requestedAssemblyGeneration = 0;
  private disposed = false;

  constructor(
    readonly projectRoot: string,
    private readonly dependencies: ProjectSnapshotCoordinatorDependencies
  ) {
    this.now = dependencies.now ?? Date.now;
  }

  async warm(): Promise<void> {
    this.assertActive();
    if (!this.warmPromise) {
      this.warmPromise = Promise.all(
        this.dependencies.secondarySources.map((source) => source.warm())
      ).then(() => {
        this.lastSecondaryRefreshAt = this.now();
      });
    }
    await this.warmPromise;
  }

  async refresh(reason: AdapterRefreshReason): Promise<void> {
    this.assertActive();
    await this.warm();
    this.refreshRequested += 1;
    this.pendingRefreshReason = strongerReason(this.pendingRefreshReason, reason);
    if (!this.refreshPump) {
      const pump = this.runRefreshPump();
      this.refreshPump = pump.finally(() => {
        this.refreshPump = null;
      });
    }
    await this.refreshPump;
  }

  async refreshIfStale(reason: AdapterRefreshReason, minimumAgeMs: number): Promise<boolean> {
    this.assertActive();
    await this.warm();
    if (this.now() - this.lastSecondaryRefreshAt < Math.max(0, minimumAgeMs)) {
      return false;
    }
    await this.refresh(reason);
    return true;
  }

  buildSnapshot(state: ProjectSnapshotState): Promise<DashboardSnapshot | null> {
    this.assertActive();
    const generation = ++this.requestedAssemblyGeneration;
    const capturedState = copySnapshotState(state);
    const currentnessNow = this.now();
    const assembly = this.assemblyTail.then(async () => {
      if (this.disposed || generation !== this.requestedAssemblyGeneration) {
        return null;
      }
      await this.warm();
      const localSnapshot = await this.dependencies.buildLocalSnapshot({
        projectRoot: this.projectRoot,
        ...capturedState
      });
      const cloudSnapshot = capturedState.cloudTasks
        ? await this.buildInjectedCloudSnapshot(capturedState.cloudTasks)
        : null;
      const snapshot = await this.dependencies.assemble({
        projectRoot: this.projectRoot,
        adapterSnapshots: [
          localSnapshot,
          ...(cloudSnapshot ? [cloudSnapshot] : []),
          ...this.dependencies.secondarySources.map((source) => source.getCachedSnapshot())
        ],
        currentnessNow
      });
      return !this.disposed && generation === this.requestedAssemblyGeneration ? snapshot : null;
    });
    this.assemblyTail = assembly.then(() => undefined, () => undefined);
    return assembly;
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    await this.refreshPump?.catch(() => undefined);
    await this.assemblyTail.catch(() => undefined);
    await Promise.all(this.dependencies.secondarySources.map((source) => source.dispose()));
  }

  private async runRefreshPump(): Promise<void> {
    while (this.refreshCompleted < this.refreshRequested) {
      const targetGeneration = this.refreshRequested;
      const reason = this.pendingRefreshReason;
      this.pendingRefreshReason = "interval";
      await Promise.all(
        this.dependencies.secondarySources.map((source) => source.refresh(reason))
      );
      this.lastSecondaryRefreshAt = this.now();
      this.refreshCompleted = targetGeneration;
    }
  }

  private async buildInjectedCloudSnapshot(tasks: CloudTask[]): Promise<AdapterSnapshot> {
    const generatedAt = new Date(this.now()).toISOString();
    return {
      adapterId: "codex-cloud",
      source: "cloud",
      generatedAt,
      agents: await this.dependencies.cloudTasksToAgents(this.projectRoot, tasks),
      events: [],
      notes: [],
      cloudTasks: tasks,
      health: {
        status: "ready",
        detail: null,
        lastUpdatedAt: generatedAt
      }
    };
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new Error("ProjectSnapshotCoordinator has been disposed.");
    }
  }
}

function copySnapshotState(state: ProjectSnapshotState): ProjectSnapshotState {
  return {
    threads: [...state.threads],
    cloudTasks: state.cloudTasks ? [...state.cloudTasks] : undefined,
    events: state.events ? [...state.events] : undefined,
    notes: state.notes ? [...state.notes] : undefined,
    needsUserByThreadId: state.needsUserByThreadId ? new Map(state.needsUserByThreadId) : undefined,
    goalsByThreadId: state.goalsByThreadId ? new Map(state.goalsByThreadId) : undefined,
    subscribedThreadIds: state.subscribedThreadIds ? new Set(state.subscribedThreadIds) : undefined,
    stoppedAtByThreadId: state.stoppedAtByThreadId ? new Map(state.stoppedAtByThreadId) : undefined,
    ongoingThreadIds: state.ongoingThreadIds ? new Set(state.ongoingThreadIds) : undefined
  };
}
