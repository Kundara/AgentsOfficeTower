import type { AdapterSnapshot, ProjectSource, AdapterRefreshReason } from "./types";

type SnapshotLoader = () => Promise<AdapterSnapshot>;

export class StaticProjectSource implements ProjectSource {
  private cachedSnapshot: AdapterSnapshot;
  private readonly listeners = new Set<() => void>();

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
    this.cachedSnapshot = await this.loadSnapshot();
    for (const listener of this.listeners) {
      listener();
    }
  }

  getCachedSnapshot(): AdapterSnapshot {
    return this.cachedSnapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async dispose(): Promise<void> {
    this.listeners.clear();
  }
}

