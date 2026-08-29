/**
 * The interface shell: header, tabs, and the panels behind them.
 *
 * Built once, updated in place. `mount` creates every node the game will ever
 * show; `update` walks a fixed set and assigns strings. Nothing is created,
 * destroyed, or reordered while the game runs, which is what keeps a
 * permanently-open tab from leaking nodes and makes the per-frame cost a
 * handful of guarded string comparisons.
 *
 * There is no framework because there is nothing for one to do. The view is a
 * fixed tree and updating it is assigning strings to it; a diffing library
 * would add a download and a virtual tree to walk, to solve a problem this game
 * does not have.
 *
 * The layout is phone-first, because portal traffic is overwhelmingly phones:
 * one column, thumb-sized targets, nothing that needs a hover to discover.
 */

import type { Decimal } from '@core/decimal';
import { formatMultiplier, formatNumber, type Notation } from '@core/format';
import { t, type Locale } from '@core/i18n';
import type { SoundName } from '@platform/audio';
import { computeStats } from '@game/stats';
import type { GameState } from '@game/state';
import { companionEntries, upgradeEntries } from './catalogue';
import { el, setHidden, setText, setToggle } from './dom';
import { CombatPanel, type FrameFeedback } from './panels/combat';
import { DescendPanel } from './panels/descend';
import { OfflineModal, type OfflineSummary } from './panels/offline';
import { ShopPanel } from './panels/shop';

/** How many levels a purchase button buys. `max` spends whatever is banked. */
export type BuyQuantity = 1 | 10 | 'max';

const QUANTITIES: readonly BuyQuantity[] = [1, 10, 'max'];

/** The order the notation button cycles through. */
const NOTATIONS: readonly Notation[] = ['korean', 'suffix', 'scientific'];

const TABS = ['delve', 'party', 'descend'] as const;
type Tab = (typeof TABS)[number];

export interface ViewCallbacks {
  /** Plays an effect. The view never touches the audio device itself. */
  readonly sound: (name: SoundName) => void;
  readonly onDescend: () => void;
  /** The view cannot retranslate itself in place; the host rebuilds it. */
  readonly onLanguageChange: (locale: Locale) => void;
  readonly onWatchForBlessing: () => void;
  readonly onWatchForChest: () => void;
  readonly onDismissOffline: () => void;
  readonly onDoubleOffline: () => void;
  readonly onWipe: () => void;
  readonly onToggleSound: () => void;
  readonly isSoundOn: () => boolean;
  readonly onExportSave: () => void;
  readonly onImportSave: () => void;
  readonly onToggleAutoDelve: () => void;
}

/** What survives a rebuild, so a language switch does not feel like a reset. */
export interface UiState {
  readonly tab: Tab;
  readonly quantity: BuyQuantity;
}

export class GameView {
  private tab: Tab = 'delve';
  private quantity: BuyQuantity = 1;
  private notation: Notation = 'suffix';

  private readonly combat: CombatPanel;
  private readonly upgrades: ShopPanel;
  private readonly party: ShopPanel;
  private readonly descend: DescendPanel;
  private readonly offline: OfflineModal;

  private gold!: HTMLElement;
  private relics!: HTMLElement;
  private relicMultiplier!: HTMLElement;
  private readonly tabButtons = new Map<Tab, HTMLElement>();
  private readonly panels = new Map<Tab, HTMLElement>();
  private readonly quantityButtons = new Map<string, HTMLElement>();

  /** Set by the host so a notation change can be persisted. */
  onNotationChange: ((notation: Notation) => void) | undefined;

  constructor(
    private readonly root: HTMLElement,
    private readonly state: GameState,
    callbacks: ViewCallbacks,
  ) {
    const num = (value: Decimal | number): string => this.num(value);
    const wantedLevels = (): number => this.wantedLevels();

    this.combat = new CombatPanel({
      state,
      num,
      sound: callbacks.sound,
      onWatchForBlessing: callbacks.onWatchForBlessing,
      onWatchForChest: callbacks.onWatchForChest,
    });
    const shopDeps = { state, num, wantedLevels, sound: callbacks.sound };
    // The toggle lives on the upgrades panel because that is what it automates;
    // companions are bought rarely and deliberately.
    this.upgrades = new ShopPanel(upgradeEntries(), {
      ...shopDeps,
      onToggleAutoDelve: callbacks.onToggleAutoDelve,
    });
    this.party = new ShopPanel(companionEntries(), shopDeps);
    this.descend = new DescendPanel({
      state,
      num,
      notation: () => this.notation,
      onDescend: callbacks.onDescend,
      onCycleNotation: () => this.cycleNotation(),
      onLanguageChange: callbacks.onLanguageChange,
      onWipe: callbacks.onWipe,
      onToggleSound: callbacks.onToggleSound,
      isSoundOn: callbacks.isSoundOn,
      onExportSave: callbacks.onExportSave,
      onImportSave: callbacks.onImportSave,
    });
    this.offline = new OfflineModal({
      num,
      onDismiss: callbacks.onDismissOffline,
      onDouble: callbacks.onDoubleOffline,
    });
  }

  // -- host interface -------------------------------------------------------

  setAdsAvailable(available: boolean): void {
    this.combat.setAdsAvailable(available);
  }

  setNotation(notation: Notation): void {
    this.notation = notation;
  }

  getNotation(): Notation {
    return this.notation;
  }

