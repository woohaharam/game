/**
 * Save encoding, decoding, and migration.
 *
 * A save is the player's entire relationship with the game. Every rule here
 * follows from that: never throw on bad input, never trust a field's type,
 * never let a missing key wipe a run. A save that loads 90% correctly is worth
 * far more than one that refuses to load at all, so decoding degrades field by
 * field toward a fresh state rather than rejecting the payload.
 *
 * The version number exists so that a player who last opened the game six
 * months ago still gets their hero back. Migrations run in sequence, each one
 * responsible only for the step it introduced.
 */

import { Decimal } from '@core/decimal';
import type { KeyValueStore } from '@core/storage';
import { COMPANIONS } from './content/companions';
import { UPGRADES } from './content/upgrades';
import { createInitialState, type GameState } from './state';

export const SAVE_VERSION = 1;
export const SAVE_KEY = 'deepdelve.save.v1';

/** Anything at all; decoding treats every field as hostile. */
type Unknown = Record<string, unknown>;

function asObject(value: unknown): Unknown {
  return typeof value === 'object' && value !== null ? (value as Unknown) : {};
}

function asFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Levels and counts: whole, non-negative, and bounded away from absurdity. */
function asCount(value: unknown, fallback = 0): number {
  const n = asFiniteNumber(value, fallback);
  return Math.max(0, Math.floor(n));
}

function asDecimal(value: unknown): Decimal {
  if (typeof value === 'string') return Decimal.parse(value);
  if (typeof value === 'number') return Decimal.from(value);
  return Decimal.ZERO;
}

export function encode(state: GameState, now = Date.now()): string {
  const payload = {
    v: SAVE_VERSION,
    floor: state.floor,
    highestFloor: state.highestFloor,
    killsOnFloor: state.killsOnFloor,
    fightingGuardian: state.fightingGuardian,
    guardianTimeRemaining: state.guardianTimeRemaining,
    enemyHealthRemaining: state.enemyHealthRemaining.serialise(),
    enemyIndex: state.enemyIndex,
    gold: state.gold.serialise(),
    lifetimeGold: state.lifetimeGold.serialise(),
    relics: state.relics.serialise(),
    lifetimeRelics: state.lifetimeRelics.serialise(),
    upgrades: state.upgrades,
    companions: state.companions,
    blessingRemaining: state.blessingRemaining,
    stats: state.stats,
    lastSeen: now,
  };
  return JSON.stringify(payload);
}

export interface DecodeResult {
  readonly state: GameState;
  /** False when nothing usable was found and a fresh run was started. */
  readonly loaded: boolean;
  /** True when the payload existed but had to be repaired. */
  readonly repaired: boolean;
}

export function decode(text: string | null, now = Date.now()): DecodeResult {
  const fresh = createInitialState(now);
  if (text === null || text === '') return { state: fresh, loaded: false, repaired: false };

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // A truncated write — a tab killed mid-save, a full quota. Nothing to
    // recover, but the player should not meet a stack trace.
    return { state: fresh, loaded: false, repaired: true };
  }

  const raw = asObject(parsed);
  if (Object.keys(raw).length === 0) return { state: fresh, loaded: false, repaired: true };

  const version = asCount(raw.v, 0);
  const migrated = migrate(raw, version);
  const state = fresh;
  let repaired = version !== SAVE_VERSION;

  state.floor = Math.max(1, asCount(migrated.floor, 1));
  state.highestFloor = asCount(migrated.highestFloor, 0);
  state.killsOnFloor = asCount(migrated.killsOnFloor, 0);
  state.fightingGuardian = migrated.fightingGuardian === true;
  state.guardianTimeRemaining = Math.max(0, asFiniteNumber(migrated.guardianTimeRemaining, 30));
  state.enemyIndex = asCount(migrated.enemyIndex, 0);
  state.gold = asDecimal(migrated.gold);
  state.lifetimeGold = asDecimal(migrated.lifetimeGold).max(state.gold);
  state.relics = asDecimal(migrated.relics);
  state.lifetimeRelics = asDecimal(migrated.lifetimeRelics).max(state.relics);
  state.blessingRemaining = Math.max(0, asFiniteNumber(migrated.blessingRemaining, 0));

  const health = asDecimal(migrated.enemyHealthRemaining);
  // A zero here would be indistinguishable from an enemy at death's door, which
  // would hand out a free kill on every load.
  state.enemyHealthRemaining =
    health.isZero || health.isNegative ? fresh.enemyHealthRemaining : health;

  const upgrades = asObject(migrated.upgrades);
  for (const upgrade of UPGRADES) {
    const level = asCount(upgrades[upgrade.id], 0);
    const capped = upgrade.maxLevel === undefined ? level : Math.min(level, upgrade.maxLevel);
    if (capped !== level) repaired = true;
    state.upgrades[upgrade.id] = capped;
  }

  const companions = asObject(migrated.companions);
  for (const companion of COMPANIONS) {
    state.companions[companion.id] = asCount(companions[companion.id], 0);
  }

  const stats = asObject(migrated.stats);
  state.stats.totalKills = asCount(stats.totalKills, 0);
  state.stats.guardiansFelled = asCount(stats.guardiansFelled, 0);
  state.stats.guardiansEscaped = asCount(stats.guardiansEscaped, 0);
  state.stats.descents = asCount(stats.descents, 0);
  state.stats.playSeconds = Math.max(0, asFiniteNumber(stats.playSeconds, 0));

  state.lastSeen = asFiniteNumber(migrated.lastSeen, now);
  // A save claiming to come from the future is either a clock change or an
  // edit; either way, crediting offline time against it would be wrong.
  if (state.lastSeen > now) {
    state.lastSeen = now;
    repaired = true;
  }

  // The highest floor is what relics are paid against, so it can never be
  // behind the current one — that would be a free rebate on a descent.
  if (state.highestFloor < state.floor - 1) {
    state.highestFloor = state.floor - 1;
    repaired = true;
  }

  return { state, loaded: true, repaired };
}

/**
 * Brings an older payload up to the current shape.
 *
 * Version 1 is the first published format, so there is nothing to migrate yet.
 * The sequence is here from the start because retrofitting migrations onto a
 * format that never had them means guessing what old saves looked like.
 */
function migrate(raw: Unknown, version: number): Unknown {
  const current = raw;
  let at = version;

  // Saves written before versioning (or with a mangled version field) are read
  // on a best-effort basis at the current shape; every field is defaulted
  // anyway, so the worst case is a partially recovered run rather than a loss.
  if (at < 1) at = 1;

  while (at < SAVE_VERSION) {
    // Each future version appends a step here, e.g.:
    //   if (at === 1) current = migrateV1toV2(current);
    at += 1;
  }

  return current;
}

export function save(store: KeyValueStore, state: GameState, now = Date.now()): boolean {
  state.lastSeen = now;
  return store.write(SAVE_KEY, encode(state, now));
}

export function load(store: KeyValueStore, now = Date.now()): DecodeResult {
  return decode(store.read(SAVE_KEY), now);
}

export function wipe(store: KeyValueStore): void {
  store.remove(SAVE_KEY);
}
