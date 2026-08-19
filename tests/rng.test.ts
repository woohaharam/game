import { describe, expect, it } from 'vitest';
import { Rng } from '@engine/rng';

/**
 * The RNG underpins every reproducible thing in the game — dungeon layout,
 * spawn tables, loot rolls. If it drifts, "seed 1234" stops meaning anything,
 * so its contract is pinned here rather than assumed.
 */
describe('Rng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = new Rng(1234);
    const b = new Rng(1234);
    const left = Array.from({ length: 50 }, () => a.next());
    const right = Array.from({ length: 50 }, () => b.next());
    expect(left).toEqual(right);
  });

  it('produces different sequences for different seeds', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    expect(a.next()).not.toBe(b.next());
  });

  it('never returns a degenerate state for seed 0', () => {
    const rng = new Rng(0);
    const values = Array.from({ length: 20 }, () => rng.next());
    expect(new Set(values).size).toBeGreaterThan(15);
  });

  it('stays inside [0, 1)', () => {
    const rng = new Rng(99);
    for (let i = 0; i < 20_000; i++) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('is roughly uniform across ten buckets', () => {
    const rng = new Rng(7);
    const buckets = new Array<number>(10).fill(0);
    const samples = 100_000;
    for (let i = 0; i < samples; i++) {
      buckets[Math.floor(rng.next() * 10)]!++;
    }
    // Each bucket should hold ~10%; ±1.5% is a generous band that still
    // catches a genuinely broken generator.
    for (const count of buckets) {
      expect(count / samples).toBeGreaterThan(0.085);
      expect(count / samples).toBeLessThan(0.115);
    }
  });

  it('int() is inclusive on both ends', () => {
    const rng = new Rng(5);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) seen.add(rng.int(1, 3));
    expect([...seen].sort()).toEqual([1, 2, 3]);
  });

  it('hashes strings into stable seeds', () => {
    expect(Rng.fromString('cavern').seed).toBe(Rng.fromString('cavern').seed);
    expect(Rng.fromString('cavern').seed).not.toBe(Rng.fromString('caverns').seed);
  });

  it('pickWeighted respects the weights', () => {
    const rng = new Rng(11);
    const counts = { a: 0, b: 0 };
    for (let i = 0; i < 10_000; i++) {
      counts[rng.pickWeighted(['a', 'b'] as const, (k) => (k === 'a' ? 9 : 1))]++;
    }
    expect(counts.a / 10_000).toBeGreaterThan(0.85);
    expect(counts.a / 10_000).toBeLessThan(0.95);
  });

  it('pickWeighted never selects a zero-weighted entry', () => {
    const rng = new Rng(3);
    for (let i = 0; i < 500; i++) {
      expect(rng.pickWeighted(['keep', 'skip'], (k) => (k === 'skip' ? 0 : 1))).toBe('keep');
    }
  });

  it('shuffle keeps every element exactly once', () => {
    const rng = new Rng(21);
    const source = Array.from({ length: 40 }, (_, i) => i);
    const shuffled = rng.shuffle([...source]);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(source);
    expect(shuffled).not.toEqual(source);
  });

  it('sample returns distinct items without mutating the source', () => {
    const rng = new Rng(31);
    const source = [1, 2, 3, 4, 5];
    const picked = rng.sample(source, 3);
    expect(picked).toHaveLength(3);
    expect(new Set(picked).size).toBe(3);
    expect(source).toEqual([1, 2, 3, 4, 5]);
  });
});
