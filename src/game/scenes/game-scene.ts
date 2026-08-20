import type { Scene, SceneContext } from '@engine/scene';
import { vec2, type Vec2 } from '@engine/math';
import { World, type PlayerIntent } from '@game/world';
import { WorldRenderer } from '@game/render/world-renderer';
import { Hud } from '@game/ui/hud';
import { Minimap } from '@game/ui/minimap';
import { PauseScene } from './pause-scene';
import { RewardScene } from './reward-scene';
import { GameOverScene } from './game-over-scene';
import { MenuScene } from './menu-scene';
import { rollChoices } from '@game/progression/upgrades';
import { profileStore } from '@game/save-data';
import { TouchControls } from '@game/ui/touch-controls';
import { ReplayPlayer, ReplayRecorder } from '@game/replay/recorder';
import { saveReplay } from '@game/replay/storage';
import type { ReplayData } from '@game/replay/format';
import { UI } from '@game/render/theme';

/**
 * The playing scene.
 *
 * Its job is narrow on purpose: translate raw input into a `PlayerIntent`,
 * step the world, draw it, and push an overlay scene when the world raises an
 * event. All the rules live in `World`; all the pixels live in
 * `WorldRenderer`. This file is the seam between them.
 *
 * The same scene plays back recordings. In replay mode the intent comes from a
 * `ReplayPlayer` instead of the input layer and rewards resolve from the
 * recorded choice instead of a picker — everything downstream is identical,
 * because a replay is not a different mode of the game, it is the same
 * simulation fed the same decisions.
 */
export class GameScene implements Scene {
  readonly name = 'game';

  private readonly worldRenderer = new WorldRenderer();
  private readonly hud = new Hud();
  private readonly minimap = new Minimap();
  private readonly touch = new TouchControls();

  private readonly move: Vec2 = vec2();
  private readonly pointerWorld: Vec2 = vec2();
  private readonly pointerVirtual: Vec2 = vec2();

  private world!: World;
  private context!: SceneContext;

  private recorder: ReplayRecorder | null = null;
  private playback: ReplayPlayer | null = null;
  /** Live intent buffer, reused so the tick allocates nothing. */
  private readonly intent: PlayerIntent = {
    move: vec2(),
    aimAngle: 0,
    firing: false,
    dashPressed: false,
  };

  /**
   * @param seed  Run seed; ignored when `replay` is given.
   * @param replay  When present, the run is played back rather than played.
   */
  constructor(
    private readonly seed: number,
    private readonly replay: ReplayData | null = null,
  ) {}

  get isReplay(): boolean {
    return this.replay !== null;
  }

  enter(context: SceneContext): void {
    this.context = context;
    const seed = this.replay?.seed ?? this.seed;
    this.world = new World(seed, context.audio, context.renderer.camera);
    this.world.events = {
      onRoomCleared: (room) => {
        // Elites are the paced power spike: one guaranteed choice per elite,
        // so a build comes together at a predictable rate.
        if (room.type !== 'elite') return;
        this.offerReward(1.0);
      },
      onFloorCleared: () => this.descend(),
      onPlayerDied: () => this.finishRun(),
      onBossSpawned: () => context.renderer.camera.addTrauma(0.8),
    };

    this.world.startRun(seed);
    this.worldRenderer.setDepth(this.world.run.depth);

    if (this.replay === null) {
      this.recorder = new ReplayRecorder(seed);
      this.touch.attach(context.input, context.renderer);
      profileStore.update({ runs: profileStore.value.runs + 1 });
    } else {
      this.playback = new ReplayPlayer(this.replay);
    }
  }

  exit(): void {
    this.touch.detach();
  }

  resume(): void {
    this.world.paused = false;
  }

  suspend(): void {
    this.world.paused = true;
  }

  update(step: number, context: SceneContext): void {
    const { input, audio } = context;

    if (this.playback !== null) {
      this.updateReplay(step, context);
      return;
    }

    if (input.wasPressed('pause')) {
      context.stack.push(new PauseScene());
      return;
    }

    const raw = this.readInput(context);
    // Recording sits in front of the simulation, not beside it: the world is
    // fed the quantised intent, so a replay cannot drift from the run.
    const intent = this.recorder === null ? raw : this.recorder.capture(raw);

    this.world.update(step, intent);
    audio.updateMusic(step, this.world.tension);
  }

