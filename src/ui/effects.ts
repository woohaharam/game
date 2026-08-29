/**
 * Floating numbers and hit reactions.
 *
 * An idle game the player is watching has to look like something is happening,
 * and a health bar shrinking is not enough — it reads as a progress bar, not as
 * a fight. These are the smallest additions that make the screen feel like
 * combat: a number leaving the enemy when damage lands, a flash when it dies, a
 * banner when a floor falls.
 *
 * Two constraints shape the implementation. Nodes are pooled and reused,
 * because an idle game runs for hours and allocating a div per kill at twenty
 * kills a second is a leak with extra steps. And the whole layer is a no-op
 * under `prefers-reduced-motion`: the information is already in the numbers,
 * so a player who has asked for stillness loses nothing by not seeing it move.
 */

import { el, setToggle } from './dom';

/** Enough to cover the busiest frame; beyond this, extra spawns are dropped. */
const POOL_SIZE = 12;

/** Must match the CSS animation duration. */
const LIFETIME_MS = 900;

export type EffectKind = 'damage' | 'gold' | 'crit';

interface PooledLabel {
  readonly node: HTMLElement;
  /** When it becomes reusable; `-Infinity` while free. */
  freeAt: number;
}

export class EffectsLayer {
  private readonly labels: PooledLabel[] = [];
  private layer!: HTMLElement;
  private banner!: HTMLElement;
  private bannerUntil = 0;
  private readonly reducedMotion: boolean;

  constructor(reducedMotion: boolean) {
    this.reducedMotion = reducedMotion;
  }

  mount(): HTMLElement {
    this.banner = el('div', { class: 'banner' }, ['']);
    this.layer = el('div', { class: 'effects', 'aria-hidden': 'true' }, [this.banner]);

    for (let i = 0; i < POOL_SIZE; i += 1) {
      const node = el('div', { class: 'float' }, ['']);
      node.hidden = true;
      this.layer.append(node);
      this.labels.push({ node, freeAt: Number.NEGATIVE_INFINITY });
    }

    return this.layer;
  }

  /**
   * Shows a number rising from the enemy.
   *
   * `offset` spreads simultaneous labels horizontally so a busy frame does not
   * stack them into an unreadable pile.
   */
  spawn(text: string, kind: EffectKind, now = performance.now()): void {
    if (this.reducedMotion) return;

    const label = this.labels.find((candidate) => candidate.freeAt <= now);
    if (label === undefined) return;

    label.freeAt = now + LIFETIME_MS;
    label.node.textContent = text;
    label.node.className = `float ${kind}`;
    label.node.style.setProperty('--drift', `${Math.round((Math.random() - 0.5) * 90)}px`);

    // Restarting a CSS animation on a node that is already animating requires
    // the class to be removed and the layout flushed, or the browser coalesces
    // the two states and nothing moves.
    label.node.hidden = true;
    void label.node.offsetWidth;
    label.node.hidden = false;
  }

  /** A short, centred message: a floor cleared, a descent made. */
  announce(text: string, now = performance.now()): void {
    this.banner.textContent = text;
    this.bannerUntil = now + 1400;
    setToggle(this.banner, 'showing', true);
  }

  /** Called every rendered frame to retire finished effects. */
  update(now = performance.now()): void {
    for (const label of this.labels) {
      if (label.freeAt !== Number.NEGATIVE_INFINITY && label.freeAt <= now) {
        label.node.hidden = true;
        label.freeAt = Number.NEGATIVE_INFINITY;
      }
    }

    if (this.bannerUntil !== 0 && this.bannerUntil <= now) {
      this.bannerUntil = 0;
      setToggle(this.banner, 'showing', false);
    }
  }
}

/**
 * True when the player has asked the system for less movement.
 *
 * `matchMedia` is read through a weaker type than `lib.dom` gives it, for the
 * same reason as `localStorage` and `AudioContext` elsewhere: the declaration
 * promises it unconditionally, and it is absent under Node — where these
 * modules are compiled and tested — and in some embedded webviews. Answering
 * "no preference" there is right; throwing is not.
 */
interface MatchMediaGlobals {
  matchMedia?: (query: string) => MediaQueryList;
}

export function prefersReducedMotion(): boolean {
  const { matchMedia } = globalThis as unknown as MatchMediaGlobals;
  if (matchMedia === undefined) return false;

  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
