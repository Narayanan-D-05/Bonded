/**
 * Stake pricing — PRD Part M, row "Risk pricing".
 *
 * Must prove: `riskToStakeMultiplierBps` is correct at R=0, R=R_unknown and
 * R=max, with integer arithmetic only and no float ever entering the path. A
 * float reaching these functions is the bug CLAUDE.md rule 2 exists for, so the
 * functions throw on one instead of quietly truncating it — and these tests pin
 * that.
 */

import {
  USDC_DECIMALS,
  USDC_SCALE,
  BPS_DENOMINATOR,
  R_UNKNOWN_BPS,
  R_MAX_BPS,
  MIN_MULTIPLIER_BPS,
  MAX_MULTIPLIER_BPS,
  riskToStakeMultiplierBps,
  applyMultiplier,
  requiredStake,
  parseUnits6,
  formatUnits6,
} from '../money.js';

describe('constants', () => {
  it('are the disclosed values', () => {
    expect(USDC_DECIMALS).toBe(6n);
    expect(USDC_SCALE).toBe(1_000_000n);
    expect(BPS_DENOMINATOR).toBe(10_000n);
    expect(R_UNKNOWN_BPS).toBe(6000);
    expect(R_MAX_BPS).toBe(10_000);
    expect(MIN_MULTIPLIER_BPS).toBe(10_500);
    expect(MAX_MULTIPLIER_BPS).toBe(30_000);
  });
});

