/**
 * `bonded_verify_invoice_payment` — the one MCP tool this package exposes.
 *
 * This is the AP/BEC (Business Email Compromise) scenario from the plan this
 * package satisfies (plan build-order item 8): an autonomous AP agent is
 * about to pay a vendor invoice; the invoice, or a "we changed our bank
 * account" email, may have been spoofed by an attacker impersonating the
 * real vendor. This tool re-derives the facts the payment decision relies on
 * — independently, right before money moves — by calling the REAL `enforce()`
 * decision loop (`@bonded/enforcer`) against the REAL, disclosed vendor-master
 * fixture (`@bonded/issuer-oracle`'s `issuerOracleVendors`, see that
 * package's `vendor-fixture.ts` for the disclosure this fixture makes
 * honest), wired through the REAL dispatcher composition
 * (`@bonded/dispatcher`'s `createEnforceDeps`/`createResolvePremise`/
 * `canonicalHash`) — the exact same composition every other caller in this
 * repo (console, villain-corpus, once built) must use, per that package's own
 * doc comment, or `STALE_POLICY` trips spuriously. This tool owns no
 * enforcement logic of its own — only the policy shape below, and the three
 * `EnforceDeps` extras (`getCheckpoint`/`sumRecentSpend`/`logMismatch`) a
 * stateless, one-shot MCP tool call has to supply itself.
 *
 * Intercepta ('intercepta-risk') is NOT wired into this tool's registry.
 * Stated plainly, not silently omitted (per this task's own instructions):
 * `@bonded/intercepta-adapter`'s field functions take `(subjectAddress,
 * chain?)`, need a chain id, and require a live `INTERCEPTA_API_KEY` to
 * return anything real (CLAUDE.md rule 1 forbids mocking that response). This
 * tool has neither the chain identifier for `claimedPayoutAddress` nor a
 * guaranteed key at tool-call time, and wiring it in without either would
 * mean either fabricating a chain id (a guess) or crashing every call that
 * lacks a key. Screening the claimed payout address through Intercepta is a
 * real, valuable next step for this tool — just not one this pass includes.
 *
 * === Policy shape, decided and documented here (not guessed) ===
 *
 * Three premises, checked in this order (the ORDER of `proposal.premises`,
 * which `enforce()` iterates and returns on the FIRST mismatch):
 *
 *   1. `vendor.status` must be `'active'` — checked FIRST and with
 *      `holdOnMismatch` unset (hard refuse). A suspended vendor is refused
 *      outright regardless of whether the claimed payout address or amount
 *      happen to be correct; this is deliberate — see the "why a status
 *      premise" note below.
 *   2. `vendor.payoutAddress` must equal the claim, exactly (`op: 'eq'`, no
 *      `toleranceBps` — an address has no meaningful "close enough").
 *      `holdOnMismatch: true` — this is the actual BEC signal (a spoofed
 *      "we changed banks" claim), and per CLAUDE.md rule 4 / the plan's own
 *      framing, a mismatch here is routed to a human step-up review rather
 *      than an automatic hard kill, because a vendor changing its real bank
 *      details is a legitimate, non-fraudulent event this system must not
 *      punish identically to an actual spoof.
 *   3. `vendor.invoiceAmountUSD` must equal the claim within `toleranceBps:
 *      50` (0.5%) — covers benign rounding/FX drift on an invoice total, not
 *      a materially different dollar amount. `holdOnMismatch` unset (hard
 *      refuse): an amount mismatch beyond a rounding tolerance is a harder
 *      problem than an address change — there is no honest-vendor story for
 *      "the invoice total itself is wrong by more than half a percent" the
 *      way there is for "the vendor's bank changed" — so it is not routed to
 *      a step-up, it is refused outright, matching the plan's own framing
 *      ("an amount mismatch is a harder problem, not a 'maybe legitimate'
 *      one").
 *
 * Why a `vendor.status` premise at all, when the tool's own input schema has
 * no `claimedStatus` field: the plan's task brief explicitly asks this
 * package to "decide sensibly and document" whether an amount/address-only
 * policy needs one. It does — without it, `vnd-suspended-corp` with a
 * perfectly correct claimed address/amount would clear straight through,
 * even though the whole point of that fixture record is that ANY payment to
 * it should be refused. The agent's implicit claim for this premise is
 * hardcoded to `'active'` here (an agent attempting to pay an invoice is, by
 * the act of trying, implicitly asserting the vendor it's paying is in good
 * standing) rather than added as a fourth tool-input field — the tool caller
 * never has to assert something it has no way to know independently; the
 * whole point of this premise is that the ENFORCER, not the caller, is the
 * one checking it against the real vendor-master record.
 *
 * === Demo budget / irreversible-threshold values, chosen and documented ===
 *
 *   - `budget.max = "50000000000"` ($50,000/day) — comfortably above all
 *     three seeded vendor invoices ($1,250 / $8,450 / $4,200 — see
 *     `@bonded/issuer-oracle`'s `vendor-fixture.ts`), so none of this tool's
 *     demo scenarios trips `BUDGET_EXCEEDED`. A real deployment sizes this to
 *     the AP desk's actual daily payables volume.
 *   - `irreversibleAboveUSDC = "10000000000"` ($10,000) — above every seeded
 *     vendor's invoice amount, so this tool's three demo scenarios resolve
 *     purely on the premise checks above (status/address/amount), not on
 *     `enforce()`'s own step-5 irreversible-threshold hold. A real deployment
 *     sizes this independently, to whatever single-payment size warrants a
 *     step-up regardless of any vendor-truth mismatch.
 *
 * === `EnforceDeps` extras this one-shot tool call supplies ===
 *
 *   - `getCheckpoint`: this tool carries no Sui SDK / chain-checkpoint reader
 *     (deliberately — matching `@bonded/dispatcher`'s own zero-chain-
 *     dependency stance, and CLAUDE.md's rule against guessing an unconfirmed
 *     chain API). It returns the current unix-seconds timestamp as a
 *     deterministic, monotonic-enough stand-in. This is safe ONLY because
 *     `@bonded/issuer-oracle`'s field table — the only schema wired into this
 *     tool's registry — ignores the `at` argument entirely (confirmed:
 *     `@bonded/dispatcher`'s own `createResolvePremise` doc comment says no
 *     adapter in this repo pins its answer to a chain checkpoint today). The
 *     resulting `Verdict.blockChecked` is therefore NOT a real Sui checkpoint
 *     and must never be presented as one.
 *   - `sumRecentSpend`: this MCP tool call is stateless across invocations —
 *     there is no ledger behind it. It truthfully returns `0n` (no prior
 *     spend recorded THIS call), rather than fabricating a plausible-looking
 *     running total. A real deployment (e.g. `apps/console`'s
 *     `lib/enforce-deps.ts` composition) wires this to the actual spend
 *     ledger; this package does not have access to one.
 *   - `logMismatch`: recorded into a local array for the duration of one
 *     call, then surfaced in this tool's own structured output as
 *     `mismatches` — CLAUDE.md rule 5 ("every slash requires evidence
 *     attached to the call... never a bare claim") applies just as much to
 *     this read path: a HELD/REFUSED verdict is always returned with the
 *     claimed-vs-derived pair that caused it, never a bare outcome code.
 *   - `onchainPolicyHash`: there is no live on-chain registry lookup wired
 *     into this demo tool. Per this task's own instruction, it is computed
 *     via `@bonded/dispatcher`'s own `canonicalHash` against the EXACT SAME
 *     `PolicyArtifact` object passed to `enforce()` below — so it always
 *     matches and `enforce()` never trips `STALE_POLICY` spuriously. In a
 *     real deployment this would instead be a real read of the on-chain
 *     `bonded_registry`'s committed policy hash for this vendor/agent pair,
 *     and a genuine mismatch there would be exactly the case this tool
 *     cannot currently demonstrate.
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Address, Hash32, PolicyArtifact, Proposal, Verdict } from '@bonded/seam';
import { ReasonCode } from '@bonded/seam';
import { enforce } from '@bonded/enforcer';
import { canonicalHash, createEnforceDeps, type SchemaRegistry } from '@bonded/dispatcher';
import { issuerOracleVendors } from '@bonded/issuer-oracle';

/** See the file header for why each value is what it is. */
const BUDGET_MAX_USDC = '50000000000'; // $50,000/day
const IRREVERSIBLE_ABOVE_USDC = '10000000000'; // $10,000
/** 0.5% — benign rounding/FX drift tolerance on the invoice total, not a materially different amount. */
const INVOICE_AMOUNT_TOLERANCE_BPS = 50;

