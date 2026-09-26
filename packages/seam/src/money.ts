/**
 * Fixed-point money — Implementation PRD Part C.2, carried over unchanged by
 * the Commerce Edition migration.
 *
 * Every USD/USDC amount in this codebase is a 6-decimal fixed-point value,
 * string-encoded on the wire (Proposal.action.valueUSDC,
 * PolicyArtifact.budget.max, etc.) and always compared/arithmetic'd as
 * `bigint`. Never a `number`. Never `parseFloat`. (CLAUDE.md rule 2 — this
 * project's own history has exactly one silent bug of this shape, and it
 * lived in this file.)
 *
 * This module intentionally exports only what Part C.2 specifies:
 * `USDC_DECIMALS`, `USDC_SCALE`, and `bpsWithinTolerance`. The Hostage
 * Protocol's stake-multiplier math (`riskToStakeMultiplierBps`,
 * `applyMultiplier`, `requiredStake`, `R_UNKNOWN_BPS`, ...) does not exist in
 * the Commerce Edition and is deleted, not deprecated.
 */

export const USDC_DECIMALS = 6n;
export const USDC_SCALE = 10n ** USDC_DECIMALS;

/**
 * Is `derived` within `toleranceBps` (hundredths of a percent) of `claimed`?
 *
 * `lower = claimed * (10000 - toleranceBps) / 10000`
 * `upper = claimed * (10000 + toleranceBps) / 10000`
 *
 * All three inputs are converted to `bigint` before any arithmetic happens,
 * so no float ever enters this computation. `toleranceBps` must be a
 * non-negative integer at most 10000 (100%) — `BigInt(10000 - toleranceBps)`
 * would itself throw a `RangeError` on a fractional value, but the explicit
 * checks below give a clearer message and reject the boundary cases
 * `BigInt()` would otherwise let through unchecked (a negative or
 * out-of-range `toleranceBps`).
 *
 * `claimed`/`derived` must be non-negative `bigint`s — these are amounts or
 * amount-like premise values, never signed, never a `number`.
 */
export function bpsWithinTolerance(claimed: bigint, derived: bigint, toleranceBps: number): boolean {
  if (typeof claimed !== 'bigint') {
    throw new TypeError(`claimed must be a bigint, got ${typeof claimed}`);
  }
  if (typeof derived !== 'bigint') {
    throw new TypeError(`derived must be a bigint, got ${typeof derived}`);
  }
  if (claimed < 0n) {
    throw new RangeError(`claimed must be non-negative, got ${claimed}`);
  }
  if (derived < 0n) {
    throw new RangeError(`derived must be non-negative, got ${derived}`);
  }
  if (typeof toleranceBps !== 'number') {
    throw new TypeError(`toleranceBps must be a number of basis points, got ${typeof toleranceBps}`);
  }
  if (!Number.isInteger(toleranceBps)) {
    throw new RangeError(`toleranceBps must be an integer, got ${toleranceBps}`);
  }
  if (toleranceBps < 0 || toleranceBps > 10_000) {
    throw new RangeError(`toleranceBps must be in 0..10000, got ${toleranceBps}`);
  }

  const toleranceBigInt = BigInt(toleranceBps);
  const lower = (claimed * (10_000n - toleranceBigInt)) / 10_000n;
  const upper = (claimed * (10_000n + toleranceBigInt)) / 10_000n;
  return derived >= lower && derived <= upper;
}
