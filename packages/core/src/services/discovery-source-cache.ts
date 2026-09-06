/** Bounded callers keep receiving the last completed discovery while slow scans finish. */
export class DiscoverySourceCache<T> {
  private readonly entries = new Map<string, {
    value: T[] | null;
    completedAt: number;
    pending: Promise<void> | null;
    pendingStartedAt: number;
    generation: number;
  }>();

  constructor(
    private readonly timeoutMs = 5000,
    private readonly retentionMs = 60000,
    private readonly now: () => number = Date.now,
    private readonly maxScanMs = 60000
  ) {}

  async read(key: string, load: () => Promise<T[]>): Promise<T[]> {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { value: null, completedAt: 0, pending: null, pendingStartedAt: 0, generation: 0 };
      this.entries.set(key, entry);
    }
    const state = entry;
    if (!state.pending || this.now() - state.pendingStartedAt >= this.maxScanMs) {
      const generation = ++state.generation;
      state.pendingStartedAt = this.now();
      state.pending = Promise.resolve().then(load).then((value) => {
        if (generation !== state.generation) return;
        state.value = value;
        state.completedAt = this.now();
      }, () => {
        // A failed scan neither clears usable evidence nor renews its retention.
      }).finally(() => {
        if (generation === state.generation) state.pending = null;
      });
    }
    const cached = () => state.value !== null && this.now() - state.completedAt < this.retentionMs;
    if (cached()) return state.value!;

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        state.pending,
        new Promise<void>((resolve) => { timer = setTimeout(resolve, this.timeoutMs); })
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    return cached() ? state.value! : [];
  }
}