const PREMISE_ID_STATUS = 'vendor-status-active';
const PREMISE_ID_PAYOUT_ADDRESS = 'vendor-payout-address';
const PREMISE_ID_INVOICE_AMOUNT = 'vendor-invoice-amount';

/** The registry this tool wires into `@bonded/dispatcher` — see the file header re: Intercepta. */
const REGISTRY: SchemaRegistry = {
  'issuer-oracle-vendors': issuerOracleVendors,
};

/**
 * The zod RAW SHAPE (a plain object of per-field schemas, not a `z.object(...)`)
 * — this is what `McpServer#registerTool`'s `inputSchema` config actually
 * expects (confirmed by reading the installed SDK's own `server/mcp.d.ts`:
 * `registerTool<...InputArgs extends ... ZodRawShapeCompat ...>`, and
 * `ToolCallback<Args>`'s handler receives the PARSED, already-validated
 * shape as a plain object — not a zod schema instance).
 */
export const verifyInvoicePaymentInputShape = {
  vendorId: z.string().min(1, 'vendorId is required'),
  claimedPayoutAddress: z
    .string()
    .regex(/^0x[0-9a-fA-F]+$/, 'claimedPayoutAddress must be a 0x-hex address'),
  claimedInvoiceAmountUSD: z
    .string()
    .regex(
      /^[0-9]+$/,
      'claimedInvoiceAmountUSD must be a 6-decimal fixed-point base-unit integer string (e.g. "1250000000" === $1,250.00) — never a decimal, never a float',
    ),
  agent: z.string().regex(/^0x[0-9a-fA-F]+$/, 'agent must be a 0x-hex address-like identifier for the paying agent'),
};

