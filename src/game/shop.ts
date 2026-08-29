/**
 * Spending dust.
 *
 * Purchases are the only thing in the game the player actually does, which
 * makes this the strictest module: every function validates against the live
 * state before mutating anything, and reports what happened rather than
 * throwing. A UI that offers a button it should not have offered is a bug, but
 * it must never be a crash, and it must never charge for what it did not give.
 */

import { Decimal } from '@core/decimal';
import {
  affordableLevels,
  bulkCost,
  costAt,
  headroom,
  type CostCurve,
} from './content/cost-curve';
import {
  UPGRADES,
  upgradeById,
  type UpgradeDefinition,
  type UpgradeId,
} from './content/upgrades';
import {
  COMPANIONS,
  companionById,
  type CompanionDefinition,
  type CompanionId,
} from './content/companions';
import type { GameState } from './state';

export interface Purchase {
  readonly bought: number;
  readonly spent: Decimal;
}

const NOTHING: Purchase = { bought: 0, spent: Decimal.ZERO };

/**
 * How far the closed-form estimate is allowed to be corrected, in either
 * direction.
 *
 * `affordableLevels` inverts a logarithm over floating-point Decimals, so it
 * can land one level either side of the truth — and it lands there exactly
 * where it matters, when a player presses MAX holding precisely the price of N
 * levels. Rounding down short-changes them; rounding up would charge dust they
 * do not have. Both were observed before this correction existed: dust equal to
 * one level's price bought nothing, and dust equal to twenty-five levels'
 * bought twenty-four.
 *
 * In practice the loops below run zero or one times. The bound exists so that a
 * pathological curve cannot spin.
 */
const PRICE_CORRECTION_STEPS = 8;

/** Everything a purchase needs to know, independent of what is being bought. */
interface Purchasable {
  readonly curve: CostCurve;
  readonly level: number;
}

/**
 * Resolves how many levels can actually be bought and what they cost.
 *
 * Returns the largest count whose true series cost the bank covers, which is
 * not always what the inverted logarithm suggests — hence the correction. The
 * alternative, trusting the estimate, charges players dust they do not have.
 */
function priceFor(state: GameState, target: Purchasable, wanted: number): Purchase {
  const room = Math.min(wanted, headroom(target.curve, target.level));
  if (room <= 0) return NOTHING;

  const affordable = (count: number): boolean =>
    !bulkCost(target.curve, target.level, count).greaterThan(state.dust);

  let count = Math.max(
    0,
    Math.min(room, affordableLevels(target.curve, target.level, state.dust)),
  );

  // Correct in whichever direction the estimate is wrong. Only one of these
  // loops can make progress, so they cannot fight each other.
  for (let step = 0; step < PRICE_CORRECTION_STEPS; step += 1) {
    if (count >= room || !affordable(count + 1)) break;
    count += 1;
  }
  for (let step = 0; step < PRICE_CORRECTION_STEPS; step += 1) {
    if (count <= 0 || affordable(count)) break;
    count -= 1;
  }

  if (count <= 0) return NOTHING;
  return { bought: count, spent: bulkCost(target.curve, target.level, count) };
}

// -- availability ----------------------------------------------------------

/** Things appear only once the stone has grown far enough to meet them. */
export function isRefinementUnlocked(state: GameState, definition: UpgradeDefinition): boolean {
  return Math.max(state.stage, state.highestStage) >= definition.unlockStage;
}

export function isOrbiterUnlocked(state: GameState, definition: CompanionDefinition): boolean {
  return Math.max(state.stage, state.highestStage) >= definition.unlockStage;
}

export function isRefinementMaxed(state: GameState, definition: UpgradeDefinition): boolean {
  return headroom(definition, state.upgrades[definition.id]) === 0;
}

export function refinementPrice(state: GameState, id: UpgradeId): Decimal {
  return costAt(upgradeById(id), state.upgrades[id]);
}

