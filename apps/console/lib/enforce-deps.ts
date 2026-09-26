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
 *    timestamp as a monotonic-enough stand-in. This is safe ONLY because both schemas wired
 *    into `registry` below (`issuer-oracle-vendors`, `intercepta-risk`) ignore the `at` argument entirely —
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
 * package or its filesystem-reading parser. The globex claimed EVM identity
 * (`#claimed-evm-identity[data-address]`) is mirrored the same way, and
 * `__tests__/enforce-deps.test.ts` reads that HTML file to fail on any drift between the two.
 *
 * === Intercepta: screening the payee's EVM identity (globex invoice only) ===
 *
 * Every payout address here is a 32-byte Sui address, which Intercepta cannot screen (it takes
 * an "ETH address/ENS", and its data covers EVM mainnet: docs/VERIFY_FINDINGS.md item 5). So the
 * globex invoice's policy screens the payee's claimed EVM identity instead, through the
 * `intercepta-risk` premise `payment.payTo.traitCount lte 0`. The premise runs FIRST, before the
 * `holdOnMismatch` payout premise, so a sanctioned identity is REFUSED rather than held for a
 * human who might approve it. The trait-semantics citations are on `payeeEvmScreenPremise`
 * below. The suspended-corp and acme-supplies policies are KEY-FREE by design (no Intercepta
 * premise), so they stay deterministic without a key.
 *
 * `intercepta-risk` is fail-closed (`@bonded/dispatcher`'s `failClosedTable`). With no
 * `INTERCEPTA_API_KEY`, the adapter throws `InterceptaKeyMissingError` before any network call,
 * that becomes `null`, and `enforce()` returns REFUSED / PREMISE_UNRESOLVABLE. The error itself
 * is returned in `screeningErrors`. Consequence, stated plainly: the globex invoice is NO
 * LONGER a HELD_FOR_STEPUP invoice, either with a key (expected REFUSED / PREMISE_MISMATCH for
 * the sanctioned identity) or without one (REFUSED / PREMISE_UNRESOLVABLE). None of the three
 * demo invoices re-derives to a held verdict any more, so `/api/stepup` answers 409 for all of them.
 */

import type { Address, Hash32, PolicyArtifact, Proposal, Verdict } from '@bonded/seam';
import { ReasonCode } from '@bonded/seam';
import { enforce, evaluatePremise, type EnforceDeps } from '@bonded/enforcer';
import {
  canonicalHash,
  createEnforceDeps,
  createResolvePremise,
  failClosedTable,
  type ResolveFailure,
  type SchemaRegistry,
} from '@bonded/dispatcher';
import { fetchVendorTruth, issuerOracleVendors } from '@bonded/issuer-oracle';
import { interceptaRisk } from '@bonded/intercepta-adapter';
import { WORLD_ENV } from '@bonded/world-agents';

// ─── Registry / EnforceDeps composition ────────────────────────────────────

/**
 * The schemas this app's demo wires in, with `intercepta-risk` FAIL-CLOSED: any adapter throw
 * (missing key, HTTP error, unexpected shape) becomes `null`, so the verdict is REFUSED /
 * PREMISE_UNRESOLVABLE, and the error goes to `screeningErrorSink`. It is never dropped. Build
 * one per request, so each request's errors stay with that request.
 */
export function buildRegistry(screeningErrorSink: ResolveFailure[]): SchemaRegistry {
  return {
    'issuer-oracle-vendors': issuerOracleVendors,
    'intercepta-risk': failClosedTable('intercepta-risk', interceptaRisk, (f) => screeningErrorSink.push(f)),
  };
}

/**
 * Shape reference only: which schemas this app wires, and in what order. `intercepta-risk` here
 * is the RAW adapter table, which throws on failure. Runtime paths in this file always use
 * `buildRegistry(sink)` instead.
 */
export const registry: SchemaRegistry = {
  'issuer-oracle-vendors': issuerOracleVendors,
  'intercepta-risk': interceptaRisk,
};

export interface MismatchRecord {
  proposalId: Hash32;
  premiseId: string;
  claimedValue: string;
  derivedValue: string;
}

/** Builds a real, non-mocked `EnforceDeps`. See the file header for what each extra is and is not. */
export function buildConsoleEnforceDeps(
  mismatchSink: MismatchRecord[] = [],
  screeningErrorSink: ResolveFailure[] = [],
): EnforceDeps {
  return createEnforceDeps(buildRegistry(screeningErrorSink), {
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

/**
 * Mirrors `packages/villain-corpus/site/spoofed-invoice.html`'s `#claimed-evm-identity[data-address]`
 * literally, the same way as the payout address above. A test in `__tests__/enforce-deps.test.ts`
 * reads that HTML file and fails if the two drift apart. The value is a REAL OFAC-listed address:
 * SDN entry 27307 "LAZARUS GROUP" (program DPRK3), "Digital Currency Address - ETH
 * 0x098B716B8Aaf21512996dC57EB0615e2383E2f96", added 2022-04-14
 * (https://ofac.treasury.gov/recent-actions/20220414), and present in the live
 * https://www.treasury.gov/ofac/downloads/sdn.csv, checked 2026-09-26.
 */
const CLAIMED_GLOBEX_EVM_IDENTITY = '0x098b716b8aaf21512996dc57eb0615e2383e2f96' as `0x${string}`;

export const PAYEE_EVM_SCREEN_PREMISE_ID = 'p-payee-evm-screen';

/**
 * `intercepta-risk` / `payment.payTo.traitCount` (Deep Scan `traits.length`), op `lte`, value `'0'`.
 * No threshold on `toxicScore`, because its range is UNCONFIRMED (VERIFY_FINDINGS item 5). Any
 * trait counts as a mismatch, because the docs define traits as risk indicators: `traits` is a
 * "List of suspicious activities detected on the address", `ToxicScoreTraitV2.risk` is "Risk
 * level of the trait" (https://docs.web3antivirus.io/reference/scan-address.md OAS, fetched
 * 2026-09-26), and every `name` enum value is a risk category (known_scammer, sanction_address,
 * mixer_transfers, rug_pull, blacklist, ...; the full list is `DOCUMENTED_TRAIT_NAMES` in
 * `@bonded/intercepta-adapter`). There is no `holdOnMismatch`: this is a hard refuse. The claimed
 * value is always `'0'` (the paying agent implicitly asserts the payee has no risk trait).
 */
function payeeEvmScreenPremise(claimedPayeeEvmAddress: string): PolicyArtifact['premises'][number] {
  return {
    id: PAYEE_EVM_SCREEN_PREMISE_ID,
    schema: 'intercepta-risk',
    field: 'payment.payTo.traitCount',
    op: 'lte',
    value: '0',
    args: [claimedPayeeEvmAddress],
  };
}

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
  /**
   * The payee's claimed EVM identity (20-byte). For globex, this is the spoofed invoice's claim,
   * and it is screened. For the two key-free invoices, it is the vendor's registered identity on
   * file, shown for display and not screened by their policies.
   */
  claimedPayeeEvmAddress: `0x${string}`;
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
      // Mirrors villain-corpus's key-gated `buildInterceptaScreenScenario` (full policy): the
      // spoofed invoice claims a FRAUDULENT payout address AND a sanctioned EVM identity.
      // ORDER: the Intercepta screen runs FIRST, as a hard refuse. The payout-address premise
      // (holdOnMismatch) runs second. If the payout premise ran first, the address mismatch would
      // return HELD_FOR_STEPUP before the screen was reached, and a human could approve paying a
      // sanctioned identity.
      const policy: PolicyArtifact = {
        version: 1,
        budget: { asset: 'USDC', period: 'daily', max: '100000000000' },
        premises: [
          payeeEvmScreenPremise(CLAIMED_GLOBEX_EVM_IDENTITY),
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
        premises: [
          { premiseId: PAYEE_EVM_SCREEN_PREMISE_ID, claimedValue: '0' },
          { premiseId: 'p-vendor-payout', claimedValue: FRAUDULENT_GLOBEX_PAYOUT_ADDRESS },
        ],
        createdAt: 1_790_200_000,
      };
      return {
        vendorId,
        legalName: truth.legalName,
        scenarioLabel:
          'Vendor claims a new (fraudulent) payout address and a sanctioned EVM identity. The live Intercepta ' +
          'screen runs before the payout hold and refuses. Without INTERCEPTA_API_KEY the screen cannot run, ' +
          'and the payment is refused (fail closed).',
        claimedPayoutAddress: FRAUDULENT_GLOBEX_PAYOUT_ADDRESS,
        claimedPayeeEvmAddress: CLAIMED_GLOBEX_EVM_IDENTITY,
        claimedInvoiceAmountUSD: truth.invoiceAmountUSD,
        proposal,
        policy,
      };
    }
    case 'vnd-suspended-corp': {
      // Mirrors buildScenario2: a plain (non-hold) vendor.status premise. Hard refuse.
      // KEY-FREE policy by design: no intercepta-risk premise.
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
        claimedPayeeEvmAddress: truth.evmAddress,
        claimedInvoiceAmountUSD: truth.invoiceAmountUSD,
        proposal,
        policy,
      };
    }
    case 'vnd-acme-supplies': {
      // Mirrors buildScenario3: a correct, matching claim on both premises. Clears.
      // KEY-FREE policy by design: no intercepta-risk premise.
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
        claimedPayeeEvmAddress: truth.evmAddress,
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

// ─── Premise diff (claimed vs. derived, for every premise enforce() actually reached) ─

export interface PremiseDiffRow {
  premiseId: string;
  field: string;
  claimedValue: string | null;
  derivedValue: string | null;
  /** Set when the premise could not be resolved because the adapter threw (e.g. no Intercepta key). */
  resolveError?: string;
}

function toRow(
  def: PolicyArtifact['premises'][number],
  claimedValue: string | null,
  derived: bigint | string | null,
  failure: ResolveFailure | undefined,
): PremiseDiffRow {
  return {
    premiseId: def.id,
    field: def.field,
    claimedValue,
    derivedValue: derived === null ? null : derived.toString(),
    ...(failure ? { resolveError: `${failure.errorName}: ${failure.message}` } : {}),
  };
}

/**
 * Independently re-resolves the premises, in the proposal's order, pairing each with its
 * claimed value, and STOPS exactly where `enforce()` stops: after the first premise that is
 * unresolvable or mismatches. CLAUDE.md rule 5: never a bare claim. No derived value is shown
 * for a premise `enforce()` never reached. Uses the fail-closed registry, so an unscreenable
 * Intercepta premise becomes a row with `derivedValue: null` and a `resolveError`, not a thrown
 * request.
 */
export async function buildPremiseDiffs(policy: PolicyArtifact, proposal: Proposal, at: bigint): Promise<PremiseDiffRow[]> {
  const failures: ResolveFailure[] = [];
  const resolvePremise = createResolvePremise(buildRegistry(failures));
  const rows: PremiseDiffRow[] = [];
  for (const claim of proposal.premises) {
    const def = policy.premises.find((p) => p.id === claim.premiseId);
    if (!def) break; // enforce() refuses PREMISE_UNRESOLVABLE here
    const before = failures.length;
    const derived = await resolvePremise(def, at);
    rows.push(toRow(def, claim.claimedValue, derived, failures[before]));
    if (derived === null) break;
    let ok: boolean;
    try {
      ok = evaluatePremise(def, claim.claimedValue, derived);
    } catch {
      ok = false;
    }
    if (!ok) break;
  }
  return rows;
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
  /** Every screen that could not be resolved, with its exact error (e.g. InterceptaKeyMissingError). */
  screeningErrors: ResolveFailure[];
}

export interface EnforceRunResult {
  invoice: DemoInvoice;
  onchainPolicyHash: Hash32;
  verdict: Verdict;
  mismatches: MismatchRecord[];
  /** Exactly the premises `enforce()` resolved, in order, with the value it resolved. */
  premises: PremiseDiffRow[];
  screeningErrors: ResolveFailure[];
}

/**
 * Builds the demo invoice, runs the real `enforce()`, and records the premise diff — the one
 * call both `/api/enforce` and `/api/stepup` use. The diff rows are the values `enforce()`
 * itself resolved (captured by wrapping `resolvePremise`), not a second resolution. So a live
 * Intercepta screen is called once per request, not twice, and the rows stop exactly where
 * `enforce()` stopped.
 */
export async function runEnforceForInvoice(vendorId: DemoVendorId): Promise<EnforceRunResult> {
  const invoice = await buildDemoInvoice(vendorId);
  const onchainPolicyHash = canonicalHash(invoice.policy);
  const mismatches: MismatchRecord[] = [];
  const screeningErrors: ResolveFailure[] = [];
  const baseDeps = buildConsoleEnforceDeps(mismatches, screeningErrors);
  const premises: PremiseDiffRow[] = [];
  const deps: EnforceDeps = {
    ...baseDeps,
    resolvePremise: async (def, at) => {
      const before = screeningErrors.length;
      const derived = await baseDeps.resolvePremise(def, at);
      const claim = invoice.proposal.premises.find((p) => p.premiseId === def.id);
      premises.push(toRow(def, claim?.claimedValue ?? null, derived, screeningErrors[before]));
      return derived;
    },
  };
  const verdict = await enforce(invoice.proposal, invoice.policy, onchainPolicyHash, deps);
  return { invoice, onchainPolicyHash, verdict, mismatches, premises, screeningErrors };
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
    screeningErrors: result.screeningErrors,
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
