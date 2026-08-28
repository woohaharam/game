/**
 * Floor curves: how hard a floor is and what it pays.
 *
 * The two growth rates are the whole balance of the game. Monster health grows
 * faster than monster gold, so raw farming always eventually stalls — that gap
 * is what makes descending (prestige) the only way forward rather than an
 * optional extra. Widen the gap and the game becomes a grind; close it and the
 * player never has a reason to reset.
 */

import { Decimal } from '@core/decimal';
import { t } from '@core/i18n';

/** Trash monsters cleared before the floor's guardian appears. */
export const KILLS_PER_FLOOR = 10;

/** Seconds the hero gets against a guardian before being pushed back. */
export const BOSS_TIME_LIMIT = 30;

/** A guardian is worth this many trash monsters in health. */
const BOSS_HEALTH_FACTOR = 14;

/** And this many in gold, so a floor clear feels like an event. */
const BOSS_GOLD_FACTOR = 9;

/**
 * Floor 1 is tuned so the very first monster dies in about two seconds.
 *
 * Measured in a browser: at the original 10 health against a starting 1.05
 * damage per second, the opening nine and a half seconds of the game showed a
 * health bar moving and nothing else — no kill, no gold, no reason to stay. A
 * portal player decides in less time than that. Floor 1's guardian still falls
 * just inside its timer without a purchase, so the first floor clears itself and
 * the second one is where the shop starts to matter.
 */
const BASE_HEALTH = 6;
const HEALTH_GROWTH = 1.55;

const BASE_GOLD = 4;
const GOLD_GROWTH = 1.47;

/**
 * Kills are never instant, however overpowered the hero.
 *
 * Without this the loop can clear unbounded floors in zero simulated time, and
 * the kill feed becomes an unreadable blur. 20 kills per second is already past
 * what anyone can follow.
 */
export const MIN_KILL_TIME = 0.05;

export function isBossFloor(floor: number): boolean {
  return floor % 5 === 0;
}

export function monsterHealth(floor: number): Decimal {
  return Decimal.of(BASE_HEALTH, 0).multiply(Decimal.of(HEALTH_GROWTH, 0).pow(floor - 1));
}

export function monsterGold(floor: number): Decimal {
  return Decimal.of(BASE_GOLD, 0).multiply(Decimal.of(GOLD_GROWTH, 0).pow(floor - 1));
}

export function guardianHealth(floor: number): Decimal {
  return monsterHealth(floor).multiply(Decimal.of(BOSS_HEALTH_FACTOR, 0));
}

export function guardianGold(floor: number): Decimal {
  return monsterGold(floor).multiply(Decimal.of(BOSS_GOLD_FACTOR, 0));
}

/**
 * Ten floors per zone; the names cycle, prefixed once the hero laps them.
 *
 * The names themselves live in the locale tables — this module owns which zone
 * a floor belongs to, not what that zone is called, so adding a language never
 * touches the curves.
 */
export const ZONE_COUNT = 8;

/** Distinct monster names per zone, so a floor is not ten identical rats. */
export const MONSTERS_PER_ZONE = 3;

function zoneIndex(floor: number): number {
  return Math.max(0, Math.floor((floor - 1) / 10));
}

export function zoneName(floor: number): string {
  const index = zoneIndex(floor);
  const key = `zone.${(index % ZONE_COUNT) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7}` as const;
  const name = t(key);

  const lap = Math.floor(index / ZONE_COUNT);
  if (lap === 0) return name;
  return t('zone.deeper', { zone: name, lap });
}

export function monsterName(floor: number, index: number): string {
  const zone = (zoneIndex(floor) % ZONE_COUNT) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  const slot = (Math.abs(index) % MONSTERS_PER_ZONE) as 0 | 1 | 2;
  return t(`monster.${zone}.${slot}` as const);
}

export function guardianName(floor: number): string {
  const zone = (zoneIndex(floor) % ZONE_COUNT) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
  return t(`guardian.${zone}` as const);
}
