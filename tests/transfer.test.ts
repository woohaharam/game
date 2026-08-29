import { describe, expect, it } from 'vitest';
import { fromTransferCode, toTransferCode } from '../src/game/transfer';
import { decode, encode } from '../src/game/save';
import { createInitialState } from '../src/game/state';
import { advance } from '../src/game/simulation';
import { Decimal } from '../src/core/decimal';

describe('transfer codes', () => {
  it('round-trips a played save', () => {
    const original = createInitialState(0);
    original.upgrades.blade = 31;
    original.companions.torchbearer = 4;
    advance(original, 4000);

    const code = toTransferCode(encode(original, 0));
    const result = fromTransferCode(code);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const restored = decode(result.payload, 0).state;
    expect(restored.stage).toBe(original.stage);
    expect(restored.dust.serialise()).toBe(original.dust.serialise());
    expect(restored.upgrades.blade).toBe(31);
  });

  it('survives the mangling a chat app applies', () => {
    const code = toTransferCode(encode(createInitialState(0), 0));
    // Line wrapping, stray spaces, and the quotes a client adds around a paste.
    const mangled = `"${code.slice(0, 20)}\n  ${code.slice(20)}"`;
    expect(fromTransferCode(mangled).ok).toBe(true);
  });

  it('refuses a truncated code rather than loading a ruin', () => {
    // The failure that actually happens: a double-click selection stops short.
    const code = toTransferCode(encode(createInitialState(0), 0));
    const result = fromTransferCode(code.slice(0, code.length - 6));
    expect(result.ok).toBe(false);
  });

  it('refuses a code with a single character changed', () => {
    const state = createInitialState(0);
    state.dust = Decimal.of(1, 30);
    const code = toTransferCode(encode(state, 0));

    let caught = 0;
    // Every position in the payload, so the checksum is exercised rather than
    // spot-checked at a convenient index.
    const [prefix, encoded, stamp] = code.split('.') as [string, string, string];
    for (let i = 0; i < encoded.length; i += 1) {
      const original = encoded[i] ?? '';
      const swapped = original === 'A' ? 'B' : 'A';
      const damaged = `${prefix}.${encoded.slice(0, i)}${swapped}${encoded.slice(i + 1)}.${stamp}`;
      if (!fromTransferCode(damaged).ok) caught += 1;
    }
    expect(caught).toBe(encoded.length);
  });

  it('reports why a code was rejected', () => {
    expect(fromTransferCode('')).toEqual({ ok: false, reason: 'empty' });
    expect(fromTransferCode('   ')).toEqual({ ok: false, reason: 'empty' });
    expect(fromTransferCode('hello')).toEqual({ ok: false, reason: 'format' });
    expect(fromTransferCode('XX.abc.00000000')).toEqual({ ok: false, reason: 'format' });
    expect(fromTransferCode('DD1.abc.deadbeef')).toEqual({ ok: false, reason: 'damaged' });
  });

  it('carries a save far past the double range intact', () => {
    const state = createInitialState(0);
    state.dust = Decimal.of(7.25, 4000);
    state.crystals = Decimal.of(3.5, 1200);

    const result = fromTransferCode(toTransferCode(encode(state, 0)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const restored = decode(result.payload, 0).state;
    expect(restored.dust.exponent).toBe(4000);
    expect(restored.crystals.exponent).toBe(1200);
  });
});
