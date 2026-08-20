import { TAU } from '@engine/math';
import type { PlayerIntent } from '@game/world';

/**
 * Replay encoding.
 *
 * The simulation is already deterministic from a seed, so a run is fully
 * described by that seed plus the sequence of intents the player fed it. That
 * makes a replay a recording of *decisions*, not of frames — a few kilobytes
 * instead of a video, and it re-simulates rather than plays back, so it stays
 * correct at any resolution and proves the determinism claim rather than
 * merely asserting it.
 *
 * Three things make it small:
 *
 * 1. **Quantisation.** Intents are snapped to a fixed grid *before* the
 *    simulation sees them, so what is recorded is exactly what ran. Quantising
 *    afterwards would be lossy and the replay would drift.
 * 2. **Change-only frames.** Input is held far more often than it changes, so
 *    only ticks where the quantised intent differs are stored, each with a
 *    varint delta from the previous stored tick.
 * 3. **Delta-coded aim.** A mouse moves in small increments; storing the change
 *    in angle costs one byte where the absolute value costs two.
 */

/**
 * Bumped whenever the byte layout **or the simulation** changes.
 *
 * A replay stores decisions, not outcomes, so it is only meaningful against
 * the rules that produced it. Version 2 exists because the maths changed, not
 * the format: swapping `Math.hypot` for `sqrt(x*x + y*y)` shifts results in the
 * last few digits, and over a few thousand ticks that is enough to send a run
 * somewhere else entirely. A stale replay would play back plausibly and
 * wrongly, which is worse than refusing it.
 */
export const REPLAY_VERSION = 2;

const MAGIC = 0x4e44; // "ND"

/**
 * Aim resolution: 1/1024 turn ≈ 0.35°.
 *
 * Chosen against the weapon rather than the display — base spread is ±2.6°, so
 * a third of a degree is already below the noise floor of the shot itself.
 * Finer steps only make aim deltas cost more bytes.
 */
const AIM_STEPS = 1024;
/** Move components are stored as signed bytes over [-1, 1]. */
const MOVE_SCALE = 127;

export interface QuantisedIntent {
  /** Move X in [-127, 127]. */
  moveX: number;
  moveY: number;
  /** Aim angle index in [0, AIM_STEPS). */
  aim: number;
  firing: boolean;
  dash: boolean;
}

/** Snaps a raw intent onto the recording grid. */
export function quantise(intent: PlayerIntent): QuantisedIntent {
  const angle = ((intent.aimAngle % TAU) + TAU) % TAU;
  return {
    moveX: Math.max(-MOVE_SCALE, Math.min(MOVE_SCALE, Math.round(intent.move.x * MOVE_SCALE))),
    moveY: Math.max(-MOVE_SCALE, Math.min(MOVE_SCALE, Math.round(intent.move.y * MOVE_SCALE))),
    aim: Math.round((angle / TAU) * AIM_STEPS) % AIM_STEPS,
    firing: intent.firing,
    dash: intent.dashPressed,
  };
}

/**
 * Expands a quantised intent back into the shape the simulation consumes.
 * `out` is reused so the hot path allocates nothing.
 */
export function dequantise(q: QuantisedIntent, out: PlayerIntent): PlayerIntent {
  out.move.x = q.moveX / MOVE_SCALE;
  out.move.y = q.moveY / MOVE_SCALE;
  out.aimAngle = (q.aim / AIM_STEPS) * TAU;
  out.firing = q.firing;
  out.dashPressed = q.dash;
  return out;
}

export function intentsEqual(a: QuantisedIntent, b: QuantisedIntent): boolean {
  return (
    a.moveX === b.moveX &&
    a.moveY === b.moveY &&
    a.aim === b.aim &&
    a.firing === b.firing &&
    a.dash === b.dash
  );
}

/** A quantised intent stamped with the tick it takes effect on. */
export interface ReplayFrame extends QuantisedIntent {
  tick: number;
}

/** A discrete choice the player made outside the movement stream. */
export interface ReplayChoice {
  tick: number;
  upgradeId: string;
}

