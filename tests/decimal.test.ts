import { describe, expect, it } from 'vitest';
import { Decimal, d } from '@core/decimal';

/**
 * The failure mode this type exists to prevent is silent: a save that looks
 * fine and is quietly wrong. So the tests care most about the boundaries where
 * plain `number` gives up — past 2^53, past 1e308 — and about the invariants
 * that keep long play sessions from drifting.
 */
describe('Decimal', () => {
  describe('normalisation', () => {
    it('keeps the mantissa in [1, 10)', () => {
      const values = [1, 9.99, 10, 999, 1e15, 1e300, 0.001, 1234.5678];
      for (const value of values) {
        const decimal = d(value);
        expect(Math.abs(decimal.mantissa), `${value}`).toBeGreaterThanOrEqual(1);
        expect(Math.abs(decimal.mantissa), `${value}`).toBeLessThan(10);
      }
    });

    it('treats zero as a single canonical value', () => {
      expect(d(0).isZero).toBe(true);
      expect(d(0).mantissa).toBe(0);
      expect(d(0).exponent).toBe(0);
      expect(Decimal.of(0, 500).isZero).toBe(true);
    });

    it('does not drift over a long chain of operations', () => {
      // The realistic shape: a multiplier applied thousands of times, which is
      // where a mantissa creeping toward 10 would compound into a lost digit.
      let value = d(1);
      for (let i = 0; i < 20_000; i++) value = value.multiply(1.001);
      // 1.001^20000 = 10^(20000 * log10(1.001))
      const expected = 20_000 * Math.log10(1.001);
      expect(value.log10()).toBeCloseTo(expected, 6);
      expect(Math.abs(value.mantissa)).toBeGreaterThanOrEqual(1);
      expect(Math.abs(value.mantissa)).toBeLessThan(10);
    });
  });

  describe('range beyond plain numbers', () => {
    it('stays exact where Number loses integer precision', () => {
      // 2^53 + 1 is the first integer a double cannot represent.
      const big = d(2 ** 53).add(1000);
      expect(big.log10()).toBeGreaterThan(15);
      // The point is not that the +1000 survives, but that magnitude is kept
      // and the value is not silently clamped.
      expect(big.greaterThan(d(2 ** 53))).toBe(true);
    });

    it('survives past the double overflow point', () => {
      const huge = d(1e300).multiply(d(1e300));
      expect(Number.isFinite(huge.exponent)).toBe(true);
      expect(huge.exponent).toBe(600);
      expect(huge.toNumber()).toBe(Infinity); // only when collapsed on purpose
    });

    it('handles exponents far past anything a double could hold', () => {
      const vast = d(2).pow(100_000);
      expect(vast.exponent).toBeGreaterThan(30_000);
      expect(vast.log10()).toBeCloseTo(100_000 * Math.log10(2), 3);
    });
  });

  describe('arithmetic', () => {
    it('adds and subtracts like ordinary numbers in the ordinary range', () => {
      expect(d(2).add(3).toNumber()).toBeCloseTo(5, 10);
      expect(d(10).subtract(4).toNumber()).toBeCloseTo(6, 10);
      expect(d(1.5).multiply(4).toNumber()).toBeCloseTo(6, 10);
      expect(d(10).divide(4).toNumber()).toBeCloseTo(2.5, 10);
    });

    it('ignores an addend too small to affect the result', () => {
      // Trickle income against a large bank: the answer is the bank, and
      // pretending otherwise would just lose the bank's low digits to rounding.
      const bank = d(1e40);
      expect(bank.add(d(1)).compare(bank)).toBe(0);
    });

    it('still accumulates additions that are individually small but in range', () => {
      let total = Decimal.ZERO;
      for (let i = 0; i < 1000; i++) total = total.add(0.001);
      expect(total.toNumber()).toBeCloseTo(1, 6);
    });

    it('returns zero for division by zero rather than a poison value', () => {
      expect(d(5).divide(0).isZero).toBe(true);
      expect(d(0).divide(5).isZero).toBe(true);
    });

    it('raises to fractional and negative powers', () => {
      expect(d(9).pow(0.5).toNumber()).toBeCloseTo(3, 8);
      expect(d(2).pow(-1).toNumber()).toBeCloseTo(0.5, 8);
      expect(d(7).pow(0).compare(Decimal.ONE)).toBe(0);
    });

    it('handles negatives consistently', () => {
      expect(d(-5).add(3).toNumber()).toBeCloseTo(-2, 10);
      expect(d(-2).multiply(-3).toNumber()).toBeCloseTo(6, 10);
      expect(d(-5).isNegative).toBe(true);
      expect(d(-5).negate().toNumber()).toBeCloseTo(5, 10);
    });
  });

  describe('comparison', () => {
    it('orders across magnitudes', () => {
      expect(d(1e50).greaterThan(d(1e49))).toBe(true);
      expect(d(1).lessThan(d(1e100))).toBe(true);
      expect(d(5).compare(d(5))).toBe(0);
      expect(d(-1e50).lessThan(d(1))).toBe(true);
    });

    it('orders two negatives the right way round', () => {
      // The sign flip is the classic place an exponent comparison goes wrong.
      expect(d(-1e50).lessThan(d(-1e10))).toBe(true);
      expect(d(-1).greaterThan(d(-100))).toBe(true);
    });

    it('max and min pick the right side', () => {
      expect(d(3).max(d(7)).toNumber()).toBe(7);
      expect(d(3).min(d(7)).toNumber()).toBe(3);
      expect(d(-3).max(d(-7)).toNumber()).toBe(-3);
    });
  });

  describe('serialisation', () => {
    it('round-trips through the save format', () => {
      const values = [d(0), d(1), d(1234.5), d(1e200), d(2).pow(50_000), d(-42)];
      for (const value of values) {
        const restored = Decimal.parse(value.serialise());
        expect(restored.mantissa).toBeCloseTo(value.mantissa, 12);
        expect(restored.exponent).toBe(value.exponent);
      }
    });

    it('degrades to zero on a corrupt payload rather than NaN', () => {
      // A NaN loose in a save propagates into every later number and is
      // unrecoverable; zero is at least a state the game can run from.
      for (const junk of ['', 'garbage', 'NaN,5', '1,', ',,,']) {
        expect(Decimal.parse(junk).isZero, junk).toBe(true);
      }
    });
  });

  it('is immutable', () => {
    const original = d(100);
    original.add(50).multiply(2);
    expect(original.toNumber()).toBe(100);
  });
});

