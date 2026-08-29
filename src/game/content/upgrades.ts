/**
 * Purchasable refinements.
 *
 * Every upgrade is data, not code: an id, a cost curve, and a pure function
 * from level to its contribution. Nothing here knows about the hero, the UI, or
 * the save format, so rebalancing is a number change and adding an upgrade is
 * one array entry.
 */

import { Decimal } from '@core/decimal';
import { t } from '@core/i18n';
import type { CostCurve } from './cost-curve';

export type UpgradeId = 'blade' | 'swiftness' | 'precision' | 'ferocity' | 'greed' | 'tome';

export interface UpgradeDefinition extends CostCurve {
  readonly id: UpgradeId;
  readonly icon: string;
  /** Stage that must have been reached before this appears. */
  readonly unlockStage: number;
}

export const UPGRADES: readonly UpgradeDefinition[] = [
  {
    id: 'blade',
    icon: '🕳️',
    baseCost: Decimal.of(1.5, 1),
    costGrowth: 1.14,
    unlockStage: 1,
  },
  {
    id: 'swiftness',
    icon: '🧲',
    baseCost: Decimal.of(6, 1),
    costGrowth: 1.19,
    unlockStage: 1,
  },
  {
    id: 'precision',
    icon: '📡',
    baseCost: Decimal.of(4, 2),
    costGrowth: 1.28,
    unlockStage: 3,
    // Crit chance is a probability; past 100% further levels would be a
    // silently worthless purchase, which is worse than an unavailable one.
    maxLevel: 140,
  },
  {
    id: 'ferocity',
    icon: '📶',
    baseCost: Decimal.of(1.2, 3),
    costGrowth: 1.33,
    unlockStage: 6,
  },
  {
    id: 'greed',
    icon: '⚗️',
    baseCost: Decimal.of(2, 2),
    costGrowth: 1.17,
    unlockStage: 2,
  },
  {
    id: 'tome',
    icon: '⚫',
    baseCost: Decimal.of(2.5, 4),
    costGrowth: 1.45,
    unlockStage: 12,
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
