/**
 * apps/console's ONE composition point for `enforce()`: the registry, the
 * `EnforceDeps`, the demo invoices, and the on-chain reads they depend on.
 * Every route imports from here (and from `payment.ts`, which settles), and
 * never re-derives its own registry or policy.
 *
 * === What each dependency is ===
 *
 *  - Policy: ONE `PolicyArtifact` for the AP agent (`ap-policy.ts`), the same
 *    for every invoice. Its hash is read from `BondedRegistry` on-chain
 *    (`readPolicyHash`). If that read fails, or the registry holds no hash for
 *    the agent, `runEnforceForInvoice` throws `OnchainPolicyError` and the
 *    route shows it. It never falls back to hashing the local policy.
 *  - `sumRecentSpend`: the vault's real `spent_this_period`, read on-chain
 *    (`readVaultSpent`). It is vault-wide and never resets (see ap-policy.ts).
 *  - Vendor master: `createVendorSource(env, { changeLogPath })` from
 *    `@bonded/issuer-oracle`: the disclosed fixture plus the append-only
 *    change log of World-approved bank changes, or the live Xero org when
 *    `VENDOR_MASTER_SOURCE=xero`. The same source feeds `enforce()` and the
 *    settlement recipient, so both see the same truth.
 *  - `getCheckpoint`: NOT a Sui checkpoint. Unix seconds, a monotonic-enough
 *    stand-in. Safe only because no schema wired here reads the `at`
 *    argument. `Verdict.blockChecked` must never be shown as a checkpoint.
 *  - `intercepta-risk` is fail-closed (`failClosedTable`): a missing
 *    INTERCEPTA_API_KEY, an HTTP error or a bad shape becomes `null`, so the
 *    verdict is REFUSED / PREMISE_UNRESOLVABLE, with the error returned in
 *    `screeningErrors`. No screen result is ever invented.
 *  - Screening premises' subjects are bound from the proposal's own claims
 *    (`bindClaimArgs`), so one committed policy can screen whatever payee
 *    identity each invoice claims.
 *
 * === The six demo invoices ===
 *
 *  - `inv-acme-supplies`: correct claims, key-free → CLEARED → settles.
 *  - `inv-globex-spoofed`: the spoofed email's claims (a real OFAC-listed EVM
 *    identity + a fraudulent payout address, both mirrored from
 *    packages/villain-corpus/site/spoofed-invoice.html) → REFUSED by the
 *    screen (with a key) or fail-closed (without one).
 *  - `inv-globex-bank-change`: globex's REGISTERED (clean) EVM identity and a
 *    NEW Sui payout address → screen passes (needs a key) → payout mismatch →
 *    HELD / PREMISE_HELD_FOR_REVIEW. Approving it through World writes the new
 *    address into the vendor master, then re-enforces and settles to the
 *    updated truth (`payment.ts`).
 *  - `inv-suspended-corp`: claims active, vendor is suspended → REFUSED.
 *  - `inv-halcyon-machining`: correct claims, $15,000 > $10,000 threshold →
 *    HELD / IRREVERSIBLE_UNCONFIRMED (needs a key for the screen) → World
 *    step-up → `settleWithStepUp` pays the on-file address.
 *  - `inv-halcyon-bank-change`: the IDKit demo (the globex bank change was
 *    already settled live and applied). halcyon's REGISTERED EVM identity and
 *    a NEW Sui payout address, $6,300.00 (under the irreversible threshold, so
 *    the only hold is the bank change) → screen passes (needs a key) → HELD /
 *    PREMISE_HELD_FOR_REVIEW. The AP step-up only succeeds if halcyon's
 *    representative first filed the same change at /vendor/bank-change and
 *    verified it with IDKit (`vendor-bank-change.ts`, gate in `payment.ts`).
 *    The same gate applies to every PREMISE_HELD_FOR_REVIEW approval.
 */

