import { StateMachine, type State } from '@engine/fsm';
import { TAU, angleDelta, clamp, damp } from '@engine/math';
import { ENEMIES, ENEMY_BULLET, SCALING, type EnemyKind } from '@game/config';
import type { CombatContext } from './context';

/**
 * Enemy entity and its behaviour.
 *
 * Every archetype shares one entity struct and differs only in which state
 * machine drives it. That keeps the world's update loop uniform (no per-type
 * branching in the hot path) while behaviour stays readable as named states.
 *
 * The design rule behind every archetype: **telegraph, then commit**. An
 * attack the player could not have seen coming reads as unfair, and an attack
 * that tracks the player through its own wind-up makes dodging pointless. So
 * each aggressive state has a visible wind-up, and locks in its aim at the
 * moment it fires.
 */
export class Enemy {
  kind: EnemyKind = 'grunt';
  x = 0;
  y = 0;
  /** Previous position, for render interpolation. */
  px = 0;
  py = 0;
  vx = 0;
  vy = 0;
  radius = 12;
  health = 1;
  maxHealth = 1;
  speed = 100;
  contactDamage = 1;
  score = 10;
  color = '#fff';
  knockbackScale = 1;
  alive = false;

  /** Counts down while the enemy is materialising: no acting, no damage. */
  spawnTimer = 0;
  /** Flashes white for a moment after taking a hit. */
  hitFlash = 0;
  /** Facing/aim angle, also used for the sprite's rotation. */
  angle = 0;
  /** Visual spin, purely cosmetic. */
  spin = 0;

  /** Per-archetype scratch values; meaning depends on the active state. */
  private timer = 0;
  private burst = 0;
  private lockedAngle = 0;
  private phase = 0;

  private machine!: StateMachine<EnemyContext>;
  /** Rebuilt each spawn so a recycled enemy never inherits a stale state. */
  private context!: EnemyContext;

  spawn(kind: EnemyKind, x: number, y: number, depth: number): void {
    const stats = ENEMIES[kind];
    this.kind = kind;
    this.x = this.px = x;
    this.y = this.py = y;
    this.vx = 0;
    this.vy = 0;
    this.radius = stats.radius;

    const healthScale = 1 + SCALING.enemyHealthPerDepth * (depth - 1);
    const bossScale = kind === 'boss' ? 1 + SCALING.bossHealthPerDepth * (depth - 1) : 1;
    this.maxHealth = Math.round(stats.health * healthScale * bossScale);
    this.health = this.maxHealth;
    this.speed = stats.speed * (1 + SCALING.enemySpeedPerDepth * (depth - 1));
    this.contactDamage = stats.contactDamage;
    this.score = stats.score;
    this.color = stats.color;
    this.knockbackScale = stats.knockbackScale;

    this.alive = true;
    this.spawnTimer = 0;
    this.hitFlash = 0;
    this.timer = 0;
    this.burst = 0;
    this.phase = 0;
    this.angle = 0;
    this.spin = 0;

    this.context = { enemy: this, world: null as unknown as CombatContext };
    this.machine = createMachine(kind);
  }

  get isBoss(): boolean {
    return this.kind === 'boss';
  }

  /** Current boss phase (0-2); meaningless for other archetypes. */
  get bossPhase(): number {
    return this.phase;
  }

  applyKnockback(angle: number, force: number): void {
    this.vx += Math.cos(angle) * force * this.knockbackScale;
    this.vy += Math.sin(angle) * force * this.knockbackScale;
  }

  update(step: number, world: CombatContext): void {
    this.px = this.x;
    this.py = this.y;
    this.hitFlash = Math.max(0, this.hitFlash - step);
    this.spin += step * (this.kind === 'turret' ? 1.6 : 0.9);

    if (this.spawnTimer > 0) {
      this.spawnTimer -= step;
      return;
    }

    this.context.world = world;
    this.machine.update(this.context, step);

    // Velocity is integrated centrally so knockback, steering and dashes all
    // compose instead of each state writing straight to the position.
    this.x += this.vx * step;
    this.y += this.vy * step;

    // Friction is per-second so behaviour is identical at any tick rate.
    const friction = 0.86 ** (step * 60);
    this.vx *= friction;
    this.vy *= friction;
  }

