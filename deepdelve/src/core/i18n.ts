/**
 * Locale selection and string lookup.
 *
 * Kept deliberately small: a key-value table per locale, `{name}` placeholders,
 * and a module-level current locale. There is no message-format library because
 * the game has no plurals to agree and no genders to inflect — Korean has no
 * plural marking at all, and the English strings that count things read fine
 * with a bare number.
 *
 * The choice is persisted separately from the save, so erasing a run does not
 * silently put the interface back into a language the player does not read.
 */

import { formatDuration, type Notation } from './format';
import { en, type StringKey } from './strings/en';
import { ko } from './strings/ko';

export type Locale = 'en' | 'ko';

export const LOCALES: readonly Locale[] = ['ko', 'en'];

const TABLES: Record<Locale, Record<StringKey, string>> = { en, ko };

export const LOCALE_STORAGE_KEY = 'deepdelve.locale';

let current: Locale = 'ko';

export function getLocale(): Locale {
  return current;
}

export function setLocale(locale: Locale): void {
  current = locale;
  if (typeof document === 'undefined') return;

  // `lang` is not cosmetic: it selects the font the browser reaches for, decides
  // how a screen reader pronounces the page, and changes line-breaking rules.
  document.documentElement.lang = locale;
  document.title = t('game.title');

  const description = document.querySelector('meta[name="description"]');
  if (description !== null) description.setAttribute('content', t('game.description'));
}

function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'ko';
}

/**
 * Picks a locale from an explicit choice, the URL, or the browser.
 *
 * Portals append their own query parameters and some pass a language through,
 * so `?lang=` is honoured ahead of the browser setting — a player who followed
 * a Korean listing should not land on English because their OS is in English.
 */
export function detectLocale(options: {
  readonly stored?: string | null;
  readonly search?: string;
  readonly languages?: readonly string[];
}): Locale {
  if (isLocale(options.stored)) return options.stored;

  const fromQuery = new URLSearchParams(options.search ?? '').get('lang');
  if (isLocale(fromQuery)) return fromQuery;

  for (const tag of options.languages ?? []) {
    // Match on the primary subtag so ko-KR, ko-Kore-KR and plain ko all land.
    const primary = tag.toLowerCase().split('-')[0];
    if (isLocale(primary)) return primary;
  }

  return 'en';
}

/** Looks up a string and substitutes `{name}` placeholders. */
export function t(key: StringKey, params: Readonly<Record<string, string | number>> = {}): string {
  const table = TABLES[current];
  // Falling back to English rather than to the key itself: an untranslated
  // string is a small blemish, a raw `descend.locked` in the UI is a bug report.
  const template = table[key] ?? en[key];

  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}

export type { StringKey };

/** `formatDuration` with the current locale's unit labels. */
export function duration(seconds: number): string {
  return formatDuration(seconds, {
    day: t('duration.day'),
    hour: t('duration.hour'),
    minute: t('duration.minute'),
    second: t('duration.second'),
  });
}

/**
 * The notation a locale should start in.
 *
 * Korean readers group in fours; everyone else gets the K/M/B path. It is only
 * a default — the setting is cycled by hand and persisted.
 */
export function defaultNotation(locale: Locale): Notation {
  return locale === 'ko' ? 'korean' : 'suffix';
}
