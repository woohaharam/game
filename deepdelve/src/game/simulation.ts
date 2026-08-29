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
 * hours of *events* is a few thousand at most, because kills that happen at a
 * constant rate can be counted with a division instead of a loop.
 *
 * Randomness is deliberately absent. Criticals are folded into DPS as an
 * expectation (see `computeStats`), so eight hours away pays exactly what eight
 * hours watching would have. A dice roll here would make the two disagree by
 * variance alone, and players would — correctly — call it cheating.
 */

import { Decimal } from '@core/decimal';
import {
  KILLS_PER_FLOOR,
  MIN_KILL_TIME,
  guardianGold,
  guardianHealth,
  monsterGold,
  monsterHealth,
} from './content/floors';
import { computeStats } from './stats';
import {
  type GameState,
  descendOneFloor,
  retreatToFloorStart,
  spawnGuardian,
  spawnMonster,
} from './state';

/**
 * Ceiling on loop iterations within a single call.
 *
 * Every iteration consumes time or resolves an enemy, so this cannot be reached
 * by normal play — a walled hero costs about three iterations per 30-second
 * guardian cycle, so eight offline hours is roughly 2,800. It exists so that a
 * pathological state (a save edited to zero DPS on a zero-health floor) stalls
 * one frame instead of hanging the tab.
 */
const MAX_EVENTS = 100_000;

/** Below this the remaining budget is spent; comparing floats to 0 never ends. */
const TIME_EPSILON = 1e-9;

export interface AdvanceReport {
  /** Simulated seconds actually consumed. */
  readonly seconds: number;
  readonly goldEarned: Decimal;
  /**
   * Health removed over the call.
   *
   * Reported rather than left for the view to re-derive from DPS × time,
   * because those two disagree: the kill-rate cap means a hero far beyond the
   * floor deals less than their damage per second suggests. A floating number
   * that says otherwise is a lie the player can check against the health bar.
   */
  readonly damageDealt: Decimal;
  readonly kills: number;
  readonly guardiansFelled: number;
  readonly guardiansEscaped: number;
  readonly startFloor: number;
  readonly endFloor: number;
  /** True when the loop hit its iteration ceiling, which should never happen. */
  readonly truncated: boolean;
}

/**
 * Sums two consecutive reports into one.
 *
 * Used where the simulation is run in slices — the offline catch-up interleaves
 * it with shopping — so the caller still sees a single account of what happened
 * rather than a list to add up itself.
 */
export function mergeReports(first: AdvanceReport, second: AdvanceReport): AdvanceReport {
  return {
    seconds: first.seconds + second.seconds,
    goldEarned: first.goldEarned.add(second.goldEarned),
    damageDealt: first.damageDealt.add(second.damageDealt),
    kills: first.kills + second.kills,
    guardiansFelled: first.guardiansFelled + second.guardiansFelled,
    guardiansEscaped: first.guardiansEscaped + second.guardiansEscaped,
    startFloor: first.startFloor,
    endFloor: second.endFloor,
    truncated: first.truncated || second.truncated,
  };
}

export function emptyReport(state: GameState): AdvanceReport {
  return {
    seconds: 0,
    goldEarned: Decimal.ZERO,
    damageDealt: Decimal.ZERO,
    kills: 0,
    guardiansFelled: 0,
    guardiansEscaped: 0,
    startFloor: state.floor,
    endFloor: state.floor,
    truncated: false,
  };
}

/**
 * The rate the hero actually kills at, given a cap of one kill per
 * `MIN_KILL_TIME`.
 *
 * The cap has to be expressed as a damage rate, not as a minimum kill duration.
 * Clamping the duration instead looks equivalent and is not: a hero who
 * overkills a monster within a single 16ms frame would have the kill refused by
 * the clamp *and* the leftover time discarded, and the fight would never
 * resolve. Capping the rate keeps health strictly linear in time, so a kill
 * lands at the same simulated moment whether it is reached in one step of an
 * hour or in 216,000 steps of a frame.
 */
function effectiveDamageRate(damagePerSecond: Decimal, enemyMaxHealth: Decimal): Decimal {
  const cap = enemyMaxHealth.multiply(Decimal.of(1 / MIN_KILL_TIME, 0));
  return damagePerSecond.min(cap);
}

/**
 * Seconds to remove `health` at `rate`.
 *
 * Returns Infinity for a hero who cannot damage anything, which the callers
 * treat as "this never finishes" rather than dividing by zero, and zero for an
 * enemy already at zero health, so an overkill resolves on the next step.
 */
function timeToKill(health: Decimal, rate: Decimal): number {
  if (rate.isZero || rate.isNegative) return Number.POSITIVE_INFINITY;
  if (health.isZero || health.isNegative) return 0;
  const seconds = health.divide(rate).toNumber();
  if (!Number.isFinite(seconds)) return Number.POSITIVE_INFINITY;
  return seconds;
}

