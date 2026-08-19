import { Camera } from './camera';
import type { Rng } from './rng';
import { TAU, type Vec2 } from './math';

/**
 * Canvas 2D renderer with a fixed virtual resolution.
 *
 * The game is authored against a constant design resolution and letterboxed
 * into whatever the window is, so tuning ("the boss arena is 3 screens wide")
 * stays true on every display. The backing store is scaled by devicePixelRatio
 * — without that, everything is soft on a retina screen.
 *
 * Glow is the single most expensive thing this renderer does. `shadowBlur`
 * costs real time per draw call, so it is opt-in per shape and disabled
 * wholesale by the low-quality toggle rather than sprinkled everywhere.
 */
export interface RendererOptions {
  width: number;
  height: number;
  rng: Rng;
}

export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  readonly camera: Camera;
  /** Virtual design resolution — all gameplay units are in these pixels. */
  readonly width: number;
  readonly height: number;

  /** Scale from virtual pixels to CSS pixels (letterbox fit). */
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;
  private dpr = 1;

  /** Disables glow and heavy passes; halves frame cost on weak GPUs. */
  lowQuality = false;

  private readonly scratch: Vec2 = { x: 0, y: 0 };

  constructor(
    readonly canvas: HTMLCanvasElement,
    options: RendererOptions,
  ) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (ctx === null) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;
    this.width = options.width;
    this.height = options.height;
    this.camera = new Camera(options.width, options.height, options.rng);
    this.resize();
  }

  /** Recomputes the letterbox fit. Call on window resize / orientation change. */
  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const availableWidth = this.canvas.clientWidth || window.innerWidth;
    const availableHeight = this.canvas.clientHeight || window.innerHeight;

    this.dpr = dpr;
    this.canvas.width = Math.round(availableWidth * dpr);
    this.canvas.height = Math.round(availableHeight * dpr);

    this.scale = Math.min(availableWidth / this.width, availableHeight / this.height);
    this.offsetX = (availableWidth - this.width * this.scale) / 2;
    this.offsetY = (availableHeight - this.height * this.scale) / 2;
  }

  /** Maps a CSS-pixel pointer position into virtual design pixels. */
  pointerToVirtual(pointer: Vec2, out: Vec2): Vec2 {
    out.x = (pointer.x - this.offsetX) / this.scale;
    out.y = (pointer.y - this.offsetY) / this.scale;
    return out;
  }

  /** Begins a frame: clears, then installs the letterbox transform. */
  begin(background = '#05060d'): void {
    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(
      this.scale * this.dpr,
      0,
      0,
      this.scale * this.dpr,
      this.offsetX * this.dpr,
      this.offsetY * this.dpr,
    );
    ctx.beginPath();
    ctx.rect(0, 0, this.width, this.height);
    ctx.clip();
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  end(): void {
    this.ctx.restore();
  }

  /** Pushes the camera transform; everything drawn inside is in world space. */
  beginWorld(): void {
    const { ctx, camera } = this;
    ctx.save();
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.viewX, -camera.viewY);
  }

  endWorld(): void {
    this.ctx.restore();
  }

  /** Enables additive glow for the shapes drawn until `clearGlow()`. */
  glow(color: string, blur = 16): void {
    if (this.lowQuality) return;
    this.ctx.shadowColor = color;
    this.ctx.shadowBlur = blur;
  }

  clearGlow(): void {
    this.ctx.shadowBlur = 0;
  }

  circle(x: number, y: number, radius: number, color: string, glowBlur = 0): void {
    const { ctx } = this;
    if (glowBlur > 0) this.glow(color, glowBlur);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.fill();
    if (glowBlur > 0) this.clearGlow();
  }

  ring(
    x: number,
    y: number,
    radius: number,
    color: string,
    lineWidth = 2,
    glowBlur = 0,
  ): void {
    const { ctx } = this;
    if (glowBlur > 0) this.glow(color, glowBlur);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.stroke();
    if (glowBlur > 0) this.clearGlow();
  }

  /** Draws an arc slice — used for reload/charge indicators. */
  arc(
    x: number,
    y: number,
    radius: number,
    from: number,
    to: number,
    color: string,
    lineWidth = 3,
  ): void {
    const { ctx } = this;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.arc(x, y, radius, from, to);
    ctx.stroke();
  }

  rect(x: number, y: number, w: number, h: number, color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x, y, w, h);
  }

  strokeRect(
    x: number,
    y: number,
    w: number,
    h: number,
    color: string,
    lineWidth = 2,
  ): void {
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = lineWidth;
    this.ctx.strokeRect(x, y, w, h);
  }

  line(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string,
    lineWidth = 2,
    glowBlur = 0,
  ): void {
    const { ctx } = this;
    if (glowBlur > 0) this.glow(color, glowBlur);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    if (glowBlur > 0) this.clearGlow();
  }

  /** Regular n-gon; the cheap way to give each enemy archetype a silhouette. */
  polygon(
    x: number,
    y: number,
    radius: number,
    sides: number,
    rotation: number,
    color: string,
    filled = true,
    glowBlur = 0,
  ): void {
    const { ctx } = this;
    if (glowBlur > 0) this.glow(color, glowBlur);
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const angle = rotation + (i / sides) * TAU;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    if (filled) {
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (glowBlur > 0) this.clearGlow();
  }

  text(
    value: string,
    x: number,
    y: number,
    options: {
      size?: number;
      color?: string;
      align?: CanvasTextAlign;
      baseline?: CanvasTextBaseline;
      weight?: string;
      glow?: number;
      letterSpacing?: string;
    } = {},
  ): void {
    const { ctx } = this;
    const size = options.size ?? 16;
    const color = options.color ?? '#e8f4ff';
    ctx.save();
    ctx.font = `${options.weight ?? '600'} ${size}px "Segoe UI", "Helvetica Neue", system-ui, sans-serif`;
    ctx.textAlign = options.align ?? 'left';
    ctx.textBaseline = options.baseline ?? 'alphabetic';
    if (options.letterSpacing !== undefined) ctx.letterSpacing = options.letterSpacing;
    if (options.glow !== undefined && !this.lowQuality) {
      ctx.shadowColor = color;
      ctx.shadowBlur = options.glow;
    }
    ctx.fillStyle = color;
    ctx.fillText(value, x, y);
    ctx.restore();
  }

  measureText(value: string, size: number, weight = '600'): number {
    const { ctx } = this;
    ctx.save();
    ctx.font = `${weight} ${size}px "Segoe UI", "Helvetica Neue", system-ui, sans-serif`;
    const width = ctx.measureText(value).width;
    ctx.restore();
    return width;
  }

  /** Full-screen colour wash, e.g. damage flash or pause dimming. */
  overlay(color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  worldToScreen(x: number, y: number): Vec2 {
    return this.camera.worldToScreen(x, y, this.scratch);
  }
}
