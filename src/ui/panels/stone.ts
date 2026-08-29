/**
 * The stone: what it is, what it weighs, and what it is drawing in.
 *
 * This is the only panel always on screen, so it is the one that has to stay
 * cheap. Every value here is written through the guarded setters, and the bars
 * move by a CSS custom property rather than by a class swap, so a frame that
 * changes nothing touches nothing.
 *
 * The mass is given the largest type on the screen deliberately. It is the
 * number the player is here for — the one that only ever goes up — and every
 * other readout on this panel exists to explain why it is moving.
 */

import type { Decimal } from '@core/decimal';
import type { Notation } from '@core/format';
import { duration, mass, t } from '@core/i18n';
import { FRAGMENTS_PER_STAGE, formIcon, formName, fragmentName } from '@game/content/stages';
import type { SoundName } from '@platform/audio';
import { BLESSING_DURATION_SECONDS, cacheValue } from '@game/rewards';
import { computeStats } from '@game/stats';
import { wholeFragmentMass, type GameState } from '@game/state';
import { el, setHidden, setText, setToggle, setVariable } from '../dom';
import { EffectsLayer, prefersReducedMotion } from '../effects';

export interface StonePanelDeps {
  readonly state: GameState;
  readonly num: (value: Decimal | number) => string;
  readonly notation: () => Notation;
  readonly sound: (name: SoundName) => void;
  readonly onWatchForBlessing: () => void;
  readonly onWatchForCache: () => void;
}

/** What the simulation did since the last rendered frame. */
export interface FrameFeedback {
  readonly massGained: Decimal;
  readonly dust: Decimal;
  readonly fragments: number;
  readonly stagesGained: number;
  readonly stage: number;
}

/**
 * Minimum gap between two mass labels while absorbing.
 *
 * A fragment near the stone's limit can take a long time, over which nothing
 * lands and nothing would otherwise be shown. The label reports mass actually
 * accumulated across the interval, so it stays true whatever the frame rate.
 */
const MASS_LABEL_INTERVAL_MS = 380;

/** How long the stone flashes after a fragment lands. Must match the CSS. */
const ABSORB_FLASH_MS = 140;

export class StonePanel {
  private adsAvailable = false;
  private readonly effects = new EffectsLayer(prefersReducedMotion());
  private pendingMass: Decimal | null = null;
  private lastMassLabelAt = 0;
  private flashUntil = 0;

  private form!: HTMLElement;
  private stageLabel!: HTMLElement;
  private body!: HTMLElement;
  private icon!: HTMLElement;
  private massLabel!: HTMLElement;
  private fragmentLabel!: HTMLElement;
  private drawBar!: HTMLElement;
  private drawFill!: HTMLElement;
  private stageFill!: HTMLElement;
  private stageText!: HTMLElement;
  private rate!: HTMLElement;
  private blessing!: HTMLElement;
  private boosts!: HTMLElement;
  private blessingButton!: HTMLElement;
  private cacheButton!: HTMLElement;

  constructor(private readonly deps: StonePanelDeps) {}

  setAdsAvailable(available: boolean): void {
    this.adsAvailable = available;
  }

  mount(): HTMLElement {
    this.form = el('span', { class: 'zone' }, ['']);
    this.stageLabel = el('span', { class: 'depth' }, ['']);
    this.icon = el('div', { class: 'sprite' }, ['·']);
    this.massLabel = el('div', { class: 'mass' }, ['']);
    this.fragmentLabel = el('div', { class: 'enemy-name' }, ['']);

    this.drawFill = el('div', { class: 'fill' });
    this.drawBar = el(
      'div',
      {
        class: 'healthbar',
        role: 'progressbar',
        'aria-label': t('a11y.enemyHealth'),
        'aria-valuemin': '0',
        'aria-valuemax': '100',
      },
      [this.drawFill],
    );

    this.stageFill = el('div', { class: 'fill' });
    this.stageText = el('span', { class: 'killtext' }, ['']);
    this.rate = el('strong', {}, ['0']);
    this.blessing = el('span', { class: 'blessing' }, ['']);

    this.body = el('div', { class: 'stage' }, [
      this.effects.mount(),
      this.icon,
      this.massLabel,
      this.fragmentLabel,
      this.drawBar,
    ]);

    return el('section', { class: 'combat' }, [
      el('div', { class: 'floorline' }, [this.form, this.stageLabel]),
      this.body,
      el('div', { class: 'progressline' }, [
        el(
          'div',
          { class: 'killbar', role: 'progressbar', 'aria-label': t('a11y.floorProgress') },
          [this.stageFill],
        ),
        this.stageText,
      ]),
      el('div', { class: 'readout' }, [
        el('span', {}, [t('stone.rate')]),
        this.rate,
        el('span', {}, [t('stone.perSecond')]),
        this.blessing,
      ]),
      this.buildBoosts(),
    ]);
  }

