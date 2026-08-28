/**
 * Immutable big number for idle-game progression.
 *
 * Idle games break `number` almost immediately. Costs and damage grow
 * geometrically, so a few hours of play pushes past 2^53 and integer arithmetic
 * silently stops being exact; a few days pushes past 1.8e308 and everything
 * becomes `Infinity`. Both failures are invisible until a player's save is
 * ruined, which is the worst possible time to find out.
 *
 * The representation is a normalised mantissa in [1, 10) plus a base-10
 * exponent, so magnitude is stored separately from precision. That trades exact
 * integer arithmetic — which the game does not need — for a range of roughly
 * 1e±1e308 and a constant ~15 significant digits everywhere in it.
 *
 * Multiplication and division become addition and subtraction of exponents,
 * which is also why they are cheap: an idle game multiplies far more than it
 * adds.
 *
 * Instances are immutable. Every operation returns a new value, so a number
 * handed to the UI cannot be mutated underneath it by the next simulation tick.
 */

/** Mantissas closer than this to a power of ten are snapped, to stop drift. */
const NORMALISE_EPSILON = 1e-12;

export class Decimal {
  /** Always in [1, 10), or exactly 0 when the value is zero. */
  readonly mantissa: number;
  readonly exponent: number;

  private constructor(mantissa: number, exponent: number) {
    if (mantissa === 0 || !Number.isFinite(mantissa)) {
      this.mantissa = 0;
      this.exponent = 0;
      return;
    }

    const sign = mantissa < 0 ? -1 : 1;
    let m = Math.abs(mantissa);
    let e = exponent;

    // Renormalise into [1, 10). log10 in one step rather than a loop, so a
    // mantissa arriving as 1e40 (from a multiplication) costs the same as 1.5.
    const shift = Math.floor(Math.log10(m));
    m /= 10 ** shift;
    e += shift;

    // Floating point leaves 9.999999999999998 where 10 belongs; left alone that
    // drifts a digit every few thousand operations.
    if (m >= 10 - NORMALISE_EPSILON) {
      m = 1;
      e += 1;
    } else if (m < 1) {
      m *= 10;
      e -= 1;
    }

    this.mantissa = sign * m;
    this.exponent = e;
  }

  // -- construction ---------------------------------------------------------

  static readonly ZERO = new Decimal(0, 0);
  static readonly ONE = new Decimal(1, 0);

  static from(value: number | Decimal): Decimal {
    if (value instanceof Decimal) return value;
    return new Decimal(value, 0);
  }

  /** `mantissa × 10^exponent`, without requiring the mantissa to be normalised. */
  static of(mantissa: number, exponent: number): Decimal {
    return new Decimal(mantissa, exponent);
  }

  /** Parses the `"m,e"` form used by saves. Returns zero for anything invalid. */
  static parse(text: string): Decimal {
    const parts = text.split(',');
    if (parts.length !== 2) return Decimal.ZERO;
    const [m, e] = parts as [string, string];
    // `Number('')` is 0, not NaN, so a truncated payload like "1," would parse
    // as a perfectly plausible 1 without this. Emptiness has to be rejected
    // before the conversion, not after it.
    if (m.trim() === '' || e.trim() === '') return Decimal.ZERO;
    const mantissa = Number(m);
    const exponent = Number(e);
    if (!Number.isFinite(mantissa) || !Number.isFinite(exponent)) return Decimal.ZERO;
    return new Decimal(mantissa, exponent);
  }

  /** Compact, lossless-enough serialisation. Not for display. */
  serialise(): string {
    return `${this.mantissa},${this.exponent}`;
  }

  // -- inspection -----------------------------------------------------------

  get isZero(): boolean {
    return this.mantissa === 0;
  }

  get isNegative(): boolean {
    return this.mantissa < 0;
  }

