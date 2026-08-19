import type { Scene, SceneContext } from '@engine/scene';
import type { Renderer } from '@engine/renderer';
import { clamp, easeOutCubic } from '@engine/math';
import { UI } from '@game/render/theme';
import type { UpgradeDef } from '@game/progression/upgrades';

/**
 * The pick-one-of-three overlay.
 *
 * Transparent, so the battlefield stays visible underneath — the choice reads
 * as part of the run rather than a modal dialog bolted on top of it. Cards
 * animate in on a stagger, which buys the player a beat to register that the
 * game has stopped before they are asked to decide.
 *
 * Navigable by mouse, keyboard and touch alike; a reward screen that demands a
 * mouse would lock out every phone player at the first elite.
 */
export class RewardScene implements Scene {
  readonly name = 'reward';
  readonly transparent = true;

  private selected = 0;
  private time = 0;
  private chosen = false;

  constructor(
    private readonly choices: UpgradeDef[],
    private readonly onPick: (upgrade: UpgradeDef) => void,
  ) {}

  enter(context: SceneContext): void {
    context.audio.play('uiSelect', 0.8);
  }

  update(step: number, context: SceneContext): void {
    this.time += step;
    const { input, renderer, stack, audio } = context;
    if (this.chosen) return;

    const previous = this.selected;
    if (input.wasPressed('left')) this.selected--;
    if (input.wasPressed('right')) this.selected++;
    this.selected = clamp(this.selected, 0, this.choices.length - 1);
    if (this.selected !== previous) audio.play('uiMove');

    // Pointer hover selects, so mouse and keyboard never disagree about which
    // card is "current".
    const pointer = renderer.pointerToVirtual(input.pointer, { x: 0, y: 0 });
    const hovered = this.cardIndexAt(renderer.width, renderer.height, pointer.x, pointer.y);
    if (hovered >= 0 && hovered !== this.selected) {
      this.selected = hovered;
      audio.play('uiMove');
    }

    const clicked = input.wasPressed('fire') && hovered >= 0;
    if (clicked || input.wasPressed('confirm') || input.wasPressed('dash')) {
      const upgrade = this.choices[this.selected];
      if (upgrade === undefined) return;
      this.chosen = true;
      audio.play('upgrade');
      this.onPick(upgrade);
      stack.pop();
      return;
    }
  }

  render(_alpha: number, context: SceneContext): void {
    const { renderer } = context;
    const { width, height } = renderer;

    renderer.overlay('rgba(4, 6, 14, 0.82)');

    renderer.text('CHOOSE AN UPGRADE', width / 2, height * 0.22, {
      size: 15,
      color: UI.textDim,
      align: 'center',
      letterSpacing: '6px',
    });

    const layout = cardLayout(width, height, this.choices.length);
    this.choices.forEach((upgrade, index) => {
      // Stagger the entrance so the eye lands on the cards one at a time.
      const appear = easeOutCubic(clamp((this.time - index * 0.07) / 0.28, 0, 1));
      const x = layout.startX + index * (layout.cardWidth + layout.gap);
      const y = layout.y + (1 - appear) * 26;
      const selected = index === this.selected;
      const accent = UI.rarity[upgrade.rarity];

      renderer.ctx.globalAlpha = appear;

      renderer.rect(x, y, layout.cardWidth, layout.cardHeight, UI.panel);
      renderer.strokeRect(
        x,
        y,
        layout.cardWidth,
        layout.cardHeight,
        selected ? accent : 'rgba(120, 150, 190, 0.28)',
        selected ? 2 : 1,
      );
      if (selected) {
        renderer.ctx.save();
        renderer.glow(accent, 22);
        renderer.strokeRect(x, y, layout.cardWidth, layout.cardHeight, accent, 2);
        renderer.clearGlow();
        renderer.ctx.restore();
      }

      const centreX = x + layout.cardWidth / 2;
      renderer.polygon(
        centreX,
        y + 62,
        selected ? 26 : 23,
        6,
        this.time * (selected ? 1.4 : 0.5),
        accent,
        false,
        selected ? 16 : 6,
      );
      renderer.polygon(centreX, y + 62, 11, 6, -this.time * 0.8, accent, true, 10);

      renderer.text(upgrade.rarity.toUpperCase(), centreX, y + 112, {
        size: 10,
        color: accent,
        align: 'center',
        letterSpacing: '3px',
      });
      renderer.text(upgrade.name, centreX, y + 140, {
        size: 19,
        color: UI.text,
        align: 'center',
        weight: '700',
      });
      wrapText(renderer, upgrade.description, centreX, y + 168, layout.cardWidth - 36, 13);

      renderer.ctx.globalAlpha = 1;
    });

    renderer.text(
      '◄ ► or hover to choose   ·   ENTER / CLICK to take',
      width / 2,
      height * 0.86,
      {
        size: 12,
        color: UI.textDim,
        align: 'center',
        letterSpacing: '1px',
      },
    );
  }

  private cardIndexAt(width: number, height: number, x: number, y: number): number {
    const layout = cardLayout(width, height, this.choices.length);
    for (let i = 0; i < this.choices.length; i++) {
      const cardX = layout.startX + i * (layout.cardWidth + layout.gap);
      if (
        x >= cardX &&
        x <= cardX + layout.cardWidth &&
        y >= layout.y &&
        y <= layout.y + layout.cardHeight
      ) {
        return i;
      }
    }
    return -1;
  }
}

function cardLayout(
  width: number,
  height: number,
  count: number,
): { cardWidth: number; cardHeight: number; gap: number; startX: number; y: number } {
  const gap = 22;
  const cardWidth = Math.min(230, (width - gap * (count + 1)) / count);
  const cardHeight = 250;
  const totalWidth = cardWidth * count + gap * (count - 1);
  return {
    cardWidth,
    cardHeight,
    gap,
    startX: (width - totalWidth) / 2,
    y: height * 0.28,
  };
}

/** Word wrap against measured widths — descriptions vary a lot in length. */
function wrapText(
  renderer: Renderer,
  value: string,
  centreX: number,
  startY: number,
  maxWidth: number,
  size: number,
): void {
  const words = value.split(' ');
  const lines: string[] = [];
  let line = '';

  for (const word of words) {
    const candidate = line.length === 0 ? word : `${line} ${word}`;
    if (renderer.measureText(candidate, size, '400') > maxWidth && line.length > 0) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line.length > 0) lines.push(line);

  lines.forEach((text, index) => {
    renderer.text(text, centreX, startY + index * 19, {
      size,
      color: UI.textDim,
      align: 'center',
      weight: '400',
    });
  });
}
