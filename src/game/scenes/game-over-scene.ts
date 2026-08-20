import type { Scene, SceneContext } from '@engine/scene';
import { clamp, easeOutCubic } from '@engine/math';
import { UI } from '@game/render/theme';
import { getUpgrade } from '@game/progression/upgrades';
import { profileStore } from '@game/save-data';
import type { RunState } from '@game/run-state';
import { GameScene } from './game-scene';
import { MenuScene } from './menu-scene';
import type { ReplayData } from '@game/replay/format';
import { exportReplay, replaySize } from '@game/replay/storage';

/**
 * Death summary.
 *
 * The single most important screen in a roguelike, because it is where the
 * player decides whether to press R. So it does three things: says how the run
 * went in numbers, shows the *build* they assembled (the part people actually
 * want to talk about), and puts "run again" one keypress away — with the same
 * seed offered, since the usual reaction to a bad death is "I could beat that
 * floor if I got it again".
 */
export class GameOverScene implements Scene {
  readonly name = 'game-over';

  private time = 0;
  private readonly summary: [string, string][];
  private readonly newBest: boolean;

  /** Transient status line for the copy-to-clipboard action. */
  private notice = '';
  private noticeTimer = 0;

  constructor(
    private readonly run: RunState,
    private readonly seed: number,
    private readonly replay: ReplayData | null = null,
  ) {
    // Snapshot the profile before it is compared, so "NEW BEST" is honest even
    // though the store was already updated when the run ended.
    this.newBest = run.score >= profileStore.value.bestScore && run.score > 0;
    const minutes = Math.floor(run.elapsed / 60);
    const seconds = Math.floor(run.elapsed % 60);

    this.summary = [
      ['FLOOR REACHED', String(run.depth)],
      ['ENEMIES DESTROYED', String(run.kills)],
      ['ROOMS CLEARED', String(run.roomsCleared)],
      ['TIME', `${minutes}:${seconds.toString().padStart(2, '0')}`],
      ['BEST SCORE', profileStore.value.bestScore.toLocaleString()],
    ];
  }

  enter(context: SceneContext): void {
    context.audio.play('gameOver');
  }

  update(step: number, context: SceneContext): void {
    this.time += step;
    const { input, stack, audio } = context;
    // Brief lockout so a shot fired at the moment of death does not skip the
    // screen before the player has seen it.
    if (this.time < 0.6) {
      return;
    }

    this.noticeTimer = Math.max(0, this.noticeTimer - step);

    if (this.replay !== null && input.wasPressed('up')) {
      audio.play('uiSelect');
      stack.replaceAll(new GameScene(this.seed, this.replay));
      return;
    }
    if (this.replay !== null && input.wasPressed('down')) {
      audio.play('uiMove');
      this.copyReplay();
      return;
    }
    if (
      input.wasPressed('restart') ||
      input.wasPressed('confirm') ||
      input.wasPressed('fire')
    ) {
      audio.play('uiSelect');
      stack.replaceAll(new GameScene(this.seed));
      return;
    }
    if (input.wasPressed('pause')) {
      audio.play('uiSelect');
      stack.replaceAll(new MenuScene());
      return;
    }
  }

  /**
   * Copies the run to the clipboard as text.
   *
   * Clipboard rather than a file download: downloads are blocked outright in
   * some embeddings, and a text blob pastes into a message or an issue, which
   * is where a shared run actually goes.
   */
  private copyReplay(): void {
    const replay = this.replay;
    if (replay === null) return;
    const text = exportReplay(replay);

    // lib.dom types `navigator.clipboard` as always present. It is not: the
    // API is gated on a secure context, so a page served over plain http has
    // no clipboard at all. Narrow it rather than let the optional chain read
    // as dead code.
    const { clipboard } = navigator as unknown as { clipboard?: Clipboard };
    if (clipboard === undefined) {
      this.notice = 'Clipboard needs a secure (https) page';
      this.noticeTimer = 3;
      return;
    }

    void clipboard
      .writeText(text)
      .then(() => {
        this.notice = `Replay copied — ${(replaySize(replay) / 1024).toFixed(1)} KB`;
        this.noticeTimer = 3;
      })
      .catch(() => {
        // Clipboard access can be denied outright; say so rather than
        // pretending the copy worked.
        this.notice = 'Clipboard blocked by the browser';
        this.noticeTimer = 3;
      });
  }

