/**
 * apps/console's ONE composition point for `@bonded/dispatcher`'s `createEnforceDeps` —
 * plan build-order item 7 (`BONDED_HOSTAGE_PROTOCOL_PRD_ALIGNED.md`-successor migration plan,
 * `staged-scribbling-clock.md` item 7). Every route in this app that needs a real `EnforceDeps`
 * or a real demo `Proposal`/`PolicyArtifact` pair imports it from here — never re-derives its
 * own registry or policy shape, for the same reason `@bonded/dispatcher`'s own `canonicalHash`
 * doc comment gives: two "reasonable" reimplementations diverge silently.
 *
 * === What this is, and what it explicitly is NOT (mirrors `packages/mcp-server`'s own
 *     documented caveats in `verify-invoice-payment.ts` almost verbatim) ===
 *
 *  - `getCheckpoint`: NOT a real Sui checkpoint reader. Returns the current unix-seconds
 *    timestamp as a monotonic-enough stand-in. This is safe ONLY because the one schema wired
 *    into `registry` below (`issuer-oracle-vendors`) ignores the `at` argument entirely —
 *    confirmed by reading `@bonded/dispatcher`'s own `createResolvePremise` doc comment, not
 *    guessed. `Verdict.blockChecked` produced through this composition is therefore NOT a real
 *    Sui checkpoint and must never be presented as one anywhere in this app's UI.
 *  - `sumRecentSpend`: NOT a persistent ledger. Always resolves `0n` — no prior spend is ever
 *    recorded across requests. A real deployment wires this to an actual spend ledger.
 *  - `logMismatch`: recorded into a caller-supplied sink array for the lifetime of one request,
 *    then surfaced verbatim in the API response. CLAUDE.md rule 5 ("every slash requires
 *    evidence attached to the call... never a bare claim") applies to this read path too.
 *
 * === The three demo invoices ===
 *
 * `buildDemoInvoice`/`listDemoInvoices` mirror `packages/villain-corpus/harness/run.ts`'s
 * `buildScenario1`/`buildScenario2`/`buildScenario3` field-for-field (same premise ids, same
 * policy shapes, same proposal ids/timestamps, same vendor ids) rather than inventing new
 * scenarios — apps/console does NOT depend on `@bonded/villain-corpus` (not in this app's
 * approved dependency list), so the shapes are mirrored here, not imported. The one exception
 * is the globex scenario's claimed fraudulent payout address: `packages/villain-corpus/harness/
 * naive-ap-agent.ts` reads it out of `site/spoofed-invoice.html`'s
 * `#fraudulent-payout-address[data-address]` attribute at runtime; that HTML file was read
 * directly (read-only) to copy the literal value below, so this app demonstrates the identical
 * fraudulent address villain-corpus's own harness proves against, without importing that
 * package or its filesystem-reading parser.
 */

import type { Address, Hash32, PolicyArtifact, Proposal, Verdict } from '@bonded/seam';
import { ReasonCode } from '@bonded/seam';
import { enforce, type EnforceDeps } from '@bonded/enforcer';
import { canonicalHash, createEnforceDeps, createResolvePremise, type SchemaRegistry } from '@bonded/dispatcher';
import { fetchVendorTruth, issuerOracleVendors } from '@bonded/issuer-oracle';
import { WORLD_ENV } from '@bonded/world-agents';

// ─── Registry / EnforceDeps composition ────────────────────────────────────

/** The one schema this app's demo wires in. See the file header re: Intercepta being deliberately absent here too (same reasoning `packages/mcp-server` documents: no chain id for the claimed address, no guaranteed live key). `@bonded/intercepta-adapter` is a declared dependency of this app for a later pass, not imported by this file. */
export const registry: SchemaRegistry = {
  'issuer-oracle-vendors': issuerOracleVendors,
};

export interface MismatchRecord {
  proposalId: Hash32;
  premiseId: string;
  claimedValue: string;
  derivedValue: string;
}

/** Builds a real, non-mocked `EnforceDeps`. See the file header for what each extra is and is not. */
export function buildConsoleEnforceDeps(mismatchSink: MismatchRecord[] = []): EnforceDeps {
  return createEnforceDeps(registry, {
    getCheckpoint: async () => BigInt(Math.floor(Date.now() / 1000)),
    sumRecentSpend: async () => 0n,
    logMismatch: async (proposalId, premiseId, claimedValue, derivedValue) => {
      mismatchSink.push({ proposalId, premiseId, claimedValue, derivedValue });
    },
  });
}

