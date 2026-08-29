/**
 * Everything the shop can sell, behind one shape.
 *
 * Refinements and orbiters are different content and identical commerce: a name,
 * an icon, a level, a price that follows the same geometric curve, and a rule
 * for when they appear. Describing both as `ShopEntry` is what lets a single
 * panel render either — and, more usefully, means a bug fixed in how a price is
 * displayed is fixed for both, which is not what happened when the two had
 * separate render paths.
 *
 * The entries are functions of state rather than snapshots, because a shop row
 * is repainted many times a second against a state that keeps moving.
 */

import type { Decimal } from '@core/decimal';
import { t } from '@core/i18n';
import { formatNumber } from '@core/format';
import { COMPANIONS, companionName } from '@game/content/companions';
import { UPGRADES, upgradeDescription, upgradeName } from '@game/content/upgrades';
import {
  buyOrbiter,
  buyRefinement,
  isOrbiterUnlocked,
  isRefinementMaxed,
  isRefinementUnlocked,
  orbiterPrice,
  refinementPrice,
  quoteOrbiter,
  quoteRefinement,
  type Purchase,
} from '@game/shop';
import type { GameState } from '@game/state';

export interface ShopEntry {
  /** Stable across locales and rebuilds; used as the row's DOM key. */
  readonly key: string;
  readonly icon: string;
  name(): string;
  description(): string;
  level(state: GameState): number;
  unlocked(state: GameState): boolean;
  maxed(state: GameState): boolean;
  /** What buying `wanted` levels would cost and buy, without buying it. */
  quote(state: GameState, wanted: number): Purchase;
  /** One level's price, shown when nothing is affordable yet. */
  unitPrice(state: GameState): Decimal;
  buy(state: GameState, wanted: number): void;
}

export function upgradeEntries(): readonly ShopEntry[] {
  return UPGRADES.map((definition) => ({
    key: definition.id,
    icon: definition.icon,
    name: () => upgradeName(definition.id),
    description: () => upgradeDescription(definition.id),
    level: (state) => state.upgrades[definition.id],
    unlocked: (state) => isRefinementUnlocked(state, definition),
    maxed: (state) => isRefinementMaxed(state, definition),
    quote: (state, wanted) => quoteRefinement(state, definition.id, wanted),
    unitPrice: (state) => refinementPrice(state, definition.id),
    buy: (state, wanted) => {
      buyRefinement(state, definition.id, wanted);
    },
  }));
}

export function companionEntries(): readonly ShopEntry[] {
  return COMPANIONS.map((definition) => ({
    key: definition.id,
    icon: definition.icon,
    name: () => companionName(definition.id),
    description: () => t('party.damage', { amount: formatNumber(definition.damagePerLevel) }),
    level: (state) => state.companions[definition.id],
    unlocked: (state) => isOrbiterUnlocked(state, definition),
    // Orbiters have no ceiling: they are the sink for a bank that has
    // outgrown every refinement cap.
    maxed: () => false,
    quote: (state, wanted) => quoteOrbiter(state, definition.id, wanted),
    unitPrice: (state) => orbiterPrice(state, definition.id),
    buy: (state, wanted) => {
      buyOrbiter(state, definition.id, wanted);
    },
  }));
}
