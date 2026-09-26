/**
 * The step-up gate: given a HELD proposal and a completed `handleCallback` result, decide
 * whether the World proof is fresh enough (and, optionally, matches the right human) to let
 * `settle_with_stepup` run.
 *
 * Rename/refactor of the now-deleted `identity/src/recovery-desk.ts` (the Hostage
 * Protocol's Recovery Desk). That file decided whether an agent-wide LOCKED state could be
 * cleared; this file decides whether ONE held proposal, identified by `proposalHash`, may
 * proceed. Everything here is a pure function over already-verified inputs — no network,
 * no store access — so it is unit-testable without any live call and without fabricating a
 * World-signed token (CLAUDE.md rule 7): the inputs it takes are exactly what
 * `flow.ts#handleCallback` already produced from a real exchange, or, in tests, plain
 * fixture values that stand in for "a handleCallback call already happened and returned
 * this."
 *
 * ── Design decision: no required owner-sub binding ──────────────────────────────────────
 *
 * The old Recovery Desk required the verifying `sub` to match the `sub` bound to the agent
 * at creation — because it was answering "is this the same human who owns this agent?".
 * Migration PRD D.6 asks a different question: "confirm purchase of 2 tickets, $90.00,
 * non-refundable" — it gates a PURCHASE (identified by `proposalHash`), not an agent's
 * owner identity. There is no natural "owner" of a proposal the way there is an owner of an
 * agent, and PRD D.6's own text never mentions checking `sub` against anything: "the fresh
 * World check gates only the moment a proposal crosses `irreversibleAboveUSDC` or is
 * flagged non-refundable" — the requirement is FRESHNESS (a human proved presence, right
 * now, for this specific proposal, because `nonce` binds the proof to this attempt), not
 * IDENTITY CONTINUITY (that it's the same recurring human). Any live human clearing World's
 * own liveness/uniqueness bar satisfies that.
 *
 * So `boundSub` on `HeldProposal` is OPTIONAL, not required: if the caller supplies one
 * (because, e.g., a future policy wants "the same operator who created this cart must be
 * the one who confirms it"), this gate enforces it and denies with `sub_mismatch` on a
 * different human. If the caller leaves it unset — the default, and what `/api/stepup`
 * should do for a bare purchase step-up — any human who freshly, successfully completes
 * World verification for that attempt satisfies the gate. This keeps the owner-binding
 * *concept* available (it cost nothing to keep as an optional field) without making it a
 * requirement the basic step-up gate needs to pass.
 */

import type { Hash32, Verdict } from '@bonded/seam';
import { ReasonCode } from '@bonded/seam';
import type { HandleCallbackResult } from './flow.js';

/**
 * How old a World proof may be when the gate acts on it, in milliseconds. 5 minutes,
 * matching the sandbox's own token/code lifetime ("Codes are single-use and last five
 * minutes." "ID tokens last five minutes.") — a step-up approval that outlives the token
 * that proved it would be checking a fact the IdP itself no longer stands behind.
 */
export const STEPUP_FRESHNESS_WINDOW_MS = 5 * 60 * 1000;

/**
 * `ReasonCode.IRREVERSIBLE_UNCONFIRMED` and `ReasonCode.PREMISE_HELD_FOR_REVIEW` are imported
 * directly from `@bonded/seam` — the seam's extension has landed, so this package does not
 * need to guess or locally re-declare that enum. `HeldProposal.holdReason` is narrowed to
 * exactly these two values: a step-up gate only ever exists to clear one of these two hold
 * reasons (an irreversible-threshold hold, or a premise mismatch held for human review),
 * never `BUDGET_EXCEEDED` or any other `ReasonCode`.
 */
export type HoldReason = ReasonCode.IRREVERSIBLE_UNCONFIRMED | ReasonCode.PREMISE_HELD_FOR_REVIEW;

export class HeldProposalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HeldProposalError';
  }
}

