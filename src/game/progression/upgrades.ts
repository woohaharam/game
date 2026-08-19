import type { Rng } from '@engine/rng';
import type { StatModifier } from './stats';

/**
 * The upgrade pool.
 *
 * Upgrades are pure data: a list of stat modifiers plus presentation. Nothing
 * here executes gameplay code, which means a build is fully described by the
 * ids the player picked — trivial to log, to show on the death screen, and to
 * test ("does taking Split Shot three times really give five bullets?").
 *
 * Design intent: no upgrade is strictly better than another. The multishot
 * line widens spread, the fire-rate line costs damage, and the defensive line
 * gives up offence — so choices stay choices rather than obvious picks.
 */
export type Rarity = 'common' | 'rare' | 'epic';

export interface UpgradeDef {
  id: string;
  name: string;
  description: string;
  rarity: Rarity;
  /** How many times this upgrade may be taken in a run. */
  maxStacks: number;
  modifiers: StatModifier[];
  /** Minimum floor before this can be offered. */
  minDepth?: number;
}

const RARITY_WEIGHT: Record<Rarity, number> = {
  common: 100,
  rare: 42,
  epic: 14,
};

export const UPGRADES: readonly UpgradeDef[] = [
  // --- Offence: raw damage ------------------------------------------------
  {
    id: 'sharp-rounds',
    name: 'Sharp Rounds',
    description: '+25% damage.',
    rarity: 'common',
    maxStacks: 6,
    modifiers: [{ stat: 'damage', op: 'mul', value: 1.25 }],
  },
  {
    id: 'overclock',
    name: 'Overclock',
    description: '+30% fire rate, -10% damage.',
    rarity: 'common',
    maxStacks: 5,
    modifiers: [
      { stat: 'fireRate', op: 'mul', value: 1.3 },
      { stat: 'damage', op: 'mul', value: 0.9 },
    ],
  },
  {
    id: 'hair-trigger',
    name: 'Hair Trigger',
    description: '+15% fire rate and +12% projectile speed.',
    rarity: 'common',
    maxStacks: 4,
    modifiers: [
      { stat: 'fireRate', op: 'mul', value: 1.15 },
      { stat: 'projectileSpeed', op: 'mul', value: 1.12 },
    ],
  },

  // --- Offence: shape of the shot ----------------------------------------
  {
    id: 'split-shot',
    name: 'Split Shot',
    description: '+1 projectile, wider spread, -15% damage.',
    rarity: 'rare',
    maxStacks: 4,
    modifiers: [
      { stat: 'projectiles', op: 'add', value: 1 },
      { stat: 'spread', op: 'add', value: 0.075 },
      { stat: 'damage', op: 'mul', value: 0.85 },
    ],
  },
  {
    id: 'focus-array',
    name: 'Focus Array',
    description: 'Halves spread, +15% damage.',
    rarity: 'rare',
    maxStacks: 3,
    modifiers: [
      { stat: 'spread', op: 'mul', value: 0.5 },
      { stat: 'damage', op: 'mul', value: 1.15 },
    ],
  },
  {
    id: 'piercing-core',
    name: 'Piercing Core',
    description: 'Shots pass through 1 extra enemy.',
    rarity: 'rare',
    maxStacks: 3,
    modifiers: [{ stat: 'pierce', op: 'add', value: 1 }],
  },
  {
    id: 'long-barrel',
    name: 'Long Barrel',
    description: '+40% projectile range and speed.',
    rarity: 'common',
    maxStacks: 3,
    modifiers: [
      { stat: 'projectileLife', op: 'mul', value: 1.4 },
      { stat: 'projectileSpeed', op: 'mul', value: 1.4 },
    ],
  },
  {
    id: 'seeker-rounds',
    name: 'Seeker Rounds',
    description: 'Shots curve toward nearby enemies.',
    rarity: 'epic',
    maxStacks: 3,
    minDepth: 2,
    modifiers: [{ stat: 'homing', op: 'add', value: 3.2 }],
  },
  {
    id: 'volatile-rounds',
    name: 'Volatile Rounds',
    description: 'Shots explode on impact.',
    rarity: 'epic',
    maxStacks: 3,
    minDepth: 2,
    modifiers: [{ stat: 'explosionRadius', op: 'add', value: 46 }],
  },
  {
    id: 'echo-chamber',
    name: 'Echo Chamber',
    description: '25% chance to fire a free second volley.',
    rarity: 'epic',
    maxStacks: 3,
    minDepth: 2,
    modifiers: [{ stat: 'doubleShotChance', op: 'add', value: 0.25 }],
  },

  // --- Offence: critical --------------------------------------------------
  {
    id: 'weak-point',
    name: 'Weak Point',
    description: '+10% critical chance.',
    rarity: 'common',
    maxStacks: 6,
    modifiers: [{ stat: 'critChance', op: 'add', value: 0.1 }],
  },
  {
    id: 'executioner',
    name: 'Executioner',
    description: '+1.0x critical damage, -5% critical chance.',
    rarity: 'rare',
    maxStacks: 3,
    modifiers: [
      { stat: 'critMultiplier', op: 'add', value: 1 },
      { stat: 'critChance', op: 'add', value: -0.05 },
    ],
  },

  // --- Defence and mobility ----------------------------------------------
  {
    id: 'reinforced-hull',
    name: 'Reinforced Hull',
    description: '+1 max health, healed to full.',
    rarity: 'common',
    maxStacks: 6,
    modifiers: [{ stat: 'maxHealth', op: 'add', value: 1 }],
  },
  {
    id: 'kinetic-plating',
    name: 'Kinetic Plating',
    description: 'Take 1 less damage per hit, -8% move speed.',
    rarity: 'epic',
    maxStacks: 2,
    minDepth: 3,
    modifiers: [
      { stat: 'armor', op: 'add', value: 1 },
      { stat: 'moveSpeed', op: 'mul', value: 0.92 },
    ],
  },
  {
    id: 'thrusters',
    name: 'Thrusters',
    description: '+12% move speed, -18% dash cooldown.',
    rarity: 'common',
    maxStacks: 4,
    modifiers: [
      { stat: 'moveSpeed', op: 'mul', value: 1.12 },
      { stat: 'dashCooldown', op: 'mul', value: 0.82 },
    ],
  },
  {
    id: 'phase-shift',
    name: 'Phase Shift',
    description: '+60% dash invulnerability.',
    rarity: 'rare',
    maxStacks: 3,
    modifiers: [{ stat: 'dashInvuln', op: 'mul', value: 1.6 }],
  },
  {
    id: 'siphon',
    name: 'Siphon',
    description: '12% chance to heal on kill.',
    rarity: 'rare',
    maxStacks: 4,
    modifiers: [{ stat: 'lifesteal', op: 'add', value: 0.12 }],
  },
  {
    id: 'orbital-blade',
    name: 'Orbital Blade',
    description: 'A blade orbits you, shredding what it touches.',
    rarity: 'rare',
    maxStacks: 4,
    modifiers: [{ stat: 'orbitals', op: 'add', value: 1 }],
  },
  {
    id: 'static-field',
    name: 'Static Field',
    description: 'Enemies that touch you take damage.',
    rarity: 'rare',
    maxStacks: 3,
    modifiers: [{ stat: 'thorns', op: 'add', value: 14 }],
  },

  // --- Economy ------------------------------------------------------------
  {
    id: 'trophy-hunter',
    name: 'Trophy Hunter',
    description: '+30% score from every source.',
    rarity: 'common',
    maxStacks: 4,
    modifiers: [{ stat: 'scoreMultiplier', op: 'mul', value: 1.3 }],
  },
  {
    id: 'glass-cannon',
    name: 'Glass Cannon',
    description: 'Double damage, but -2 max health.',
    rarity: 'epic',
    maxStacks: 1,
    minDepth: 2,
    modifiers: [
      { stat: 'damage', op: 'mul', value: 2 },
      { stat: 'maxHealth', op: 'add', value: -2 },
    ],
  },
];

