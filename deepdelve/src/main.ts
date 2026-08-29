/**
 * Boot, loop, and the wiring between the game and the page it lives on.
 *
 * The interesting problems here are all about time. A browser tab does not run
 * while it is in the background: `requestAnimationFrame` simply stops, and when
 * the tab comes back the first frame reports an enormous delta that would
 * either be clamped away (losing the player's progress) or applied raw (letting
 * anyone bank hours by tabbing away). Neither is acceptable, so the frame delta
 * is only ever trusted for small values, and anything longer is reconciled
 * against the wall clock through the same offline path a fresh page load uses.
 */

import './ui/styles.css';

import {
  defaultNotation,
  detectLocale,
  setLocale,
  t,
  LOCALE_STORAGE_KEY,
  type Locale,
} from '@core/i18n';
import type { Notation } from '@core/format';
import { createStore } from '@core/storage';
import { applyOfflineProgress, doubleOfflineEarnings, type OfflineResult } from '@game/offline';
import { canDescend, descend } from '@game/prestige';
import { grantBlessing, grantChest } from '@game/rewards';
import { load, save, wipe } from '@game/save';
import { advance } from '@game/simulation';
import { detectAdProvider } from '@platform/portals';
import { GameView } from '@ui/view';

/**
 * Longest frame delta trusted as a real frame.
 *
 * A dropped frame or a slow garbage collection can produce a few hundred
 * milliseconds legitimately. Anything past a second means the tab was not
 * running, and that time belongs to the offline path, which is capped and
 * audited, rather than to the frame loop, which is neither.
 */
const MAX_FRAME_SECONDS = 1;

/** Saving is cheap, but not free; ten seconds bounds a crash to ten seconds. */
const AUTOSAVE_INTERVAL_MS = 10_000;

/** Text updates are throttled; the simulation is not. */
const RENDER_INTERVAL_MS = 1000 / 20;

function boot(): void {
  const found = document.querySelector<HTMLElement>('#app');
  if (found === null) throw new Error('#app missing');
  // Rebound after the guard: `rebuildView` is a hoisted declaration, and the
  // narrowing on the original binding does not reach into it.
  const root: HTMLElement = found;

  const store = createStore();
  const loaded = load(store);
  const state = loaded.state;

  let paused = false;
  const provider = detectAdProvider(globalThis, {
    onAdStart: () => {
      paused = true;
      provider.gameplayStop();
    },
    onAdEnd: () => {
      paused = false;
      // The clock kept running behind the ad; hand that time to the offline
      // path rather than to the next frame delta.
      reconcile();
      provider.gameplayStart();
    },
  });

  let pendingOffline: OfflineResult | null = null;

  // Preferences live outside the save: erasing a run should not drop the player
  // back into a language they cannot read.
  const NOTATION_KEY = 'deepdelve.notation';
  const locale = detectLocale({
    stored: store.read(LOCALE_STORAGE_KEY),
    search: globalThis.location.search,
    languages: navigator.languages,
  });
  setLocale(locale);

  const storedNotation = store.read(NOTATION_KEY);
  const notation: Notation =
    storedNotation === 'suffix' ||
    storedNotation === 'scientific' ||
    storedNotation === 'korean'
      ? storedNotation
      : defaultNotation(locale);

  const callbacks = {
    onDescend: () => {
      if (!canDescend(state)) return;
      const confirmed = globalThis.confirm(t('descend.confirm'));
      if (!confirmed) return;
      descend(state);
      save(store, state);
      // A descent is the natural break in the session: the run just ended, and
      // nothing is interrupted. It is the only place an interstitial belongs.
      void provider.showInterstitial();
    },
    onWatchForBlessing: () => {
      void provider.showRewarded('blessing').then((outcome) => {
        if (outcome.granted) grantBlessing(state);
      });
    },
    onWatchForChest: () => {
      void provider.showRewarded('chest').then((outcome) => {
        if (outcome.granted) grantChest(state);
      });
    },
    onDismissOffline: () => {
      pendingOffline = null;
      view.hideOffline();
    },
    onDoubleOffline: () => {
      const result = pendingOffline;
      if (result === null) return;
      void provider.showRewarded('offline-double').then((outcome) => {
        if (!outcome.granted) return;
        doubleOfflineEarnings(state, result);
        view.markOfflineDoubled();
      });
    },
    onWipe: () => {
      if (!globalThis.confirm(t('settings.wipeConfirm'))) return;
      wipe(store);
      globalThis.location.reload();
    },
    onLanguageChange: (next: Locale) => {
      setLocale(next);
      store.write(LOCALE_STORAGE_KEY, next);
      // Every label in the tree was written in the old language, so the view is
      // rebuilt rather than retranslated in place. That is the right trade: the
      // build-once design pays off across millions of frames, and a language
      // switch happens at most a handful of times in a save's life.
      rebuildView(defaultNotation(next));
    },
  };

  let view = new GameView(root, state, callbacks);

  function rebuildView(withNotation: Notation): void {
    const carried = view.getUiState();
    root.replaceChildren();
    view = new GameView(root, state, callbacks);
    view.setNotation(withNotation);
    view.onNotationChange = (chosen) => store.write(NOTATION_KEY, chosen);
    view.setAdsAvailable(provider.rewardedAvailable());
    view.mount();
    view.restoreUiState(carried);
    view.update();
  }

  view.setNotation(notation);
  view.onNotationChange = (chosen) => store.write(NOTATION_KEY, chosen);
  view.setAdsAvailable(provider.rewardedAvailable());
  view.mount();

  /** Credits wall-clock time the frame loop could not have seen. */
  function reconcile(): void {
    const result = applyOfflineProgress(state);
    if (!result.worthReporting) return;
    pendingOffline = result;
    view.showOffline({
      awaySeconds: result.elapsedSeconds,
      gold: result.report.goldEarned,
      kills: result.report.kills,
      floors: Math.max(0, result.report.endFloor - result.report.startFloor),
      cappedOut: result.cappedOut,
      canDouble: provider.rewardedAvailable(),
    });
  }

  if (loaded.loaded) reconcile();
  else state.lastSeen = Date.now();

  let lastFrameAt = performance.now();
  let lastRenderAt = 0;
  let lastSaveAt = performance.now();

  function frame(now: number): void {
    requestAnimationFrame(frame);

    const delta = (now - lastFrameAt) / 1000;
    lastFrameAt = now;

    if (!paused) {
      // Anything longer than a frame means the tab was asleep. Dropping it here
      // is safe because `reconcile` on the visibility change credits it in full.
      if (delta > 0 && delta <= MAX_FRAME_SECONDS) advance(state, delta);
    }

    if (now - lastRenderAt >= RENDER_INTERVAL_MS) {
      lastRenderAt = now;
      view.update();
    }

    if (now - lastSaveAt >= AUTOSAVE_INTERVAL_MS) {
      lastSaveAt = now;
      save(store, state);
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      // Stamp the save before the tab is frozen; `lastSeen` is what the offline
      // path measures from, and a tab can be discarded without warning.
      save(store, state);
    } else {
      lastFrameAt = performance.now();
      reconcile();
    }
  });

  // `pagehide` fires where `beforeunload` does not, notably on iOS.
  globalThis.addEventListener('pagehide', () => {
    save(store, state);
  });

  provider.loadingFinished();
  provider.gameplayStart();
  requestAnimationFrame(frame);
}

boot();
