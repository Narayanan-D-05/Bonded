/**
 * The `resolvePremise` adapter side — Migration PRD D.5's `interceptaRisk`
 * export, wired to `def.schema === 'intercepta-risk'` once `packages/enforcer`
 * exists.
 *
 * Return convention (documented explicitly, because the two sources this
 * package was briefed from disagree, and this file picks one on purpose):
 *
 *   - The Migration PRD's D.5 sketch shows field functions returning
 *     `Promise<string | number | boolean | undefined>`.
 *   - `packages/enforcer` does not exist yet in this repo (checked:
 *     `packages/enforcer/src/enforce.ts` is absent). The ORIGINAL
 *     Implementation PRD's `resolvePremise` — the function this migration's
 *     D.3 says is "identical control flow" to — has signature
 *     `(def, atBlock) => Promise<bigint | null>`, and `enforce()` compares
 *     the result with plain bigint `>=`/`<=` against `BigInt(claim.claimedValue)`.
 *   - This file follows the CONFIRMED, already-written convention
 *     (`bigint | null`) rather than the PRD sketch's unconfirmed one, per
 *     this task's own instruction to do so when `packages/enforcer` doesn't
 *     exist yet. **This needs reconciling once `packages/enforcer` is
 *     actually written** — flagged again in the package report.
 *   - `null` means "no derivable value" (the enforcer's existing contract:
 *     `derived === null` -> `ReasonCode.PREMISE_UNRESOLVABLE`), used here for
 *     genuinely no-data cases. Every other failure (missing key, HTTP error,
 *     shape mismatch) THROWS instead of resolving to `null` — a thrown error
 *     is never mistaken for "this field legitimately has no value"
 *     (CLAUDE.md rule 1).
 *
 * A real architectural gap, stated rather than papered over: several fields
 * Intercepta actually documents are CATEGORICAL STRINGS (`riskLevel`,
 * `category`, `trust`, `action`, `riskGroup`), not numbers. The seam's
 * `PremiseOp` set (`gte`/`lte`/`eq`/`older_than`/`younger_than`) is built for
 * bigint comparison, not string-enum equality-with-an-implied-order. This
 * file does NOT invent an ordinal encoding for those fields (e.g. deciding
 * that `high` = 3n) — that would be exactly the kind of guessed severity
 * threshold CLAUDE.md's [VERIFY] rule forbids. Only fields that are already
 * numeric in Intercepta's own schema are exposed through `resolvePremise`.
 * The categorical fields are still reachable from `@bonded/intercepta-adapter`
 * directly (via `client.ts`'s parsed response objects) for a UI or a future,
 * differently-shaped premise op — just not through this bigint-only surface.
 *
 * Fields NOT exposed here, and why:
 *   - `payment.token.isLookalike` (the PRD D.5 sketch's guess) — Scan Token's
 *     real, confirmed response has no `isLookalike` field at all. Inventing
 *     one would violate CLAUDE.md's [VERIFY] rule outright.
 *   - Anything backed by Scan Message — see `client.ts`'s `scanMessage` doc
 *     comment: its documented `messageType` enum is the Permit/Permit2
 *     family, not x402's ERC-3009 `TransferWithAuthorization`, so it does not
 *     fit this migration's actual payment-authorization shape. Wiring it in
 *     here would be adapting to a guessed fit, which this task explicitly
 *     asked not to do.
 *   - The "hard flag" threshold from the abandoned Hostage Protocol's
 *     `risk.ts` (which trait names should BLOCK vs merely be priced) is
 *     deliberately NOT ported. That was stake-multiplier decision logic, out
 *     of scope for this package per the task brief. `traitCount` below is a
 *     neutral, undecided primitive: it says traits were found, and leaves
 *     "how many is too many" to the policy artifact, not this adapter.
 */
import { InterceptaSubjectError, scanAddress, scanToken } from './client.js';

/** Every field function shares this signature, whether or not it uses `chain`. */
export type PremiseFieldFn = (subjectAddress: string, chain?: string) => Promise<bigint | null>;

function toBigIntScoreOrThrow(value: number, what: string): bigint {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${what} is not finite (${value}); refusing to encode it as a premise value`);
  }
  if (!Number.isInteger(value)) {
    // Neither documented score has a stated fractional convention
    // (VERIFY_FINDINGS item 5: "no min, max or range is documented"). A
    // fractional score is unexpected; fail closed instead of truncating it
    // (CLAUDE.md rule 2 — no float ever silently becomes an integer).
    throw new RangeError(`${what} = ${value} is fractional; the documented score's convention is UNCONFIRMED`);
  }
  return BigInt(value);
}

