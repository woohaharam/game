import { vec2 } from '@engine/math';
import type { PlayerIntent } from '@game/world';
import {
  REPLAY_VERSION,
  dequantise,
  intentsEqual,
  quantise,
  type QuantisedIntent,
  type ReplayChoice,
  type ReplayData,
  type ReplayFrame,
} from './format';

/**
 * Records a run as it is played.
 *
 * The recorder sits *in front of* the simulation, not beside it: the caller
 * hands it a raw intent and uses the quantised one it returns. That ordering is
 * the whole trick — the simulation only ever sees values that survive a
 * round-trip through the recording format, so a replay cannot drift from the
 * run it recorded.
 */
export class ReplayRecorder {
  private readonly frames: ReplayFrame[] = [];
  private readonly choices: ReplayChoice[] = [];
  private readonly scratch: PlayerIntent = {
    move: vec2(),
    aimAngle: 0,
    firing: false,
    dashPressed: false,
  };

  private previous: QuantisedIntent | null = null;
  private tick = 0;

  constructor(readonly seed: number) {}

  get tickCount(): number {
    return this.tick;
  }

  get frameCount(): number {
    return this.frames.length;
  }

  /**
   * Quantises `intent`, stores it if it differs from the last one, and returns
   * the value the simulation should actually be given.
   */
  capture(intent: PlayerIntent): PlayerIntent {
    const q = quantise(intent);

    // A dash is an edge, not a state: it must be stored on the exact tick it
    // fires even when everything else is unchanged, or the replay silently
    // drops the dodge.
    if (this.previous === null || q.dash || !intentsEqual(this.previous, q)) {
      this.frames.push({ tick: this.tick, ...q });
      this.previous = q;
    }

    this.tick++;
    return dequantise(q, this.scratch);
  }

  /** Records an upgrade taken at the current tick. */
  recordChoice(upgradeId: string): void {
    this.choices.push({ tick: this.tick, upgradeId });
  }

  finish(meta: Omit<ReplayData['meta'], 'recordedAt'>): ReplayData {
    return {
      version: REPLAY_VERSION,
      seed: this.seed,
      ticks: this.tick,
      frames: [...this.frames],
      choices: [...this.choices],
      meta: { ...meta, recordedAt: Date.now() },
    };
  }
}

/**
 * Plays a recording back into the simulation.
 *
 * Frames are sparse, so the player holds the last one until the next arrives —
 * the same "input is held until it changes" assumption the recorder used.
 * `dash` is the exception: it is an edge, and is delivered only on its own
 * tick.
 */
export class ReplayPlayer {
  private frameIndex = 0;
  private tick = 0;
  private choiceIndex = 0;
  private current: ReplayFrame | null = null;

  private readonly scratch: PlayerIntent = {
    move: vec2(),
    aimAngle: 0,
    firing: false,
    dashPressed: false,
  };

  constructor(readonly replay: ReplayData) {}

  get currentTick(): number {
    return this.tick;
  }

  get totalTicks(): number {
    return this.replay.ticks;
  }

  get finished(): boolean {
    return this.tick >= this.replay.ticks;
  }

  get progress(): number {
    return this.replay.ticks === 0 ? 1 : Math.min(1, this.tick / this.replay.ticks);
  }

  /** Advances one tick and returns the intent the simulation should receive. */
  next(): PlayerIntent {
    let frame = this.replay.frames[this.frameIndex];
    while (frame !== undefined && frame.tick <= this.tick) {
      this.current = frame;
      this.frameIndex++;
      frame = this.replay.frames[this.frameIndex];
    }

    const active = this.current;
    if (active === null) {
      this.scratch.move.x = 0;
      this.scratch.move.y = 0;
      this.scratch.firing = false;
      this.scratch.dashPressed = false;
      this.tick++;
      return this.scratch;
    }

    dequantise(active, this.scratch);
    // Only fire the dash on the tick it was stored for.
    this.scratch.dashPressed = active.dash && active.tick === this.tick;
    this.tick++;
    return this.scratch;
  }

  /**
   * Returns the upgrade chosen at or before the current tick, if one is due.
   * Called when the run reaches a reward, in place of showing the picker.
   */
  takeChoice(): string | null {
    const choice = this.replay.choices[this.choiceIndex];
    if (choice === undefined) return null;
    this.choiceIndex++;
    return choice.upgradeId;
  }
}
