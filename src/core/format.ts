/**
 * Display formatting for progression numbers.
 *
 * Idle games ask players to compare quantities they can never picture: is
 * 4.21aa of damage enough for a floor that costs 892Z of gold? The formatter's
 * whole job is to make that comparison possible at a glance, which means the
 * digit count must stay fixed no matter the magnitude — a number that grows
 * wider as it grows larger makes a column of them unreadable.
 *
 * Two notations, because portals serve a wide audience: suffixes read naturally
 * for the first few hours, and scientific stops being a wall of made-up
 * syllables once the player is deep. Both are offered; neither is forced.
 */

import { Decimal } from './decimal';

export type Notation = 'suffix' | 'scientific' | 'korean';

/**
 * Short scale, matching what English-language idle games have converged on.
 * Beyond this the alphabetic sequence takes over, which is unbounded.
 */
const SHORT_SUFFIXES = [
  '',
  'K',
  'M',
  'B',
  'T',
  'Qa',
  'Qi',
  'Sx',
  'Sp',
  'Oc',
  'No',
  'Dc',
] as const;

/**
 * Korean groups large numbers in fours, not threes.
 *
 * 만 is 10^4, 억 is 10^8, 조 is 10^12 — so the English K/M/B path, which splits
 * every three digits, produces numbers a Korean reader has to stop and convert.
 * Showing 1,234만 where the English build shows 12.34M is not a cosmetic
 * preference; it is the difference between a number that is read and one that
 * is decoded.
 *
 * The tail of this list (항하사 onwards) comes from the Buddhist series and is
 * genuinely obscure, but an idle game reaches 10^52 within a day or two and the
 * alternative there is bare scientific notation, which is worse.
 */
const KOREAN_UNITS = [
  '',
  '만',
  '억',
  '조',
  '경',
  '해',
  '자',
  '양',
  '구',
  '간',
  '정',
  '재',
  '극',
  '항하사',
  '아승기',
  '나유타',
  '불가사의',
  '무량대수',
] as const;

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz';

/**
 * Suffix for the `tier`-th group of three digits, counting from zero.
 *
 * After the named suffixes run out this becomes a bijective base-26 counter:
 * `aa`, `ab`, ... `az`, `ba`, ... `zz`, `aaa`. Bijective rather than plain
 * base-26 because there is no "zero" digit — the sequence has no gaps, and
 * every tier gets a distinct label forever.
 */
