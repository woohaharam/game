import { clamp, damp, type Vec2 } from './math';
import type { Rng } from './rng';

/**
 * 2D camera with smoothed follow, trauma-based shake and world/screen mapping.
 *
 * Shake is driven by a "trauma" value rather than a fixed animation: many small
 * hits accumulate into a bigger shake, and offset scales with trauma^2 so light
 * feedback stays subtle while a boss slam is unmistakable. Decay is per-second,
 * so the effect is identical at any frame rate.
 */
export class Camera {
  readonly position: Vec2 = { x: 0, y: 0 };
  zoom = 1;

  private trauma = 0;
  private shakeTime = 0;
  private readonly offset: Vec2 = { x: 0, y: 0 };

  /** World-space rectangle the camera is allowed to show; null = unbounded. */
  bounds: { x: number; y: number; width: number; height: number } | null = null;

  constructor(
    public viewWidth: number,
    public viewHeight: number,
    private readonly rng: Rng,
  ) {}

  resize(width: number, height: number): void {
    this.viewWidth = width;
    this.viewHeight = height;
  }

  snapTo(x: number, y: number): void {
    this.position.x = x;
    this.position.y = y;
    this.applyBounds();
  }

  /** Eases toward a target. `rate` is the follow stiffness per second. */
  follow(targetX: number, targetY: number, dt: number, rate = 8): void {
    this.position.x = damp(this.position.x, targetX, rate, dt);
    this.position.y = damp(this.position.y, targetY, rate, dt);
    this.applyBounds();
  }

  /** Adds shake. `amount` in [0, 1]; trauma saturates at 1. */
  addTrauma(amount: number): void {
    this.trauma = clamp(this.trauma + amount, 0, 1);
  }

  update(dt: number): void {
    this.shakeTime += dt;
    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - dt * 1.6);
      const magnitude = this.trauma * this.trauma * 18;
      // Two out-of-phase sines read as "impact" where pure noise reads as "broken".
      this.offset.x = Math.sin(this.shakeTime * 47 + this.rng.seed) * magnitude;
      this.offset.y = Math.cos(this.shakeTime * 61) * magnitude;
    } else {
      this.offset.x = 0;
      this.offset.y = 0;
    }
  }

  private applyBounds(): void {
    const b = this.bounds;
    if (b === null) return;
    const halfW = this.viewWidth / (2 * this.zoom);
    const halfH = this.viewHeight / (2 * this.zoom);

    // A room narrower than the viewport is centred rather than clamped to an
    // edge, otherwise small rooms visibly snap to a corner.
    this.position.x =
      b.width <= halfW * 2
        ? b.x + b.width / 2
        : clamp(this.position.x, b.x + halfW, b.x + b.width - halfW);
    this.position.y =
      b.height <= halfH * 2
        ? b.y + b.height / 2
        : clamp(this.position.y, b.y + halfH, b.y + b.height - halfH);
  }

  /** Top-left world coordinate currently visible, shake included. */
  get viewX(): number {
    return this.position.x + this.offset.x - this.viewWidth / (2 * this.zoom);
  }

  get viewY(): number {
    return this.position.y + this.offset.y - this.viewHeight / (2 * this.zoom);
  }

  worldToScreen(worldX: number, worldY: number, out: Vec2): Vec2 {
    out.x = (worldX - this.viewX) * this.zoom;
    out.y = (worldY - this.viewY) * this.zoom;
    return out;
  }

  screenToWorld(screenX: number, screenY: number, out: Vec2): Vec2 {
    out.x = screenX / this.zoom + this.viewX;
    out.y = screenY / this.zoom + this.viewY;
    return out;
  }

  /** Cheap frustum cull test used before every draw call. */
  isVisible(x: number, y: number, radius: number): boolean {
    const left = this.viewX - radius;
    const top = this.viewY - radius;
    const right = left + this.viewWidth / this.zoom + radius * 2;
    const bottom = top + this.viewHeight / this.zoom + radius * 2;
    return x >= left && x <= right && y >= top && y <= bottom;
  }
}
