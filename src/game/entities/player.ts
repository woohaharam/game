import { clamp, damp, length, type Vec2 } from '@engine/math';
import { PLAYER } from '@game/config';
import type { PlayerStats } from '@game/progression/stats';

/**
 * Player entity.
 *
 * Everything here exists to make the character feel responsive rather than
 * realistic:
 *
 * - **Acceleration, not teleportation.** Velocity is eased toward the input
 *   direction, but fast enough (`PLAYER.accel`) that it reads as instant while
 *   still letting momentum carry through a direction change.
 * - **Input buffering.** A dash pressed a few frames before it comes off
 *   cooldown still fires. Players do not perceive their own early presses as
 *   errors, so eating them feels like the game dropped an input.
 * - **Generous invulnerability.** After a hit, and for slightly longer than
 *   the dash itself lasts, so a well-timed dash through a bullet always works
 *   even when the timing is a frame off.
 */
export class Player {
  x = 0;
  y = 0;
  /** Previous position, for render interpolation. */
  px = 0;
  py = 0;
  vx = 0;
  vy = 0;
  readonly radius = PLAYER.radius;

  health: number = PLAYER.maxHealth;
  alive = true;

  /** Aim direction in radians; driven by the pointer or the right stick. */
  aimAngle = 0;
  /** Facing used for the sprite; lags aim slightly so turns read as motion. */
  facing = 0;

  dashCooldown = 0;
  dashTimer = 0;
  /** Buffered dash press, consumed when the cooldown clears. */
  private dashBuffer = 0;
  dashAngle = 0;

  invulnerable = 0;
  fireCooldown = 0;
  private fireBuffer = 0;

  /** Rotation of the orbital blades, if the build has any. */
  orbitAngle = 0;

  /** Set for one tick when a hit lands, so the world can react once. */
  justHit = false;

  reset(x: number, y: number, stats: PlayerStats): void {
    this.x = this.px = x;
    this.y = this.py = y;
    this.vx = 0;
    this.vy = 0;
    this.health = stats.maxHealth;
    this.alive = true;
    this.dashCooldown = 0;
    this.dashTimer = 0;
    this.dashBuffer = 0;
    this.invulnerable = 0;
    this.fireCooldown = 0;
    this.fireBuffer = 0;
    this.justHit = false;
  }

  get isDashing(): boolean {
    return this.dashTimer > 0;
  }

  get isInvulnerable(): boolean {
    return this.invulnerable > 0;
  }

  /** Ratio in [0, 1] for the dash-ready ring in the HUD. */
  dashReadiness(stats: PlayerStats): number {
    if (this.dashCooldown <= 0) return 1;
    return clamp(1 - this.dashCooldown / stats.dashCooldown, 0, 1);
  }

  requestDash(): void {
    this.dashBuffer = 0.16;
  }

  requestFire(): void {
    this.fireBuffer = PLAYER.fireBuffer;
  }

  /**
   * Advances movement. Returns nothing; firing is resolved by the world, which
   * owns the projectile pool.
   */
  update(step: number, move: Vec2, stats: PlayerStats): void {
    this.px = this.x;
    this.py = this.y;

    this.invulnerable = Math.max(0, this.invulnerable - step);
    this.dashCooldown = Math.max(0, this.dashCooldown - step);
    this.fireCooldown = Math.max(0, this.fireCooldown - step);
    this.dashBuffer = Math.max(0, this.dashBuffer - step);
    this.fireBuffer = Math.max(0, this.fireBuffer - step);
    this.justHit = false;
    this.orbitAngle += step * 3.1;

    if (this.dashTimer > 0) {
      this.dashTimer -= step;
      // A dash is fully committed: no steering mid-dash, which is what makes
      // it a real decision rather than a free speed boost.
      this.vx = Math.cos(this.dashAngle) * PLAYER.dashSpeed;
      this.vy = Math.sin(this.dashAngle) * PLAYER.dashSpeed;
    } else {
      if (this.dashBuffer > 0 && this.dashCooldown <= 0) {
        this.startDash(move, stats);
      } else {
        const targetX = move.x * stats.moveSpeed;
        const targetY = move.y * stats.moveSpeed;
        this.vx = damp(this.vx, targetX, PLAYER.accel, step);
        this.vy = damp(this.vy, targetY, PLAYER.accel, step);
      }
    }

    this.x += this.vx * step;
    this.y += this.vy * step;

    // Face the way we are aiming, easing so quick flicks still look smooth.
    const moving = length(this.vx, this.vy) > 12;
    const target = moving && !this.isDashing ? Math.atan2(this.vy, this.vx) : this.aimAngle;
    const delta = ((target - this.facing + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this.facing += delta * clamp(step * 16, 0, 1);
  }

  private startDash(move: Vec2, stats: PlayerStats): void {
    // Dash toward the movement stick when there is one, otherwise toward the
    // crosshair — dashing "nowhere" because no key was held feels broken.
    const hasMove = length(move.x, move.y) > 0.1;
    this.dashAngle = hasMove ? Math.atan2(move.y, move.x) : this.aimAngle;
    this.dashTimer = PLAYER.dashDuration;
    this.dashCooldown = stats.dashCooldown;
    this.invulnerable = Math.max(this.invulnerable, stats.dashInvuln);
    this.dashBuffer = 0;
  }

  /** True when the world should emit a volley this tick. */
  consumeFire(held: boolean, stats: PlayerStats): boolean {
    if (this.fireCooldown > 0) return false;
    if (!held && this.fireBuffer <= 0) return false;
    this.fireCooldown = 1 / stats.fireRate;
    this.fireBuffer = 0;
    return true;
  }

  /** Applies damage. Returns true when the hit actually landed. */
  takeDamage(amount: number): boolean {
    if (!this.alive || this.isInvulnerable) return false;
    this.health -= amount;
    this.invulnerable = PLAYER.hitInvuln;
    this.justHit = true;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
    }
    return true;
  }

  heal(amount: number, stats: PlayerStats): boolean {
    if (this.health >= stats.maxHealth) return false;
    this.health = Math.min(stats.maxHealth, this.health + amount);
    return true;
  }

  /** Shoves the player, e.g. away from an explosion. */
  applyImpulse(angle: number, force: number): void {
    this.vx += Math.cos(angle) * force;
    this.vy += Math.sin(angle) * force;
  }
}