import { createHash } from 'node:crypto';
import type { Address, Hash32, PolicyArtifact, Proposal, Verdict } from '@bonded/seam';
import { ReasonCode } from '@bonded/seam';
import { enforce, type EnforceDeps } from '@bonded/enforcer';
import {
  bindClaimArgs,
  createEnforceDeps,
  failClosedTable,
  type ResolveFailure,
  type SchemaRegistry,
} from '@bonded/dispatcher';
import {
  createVendorMasterBankChangeWriter,
  createVendorSource,
  defaultVendorMasterChangeLogPath,
  vendorTruthFields,
  type VendorMasterBankChangeWriter,
  type VendorSource,
} from '@bonded/issuer-oracle';
import { interceptaRisk } from '@bonded/intercepta-adapter';
import {
  readPolicyHash,
  readVaultSpent,
  settleCleared,
  settleWithStepUp,
  type SettleClearedInput,
  type SettlementResult,
  type SettleWithStepUpInput,
} from '@bonded/sui-settlement';
import { WORLD_ENV } from '@bonded/world-agents';
import { AP_AGENT_ADDRESS, AP_AGENT_POLICY, AP_VAULT_TARGET_ADDRESS } from './ap-policy';
import { IDKIT_ENV } from './idkit';
import { SettlementLedger } from './settlement-ledger';
import { defaultVendorRequestStorePath, fileVendorRequestStore, type VendorRequestStore } from './vendor-bank-change';
import { recordVerdict, type VerdictLogEntry } from './verdict-log';

// ─── Context: chain, vendor master, ledger ─────────────────────────────────

/** Everything this app touches outside the process. Production uses `defaultConsoleContext()`. */
export interface ChainPort {
  readPolicyHash(agent: Address): Promise<Hash32 | null>;
  readVaultSpent(): Promise<bigint>;
  settleCleared(input: SettleClearedInput): Promise<SettlementResult>;
  settleWithStepUp(input: SettleWithStepUpInput): Promise<SettlementResult>;
}

export interface ConsoleContext {
  chain: ChainPort;
  vendorSource: VendorSource;
  ledger: SettlementLedger;
  writeBankChange: VendorMasterBankChangeWriter;
  /**
   * The IDKit-verified vendor bank-change requests (`.data/vendor-bank-change-requests.json`). A
   * PREMISE_HELD_FOR_REVIEW approval only proceeds when one matches the invoice's claim.
   */
  vendorRequests: VendorRequestStore;
  /**
   * How an invoice's `Proposal`/`PolicyArtifact` is built. Always `buildDemoInvoice` (the ONE
   * committed AP policy) in this app; `defaultConsoleContext` never sets it and no route can. Unit
   * tests set it to exercise the step-up chain under a clearly labelled, screen-free TEST policy,
   * so no test ever has to pretend Intercepta answered.
   */
  buildInvoice?: (invoiceId: DemoInvoiceId, vendorSource: VendorSource) => Promise<DemoInvoice>;
  /**
   * Records the agent's latest verdict per invoice for the Invoice Inbox (display only; see
   * lib/verdict-log.ts). Set by `defaultConsoleContext`; unit-test contexts leave it unset, so
   * tests never write into the real `.data/` folder.
   */
  recordVerdict?: (entry: VerdictLogEntry) => Promise<void>;
}

/** The real `@bonded/sui-settlement` calls, reading SUI_* from `process.env`. */
export const liveChain: ChainPort = {
  readPolicyHash: (agent) => readPolicyHash(agent),
  readVaultSpent: () => readVaultSpent(),
  settleCleared: (input) => settleCleared(input),
  settleWithStepUp: (input) => settleWithStepUp(input),
};

let defaultContext: ConsoleContext | undefined;

/** Lazily built once per server process, from `process.env`. */
export function defaultConsoleContext(): ConsoleContext {
  if (defaultContext === undefined) {
    const changeLogPath = defaultVendorMasterChangeLogPath();
    defaultContext = {
      chain: liveChain,
      vendorSource: createVendorSource(process.env, { changeLogPath }),
      ledger: new SettlementLedger(),
      writeBankChange: createVendorMasterBankChangeWriter(process.env, { changeLogPath }),
      vendorRequests: fileVendorRequestStore(defaultVendorRequestStorePath()),
      recordVerdict: (entry) => recordVerdict(entry),
    };
  }
  return defaultContext;
}

// ─── Registry / EnforceDeps composition ────────────────────────────────────

/**
 * `issuer-oracle-vendors` over the context's vendor source, and
 * `intercepta-risk` FAIL-CLOSED (errors go to `screeningErrorSink`, never
 * dropped). One per request, so each request keeps its own errors.
 */
export function buildRegistry(vendorSource: VendorSource, screeningErrorSink: ResolveFailure[]): SchemaRegistry {
  return {
    'issuer-oracle-vendors': vendorTruthFields(vendorSource),
    'intercepta-risk': failClosedTable('intercepta-risk', interceptaRisk, (f) => screeningErrorSink.push(f)),
  };
}