// ─── Demo invoices — mirrors packages/villain-corpus/harness/run.ts ────────

const NAIVE_AP_AGENT_ADDRESS = `0x${'aa'.repeat(20)}` as Address;
const AP_VAULT_TARGET_ADDRESS = `0x${'bb'.repeat(20)}` as Address;

/**
 * Mirrors `packages/villain-corpus/site/spoofed-invoice.html`'s
 * `#fraudulent-payout-address[data-address]` literally (copied by reading that file directly;
 * see the file header). Not read from disk here — apps/console does not depend on
 * `@bonded/villain-corpus`.
 */
const FRAUDULENT_GLOBEX_PAYOUT_ADDRESS =
  '0xe218026a7210d04d19e4cc677f1c459c5ff353df6915b44e085397fdbdb89187' as Address;

export const DEMO_VENDOR_IDS = ['vnd-globex-freight', 'vnd-suspended-corp', 'vnd-acme-supplies'] as const;
export type DemoVendorId = (typeof DEMO_VENDOR_IDS)[number];

export function isDemoVendorId(value: string): value is DemoVendorId {
  return (DEMO_VENDOR_IDS as readonly string[]).includes(value);
}

export interface DemoInvoice {
  vendorId: DemoVendorId;
  legalName: string;
  /** Human-readable one-liner shown on the inbox/detail pages, not consumed by `enforce()`. */
  scenarioLabel: string;
  claimedPayoutAddress: Address;
  claimedInvoiceAmountUSD: string;
  proposal: Proposal;
  policy: PolicyArtifact;
}

/**
 * Builds one demo invoice's real `Proposal`/`PolicyArtifact` pair, keyed directly by the same
 * seeded vendor id `@bonded/issuer-oracle`'s `vendor-fixture.ts` and villain-corpus's harness
 * both use. Throws if the id is unknown to the real fixture — this app has no invoices beyond
 * these three seeded scenarios (disclosed scope limit, matching the plan's "no policy compiler"
 * note).
 */
