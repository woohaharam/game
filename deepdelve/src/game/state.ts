/**
 * The complete mutable game state and its transitions.
 *
 * One object holds everything the simulation touches, and everything in it is
 * either a plain number or a Decimal — no functions, no class instances beyond
 * Decimal, no references into the DOM. That is what makes the save format a
 * near-direct projection of this shape, and what lets a test construct any
 * situation it wants without booting the game.
 */

import { Decimal } from '@core/decimal';
import { COMPANIONS, type CompanionId } from './content/companions';
import { UPGRADES, type UpgradeId } from './content/upgrades';
import { BOSS_TIME_LIMIT, guardianHealth, monsterHealth } from './content/floors';

export interface RunStatistics {
  totalKills: number;
  guardiansFelled: number;
  guardiansEscaped: number;
  descents: number;
  playSeconds: number;
}

export interface GameState {
  /** The floor being fought on right now. Resets to 1 on descent. */
  floor: number;
  /** Deepest floor ever *cleared*, which is what relics are paid against. */
  highestFloor: number;
  killsOnFloor: number;
  fightingGuardian: boolean;
  guardianTimeRemaining: number;
  enemyHealthRemaining: Decimal;
  /** Cycles the displayed monster name so a floor is not ten identical rats. */
  enemyIndex: number;

  gold: Decimal;
  lifetimeGold: Decimal;
  relics: Decimal;
  lifetimeRelics: Decimal;

  upgrades: Record<UpgradeId, number>;
  companions: Record<CompanionId, number>;

  /** Seconds of doubled output remaining from a watched advertisement. */
  blessingRemaining: number;

  /**
   * Whether the hero spends gold without being asked.
   *
   * Unlocked by the first descent, which is the point where re-buying the same
   * early upgrades stops being a decision and starts being a chore. Off by
   * default even once unlocked: a player who wants to spend deliberately should
   * not have that taken away.
   */
  autoDelve: boolean;

  stats: RunStatistics;
  /** Epoch milliseconds of the last save, used to compute offline progress. */
  lastSeen: number;
}

function emptyUpgrades(): Record<UpgradeId, number> {
  const record = {} as Record<UpgradeId, number>;
  for (const upgrade of UPGRADES) record[upgrade.id] = 0;
  return record;
}

function emptyCompanions(): Record<CompanionId, number> {
  const record = {} as Record<CompanionId, number>;
  for (const companion of COMPANIONS) record[companion.id] = 0;
  return record;
}

export function createInitialState(now = Date.now()): GameState {
  return {
    floor: 1,
    highestFloor: 0,
    killsOnFloor: 0,
    fightingGuardian: false,
    guardianTimeRemaining: BOSS_TIME_LIMIT,
    enemyHealthRemaining: monsterHealth(1),
    enemyIndex: 0,
    gold: Decimal.ZERO,
    lifetimeGold: Decimal.ZERO,
    relics: Decimal.ZERO,
    lifetimeRelics: Decimal.ZERO,
    upgrades: emptyUpgrades(),
    companions: emptyCompanions(),
    blessingRemaining: 0,
    autoDelve: false,
    stats: {
      totalKills: 0,
      guardiansFelled: 0,
      guardiansEscaped: 0,
      descents: 0,
      playSeconds: 0,
    },
    lastSeen: now,
  };
}

/** Puts a fresh trash monster in front of the hero on the current floor. */
export function spawnMonster(state: GameState): void {
  state.fightingGuardian = false;
  state.enemyIndex += 1;
  state.enemyHealthRemaining = monsterHealth(state.floor);
}

/** Starts the floor's guardian fight, with a fresh timer. */
export function spawnGuardian(state: GameState): void {
  state.fightingGuardian = true;
  state.guardianTimeRemaining = BOSS_TIME_LIMIT;
  state.enemyHealthRemaining = guardianHealth(state.floor);
}

/**
 * Sends the hero back to the start of the current floor.
 *
 * Failing a guardian costs progress on the floor but never the floor itself —
 * an idle game the player cannot leave running is not an idle game, so the
 * failure state has to be a stall, not a loss.
 */
export function retreatToFloorStart(state: GameState): void {
  state.killsOnFloor = 0;
  spawnMonster(state);
}

/** Moves to the next floor after a guardian falls. */
export function descendOneFloor(state: GameState): void {
  state.highestFloor = Math.max(state.highestFloor, state.floor);
  state.floor += 1;
  state.killsOnFloor = 0;
  spawnMonster(state);
}

export function maxHealthOfCurrentEnemy(state: GameState): Decimal {
  return state.fightingGuardian ? guardianHealth(state.floor) : monsterHealth(state.floor);
}

/**
 * A deep copy, for asking "what would happen if…" without it happening.
 *
 * Written by hand rather than with `structuredClone`, which cannot carry the
 * Decimal instances across. Decimals are immutable, so they are shared rather
 * than copied — that is the point of making them immutable.
 */
export function cloneState(state: GameState): GameState {
  return {
    ...state,
    upgrades: { ...state.upgrades },
    companions: { ...state.companions },
    stats: { ...state.stats },
  };
}
