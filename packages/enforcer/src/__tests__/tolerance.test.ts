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
  it('gte: derived >= claimed', () => {
    const def = makePremise({ op: 'gte' });
    expect(evaluatePremise(def, 10n, 10n)).toBe(true);
    expect(evaluatePremise(def, 10n, 9n)).toBe(false);
    expect(evaluatePremise(def, 10n, 11n)).toBe(true);
  });

  it('lte: derived <= claimed', () => {
    const def = makePremise({ op: 'lte' });
    expect(evaluatePremise(def, 10n, 10n)).toBe(true);
    expect(evaluatePremise(def, 10n, 11n)).toBe(false);
    expect(evaluatePremise(def, 10n, 9n)).toBe(true);
  });

  it('older_than / younger_than dispatch to compareTimestamp', () => {
    expect(evaluatePremise(makePremise({ op: 'older_than' }), 50n, 100n)).toBe(true);
    expect(evaluatePremise(makePremise({ op: 'younger_than' }), 50n, 40n)).toBe(true);
  });

  it('eq with no toleranceBps requires exact bigint equality', () => {
    const def = makePremise({ op: 'eq' });
    expect(evaluatePremise(def, 100n, 100n)).toBe(true);
    expect(evaluatePremise(def, 100n, 99n)).toBe(false);
    expect(evaluatePremise(def, 100n, 101n)).toBe(false);
  });

  it('eq with toleranceBps delegates to bpsWithinTolerance', () => {
    const def = makePremise({ op: 'eq', toleranceBps: 100 }); // 1%
    expect(evaluatePremise(def, 10_000n, 9_900n)).toBe(true); // exact lower bound
    expect(evaluatePremise(def, 10_000n, 10_100n)).toBe(true); // exact upper bound
    expect(evaluatePremise(def, 10_000n, 9_899n)).toBe(false);
    expect(evaluatePremise(def, 10_000n, 10_101n)).toBe(false);
  });
});
