import type { Input } from './input';
import type { Renderer } from './renderer';
import type { AudioBus } from './audio';

/** Services every scene is handed; keeps scenes free of global singletons. */
export interface SceneContext {
  readonly input: Input;
  readonly renderer: Renderer;
  readonly audio: AudioBus;
  readonly stack: SceneStack;
}

export interface Scene {
  readonly name: string;
  /** Called once when the scene is pushed. */
  enter?(context: SceneContext): void;
  /** Called once when the scene is popped or replaced. */
  exit?(): void;
  /** Called when a scene is pushed on top of this one. */
  suspend?(): void;
  /** Called when the scene above this one is popped. */
  resume?(): void;
  update(step: number, context: SceneContext): void;
  render(alpha: number, context: SceneContext): void;
  /**
   * When true this scene lets the one below it keep drawing — how the pause
   * menu renders over a frozen battlefield instead of a black screen.
   */
  readonly transparent?: boolean;
}

/**
 * Stack of scenes. Only the topmost scene updates; scenes render bottom-up
 * from the deepest opaque scene, so overlays compose without every scene
 * having to know what might sit under it.
 */
export class SceneStack {
  private readonly scenes: Scene[] = [];
  private context!: SceneContext;

  bind(context: SceneContext): void {
    this.context = context;
  }

  get current(): Scene | undefined {
    return this.scenes[this.scenes.length - 1];
  }

  get depth(): number {
    return this.scenes.length;
  }

  push(scene: Scene): void {
    this.current?.suspend?.();
    this.scenes.push(scene);
    scene.enter?.(this.context);
  }

  pop(): void {
    const scene = this.scenes.pop();
    scene?.exit?.();
    this.current?.resume?.();
  }

  /** Clears the whole stack and starts fresh with `scene`. */
  replaceAll(scene: Scene): void {
    while (this.scenes.length > 0) this.pop();
    this.push(scene);
  }

  update(step: number): void {
    this.current?.update(step, this.context);
  }

  render(alpha: number): void {
    // Walk down to the deepest scene that actually paints a background.
    let start = this.scenes.length - 1;
    while (start > 0 && this.scenes[start]?.transparent === true) start--;
    for (let i = start; i < this.scenes.length; i++) {
      this.scenes[i]?.render(alpha, this.context);
    }
  }
}
