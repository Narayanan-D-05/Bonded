/**
 * Verdict → real Sui payout.
 *
 *  - `proposePayment(invoiceId)`: the AP agent proposing a payment
 *    (`POST /api/enforce`). Runs the real `enforce()`; on CLEARED it settles
 *    through `settleCleared`, once per proposal (`SettlementLedger`). No human
 *    button is involved.
 *  - `completeStepUp(proposalHash, callback)`: the World step-up callback, the
 *    one human moment (CLAUDE.md rule 4). The approval is certified by
 *    `approveStepUpForSettlement`, which runs the real `decideStepUp` over the
 *    `handleCallback` result. Then:
 *      · IRREVERSIBLE_UNCONFIRMED → `settleWithStepUp` to the on-file address.
 *      · PREMISE_HELD_FOR_REVIEW (payout mismatch) → first the VENDOR-SIDE gate:
 *        the approval only proceeds if an IDKit-verified vendor bank-change
 *        request (`vendor-bank-change.ts`) matches the invoice's claimed new
 *        payout address and EVM identity; otherwise it is denied
 *        `no_verified_vendor_request` and nothing is written or paid. The
 *        approval does NOT pay the claimed address. It writes the confirmed new address into the
 *        vendor master (fixture change log or Xero), re-runs `enforce()`, and
 *        the now-matching claim CLEARS and settles to the updated truth.
 *        Settlement always pays `deriveVendorRecipient`'s re-derived truth.
 *
 * Every settlement goes through the ledger, so a proposal is paid at most once.
 */

import type { Hash32 } from '@bonded/seam';
import { ReasonCode } from '@bonded/seam';
import type { ResolveFailure } from '@bonded/dispatcher';
import {
  approveStepUpForSettlement,
  deriveVendorRecipient,
  isCertifiedStepUpApproval,
  type CertifiedStepUpApproval,
  type SettlementResult,
} from '@bonded/sui-settlement';
import { fromHeldVerdict, type HandleCallbackResult } from '@bonded/world-agents';
import {
  defaultConsoleContext,
  findInvoiceIdByProposalHash,
  runEnforceForInvoice,
  serializeVerdict,
  type ConsoleContext,
  type DemoInvoiceId,
  type EnforceRunResult,
  type MismatchRecord,
  type PremiseDiffRow,
  type SerializedVerdict,
} from './enforce-deps';
import type { LedgerEntry, RunOnceResult, SettledRecord } from './settlement-ledger';
import { checkVendorRequestGate, type VerifiedVendorBankChangeRequest } from './vendor-bank-change';

export type SettlementView =
  | { status: 'settled'; alreadySettled: boolean; digest: string; explorerUrl: string; recipient: string; valueUsdc: string; viaStepup: boolean; settledAtMs: number }
  | { status: 'in-progress' }
  | { status: 'unknown'; error: string }
  | { status: 'failed'; error: string }
  | { status: 'not-settled'; reason: string };

export interface EnforceApiResponse {
  invoiceId: DemoInvoiceId;
  vendorId: string;
  legalName: string;
  scenarioLabel: string;
  needs: string[];
  onchainPolicyHash: Hash32;
  verdict: SerializedVerdict;
  premises: PremiseDiffRow[];
  mismatches: MismatchRecord[];
  screeningErrors: ResolveFailure[];
  vaultSpentUsdc: string | null;
  settlement: SettlementView;
}

function toRecord(result: SettlementResult, viaStepup: boolean, nowMs: number): SettledRecord {
  return {
    digest: result.digest,
    explorerUrl: result.explorerUrl,
    vendorId: result.vendorId,
    recipient: result.recipient,
    valueUsdc: result.valueUsdc.toString(),
    viaStepup,
    settledAtMs: nowMs,
  };
}

export function ledgerView(entry: LedgerEntry, alreadySettled: boolean): SettlementView {
  if (entry.status === 'settled') {
    return {
      status: 'settled',
      alreadySettled,
      digest: entry.digest,
      explorerUrl: entry.explorerUrl,
      recipient: entry.recipient,
      valueUsdc: entry.valueUsdc,
      viaStepup: entry.viaStepup,
      settledAtMs: entry.settledAtMs,
    };
  }
  if (entry.status === 'pending') return { status: 'in-progress' };
  return { status: 'unknown', error: entry.error };
}

function runView(r: RunOnceResult): SettlementView {
  return ledgerView(r.entry, r.kind !== 'settled-now');
}

