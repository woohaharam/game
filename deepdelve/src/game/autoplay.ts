/**
 * A simulated player, for balance work.
 *
 * The simulation alone cannot answer the only question that matters — "does
 * this reach floor 60 in a satisfying amount of time?" — because progression
 * depends on spending, and spending is the player. So the balance harness needs
 * a player it can run ten thousand times.
 *
 * This one is deliberately unsophisticated: it fights for a while, buys the
 * cheapest thing it can afford, and repeats. Real players do better than this.
 * That makes every number it produces a conservative bound, which is the useful
 * direction for a bound to point: a curve that is fine under this shopper is
 * fine, and one that stalls here needs looking at.
 */

import { advance, emptyReport, mergeReports, type AdvanceReport } from './simulation';
import { spendGreedily } from './shop';
import { canDescend, descend } from './prestige';
import type { GameState } from './state';

export interface AutoplayOptions {
  /** How often the simulated player checks the shop. */
  readonly shopIntervalSeconds?: number;
  /** Descend automatically once the run reaches this depth. Off when absent. */
  readonly descendAtFloor?: number;
}

export interface AutoplayResult {
  readonly secondsPlayed: number;
  readonly purchases: number;
  readonly descents: number;
  readonly highestFloor: number;
  /** Everything the underlying simulation did, summed across the slices. */
  readonly report: AdvanceReport;
}

export function autoplay(
  state: GameState,
  seconds: number,
  options: AutoplayOptions = {},
): AutoplayResult {
  // Ten seconds is roughly how often an engaged player actually glances at the
  // shop. Checking every frame would make the simulated player superhuman and
  // the resulting curves too optimistic to trust.
  const interval = Math.max(0.1, options.shopIntervalSeconds ?? 10);
  const descendAt = options.descendAtFloor;

  let played = 0;
  let purchases = 0;
  let descents = 0;
  let deepest = state.highestFloor;
  let report = emptyReport(state);

  while (played < seconds) {
    const step = Math.min(interval, seconds - played);
    report = mergeReports(report, advance(state, step));
    played += step;

    purchases += spendGreedily(state);
    deepest = Math.max(deepest, state.highestFloor);

    if (descendAt !== undefined && state.highestFloor >= descendAt && canDescend(state)) {
      descend(state);
      descents += 1;
    }
  }

  return { secondsPlayed: played, purchases, descents, highestFloor: deepest, report };
}
