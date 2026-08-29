/**
 * Descending: the reset that makes the next run faster.
 *
 * Every run walls, and it walls for a structural reason rather than a tuning
 * one. Upgrades give flat damage at exponentially rising cost, so damage grows
 * with the *logarithm* of gold; monster health grows exponentially with depth.
 * Logarithmic growth cannot chase exponential growth, so no amount of patience
 * gets a run past its ceiling. That is the genre working as intended — the run
 * is not the game, the sequence of runs is.
 *
 * Descending is what makes the sequence go somewhere, and it only works if the
 * relic payout grows faster with depth than monster health does. Each extra
 * floor demands 1.55× the damage, and relics multiply damage directly, so a
 * payout growing at 1.75× per floor means every descent lands strictly deeper
 * than the last, by a widening margin. Drop that below 1.55 and the runs
 * converge on a fixed depth: the player descends forever and never moves. It is
 * the single most important number in the design, and `tests/save.test.ts`
 * asserts the relationship directly so it cannot be tuned away by accident.
 */

import { Decimal } from '@core/decimal';
import { createInitialState, type GameState } from './state';

/**
 * Descending before this depth would pay less than it costs to rebuild.
 *
 * Measured, not chosen: a first-time player with no relics walls somewhere
 * around floor 10-12, so this is set to where the wall actually is. Setting it
 * deeper than the wall — as it was at first — leaves players grinding against a
 * ceiling with the mechanic that exists to break it still greyed out.
 */
export const DESCENT_UNLOCK_FLOOR = 10;

const RELIC_BASE = 25;

/**
 * Must stay above the 1.55 health growth per floor, and only just.
 *
 * Depth reachable with multiplier M is roughly log(M)/log(1.55), and M is
 * proportional to `RELIC_GROWTH^depth`, so one descent maps to the next by
 *
 *     next ≈ depth · log(RELIC_GROWTH)/log(1.55) + constant
 *
 * That ratio decides everything. Below 1.55 the map is a contraction: it has a
 * fixed point, runs converge on one depth, and the game silently ends — at 1.36
 * a simulated player crawls from floor 213 to floor 228 over twenty descents
 * and stops. Above 1.55 there is no fixed point and every descent gains more
 * than the last. At 1.75 the gain *multiplies*, reaching floor 4,000 inside two
 * days, which is a scoreboard rather than a game.
 *
 * 1.58 puts the ratio at 1.044: measured over 24 descents the gain climbs
 * steadily from +19 floors to +170 and never plateaus.
 */
const RELIC_GROWTH = 1.58;

/** Relics a descent would pay right now, given how deep the run reached. */
export function pendingRelics(highestFloor: number): Decimal {
  if (highestFloor < DESCENT_UNLOCK_FLOOR) return Decimal.ZERO;
  const beyond = highestFloor - DESCENT_UNLOCK_FLOOR;
  const raw = Decimal.of(RELIC_BASE, 0).multiply(Decimal.of(RELIC_GROWTH, 0).pow(beyond));
  return raw.floorToInteger();
}

/**
 * Auto-Delve appears after the first descent.
 *
 * Before then, deciding what to buy *is* the game — the whole loop is a player
 * learning which curve pays. Afterwards, re-buying the same early upgrades on
 * every run is a chore, and automating it is the genre's standard answer.
 */
export function canAutoDelve(state: GameState): boolean {
  return state.stats.descents > 0;
}

export function canDescend(state: GameState): boolean {
  return state.highestFloor >= DESCENT_UNLOCK_FLOOR;
}

export interface DescentResult {
  readonly relicsGained: Decimal;
  readonly floorReached: number;
}

/**
 * Performs a descent in place, returning what it paid.
 *
 * Everything bought with gold is surrendered — gold, upgrades, companions, the
 * run's depth. Relics, lifetime totals, and the blessing survive, because
 * losing a reward the player watched an advertisement for would be a straight
 * betrayal of the transaction.
 */
export function descend(state: GameState, now = Date.now()): DescentResult {
  const relicsGained = pendingRelics(state.highestFloor);
  const floorReached = state.highestFloor;

  const fresh = createInitialState(now);

  state.floor = fresh.floor;
  state.highestFloor = fresh.highestFloor;
  state.killsOnFloor = fresh.killsOnFloor;
  state.fightingGuardian = fresh.fightingGuardian;
  state.guardianTimeRemaining = fresh.guardianTimeRemaining;
  state.enemyHealthRemaining = fresh.enemyHealthRemaining;
  state.enemyIndex = fresh.enemyIndex;
  state.gold = fresh.gold;
  state.upgrades = fresh.upgrades;
  state.companions = fresh.companions;

  state.relics = state.relics.add(relicsGained);
  state.lifetimeRelics = state.lifetimeRelics.add(relicsGained);
  state.stats.descents += 1;

  return { relicsGained, floorReached };
}
