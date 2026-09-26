/**
 * Cross-implementation stake vectors.
 *
 * `stake-vectors.json` is asserted in two places that must never disagree: here,
 * against the TypeScript kernel, and in the Move vault's tests, against its own
 * u128 ceiling computation. Two independent implementations agreeing on the same
 * rows is the evidence; a comment claiming the formulas match is not.
 *
 * Amounts are decimal strings in the JSON (JSON has no bigint) and are parsed
 * with BigInt(), never Number().
 */

import { readFileSync } from 'node:fs';
import { applyMultiplier, requiredStake, riskToStakeMultiplierBps } from '../money.js';

interface VectorRow {
  price: string;
  riskBps: number;
  multiplierBps: number;
  requiredStake: string;
}

const rows = JSON.parse(
  readFileSync(new URL('./stake-vectors.json', import.meta.url), 'utf8'),
) as VectorRow[];

describe('stake-vectors.json', () => {
  it('has rows', () => {
    expect(rows.length).toBeGreaterThanOrEqual(12);
  });

  it.each(rows.map((r) => [r.price, r.riskBps, r] as const))(
    'price=%s riskBps=%i',
    (_price, _risk, row) => {
      expect(row.price).toMatch(/^\d+$/);
      expect(row.requiredStake).toMatch(/^\d+$/);
      const price = BigInt(row.price);
      const expected = BigInt(row.requiredStake);
      expect(riskToStakeMultiplierBps(row.riskBps)).toBe(row.multiplierBps);
      expect(applyMultiplier(price, row.multiplierBps)).toBe(expected);
      expect(requiredStake(price, row.riskBps)).toBe(expected);
    },
  );

  it('every row stays within u64 for price and stake (Coin amounts on Sui are u64)', () => {
    const U64_MAX = 18_446_744_073_709_551_615n;
    for (const r of rows) {
      expect(BigInt(r.price)).toBeLessThanOrEqual(U64_MAX);
      expect(BigInt(r.requiredStake)).toBeLessThanOrEqual(U64_MAX);
    }
  });
});
