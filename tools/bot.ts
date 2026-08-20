import { clamp, TAU } from '@engine/math';
import type { Rng } from '@engine/rng';
import type { World, PlayerIntent } from '@game/world';
import { findPath } from './pathfinder';

/**
 * A scripted player, good enough for the numbers to mean something.
 *
 * The bot exists to make balance measurable, so its job is not to be optimal —
 * an optimal bot measures the ceiling, which nobody plays at. It is written to
 * approximate a *competent* player: it kites at a preferred range, strafes
 * rather than charging, dashes out of danger when something is about to hit,
 * and takes upgrades on a fixed preference order.
 *
 * That makes its results comparable across builds. When a tuning change moves
 * the bot's floor-4 survival rate from 60% to 30%, the change did that — the
 * bot plays the same way it did yesterday.
 *
 * What it deliberately does not do: aim ahead of moving targets, kite around
 * cover, or bait attacks. A human does all three, so the bot's numbers are a
 * lower bound on human performance, not a prediction of it.
 */

/** Distance the bot tries to hold from whatever it is shooting. */
const PREFERRED_RANGE = 190;
/** Incoming projectiles inside this radius trigger a dash. */
const DANGER_RADIUS = 64;

export interface BotConfig {
  /** 0 = never dodges, 1 = dashes at every threat it notices. */
  reflex: number;
  /** Seconds of reaction delay before the bot acts on a new threat. */
  reactionTime: number;
}

export const DEFAULT_BOT: BotConfig = {
  reflex: 0.8,
  reactionTime: 0.12,
};

export class Bot {
  private readonly intent: PlayerIntent = {
    move: { x: 0, y: 0 },
    aimAngle: 0,
    firing: false,
    dashPressed: false,
  };

  private strafeSign = 1;
  private strafeTimer = 0;
  private threatTimer = 0;
  private dashCooldown = 0;

  /** Room the bot is currently trying to reach, or -1 for none. */
  private goalRoom = -1;
  /** Waypoints still to walk, nearest first. */
  private navPath: { x: number; y: number }[] = [];
  private navTimer = 0;
  /** Last heading used, so a corridor crossing keeps its direction. */
  private lastHeading = 0;

  /** Unstick state: where we were, how long we have been there. */
  private lastX = 0;
  private lastY = 0;
  private stuckFor = 0;
  private detourTimer = 0;
  private detourAngle = 0;

  constructor(
    private readonly rng: Rng,
    private readonly config: BotConfig = DEFAULT_BOT,
  ) {}

  /** Navigation state, for the simulator's `--trace` output. */
  debug(): { goal: number; waypoints: number; detour: number } {
    return {
      goal: this.goalRoom,
      waypoints: this.navPath.length,
      detour: this.detourTimer,
    };
  }

  think(world: World, step: number): PlayerIntent {
    const player = world.player;
    this.dashCooldown = Math.max(0, this.dashCooldown - step);
    this.updateStuckness(world, step);

    // Reverse strafe direction periodically so the bot does not orbit forever
    // in one direction and wedge itself into a corner.
    this.strafeTimer -= step;
    if (this.strafeTimer <= 0) {
      this.strafeTimer = this.rng.float(0.8, 2.2);
      this.strafeSign = this.rng.sign();
    }

    const target = this.nearestEnemy(world);
    const threat = this.nearestThreat(world);

    // Reaction delay: the bot cannot respond to a bullet the instant it
    // spawns, because a human cannot either.
    this.threatTimer = threat === null ? 0 : this.threatTimer + step;
    const reacted = this.threatTimer >= this.config.reactionTime;

    let moveAngle: number;
    if (threat !== null && reacted) {
      // Sidestep perpendicular to the incoming shot rather than running from
      // it — running away keeps you in the line of fire.
      moveAngle = threat.angle + (Math.PI / 2) * this.strafeSign;
    } else if (target !== null) {
      const toTarget = Math.atan2(target.y - player.y, target.x - player.x);
      const distance = Math.hypot(target.x - player.x, target.y - player.y);
      // Blend "hold range" with "circle the target".
      const radial = distance > PREFERRED_RANGE ? 0 : Math.PI;
      const orbit = (Math.PI / 2) * this.strafeSign;
      const pull = clamp(Math.abs(distance - PREFERRED_RANGE) / PREFERRED_RANGE, 0, 1);
      moveAngle = toTarget + radial * pull + orbit * (1 - pull);
    } else if (this.detourTimer > 0) {
      // Wedged on geometry: commit to a detour rather than keep pressing into
      // the wall the navigation target is behind.
      moveAngle = this.detourAngle;
    } else {
      const heading = this.navigate(world, step);
      if (heading === null) return this.idle();
      moveAngle = heading;
    }

    this.intent.move.x = Math.cos(moveAngle);
    this.intent.move.y = Math.sin(moveAngle);
    this.intent.aimAngle =
      target === null ? moveAngle : Math.atan2(target.y - player.y, target.x - player.x);
    this.intent.firing = target !== null;

    // Dash to break out of danger, not to travel — travelling on dash burns the
    // cooldown that would have saved the next hit.
    const shouldDash =
      threat !== null &&
      reacted &&
      this.dashCooldown <= 0 &&
      player.dashCooldown <= 0 &&
      this.rng.chance(this.config.reflex);
    this.intent.dashPressed = shouldDash;
    if (shouldDash) this.dashCooldown = 0.35;

    return this.intent;
  }

