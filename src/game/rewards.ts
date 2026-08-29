/**
 * What a watched advertisement actually buys.
 *
 * Two rules govern everything here. Rewards are always *bonuses*, never gates —
 * a player who never watches an ad still finishes the game, just more slowly.
 * And every reward is denominated in the game's own economy rather than in a
 * flat number, so it stays meaningful at floor 5 and at floor 5,000 without
 * anyone retuning it.
 *
 * The second rule is why a cache is worth "thirty minutes of your current
 * income" rather than "10,000 gold". Working that out means asking the
 * simulation what thirty minutes would actually pay, on a copy of the state, so
 * the answer is the real one rather than an estimate that drifts from it.
 */

import { Decimal } from '@core/decimal';
import { advance } from './simulation';
import { cloneState, type GameState } from './state';

/** Five minutes of doubled output. Long enough to feel, short enough to want again. */
export const BLESSING_DURATION_SECONDS = 5 * 60;

/** A cache pays what half an hour of the current stone would have paid. */
export const CACHE_SECONDS_OF_INCOME = 30 * 60;

/**
 * Dust the stone would gather in `seconds`, without any of it actually happening.
 *
 * Runs on a copy, so stages are not advanced and no state is touched. This is
 * the honest way to price a reward: it is the same simulation the player is
 * subject to, not a parallel formula that can disagree with it.
 */
export function previewEarnings(state: GameState, seconds: number): Decimal {
  return advance(cloneState(state), seconds).dustGathered;
}

/**
 * Extends the blessing rather than replacing it.
 *
 * A player who watches a second ad before the first has run out should not be
 * punished for enthusiasm by having time taken away.
 */
export function grantBlessing(state: GameState): number {
  state.blessingRemaining += BLESSING_DURATION_SECONDS;
  return state.blessingRemaining;
}

export function cacheValue(state: GameState): Decimal {
  return previewEarnings(state, CACHE_SECONDS_OF_INCOME);
}

export function grantCache(state: GameState): Decimal {
  const value = cacheValue(state);
  state.dust = state.dust.add(value);
  state.lifetimeDust = state.lifetimeDust.add(value);
  return value;
}
