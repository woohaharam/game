/**
 * Versioned localStorage persistence.
 *
 * Save data outlives the code that wrote it, so every record carries a schema
 * version and unknown/older payloads fall back to defaults instead of throwing
 * mid-frame. localStorage can also be unavailable outright (private mode,
 * sandboxed iframe, disabled cookies) — persistence failing must never stop the
 * game from being playable.
 */
export interface Persisted<T> {
  version: number;
  data: T;
}

export class SaveStore<T extends object> {
  private cache: T;
  private available: boolean;

  constructor(
    private readonly key: string,
    private readonly version: number,
    private readonly defaults: T,
  ) {
    this.available = SaveStore.probe();
    this.cache = this.read();
  }

  private static probe(): boolean {
    try {
      const probeKey = '__probe__';
      window.localStorage.setItem(probeKey, '1');
      window.localStorage.removeItem(probeKey);
      return true;
    } catch {
      return false;
    }
  }

  private read(): T {
    if (!this.available) return { ...this.defaults };
    try {
      const raw = window.localStorage.getItem(this.key);
      if (raw === null) return { ...this.defaults };
      const parsed = JSON.parse(raw) as Persisted<T>;
      if (parsed.version !== this.version) return { ...this.defaults };
      // Spread over defaults so a field added in a later build is present
      // even when the stored payload predates it.
      return { ...this.defaults, ...parsed.data };
    } catch {
      return { ...this.defaults };
    }
  }

  get value(): Readonly<T> {
    return this.cache;
  }

  update(patch: Partial<T>): void {
    this.cache = { ...this.cache, ...patch };
    this.flush();
  }

  reset(): void {
    this.cache = { ...this.defaults };
    this.flush();
  }

  private flush(): void {
    if (!this.available) return;
    try {
      const payload: Persisted<T> = { version: this.version, data: this.cache };
      window.localStorage.setItem(this.key, JSON.stringify(payload));
    } catch {
      // Quota exceeded or storage revoked mid-session: drop the write and
      // keep playing from the in-memory cache.
      this.available = false;
    }
  }
}