/**
 * `payment.payTo.toxicScore` / `payment.payer.toxicScore` — Quick Scan's
 * `toxicScore`, exactly as returned. UNCONFIRMED range (no min/max/direction
 * is published — VERIFY_FINDINGS item 5); this function does not normalise
 * or invert it, it passes the raw integer through as a bigint.
 */
export const quickScanToxicScore: PremiseFieldFn = async (subjectAddress) => {
  const { result } = await scanAddress(subjectAddress, 'quick-scan');
  return toBigIntScoreOrThrow(result.toxicScore, 'quick-scan toxicScore');
};

/** Same as above, via Deep Scan (`toxic-score`) instead of Quick Scan. */
export const deepScanToxicScore: PremiseFieldFn = async (subjectAddress) => {
  const { result } = await scanAddress(subjectAddress, 'toxic-score');
  return toBigIntScoreOrThrow(result.toxicScore, 'toxic-score toxicScore');
};

/**
 * Count of documented trait entries Deep Scan returned for the address — a
 * neutral numeric proxy for "something was flagged", with no severity
 * weighting invented. 0n means no trait was returned, not "confirmed clean".
 */
export const deepScanTraitCount: PremiseFieldFn = async (subjectAddress) => {
  const { result } = await scanAddress(subjectAddress, 'toxic-score');
  return BigInt(result.traits.length);
};

/**
 * `payment.token.riskScore` — Scan Token's `riskScore` ("Risk percentage",
 * documented example 70; no stated bound). `chain` is REQUIRED here (unlike
 * the address-scan fields) because Scan Token's endpoint requires a
 * documented `chainId`; passing one outside `TOKEN_CHAIN_IDS` throws rather
 * than silently picking a default. Note: this enum has no Sui id, so a
 * token that only exists on Sui cannot be scored by this call at all — this
 * matches docs/THREATMODEL.md's existing "Intercepta being wrong"/coverage
 * disclosure.
 */
export const scanTokenRiskScore: PremiseFieldFn = async (tokenAddress, chain) => {
  if (chain === undefined) {
    throw new InterceptaSubjectError('scanTokenRiskScore: chain is required (Scan Token has no default chainId)');
  }
  const { result } = await scanToken(tokenAddress, chain);
  return toBigIntScoreOrThrow(result.riskScore, 'scan-token riskScore');
};

/** Count of Scan Token's `detectors[]` — same neutral, unweighted convention as `deepScanTraitCount`. */
export const scanTokenDetectorCount: PremiseFieldFn = async (tokenAddress, chain) => {
  if (chain === undefined) {
    throw new InterceptaSubjectError('scanTokenDetectorCount: chain is required (Scan Token has no default chainId)');
  }
  const { result } = await scanToken(tokenAddress, chain);
  return BigInt(result.detectors.length);
};

/**
 * The `resolvePremise` adapter, keyed by field name. Every value is
 * `(subjectAddress, chain?) => Promise<bigint | null>` — see the return
 * convention note above.
 *
 * Field-naming departure from the Migration PRD D.5 sketch, stated plainly:
 * the sketch's `'payment.payTo.riskScore'` is kept in NAME only for the
 * address-side alias below, but the value it resolves is Intercepta's real
 * field, `toxicScore` — the API has no field literally called `riskScore`
 * for an address (only for a TOKEN). Keeping the PRD's exact string as an
 * alias avoids forcing every existing reference to the PRD's vocabulary to
 * change immediately, but the underlying data is toxicScore; new code should
 * prefer the `*.toxicScore` names.
 */
export const interceptaRisk = {
  schema: 'intercepta-risk' as const,
  fields: {
    'payment.payTo.toxicScore': quickScanToxicScore,
    'payment.payTo.toxicScoreDeep': deepScanToxicScore,
    'payment.payTo.traitCount': deepScanTraitCount,
    'payment.payer.toxicScore': quickScanToxicScore,
    'payment.payer.toxicScoreDeep': deepScanToxicScore,
    'payment.payer.traitCount': deepScanTraitCount,
    /** Alias of `payment.payTo.toxicScore` — see the departure note above. */
    'payment.payTo.riskScore': quickScanToxicScore,
    'payment.token.riskScore': scanTokenRiskScore,
    'payment.token.detectorCount': scanTokenDetectorCount,
  },
} as const;

export type InterceptaRiskField = keyof typeof interceptaRisk.fields;