  getUiState(): UiState {
    return { tab: this.tab, quantity: this.quantity };
  }

  restoreUiState(uiState: UiState): void {
    this.selectTab(uiState.tab);
    this.selectQuantity(uiState.quantity);
  }

  showOffline(summary: OfflineSummary): void {
    this.offline.show(summary);
  }

  hideOffline(): void {
    this.offline.hide();
  }

  markOfflineDoubled(): void {
    this.offline.markDoubled();
  }

  /** Hands one frame of simulation to the panel that can show it. */
  applyFeedback(feedback: FrameFeedback): void {
    this.combat.feedback(feedback);
  }

  /** A one-off announcement over the stage, for events with no frame report. */
  announce(text: string): void {
    this.combat.announce(text);
  }

  // -- construction ---------------------------------------------------------

  mount(): void {
    const delvePanel = el('section', { class: 'panel', role: 'tabpanel', id: 'panel-delve' }, [
      this.buildQuantitySelector(),
      this.upgrades.mount(),
    ]);
    const partyPanel = el('section', { class: 'panel', role: 'tabpanel', id: 'panel-party' }, [
      el('p', { class: 'hint' }, [t('party.hint')]),
      this.party.mount(),
    ]);
    const descendPanel = this.descend.mount();
    descendPanel.setAttribute('role', 'tabpanel');
    descendPanel.id = 'panel-descend';

    this.panels.set('delve', delvePanel);
    this.panels.set('party', partyPanel);
    this.panels.set('descend', descendPanel);

    this.root.append(
      this.buildHeader(),
      this.combat.mount(),
      this.buildTabs(),
      delvePanel,
      partyPanel,
      descendPanel,
      this.offline.mount(),
    );

    this.selectTab(this.tab);
    // The default has to be applied, not merely assumed: without this the game
    // opens with a quantity chosen in the model and none of the three buttons
    // showing as chosen.
    this.selectQuantity(this.quantity);
  }

  private buildHeader(): HTMLElement {
    this.gold = el('strong', {}, ['0']);
    this.relics = el('strong', {}, ['0']);
    this.relicMultiplier = el('em', {}, ['']);

    return el('header', { class: 'topbar' }, [
      el('div', { class: 'purse' }, [el('span', { class: 'coin' }, ['◈']), this.gold]),
      el('div', { class: 'purse relics' }, [
        el('span', { class: 'coin' }, ['✦']),
        this.relics,
        this.relicMultiplier,
      ]),
    ]);
  }

  private buildTabs(): HTMLElement {
    const labels: Record<Tab, string> = {
      delve: t('tab.upgrades'),
      party: t('tab.party'),
      descend: t('tab.descend'),
    };

    return el(
      'nav',
      { class: 'tabs', role: 'tablist' },
      TABS.map((tab) => {
        const button = el(
          'button',
          { class: 'tab', type: 'button', role: 'tab', 'aria-controls': `panel-${tab}` },
          [labels[tab]],
        );
        button.addEventListener('click', () => this.selectTab(tab));
        this.tabButtons.set(tab, button);
        return button;
      }),
    );
  }

  private buildQuantitySelector(): HTMLElement {
    return el(
      'div',
      { class: 'qty-select' },
      QUANTITIES.map((amount) => {
        const button = el('button', { class: 'qty-option', type: 'button' }, [
          amount === 'max' ? t('shop.quantityMax') : `×${amount}`,
        ]);
        button.addEventListener('click', () => this.selectQuantity(amount));
        this.quantityButtons.set(String(amount), button);
        return button;
      }),
    );
  }

  // -- interaction ----------------------------------------------------------

  private selectTab(tab: Tab): void {
    this.tab = tab;
    for (const candidate of TABS) {
      const button = this.tabButtons.get(candidate);
      const panel = this.panels.get(candidate);
      if (button !== undefined) {
        setToggle(button, 'active', candidate === tab);
        // Assistive technology reads the selected state, not the class.
        button.setAttribute('aria-selected', String(candidate === tab));
      }
      if (panel !== undefined) setHidden(panel, candidate !== tab);
    }
  }

  private selectQuantity(quantity: BuyQuantity): void {
    this.quantity = quantity;
    for (const option of QUANTITIES) {
      const button = this.quantityButtons.get(String(option));
      if (button !== undefined) setToggle(button, 'active', option === quantity);
    }
  }

  private cycleNotation(): void {
    const next = NOTATIONS[(NOTATIONS.indexOf(this.notation) + 1) % NOTATIONS.length];
    this.notation = next ?? 'suffix';
    this.onNotationChange?.(this.notation);
  }

  private wantedLevels(): number {
    return this.quantity === 'max' ? Number.MAX_SAFE_INTEGER : this.quantity;
  }

  private num(value: Decimal | number): string {
    return formatNumber(value, { notation: this.notation });
  }

  // -- per-frame update -----------------------------------------------------

  update(): void {
    const stats = computeStats(this.state);

    setText(this.gold, this.num(this.state.gold));
    setText(this.relics, this.num(this.state.relics));
    setText(
      this.relicMultiplier,
      this.state.relics.isZero ? '' : formatMultiplier(stats.relicMultiplier),
    );

    this.combat.update();

    // Only the visible panel is repainted. The others are behind a `hidden`
    // attribute and will be brought up to date the moment they are shown.
    if (this.tab === 'delve') this.upgrades.update();
    else if (this.tab === 'party') this.party.update();
    else this.descend.update();
  }
}
