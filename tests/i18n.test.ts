import { afterEach, describe, expect, it } from 'vitest';
import { Decimal, d } from '../src/core/decimal';
import { formatDuration, formatNumber } from '../src/core/format';
import {
  defaultNotation,
  detectLocale,
  duration,
  getLocale,
  setLocale,
  t,
} from '../src/core/i18n';
import { en } from '../src/core/strings/en';
import { ko } from '../src/core/strings/ko';

afterEach(() => setLocale('en'));

describe('Korean number grouping', () => {
  const korean = (value: Decimal | number): string =>
    formatNumber(value, { notation: 'korean' });

  it('groups in fours, not threes', () => {
    // The whole point: 12345 is 1.2345만 to a Korean reader, not 12.34K.
    expect(korean(d(12_345))).toBe('1.234만');
    expect(korean(d(100_000))).toBe('10.00만');
    expect(korean(Decimal.of(1, 8))).toBe('1.000억');
    expect(korean(Decimal.of(1, 12))).toBe('1.000조');
    expect(korean(Decimal.of(1, 16))).toBe('1.000경');
  });

  it('leaves four-digit numbers alone, since Korean reads them directly', () => {
    expect(korean(d(1000))).toBe('1000');
    expect(korean(d(9999))).toBe('9999');
  });

  it('shows the same number of significant digits across a whole unit', () => {
    // 1.234만, 12.34만, 123.4만, 1234만 — the point moves, the four digits do
    // not. Within one Korean unit the magnitude spans three orders, far more
    // than in the three-digit English path, so a fixed decimal count would give
    // either 1.23만 and 1234.00만 or a column nobody can scan.
    const digitCounts = new Set(
      [1, 10, 100, 1000].map((factor) => {
        const text = korean(d(1.234 * factor * 10_000));
        return (text.match(/\d/g) ?? []).length;
      }),
    );
    expect(digitCounts).toEqual(new Set([4]));
  });

  it('keeps naming units as deep as Korean actually names them', () => {
    expect(korean(Decimal.of(1, 48))).toContain('극');
    expect(korean(Decimal.of(1, 68))).toContain('무량대수');
  });

  it('falls back to an exponent past the last named unit', () => {
    // Inventing a name beyond 무량대수 would be less readable than the exponent.
    const beyond = korean(Decimal.of(1.5, 200));
    expect(beyond).toContain('10^200');
  });

  it('never emits a raw JS exponent or a NaN at any magnitude', () => {
    for (let exponent = 0; exponent < 500; exponent += 1) {
      const text = korean(Decimal.of(1.5, exponent));
      expect(text).not.toContain('e+');
      expect(text).not.toContain('NaN');
      expect(text).not.toContain('undefined');
    }
  });
});

describe('string tables', () => {
  it('translates every key the interface can ask for', () => {
    const englishKeys = Object.keys(en).sort();
    const koreanKeys = Object.keys(ko).sort();
    expect(koreanKeys).toEqual(englishKeys);
  });

  it('leaves nothing blank', () => {
    for (const [key, value] of Object.entries(ko)) {
      expect(value.trim(), key).not.toBe('');
    }
  });

  it('actually translates the content, rather than passing English through', () => {
    // Structural strings legitimately match across locales; names must not.
    const hangul = /[가-힯]/;
    for (const key of Object.keys(en)) {
      if (!/^(zone|monster|guardian|upgrade|companion|stats|offline|descend|tab)\./.test(key)) {
        continue;
      }
      if (key === 'zone.deeper') continue;
      expect(ko[key as keyof typeof ko], key).toMatch(hangul);
    }
  });

  it('keeps every placeholder the English string declares', () => {
    const placeholders = (text: string): string[] =>
      (text.match(/\{\w+\}/g) ?? []).slice().sort();

    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      // A dropped placeholder shows the player a sentence with a hole in it.
      expect(placeholders(ko[key]), key).toEqual(placeholders(en[key]));
    }
  });
});

describe('lookup', () => {
  it('substitutes placeholders', () => {
    setLocale('ko');
    expect(t('stone.stage', { n: 42 })).toBe('42단계');
    expect(t('descend.locked', { n: 10 })).toContain('10단계');
  });

  it('leaves an unknown placeholder visible rather than printing undefined', () => {
    setLocale('en');
    expect(t('stone.stage')).toBe('Stage {n}');
  });

  it('localises durations', () => {
    setLocale('ko');
    expect(duration(200)).toBe('3분 20초');
    expect(duration(3600)).toBe('1시간 00분');
    expect(duration(90_000)).toBe('1일 01시간');

    setLocale('en');
    expect(duration(200)).toBe('3m 20s');
    expect(formatDuration(200)).toBe('3m 20s');
  });
});

describe('locale detection', () => {
  it('prefers an explicit stored choice over everything', () => {
    expect(detectLocale({ stored: 'en', search: '?lang=ko', languages: ['ko-KR'] })).toBe('en');
  });

  it('honours a query parameter ahead of the browser', () => {
    // A player who followed a Korean listing should not land on English because
    // their operating system happens to be.
    expect(detectLocale({ search: '?lang=ko', languages: ['en-US'] })).toBe('ko');
  });

  it('matches on the primary subtag', () => {
    expect(detectLocale({ languages: ['ko-KR'] })).toBe('ko');
    expect(detectLocale({ languages: ['ko-Kore-KR'] })).toBe('ko');
  });

  it('ignores languages it has no table for', () => {
    expect(detectLocale({ languages: ['fr-FR', 'de'] })).toBe('en');
    expect(detectLocale({})).toBe('en');
  });

  it('rejects a stored value that is not a locale', () => {
    expect(detectLocale({ stored: 'klingon', languages: ['ko'] })).toBe('ko');
  });

  it('starts Korean players in the notation they read', () => {
    expect(defaultNotation('ko')).toBe('korean');
    expect(defaultNotation('en')).toBe('suffix');
  });

  it('tracks the active locale', () => {
    setLocale('ko');
    expect(getLocale()).toBe('ko');
  });
});
