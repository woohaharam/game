/**
 * A small seeded PRNG.
 *
 * The stone's shape has to be *stable*: the same stage must produce the same
 * silhouette, the same craters and the same rings every time it is drawn, or
 * the thing the player is growing appears to writhe. `Math.random` cannot do
 * that, so the renderer draws from a generator seeded by the stage instead.
 *
 * mulberry32 because it is nine lines, has no state beyond a 32-bit integer,
 * and passes the statistical bar that "scatter some craters" actually needs.
 * Nothing here is security-sensitive and nothing is shared with the
 * simulation — which has no randomness at all, deliberately.
 */
export type Random = () => number;

export function mulberry32(seed: number): Random {
  // `>>> 0` keeps the state an unsigned 32-bit integer through the arithmetic
  // below; without it the shifts start operating on a sign-extended value and
  // the sequence degrades.
  let state = seed >>> 0;

  return function next(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A float in `[min, max)`. */
export function between(random: Random, min: number, max: number): number {
  return min + random() * (max - min);
}