  /**
   * Collapses to a plain number. Returns `Infinity` past the double range —
   * only call this where that is acceptable, such as a progress-bar ratio.
   */
  toNumber(): number {
    if (this.mantissa === 0) return 0;
    if (this.exponent > 308) return this.mantissa < 0 ? -Infinity : Infinity;
    if (this.exponent < -308) return 0;
    return this.mantissa * 10 ** this.exponent;
  }

  /** Base-10 logarithm. Negative and zero values return `-Infinity`. */
  log10(): number {
    if (this.mantissa <= 0) return -Infinity;
    return this.exponent + Math.log10(this.mantissa);
  }

  // -- arithmetic -----------------------------------------------------------

  add(other: Decimal | number): Decimal {
    const b = Decimal.from(other);
    if (this.isZero) return b;
    if (b.isZero) return this;

    const [big, small] = this.exponent >= b.exponent ? [this, b] : [b, this];
    const gap = big.exponent - small.exponent;
    // Beyond ~17 decades the smaller term cannot affect the result's
    // significant digits, so skip the arithmetic instead of losing it to
    // rounding. This is the common case: adding trickle income to a large bank.
    if (gap > 17) return big;

    return new Decimal(big.mantissa + small.mantissa / 10 ** gap, big.exponent);
  }

  subtract(other: Decimal | number): Decimal {
    return this.add(Decimal.from(other).negate());
  }

  negate(): Decimal {
    return new Decimal(-this.mantissa, this.exponent);
  }

  multiply(other: Decimal | number): Decimal {
    const b = Decimal.from(other);
    if (this.isZero || b.isZero) return Decimal.ZERO;
    return new Decimal(this.mantissa * b.mantissa, this.exponent + b.exponent);
  }

  divide(other: Decimal | number): Decimal {
    const b = Decimal.from(other);
    // Division by zero yields zero rather than Infinity: an idle game's answer
    // to "how many can I afford at zero cost" should never be a poison value
    // that spreads through every later calculation.
    if (b.isZero) return Decimal.ZERO;
    if (this.isZero) return Decimal.ZERO;
    return new Decimal(this.mantissa / b.mantissa, this.exponent - b.exponent);
  }

  /** Raises to a real power. */
  pow(exponent: number): Decimal {
    if (this.isZero) return exponent === 0 ? Decimal.ONE : Decimal.ZERO;
    if (exponent === 0) return Decimal.ONE;
    // Work in logs: mantissa^n overflows for large n, the log never does.
    const log = this.log10() * exponent;
    const wholePart = Math.floor(log);
    return new Decimal(10 ** (log - wholePart), wholePart);
  }

  // -- comparison -----------------------------------------------------------

  /** -1, 0 or 1. */
  compare(other: Decimal | number): number {
    const b = Decimal.from(other);
    if (this.isZero && b.isZero) return 0;
    if (this.mantissa < 0 !== b.mantissa < 0) return this.mantissa < 0 ? -1 : 1;

    const sign = this.mantissa < 0 ? -1 : 1;
    if (this.exponent !== b.exponent) {
      return this.exponent > b.exponent ? sign : -sign;
    }
    if (this.mantissa === b.mantissa) return 0;
    return this.mantissa > b.mantissa ? 1 : -1;
  }

  greaterThan(other: Decimal | number): boolean {
    return this.compare(other) > 0;
  }

  greaterOrEqual(other: Decimal | number): boolean {
    return this.compare(other) >= 0;
  }

  lessThan(other: Decimal | number): boolean {
    return this.compare(other) < 0;
  }

  max(other: Decimal | number): Decimal {
    const b = Decimal.from(other);
    return this.compare(b) >= 0 ? this : b;
  }

  min(other: Decimal | number): Decimal {
    const b = Decimal.from(other);
    return this.compare(b) <= 0 ? this : b;
  }
}

/** Convenience constructor: `d(5)` reads better than `Decimal.from(5)`. */
export function d(value: number | Decimal): Decimal {
  return Decimal.from(value);
}
