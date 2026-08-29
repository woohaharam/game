/**
 * Persistence, written for the environment it actually runs in.
 *
 * A portal build sits in an iframe on someone else's domain, which means
 * `localStorage` can throw on *access*, not just on write: Safari's cross-site
 * tracking prevention and any browser with third-party storage blocked both
 * make the getter itself raise. Feature-detecting by reading `window.localStorage`
 * is therefore not enough — the whole interaction has to be wrapped.
 *
 * When storage is unavailable the game must still be playable; it just cannot
 * remember. An in-memory fallback keeps a single session working rather than
 * showing an error page to a player who did nothing wrong.
 */

export interface KeyValueStore {
  read(key: string): string | null;
  write(key: string, value: string): boolean;
  remove(key: string): void;
  /** False when writes go nowhere, so the UI can warn once. */
  readonly durable: boolean;
}

/**
 * `lib.dom` declares `localStorage` as always present, which is not true of
 * every environment this code is compiled for — it is absent under Node, where
 * the tests run, and absent in some embedded webviews. Reading it through a
 * deliberately weaker type keeps the guard below meaningful instead of leaving
 * it as code the compiler believes is unreachable.
 */
interface StorageGlobals {
  localStorage?: Storage | null;
}

function probeLocalStorage(): Storage | null {
  try {
    const { localStorage: storage } = globalThis as unknown as StorageGlobals;
    if (storage === undefined || storage === null) return null;
    // Some browsers expose the object and reject writes; only a real write proves it.
    const probe = '__deepdelve_probe__';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

class MemoryStore implements KeyValueStore {
  readonly durable = false;
  private readonly entries = new Map<string, string>();

  read(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  write(key: string, value: string): boolean {
    this.entries.set(key, value);
    return true;
  }

  remove(key: string): void {
    this.entries.delete(key);
  }
}

class BrowserStore implements KeyValueStore {
  readonly durable = true;

  constructor(private readonly storage: Storage) {}

  read(key: string): string | null {
    try {
      return this.storage.getItem(key);
    } catch {
      return null;
    }
  }

  write(key: string, value: string): boolean {
    try {
      this.storage.setItem(key, value);
      return true;
    } catch {
      // Quota exhausted, or the user revoked storage mid-session.
      return false;
    }
  }

  remove(key: string): void {
    try {
      this.storage.removeItem(key);
    } catch {
      // Nothing useful to do; the caller is discarding the value anyway.
    }
  }
}

export function createStore(): KeyValueStore {
  const storage = probeLocalStorage();
  return storage === null ? new MemoryStore() : new BrowserStore(storage);
}

export function createMemoryStore(): KeyValueStore {
  return new MemoryStore();
}
