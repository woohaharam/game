/**
 * The fight: where the hero is, what it is hitting, and how hard.
 *
 * This is the only panel always on screen, so it is the one that has to stay
 * cheap. Every value here is written through the guarded setters, and the
 * health bar moves by a CSS custom property rather than by a class swap, so a
 * frame that changes nothing touches nothing.
 */

import type { Decimal } from '@core/decimal';
import { duration, t } from '@core/i18n';
import {
  BOSS_TIME_LIMIT,
  KILLS_PER_FLOOR,
  guardianName,
  monsterName,
  zoneName,
} from '@game/content/floors';
import { BLESSING_DURATION_SECONDS, chestValue } from '@game/rewards';
import { computeStats } from '@game/stats';
import { maxHealthOfCurrentEnemy, type GameState } from '@game/state';
import type { SoundName } from '@platform/audio';
import { el, setHidden, setText, setToggle, setVariable } from '../dom';
import { EffectsLayer, prefersReducedMotion } from '../effects';

export interface CombatPanelDeps {
  readonly state: GameState;
  readonly num: (value: Decimal | number) => string;
  readonly sound: (name: SoundName) => void;
  readonly onWatchForBlessing: () => void;
  readonly onWatchForChest: () => void;
}

/** What the simulation did since the last rendered frame. */
export interface FrameFeedback {
  readonly damage: Decimal;
  readonly gold: Decimal;
  readonly kills: number;
  readonly guardiansFelled: number;
  readonly floorsCleared: number;
  readonly floor: number;
}

/**
 * Minimum gap between two damage labels during a long fight.
 *
 * A guardian can take thirty seconds, over which nothing dies and nothing would
 * otherwise be shown. The label reports damage actually accumulated across the
 * interval, so it stays true whatever the frame rate.
 */
const DAMAGE_LABEL_INTERVAL_MS = 380;

/** How long the enemy flashes after a kill. Must match the CSS. */
const STRIKE_FLASH_MS = 140;

export class CombatPanel {
  private adsAvailable = false;
  private readonly effects = new EffectsLayer(prefersReducedMotion());
  private pendingDamage: Decimal | null = null;
  private lastDamageLabelAt = 0;
  private strikeUntil = 0;

  private zone!: HTMLElement;
  private depth!: HTMLElement;
  private stage!: HTMLElement;
  private sprite!: HTMLElement;
  private enemyName!: HTMLElement;
  private healthFill!: HTMLElement;
  private healthText!: HTMLElement;
  private timer!: HTMLElement;
  private timerText!: HTMLElement;
  private killFill!: HTMLElement;
  private killText!: HTMLElement;
  private dps!: HTMLElement;
  private blessing!: HTMLElement;
  private boosts!: HTMLElement;
  private blessingButton!: HTMLElement;
  private chestButton!: HTMLElement;

  constructor(private readonly deps: CombatPanelDeps) {}

  setAdsAvailable(available: boolean): void {
    this.adsAvailable = available;
  }

  mount(): HTMLElement {
    this.zone = el('span', { class: 'zone' }, ['']);
    this.depth = el('span', { class: 'depth' }, ['']);
    this.sprite = el('div', { class: 'sprite' }, ['🐀']);
    this.enemyName = el('div', { class: 'enemy-name' }, ['']);
    this.healthFill = el('div', { class: 'fill' });
    this.healthText = el('span', { class: 'bartext' }, ['']);
    this.timerText = el('span', {}, ['']);
    this.timer = el('div', { class: 'timer' }, [this.timerText]);
    this.killFill = el('div', { class: 'fill' });
    this.killText = el('span', { class: 'killtext' }, ['']);
    this.dps = el('strong', {}, ['0']);
    this.blessing = el('span', { class: 'blessing' }, ['']);

    this.stage = el('div', { class: 'stage' }, [
      this.effects.mount(),
      this.sprite,
      this.enemyName,
      el('div', { class: 'healthbar' }, [this.healthFill, this.healthText]),
      this.timer,
    ]);

    return el('section', { class: 'combat' }, [
      el('div', { class: 'floorline' }, [this.zone, this.depth]),
      this.stage,
      el('div', { class: 'progressline' }, [
        el('div', { class: 'killbar' }, [this.killFill]),
        this.killText,
      ]),
      el('div', { class: 'readout' }, [
        el('span', {}, [t('combat.damage')]),
        this.dps,
        el('span', {}, [t('combat.perSecond')]),
        this.blessing,
      ]),
      this.buildBoosts(),
    ]);
  }

