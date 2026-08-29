/**
 * Derives the stone's effective numbers from what has been bought.
 *
 * Stats are recomputed from scratch rather than accumulated, so there is no
 * running total to fall out of sync with the save. It costs a few dozen
 * multiplications per recompute — nothing next to a frame — and in exchange a
 * corrupted or hand-edited save can never leave a phantom bonus behind.
 *
 * Order matters: additive terms are collected first, then multipliers are
 * applied. Doing it the other way round makes the value of a refinement depend
 * on the order the player happened to buy things in, which is impossible to
 * explain in a tooltip.
 */

import { Decimal } from '@core/decimal';
import { COMPANIONS, type CompanionId } from './content/companions';
import { type UpgradeId } from './content/upgrades';

/** What a bare stone manages before a single refinement. */
const BASE_PULL = 3;
const BASE_PULLS_PER_SECOND = 1;
const BASE_RESONANCE_CHANCE = 0.05;
const BASE_RESONANCE_MULTIPLIER = 2;

const PULL_PER_GRAVITY = 2;
const PULLS_PER_RATE = 0.08;
const RESONANCE_PER_LEVEL = 0.005;
const RESONANCE_PER_AMPLITUDE = 0.15;
const DUST_PER_SIEVE = 0.07;
const ABSORPTION_PER_DENSITY = 0.12;

/**
 * Each crystal is a permanent +25% to absorption and dust, stacking additively.
 *
 * Additive rather than multiplicative so the tooltip can state a number the
 * player can verify by counting. The steepness lives in how many crystals a
 * heavy stone pays out, not in compounding a per-crystal bonus.
 */
const CRYSTAL_BONUS = 0.25;

/** A watched advertisement doubles output for its duration. */
export const BLESSING_MULTIPLIER = 2;

export interface PowerSource {
  readonly upgrades: Readonly<Record<UpgradeId, number>>;
  readonly companions: Readonly<Record<CompanionId, number>>;
  readonly crystals: Decimal;
  readonly blessingRemaining: number;
}

export interface StoneStats {
  readonly pullStrength: Decimal;
  readonly pullsPerSecond: number;
  readonly resonanceChance: number;
  readonly resonanceMultiplier: number;
  /** Expected multiplier from resonance, folded into the absorption rate. */
  readonly resonanceFactor: number;
  readonly stoneAbsorption: Decimal;
  readonly orbiterAbsorption: Decimal;
  readonly absorptionPerSecond: Decimal;
  readonly dustMultiplier: Decimal;
  readonly crystalMultiplier: Decimal;
  readonly blessed: boolean;
}

export function crystalMultiplier(crystals: Decimal): Decimal {
  return Decimal.ONE.add(crystals.multiply(Decimal.of(CRYSTAL_BONUS, 0)));
}

export function computeStats(source: PowerSource): StoneStats {
  const blessed = source.blessingRemaining > 0;
  const blessing = Decimal.of(blessed ? BLESSING_MULTIPLIER : 1, 0);
  const crystalMult = crystalMultiplier(source.crystals);

  const globalAbsorption = Decimal.ONE.add(
    Decimal.of(ABSORPTION_PER_DENSITY * source.upgrades.tome, 0),
  )
    .multiply(crystalMult)
    .multiply(blessing);

  const pullStrength = Decimal.of(
    BASE_PULL + PULL_PER_GRAVITY * source.upgrades.blade,
    0,
  ).multiply(globalAbsorption);

  const pullsPerSecond = BASE_PULLS_PER_SECOND + PULLS_PER_RATE * source.upgrades.swiftness;

  // Resonance chance is a probability and has to be clamped; a save reporting
  // 140% should be treated as certainty, not as a 1.4× on the expectation.
  const resonanceChance = Math.min(
    1,
    BASE_RESONANCE_CHANCE + RESONANCE_PER_LEVEL * source.upgrades.precision,
  );
  const resonanceMultiplier =
    BASE_RESONANCE_MULTIPLIER + RESONANCE_PER_AMPLITUDE * source.upgrades.ferocity;

  // Resonance is resolved as an expectation rather than a coin flip. The
  // simulation has to produce the same answer over one second as over eight
  // offline hours, and a random roll cannot do that.
  const resonanceFactor = 1 + resonanceChance * (resonanceMultiplier - 1);

  const stoneAbsorption = pullStrength.multiply(
    Decimal.of(pullsPerSecond * resonanceFactor, 0),
  );

  let orbiterBase = Decimal.ZERO;
  for (const companion of COMPANIONS) {
    const level = source.companions[companion.id];
    if (level > 0) {
      orbiterBase = orbiterBase.add(companion.damagePerLevel.multiply(Decimal.of(level, 0)));
    }
  }
  const orbiterAbsorption = orbiterBase.multiply(globalAbsorption);

  const dustMultiplier = Decimal.ONE.add(Decimal.of(DUST_PER_SIEVE * source.upgrades.greed, 0))
    .multiply(crystalMult)
    .multiply(blessing);

  return {
    pullStrength,
    pullsPerSecond,
    resonanceChance,
    resonanceMultiplier,
    resonanceFactor,
    stoneAbsorption,
    orbiterAbsorption,
    absorptionPerSecond: stoneAbsorption.add(orbiterAbsorption),
    dustMultiplier,
    crystalMultiplier: crystalMult,
    blessed,
  };
}
