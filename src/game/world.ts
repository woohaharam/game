import { Rng } from '@engine/rng';
import { Pool } from '@engine/pool';
import { SpatialHash } from '@engine/spatial-hash';
import { ParticleSystem } from '@engine/particles';
import type { AudioBus, SfxName } from '@engine/audio';
import type { Camera } from '@engine/camera';
import {
  TAU,
  angleDelta,
  circlesOverlap,
  clamp,
  decayPerStep,
  length,
  type Vec2,
} from '@engine/math';

import { ENEMY_BULLET, FEEL, PICKUP, ROOM, SCORE, type EnemyKind } from '@game/config';
import { generateDungeon } from '@game/dungeon/generator';
import {
  TILE_SIZE,
  Tile,
  roomAtPosition,
  roomBounds,
  roomCenter,
  type Dungeon,
  type Room,
  type TileId,
} from '@game/dungeon/types';
import {
  hasLineOfSight,
  isSolidAt,
  resolveCircle,
  type CollisionResult,
} from '@game/collision';
import { Enemy } from '@game/entities/enemy';
import { Player } from '@game/entities/player';
import type { CombatContext } from '@game/entities/context';
import {
  createEnemyBullet,
  createFloatingText,
  createPickup,
  createProjectile,
  resetProjectile,
  type EnemyBullet,
  type FloatingText,
  type Pickup,
  type PickupKind,
  type Projectile,
} from '@game/entities/projectiles';
import { explosionFalloff, resolvePlayerDamage, rollDamage } from '@game/combat/damage';
import { planSpawns } from '@game/spawn-director';
import { RunState } from '@game/run-state';
import { rollChoices, type UpgradeDef } from '@game/progression/upgrades';

/**
 * The simulation.
 *
 * Owns the dungeon, every entity and all the rules that connect them; knows
 * nothing about scenes, menus or the DOM. That split is deliberate — the world
 * advances by `update(step)` alone, so it can be stepped headlessly in a test
 * or a balance sweep without a canvas anywhere in sight.
 *
 * It implements `CombatContext`, which is the narrow view enemy AI is given.
 *
 * Ordering inside a tick is fixed and matters:
 *   input → player → enemies → projectiles → collisions → pickups → room rules
 * Resolving collisions after everything has moved is what stops the classic
 * "the bullet that killed me had already been destroyed" class of bug.
 */

export type RoomPhase = 'idle' | 'spawning' | 'combat' | 'cleared';

/**
 * One tick of player will, expressed in terms the simulation cares about.
 *
 * Aim is an **angle**, not a screen point. The simulation only ever needed the
 * direction — a cursor position had to be converted to one anyway — and an
 * angle is the same shape whether it came from a mouse, a thumbstick or a
 * recorded replay. It is also finitely quantisable, which is what lets a run be
 * recorded and replayed bit-for-bit.
 */
export interface PlayerIntent {
  move: Vec2;
  /** Aim direction in radians. */
  aimAngle: number;
  firing: boolean;
  dashPressed: boolean;
}

/**
 * How far ahead of the player the camera leans, in the aim direction. Constant
 * rather than proportional to cursor distance, so the framing is identical for
 * a mouse held just off the ship and one parked at the edge of the room.
 */
const CAMERA_LEAD = 96;

export interface Pedestal {
  x: number;
  y: number;
  /** `reward` is free; `shop` costs coins. */
  kind: 'reward' | 'shop';
  upgrade: UpgradeDef;
  price: number;
  taken: boolean;
  /** Cosmetic bob offset. */
  phase: number;
}

export interface WorldEvents {
  onRoomCleared?(room: Room): void;
  onFloorCleared?(): void;
  onPlayerDied?(): void;
  onUpgradeTaken?(upgrade: UpgradeDef): void;
  onBossSpawned?(boss: Enemy): void;
}

const MAX_PROJECTILES = 512;
const MAX_ENEMY_BULLETS = 900;
const MAX_ENEMIES = 96;
const MAX_PICKUPS = 128;
const MAX_TEXTS = 96;

export class World implements CombatContext {
  readonly rng: Rng;
  /** Separate stream for cosmetics, so VFX never shift gameplay rolls. */
  private readonly cosmeticRng: Rng;
  readonly particles: ParticleSystem;
  readonly run = new RunState();

  dungeon!: Dungeon;
  readonly player = new Player();
  readonly enemies: Enemy[] = [];
  readonly pedestals: Pedestal[] = [];

  readonly projectiles: Pool<Projectile>;
  readonly enemyBullets: Pool<EnemyBullet>;
  readonly pickups: Pool<Pickup>;
  readonly texts: Pool<FloatingText>;

  private readonly enemyHash = new SpatialHash<Enemy>(48);
  /** Reused broadphase result buffer; never escapes the method that fills it. */
  private readonly candidates: Enemy[] = [];
  private readonly collision: CollisionResult = { x: 0, y: 0, hitX: false, hitY: false };

  /** Index of the room the player is standing in. */
  currentRoom = 0;
  roomPhase: RoomPhase = 'idle';
  private roomTimer = 0;
  private pendingSpawns: EnemyKind[] = [];
  doorsLocked = false;

  /** Set once the boss dies; touching it descends to the next floor. */
  exitPortal: { x: number; y: number; active: boolean } = { x: 0, y: 0, active: false };

