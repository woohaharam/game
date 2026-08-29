import { describe, expect, it } from 'vitest';
import { Decimal } from '../src/core/decimal';
import { createMemoryStore } from '../src/core/storage';
import { decode, encode, load, save, SAVE_KEY } from '../src/game/save';
import { createInitialState } from '../src/game/state';
import { advance } from '../src/game/simulation';
import { applyOfflineProgress, OFFLINE_CAP_SECONDS } from '../src/game/offline';
import {
  canAutoRefine,
  canCompress,
  compress,
  pendingCrystals,
  COMPRESSION_UNLOCK_STAGE,
} from '../src/game/prestige';
import { autoplay } from '../src/game/autoplay';
import { bulkCost } from '../src/game/content/cost-curve';
import { UPGRADES } from '../src/game/content/upgrades';
import { COMPANIONS } from '../src/game/content/companions';
import { buyOrbiter, buyRefinement, quoteRefinement } from '../src/game/shop';

describe('save round-trip', () => {
  it('restores a played run exactly', () => {
    const original = createInitialState(1000);
    original.upgrades.blade = 42;
    original.upgrades.greed = 7;
    original.companions.torchbearer = 3;
    advance(original, 5000);

    const restored = decode(encode(original, 2000), 2000);

    expect(restored.loaded).toBe(true);
    expect(restored.repaired).toBe(false);
    expect(restored.state.stage).toBe(original.stage);
    expect(restored.state.highestStage).toBe(original.highestStage);
    expect(restored.state.fragmentsOnStage).toBe(original.fragmentsOnStage);
    expect(restored.state.dust.serialise()).toBe(original.dust.serialise());
    expect(restored.state.upgrades.blade).toBe(42);
    expect(restored.state.companions.torchbearer).toBe(3);
    expect(restored.state.stats.totalFragments).toBe(original.stats.totalFragments);
  });

  it('survives magnitudes far past a double', () => {
    const state = createInitialState(0);
    state.dust = Decimal.of(4.25, 900);
    state.crystals = Decimal.of(9.1, 1500);

    const restored = decode(encode(state, 0), 0).state;
    expect(restored.dust.exponent).toBe(900);
    expect(restored.crystals.mantissa).toBeCloseTo(9.1, 10);
  });

  it('starts a fresh run rather than throwing on a corrupt payload', () => {
    for (const junk of ['', '{', 'null', '[]', '{"v":1', 'not json at all']) {
      const result = decode(junk, 0);
      expect(result.state.stage).toBe(1);
      expect(result.loaded).toBe(false);
    }
  });

  it('repairs a hand-edited save instead of trusting or rejecting it', () => {
    const tampered = JSON.stringify({
      v: 1,
      floor: -50,
      highestFloor: 0,
      gold: 'garbage',
      // Crit chance is capped at 140 levels; a save claiming 9999 is an edit.
      upgrades: { blade: 3.7, precision: 9999, nonexistent: 5 },
      companions: { torchbearer: -4 },
      stats: { totalKills: 'lots' },
      lastSeen: Number.MAX_SAFE_INTEGER,
    });

    const result = decode(tampered, 1_000_000);

    expect(result.loaded).toBe(true);
    expect(result.repaired).toBe(true);
    expect(result.state.stage).toBe(1);
    expect(result.state.dust.isZero).toBe(true);
    expect(result.state.upgrades.blade).toBe(3);
    expect(result.state.upgrades.precision).toBe(140);
    expect(result.state.companions.torchbearer).toBe(0);
    expect(result.state.stats.totalFragments).toBe(0);
    // A save from the future must not bank offline time.
    expect(result.state.lastSeen).toBeLessThanOrEqual(1_000_000);
  });

  it('never hands out a free kill by restoring an enemy at zero health', () => {
    const state = createInitialState(0);
    state.fragmentRemaining = Decimal.ZERO;
    const restored = decode(encode(state, 0), 0).state;
    expect(restored.fragmentRemaining.isZero).toBe(false);
  });

  it('writes through a store and reads back', () => {
    const store = createMemoryStore();
    const state = createInitialState(0);
    state.upgrades.blade = 11;

    expect(save(store, state, 500)).toBe(true);
    expect(store.read(SAVE_KEY)).not.toBeNull();
    expect(load(store, 500).state.upgrades.blade).toBe(11);
  });
});

