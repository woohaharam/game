/**
 * Central balance and tuning table.
 *
 * Every gameplay constant lives here rather than inline at its use site.
 * Tuning a roguelike means changing one number and immediately replaying, and
 * hunting a magic number across a dozen files is how balance passes die. It
 * also makes the whole game's feel reviewable as a single diff.
 *
 * Units: distances in pixels, times in seconds, speeds in pixels/second.
 */

export const VIEW = {
  /** Virtual design resolution. Everything is authored against this. */
  width: 1024,
  height: 576,
} as const;

export const PLAYER = {
  radius: 11,
  maxHealth: 6,
  moveSpeed: 215,
  /** Acceleration/deceleration stiffness; higher = snappier, less drift. */
  accel: 22,
  dashSpeed: 640,
  dashDuration: 0.16,
  dashCooldown: 0.68,
  /** Invulnerability from the moment a dash starts. */
  dashInvuln: 0.3,
  /** Invulnerability after taking a hit, so one mistake is not three. */
  hitInvuln: 1.0,
  /** Held-fire is buffered this long past the press so taps never eat a shot. */
  fireBuffer: 0.12,
} as const;

export const WEAPON = {
  damage: 10,
  /** Shots per second. */
  fireRate: 5.2,
  projectileSpeed: 640,
  projectileRadius: 4,
  projectileLife: 0.72,
  /** Cone half-angle in radians applied to every shot. */
  spread: 0.045,
  projectiles: 1,
  critChance: 0.05,
  critMultiplier: 2,
  knockback: 130,
} as const;

export type EnemyKind = 'grunt' | 'shooter' | 'bomber' | 'turret' | 'brute' | 'boss';

export interface EnemyStats {
  kind: EnemyKind;
  health: number;
  radius: number;
  speed: number;
  /** Damage dealt by touching the player. 0 = harmless on contact. */
  contactDamage: number;
  /** Score and XP value. */
  score: number;
  color: string;
  /** How hard the enemy is shoved by a hit; 0 = immovable. */
  knockbackScale: number;
  /** Difficulty weight used when filling a room to a budget. */
  cost: number;
}

export const ENEMIES: Record<EnemyKind, EnemyStats> = {
  grunt: {
    kind: 'grunt',
    health: 26,
    radius: 12,
    speed: 118,
    contactDamage: 1,
    score: 10,
    color: '#ff5c7a',
    knockbackScale: 1,
    cost: 1,
  },
  shooter: {
    kind: 'shooter',
    health: 22,
    radius: 12,
    speed: 92,
    contactDamage: 1,
    score: 15,
    color: '#ffb03a',
    knockbackScale: 1,
    cost: 1.5,
  },
  bomber: {
    kind: 'bomber',
    health: 30,
    radius: 13,
    speed: 168,
    contactDamage: 0,
    score: 18,
    color: '#c98bff',
    knockbackScale: 0.8,
    cost: 1.5,
  },
  turret: {
    kind: 'turret',
    health: 46,
    radius: 15,
    speed: 0,
    contactDamage: 1,
    score: 20,
    color: '#4de2c0',
    knockbackScale: 0,
    cost: 2,
  },
  brute: {
    kind: 'brute',
    health: 96,
    radius: 20,
    speed: 96,
    contactDamage: 2,
    score: 45,
    color: '#ff3d5e',
    knockbackScale: 0.35,
    cost: 3.5,
  },
  boss: {
    kind: 'boss',
    health: 620,
    radius: 42,
    speed: 78,
    contactDamage: 2,
    score: 400,
    color: '#ff2d6f',
    knockbackScale: 0,
    cost: 0,
  },
};

export const ENEMY_BULLET = {
  speed: 235,
  radius: 6,
  damage: 1,
  life: 3.2,
} as const;

/**
 * Per-floor scaling. Enemies gain health and rooms gain budget with depth;
 * both curves are deliberately gentle so player upgrades outpace them early
 * and only catch up around floor 5.
 */
export const SCALING = {
  enemyHealthPerDepth: 0.22,
  enemySpeedPerDepth: 0.045,
  /** Spawn budget for a normal combat room. */
  budgetBase: 3.5,
  budgetPerDepth: 1.6,
  eliteBudgetMultiplier: 1.7,
  bossHealthPerDepth: 0.35,
} as const;

export const ROOM = {
  /** Delay before a freshly entered combat room spawns its enemies. */
  spawnDelay: 0.45,
  /** Time each enemy spends materialising and unable to act or be hit. */
  spawnTelegraph: 0.55,
  /** Doors stay shut this long after the last kill, so the payoff lands. */
  clearDelay: 0.35,
} as const;

export const FEEL = {
  /** Frames-of-freeze on a hit, in seconds. Sells impact better than any VFX. */
  hitStopLight: 0.035,
  hitStopHeavy: 0.09,
  cameraTraumaHit: 0.16,
  cameraTraumaExplosion: 0.4,
  cameraTraumaPlayerHit: 0.5,
  /** Player-hit slow motion. */
  slowMoScale: 0.35,
  slowMoDuration: 0.5,
} as const;

export const SCORE = {
  /** Combo decays this many seconds after the last kill. */
  comboWindow: 3,
  /** Score multiplier is 1 + kills * this, capped. */
  comboStep: 0.1,
  comboMax: 4,
  roomClearBonus: 50,
  floorClearBonus: 500,
  /** Bonus for finishing a floor without taking a hit. */
  flawlessBonus: 750,
} as const;

export const PICKUP = {
  radius: 9,
  magnetRadius: 96,
  magnetSpeed: 420,
  healAmount: 1,
  /** Chance a normal enemy drops a heart when the player is hurt. */
  heartChance: 0.07,
  coinChance: 0.45,
} as const;