export async function buildDemoInvoice(vendorId: DemoVendorId): Promise<DemoInvoice> {
  const truth = await fetchVendorTruth(vendorId);
  if (truth === null) {
    throw new Error(`Demo vendor ${vendorId} is missing from the real issuer-oracle fixture.`);
  }

  switch (vendorId) {
    case 'vnd-globex-freight': {
      // Mirrors buildScenario1: the naive AP agent's proposal claims the FRAUDULENT payout
      // address; the payout-address premise holds for step-up on mismatch instead of hard-
      // refusing, because a vendor changing its real bank details is itself a legitimate event.
      const policy: PolicyArtifact = {
        version: 1,
        budget: { asset: 'USDC', period: 'daily', max: '100000000000' },
        premises: [
          {
            id: 'p-vendor-payout',
            schema: 'issuer-oracle-vendors',
            field: 'vendor.payoutAddress',
            op: 'eq',
            value: truth.payoutAddress,
            args: [vendorId],
            holdOnMismatch: true,
          },
        ],
        forbid: [],
        irreversibleAboveUSDC: '50000000000',
      };
      const proposal: Proposal = {
        id: `0x${'11'.repeat(32)}` as Hash32,
        agent: NAIVE_AP_AGENT_ADDRESS,
        action: {
          kind: 'transfer',
          target: AP_VAULT_TARGET_ADDRESS,
          calldata: '0x',
          valueUSDC: truth.invoiceAmountUSD,
        },
        premises: [{ premiseId: 'p-vendor-payout', claimedValue: FRAUDULENT_GLOBEX_PAYOUT_ADDRESS }],
        createdAt: 1_790_200_000,
      };
      return {
        vendorId,
        legalName: truth.legalName,
        scenarioLabel: 'Vendor claims a new (fraudulent) payout address — held for human step-up review.',
        claimedPayoutAddress: FRAUDULENT_GLOBEX_PAYOUT_ADDRESS,
        claimedInvoiceAmountUSD: truth.invoiceAmountUSD,
        proposal,
        policy,
      };
    }
    case 'vnd-suspended-corp': {
      // Mirrors buildScenario2: a plain (non-hold) vendor.status premise. Hard refuse.
      const policy: PolicyArtifact = {
        version: 1,
        budget: { asset: 'USDC', period: 'daily', max: '100000000000' },
        premises: [
          {
            id: 'p-vendor-status',
            schema: 'issuer-oracle-vendors',
            field: 'vendor.status',
            op: 'eq',
            value: 'active',
            args: [vendorId],
          },
        ],
        forbid: [],
        irreversibleAboveUSDC: '50000000000',
      };
      const proposal: Proposal = {
        id: `0x${'22'.repeat(32)}` as Hash32,
        agent: NAIVE_AP_AGENT_ADDRESS,
        action: {
          kind: 'transfer',
          target: AP_VAULT_TARGET_ADDRESS,
          calldata: '0x',
          valueUSDC: truth.invoiceAmountUSD,
        },
        premises: [{ premiseId: 'p-vendor-status', claimedValue: 'active' }],
        createdAt: 1_790_200_100,
      };
      return {
        vendorId,
        legalName: truth.legalName,
        scenarioLabel: 'Vendor is claimed active but is suspended on file — hard refused.',
        claimedPayoutAddress: truth.payoutAddress,
        claimedInvoiceAmountUSD: truth.invoiceAmountUSD,
        proposal,
        policy,
      };
    }
    case 'vnd-acme-supplies': {
      // Mirrors buildScenario3: a correct, matching claim on both premises. Clears.
      const policy: PolicyArtifact = {
        version: 1,
        budget: { asset: 'USDC', period: 'daily', max: '100000000000' },
        premises: [
          {
            id: 'p-vendor-payout',
            schema: 'issuer-oracle-vendors',
            field: 'vendor.payoutAddress',
            op: 'eq',
            value: truth.payoutAddress,
            args: [vendorId],
          },
          {
            id: 'p-vendor-status',
            schema: 'issuer-oracle-vendors',
            field: 'vendor.status',
            op: 'eq',
            value: 'active',
            args: [vendorId],
          },
        ],
        forbid: [],
        irreversibleAboveUSDC: '50000000000',
      };
      const proposal: Proposal = {
        id: `0x${'33'.repeat(32)}` as Hash32,
        agent: NAIVE_AP_AGENT_ADDRESS,
        action: {
          kind: 'transfer',
          target: AP_VAULT_TARGET_ADDRESS,
          calldata: '0x',
          valueUSDC: truth.invoiceAmountUSD,
        },
        premises: [
          { premiseId: 'p-vendor-payout', claimedValue: truth.payoutAddress },
          { premiseId: 'p-vendor-status', claimedValue: truth.status },
        ],
        createdAt: 1_790_200_200,
      };
      return {
        vendorId,
        legalName: truth.legalName,
        scenarioLabel: 'Correct, matching claim — clears straight through.',
        claimedPayoutAddress: truth.payoutAddress,
        claimedInvoiceAmountUSD: truth.invoiceAmountUSD,
        proposal,
        policy,
      };
    }
  }
}

export async function listDemoInvoices(): Promise<DemoInvoice[]> {
  return Promise.all(DEMO_VENDOR_IDS.map((vendorId) => buildDemoInvoice(vendorId)));
}

// ─── Verdict serialization (JSON has no bigint) ────────────────────────────

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

const OUTCOME_LABEL: Record<0 | 1 | 2, SerializedVerdict['outcomeLabel']> = {
  0: 'CLEARED',
  1: 'REFUSED',
  2: 'HELD_FOR_STEPUP',
};

export function reasonCodeLabel(code: ReasonCode): string {
  return ReasonCode[code] ?? `UNKNOWN(${code})`;
}

export function serializeVerdict(verdict: Verdict): SerializedVerdict {
  return {
    proposalHash: verdict.proposalHash,
    policyHash: verdict.policyHash,
    outcome: verdict.outcome,
    outcomeLabel: OUTCOME_LABEL[verdict.outcome],
    reasonCode: verdict.reasonCode,
    reasonCodeLabel: reasonCodeLabel(verdict.reasonCode),
    blockChecked: verdict.blockChecked.toString(),
    logRef: verdict.logRef,
  };
}

// ─── Premise diff (claimed vs. derived, every premise, not only the mismatched one) ─

export interface PremiseDiffRow {
  premiseId: string;
  field: string;
  claimedValue: string | null;
  derivedValue: string | null;
}