  /** Builds this tick's intent from keyboard, mouse and touch. */
  private readInput(context: SceneContext): PlayerIntent {
    const { input, renderer } = context;
    input.moveVector(this.move);
    this.touch.update(input, renderer);

    // The pointer arrives in CSS pixels; it has to cross the letterbox
    // transform and then the camera transform before it means anything to the
    // simulation.
    renderer.pointerToVirtual(input.pointer, this.pointerVirtual);
    renderer.camera.screenToWorld(
      this.pointerVirtual.x,
      this.pointerVirtual.y,
      this.pointerWorld,
    );

    const aim = this.touch.aimOverride ?? this.pointerWorld;
    this.intent.move.x = this.move.x;
    this.intent.move.y = this.move.y;
    this.intent.aimAngle = Math.atan2(aim.y - this.world.player.y, aim.x - this.world.player.x);
    this.intent.firing = input.isHeld('fire') || this.touch.firing;
    this.intent.dashPressed = input.wasPressed('dash');
    return this.intent;
  }

  private updateReplay(step: number, context: SceneContext): void {
    const playback = this.playback;
    if (playback === null) return;

    // Any of escape, restart or fire leaves the replay — it is a viewer, and
    // trapping someone in someone else's run would be rude.
    if (
      context.input.wasPressed('pause') ||
      context.input.wasPressed('restart') ||
      context.input.wasPressed('confirm')
    ) {
      context.stack.replaceAll(new MenuScene());
      return;
    }

    if (playback.finished) return;

    this.world.update(step, playback.next());
    context.audio.updateMusic(step, this.world.tension);
    this.worldRenderer.setDepth(this.world.run.depth);
  }

  render(alpha: number, context: SceneContext): void {
    const { renderer } = context;
    renderer.begin(this.worldRenderer.background);
    this.worldRenderer.render(renderer, this.world, alpha);
    this.hud.render(renderer, this.world);
    this.minimap.render(renderer, this.world);
    if (this.playback === null) this.touch.render(renderer, context.input);
    else this.renderReplayOverlay(renderer);
  }

  /** Playback banner and scrub bar, so a replay is never mistaken for play. */
  private renderReplayOverlay(renderer: SceneContext['renderer']): void {
    const playback = this.playback;
    if (playback === null) return;
    const { width, height } = renderer;

    renderer.text('▶ REPLAY', width / 2, height - 78, {
      size: 13,
      color: UI.combo,
      align: 'center',
      letterSpacing: '5px',
      glow: 10,
    });

    const barWidth = width * 0.4;
    const x = (width - barWidth) / 2;
    const y = height - 66;
    renderer.rect(x, y, barWidth, 3, 'rgba(255,255,255,0.15)');
    renderer.rect(x, y, barWidth * playback.progress, 3, UI.combo);

    if (playback.finished) {
      renderer.text('REPLAY COMPLETE — press ENTER for the menu', width / 2, height - 44, {
        size: 12,
        color: UI.textDim,
        align: 'center',
      });
    }
  }

  private offerReward(luck: number): void {
    const choices = rollChoices(
      this.world.rng,
      this.world.run.upgrades,
      this.world.run.depth,
      3,
      luck,
    );
    if (choices.length === 0) return;

    // The roll itself must happen in both modes — it draws from the gameplay
    // RNG, so skipping it during playback would desynchronise every later
    // draw. Only the *picking* differs.
    const playback = this.playback;
    if (playback !== null) {
      const recorded = playback.takeChoice();
      const chosen = choices.find((c) => c.id === recorded) ?? choices[0];
      if (chosen !== undefined) this.world.grantUpgrade(chosen);
      return;
    }

    this.context.stack.push(
      new RewardScene(choices, (chosen) => {
        this.world.grantUpgrade(chosen);
        this.recorder?.recordChoice(chosen.id);
      }),
    );
  }

  private descend(): void {
    const nextDepth = this.world.run.depth + 1;
    profileStore.update({
      bossesFelled: profileStore.value.bossesFelled + 1,
      bestDepth: Math.max(profileStore.value.bestDepth, this.world.run.depth),
    });
    this.world.run.advanceFloor();
    this.world.startFloor(nextDepth);
    this.worldRenderer.setDepth(nextDepth);
    // Descending is the run's high point — pay it off with a strong pick.
    this.offerReward(1.6);
  }

  private finishRun(): void {
    const run = this.world.run;
    if (this.playback !== null) return; // a replay's ending is not a new record

    const profile = profileStore.value;
    profileStore.update({
      bestScore: Math.max(profile.bestScore, run.score),
      bestDepth: Math.max(profile.bestDepth, run.depth),
      totalKills: profile.totalKills + run.kills,
    });

    const replay =
      this.recorder?.finish({
        score: run.score,
        depth: run.depth,
        kills: run.kills,
        elapsed: run.elapsed,
      }) ?? null;
    if (replay !== null) saveReplay(replay);

    // Let the death animation and slow motion play before the summary lands.
    window.setTimeout(() => {
      this.context.stack.push(new GameOverScene(run, this.seed, replay));
    }, 1300);
  }
}
