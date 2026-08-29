/**
 * The one function that moves the game forward.
 *
 * `advance(state, seconds)` is used identically by the live frame loop (with
 * ~0.016s) and by the offline catch-up (with up to eight hours). That is not a
 * convenience — it is the only way the two can be guaranteed not to disagree.
 * Idle games that model offline progress with a separate estimate always end up
 * with a discrepancy, and the discrepancy is always an exploit: players learn
 * whether it pays to close the tab, and the honest way to play stops being the
 * best way to play.
 *
 * Making one function serve both requires it to be O(events) rather than
 * O(ticks). Eight hours at sixty ticks a second is 1.7 million iterations; eight
 * hours of *events* is a few thousand at most, because fragments absorbed at a
 * constant rate can be counted with a division instead of a loop.
 *
 * Randomness is deliberately absent. Resonant pulls are folded into the
 * absorption rate as an expectation (see `computeStats`), so eight hours away
 * pays exactly what eight hours watching would have. A dice roll here would make
 * the two disagree by variance alone, and players would — correctly — call it
 * cheating.
 */

import { Decimal } from '@core/decimal';
import {
  FRAGMENTS_PER_STAGE,
  MIN_ABSORB_TIME,
  fragmentDust,
  fragmentMass,
} from './content/stages';
import { computeStats } from './stats';
import { type GameState, growToNextStage, spawnFragment } from './state';

/**
 * Ceiling on loop iterations within a single call.
 *
 * Every iteration consumes time or resolves a fragment, so this cannot be
 * reached by normal play. It exists so that a pathological state (a save edited
 * to zero absorption on a zero-mass stage) stalls one frame instead of hanging
 * the tab.
 */
const MAX_EVENTS = 100_000;

/** Below this the remaining budget is spent; comparing floats to 0 never ends. */
const TIME_EPSILON = 1e-9;

export interface AdvanceReport {
  /** Simulated seconds actually consumed. */
  readonly seconds: number;
  readonly dustGathered: Decimal;
  /**
   * Mass drawn into the stone over the call.
   *
   * Reported rather than left for the view to re-derive from rate × time,
   * because those two disagree: the absorption cap means a stone far beyond its
   * stage draws less than its rate suggests. A floating number that says
   * otherwise is a lie the player can check against the bar.
   */
  readonly massGained: Decimal;
  readonly fragments: number;
  readonly stagesGained: number;
  readonly startStage: number;
  readonly endStage: number;
  /** True when the loop hit its iteration ceiling, which should never happen. */
  readonly truncated: boolean;
}

export function emptyReport(state: GameState): AdvanceReport {
  return {
    seconds: 0,
    dustGathered: Decimal.ZERO,
    massGained: Decimal.ZERO,
    fragments: 0,
    stagesGained: 0,
    startStage: state.stage,
    endStage: state.stage,
    truncated: false,
  };
}

/**
 * Sums two consecutive reports into one.
 *
 * Used where the simulation is run in slices — the offline catch-up interleaves
 * it with refining — so the caller still sees a single account of what happened
 * rather than a list to add up itself.
 */
export function mergeReports(first: AdvanceReport, second: AdvanceReport): AdvanceReport {
  return {
    seconds: first.seconds + second.seconds,
    dustGathered: first.dustGathered.add(second.dustGathered),
    massGained: first.massGained.add(second.massGained),
    fragments: first.fragments + second.fragments,
    stagesGained: first.stagesGained + second.stagesGained,
    startStage: first.startStage,
    endStage: second.endStage,
    truncated: first.truncated || second.truncated,
  };
}

/**
 * The rate the stone actually absorbs at, given a cap of one fragment per
 * `MIN_ABSORB_TIME`.
 *
 * The cap has to be expressed as an absorption rate, not as a minimum
 * absorption duration. Clamping the duration instead looks equivalent and is
 * not: a stone that swallows a fragment within a single 16ms frame would have
 * the absorption refused by the clamp *and* the leftover time discarded, and it
 * would never resolve. Capping the rate keeps the remainder strictly linear in
 * time, so a fragment lands at the same simulated moment whether it is reached
 * in one step of an hour or in 216,000 steps of a frame.
 */
function effectiveAbsorptionRate(ratePerSecond: Decimal, wholeFragment: Decimal): Decimal {
  const cap = wholeFragment.multiply(Decimal.of(1 / MIN_ABSORB_TIME, 0));
  return ratePerSecond.min(cap);
}