export interface ReplayData {
  version: number;
  seed: number;
  /** Total simulation ticks the run lasted. */
  ticks: number;
  frames: ReplayFrame[];
  choices: ReplayChoice[];
  /** Summary shown before playback; not used by the simulation. */
  meta: {
    score: number;
    depth: number;
    kills: number;
    /** Wall-clock seconds of simulated time. */
    elapsed: number;
    /** Unix ms when the run finished. */
    recordedAt: number;
  };
}

// ---------------------------------------------------------------------------
// Binary codec
// ---------------------------------------------------------------------------

/** Growable byte sink with LEB128-style varints. */
class ByteWriter {
  private bytes: number[] = [];

  u8(value: number): void {
    this.bytes.push(value & 0xff);
  }

  u16(value: number): void {
    this.u8(value >> 8);
    this.u8(value);
  }

  u32(value: number): void {
    this.u16(value >>> 16);
    this.u16(value & 0xffff);
  }

  /** Unsigned varint: 7 bits per byte, high bit as the continue flag. */
  varint(value: number): void {
    let v = value >>> 0;
    while (v >= 0x80) {
      this.u8((v & 0x7f) | 0x80);
      v >>>= 7;
    }
    this.u8(v);
  }

  /** Zig-zag signed varint, so small negatives stay one byte. */
  svarint(value: number): void {
    this.varint(value < 0 ? -value * 2 - 1 : value * 2);
  }

  ascii(text: string): void {
    this.varint(text.length);
    for (let i = 0; i < text.length; i++) this.u8(text.charCodeAt(i));
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

class ByteReader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get exhausted(): boolean {
    return this.offset >= this.bytes.length;
  }

  u8(): number {
    const value = this.bytes[this.offset];
    if (value === undefined) throw new Error('Replay truncated');
    this.offset++;
    return value;
  }

  u16(): number {
    return (this.u8() << 8) | this.u8();
  }

  u32(): number {
    return ((this.u16() << 16) >>> 0) + this.u16();
  }

  varint(): number {
    let result = 0;
    let shift = 0;
    for (;;) {
      const byte = this.u8();
      result += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) return result;
      shift += 7;
      if (shift > 35) throw new Error('Replay varint overflow');
    }
  }

  svarint(): number {
    const raw = this.varint();
    return raw % 2 === 1 ? -(raw + 1) / 2 : raw / 2;
  }

  ascii(): string {
    const length = this.varint();
    let text = '';
    for (let i = 0; i < length; i++) text += String.fromCharCode(this.u8());
    return text;
  }
}

/**
 * Each frame opens with one byte: four flag bits, and four bits of tick delta.
 *
 * Almost every stored frame follows the previous one by exactly one tick, so
 * carrying the gap in the spare nibble rather than as its own varint removes a
 * byte from nearly every frame. `DELTA_ESCAPE` means "the gap did not fit,
 * read a varint next" — which is what happens across a pause or a reward
 * screen, and is rare enough that the extra byte costs nothing overall.
 */
const FLAG_FIRING = 1 << 0;
const FLAG_DASH = 1 << 1;
const FLAG_MOVE_CHANGED = 1 << 2;
const FLAG_AIM_CHANGED = 1 << 3;
const DELTA_SHIFT = 4;
const DELTA_ESCAPE = 0xf;

