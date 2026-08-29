/**
 * The "while you were away" summary.
 *
 * The one moment in the game with a captive audience, and therefore the one
 * place a rewarded advertisement is genuinely welcome: the player has just been
 * handed something and is being offered twice as much. It is also the only
 * modal in the game, which is deliberate — anything else that interrupts an
 * idle game is interrupting the thing the player came for.
 */

import type { Decimal } from '@core/decimal';
import { duration, t } from '@core/i18n';
import { el, setHidden, setText } from '../dom';

export interface OfflineSummary {
  readonly awaySeconds: number;
  readonly gold: Decimal;
  readonly kills: number;
  readonly floors: number;
  readonly cappedOut: boolean;
  readonly canDouble: boolean;
}

export interface OfflineModalDeps {
  readonly num: (value: Decimal | number) => string;
  readonly onDismiss: () => void;
  readonly onDouble: () => void;
}

export class OfflineModal {
  private backdrop!: HTMLElement;
  private away!: HTMLElement;
  private gold!: HTMLElement;
  private kills!: HTMLElement;
  private floors!: HTMLElement;
  private cap!: HTMLElement;
  private double!: HTMLElement;
  private dismissButton!: HTMLButtonElement;

  constructor(private readonly deps: OfflineModalDeps) {}

  mount(): HTMLElement {
    const dismiss = el('button', { class: 'primary', type: 'button' }, [t('offline.continue')]);
    dismiss.addEventListener('click', () => this.deps.onDismiss());
    this.dismissButton = dismiss;

    this.double = el('button', { class: 'ad', type: 'button' }, [t('offline.double')]);
    this.double.addEventListener('click', () => this.deps.onDouble());

    this.away = el('p', { class: 'away' }, ['']);
    this.gold = el('dd', {}, ['0']);
    this.kills = el('dd', {}, ['0']);
    this.floors = el('dd', {}, ['0']);
    this.cap = el('p', { class: 'lock' }, ['']);

    this.backdrop = el('div', { class: 'modal-backdrop' }, [
      el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, [
        el('h2', {}, [t('offline.title')]),
        this.away,
        el('dl', { class: 'stats' }, [
          el('dt', {}, [t('offline.gold')]),
          this.gold,
          el('dt', {}, [t('offline.kills')]),
          this.kills,
          el('dt', {}, [t('offline.floors')]),
          this.floors,
        ]),
        this.cap,
        el('div', { class: 'modal-actions' }, [this.double, dismiss]),
      ]),
    ]);
    this.backdrop.hidden = true;
    return this.backdrop;
  }

  show(summary: OfflineSummary): void {
    setText(this.away, t('offline.away', { duration: duration(summary.awaySeconds) }));
    setText(this.gold, this.deps.num(summary.gold));
    setText(this.kills, this.deps.num(summary.kills));
    setText(this.floors, String(summary.floors));
    setText(this.cap, summary.cappedOut ? t('offline.cap') : '');
    setHidden(this.double, !summary.canDouble);
    setHidden(this.backdrop, false);
    // After it is shown, not before: focus does not move to a hidden element,
    // and a keyboard user opening the game would otherwise be left behind the
    // dialog with no obvious way through it.
    this.dismissButton.focus();
  }

  hide(): void {
    setHidden(this.backdrop, true);
  }

  markDoubled(): void {
    setHidden(this.double, true);
  }
}
