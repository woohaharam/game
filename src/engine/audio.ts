/**
 * Procedural audio bus built on the Web Audio API.
 *
 * Every sound is synthesised at runtime — no .wav/.mp3 assets. That keeps the
 * whole game a ~60 KB download with zero asset pipeline, and it means pitch,
 * length and timbre are gameplay parameters: a bigger enemy dying is literally
 * the same routine at a lower frequency.
 *
 * Browsers block audio until a user gesture, so the AudioContext is created
 * lazily on first interaction and every call is a no-op before that.
 */
export type SfxName =
  | 'shoot'
  | 'enemyShoot'
  | 'hit'
  | 'playerHit'
  | 'dash'
  | 'explosion'
  | 'pickup'
  | 'upgrade'
  | 'doorOpen'
  | 'uiMove'
  | 'uiSelect'
  | 'bossSpawn'
  | 'gameOver';

interface SfxSpec {
  type: OscillatorType;
  /** Start frequency in Hz. */
  freq: number;
  /** End frequency; the sweep is what makes a blip read as "laser" vs "thud". */
  freqEnd: number;
  duration: number;
  gain: number;
  /** Mixes in a noise burst — essential for explosions and impacts. */
  noise?: number;
  /** Detuned second oscillator for a fuller, less sterile tone. */
  detune?: number;
}

const SFX: Record<SfxName, SfxSpec> = {
  shoot: { type: 'square', freq: 780, freqEnd: 240, duration: 0.09, gain: 0.16, detune: 12 },
  enemyShoot: { type: 'sawtooth', freq: 320, freqEnd: 130, duration: 0.12, gain: 0.12 },
  hit: { type: 'triangle', freq: 420, freqEnd: 180, duration: 0.07, gain: 0.18, noise: 0.3 },
  playerHit: { type: 'sawtooth', freq: 240, freqEnd: 60, duration: 0.3, gain: 0.3, noise: 0.4 },
  dash: { type: 'sine', freq: 180, freqEnd: 660, duration: 0.16, gain: 0.16 },
  explosion: { type: 'sine', freq: 140, freqEnd: 40, duration: 0.5, gain: 0.34, noise: 0.85 },
  pickup: { type: 'sine', freq: 620, freqEnd: 1180, duration: 0.16, gain: 0.2 },
  upgrade: { type: 'triangle', freq: 440, freqEnd: 1320, duration: 0.4, gain: 0.24, detune: 7 },
  doorOpen: { type: 'sine', freq: 200, freqEnd: 520, duration: 0.35, gain: 0.18 },
  uiMove: { type: 'square', freq: 520, freqEnd: 520, duration: 0.04, gain: 0.09 },
  uiSelect: { type: 'square', freq: 640, freqEnd: 960, duration: 0.11, gain: 0.14 },
  bossSpawn: {
    type: 'sawtooth',
    freq: 90,
    freqEnd: 220,
    duration: 0.9,
    gain: 0.32,
    noise: 0.25,
  },
  gameOver: { type: 'triangle', freq: 300, freqEnd: 70, duration: 1.1, gain: 0.3 },
};

/**
 * The audio constructors as the platform actually provides them, rather than
 * as lib.dom declares them. Intersecting with `Window` would not work: an
 * optional member intersected with a required one stays required, and the
 * runtime guard would type-check as dead code.
 */
interface AudioGlobals {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
}

/** Pentatonic minor — hard to make dissonant, which suits generative music. */
const SCALE = [0, 3, 5, 7, 10, 12, 15];
const ROOT_HZ = 110;

export class AudioBus {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private musicTimer = 0;
  private musicStep = 0;
  private musicIntensity = 0;

  muted = false;
  volume = 0.7;

