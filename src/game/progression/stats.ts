import { PLAYER, WEAPON } from '@game/config';

/**
 * The complete set of numbers an upgrade is allowed to touch.
 *
 * Keeping the player's derived stats in one flat, plain-data record — rather
 * than as mutable fields scattered over the player entity — means the whole
 * build can be recomputed from `(base, upgrades)` at any time. Recomputing
 * instead of incrementally mutating is what stops the classic roguelike bug
 * where removing a buff leaves part of its effect behind.
 */
export interface PlayerStats {
  maxHealth: number;
  moveSpeed: number;
  damage: number;
  /** Shots per second. */
  fireRate: number;
  projectileSpeed: number;
  projectileLife: number;
  /** Bullets released per shot. */
  projectiles: number;
  /** Cone half-angle in radians. */
  spread: number;
  critChance: number;
  critMultiplier: number;
  knockback: number;
  dashCooldown: number;
  dashInvuln: number;
  /** Extra enemies each bullet passes through. */
  pierce: number;
  /** Health restored per kill, as a probability when below 1. */
  lifesteal: number;
  /** Bullets explode on impact when > 0; value is the blast radius. */
  explosionRadius: number;
  /** Orbiting blades that damage on contact. */
  orbitals: number;
  /** Multiplier on all score gained. */
  scoreMultiplier: number;
  /** Chance a shot fires a second time at no cost. */
  doubleShotChance: number;
  /** Steering strength applied to bullets, in radians/second. */
  homing: number;
  /** Contact damage reflected onto attackers. */
  thorns: number;
  /** Flat damage reduction applied after everything else. */
  armor: number;
}

export function baseStats(): PlayerStats {
  return {
    maxHealth: PLAYER.maxHealth,
    moveSpeed: PLAYER.moveSpeed,
    damage: WEAPON.damage,
    fireRate: WEAPON.fireRate,
    projectileSpeed: WEAPON.projectileSpeed,
    projectileLife: WEAPON.projectileLife,
    projectiles: WEAPON.projectiles,
    spread: WEAPON.spread,
    critChance: WEAPON.critChance,
    critMultiplier: WEAPON.critMultiplier,
    knockback: WEAPON.knockback,
    dashCooldown: PLAYER.dashCooldown,
    dashInvuln: PLAYER.dashInvuln,
    pierce: 0,
    lifesteal: 0,
    explosionRadius: 0,
    orbitals: 0,
    scoreMultiplier: 1,
    doubleShotChance: 0,
    homing: 0,
    thorns: 0,
    armor: 0,
  };
}

export type StatKey = keyof PlayerStats;

export interface StatModifier {
  stat: StatKey;
  /** `add` is applied before every `mul`, so ordering never affects the result. */
  op: 'add' | 'mul';
  value: number;
}

/** Stats that must stay whole numbers (bullet counts cannot be 1.5). */
const INTEGER_STATS: ReadonlySet<StatKey> = new Set<StatKey>([
  'projectiles',
  'pierce',
  'orbitals',
  'maxHealth',
]);

/** Lower bounds that keep a stacked build from producing a broken state. */
const FLOORS: Partial<Record<StatKey, number>> = {
  maxHealth: 1,
  moveSpeed: 60,
  damage: 1,
  fireRate: 0.5,
  projectiles: 1,
  spread: 0,
  dashCooldown: 0.12,
  critChance: 0,
};

/** Upper bounds on stats where an unbounded stack would trivialise the game. */
const CEILINGS: Partial<Record<StatKey, number>> = {
  fireRate: 22,
  critChance: 1,
  projectiles: 14,
  doubleShotChance: 1,
  lifesteal: 1,
};

/**
 * Folds a list of modifiers onto a base stat block.
 *
 * All additive terms land first, then all multiplicative ones. Doing it in one
 * fixed order makes a build's power independent of the order upgrades were
 * picked up in — otherwise "+5 damage then x2" and "x2 then +5 damage" give
 * different results and players quite reasonably call it a bug.
 */
export function applyModifiers(
  base: PlayerStats,
  modifiers: readonly StatModifier[],
): PlayerStats {
  const result: PlayerStats = { ...base };

  for (const modifier of modifiers) {
    if (modifier.op === 'add') {
      result[modifier.stat] = result[modifier.stat] + modifier.value;
    }
  }
  for (const modifier of modifiers) {
    if (modifier.op === 'mul') {
      result[modifier.stat] = result[modifier.stat] * modifier.value;
    }
  }

  for (const key of Object.keys(result) as StatKey[]) {
    let value = result[key];
    const floor = FLOORS[key];
    const ceiling = CEILINGS[key];
    if (floor !== undefined && value < floor) value = floor;
    if (ceiling !== undefined && value > ceiling) value = ceiling;
    if (INTEGER_STATS.has(key)) value = Math.round(value);
    result[key] = value;
  }

  return result;
}
