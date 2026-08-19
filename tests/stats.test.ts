import { describe, expect, it } from 'vitest';
import { applyModifiers, baseStats, type StatModifier } from '@game/progression/stats';
import { UPGRADES, getUpgrade, modifiersFor, rollChoices } from '@game/progression/upgrades';
import { Rng } from '@engine/rng';

/**
 * Build maths is the system players scrutinise hardest — someone will take
 * Split Shot four times and count the bullets. These tests pin the rules that
 * make a build's power predictable regardless of pickup order.
 */
describe('applyModifiers', () => {
  it('applies additive terms before multiplicative ones', () => {
    const modifiers: StatModifier[] = [
      { stat: 'damage', op: 'mul', value: 2 },
      { stat: 'damage', op: 'add', value: 10 },
    ];
    const base = baseStats();
    const result = applyModifiers(base, modifiers);
    expect(result.damage).toBe((base.damage + 10) * 2);
  });

  it('is order independent', () => {
    const a: StatModifier[] = [
      { stat: 'damage', op: 'add', value: 5 },
      { stat: 'damage', op: 'mul', value: 1.5 },
      { stat: 'damage', op: 'add', value: 3 },
    ];
    const b = [a[2], a[0], a[1]] as StatModifier[];
    expect(applyModifiers(baseStats(), a).damage).toBe(applyModifiers(baseStats(), b).damage);
  });

  it('keeps integer stats whole', () => {
    const result = applyModifiers(baseStats(), [
      { stat: 'projectiles', op: 'mul', value: 2.5 },
      { stat: 'maxHealth', op: 'mul', value: 1.33 },
    ]);
    expect(Number.isInteger(result.projectiles)).toBe(true);
    expect(Number.isInteger(result.maxHealth)).toBe(true);
  });

  it('clamps stats to their floors', () => {
    const result = applyModifiers(baseStats(), [
      { stat: 'maxHealth', op: 'add', value: -999 },
      { stat: 'damage', op: 'mul', value: 0 },
      { stat: 'dashCooldown', op: 'mul', value: 0 },
    ]);
    expect(result.maxHealth).toBe(1);
    expect(result.damage).toBeGreaterThanOrEqual(1);
    expect(result.dashCooldown).toBeGreaterThanOrEqual(0.12);
  });

  it('clamps stats to their ceilings', () => {
    const result = applyModifiers(baseStats(), [
      { stat: 'fireRate', op: 'mul', value: 1000 },
      { stat: 'critChance', op: 'add', value: 99 },
    ]);
    expect(result.fireRate).toBe(22);
    expect(result.critChance).toBe(1);
  });

  it('does not mutate the base stat block', () => {
    const base = baseStats();
    const snapshot = { ...base };
    applyModifiers(base, [{ stat: 'damage', op: 'add', value: 100 }]);
    expect(base).toEqual(snapshot);
  });
});

describe('upgrade pool', () => {
  it('has unique ids', () => {
    const ids = UPGRADES.map((u) => u.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('declares a positive stack limit and at least one modifier each', () => {
    for (const upgrade of UPGRADES) {
      expect(upgrade.maxStacks, upgrade.id).toBeGreaterThan(0);
      expect(upgrade.modifiers.length, upgrade.id).toBeGreaterThan(0);
    }
  });

  it('only references stats that exist', () => {
    const known = new Set(Object.keys(baseStats()));
    for (const upgrade of UPGRADES) {
      for (const modifier of upgrade.modifiers) {
        expect(known.has(modifier.stat), `${upgrade.id} -> ${modifier.stat}`).toBe(true);
      }
    }
  });

  it('stacks Split Shot into the expected projectile count', () => {
    const taken = ['split-shot', 'split-shot', 'split-shot'];
    const stats = applyModifiers(baseStats(), modifiersFor(taken));
    expect(stats.projectiles).toBe(baseStats().projectiles + 3);
  });

  it('ignores unknown upgrade ids from older saves', () => {
    expect(modifiersFor(['does-not-exist'])).toEqual([]);
    expect(getUpgrade('does-not-exist')).toBeUndefined();
  });
});

describe('rollChoices', () => {
  it('returns distinct upgrades', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const choices = rollChoices(new Rng(seed), [], 3);
      expect(new Set(choices.map((c) => c.id)).size).toBe(choices.length);
    }
  });

  it('never offers an upgrade already at max stacks', () => {
    const maxed = UPGRADES.find((u) => u.maxStacks === 1);
    expect(maxed).toBeDefined();
    const taken = new Array<string>(maxed!.maxStacks).fill(maxed!.id);
    for (let seed = 1; seed <= 200; seed++) {
      const choices = rollChoices(new Rng(seed), taken, 6);
      expect(choices.some((c) => c.id === maxed!.id)).toBe(false);
    }
  });

  it('gates depth-restricted upgrades', () => {
    const gated = UPGRADES.filter((u) => (u.minDepth ?? 1) > 1).map((u) => u.id);
    expect(gated.length).toBeGreaterThan(0);
    for (let seed = 1; seed <= 200; seed++) {
      const choices = rollChoices(new Rng(seed), [], 1, 3);
      for (const choice of choices) expect(gated).not.toContain(choice.id);
    }
  });

  it('degrades gracefully when the pool runs dry', () => {
    // Take every upgrade to its limit: the roll must return fewer options
    // rather than looping forever or throwing.
    const taken = UPGRADES.flatMap((u) => new Array<string>(u.maxStacks).fill(u.id));
    expect(rollChoices(new Rng(1), taken, 6, 3)).toEqual([]);
  });

  it('is deterministic for a seed', () => {
    const a = rollChoices(new Rng(77), [], 4).map((c) => c.id);
    const b = rollChoices(new Rng(77), [], 4).map((c) => c.id);
    expect(a).toEqual(b);
  });
});
