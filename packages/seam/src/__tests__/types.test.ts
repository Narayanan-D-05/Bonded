/**
 * The numeric values of these enums are the wire format shared with the Move
 * vault's outcome and slash-reason constants. Changing one here without the
 * vault (or the reverse) silently mislabels every bond record, so they are
 * pinned value by value.
 */

import { BondOutcome, SlashReason, type BondRecord } from '../types.js';

describe('BondOutcome', () => {
  it('matches the Move vault constants 0..3', () => {
    expect(BondOutcome.SETTLED).toBe(0);
    expect(BondOutcome.SLASHED_PAYER).toBe(1);
    expect(BondOutcome.SLASHED_SELLER).toBe(2);
    expect(BondOutcome.EXPIRED_REFUND).toBe(3);
  });

  it('has exactly four members', () => {
    const numeric = Object.values(BondOutcome).filter((v) => typeof v === 'number');
    expect(numeric).toEqual([0, 1, 2, 3]);
  });
});

describe('SlashReason', () => {
  it('matches the Move vault constants 0..2', () => {
    expect(SlashReason.NONE).toBe(0);
    expect(SlashReason.PAYMENT_SIDE_FLAG).toBe(1);
    expect(SlashReason.DELIVERY_HASH_MISMATCH).toBe(2);
  });

  it('has exactly three members', () => {
    const numeric = Object.values(SlashReason).filter((v) => typeof v === 'number');
    expect(numeric).toEqual([0, 1, 2]);
  });
});

describe('BondRecord', () => {
  it('carries amounts as bigint', () => {
    const record: BondRecord = {
      bondId: '0x5',
      txRef: `0x${'ab'.repeat(32)}`,
      buyer: `0x${'01'.repeat(32)}`,
      seller: `0x${'02'.repeat(32)}`,
      price: 1_000_000n,
      stakeMultiplierBps: 19_500,
      requiredStake: 1_950_000n,
      outcome: BondOutcome.SETTLED,
      reason: SlashReason.NONE,
    };
    expect(typeof record.price).toBe('bigint');
    expect(typeof record.requiredStake).toBe('bigint');
    expect(record.evidenceHash).toBeUndefined();

    // @ts-expect-error — a number price does not type-check
    const bad: BondRecord = { ...record, price: 1.0 };
    expect(bad).toBeDefined();
  });
});
