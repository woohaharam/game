/**
 * Everything the shop can sell, behind one shape.
 *
 * Upgrades and companions are different content and identical commerce: a name,
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
  buyCompanion,
  buyUpgrade,
  isCompanionUnlocked,
  isUpgradeMaxed,
  isUpgradeUnlocked,
  nextCompanionCost,
  nextUpgradeCost,
  quoteCompanion,
  quoteUpgrade,
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
    unlocked: (state) => isUpgradeUnlocked(state, definition),
    maxed: (state) => isUpgradeMaxed(state, definition),
    quote: (state, wanted) => quoteUpgrade(state, definition.id, wanted),
    unitPrice: (state) => nextUpgradeCost(state, definition.id),
    buy: (state, wanted) => {
      buyUpgrade(state, definition.id, wanted);
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
    unlocked: (state) => isCompanionUnlocked(state, definition),
    // Companions have no ceiling: they are the sink for a bank that has
    // outgrown every upgrade cap.
    maxed: () => false,
    quote: (state, wanted) => quoteCompanion(state, definition.id, wanted),
    unitPrice: (state) => nextCompanionCost(state, definition.id),
    buy: (state, wanted) => {
      buyCompanion(state, definition.id, wanted);
    },
  }));
}
