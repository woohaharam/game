/**
 * Compressing: the reset that makes the next stone grow faster.
 *
 * Every stone walls, and it walls for a structural reason rather than a tuning
 * one. Refinements give flat absorption at exponentially rising cost, so
 * absorption grows with the *logarithm* of dust; fragment mass grows
 * exponentially with the stage. Logarithmic growth cannot chase exponential
 * growth, so no amount of patience gets a stone past its ceiling. That is the
 * genre working as intended — one stone is not the game, the sequence of stones
 * is.
 *
 * Compressing is what makes the sequence go somewhere, and it only works if the
 * crystal payout grows faster with the stage than fragment mass does. Each
 * extra stage demands 1.55× the absorption, and crystals multiply absorption
 * directly, so a payout growing faster per stage means every compression lands
 * strictly further than the last. Drop it below 1.55 and the stones converge on
 * a fixed stage: the player compresses forever and never moves. It is the
 * single most important number in the design, and `tests/save.test.ts` asserts
 * the relationship directly so it cannot be tuned away by accident.
 */

import { Decimal } from '@core/decimal';
import { createInitialState, type GameState } from './state';

/**
 * Descending before this stage would pay less than it costs to rebuild.
 *
 * Measured, not chosen: a first-time player with no crystals walls somewhere
 * around stage 10-12, so this is set to where the wall actually is. Setting it
 * deeper than the wall — as it was at first — leaves players grinding against a
 * ceiling with the mechanic that exists to break it still greyed out.
 */
export const COMPRESSION_UNLOCK_STAGE = 10;

const CRYSTAL_BASE = 25;

/**
 * Must stay above the 1.55 mass growth per stage, and only just.
 *
 * Stage reachable with multiplier M is roughly log(M)/log(1.55), and M is
 * proportional to `CRYSTAL_GROWTH^stage`, so one compression maps to the next by
 *
 *     next ≈ stage · log(CRYSTAL_GROWTH)/log(1.55) + constant
 *
 * That ratio decides everything. Below 1.55 the map is a contraction: it has a
 * fixed point, stones converge on one stage, and the game silently ends — at 1.36
 * a simulated player crawls from stage 213 to stage 228 over twenty compressions
 * and stops. Above 1.55 there is no fixed point and every compression gains
 * more than the last. At 1.75 the gain *multiplies*, reaching stage 4,000 in two
 * days, which is a scoreboard rather than a game.
 *
 * 1.58 puts the ratio at 1.044: measured over twenty compressions the gain
 * climbs steadily and never plateaus.
 */
const CRYSTAL_GROWTH = 1.58;

/** Crystals a compression would pay right now, given how far the stone got. */
export function pendingCrystals(highestStage: number): Decimal {
  if (highestStage < COMPRESSION_UNLOCK_STAGE) return Decimal.ZERO;
  const beyond = highestStage - COMPRESSION_UNLOCK_STAGE;
  const raw = Decimal.of(CRYSTAL_BASE, 0).multiply(Decimal.of(CRYSTAL_GROWTH, 0).pow(beyond));
  return raw.floorToInteger();
}

/**
 * Auto-refine appears after the first compression.
 *
 * Before then, deciding what to buy *is* the game — the whole loop is a player
 * learning which curve pays. Afterwards, re-buying the same early refinements on
 * every stone is a chore, and automating it is the genre's standard answer.
 */
export function canAutoRefine(state: GameState): boolean {
  return state.stats.compressions > 0;
}

export function canCompress(state: GameState): boolean {
  return state.highestStage >= COMPRESSION_UNLOCK_STAGE;
}

export interface CompressionResult {
  readonly crystalsGained: Decimal;
  readonly stageReached: number;
}

/**
 * Performs a compression in place, returning what it paid.
 *
 * Everything bought with dust is surrendered — dust, refinements, orbiters, and
 * the mass itself. Crystals, lifetime totals, and the blessing survive, because
 * losing a reward the player watched an advertisement for would be a straight
 * betrayal of the transaction.
 */
export function compress(state: GameState, now = Date.now()): CompressionResult {
  const crystalsGained = pendingCrystals(state.highestStage);
  const stageReached = state.highestStage;

  const fresh = createInitialState(now);

  state.stage = fresh.stage;
  state.highestStage = fresh.highestStage;
  state.fragmentsOnStage = fresh.fragmentsOnStage;
  state.fragmentRemaining = fresh.fragmentRemaining;
  state.fragmentIndex = fresh.fragmentIndex;
  state.mass = fresh.mass;
  state.dust = fresh.dust;
  state.upgrades = fresh.upgrades;
  state.companions = fresh.companions;

  state.crystals = state.crystals.add(crystalsGained);
  state.lifetimeCrystals = state.lifetimeCrystals.add(crystalsGained);
  state.stats.compressions += 1;

  return { crystalsGained, stageReached };
}