  /** Frozen while an overlay (upgrade choice, pause) is open. */
  paused = false;
  /** Global time multiplier: hit-stop and the on-death slow motion. */
  timeScale = 1;
  private hitStop = 0;
  private slowMo = 0;

  events: WorldEvents = {};

  constructor(
    seed: number,
    private readonly audioBus: AudioBus,
    private readonly camera: Camera,
  ) {
    this.rng = new Rng(seed);
    this.cosmeticRng = new Rng(seed ^ 0x5f3759df);
    this.particles = new ParticleSystem(this.cosmeticRng);

    this.projectiles = new Pool(createProjectile, resetProjectile, MAX_PROJECTILES);
    this.enemyBullets = new Pool(
      createEnemyBullet,
      (b) => {
        b.life = 0;
      },
      MAX_ENEMY_BULLETS,
    );
    this.pickups = new Pool(
      createPickup,
      (p) => {
        p.life = 0;
        p.delay = 0;
      },
      MAX_PICKUPS,
    );
    this.texts = new Pool(
      createFloatingText,
      (t) => {
        t.life = 0;
      },
      MAX_TEXTS,
    );

    for (let i = 0; i < MAX_ENEMIES; i++) this.enemies.push(new Enemy());
  }

  // -- CombatContext ---------------------------------------------------------

  get audio(): AudioBus {
    return this.audioBus;
  }

  get playerX(): number {
    return this.player.x;
  }

  get playerY(): number {
    return this.player.y;
  }

  get playerRadius(): number {
    return this.player.radius;
  }

  get playerAlive(): boolean {
    return this.player.alive;
  }

  playSfx(name: SfxName, pitch = 1, gain = 1): void {
    this.audioBus.play(name, pitch, gain);
  }

  addTrauma(amount: number): void {
    this.camera.addTrauma(amount);
  }

  isSolidAt(x: number, y: number): boolean {
    return isSolidAt(this.dungeon, x, y, this.doorsLocked);
  }

  hasLineOfSight(fromX: number, fromY: number, toX: number, toY: number): boolean {
    return hasLineOfSight(this.dungeon, fromX, fromY, toX, toY);
  }

  // -- lifecycle -------------------------------------------------------------

  /** Builds a floor and drops the player in the start room. */
  startFloor(depth: number): void {
    // Derive each floor's seed from the run seed so the whole run replays from
    // one number, rather than each floor being independently random.
    const floorSeed = (this.run.seed + depth * 0x9e3779b1) >>> 0;
    this.dungeon = generateDungeon({ seed: floorSeed, depth });
    this.run.depth = depth;

    for (const enemy of this.enemies) enemy.alive = false;
    this.projectiles.clear();
    this.enemyBullets.clear();
    this.pickups.clear();
    this.texts.clear();
    this.particles.clear();
    this.pedestals.length = 0;
    this.exitPortal.active = false;
    this.doorsLocked = false;
    this.roomPhase = 'idle';
    this.roomTimer = 0;

    const start = this.dungeon.rooms[this.dungeon.startRoom];
    // The generator guarantees a start room; if that ever stops holding, fail
    // loudly here rather than dropping the player into undefined geometry.
    if (start === undefined) throw new Error('Generated dungeon has no start room');
    const centre = roomCenter(start);
    this.player.reset(centre.x, centre.y, this.run.stats);
    start.visited = true;
    this.currentRoom = start.index;
    this.camera.snapTo(centre.x, centre.y);
    this.updateCameraBounds(start);

    this.populatePedestals();
  }

  /** Fresh run: new seed, cleared upgrades, floor 1. */
  startRun(seed: number): void {
    this.run.reset(seed);
    this.startFloor(1);
  }

  private populatePedestals(): void {
    for (const room of this.dungeon.rooms) {
      const centre = roomCenter(room);
      if (room.type === 'treasure') {
        const [choice] = rollChoices(this.rng, this.run.upgrades, this.run.depth, 1, 1.4);
        if (choice === undefined) continue;
        this.pedestals.push({
          x: centre.x,
          y: centre.y,
          kind: 'reward',
          upgrade: choice,
          price: 0,
          taken: false,
          phase: this.cosmeticRng.angle(),
        });
      } else if (room.type === 'shop') {
        const stock = rollChoices(this.rng, this.run.upgrades, this.run.depth, 3, 0.4);
        stock.forEach((upgrade, index) => {
          const offset = (index - (stock.length - 1) / 2) * TILE_SIZE * 3;
          this.pedestals.push({
            x: centre.x + offset,
            y: centre.y,
            kind: 'shop',
            upgrade,
            price: priceFor(upgrade, this.run.depth),
            taken: false,
            phase: this.cosmeticRng.angle(),
          });
        });
      }
    }
  }

  private updateCameraBounds(room: Room): void {
    const bounds = roomBounds(room);
    // A one-tile margin lets the walls stay on screen rather than being
    // clipped exactly at the floor edge.
    this.camera.bounds = {
      x: bounds.x - TILE_SIZE,
      y: bounds.y - TILE_SIZE,
      width: bounds.width + TILE_SIZE * 2,
      height: bounds.height + TILE_SIZE * 2,
    };
  }

  // -- main tick -------------------------------------------------------------

