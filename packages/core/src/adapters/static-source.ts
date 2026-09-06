import type { AdapterSnapshot, ProjectSource, AdapterRefreshReason } from "./types";

type SnapshotLoader = () => Promise<AdapterSnapshot>;

export class StaticProjectSource implements ProjectSource {
  private cachedSnapshot: AdapterSnapshot;
  private readonly listeners = new Set<() => void>();
  private refreshGeneration = 0;
  private disposed = false;

  constructor(
    private readonly loadSnapshot: SnapshotLoader,
    initialSnapshot: AdapterSnapshot
  ) {
    this.cachedSnapshot = initialSnapshot;
  }

  async warm(): Promise<void> {
    await this.refresh("warm");
  }

  async refresh(_reason: AdapterRefreshReason): Promise<void> {
    if (this.disposed) return;
    const generation = ++this.refreshGeneration;
    let snapshot: AdapterSnapshot;
    try {
      snapshot = await this.loadSnapshot();
    } catch (error) {
      const cached = this.cachedSnapshot;
      const hasCachedData = cached.health.status === "ready" || cached.health.status === "degraded"
        || cached.agents.length > 0 || cached.events.length > 0 || (cached.cloudTasks?.length ?? 0) > 0;
      snapshot = {
        ...cached,
        health: {
          ...cached.health,
          status: hasCachedData ? "degraded" : "error",
          detail: `Snapshot load failed: ${error instanceof Error ? error.message : String(error)}`
        }
      };
    }
    if (this.disposed || generation !== this.refreshGeneration) return;
    this.cachedSnapshot = snapshot;
    for (const listener of this.listeners) {
      if (this.disposed) break;
      try {
        listener();
      } catch {
        // An observer cannot prevent other observers from receiving the update.
      }
    }
  }

  getCachedSnapshot(): AdapterSnapshot {
    return this.cachedSnapshot;
  }

  subscribe(listener: () => void): () => void {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.refreshGeneration++;
    this.listeners.clear();
  }
}
