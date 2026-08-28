/**
 * Derives the hero's effective numbers from what they have bought.
 *
 * Stats are recomputed from scratch rather than accumulated, so there is no
 * running total to fall out of sync with the save. It costs a few dozen
 * multiplications per recompute — nothing next to a frame — and in exchange a
 * corrupted or hand-edited save can never leave a phantom bonus behind.
 *
 * Order matters: additive terms are collected first, then multipliers are
 * applied. Doing it the other way round makes the value of an upgrade depend on
 * the order the player happened to buy things in, which is impossible to
 * explain in a tooltip.
 */

import { Decimal } from '@core/decimal';
import { COMPANIONS, type CompanionId } from './content/companions';
import { type UpgradeId } from './content/upgrades';

/** What the hero starts with, before a single purchase. */
const BASE_DAMAGE = 1;
const BASE_STRIKES_PER_SECOND = 1;
const BASE_CRIT_CHANCE = 0.05;
const BASE_CRIT_MULTIPLIER = 2;

const DAMAGE_PER_BLADE = 2;
const STRIKES_PER_SWIFTNESS = 0.08;
const CRIT_PER_PRECISION = 0.005;
const CRIT_MULTIPLIER_PER_FEROCITY = 0.15;
const GOLD_PER_GREED = 0.07;
const DAMAGE_PER_TOME = 0.12;

/**
 * Each relic is a permanent +25% to damage and gold, stacking additively.
 *
 * Additive rather than multiplicative so the tooltip can state a number the
 * player can verify by counting. The steepness lives in how many relics a deep
 * run pays out, not in compounding a per-relic bonus.
 */
const RELIC_BONUS = 0.25;

/** A watched advertisement doubles output for its duration. */
export const BLESSING_MULTIPLIER = 2;

export interface PowerSource {
  readonly upgrades: Readonly<Record<UpgradeId, number>>;
  readonly companions: Readonly<Record<CompanionId, number>>;
  readonly relics: Decimal;
  readonly blessingRemaining: number;
}

export interface HeroStats {
  readonly damagePerStrike: Decimal;
  readonly strikesPerSecond: number;
  readonly critChance: number;
  readonly critMultiplier: number;
  /** Expected damage multiplier from criticals, folded into DPS. */
  readonly critFactor: number;
  readonly heroDamagePerSecond: Decimal;
  readonly companionDamagePerSecond: Decimal;
  readonly damagePerSecond: Decimal;
  readonly goldMultiplier: Decimal;
  readonly relicMultiplier: Decimal;
  readonly blessed: boolean;
}

export function relicMultiplier(relics: Decimal): Decimal {
  return Decimal.ONE.add(relics.multiply(Decimal.of(RELIC_BONUS, 0)));
}

export function computeStats(source: PowerSource): HeroStats {
  const blessed = source.blessingRemaining > 0;
  const blessing = Decimal.of(blessed ? BLESSING_MULTIPLIER : 1, 0);
  const relicMult = relicMultiplier(source.relics);

  const globalDamage = Decimal.ONE.add(
    Decimal.of(DAMAGE_PER_TOME * source.upgrades.tome, 0),
  )
    .multiply(relicMult)
    .multiply(blessing);

  const damagePerStrike = Decimal.of(
    BASE_DAMAGE + DAMAGE_PER_BLADE * source.upgrades.blade,
    0,
  ).multiply(globalDamage);

  const strikesPerSecond = BASE_STRIKES_PER_SECOND + STRIKES_PER_SWIFTNESS * source.upgrades.swiftness;

  // Crit chance is a probability and has to be clamped; a save reporting 140%
  // should be treated as certainty, not as a 1.4× on the expectation.
  const critChance = Math.min(1, BASE_CRIT_CHANCE + CRIT_PER_PRECISION * source.upgrades.precision);
  const critMultiplier =
    BASE_CRIT_MULTIPLIER + CRIT_MULTIPLIER_PER_FEROCITY * source.upgrades.ferocity;

  // Criticals are resolved as an expectation rather than a coin flip. The
  // simulation has to produce the same answer over one second as over eight
  // offline hours, and a random roll cannot do that.
  const critFactor = 1 + critChance * (critMultiplier - 1);

  const heroDamagePerSecond = damagePerStrike.multiply(
    Decimal.of(strikesPerSecond * critFactor, 0),
  );

  let companionBase = Decimal.ZERO;
  for (const companion of COMPANIONS) {
    const level = source.companions[companion.id];
    if (level > 0) {
      companionBase = companionBase.add(companion.damagePerLevel.multiply(Decimal.of(level, 0)));
    }
  }
  const companionDamagePerSecond = companionBase.multiply(globalDamage);

  const goldMultiplier = Decimal.ONE.add(Decimal.of(GOLD_PER_GREED * source.upgrades.greed, 0))
    .multiply(relicMult)
    .multiply(blessing);

  return {
    damagePerStrike,
    strikesPerSecond,
    critChance,
    critMultiplier,
    critFactor,
    heroDamagePerSecond,
    companionDamagePerSecond,
    damagePerSecond: heroDamagePerSecond.add(companionDamagePerSecond),
    goldMultiplier,
    relicMultiplier: relicMult,
    blessed,
  };
}
