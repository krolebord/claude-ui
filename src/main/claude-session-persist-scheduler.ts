export const SESSION_ACTIVITY_PERSIST_DEBOUNCE_MS = 1000;

export class SessionSnapshotPersistScheduler {
  private pendingPersist: NodeJS.Timeout | null = null;

  constructor(
    private readonly persist: () => void,
    private readonly debounceMs = SESSION_ACTIVITY_PERSIST_DEBOUNCE_MS,
  ) {}

  schedule(): void {
    if (this.pendingPersist) {
      return;
    }

    this.pendingPersist = setTimeout(() => {
      this.pendingPersist = null;
      this.persist();
    }, this.debounceMs);
  }

  clear(): void {
    if (!this.pendingPersist) {
      return;
    }

    clearTimeout(this.pendingPersist);
    this.pendingPersist = null;
  }
}