export interface MismatchRecord {
  proposalId: Hash32;
  premiseId: string;
  claimedValue: string;
  derivedValue: string;
}

/** The real `EnforceDeps` for one proposal. See the file header for what each piece is. */
export function buildConsoleEnforceDeps(
  ctx: Pick<ConsoleContext, 'chain' | 'vendorSource'>,
  proposal: Pick<Proposal, 'premises'>,
  mismatchSink: MismatchRecord[] = [],
  screeningErrorSink: ResolveFailure[] = [],
): EnforceDeps {
  const base = createEnforceDeps(buildRegistry(ctx.vendorSource, screeningErrorSink), {
    getCheckpoint: async () => BigInt(Math.floor(Date.now() / 1000)),
    sumRecentSpend: () => ctx.chain.readVaultSpent(),
    logMismatch: async (proposalId, premiseId, claimedValue, derivedValue) => {
      mismatchSink.push({ proposalId, premiseId, claimedValue, derivedValue });
    },
  });
  return { ...base, resolvePremise: bindClaimArgs(base.resolvePremise, proposal) };
}

// ─── Demo invoices ─────────────────────────────────────────────────────────

/** From villain-corpus/site/spoofed-invoice.html `#fraudulent-payout-address[data-address]` (read, not imported). */
const FRAUDULENT_GLOBEX_PAYOUT_ADDRESS = '0xe218026a7210d04d19e4cc677f1c459c5ff353df6915b44e085397fdbdb89187' as Address;

/**
 * From spoofed-invoice.html `#claimed-evm-identity[data-address]`. A REAL OFAC-listed address:
 * SDN entry 27307 "LAZARUS GROUP" (DPRK3), "Digital Currency Address - ETH
 * 0x098B716B8Aaf21512996dC57EB0615e2383E2f96", added 2022-04-14; present in the live sdn.csv
 * (checked 2026-09-26). The test file fails on drift from the HTML.
 */
const CLAIMED_SPOOF_EVM_IDENTITY = '0x098b716b8aaf21512996dc57eb0615e2383e2f96' as `0x${string}`;

/**
 * Globex's genuine new Sui payout address for the bank-change invoice. Synthetic, like every
 * address in this demo: sha256("bonded-synthetic-sui-payout:vnd-globex-freight:bank-change").
 */
export const GLOBEX_NEW_BANK_PAYOUT_ADDRESS =
  '0x053cbe6fe7b37c2f10a0d30eab88de7466cb9f63a6145a3d963fb9ccd81631ad' as Address;

/**
 * Halcyon's new Sui payout address for the IDKit bank-change demo. Synthetic, like every address in
 * this demo: sha256("bonded-synthetic-sui-payout:vnd-halcyon-machining:bank-change").
 */
export const HALCYON_NEW_BANK_PAYOUT_ADDRESS =
  '0x4b7d62a058390ef2ee51add354dad9776e4dca91953f159f92d340ddb38850f7' as Address;

/** $6,300.00, under the $10,000.00 irreversible threshold, so the bank change is the only hold. */
export const HALCYON_BANK_CHANGE_INVOICE_USDC = '6300000000';

export const DEMO_INVOICE_IDS = [
  'inv-acme-supplies',
  'inv-globex-spoofed',
  'inv-globex-bank-change',
  'inv-suspended-corp',
  'inv-halcyon-machining',
  'inv-halcyon-bank-change',
] as const;
export type DemoInvoiceId = (typeof DEMO_INVOICE_IDS)[number];

export function isDemoInvoiceId(value: string): value is DemoInvoiceId {
  return (DEMO_INVOICE_IDS as readonly string[]).includes(value);
}

/**
 * Deterministic proposal id per invoice: sha256("bonded-console-invoice:v2:<invoiceId>"). New ids
 * (not villain-corpus's 0x11…/0x22…/0x33…) because these are new proposals under a new policy;
 * `0x33…33` was already paid on-chain by `sui-settlement`'s live script (move/DEPLOYMENTS.md).
 */
export function proposalIdFor(invoiceId: DemoInvoiceId): Hash32 {
  return `0x${createHash('sha256').update(`bonded-console-invoice:v2:${invoiceId}`, 'utf8').digest('hex')}` as Hash32;
}

