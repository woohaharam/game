import { describe, expect, it } from 'vitest';
import { AudioBus } from '@engine/audio';
import { Camera } from '@engine/camera';
import { Rng } from '@engine/rng';
import { World, type PlayerIntent } from '@game/world';
import { TILE_SIZE, roomCenter } from '@game/dungeon/types';
import { isSolidAt } from '@game/collision';

/**
 * Headless simulation tests.
 *
 * These exist as much to prove an architectural claim as to catch bugs: the
 * whole game advances through `World.update(step, intent)` with no canvas, no
 * DOM and no rendering anywhere in the call graph. That is what lets thousands
 * of simulated ticks run in CI in under a second, and it is the difference
 * between a game you can test and one you can only play.
 *
 * `AudioBus` is safe here because it stays inert until `unlock()` is called
 * from a user gesture, and `Camera` only needs an RNG for shake.
 */
function makeWorld(seed: number): World {
  const camera = new Camera(1024, 576, new Rng(seed));
  return new World(seed, new AudioBus(), camera);
}

const IDLE: PlayerIntent = {
  move: { x: 0, y: 0 },
  aimX: 0,
  aimY: 0,
  firing: false,
  dashPressed: false,
};

/** Steers at the nearest enemy and holds fire — enough to clear a room. */
function botIntent(world: World): PlayerIntent {
  let targetX = world.player.x;
  let targetY = world.player.y;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const enemy of world.enemies) {
    if (!enemy.alive || enemy.spawnTimer > 0) continue;
    const distance = Math.hypot(enemy.x - world.player.x, enemy.y - world.player.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      targetX = enemy.x;
      targetY = enemy.y;
    }
  }

  // Strafe rather than charging in, so the bot survives long enough to matter.
  const angle = Math.atan2(targetY - world.player.y, targetX - world.player.x);
  const strafe = angle + Math.PI / 2;
  return {
    move: { x: Math.cos(strafe), y: Math.sin(strafe) },
    aimX: targetX,
    aimY: targetY,
    firing: bestDistance < Number.POSITIVE_INFINITY,
    dashPressed: false,
  };
}

function step(world: World, seconds: number, intent: (w: World) => PlayerIntent): void {
  const dt = 1 / 60;
  for (let i = 0; i < Math.round(seconds * 60); i++) world.update(dt, intent(world));
}

