/**
 * Step-up gating for `settleWithStepUp`.
 *
 * A HELD_FOR_STEPUP verdict may only settle when a human freshly proved
 * presence through World for that exact proposal. The on-chain
 * `StepUpApproval` object is that proof in Move (see `bonded_vault.move`).
 * Minting one without a real World verification would fake the human step,
 * so this module makes sure `mint_stepup_approval` is never reached without
 * one.
 *
 * `@bonded/world-agents`' `decideStepUp` returns a plain object, and the same
 * shape can be typed by hand. So a raw `StepUpGateDecision` isn't accepted
 * here. Callers go through `approveStepUpForSettlement`, which:
 *   1. calls the real `decideStepUp` itself (no second implementation of the
 *      policy lives here), and
 *   2. only when that returned `{ approved: true }`, freezes the result,
 *      brands it with a module-private `unique symbol` (so a hand-built literal
 *      doesn't typecheck as `CertifiedStepUpApproval`), and records it in a
 *      module-private `WeakSet` (so an `as any` cast or a spread copy fails
 *      at runtime).
 *
 * `assertStepUpAuthorized` then re-checks, at settle time, that the approval
 * is certified, is for this verdict's proposal, that the verdict really is
 * HELD_FOR_STEPUP, and that the World proof is still inside the freshness
 * window. An approval that was fresh when issued but has since aged out is
 * refused.
 */

import type { Verdict } from '@bonded/seam';
import {
  decideStepUp,
  freshnessProblem,
  STEPUP_FRESHNESS_WINDOW_MS,
  type HandleCallbackResult,
  type HeldProposal,
  type StepUpGateDecision,
} from '@bonded/world-agents';

declare const certifiedStepUpBrand: unique symbol;

type ApprovedDecision = Extract<StepUpGateDecision, { approved: true }>;
type DeniedDecision = Extract<StepUpGateDecision, { approved: false }>;

/** An `{approved: true}` decision that came out of the real `decideStepUp`, via `approveStepUpForSettlement`. */
export type CertifiedStepUpApproval = Readonly<ApprovedDecision> & { readonly [certifiedStepUpBrand]: true };

export class StepUpRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StepUpRefusedError';
  }
}

const certified = new WeakSet<object>();

/**
 * Runs the real `decideStepUp(proposal, callback, nowMs)` from
 * `@bonded/world-agents`. On approval, returns a certified approval that
 * `settleWithStepUp` will accept. On denial, returns the denied decision
 * unchanged, which `settleWithStepUp` will refuse.
 */
export function approveStepUpForSettlement(
  proposal: HeldProposal,
  callback: HandleCallbackResult,
  nowMs: number = Date.now(),
): CertifiedStepUpApproval | DeniedDecision {
  const decision = decideStepUp(proposal, callback, nowMs);
  if (!decision.approved) {
    return decision;
  }
  const approval = Object.freeze({ ...decision }) as CertifiedStepUpApproval;
  certified.add(approval);
  return approval;
}

export function isCertifiedStepUpApproval(value: unknown): value is CertifiedStepUpApproval {
  return typeof value === 'object' && value !== null && certified.has(value);
}

/**
 * The runtime gate. Throws `StepUpRefusedError` unless every condition holds.
 * `settleWithStepUp` calls this before it loads config or touches the CLI,
 * so a refusal never reaches the chain.
 */
export function assertStepUpAuthorized(
  verdict: Verdict,
  stepUpDecision: unknown,
  nowMs: number = Date.now(),
): asserts stepUpDecision is CertifiedStepUpApproval {
  if (verdict.outcome !== 2) {
    throw new StepUpRefusedError(`settleWithStepUp needs a HELD_FOR_STEPUP verdict (outcome 2); got outcome ${verdict.outcome}.`);
  }
  if (typeof stepUpDecision !== 'object' || stepUpDecision === null) {
    throw new StepUpRefusedError('settleWithStepUp needs a step-up decision; got none.');
  }
  const d = stepUpDecision as { approved?: unknown; reason?: unknown };
  if (d.approved !== true) {
    const why = typeof d.reason === 'string' ? ` (${d.reason})` : '';
    throw new StepUpRefusedError(`World step-up was not approved${why}; refusing to settle a held verdict.`);
  }
  if (!isCertifiedStepUpApproval(stepUpDecision)) {
    throw new StepUpRefusedError(
      'Step-up decision was not produced by approveStepUpForSettlement() (i.e. by the real @bonded/world-agents ' +
        'decideStepUp). A hand-built {approved: true} object is not a World verification; refusing to mint a StepUpApproval.',
    );
  }
  if (stepUpDecision.proposalHash.toLowerCase() !== verdict.proposalHash.toLowerCase()) {
    throw new StepUpRefusedError(
      `Step-up approval is for proposal ${stepUpDecision.proposalHash}, but the verdict is for ${verdict.proposalHash}; refusing.`,
    );
  }
  const stale = freshnessProblem(stepUpDecision.authTimeMs, nowMs, STEPUP_FRESHNESS_WINDOW_MS);
  if (stale !== null) {
    throw new StepUpRefusedError(`Step-up approval is no longer fresh at settle time: ${stale}.`);
  }
}