export function findInvoiceIdByProposalHash(proposalHash: string): DemoInvoiceId | null {
  const wanted = proposalHash.toLowerCase();
  return DEMO_INVOICE_IDS.find((id) => proposalIdFor(id) === wanted) ?? null;
}

const VENDOR_OF: Record<DemoInvoiceId, string> = {
  'inv-acme-supplies': 'vnd-acme-supplies',
  'inv-globex-spoofed': 'vnd-globex-freight',
  'inv-globex-bank-change': 'vnd-globex-freight',
  'inv-suspended-corp': 'vnd-suspended-corp',
  'inv-halcyon-machining': 'vnd-halcyon-machining',
  'inv-halcyon-bank-change': 'vnd-halcyon-machining',
};

export interface DemoInvoice {
  invoiceId: DemoInvoiceId;
  vendorId: string;
  legalName: string;
  /** Shown on the inbox/detail pages; not consumed by `enforce()`. */
  scenarioLabel: string;
  /** Which keys this invoice needs to run live. Empty = runs with none. */
  needs: string[];
  claimedPayoutAddress: Address;
  /** The payee EVM identity this invoice claims (screened for globex/halcyon). */
  claimedPayeeEvmAddress: `0x${string}`;
  claimedInvoiceAmountUSD: string;
  proposal: Proposal;
  policy: PolicyArtifact;
}

function proposal(invoiceId: DemoInvoiceId, valueUSDC: string, premises: Proposal['premises'], createdAt: number): Proposal {
  return {
    id: proposalIdFor(invoiceId),
    agent: AP_AGENT_ADDRESS,
    action: { kind: 'transfer', target: AP_VAULT_TARGET_ADDRESS, calldata: '0x', valueUSDC },
    premises,
    createdAt,
  };
}

/**
 * Builds one invoice's `Proposal` against the ONE agent policy. Claims that are "correct" are read
 * from the vendor source (what the agent's invoice says, which for these invoices is the truth);
 * the fraudulent and bank-change claims are constants above. Throws for a vendor the source
 * doesn't know.
 */
