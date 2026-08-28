import { describe, expect, it } from 'vitest';
import { Decimal, d } from '../src/core/decimal';
import {
  formatCompact,
  formatDuration,
  formatMultiplier,
  formatNumber,
  formatPercent,
  suffixForTier,
} from '../src/core/format';

describe('suffixForTier', () => {
  it('uses the named short-scale suffixes first', () => {
    expect(suffixForTier(0)).toBe('');
    expect(suffixForTier(1)).toBe('K');
    expect(suffixForTier(4)).toBe('T');
    expect(suffixForTier(11)).toBe('Dc');
  });

  it('continues into a bijective alphabetic sequence with no gaps', () => {
    expect(suffixForTier(12)).toBe('a');
    expect(suffixForTier(37)).toBe('z');
    expect(suffixForTier(38)).toBe('aa');
    expect(suffixForTier(39)).toBe('ab');
  });

  it('never repeats a label, which is what makes tiers comparable', () => {
    const seen = new Set<string>();
    for (let tier = 0; tier < 2000; tier += 1) {
      const suffix = suffixForTier(tier);
      expect(seen.has(suffix), `duplicate suffix ${suffix} at tier ${tier}`).toBe(false);
      seen.add(suffix);
    }
  });
});

describe('formatNumber', () => {
  it('shows exact digits below a thousand, where they still mean something', () => {
    expect(formatNumber(d(0))).toBe('0');
    expect(formatNumber(d(7.5))).toBe('7.5');
    expect(formatNumber(d(0.25))).toBe('0.250');
    expect(formatNumber(d(999))).toBe('999');
  });

  it('switches to suffixes at a thousand', () => {
    expect(formatNumber(d(1000))).toBe('1.00K');
    expect(formatNumber(d(1500))).toBe('1.50K');
    expect(formatNumber(d(1_234_567))).toBe('1.23M');
  });

  it('truncates rather than rounds, so a threshold is never shown as met early', () => {
    expect(formatNumber(d(1999))).toBe('1.99K');
    expect(formatNumber(d(9999))).toBe('9.99K');
  });

  it('keeps a fixed width past the range of a double', () => {
    for (let exponent = 3; exponent < 400; exponent += 1) {
      const text = formatNumber(Decimal.of(1.5, exponent));
      expect(text).not.toContain('e+');
      expect(text).not.toContain('Infinity');
      expect(text).not.toContain('NaN');
      expect(text.startsWith('1.5') || text.startsWith('15') || text.startsWith('150')).toBe(true);
    }
  });

  it('formats magnitudes an idle save reaches after weeks', () => {
    expect(formatNumber(Decimal.of(1, 3000))).toMatch(/^1\.00[a-z]+$/);
  });

  it('offers scientific notation for players who prefer it', () => {
    expect(formatNumber(Decimal.of(1.5, 42), { notation: 'scientific' })).toBe('1.50e42');
    expect(formatNumber(Decimal.of(9.999, 1200), { notation: 'scientific' })).toBe('9.99e1200');
  });

  it('carries the sign through', () => {
    expect(formatNumber(d(-2500))).toBe('-2.50K');
  });

  it('drops a decimal in compact form', () => {
    expect(formatCompact(d(1_234_567))).toBe('1.2M');
  });
});

describe('formatDuration', () => {
  it('never leads with a zero unit', () => {
    expect(formatDuration(12)).toBe('12s');
    expect(formatDuration(200)).toBe('3m 20s');
    expect(formatDuration(3600)).toBe('1h 00m');
    expect(formatDuration(90_000)).toBe('1d 01h');
  });

  it('degrades on nonsense rather than rendering NaN', () => {
    expect(formatDuration(-5)).toBe('0s');
    expect(formatDuration(Number.NaN)).toBe('0s');
  });
});

describe('small formatters', () => {
  it('renders multipliers and percentages', () => {
    expect(formatMultiplier(d(2.5))).toBe('×2.50');
    expect(formatMultiplier(d(1.05))).toBe('×1.05');
    expect(formatMultiplier(Decimal.of(3, 9))).toBe('×3.00B');
    expect(formatPercent(0.5)).toBe('50.0%');
    expect(formatPercent(1.4)).toBe('100.0%');
    expect(formatPercent(Number.NaN)).toBe('0.0%');
  });
});
