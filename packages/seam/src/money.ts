/**
 * Fixed-point money — PRD Parts C.3 and F.3.
 *
 * Every USD/USDC amount in this codebase is a 6-decimal fixed-point bigint.
 * Never a `number`. Never `parseFloat`. (CLAUDE.md rule 2.)
 *
 * The settlement coin is Sui testnet USDSUI, not Circle USDC
 * (docs/THREATMODEL.md, 2026-09-25). It is also 6 decimals, so the same scale
 * applies unchanged.
 *
 * Every function here throws on out-of-domain input instead of truncating or
 * clamping it. A float risk score or a `number` amount reaching this file is
 * exactly the bug rule 2 exists for, and silently rounding it would hide it.
 *
 * The Move bond vault computes the required stake with the identical formula
 * (integer bps, ceiling division, u128 intermediate). `__tests__/stake-vectors.json`
 * is asserted by both implementations.
 */

export const USDC_DECIMALS = 6n;
export const USDC_SCALE = 10n ** USDC_DECIMALS;

/** USDC_DECIMALS as a digit count, for string padding only — never an amount. */
const FRACTION_DIGITS = 6;

/** Basis-point denominator: 10000 bps = 1.0x. */
export const BPS_DENOMINATOR = 10_000n;

/** Maximum risk score: R is an integer count of bps in 0..10000. */
export const R_MAX_BPS = 10_000;

/** Fixed, disclosed risk score for "no data yet" (PRD C.3). */
export const R_UNKNOWN_BPS = 6000;

/** 1.05x — betrayal is never rational, even at R=0. */
export const MIN_MULTIPLIER_BPS = 10_500;

/**
 * 3.0x — the PRD's cap. With R bounded at 10000 the formula tops out at
 * 10500 + 15000 = 25500, so this cap is unreachable through
 * `riskToStakeMultiplierBps`. It is kept as a defensive clamp and as the upper
 * bound `applyMultiplier` accepts.
 */
export const MAX_MULTIPLIER_BPS = 30_000;

/** Slope of m_bps(R): 15000 bps of multiplier across the full 10000 bps of risk. */
const RISK_SLOPE_BPS = 15_000;

function assertIntegerInRange(name: string, value: number, min: number, max: number): void {
  if (typeof value !== 'number') {
    throw new TypeError(`${name} must be a number of basis points, got ${typeof value}`);
  }
  if (!Number.isInteger(value)) {
    throw new RangeError(`${name} must be an integer, got ${value}`);
  }
  if (value < min || value > max) {
    throw new RangeError(`${name} must be in ${min}..${max}, got ${value}`);
  }
}

function assertNonNegativeBigint(name: string, value: bigint): void {
  if (typeof value !== 'bigint') {
    throw new TypeError(`${name} must be a bigint, got ${typeof value}`);
  }
  if (value < 0n) {
    throw new RangeError(`${name} must be non-negative, got ${value}`);
  }
}

/**
 * m_bps(R) = 10500 + floor(15000 * R / 10000), clamped to [10500, 30000].
 *
 * `riskBps` must be an integer in 0..10000; anything else throws. The division
 * is done on integers (remainder subtracted first), so no fractional value ever
 * exists in the computation. The product 15000 * 10000 = 1.5e8 is far inside
 * Number.MAX_SAFE_INTEGER.
 *
 * Reachable range: 10500 (R=0) .. 25500 (R=10000). The 30000 clamp cannot bind.
 */
export function riskToStakeMultiplierBps(riskBps: number): number {
  assertIntegerInRange('riskBps', riskBps, 0, R_MAX_BPS);
  const product = RISK_SLOPE_BPS * riskBps;
  const quotient = (product - (product % R_MAX_BPS)) / R_MAX_BPS;
  const raw = MIN_MULTIPLIER_BPS + quotient;
  return Math.min(MAX_MULTIPLIER_BPS, Math.max(MIN_MULTIPLIER_BPS, raw));
}

/**
 * ceil(amount * multiplierBps / 10000).
 *
 * Deviation from PRD F.3, which floors. The thesis is "stake > payment"; floor
 * division under-collateralises tiny amounts (1 base unit at 10500 bps floors to
 * 1, equal to the price). Ceiling guarantees stake >= amount * multiplier, and
 * with multiplierBps >= 10500 it guarantees stake > amount for every amount >= 1.
 *
 * Throws on a negative or non-bigint amount, and on a multiplier that is not an
 * integer in [MIN_MULTIPLIER_BPS, MAX_MULTIPLIER_BPS].
 */
export function applyMultiplier(amount: bigint, multiplierBps: number): bigint {
  assertNonNegativeBigint('amount', amount);
  assertIntegerInRange('multiplierBps', multiplierBps, MIN_MULTIPLIER_BPS, MAX_MULTIPLIER_BPS);
  return (amount * BigInt(multiplierBps) + (BPS_DENOMINATOR - 1n)) / BPS_DENOMINATOR;
}

/** The stake each side posts for a transaction of `price` at risk score `riskBps`. */
export function requiredStake(price: bigint, riskBps: number): bigint {
  return applyMultiplier(price, riskToStakeMultiplierBps(riskBps));
}

const UNITS6_PATTERN = /^(\d+)(?:\.(\d{1,6}))?$/;

/**
 * Parse a non-negative decimal string ("2.5") into 6-decimal base units
 * (2_500_000n) using string arithmetic only.
 *
 * Rejects: more than 6 fractional digits (never rounds), signs, exponents,
 * whitespace, separators, a leading or trailing dot, and the empty string.
 */
export function parseUnits6(input: string): bigint {
  if (typeof input !== 'string') {
    throw new TypeError(`parseUnits6 takes a decimal string, got ${typeof input}`);
  }
  const match = UNITS6_PATTERN.exec(input);
  if (match === null) {
    throw new RangeError(
      `not a non-negative decimal with at most ${USDC_DECIMALS} fractional digits: ${JSON.stringify(input)}`,
    );
  }
  const whole = match[1] ?? '0';
  const fraction = (match[2] ?? '').padEnd(FRACTION_DIGITS, '0');
  return BigInt(whole) * USDC_SCALE + BigInt(fraction);
}

/** Format 6-decimal base units as a canonical decimal string (no trailing zeros). */
export function formatUnits6(amount: bigint): string {
  assertNonNegativeBigint('amount', amount);
  const whole = amount / USDC_SCALE;
  const fraction = (amount % USDC_SCALE)
    .toString()
    .padStart(FRACTION_DIGITS, '0')
    .replace(/0+$/, '');
  return fraction === '' ? whole.toString() : `${whole}.${fraction}`;
}
