import { describe, expect, it } from 'vitest';
import { Rng } from '@engine/rng';
import { baseStats } from '@game/progression/stats';
import { explosionFalloff, resolvePlayerDamage, rollDamage } from '@game/combat/damage';
import { budgetFor, planSpawns } from '@game/spawn-director';
import { ENEMIES } from '@game/config';
import {
  hasLineOfSight,
  isSolidAt,
  isSolidTile,
  resolveCircle,
  type CollisionResult,
} from '@game/collision';
import { TILE_SIZE, Tile, type Dungeon } from '@game/dungeon/types';

describe('damage resolution', () => {
  it('never rounds a hit down to zero', () => {
    const stats = { ...baseStats(), damage: 1 };
    const result = rollDamage(stats, new Rng(1), 0.01);
    expect(result.amount).toBeGreaterThanOrEqual(1);
  });

  it('applies the crit multiplier when a crit is rolled', () => {
    // critChance 1 forces the crit branch deterministically.
    const stats = { ...baseStats(), critChance: 1, critMultiplier: 3, damage: 10 };
    const result = rollDamage(stats, new Rng(1));
    expect(result.critical).toBe(true);
    expect(result.amount).toBe(30);
  });

  it('never crits at zero crit chance', () => {
    const stats = { ...baseStats(), critChance: 0 };
    const rng = new Rng(9);
    for (let i = 0; i < 500; i++) expect(rollDamage(stats, rng).critical).toBe(false);
  });

  it('crit rate tracks the configured chance', () => {
    const stats = { ...baseStats(), critChance: 0.25 };
    const rng = new Rng(4);
    let crits = 0;
    for (let i = 0; i < 20_000; i++) if (rollDamage(stats, rng).critical) crits++;
    expect(crits / 20_000).toBeGreaterThan(0.23);
    expect(crits / 20_000).toBeLessThan(0.27);
  });

  it('armour reduces damage but never fully negates a hit', () => {
    expect(resolvePlayerDamage(3, 1)).toBe(2);
    // Stacking armour past the damage value must not make the player immortal.
    expect(resolvePlayerDamage(1, 99)).toBe(1);
  });

  it('explosion falloff is full at the centre and zero past the rim', () => {
    expect(explosionFalloff(0, 50)).toBe(1);
    expect(explosionFalloff(49.9, 50)).toBeGreaterThan(0);
    expect(explosionFalloff(50, 50)).toBe(0);
    expect(explosionFalloff(80, 50)).toBe(0);
  });

  it('explosion falloff decreases monotonically', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let d = 0; d <= 60; d += 2) {
      const value = explosionFalloff(d, 60);
      expect(value).toBeLessThanOrEqual(previous);
      previous = value;
    }
  });
});

describe('spawn director', () => {
  it('scales the budget with depth and marks elites harder', () => {
    expect(budgetFor(4, 'combat')).toBeGreaterThan(budgetFor(1, 'combat'));
    expect(budgetFor(3, 'elite')).toBeGreaterThan(budgetFor(3, 'combat'));
  });

  it('always spawns at least one enemy', () => {
    for (let seed = 1; seed <= 100; seed++) {
      for (let depth = 1; depth <= 8; depth++) {
        expect(planSpawns(new Rng(seed), depth, 'combat').kinds.length).toBeGreaterThan(0);
      }
    }
  });

  it('spends close to the budget without blowing past it', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const depth = (seed % 6) + 1;
      const plan = planSpawns(new Rng(seed), depth, 'combat');
      const spent = plan.kinds.reduce((total, kind) => total + ENEMIES[kind].cost, 0);
      expect(spent).toBeLessThanOrEqual(plan.budget + 0.001);
      // The cheapest enemy costs 1, so a well-behaved plan leaves under that.
      expect(plan.budget - spent).toBeLessThan(1);
    }
  });

  it('withholds late-game archetypes on floor 1', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const plan = planSpawns(new Rng(seed), 1, 'combat');
      expect(plan.kinds).not.toContain('brute');
      expect(plan.kinds).not.toContain('bomber');
    }
  });

  it('is deterministic for a seed', () => {
    expect(planSpawns(new Rng(55), 4, 'elite').kinds).toEqual(
      planSpawns(new Rng(55), 4, 'elite').kinds,
    );
  });
});