  private buildBoosts(): HTMLElement {
    this.blessingButton = el('button', { class: 'ad', type: 'button' }, ['']);
    this.blessingButton.addEventListener('click', () => this.deps.onWatchForBlessing());

    this.cacheButton = el('button', { class: 'ad', type: 'button' }, ['']);
    this.cacheButton.addEventListener('click', () => this.deps.onWatchForCache());

    this.boosts = el('div', { class: 'boosts' }, [this.blessingButton, this.cacheButton]);
    return this.boosts;
  }

  /**
   * Turns one frame of simulation into something visible.
   *
   * Driven by what `advance` actually reported rather than re-derived from rate
   * and elapsed time: those two disagree once the absorption cap binds, and a
   * floating number that contradicts the bar beside it is worse than no number.
   */
  feedback(input: FrameFeedback, now = performance.now()): void {
    if (input.stagesGained > 0) {
      this.deps.sound('floor');
      this.effects.announce(t('effect.becameForm', { form: formName(input.stage) }), now);
      this.flashUntil = now + ABSORB_FLASH_MS;
    } else if (input.fragments > 0) {
      this.deps.sound('kill');
      this.flashUntil = now + ABSORB_FLASH_MS;
    } else if (!input.massGained.isZero) {
      this.deps.sound('hit');
    }

    if (input.fragments > 0 && !input.dust.isZero) {
      this.effects.spawn(`+${this.deps.num(input.dust)}`, 'gold', now);
    }

    // Mass accumulates between labels instead of being dropped, so a long draw
    // shows a true running total rather than one frame's worth.
    this.pendingMass =
      this.pendingMass === null ? input.massGained : this.pendingMass.add(input.massGained);

    if (!this.pendingMass.isZero && now - this.lastMassLabelAt >= MASS_LABEL_INTERVAL_MS) {
      this.lastMassLabelAt = now;
      this.effects.spawn(
        `+${mass(this.pendingMass, this.deps.notation())}`,
        input.stagesGained > 0 ? 'crit' : 'damage',
        now,
      );
      this.pendingMass = null;
    }
  }

  /** Shows a centred message over the stone. */
  announce(text: string, now = performance.now()): void {
    this.effects.announce(text, now);
  }

  update(now = performance.now()): void {
    const state = this.deps.state;
    const stats = computeStats(state);
    const notation = this.deps.notation();

    setText(this.form, formName(state.stage));
    setText(this.stageLabel, t('stone.stage', { n: state.stage }));
    setText(this.icon, formIcon(state.stage));
    setText(this.massLabel, mass(state.mass, notation));

    const whole = wholeFragmentMass(state);
    // The bar fills as the fragment is drawn in, so it reads as the stone
    // taking something rather than as something being worn away.
    const drawn = whole.isZero
      ? 0
      : Math.min(1, Math.max(0, 1 - state.fragmentRemaining.divide(whole).toNumber()));
    setVariable(this.drawFill, '--fill', `${(drawn * 100).toFixed(1)}%`);
    this.drawBar.setAttribute('aria-valuenow', String(Math.round(drawn * 100)));

    setText(
      this.fragmentLabel,
      `${fragmentName(state.fragmentIndex)} · ${mass(whole, notation)}`,
    );

    const stageFraction = Math.min(1, state.fragmentsOnStage / FRAGMENTS_PER_STAGE);
    setVariable(this.stageFill, '--fill', `${(stageFraction * 100).toFixed(0)}%`);
    setText(
      this.stageText,
      t('stone.progress', { done: state.fragmentsOnStage, total: FRAGMENTS_PER_STAGE }),
    );

    setText(this.rate, mass(stats.absorptionPerSecond, notation));
    setText(
      this.blessing,
      stats.blessed
        ? ` · ${t('stone.blessed', { time: duration(state.blessingRemaining) })}`
        : '',
    );

    setToggle(this.body, 'struck', now < this.flashUntil);
    this.effects.update(now);

    setHidden(this.boosts, !this.adsAvailable);
    if (this.adsAvailable) {
      setText(this.cacheButton, t('boost.chest', { amount: this.deps.num(cacheValue(state)) }));
      setText(
        this.blessingButton,
        t('boost.blessing', { minutes: Math.round(BLESSING_DURATION_SECONDS / 60) }),
      );
    }
  }
}