  render(_alpha: number, context: SceneContext): void {
    const { renderer } = context;
    const { width, height } = renderer;
    renderer.begin('#05060d');

    const appear = easeOutCubic(clamp(this.time / 0.5, 0, 1));
    renderer.ctx.globalAlpha = appear;

    renderer.text('RUN OVER', width / 2, height * 0.16, {
      size: 46,
      color: UI.danger,
      align: 'center',
      weight: '700',
      letterSpacing: '10px',
      glow: 22,
    });

    renderer.text(this.run.score.toLocaleString(), width / 2, height * 0.3, {
      size: 62,
      color: UI.text,
      align: 'center',
      weight: '700',
      glow: 16,
    });
    if (this.newBest) {
      const pulse = 0.6 + Math.sin(this.time * 6) * 0.4;
      renderer.ctx.globalAlpha = appear * pulse;
      renderer.text('NEW BEST', width / 2, height * 0.35, {
        size: 14,
        color: UI.coin,
        align: 'center',
        letterSpacing: '6px',
        glow: 12,
      });
      renderer.ctx.globalAlpha = appear;
    }

    // Left column: the run's numbers.
    const statsX = width * 0.28;
    this.summary.forEach(([label, value], index) => {
      const y = height * 0.46 + index * 26;
      renderer.text(label, statsX - 14, y, { size: 12, color: UI.textDim, align: 'right' });
      renderer.text(value, statsX + 14, y, { size: 15, color: UI.text, weight: '700' });
    });

    // Right column: the build, which is what a player retells afterwards.
    const buildX = width * 0.62;
    renderer.text('YOUR BUILD', buildX, height * 0.44, {
      size: 12,
      color: UI.textDim,
      letterSpacing: '3px',
    });

    const counts = new Map<string, number>();
    for (const id of this.run.upgrades) counts.set(id, (counts.get(id) ?? 0) + 1);
    const entries = [...counts.entries()];

    if (entries.length === 0) {
      renderer.text('— none —', buildX, height * 0.5, { size: 13, color: UI.textDim });
    }
    entries.slice(0, 9).forEach(([id, count], index) => {
      const upgrade = getUpgrade(id);
      if (upgrade === undefined) return;
      renderer.text(
        count > 1 ? `${upgrade.name} ×${count}` : upgrade.name,
        buildX,
        height * 0.5 + index * 20,
        { size: 13, color: UI.rarity[upgrade.rarity] },
      );
    });
    if (entries.length > 9) {
      renderer.text(`+${entries.length - 9} more`, buildX, height * 0.5 + 9 * 20, {
        size: 12,
        color: UI.textDim,
      });
    }

    renderer.text(`SEED ${this.seed}`, width / 2, height * 0.88, {
      size: 12,
      color: UI.textDim,
      align: 'center',
      letterSpacing: '2px',
    });
    const hints =
      this.replay === null
        ? 'R / CLICK — retry this seed      ESC — main menu'
        : 'R — retry seed    ↑ watch replay    ↓ copy replay    ESC — menu';
    renderer.text(hints, width / 2, height * 0.94, {
      size: 13,
      color: UI.combo,
      align: 'center',
    });

    if (this.noticeTimer > 0) {
      renderer.text(this.notice, width / 2, height * 0.985, {
        size: 12,
        color: UI.coin,
        align: 'center',
      });
    }

    renderer.ctx.globalAlpha = 1;
  }
}
