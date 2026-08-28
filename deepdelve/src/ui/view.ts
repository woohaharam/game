/**
 * The whole interface.
 *
 * Built once, updated in place. `mount` creates every node the game will ever
 * show and stores the ones that change; `update` walks that fixed set and
 * assigns strings. Nothing is created, destroyed, or reordered while the game
 * is running, which is what keeps a permanently-open tab from leaking nodes and
 * what makes the per-frame cost a handful of string comparisons.
 *
 * The layout is phone-first, because portal traffic is overwhelmingly phones:
 * one column, thumb-sized targets, and nothing that needs a hover to discover.
 */

import { Decimal } from '@core/decimal';
import { formatDuration, formatMultiplier, formatNumber, type Notation } from '@core/format';
import {
  BOSS_TIME_LIMIT,
  KILLS_PER_FLOOR,
  guardianName,
  monsterName,
  zoneName,
} from '@game/content/floors';
import { COMPANIONS, type CompanionId } from '@game/content/companions';
import { UPGRADES, type UpgradeId } from '@game/content/upgrades';
import { DESCENT_UNLOCK_FLOOR, canDescend, pendingRelics } from '@game/prestige';
import { BLESSING_DURATION_SECONDS, chestValue } from '@game/rewards';
import {
  buyCompanion,
  buyUpgrade,
  isCompanionUnlocked,
  isUpgradeUnlocked,
  nextCompanionCost,
  nextUpgradeCost,
} from '@game/shop';
import { affordableLevels, upgradeBulkCost } from '@game/content/upgrades';
import { computeStats } from '@game/stats';
import { maxHealthOfCurrentEnemy, type GameState } from '@game/state';
import { upgradeById } from '@game/content/upgrades';
import { el, setDisabled, setHidden, setText, setToggle, setVariable } from './dom';

/** How many levels a purchase button buys. `max` spends whatever is banked. */
export type BuyQuantity = 1 | 10 | 'max';

export interface ViewCallbacks {
  readonly onDescend: () => void;
  readonly onWatchForBlessing: () => void;
  readonly onWatchForChest: () => void;
  readonly onDismissOffline: () => void;
  readonly onDoubleOffline: () => void;
  readonly onWipe: () => void;
}

interface UpgradeRow {
  readonly root: HTMLElement;
  readonly level: HTMLElement;
  readonly cost: HTMLElement;
  readonly button: HTMLButtonElement;
  readonly quantity: HTMLElement;
}

const TABS = ['delve', 'party', 'descend'] as const;
type Tab = (typeof TABS)[number];

export class GameView {
  private readonly nodes = new Map<string, HTMLElement>();
  private readonly upgradeRows = new Map<UpgradeId, UpgradeRow>();
  private readonly companionRows = new Map<CompanionId, UpgradeRow>();