/** `z.object(...)` of the shape above, for validating a call made outside the MCP SDK's own pipeline (e.g. this file's tests calling the handler directly). */
export const verifyInvoicePaymentInputSchema = z.object(verifyInvoicePaymentInputShape);

export type VerifyInvoicePaymentInput = z.infer<typeof verifyInvoicePaymentInputSchema>;

/** One mismatched/held premise's claimed-vs-derived evidence (CLAUDE.md rule 5). */
export interface PremiseDiff {
  premiseId: string;
  field: string;
  claimedValue: string;
  derivedValue: string;
}

/** `Verdict`, JSON-serializable (bigint fields turned into strings — JSON has no bigint). */
export interface SerializedVerdict {
  proposalHash: Hash32;
  policyHash: Hash32;
  outcome: 0 | 1 | 2;
  outcomeLabel: 'CLEARED' | 'REFUSED' | 'HELD_FOR_STEPUP';
  reasonCode: ReasonCode;
  reasonCodeLabel: string;
  blockChecked: string;
  logRef: Hash32;
}

export interface VerifyInvoicePaymentResult {
  verdict: SerializedVerdict;
  /** Every mismatched/held premise's claimed-vs-derived pair, never a bare claim. Empty when `verdict.outcome === 0` (CLEARED). */
  mismatches: PremiseDiff[];
  /** The exact `PolicyArtifact` this call constructed and checked the proposal against — for audit/display, not re-consumed by anything. */
  policy: PolicyArtifact;
}

const OUTCOME_LABEL: Record<0 | 1 | 2, SerializedVerdict['outcomeLabel']> = {
  0: 'CLEARED',
  1: 'REFUSED',
  2: 'HELD_FOR_STEPUP',
};

function reasonCodeLabel(code: ReasonCode): string {
  return ReasonCode[code] ?? `UNKNOWN(${code})`;
}

/**
 * Builds this call's `PolicyArtifact`. `Premise.value` is set to the same
 * value the proposal claims (see the file header: `evaluatePremise` in
 * `@bonded/enforcer`'s `tolerance.ts` compares the PROPOSAL's claimed value
 * against the oracle-DERIVED truth — it never reads `Premise.value` at all;
 * that field exists on the seam type for audit/on-chain-commitment display,
 * confirmed by reading `tolerance.ts` directly rather than guessed). Mirroring
 * the claim into `value` here keeps this ad-hoc, per-call policy's audit
 * trail honest about what was actually being asserted.
 */