describe('offline progress', () => {
  it('credits away-time as the live loop would have paid it', () => {
    const offline = createInitialState(0);
    offline.upgrades.blade = 30;
    offline.upgrades.swiftness = 10;

    const live = createInitialState(0);
    live.upgrades.blade = 30;
    live.upgrades.swiftness = 10;

    const twoHours = 2 * 60 * 60;
    applyOfflineProgress(offline, twoHours * 1000);
    advance(live, twoHours);

    expect(offline.stage).toBe(live.stage);
    expect(offline.dust.serialise()).toBe(live.dust.serialise());
  });

  it('caps a long absence', () => {
    const state = createInitialState(0);
    state.upgrades.blade = 30;

    const away = 40 * 60 * 60 * 1000;
    const result = applyOfflineProgress(state, away);

    expect(result.cappedOut).toBe(true);
    expect(result.creditedSeconds).toBeCloseTo(OFFLINE_CAP_SECONDS, 3);
  });

  it('credits nothing when the clock moves backwards', () => {
    const state = createInitialState(10_000_000);
    const result = applyOfflineProgress(state, 5_000_000);
    expect(result.creditedSeconds).toBe(0);
    expect(state.dust.isZero).toBe(true);
  });

  it('does not burn a blessing the player is not there to use', () => {
    const state = createInitialState(0);
    state.upgrades.blade = 30;
    state.blessingRemaining = 120;

    applyOfflineProgress(state, 4 * 60 * 60 * 1000);
    expect(state.blessingRemaining).toBe(120);
  });

  it('says nothing about an absence too short to matter', () => {
    const state = createInitialState(0);
    state.upgrades.blade = 30;
    expect(applyOfflineProgress(state, 5_000).worthReporting).toBe(false);
  });
});