describe('comparison against zero', () => {
  it('orders values below one correctly against zero', () => {
    // Zero is stored with exponent 0, which is meaningless, so any comparison
    // that reaches the exponent branch gets a value like 5.25e-2 backwards.
    for (const exponent of [-1, -2, -8, -300]) {
      const small = Decimal.of(5.25, exponent);
      expect(small.greaterThan(Decimal.ZERO), `5.25e${exponent}`).toBe(true);
      expect(small.lessThan(Decimal.ZERO), `5.25e${exponent}`).toBe(false);
      expect(small.max(Decimal.ZERO).serialise()).toBe(small.serialise());
      expect(small.min(Decimal.ZERO).isZero).toBe(true);
    }
  });

  it('orders negative values below one correctly against zero', () => {
    for (const exponent of [-1, -4, -120]) {
      const small = Decimal.of(-3, exponent);
      expect(small.lessThan(Decimal.ZERO), `-3e${exponent}`).toBe(true);
      expect(small.greaterThan(Decimal.ZERO), `-3e${exponent}`).toBe(false);
      expect(small.max(Decimal.ZERO).isZero).toBe(true);
    }
  });

  it('is a total order over a spread of magnitudes and signs', () => {
    const values = [
      Decimal.of(-4, 200),
      Decimal.of(-1, 0),
      Decimal.of(-7, -50),
      Decimal.ZERO,
      Decimal.of(2, -300),
      Decimal.of(9.9, -1),
      Decimal.ONE,
      Decimal.of(1.0001, 0),
      Decimal.of(3, 40),
    ];

    // Sorting with the comparator must reproduce the order they are written in,
    // which is the only property every caller — max, min, affordability, the
    // shop's price correction — actually depends on.
    const shuffled = [...values].reverse();
    shuffled.sort((a, b) => a.compare(b));
    expect(shuffled.map((v) => v.serialise())).toEqual(values.map((v) => v.serialise()));
  });

  it('agrees with itself in both directions', () => {
    // Normalised because `Math.sign(0)` is `+0` while `-Math.sign(0)` is `-0`,
    // and those are the same ordering answer even though `Object.is` disagrees.
    const order = (value: number): -1 | 0 | 1 => (value < 0 ? -1 : value > 0 ? 1 : 0);

    const values = [Decimal.ZERO, Decimal.of(5, -3), Decimal.of(-5, -3), Decimal.of(1, 100)];
    for (const a of values) {
      for (const b of values) {
        expect(order(a.compare(b))).toBe(-order(b.compare(a)) || 0);
      }
    }
  });
});
