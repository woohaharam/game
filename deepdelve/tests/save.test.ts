import { describe, expect, it } from 'vitest';
import { Decimal } from '../src/core/decimal';
import { createMemoryStore } from '../src/core/storage';
import { decode, encode, load, save, SAVE_KEY } from '../src/game/save';
import { createInitialState } from '../src/game/state';
import { advance } from '../src/game/simulation';
import { applyOfflineProgress, OFFLINE_CAP_SECONDS } from '../src/game/offline';
import { canDescend, descend, pendingRelics, DESCENT_UNLOCK_FLOOR } from '../src/game/prestige';
import { autoplay } from '../src/game/autoplay';
import { bulkCost } from '../src/game/content/cost-curve';
import { UPGRADES } from '../src/game/content/upgrades';
import { COMPANIONS } from '../src/game/content/companions';
import { buyCompanion, buyUpgrade, quoteUpgrade } from '../src/game/shop';

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
    expect(restored.state.floor).toBe(original.floor);
    expect(restored.state.highestFloor).toBe(original.highestFloor);
    expect(restored.state.killsOnFloor).toBe(original.killsOnFloor);
    expect(restored.state.gold.serialise()).toBe(original.gold.serialise());
    expect(restored.state.upgrades.blade).toBe(42);
    expect(restored.state.companions.torchbearer).toBe(3);
    expect(restored.state.stats.totalKills).toBe(original.stats.totalKills);
  });

  it('survives magnitudes far past a double', () => {
    const state = createInitialState(0);
    state.gold = Decimal.of(4.25, 900);
    state.relics = Decimal.of(9.1, 1500);

    const restored = decode(encode(state, 0), 0).state;
    expect(restored.gold.exponent).toBe(900);
    expect(restored.relics.mantissa).toBeCloseTo(9.1, 10);
  });

  it('starts a fresh run rather than throwing on a corrupt payload', () => {
    for (const junk of ['', '{', 'null', '[]', '{"v":1', 'not json at all']) {
      const result = decode(junk, 0);
      expect(result.state.floor).toBe(1);
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
    expect(result.state.floor).toBe(1);
    expect(result.state.gold.isZero).toBe(true);
    expect(result.state.upgrades.blade).toBe(3);
    expect(result.state.upgrades.precision).toBe(140);
    expect(result.state.companions.torchbearer).toBe(0);
    expect(result.state.stats.totalKills).toBe(0);
    // A save from the future must not bank offline time.
    expect(result.state.lastSeen).toBeLessThanOrEqual(1_000_000);
  });

  it('never hands out a free kill by restoring an enemy at zero health', () => {
    const state = createInitialState(0);
    state.enemyHealthRemaining = Decimal.ZERO;
    const restored = decode(encode(state, 0), 0).state;
    expect(restored.enemyHealthRemaining.isZero).toBe(false);
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

    expect(offline.floor).toBe(live.floor);
    expect(offline.gold.serialise()).toBe(live.gold.serialise());
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
    expect(state.gold.isZero).toBe(true);
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
    state.highestFloor = DESCENT_UNLOCK_FLOOR - 1;
    expect(canDescend(state)).toBe(false);
    expect(pendingRelics(state.highestFloor).isZero).toBe(true);
  });

  it('pays more for a deeper run, always in whole relics', () => {
    let previous = pendingRelics(DESCENT_UNLOCK_FLOOR);
    for (let floor = DESCENT_UNLOCK_FLOOR + 1; floor < 200; floor += 1) {
      const relics = pendingRelics(floor);
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

    const at = pendingRelics(100).log10();
    const deeper = pendingRelics(110).log10();
    const relicGrowthPerFloor = 10 ** ((deeper - at) / 10);

    const ratio = Math.log(relicGrowthPerFloor) / Math.log(healthGrowthPerFloor);
    expect(ratio).toBeGreaterThan(1);
  });

  it('gains more floors on each successive descent', () => {
    const state = createInitialState(0);
    const depths: number[] = [];

    for (let run = 0; run < 4; run += 1) {
      autoplay(state, 60 * 60 * 6);
      depths.push(state.highestFloor);
      if (!canDescend(state)) break;
      descend(state, 0);
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
    state.highestFloor = Math.max(state.highestFloor, 40);
    state.blessingRemaining = 90;
    const lifetimeGoldBefore = state.lifetimeGold;

    const result = descend(state, 1234);

    expect(result.relicsGained.greaterThan(Decimal.ZERO)).toBe(true);
    expect(state.relics.serialise()).toBe(result.relicsGained.serialise());
    expect(state.floor).toBe(1);
    expect(state.gold.isZero).toBe(true);
    expect(state.upgrades.blade).toBe(0);
    expect(state.stats.descents).toBe(1);
    expect(state.blessingRemaining).toBe(90);
    expect(state.lifetimeGold.serialise()).toBe(lifetimeGoldBefore.serialise());
  });

  it('gets deeper on the second run than the first', () => {
    // A hero who never spends gold never passes the first guardian, so this has
    // to be measured against a player, not against the simulation alone.
    const day = 60 * 60 * 24;

    const run = createInitialState(0);
    autoplay(run, day);
    const firstDepth = run.highestFloor;
    expect(firstDepth).toBeGreaterThanOrEqual(DESCENT_UNLOCK_FLOOR);

    descend(run, 0);
    autoplay(run, day);

    expect(run.highestFloor).toBeGreaterThan(firstDepth);
  });

  it('reaches the descent unlock inside a first session', () => {
    const state = createInitialState(0);
    const result = autoplay(state, 60 * 60 * 2);
    // Two hours of a naive shopper should be enough to see the mechanic that
    // the rest of the game is built around; a player who never meets it never
    // learns there is a reason to come back.
    expect(result.highestFloor).toBeGreaterThanOrEqual(DESCENT_UNLOCK_FLOOR);
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
        state.highestFloor = 200;
        state.gold = bulkCost(definition, 0, levels);

        const purchase = buyUpgrade(state, definition.id, Number.MAX_SAFE_INTEGER);

        expect(state.gold.isNegative, `${definition.id} ×${levels}`).toBe(false);
        expect(purchase.bought, `${definition.id} ×${levels}`).toBeGreaterThan(0);
        expect(purchase.spent.greaterThan(bulkCost(definition, 0, levels))).toBe(false);
      }
    }
  });

  it('buys as many levels as the bank truly covers, not one fewer', () => {
    const definition = UPGRADES[0];
    if (definition === undefined) throw new Error('no upgrades');

    const state = createInitialState(0);
    state.highestFloor = 200;
    state.gold = bulkCost(definition, 0, 25);
    expect(buyUpgrade(state, definition.id, Number.MAX_SAFE_INTEGER).bought).toBe(25);
  });

  it('quotes exactly what the purchase will do', () => {
    const state = createInitialState(0);
    state.highestFloor = 200;
    state.gold = Decimal.of(5, 6);

    for (const definition of UPGRADES) {
      const quote = quoteUpgrade(state, definition.id, 10);
      const purchase = buyUpgrade(state, definition.id, 10);
      expect(purchase.bought).toBe(quote.bought);
      expect(purchase.spent.serialise()).toBe(quote.spent.serialise());
    }
  });

  it('respects a level cap without spending anything at it', () => {
    const definition = UPGRADES.find((u) => u.maxLevel !== undefined);
    if (definition === undefined) throw new Error('expected a capped upgrade');

    const state = createInitialState(0);
    state.highestFloor = 100;
    state.gold = Decimal.of(1, 200);

    buyUpgrade(state, definition.id, Number.MAX_SAFE_INTEGER);
    expect(state.upgrades[definition.id]).toBe(definition.maxLevel);

    const goldBefore = state.gold.serialise();
    expect(buyUpgrade(state, definition.id, 5).bought).toBe(0);
    expect(state.gold.serialise()).toBe(goldBefore);
  });

  it('will not sell anything the run has not unlocked yet', () => {
    const state = createInitialState(0);
    state.gold = Decimal.of(1, 100);

    // The last companion unlocks at floor 110; a floor-1 hero cannot recruit it.
    const locked = COMPANIONS[COMPANIONS.length - 1];
    if (locked === undefined) throw new Error('no companions');
    expect(buyCompanion(state, locked.id, 1).bought).toBe(0);
    expect(state.companions[locked.id]).toBe(0);
  });

  it('buys companions in bulk through the same closed form as upgrades', () => {
    const definition = COMPANIONS[0];
    if (definition === undefined) throw new Error('no companions');

    const state = createInitialState(0);
    state.highestFloor = 50;
    state.gold = bulkCost(definition, 0, 12);

    expect(buyCompanion(state, definition.id, Number.MAX_SAFE_INTEGER).bought).toBe(12);
    expect(state.gold.isNegative).toBe(false);
  });
});