/**
 * Build a `HeldProposal` straight from the enforcer's own `Verdict` object (the seam type
 * `enforce()` actually produces), instead of a caller hand-assembling one. Throws if the
 * verdict is not, in fact, a HELD_FOR_STEPUP verdict for `IRREVERSIBLE_UNCONFIRMED` — this
 * gate must never be asked to bless a verdict it was not built to clear.
 */
export function fromHeldVerdict(verdict: Verdict, boundSub?: string): HeldProposal {
  if (verdict.outcome !== 2) {
    throw new HeldProposalError(`Verdict outcome is ${verdict.outcome}, expected 2 (HELD_FOR_STEPUP)`);
  }
  if (verdict.reasonCode !== ReasonCode.IRREVERSIBLE_UNCONFIRMED && verdict.reasonCode !== ReasonCode.PREMISE_HELD_FOR_REVIEW) {
    throw new HeldProposalError(
      `Verdict reasonCode is ${ReasonCode[verdict.reasonCode] ?? verdict.reasonCode}, expected IRREVERSIBLE_UNCONFIRMED or PREMISE_HELD_FOR_REVIEW`,
    );
  }
  return { proposalHash: verdict.proposalHash, holdReason: verdict.reasonCode, ...(boundSub !== undefined ? { boundSub } : {}) };
}

export interface HeldProposal {
  proposalHash: Hash32;
  holdReason: HoldReason;
  /**
   * Optional. See the module doc's "no required owner-sub binding" section. Leave unset for
   * the basic step-up gate; set it only when a policy specifically wants proof continuity
   * with an earlier-bound human, not just freshness.
   */
  boundSub?: string;
}

/**
 * Every denied path gets a distinct, typed reason. The first eight come straight from
 * `flow.ts#handleCallback`'s own internal bookkeeping (state/nonce replay, IdP-side denial,
 * token exchange/verification failure) — this gate does not re-derive them, it just
 * surfaces whatever `handleCallback` already decided, once, as a `{denied, reason}` or
 * `{expired}` result. The last two (`stale_authentication`, `sub_mismatch`) are decided
 * HERE, after `handleCallback` already returned `verified: true` — they are this gate's own
 * policy, not an OIDC-protocol failure.
 */
export type StepUpDeniedReason =
  /** The callback carried `error=access_denied` (or another IdP-side denial folded into it) — the human denied, or the IdP refused before a code was ever issued. */
  | 'access_denied'
  /** No pending attempt for this `state` (CSRF, or a stale/foreign callback), or the callback carried neither a code nor an error. */
  | 'state_mismatch'
  /** The verified ID token's `nonce` does not match the nonce this attempt sent. */
  | 'nonce_mismatch'
  /** This authorization code, or this attempt's state/nonce pair, was already presented once. */
  | 'replayed_code'
  /** The token endpoint rejected the code with an OAuth error other than access_denied. */
  | 'token_exchange_failed'
  /** The IdP or its JWKS was unreachable or returned 5xx/429. Never treated as a verdict — retry, don't deny permanently. */
  | 'idp_unavailable'
  /** Signature, issuer, audience, algorithm or claim shape failed verification. */
  | 'token_invalid'
  /** `acr` is not orb-v3, or `amr` lacks `pop` — the assurance level itself was insufficient. */
  | 'assurance_mismatch'
  /** The attempt's own TTL elapsed before a callback arrived, or the ID token's `exp` had already passed by verification time. Maps 1:1 from `handleCallback`'s `{ expired: true }`. */
  | 'token_expired'
  /** `verified: true`, but `authTimeMs` is older than `STEPUP_FRESHNESS_WINDOW_MS` (or implausibly in the future) at decision time. */
  | 'stale_authentication'
  /** `verified: true` and fresh, but `HeldProposal.boundSub` was set and the verifying `sub` does not match it. */
  | 'sub_mismatch';

