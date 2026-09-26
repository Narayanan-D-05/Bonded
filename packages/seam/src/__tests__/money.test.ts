/**
 * Fixed-point money — Implementation PRD Part C.2 / Migration PRD Part D.2.
 * Part G row: Enforcer / `money.test.ts` — "`bpsWithinTolerance` never
 * touches a float; correct at exact boundary values."
 *
 * Every case below is constructed from `bigint` literals and integer
 * `toleranceBps` values only. No test in this file constructs a `number`
 * amount or calls `parseFloat` — that absence is itself part of what this
 * file proves.
 */

import { USDC_DECIMALS, USDC_SCALE, bpsWithinTolerance } from '../money.js';

describe('constants', () => {
  it('are the disclosed 6-decimal values', () => {
    expect(USDC_DECIMALS).toBe(6n);
    expect(USDC_SCALE).toBe(1_000_000n);
  });
});

describe('bpsWithinTolerance', () => {
  it('0 bps: only an exact match passes', () => {
    expect(bpsWithinTolerance(100n, 100n, 0)).toBe(true);
    expect(bpsWithinTolerance(100n, 99n, 0)).toBe(false);
    expect(bpsWithinTolerance(100n, 101n, 0)).toBe(false);
  });

  it('exact match passes at every tolerance, including 0', () => {
    for (const bps of [0, 1, 50, 100, 5000, 10_000]) {
      expect(bpsWithinTolerance(1_000_000n, 1_000_000n, bps)).toBe(true);
    }
  });

  it('exact match passes even when claimed is 0 (lower === upper === 0)', () => {
    expect(bpsWithinTolerance(0n, 0n, 500)).toBe(true);
    expect(bpsWithinTolerance(0n, 1n, 500)).toBe(false);
  });

  it('just inside tolerance on both sides passes (100 bps = 1%, claimed = 10000)', () => {
    // lower = 10000 * 9900 / 10000 = 9900, upper = 10000 * 10100 / 10000 = 10100
    expect(bpsWithinTolerance(10_000n, 9_900n, 100)).toBe(true); // exact lower bound
    expect(bpsWithinTolerance(10_000n, 10_100n, 100)).toBe(true); // exact upper bound
  });

  it('just outside tolerance on both sides fails (100 bps, claimed = 10000)', () => {
    expect(bpsWithinTolerance(10_000n, 9_899n, 100)).toBe(false); // one below lower
    expect(bpsWithinTolerance(10_000n, 10_101n, 100)).toBe(false); // one above upper
  });

  it('tolerance 10000 (100%): [0, 2*claimed] passes, one outside on either side fails', () => {
    expect(bpsWithinTolerance(500n, 0n, 10_000)).toBe(true); // exact lower bound: 0
    expect(bpsWithinTolerance(500n, 1_000n, 10_000)).toBe(true); // exact upper bound: 2x
    expect(bpsWithinTolerance(500n, 1_001n, 10_000)).toBe(false); // one above 2x
  });

  it('is exact at boundary values that do not divide evenly (integer truncation only, never rounded)', () => {
    // claimed = 3, toleranceBps = 100 -> lower = 3*9900/10000 = 2 (2.97 truncated),
    // upper = 3*10100/10000 = 3 (3.03 truncated)
    expect(bpsWithinTolerance(3n, 2n, 100)).toBe(true);
    expect(bpsWithinTolerance(3n, 3n, 100)).toBe(true);
    expect(bpsWithinTolerance(3n, 1n, 100)).toBe(false);
    expect(bpsWithinTolerance(3n, 4n, 100)).toBe(false);
  });

  it('never touches a float: rejects a non-bigint claimed/derived at runtime', () => {
    // @ts-expect-error — claimed must be bigint, never a number
    expect(() => bpsWithinTolerance(100, 100n, 0)).toThrow(TypeError);
    // @ts-expect-error — derived must be bigint, never a number
    expect(() => bpsWithinTolerance(100n, 100, 0)).toThrow(TypeError);
  });

  it('rejects a negative claimed or derived', () => {
    expect(() => bpsWithinTolerance(-1n, 0n, 0)).toThrow(RangeError);
    expect(() => bpsWithinTolerance(0n, -1n, 0)).toThrow(RangeError);
  });

  it('rejects a fractional or out-of-range toleranceBps', () => {
    expect(() => bpsWithinTolerance(100n, 100n, 0.5)).toThrow(RangeError);
    expect(() => bpsWithinTolerance(100n, 100n, -1)).toThrow(RangeError);
    expect(() => bpsWithinTolerance(100n, 100n, 10_001)).toThrow(RangeError);
  });

  it('rejects a bigint toleranceBps (bps counts are number, never bigint)', () => {
    // @ts-expect-error — toleranceBps is a number of bps, not a bigint
    expect(() => bpsWithinTolerance(100n, 100n, 0n)).toThrow(TypeError);
  });
});
