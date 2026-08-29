/**
 * The geometric cost curve every purchasable thing in the game shares.
 *
 * An upgrade and a companion differ in what they do and in nothing else: both
 * cost `base × growth^level`, both are bought in bulk, both need a "how many
 * can I afford" answer. Keeping one implementation means the closed-form maths
 * is written, reasoned about, and tested once — and that a companion cannot
 * quietly end up with the O(n) loop that an upgrade avoided.
 *
 * Growth is the dial that decides how long a purchase stays interesting. A low
 * one (1.14) stays buyable for hundreds of levels and carries early
 * progression; a high one (1.45) is a rare, deliberate purchase. Mixing both is
 * what stops the shop collapsing into "always buy the cheapest".
 */

import { Decimal } from '@core/decimal';

export interface CostCurve {
  readonly baseCost: Decimal;
  readonly costGrowth: number;
  /** Hard cap, where uncapped growth would break the design. */
  readonly maxLevel?: number | undefined;
}

/** Cost of taking `level` → `level + 1`. Levels are zero-based. */
export function costAt(curve: CostCurve, level: number): Decimal {
  return curve.baseCost.multiply(Decimal.of(curve.costGrowth, 0).pow(level));
}

/**
 * Total cost of taking `level` → `level + count`, as a geometric series.
 *
 * Summed in closed form rather than looped: `count` reaches into the thousands
 * once a player is deep, and this runs on every frame the shop is visible to
 * label a MAX button.
 */
export function bulkCost(curve: CostCurve, level: number, count: number): Decimal {
  if (count <= 0) return Decimal.ZERO;
  const first = costAt(curve, level);
  const numerator = Decimal.of(curve.costGrowth, 0).pow(count).subtract(Decimal.ONE);
  return first.multiply(numerator).divide(Decimal.of(curve.costGrowth - 1, 0));
}

/** Levels remaining before this curve's cap, or Infinity when it has none. */
export function headroom(curve: CostCurve, level: number): number {
  return curve.maxLevel === undefined
    ? Number.POSITIVE_INFINITY
    : Math.max(0, curve.maxLevel - level);
}

/**
 * How many levels `budget` can buy, starting from `level`.
 *
 * Inverts the series rather than looping: a player sitting on a large bank can
 * afford thousands of levels of a cheap upgrade, and the MAX button has to
 * answer within a frame.
 *
 *     n = log_r( 1 + budget·(r-1)/first )
 *
 * done in log space, so the intermediate never has to be representable as a
 * double. The result can land one level either side of the truth at the
 * boundary — callers settle that against the real bulk cost.
 */
export function affordableLevels(curve: CostCurve, level: number, budget: Decimal): number {
  if (budget.isZero || budget.isNegative) return 0;

  const room = headroom(curve, level);
  if (room === 0) return 0;

  const first = costAt(curve, level);
  if (budget.lessThan(first)) return 0;

  const ratio = budget.multiply(Decimal.of(curve.costGrowth - 1, 0)).divide(first);
  const levels = Math.floor(ratio.add(Decimal.ONE).log10() / Math.log10(curve.costGrowth));

  return Math.max(0, Math.min(levels, room));
}
