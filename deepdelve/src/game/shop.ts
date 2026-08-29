/**
 * Spending gold.
 *
 * Purchases are the only thing in the game the player actually does, so this
 * module is deliberately the strictest one: every function validates the
 * purchase against the live state before mutating anything, and returns what
 * happened rather than throwing. A UI that offers a button it should not have
 * offered is a bug, but it must never be a crash.
 */

import { Decimal } from '@core/decimal';
import {
  UPGRADES,
  affordableLevels,
  upgradeBulkCost,
  upgradeById,
  upgradeCost,
  type UpgradeDefinition,
  type UpgradeId,
} from './content/upgrades';
import {
  COMPANIONS,
  companionById,
  companionCost,
  type CompanionDefinition,
  type CompanionId,
} from './content/companions';
import type { GameState } from './state';

export interface Purchase {
  readonly bought: number;
  readonly spent: Decimal;
}

const NOTHING: Purchase = { bought: 0, spent: Decimal.ZERO };

/** Upgrades appear only once the run has been deep enough to have met them. */
export function isUpgradeUnlocked(state: GameState, definition: UpgradeDefinition): boolean {
  return Math.max(state.floor, state.highestFloor) >= definition.unlockFloor;
}

export function isCompanionUnlocked(
  state: GameState,
  definition: CompanionDefinition,
): boolean {
  return Math.max(state.floor, state.highestFloor) >= definition.unlockFloor;
}

export function visibleUpgrades(state: GameState): readonly UpgradeDefinition[] {
  return UPGRADES.filter((upgrade) => isUpgradeUnlocked(state, upgrade));
}

export function visibleCompanions(state: GameState): readonly CompanionDefinition[] {
  return COMPANIONS.filter((companion) => isCompanionUnlocked(state, companion));
}

export function nextUpgradeCost(state: GameState, id: UpgradeId): Decimal {
  return upgradeCost(upgradeById(id), state.upgrades[id]);
}

export function nextCompanionCost(state: GameState, id: CompanionId): Decimal {
  return companionCost(companionById(id), state.companions[id]);
}

/** Buys up to `count` levels, or as many as the bank allows. */
export function buyUpgrade(state: GameState, id: UpgradeId, count = 1): Purchase {
  const definition = upgradeById(id);
  if (!isUpgradeUnlocked(state, definition) || count <= 0) return NOTHING;

  const level = state.upgrades[id];
  const possible = Math.min(count, affordableLevels(definition, level, state.gold));
  if (possible <= 0) return NOTHING;

  const spent = upgradeBulkCost(definition, level, possible);
  // The closed-form series can land a hair above the bank at the boundary;
  // taking one fewer level is the honest correction, since the alternative is
  // charging a player gold they do not have.
  if (spent.greaterThan(state.gold)) {
    if (possible === 1) return NOTHING;
    return buyUpgrade(state, id, possible - 1);
  }

  state.gold = state.gold.subtract(spent);
  state.upgrades[id] = level + possible;
  return { bought: possible, spent };
}

/** Buys every level the bank can currently afford. */
export function buyMaxUpgrade(state: GameState, id: UpgradeId): Purchase {
  const definition = upgradeById(id);
  if (!isUpgradeUnlocked(state, definition)) return NOTHING;
  return buyUpgrade(state, id, affordableLevels(definition, state.upgrades[id], state.gold));
}

export function buyCompanion(state: GameState, id: CompanionId, count = 1): Purchase {
  const definition = companionById(id);
  if (!isCompanionUnlocked(state, definition) || count <= 0) return NOTHING;

  let bought = 0;
  let spent = Decimal.ZERO;
  // Companion levels are bought a handful at a time rather than in thousands,
  // so a loop is clearer here than inverting the series and cheap enough.
  for (let i = 0; i < count; i += 1) {
    const price = companionCost(definition, state.companions[id] + bought);
    const remaining = state.gold.subtract(spent);
    if (price.greaterThan(remaining)) break;
    spent = spent.add(price);
    bought += 1;
  }

  if (bought === 0) return NOTHING;
  state.gold = state.gold.subtract(spent);
  state.companions[id] += bought;
  return { bought, spent };
}

/**
 * A stand-in for a player at the shop: buy the cheapest thing available, repeat.
 *
 * This exists for two reasons. It is what an unlocked auto-spend convenience
 * would do, and — more importantly — it is what lets a test or a balance run
 * measure progression, because a hero who never spends gold never gets past the
 * first guardian and tells you nothing about the curves.
 *
 * Cheapest-first is not optimal play, and that is the point: it is a *floor* on
 * how well the curves perform. If the game is satisfying under a shopper this
 * naive, a thoughtful player will do better.
 */
type PurchaseChoice =
  | { readonly kind: 'upgrade'; readonly id: UpgradeId }
  | { readonly kind: 'companion'; readonly id: CompanionId };

/** The cheapest thing the bank can currently afford, or null if nothing can. */
function cheapestAffordable(state: GameState): PurchaseChoice | null {
  let best: PurchaseChoice | null = null;
  let bestCost = Decimal.ZERO;

  for (const definition of UPGRADES) {
    if (!isUpgradeUnlocked(state, definition)) continue;
    const level = state.upgrades[definition.id];
    if (definition.maxLevel !== undefined && level >= definition.maxLevel) continue;

    const cost = upgradeCost(definition, level);
    if (cost.greaterThan(state.gold)) continue;
    if (best === null || cost.lessThan(bestCost)) {
      best = { kind: 'upgrade', id: definition.id };
      bestCost = cost;
    }
  }

  // Companions compete on the same axis as upgrades, so the cheaper of the two
  // wins regardless of which list it came from.
  for (const definition of COMPANIONS) {
    if (!isCompanionUnlocked(state, definition)) continue;

    const cost = companionCost(definition, state.companions[definition.id]);
    if (cost.greaterThan(state.gold)) continue;
    if (best === null || cost.lessThan(bestCost)) {
      best = { kind: 'companion', id: definition.id };
      bestCost = cost;
    }
  }

  return best;
}

export function spendGreedily(state: GameState, maxPurchases = 20_000): number {
  let purchases = 0;

  while (purchases < maxPurchases) {
    const choice = cheapestAffordable(state);
    if (choice === null) break;

    const purchase =
      choice.kind === 'upgrade'
        ? buyUpgrade(state, choice.id, 1)
        : buyCompanion(state, choice.id, 1);
    if (purchase.bought === 0) break;
    purchases += 1;
  }

  return purchases;
}