  private buildBoosts(): HTMLElement {
    this.blessingButton = el('button', { class: 'ad', type: 'button' }, ['']);
    this.blessingButton.addEventListener('click', () => this.deps.onWatchForBlessing());

    this.chestButton = el('button', { class: 'ad', type: 'button' }, ['']);
    this.chestButton.addEventListener('click', () => this.deps.onWatchForChest());

    this.boosts = el('div', { class: 'boosts' }, [this.blessingButton, this.chestButton]);
    return this.boosts;
  }

  /**
   * Turns one frame of simulation into something visible.
   *
   * Driven by what `advance` reported rather than re-derived from DPS and
   * elapsed time: those two disagree once the kill-rate cap binds, and a
   * floating number that disagrees with the health bar is worse than no number.
   */
  feedback(input: FrameFeedback, now = performance.now()): void {
    if (input.guardiansFelled > 0) {
      this.deps.sound('guardian');
      this.deps.sound('floor');
      this.effects.announce(t('effect.floorCleared', { n: input.floor - 1 }), now);
      this.strikeUntil = now + STRIKE_FLASH_MS;
    } else if (input.kills > 0) {
      this.deps.sound('kill');
      this.strikeUntil = now + STRIKE_FLASH_MS;
    } else if (!input.damage.isZero) {
      this.deps.sound('hit');
    }

    if (input.kills > 0 && !input.gold.isZero) {
      this.effects.spawn(`+${this.deps.num(input.gold)}`, 'gold', now);
    }

    // Damage accumulates between labels instead of being dropped, so a long
    // guardian fight shows the true running total rather than one frame's worth.
    this.pendingDamage =
      this.pendingDamage === null ? input.damage : this.pendingDamage.add(input.damage);

    if (
      !this.pendingDamage.isZero &&
      now - this.lastDamageLabelAt >= DAMAGE_LABEL_INTERVAL_MS
    ) {
      this.lastDamageLabelAt = now;
      this.effects.spawn(
        this.deps.num(this.pendingDamage),
        this.deps.state.fightingGuardian ? 'crit' : 'damage',
        now,
      );
      this.pendingDamage = null;
    }
  }

  /** Shows a centred message over the stage. */
  announce(text: string, now = performance.now()): void {
    this.effects.announce(text, now);
  }

  update(now = performance.now()): void {
    const state = this.deps.state;
    const stats = computeStats(state);
    const num = this.deps.num;

    setText(this.zone, zoneName(state.floor));
    setText(this.depth, t('combat.floor', { n: state.floor }));

    const maxHealth = maxHealthOfCurrentEnemy(state);
    const fraction = maxHealth.isZero
      ? 0
      : Math.min(1, Math.max(0, state.enemyHealthRemaining.divide(maxHealth).toNumber()));
    setVariable(this.healthFill, '--fill', `${(fraction * 100).toFixed(1)}%`);
    setText(this.healthText, num(state.enemyHealthRemaining));

    setToggle(this.stage, 'guardian', state.fightingGuardian);
    setText(
      this.enemyName,
      state.fightingGuardian
        ? guardianName(state.floor)
        : monsterName(state.floor, state.enemyIndex),
    );
    setText(this.sprite, state.fightingGuardian ? '👑' : '🐀');

    setHidden(this.timer, !state.fightingGuardian);
    if (state.fightingGuardian) {
      const left = Math.max(0, state.guardianTimeRemaining);
      setText(this.timerText, `${left.toFixed(1)}s`);
      setToggle(this.timer, 'urgent', left < BOSS_TIME_LIMIT / 3);
    }

    const killFraction = Math.min(1, state.killsOnFloor / KILLS_PER_FLOOR);
    setVariable(this.killFill, '--fill', `${(killFraction * 100).toFixed(0)}%`);
    setText(
      this.killText,
      t('combat.killProgress', { done: state.killsOnFloor, total: KILLS_PER_FLOOR }),
    );

    setText(this.dps, num(stats.damagePerSecond));
    setText(
      this.blessing,
      stats.blessed
        ? ` · ${t('combat.blessed', { time: duration(state.blessingRemaining) })}`
        : '',
    );

    setToggle(this.stage, 'struck', now < this.strikeUntil);
    this.effects.update(now);

    setHidden(this.boosts, !this.adsAvailable);
    if (this.adsAvailable) {
      setText(this.chestButton, t('boost.chest', { amount: num(chestValue(state)) }));
      setText(
        this.blessingButton,
        t('boost.blessing', { minutes: Math.round(BLESSING_DURATION_SECONDS / 60) }),
      );
    }
  }
}
