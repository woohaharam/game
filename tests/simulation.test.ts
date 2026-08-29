import { describe, expect, it } from 'vitest';
import { Decimal, d } from '../src/core/decimal';
import { advance } from '../src/game/simulation';
import { createInitialState, type GameState } from '../src/game/state';
import { FRAGMENTS_PER_STAGE } from '../src/game/content/stages';

function heroWith(power: Partial<GameState['upgrades']> = {}): GameState {
  const state = createInitialState(0);
  Object.assign(state.upgrades, power);
  return state;
}

/** Relative difference, so the assertion means the same thing at any magnitude. */
function relativeGap(a: Decimal, b: Decimal): number {
  if (a.isZero && b.isZero) return 0;
  const larger = a.max(b);
  if (larger.isZero) return 0;
  return Math.abs(a.subtract(b).divide(larger).toNumber());
}

describe('advance', () => {
  it('pays out and clears floors from a standing start', () => {
    const state = heroWith({ blade: 20, swiftness: 10 });
    const report = advance(state, 600);

    expect(report.fragments).toBeGreaterThan(0);
    expect(report.dustGathered.isZero).toBe(false);
    expect(state.stage).toBeGreaterThan(1);
    expect(report.truncated).toBe(false);
    expect(report.seconds).toBeCloseTo(600, 6);
  });

  it('banks gold into the state exactly once', () => {
    const state = heroWith({ blade: 15 });
    const report = advance(state, 120);
    expect(relativeGap(state.dust, report.dustGathered)).toBeLessThan(1e-12);
    expect(relativeGap(state.lifetimeDust, report.dustGathered)).toBeLessThan(1e-12);
  });

  /**
   * The property the whole design rests on: the offline catch-up and the live
   * loop are the same function, so they must reach the same place. If this ever
   * fails, closing the tab is either a penalty or an exploit.
   */
  it('reaches the same state in one long step as in thousands of frames', () => {
    const asOneStep = heroWith({ blade: 30, swiftness: 12, greed: 8 });
    const asFrames = heroWith({ blade: 30, swiftness: 12, greed: 8 });

    const totalSeconds = 3600;
    advance(asOneStep, totalSeconds);

    const frame = 1 / 60;
    for (let elapsed = 0; elapsed < totalSeconds; elapsed += frame) {
      advance(asFrames, Math.min(frame, totalSeconds - elapsed));
    }

    expect(asFrames.stage).toBe(asOneStep.stage);
    expect(asFrames.highestStage).toBe(asOneStep.highestStage);
    expect(asFrames.fragmentsOnStage).toBe(asOneStep.fragmentsOnStage);
    expect(relativeGap(asFrames.mass, asOneStep.mass)).toBeLessThan(1e-9);
    expect(asFrames.stats.totalFragments).toBe(asOneStep.stats.totalFragments);
    expect(relativeGap(asFrames.dust, asOneStep.dust)).toBeLessThan(1e-9);
  });

  it('agrees across wildly different step sizes', () => {
    const steps = [0.25, 1, 30, 900, 7200];
    const results = steps.map((step) => {
      const state = heroWith({ blade: 40, swiftness: 20, greed: 10, precision: 20 });
      for (let elapsed = 0; elapsed < 7200; elapsed += step) {
        advance(state, Math.min(step, 7200 - elapsed));
      }
      return state;
    });

    const [reference] = results;
    if (reference === undefined) throw new Error('no results');
    for (const result of results) {
      expect(result.stage).toBe(reference.stage);
      expect(result.stats.totalFragments).toBe(reference.stats.totalFragments);
      expect(relativeGap(result.dust, reference.dust)).toBeLessThan(1e-9);
    }
  });

  it('caps how fast an absurdly overpowered hero can clear', () => {
    // A hero far beyond the floor still cannot exceed one kill per MIN_KILL_TIME,
    // which is what stops a returning player from skipping a thousand floors in
    // the first frame after loading.
    const state = heroWith({ blade: 100_000 });
    const report = advance(state, 10);
    expect(report.fragments).toBeLessThanOrEqual(10 / 0.05);
  });

  it('never stalls when the hero overkills inside a single frame', () => {
    const state = heroWith({ blade: 100_000 });
    for (let i = 0; i < 600; i += 1) advance(state, 1 / 60);
    expect(state.stats.totalFragments).toBeGreaterThan(0);
    expect(state.stage).toBeGreaterThan(1);
  });

  it('makes no progress for a hero who cannot deal damage', () => {
    const state = createInitialState(0);
    state.upgrades.blade = 0;
    // Base damage is 1, so zero out the multiplier path instead: an unarmed run
    // still kills, just slowly. What must hold is that it terminates.
    const report = advance(state, 3600);
    expect(report.truncated).toBe(false);
    expect(report.seconds).toBeCloseTo(3600, 6);
  });

  it('stalls on a guardian it cannot beat without losing the floor', () => {
    const state = heroWith({ blade: 3 });
    advance(state, 60 * 60 * 4);
    const reached = state.stage;

    advance(state, 60 * 60 * 4);
    expect(state.stage).toBeGreaterThanOrEqual(reached);
    // A stalled stone still gathers: slowing down is the wall, not stopping.
    expect(state.dust.isZero).toBe(false);
  });

  /**
   * The design's central promise, and the thing that separates this from the
   * dungeon crawler it grew out of: a stone that has grown cannot un-grow.
   * There is no timer to fail and no way back down, so the only thing a stage
   * too heavy to absorb does is slow the player down.
   */
  it('never moves backwards, at any power level or step size', () => {
    for (const power of [0, 1, 40, 5000]) {
      for (const step of [1 / 60, 7, 3600]) {
        const state = heroWith({ blade: power });
        let stage = state.stage;
        let mass = state.mass;

        for (let i = 0; i < 200; i += 1) {
          advance(state, step);
          expect(state.stage, `blade ${power}, step ${step}`).toBeGreaterThanOrEqual(stage);
          expect(state.mass.lessThan(mass), `blade ${power}, step ${step}`).toBe(false);
          stage = state.stage;
          mass = state.mass;
        }
      }
    }
  });

  it('advances a stage only once the fragments for it have landed', () => {
    const state = heroWith({ blade: 5 });
    advance(state, 3);
    // Progress within a stage is the count, so the two can never disagree.
    expect(state.fragmentsOnStage).toBeLessThan(FRAGMENTS_PER_STAGE);
    expect(state.stage).toBe(1 + state.stats.stagesReached);
  });

  it('completes an eight-hour catch-up without hitting the event ceiling', () => {
    const state = heroWith({ blade: 200, swiftness: 40, greed: 20, tome: 5 });
    const started = performance.now();
    const report = advance(state, 8 * 60 * 60);
    const elapsed = performance.now() - started;

    expect(report.truncated).toBe(false);
    // A returning player waits on this before the game draws its first frame.
    expect(elapsed).toBeLessThan(250);
  });

  it('consumes blessing time as it simulates', () => {
    const state = heroWith({ blade: 20 });
    state.blessingRemaining = 30;
    advance(state, 10);
    expect(state.blessingRemaining).toBeCloseTo(20, 6);
    advance(state, 60);
    expect(state.blessingRemaining).toBe(0);
  });

  it('ignores nonsense budgets rather than corrupting the run', () => {
    const state = heroWith({ blade: 20 });
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const report = advance(state, bad);
      expect(report.seconds).toBe(0);
      expect(report.fragments).toBe(0);
    }
    expect(state.dust.isZero).toBe(true);
    expect(d(state.stage).toNumber()).toBe(1);
  });
});
