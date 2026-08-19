import type { Rng } from '@engine/rng';
import { ENEMIES, SCALING, type EnemyKind } from '@game/config';
import type { RoomType } from '@game/dungeon/types';

/**
 * Decides what fills a room.
 *
 * Rooms are populated against a difficulty **budget** rather than a flat count,
 * so a room can be "worth 6 points" and spend them on six grunts or on a brute
 * plus a turret. That decouples pacing (how hard is floor 4?) from composition
 * (what does this room throw at me?), and it means adding a new archetype is a
 * one-line cost entry rather than a rebalance of every spawn table.
 *
 * Weights shift with depth so early floors stay legible — grunts and shooters
 * teach the basics — and later floors bring in the archetypes that punish
 * standing still.
 */
export interface SpawnPlan {
  kinds: EnemyKind[];
  budget: number;
}

interface Weight {
  kind: EnemyKind;
  weight: number;
  /** Not offered before this floor. */
  minDepth: number;
}

const TABLE: readonly Weight[] = [
  { kind: 'grunt', weight: 10, minDepth: 1 },
  { kind: 'shooter', weight: 7, minDepth: 1 },
  { kind: 'bomber', weight: 5, minDepth: 2 },
  { kind: 'turret', weight: 4, minDepth: 2 },
  { kind: 'brute', weight: 3, minDepth: 3 },
];

export function budgetFor(depth: number, roomType: RoomType): number {
  const base = SCALING.budgetBase + SCALING.budgetPerDepth * (depth - 1);
  return roomType === 'elite' ? base * SCALING.eliteBudgetMultiplier : base;
}

/**
 * Spends the budget on enemies.
 *
 * Two guards matter: at least one enemy always spawns (an empty combat room
 * that instantly "clears" reads as a bug), and the loop is bounded so a
 * pathological weight table can never hang the frame.
 */
export function planSpawns(rng: Rng, depth: number, roomType: RoomType): SpawnPlan {
  const budget = budgetFor(depth, roomType);
  const available = TABLE.filter((entry) => entry.minDepth <= depth);
  const kinds: EnemyKind[] = [];

  let remaining = budget;
  let guard = 64;
  while (remaining > 0 && guard-- > 0) {
    const affordable = available.filter((entry) => ENEMIES[entry.kind].cost <= remaining);
    if (affordable.length === 0) break;

    const pick = rng.pickWeighted(affordable, (entry) => {
      // Elites lean on the expensive archetypes; normal rooms stay mixed.
      const cost = ENEMIES[entry.kind].cost;
      const eliteBias = roomType === 'elite' ? 1 + cost * 0.5 : 1;
      // Later floors gradually favour the pricier, more demanding enemies.
      const depthBias = 1 + (depth - entry.minDepth) * 0.12;
      return entry.weight * eliteBias * depthBias;
    });

    kinds.push(pick.kind);
    remaining -= ENEMIES[pick.kind].cost;
  }

  if (kinds.length === 0) kinds.push('grunt');
  return { kinds, budget };
}