  /** Exposed for the HUD and debug overlay. */
  get stateName(): string {
    return this.machine.current;
  }

  // -- helpers shared by the state implementations --------------------------

  /** @internal */
  steerToward(targetX: number, targetY: number, step: number, speedScale = 1): void {
    const dx = targetX - this.x;
    const dy = targetY - this.y;
    const distance = Math.hypot(dx, dy) || 1;
    const desiredX = (dx / distance) * this.speed * speedScale;
    const desiredY = (dy / distance) * this.speed * speedScale;
    this.vx = damp(this.vx, desiredX, 8, step);
    this.vy = damp(this.vy, desiredY, 8, step);
    this.angle = Math.atan2(dy, dx);
  }

  /** @internal Turns to face a point without moving. */
  faceToward(targetX: number, targetY: number, step: number, rate = 6): void {
    const target = Math.atan2(targetY - this.y, targetX - this.x);
    this.angle += angleDelta(this.angle, target) * clamp(step * rate, 0, 1);
  }

  /** @internal */
  distanceToPlayer(world: CombatContext): number {
    return Math.hypot(world.playerX - this.x, world.playerY - this.y);
  }

  /** @internal */
  angleToPlayer(world: CombatContext): number {
    return Math.atan2(world.playerY - this.y, world.playerX - this.x);
  }

  /** @internal */
  setTimer(value: number): void {
    this.timer = value;
  }

  /** @internal */
  tickTimer(step: number): boolean {
    this.timer -= step;
    return this.timer <= 0;
  }

  /** @internal */
  setBurst(value: number): void {
    this.burst = value;
  }

  /** @internal */
  takeBurst(): number {
    return this.burst--;
  }

  /** @internal */
  lockAim(angle: number): void {
    this.lockedAngle = angle;
  }

  /** @internal */
  get aim(): number {
    return this.lockedAngle;
  }

  /** @internal */
  setPhase(value: number): void {
    this.phase = value;
  }
}

interface EnemyContext {
  enemy: Enemy;
  world: CombatContext;
}

// ---------------------------------------------------------------------------
// Archetype behaviours
// ---------------------------------------------------------------------------

/** Wanders when the player is far, closes in and swarms when near. */
const gruntStates: Array<State<EnemyContext>> = [
  {
    name: 'chase',
    update({ enemy, world }, step) {
      if (!world.playerAlive) return 'idle';
      enemy.steerToward(world.playerX, world.playerY, step);
      return null;
    },
  },
  {
    name: 'idle',
    update({ enemy, world }, step) {
      enemy.vx = damp(enemy.vx, 0, 6, step);
      enemy.vy = damp(enemy.vy, 0, 6, step);
      return world.playerAlive ? 'chase' : null;
    },
  },
];

/**
 * Ranged. Holds a preferred band around the player — backs off when crowded,
 * closes when the player runs — then telegraphs before each burst.
 */
const SHOOTER_RANGE = 240;
const shooterStates: Array<State<EnemyContext>> = [
  {
    name: 'reposition',
    enter({ enemy }) {
      enemy.setTimer(0.7 + Math.random() * 0.5);
    },
    update({ enemy, world }, step) {
      const distance = enemy.distanceToPlayer(world);
      const angle = enemy.angleToPlayer(world);
      // Strafe rather than beeline, so shooters do not stack into one point.
      const strafe = Math.sin(enemy.spin * 1.4) * 0.6;
      if (distance > SHOOTER_RANGE * 1.15) {
        enemy.steerToward(world.playerX, world.playerY, step, 1);
      } else if (distance < SHOOTER_RANGE * 0.7) {
        enemy.steerToward(
          enemy.x - Math.cos(angle) * 100,
          enemy.y - Math.sin(angle) * 100,
          step,
          1,
        );
      } else {
        enemy.steerToward(
          enemy.x + Math.cos(angle + Math.PI / 2) * 100 * strafe,
          enemy.y + Math.sin(angle + Math.PI / 2) * 100 * strafe,
          step,
          0.6,
        );
      }
      enemy.faceToward(world.playerX, world.playerY, step, 8);

      if (!enemy.tickTimer(step)) return null;
      if (!world.playerAlive) return null;
      if (!world.hasLineOfSight(enemy.x, enemy.y, world.playerX, world.playerY)) return null;
      return 'aim';
    },
  },
  {
    name: 'aim',
    enter({ enemy }) {
      enemy.setTimer(0.42);
    },
    update({ enemy, world }, step) {
      enemy.vx = damp(enemy.vx, 0, 10, step);
      enemy.vy = damp(enemy.vy, 0, 10, step);
      enemy.faceToward(world.playerX, world.playerY, step, 10);
      return enemy.tickTimer(step) ? 'fire' : null;
    },
  },
  {
    name: 'fire',
    enter({ enemy, world }) {
      enemy.setBurst(3);
      enemy.setTimer(0);
      // Aim is locked at the start of the burst: the player can sidestep the
      // whole volley by moving after the telegraph, which is the point.
      enemy.lockAim(enemy.angleToPlayer(world));
    },
    update({ enemy, world }, step) {
      if (!enemy.tickTimer(step)) return null;
      if (enemy.takeBurst() <= 0) return 'reposition';
      enemy.setTimer(0.13);
      world.spawnEnemyBullet(enemy.x, enemy.y, enemy.aim);
      world.playSfx('enemyShoot', 1 + (Math.random() - 0.5) * 0.1);
      return null;
    },
  },
];