/**
 * Independently re-resolves every premise in `policy`, pairing each with its claimed value,
 * regardless of whether `enforce()` itself reached it. CLAUDE.md rule 5: never a bare claim —
 * show the actual re-derived value for every premise checked, not only the one that mismatched.
 *
 * Safe for these three demo policies specifically because `enforce()` (see `enforce.ts`) always
 * reaches every premise in each of them: the globex/suspended-corp policies have exactly one
 * premise, and the acme-supplies policy's two premises both pass (so evaluation never stops
 * early). A policy where an earlier premise hard-mismatches before a later one is ever resolved
 * would need this function to stop at the same point `enforce()` did, to avoid claiming a
 * "derived" value for a premise that was never actually checked.
 */
export async function buildPremiseDiffs(policy: PolicyArtifact, proposal: Proposal, at: bigint): Promise<PremiseDiffRow[]> {
  const resolvePremise = createResolvePremise(registry);
  return Promise.all(
    policy.premises.map(async (def) => {
      const claim = proposal.premises.find((p) => p.premiseId === def.id);
      const derived = await resolvePremise(def, at);
      return {
        premiseId: def.id,
        field: def.field,
        claimedValue: claim?.claimedValue ?? null,
        derivedValue: derived === null ? null : derived.toString(),
      };
    }),
  );
}

// ─── Combined run + API response shape, shared by /api/enforce and /api/stepup ─

export interface EnforceApiResponse {
  invoiceId: DemoVendorId;
  vendorId: DemoVendorId;
  legalName: string;
  scenarioLabel: string;
  verdict: SerializedVerdict;
  premises: PremiseDiffRow[];
  mismatches: MismatchRecord[];
}

export interface EnforceRunResult {
  invoice: DemoInvoice;
  onchainPolicyHash: Hash32;
  verdict: Verdict;
  mismatches: MismatchRecord[];
  premises: PremiseDiffRow[];
}

/** Builds the demo invoice, runs the real `enforce()`, and derives the full premise diff — the one call both `/api/enforce` and `/api/stepup` use. */
export async function runEnforceForInvoice(vendorId: DemoVendorId): Promise<EnforceRunResult> {
  const invoice = await buildDemoInvoice(vendorId);
  const onchainPolicyHash = canonicalHash(invoice.policy);
  const mismatches: MismatchRecord[] = [];
  const deps = buildConsoleEnforceDeps(mismatches);
  const verdict = await enforce(invoice.proposal, invoice.policy, onchainPolicyHash, deps);
  const premises = await buildPremiseDiffs(invoice.policy, invoice.proposal, verdict.blockChecked);
  return { invoice, onchainPolicyHash, verdict, mismatches, premises };
}

export function toApiResponse(result: EnforceRunResult): EnforceApiResponse {
  return {
    invoiceId: result.invoice.vendorId,
    vendorId: result.invoice.vendorId,
    legalName: result.invoice.legalName,
    scenarioLabel: result.invoice.scenarioLabel,
    verdict: serializeVerdict(result.verdict),
    premises: result.premises,
    mismatches: result.mismatches,
  };
}

/**
 * Recovers which of the 3 known demo proposals a `proposalHash` belongs to, by re-deriving each
 * one's real verdict and matching on `Verdict.proposalHash`. This works only within this demo's
 * closed universe of 3 known invoices — a real deployment would look up the proposal by hash
 * from a real proposal store, not enumerate a fixed list. Used by `/api/stepup` so it never has
 * to trust a client-supplied vendor id/policy for the step-up gate; it always re-derives.
 */
export async function findHeldInvoiceByProposalHash(proposalHash: Hash32): Promise<EnforceRunResult | null> {
  for (const vendorId of DEMO_VENDOR_IDS) {
    const result = await runEnforceForInvoice(vendorId);
    if (result.verdict.proposalHash === proposalHash) {
      return result;
    }
  }
  return null;
}

// ─── World env presence check (names only, never values) ──────────────────

/**
 * Which required World sandbox env vars are unset, by NAME only — never reads or returns a
 * value. Imports `WORLD_ENV` from `@bonded/world-agents` rather than re-typing the variable
 * names, so this can never drift out of sync with `flow.ts#readWorldClientConfig`.
 */
export function missingWorldEnvVars(env: Record<string, string | undefined> = process.env): string[] {
  const required = [WORLD_ENV.clientId, WORLD_ENV.clientSecret, WORLD_ENV.redirectUri] as const;
  return required.filter((name) => !env[name] || env[name]?.trim() === '');
}
