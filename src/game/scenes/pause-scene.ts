import type { Scene, SceneContext } from '@engine/scene';
import { UI } from '@game/render/theme';
import { profileStore } from '@game/save-data';
import { MenuScene } from './menu-scene';

/**
 * Pause overlay.
 *
 * Transparent so the frozen battlefield shows through — it reads as the game
 * held mid-breath rather than as a screen the player was taken to. Doubles as
 * the options panel, since audio and quality are exactly what someone reaches
 * for the moment they hit Escape.
 */
export class PauseScene implements Scene {
  readonly name = 'pause';
  readonly transparent = true;

  private time = 0;

  enter(context: SceneContext): void {
    context.audio.play('uiSelect', 0.7);
  }

  update(step: number, context: SceneContext): void {
    this.time += step;
    const { input, stack, audio, renderer } = context;

    if (input.wasPressed('pause') || input.wasPressed('confirm')) {
      audio.play('uiSelect');
      stack.pop();
      return;
    }
    if (input.wasPressed('restart')) {
      audio.play('uiSelect');
      stack.replaceAll(new MenuScene());
      return;
    }
    if (input.wasPressed('fire')) {
      const pointer = renderer.pointerToVirtual(input.pointer, { x: 0, y: 0 });
      // The two toggles are the only clickable things here, so a simple band
      // test is enough — no need for a general widget system.
      if (Math.abs(pointer.y - renderer.height * 0.6) < 16) {
        const muted = audio.toggleMute();
        profileStore.update({ muted });
      } else if (Math.abs(pointer.y - renderer.height * 0.66) < 16) {
        renderer.lowQuality = !renderer.lowQuality;
        profileStore.update({ lowQuality: renderer.lowQuality });
      }
    }
  }

  render(_alpha: number, context: SceneContext): void {
    const { renderer, audio } = context;
    const { width, height } = renderer;

    renderer.overlay('rgba(4, 6, 14, 0.78)');
    renderer.text('PAUSED', width / 2, height * 0.34, {
      size: 44,
      color: UI.text,
      align: 'center',
      weight: '700',
      letterSpacing: '10px',
      glow: 18,
    });

    const rows: [string, string][] = [
      ['ESC / P', 'resume'],
      ['R', 'abandon run'],
    ];
    rows.forEach(([key, label], index) => {
      renderer.text(`${key}  ·  ${label}`, width / 2, height * 0.46 + index * 24, {
        size: 14,
        color: UI.textDim,
        align: 'center',
      });
    });

    renderer.text(`SOUND: ${audio.muted ? 'OFF' : 'ON'}`, width / 2, height * 0.6, {
      size: 15,
      color: UI.combo,
      align: 'center',
      letterSpacing: '2px',
    });
    renderer.text(
      `EFFECTS: ${renderer.lowQuality ? 'LOW' : 'HIGH'}`,
      width / 2,
      height * 0.66,
      { size: 15, color: UI.combo, align: 'center', letterSpacing: '2px' },
    );
    renderer.text('click to toggle', width / 2, height * 0.72, {
      size: 11,
      color: UI.textDim,
      align: 'center',
    });
  }
}
