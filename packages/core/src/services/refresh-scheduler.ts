export class RefreshScheduler {
  private readonly intervals = new Set<NodeJS.Timeout>();
  private readonly timeouts = new Map<string, NodeJS.Timeout>();

  interval(task: () => void | Promise<void>, everyMs: number): void {
    const timer = setInterval(() => {
      void task();
    }, everyMs);
    this.intervals.add(timer);
  }

  debounce(key: string, delayMs: number, task: () => void | Promise<void>): void {
    const existing = this.timeouts.get(key);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.timeouts.delete(key);
      void task();
    }, delayMs);
    this.timeouts.set(key, timer);
  }

  clear(key: string): void {
    const timer = this.timeouts.get(key);
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    this.timeouts.delete(key);
  }

  dispose(): void {
    for (const timer of this.intervals) {
      clearInterval(timer);
    }
    this.intervals.clear();

    for (const timer of this.timeouts.values()) {
      clearTimeout(timer);
    }
    this.timeouts.clear();
  }
}

