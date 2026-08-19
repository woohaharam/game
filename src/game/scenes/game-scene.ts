import type { Scene, SceneContext } from '@engine/scene';
import { vec2, type Vec2 } from '@engine/math';
import { World, type PlayerIntent } from '@game/world';
import { WorldRenderer } from '@game/render/world-renderer';
import { Hud } from '@game/ui/hud';
import { Minimap } from '@game/ui/minimap';
import { PauseScene } from './pause-scene';
import { RewardScene } from './reward-scene';
import { GameOverScene } from './game-over-scene';
import { rollChoices } from '@game/progression/upgrades';
import { profileStore } from '@game/save-data';
import { TouchControls } from '@game/ui/touch-controls';

/**
 * The playing scene.
 *
 * Its job is narrow on purpose: translate raw input into a `PlayerIntent`,
 * step the world, draw it, and push an overlay scene when the world raises an
 * event. All the rules live in `World`; all the pixels live in
 * `WorldRenderer`. This file is the seam between them.
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

  constructor(private readonly seed: number) {}

  enter(context: SceneContext): void {
    this.context = context;
    this.world = new World(this.seed, context.audio, context.renderer.camera);
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

    this.world.startRun(this.seed);
    this.worldRenderer.setDepth(this.world.run.depth);
    this.touch.attach(context.input, context.renderer);

    profileStore.update({ runs: profileStore.value.runs + 1 });
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
    const { input, renderer, audio } = context;

    if (input.wasPressed('pause')) {
      context.stack.push(new PauseScene());
      return;
    }

    input.moveVector(this.move);
    this.touch.update(input, renderer);

    // The pointer arrives in CSS pixels; it has to cross the letterbox
    // transform and then the camera transform before it means anything to the
    // simulation.
    renderer.pointerToVirtual(input.pointer, this.pointerVirtual);
    renderer.camera.screenToWorld(this.pointerVirtual.x, this.pointerVirtual.y, this.pointerWorld);

    const aim = this.touch.aimOverride ?? this.pointerWorld;
    const intent: PlayerIntent = {
      move: this.move,
      aimX: aim.x,
      aimY: aim.y,
      firing: input.isHeld('fire') || this.touch.firing,
      dashPressed: input.wasPressed('dash'),
    };

    this.world.update(step, intent);
    audio.updateMusic(step, this.world.tension);
  }

  render(alpha: number, context: SceneContext): void {
    const { renderer } = context;
    renderer.begin(this.worldRenderer.background);
    this.worldRenderer.render(renderer, this.world, alpha);
    this.hud.render(renderer, this.world);
    this.minimap.render(renderer, this.world);
    this.touch.render(renderer, context.input);
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
    this.context.stack.push(
      new RewardScene(choices, (chosen) => {
        this.world.grantUpgrade(chosen);
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
    const profile = profileStore.value;
    profileStore.update({
      bestScore: Math.max(profile.bestScore, run.score),
      bestDepth: Math.max(profile.bestDepth, run.depth),
      totalKills: profile.totalKills + run.kills,
    });
    // Let the death animation and slow motion play before the summary lands.
    window.setTimeout(() => {
      this.context.stack.push(new GameOverScene(run, this.seed));
    }, 1300);
  }
}
