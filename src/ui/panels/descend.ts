/**
 * The compression panel: what collapsing the stone is worth, and what it costs.
 *
 * Also carries the settings, which belong here rather than behind a gear icon:
 * this is the only screen a player already visits deliberately, and burying
 * language and number-format behind another affordance would hide the two
 * controls most likely to be needed by someone who cannot read the interface.
 */

import type { Decimal } from '@core/decimal';
import type { Notation } from '@core/format';
import { duration, getLocale, t, type Locale } from '@core/i18n';
import { COMPRESSION_UNLOCK_STAGE, canCompress, pendingCrystals } from '@game/prestige';
import type { GameState } from '@game/state';
import { el, setDisabled, setText } from '../dom';

export interface DescendPanelDeps {
  readonly state: GameState;
  readonly num: (value: Decimal | number) => string;
  readonly notation: () => Notation;
  readonly onCompress: () => void;
  readonly onCycleNotation: () => void;
  readonly onLanguageChange: (locale: Locale) => void;
  readonly onWipe: () => void;
  readonly onToggleSound: () => void;
  readonly isSoundOn: () => boolean;
  readonly onExportSave: () => void;
  readonly onImportSave: () => void;
}

export class DescendPanel {
  private pending!: HTMLElement;
  private hint!: HTMLElement;
  private button!: HTMLButtonElement;
  private statList!: HTMLElement;
  private notationButton!: HTMLElement;
  private languageButton!: HTMLElement;
  private soundButton!: HTMLElement;
  /** Built once, then written through; the row count never changes. */
  private statValues: HTMLElement[] = [];

  constructor(private readonly deps: DescendPanelDeps) {}

  mount(): HTMLElement {
    this.button = el('button', { class: 'descend', type: 'button' }, [t('descend.button')]);
    this.button.addEventListener('click', () => this.deps.onCompress());

    const wipe = el('button', { class: 'danger', type: 'button' }, [t('settings.wipe')]);
    wipe.addEventListener('click', () => this.deps.onWipe());

    this.notationButton = el('button', { class: 'quiet', type: 'button' }, ['']);
    this.notationButton.addEventListener('click', () => this.deps.onCycleNotation());

    this.languageButton = el('button', { class: 'quiet', type: 'button' }, ['']);
    this.languageButton.addEventListener('click', () => {
      this.deps.onLanguageChange(getLocale() === 'ko' ? 'en' : 'ko');
    });

    this.soundButton = el('button', { class: 'quiet', type: 'button' }, ['']);
    this.soundButton.addEventListener('click', () => this.deps.onToggleSound());

    const exportButton = el('button', { class: 'quiet', type: 'button' }, [
      t('settings.export'),
    ]);
    exportButton.addEventListener('click', () => this.deps.onExportSave());

    const importButton = el('button', { class: 'quiet', type: 'button' }, [
      t('settings.import'),
    ]);
    importButton.addEventListener('click', () => this.deps.onImportSave());

    this.pending = el('strong', {}, ['0']);
    this.hint = el('p', { class: 'lock' }, ['']);
    this.statList = el('dl', { class: 'stats' });

    return el('section', { class: 'panel' }, [
      el('div', { class: 'descend-card' }, [
        el('h2', {}, [t('descend.title')]),
        el('p', { class: 'hint' }, [t('descend.body')]),
        el('div', { class: 'relic-preview' }, [
          this.pending,
          el('span', {}, [` ${t('descend.relics')}`]),
        ]),
        this.hint,
        this.button,
      ]),
      el('div', { class: 'stats-card' }, [el('h3', {}, [t('stats.title')]), this.statList]),
      el('div', { class: 'settings' }, [
        this.languageButton,
        this.notationButton,
        this.soundButton,
        exportButton,
        importButton,
        wipe,
      ]),
    ]);
  }

  update(): void {
    const state = this.deps.state;
    const num = this.deps.num;

    setText(this.pending, num(pendingCrystals(state.highestStage)));

    const ready = canCompress(state);
    setDisabled(this.button, !ready);
    setText(
      this.hint,
      ready ? t('descend.ready') : t('descend.locked', { n: COMPRESSION_UNLOCK_STAGE }),
    );

    setText(
      this.notationButton,
      t('settings.notation', { mode: t(`notation.${this.deps.notation()}`) }),
    );
    setText(this.languageButton, t('settings.language'));
    setText(
      this.soundButton,
      t(this.deps.isSoundOn() ? 'settings.soundOn' : 'settings.soundOff'),
    );

    const stats = state.stats;
    const lines: [string, string][] = [
      [t('stats.deepest'), String(state.highestStage)],
      [t('stats.descents'), String(stats.compressions)],
      [t('stats.kills'), num(stats.totalFragments)],
      [t('stats.guardiansFelled'), num(stats.stagesReached)],
      [t('stats.goldEarned'), num(state.lifetimeDust)],
      [t('stats.timePlayed'), duration(stats.playSeconds)],
    ];

    if (this.statValues.length !== lines.length) {
      this.statValues = lines.map(() => el('dd', {}, ['']));
      this.statList.replaceChildren(
        ...lines.flatMap(([label], index) => {
          const value = this.statValues[index];
          return value === undefined ? [el('dt', {}, [label])] : [el('dt', {}, [label]), value];
        }),
      );
    }

    lines.forEach(([, value], index) => {
      const node = this.statValues[index];
      if (node !== undefined) setText(node, value);
    });
  }
}