  private tab: Tab = 'delve';
  private quantity: BuyQuantity = 1;
  private notation: Notation = 'suffix';
  private adsAvailable = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly state: GameState,
    private readonly callbacks: ViewCallbacks,
  ) {}

  private ref(id: string): HTMLElement {
    const node = this.nodes.get(id);
    if (node === undefined) throw new Error(`view node missing: ${id}`);
    return node;
  }

  private track<T extends HTMLElement>(id: string, node: T): T {
    this.nodes.set(id, node);
    return node;
  }

  setAdsAvailable(available: boolean): void {
    this.adsAvailable = available;
  }

  setNotation(notation: Notation): void {
    this.notation = notation;
  }

  getNotation(): Notation {
    return this.notation;
  }

  private num(value: Decimal | number): string {
    return formatNumber(value, { notation: this.notation });
  }

  // -- construction ---------------------------------------------------------

  mount(): void {
    this.root.append(
      this.buildHeader(),
      this.buildCombat(),
      this.buildTabs(),
      this.buildDelvePanel(),
      this.buildPartyPanel(),
      this.buildDescendPanel(),
      this.buildOfflineModal(),
    );
    this.selectTab('delve');
    // The default has to be applied, not just assumed: without this the game
    // opens with a quantity selected in the model and none of the three buttons
    // showing as chosen.
    this.selectQuantity(this.quantity);
  }

  private buildHeader(): HTMLElement {
    return el('header', { class: 'topbar' }, [
      el('div', { class: 'purse' }, [
        el('span', { class: 'coin' }, ['◈']),
        this.track('gold', el('strong', { id: 'gold' }, ['0'])),
      ]),
      el('div', { class: 'purse relics' }, [
        el('span', { class: 'coin' }, ['✦']),
        this.track('relics', el('strong', {}, ['0'])),
        this.track('relicMultiplier', el('em', {}, [''])),
      ]),
    ]);
  }

  private buildCombat(): HTMLElement {
    return el('section', { class: 'combat' }, [
      el('div', { class: 'floorline' }, [
        this.track('zone', el('span', { class: 'zone' }, ['Mossy Crypt'])),
        this.track('depth', el('span', { class: 'depth' }, ['Floor 1'])),
      ]),

      this.track(
        'stage',
        el('div', { class: 'stage' }, [
          this.track('sprite', el('div', { class: 'sprite' }, ['🐀'])),
          this.track('enemyName', el('div', { class: 'enemy-name' }, ['Crypt Rat'])),
          el('div', { class: 'healthbar' }, [
            this.track('healthFill', el('div', { class: 'fill' })),
            this.track('healthText', el('span', { class: 'bartext' }, [''])),
          ]),
          this.track(
            'timer',
            el('div', { class: 'timer' }, [
              this.track('timerText', el('span', {}, ['']))
            ]),
          ),
        ]),
      ),

      el('div', { class: 'progressline' }, [
        el('div', { class: 'killbar' }, [this.track('killFill', el('div', { class: 'fill' }))]),
        this.track('killText', el('span', { class: 'killtext' }, ['0 / 10'])),
      ]),

      el('div', { class: 'readout' }, [
        el('span', {}, ['Damage ']),
        this.track('dps', el('strong', {}, ['0'])),
        el('span', {}, [' / sec']),
        this.track('blessing', el('span', { class: 'blessing' }, [''])),
      ]),

      this.buildBoosts(),
    ]);
  }

  private buildBoosts(): HTMLElement {
    const blessing = this.track(
      'blessingButton',
      el('button', { class: 'ad', type: 'button' }, ['▶ Blessing']),
    );
    blessing.addEventListener('click', () => this.callbacks.onWatchForBlessing());

    const chest = this.track('chestButton', el('button', { class: 'ad', type: 'button' }, ['▶ Chest']));
    chest.addEventListener('click', () => this.callbacks.onWatchForChest());

    return this.track('boosts', el('div', { class: 'boosts' }, [blessing, chest]));
  }

  private buildTabs(): HTMLElement {
    const labels: Record<Tab, string> = {
      delve: 'Upgrades',
      party: 'Party',
      descend: 'Descend',
    };
    return el(
      'nav',
      { class: 'tabs' },
      TABS.map((tab) => {
        const button = this.track(
          `tab-${tab}`,
          el('button', { class: 'tab', type: 'button' }, [labels[tab]]),
        );
        button.addEventListener('click', () => this.selectTab(tab));
        return button;
      }),
    );
  }

  private buildShopRow(
    key: string,
    icon: string,
    name: string,
    description: string,
    onBuy: () => void,
  ): UpgradeRow {
    const level = el('span', { class: 'level' }, ['Lv 0']);
    const cost = el('span', { class: 'cost' }, ['0']);
    const quantity = el('span', { class: 'qty' }, ['']);
    const button = el('button', { class: 'buy', type: 'button' }, [cost, quantity]);
    button.addEventListener('click', onBuy);

    const root = el('div', { class: 'row', 'data-key': key }, [
      el('span', { class: 'icon' }, [icon]),
      el('div', { class: 'about' }, [
        el('div', { class: 'name' }, [name, level]),
        el('div', { class: 'desc' }, [description]),
      ]),
      button,
    ]);

    return { root, level, cost, button, quantity };
  }

  private buildDelvePanel(): HTMLElement {
    const quantities: readonly BuyQuantity[] = [1, 10, 'max'];
    const selector = el(
      'div',
      { class: 'qty-select' },
      quantities.map((amount) => {
        const button = this.track(
          `qty-${String(amount)}`,
          el('button', { class: 'qty-option', type: 'button' }, [
            amount === 'max' ? 'MAX' : `×${amount}`,
          ]),
        );
        button.addEventListener('click', () => this.selectQuantity(amount));
        return button;
      }),
    );

    const rows = UPGRADES.map((upgrade) => {
      const row = this.buildShopRow(upgrade.id, upgrade.icon, upgrade.name, upgrade.description, () =>
        this.purchaseUpgrade(upgrade.id),
      );
      this.upgradeRows.set(upgrade.id, row);
      return row.root;
    });

    return this.track(
      'panel-delve',
      el('section', { class: 'panel' }, [selector, el('div', { class: 'rows' }, rows)]),
    );
  }

  private buildPartyPanel(): HTMLElement {
    const rows = COMPANIONS.map((companion) => {
      const row = this.buildShopRow(
        companion.id,
        companion.icon,
        `${companion.name}, ${companion.title}`,
        `+${formatNumber(companion.damagePerLevel)} damage per second.`,
        () => this.purchaseCompanion(companion.id),
      );
      this.companionRows.set(companion.id, row);
      return row.root;
    });

    return this.track(
      'panel-party',
      el('section', { class: 'panel' }, [
        el('p', { class: 'hint' }, ['Companions fight on their own and never stop.']),
        el('div', { class: 'rows' }, rows),
      ]),
    );
  }

  private buildDescendPanel(): HTMLElement {
    const button = this.track(
      'descendButton',
      el('button', { class: 'descend', type: 'button' }, ['Descend']),
    );
    button.addEventListener('click', () => this.callbacks.onDescend());

    const wipe = el('button', { class: 'danger', type: 'button' }, ['Erase save']);
    wipe.addEventListener('click', () => this.callbacks.onWipe());

    const notationButton = this.track(
      'notationButton',
      el('button', { class: 'quiet', type: 'button' }, ['Notation: suffix']),
    );
    notationButton.addEventListener('click', () => {
      this.notation = this.notation === 'suffix' ? 'scientific' : 'suffix';
    });

    return this.track(
      'panel-descend',
      el('section', { class: 'panel' }, [
        el('div', { class: 'descend-card' }, [
          el('h2', {}, ['Leave the run behind']),
          el('p', { class: 'hint' }, [
            'Surrender this run to keep its relics. Every relic is a permanent +25% ' +
              'to damage and gold, on this run and every run after it.',
          ]),
          el('div', { class: 'relic-preview' }, [
            this.track('pendingRelics', el('strong', {}, ['0'])),
            el('span', {}, [' relics']),
          ]),
          this.track('descendHint', el('p', { class: 'lock' }, [''])),
          button,
        ]),
        el('div', { class: 'stats-card' }, [
          el('h3', {}, ['This save']),
          this.track('statLines', el('dl', { class: 'stats' })),
        ]),
        el('div', { class: 'settings' }, [notationButton, wipe]),
      ]),
    );
  }

  private buildOfflineModal(): HTMLElement {
    const dismiss = el('button', { class: 'primary', type: 'button' }, ['Continue']);
    dismiss.addEventListener('click', () => this.callbacks.onDismissOffline());

    const double = this.track(
      'offlineDouble',
      el('button', { class: 'ad', type: 'button' }, ['▶ Double it']),
    );
    double.addEventListener('click', () => this.callbacks.onDoubleOffline());

    const modal = this.track(
      'offlineModal',
      el('div', { class: 'modal-backdrop' }, [
        el('div', { class: 'modal' }, [
          el('h2', {}, ['While you were away']),
          this.track('offlineDuration', el('p', { class: 'away' }, [''])),
          el('dl', { class: 'stats' }, [
            el('dt', {}, ['Gold']),
            this.track('offlineGold', el('dd', {}, ['0'])),
            el('dt', {}, ['Kills']),
            this.track('offlineKills', el('dd', {}, ['0'])),
            el('dt', {}, ['Floors']),
            this.track('offlineFloors', el('dd', {}, ['0'])),
          ]),
          this.track('offlineCap', el('p', { class: 'lock' }, [''])),
          el('div', { class: 'modal-actions' }, [double, dismiss]),
        ]),
      ]),
    );
    modal.hidden = true;
    return modal;
  }

  // -- interaction ----------------------------------------------------------

  private selectTab(tab: Tab): void {
    this.tab = tab;
    for (const candidate of TABS) {
      setToggle(this.ref(`tab-${candidate}`), 'active', candidate === tab);
      setHidden(this.ref(`panel-${candidate}`), candidate !== tab);
    }
  }

  private selectQuantity(quantity: BuyQuantity): void {
    this.quantity = quantity;
    for (const option of [1, 10, 'max'] as const) {
      setToggle(this.ref(`qty-${String(option)}`), 'active', option === quantity);
    }
  }

  private purchaseUpgrade(id: UpgradeId): void {
    buyUpgrade(this.state, id, this.quantity === 'max' ? Number.MAX_SAFE_INTEGER : this.quantity);
  }

  private purchaseCompanion(id: CompanionId): void {
    buyCompanion(this.state, id, this.quantity === 'max' ? 100 : this.quantity);
  }

  showOffline(summary: {
    readonly awaySeconds: number;
    readonly gold: Decimal;
    readonly kills: number;
    readonly floors: number;
    readonly cappedOut: boolean;
    readonly canDouble: boolean;
  }): void {
    setText(this.ref('offlineDuration'), `You were gone ${formatDuration(summary.awaySeconds)}.`);
    setText(this.ref('offlineGold'), this.num(summary.gold));
    setText(this.ref('offlineKills'), this.num(summary.kills));
    setText(this.ref('offlineFloors'), String(summary.floors));
    setText(
      this.ref('offlineCap'),
      summary.cappedOut ? 'The party can only press on for eight hours unattended.' : '',
    );
    setHidden(this.ref('offlineDouble'), !summary.canDouble);
    setHidden(this.ref('offlineModal'), false);
  }

  hideOffline(): void {
    setHidden(this.ref('offlineModal'), true);
  }

  markOfflineDoubled(): void {
    setHidden(this.ref('offlineDouble'), true);
  }

  // -- per-frame update -----------------------------------------------------

  update(): void {
    const state = this.state;
    const stats = computeStats(state);

    setText(this.ref('gold'), this.num(state.gold));
    setText(this.ref('relics'), this.num(state.relics));
    setText(
      this.ref('relicMultiplier'),
      state.relics.isZero ? '' : formatMultiplier(stats.relicMultiplier),
    );

    setText(this.ref('zone'), zoneName(state.floor));
    setText(this.ref('depth'), `Floor ${state.floor}`);

    const maxHealth = maxHealthOfCurrentEnemy(state);
    const fraction = maxHealth.isZero
      ? 0
      : Math.min(1, Math.max(0, state.enemyHealthRemaining.divide(maxHealth).toNumber()));
    setVariable(this.ref('healthFill'), '--fill', `${(fraction * 100).toFixed(1)}%`);
    setText(this.ref('healthText'), this.num(state.enemyHealthRemaining));

    setToggle(this.ref('stage'), 'guardian', state.fightingGuardian);
    setText(
      this.ref('enemyName'),
      state.fightingGuardian ? guardianName(state.floor) : monsterName(state.floor, state.enemyIndex),
    );
    setText(this.ref('sprite'), state.fightingGuardian ? '👑' : '🐀');

    setHidden(this.ref('timer'), !state.fightingGuardian);
    if (state.fightingGuardian) {
      const left = Math.max(0, state.guardianTimeRemaining);
      setText(this.ref('timerText'), `${left.toFixed(1)}s`);
      setToggle(this.ref('timer'), 'urgent', left < BOSS_TIME_LIMIT / 3);
    }

    const killFraction = Math.min(1, state.killsOnFloor / KILLS_PER_FLOOR);
    setVariable(this.ref('killFill'), '--fill', `${(killFraction * 100).toFixed(0)}%`);
    setText(this.ref('killText'), `${state.killsOnFloor} / ${KILLS_PER_FLOOR}`);

    setText(this.ref('dps'), this.num(stats.damagePerSecond));
    setText(
      this.ref('blessing'),
      stats.blessed ? ` · blessed ${formatDuration(state.blessingRemaining)}` : '',
    );

    setHidden(this.ref('boosts'), !this.adsAvailable);
    if (this.adsAvailable) {
      setText(this.ref('chestButton'), `▶ Chest · ${this.num(chestValue(state))}`);
      setText(
        this.ref('blessingButton'),
        `▶ Blessing · 2× for ${formatDuration(BLESSING_DURATION_SECONDS)}`,
      );
    }

    if (this.tab === 'delve') this.updateShop();
    if (this.tab === 'party') this.updateParty();
    if (this.tab === 'descend') this.updateDescend();

    setText(this.ref('notationButton'), `Notation: ${this.notation}`);
  }

  private updateShop(): void {
    for (const definition of UPGRADES) {
      const row = this.upgradeRows.get(definition.id);
      if (row === undefined) continue;

      const unlocked = isUpgradeUnlocked(this.state, definition);
      setHidden(row.root, !unlocked);
      if (!unlocked) continue;

      const level = this.state.upgrades[definition.id];
      const capped = definition.maxLevel !== undefined && level >= definition.maxLevel;
      setText(row.level, capped ? 'MAX' : `Lv ${level}`);

      if (capped) {
        setText(row.cost, '—');
        setText(row.quantity, '');
        setDisabled(row.button, true);
        continue;
      }

      // The button shows what pressing it right now would actually cost and
      // buy, rather than a sticker price for one level the player is not
      // buying. On MAX that means recomputing the affordable count each frame,
      // which is a logarithm, not a loop.
      const wanted =
        this.quantity === 'max'
          ? Math.max(1, affordableLevels(definition, level, this.state.gold))
          : this.quantity;
      const capacity =
        definition.maxLevel === undefined ? wanted : Math.min(wanted, definition.maxLevel - level);
      const price = upgradeBulkCost(definition, level, Math.max(1, capacity));

      setText(row.cost, this.num(price));
      setText(row.quantity, capacity > 1 ? ` ×${capacity}` : '');
      setDisabled(row.button, price.greaterThan(this.state.gold));
      setToggle(row.root, 'affordable', !price.greaterThan(this.state.gold));
    }
  }

  private updateParty(): void {
    for (const definition of COMPANIONS) {
      const row = this.companionRows.get(definition.id);
      if (row === undefined) continue;

      const unlocked = isCompanionUnlocked(this.state, definition);
      setHidden(row.root, !unlocked);
      if (!unlocked) continue;

      const level = this.state.companions[definition.id];
      setText(row.level, `Lv ${level}`);
      const price = nextCompanionCost(this.state, definition.id);
      setText(row.cost, this.num(price));
      setText(row.quantity, '');
      setDisabled(row.button, price.greaterThan(this.state.gold));
      setToggle(row.root, 'affordable', !price.greaterThan(this.state.gold));
    }
  }

  private updateDescend(): void {
    const pending = pendingRelics(this.state.highestFloor);
    setText(this.ref('pendingRelics'), this.num(pending));

    const ready = canDescend(this.state);
    setDisabled(this.ref('descendButton') as HTMLButtonElement, !ready);
    setText(
      this.ref('descendHint'),
      ready
        ? 'Gold, upgrades and companions are lost. Relics are not.'
        : `Clear floor ${DESCENT_UNLOCK_FLOOR} to unlock descending.`,
    );

    const stats = this.state.stats;
    const lines: Array<[string, string]> = [
      ['Deepest floor', String(this.state.highestFloor)],
      ['Descents', String(stats.descents)],
      ['Kills', this.num(stats.totalKills)],
      ['Guardians felled', this.num(stats.guardiansFelled)],
      ['Guardians escaped', this.num(stats.guardiansEscaped)],
      ['Gold earned', this.num(this.state.lifetimeGold)],
      ['Time delved', formatDuration(stats.playSeconds)],
    ];

    const list = this.ref('statLines');
    // Rebuilt only when the row count changes, which it never does after the
    // first pass; the values themselves are written through setText.
    if (list.childElementCount !== lines.length * 2) {
      list.replaceChildren(
        ...lines.flatMap(([label]) => [el('dt', {}, [label]), el('dd', {}, [''])]),
      );
    }
    const values = list.querySelectorAll('dd');
    lines.forEach(([, value], index) => {
      const node = values[index];
      if (node instanceof HTMLElement) setText(node, value);
    });
  }
}

/** Re-exported so the boot code does not need a second import for this. */
export { upgradeById, nextUpgradeCost };
