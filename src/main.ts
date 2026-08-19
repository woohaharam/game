import { GameLoop } from '@engine/loop';
import { Input } from '@engine/input';
import { Renderer } from '@engine/renderer';
import { AudioBus } from '@engine/audio';
import { SceneStack, type SceneContext } from '@engine/scene';
import { Rng } from '@engine/rng';
import { VIEW } from '@game/config';
import { MenuScene } from '@game/scenes/menu-scene';
import { profileStore } from '@game/save-data';

/**
 * Bootstrap.
 *
 * Wires the engine services together, hands them to the scene stack, and
 * starts the loop. Nothing else — every decision beyond "which scene starts"
 * belongs to the game layer.
 */
function boot(): void {
  const canvas = document.getElementById('game') as HTMLCanvasElement | null;
  if (canvas === null) throw new Error('#game canvas is missing from the document');

  const renderer = new Renderer(canvas, {
    width: VIEW.width,
    height: VIEW.height,
    rng: new Rng(0xc0ffee),
  });
  const input = new Input(canvas);
  const audio = new AudioBus();
  const stack = new SceneStack();

  renderer.lowQuality = profileStore.value.lowQuality;
  if (profileStore.value.muted) audio.toggleMute();

  const context: SceneContext = { input, renderer, audio, stack };
  stack.bind(context);

  // Browsers refuse to create an AudioContext before a real user gesture, so
  // the bus is unlocked on the first interaction of any kind and never again.
  const unlock = (): void => {
    audio.unlock();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);

  const loop = new GameLoop({
    update: (step) => {
      stack.update(step);
      // Edge state is cleared centrally, once per tick, after the whole stack
      // has run. Letting each scene do it invites the bug where a scene
      // transition leaves a press latched and the new scene immediately
      // consumes the keystroke that dismissed the old one.
      input.endTick();
    },
    render: (alpha) => stack.render(alpha),
  });

  const resize = (): void => renderer.resize();
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
  resize();

  // The arena is authored landscape. On a touch device held in portrait, CSS
  // covers the canvas with a rotate prompt; stop the loop behind it so the
  // player is not dropped back into a fight that ran on without them.
  const portrait = window.matchMedia('(orientation: portrait) and (pointer: coarse)');

  const shouldRun = (): boolean => !document.hidden && !portrait.matches;
  const sync = (): void => {
    if (shouldRun()) loop.start();
    else loop.stop();
    renderer.resize();
  };

  // `visibilitychange` matters separately: a backgrounded tab still fires rAF
  // on some platforms and not on others, so stopping outright makes the
  // behaviour uniform and keeps a hidden tab from burning battery.
  document.addEventListener('visibilitychange', sync);
  portrait.addEventListener('change', sync);

  stack.push(new MenuScene());
  sync();

  document.getElementById('boot')?.remove();

  // Exposed for debugging and for the automated smoke test; harmless in prod.
  Object.assign(window, { __neon: { loop, renderer, stack, audio } });
}

boot();
