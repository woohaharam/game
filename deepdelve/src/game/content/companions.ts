/**
 * Party members that fight alongside the hero.
 *
 * Companions exist to give the shop a second shape. Upgrades sharpen what the
 * hero already does — companions arrive as discrete events, each one unlocked
 * by depth rather than by gold, so there is always a named thing to reach for
 * beyond the next decimal place on a stat.
 *
 * Their damage is flat per level and benefits from the same global multipliers
 * as the hero, which keeps one damage formula in the game instead of two.
 */

import { Decimal } from '@core/decimal';
import { t } from '@core/i18n';

export type CompanionId = 'torchbearer' | 'houndmaster' | 'runesmith' | 'revenant' | 'archivist';

export interface CompanionDefinition {
  readonly id: CompanionId;
  readonly icon: string;
  /** Damage per second contributed by each level, before global multipliers. */
  readonly damagePerLevel: Decimal;
  readonly baseCost: Decimal;
  readonly costGrowth: number;
  /** Highest floor the player must have reached before recruitment. */
  readonly unlockFloor: number;
}

export const COMPANIONS: readonly CompanionDefinition[] = [
  {
    id: 'torchbearer',
    icon: '🔥',
    damagePerLevel: Decimal.of(3, 0),
    baseCost: Decimal.of(2.5, 2),
    costGrowth: 1.16,
    unlockFloor: 8,
  },
  {
    id: 'houndmaster',
    icon: '🐺',
    damagePerLevel: Decimal.of(4.5, 1),
    baseCost: Decimal.of(6, 3),
    costGrowth: 1.18,
    unlockFloor: 20,
  },
  {
    id: 'runesmith',
    icon: '🪬',
    damagePerLevel: Decimal.of(9, 2),
    baseCost: Decimal.of(4, 5),
    costGrowth: 1.2,
    unlockFloor: 40,
  },
  {
    id: 'revenant',
    icon: '💀',
    damagePerLevel: Decimal.of(2.2, 5),
    baseCost: Decimal.of(9, 8),
    costGrowth: 1.22,
    unlockFloor: 70,
  },
  {
    id: 'archivist',
    icon: '📜',
    damagePerLevel: Decimal.of(1.4, 9),
    baseCost: Decimal.of(3, 13),
    costGrowth: 1.24,
    unlockFloor: 110,
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

export function companionCost(definition: CompanionDefinition, level: number): Decimal {
  return definition.baseCost.multiply(Decimal.of(definition.costGrowth, 0).pow(level));
}
