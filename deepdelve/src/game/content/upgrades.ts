/**
 * Purchasable upgrades.
 *
 * Every upgrade is data, not code: an id, a cost curve, and a pure function
 * from level to its contribution. Nothing here knows about the hero, the UI, or
 * the save format, so rebalancing is a number change and adding an upgrade is
 * one array entry.
 *
 * Cost growth is the dial that decides how long an upgrade stays interesting.
 * A low growth (1.12) stays buyable for hundreds of levels and carries early
 * progression; a high one (1.5) is a rare, deliberate purchase. Mixing both is
 * what keeps the shop from collapsing into "always buy the cheapest".
 */

import { Decimal } from '@core/decimal';
import { t } from '@core/i18n';

export type UpgradeId = 'blade' | 'swiftness' | 'precision' | 'ferocity' | 'greed' | 'tome';

export interface UpgradeDefinition {
  readonly id: UpgradeId;
  readonly icon: string;
  readonly baseCost: Decimal;
  readonly costGrowth: number;
  /** Floors that must have been reached before this appears in the shop. */
  readonly unlockFloor: number;
  /** Hard level cap, where uncapped growth would break the design. */
  readonly maxLevel?: number;
}

export const UPGRADES: readonly UpgradeDefinition[] = [
  {
    id: 'blade',
    icon: '🗡️',
    baseCost: Decimal.of(1.5, 1),
    costGrowth: 1.14,
    unlockFloor: 1,
  },
  {
    id: 'swiftness',
    icon: '🌀',
    baseCost: Decimal.of(6, 1),
    costGrowth: 1.19,
    unlockFloor: 1,
  },
  {
    id: 'precision',
    icon: '🎯',
    baseCost: Decimal.of(4, 2),
    costGrowth: 1.28,
    unlockFloor: 3,
    // Crit chance is a probability; past 100% further levels would be a
    // silently worthless purchase, which is worse than an unavailable one.
    maxLevel: 140,
  },
  {
    id: 'ferocity',
    icon: '💢',
    baseCost: Decimal.of(1.2, 3),
    costGrowth: 1.33,
    unlockFloor: 6,
  },
  {
    id: 'greed',
    icon: '💰',
    baseCost: Decimal.of(2, 2),
    costGrowth: 1.17,
    unlockFloor: 2,
  },
  {
    id: 'tome',
    icon: '📖',
    baseCost: Decimal.of(2.5, 4),
    costGrowth: 1.45,
    unlockFloor: 12,
  },
];

const BY_ID = new Map<UpgradeId, UpgradeDefinition>(UPGRADES.map((u) => [u.id, u]));

/** Display name in the active locale. */
export function upgradeName(id: UpgradeId): string {
  return t(`upgrade.${id}.name`);
}

/** One line, present tense, describing what one more level does. */
export function upgradeDescription(id: UpgradeId): string {
  return t(`upgrade.${id}.desc`);
}

export function upgradeById(id: UpgradeId): UpgradeDefinition {
  const definition = BY_ID.get(id);
  if (definition === undefined) throw new Error(`unknown upgrade: ${id}`);
  return definition;
}

/** Cost of taking `level` → `level + 1`. Levels are zero-based. */
export function upgradeCost(definition: UpgradeDefinition, level: number): Decimal {
  return definition.baseCost.multiply(Decimal.of(definition.costGrowth, 0).pow(level));
}

/** Total cost of taking `level` → `level + count`, summed as a geometric series. */
export function upgradeBulkCost(
  definition: UpgradeDefinition,
  level: number,
  count: number,
): Decimal {
  if (count <= 0) return Decimal.ZERO;
  const growth = definition.costGrowth;
  const first = upgradeCost(definition, level);
  // (r^n - 1) / (r - 1), the closed form. Looping would be O(count), and count
  // reaches into the thousands once the player is deep.
  const numerator = Decimal.of(growth, 0).pow(count).subtract(Decimal.ONE);
  return first.multiply(numerator).divide(Decimal.of(growth - 1, 0));
}

/**
 * How many levels `gold` can buy, starting from `level`.
 *
 * Inverts the geometric series rather than looping, because a player sitting on
 * a large bank can afford thousands of levels of a cheap upgrade and "buy max"
 * has to answer within a frame.
 */
export function affordableLevels(
  definition: UpgradeDefinition,
  level: number,
  gold: Decimal,
): number {
  if (gold.isZero || gold.isNegative) return 0;

  const cap = definition.maxLevel;
  const headroom = cap === undefined ? Number.POSITIVE_INFINITY : Math.max(0, cap - level);
  if (headroom === 0) return 0;

  const growth = definition.costGrowth;
  const first = upgradeCost(definition, level);
  if (gold.lessThan(first)) return 0;

  // n = log_r( 1 + gold·(r-1)/first ), done in log space so the intermediate
  // never has to be representable as a double.
  const ratio = gold.multiply(Decimal.of(growth - 1, 0)).divide(first);
  const inner = ratio.add(Decimal.ONE).log10();
  const levels = Math.floor(inner / Math.log10(growth));

  return Math.max(0, Math.min(levels, headroom));
}
