import type { Renderer } from '@engine/renderer';
import { TAU, lerp } from '@engine/math';
import { TILE_SIZE, Tile } from '@game/dungeon/types';
import type { World } from '@game/world';
import type { Enemy } from '@game/entities/enemy';
import { paletteForDepth, UI, type Palette } from './theme';
import { ROOM } from '@game/config';

/**
 * Draws the world.
 *
 * Kept entirely separate from the simulation: it reads world state and writes
 * pixels, never the other way round. Beyond the obvious tidiness, that is what
 * lets the sim be stepped in a test with no canvas, and it means the whole
 * look of the game can be reworked without touching a line of gameplay.
 *
 * Two things carry the visuals, since there are no art assets at all:
 * **silhouette** — every archetype is a different polygon, readable at a
 * glance in a crowded room — and **glow**, which is expensive enough that it
 * is applied to entities only, never to the thousands of tiles behind them.
 */
export class WorldRenderer {
  private palette: Palette = paletteForDepth(1);
  /** Bound to the live world each frame so telegraphs can test the tile map. */
  private probe: ((x: number, y: number) => number) | null = null;

  setDepth(depth: number): void {
    this.palette = paletteForDepth(depth);
  }

  get background(): string {
    return this.palette.background;
  }

  render(renderer: Renderer, world: World, alpha: number): void {
    this.probe = (x, y) => world.tileAt(x, y);
    renderer.beginWorld();
    this.drawTiles(renderer, world);
    this.drawPedestals(renderer, world);
    this.drawPortal(renderer, world);
    this.drawPickups(renderer, world, alpha);
    this.drawEnemies(renderer, world, alpha);
    this.drawEnemyBullets(renderer, world, alpha);
    this.drawPlayer(renderer, world, alpha);
    this.drawProjectiles(renderer, world, alpha);
    world.particles.render(renderer, alpha);
    this.drawFloatingText(renderer, world);
    renderer.endWorld();
    this.drawVignette(renderer, world);
  }