  /**
   * Detects the bot pressing into a wall and sends it sideways.
   *
   * Collision resolution slides along surfaces, so a bot aiming through a
   * corner makes almost no progress while its input looks perfectly sensible.
   * Without this, runs ended as "stalled" over half the time and the survival
   * numbers were measuring pathing, not difficulty.
   */
  private updateStuckness(world: World, step: number): void {
    const player = world.player;

    if (this.detourTimer > 0) {
      this.detourTimer -= step;
      this.lastX = player.x;
      this.lastY = player.y;
      return;
    }

    const moved = Math.hypot(player.x - this.lastX, player.y - this.lastY);
    // Well under a walking tick's distance: not moving, whatever the input says.
    this.stuckFor = moved < 0.6 ? this.stuckFor + step : 0;
    this.lastX = player.x;
    this.lastY = player.y;

    if (this.stuckFor > 0.5) {
      this.stuckFor = 0;
      this.detourTimer = this.rng.float(0.5, 1.1);
      // Sidestep rather than reverse: the way out of a corner is along a wall.
      const target = this.navPath[0];
      const base =
        target === undefined
          ? this.rng.angle()
          : Math.atan2(target.y - player.y, target.x - player.x);
      this.detourAngle = base + (Math.PI / 2) * this.rng.sign();
      // Force a fresh route once the detour ends.
      this.navPath = [];
    }
    void world;
  }

  private idle(): PlayerIntent {
    this.intent.move.x = 0;
    this.intent.move.y = 0;
    this.intent.firing = false;
    this.intent.dashPressed = false;
    return this.intent;
  }

