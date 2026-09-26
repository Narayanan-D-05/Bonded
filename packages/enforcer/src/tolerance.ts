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

/**
 * Evaluates one premise's claimed-vs-derived pair per its declared op.
 *
 * `claimedRaw` is always the raw string from `Proposal.premises[].claimedValue`
 * — never pre-parsed by the caller (`enforce.ts`). `derived` is whatever
 * `resolvePremise` actually returned: a `bigint` for magnitude/timestamp
 * fields, or a `string` for categorical fields (e.g. `vendor.status`).
 *
 * When `derived` is a `string`, only `'eq'` is a valid op — a categorical
 * field has no meaningful `gte`/`lte`/`older_than`/`younger_than` ordering,
 * so any other op throws a `TypeError` naming the offending op and field
 * rather than silently coercing. The bigint branch (existing behavior,
 * unchanged) parses `claimedRaw` internally via `BigInt(claimedRaw)` instead
 * of accepting an already-parsed bigint — this is what lets `enforce.ts`
 * pass the raw string straight through without guessing whether a premise is
 * categorical before calling this function.
 */
export function evaluatePremise(def: Premise, claimedRaw: string, derived: bigint | string): boolean {
  if (typeof derived === 'string') {
    if (def.op !== 'eq') {
      throw new TypeError(`op '${def.op}' is not valid for a categorical (string) premise field '${def.field}'`);
    }
    return claimedRaw === derived;
  }
  const claimed = BigInt(claimedRaw);
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
