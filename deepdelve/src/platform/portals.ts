/**
 * Portal SDK adapters and detection.
 *
 * Each portal's SDK arrives as a global injected by a script tag the portal
 * adds around the build, so none of it can be imported and none of it can be
 * type-checked against a package. Everything here is therefore structurally
 * typed and feature-detected method by method: SDKs change shape between
 * versions, and a game that throws because `requestAd` was renamed is a game
 * that shows a black screen to every player on that portal.
 *
 * The rule throughout is that a missing or misbehaving SDK degrades to "no ads
 * available", never to "reward granted" and never to an exception.
 */

import {
  DebugAdProvider,
  NoAdsProvider,
  PacedAdProvider,
  type AdPlacement,
  type AdProvider,
  type RewardOutcome,
} from './ads';

// -- CrazyGames ------------------------------------------------------------

interface CrazyGamesAdCallbacks {
  adFinished?: () => void;
  adError?: (error: unknown) => void;
  adStarted?: () => void;
}

interface CrazyGamesSdk {
  init?: () => Promise<void>;
  ad?: { requestAd?: (type: 'rewarded' | 'midgame', callbacks: CrazyGamesAdCallbacks) => void };
  game?: {
    gameplayStart?: () => void;
    gameplayStop?: () => void;
    loadingStop?: () => void;
  };
}

class CrazyGamesProvider implements AdProvider {
  readonly name = 'crazygames';
  private ready = false;

  constructor(private readonly sdk: CrazyGamesSdk) {}

  async initialise(): Promise<void> {
    const init = this.sdk.init;
    if (typeof init !== 'function') {
      // An older SDK with no init step, or a shape we do not recognise. The
      // feature detection in `rewardedAvailable` still decides the outcome.
      this.ready = true;
      return;
    }

    try {
      await init.call(this.sdk);
      this.ready = true;
    } catch {
      // Ad-blocked, offline, or the portal declined. No inventory, no crash.
      this.ready = false;
    }
  }

  rewardedAvailable(): boolean {
    return this.ready && typeof this.sdk.ad?.requestAd === 'function';
  }

  showRewarded(_placement: AdPlacement): Promise<RewardOutcome> {
    return this.request('rewarded').then(
      (): RewardOutcome => ({ granted: true }),
      (): RewardOutcome => ({ granted: false, reason: 'dismissed' }),
    );
  }

  showInterstitial(): Promise<void> {
    return this.request('midgame').catch(() => undefined);
  }

  /** Turns the callback API into a promise, with exactly one settle path. */
  private request(type: 'rewarded' | 'midgame'): Promise<void> {
    const requestAd = this.sdk.ad?.requestAd;
    if (typeof requestAd !== 'function') return Promise.reject(new Error('no ad api'));

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (ok: boolean): void => {
        if (settled) return;
        settled = true;
        if (ok) resolve();
        else reject(new Error('ad not completed'));
      };

      try {
        requestAd.call(this.sdk.ad, type, {
          adFinished: () => settle(true),
          adError: () => settle(false),
        });
      } catch {
        settle(false);
      }
    });
  }

  gameplayStart(): void {
    this.sdk.game?.gameplayStart?.();
  }

  gameplayStop(): void {
    this.sdk.game?.gameplayStop?.();
  }

  loadingFinished(): void {
    this.sdk.game?.loadingStop?.();
  }
}

// -- Poki ------------------------------------------------------------------

interface PokiSdk {
  init?: () => Promise<unknown>;
  rewardedBreak?: () => Promise<boolean>;
  commercialBreak?: () => Promise<void>;
  gameplayStart?: () => void;
  gameplayStop?: () => void;
  gameLoadingFinished?: () => void;
}

class PokiProvider implements AdProvider {
  readonly name = 'poki';
  private ready = false;

  constructor(private readonly sdk: PokiSdk) {}

  async initialise(): Promise<void> {
    const init = this.sdk.init;
    if (typeof init !== 'function') {
      this.ready = true;
      return;
    }

    try {
      // Poki resolves this even when the player is running an ad blocker; the
      // documented behaviour is to carry on either way, so a rejection is
      // treated as "no inventory" rather than as a reason to stop.
      await init.call(this.sdk);
      this.ready = true;
    } catch {
      this.ready = false;
    }
  }

  rewardedAvailable(): boolean {
    return this.ready && typeof this.sdk.rewardedBreak === 'function';
  }

  async showRewarded(_placement: AdPlacement): Promise<RewardOutcome> {
    const rewardedBreak = this.sdk.rewardedBreak;
    if (typeof rewardedBreak !== 'function') return { granted: false, reason: 'unavailable' };
    try {
      // Poki resolves with whether the player actually watched it through.
      const watched = await rewardedBreak.call(this.sdk);
      return watched === true ? { granted: true } : { granted: false, reason: 'dismissed' };
    } catch {
      return { granted: false, reason: 'error' };
    }
  }

  async showInterstitial(): Promise<void> {
    try {
      await this.sdk.commercialBreak?.call(this.sdk);
    } catch {
      // A failed commercial break is not the player's problem.
    }
  }

  gameplayStart(): void {
    this.sdk.gameplayStart?.();
  }

  gameplayStop(): void {
    this.sdk.gameplayStop?.();
  }

  loadingFinished(): void {
    this.sdk.gameLoadingFinished?.();
  }
}

// -- detection -------------------------------------------------------------

/**
 * The globals as they actually arrive, which is not as they are documented.
 *
 * Every field is optional *and* nullable: a portal wrapper that failed to
 * initialise leaves `PokiSDK = null` rather than leaving it undefined, and a
 * type that admits only `undefined` turns the runtime null check into code the
 * compiler believes is unreachable. Being honest here is what makes the guards
 * below mean something.
 */
interface PortalGlobals {
  CrazyGames?: { SDK?: CrazyGamesSdk | null } | null;
  PokiSDK?: PokiSdk | null;
  location?: { search?: string } | null;
}

export interface AdProviderHooks {
  /** Called when an ad takes over the screen — stop audio and the loop here. */
  readonly onAdStart?: () => void;
  readonly onAdEnd?: () => void;
}

/**
 * Picks a provider for wherever this build happens to be running.
 *
 * The debug provider is reachable only through an explicit `?ads=debug`, so a
 * portal whose SDK failed to load falls back to no ads rather than to free
 * rewards. Order matters only in that a page cannot host two portals at once.
 */
export function detectAdProvider(
  scope: unknown = globalThis,
  hooks: AdProviderHooks = {},
): AdProvider {
  const globals = (scope ?? {}) as PortalGlobals;

  const search = globals.location?.search ?? '';
  if (search.includes('ads=debug')) {
    return new PacedAdProvider(new DebugAdProvider(), hooks);
  }

  const crazy = globals.CrazyGames?.SDK;
  if (crazy !== undefined && crazy !== null) {
    return new PacedAdProvider(new CrazyGamesProvider(crazy), hooks);
  }

  const poki = globals.PokiSDK;
  if (poki !== undefined && poki !== null) {
    return new PacedAdProvider(new PokiProvider(poki), hooks);
  }

  return new PacedAdProvider(new NoAdsProvider(), hooks);
}
