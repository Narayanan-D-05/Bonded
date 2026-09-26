import type { Premise } from '@bonded/seam';
import { compareTimestamp, evaluatePremise } from '../tolerance.js';

function makePremise(overrides: Partial<Premise>): Premise {
  return { id: 'p1', schema: 'issuer-oracle-tickets', field: 'x', op: 'eq', value: '', ...overrides };
}

describe('compareTimestamp', () => {
  it('older_than: derived strictly greater than claimed', () => {
    expect(compareTimestamp('older_than', 100n, 50n)).toBe(true);
    expect(compareTimestamp('older_than', 50n, 50n)).toBe(false);
    expect(compareTimestamp('older_than', 40n, 50n)).toBe(false);
  });

  it('younger_than: derived strictly less than claimed', () => {
    expect(compareTimestamp('younger_than', 40n, 50n)).toBe(true);
    expect(compareTimestamp('younger_than', 50n, 50n)).toBe(false);
    expect(compareTimestamp('younger_than', 60n, 50n)).toBe(false);
  });
});

describe('evaluatePremise', () => {
  // NOTE: `evaluatePremise`'s first parameter widened from `claimed: bigint`
  // to `claimedRaw: string` (the raw wire value, parsed internally now —
  // see tolerance.ts and enforce.ts's corrected mismatch branch). Every call
  // site below is mechanically updated to pass a string for that argument;
  // the numeric values and every assertion's expected boolean are unchanged.
  it('gte: derived >= claimed', () => {
    const def = makePremise({ op: 'gte' });
    expect(evaluatePremise(def, '10', 10n)).toBe(true);
    expect(evaluatePremise(def, '10', 9n)).toBe(false);
    expect(evaluatePremise(def, '10', 11n)).toBe(true);
  });

  it('lte: derived <= claimed', () => {
    const def = makePremise({ op: 'lte' });
    expect(evaluatePremise(def, '10', 10n)).toBe(true);
    expect(evaluatePremise(def, '10', 11n)).toBe(false);
    expect(evaluatePremise(def, '10', 9n)).toBe(true);
  });

  it('older_than / younger_than dispatch to compareTimestamp', () => {
    expect(evaluatePremise(makePremise({ op: 'older_than' }), '50', 100n)).toBe(true);
    expect(evaluatePremise(makePremise({ op: 'younger_than' }), '50', 40n)).toBe(true);
  });

  it('eq with no toleranceBps requires exact bigint equality', () => {
    const def = makePremise({ op: 'eq' });
    expect(evaluatePremise(def, '100', 100n)).toBe(true);
    expect(evaluatePremise(def, '100', 99n)).toBe(false);
    expect(evaluatePremise(def, '100', 101n)).toBe(false);
  });

  it('eq with toleranceBps delegates to bpsWithinTolerance', () => {
    const def = makePremise({ op: 'eq', toleranceBps: 100 }); // 1%
    expect(evaluatePremise(def, '10000', 9_900n)).toBe(true); // exact lower bound
    expect(evaluatePremise(def, '10000', 10_100n)).toBe(true); // exact upper bound
    expect(evaluatePremise(def, '10000', 9_899n)).toBe(false);
    expect(evaluatePremise(def, '10000', 10_101n)).toBe(false);
  });

  it('a non-\'eq\' op against a string derived throws TypeError', () => {
    const def = makePremise({ op: 'gte', field: 'vendor.status' });
    expect(() => evaluatePremise(def, 'active', 'active')).toThrow(TypeError);
    expect(() => evaluatePremise(def, 'active', 'active')).toThrow(/gte/);
    expect(() => evaluatePremise(def, 'active', 'active')).toThrow(/vendor\.status/);
  });

  it('categorical eq: string derived compares by strict string equality', () => {
    const def = makePremise({ op: 'eq', field: 'vendor.status' });
    expect(evaluatePremise(def, 'active', 'active')).toBe(true);
    expect(evaluatePremise(def, 'active', 'suspended')).toBe(false);
  });
});
