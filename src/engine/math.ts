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
 * `rate` is the fraction of the remaining distance covered per second.
 */
export function damp(a: number, b: number, rate: number, dt: number): number {
  return lerp(a, b, 1 - Math.exp(-rate * dt));
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

export function length(x: number, y: number): number {
  return Math.hypot(x, y);
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function distanceSq(a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return dx * dx + dy * dy;
}

/** Normalises in place and returns the original magnitude. */
export function normalize(v: Vec2): number {
  const len = Math.hypot(v.x, v.y);
  if (len > 1e-6) {
    v.x /= len;
    v.y /= len;
  }
  return len;
}

/** Caps a vector's magnitude without changing its direction. */
export function clampLength(v: Vec2, max: number): void {
  const len = Math.hypot(v.x, v.y);
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

export function easeOutCubic(t: number): number {
  const c = clamp(t, 0, 1);
  return 1 - (1 - c) ** 3;
}
