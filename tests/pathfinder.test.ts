import { describe, expect, it } from 'vitest';
import { generateDungeon } from '@game/dungeon/generator';
import { TILE_SIZE, roomCenter } from '@game/dungeon/types';
import { findPath, lineIsClear } from '../tools/pathfinder';

/**
 * The pathfinder exists because the cheap assumption it replaced was measured
 * and found wanting: on 60 seeds, the straight line between adjacent room
 * centres is blocked 21% of the time by interior cover. These tests pin both
 * halves of that — the measurement that justified the work, and the routine
 * that fixed it.
 */
describe('lineIsClear', () => {
  it('agrees with itself in both directions', () => {
    const dungeon = generateDungeon({ seed: 7, depth: 2 });
    const [a, b] = dungeon.rooms;
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    const from = roomCenter(a!);
    const to = roomCenter(b!);
    expect(lineIsClear(dungeon, from.x, from.y, to.x, to.y)).toBe(
      lineIsClear(dungeon, to.x, to.y, from.x, from.y),
    );
  });

  it('rejects a line that leaves the map', () => {
    const dungeon = generateDungeon({ seed: 3, depth: 1 });
    const start = roomCenter(dungeon.rooms[dungeon.startRoom]!);
    expect(lineIsClear(dungeon, start.x, start.y, -5000, -5000)).toBe(false);
  });
});

describe('findPath', () => {
  it('reaches every room from the start, on every seed', () => {
    // The generator already guarantees connectivity; this checks the *walker*
    // can realise it, which is what the bot depends on.
    for (let seed = 1; seed <= 40; seed++) {
      const dungeon = generateDungeon({ seed, depth: (seed % 5) + 1 });
      const start = roomCenter(dungeon.rooms[dungeon.startRoom]!);
      for (const room of dungeon.rooms) {
        const target = roomCenter(room);
        const path = findPath(dungeon, start.x, start.y, target.x, target.y);
        if (room.index === dungeon.startRoom) continue;
        expect(path.length, `seed ${seed} room ${room.index} (${room.type})`).toBeGreaterThan(
          0,
        );
      }
    }
  });

  it('produces a route whose every leg is walkable', () => {
    for (let seed = 1; seed <= 15; seed++) {
      const dungeon = generateDungeon({ seed, depth: 2 });
      const start = roomCenter(dungeon.rooms[dungeon.startRoom]!);
      const boss = roomCenter(dungeon.rooms[dungeon.bossRoom]!);
      const path = findPath(dungeon, start.x, start.y, boss.x, boss.y);
      expect(path.length).toBeGreaterThan(0);

      let x = start.x;
      let y = start.y;
      for (const point of path) {
        expect(lineIsClear(dungeon, x, y, point.x, point.y), `seed ${seed}`).toBe(true);
        x = point.x;
        y = point.y;
      }
    }
  });

  it('smooths the grid path instead of returning one point per tile', () => {
    const dungeon = generateDungeon({ seed: 11, depth: 3 });
    const start = roomCenter(dungeon.rooms[dungeon.startRoom]!);
    const boss = roomCenter(dungeon.rooms[dungeon.bossRoom]!);
    const path = findPath(dungeon, start.x, start.y, boss.x, boss.y);

    const straightLineTiles = Math.hypot(boss.x - start.x, boss.y - start.y) / TILE_SIZE;
    // A raw grid path is at least one waypoint per tile travelled; a smoothed
    // one is a handful of turns.
    expect(path.length).toBeLessThan(straightLineTiles / 2);
  });

  it('returns an empty route rather than throwing when the target is solid', () => {
    const dungeon = generateDungeon({ seed: 5, depth: 1 });
    const start = roomCenter(dungeon.rooms[dungeon.startRoom]!);
    expect(findPath(dungeon, start.x, start.y, 0, 0)).toEqual([]);
    expect(findPath(dungeon, -100, -100, start.x, start.y)).toEqual([]);
  });

  it('is a no-op when already at the destination', () => {
    const dungeon = generateDungeon({ seed: 9, depth: 1 });
    const start = roomCenter(dungeon.rooms[dungeon.startRoom]!);
    expect(findPath(dungeon, start.x, start.y, start.x, start.y)).toHaveLength(1);
  });
});

describe('the assumption this replaced', () => {
  it('confirms centre-to-centre lines really are blocked often enough to matter', () => {
    let pairs = 0;
    let blocked = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const dungeon = generateDungeon({ seed, depth: (seed % 5) + 1 });
      for (const room of dungeon.rooms) {
        const from = roomCenter(room);
        for (const door of room.doors) {
          const other = dungeon.rooms[door.to];
          if (other === undefined) continue;
          const to = roomCenter(other);
          pairs++;
          if (!lineIsClear(dungeon, from.x, from.y, to.x, to.y)) blocked++;
        }
      }
    }
    // Pinned as a range, not a point: this is a property of the obstacle
    // patterns, and if it ever drops near zero the pathfinder could be
    // reconsidered.
    expect(pairs).toBeGreaterThan(500);
    expect(blocked / pairs).toBeGreaterThan(0.1);
    expect(blocked / pairs).toBeLessThan(0.4);
  });
});