export function suffixForTier(tier: number): string {
  if (tier < SHORT_SUFFIXES.length) return SHORT_SUFFIXES[tier] ?? '';

  let n = tier - SHORT_SUFFIXES.length;
  let out = '';
  do {
    out = (ALPHABET[n % 26] ?? 'a') + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/** Rounds toward zero at `places` decimals, so a bar never reads as full early. */
function truncate(value: number, places: number): string {
  const scale = 10 ** places;
  const truncated = Math.trunc(Math.abs(value) * scale) / scale;
  const sign = value < 0 ? '-' : '';
  return sign + truncated.toFixed(places);
}

export interface FormatOptions {
  readonly notation?: Notation;
  /** Significant decimals for values above 1000. Default 2. */
  readonly places?: number;
}

/**
 * Formats a value for display. Never returns exponential JS notation like
 * `1e+21` — every path produces something a player can read aloud.
 */
export function formatNumber(value: Decimal | number, options: FormatOptions = {}): string {
  const decimal = Decimal.from(value);
  const notation = options.notation ?? 'suffix';
  const places = options.places ?? 2;

  if (decimal.isZero) return '0';
  if (decimal.isNegative) return '-' + formatNumber(decimal.negate(), options);

  // Below 1000 the exact digits still mean something to the player, so show
  // them rather than rounding 999 to "1.00K".
  if (decimal.exponent < 3) {
    const n = decimal.toNumber();
    // Counts are numbers too. "2.0 guardians felled" reads like a rounding
    // error, so anything already whole is printed whole.
    if (Number.isInteger(n)) return String(n);
    if (n < 10) return truncate(n, n < 1 ? 3 : 1);
    return String(Math.floor(n));
  }

  if (notation === 'scientific') {
    return `${truncate(decimal.mantissa, places)}e${decimal.exponent}`;
  }

  if (notation === 'korean') return formatKorean(decimal, places);

  const tier = Math.floor(decimal.exponent / 3);
  const withinTier = decimal.mantissa * 10 ** (decimal.exponent - tier * 3);
  return `${truncate(withinTier, places)}${suffixForTier(tier)}`;
}

/**
 * Four-digit grouping with Korean unit names.
 *
 * The digit count is held at four significant figures rather than at a fixed
 * number of decimals, so 1.234만, 12.34만, 123.4만 and 1234만 all occupy the
 * same width. A column of numbers that changes width cannot be compared at a
 * glance, and within a four-digit group the leading magnitude varies by three
 * orders — far more than it does in the three-digit English path.
 */
function formatKorean(decimal: Decimal, places: number): string {
  const tier = Math.floor(decimal.exponent / 4);
  if (tier >= KOREAN_UNITS.length) {
    // Past 무량대수 there is no name left to use, and inventing one would be
    // less readable than the exponent itself.
    return `${truncate(decimal.mantissa, places)}×10^${decimal.exponent}`;
  }

  const withinTier = decimal.mantissa * 10 ** (decimal.exponent - tier * 4);
  const digitsBeforePoint = Math.max(1, Math.floor(Math.log10(withinTier)) + 1);
  const decimals = Math.max(0, 4 - digitsBeforePoint);
  return `${truncate(withinTier, decimals)}${KOREAN_UNITS[tier] ?? ''}`;
}

/** `formatNumber` with the decimals stripped, for tight spaces like buttons. */
export function formatCompact(value: Decimal | number, notation: Notation = 'suffix'): string {
  return formatNumber(value, { notation, places: 1 });
}

export interface DurationUnits {
  readonly day: string;
  readonly hour: string;
  readonly minute: string;
  readonly second: string;
}

const ENGLISH_UNITS: DurationUnits = { day: 'd', hour: 'h', minute: 'm', second: 's' };

/**
 * Whole seconds into `1h 04m`, `3m 20s`, `12s`, never leading with a zero unit.
 *
 * Units are passed in rather than looked up, so this module stays free of any
 * dependency on the locale layer; callers that want translated units supply
 * them.
 */
export function formatDuration(seconds: number, units: DurationUnits = ENGLISH_UNITS): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return `0${units.second}`;

  const total = Math.floor(seconds);
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  const pad = (n: number): string => String(n).padStart(2, '0');
  if (days > 0) return `${days}${units.day} ${pad(hours)}${units.hour}`;
  if (hours > 0) return `${hours}${units.hour} ${pad(minutes)}${units.minute}`;
  if (minutes > 0) return `${minutes}${units.minute} ${pad(secs)}${units.second}`;
  return `${secs}${units.second}`;
}

/**
 * Multiplier display: `×2.50`, `×1.05`.
 *
 * Multipliers keep two decimals all the way down, unlike plain numbers. The
 * difference between a ×1.05 and a ×1.5 upgrade is the entire decision, and a
 * variable-width `×1.5` next to `×1.05` hides it.
 */
export function formatMultiplier(value: Decimal | number): string {
  const decimal = Decimal.from(value);
  if (!decimal.isNegative && !decimal.isZero && decimal.exponent < 3) {
    return `×${truncate(decimal.toNumber(), 2)}`;
  }
  return `×${formatNumber(decimal, { places: 2 })}`;
}

/**
 * Mass, in grams, rendered in the largest unit that leaves a readable number.
 *
 * The stone's mass is the number the player watches for hours, and "4.2 tonnes"
 * lands where "4,200,000 g" does not — the unit does the work of conveying
 * scale that a bare digit string cannot. Past the point where human units run
 * out the table switches to astronomical ones, which is the moment the game is
 * really about: a stone measured in Earths is a different feeling from one
 * measured in gigatonnes, and it costs one row in a table to say so.
 *
 * `units` is passed in rather than looked up so this module stays free of any
 * dependency on the locale layer.
 */
export interface MassUnit {
  /** Grams in one of this unit, as a power of ten. */
  readonly exponent: number;
  readonly label: string;
}

export function formatMass(
  grams: Decimal | number,
  units: readonly MassUnit[],
  options: FormatOptions = {},
): string {
  const value = Decimal.from(grams);
  if (value.isZero || value.isNegative) return `0${units[0]?.label ?? ''}`;

  // The largest unit the value is at least one of; the first otherwise.
  let chosen = units[0];
  for (const unit of units) {
    if (value.exponent >= unit.exponent) chosen = unit;
  }
  if (chosen === undefined) return formatNumber(value, options);

  const scaled = Decimal.of(value.mantissa, value.exponent - chosen.exponent);
  return `${formatNumber(scaled, options)}${chosen.label}`;
}

/** `0.0%`..`100.0%`, clamped, for progress readouts. */
export function formatPercent(fraction: number, places = 1): string {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
  return `${(clamped * 100).toFixed(places)}%`;
}
