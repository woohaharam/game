import { describe, expect, it } from 'vitest';
import { AudioBus } from '@engine/audio';
import { Camera } from '@engine/camera';
import { Rng } from '@engine/rng';
import { World, type PlayerIntent } from '@game/world';
import { roomCenter } from '@game/dungeon/types';
import { ReplayPlayer, ReplayRecorder } from '@game/replay/recorder';
import {
  decodeReplay,
  dequantise,
  encodeReplay,
  fromBase64Url,
  quantise,
  toBase64Url,
  type ReplayData,
} from '@game/replay/format';

/**
 * The replay system's only real claim is that a recording re-simulates into
 * the identical run. Everything else — the codec, the size, the UI — is in
 * service of that, so it is what these tests actually check: play a run, feed
 * the recording back, and compare the full end state.
 */

function makeWorld(seed: number): World {
  return new World(seed, new AudioBus(), new Camera(1024, 576, new Rng(seed)));
}

/** Deterministic pseudo-player: circles, aims at the nearest enemy, dashes. */
function scriptedIntent(world: World, tick: number): PlayerIntent {
  let targetX = world.player.x + 100;
  let targetY = world.player.y;
  let best = Number.POSITIVE_INFINITY;

  for (const enemy of world.enemies) {
    if (!enemy.alive || enemy.spawnTimer > 0) continue;
    const distance = Math.hypot(enemy.x - world.player.x, enemy.y - world.player.y);
    if (distance < best) {
      best = distance;
      targetX = enemy.x;
      targetY = enemy.y;
    }
  }

  const aim = Math.atan2(targetY - world.player.y, targetX - world.player.x);
  const wander = tick * 0.031;
  return {
    move: { x: Math.cos(wander), y: Math.sin(wander * 1.3) },
    aimAngle: aim,
    firing: tick % 5 !== 0,
    // Dash occasionally, on an exact tick — the edge case the format has to
    // preserve, since a dropped dash changes where the player ends up.
    dashPressed: tick % 137 === 0,
  };
}

/** Everything about the run that a replay must reproduce exactly. */
function fingerprint(world: World): string {
  return JSON.stringify({
    x: world.player.x.toFixed(6),
    y: world.player.y.toFixed(6),
    vx: world.player.vx.toFixed(6),
    vy: world.player.vy.toFixed(6),
    health: world.player.health,
    alive: world.player.alive,
    score: world.run.score,
    kills: world.run.kills,
    coins: world.run.coins,
    roomsCleared: world.run.roomsCleared,
    upgrades: world.run.upgrades,
    room: world.currentRoom,
    phase: world.roomPhase,
    enemies: world.enemies
      .filter((e) => e.alive)
      .map((e) => `${e.kind}:${e.health}:${e.x.toFixed(4)}:${e.y.toFixed(4)}:${e.stateName}`),
  });
}

/** Plays a scripted run, recording it. Returns the replay and the end state. */
function recordRun(seed: number, ticks: number): { replay: ReplayData; end: string } {
  const world = makeWorld(seed);
  world.startRun(seed);
  const recorder = new ReplayRecorder(seed);

  const combat = world.dungeon.rooms.find((r) => r.type === 'combat');
  if (combat !== undefined) {
    const centre = roomCenter(combat);
    world.player.x = world.player.px = centre.x;
    world.player.y = world.player.py = centre.y;
  }

  const step = 1 / 60;
  for (let tick = 0; tick < ticks; tick++) {
    const intent = recorder.capture(scriptedIntent(world, tick));
    world.update(step, intent);
  }

  return {
    replay: recorder.finish({
      score: world.run.score,
      depth: world.run.depth,
      kills: world.run.kills,
      elapsed: world.run.elapsed,
    }),
    end: fingerprint(world),
  };
}

/** Replays a recording into a fresh world and returns the end state. */
function playbackRun(replay: ReplayData): string {
  const world = makeWorld(replay.seed);
  world.startRun(replay.seed);
  const player = new ReplayPlayer(replay);

  const combat = world.dungeon.rooms.find((r) => r.type === 'combat');
  if (combat !== undefined) {
    const centre = roomCenter(combat);
    world.player.x = world.player.px = centre.x;
    world.player.y = world.player.py = centre.y;
  }

  const step = 1 / 60;
  while (!player.finished) world.update(step, player.next());
  return fingerprint(world);
}