describe('riskToStakeMultiplierBps', () => {
  it.each([
    [0, 10_500], // R=0: floor 1.05x, betrayal never rational
    [1, 10_501], // 15000*1/10000 = 1.5, truncated to 1
    [R_UNKNOWN_BPS, 19_500], // "no data yet"
    [9_999, 25_498], // 15000*9999/10000 = 14998.5, truncated
    [10_000, 25_500], // R=max
  ])('R=%i -> %i bps', (r, expected) => {
    const m = riskToStakeMultiplierBps(r);
    expect(m).toBe(expected);
    expect(Number.isInteger(m)).toBe(true);
  });

  it('never reaches the 30000 cap: R is bounded at 10000, so the maximum is 25500', () => {
    let max = 0;
    for (let r = 0; r <= R_MAX_BPS; r++) {
      const m = riskToStakeMultiplierBps(r);
      expect(Number.isInteger(m)).toBe(true);
      if (m > max) max = m;
    }
    expect(max).toBe(25_500);
    expect(max).toBeLessThan(MAX_MULTIPLIER_BPS);
  });

  it('is monotonic non-decreasing across the whole domain', () => {
    let prev = riskToStakeMultiplierBps(0);
    for (let r = 1; r <= R_MAX_BPS; r++) {
      const m = riskToStakeMultiplierBps(r);
      expect(m).toBeGreaterThanOrEqual(prev);
      prev = m;
    }
  });

  it.each([
    ['a fractional score', 0.5],
    ['a fractional score near an integer', 6000.0001],
    ['a negative score', -1],
    ['a score above 10000', 10_001],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('throws on %s', (_label, r) => {
    expect(() => riskToStakeMultiplierBps(r)).toThrow(RangeError);
  });

  it('throws on a non-number at runtime (e.g. a bigint or string from untyped JSON)', () => {
    // @ts-expect-error — the type says number; a JS caller could still pass anything
    expect(() => riskToStakeMultiplierBps(6000n)).toThrow(TypeError);
    // @ts-expect-error — as above
    expect(() => riskToStakeMultiplierBps('6000')).toThrow(TypeError);
  });
});

describe('applyMultiplier', () => {
  it('returns a bigint', () => {
    expect(typeof applyMultiplier(1_000_000n, 10_500)).toBe('bigint');
    expect(typeof requiredStake(1_000_000n, 0)).toBe('bigint');
  });

  it.each([
    [0n, 10_500, 0n],
    [1n, 10_500, 2n], // 1.05 -> ceil 2 (floor would give 1 == price: not collateralised)
    [19n, 10_500, 20n], // 19.95 -> 20
    [20n, 10_500, 21n], // exact: 21.00
    [7n, 18_000, 13n], // 12.6 -> 13
    [1_000_000n, 10_500, 1_050_000n],
    [1_000_000n, 19_500, 1_950_000n],
    [1_000_000n, 25_500, 2_550_000n],
    [1_000_000n, 30_000, 3_000_000n],
    [3n, 30_000, 9n],
    [9_999n, 10_501, 10_500n], // 10499.9499 -> 10500
  ])('applyMultiplier(%s, %i) = %s', (amount, bps, expected) => {
    expect(applyMultiplier(amount, bps)).toBe(expected);
  });

  it('is exact (no rounding) when amount * bps divides by 10000', () => {
    expect(applyMultiplier(10_000n, 12_345)).toBe(12_345n);
    expect(applyMultiplier(20n * USDC_SCALE, 10_500)).toBe(21n * USDC_SCALE);
  });

  it('handles amounts whose product exceeds u64 but whose result fits (u128 intermediate on-chain)', () => {
    const price = 7_000_000_000_000_000_000n; // 7e18 < u64::MAX; 7e18 * 10500 > u64::MAX
    expect(applyMultiplier(price, 10_500)).toBe(7_350_000_000_000_000_000n);
  });

  it('is the tight ceiling, and stake > price, for every bps in range across prices 1..1000', () => {
    // Collect failures rather than asserting per iteration: ~19.5M cases.
    const failures: string[] = [];
    for (let bps = MIN_MULTIPLIER_BPS; bps <= MAX_MULTIPLIER_BPS; bps++) {
      const b = BigInt(bps);
      for (let p = 1n; p <= 1000n; p++) {
        const stake = applyMultiplier(p, bps);
        const scaled = p * b;
        const ok =
          stake > p && // strictly greater than the payment: the whole thesis
          stake * 10_000n >= scaled && // stake >= price * multiplier
          (stake - 1n) * 10_000n < scaled; // and no more than necessary
        if (!ok && failures.length < 10) failures.push(`p=${p} bps=${bps} stake=${stake}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('throws on a negative amount', () => {
    expect(() => applyMultiplier(-1n, 10_500)).toThrow(RangeError);
  });

  it.each([
    ['below the floor', 10_499],
    ['above the cap', 30_001],
    ['fractional', 10_500.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['zero', 0],
  ])('throws on multiplier bps %s', (_label, bps) => {
    expect(() => applyMultiplier(1_000_000n, bps)).toThrow(RangeError);
  });

  it('rejects a number amount (type-level, and at runtime for untyped callers)', () => {
    // @ts-expect-error — amounts are bigint; a number here is the CLAUDE.md rule 2 bug
    expect(() => applyMultiplier(1.05, 10_500)).toThrow(TypeError);
    // @ts-expect-error — even an integral number is refused: the caller must decide on bigint
    expect(() => applyMultiplier(100, 10_500)).toThrow(TypeError);
    // @ts-expect-error — multiplier is a number of bps, not a bigint
    expect(() => applyMultiplier(100n, 10_500n)).toThrow(TypeError);
  });
});

describe('requiredStake', () => {
  it('composes riskToStakeMultiplierBps and applyMultiplier', () => {
    expect(requiredStake(1_000_000n, 0)).toBe(1_050_000n);
    expect(requiredStake(1_000_000n, R_UNKNOWN_BPS)).toBe(1_950_000n);
    expect(requiredStake(1_000_000n, 10_000)).toBe(2_550_000n);
    expect(requiredStake(1n, 0)).toBe(2n);
  });

  it('throws on a float risk score rather than pricing it', () => {
    expect(() => requiredStake(1_000_000n, 0.6)).toThrow(RangeError);
  });

  it('throws on a negative price', () => {
    expect(() => requiredStake(-5n, 0)).toThrow(RangeError);
  });
});

describe('parseUnits6 / formatUnits6', () => {
  it.each([
    ['0', 0n],
    ['0.000001', 1n],
    ['1', 1_000_000n],
    ['2.5', 2_500_000n],
    ['123456.789012', 123_456_789_012n],
    ['18446744073709.551615', 18_446_744_073_709_551_615n], // u64::MAX base units
  ])('round-trips %s <-> %s', (text, units) => {
    const parsed = parseUnits6(text);
    expect(typeof parsed).toBe('bigint');
    expect(parsed).toBe(units);
    expect(formatUnits6(units)).toBe(text);
  });

  it('accepts trailing zeros in the fraction and formats canonically', () => {
    expect(parseUnits6('1.500000')).toBe(1_500_000n);
    expect(parseUnits6('1.50')).toBe(1_500_000n);
    expect(formatUnits6(1_500_000n)).toBe('1.5');
    expect(formatUnits6(1_000_001n)).toBe('1.000001');
  });

  it('does not lose precision on values a float would round', () => {
    // 0.1 + 0.2 territory and beyond 2^53 base units
    expect(parseUnits6('9007199254.740993')).toBe(9_007_199_254_740_993n);
    expect(formatUnits6(9_007_199_254_740_993n)).toBe('9007199254.740993');
  });

  it.each([
    ['more than 6 decimals', '1.0000001'],
    ['a negative', '-1'],
    ['letters', 'abc'],
    ['empty string', ''],
    ['a lone dot', '.'],
    ['a leading dot', '.5'],
    ['a trailing dot', '1.'],
    ['whitespace', ' 1'],
    ['a plus sign', '+1'],
    ['exponent notation', '1e6'],
    ['a thousands separator', '1,000'],
    ['two dots', '1.2.3'],
  ])('rejects %s (%p)', (_label, text) => {
    expect(() => parseUnits6(text)).toThrow(RangeError);
  });

  it('rejects a non-string at runtime', () => {
    // @ts-expect-error — input must be a string, never a float
    expect(() => parseUnits6(2.5)).toThrow(TypeError);
  });

  it('formatUnits6 rejects a negative amount and a non-bigint', () => {
    expect(() => formatUnits6(-1n)).toThrow(RangeError);
    // @ts-expect-error — amounts are bigint
    expect(() => formatUnits6(1)).toThrow(TypeError);
  });
});