/**
 * Seconds to absorb `remainingMass` at `rate`.
 *
 * Returns Infinity for a stone that cannot draw anything, which the caller
 * treats as "this never finishes" rather than dividing by zero, and zero for a
 * fragment already fully drawn, so an overshoot resolves on the next step.
 */
function timeToAbsorb(remainingMass: Decimal, rate: Decimal): number {
  if (rate.isZero || rate.isNegative) return Number.POSITIVE_INFINITY;
  if (remainingMass.isZero || remainingMass.isNegative) return 0;
  const seconds = remainingMass.divide(rate).toNumber();
  if (!Number.isFinite(seconds)) return Number.POSITIVE_INFINITY;
  return seconds;
}

/** Draws mass for `seconds` and returns how much actually landed. */
function drawOverTime(state: GameState, rate: Decimal, seconds: number): Decimal {
  const before = state.fragmentRemaining;
  const drawn = rate.multiply(Decimal.of(seconds, 0));
  state.fragmentRemaining = before.subtract(drawn).max(Decimal.ZERO);
  return before.subtract(state.fragmentRemaining);
}

export function advance(state: GameState, seconds: number): AdvanceReport {
  if (!Number.isFinite(seconds) || seconds <= 0) return emptyReport(state);

  const startStage = state.stage;
  const stats = computeStats(state);
  const absorption = stats.absorptionPerSecond;

  let remaining = seconds;
  let dustGathered = Decimal.ZERO;
  let massGained = Decimal.ZERO;
  let fragments = 0;
  let stagesGained = 0;
  let events = 0;

  const award = (amount: Decimal, count: number): void => {
    dustGathered = dustGathered.add(
      amount.multiply(stats.dustMultiplier).multiply(Decimal.of(count, 0)),
    );
  };

  while (remaining > TIME_EPSILON) {
    if (events >= MAX_EVENTS) break;
    events += 1;

    const whole = fragmentMass(state.stage);
    const rate = effectiveAbsorptionRate(absorption, whole);

    // Resolve the fragment already being drawn first, since it may be partly
    // absorbed, then batch the rest of the stage in one step.
    const firstTime = timeToAbsorb(state.fragmentRemaining, rate);
    if (firstTime > remaining) {
      massGained = massGained.add(drawOverTime(state, rate, remaining));
      remaining = 0;
      continue;
    }

    remaining -= firstTime;
    massGained = massGained.add(state.fragmentRemaining);
    fragments += 1;
    state.stats.totalFragments += 1;
    state.fragmentsOnStage += 1;
    award(fragmentDust(state.stage), 1);

    if (state.fragmentsOnStage >= FRAGMENTS_PER_STAGE) {
      growToNextStage(state);
      stagesGained += 1;
      state.stats.stagesReached += 1;
      continue;
    }

    // The remaining fragments on this stage are identical and untouched, so how
    // many of them fit in the budget is a division rather than a loop. This is
    // what keeps an eight-hour catch-up as cheap as a single frame.
    const perFragment = timeToAbsorb(whole, rate);
    const outstanding = FRAGMENTS_PER_STAGE - state.fragmentsOnStage;
    const affordable = Number.isFinite(perFragment) ? Math.floor(remaining / perFragment) : 0;
    const batch = Math.max(0, Math.min(outstanding, affordable));

    if (batch > 0) {
      remaining -= batch * perFragment;
      massGained = massGained.add(whole.multiply(Decimal.of(batch, 0)));
      fragments += batch;
      state.stats.totalFragments += batch;
      state.fragmentsOnStage += batch;
      award(fragmentDust(state.stage), batch);
    }

    if (state.fragmentsOnStage >= FRAGMENTS_PER_STAGE) {
      growToNextStage(state);
      stagesGained += 1;
      state.stats.stagesReached += 1;
    } else {
      spawnFragment(state);
    }
  }

  const consumed = seconds - Math.max(0, remaining);
  state.dust = state.dust.add(dustGathered);
  state.lifetimeDust = state.lifetimeDust.add(dustGathered);
  state.mass = state.mass.add(massGained);
  state.stats.playSeconds += consumed;
  if (state.blessingRemaining > 0) {
    state.blessingRemaining = Math.max(0, state.blessingRemaining - consumed);
  }

  return {
    seconds: consumed,
    dustGathered,
    massGained,
    fragments,
    stagesGained,
    startStage,
    endStage: state.stage,
    truncated: events >= MAX_EVENTS,
  };
}