export async function buildDemoInvoice(invoiceId: DemoInvoiceId, vendorSource: VendorSource): Promise<DemoInvoice> {
  const vendorId = VENDOR_OF[invoiceId];
  const truth = await vendorSource(vendorId);
  if (truth === null) throw new Error(`Demo vendor ${vendorId} is missing from the vendor-master source.`);
  const base = { invoiceId, vendorId, legalName: truth.legalName, claimedInvoiceAmountUSD: truth.invoiceAmountUSD, policy: AP_AGENT_POLICY };

  switch (invoiceId) {
    case 'inv-acme-supplies':
      return {
        ...base,
        scenarioLabel: 'Correct, matching claim. Clears, and the AP agent settles it on Sui automatically.',
        needs: [],
        claimedPayoutAddress: truth.payoutAddress,
        claimedPayeeEvmAddress: truth.evmAddress,
        proposal: proposal(invoiceId, truth.invoiceAmountUSD, [
          { premiseId: 'p-acme-status', claimedValue: truth.status },
          { premiseId: 'p-acme-payout', claimedValue: truth.payoutAddress },
        ], 1_790_300_000),
      };
    case 'inv-globex-spoofed':
      return {
        ...base,
        scenarioLabel:
          'The spoofed "we changed banks" email: a fraudulent payout address and a sanctioned (OFAC-listed) EVM identity. ' +
          'The live Intercepta screen runs before the payout hold and refuses. Without INTERCEPTA_API_KEY it fails closed (refused).',
        needs: ['INTERCEPTA_API_KEY'],
        claimedPayoutAddress: FRAUDULENT_GLOBEX_PAYOUT_ADDRESS,
        claimedPayeeEvmAddress: CLAIMED_SPOOF_EVM_IDENTITY,
        proposal: proposal(invoiceId, truth.invoiceAmountUSD, [
          { premiseId: 'p-globex-screen', claimedValue: '0' },
          { premiseId: 'p-globex-status', claimedValue: 'active' },
          { premiseId: 'p-globex-evm-identity', claimedValue: CLAIMED_SPOOF_EVM_IDENTITY },
          { premiseId: 'p-globex-payout', claimedValue: FRAUDULENT_GLOBEX_PAYOUT_ADDRESS },
        ], 1_790_300_100),
      };
    case 'inv-globex-bank-change':
      return {
        ...base,
        scenarioLabel:
          'A genuine bank change: globex\'s registered (clean) EVM identity and a new payout address. The screen passes, the ' +
          'payout mismatch holds for a World step-up; approving writes the new address to the vendor master, then it clears and settles.',
        needs: ['INTERCEPTA_API_KEY', ...Object.values(WORLD_ENV).slice(0, 3)],
        claimedPayoutAddress: GLOBEX_NEW_BANK_PAYOUT_ADDRESS,
        claimedPayeeEvmAddress: truth.evmAddress,
        proposal: proposal(invoiceId, truth.invoiceAmountUSD, [
          { premiseId: 'p-globex-screen', claimedValue: '0' },
          { premiseId: 'p-globex-status', claimedValue: 'active' },
          { premiseId: 'p-globex-evm-identity', claimedValue: truth.evmAddress },
          { premiseId: 'p-globex-payout', claimedValue: GLOBEX_NEW_BANK_PAYOUT_ADDRESS },
        ], 1_790_300_200),
      };
    case 'inv-suspended-corp':
      return {
        ...base,
        scenarioLabel: 'Vendor is claimed active but is suspended on file. Hard refused.',
        needs: [],
        claimedPayoutAddress: truth.payoutAddress,
        claimedPayeeEvmAddress: truth.evmAddress,
        proposal: proposal(invoiceId, truth.invoiceAmountUSD, [{ premiseId: 'p-suspended-status', claimedValue: 'active' }], 1_790_300_300),
      };
    case 'inv-halcyon-machining':
      return {
        ...base,
        scenarioLabel:
          'Every fact matches, but $15,000.00 is over the $10,000.00 irreversible threshold. Held for a World step-up, then ' +
          'settled with settle_with_stepup to the address on file.',
        needs: ['INTERCEPTA_API_KEY', ...Object.values(WORLD_ENV).slice(0, 3)],
        claimedPayoutAddress: truth.payoutAddress,
        claimedPayeeEvmAddress: truth.evmAddress,
        proposal: proposal(invoiceId, truth.invoiceAmountUSD, [
          { premiseId: 'p-halcyon-screen', claimedValue: '0' },
          { premiseId: 'p-halcyon-status', claimedValue: truth.status },
          { premiseId: 'p-halcyon-evm-identity', claimedValue: truth.evmAddress },
          { premiseId: 'p-halcyon-payout', claimedValue: truth.payoutAddress },
        ], 1_790_300_400),
      };
    case 'inv-halcyon-bank-change':
      return {
        ...base,
        claimedInvoiceAmountUSD: HALCYON_BANK_CHANGE_INVOICE_USDC,
        scenarioLabel:
          "A bank change filed by the vendor through IDKit: halcyon's registered (clean) EVM identity and a new payout address, $6,300.00. " +
          "The screen passes and the payout mismatch holds. The AP step-up only succeeds if halcyon's representative filed this exact change " +
          'at /vendor/bank-change and verified it with World ID (IDKit); then the vendor master is updated and the invoice clears and settles.',
        needs: ['INTERCEPTA_API_KEY', ...Object.values(WORLD_ENV).slice(0, 3), ...Object.values(IDKIT_ENV)],
        claimedPayoutAddress: HALCYON_NEW_BANK_PAYOUT_ADDRESS,
        claimedPayeeEvmAddress: truth.evmAddress,
        proposal: proposal(invoiceId, HALCYON_BANK_CHANGE_INVOICE_USDC, [
          { premiseId: 'p-halcyon-screen', claimedValue: '0' },
          { premiseId: 'p-halcyon-status', claimedValue: 'active' },
          { premiseId: 'p-halcyon-evm-identity', claimedValue: truth.evmAddress },
          { premiseId: 'p-halcyon-payout', claimedValue: HALCYON_NEW_BANK_PAYOUT_ADDRESS },
        ], 1_790_300_500),
      };
  }
}

export async function listDemoInvoices(vendorSource: VendorSource): Promise<DemoInvoice[]> {
  return Promise.all(DEMO_INVOICE_IDS.map((id) => buildDemoInvoice(id, vendorSource)));
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

const OUTCOME_LABEL: Record<0 | 1 | 2, SerializedVerdict['outcomeLabel']> = { 0: 'CLEARED', 1: 'REFUSED', 2: 'HELD_FOR_STEPUP' };

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

// ─── Premise diff: exactly what enforce() resolved ─────────────────────────

export interface PremiseDiffRow {
  premiseId: string;
  field: string;
  claimedValue: string | null;
  derivedValue: string | null;
  /** Set when the premise could not be resolved because the adapter threw (e.g. no Intercepta key). */
  resolveError?: string;
}

// ─── The enforce() run ─────────────────────────────────────────────────────

export class OnchainPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OnchainPolicyError';
  }
}

