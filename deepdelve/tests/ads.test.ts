import { describe, expect, it, vi } from 'vitest';
import {
  DebugAdProvider,
  NoAdsProvider,
  PacedAdProvider,
  type AdProvider,
  type RewardOutcome,
} from '../src/platform/ads';
import { detectAdProvider } from '../src/platform/portals';

class FakeClock {
  private t = 0;
  now = (): number => this.t;
  advance(ms: number): void {
    this.t += ms;
  }
}

function countingProvider(outcome: RewardOutcome = { granted: true }): AdProvider & {
  rewarded: number;
  interstitials: number;
} {
  return {
    name: 'fake',
    rewarded: 0,
    interstitials: 0,
    rewardedAvailable: () => true,
    async showRewarded() {
      this.rewarded += 1;
      return outcome;
    },
    async showInterstitial() {
      this.interstitials += 1;
    },
    gameplayStart() {},
    gameplayStop() {},
    loadingFinished() {},
  };
}

describe('ad pacing', () => {
  it('caps interstitials to one every three minutes', async () => {
    const clock = new FakeClock();
    const inner = countingProvider();
    const paced = new PacedAdProvider(inner, { now: clock.now });

    await paced.showInterstitial();
    await paced.showInterstitial();
    clock.advance(60_000);
    await paced.showInterstitial();
    expect(inner.interstitials).toBe(1);

    clock.advance(3 * 60_000);
    await paced.showInterstitial();
    expect(inner.interstitials).toBe(2);
  });

  it('refuses a second rewarded ad while one is open', async () => {
    const clock = new FakeClock();
    let release: (() => void) | null = null;
    const inner: AdProvider = {
      name: 'slow',
      rewardedAvailable: () => true,
      showRewarded: () =>
        new Promise<RewardOutcome>((resolve) => {
          release = () => resolve({ granted: true });
        }),
      showInterstitial: async () => {},
      gameplayStart() {},
      gameplayStop() {},
      loadingFinished() {},
    };
    const paced = new PacedAdProvider(inner, { now: clock.now });

    const first = paced.showRewarded('blessing');
    // A double tap must not resolve against the open request and pay twice.
    const second = await paced.showRewarded('blessing');
    expect(second).toEqual({ granted: false, reason: 'throttled' });

    release?.();
    expect(await first).toEqual({ granted: true });
  });

  it('never pays out when the SDK throws', async () => {
    const clock = new FakeClock();
    const inner: AdProvider = {
      name: 'broken',
      rewardedAvailable: () => true,
      showRewarded: () => Promise.reject(new Error('sdk exploded')),
      showInterstitial: () => Promise.reject(new Error('sdk exploded')),
      gameplayStart() {},
      gameplayStop() {},
      loadingFinished() {},
    };
    const paced = new PacedAdProvider(inner, { now: clock.now });

    expect(await paced.showRewarded('chest')).toEqual({ granted: false, reason: 'error' });
    await expect(paced.showInterstitial()).resolves.toBeUndefined();
  });

  it('brackets every ad with the pause hooks, even on failure', async () => {
    const onAdStart = vi.fn();
    const onAdEnd = vi.fn();
    const inner: AdProvider = {
      name: 'broken',
      rewardedAvailable: () => true,
      showRewarded: () => Promise.reject(new Error('nope')),
      showInterstitial: async () => {},
      gameplayStart() {},
      gameplayStop() {},
      loadingFinished() {},
    };

    await new PacedAdProvider(inner, { onAdStart, onAdEnd }).showRewarded('blessing');
    expect(onAdStart).toHaveBeenCalledTimes(1);
    expect(onAdEnd).toHaveBeenCalledTimes(1);
  });

  it('reports no inventory rather than granting when there is no provider', async () => {
    const paced = new PacedAdProvider(new NoAdsProvider());
    expect(paced.rewardedAvailable()).toBe(false);
    expect(await paced.showRewarded('offline-double')).toEqual({
      granted: false,
      reason: 'unavailable',
    });
  });
});

describe('portal detection', () => {
  it('falls back to no ads when nothing is hosting the game', () => {
    expect(detectAdProvider({}).rewardedAvailable()).toBe(false);
  });

  it('uses the CrazyGames SDK when it is present', async () => {
    const requestAd = vi.fn((_type: string, callbacks: { adFinished?: () => void }) => {
      callbacks.adFinished?.();
    });
    const provider = detectAdProvider({
      CrazyGames: { SDK: { ad: { requestAd }, game: {} } },
    });

    expect(provider.name).toBe('crazygames');
    expect(await provider.showRewarded('blessing')).toEqual({ granted: true });
    expect(requestAd).toHaveBeenCalledWith('rewarded', expect.anything());
  });

  it('treats a CrazyGames ad error as a refusal, not a reward', async () => {
    const provider = detectAdProvider({
      CrazyGames: {
        SDK: {
          ad: {
            requestAd: (_t: string, cb: { adError?: (e: unknown) => void }) => cb.adError?.('no fill'),
          },
        },
      },
    });
    expect(await provider.showRewarded('chest')).toEqual({ granted: false, reason: 'dismissed' });
  });

  it('honours Poki reporting that the player skipped', async () => {
    const provider = detectAdProvider({ PokiSDK: { rewardedBreak: async () => false } });
    expect(provider.name).toBe('poki');
    expect(await provider.showRewarded('chest')).toEqual({ granted: false, reason: 'dismissed' });
  });

  it('survives an SDK that is present but half-built', async () => {
    const provider = detectAdProvider({ CrazyGames: { SDK: {} } });
    expect(provider.rewardedAvailable()).toBe(false);
    expect(await provider.showRewarded('blessing')).toEqual({
      granted: false,
      reason: 'unavailable',
    });
    // These are fire-and-forget on every portal; none of them may throw.
    expect(() => provider.gameplayStart()).not.toThrow();
    expect(() => provider.gameplayStop()).not.toThrow();
    expect(() => provider.loadingFinished()).not.toThrow();
  });

  it('reaches the debug provider only through an explicit opt-in', () => {
    expect(detectAdProvider({ location: { search: '?ads=debug' } }).rewardedAvailable()).toBe(true);
    expect(detectAdProvider({ location: { search: '?utm=whatever' } }).rewardedAvailable()).toBe(
      false,
    );
  });

  it('grants immediately in debug, so reward flows can be exercised offline', async () => {
    expect(await new DebugAdProvider().showRewarded()).toEqual({ granted: true });
  });
});
