import type { Renderer } from '@engine/renderer';
import { clamp } from '@engine/math';
import type { World } from '@game/world';
import { UI, paletteForDepth } from '@game/render/theme';
import { getUpgrade } from '@game/progression/upgrades';

/**
 * Heads-up display.
 *
 * Everything here is drawn in screen space over the world. The layout follows
 * one rule: information the player needs *during* a fight goes near the
 * character's eyeline or on the character itself, and everything else is
 * pushed to the corners. Health is top-left because it is checked constantly;
 * the build list is bottom-left because it is checked between rooms.
 */
export class Hud {
  render(renderer: Renderer, world: World): void {
    this.drawHealth(renderer, world);
    this.drawRunInfo(renderer, world);
    this.drawCombo(renderer, world);
    this.drawDashMeter(renderer, world);
    this.drawBuild(renderer, world);
    this.drawBossBar(renderer, world);
    this.drawRoomBanner(renderer, world);
  }

  private drawHealth(renderer: Renderer, world: World): void {
    const max = world.run.stats.maxHealth;
    const current = world.player.health;
    const size = 15;
    const gap = 6;

    for (let i = 0; i < max; i++) {
      const x = 24 + i * (size + gap);
      const y = 26;
      const filled = i < current;
      // Discrete pips rather than a bar: at these amounts the player needs to
      // know "how many hits left", not a percentage.
      renderer.polygon(
        x,
        y,
        size / 2,
        4,
        0,
        filled ? UI.health : UI.healthEmpty,
        true,
        filled ? 12 : 0,
      );
    }

    const armor = world.run.stats.armor;
    if (armor > 0) {
      renderer.text(`ARMOR ${armor}`, 24, 52, {
        size: 11,
        color: UI.textDim,
        letterSpacing: '1px',
      });
    }
  }

  private drawRunInfo(renderer: Renderer, world: World): void {
    const { width } = renderer;
    const palette = paletteForDepth(world.run.depth);

    renderer.text(world.run.score.toLocaleString(), width - 24, 32, {
      size: 26,
      color: UI.text,
      align: 'right',
      weight: '700',
      glow: 8,
    });
    renderer.text(`FLOOR ${world.run.depth} · ${palette.name}`, width - 24, 52, {
      size: 12,
      color: UI.textDim,
      align: 'right',
      letterSpacing: '2px',
    });
    renderer.text(`⬥ ${world.run.coins}`, width - 24, 72, {
      size: 14,
      color: UI.coin,
      align: 'right',
    });
  }

  private drawCombo(renderer: Renderer, world: World): void {
    if (world.run.comboCount < 2) return;
    const { width } = renderer;
    const x = width / 2;

    renderer.text(`x${world.run.comboMultiplier.toFixed(1)}`, x, 40, {
      size: 24,
      color: UI.combo,
      align: 'center',
      weight: '700',
      glow: 14,
    });

    // The draining bar is the whole point: it tells the player how long they
    // have to find the next kill.
    const barWidth = 120;
    renderer.rect(x - barWidth / 2, 48, barWidth, 4, 'rgba(255,255,255,0.12)');
    renderer.rect(x - barWidth / 2, 48, barWidth * world.run.comboRatio, 4, UI.combo);
  }

  /** Dash cooldown is drawn on the player, where the player is already looking. */
  private drawDashMeter(renderer: Renderer, world: World): void {
    const player = world.player;
    if (!player.alive) return;
    const ready = player.dashReadiness(world.run.stats);
    if (ready >= 1) return;

    const screen = renderer.worldToScreen(player.x, player.y);
    renderer.arc(
      screen.x,
      screen.y,
      22,
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * ready,
      'rgba(110, 242, 255, 0.85)',
      3,
    );
  }

  private drawBuild(renderer: Renderer, world: World): void {
    const counts = new Map<string, number>();
    for (const id of world.run.upgrades) counts.set(id, (counts.get(id) ?? 0) + 1);
    if (counts.size === 0) return;

    const { height } = renderer;
    let y = height - 22;
    let shown = 0;
    // Newest first, capped: a 20-item build would otherwise cover the arena.
    const entries = [...counts.entries()].reverse();

    for (const [id, count] of entries) {
      if (shown >= 7) {
        renderer.text(`+${entries.length - shown} more`, 24, y, {
          size: 11,
          color: UI.textDim,
        });
        break;
      }
      const upgrade = getUpgrade(id);
      if (upgrade === undefined) continue;
      const label = count > 1 ? `${upgrade.name} ×${count}` : upgrade.name;
      renderer.text(label, 24, y, {
        size: 12,
        color: UI.rarity[upgrade.rarity],
      });
      y -= 17;
      shown++;
    }
  }

  private drawBossBar(renderer: Renderer, world: World): void {
    const boss = world.activeBoss;
    if (boss === null || boss.spawnTimer > 0) return;

    const { width, height } = renderer;
    const barWidth = width * 0.55;
    const x = (width - barWidth) / 2;
    const y = height - 46;
    const ratio = clamp(boss.health / boss.maxHealth, 0, 1);

    renderer.text('WARDEN', width / 2, y - 12, {
      size: 14,
      color: UI.danger,
      align: 'center',
      letterSpacing: '5px',
      glow: 10,
    });

    renderer.rect(x, y, barWidth, 12, 'rgba(0,0,0,0.6)');
    renderer.rect(x, y, barWidth * ratio, 12, UI.danger);
    renderer.strokeRect(x, y, barWidth, 12, 'rgba(255,255,255,0.25)', 1);

    // Phase ticks let the player see the escalation coming.
    for (const threshold of [0.33, 0.66]) {
      const tickX = x + barWidth * threshold;
      renderer.line(tickX, y, tickX, y + 12, 'rgba(0,0,0,0.65)', 2);
    }
  }

  private drawRoomBanner(renderer: Renderer, world: World): void {
    const room = world.dungeon.rooms[world.currentRoom];
    if (room === undefined) return;

    // The boss has its own name plate and health bar; a second banner over the
    // same fight is just noise.
    if (room.type === 'boss') return;
    if (world.roomPhase !== 'combat' && world.roomPhase !== 'spawning') return;
    const label = room.type === 'elite' ? 'ELITE THREAT' : 'HOSTILES DETECTED';

    renderer.text(label, renderer.width / 2, 86, {
      size: 13,
      color: room.type === 'elite' ? UI.rarity.epic : UI.danger,
      align: 'center',
      letterSpacing: '4px',
      glow: 10,
    });
  }
}