export interface EnforceRunResult {
  invoice: DemoInvoice;
  /** Read from BondedRegistry on-chain for the agent. Never recomputed locally. */
  onchainPolicyHash: Hash32;
  verdict: Verdict;
  mismatches: MismatchRecord[];
  /** Exactly the premises `enforce()` resolved, in order, with the value it resolved. */
  premises: PremiseDiffRow[];
  screeningErrors: ResolveFailure[];
  /** The vault's on-chain `spent_this_period`, if `enforce()` reached the budget step. */
  vaultSpentUsdc: bigint | null;
}

/** Reads the agent's on-chain policy hash. Throws `OnchainPolicyError` on any failure or a missing hash. */
export async function readOnchainPolicyHash(chain: ChainPort, agent: Address = AP_AGENT_ADDRESS): Promise<Hash32> {
  let hash: Hash32 | null;
  try {
    hash = await chain.readPolicyHash(agent);
  } catch (error) {
    throw new OnchainPolicyError(
      `Could not read the AP agent's policy hash from BondedRegistry on-chain (${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}). ` +
        'Refusing to enforce: the policy hash is never recomputed locally as a stand-in.',
    );
  }
  if (hash === null) {
    throw new OnchainPolicyError(
      `BondedRegistry holds no policy hash for agent ${agent}. Commit the AP policy first: pnpm --filter @bonded/console commit:policy`,
    );
  }
  return hash;
}

/**
 * Builds the invoice, reads the on-chain policy hash, runs the real `enforce()`, and records the
 * premise diff as `enforce()` itself resolved it (captured by wrapping `resolvePremise`, so a live
 * Intercepta screen runs once per request and the rows stop exactly where `enforce()` stopped).
 */
export async function runEnforceForInvoice(
  invoiceId: DemoInvoiceId,
  ctx: Pick<ConsoleContext, 'chain' | 'vendorSource' | 'buildInvoice'> = defaultConsoleContext(),
): Promise<EnforceRunResult> {
  const invoice = await (ctx.buildInvoice ?? buildDemoInvoice)(invoiceId, ctx.vendorSource);
  const onchainPolicyHash = await readOnchainPolicyHash(ctx.chain, invoice.proposal.agent);
  const mismatches: MismatchRecord[] = [];
  const screeningErrors: ResolveFailure[] = [];
  const baseDeps = buildConsoleEnforceDeps(ctx, invoice.proposal, mismatches, screeningErrors);
  const premises: PremiseDiffRow[] = [];
  let vaultSpentUsdc: bigint | null = null;
  const deps: EnforceDeps = {
    ...baseDeps,
    resolvePremise: async (def, at) => {
      const before = screeningErrors.length;
      const derived = await baseDeps.resolvePremise(def, at);
      const claim = invoice.proposal.premises.find((p) => p.premiseId === def.id);
      const failure = screeningErrors[before];
      premises.push({
        premiseId: def.id,
        field: def.field,
        claimedValue: claim?.claimedValue ?? null,
        derivedValue: derived === null ? null : derived.toString(),
        ...(failure ? { resolveError: `${failure.errorName}: ${failure.message}` } : {}),
      });
      return derived;
    },
    sumRecentSpend: async (agent, period) => {
      vaultSpentUsdc = await baseDeps.sumRecentSpend(agent, period);
      return vaultSpentUsdc;
    },
  };
  const verdict = await enforce(invoice.proposal, invoice.policy, onchainPolicyHash, deps);
  return { invoice, onchainPolicyHash, verdict, mismatches, premises, screeningErrors, vaultSpentUsdc };
}

// ─── World env presence check (names only, never values) ──────────────────

/** Which required World sandbox env vars are unset, by NAME only. */
export function missingWorldEnvVars(env: Record<string, string | undefined> = process.env): string[] {
  const required = [WORLD_ENV.clientId, WORLD_ENV.clientSecret, WORLD_ENV.redirectUri] as const;
  return required.filter((name) => !env[name] || env[name]?.trim() === '');
}