/** Suicide charger: rushes, then fuses loudly before detonating. */
const bomberStates: Array<State<EnemyContext>> = [
  {
    name: 'approach',
    update({ enemy, world }, step) {
      enemy.steerToward(world.playerX, world.playerY, step, 1);
      if (!world.playerAlive) return null;
      return enemy.distanceToPlayer(world) < 64 ? 'fuse' : null;
    },
  },
  {
    name: 'fuse',
    enter({ enemy, world }) {
      enemy.setTimer(0.62);
      world.playSfx('enemyShoot', 0.6);
    },
    update({ enemy, world }, step) {
      // Keeps drifting during the fuse so a standing player still gets hit,
      // but slowly enough that walking away works.
      enemy.steerToward(world.playerX, world.playerY, step, 0.35);
      if (!enemy.tickTimer(step)) return null;
      enemy.health = 0; // detonation is death; the world handles the cleanup
      world.explode(enemy.x, enemy.y, 78, 1, enemy.color, { source: enemy });
      return null;
    },
  },
];

/** Static emplacement that alternates aimed bursts with spiral sweeps. */
const turretStates: Array<State<EnemyContext>> = [
  {
    name: 'charge',
    enter({ enemy }) {
      enemy.setTimer(1.5);
    },
    update({ enemy }, step) {
      enemy.vx = 0;
      enemy.vy = 0;
      return enemy.tickTimer(step) ? 'sweep' : null;
    },
  },
  {
    name: 'sweep',
    enter({ enemy, world }) {
      enemy.setBurst(8);
      enemy.setTimer(0);
      enemy.lockAim(enemy.angleToPlayer(world));
    },
    update({ enemy, world }, step) {
      if (!enemy.tickTimer(step)) return null;
      const shot = enemy.takeBurst();
      if (shot <= 0) return 'charge';
      enemy.setTimer(0.1);
      // Two opposing arms rotating together: dense enough to matter, sparse
      // enough that there is always a gap to dash through.
      const base = enemy.aim + (8 - shot) * 0.34;
      world.spawnEnemyBullet(enemy.x, enemy.y, base, { speed: 190 });
      world.spawnEnemyBullet(enemy.x, enemy.y, base + Math.PI, { speed: 190 });
      world.playSfx('enemyShoot', 1.25, 0.6);
      return null;
    },
  },
];

