import { describe, expect, it } from 'vitest';
import { generateDungeon, roomCountForDepth } from '@game/dungeon/generator';
import {
  Tile,
  isWalkable,
  type Dungeon,
  type TileId,
} from '@game/dungeon/types';

/**
 * The generator is the one system where a bad roll is unrecoverable: a boss
 * room sealed behind a wall ends the run through no fault of the player. These
 * tests therefore sweep a few hundred seeds rather than checking one layout.
 */

const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);

/** Flood fills walkable tiles from the start room's centre. */
function reachableTiles(dungeon: Dungeon): number {
  const start = dungeon.rooms[dungeon.startRoom];
  if (start === undefined) return 0;
  const sx = start.tileX + Math.floor(start.tileWidth / 2);
  const sy = start.tileY + Math.floor(start.tileHeight / 2);

  const seen = new Uint8Array(dungeon.width * dungeon.height);
  const stack = [sy * dungeon.width + sx];
  seen[stack[0] as number] = 1;
  let count = 0;

  while (stack.length > 0) {
    const index = stack.pop() as number;
    count++;
    const x = index % dungeon.width;
    const y = Math.floor(index / dungeon.width);
    const neighbours = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ] as const;
    for (const [nx, ny] of neighbours) {
      if (nx < 0 || ny < 0 || nx >= dungeon.width || ny >= dungeon.height) continue;
      const next = ny * dungeon.width + nx;
      if (seen[next] === 1) continue;
      if (!isWalkable((dungeon.tiles[next] ?? Tile.Void) as TileId)) continue;
      seen[next] = 1;
      stack.push(next);
    }
  }
  return count;
}

function countWalkable(dungeon: Dungeon): number {
  let total = 0;
  for (let i = 0; i < dungeon.tiles.length; i++) {
    if (isWalkable((dungeon.tiles[i] ?? Tile.Void) as TileId)) total++;
  }
  return total;
}

describe('generateDungeon', () => {
  it('is deterministic for a given seed', () => {
    const a = generateDungeon({ seed: 4242, depth: 3 });
    const b = generateDungeon({ seed: 4242, depth: 3 });
    expect(Array.from(a.tiles)).toEqual(Array.from(b.tiles));
    expect(a.rooms).toEqual(b.rooms);
  });

  it('produces different layouts for different seeds', () => {
    const a = generateDungeon({ seed: 1, depth: 3 });
    const b = generateDungeon({ seed: 2, depth: 3 });
    expect(Array.from(a.tiles)).not.toEqual(Array.from(b.tiles));
  });

  it('scales room count with depth', () => {
    expect(roomCountForDepth(1)).toBeLessThan(roomCountForDepth(4));
    expect(roomCountForDepth(99)).toBeLessThanOrEqual(16);
  });

  it.each(SEEDS)('seed %i: every walkable tile is reachable from the start', (seed) => {
    const dungeon = generateDungeon({ seed, depth: (seed % 6) + 1 });
    expect(reachableTiles(dungeon)).toBe(countWalkable(dungeon));
  });

  it.each(SEEDS)('seed %i: always has exactly one start and one boss room', (seed) => {
    const dungeon = generateDungeon({ seed, depth: (seed % 6) + 1 });
    expect(dungeon.rooms.filter((r) => r.type === 'start')).toHaveLength(1);
    expect(dungeon.rooms.filter((r) => r.type === 'boss')).toHaveLength(1);
    expect(dungeon.rooms[dungeon.bossRoom]?.type).toBe('boss');
  });

  it.each(SEEDS)('seed %i: doors are symmetric and sit on door tiles', (seed) => {
    const dungeon = generateDungeon({ seed, depth: (seed % 6) + 1 });
    for (const room of dungeon.rooms) {
      expect(room.doors.length).toBeGreaterThan(0);
      for (const door of room.doors) {
        const other = dungeon.rooms[door.to];
        expect(other).toBeDefined();
        expect(other?.doors.some((d) => d.to === room.index)).toBe(true);
        expect(dungeon.tiles[door.tileY * dungeon.width + door.tileX]).toBe(Tile.Door);
      }
    }
  });

  it.each(SEEDS)('seed %i: combat rooms have room to spawn enemies', (seed) => {
    const dungeon = generateDungeon({ seed, depth: (seed % 6) + 1 });
    for (const room of dungeon.rooms) {
      if (room.type === 'shop' || room.type === 'treasure') continue;
      expect(room.spawnPoints.length).toBeGreaterThanOrEqual(8);
    }
  });
});