/** Applies damage and returns how much actually landed, after the zero clamp. */
function applyDamageOverTime(state: GameState, rate: Decimal, seconds: number): Decimal {
  const before = state.enemyHealthRemaining;
  const dealt = rate.multiply(Decimal.of(seconds, 0));
  state.enemyHealthRemaining = before.subtract(dealt).max(Decimal.ZERO);
  return before.subtract(state.enemyHealthRemaining);
}

export function advance(state: GameState, seconds: number): AdvanceReport {
  if (!Number.isFinite(seconds) || seconds <= 0) return emptyReport(state);

  const startFloor = state.floor;
  const stats = computeStats(state);
  const dps = stats.damagePerSecond;

  let remaining = seconds;
  let goldEarned = Decimal.ZERO;
  let damageDealt = Decimal.ZERO;
  let kills = 0;
  let guardiansFelled = 0;
  let guardiansEscaped = 0;
  let events = 0;

  const award = (amount: Decimal, count: number): void => {
    goldEarned = goldEarned.add(
      amount.multiply(stats.goldMultiplier).multiply(Decimal.of(count, 0)),
    );
  };

  while (remaining > TIME_EPSILON) {
    if (events >= MAX_EVENTS) break;
    events += 1;

    if (state.fightingGuardian) {
      const rate = effectiveDamageRate(dps, guardianHealth(state.floor));
      const killTime = timeToKill(state.enemyHealthRemaining, rate);
      const window = Math.min(remaining, state.guardianTimeRemaining);

      if (killTime <= window) {
        remaining -= killTime;
        damageDealt = damageDealt.add(state.enemyHealthRemaining);
        award(guardianGold(state.floor), 1);
        guardiansFelled += 1;
        kills += 1;
        state.stats.guardiansFelled += 1;
        state.stats.totalKills += 1;
        descendOneFloor(state);
        continue;
      }

      if (state.guardianTimeRemaining <= remaining) {
        // The timer runs out first. The hero is pushed back to the start of the
        // floor and has to clear the trash again before another attempt.
        remaining -= state.guardianTimeRemaining;
        guardiansEscaped += 1;
        state.stats.guardiansEscaped += 1;
        retreatToFloorStart(state);
        continue;
      }

      // The caller's budget expires mid-fight; carry the partial state forward.
      damageDealt = damageDealt.add(applyDamageOverTime(state, rate, remaining));
      state.guardianTimeRemaining -= remaining;
      remaining = 0;
      continue;
    }

    // Trash. Resolve the monster already in front of the hero first, since it
    // may be partly damaged, then batch the rest of the floor in one step.
    const trashRate = effectiveDamageRate(dps, monsterHealth(state.floor));
    const firstKillTime = timeToKill(state.enemyHealthRemaining, trashRate);
    if (firstKillTime > remaining) {
      damageDealt = damageDealt.add(applyDamageOverTime(state, trashRate, remaining));
      remaining = 0;
      continue;
    }

    remaining -= firstKillTime;
    damageDealt = damageDealt.add(state.enemyHealthRemaining);
    kills += 1;
    state.stats.totalKills += 1;
    state.killsOnFloor += 1;
    award(monsterGold(state.floor), 1);

    if (state.killsOnFloor >= KILLS_PER_FLOOR) {
      spawnGuardian(state);
      continue;
    }

    // The remaining monsters on this floor are identical and undamaged, so how
    // many of them fit in the budget is a division rather than a loop. This is
    // what keeps an eight-hour catch-up as cheap as a single frame.
    const perKill = timeToKill(monsterHealth(state.floor), trashRate);
    const outstanding = KILLS_PER_FLOOR - state.killsOnFloor;
    const affordable = Number.isFinite(perKill) ? Math.floor(remaining / perKill) : 0;
    const batch = Math.max(0, Math.min(outstanding, affordable));

    if (batch > 0) {
      remaining -= batch * perKill;
      damageDealt = damageDealt.add(monsterHealth(state.floor).multiply(Decimal.of(batch, 0)));
      kills += batch;
      state.stats.totalKills += batch;
      state.killsOnFloor += batch;
      award(monsterGold(state.floor), batch);
    }

    if (state.killsOnFloor >= KILLS_PER_FLOOR) spawnGuardian(state);
    else spawnMonster(state);
  }

  const consumed = seconds - Math.max(0, remaining);
  state.gold = state.gold.add(goldEarned);
  state.lifetimeGold = state.lifetimeGold.add(goldEarned);
  state.stats.playSeconds += consumed;
  if (state.blessingRemaining > 0) {
    state.blessingRemaining = Math.max(0, state.blessingRemaining - consumed);
  }

  return {
    seconds: consumed,
    goldEarned,
    damageDealt,
    kills,
    guardiansFelled,
    guardiansEscaped,
    startFloor,
    endFloor: state.floor,
    truncated: events >= MAX_EVENTS,
  };
}