function apiResponse(run: EnforceRunResult, settlement: SettlementView): EnforceApiResponse {
  return {
    invoiceId: run.invoice.invoiceId,
    vendorId: run.invoice.vendorId,
    legalName: run.invoice.legalName,
    scenarioLabel: run.invoice.scenarioLabel,
    needs: run.invoice.needs,
    onchainPolicyHash: run.onchainPolicyHash,
    verdict: serializeVerdict(run.verdict),
    premises: run.premises,
    mismatches: run.mismatches,
    screeningErrors: run.screeningErrors,
    vaultSpentUsdc: run.vaultSpentUsdc === null ? null : run.vaultSpentUsdc.toString(),
    settlement,
  };
}

async function settleClearedOnce(run: EnforceRunResult, ctx: ConsoleContext): Promise<SettlementView> {
  const { invoice, verdict } = run;
  try {
    const r = await ctx.ledger.runOnce(verdict.proposalHash, invoice.invoiceId, async () => {
      const recipient = await deriveVendorRecipient(invoice.vendorId, ctx.vendorSource);
      const result = await ctx.chain.settleCleared({ verdict, valueUsdc: BigInt(invoice.proposal.action.valueUSDC), recipient });
      return toRecord(result, false, Date.now());
    });
    return runView(r);
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  }
}

/** `POST /api/enforce`: the AP agent proposes paying `invoiceId`. CLEARED settles (once). */
export async function proposePayment(invoiceId: DemoInvoiceId, ctx: ConsoleContext = defaultConsoleContext()): Promise<EnforceApiResponse> {
  const run = await runEnforceForInvoice(invoiceId, ctx);
  if (run.verdict.outcome === 0) return apiResponse(run, await settleClearedOnce(run, ctx));
  // Not CLEARED now: still show a payment already made for this proposal (e.g. via step-up).
  const prior = await ctx.ledger.get(run.verdict.proposalHash);
  if (prior !== null) return apiResponse(run, ledgerView(prior, true));
  const reason =
    run.verdict.outcome === 2 ? 'Held for a World ID step-up; nothing is paid until a verified human approves.' : 'Refused; nothing is paid.';
  return apiResponse(run, { status: 'not-settled', reason });
}

export type StepUpOutcome =
  | { kind: 'unknown-proposal' }
  | { kind: 'not-held'; verdict: SerializedVerdict; settlement: SettlementView | null }
  | { kind: 'denied'; reason: string; detail: string }
  | { kind: 'refused'; detail: string }
  | {
      kind: 'approved';
      sub: string;
      holdReason: 'IRREVERSIBLE_UNCONFIRMED' | 'PREMISE_HELD_FOR_REVIEW';
      vendorMasterChange: { previousPayoutAddress: string; newPayoutAddress: string; appliedTo: string } | null;
      /** PREMISE_HELD_FOR_REVIEW only: the IDKit-verified vendor request that authorised the change. */
      vendorRequest: VerifiedVendorBankChangeRequest | null;
      reenforcedVerdict: SerializedVerdict | null;
      settlement: SettlementView;
    };

/**
 * The World step-up callback, after `handleCallback` returned. `nowMs` is the decision time
 * (the freshness window is checked against it here and again at settle time).
 */
