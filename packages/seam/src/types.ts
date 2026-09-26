/**
 * Shared types for the Hostage Protocol — PRD Part F.2.
 *
 * The numeric enum values below are a wire format: they must equal the outcome
 * and slash-reason constants in the Move bond vault. `__tests__/types.test.ts`
 * pins them value by value.
 *
 * Amounts are always `bigint` in 6-decimal base units (CLAUDE.md rule 2). The
 * only `number`s here are small integer enumerations and basis-point counts,
 * which are never amounts.
 */

export type Address = `0x${string}`;
export type Hash32 = `0x${string}`;

export enum BondOutcome {
  SETTLED = 0,
  SLASHED_PAYER = 1,
  SLASHED_SELLER = 2,
  /**
   * Not in PRD F.2 — a decided addition (docs/THREATMODEL.md, 2026-09-25). The
   * buyer reclaims after the deadline when the seller never joined or the bond
   * was never adjudicated. Nobody's stake moves to anyone else, so this is not
   * a slash path; it exists so funds cannot be stranded.
   */
  EXPIRED_REFUND = 3,
}

export enum SlashReason {
  NONE = 0,
  /** A fresh Intercepta deep-scan flag at settlement. */
  PAYMENT_SIDE_FLAG = 1,
  /** The delivered resource's hash differs from the seller's pre-payment commitment. */
  DELIVERY_HASH_MISMATCH = 2,
}

export interface BondRecord {
  /** Sui object id of the Bond. */
  bondId: string;
  txRef: Hash32;
  buyer: Address;
  seller: Address;
  /** Transaction value, 6-decimal base units. */
  price: bigint;
  /** m_bps(R) at lock time — an integer count of basis points, see PRD C.3. */
  stakeMultiplierBps: number;
  /** Stake each side posts: applyMultiplier(price, stakeMultiplierBps), base units. */
  requiredStake: bigint;
  outcome: BondOutcome;
  reason: SlashReason;
  evidenceHash?: Hash32;
}
