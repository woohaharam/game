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
import { formatNumber, type Notation } from '@core/format';
import { createStore } from '@core/storage';
import { SAVE_KEY } from '@game/save';

/**
 * Best-effort clipboard write.
 *
 * `navigator.clipboard` is declared unconditionally by `lib.dom` but is absent
 * over plain HTTP and frequently blocked inside a cross-origin iframe, which is
 * exactly where a portal build lives. Failure is not worth reporting: the code
 * is on screen either way.
 */
async function copyToClipboard(text: string): Promise<void> {
  const { clipboard } = navigator as unknown as { clipboard?: Clipboard };
  try {
    await clipboard?.writeText(text);
  } catch {
    // Blocked or unavailable; the prompt is the real delivery mechanism.
  }
}
import { applyOfflineProgress, doubleOfflineEarnings, type OfflineResult } from '@game/offline';
import { canAutoDelve, canDescend, descend } from '@game/prestige';
import { grantBlessing, grantChest } from '@game/rewards';
import { decode, encode, load, save, wipe } from '@game/save';
import { fromTransferCode, toTransferCode } from '@game/transfer';
import { advance } from '@game/simulation';
import { spendGreedily } from '@game/shop';
import { GameAudio } from '@platform/audio';
import { detectAdProvider } from '@platform/portals';
import { GameView } from '@ui/view';
import type { FrameFeedback } from '@ui/panels/combat';
import { Decimal } from '@core/decimal';

function emptyFeedback(floor: number): FrameFeedback {
  return {
    damage: Decimal.ZERO,
    gold: Decimal.ZERO,
    kills: 0,
    guardiansFelled: 0,
    floorsCleared: 0,
    floor,
  };
}

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

/**
 * How often Auto-Delve visits the shop, in simulated seconds.
 *
 * Deliberately the same figure the offline catch-up uses, so a player who
 * leaves the tab open and one who closes it end up in the same place. Checking
 * every frame would make the automaton superhuman relative to the balance
 * measurements, which assume this interval.
 */
const AUTO_DELVE_INTERVAL_SECONDS = 10;