  update(rawStep: number, intent: PlayerIntent): void {
    if (this.paused) return;

    // Hit-stop freezes the simulation outright for a few dozen milliseconds.
    // It is the single cheapest way to make a hit feel like it connected.
    if (this.hitStop > 0) {
      this.hitStop -= rawStep;
      this.particles.update(rawStep * 0.15);
      return;
    }

    if (this.slowMo > 0) {
      this.slowMo -= rawStep;
      this.timeScale = FEEL.slowMoScale;
    } else {
      this.timeScale = 1;
    }

    const step = rawStep * this.timeScale;
    this.run.tick(step);

    this.updatePlayer(step, intent);
    this.rebuildEnemyHash();
    this.updateEnemies(step);
    this.updateProjectiles(step);
    this.updateEnemyBullets(step);
    this.updatePickups(step);
    this.updatePedestals(step);
    this.updateTexts(step);
    this.particles.update(step);
    this.updateRoom(step);

    // Lead the camera toward where the player is aiming, so they can see what
    // they are shooting at without it drifting off the ship entirely.
    this.camera.follow(
      this.player.x + Math.cos(intent.aimAngle) * CAMERA_LEAD,
      this.player.y + Math.sin(intent.aimAngle) * CAMERA_LEAD,
      step,
    );
    this.camera.update(rawStep);
  }

  private updatePlayer(step: number, intent: PlayerIntent): void {
    const player = this.player;
    if (!player.alive) return;

    player.aimAngle = intent.aimAngle;
    if (intent.dashPressed) player.requestDash();
    if (intent.firing) player.requestFire();

    // Sampled either side of the update so the dash's start edge is detected
    // once. Read into two separate consts: comparing a const against the live
    // getter makes TypeScript treat the getter as an alias of the snapshot and
    // narrow the check away.
    const wasDashing = player.isDashing;
    player.update(step, intent.move, this.run.stats);
    const isDashing = player.isDashing;
    if (!wasDashing && isDashing) this.onDashStarted();

    resolveCircle(
      this.dungeon,
      player.x,
      player.y,
      player.radius,
      this.doorsLocked,
      this.collision,
    );
    player.x = this.collision.x;
    player.y = this.collision.y;
    // Kill the velocity component that ran into the wall, so the player slides
    // along it instead of vibrating against it.
    if (this.collision.hitX) player.vx = 0;
    if (this.collision.hitY) player.vy = 0;

    if (player.isDashing) {
      this.particles.emit(
        player.x,
        player.y,
        -player.vx * 0.12,
        -player.vy * 0.12,
        '#6ef2ff',
        0.25,
        5,
        'spark',
      );
    }

    if (player.consumeFire(intent.firing, this.run.stats)) this.fireVolley();
    this.updateOrbitals(step);
  }

  private onDashStarted(): void {
    this.playSfx('dash', this.cosmeticRng.float(0.95, 1.08));
    this.particles.burst(this.player.x, this.player.y, {
      count: 16,
      color: '#6ef2ff',
      speed: [60, 220],
      life: [0.15, 0.35],
      size: [2, 4],
      direction: this.player.dashAngle + Math.PI,
      spread: 1.2,
    });
  }

  private fireVolley(): void {
    const stats = this.run.stats;
    this.emitVolley();
    if (stats.doubleShotChance > 0 && this.rng.chance(stats.doubleShotChance)) {
      this.emitVolley();
    }
    this.playSfx('shoot', this.cosmeticRng.float(0.94, 1.06), 0.9);
    this.camera.addTrauma(0.035);
    this.player.applyImpulse(this.player.aimAngle + Math.PI, 22);
  }

  private emitVolley(): void {
    const stats = this.run.stats;
    const count = stats.projectiles;
    for (let i = 0; i < count; i++) {
      const acquired = this.projectiles.acquire();
      if (acquired === null) return;
      const bullet = acquired.item;

      // Spread is distributed evenly across the volley and then jittered, so a
      // wide multishot still covers its cone instead of clumping.
      const offset = count === 1 ? 0 : (i / (count - 1) - 0.5) * 2;
      const angle =
        this.player.aimAngle +
        offset * stats.spread * count * 0.5 +
        this.rng.float(-stats.spread, stats.spread) * 0.5;

      const roll = rollDamage(stats, this.rng);
      const muzzle = this.player.radius + 6;
      bullet.x = bullet.px = this.player.x + Math.cos(angle) * muzzle;
      bullet.y = bullet.py = this.player.y + Math.sin(angle) * muzzle;
      bullet.vx = Math.cos(angle) * stats.projectileSpeed;
      bullet.vy = Math.sin(angle) * stats.projectileSpeed;
      bullet.radius = 4;
      bullet.damage = roll.amount;
      bullet.critical = roll.critical;
      bullet.life = stats.projectileLife;
      bullet.pierce = stats.pierce;
      bullet.explosionRadius = stats.explosionRadius;
      bullet.homing = stats.homing;
      bullet.knockback = stats.knockback;
      bullet.hits.clear();
    }
  }

  /** Orbiting blades: pure contact damage on a cooldown-free spin. */
  private updateOrbitals(step: number): void {
    const count = this.run.stats.orbitals;
    if (count <= 0 || !this.player.alive) return;

    const radius = 58;
    for (let i = 0; i < count; i++) {
      const angle = this.player.orbitAngle + (i / count) * TAU;
      const x = this.player.x + Math.cos(angle) * radius;
      const y = this.player.y + Math.sin(angle) * radius;
      this.enemyHash.query(x, y, 14, (enemy) => {
        if (!enemy.alive || enemy.spawnTimer > 0) return;
        if (!circlesOverlap(x, y, 13, enemy.x, enemy.y, enemy.radius)) return;
        // Scaled by step so damage-per-second is frame-rate independent.
        this.damageEnemy(enemy, this.run.stats.damage * 3 * step, {
          angle,
          feedback: false,
        });
      });
      if (this.cosmeticRng.chance(0.25)) {
        this.particles.emit(x, y, 0, 0, '#9dffcf', 0.2, 3);
      }
    }
  }

