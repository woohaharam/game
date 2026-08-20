import {
  decodeReplay,
  encodeReplay,
  fromBase64Url,
  toBase64Url,
  type ReplayData,
} from './format';

/**
 * Replay persistence.
 *
 * Kept out of the profile store: a replay is tens of kilobytes and the profile
 * is rewritten on every run, so mixing them would mean re-serialising the whole
 * recording to bump a score. Two slots are held — the most recent run, and the
 * best-scoring one — because those are the two a player actually asks for.
 *
 * Every read is defensive. Replays outlive the code that recorded them, and a
 * payload from an older format must degrade to "no replay available" rather
 * than throwing on the title screen.
 */
const LAST_KEY = 'neon-depths/replay/last';
const BEST_KEY = 'neon-depths/replay/best';

function write(key: string, replay: ReplayData): boolean {
  try {
    window.localStorage.setItem(key, toBase64Url(encodeReplay(replay)));
    return true;
  } catch {
    // Quota exhausted or storage unavailable. A missing replay is a missing
    // feature, never a broken run.
    return false;
  }
}

function read(key: string): ReplayData | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    return decodeReplay(fromBase64Url(raw));
  } catch {
    // Corrupt or written by an incompatible build: drop it so the bad payload
    // is not retried on every visit.
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* storage is gone entirely; nothing to clean up */
    }
    return null;
  }
}

export function saveReplay(replay: ReplayData): void {
  write(LAST_KEY, replay);

  const best = read(BEST_KEY);
  if (best === null || replay.meta.score > best.meta.score) {
    write(BEST_KEY, replay);
  }
}

export function loadLastReplay(): ReplayData | null {
  return read(LAST_KEY);
}

export function loadBestReplay(): ReplayData | null {
  return read(BEST_KEY);
}

/** Serialises a replay for the clipboard. */
export function exportReplay(replay: ReplayData): string {
  return toBase64Url(encodeReplay(replay));
}

/** Parses a pasted replay, returning null rather than throwing on junk. */
export function importReplay(text: string): ReplayData | null {
  try {
    return decodeReplay(fromBase64Url(text.trim()));
  } catch {
    return null;
  }
}

/** Encoded size in bytes, for the UI to show what a share would cost. */
export function replaySize(replay: ReplayData): number {
  return encodeReplay(replay).length;
}
