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
import { fragmentMass } from './content/stages';

export interface RunStatistics {
  totalFragments: number;
  stagesReached: number;
  compressions: number;
  playSeconds: number;
}

export interface GameState {
  /** The stage being grown through right now. Resets to 1 on compression. */
  stage: number;
  /** Deepest stage ever reached, which is what crystals are paid against. */
  highestStage: number;
  fragmentsOnStage: number;
  /** Mass left in the fragment currently being drawn in. */
  fragmentRemaining: Decimal;
  /** Cycles the displayed fragment name so a stage is not ten identical lumps. */
  fragmentIndex: number;

  /**
   * The stone's mass, in grams. Only ever goes up.
   *
   * Not a currency — it is the thing the player is growing, and the number they
   * actually watch. Spending it would mean the stone shrinks when you improve
   * it, which is the wrong feeling for the entire genre.
   */
  mass: Decimal;

  /** The spendable currency, sieved out of fragments as they are absorbed. */
  dust: Decimal;
  lifetimeDust: Decimal;
  crystals: Decimal;
  lifetimeCrystals: Decimal;

  upgrades: Record<UpgradeId, number>;
  companions: Record<CompanionId, number>;

  /** Seconds of doubled output remaining from a watched advertisement. */
  blessingRemaining: number;

  /**
   * Whether the stone spends dust without being asked.
   *
   * Unlocked by the first compression, which is the point where re-buying the
   * same early refinements stops being a decision and starts being a chore. Off
   * by default even once unlocked: a player who wants to spend deliberately
   * should not have that taken away.
   */
  autoRefine: boolean;

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
    stage: 1,
    highestStage: 0,
    fragmentsOnStage: 0,
    fragmentRemaining: fragmentMass(1),
    fragmentIndex: 0,
    mass: Decimal.ZERO,
    dust: Decimal.ZERO,
    lifetimeDust: Decimal.ZERO,
    crystals: Decimal.ZERO,
    lifetimeCrystals: Decimal.ZERO,
    upgrades: emptyUpgrades(),
    companions: emptyCompanions(),
    blessingRemaining: 0,
    autoRefine: false,
    stats: {
      totalFragments: 0,
      stagesReached: 0,
      compressions: 0,
      playSeconds: 0,
    },
    lastSeen: now,
  };
}

/** Draws a fresh fragment towards the stone at the current stage. */
export function spawnFragment(state: GameState): void {
  state.fragmentIndex += 1;
  state.fragmentRemaining = fragmentMass(state.stage);
}

/**
 * Moves to the next stage.
 *
 * There is no way back. A dungeon crawler can push a hero down a floor; a stone
 * that has grown cannot un-grow, so the only thing a stage too heavy to absorb
 * does is slow the player down. That is the genre's honest version of a wall,
 * and it is why this game has no failure state at all.
 */
export function growToNextStage(state: GameState): void {
  state.highestStage = Math.max(state.highestStage, state.stage);
  state.stage += 1;
  state.fragmentsOnStage = 0;
  spawnFragment(state);
}

export function wholeFragmentMass(state: GameState): Decimal {
  return fragmentMass(state.stage);
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