/** Elite bruiser: slow pursuit punctuated by a committed, dodgeable charge. */
const bruteStates: Array<State<EnemyContext>> = [
  {
    name: 'stalk',
    enter({ enemy }) {
      enemy.setTimer(1.1);
    },
    update({ enemy, world }, step) {
      enemy.steerToward(world.playerX, world.playerY, step, 0.75);
      if (!enemy.tickTimer(step)) return null;
      return enemy.distanceToPlayer(world) < 300 ? 'windup' : null;
    },
  },
  {
    name: 'windup',
    enter({ enemy, world }) {
      enemy.setTimer(0.55);
      world.playSfx('enemyShoot', 0.5);
    },
    update({ enemy, world }, step) {
      enemy.vx = damp(enemy.vx, 0, 12, step);
      enemy.vy = damp(enemy.vy, 0, 12, step);
      enemy.faceToward(world.playerX, world.playerY, step, 5);
      if (!enemy.tickTimer(step)) return null;
      enemy.lockAim(enemy.angleToPlayer(world));
      return 'charge';
    },
  },
  {
    name: 'charge',
    enter({ enemy }) {
      enemy.setTimer(0.42);
      // Fired once on entry: the charge is ballistic, so sidestepping works.
      enemy.vx = Math.cos(enemy.aim) * 560;
      enemy.vy = Math.sin(enemy.aim) * 560;
    },
    update({ enemy, world }, step) {
      world.particles.emit(
        enemy.x, enemy.y,
        -enemy.vx * 0.2, -enemy.vy * 0.2,
        enemy.color, 0.3, 5, 'spark',
      );
      return enemy.tickTimer(step) ? 'recover' : null;
    },
  },
  {
    name: 'recover',
    enter({ enemy }) {
      enemy.setTimer(0.75);
    },
    update({ enemy }, step) {
      enemy.vx = damp(enemy.vx, 0, 5, step);
      enemy.vy = damp(enemy.vy, 0, 5, step);
      return enemy.tickTimer(step) ? 'stalk' : null;
    },
  },
];

/**
 * Boss.
 *
 * Three phases gated on health, each adding a pattern rather than replacing
 * one, so the fight escalates in a way the player can feel and learn. Attack
 * selection is a weighted roll biased by distance — the boss charges when you
 * are far and sprays when you are close, which stops "hug the boss" and "run
 * away forever" from both being free wins.
 */
