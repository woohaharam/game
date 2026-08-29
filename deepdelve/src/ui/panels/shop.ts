/**
 * A list of things to buy.
 *
 * Renders any `ShopEntry` list, so the upgrade shop and the party roster are
 * one implementation with two catalogues rather than two near-identical render
 * paths that drift apart.
 */

import type { Decimal } from '@core/decimal';
import { t } from '@core/i18n';
import type { Purchase } from '@game/shop';
import type { GameState } from '@game/state';
import type { ShopEntry } from '../catalogue';
import { el, setDisabled, setHidden, setText, setToggle } from '../dom';

interface Row {
  readonly root: HTMLElement;
  readonly name: HTMLElement;
  readonly description: HTMLElement;
  readonly level: HTMLElement;
  readonly cost: HTMLElement;
  readonly quantity: HTMLElement;
  readonly button: HTMLButtonElement;
}

export interface ShopPanelDeps {
  readonly state: GameState;
  /** Locale-aware number rendering, owned by the view. */
  readonly num: (value: Decimal | number) => string;
  /** How many levels the current quantity setting asks for. */
  readonly wantedLevels: () => number;
}

export class ShopPanel {
  private readonly rows = new Map<string, Row>();
  private root: HTMLElement | null = null;

  constructor(
    private readonly entries: readonly ShopEntry[],
    private readonly deps: ShopPanelDeps,
  ) {}

  /** Builds the rows. `header` is prepended, for a panel that needs a hint. */
  mount(header?: HTMLElement): HTMLElement {
    const rows = this.entries.map((entry) => this.buildRow(entry));
    const children = header === undefined ? rows : [header, ...rows];
    this.root = el('div', { class: 'rows' }, children);
    return this.root;
  }

  private buildRow(entry: ShopEntry): HTMLElement {
    const level = el('span', { class: 'level' }, ['']);
    const cost = el('span', { class: 'cost' }, ['0']);
    const quantity = el('span', { class: 'qty' }, ['']);
    const button = el('button', { class: 'buy', type: 'button' }, [cost, quantity]);
    button.addEventListener('click', () => {
      entry.buy(this.deps.state, this.deps.wantedLevels());
    });

    const name = el('span', { class: 'label' }, ['']);
    const description = el('div', { class: 'desc' }, ['']);

    const root = el('div', { class: 'row', 'data-key': entry.key }, [
      el('span', { class: 'icon' }, [entry.icon]),
      el('div', { class: 'about' }, [el('div', { class: 'name' }, [name, level]), description]),
      button,
    ]);

    this.rows.set(entry.key, { root, name, description, level, cost, quantity, button });
    return root;
  }

  update(): void {
    const state = this.deps.state;

    for (const entry of this.entries) {
      const row = this.rows.get(entry.key);
      if (row === undefined) continue;

      const unlocked = entry.unlocked(state);
      setHidden(row.root, !unlocked);
      if (!unlocked) continue;

      setText(row.name, entry.name());
      setText(row.description, entry.description());

      const maxed = entry.maxed(state);
      setText(row.level, maxed ? t('shop.maxed') : t('shop.level', { n: entry.level(state) }));

      if (maxed) {
        setText(row.cost, '—');
        setText(row.quantity, '');
        setDisabled(row.button, true);
        setToggle(row.root, 'affordable', false);
        continue;
      }

      this.paintPrice(row, entry.quote(state, this.deps.wantedLevels()), () =>
        entry.unitPrice(state),
      );
    }
  }

  /**
   * Labels a buy button from the same quote the click acts on.
   *
   * That is the point of routing both through `quote`: the button can never
   * promise a count or a price the purchase would not honour. When nothing is
   * affordable it shows one level's price, which is the number the player is
   * saving towards.
   */
  private paintPrice(row: Row, quote: Purchase, fallbackPrice: () => Decimal): void {
    const affordable = quote.bought > 0;
    setText(row.cost, this.deps.num(affordable ? quote.spent : fallbackPrice()));
    setText(row.quantity, quote.bought > 1 ? ` ×${quote.bought}` : '');
    setDisabled(row.button, !affordable);
    setToggle(row.root, 'affordable', affordable);
  }
}