describe('descending', () => {
  it('stays locked until the run is deep enough to pay for itself', () => {
    const state = createInitialState(0);
    state.highestStage = COMPRESSION_UNLOCK_STAGE - 1;
    expect(canCompress(state)).toBe(false);
    expect(pendingCrystals(state.highestStage).isZero).toBe(true);
  });

  it('pays more for a deeper run, always in whole relics', () => {
    let previous = pendingCrystals(COMPRESSION_UNLOCK_STAGE);
    for (let floor = COMPRESSION_UNLOCK_STAGE + 1; floor < 200; floor += 1) {
      const relics = pendingCrystals(floor);
      expect(relics.greaterThan(previous)).toBe(true);
      expect(relics.serialise()).toBe(relics.floorToInteger().serialise());
      previous = relics;
    }
  });

  /**
   * The one relationship the whole progression rests on.
   *
   * Reachable depth is about log(multiplier)/log(healthGrowth), and the
   * multiplier is proportional to relicGrowth^depth, so successive descents
   * compose as `next ≈ depth · log(relicGrowth)/log(healthGrowth)`. When that
   * ratio drops to 1 or below the map becomes a contraction with a fixed point,
   * runs converge on a single depth, and the game ends without saying so. This
   * asserts the ratio, not the payout, because the payout can be retuned freely
   * and the ratio cannot.
   */
  it('has no fixed point, so no descent is ever the last one worth making', () => {
    const healthGrowthPerFloor = 1.55;

    const at = pendingCrystals(100).log10();
    const deeper = pendingCrystals(110).log10();
    const relicGrowthPerFloor = 10 ** ((deeper - at) / 10);

    const ratio = Math.log(relicGrowthPerFloor) / Math.log(healthGrowthPerFloor);
    expect(ratio).toBeGreaterThan(1);
  });

  it('gains more floors on each successive descent', () => {
    const state = createInitialState(0);
    const depths: number[] = [];

    for (let run = 0; run < 4; run += 1) {
      autoplay(state, 60 * 60 * 6);
      depths.push(state.highestStage);
      if (!canCompress(state)) break;
      compress(state, 0);
    }

    expect(depths.length).toBe(4);
    for (let i = 1; i < depths.length; i += 1) {
      const previous = depths[i - 1] ?? 0;
      const current = depths[i] ?? 0;
      expect(current).toBeGreaterThan(previous);
    }
  });

  it('surrenders the run but keeps relics and the blessing', () => {
    const state = createInitialState(0);
    state.upgrades.blade = 80;
    advance(state, 60 * 60 * 6);
    state.highestStage = Math.max(state.highestStage, 40);
    state.blessingRemaining = 90;
    const lifetimeGoldBefore = state.lifetimeDust;

    const result = compress(state, 1234);

    expect(result.crystalsGained.greaterThan(Decimal.ZERO)).toBe(true);
    expect(state.crystals.serialise()).toBe(result.crystalsGained.serialise());
    expect(state.stage).toBe(1);
    expect(state.dust.isZero).toBe(true);
    expect(state.upgrades.blade).toBe(0);
    expect(state.stats.compressions).toBe(1);
    expect(state.blessingRemaining).toBe(90);
    expect(state.lifetimeDust.serialise()).toBe(lifetimeGoldBefore.serialise());
  });

  it('gets deeper on the second run than the first', () => {
    // A hero who never spends gold never passes the first guardian, so this has
    // to be measured against a player, not against the simulation alone.
    const day = 60 * 60 * 24;

    const run = createInitialState(0);
    autoplay(run, day);
    const firstDepth = run.highestStage;
    expect(firstDepth).toBeGreaterThanOrEqual(COMPRESSION_UNLOCK_STAGE);

    compress(run, 0);
    autoplay(run, day);

    expect(run.highestStage).toBeGreaterThan(firstDepth);
  });

  it('reaches the descent unlock inside a first session', () => {
    const state = createInitialState(0);
    const result = autoplay(state, 60 * 60 * 2);
    // Two hours of a naive shopper should be enough to see the mechanic that
    // the rest of the game is built around; a player who never meets it never
    // learns there is a reason to come back.
    expect(result.highestStage).toBeGreaterThanOrEqual(COMPRESSION_UNLOCK_STAGE);
  });
});

