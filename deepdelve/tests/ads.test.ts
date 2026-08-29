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
    initialise: () => Promise.resolve(),
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
    // Held in an object rather than a `let`: the assignment happens inside a
    // callback, which control-flow analysis cannot see, so a plain variable
    // stays narrowed to null at the call below.
    const gate: { release: () => void } = { release: () => {} };
    const inner: AdProvider = {
      name: 'slow',
      initialise: () => Promise.resolve(),
      rewardedAvailable: () => true,
      showRewarded: () =>
        new Promise<RewardOutcome>((resolve) => {
          gate.release = () => resolve({ granted: true });
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

    gate.release();
    expect(await first).toEqual({ granted: true });
  });

  it('never pays out when the SDK throws', async () => {
    const clock = new FakeClock();
    const inner: AdProvider = {
      name: 'broken',
      initialise: () => Promise.resolve(),
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
      initialise: () => Promise.resolve(),
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
    await provider.initialise();
    expect(await provider.showRewarded('blessing')).toEqual({ granted: true });
    expect(requestAd).toHaveBeenCalledWith('rewarded', expect.anything());
  });

  it('treats a CrazyGames ad error as a refusal, not a reward', async () => {
    const provider = detectAdProvider({
      CrazyGames: {
        SDK: {
          ad: {
            requestAd: (_t: string, cb: { adError?: (e: unknown) => void }) =>
              cb.adError?.('no fill'),
          },
        },
      },
    });
    await provider.initialise();
    expect(await provider.showRewarded('chest')).toEqual({
      granted: false,
      reason: 'dismissed',
    });
  });

  it('honours Poki reporting that the player skipped', async () => {
    const provider = detectAdProvider({ PokiSDK: { rewardedBreak: async () => false } });
    expect(provider.name).toBe('poki');
    await provider.initialise();
    expect(await provider.showRewarded('chest')).toEqual({
      granted: false,
      reason: 'dismissed',
    });
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
    expect(detectAdProvider({ location: { search: '?ads=debug' } }).rewardedAvailable()).toBe(
      true,
    );
    expect(
      detectAdProvider({ location: { search: '?utm=whatever' } }).rewardedAvailable(),
    ).toBe(false);
  });

  it('grants immediately in debug, so reward flows can be exercised offline', async () => {
    expect(await new DebugAdProvider().showRewarded()).toEqual({ granted: true });
  });
});

describe('SDK initialisation', () => {
  it('reports no inventory until the SDK has finished initialising', async () => {
    // Held in an object, not a `let`: the assignment happens inside a callback
    // that control-flow analysis cannot see.
    const opener: { release: () => void } = { release: () => {} };
    const gate = new Promise<void>((resolve) => {
      opener.release = resolve;
    });

    const provider = detectAdProvider({
      CrazyGames: { SDK: { init: () => gate, ad: { requestAd: () => undefined } } },
    });

    // The API is present from the first frame, but calling it before init
    // resolves fails rather than queueing — so offering the button now would
    // teach the player the reward is broken.
    expect(provider.rewardedAvailable()).toBe(false);

    const initialising = provider.initialise();
    opener.release();
    await initialising;

    expect(provider.rewardedAvailable()).toBe(true);
  });

  it('survives an SDK whose init rejects, without offering ads', async () => {
    // What an ad blocker looks like from in here.
    const provider = detectAdProvider({
      PokiSDK: {
        init: () => Promise.reject(new Error('blocked')),
        rewardedBreak: () => Promise.resolve(true),
      },
    });

    await expect(provider.initialise()).resolves.toBeUndefined();
    expect(provider.rewardedAvailable()).toBe(false);
  });

  it('treats an SDK with no init step as ready', async () => {
    const provider = detectAdProvider({
      CrazyGames: { SDK: { ad: { requestAd: () => undefined } } },
    });

    await provider.initialise();
    expect(provider.rewardedAvailable()).toBe(true);
  });

  it('needs no initialisation when there is no portal', async () => {
    const provider = detectAdProvider({});
    await expect(provider.initialise()).resolves.toBeUndefined();
    expect(provider.rewardedAvailable()).toBe(false);
  });
});
