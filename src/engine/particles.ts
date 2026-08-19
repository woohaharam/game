import { Pool } from './pool';
import type { Renderer } from './renderer';
import type { Rng } from './rng';
import { TAU } from './math';

/**
 * Pooled particle system.
 *
 * Particles are the cheapest way to make hits feel like they land, so the
 * budget is deliberately generous (2,000) and backed by a pool — allocating
 * that many objects per second would keep the GC permanently busy.
 *
 * Each particle is plain data updated in a flat loop rather than an object
 * with its own update method: better cache behaviour and no megamorphic
 * dispatch when thousands are live.
 */
export type ParticleShape = 'dot' | 'spark' | 'square';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  drag: number;
  color: string;
  shape: ParticleShape;
  /** Previous position, kept so rendering can interpolate between ticks. */
  px: number;
  py: number;
}

function createParticle(): Particle {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    life: 0,
    maxLife: 1,
    size: 2,
    drag: 1,
    color: '#fff',
    shape: 'dot',
    px: 0,
    py: 0,
  };
}

export interface BurstOptions {
  count: number;
  color: string;
  speed: [number, number];
  life: [number, number];
  size: [number, number];
  shape?: ParticleShape;
  /** Restricts the spray to a cone around this angle (radians). */
  direction?: number;
  spread?: number;
  drag?: number;
}

export class ParticleSystem {
  private readonly pool: Pool<Particle>;

  constructor(
    private readonly rng: Rng,
    capacity = 2000,
  ) {
    this.pool = new Pool<Particle>(
      createParticle,
      (p) => {
        p.life = 0;
        p.drag = 1;
      },
      capacity,
    );
  }

  get liveCount(): number {
    return this.pool.size;
  }

  clear(): void {
    this.pool.clear();
  }

  burst(x: number, y: number, options: BurstOptions): void {
    const spread = options.spread ?? TAU;
    const baseAngle = options.direction ?? 0;
    for (let i = 0; i < options.count; i++) {
      const acquired = this.pool.acquire();
      // Pool exhaustion drops the particle rather than growing the pool:
      // a missing spark is invisible, a mid-combat allocation spike is not.
      if (acquired === null) return;

      const p = acquired.item;
      const angle =
        options.direction === undefined
          ? this.rng.angle()
          : baseAngle + this.rng.float(-spread / 2, spread / 2);
      const speed = this.rng.float(options.speed[0], options.speed[1]);
      p.x = p.px = x;
      p.y = p.py = y;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed;
      p.maxLife = this.rng.float(options.life[0], options.life[1]);
      p.life = p.maxLife;
      p.size = this.rng.float(options.size[0], options.size[1]);
      p.color = options.color;
      p.shape = options.shape ?? 'dot';
      p.drag = options.drag ?? 0.94;
    }
  }

  /** A single directed particle — used for trails. */
  emit(
    x: number,
    y: number,
    vx: number,
    vy: number,
    color: string,
    life: number,
    size: number,
    shape: ParticleShape = 'dot',
  ): void {
    const acquired = this.pool.acquire();
    if (acquired === null) return;
    const p = acquired.item;
    p.x = p.px = x;
    p.y = p.py = y;
    p.vx = vx;
    p.vy = vy;
    p.maxLife = p.life = life;
    p.size = size;
    p.color = color;
    p.shape = shape;
    p.drag = 0.9;
  }

  update(step: number): void {
    this.pool.forEach((p, index) => {
      p.px = p.x;
      p.py = p.y;
      p.life -= step;
      if (p.life <= 0) {
        this.pool.release(index);
        return;
      }
      // Per-second drag raised to the step keeps decay frame-rate independent.
      const drag = p.drag ** (step * 60);
      p.vx *= drag;
      p.vy *= drag;
      p.x += p.vx * step;
      p.y += p.vy * step;
    });
  }

  render(renderer: Renderer, alpha: number): void {
    const { ctx, camera } = renderer;
    ctx.save();
    this.pool.forEach((p) => {
      const x = p.px + (p.x - p.px) * alpha;
      const y = p.py + (p.y - p.py) * alpha;
      if (!camera.isVisible(x, y, p.size)) return;

      const t = p.life / p.maxLife;
      ctx.globalAlpha = t;
      ctx.fillStyle = p.color;

      switch (p.shape) {
        case 'dot':
          ctx.beginPath();
          ctx.arc(x, y, p.size * t, 0, TAU);
          ctx.fill();
          break;
        case 'square':
          ctx.fillRect(x - p.size / 2, y - p.size / 2, p.size, p.size);
          break;
        case 'spark': {
          // Streak length follows velocity, which reads as speed.
          const len = Math.min(14, Math.hypot(p.vx, p.vy) * 0.05);
          const inv = 1 / (Math.hypot(p.vx, p.vy) || 1);
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.size * t;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - p.vx * inv * len, y - p.vy * inv * len);
          ctx.stroke();
          break;
        }
      }
    });
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}