describe('purchasing', () => {
  it('never charges more gold than the player has', () => {
    // The affordable-levels estimate inverts a logarithm and can land a level
    // above the truth at the boundary. Buying at exactly the price of N levels,
    // across every curve in the game, is where that shows up.
    for (const definition of UPGRADES) {
      for (const levels of [1, 2, 7, 40, 300]) {
        const state = createInitialState(0);
        // Deep enough that every upgrade is on sale; the unlock rule is tested
        // separately and would otherwise mask the boundary this is about.
        state.highestStage = 200;
        state.dust = bulkCost(definition, 0, levels);

        const purchase = buyRefinement(state, definition.id, Number.MAX_SAFE_INTEGER);

        expect(state.dust.isNegative, `${definition.id} ×${levels}`).toBe(false);
        expect(purchase.bought, `${definition.id} ×${levels}`).toBeGreaterThan(0);
        expect(purchase.spent.greaterThan(bulkCost(definition, 0, levels))).toBe(false);
      }
    }
  });

  it('buys as many levels as the bank truly covers, not one fewer', () => {
    const definition = UPGRADES[0];
    if (definition === undefined) throw new Error('no upgrades');

    const state = createInitialState(0);
    state.highestStage = 200;
    state.dust = bulkCost(definition, 0, 25);
    expect(buyRefinement(state, definition.id, Number.MAX_SAFE_INTEGER).bought).toBe(25);
  });

  it('quotes exactly what the purchase will do', () => {
    const state = createInitialState(0);
    state.highestStage = 200;
    state.dust = Decimal.of(5, 6);

    for (const definition of UPGRADES) {
      const quote = quoteRefinement(state, definition.id, 10);
      const purchase = buyRefinement(state, definition.id, 10);
      expect(purchase.bought).toBe(quote.bought);
      expect(purchase.spent.serialise()).toBe(quote.spent.serialise());
    }
  });

  it('respects a level cap without spending anything at it', () => {
    const definition = UPGRADES.find((u) => u.maxLevel !== undefined);
    if (definition === undefined) throw new Error('expected a capped upgrade');

    const state = createInitialState(0);
    state.highestStage = 100;
    state.dust = Decimal.of(1, 200);

    buyRefinement(state, definition.id, Number.MAX_SAFE_INTEGER);
    expect(state.upgrades[definition.id]).toBe(definition.maxLevel);

    const goldBefore = state.dust.serialise();
    expect(buyRefinement(state, definition.id, 5).bought).toBe(0);
    expect(state.dust.serialise()).toBe(goldBefore);
  });

  it('will not sell anything the run has not unlocked yet', () => {
    const state = createInitialState(0);
    state.dust = Decimal.of(1, 100);

    // The last companion unlocks at floor 110; a floor-1 hero cannot recruit it.
    const locked = COMPANIONS[COMPANIONS.length - 1];
    if (locked === undefined) throw new Error('no companions');
    expect(buyOrbiter(state, locked.id, 1).bought).toBe(0);
    expect(state.companions[locked.id]).toBe(0);
  });

  it('buys companions in bulk through the same closed form as upgrades', () => {
    const definition = COMPANIONS[0];
    if (definition === undefined) throw new Error('no companions');

    const state = createInitialState(0);
    state.highestStage = 50;
    state.dust = bulkCost(definition, 0, 12);

    expect(buyOrbiter(state, definition.id, Number.MAX_SAFE_INTEGER).bought).toBe(12);
    expect(state.dust.isNegative).toBe(false);
  });
});

describe('Auto-Delve', () => {
  it('stays locked until the first descent', () => {
    const state = createInitialState(0);
    expect(canAutoRefine(state)).toBe(false);

    state.highestStage = 40;
    compress(state, 0);
    expect(canAutoRefine(state)).toBe(true);
  });

  it('is off by default even once unlocked', () => {
    const state = createInitialState(0);
    state.highestStage = 40;
    compress(state, 0);
    expect(state.autoRefine).toBe(false);
  });

  it('survives a save round trip, and defaults off in an older save', () => {
    const state = createInitialState(0);
    state.autoRefine = true;
    expect(decode(encode(state, 0), 0).state.autoRefine).toBe(true);

    // A save written before the field existed must not enable it silently.
    const older = JSON.stringify({ v: 1, floor: 3, highestFloor: 2, gold: '1,2' });
    expect(decode(older, 0).state.autoRefine).toBe(false);
  });

  it('climbs floors while away, where a hero who never spends only banks gold', () => {
    const eightHours = 8 * 60 * 60 * 1000;

    const manual = createInitialState(0);
    manual.upgrades.blade = 12;
    manual.stats.compressions = 1;

    const automatic = createInitialState(0);
    automatic.upgrades.blade = 12;
    automatic.stats.compressions = 1;
    automatic.autoRefine = true;

    applyOfflineProgress(manual, eightHours);
    applyOfflineProgress(automatic, eightHours);

    expect(automatic.highestStage).toBeGreaterThan(manual.highestStage);
  });

  it('reaches the same place offline as it would have watched', () => {
    // The reason the offline path reuses the live interval rather than a
    // cheaper one: leaving the tab open and closing it must not differ.
    const away = createInitialState(0);
    away.autoRefine = true;
    away.stats.compressions = 1;

    const watched = createInitialState(0);
    watched.autoRefine = true;
    watched.stats.compressions = 1;

    applyOfflineProgress(away, 2 * 60 * 60 * 1000);
    autoplay(watched, 2 * 60 * 60);

    expect(away.highestStage).toBe(watched.highestStage);
    expect(away.dust.serialise()).toBe(watched.dust.serialise());
  });
});