export type StepUpGateDecision =
  | { approved: true; proposalHash: Hash32; sub: string; authTimeMs: number }
  | { approved: false; proposalHash: Hash32; reason: StepUpDeniedReason; detail: string };

/** Every internal `handleCallback` denial reason this gate recognizes, mapped to a `StepUpDeniedReason`. Anything not listed here falls through to `token_invalid` rather than throwing, so an unrecognized-but-real denial still reads as "denied," not as a crash. */
const DENIAL_MAP: Record<string, StepUpDeniedReason> = {
  access_denied: 'access_denied',
  state_mismatch: 'state_mismatch',
  malformed_callback: 'state_mismatch',
  nonce_mismatch: 'nonce_mismatch',
  replayed_code: 'replayed_code',
  replayed_nonce: 'replayed_code',
  token_exchange_failed: 'token_exchange_failed',
  idp_unavailable: 'idp_unavailable',
  token_invalid: 'token_invalid',
  assurance_mismatch: 'assurance_mismatch',
  attempt_expired: 'token_expired',
  token_expired: 'token_expired',
};

function mapDeniedReason(raw: string): StepUpDeniedReason {
  return DENIAL_MAP[raw] ?? 'token_invalid';
}

/**
 * Pure freshness check. Returns why the proof is not fresh, or null. Exported separately
 * from `decideStepUp` so its boundary values (exactly at the window edge, negative age from
 * clock skew) are directly unit-testable without constructing a whole callback result.
 *
 *  - `authTimeMs > nowMs + clockSkewMs`: the proof claims to be from the future — reject
 *    outright rather than silently clamping it, per the seam's general "throw on
 *    out-of-domain input" discipline.
 *  - `nowMs - authTimeMs > windowMs`: the proof is older than the freshness window.
 *  - Exactly `nowMs - authTimeMs === windowMs` is ACCEPTED (the window is inclusive at its
 *    far edge) — this is the boundary `__tests__/stepup-gate.test.ts` pins.
 */
export function freshnessProblem(
  authTimeMs: number,
  nowMs: number,
  windowMs: number = STEPUP_FRESHNESS_WINDOW_MS,
  clockSkewMs: number = 30_000,
): string | null {
  if (authTimeMs > nowMs + clockSkewMs) {
    return `auth_time is ${authTimeMs - nowMs}ms in the future`;
  }
  if (nowMs - authTimeMs > windowMs) {
    return `World proof is ${nowMs - authTimeMs}ms old, past the ${windowMs}ms window`;
  }
  return null;
}

/**
 * The gate's decision, given a held proposal and an already-completed `handleCallback`
 * result. Does not touch the network or the store — `nowMs` is passed in explicitly so
 * boundary tests never depend on wall-clock time.
 */
export function decideStepUp(
  proposal: HeldProposal,
  callback: HandleCallbackResult,
  nowMs: number = Date.now(),
  windowMs: number = STEPUP_FRESHNESS_WINDOW_MS,
): StepUpGateDecision {
  const deny = (reason: StepUpDeniedReason, detail: string): StepUpGateDecision => ({
    approved: false,
    proposalHash: proposal.proposalHash,
    reason,
    detail,
  });

  if ('expired' in callback) {
    return deny('token_expired', 'The step-up attempt or its ID token expired before a decision could be made.');
  }
  if ('denied' in callback) {
    return deny(mapDeniedReason(callback.reason), `handleCallback denied: ${callback.reason}`);
  }
  // Only the `verified: true` variant is left.

  const stale = freshnessProblem(callback.authTimeMs, nowMs, windowMs);
  if (stale) return deny('stale_authentication', stale);

  if (proposal.boundSub !== undefined && proposal.boundSub !== callback.sub) {
    return deny('sub_mismatch', 'A different human completed this verification than the one this proposal was bound to.');
  }

  return { approved: true, proposalHash: proposal.proposalHash, sub: callback.sub, authTimeMs: callback.authTimeMs };
}