describe('replay determinism', () => {
  it.each([101, 202, 303, 404, 505])(
    'seed %i: a recorded run replays into the identical end state',
    (seed) => {
      const { replay, end } = recordRun(seed, 900);
      expect(playbackRun(replay)).toBe(end);
    },
  );

  it('survives a binary round-trip before playback', () => {
    const { replay, end } = recordRun(777, 900);
    const decoded = decodeReplay(encodeReplay(replay));
    expect(playbackRun(decoded)).toBe(end);
  });

  it('survives a base64url round-trip', () => {
    const { replay, end } = recordRun(888, 600);
    const decoded = decodeReplay(fromBase64Url(toBase64Url(encodeReplay(replay))));
    expect(playbackRun(decoded)).toBe(end);
  });

  it('records far fewer frames than ticks', () => {
    const { replay } = recordRun(999, 1800);
    expect(replay.ticks).toBe(1800);
    // Aim moves most ticks under this script, but move and fire are held —
    // the format should still be well under one frame per tick.
    expect(replay.frames.length).toBeLessThan(replay.ticks);
  });

  it('preserves dash edges on their exact tick', () => {
    const { replay } = recordRun(1234, 900);
    const dashTicks = replay.frames.filter((f) => f.dash).map((f) => f.tick);
    // The script dashes on every 137th tick; each must survive as its own frame.
    expect(dashTicks).toContain(0);
    expect(dashTicks).toContain(137);
    expect(dashTicks).toContain(274);
  });
});

describe('replay codec', () => {
  it('round-trips every field', () => {
    const original: ReplayData = {
      version: 1,
      seed: 0xdeadbeef,
      ticks: 5000,
      frames: [
        { tick: 0, moveX: 0, moveY: 0, aim: 0, firing: false, dash: false },
        // aim spans the full quantised range: 0 and the last valid step.
        { tick: 12, moveX: -127, moveY: 127, aim: 1023, firing: true, dash: true },
        // A large tick gap forces the escape path in the packed header byte.
        { tick: 900, moveX: 64, moveY: -64, aim: 512, firing: true, dash: false },
      ],
      choices: [
        { tick: 400, upgradeId: 'sharp-rounds' },
        { tick: 1200, upgradeId: 'orbital-blade' },
      ],
      meta: {
        score: 123456,
        depth: 4,
        kills: 210,
        elapsed: 312.45,
        recordedAt: 1_700_000_000_000,
      },
    };

    const decoded = decodeReplay(encodeReplay(original));
    expect(decoded.seed).toBe(original.seed);
    expect(decoded.ticks).toBe(original.ticks);
    expect(decoded.frames).toEqual(original.frames);
    expect(decoded.choices).toEqual(original.choices);
    expect(decoded.meta.score).toBe(original.meta.score);
    expect(decoded.meta.depth).toBe(original.meta.depth);
    expect(decoded.meta.kills).toBe(original.meta.kills);
    expect(decoded.meta.elapsed).toBeCloseTo(original.meta.elapsed, 2);
    // Timestamps are stored to the second.
    expect(Math.abs(decoded.meta.recordedAt - original.meta.recordedAt)).toBeLessThan(1000);
  });

  it('rejects payloads that are not replays', () => {
    expect(() => decodeReplay(new Uint8Array([1, 2, 3, 4]))).toThrow(
      /Not a Neon Depths replay/,
    );
  });

  it('packs small tick gaps into the header byte', () => {
    const frames = Array.from({ length: 200 }, (_, i) => ({
      tick: i,
      moveX: 10,
      moveY: 20,
      aim: 100,
      firing: true,
      dash: false,
    }));
    const bytes = encodeReplay({
      version: 1,
      seed: 1,
      ticks: 200,
      frames,
      choices: [],
      meta: { score: 0, depth: 1, kills: 0, elapsed: 0, recordedAt: 0 },
    });
    // Header only for consecutive, unchanged frames: one byte each plus a
    // small fixed prelude. Two bytes per frame would mean the gap nibble is
    // not being used.
    expect(bytes.length).toBeLessThan(200 * 2);
    expect(decodeReplay(bytes).frames).toEqual(frames);
  });

  it('rejects a future format version rather than misreading it', () => {
    const bytes = encodeReplay({
      version: 1,
      seed: 1,
      ticks: 0,
      frames: [],
      choices: [],
      meta: { score: 0, depth: 1, kills: 0, elapsed: 0, recordedAt: 0 },
    });
    bytes[2] = 99;
    expect(() => decodeReplay(bytes)).toThrow(/not supported/);
  });

  it('quantisation is stable under a round-trip', () => {
    const intent: PlayerIntent = {
      move: { x: 0.7071, y: -0.7071 },
      aimAngle: 2.3456,
      firing: true,
      dashPressed: false,
    };
    const once = dequantise(quantise(intent), {
      move: { x: 0, y: 0 },
      aimAngle: 0,
      firing: false,
      dashPressed: false,
    });
    const twice = quantise(once);
    expect(twice).toEqual(quantise(intent));
  });
});