function buildPolicy(vendorId: string, claimedPayoutAddress: string, claimedInvoiceAmountUSD: string): PolicyArtifact {
  return {
    version: 1,
    budget: { asset: 'USDC', period: 'daily', max: BUDGET_MAX_USDC },
    premises: [
      {
        id: PREMISE_ID_STATUS,
        schema: 'issuer-oracle-vendors',
        field: 'vendor.status',
        op: 'eq',
        value: 'active',
        args: [vendorId],
      },
      {
        id: PREMISE_ID_PAYOUT_ADDRESS,
        schema: 'issuer-oracle-vendors',
        field: 'vendor.payoutAddress',
        op: 'eq',
        value: claimedPayoutAddress,
        holdOnMismatch: true,
        args: [vendorId],
      },
      {
        id: PREMISE_ID_INVOICE_AMOUNT,
        schema: 'issuer-oracle-vendors',
        field: 'vendor.invoiceAmountUSD',
        op: 'eq',
        value: claimedInvoiceAmountUSD,
        toleranceBps: INVOICE_AMOUNT_TOLERANCE_BPS,
        args: [vendorId],
      },
    ],
    forbid: [],
    irreversibleAboveUSDC: IRREVERSIBLE_ABOVE_USDC,
  };
}

/**
 * `Proposal.id`'s own doc comment in `@bonded/seam` says "keccak256 of the
 * canonical JSON below, minus this field" — this package carries no
 * keccak/chain-crypto dependency (deliberately, matching `@bonded/dispatcher`'s
 * own zero-chain-dependency stance for `canonicalHash`/`computeLogRef`), and
 * nothing downstream of this demo tool verifies `proposal.id` against a real
 * on-chain keccak commitment. sha256 (Node's built-in `node:crypto`, already
 * this repo's choice in `@bonded/dispatcher`) is used instead — stated
 * plainly here, not silently substituted.
 */
function computeProposalId(withoutId: Omit<Proposal, 'id'>): Hash32 {
  return `0x${createHash('sha256').update(JSON.stringify(withoutId)).digest('hex')}` as Hash32;
}

function buildProposal(input: VerifyInvoicePaymentInput, policy: PolicyArtifact): Proposal {
  const withoutId: Omit<Proposal, 'id'> = {
    agent: input.agent as Address,
    action: {
      kind: 'pay_vendor_invoice',
      target: input.claimedPayoutAddress as Address,
      calldata: '0x',
      valueUSDC: input.claimedInvoiceAmountUSD,
    },
    premises: [
      // The agent's implicit claim that the vendor it's paying is in good
      // standing — see the file header's "why a vendor.status premise" note.
      { premiseId: PREMISE_ID_STATUS, claimedValue: 'active' },
      { premiseId: PREMISE_ID_PAYOUT_ADDRESS, claimedValue: input.claimedPayoutAddress },
      { premiseId: PREMISE_ID_INVOICE_AMOUNT, claimedValue: input.claimedInvoiceAmountUSD },
    ],
    createdAt: Math.floor(Date.now() / 1000),
  };
  return { id: computeProposalId(withoutId), ...withoutId };
}

/**
 * The handler itself — called directly by this package's own tests, and
 * wired into the MCP tool registration in `server.ts`. Builds the real
 * `PolicyArtifact`/`Proposal`, wires the real `@bonded/dispatcher` deps
 * against `vendorId` (via each premise's `args`), calls the real `enforce()`,
 * and returns the `Verdict` plus every mismatched/held premise's evidence.
 */
export async function verifyInvoicePayment(rawInput: VerifyInvoicePaymentInput): Promise<VerifyInvoicePaymentResult> {
  const input = verifyInvoicePaymentInputSchema.parse(rawInput);

  const policy = buildPolicy(input.vendorId, input.claimedPayoutAddress, input.claimedInvoiceAmountUSD);
  const onchainPolicyHash = canonicalHash(policy);
  const proposal = buildProposal(input, policy);

  const mismatches: PremiseDiff[] = [];
  const deps = createEnforceDeps(REGISTRY, {
    getCheckpoint: async () => BigInt(Math.floor(Date.now() / 1000)),
    sumRecentSpend: async () => 0n,
    logMismatch: async (_proposalId, premiseId, claimedValue, derivedValue) => {
      const def = policy.premises.find((p) => p.id === premiseId);
      mismatches.push({ premiseId, field: def?.field ?? '(unknown)', claimedValue, derivedValue });
    },
  });

  const verdict: Verdict = await enforce(proposal, policy, onchainPolicyHash, deps);

  return {
    verdict: {
      proposalHash: verdict.proposalHash,
      policyHash: verdict.policyHash,
      outcome: verdict.outcome,
      outcomeLabel: OUTCOME_LABEL[verdict.outcome],
      reasonCode: verdict.reasonCode,
      reasonCodeLabel: reasonCodeLabel(verdict.reasonCode),
      blockChecked: verdict.blockChecked.toString(),
      logRef: verdict.logRef,
    },
    mismatches,
    policy,
  };
}
