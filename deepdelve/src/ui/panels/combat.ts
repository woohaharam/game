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
import { el, setHidden, setText, setToggle, setVariable } from '../dom';

export interface CombatPanelDeps {
  readonly state: GameState;
  readonly num: (value: Decimal | number) => string;
  readonly onWatchForBlessing: () => void;
  readonly onWatchForChest: () => void;
}

export class CombatPanel {
  private adsAvailable = false;

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

  update(): void {
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