/** A tiny hand-built map: a 5x5 open room ringed by wall, with one door. */
function testDungeon(): Dungeon {
  const width = 7;
  const height = 7;
  const tiles = new Uint8Array(width * height).fill(Tile.Wall);
  for (let y = 1; y <= 5; y++) {
    for (let x = 1; x <= 5; x++) tiles[y * width + x] = Tile.Floor;
  }
  tiles[3 * width + 6] = Tile.Door;
  return {
    seed: 0, depth: 1, rooms: [], startRoom: 0, bossRoom: 0,
    tiles, width, height,
  };
}

describe('collision', () => {
  const result: CollisionResult = { x: 0, y: 0, hitX: false, hitY: false };

  it('treats doors as solid only while locked', () => {
    expect(isSolidTile(Tile.Door, true)).toBe(true);
    expect(isSolidTile(Tile.Door, false)).toBe(false);
    expect(isSolidTile(Tile.Wall, false)).toBe(true);
    expect(isSolidTile(Tile.Floor, true)).toBe(false);
  });

  it('treats out-of-bounds as solid so nothing escapes the map', () => {
    const dungeon = testDungeon();
    expect(isSolidAt(dungeon, -10, -10, false)).toBe(true);
    expect(isSolidAt(dungeon, 1e6, 1e6, false)).toBe(true);
  });

  it('leaves a circle in open space untouched', () => {
    const dungeon = testDungeon();
    const x = 3.5 * TILE_SIZE;
    const y = 3.5 * TILE_SIZE;
    resolveCircle(dungeon, x, y, 10, false, result);
    expect(result.x).toBeCloseTo(x, 6);
    expect(result.y).toBeCloseTo(y, 6);
    expect(result.hitX).toBe(false);
    expect(result.hitY).toBe(false);
  });

  it('pushes a circle out of a wall it overlaps', () => {
    const dungeon = testDungeon();
    // Sitting just inside the left wall's face.
    const x = TILE_SIZE + 4;
    const y = 3.5 * TILE_SIZE;
    resolveCircle(dungeon, x, y, 10, false, result);
    expect(result.x).toBeGreaterThan(x);
    expect(isSolidAt(dungeon, result.x - 10 + 0.01, result.y, false)).toBe(false);
  });

  it('never leaves an entity embedded in geometry, from any approach', () => {
    const dungeon = testDungeon();
    const radius = 11;
    // Distances up to 90px cover everything reachable in play: standing in the
    // open, pressed against a wall, and jammed into a corner. Positions fully
    // outside the map are excluded — there is no valid answer to "push me out"
    // when every neighbouring tile is solid, and the game never creates one
    // (spawn points are pre-validated and collision runs every tick).
    for (let angle = 0; angle < Math.PI * 2; angle += 0.2) {
      for (const distance of [10, 45, 75, 90]) {
        const x = 3.5 * TILE_SIZE + Math.cos(angle) * distance;
        const y = 3.5 * TILE_SIZE + Math.sin(angle) * distance;
        resolveCircle(dungeon, x, y, radius, false, result);
        // Sample the resolved circle's rim: none of it may be inside a solid.
        for (let a = 0; a < Math.PI * 2; a += 0.4) {
          const px = result.x + Math.cos(a) * (radius - 0.5);
          const py = result.y + Math.sin(a) * (radius - 0.5);
          expect(isSolidAt(dungeon, px, py, false)).toBe(false);
        }
      }
    }
  });

  it('reports line of sight through open floor and blocks it through wall', () => {
    const dungeon = testDungeon();
    const a = { x: 1.5 * TILE_SIZE, y: 3.5 * TILE_SIZE };
    const b = { x: 4.5 * TILE_SIZE, y: 3.5 * TILE_SIZE };
    expect(hasLineOfSight(dungeon, a.x, a.y, b.x, b.y)).toBe(true);
    // Straight up crosses the top wall.
    expect(hasLineOfSight(dungeon, a.x, a.y, a.x, -TILE_SIZE)).toBe(false);
  });

  it('treats a zero-length sightline as clear', () => {
    const dungeon = testDungeon();
    expect(hasLineOfSight(dungeon, 50, 50, 50, 50)).toBe(true);
  });
});
