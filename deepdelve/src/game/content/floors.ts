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

/** Trash monsters cleared before the floor's guardian appears. */
export const KILLS_PER_FLOOR = 10;

/** Seconds the hero gets against a guardian before being pushed back. */
export const BOSS_TIME_LIMIT = 30;

/** A guardian is worth this many trash monsters in health. */
const BOSS_HEALTH_FACTOR = 14;

/** And this many in gold, so a floor clear feels like an event. */
const BOSS_GOLD_FACTOR = 9;

const BASE_HEALTH = 10;
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

/** Ten floors per zone; the names cycle, prefixed once the hero laps them. */
const ZONES = [
  'Mossy Crypt',
  'Bone Halls',
  'Ember Deep',
  'Drowned Vault',
  'Shadowspire',
  'Silent Foundry',
  'Weeping Gardens',
  'Obsidian Reach',
] as const;

export function zoneName(floor: number): string {
  const index = Math.max(0, Math.floor((floor - 1) / 10));
  const name = ZONES[index % ZONES.length] ?? ZONES[0];
  const lap = Math.floor(index / ZONES.length);
  if (lap === 0) return name;
  return `${name} · Deeper ${'I'.repeat(Math.min(lap, 3))}${lap > 3 ? `×${lap}` : ''}`;
}

const MONSTERS = [
  ['Crypt Rat', 'Grave Moss', 'Pale Beetle'],
  ['Rattling Bones', 'Bone Archer', 'Cracked Knight'],
  ['Ash Imp', 'Cinder Hound', 'Magma Slug'],
  ['Drowned Thrall', 'Reef Lurker', 'Barnacle Ogre'],
  ['Shade', 'Mirror Wraith', 'Nightbloom'],
  ['Rust Automaton', 'Steam Golem', 'Loose Cog'],
  ['Thornling', 'Weeping Dryad', 'Sap Horror'],
  ['Glass Stalker', 'Obsidian Maw', 'Void Shard'],
] as const;

export function monsterName(floor: number, index: number): string {
  const zone = Math.max(0, Math.floor((floor - 1) / 10)) % MONSTERS.length;
  const pool = MONSTERS[zone] ?? MONSTERS[0];
  return pool[Math.abs(index) % pool.length] ?? 'Something';
}

const GUARDIANS = [
  'The Grave Warden',
  'Ossuary King',
  'Cinderjaw',
  'The Drowned Choir',
  'Your Own Shadow',
  'Prime Automaton',
  'The Weeping Root',
  'Glass Tyrant',
] as const;

export function guardianName(floor: number): string {
  const zone = Math.max(0, Math.floor((floor - 1) / 10)) % GUARDIANS.length;
  return GUARDIANS[zone] ?? 'The Warden';
}
