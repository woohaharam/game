import { describe, expect, it } from 'vitest';
import { Pool } from '@engine/pool';
import { SpatialHash } from '@engine/spatial-hash';
import { StateMachine, type State } from '@engine/fsm';
import {
  angleDelta,
  clamp,
  clampLength,
  damp,
  explosionSafe,
  lerp,
  normalize,
} from './helpers';

describe('Pool', () => {
  it('hands out distinct instances until exhausted, then returns null', () => {
    const pool = new Pool(
      () => ({ value: 0 }),
      (item) => {
        item.value = 0;
      },
      3,
    );
    const acquired = [pool.acquire(), pool.acquire(), pool.acquire()];
    expect(acquired.every((a) => a !== null)).toBe(true);
    expect(new Set(acquired.map((a) => a?.index)).size).toBe(3);
    // Exhaustion must be a soft failure: dropping a particle beats stalling.
    expect(pool.acquire()).toBeNull();
    expect(pool.size).toBe(3);
  });

  it('recycles released slots and resets their state', () => {
    const pool = new Pool(
      () => ({ value: 0 }),
      (item) => {
        item.value = 0;
      },
      2,
    );
    const first = pool.acquire();
    expect(first).not.toBeNull();
    first!.item.value = 42;
    pool.release(first!.index);
    expect(pool.size).toBe(0);

    const reused = pool.acquire();
    expect(reused).not.toBeNull();
    expect(reused!.item.value).toBe(0);
  });

  it('ignores a double release', () => {
    const pool = new Pool(
      () => ({}),
      () => {},
      2,
    );
    const item = pool.acquire();
    pool.release(item!.index);
    pool.release(item!.index);
    expect(pool.size).toBe(0);
    // A double release must not corrupt the free list into handing out the
    // same slot to two owners.
    const a = pool.acquire();
    const b = pool.acquire();
    expect(a?.index).not.toBe(b?.index);
  });

  it('iterates live entries only, and tolerates release during iteration', () => {
    const pool = new Pool(
      () => ({ n: 0 }),
      () => {},
      5,
    );
    for (let i = 0; i < 5; i++) pool.acquire()!.item.n = i;
    const seen: number[] = [];
    pool.forEach((item, index) => {
      seen.push(item.n);
      if (item.n % 2 === 0) pool.release(index);
    });
    expect(seen).toHaveLength(5);
    expect(pool.size).toBe(2);
  });

  it('clear() releases everything', () => {
    const pool = new Pool(
      () => ({}),
      () => {},
      4,
    );
    pool.acquire();
    pool.acquire();
    pool.clear();
    expect(pool.size).toBe(0);
  });
});

describe('SpatialHash', () => {
  it('finds entities within the query radius', () => {
    const hash = new SpatialHash<string>(32);
    hash.insert('near', 10, 10, 4);
    hash.insert('far', 500, 500, 4);
    const found = hash.collect(12, 12, 20);
    expect(found).toContain('near');
    expect(found).not.toContain('far');
  });

  it('reports an entity spanning several cells exactly once', () => {
    const hash = new SpatialHash<string>(16);
    // Radius 40 across 16px cells means this lands in nine buckets.
    hash.insert('big', 40, 40, 40);
    const found = hash.collect(40, 40, 40);
    expect(found).toEqual(['big']);
  });

  it('handles negative coordinates', () => {
    const hash = new SpatialHash<string>(32);
    hash.insert('left', -100, -100, 8);
    expect(hash.collect(-98, -98, 10)).toEqual(['left']);
  });

  it('clear() empties every bucket', () => {
    const hash = new SpatialHash<string>(32);
    hash.insert('a', 0, 0, 4);
    hash.clear();
    expect(hash.collect(0, 0, 32)).toEqual([]);
  });

  it('matches brute force on random data', () => {
    const hash = new SpatialHash<number>(48);
    const points: { x: number; y: number; r: number }[] = [];
    for (let i = 0; i < 400; i++) {
      const point = {
        x: Math.sin(i * 12.9898) * 900,
        y: Math.cos(i * 78.233) * 900,
        r: 6,
      };
      points.push(point);
      hash.insert(i, point.x, point.y, point.r);
    }

    const qx = 120;
    const qy = -80;
    const qr = 90;
    const broadphase = new Set(hash.collect(qx, qy, qr));
    // The hash is allowed to over-report (that is what a broadphase does), but
    // it must never miss a true overlap.
    const expected = points
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => Math.hypot(p.x - qx, p.y - qy) <= qr + p.r)
      .map(({ i }) => i);
    for (const index of expected) expect(broadphase.has(index)).toBe(true);
  });
});