  /** Creates the context. Must be called from a user-gesture handler. */
  unlock(): void {
    if (this.ctx !== null) {
      void this.ctx.resume();
      return;
    }
    // lib.dom types `window.AudioContext` as always present, which is a
    // promise the platform does not keep: older WebKit only ships the prefixed
    // constructor, and locked-down embeddings expose neither. Narrowing to a
    // view where both are optional keeps the runtime guard honest instead of
    // making it look like dead code to the type checker.
    const scope = window as unknown as AudioGlobals;
    const Ctor = scope.AudioContext ?? scope.webkitAudioContext;
    if (Ctor === undefined) return;

    const ctx = new Ctor();
    const master = ctx.createGain();
    master.gain.value = this.volume;
    master.connect(ctx.destination);

    const musicGain = ctx.createGain();
    musicGain.gain.value = 0.35;
    musicGain.connect(master);

    this.ctx = ctx;
    this.master = master;
    this.musicGain = musicGain;
    this.noiseBuffer = this.createNoiseBuffer(ctx);
  }

  get isReady(): boolean {
    return this.ctx !== null;
  }

  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.master !== null) this.master.gain.value = this.muted ? 0 : this.volume;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master !== null) this.master.gain.value = this.muted ? 0 : this.volume;
    return this.muted;
  }

  private createNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * 0.6);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  /**
   * Plays a one-shot. `pitch` multiplies both frequency endpoints, so callers
   * can vary repeated sounds slightly and avoid the machine-gun sameness that
   * makes retriggered SFX grating.
   */
  play(name: SfxName, pitch = 1, gainScale = 1): void {
    const ctx = this.ctx;
    const master = this.master;
    if (ctx === null || master === null || this.muted) return;

    const spec = SFX[name];
    const now = ctx.currentTime;
    const duration = spec.duration;
    const gain = ctx.createGain();
    gain.connect(master);

    // Short attack avoids the click that a hard gain step produces.
    const peak = spec.gain * gainScale;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    const startOscillator = (detune: number): void => {
      const osc = ctx.createOscillator();
      osc.type = spec.type;
      osc.detune.value = detune;
      osc.frequency.setValueAtTime(spec.freq * pitch, now);
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(20, spec.freqEnd * pitch),
        now + duration,
      );
      osc.connect(gain);
      osc.start(now);
      osc.stop(now + duration + 0.02);
    };

    startOscillator(0);
    if (spec.detune !== undefined) startOscillator(spec.detune);

    if (spec.noise !== undefined && this.noiseBuffer !== null) {
      const noise = ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;
      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(peak * spec.noise, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      // Low-pass keeps white noise from sounding like static hiss.
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(2400 * pitch, now);
      noise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(master);
      noise.start(now);
      noise.stop(now + duration);
    }
  }

  /**
   * Generative background music: an arpeggiated bass line whose density and
   * brightness follow `intensity` (0 = exploring, 1 = boss fight). Cheaper and
   * more responsive than crossfading pre-rendered stems.
   */
  updateMusic(dt: number, intensity: number): void {
    const ctx = this.ctx;
    const out = this.musicGain;
    if (ctx === null || out === null || this.muted) return;

    this.musicIntensity += (intensity - this.musicIntensity) * Math.min(1, dt * 1.2);
    const interval = 0.34 - this.musicIntensity * 0.14;

    this.musicTimer -= dt;
    if (this.musicTimer > 0) return;
    this.musicTimer = interval;

    const now = ctx.currentTime;
    const degree = SCALE[this.musicStep % SCALE.length] ?? 0;
    const octave = this.musicStep % 8 < 4 ? 0 : 12;
    const freq = ROOT_HZ * 2 ** ((degree + octave) / 12);
    this.musicStep++;

    const voice = ctx.createOscillator();
    voice.type = this.musicIntensity > 0.5 ? 'sawtooth' : 'triangle';
    voice.frequency.value = freq;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400 + this.musicIntensity * 2200;
    filter.Q.value = 6;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18 + this.musicIntensity * 0.12, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + interval * 1.6);

    voice.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    voice.start(now);
    voice.stop(now + interval * 1.7);
  }
}