function boot(): void {
  const found = document.querySelector<HTMLElement>('#app');
  if (found === null) throw new Error('#app missing');
  // Rebound after the guard: `rebuildView` is a hoisted declaration, and the
  // narrowing on the original binding does not reach into it.
  const root: HTMLElement = found;

  const store = createStore();
  const loaded = load(store);
  const state = loaded.state;

  // Sound defaults on, which is what a portal player expects; the choice is
  // remembered separately from the save, like the other preferences.
  const audio = new GameAudio(store.read('deepdelve.sound') !== 'off');

  let paused = false;
  const provider = detectAdProvider(globalThis, {
    onAdStart: () => {
      paused = true;
      // Portals check this: an advertisement must not play over game audio.
      audio.suspend();
      provider.gameplayStop();
    },
    onAdEnd: () => {
      paused = false;
      audio.resume();
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
  const SOUND_KEY = 'deepdelve.sound';
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
    sound: (name: Parameters<typeof audio.play>[0]) => audio.play(name),
    onToggleSound: () => {
      audio.setEnabled(!audio.isEnabled());
      store.write(SOUND_KEY, audio.isEnabled() ? 'on' : 'off');
      if (audio.isEnabled()) audio.unlock();
    },
    isSoundOn: () => audio.isEnabled(),
    onToggleAutoDelve: () => {
      if (!canAutoDelve(state)) return;
      state.autoDelve = !state.autoDelve;
      save(store, state);
    },
    onExportSave: () => {
      save(store, state);
      const code = toTransferCode(encode(state));
      // `prompt` rather than the clipboard API on purpose: the game runs inside
      // a portal's iframe, where clipboard writes are frequently blocked with no
      // way to detect it beforehand. A prompt pre-filled with the code always
      // works, and the player can select it themselves. The clipboard is still
      // tried, as a convenience when it happens to be permitted.
      void copyToClipboard(code);
      globalThis.prompt(t('settings.exportPrompt'), code);
    },
    onImportSave: () => {
      const pasted = globalThis.prompt(t('settings.importPrompt'), '');
      if (pasted === null) return;

      const result = fromTransferCode(pasted);
      if (!result.ok) {
        globalThis.alert(t('settings.importBad'));
        return;
      }

      // Decoded before the confirmation, so a code that turns out to be
      // unreadable never gets as far as asking the player to sacrifice a run.
      const incoming = decode(result.payload);
      if (!incoming.loaded) {
        globalThis.alert(t('settings.importBad'));
        return;
      }
      if (!globalThis.confirm(t('settings.importConfirm'))) return;

      store.write(SAVE_KEY, result.payload);
      globalThis.alert(t('settings.importOk'));
      globalThis.location.reload();
    },
    onDescend: () => {
      if (!canDescend(state)) return;
      const confirmed = globalThis.confirm(t('descend.confirm'));
      if (!confirmed) return;

      const result = descend(state);
      audio.play('descend');
      view.announce(t('effect.descended', { relics: formatNumber(result.relicsGained) }));
      save(store, state);
      // A descent is the natural break in the session: the run just ended, and
      // nothing is interrupted. It is the only place an interstitial belongs.
      void provider.showInterstitial();
    },
    onWatchForBlessing: () => {
      void provider.showRewarded('blessing').then((outcome) => {
        if (!outcome.granted) return;
        grantBlessing(state);
        audio.play('reward');
      });
    },
    onWatchForChest: () => {
      void provider.showRewarded('chest').then((outcome) => {
        if (!outcome.granted) return;
        grantChest(state);
        audio.play('reward');
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
        audio.play('reward');
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

  // The SDK is not usable the instant its script tag lands, so the game starts
  // without waiting and the reward buttons appear when inventory does. Blocking
  // the first frame on a network round trip to a portal's backend — which may
  // never answer, if the player is running an ad blocker — would trade a
  // certain delay for an uncertain reward.
  void provider.initialise().then(() => {
    view.setAdsAvailable(provider.rewardedAvailable());
  });

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

  /**
   * What the simulation has done since the last rendered frame.
   *
   * The loop runs at the display's rate and the interface repaints at twenty a
   * second, so several frames of simulation collapse into one repaint.
   * Accumulating rather than sampling means a kill that happened between
   * repaints still produces a number, instead of being silently dropped.
   */
  let pending: FrameFeedback = emptyFeedback(state.floor);
  let sinceAutoDelve = 0;

  function frame(now: number): void {
    requestAnimationFrame(frame);

    const delta = (now - lastFrameAt) / 1000;
    lastFrameAt = now;

    if (!paused) {
      // Anything longer than a frame means the tab was asleep. Dropping it here
      // is safe because `reconcile` on the visibility change credits it in full.
      if (delta > 0 && delta <= MAX_FRAME_SECONDS) {
        const report = advance(state, delta);

        if (state.autoDelve && canAutoDelve(state)) {
          sinceAutoDelve += delta;
          if (sinceAutoDelve >= AUTO_DELVE_INTERVAL_SECONDS) {
            sinceAutoDelve = 0;
            if (spendGreedily(state) > 0) audio.play('purchase');
          }
        }

        pending = {
          damage: pending.damage.add(report.damageDealt),
          gold: pending.gold.add(report.goldEarned),
          kills: pending.kills + report.kills,
          guardiansFelled: pending.guardiansFelled + report.guardiansFelled,
          floorsCleared: pending.floorsCleared + (report.endFloor - report.startFloor),
          floor: state.floor,
        };
      }
    }

    if (now - lastRenderAt >= RENDER_INTERVAL_MS) {
      lastRenderAt = now;
      view.applyFeedback(pending);
      pending = emptyFeedback(state.floor);
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

  // Browsers refuse to start an AudioContext without a gesture, so the first
  // touch or click anywhere is what makes sound possible. Once is enough.
  const unlockAudio = (): void => {
    audio.unlock();
    root.removeEventListener('pointerdown', unlockAudio);
  };
  root.addEventListener('pointerdown', unlockAudio);

  provider.loadingFinished();
  provider.gameplayStart();
  requestAnimationFrame(frame);
}

/**
 * Renders a way out when the game cannot start.
 *
 * Without this a boot exception leaves an empty page: no message, no recourse,
 * and — since the most likely cause is a save the loader could not cope with —
 * no way for the player to clear the thing that is blocking them. It is a
 * dozen lines of plain DOM on purpose, because it has to work in exactly the
 * situation where the rest of the code did not.
 */
function renderBootFailure(error: unknown): void {
  console.error('DeepDelve failed to start', error);

  const root = document.querySelector('#app');
  if (root === null) return;

  const heading = document.createElement('h1');
  heading.textContent = t('boot.failed');

  const hint = document.createElement('p');
  hint.textContent = t('boot.failedHint');

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'danger';
  button.textContent = t('boot.erase');
  button.addEventListener('click', () => {
    try {
      wipe(createStore());
    } catch {
      // Storage may be the reason we are here; reloading is still worth a try.
    }
    globalThis.location.reload();
  });

  const panel = document.createElement('div');
  panel.className = 'boot-failure';
  panel.append(heading, hint, button);
  root.replaceChildren(panel);
}

try {
  boot();
} catch (error) {
  renderBootFailure(error);
}