export function orbiterPrice(state: GameState, id: CompanionId): Decimal {
  return costAt(companionById(id), state.companions[id]);
}

/** What a purchase of `wanted` levels would cost and buy, without buying it. */
export function quoteRefinement(state: GameState, id: UpgradeId, wanted: number): Purchase {
  const definition = upgradeById(id);
  if (!isRefinementUnlocked(state, definition)) return NOTHING;
  return priceFor(state, { curve: definition, level: state.upgrades[id] }, wanted);
}

export function quoteOrbiter(state: GameState, id: CompanionId, wanted: number): Purchase {
  const definition = companionById(id);
  if (!isOrbiterUnlocked(state, definition)) return NOTHING;
  return priceFor(state, { curve: definition, level: state.companions[id] }, wanted);
}

// -- purchasing ------------------------------------------------------------

/** Buys up to `count` levels, or as many as the bank allows. */
export function buyRefinement(state: GameState, id: UpgradeId, count = 1): Purchase {
  if (count <= 0) return NOTHING;

  const purchase = quoteRefinement(state, id, count);
  if (purchase.bought === 0) return NOTHING;

  state.dust = state.dust.subtract(purchase.spent);
  state.upgrades[id] += purchase.bought;
  return purchase;
}

export function buyOrbiter(state: GameState, id: CompanionId, count = 1): Purchase {
  if (count <= 0) return NOTHING;

  const purchase = quoteOrbiter(state, id, count);
  if (purchase.bought === 0) return NOTHING;

  state.dust = state.dust.subtract(purchase.spent);
  state.companions[id] += purchase.bought;
  return purchase;
}

// -- a stand-in for a player -----------------------------------------------

type PurchaseChoice =
  | { readonly kind: 'upgrade'; readonly id: UpgradeId }
  | { readonly kind: 'companion'; readonly id: CompanionId };

/** The cheapest thing the bank can currently afford, or null if nothing can. */
function cheapestAffordable(state: GameState): PurchaseChoice | null {
  let best: PurchaseChoice | null = null;
  let bestCost = Decimal.ZERO;

  for (const definition of UPGRADES) {
    if (!isRefinementUnlocked(state, definition) || isRefinementMaxed(state, definition))
      continue;

    const cost = costAt(definition, state.upgrades[definition.id]);
    if (cost.greaterThan(state.dust)) continue;
    if (best === null || cost.lessThan(bestCost)) {
      best = { kind: 'upgrade', id: definition.id };
      bestCost = cost;
    }
  }

  // Companions compete on the same axis as upgrades, so the cheaper of the two
  // wins regardless of which list it came from.
  for (const definition of COMPANIONS) {
    if (!isOrbiterUnlocked(state, definition)) continue;

    const cost = costAt(definition, state.companions[definition.id]);
    if (cost.greaterThan(state.dust)) continue;
    if (best === null || cost.lessThan(bestCost)) {
      best = { kind: 'companion', id: definition.id };
      bestCost = cost;
    }
  }

  return best;
}

/**
 * Buy the cheapest thing available, repeat.
 *
 * This exists for two reasons. It is what an unlocked auto-spend convenience
 * would do, and — more importantly — it is what lets a test or a balance run
 * measure progression, because a stone that never spends dust never passes the
 * first wall and tells you nothing about the curves.
 *
 * Cheapest-first is not optimal play, and that is the point: every number it
 * produces is a lower bound. A curve that is satisfying under a shopper this
 * naive is satisfying; one that stalls here needs looking at.
 */
export function spendGreedily(state: GameState, maxPurchases = 20_000): number {
  let purchases = 0;

  while (purchases < maxPurchases) {
    const choice = cheapestAffordable(state);
    if (choice === null) break;

    const purchase =
      choice.kind === 'upgrade'
        ? buyRefinement(state, choice.id, 1)
        : buyOrbiter(state, choice.id, 1);
    if (purchase.bought === 0) break;
    purchases += 1;
  }

  return purchases;
}
