/**
 * Sound, synthesised rather than downloaded.
 *
 * Every effect here is a few oscillator cycles under an envelope, which costs
 * nothing to ship — no audio files, no decode, nothing added to a cold load
 * that a portal measures. For a game whose entire sound design is "a hit, a
 * kill, a purchase, a descent", a sample library would be almost all of the
 * bundle for a fraction of the value.
 *
 * Three rules the browser and the portals impose, enforced here rather than at
 * the call sites:
 *
 * 1. An `AudioContext` created before a user gesture starts suspended and stays
 *    that way. It is therefore created lazily, on the first interaction.
 * 2. Audio must stop while an advertisement plays. Portals check this.
 * 3. An idle game can produce twenty kills a second, and twenty overlapping
 *    kill sounds is not feedback, it is noise. Voices are rate-limited per
 *    effect and capped in total.
 */

export type SoundName =
  'hit' | 'kill' | 'guardian' | 'floor' | 'purchase' | 'descend' | 'reward';

interface Voice {
  /** Base frequency in Hz. */
  readonly frequency: number;
  /** Frequency at the end of the sweep; equal to `frequency` for no sweep. */
  readonly sweepTo: number;
  readonly duration: number;
  readonly type: OscillatorType;
  readonly gain: number;
  /** Minimum milliseconds between two plays of this effect. */
  readonly minInterval: number;
}

/**
 * The sound design in one table.
 *
 * Pitch carries meaning: routine events sit low and short so they can repeat
 * without fatigue, and the rare ones rise. A descent — the biggest decision in
 * the game — is the only sound that sweeps upward across a full octave.
 */
const VOICES: Record<SoundName, Voice> = {
  hit: {
    frequency: 180,
    sweepTo: 120,
    duration: 0.05,
    type: 'square',
    gain: 0.05,
    minInterval: 90,
  },
  kill: {
    frequency: 420,
    sweepTo: 300,
    duration: 0.09,
    type: 'triangle',
    gain: 0.08,
    minInterval: 70,
  },
  guardian: {
    frequency: 160,
    sweepTo: 90,
    duration: 0.45,
    type: 'sawtooth',
    gain: 0.12,
    minInterval: 300,
  },
  floor: {
    frequency: 520,
    sweepTo: 780,
    duration: 0.22,
    type: 'triangle',
    gain: 0.1,
    minInterval: 200,
  },
  purchase: {
    frequency: 640,
    sweepTo: 900,
    duration: 0.07,
    type: 'square',
    gain: 0.05,
    minInterval: 40,
  },
  descend: {
    frequency: 220,
    sweepTo: 440,
    duration: 0.9,
    type: 'sine',
    gain: 0.16,
    minInterval: 1000,
  },
  reward: {
    frequency: 700,
    sweepTo: 1100,
    duration: 0.3,
    type: 'triangle',
    gain: 0.12,
    minInterval: 400,
  },
};

/** More than this many at once is mud, not sound. */
const MAX_CONCURRENT_VOICES = 6;

/** `lib.dom` promises AudioContext unconditionally; older Safari has only the prefix. */
interface AudioGlobals {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
}

export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private enabled: boolean;
  private suspended = false;
  private active = 0;
  private readonly lastPlayedAt = new Map<SoundName, number>();

  constructor(enabled: boolean) {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.stopEverything();
  }

  /**
   * Creates the context, if a gesture has made that legal.
   *
   * Safe to call repeatedly; the first successful call wins. Returns null when
   * the browser has no Web Audio at all, which is a reason to be silent rather
   * than a reason to fail.
   */
  private ensureContext(): AudioContext | null {
    if (this.context !== null) return this.context;

    const globals = globalThis as unknown as AudioGlobals;
    const Ctor = globals.AudioContext ?? globals.webkitAudioContext;
    if (Ctor === undefined) return null;

    try {
      const context = new Ctor();
      const master = context.createGain();
      master.gain.value = 1;
      master.connect(context.destination);
      this.context = context;
      this.master = master;
      return context;
    } catch {
      return null;
    }
  }

  /** Call from a real user gesture; browsers refuse to start audio without one. */
  unlock(): void {
    const context = this.ensureContext();
    if (context === null) return;
    if (context.state === 'suspended') void context.resume();
  }

  /** Silence for the duration of an advertisement, then restore. */
  suspend(): void {
    this.suspended = true;
    this.stopEverything();
    if (this.context !== null && this.context.state === 'running') void this.context.suspend();
  }

  resume(): void {
    this.suspended = false;
    if (this.context !== null && this.context.state === 'suspended') void this.context.resume();
  }

  private stopEverything(): void {
    if (this.master === null || this.context === null) return;
    // Ramp rather than cut: an instant gain change is an audible click.
    this.master.gain.cancelScheduledValues(this.context.currentTime);
    this.master.gain.setTargetAtTime(0, this.context.currentTime, 0.01);
  }

  play(name: SoundName, now = performance.now()): void {
    if (!this.enabled || this.suspended) return;
    if (this.active >= MAX_CONCURRENT_VOICES) return;

    const voice = VOICES[name];
    const last = this.lastPlayedAt.get(name);
    if (last !== undefined && now - last < voice.minInterval) return;

    const context = this.ensureContext();
    if (context === null || this.master === null) return;
    if (context.state !== 'running') return;

    this.lastPlayedAt.set(name, now);
    this.master.gain.cancelScheduledValues(context.currentTime);
    this.master.gain.setValueAtTime(1, context.currentTime);

    const at = context.currentTime;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();

    oscillator.type = voice.type;
    oscillator.frequency.setValueAtTime(voice.frequency, at);
    if (voice.sweepTo !== voice.frequency) {
      // Exponential, because pitch is perceived logarithmically — a linear
      // sweep sounds like it slows down at the top.
      oscillator.frequency.exponentialRampToValueAtTime(voice.sweepTo, at + voice.duration);
    }

    // A short attack keeps the onset from clicking; the decay to a floor value
    // rather than zero is required, as exponential ramps cannot reach zero.
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(voice.gain, at + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + voice.duration);

    oscillator.connect(envelope);
    envelope.connect(this.master);

    this.active += 1;
    oscillator.onended = (): void => {
      this.active -= 1;
      oscillator.disconnect();
      envelope.disconnect();
    };

    oscillator.start(at);
    oscillator.stop(at + voice.duration + 0.02);
  }
}
