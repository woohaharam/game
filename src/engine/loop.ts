/**
 * Fixed-timestep game loop with rendering interpolation.
 *
 * Simulating with a variable dt makes physics and hit detection depend on the
 * player's frame rate — a 144 Hz machine resolves collisions the 30 Hz machine
 * tunnels straight through. So the simulation advances in fixed slices and the
 * renderer interpolates between the last two states, which keeps motion smooth
 * on displays that do not divide evenly into the tick rate.
 *
 * Pattern is Glenn Fiedler's "Fix Your Timestep"; the spiral-of-death guard
 * matters most: if a tab is backgrounded for 10s we must not try to catch up
 * on 600 ticks at once.
 */
export interface LoopCallbacks {
  /** Advances the simulation by exactly `step` seconds. */
  update(step: number): void;
  /**
   * Draws one frame. `alpha` is how far the renderer sits between the previous
   * and current simulation state, in [0, 1).
   */
  render(alpha: number): void;
}

export interface LoopStats {
  fps: number;
  /** Simulation ticks executed during the last rendered frame. */
  ticksLastFrame: number;
  /** Milliseconds spent inside update()+render() last frame. */
  frameMs: number;
}

export class GameLoop {
  private rafId = 0;
  private running = false;
  private previousTime = 0;
  private accumulator = 0;
  private fpsWindow = 0;
  private fpsFrames = 0;

  readonly stats: LoopStats = { fps: 0, ticksLastFrame: 0, frameMs: 0 };

  constructor(
    private readonly callbacks: LoopCallbacks,
    /** Simulation rate in Hz. 60 keeps the tuning numbers human-readable. */
    readonly tickRate = 60,
    /** Never simulate more than this many ticks in one frame. */
    private readonly maxTicksPerFrame = 5,
  ) {}

  get step(): number {
    return 1 / this.tickRate;
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.previousTime = performance.now();
    this.accumulator = 0;
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.frame);

    const frameStart = now;
    // Clamp elapsed time so an alt-tab or a breakpoint cannot queue up a
    // hundred ticks and freeze the page trying to catch up.
    const elapsed = Math.min((now - this.previousTime) / 1000, 0.25);
    this.previousTime = now;
    this.accumulator += elapsed;

    const step = this.step;
    let ticks = 0;
    while (this.accumulator >= step && ticks < this.maxTicksPerFrame) {
      this.callbacks.update(step);
      this.accumulator -= step;
      ticks++;
    }
    // Dropped time is discarded rather than carried: the sim runs in slow
    // motion for one frame instead of spiralling.
    if (ticks === this.maxTicksPerFrame) this.accumulator = 0;

    this.callbacks.render(this.accumulator / step);

    this.stats.ticksLastFrame = ticks;
    this.stats.frameMs = performance.now() - frameStart;

    this.fpsFrames++;
    this.fpsWindow += elapsed;
    if (this.fpsWindow >= 0.5) {
      this.stats.fps = Math.round(this.fpsFrames / this.fpsWindow);
      this.fpsFrames = 0;
      this.fpsWindow = 0;
    }
  };
}
