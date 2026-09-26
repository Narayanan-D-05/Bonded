/**
 * Budget and irreversible-threshold checks — Implementation PRD D.2 steps 4
 * and 5. Thin bigint comparisons only; tolerance/comparison math itself
 * lives exactly once, in `@bonded/seam`'s `bpsWithinTolerance` (used by
 * `tolerance.ts`, not here).
 */

/**
 * Step 4: the budget is exceeded iff `spentSoFar + requested` is strictly
 * greater than `maxUSDC`. Exactly equal to `maxUSDC` passes (D.2: `if (spent
 * + requested > BigInt(policy.budget.max))`).
 */
export function isBudgetExceeded(spentSoFar: bigint, requested: bigint, maxUSDC: bigint): boolean {
  return spentSoFar + requested > maxUSDC;
}

/**
 * Step 5: irreversible iff `requested` is strictly greater than the
 * threshold. D.2's own comparison is strict `>` — exactly equal to the
 * threshold does NOT hold for step-up, it clears.
 */
export function isIrreversible(requested: bigint, irreversibleAboveUSDC: bigint): boolean {
  return requested > irreversibleAboveUSDC;
}
