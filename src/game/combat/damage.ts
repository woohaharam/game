import type { Rng } from '@engine/rng';
import type { PlayerStats } from '@game/progression/stats';

/**
 * Damage resolution.
 *
 * Isolated as a pure function on purpose: it is the one calculation players
 * will argue about, so it needs to be readable at a glance and testable
 * without spinning up a world. Randomness enters only through the injected
 * `Rng`, so a damage roll is reproducible from a seed like everything else.
 */
export interface DamageResult {
  amount: number;
  critical: boolean;
}

export function rollDamage(
  stats: PlayerStats,
  rng: Rng,
  /** Per-source scaling, e.g. explosions deal a fraction of the hit. */
  multiplier = 1,
): DamageResult {
  const critical = rng.chance(stats.critChance);
  const raw = stats.damage * multiplier * (critical ? stats.critMultiplier : 1);
  // Round up so a heavily-diluted multishot build never rounds a hit to zero.
  return { amount: Math.max(1, Math.ceil(raw)), critical };
}

/**
 * Damage taken by the player. Armour is flat and applied last, but can never
 * reduce a hit to nothing — otherwise stacking it turns off the game.
 */
export function resolvePlayerDamage(incoming: number, armor: number): number {
  return Math.max(1, Math.round(incoming - armor));
}

/**
 * Falloff for explosions: full damage at the centre, tapering to 25% at the
 * rim. A flat blast makes positioning irrelevant; zero at the rim makes the
 * radius feel like it is lying to you.
 */
export function explosionFalloff(distance: number, radius: number): number {
  if (distance >= radius) return 0;
  const t = 1 - distance / radius;
  return 0.25 + 0.75 * t;
}