  /**
   * Tiles are drawn one flat pass over only the visible range. A 500x400 map
   * is 200,000 tiles; culling to the ~40x25 on screen is the difference
   * between 60 fps and a slideshow.
   */
  private drawTiles(renderer: Renderer, world: World): void {
    const { ctx, camera } = renderer;
    const { dungeon } = world;

    const minX = Math.max(0, Math.floor(camera.viewX / TILE_SIZE) - 1);
    const minY = Math.max(0, Math.floor(camera.viewY / TILE_SIZE) - 1);
    const maxX = Math.min(
      dungeon.width - 1,
      Math.ceil((camera.viewX + camera.viewWidth / camera.zoom) / TILE_SIZE) + 1,
    );
    const maxY = Math.min(
      dungeon.height - 1,
      Math.ceil((camera.viewY + camera.viewHeight / camera.zoom) / TILE_SIZE) + 1,
    );

    const p = this.palette;

    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        const tile = world.tileAt(tx, ty);
        if (tile === Tile.Void) continue;

        const x = tx * TILE_SIZE;
        const y = ty * TILE_SIZE;

        switch (tile) {
          case Tile.Floor:
            // Checkerboard: enough texture to read movement across a big empty
            // arena, without any actual texture to load.
            ctx.fillStyle = (tx + ty) % 2 === 0 ? p.floor : p.floorAlt;
            ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
            break;
          case Tile.Corridor:
            ctx.fillStyle = p.corridor;
            ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
            break;
          case Tile.Wall:
            this.drawWallTile(renderer, world, tx, ty, x, y);
            break;
          case Tile.Door:
            this.drawDoorTile(renderer, world, x, y);
            break;
          default:
            break;
        }
      }
    }
  }

  private drawWallTile(
    renderer: Renderer,
    world: World,
    tx: number,
    ty: number,
    x: number,
    y: number,
  ): void {
    const { ctx } = renderer;
    const p = this.palette;
    ctx.fillStyle = p.wall;
    ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);

    // A lit lower lip on walls that front onto floor fakes a light source and
    // makes the arena read as three-dimensional at almost no cost.
    const below = world.tileAt(tx, ty + 1);
    if (below !== Tile.Void && below !== Tile.Wall) {
      ctx.fillStyle = p.wallEdge;
      ctx.fillRect(x, y + TILE_SIZE - 5, TILE_SIZE, 5);
    }
  }

  private drawDoorTile(renderer: Renderer, world: World, x: number, y: number): void {
    const { ctx } = renderer;
    const p = this.palette;
    if (world.doorsLocked) {
      // Shut: solid, bright, and pulsing so it is unmistakably "not yet".
      const pulse = 0.6 + Math.sin(world.run.elapsed * 6) * 0.2;
      ctx.fillStyle = p.wall;
      ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
      ctx.globalAlpha = pulse;
      renderer.glow(UI.danger, 12);
      ctx.fillStyle = UI.danger;
      ctx.fillRect(x + 3, y + 3, TILE_SIZE - 6, TILE_SIZE - 6);
      renderer.clearGlow();
      ctx.globalAlpha = 1;
      return;
    }
    ctx.fillStyle = p.corridor;
    ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
    ctx.fillStyle = p.accentSoft;
    ctx.fillRect(x, y + TILE_SIZE / 2 - 1, TILE_SIZE, 2);
  }

  private drawPlayer(renderer: Renderer, world: World, alpha: number): void {
    const { ctx } = renderer;
    const player = world.player;
    if (!player.alive) return;

    const x = lerp(player.px, player.x, alpha);
    const y = lerp(player.py, player.y, alpha);

    // Flicker while invulnerable, but never fully hide the player — losing
    // track of your own character mid-fight is worse than the readability win.
    const flickering = player.isInvulnerable && !player.isDashing;
    ctx.globalAlpha = flickering ? 0.45 + Math.sin(world.run.elapsed * 40) * 0.3 : 1;

    // Orbital blades sit behind the ship so they never obscure it.
    const orbitals = world.run.stats.orbitals;
    for (let i = 0; i < orbitals; i++) {
      const angle = player.orbitAngle + (i / orbitals) * TAU;
      const ox = x + Math.cos(angle) * 58;
      const oy = y + Math.sin(angle) * 58;
      renderer.polygon(ox, oy, 9, 3, angle * 3, '#9dffcf', true, 14);
    }

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(player.facing);

    const dashing = player.isDashing;
    const body = dashing ? '#b6f6ff' : '#6ef2ff';
    renderer.glow(body, dashing ? 30 : 18);

    // Arrowhead hull: unambiguous facing, which matters more than detail when
    // the ship is 22 pixels across.
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(14, 0);
    ctx.lineTo(-9, -10);
    ctx.lineTo(-5, 0);
    ctx.lineTo(-9, 10);
    ctx.closePath();
    ctx.fill();
    renderer.clearGlow();

    ctx.fillStyle = '#04121a';
    ctx.beginPath();
    ctx.arc(1, 0, 3.4, 0, TAU);
    ctx.fill();
    ctx.restore();

    ctx.globalAlpha = 1;

    // Crosshair-side muzzle marker, so aim is readable even when the pointer
    // is off past the edge of the room.
    const aimX = x + Math.cos(player.aimAngle) * 30;
    const aimY = y + Math.sin(player.aimAngle) * 30;
    renderer.circle(aimX, aimY, 2.5, 'rgba(110, 242, 255, 0.75)');
  }

  private drawEnemies(renderer: Renderer, world: World, alpha: number): void {
    const { ctx, camera } = renderer;
    for (const enemy of world.enemies) {
      if (!enemy.alive) continue;
      const x = lerp(enemy.px, enemy.x, alpha);
      const y = lerp(enemy.py, enemy.y, alpha);
      if (!camera.isVisible(x, y, enemy.radius + 40)) continue;

      // Spawn telegraph: a closing ring that says "something lands here in
      // half a second", so a room never materialises an enemy on top of you.
      if (enemy.spawnTimer > 0) {
        const t = 1 - enemy.spawnTimer / ROOM.spawnTelegraph;
        renderer.ring(x, y, enemy.radius + 26 * (1 - t), enemy.color, 2, 12);
        ctx.globalAlpha = t * 0.6;
        renderer.polygon(
          x,
          y,
          enemy.radius * t,
          sidesFor(enemy),
          enemy.spin,
          enemy.color,
          true,
          8,
        );
        ctx.globalAlpha = 1;
        continue;
      }

      const flashing = enemy.hitFlash > 0;
      const color = flashing ? '#ffffff' : enemy.color;
      renderer.polygon(x, y, enemy.radius, sidesFor(enemy), enemy.spin, color, true, 14);

      this.drawEnemyTell(renderer, enemy, x, y);

      // Health rings for anything that survives more than a couple of hits;
      // grunts die too fast for a bar to be anything but clutter.
      if (!enemy.isBoss && enemy.maxHealth > 40 && enemy.health < enemy.maxHealth) {
        const ratio = Math.max(0, enemy.health / enemy.maxHealth);
        renderer.arc(
          x,
          y,
          enemy.radius + 7,
          -Math.PI / 2,
          -Math.PI / 2 + TAU * ratio,
          '#ff8fa3',
          3,
        );
      }
    }
  }

  /** Per-archetype attack telegraphs, drawn on top of the body. */
  private drawEnemyTell(renderer: Renderer, enemy: Enemy, x: number, y: number): void {
    const state = enemy.stateName;

    if (enemy.kind === 'shooter' && (state === 'aim' || state === 'fire')) {
      this.drawSightline(renderer, x, y, enemy.angle, 260, 'rgba(255, 176, 58, 0.35)', 2);
    }

    if (enemy.kind === 'bomber' && state === 'fuse') {
      renderer.ring(x, y, 78, 'rgba(201, 139, 255, 0.4)', 2, 10);
      renderer.ring(x, y, enemy.radius + 6 + Math.sin(enemy.spin * 14) * 3, '#fff', 2, 14);
    }

    if (enemy.kind === 'brute' && state === 'windup') {
      this.drawSightline(renderer, x, y, enemy.angle, 300, 'rgba(255, 61, 94, 0.5)', 4);
    }

    if (enemy.isBoss) {
      renderer.ring(x, y, enemy.radius + 10, enemy.color, 2, 20);
      if (state === 'dash' || state === 'shotgun') {
        this.drawSightline(renderer, x, y, enemy.angle, 420, 'rgba(255, 45, 111, 0.4)', 5);
      }
    }
  }

  /**
   * Draws an aim telegraph that stops at the first wall.
   *
   * A laser sight that carries on through solid rock reads as a rendering bug
   * and, worse, lies about where the shot will actually land.
   */
  private drawSightline(
    renderer: Renderer,
    x: number,
    y: number,
    angle: number,
    maxLength: number,
    color: string,
    width: number,
  ): void {
    const stepSize = TILE_SIZE * 0.5;
    let length = maxLength;
    for (let travelled = stepSize; travelled <= maxLength; travelled += stepSize) {
      const tx = Math.floor((x + Math.cos(angle) * travelled) / TILE_SIZE);
      const ty = Math.floor((y + Math.sin(angle) * travelled) / TILE_SIZE);
      const tile = this.probe?.(tx, ty) ?? Tile.Floor;
      if (tile === Tile.Void || tile === Tile.Wall) {
        length = travelled - stepSize;
        break;
      }
    }
    if (length <= 0) return;
    renderer.line(
      x,
      y,
      x + Math.cos(angle) * length,
      y + Math.sin(angle) * length,
      color,
      width,
      6,
    );
  }

  private drawProjectiles(renderer: Renderer, world: World, alpha: number): void {
    const { ctx } = renderer;
    world.projectiles.forEach((bullet) => {
      const x = lerp(bullet.px, bullet.x, alpha);
      const y = lerp(bullet.py, bullet.y, alpha);
      const color = bullet.critical ? '#fff2a8' : '#8fe9ff';

      // A trail behind the head reads as speed far better than a bigger dot.
      renderer.glow(color, 14);
      ctx.strokeStyle = color;
      ctx.lineWidth = bullet.radius * 1.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - bullet.vx * 0.018, y - bullet.vy * 0.018);
      ctx.stroke();
      ctx.lineCap = 'butt';
      renderer.clearGlow();

      if (bullet.explosionRadius > 0) {
        renderer.ring(x, y, bullet.radius + 3, '#ffb03a', 1.5, 8);
      }
    });
  }

  private drawEnemyBullets(renderer: Renderer, world: World, alpha: number): void {
    world.enemyBullets.forEach((bullet) => {
      const x = lerp(bullet.px, bullet.x, alpha);
      const y = lerp(bullet.py, bullet.y, alpha);
      // Bright core plus a soft halo: enemy fire has to stay legible against a
      // busy floor, because every one of these is a mistake waiting to happen.
      renderer.circle(x, y, bullet.radius + 2, 'rgba(255, 154, 77, 0.28)');
      renderer.circle(x, y, bullet.radius, bullet.color, 12);
      renderer.circle(x, y, bullet.radius * 0.45, '#fff6e8');
    });
  }

  private drawPickups(renderer: Renderer, world: World, alpha: number): void {
    const { ctx } = renderer;
    world.pickups.forEach((pickup) => {
      const x = lerp(pickup.px, pickup.x, alpha);
      const y = lerp(pickup.py, pickup.y, alpha);
      const bob = Math.sin(world.run.elapsed * 5 + x * 0.05) * 2;

      // Blink out over the last two seconds, so a drop about to vanish says so.
      if (pickup.life < 2) {
        ctx.globalAlpha = 0.35 + Math.sin(world.run.elapsed * 22) * 0.35;
      }

      if (pickup.kind === 'heart') {
        renderer.polygon(x, y + bob, 8, 4, Math.PI / 4, UI.health, true, 14);
        renderer.circle(x, y + bob, 2.5, '#fff');
      } else {
        renderer.polygon(x, y + bob, 6, 6, world.run.elapsed * 2, UI.coin, true, 10);
      }
      ctx.globalAlpha = 1;
    });
  }

  private drawPedestals(renderer: Renderer, world: World): void {
    for (const pedestal of world.pedestals) {
      const bob = Math.sin(pedestal.phase) * 3;
      const color = pedestal.taken ? '#2c3a4d' : UI.rarity[pedestal.upgrade.rarity];

      renderer.rect(pedestal.x - 14, pedestal.y + 8, 28, 10, '#1a2436');
      renderer.ring(pedestal.x, pedestal.y + 13, 18, color, 2, pedestal.taken ? 0 : 10);
      if (pedestal.taken) continue;

      renderer.polygon(
        pedestal.x,
        pedestal.y - 6 + bob,
        11,
        6,
        pedestal.phase * 0.6,
        color,
        true,
        18,
      );

      renderer.text(pedestal.upgrade.name, pedestal.x, pedestal.y - 34 + bob, {
        size: 13,
        color,
        align: 'center',
        glow: 8,
      });
      if (pedestal.kind === 'shop') {
        const affordable = world.run.coins >= pedestal.price;
        renderer.text(`${pedestal.price} ⬥`, pedestal.x, pedestal.y + 40, {
          size: 13,
          color: affordable ? UI.coin : '#6b5a3a',
          align: 'center',
        });
      }
    }
  }

  private drawPortal(renderer: Renderer, world: World): void {
    if (!world.exitPortal.active) return;
    const { x, y } = world.exitPortal;
    const t = world.run.elapsed;
    for (let i = 0; i < 4; i++) {
      const radius = 12 + i * 8 + Math.sin(t * 3 + i) * 3;
      renderer.ring(x, y, radius, this.palette.accent, 2, 18);
    }
    renderer.circle(x, y, 8, '#ffffff', 24);
    renderer.text('DESCEND', x, y - 56, {
      size: 15,
      color: this.palette.accent,
      align: 'center',
      glow: 12,
      letterSpacing: '3px',
    });
  }

  private drawFloatingText(renderer: Renderer, world: World): void {
    const { ctx } = renderer;
    world.texts.forEach((item) => {
      const t = item.life / item.maxLife;
      ctx.globalAlpha = Math.min(1, t * 1.8);
      renderer.text(item.text, item.x, item.y, {
        size: item.size,
        color: item.color,
        align: 'center',
        weight: '700',
        glow: 6,
      });
      ctx.globalAlpha = 1;
    });
  }

  /**
   * Screen-space vignette. Darkens the edges to pull the eye to the middle,
   * and flares red as health drops — a health warning the player feels rather
   * than has to read off the HUD.
   */
  private drawVignette(renderer: Renderer, world: World): void {
    const { ctx, width, height } = renderer;
    const healthRatio = world.player.health / Math.max(1, world.run.stats.maxHealth);
    const danger = healthRatio <= 0.34 ? 1 - healthRatio / 0.34 : 0;

    const gradient = ctx.createRadialGradient(
      width / 2,
      height / 2,
      height * 0.32,
      width / 2,
      height / 2,
      height * 0.85,
    );
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(
      1,
      `rgba(${danger > 0 ? 60 : 0}, 0, ${danger > 0 ? 20 : 0}, ${0.55 + danger * 0.25})`,
    );
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    if (danger > 0) {
      const pulse = (Math.sin(world.run.elapsed * 5) * 0.5 + 0.5) * danger;
      ctx.fillStyle = `rgba(255, 45, 111, ${pulse * 0.12})`;
      ctx.fillRect(0, 0, width, height);
    }
  }
}

/** Silhouette per archetype — the only thing telling enemies apart at speed. */
function sidesFor(enemy: Enemy): number {
  switch (enemy.kind) {
    case 'grunt':
      return 3;
    case 'shooter':
      return 4;
    case 'bomber':
      return 5;
    case 'turret':
      return 6;
    case 'brute':
      return 8;
    case 'boss':
      return 7;
  }
}