  private rebuildEnemyHash(): void {
    this.enemyHash.clear();
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      this.enemyHash.insert(enemy, enemy.x, enemy.y, enemy.radius);
    }
  }

  private updateEnemies(step: number): void {
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;

      enemy.update(step, this);

      if (enemy.spawnTimer <= 0) {
        this.separateEnemy(enemy, step);

        resolveCircle(
          this.dungeon,
          enemy.x,
          enemy.y,
          enemy.radius,
          this.doorsLocked,
          this.collision,
        );
        enemy.x = this.collision.x;
        enemy.y = this.collision.y;
        if (this.collision.hitX) enemy.vx *= -0.3;
        if (this.collision.hitY) enemy.vy *= -0.3;

        this.resolveContactDamage(enemy);
      }

      // Bombers set their own health to 0 when they detonate.
      if (enemy.health <= 0) this.killEnemy(enemy, false);
    }
  }

  /**
   * Soft separation so a pack of chasers spreads into a ring around the player
   * instead of collapsing into a single overlapping blob. Cheap, local, and
   * far more legible than a full steering-behaviour stack.
   */
  private separateEnemy(enemy: Enemy, step: number): void {
    const range = enemy.radius * 2;
    this.enemyHash.query(enemy.x, enemy.y, range, (other) => {
      if (other === enemy || !other.alive || other.spawnTimer > 0) return;
      const dx = enemy.x - other.x;
      const dy = enemy.y - other.y;
      const minDistance = enemy.radius + other.radius;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq >= minDistance * minDistance || distanceSq < 1e-4) return;

      const distance = Math.sqrt(distanceSq);
      // Immovable enemies (turrets) push others without being pushed back.
      if (enemy.knockbackScale <= 0) return;
      const push = (minDistance - distance) / minDistance;
      const force = 900;
      enemy.vx += (dx / distance) * push * force * step;
      enemy.vy += (dy / distance) * push * force * step;
    });
  }

  private resolveContactDamage(enemy: Enemy): void {
    if (enemy.contactDamage <= 0 || !this.player.alive) return;
    if (
      !circlesOverlap(
        enemy.x,
        enemy.y,
        enemy.radius,
        this.player.x,
        this.player.y,
        this.player.radius,
      )
    )
      return;

    this.damagePlayer(enemy.contactDamage);

    const thorns = this.run.stats.thorns;
    if (thorns > 0) {
      this.damageEnemy(enemy, thorns, {
        angle: Math.atan2(enemy.y - this.player.y, enemy.x - this.player.x),
        knockback: 220,
      });
    }
  }

  private updateProjectiles(step: number): void {
    this.projectiles.forEach((bullet, index) => {
      bullet.px = bullet.x;
      bullet.py = bullet.y;
      bullet.life -= step;
      if (bullet.life <= 0) {
        this.projectiles.release(index);
        return;
      }

      if (bullet.homing > 0) this.steerProjectile(bullet, step);

      bullet.x += bullet.vx * step;
      bullet.y += bullet.vy * step;

      if (isSolidAt(this.dungeon, bullet.x, bullet.y, this.doorsLocked)) {
        this.onProjectileExpired(bullet);
        this.projectiles.release(index);
        return;
      }

      let consumed = false;
      const candidates = this.enemyHash.collectInto(
        this.candidates,
        bullet.x,
        bullet.y,
        bullet.radius + 24,
      );

      for (const enemy of candidates) {
        if (!enemy.alive || enemy.spawnTimer > 0) continue;
        if (bullet.hits.has(enemy)) continue;
        if (!circlesOverlap(bullet.x, bullet.y, bullet.radius, enemy.x, enemy.y, enemy.radius))
          continue;

        const angle = Math.atan2(bullet.vy, bullet.vx);
        this.damageEnemy(enemy, bullet.damage, {
          critical: bullet.critical,
          angle,
          knockback: bullet.knockback,
        });
        bullet.hits.add(enemy);

        if (bullet.explosionRadius > 0) {
          this.explode(
            bullet.x,
            bullet.y,
            bullet.explosionRadius,
            bullet.damage * 0.6,
            '#ffb03a',
            {
              hurtsPlayer: false,
            },
          );
          consumed = true;
          break;
        }
        if (bullet.pierce > 0) {
          bullet.pierce--;
          // Piercing shots lose a little damage each time, so pierce stacks
          // widen a build's reach without also multiplying its damage.
          bullet.damage = Math.max(1, Math.round(bullet.damage * 0.8));
        } else {
          consumed = true;
          break;
        }
      }

      if (consumed) this.projectiles.release(index);
    });
  }

  /** Gentle steering toward the nearest enemy inside a forward-facing cone. */
  private steerProjectile(bullet: Projectile, step: number): void {
    let target: Enemy | undefined;
    let bestScore = Number.POSITIVE_INFINITY;
    const heading = Math.atan2(bullet.vy, bullet.vx);

    const candidates = this.enemyHash.collectInto(this.candidates, bullet.x, bullet.y, 220);
    for (const enemy of candidates) {
      if (!enemy.alive || enemy.spawnTimer > 0 || bullet.hits.has(enemy)) continue;
      const dx = enemy.x - bullet.x;
      const dy = enemy.y - bullet.y;
      const offset = Math.abs(angleDelta(heading, Math.atan2(dy, dx)));
      // Never turn back on itself: a bullet that boomerangs reads as a bug.
      if (offset > 1.1) continue;
      const score = length(dx, dy) + offset * 120;
      if (score < bestScore) {
        bestScore = score;
        target = enemy;
      }
    }

    if (target === undefined) return;
    const desired = Math.atan2(target.y - bullet.y, target.x - bullet.x);
    const turn = clamp(
      angleDelta(heading, desired),
      -bullet.homing * step,
      bullet.homing * step,
    );
    const speed = length(bullet.vx, bullet.vy);
    const angle = heading + turn;
    bullet.vx = Math.cos(angle) * speed;
    bullet.vy = Math.sin(angle) * speed;
  }

  private onProjectileExpired(bullet: Projectile): void {
    if (bullet.explosionRadius > 0) {
      this.explode(bullet.x, bullet.y, bullet.explosionRadius, bullet.damage * 0.6, '#ffb03a', {
        hurtsPlayer: false,
      });
      return;
    }
    this.particles.burst(bullet.x, bullet.y, {
      count: 4,
      color: '#8fe9ff',
      speed: [40, 130],
      life: [0.1, 0.22],
      size: [1, 3],
    });
  }

  private updateEnemyBullets(step: number): void {
    this.enemyBullets.forEach((bullet, index) => {
      bullet.px = bullet.x;
      bullet.py = bullet.y;
      bullet.life -= step;
      if (bullet.life <= 0) {
        this.enemyBullets.release(index);
        return;
      }
      bullet.x += bullet.vx * step;
      bullet.y += bullet.vy * step;

      if (isSolidAt(this.dungeon, bullet.x, bullet.y, this.doorsLocked)) {
        this.particles.burst(bullet.x, bullet.y, {
          count: 5,
          color: bullet.color,
          speed: [40, 150],
          life: [0.1, 0.25],
          size: [1, 3],
        });
        this.enemyBullets.release(index);
        return;
      }

      if (
        this.player.alive &&
        circlesOverlap(
          bullet.x,
          bullet.y,
          bullet.radius,
          this.player.x,
          this.player.y,
          this.player.radius,
        )
      ) {
        // Dashing through a bullet destroys it even while invulnerable, so a
        // successful dodge visibly clears the screen instead of leaving the
        // shot to hit you a frame later.
        const hit = this.damagePlayer(bullet.damage);
        if (hit || this.player.isInvulnerable) this.enemyBullets.release(index);
      }
    });
  }

  private updatePickups(step: number): void {
    this.pickups.forEach((pickup, index) => {
      pickup.px = pickup.x;
      pickup.py = pickup.y;
      pickup.life -= step;
      if (pickup.life <= 0) {
        this.pickups.release(index);
        return;
      }
      pickup.delay = Math.max(0, pickup.delay - step);

      const dx = this.player.x - pickup.x;
      const dy = this.player.y - pickup.y;
      const distance = length(dx, dy);

      if (pickup.delay <= 0 && distance < PICKUP.magnetRadius && this.player.alive) {
        // Magnet strength ramps as it closes, so drops accelerate into the
        // player rather than trailing behind them forever.
        const pull = (1 - distance / PICKUP.magnetRadius) * PICKUP.magnetSpeed;
        pickup.vx += (dx / (distance || 1)) * pull * step * 6;
        pickup.vy += (dy / (distance || 1)) * pull * step * 6;
      }

      pickup.x += pickup.vx * step;
      pickup.y += pickup.vy * step;
      const friction = decayPerStep(0.9, step);
      pickup.vx *= friction;
      pickup.vy *= friction;

      if (this.player.alive && distance < this.player.radius + PICKUP.radius) {
        this.collectPickup(pickup.kind);
        this.pickups.release(index);
      }
    });
  }

  private collectPickup(kind: PickupKind): void {
    if (kind === 'heart') {
      if (this.player.heal(PICKUP.healAmount, this.run.stats)) {
        this.playSfx('pickup', 0.9);
        this.spawnText(this.player.x, this.player.y - 20, '+1', '#4dff9e');
      } else {
        // Full health converts the heart to score rather than wasting it.
        this.run.addScore(25);
        this.playSfx('pickup', 1.4);
      }
      return;
    }
    this.run.coins++;
    this.run.addScore(5);
    this.playSfx('pickup', this.cosmeticRng.float(1.1, 1.3), 0.5);
  }

  private updatePedestals(step: number): void {
    for (const pedestal of this.pedestals) {
      pedestal.phase += step * 2;
      if (pedestal.taken || !this.player.alive) continue;
      if (
        !circlesOverlap(
          pedestal.x,
          pedestal.y,
          18,
          this.player.x,
          this.player.y,
          this.player.radius,
        )
      )
        continue;

      if (pedestal.kind === 'shop') {
        if (this.run.coins < pedestal.price) continue;
        this.run.coins -= pedestal.price;
      }
      pedestal.taken = true;
      this.grantUpgrade(pedestal.upgrade);
    }
  }

  grantUpgrade(upgrade: UpgradeDef): void {
    const previousMax = this.run.stats.maxHealth;
    this.run.addUpgrade(upgrade.id);

    // Max-health changes adjust current health so a +health pickup actually
    // heals and Glass Cannon's downside is felt immediately.
    const delta = this.run.stats.maxHealth - previousMax;
    if (delta > 0)
      this.player.health = Math.min(this.run.stats.maxHealth, this.player.health + delta);
    else if (delta < 0)
      this.player.health = Math.max(1, Math.min(this.player.health, this.run.stats.maxHealth));

    this.playSfx('upgrade');
    this.camera.addTrauma(0.2);
    this.particles.burst(this.player.x, this.player.y, {
      count: 40,
      color: '#ffe27a',
      speed: [80, 300],
      life: [0.3, 0.8],
      size: [2, 5],
      shape: 'spark',
    });
    this.spawnText(this.player.x, this.player.y - 30, upgrade.name, '#ffe27a', 18);
    this.events.onUpgradeTaken?.(upgrade);
  }

  private updateTexts(step: number): void {
    this.texts.forEach((text, index) => {
      text.life -= step;
      if (text.life <= 0) {
        this.texts.release(index);
        return;
      }
      text.y += text.vy * step;
      text.vy *= decayPerStep(0.92, step);
    });
  }

  // -- room rules ------------------------------------------------------------

  private updateRoom(step: number): void {
    const roomIndex = roomAtPosition(this.dungeon, this.player.x, this.player.y);
    if (roomIndex >= 0) {
      if (roomIndex !== this.currentRoom) this.enterRoom(roomIndex);
    } else if (this.roomPhase === 'idle') {
      // In a corridor: release the camera from the room it was clamped to,
      // otherwise the player walks straight off the edge of the screen.
      this.camera.bounds = null;
    }

    const room = this.dungeon.rooms[this.currentRoom];
    if (room === undefined) return;

    switch (this.roomPhase) {
      case 'idle': {
        if (room.cleared) break;
        if (!this.isInsideInterior(room)) break;
        this.beginCombat(room);
        break;
      }
      case 'spawning': {
        this.roomTimer -= step;
        if (this.roomTimer <= 0) {
          this.spawnPlanned(room);
          this.roomPhase = 'combat';
        }
        break;
      }
      case 'combat': {
        if (this.countLiveEnemies() > 0) break;
        this.roomTimer = ROOM.clearDelay;
        this.roomPhase = 'cleared';
        break;
      }
      case 'cleared': {
        this.roomTimer -= step;
        if (this.roomTimer <= 0) this.finishRoom(room);
        break;
      }
    }

    if (this.exitPortal.active && this.player.alive) {
      const distance = length(
        this.player.x - this.exitPortal.x,
        this.player.y - this.exitPortal.y,
      );
      if (distance < 26) {
        this.exitPortal.active = false;
        this.events.onFloorCleared?.();
      }
    }
  }

  private enterRoom(index: number): void {
    const room = this.dungeon.rooms[index];
    if (room === undefined) return;
    this.currentRoom = index;
    room.visited = true;
    this.updateCameraBounds(room);
    if (this.roomPhase === 'combat' || this.roomPhase === 'spawning') return;
    this.roomPhase = 'idle';
  }

  /**
   * Combat only starts once the player is properly inside — standing in the
   * threshold when the doors slam would trap them inside a wall.
   */
  private isInsideInterior(room: Room): boolean {
    const margin = TILE_SIZE * 1.5;
    const bounds = roomBounds(room);
    return (
      this.player.x > bounds.x + margin &&
      this.player.x < bounds.x + bounds.width - margin &&
      this.player.y > bounds.y + margin &&
      this.player.y < bounds.y + bounds.height - margin
    );
  }

  private beginCombat(room: Room): void {
    this.doorsLocked = true;
    this.roomPhase = 'spawning';
    this.roomTimer = ROOM.spawnDelay;
    this.pendingSpawns =
      room.type === 'boss' ? ['boss'] : planSpawns(this.rng, this.run.depth, room.type).kinds;
    this.playSfx('doorOpen', 0.6);
  }

  private spawnPlanned(room: Room): void {
    if (room.type === 'boss') {
      const centre = roomCenter(room);
      const boss = this.spawnEnemy('boss', centre.x, centre.y - 60);
      if (boss !== null) this.events.onBossSpawned?.(boss);
      return;
    }

    // Shuffle a copy so several enemies never stack on one spawn point.
    const points = this.rng.shuffle([...room.spawnPoints]);
    this.pendingSpawns.forEach((kind, i) => {
      const point = points[i % points.length];
      if (point === undefined) return;
      this.spawnEnemy(kind, (point.x + 0.5) * TILE_SIZE, (point.y + 0.5) * TILE_SIZE);
    });
  }

  private countLiveEnemies(): number {
    let total = 0;
    for (const enemy of this.enemies) if (enemy.alive) total++;
    return total;
  }

  private finishRoom(room: Room): void {
    room.cleared = true;
    this.doorsLocked = false;
    this.roomPhase = 'idle';
    this.run.roomsCleared++;
    this.run.addScore(SCORE.roomClearBonus);
    this.playSfx('doorOpen');

    if (room.type === 'boss') {
      this.run.addScore(SCORE.floorClearBonus);
      if (this.run.flawlessFloor) {
        this.run.addScore(SCORE.flawlessBonus);
        this.spawnText(this.player.x, this.player.y - 44, 'FLAWLESS', '#6ef2ff', 22);
      }
      const centre = roomCenter(room);
      this.exitPortal.x = centre.x;
      this.exitPortal.y = centre.y;
      this.exitPortal.active = true;
    }

    this.events.onRoomCleared?.(room);
  }

  // -- damage and death ------------------------------------------------------

  /**
   * Applies damage to an enemy plus all of its feedback.
   *
   * `feedback: false` exists for continuous sources (orbital blades tick every
   * frame). Those must not fire hit-stop, screen shake, a sound and a damage
   * number sixty times a second — doing so freezes the game solid while a
   * blade is touching anything.
   */
  damageEnemy(
    enemy: Enemy,
    amount: number,
    options: {
      critical?: boolean;
      angle?: number;
      knockback?: number;
      feedback?: boolean;
    } = {},
  ): void {
    if (!enemy.alive || enemy.spawnTimer > 0) return;

    const critical = options.critical ?? false;
    const angle = options.angle ?? 0;
    const knockback = options.knockback ?? 0;
    const feedback = options.feedback ?? true;

    enemy.health -= amount;
    enemy.hitFlash = 0.12;
    if (knockback > 0) enemy.applyKnockback(angle, knockback);

    this.particles.burst(enemy.x, enemy.y, {
      count: feedback ? (critical ? 14 : 6) : 1,
      color: critical ? '#fff2a8' : enemy.color,
      speed: [80, critical ? 380 : 220],
      life: [0.15, 0.4],
      size: [1, critical ? 5 : 3],
      direction: angle,
      spread: 1.6,
      shape: 'spark',
    });

    if (feedback) {
      this.spawnText(
        enemy.x,
        enemy.y - enemy.radius,
        String(Math.max(1, Math.round(amount))),
        critical ? '#fff2a8' : '#ffffff',
        critical ? 20 : 14,
      );
      this.hitStop = Math.max(this.hitStop, critical ? FEEL.hitStopHeavy : FEEL.hitStopLight);
      this.camera.addTrauma(critical ? FEEL.cameraTraumaHit * 1.5 : FEEL.cameraTraumaHit * 0.5);
      this.playSfx('hit', this.cosmeticRng.float(0.9, 1.15), critical ? 1.3 : 0.8);
    }

    if (enemy.health <= 0) this.killEnemy(enemy, true);
  }

  private killEnemy(enemy: Enemy, awardScore: boolean): void {
    if (!enemy.alive) return;
    enemy.alive = false;

    this.particles.burst(enemy.x, enemy.y, {
      count: enemy.isBoss ? 160 : 22,
      color: enemy.color,
      speed: [60, enemy.isBoss ? 520 : 280],
      life: [0.3, enemy.isBoss ? 1.2 : 0.6],
      size: [2, enemy.isBoss ? 8 : 4],
    });
    this.camera.addTrauma(enemy.isBoss ? 0.9 : 0.12);
    this.playSfx(
      enemy.isBoss ? 'explosion' : 'explosion',
      enemy.isBoss ? 0.55 : this.cosmeticRng.float(1.3, 1.6),
      enemy.isBoss ? 1.4 : 0.45,
    );

    if (!awardScore) return;

    const gained = this.run.registerKill(enemy.score);
    this.spawnText(enemy.x, enemy.y - enemy.radius - 8, `+${gained}`, '#ffe27a', 15);

    const stats = this.run.stats;
    if (stats.lifesteal > 0 && this.rng.chance(stats.lifesteal)) {
      if (this.player.heal(1, stats)) {
        this.spawnText(this.player.x, this.player.y - 24, '+1', '#4dff9e');
      }
    }

    this.dropLoot(enemy);
  }

  private dropLoot(enemy: Enemy): void {
    const hurt = this.player.health < this.run.stats.maxHealth;
    if (hurt && this.rng.chance(enemy.isBoss ? 1 : PICKUP.heartChance)) {
      this.spawnPickup('heart', enemy.x, enemy.y);
    }
    const coins = enemy.isBoss ? 12 : this.rng.chance(PICKUP.coinChance) ? 1 : 0;
    for (let i = 0; i < coins; i++) this.spawnPickup('coin', enemy.x, enemy.y);
  }

  private spawnPickup(kind: PickupKind, x: number, y: number): void {
    const acquired = this.pickups.acquire();
    if (acquired === null) return;
    const pickup = acquired.item;
    const angle = this.cosmeticRng.angle();
    const speed = this.cosmeticRng.float(60, 190);
    pickup.x = pickup.px = x;
    pickup.y = pickup.py = y;
    pickup.vx = Math.cos(angle) * speed;
    pickup.vy = Math.sin(angle) * speed;
    pickup.kind = kind;
    pickup.life = 22;
    pickup.delay = 0.35;
  }

  damagePlayer(amount: number): boolean {
    const final = resolvePlayerDamage(amount, this.run.stats.armor);
    if (!this.player.takeDamage(final)) return false;

    this.run.flawlessFloor = false;
    this.hitStop = Math.max(this.hitStop, FEEL.hitStopHeavy);
    this.camera.addTrauma(FEEL.cameraTraumaPlayerHit);
    this.playSfx('playerHit');
    this.particles.burst(this.player.x, this.player.y, {
      count: 30,
      color: '#ff5c7a',
      speed: [80, 320],
      life: [0.25, 0.7],
      size: [2, 5],
    });

    if (!this.player.alive) {
      this.slowMo = FEEL.slowMoDuration * 3;
      this.playSfx('gameOver');
      this.events.onPlayerDied?.();
    } else {
      this.slowMo = FEEL.slowMoDuration;
    }
    return true;
  }

  // -- CombatContext actions -------------------------------------------------

  spawnEnemyBullet(
    x: number,
    y: number,
    angle: number,
    options: { speed?: number; radius?: number; damage?: number; color?: string } = {},
  ): void {
    const acquired = this.enemyBullets.acquire();
    if (acquired === null) return;
    const bullet = acquired.item;
    const speed = options.speed ?? ENEMY_BULLET.speed;
    bullet.x = bullet.px = x;
    bullet.y = bullet.py = y;
    bullet.vx = Math.cos(angle) * speed;
    bullet.vy = Math.sin(angle) * speed;
    bullet.radius = options.radius ?? ENEMY_BULLET.radius;
    bullet.damage = options.damage ?? ENEMY_BULLET.damage;
    bullet.life = ENEMY_BULLET.life;
    bullet.color = options.color ?? '#ff9a4d';
  }

  explode(
    x: number,
    y: number,
    radius: number,
    damage: number,
    color: string,
    options: { hurtsPlayer?: boolean; source?: Enemy } = {},
  ): void {
    this.particles.burst(x, y, {
      count: 46,
      color,
      speed: [120, 520],
      life: [0.25, 0.7],
      size: [2, 7],
      shape: 'spark',
    });
    this.camera.addTrauma(FEEL.cameraTraumaExplosion);
    this.playSfx('explosion', this.cosmeticRng.float(0.85, 1.1));
    this.hitStop = Math.max(this.hitStop, FEEL.hitStopHeavy);

    this.enemyHash.query(x, y, radius, (enemy) => {
      if (!enemy.alive || enemy.spawnTimer > 0) return;
      // A bomber does not award itself score by detonating on top of itself.
      if (enemy === options.source) return;
      const distance = length(enemy.x - x, enemy.y - y);
      const falloff = explosionFalloff(distance, radius + enemy.radius);
      if (falloff <= 0) return;
      this.damageEnemy(enemy, Math.max(1, Math.round(damage * falloff)), {
        angle: Math.atan2(enemy.y - y, enemy.x - x),
        knockback: 180 * falloff,
      });
    });

    if (this.player.alive) {
      const distance = length(this.player.x - x, this.player.y - y);
      const falloff = explosionFalloff(distance, radius + this.player.radius);
      // The player's own Volatile Rounds never hurt them; an upgrade that
      // kills its owner at point-blank range is a trap, not a choice.
      if (falloff > 0 && (options.hurtsPlayer ?? true)) this.damagePlayer(1);
    }
  }

  requestSpawn(kind: EnemyKind, x: number, y: number): void {
    // Reinforcements must not land inside geometry.
    if (isSolidAt(this.dungeon, x, y, this.doorsLocked)) {
      const room = this.dungeon.rooms[this.currentRoom];
      if (room === undefined) return;
      const centre = roomCenter(room);
      this.spawnEnemy(kind, centre.x, centre.y);
      return;
    }
    this.spawnEnemy(kind, x, y);
  }

  private spawnEnemy(kind: EnemyKind, x: number, y: number): Enemy | null {
    const enemy = this.enemies.find((candidate) => !candidate.alive);
    if (enemy === undefined) return null;
    enemy.spawn(kind, x, y, this.run.depth);
    enemy.spawnTimer = ROOM.spawnTelegraph;
    this.particles.burst(x, y, {
      count: 18,
      color: enemy.color,
      speed: [40, 160],
      life: [0.3, 0.7],
      size: [1, 4],
    });
    return enemy;
  }

  spawnText(x: number, y: number, text: string, color: string, size = 14): void {
    const acquired = this.texts.acquire();
    if (acquired === null) return;
    const item = acquired.item;
    item.x = x + this.cosmeticRng.float(-8, 8);
    item.y = y;
    item.vy = -46;
    item.maxLife = item.life = 0.8;
    item.text = text;
    item.color = color;
    item.size = size;
  }

  /** Live boss, if one is on the field — the HUD draws its health bar. */
  get activeBoss(): Enemy | null {
    for (const enemy of this.enemies) {
      if (enemy.alive && enemy.isBoss) return enemy;
    }
    return null;
  }

  /** 0 when exploring, 1 during a boss fight — drives the music intensity. */
  get tension(): number {
    if (this.activeBoss !== null) return 1;
    if (this.roomPhase === 'combat') return 0.6;
    return 0.15;
  }

  tileAt(x: number, y: number): TileId {
    if (x < 0 || y < 0 || x >= this.dungeon.width || y >= this.dungeon.height) return Tile.Void;
    return (this.dungeon.tiles[y * this.dungeon.width + x] ?? Tile.Void) as TileId;
  }
}

/** Shop prices scale with rarity and depth so gold keeps its meaning late. */
function priceFor(upgrade: UpgradeDef, depth: number): number {
  const base = upgrade.rarity === 'epic' ? 22 : upgrade.rarity === 'rare' ? 14 : 8;
  return Math.round(base * (1 + (depth - 1) * 0.15));
}