describe('World (headless)', () => {
  it('starts a run without touching the DOM', () => {
    const world = makeWorld(1234);
    world.startRun(1234);
    expect(world.dungeon.rooms.length).toBeGreaterThan(4);
    expect(world.player.alive).toBe(true);
    expect(world.player.health).toBe(world.run.stats.maxHealth);
    expect(world.run.depth).toBe(1);
  });

  it('places the player on walkable ground in the start room', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const world = makeWorld(seed);
      world.startRun(seed);
      expect(isSolidAt(world.dungeon, world.player.x, world.player.y, false)).toBe(false);
    }
  });

  it('keeps the player inside the map over a long idle run', () => {
    const world = makeWorld(7);
    world.startRun(7);
    step(world, 20, () => IDLE);
    expect(Number.isFinite(world.player.x)).toBe(true);
    expect(Number.isFinite(world.player.y)).toBe(true);
    expect(world.player.x).toBeGreaterThan(0);
    expect(world.player.y).toBeGreaterThan(0);
    expect(world.player.x).toBeLessThan(world.dungeon.width * TILE_SIZE);
    expect(world.player.y).toBeLessThan(world.dungeon.height * TILE_SIZE);
  });

  it('locks the doors when a combat room activates, and opens them on clear', () => {
    const world = makeWorld(99);
    world.startRun(99);

    const combat = world.dungeon.rooms.find((r) => r.type === 'combat');
    expect(combat).toBeDefined();
    const centre = roomCenter(combat!);
    world.player.x = world.player.px = centre.x;
    world.player.y = world.player.py = centre.y;

    step(world, 1.5, () => IDLE);
    expect(world.roomPhase).toBe('combat');
    expect(world.doorsLocked).toBe(true);
    expect(world.enemies.filter((e) => e.alive).length).toBeGreaterThan(0);

    // Remove the opposition and let the clear timer run.
    for (const enemy of world.enemies) if (enemy.alive) enemy.health = 0;
    step(world, 1.5, () => IDLE);

    expect(world.doorsLocked).toBe(false);
    expect(combat!.cleared).toBe(true);
    expect(world.run.roomsCleared).toBeGreaterThan(0);
  });

  it('lets a firing bot clear a floor-1 combat room and score for it', () => {
    const world = makeWorld(2024);
    world.startRun(2024);
    // Immortal for this test: we are asserting that combat resolves, not that
    // a scripted bot can dodge.
    world.player.takeDamage = () => false;

    const combat = world.dungeon.rooms.find((r) => r.type === 'combat');
    const centre = roomCenter(combat!);
    world.player.x = world.player.px = centre.x;
    world.player.y = world.player.py = centre.y;

    step(world, 45, botIntent);

    expect(world.run.kills).toBeGreaterThan(0);
    expect(world.run.score).toBeGreaterThan(0);
    expect(combat!.cleared).toBe(true);
  });

  it('spawns a boss in the boss room and opens a portal when it dies', () => {
    const world = makeWorld(31337);
    world.startRun(31337);
    const boss = world.dungeon.rooms[world.dungeon.bossRoom]!;
    const centre = roomCenter(boss);
    world.player.x = world.player.px = centre.x;
    world.player.y = world.player.py = centre.y + 100;
    world.player.takeDamage = () => false;

    step(world, 2, () => IDLE);
    expect(world.activeBoss).not.toBeNull();
    expect(world.tension).toBe(1);

    world.activeBoss!.health = 0;
    step(world, 2, () => IDLE);

    expect(world.activeBoss).toBeNull();
    expect(world.exitPortal.active).toBe(true);
    expect(world.run.score).toBeGreaterThan(0);
  });

  it('never lets an entity end a tick inside solid geometry', () => {
    const world = makeWorld(4242);
    world.startRun(4242);
    const combat = world.dungeon.rooms.find((r) => r.type === 'combat')!;
    const centre = roomCenter(combat);
    world.player.x = world.player.px = centre.x;
    world.player.y = world.player.py = centre.y;
    world.player.takeDamage = () => false;

    const dt = 1 / 60;
    for (let i = 0; i < 60 * 20; i++) {
      world.update(dt, botIntent(world));
      expect(isSolidAt(world.dungeon, world.player.x, world.player.y, world.doorsLocked)).toBe(
        false,
      );
      for (const enemy of world.enemies) {
        if (!enemy.alive || enemy.spawnTimer > 0) continue;
        expect(Number.isFinite(enemy.x)).toBe(true);
        expect(Number.isFinite(enemy.y)).toBe(true);
      }
    }
  });

  it('advances to a fresh floor with the build intact', () => {
    const world = makeWorld(555);
    world.startRun(555);
    world.run.addUpgrade('sharp-rounds');
    const damageBefore = world.run.stats.damage;
    const layoutBefore = Array.from(world.dungeon.tiles);

    world.run.advanceFloor();
    world.startFloor(2);

    expect(world.run.depth).toBe(2);
    expect(world.run.stats.damage).toBe(damageBefore);
    expect(Array.from(world.dungeon.tiles)).not.toEqual(layoutBefore);
    expect(world.enemies.every((e) => !e.alive)).toBe(true);
    expect(world.exitPortal.active).toBe(false);
  });

  it('replays identically from the same seed', () => {
    const trace = (seed: number): string => {
      const world = makeWorld(seed);
      world.startRun(seed);
      const combat = world.dungeon.rooms.find((r) => r.type === 'combat')!;
      const centre = roomCenter(combat);
      world.player.x = world.player.px = centre.x;
      world.player.y = world.player.py = centre.y;
      world.player.takeDamage = () => false;
      step(world, 12, botIntent);
      return JSON.stringify({
        x: world.player.x.toFixed(4),
        y: world.player.y.toFixed(4),
        score: world.run.score,
        kills: world.run.kills,
        alive: world.enemies.filter((e) => e.alive).length,
      });
    };
    expect(trace(8080)).toBe(trace(8080));
  });

  it('does nothing while paused', () => {
    const world = makeWorld(12);
    world.startRun(12);
    world.paused = true;
    const x = world.player.x;
    step(world, 3, () => ({ ...IDLE, move: { x: 1, y: 0 } }));
    expect(world.player.x).toBe(x);
  });
});