const bossStates: Array<State<EnemyContext>> = [
  {
    name: 'idle',
    enter({ enemy }) {
      enemy.setTimer(0.9 - enemy.bossPhase * 0.22);
    },
    update({ enemy, world }, step) {
      const health = enemy.health / enemy.maxHealth;
      const phase = health < 0.33 ? 2 : health < 0.66 ? 1 : 0;
      if (phase !== enemy.bossPhase) {
        enemy.setPhase(phase);
        return 'enrage';
      }

      // Drifts toward a mid-range hover distance rather than body-blocking.
      const distance = enemy.distanceToPlayer(world);
      const angle = enemy.angleToPlayer(world);
      const target = 220;
      const sign = distance > target ? 1 : -1;
      enemy.steerToward(
        enemy.x + Math.cos(angle) * 120 * sign,
        enemy.y + Math.sin(angle) * 120 * sign,
        step,
        0.7,
      );
      enemy.faceToward(world.playerX, world.playerY, step, 3);

      if (!enemy.tickTimer(step)) return null;

      const far = distance > 260;
      return world.rng.pickWeighted(
        ['spiral', 'shotgun', 'dash', 'summon'] as const,
        (attack) => {
          switch (attack) {
            case 'spiral':
              return 3;
            case 'shotgun':
              return far ? 1 : 4;
            case 'dash':
              return far ? 4 : 1;
            case 'summon':
              return enemy.bossPhase >= 1 ? 2 : 0;
          }
        },
      );
    },
  },
  {
    name: 'enrage',
    enter({ enemy, world }) {
      enemy.setTimer(0.8);
      world.playSfx('bossSpawn', 1 + enemy.bossPhase * 0.15);
      world.addTrauma(0.5);
      world.particles.burst(enemy.x, enemy.y, {
        count: 90,
        color: enemy.color,
        speed: [120, 460],
        life: [0.4, 0.9],
        size: [2, 6],
        shape: 'spark',
      });
    },
    update({ enemy }, step) {
      enemy.vx = damp(enemy.vx, 0, 8, step);
      enemy.vy = damp(enemy.vy, 0, 8, step);
      return enemy.tickTimer(step) ? 'idle' : null;
    },
  },
  {
    name: 'spiral',
    enter({ enemy, world }) {
      enemy.setBurst(18 + enemy.bossPhase * 8);
      enemy.setTimer(0);
      enemy.lockAim(world.rng.angle());
    },
    update({ enemy, world }, step) {
      enemy.vx = damp(enemy.vx, 0, 6, step);
      enemy.vy = damp(enemy.vy, 0, 6, step);
      if (!enemy.tickTimer(step)) return null;
      const shot = enemy.takeBurst();
      if (shot <= 0) return 'idle';
      enemy.setTimer(0.075);

      const arms = 2 + enemy.bossPhase;
      const angle = enemy.aim + shot * 0.42;
      for (let i = 0; i < arms; i++) {
        world.spawnEnemyBullet(enemy.x, enemy.y, angle + (i / arms) * TAU, { speed: 205 });
      }
      world.playSfx('enemyShoot', 0.9, 0.45);
      return null;
    },
  },
  {
    name: 'shotgun',
    enter({ enemy, world }) {
      enemy.setTimer(0.45);
      enemy.lockAim(enemy.angleToPlayer(world));
      world.playSfx('enemyShoot', 0.45);
    },
    update({ enemy, world }, step) {
      enemy.vx = damp(enemy.vx, 0, 10, step);
      enemy.vy = damp(enemy.vy, 0, 10, step);
      if (!enemy.tickTimer(step)) return null;
      const pellets = 7 + enemy.bossPhase * 3;
      for (let i = 0; i < pellets; i++) {
        const spread = (i / (pellets - 1) - 0.5) * 0.85;
        world.spawnEnemyBullet(enemy.x, enemy.y, enemy.aim + spread, { speed: 270 });
      }
      world.addTrauma(0.2);
      return 'idle';
    },
  },
  {
    name: 'dash',
    enter({ enemy, world }) {
      enemy.setTimer(0.5);
      enemy.lockAim(enemy.angleToPlayer(world));
      world.playSfx('dash', 0.5);
    },
    update({ enemy, world }, step, timeInState) {
      // 0.5s wind-up in place, then a fixed-direction lunge.
      if (timeInState < 0.5) {
        enemy.vx = damp(enemy.vx, 0, 14, step);
        enemy.vy = damp(enemy.vy, 0, 14, step);
        enemy.faceToward(world.playerX, world.playerY, step, 4);
        return null;
      }
      if (enemy.tickTimer(step)) {
        enemy.setTimer(0.55);
        enemy.vx = Math.cos(enemy.aim) * 720;
        enemy.vy = Math.sin(enemy.aim) * 720;
        world.addTrauma(0.25);
      }
      world.particles.emit(
        enemy.x, enemy.y,
        -enemy.vx * 0.15, -enemy.vy * 0.15,
        enemy.color, 0.35, 8, 'spark',
      );
      return timeInState > 1.25 ? 'idle' : null;
    },
  },
  {
    name: 'summon',
    enter({ enemy, world }) {
      enemy.setTimer(0.6);
      world.playSfx('bossSpawn', 1.4, 0.5);
    },
    update({ enemy, world }, step) {
      enemy.vx = damp(enemy.vx, 0, 8, step);
      enemy.vy = damp(enemy.vy, 0, 8, step);
      if (!enemy.tickTimer(step)) return null;
      const count = 2 + enemy.bossPhase;
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * TAU + world.rng.angle();
        const distance = 90;
        world.requestSpawn(
          world.rng.chance(0.35) ? 'bomber' : 'grunt',
          enemy.x + Math.cos(angle) * distance,
          enemy.y + Math.sin(angle) * distance,
        );
      }
      return 'idle';
    },
  },
];

const MACHINES: Record<EnemyKind, { states: Array<State<EnemyContext>>; initial: string }> = {
  grunt: { states: gruntStates, initial: 'chase' },
  shooter: { states: shooterStates, initial: 'reposition' },
  bomber: { states: bomberStates, initial: 'approach' },
  turret: { states: turretStates, initial: 'charge' },
  brute: { states: bruteStates, initial: 'stalk' },
  boss: { states: bossStates, initial: 'idle' },
};

function createMachine(kind: EnemyKind): StateMachine<EnemyContext> {
  const definition = MACHINES[kind];
  return new StateMachine<EnemyContext>(definition.states, definition.initial);
}

/** Default enemy bullet options, exported so the world stays the single source. */
export const DEFAULT_ENEMY_BULLET = ENEMY_BULLET;