export async function completeStepUp(
  proposalHash: Hash32,
  callback: HandleCallbackResult,
  ctx: ConsoleContext = defaultConsoleContext(),
  nowMs: number = Date.now(),
): Promise<StepUpOutcome> {
  const invoiceId = findInvoiceIdByProposalHash(proposalHash);
  if (invoiceId === null) return { kind: 'unknown-proposal' };

  // Never trust the attempt: re-derive the verdict now.
  const run = await runEnforceForInvoice(invoiceId, ctx);
  if (run.verdict.outcome !== 2) {
    const prior = await ctx.ledger.get(run.verdict.proposalHash);
    return { kind: 'not-held', verdict: serializeVerdict(run.verdict), settlement: prior === null ? null : ledgerView(prior, true) };
  }
  const held = fromHeldVerdict(run.verdict);
  const decision = approveStepUpForSettlement(held, callback, nowMs);
  if (!isCertifiedStepUpApproval(decision)) {
    const d = decision as { reason: string; detail: string };
    return { kind: 'denied', reason: d.reason, detail: d.detail };
  }

  if (run.verdict.reasonCode === ReasonCode.IRREVERSIBLE_UNCONFIRMED) {
    const settlement = await settleWithStepUpOnce(run, decision, ctx);
    return {
      kind: 'approved',
      sub: decision.sub,
      holdReason: 'IRREVERSIBLE_UNCONFIRMED',
      vendorMasterChange: null,
      vendorRequest: null,
      reenforcedVerdict: null,
      settlement,
    };
  }

  // PREMISE_HELD_FOR_REVIEW: only a payout-address hold is a bank change a human can confirm.
  const held_on = run.mismatches[run.mismatches.length - 1];
  const payoutDef = run.invoice.policy.premises.find((p) => p.id === held_on?.premiseId);
  if (held_on === undefined || payoutDef?.field !== 'vendor.payoutAddress') {
    return { kind: 'refused', detail: `The hold is on ${held_on?.premiseId ?? 'no recorded premise'}, not a payout-address change; nothing to confirm.` };
  }

  // The vendor side: the change must have been filed by the vendor and verified with IDKit, for
  // exactly this payout address and EVM identity. Both claims are re-derived server-side from the
  // proposal, never client-supplied. Checked before anything is written.
  const gate = await vendorRequestGate(run, held_on.claimedValue, ctx);
  if (!gate.ok) return { kind: 'denied', reason: gate.reason, detail: gate.detail };
  const change = await ctx.writeBankChange({
    vendorId: run.invoice.vendorId,
    previousPayoutAddress: held_on.derivedValue as `0x${string}`,
    // The invoice's claim, re-derived server-side from the proposal, never a client-supplied value.
    newPayoutAddress: held_on.claimedValue as `0x${string}`,
    approvedBy: { worldSub: decision.sub, authTimeMs: decision.authTimeMs },
    proposalHash: run.verdict.proposalHash,
  });
  const vendorMasterChange = {
    previousPayoutAddress: change.change.previousPayoutAddress,
    newPayoutAddress: change.change.newPayoutAddress,
    appliedTo: change.change.appliedTo,
  };

  const rerun = await runEnforceForInvoice(invoiceId, ctx);
  const reenforcedVerdict = serializeVerdict(rerun.verdict);
  let settlement: SettlementView;
  if (rerun.verdict.outcome === 0) {
    settlement = await settleClearedOnce(rerun, ctx);
  } else if (rerun.verdict.outcome === 2 && rerun.verdict.reasonCode === ReasonCode.IRREVERSIBLE_UNCONFIRMED) {
    // Same proposal, same verified human, still fresh: the one approval also covers the size hold.
    settlement = await settleWithStepUpOnce(rerun, decision, ctx);
  } else {
    settlement = { status: 'not-settled', reason: `Re-enforced after the vendor-master update: ${reenforcedVerdict.outcomeLabel} / ${reenforcedVerdict.reasonCodeLabel}.` };
  }
  return {
    kind: 'approved',
    sub: decision.sub,
    holdReason: 'PREMISE_HELD_FOR_REVIEW',
    vendorMasterChange,
    vendorRequest: gate.request,
    reenforcedVerdict,
    settlement,
  };
}

/** The claimed payee EVM identity, from the proposal's own `vendor.evmAddress` premise claim. */
export function claimedEvmIdentity(run: Pick<EnforceRunResult, 'invoice'>): string | null {
  const { policy, proposal } = run.invoice;
  for (const claim of proposal.premises) {
    const def = policy.premises.find((p) => p.id === claim.premiseId);
    if (def?.field === 'vendor.evmAddress') return claim.claimedValue;
  }
  return null;
}

async function vendorRequestGate(
  run: EnforceRunResult,
  claimedPayoutAddress: string,
  ctx: ConsoleContext,
): Promise<{ ok: true; request: VerifiedVendorBankChangeRequest } | { ok: false; reason: string; detail: string }> {
  const vendorId = run.invoice.vendorId;
  const evm = claimedEvmIdentity(run);
  if (evm === null) {
    return { ok: false, reason: 'no_verified_vendor_request', detail: `The invoice claims no EVM identity for ${vendorId}, so no vendor request can match it.` };
  }
  const truth = await ctx.vendorSource(vendorId);
  if (truth === null) return { ok: false, reason: 'no_verified_vendor_request', detail: `${vendorId} is not in the vendor master.` };
  return checkVendorRequestGate(await ctx.vendorRequests.list(), {
    vendorId,
    claimedPayoutAddress,
    claimedEvmAddress: evm,
    payoutAddressLastChangedAt: truth.payoutAddressLastChangedAt,
  });
}

async function settleWithStepUpOnce(run: EnforceRunResult, decision: CertifiedStepUpApproval, ctx: ConsoleContext): Promise<SettlementView> {
  const { invoice, verdict } = run;
  try {
    const r = await ctx.ledger.runOnce(verdict.proposalHash, invoice.invoiceId, async () => {
      const recipient = await deriveVendorRecipient(invoice.vendorId, ctx.vendorSource);
      const result = await ctx.chain.settleWithStepUp({
        verdict,
        valueUsdc: BigInt(invoice.proposal.action.valueUSDC),
        recipient,
        stepUpDecision: decision,
      });
      return toRecord(result, true, Date.now());
    });
    return runView(r);
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  }
}