const UPGRADES_BY_ID = new Map(UPGRADES.map((u) => [u.id, u]));

export function getUpgrade(id: string): UpgradeDef | undefined {
  return UPGRADES_BY_ID.get(id);
}

/** Expands a list of taken ids into the flat modifier list `applyModifiers` wants. */
export function modifiersFor(takenIds: readonly string[]): StatModifier[] {
  const modifiers: StatModifier[] = [];
  for (const id of takenIds) {
    const upgrade = UPGRADES_BY_ID.get(id);
    if (upgrade === undefined) continue; // ignore ids from an older build
    modifiers.push(...upgrade.modifiers);
  }
  return modifiers;
}

/**
 * Rolls the choices shown at a reward.
 *
 * Two rules matter more than the weights: options are always distinct (being
 * offered the same card three times feels broken), and anything already at max
 * stacks is excluded so late-run offers keep introducing something new.
 */
export function rollChoices(
  rng: Rng,
  taken: readonly string[],
  depth: number,
  count = 3,
  /** Nudges the roll toward rare/epic — used by treasure and boss rewards. */
  luck = 0,
): UpgradeDef[] {
  const stacks = new Map<string, number>();
  for (const id of taken) stacks.set(id, (stacks.get(id) ?? 0) + 1);

  const pool = UPGRADES.filter((upgrade) => {
    if ((upgrade.minDepth ?? 1) > depth) return false;
    return (stacks.get(upgrade.id) ?? 0) < upgrade.maxStacks;
  });

  const chosen: UpgradeDef[] = [];
  const remaining = [...pool];
  while (chosen.length < count && remaining.length > 0) {
    const pick = rng.pickWeighted(remaining, (upgrade) => {
      const base = RARITY_WEIGHT[upgrade.rarity];
      // Luck lifts the tail of the distribution without ever zeroing commons.
      return upgrade.rarity === 'common' ? base : base * (1 + luck);
    });
    chosen.push(pick);
    remaining.splice(remaining.indexOf(pick), 1);
  }
  return chosen;
}
