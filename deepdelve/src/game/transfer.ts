/**
 * Moving a save between browsers, as a code the player can copy.
 *
 * A portal game has no accounts, so a save lives in one browser's storage and
 * dies with it — cleared site data, a new phone, a switch from the portal's app
 * to its website. That is the single most common way a player loses a run they
 * cared about, and the fix is not a backend. It is a string they can paste.
 *
 * The format is `DD1.<base64 payload>.<checksum>`. The checksum is the point:
 * a code that survives a chat app, an email client, or a double-click selection
 * that clipped the last character has to be *rejected*, not loaded as a
 * plausible-looking ruin of somebody's progress. Base64 alone cannot tell the
 * difference; a checksum can.
 *
 * This is deliberately not encryption. Anyone can decode and edit their own
 * save, and that is fine — the game is single-player with no leaderboard, so
 * the only person a forged code can cheat is the person who forged it. Saves
 * are validated on load regardless, because a hand-edited file arriving through
 * this path is no different from one arriving through storage.
 */

const PREFIX = 'DD1';

/**
 * FNV-1a, 32-bit.
 *
 * Not a cryptographic hash and not trying to be — the threat here is
 * transcription damage, not forgery. It catches truncation and any single
 * character change, costs a few lines, and adds eight characters to the code.
 */
function checksum(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    // The FNV prime, applied with shifts because `hash * 16777619` exceeds the
    // exact integer range and would silently lose the low bits.
    hash =
      (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** UTF-8 safe base64; `btoa` alone throws on anything outside Latin-1. */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(encoded: string): string | null {
  try {
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/** Wraps an encoded save in a transferable code. */
export function toTransferCode(payload: string): string {
  const encoded = toBase64(payload);
  return `${PREFIX}.${encoded}.${checksum(encoded)}`;
}

export type TransferResult =
  | { readonly ok: true; readonly payload: string }
  | { readonly ok: false; readonly reason: 'empty' | 'format' | 'damaged' };

/**
 * Unwraps a code, refusing anything that does not verify.
 *
 * Whitespace and surrounding quotes are stripped first: a code that has been
 * through a chat app arrives wrapped in whatever that app added, and failing a
 * player for their client's line wrapping would be the wrong lesson.
 */
export function fromTransferCode(code: string): TransferResult {
  const cleaned = code.replace(/\s+/g, '').replace(/^["']|["']$/g, '');
  if (cleaned === '') return { ok: false, reason: 'empty' };

  const parts = cleaned.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'format' };

  const [prefix, encoded, stamp] = parts as [string, string, string];
  if (prefix !== PREFIX) return { ok: false, reason: 'format' };
  if (checksum(encoded) !== stamp) return { ok: false, reason: 'damaged' };

  const payload = fromBase64(encoded);
  if (payload === null) return { ok: false, reason: 'damaged' };

  return { ok: true, payload };
}
