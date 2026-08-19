/**
 * Plain-data structs for everything that flies.
 *
 * These are pooled, so they are written as mutable records with a `reset`
 * rather than as classes with constructors: a pooled instance is recycled
 * hundreds of times per run and must never carry state from its last life.
 */
import type { Enemy } from './enemy';

export interface Projectile {
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  critical: boolean;
  life: number;
  /** Remaining enemies this shot can pass through. */
  pierce: number;
  /** Enemies already hit, so a piercing shot cannot hit one twice. */
  hits: Set<Enemy>;
  explosionRadius: number;
  homing: number;
  knockback: number;
}

export function createProjectile(): Projectile {
  return {
    x: 0,
    y: 0,
    px: 0,
    py: 0,
    vx: 0,
    vy: 0,
    radius: 4,
    damage: 1,
    critical: false,
    life: 0,
    pierce: 0,
    hits: new Set(),
    explosionRadius: 0,
    homing: 0,
    knockback: 0,
  };
}

export function resetProjectile(p: Projectile): void {
  p.life = 0;
  p.pierce = 0;
  p.critical = false;
  p.explosionRadius = 0;
  p.homing = 0;
  p.hits.clear();
}

export interface EnemyBullet {
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  life: number;
  color: string;
}

export function createEnemyBullet(): EnemyBullet {
  return {
    x: 0,
    y: 0,
    px: 0,
    py: 0,
    vx: 0,
    vy: 0,
    radius: 6,
    damage: 1,
    life: 0,
    color: '#ff7a4d',
  };
}

export type PickupKind = 'heart' | 'coin';

export interface Pickup {
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  kind: PickupKind;
  life: number;
  /** Brief delay before the magnet grabs it, so drops visibly scatter first. */
  delay: number;
}

export function createPickup(): Pickup {
  return {
    x: 0,
    y: 0,
    px: 0,
    py: 0,
    vx: 0,
    vy: 0,
    kind: 'coin',
    life: 0,
    delay: 0,
  };
}

export interface FloatingText {
  x: number;
  y: number;
  vy: number;
  life: number;
  maxLife: number;
  text: string;
  color: string;
  size: number;
}

export function createFloatingText(): FloatingText {
  return { x: 0, y: 0, vy: 0, life: 0, maxLife: 1, text: '', color: '#fff', size: 14 };
}
