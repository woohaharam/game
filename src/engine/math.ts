/** Small math helpers shared by every system. All angles are radians. */

export const TAU = Math.PI * 2;

export interface Vec2 {
  x: number;
  y: number;
}

export function vec2(x = 0, y = 0): Vec2 {
  return { x, y };
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Frame-rate independent exponential smoothing.
 *
 * `rate` is the fraction of the remaining distance covered per second. The
 * blend factor is memoised per (rate, dt) pair for the same reason
 * `decayPerStep` is: `Math.exp` has implementation-defined precision, and a
 * fixed-timestep simulation only ever asks for a handful of pairs.
 */
const dampCache = new Map<string, number>();

export function damp(a: number, b: number, rate: number, dt: number): number {
  const key = `${rate}:${dt}`;
  let t = dampCache.get(key);
  if (t === undefined) {
    t = 1 - Math.exp(-rate * dt);
    dampCache.set(key, t);
  }
  return lerp(a, b, t);
}

export function lerpAngle(a: number, b: number, t: number): number {
  return a + angleDelta(a, b) * t;
}

/** Shortest signed rotation from `a` to `b`, always within (-PI, PI]. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/**
 * Vector length.
 *
 * Deliberately `sqrt(x*x + y*y)` rather than `Math.hypot`. The ECMAScript spec
 * pins `Math.sqrt` to IEEE-754's exactly-rounded square root, but leaves
 * `Math.hypot`'s precision to the implementation — and V8 evaluates it
 * differently in optimised and unoptimised code. That is invisible in normal
 * play and fatal to replays: a run recorded before a function tiers up can
 * diverge from the same run replayed after it.
 *
 * `Math.hypot` also guards against intermediate overflow, which matters for
 * astronomical magnitudes and never for screen coordinates. It is several
 * times slower for the trouble.
 */
export function length(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

export function distance(a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function distanceSq(a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx * dx + dy * dy;
}

/** Normalises in place and returns the original magnitude. */
export function normalize(v: Vec2): number {
  const len = length(v.x, v.y);
  if (len > 1e-6) {
    v.x /= len;
    v.y /= len;
  }
  return len;
}

/** Caps a vector's magnitude without changing its direction. */
export function clampLength(v: Vec2, max: number): void {
  const len = length(v.x, v.y);
  if (len > max && len > 1e-6) {
    v.x = (v.x / len) * max;
    v.y = (v.y / len) * max;
  }
}

export function circlesOverlap(
  ax: number,
  ay: number,
  ar: number,
  bx: number,
  by: number,
  br: number,
): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const r = ar + br;
  return dx * dx + dy * dy <= r * r;
}

/** Smoothstep easing on the normalised range [0, 1]. */
export function smoothstep(t: number): number {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}

/**
 * Per-second decay applied over one step, as a plain multiplier.
 *
 * `rate ** (step * 60)` reads naturally but calls `Math.pow` with a fractional
 * exponent every frame, for every entity. `Math.pow` is another function whose
 * precision the spec leaves to the implementation, so — like `Math.hypot` — it
 * can round differently once V8 optimises the caller, which breaks replays.
 *
 * Results are memoised per (rate, step) pair. In practice the simulation runs
 * at one fixed step with a handful of rates, so the cache holds a few entries
 * and every call after the first is a lookup.
 */
const decayCache = new Map<string, number>();

export function decayPerStep(ratePerSecond: number, step: number): number {
  const key = `${ratePerSecond}:${step}`;
  const cached = decayCache.get(key);
  if (cached !== undefined) return cached;
  const value = ratePerSecond ** (step * 60);
  decayCache.set(key, value);
  return value;
}

export function easeOutCubic(t: number): number {
  const c = clamp(t, 0, 1);
  return 1 - (1 - c) ** 3;
}