  private nearestEnemy(world: World): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const enemy of world.enemies) {
      if (!enemy.alive || enemy.spawnTimer > 0) continue;
      const distance = Math.hypot(enemy.x - world.player.x, enemy.y - world.player.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = enemy;
      }
    }
    return best;
  }

  /** The closest enemy bullet actually heading at the player. */
  private nearestThreat(world: World): { angle: number; distance: number } | null {
    let best: { angle: number; distance: number } | null = null;
    world.enemyBullets.forEach((bullet) => {
      const dx = world.player.x - bullet.x;
      const dy = world.player.y - bullet.y;
      const distance = Math.hypot(dx, dy);
      if (distance > DANGER_RADIUS * 3) return;

      // Ignore anything travelling away: a bullet behind you is not a threat.
      const closing = dx * bullet.vx + dy * bullet.vy;
      if (closing <= 0) return;

      if (best === null || distance < best.distance) {
        best = { angle: Math.atan2(bullet.vy, bullet.vx), distance };
      }
    });
    return best;
  }

  /**
   * Decides where to walk when there is nothing to shoot.
   *
   * Three rules, in order:
   *
   * 1. If the exit portal is open, take it — the floor is done.
   * 2. If the room the bot is standing in has not been cleared, walk to its
   *    centre. Combat only starts once the player is properly inside, so a bot
   *    that clips a doorway and turns around never triggers the fight. That was
   *    the first version's failure: it wandered into the boss room, immediately
   *    re-targeted a neighbour, and left without waking anything.
   * 3. Otherwise head for the nearest uncleared room, one hop at a time.
   *
   * Hops aim at the next room's *centre* rather than at the doorway, which
   * exploits a property of the generator: rooms sit centred in their cells and
   * corridors run along the cell centre line, so the straight line between two
   * adjacent room centres passes through the door joining them.
   */
  private navigate(world: World, step: number): number | null {
    const player = world.player;
    this.navTimer -= step;

    if (world.exitPortal.active) {
      return Math.atan2(world.exitPortal.y - player.y, world.exitPortal.x - player.x);
    }

    const room = world.dungeon.rooms[world.currentRoom];
    if (room === undefined) return null;

    if (!room.cleared) {
      const cx = (room.tileX + room.tileWidth / 2) * 32;
      const cy = (room.tileY + room.tileHeight / 2) * 32;
      return Math.atan2(cy - player.y, cx - player.x);
    }

    // Drop waypoints as they are reached.
    while (this.navPath.length > 0) {
      const next = this.navPath[0] as { x: number; y: number };
      if (Math.hypot(next.x - player.x, next.y - player.y) > 56) break;
      this.navPath.shift();
    }

    const goal = world.dungeon.rooms[this.goalRoom];
    const goalDone = goal === undefined || (goal.cleared && goal.visited);
    const arrived = this.goalRoom === room.index;

    // Replan only when the goal is met, void, or taking too long.
    if (goalDone || arrived || this.navPath.length === 0 || this.navTimer <= 0) {
      this.replan(world);
    }

    const target = this.navPath[0];
    if (target === undefined) return null;
    this.lastHeading = Math.atan2(target.y - player.y, target.x - player.x);
    return this.lastHeading;
  }

  private roomCentre(world: World, index: number): { x: number; y: number } | null {
    const room = world.dungeon.rooms[index];
    if (room === undefined) return null;
    return {
      x: (room.tileX + room.tileWidth / 2) * 32,
      y: (room.tileY + room.tileHeight / 2) * 32,
    };
  }

  /**
   * Chooses a goal room and lays a walkable path to it.
   *
   * Two searches, at different resolutions: BFS over the *room graph* decides
   * which room is worth going to, then BFS over the *tile grid* works out how
   * to get there. Separating them keeps the goal choice cheap and readable
   * while still producing a route that respects interior cover.
   *
   * If the tile search cannot reach the chosen room, the room is skipped and
   * the next candidate tried — a treasure room sealed behind a fight the bot
   * has not taken yet should not freeze it in place.
   */
  private replan(world: World): void {
    const candidates = this.goalCandidates(world);
    const player = world.player;

    for (const index of candidates) {
      const centre = this.roomCentre(world, index);
      if (centre === null) continue;
      const path = findPath(world.dungeon, player.x, player.y, centre.x, centre.y);
      if (path.length === 0) continue;

      this.goalRoom = index;
      this.navPath = path;
      // Scaled to the route's actual length rather than a flat guess, so a
      // long crossing is not abandoned halfway.
      this.navTimer = 6 + path.length * 3;
      return;
    }

    this.goalRoom = -1;
    this.navPath = [];
  }

  /**
   * Rooms worth going to, nearest first over the room graph.
   *
   * Returns candidates rather than one answer so `replan` can fall through to
   * the next when a route cannot be found.
   */
  private goalCandidates(world: World): number[] {
    const rooms = world.dungeon.rooms;
    const from = world.currentRoom;
    const queue: number[] = [from];
    const seen = new Set<number>([from]);
    const candidates: number[] = [];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const room = rooms[current];
      if (room === undefined) continue;
      if (current !== from && (!room.cleared || !room.visited)) candidates.push(current);

      for (const door of room.doors) {
        if (seen.has(door.to)) continue;
        seen.add(door.to);
        queue.push(door.to);
      }
    }

    // Nothing left undone: drift somewhere rather than stand still, so a
    // missed portal is not a permanent freeze.
    if (candidates.length === 0) {
      const room = rooms[from];
      if (room !== undefined && room.doors.length > 0) {
        return [this.rng.pick(room.doors).to];
      }
    }
    return candidates;
  }

  /** Fixed preference order, so upgrade choice does not add its own variance. */
  static preferUpgrade(ids: readonly string[]): string | undefined {
    const order = [
      'reinforced-hull',
      'sharp-rounds',
      'weak-point',
      'thrusters',
      'split-shot',
      'overclock',
      'piercing-core',
      'orbital-blade',
      'siphon',
      'focus-array',
      'hair-trigger',
      'long-barrel',
    ];
    for (const preferred of order) {
      if (ids.includes(preferred)) return preferred;
    }
    return ids[0];
  }
}

void TAU;
