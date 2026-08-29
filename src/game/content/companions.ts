/**
 * Bodies that orbit the stone and feed it.
 *
 * Orbiters exist to give the shop a second shape. Refinements sharpen what the
 * stone already does — orbiters arrive as discrete events, each unlocked by the
 * stage rather than by dust, so there is always a named thing to reach for
 * beyond the next decimal place on a stat.
 *
 * Their contribution is flat per level and benefits from the same global
 * multipliers as the stone, which keeps one absorption formula instead of two.
 */

import { Decimal } from '@core/decimal';
import { t } from '@core/i18n';
import type { CostCurve } from './cost-curve';

export type CompanionId =
  'torchbearer' | 'houndmaster' | 'runesmith' | 'revenant' | 'archivist';

export interface CompanionDefinition extends CostCurve {
  readonly id: CompanionId;
  readonly icon: string;
  /** Mass per second contributed by each level, before global multipliers. */
  readonly damagePerLevel: Decimal;
  /** Stage the stone must have reached before this orbiter can form. */
  readonly unlockStage: number;
}

export const COMPANIONS: readonly CompanionDefinition[] = [
  {
    id: 'torchbearer',
    icon: '☁️',
    damagePerLevel: Decimal.of(3, 0),
    baseCost: Decimal.of(2.5, 2),
    costGrowth: 1.16,
    unlockStage: 8,
  },
  {
    id: 'houndmaster',
    icon: '🧊',
    damagePerLevel: Decimal.of(4.5, 1),
    baseCost: Decimal.of(6, 3),
    costGrowth: 1.18,
    unlockStage: 20,
  },
  {
    id: 'runesmith',
    icon: '⚙️',
    damagePerLevel: Decimal.of(9, 2),
    baseCost: Decimal.of(4, 5),
    costGrowth: 1.2,
    unlockStage: 40,
  },
  {
    id: 'revenant',
    icon: '💫',
    damagePerLevel: Decimal.of(2.2, 5),
    baseCost: Decimal.of(9, 8),
    costGrowth: 1.22,
    unlockStage: 70,
  },
  {
    id: 'archivist',
    icon: '💍',
    damagePerLevel: Decimal.of(1.4, 9),
    baseCost: Decimal.of(3, 13),
    costGrowth: 1.24,
    unlockStage: 110,
  },
];

const BY_ID = new Map<CompanionId, CompanionDefinition>(COMPANIONS.map((c) => [c.id, c]));

/** Display name in the active locale, including the companion's title. */
export function companionName(id: CompanionId): string {
  return t(`companion.${id}.name`);
}

export function companionById(id: CompanionId): CompanionDefinition {
  const definition = BY_ID.get(id);
  if (definition === undefined) throw new Error(`unknown companion: ${id}`);
  return definition;
}
