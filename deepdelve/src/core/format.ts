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

export type Notation = 'suffix' | 'scientific';

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

  const tier = Math.floor(decimal.exponent / 3);
  const withinTier = decimal.mantissa * 10 ** (decimal.exponent - tier * 3);
  return `${truncate(withinTier, places)}${suffixForTier(tier)}`;
}

/** `formatNumber` with the decimals stripped, for tight spaces like buttons. */
export function formatCompact(value: Decimal | number, notation: Notation = 'suffix'): string {
  return formatNumber(value, { notation, places: 1 });
}

/** Whole seconds into `1h 04m`, `3m 20s`, `12s`. Never shows a unit that is zero at the head. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s';

  const total = Math.floor(seconds);
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  const pad = (n: number): string => String(n).padStart(2, '0');
  if (days > 0) return `${days}d ${pad(hours)}h`;
  if (hours > 0) return `${hours}h ${pad(minutes)}m`;
  if (minutes > 0) return `${minutes}m ${pad(secs)}s`;
  return `${secs}s`;
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

/** `0.0%`..`100.0%`, clamped, for progress readouts. */
export function formatPercent(fraction: number, places = 1): string {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
  return `${(clamped * 100).toFixed(places)}%`;
}
