/**
 * Advertising, behind one interface.
 *
 * The revenue model for a portal game is the portal's ad share, so this is the
 * commercial layer — but it is also the layer most likely to get the game
 * rejected. Every portal publishes rules about it, and they largely agree:
 * rewarded ads must be opt-in, interstitials must be infrequent and never
 * interrupt play, audio must stop while an ad runs, and the game must remain
 * completable by someone who never watches one. Those rules are enforced here
 * rather than at each call site, because a rule enforced at the call site is a
 * rule that gets forgotten at the next call site.
 *
 * The abstraction exists because the same build ships to several portals with
 * incompatible SDKs — CrazyGames hands you callbacks, Poki hands you promises,
 * itch.io hands you nothing at all. Each is a small adapter; the game only ever
 * sees `AdProvider`. Nothing outside this folder mentions a portal by name.
 */

export type AdPlacement = 'offline-double' | 'blessing' | 'chest';

export type RewardOutcome =
  | { readonly granted: true }
  | { readonly granted: false; readonly reason: 'dismissed' | 'unavailable' | 'error' | 'throttled' };

export interface AdProvider {
  /** For diagnostics and the credits screen. */
  readonly name: string;
  /** False when the UI should not offer rewarded buttons at all. */
  rewardedAvailable(): boolean;
  showRewarded(placement: AdPlacement): Promise<RewardOutcome>;
  /** Non-rewarded break. Resolves whether or not anything was shown. */
  showInterstitial(): Promise<void>;
  /** Portals use these to pause their own overlays and to measure engagement. */
  gameplayStart(): void;
  gameplayStop(): void;
  /** Called once when the game is interactive; some portals gate revenue on it. */
  loadingFinished(): void;
}

/**
 * Interstitials are capped in one place, for everybody.
 *
 * Three minutes is the strictest common denominator across the portals'
 * published guidance. Getting this wrong does not produce a warning — it
 * produces a rejected submission, or a quietly reduced share.
 */
const MIN_INTERSTITIAL_INTERVAL_MS = 3 * 60 * 1000;

/** Rewarded ads are opt-in, so they need only enough spacing to stop double-taps. */
const MIN_REWARDED_INTERVAL_MS = 5 * 1000;

/**
 * Wraps any provider with the pacing rules and with audio muting.
 *
 * Written as a decorator rather than a base class so that a portal adapter
 * cannot accidentally opt out of the rules by forgetting a `super` call.
 */
export class PacedAdProvider implements AdProvider {
  private lastInterstitialAt = Number.NEGATIVE_INFINITY;
  private lastRewardedAt = Number.NEGATIVE_INFINITY;
  private inFlight = false;

  constructor(
    private readonly inner: AdProvider,
    private readonly hooks: {
      readonly onAdStart?: () => void;
      readonly onAdEnd?: () => void;
      readonly now?: () => number;
    } = {},
  ) {}

  get name(): string {
    return this.inner.name;
  }

  private now(): number {
    return this.hooks.now?.() ?? Date.now();
  }

  rewardedAvailable(): boolean {
    return this.inner.rewardedAvailable();
  }

  async showRewarded(placement: AdPlacement): Promise<RewardOutcome> {
    if (!this.inner.rewardedAvailable()) return { granted: false, reason: 'unavailable' };
    // A second request while one is open would, on some SDKs, resolve the first
    // one's callback against the second request and pay out twice.
    if (this.inFlight) return { granted: false, reason: 'throttled' };
    if (this.now() - this.lastRewardedAt < MIN_REWARDED_INTERVAL_MS) {
      return { granted: false, reason: 'throttled' };
    }

    this.inFlight = true;
    this.hooks.onAdStart?.();
    try {
      const outcome = await this.inner.showRewarded(placement);
      this.lastRewardedAt = this.now();
      return outcome;
    } catch {
      // An SDK that rejects must not take the game down with it, and must not
      // pay out either.
      return { granted: false, reason: 'error' };
    } finally {
      this.inFlight = false;
      this.hooks.onAdEnd?.();
    }
  }

  async showInterstitial(): Promise<void> {
    if (this.inFlight) return;
    if (this.now() - this.lastInterstitialAt < MIN_INTERSTITIAL_INTERVAL_MS) return;

    this.inFlight = true;
    this.lastInterstitialAt = this.now();
    this.hooks.onAdStart?.();
    try {
      await this.inner.showInterstitial();
    } catch {
      // Nothing was promised to the player, so there is nothing to make good.
    } finally {
      this.inFlight = false;
      this.hooks.onAdEnd?.();
    }
  }

  gameplayStart(): void {
    this.inner.gameplayStart();
  }

  gameplayStop(): void {
    this.inner.gameplayStop();
  }

  loadingFinished(): void {
    this.inner.loadingFinished();
  }
}

/**
 * The provider for builds with no portal behind them — itch.io, a local file,
 * the dev server.
 *
 * It reports no rewarded inventory, which makes the UI hide the reward buttons
 * rather than offer a button that does nothing. The rewards themselves are pure
 * bonuses, never gates, so a build without ads is a complete game.
 */
export class NoAdsProvider implements AdProvider {
  readonly name = 'none';

  rewardedAvailable(): boolean {
    return false;
  }

  async showRewarded(): Promise<RewardOutcome> {
    return { granted: false, reason: 'unavailable' };
  }

  async showInterstitial(): Promise<void> {
    // Nothing to show.
  }

  gameplayStart(): void {}
  gameplayStop(): void {}
  loadingFinished(): void {}
}

/**
 * Grants every reward immediately, for development and for tests.
 *
 * Never selected automatically in a production build — reaching it requires an
 * explicit `?ads=debug`, so a misdetected portal degrades to no ads rather than
 * to free rewards.
 */
export class DebugAdProvider implements AdProvider {
  readonly name = 'debug';

  rewardedAvailable(): boolean {
    return true;
  }

  async showRewarded(): Promise<RewardOutcome> {
    return { granted: true };
  }

  async showInterstitial(): Promise<void> {}

  gameplayStart(): void {}
  gameplayStop(): void {}
  loadingFinished(): void {}
}
