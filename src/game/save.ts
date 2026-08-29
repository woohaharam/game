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

export const SAVE_VERSION = 2;

/**
 * The key is not versioned even though the payload is.
 *
 * A versioned key means an upgrade silently abandons the old save under its old
 * key and starts the player from nothing, which is the failure this whole module
 * exists to prevent. One key plus a version field inside it means `migrate` is
 * always given the chance to bring an old save forward.
 */
export const SAVE_KEY = 'pebble.save';

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
    stage: state.stage,
    highestStage: state.highestStage,
    fragmentsOnStage: state.fragmentsOnStage,
    fragmentRemaining: state.fragmentRemaining.serialise(),
    fragmentIndex: state.fragmentIndex,
    mass: state.mass.serialise(),
    dust: state.dust.serialise(),
    lifetimeDust: state.lifetimeDust.serialise(),
    crystals: state.crystals.serialise(),
    lifetimeCrystals: state.lifetimeCrystals.serialise(),
    upgrades: state.upgrades,
    companions: state.companions,
    blessingRemaining: state.blessingRemaining,
    autoRefine: state.autoRefine,
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

  state.stage = Math.max(1, asCount(migrated.stage, 1));
  state.highestStage = asCount(migrated.highestStage, 0);
  state.fragmentsOnStage = asCount(migrated.fragmentsOnStage, 0);
  state.fragmentIndex = asCount(migrated.fragmentIndex, 0);
  state.mass = asDecimal(migrated.mass);
  state.dust = asDecimal(migrated.dust);
  state.lifetimeDust = asDecimal(migrated.lifetimeDust).max(state.dust);
  state.crystals = asDecimal(migrated.crystals);
  state.lifetimeCrystals = asDecimal(migrated.lifetimeCrystals).max(state.crystals);
  state.blessingRemaining = Math.max(0, asFiniteNumber(migrated.blessingRemaining, 0));
  state.autoRefine = migrated.autoRefine === true;

  const partial = asDecimal(migrated.fragmentRemaining);
  // A zero here would be indistinguishable from a fragment about to land, which
  // would hand out a free absorption on every load.
  state.fragmentRemaining =
    partial.isZero || partial.isNegative ? fresh.fragmentRemaining : partial;

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
  state.stats.totalFragments = asCount(stats.totalFragments, 0);
  state.stats.stagesReached = asCount(stats.stagesReached, 0);
  state.stats.compressions = asCount(stats.compressions, 0);
  state.stats.playSeconds = Math.max(0, asFiniteNumber(stats.playSeconds, 0));

  state.lastSeen = asFiniteNumber(migrated.lastSeen, now);
  // A save claiming to come from the future is either a clock change or an
  // edit; either way, crediting offline time against it would be wrong.
  if (state.lastSeen > now) {
    state.lastSeen = now;
    repaired = true;
  }

  // The highest stage is what crystals are paid against, so it can never be
  // behind the current one — that would be a free rebate on a compression.
  if (state.highestStage < state.stage - 1) {
    state.highestStage = state.stage - 1;
    repaired = true;
  }

  return { state, loaded: true, repaired };
}

/**
 * Brings an older payload up to the current shape.
 *
 * Version 1 was the dungeon game this grew out of, and it shared nothing but a
 * shape: floors instead of stages, gold instead of dust, relics instead of
 * crystals. The names map one to one, and a player who was on floor 40 with
 * 12,000 gold has earned being on stage 40 with 12,000 dust — so the migration
 * renames rather than discards. Dropping the save instead would have been less
 * code and a worse thing to do to somebody.
 */
function migrateV1toV2(raw: Unknown): Unknown {
  const stats = asObject(raw.stats);
  return {
    ...raw,
    v: 2,
    stage: raw.floor,
    highestStage: raw.highestFloor,
    fragmentsOnStage: raw.killsOnFloor,
    fragmentRemaining: raw.enemyHealthRemaining,
    fragmentIndex: raw.enemyIndex,
    // Version 1 had no mass; it is derived from nothing, so the stone starts
    // its new life weightless and grows from where the player actually is.
    mass: undefined,
    dust: raw.gold,
    lifetimeDust: raw.lifetimeGold,
    crystals: raw.relics,
    lifetimeCrystals: raw.lifetimeRelics,
    autoRefine: raw.autoDelve,
    stats: {
      totalFragments: stats.totalKills,
      stagesReached: stats.guardiansFelled,
      compressions: stats.descents,
      playSeconds: stats.playSeconds,
    },
  };
}

function migrate(raw: Unknown, version: number): Unknown {
  let current = raw;
  let at = version;

  // Saves written before versioning (or with a mangled version field) are read
  // on a best-effort basis at the oldest known shape; every field is defaulted
  // anyway, so the worst case is a partially recovered stone rather than a loss.
  if (at < 1) at = 1;

  while (at < SAVE_VERSION) {
    if (at === 1) current = migrateV1toV2(current);
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
