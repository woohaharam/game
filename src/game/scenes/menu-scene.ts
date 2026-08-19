import type { Scene, SceneContext } from '@engine/scene';
import { clamp } from '@engine/math';
import { Rng } from '@engine/rng';
import { ParticleSystem } from '@engine/particles';
import { UI } from '@game/render/theme';
import { profileStore } from '@game/save-data';
import { GameScene } from './game-scene';

/**
 * Title screen.
 *
 * Also the seed entry point: typing a seed and replaying it is the feature
 * that turns "I had a great run" into something another person can experience
 * for themselves, so it gets a place on the front screen rather than being
 * buried in options.
 *
 * The drifting particle field exists to prove the engine is live before the
 * player has pressed anything — a static title card makes a browser game look
 * like it failed to load.
 */
export class MenuScene implements Scene {
  readonly name = 'menu';

  private time = 0;
  private seedText = '';
  private editingSeed = false;
  private particles!: ParticleSystem;
  private rng = new Rng(Date.now() >>> 0);
  private keyHandler: ((event: KeyboardEvent) => void) | null = null;

  enter(context: SceneContext): void {
    this.particles = new ParticleSystem(this.rng, 240);
    this.seedText = profileStore.value.lastSeed;
    context.renderer.lowQuality = profileStore.value.lowQuality;
    if (profileStore.value.muted !== context.audio.muted) context.audio.toggleMute();

    // Seed entry needs real text input, which the action-based Input layer
    // deliberately does not model. A scoped listener is the honest way to do
    // it, and it is removed the moment the scene exits.
    this.keyHandler = (event: KeyboardEvent): void => {
      if (!this.editingSeed) return;
      if (event.key === 'Backspace') this.seedText = this.seedText.slice(0, -1);
      else if (/^[a-zA-Z0-9 -]$/.test(event.key) && this.seedText.length < 18) {
        this.seedText += event.key;
      }
    };
    window.addEventListener('keydown', this.keyHandler);
  }

  exit(): void {
    if (this.keyHandler !== null) window.removeEventListener('keydown', this.keyHandler);
    this.keyHandler = null;
  }

  update(step: number, context: SceneContext): void {
    this.time += step;
    const { input, audio, renderer, stack } = context;

    // The first interaction anywhere is what unlocks audio in every browser.
    if (input.wasPressed('fire') || input.wasPressed('confirm')) audio.unlock();

    this.particles.update(step);
    if (this.rng.chance(0.6)) {
      const x = this.rng.float(0, renderer.width);
      this.particles.emit(
        x,
        renderer.height + 10,
        this.rng.float(-14, 14),
        this.rng.float(-40, -14),
        this.rng.chance(0.15) ? '#ff5c7a' : '#2b6f96',
        this.rng.float(2.5, 5.5),
        this.rng.float(1, 3),
      );
    }

    const pointer = renderer.pointerToVirtual(input.pointer, { x: 0, y: 0 });
    const overSeed = Math.abs(pointer.y - renderer.height * 0.66) < 18;

    if (input.wasPressed('fire')) {
      this.editingSeed = overSeed;
      if (!overSeed) {
        this.start(context);
        return;
      }
      audio.play('uiMove');
    }

    if (input.wasPressed('confirm')) {
      if (this.editingSeed) this.editingSeed = false;
      else {
        this.start(context);
        return;
      }
    }

    void stack;
  }

  private start(context: SceneContext): void {
    const trimmed = this.seedText.trim();
    // A typed seed is hashed so words work as well as numbers; an empty box
    // means "surprise me".
    const seed =
      trimmed.length === 0
        ? Math.floor(Math.random() * 0xffffffff) >>> 0
        : /^\d+$/.test(trimmed)
          ? Number(trimmed) >>> 0
          : Rng.fromString(trimmed).seed;

    profileStore.update({ lastSeed: trimmed });
    context.audio.unlock();
    context.audio.play('uiSelect');
    context.stack.replaceAll(new GameScene(seed));
  }

  render(alpha: number, context: SceneContext): void {
    const { renderer } = context;
    const { width, height } = renderer;
    renderer.begin('#05060d');
    this.particles.render(renderer, alpha);

    const bob = Math.sin(this.time * 1.4) * 4;

    // Rotating rings behind the title: cheap, and it gives the screen depth.
    for (let i = 0; i < 3; i++) {
      const radius = 84 + i * 26;
      renderer.ctx.save();
      renderer.ctx.globalAlpha = 0.16 - i * 0.04;
      renderer.ring(width / 2, height * 0.3 + bob, radius, '#4cc9ff', 2, 20);
      renderer.ctx.restore();
    }
    renderer.polygon(
      width / 2,
      height * 0.3 + bob,
      26,
      3,
      this.time * 0.7,
      '#6ef2ff',
      true,
      26,
    );

    renderer.text('NEON DEPTHS', width / 2, height * 0.45 + bob, {
      size: 58,
      color: UI.text,
      align: 'center',
      weight: '700',
      letterSpacing: '12px',
      glow: 26,
    });
    renderer.text('a procedural action roguelike', width / 2, height * 0.51 + bob, {
      size: 13,
      color: UI.textDim,
      align: 'center',
      letterSpacing: '5px',
    });

    const pulse = 0.55 + Math.sin(this.time * 3) * 0.45;
    renderer.ctx.globalAlpha = clamp(pulse, 0, 1);
    renderer.text('CLICK OR PRESS ENTER TO DESCEND', width / 2, height * 0.59, {
      size: 15,
      color: UI.combo,
      align: 'center',
      letterSpacing: '4px',
      glow: 10,
    });
    renderer.ctx.globalAlpha = 1;

    // Seed box.
    const boxWidth = 260;
    const boxX = (width - boxWidth) / 2;
    const boxY = height * 0.66 - 16;
    renderer.rect(boxX, boxY, boxWidth, 32, 'rgba(10, 16, 28, 0.9)');
    renderer.strokeRect(
      boxX,
      boxY,
      boxWidth,
      32,
      this.editingSeed ? UI.combo : 'rgba(120, 150, 190, 0.3)',
      this.editingSeed ? 2 : 1,
    );
    const caret = this.editingSeed && Math.floor(this.time * 2) % 2 === 0 ? '|' : '';
    renderer.text(
      this.seedText.length > 0
        ? this.seedText + caret
        : this.editingSeed
          ? caret
          : 'seed (optional)',
      width / 2,
      boxY + 21,
      {
        size: 13,
        color: this.seedText.length > 0 ? UI.text : UI.textDim,
        align: 'center',
        letterSpacing: '1px',
      },
    );

    const profile = profileStore.value;
    renderer.text(
      `BEST ${profile.bestScore.toLocaleString()}   ·   DEEPEST FLOOR ${profile.bestDepth}   ·   ${profile.runs} RUNS`,
      width / 2,
      height * 0.78,
      { size: 12, color: UI.textDim, align: 'center', letterSpacing: '2px' },
    );

    const controls = [
      'WASD / ARROWS  move',
      'MOUSE  aim      CLICK / J  fire',
      'SPACE / SHIFT  dash      ESC  pause',
    ];
    controls.forEach((line, index) => {
      renderer.text(line, width / 2, height * 0.86 + index * 18, {
        size: 12,
        color: 'rgba(127, 147, 173, 0.75)',
        align: 'center',
      });
    });
  }
}
