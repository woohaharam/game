/**
 * Deterministic pseudo-random number generator.
 *
 * The whole run — dungeon layout, enemy composition, loot rolls — is derived
 * from a single 32-bit seed, which is what makes a run shareable ("seed 12345"
 * plays identically on every machine) and makes the generators unit-testable.
 *
 * Implementation is mulberry32: tiny, fast, and statistically good enough for
 * gameplay. It is NOT cryptographically secure and must never be used as such.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    // Force to an unsigned 32-bit integer; 0 is a degenerate state for mulberry32.
    this.state = seed >>> 0 || 0x9e3779b9;
  }

  /** Hashes an arbitrary string into a seed, so "cavern" is a valid seed. */
  static fromString(text: string): Rng {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return new Rng(h >>> 0);
  }

  /** Current internal state — snapshot it to resume an identical sequence. */
  get seed(): number {
    return this.state;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform float in [min, max). */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in [min, max] inclusive on both ends. */
  int(min: number, max: number): number {
    return Math.floor(this.float(min, max + 1));
  }

  /** True with probability `chance` (0 = never, 1 = always). */
  chance(probability: number): boolean {
    return this.next() < probability;
  }

  /** Uniform angle in radians. */
  angle(): number {
    return this.next() * Math.PI * 2;
  }

  /** +1 or -1. */
  sign(): number {
    return this.next() < 0.5 ? -1 : 1;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: empty array');
    return items[this.int(0, items.length - 1)] as T;
  }

  /**
   * Weighted pick. `weightOf` must return a non-negative number; entries
   * weighted 0 are never selected.
   */
  pickWeighted<T>(items: readonly T[], weightOf: (item: T) => number): T {
    let total = 0;
    for (const item of items) total += Math.max(0, weightOf(item));
    if (total <= 0) return this.pick(items);

    let roll = this.next() * total;
    for (const item of items) {
      roll -= Math.max(0, weightOf(item));
      if (roll < 0) return item;
    }
    return items[items.length - 1] as T;
  }

  /** In-place Fisher-Yates shuffle; returns the same array for chaining. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const tmp = items[i] as T;
      items[i] = items[j] as T;
      items[j] = tmp;
    }
    return items;
  }

  /** Picks `count` distinct items without mutating the source array. */
  sample<T>(items: readonly T[], count: number): T[] {
    return this.shuffle([...items]).slice(0, Math.min(count, items.length));
  }
}