describe('StateMachine', () => {
  interface Ctx {
    log: string[];
  }

  const states: State<Ctx>[] = [
    {
      name: 'idle',
      enter: (c) => c.log.push('enter:idle'),
      exit: (c) => c.log.push('exit:idle'),
      update: (_c, _step, timeInState) => (timeInState >= 0.2 ? 'active' : null),
    },
    {
      name: 'active',
      enter: (c) => c.log.push('enter:active'),
      update: () => null,
    },
  ];

  it('transitions when a state returns a name, firing enter/exit once', () => {
    const context: Ctx = { log: [] };
    const machine = new StateMachine(states, 'idle');
    machine.update(context, 0.1);
    expect(machine.current).toBe('idle');
    machine.update(context, 0.1);
    expect(machine.current).toBe('active');
    expect(context.log).toEqual(['exit:idle', 'enter:active']);
  });

  it('resets timeInState on transition', () => {
    const context: Ctx = { log: [] };
    const machine = new StateMachine(states, 'idle');
    machine.update(context, 0.3);
    expect(machine.current).toBe('active');
    expect(machine.timeInState).toBe(0);
  });

  it('ignores a transition to the state already active', () => {
    const context: Ctx = { log: [] };
    const machine = new StateMachine(states, 'idle');
    machine.transition('idle', context);
    expect(context.log).toEqual([]);
  });

  it('throws on an unknown state rather than silently doing nothing', () => {
    const machine = new StateMachine(states, 'idle');
    expect(() => machine.transition('nope', { log: [] })).toThrow(/Unknown state/);
    expect(() => new StateMachine(states, 'nope')).toThrow(/Unknown initial state/);
  });
});

describe('math helpers', () => {
  it('clamp bounds both ends', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-5, 0, 3)).toBe(0);
    expect(clamp(1, 0, 3)).toBe(1);
  });

  it('lerp hits both endpoints exactly', () => {
    expect(lerp(10, 20, 0)).toBe(10);
    expect(lerp(10, 20, 1)).toBe(20);
    expect(lerp(10, 20, 0.5)).toBe(15);
  });

  it('damp converges and is frame-rate independent', () => {
    // One 0.5s step must land in the same place as fifty 0.01s steps.
    const single = damp(0, 100, 6, 0.5);
    let stepped = 0;
    for (let i = 0; i < 50; i++) stepped = damp(stepped, 100, 6, 0.01);
    expect(stepped).toBeCloseTo(single, 5);
  });

  it('angleDelta returns the shortest signed rotation', () => {
    expect(angleDelta(0.1, -0.1)).toBeCloseTo(-0.2, 6);
    // Across the wrap point the short way round is +0.2, not -6.08.
    expect(angleDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2, 6);
  });

  it('normalize returns the original length and yields a unit vector', () => {
    const v = { x: 3, y: 4 };
    expect(normalize(v)).toBe(5);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1, 6);
  });

  it('normalize leaves a zero vector alone instead of producing NaN', () => {
    const v = { x: 0, y: 0 };
    expect(normalize(v)).toBe(0);
    expect(Number.isNaN(v.x)).toBe(false);
  });

  it('clampLength caps magnitude without changing direction', () => {
    const v = { x: 30, y: 40 };
    clampLength(v, 10);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(10, 6);
    expect(v.y / v.x).toBeCloseTo(40 / 30, 6);
  });

  it('explosion falloff tapers from full damage to zero at the rim', () => {
    expect(explosionSafe(0, 100)).toBe(1);
    expect(explosionSafe(100, 100)).toBe(0);
    expect(explosionSafe(50, 100)).toBeCloseTo(0.625, 6);
  });
});
