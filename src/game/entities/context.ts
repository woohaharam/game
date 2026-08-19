import type { Rng } from '@engine/rng';
import type { ParticleSystem } from '@engine/particles';
import type { AudioBus } from '@engine/audio';
import type { EnemyKind } from '@game/config';

/**
 * The slice of the world that AI code is allowed to touch.
 *
 * Enemies need to shoot, explode and hurt the player, but handing them the
 * whole `World` invites them to reach into rendering, run state or the scene
 * stack. Narrowing it to this interface keeps behaviour code honest, breaks
 * the import cycle between the world and its entities, and makes an enemy
 * testable against a stub instead of a full simulation.
 */
export interface CombatContext {
  readonly rng: Rng;
  readonly particles: ParticleSystem;
  readonly audio: AudioBus;

  /** Live player position; AI must not mutate it. */
  readonly playerX: number;
  readonly playerY: number;
  readonly playerRadius: number;
  readonly playerAlive: boolean;

  spawnEnemyBullet(
    x: number,
    y: number,
    angle: number,
    options?: { speed?: number; radius?: number; damage?: number; color?: string },
  ): void;

  explode(
    x: number,
    y: number,
    radius: number,
    damage: number,
    color: string,
    options?: { hurtsPlayer?: boolean; source?: unknown },
  ): void;

  damagePlayer(amount: number): void;

  addTrauma(amount: number): void;

  /** Blocks sight/movement. Doors count as solid while a room is locked down. */
  isSolidAt(x: number, y: number): boolean;

  hasLineOfSight(fromX: number, fromY: number, toX: number, toY: number): boolean;

  /** Used by the boss to call in reinforcements. */
  requestSpawn(kind: EnemyKind, x: number, y: number): void;

  playSfx(name: Parameters<AudioBus['play']>[0], pitch?: number, gain?: number): void;
}