export function encodeReplay(replay: ReplayData): Uint8Array {
  const writer = new ByteWriter();
  writer.u16(MAGIC);
  writer.u8(replay.version);
  writer.u32(replay.seed);
  writer.varint(replay.ticks);

  writer.varint(Math.max(0, Math.round(replay.meta.score)));
  writer.varint(Math.max(0, Math.round(replay.meta.depth)));
  writer.varint(Math.max(0, Math.round(replay.meta.kills)));
  writer.varint(Math.max(0, Math.round(replay.meta.elapsed * 100)));
  // Seconds, not milliseconds: the extra three digits never mattered and cost
  // two bytes on every replay.
  writer.varint(Math.max(0, Math.round(replay.meta.recordedAt / 1000)));

  writer.varint(replay.frames.length);
  let previousTick = 0;
  let previousAim = 0;
  let previousMoveX = 0;
  let previousMoveY = 0;

  for (const frame of replay.frames) {
    const moveChanged = frame.moveX !== previousMoveX || frame.moveY !== previousMoveY;
    const aimChanged = frame.aim !== previousAim;

    let flags = 0;
    if (frame.firing) flags |= FLAG_FIRING;
    if (frame.dash) flags |= FLAG_DASH;
    if (moveChanged) flags |= FLAG_MOVE_CHANGED;
    if (aimChanged) flags |= FLAG_AIM_CHANGED;

    const gap = frame.tick - previousTick;
    if (gap < DELTA_ESCAPE) {
      writer.u8(flags | (gap << DELTA_SHIFT));
    } else {
      writer.u8(flags | (DELTA_ESCAPE << DELTA_SHIFT));
      writer.varint(gap);
    }
    if (moveChanged) {
      writer.u8(frame.moveX & 0xff);
      writer.u8(frame.moveY & 0xff);
    }
    if (aimChanged) {
      // Shortest way round the circle, so a small mouse movement is one byte.
      let delta = frame.aim - previousAim;
      if (delta > AIM_STEPS / 2) delta -= AIM_STEPS;
      if (delta < -AIM_STEPS / 2) delta += AIM_STEPS;
      writer.svarint(delta);
    }

    previousTick = frame.tick;
    previousAim = frame.aim;
    previousMoveX = frame.moveX;
    previousMoveY = frame.moveY;
  }

  writer.varint(replay.choices.length);
  let previousChoiceTick = 0;
  for (const choice of replay.choices) {
    writer.varint(choice.tick - previousChoiceTick);
    writer.ascii(choice.upgradeId);
    previousChoiceTick = choice.tick;
  }

  return writer.finish();
}

export function decodeReplay(bytes: Uint8Array): ReplayData {
  const reader = new ByteReader(bytes);
  if (reader.u16() !== MAGIC) throw new Error('Not a Neon Depths replay');

  const version = reader.u8();
  if (version !== REPLAY_VERSION) {
    throw new Error(`Replay version ${version} is not supported by this build`);
  }

  const seed = reader.u32();
  const ticks = reader.varint();
  const score = reader.varint();
  const depth = reader.varint();
  const kills = reader.varint();
  const elapsed = reader.varint() / 100;
  const recordedAt = reader.varint() * 1000;

  const frameCount = reader.varint();
  const frames: ReplayFrame[] = [];
  let tick = 0;
  let aim = 0;
  let moveX = 0;
  let moveY = 0;

  for (let i = 0; i < frameCount; i++) {
    const header = reader.u8();
    const flags = header & 0x0f;
    const gap = header >> DELTA_SHIFT;
    tick += gap === DELTA_ESCAPE ? reader.varint() : gap;
    if ((flags & FLAG_MOVE_CHANGED) !== 0) {
      moveX = (reader.u8() << 24) >> 24; // sign-extend
      moveY = (reader.u8() << 24) >> 24;
    }
    if ((flags & FLAG_AIM_CHANGED) !== 0) {
      aim = (aim + reader.svarint() + AIM_STEPS) % AIM_STEPS;
    }
    frames.push({
      tick,
      moveX,
      moveY,
      aim,
      firing: (flags & FLAG_FIRING) !== 0,
      dash: (flags & FLAG_DASH) !== 0,
    });
  }

  const choiceCount = reader.varint();
  const choices: ReplayChoice[] = [];
  let choiceTick = 0;
  for (let i = 0; i < choiceCount; i++) {
    choiceTick += reader.varint();
    choices.push({ tick: choiceTick, upgradeId: reader.ascii() });
  }

  return {
    version,
    seed,
    ticks,
    frames,
    choices,
    meta: { score, depth, kills, elapsed, recordedAt },
  };
}

/** URL-safe base64, for clipboard and query-string sharing. */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 = typeof btoa === 'function' ? btoa(binary) : bufferToBase64(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = typeof atob === 'function' ? atob(padded) : base64ToBuffer(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Node fallbacks so the codec is testable without a DOM. */
function bufferToBase64(binary: string): string {
  return Buffer.from(binary, 'binary').toString('base64');
}

function base64ToBuffer(base64: string): string {
  return Buffer.from(base64, 'base64').toString('binary');
}
