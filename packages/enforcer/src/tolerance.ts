/**
 * Non-magnitude premise comparisons, plus the single dispatch point that
 * routes every `PremiseOp` through either these or `bpsWithinTolerance`
 * (`@bonded/seam`'s canonical comparison — never reimplemented here).
 *
 * Implementation PRD D.2's own ternary chain: `'gte'`/`'lte'` are plain
 * bigint comparisons, `'older_than'`/`'younger_than'` compare timestamps via
 * a `compareTimestamp` helper the pseudocode calls but never defines, and
 * `'eq'` (the ternary's final fallthrough) always goes through
 * `bpsWithinTolerance` with `toleranceBps ?? 0` — so an exact-equality
 * premise with no declared tolerance requires bit-for-bit bigint equality.
 */
import { bpsWithinTolerance, type Premise } from '@bonded/seam';

/**
 * `older_than`: passes when the derived value is strictly greater than the
 * claimed threshold (further in the past / a larger age than the claim
 * demands). `younger_than`: strictly less than.
 *
 * Not specified verbatim anywhere in the Implementation PRD — D.2's
 * pseudocode calls `compareTimestamp(def.op, derived, claimed)` without
 * defining its body. This is this package's own judgment call on the
 * natural reading of the two op names (documented here, and in the
 * enforcer's build report, rather than silently assumed); it is not a guess
 * at an external sponsor API, since no sponsor defines this comparison.
 */
export function compareTimestamp(op: 'older_than' | 'younger_than', derived: bigint, claimed: bigint): boolean {
  return op === 'older_than' ? derived > claimed : derived < claimed;
}

/** Evaluates one premise's claimed-vs-derived pair per its declared op. */
export function evaluatePremise(def: Premise, claimed: bigint, derived: bigint): boolean {
  switch (def.op) {
    case 'gte':
      return derived >= claimed;
    case 'lte':
      return derived <= claimed;
    case 'older_than':
    case 'younger_than':
      return compareTimestamp(def.op, derived, claimed);
    case 'eq':
      return bpsWithinTolerance(claimed, derived, def.toleranceBps ?? 0);
  }
}
