/**
 * `harness/run.ts` — the villain corpus's actual proof: three REAL
 * `enforce()` calls (imported from `@bonded/enforcer`, routed through the
 * real `@bonded/dispatcher` router against the real `@bonded/issuer-oracle`
 * vendor fixture) demonstrating the BEC (Business Email Compromise) /
 * vendor-invoice-payment-fraud scenario end to end, with no mocks anywhere in
 * this file. See `../site/spoofed-invoice.html` for the spoofed artifact and
 * `naive-ap-agent.ts` for the naive, pre-Bonded agent behavior being guarded
 * against.
 *
 * Three core scenarios (always run, no network dependency, deterministic):
 *   1. `vnd-globex-freight` — the naive agent's proposal claims the
 *      FRAUDULENT payout address read off the spoofed page. The policy's
 *      `vendor.payoutAddress` premise has `holdOnMismatch: true`, so the
 *      mismatch produces HELD_FOR_STEPUP / PREMISE_HELD_FOR_REVIEW — a human
 *      reviews it — rather than a hard refuse.
 *   2. `vnd-suspended-corp` — a plain (non-hold) `vendor.status` premise
 *      expects `'active'`; the real fixture status is `'suspended'`. Hard
 *      refuse: REFUSED / PREMISE_MISMATCH.
 *   3. `vnd-acme-supplies` — a correct, matching claim against the real
 *      payout address AND status. Both premises pass, budget and
 *      irreversible-threshold checks pass too: CLEARED / OK.
 *
 * The three core scenarios are KEY-FREE BY DESIGN: their policies
 * deliberately omit the `intercepta-risk` premise, so they stay deterministic
 * with no network and no API key. They test the vendor-master premises only.
 *
 * Key-gated 4th scenario (`runInterceptaScreenScenario`): the same globex
 * spoofed invoice, with the FULL policy. The claimed EVM identity read off
 * the spoofed page (a real OFAC-listed address) is screened live through the
 * REAL `@bonded/intercepta-adapter` BEFORE the payout-address hold premise.
 * With `INTERCEPTA_API_KEY` set, it runs live and must REFUSE. Without the
 * key, it is reported as "not run: missing key", never as a pass. `enforce()`
 * still runs (no network call is made, because the adapter throws on the
 * missing key before any fetch), and it fails CLOSED: REFUSED /
 * PREMISE_UNRESOLVABLE. It is kept apart from the core scenarios, so a
 * missing key cannot change their pass/fail status.
 *
 * This replaces the earlier optional scenario, which screened the 32-byte
 * Sui payout address. That scenario could never succeed:
 * `parseScreeningSubject` rejects a Sui address before any network call.
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Address, Hash32, PolicyArtifact, Proposal, Verdict } from '@bonded/seam';
import { ReasonCode } from '@bonded/seam';
import { enforce, type EnforceDeps } from '@bonded/enforcer';
import {
  canonicalHash,
  createEnforceDeps,
  failClosedTable,
  type ResolveFailure,
  type SchemaRegistry,
} from '@bonded/dispatcher';
import { fetchVendorTruth, issuerOracleVendors } from '@bonded/issuer-oracle';
import { INTERCEPTA_API_KEY_ENV, interceptaRisk } from '@bonded/intercepta-adapter';
import { proposeNaivePayment } from './naive-ap-agent.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS_PATH = join(HERE, '..', 'results.json');

// ─── Synthetic, non-sponsor test-harness values (legitimate per the task
//     brief: EnforceDeps' getCheckpoint/sumRecentSpend/logMismatch extras are
//     this package's own deterministic stand-ins, not fabricated Intercepta
//     or World data) ────────────────────────────────────────────────────────

/** Fixed synthetic checkpoint — `getCheckpoint()` pins exactly one value per `enforce()` call by design. */
const CHECKPOINT = 4200n;

/** Placeholder EVM-shaped addresses for the demo proposal's own `agent`/`action.target` fields (20 bytes, matching the convention `@bonded/dispatcher`'s own test fixtures use). Not real on-chain addresses. */
const NAIVE_AP_AGENT_ADDRESS = `0x${'aa'.repeat(20)}` as Address;
const AP_VAULT_TARGET_ADDRESS = `0x${'bb'.repeat(20)}` as Address;

interface MismatchLogEntry {
  proposalId: Hash32;
  premiseId: string;
  claimedValue: string;
  derivedValue: string;
}
const mismatchLog: MismatchLogEntry[] = [];

/**
 * `intercepta-risk` is wrapped in `failClosedTable`: an adapter throw (missing
 * key, HTTP error, unexpected shape) becomes `null`, which `enforce()` turns
 * into REFUSED / PREMISE_UNRESOLVABLE. The error is recorded in
 * `failureSink` and printed, so the refusal is never silent.
 */
export function buildHarnessRegistry(failureSink: ResolveFailure[]): SchemaRegistry {
  return {
    'issuer-oracle-vendors': issuerOracleVendors,
    'intercepta-risk': failClosedTable('intercepta-risk', interceptaRisk, (failure) => {
      failureSink.push(failure);
      console.log(`    [resolveFailure] ${failure.schema}/${failure.field} ${failure.errorName}: ${failure.message}`);
    }),
  };
}

function buildHarnessDeps(failureSink: ResolveFailure[]): EnforceDeps {
  return createEnforceDeps(buildHarnessRegistry(failureSink), {
    getCheckpoint: async () => CHECKPOINT,
    sumRecentSpend: async () => 0n,
    logMismatch: async (proposalId, premiseId, claimedValue, derivedValue) => {
      mismatchLog.push({ proposalId, premiseId, claimedValue, derivedValue });
      console.log(`    [logMismatch] premise=${premiseId} claimed=${claimedValue} derived=${derivedValue}`);
    },
  });
}

const coreResolveFailures: ResolveFailure[] = [];
const deps: EnforceDeps = buildHarnessDeps(coreResolveFailures);

// ─── Scenario scaffolding ───────────────────────────────────────────────────

interface ScenarioSpec {
  name: string;
  vendorId: string;
  proposal: Proposal;
  policy: PolicyArtifact;
  expected: { outcome: 0 | 1 | 2; reasonCode: ReasonCode };
}

interface ScenarioResult extends ScenarioSpec {
  onchainPolicyHash: Hash32;
  verdict: Verdict;
  pass: boolean;
}

export async function runScenario(spec: ScenarioSpec, scenarioDeps: EnforceDeps = deps): Promise<ScenarioResult> {
  // Simulates the on-chain-committed policy hash already matching the policy
  // being enforced against — see step 1 of `enforce()`. `canonicalHash` is
  // `@bonded/dispatcher`'s own authoritative implementation (see its doc
  // comment), not re-derived here.
  const onchainPolicyHash = canonicalHash(spec.policy);
  const verdict = await enforce(spec.proposal, spec.policy, onchainPolicyHash, scenarioDeps);
  const pass = verdict.outcome === spec.expected.outcome && verdict.reasonCode === spec.expected.reasonCode;
  return { ...spec, onchainPolicyHash, verdict, pass };
}

export function reasonCodeName(code: ReasonCode): string {
  return (Object.keys(ReasonCode) as Array<keyof typeof ReasonCode>).find(
    (k) => ReasonCode[k] === code,
  ) as string;
}

export function outcomeName(outcome: 0 | 1 | 2): string {
  return outcome === 0 ? 'CLEARED' : outcome === 1 ? 'REFUSED' : 'HELD_FOR_STEPUP';
}

// ─── Scenario 1: vnd-globex-freight, fraudulent payout address, held for review ───
// KEY-FREE policy: deliberately omits the intercepta-risk premise (see the
// file header). The full globex policy is `buildInterceptaScreenScenario`.

export async function buildScenario1(): Promise<ScenarioSpec> {
  const truth = await fetchVendorTruth('vnd-globex-freight');
  if (truth === null) throw new Error('vnd-globex-freight is missing from the real issuer-oracle fixture');

  // The naive AP agent's proposal: it read the spoofed page's claimed
  // (fraudulent) payout address and would pay it unconditionally.
  const naive = proposeNaivePayment('vnd-globex-freight', truth.invoiceAmountUSD);
  console.log(
    `  naive-ap-agent read claimed payout address from site/spoofed-invoice.html: ${naive.claimedPayoutAddress}`,
  );
  console.log(`  real payout address on file (issuer-oracle vendor-fixture):     ${truth.payoutAddress}`);

  const policy: PolicyArtifact = {
    version: 1,
    budget: { asset: 'USDC', period: 'daily', max: '100000000000' }, // $100,000.00 — not the point of this scenario
    premises: [
      {
        id: 'p-vendor-payout',
        schema: 'issuer-oracle-vendors',
        field: 'vendor.payoutAddress',
        op: 'eq',
        value: truth.payoutAddress, // documentation only — evaluatePremise compares claimedValue vs the live-resolved derived value, not this field
        args: ['vnd-globex-freight'],
        holdOnMismatch: true, // a bank-detail mismatch holds for human step-up, it does not hard-refuse
      },
    ],
    forbid: [],
    irreversibleAboveUSDC: '50000000000', // $50,000.00 — not the point of this scenario either
  };

  const proposal: Proposal = {
    id: `0x${'11'.repeat(32)}` as Hash32, // hand-authored placeholder id — no policy compiler in this build (disclosed scope limit)
    agent: NAIVE_AP_AGENT_ADDRESS,
    action: {
      kind: 'transfer',
      target: AP_VAULT_TARGET_ADDRESS,
      calldata: '0x',
      valueUSDC: truth.invoiceAmountUSD, // $8,450.00, 6-decimal base units, real fixture value
    },
    premises: [{ premiseId: 'p-vendor-payout', claimedValue: naive.claimedPayoutAddress }],
    createdAt: 1_790_200_000,
  };

  return {
    name: 'core-1-globex-fraudulent-payout-address',
    vendorId: 'vnd-globex-freight',
    proposal,
    policy,
    expected: { outcome: 2, reasonCode: ReasonCode.PREMISE_HELD_FOR_REVIEW },
  };
}

// ─── Scenario 2: vnd-suspended-corp, vendor.status mismatch, hard refuse ───
// KEY-FREE policy: no intercepta-risk premise.

export async function buildScenario2(): Promise<ScenarioSpec> {
  const truth = await fetchVendorTruth('vnd-suspended-corp');
  if (truth === null) throw new Error('vnd-suspended-corp is missing from the real issuer-oracle fixture');
  console.log(`  claimed vendor.status: active`);
  console.log(`  real vendor.status (issuer-oracle vendor-fixture): ${truth.status}`);

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
        args: ['vnd-suspended-corp'],
        // holdOnMismatch intentionally unset (default false): a suspended
        // vendor is a hard refuse, not a step-up hold.
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
    name: 'core-2-suspended-corp-status-mismatch',
    vendorId: 'vnd-suspended-corp',
    proposal,
    policy,
    expected: { outcome: 1, reasonCode: ReasonCode.PREMISE_MISMATCH },
  };
}

// ─── Scenario 3: vnd-acme-supplies, correct matching claim, cleared ───
// KEY-FREE policy: no intercepta-risk premise.

export async function buildScenario3(): Promise<ScenarioSpec> {
  const truth = await fetchVendorTruth('vnd-acme-supplies');
  if (truth === null) throw new Error('vnd-acme-supplies is missing from the real issuer-oracle fixture');
  console.log(`  claimed payout address (correct): ${truth.payoutAddress}`);
  console.log(`  claimed vendor.status (correct):   ${truth.status}`);

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
        args: ['vnd-acme-supplies'],
      },
      {
        id: 'p-vendor-status',
        schema: 'issuer-oracle-vendors',
        field: 'vendor.status',
        op: 'eq',
        value: 'active',
        args: ['vnd-acme-supplies'],
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
      valueUSDC: truth.invoiceAmountUSD, // $1,250.00
    },
    premises: [
      { premiseId: 'p-vendor-payout', claimedValue: truth.payoutAddress },
      { premiseId: 'p-vendor-status', claimedValue: truth.status },
    ],
    createdAt: 1_790_200_200,
  };

  return {
    name: 'core-3-acme-supplies-correct-claim',
    vendorId: 'vnd-acme-supplies',
    proposal,
    policy,
    expected: { outcome: 0, reasonCode: ReasonCode.OK },
  };
}

// ─── Scenario 4 (key-gated): live Intercepta screen of the claimed EVM identity ───

export const INTERCEPTA_SCREEN_PREMISE_ID = 'p-payee-evm-screen';

/**
 * The screening premise: "the payee's claimed EVM identity has NO documented
 * Intercepta risk trait". Field `payment.payTo.traitCount` is Deep Scan
 * (`/account/{address}/toxic-score`) `traits.length`; op `lte`, value `0`.
 *
 * Why a trait count and not `toxicScore`: `toxicScore` has NO documented
 * range or direction (docs/VERIFY_FINDINGS.md item 5: "`toxicScore` is a
 * number with **no documented range**"), so any threshold on it would be
 * invented. The trait list needs no threshold, because the docs define every
 * entry as a risk indicator, not a neutral label:
 *   - `ToxicScoreShortResponseV2.traits`: "List of suspicious activities
 *     detected on the address" (OAS at
 *     https://docs.web3antivirus.io/reference/scan-address.md, fetched
 *     2026-09-26; same text in intercepta-adapter/src/client.ts).
 *   - `ToxicScoreTraitV2.risk`: "Risk level of the trait".
 *   - `name` enum (VERIFY_FINDINGS item 5, client.ts DOCUMENTED_TRAIT_NAMES):
 *     known_scammer, initiator_scam_transactions,
 *     sanction_address_communication, suspicious_dex_pair_deployer,
 *     suspicious_deployer, attack_money_target, zero_address_risk,
 *     sanction_address, fake_phishing_transfer, non_kyc_transfers,
 *     mixer_transfers, fake_phishing_contract_communication, rug_pull,
 *     rug_pull_trader, blacklist. Every value names a risk; none is benign.
 *   - Deep Scan prose (docs/reference/intercepta-api-docs.md lines 2177-2186):
 *     "Checks if the address has involvement in phishing, blackmail, stealing
 *     attacks, and more"; monitored: "Money laundering and sanctions flags".
 * So ANY trait is a mismatch. The per-trait `risk` number is NOT used,
 * because its range is also undocumented. A zero count means "no trait
 * returned", not "confirmed clean"; that is the most this premise claims.
 *
 * `holdOnMismatch` is deliberately UNSET: a trait on the payee identity is a
 * hard REFUSE, never a step-up hold a human could approve.
 *
 * `claimedValue` is always `'0'`, set by the builder and never taken from the
 * invoice: by attempting to pay, the agent implicitly asserts that the payee
 * carries no risk trait. This works the same way as the `'active'` status
 * claim in packages/mcp-server.
 */
export function payeeEvmScreenPremise(claimedPayeeEvmAddress: string): PolicyArtifact['premises'][number] {
  return {
    id: INTERCEPTA_SCREEN_PREMISE_ID,
    schema: 'intercepta-risk',
    field: 'payment.payTo.traitCount',
    op: 'lte',
    value: '0',
    args: [claimedPayeeEvmAddress],
  };
}

/**
 * The globex spoofed invoice with the FULL policy. Premise ORDER matters,
 * because `enforce()` returns on the FIRST mismatch:
 *   1. `p-payee-evm-screen` (intercepta-risk, hard refuse) runs FIRST.
 *   2. `p-vendor-payout` (holdOnMismatch: true) runs second.
 * If the payout premise ran first, the address mismatch would return
 * HELD_FOR_STEPUP before the screen was reached. A human reviewer could then
 * approve a payment to a sanctioned identity. With the screen first, a
 * sanctioned identity is REFUSED, and a failed or unkeyed screen is REFUSED
 * too (PREMISE_UNRESOLVABLE). No hold is produced in either case.
 */
export async function buildInterceptaScreenScenario(): Promise<ScenarioSpec> {
  const truth = await fetchVendorTruth('vnd-globex-freight');
  if (truth === null) throw new Error('vnd-globex-freight is missing from the real issuer-oracle fixture');
  const naive = proposeNaivePayment('vnd-globex-freight', truth.invoiceAmountUSD);
  console.log(`  claimed EVM identity (read from site/spoofed-invoice.html): ${naive.claimedPayeeEvmAddress}`);
  console.log(`  registered EVM identity on file (issuer-oracle, synthetic): ${truth.evmAddress}`);
  console.log(`  claimed Sui payout address: ${naive.claimedPayoutAddress}`);

  const policy: PolicyArtifact = {
    version: 1,
    budget: { asset: 'USDC', period: 'daily', max: '100000000000' },
    premises: [
      payeeEvmScreenPremise(naive.claimedPayeeEvmAddress), // FIRST — see the doc comment above
      {
        id: 'p-vendor-payout',
        schema: 'issuer-oracle-vendors',
        field: 'vendor.payoutAddress',
        op: 'eq',
        value: truth.payoutAddress,
        args: ['vnd-globex-freight'],
        holdOnMismatch: true,
      },
    ],
    forbid: [],
    irreversibleAboveUSDC: '50000000000',
  };

  const proposal: Proposal = {
    id: `0x${'44'.repeat(32)}` as Hash32,
    agent: NAIVE_AP_AGENT_ADDRESS,
    action: { kind: 'transfer', target: AP_VAULT_TARGET_ADDRESS, calldata: '0x', valueUSDC: truth.invoiceAmountUSD },
    premises: [
      { premiseId: INTERCEPTA_SCREEN_PREMISE_ID, claimedValue: '0' },
      { premiseId: 'p-vendor-payout', claimedValue: naive.claimedPayoutAddress },
    ],
    createdAt: 1_790_200_300,
  };

  return {
    name: 'keygated-4-globex-sanctioned-evm-identity-screen',
    vendorId: 'vnd-globex-freight',
    proposal,
    policy,
    // Expected ONLY for a live, keyed run: the claimed identity is on the
    // OFAC SDN list, so Deep Scan is expected to return at least one trait.
    // This is an expectation that the live run checks. It is not an assumed
    // result: if the live run disagrees, the scenario is reported as failing.
    expected: { outcome: 1, reasonCode: ReasonCode.PREMISE_MISMATCH },
  };
}

interface VerdictSummary {
  outcome: 0 | 1 | 2;
  outcomeName: string;
  reasonCode: ReasonCode;
  reasonCodeName: string;
}

export interface InterceptaScreenResult {
  /**
   * - `not_run_missing_key`: no key, so the live screen did not run. Never a pass.
   * - `error`: a key was present, but the live call failed. Never a pass.
   * - `ran`: a live response was received and evaluated.
   */
  status: 'not_run_missing_key' | 'error' | 'ran';
  screenedAddress: string;
  expected: { outcome: 0 | 1 | 2; reasonCode: ReasonCode };
  /** The real `enforce()` verdict. Without a key, this is the fail-closed refusal. */
  actual: VerdictSummary;
  resolveFailures: ResolveFailure[];
  /** True only for `status: 'ran'` with the expected verdict. */
  pass: boolean;
  reason: string;
}

export async function runInterceptaScreenScenario(): Promise<InterceptaScreenResult> {
  const spec = await buildInterceptaScreenScenario();
  const screenedAddress = spec.policy.premises[0]?.args?.[0] ?? '';
  const key = process.env[INTERCEPTA_API_KEY_ENV];
  const hasKey = key !== undefined && key.trim() !== '';

  const failures: ResolveFailure[] = [];
  const result = await runScenario(spec, buildHarnessDeps(failures));
  const actual: VerdictSummary = {
    outcome: result.verdict.outcome,
    outcomeName: outcomeName(result.verdict.outcome),
    reasonCode: result.verdict.reasonCode,
    reasonCodeName: reasonCodeName(result.verdict.reasonCode),
  };

  if (!hasKey) {
    return {
      status: 'not_run_missing_key',
      screenedAddress,
      expected: spec.expected,
      actual,
      resolveFailures: failures,
      pass: false,
      reason:
        `not run: missing key. ${INTERCEPTA_API_KEY_ENV} is not set, so no live Intercepta screen happened and no ` +
        `Intercepta result exists. enforce() failed closed: ${actual.outcomeName} / ${actual.reasonCodeName}. ` +
        'No mocked or fallback response was substituted (CLAUDE.md rule 1).',
    };
  }
  if (failures.length > 0) {
    return {
      status: 'error',
      screenedAddress,
      expected: spec.expected,
      actual,
      resolveFailures: failures,
      pass: false,
      reason: `live Intercepta screen failed: ${failures.map((f) => `${f.errorName}: ${f.message}`).join('; ')}`,
    };
  }
  return {
    status: 'ran',
    screenedAddress,
    expected: spec.expected,
    actual,
    resolveFailures: failures,
    pass: result.pass,
    reason: result.pass
      ? 'live screen returned at least one documented risk trait; refused before the payout hold'
      : `live screen verdict ${actual.outcomeName} / ${actual.reasonCodeName} did not match the expected REFUSED / PREMISE_MISMATCH`,
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('='.repeat(78));
  console.log('Bonded villain-corpus — BEC / vendor-invoice-fraud harness (no mocks)');
  console.log('='.repeat(78));

  console.log('\n[scenario 1] vnd-globex-freight — naive agent pays the spoofed page\'s claimed address');
  const spec1 = await buildScenario1();
  const result1 = await runScenario(spec1);

  console.log('\n[scenario 2] vnd-suspended-corp — vendor.status premise mismatch');
  const spec2 = await buildScenario2();
  const result2 = await runScenario(spec2);

  console.log('\n[scenario 3] vnd-acme-supplies — correct, matching claim');
  const spec3 = await buildScenario3();
  const result3 = await runScenario(spec3);

  const coreResults = [result1, result2, result3];

  console.log('\n' + '-'.repeat(78));
  console.log('SUMMARY — core scenarios (always run, deterministic, no network)');
  console.log('-'.repeat(78));
  for (const r of coreResults) {
    const status = r.pass ? 'PASS' : 'FAIL';
    console.log(
      `[${status}] ${r.name}\n` +
        `       expected: outcome=${outcomeName(r.expected.outcome)} reasonCode=${reasonCodeName(r.expected.reasonCode)}\n` +
        `       actual:   outcome=${outcomeName(r.verdict.outcome)} reasonCode=${reasonCodeName(r.verdict.reasonCode)}\n` +
        `       verdict.logRef=${r.verdict.logRef} verdict.blockChecked=${r.verdict.blockChecked}`,
    );
  }

  console.log('\n[scenario 4, key-gated] vnd-globex-freight — full policy, Intercepta screen of the claimed EVM identity first');
  const screen = await runInterceptaScreenScenario();
  console.log('\n' + '-'.repeat(78));
  console.log('SUMMARY — scenario 4 (live Intercepta screen, key-gated; never counted as a pass without a live run)');
  console.log('-'.repeat(78));
  const screenLabel =
    screen.status === 'ran' ? (screen.pass ? 'PASS' : 'FAIL') : screen.status === 'error' ? 'ERROR' : 'NOT RUN';
  console.log(
    `[${screenLabel}] status=${screen.status} screenedAddress=${screen.screenedAddress}\n` +
      `       expected (live): outcome=${outcomeName(screen.expected.outcome)} reasonCode=${reasonCodeName(screen.expected.reasonCode)}\n` +
      `       actual:          outcome=${screen.actual.outcomeName} reasonCode=${screen.actual.reasonCodeName}\n` +
      `       reason: ${screen.reason}`,
  );

  const allCorePassed = coreResults.every((r) => r.pass);
  console.log('\n' + '='.repeat(78));
  console.log(allCorePassed ? 'ALL CORE SCENARIOS PASSED' : 'AT LEAST ONE CORE SCENARIO FAILED');
  console.log('='.repeat(78));

  // ─── results.json — this package's own file, structurally similar to but
  //     entirely separate from packages/attack-corpus/results.json ─────────
  const output = {
    generatedAt: new Date().toISOString(),
    coreScenarios: coreResults.map((r) => ({
      name: r.name,
      vendorId: r.vendorId,
      proposal: r.proposal,
      policy: r.policy,
      expected: { outcome: r.expected.outcome, reasonCode: r.expected.reasonCode, reasonCodeName: reasonCodeName(r.expected.reasonCode) },
      actual: {
        outcome: r.verdict.outcome,
        reasonCode: r.verdict.reasonCode,
        reasonCodeName: reasonCodeName(r.verdict.reasonCode),
        proposalHash: r.verdict.proposalHash,
        policyHash: r.verdict.policyHash,
        blockChecked: r.verdict.blockChecked.toString(),
        logRef: r.verdict.logRef,
      },
      pass: r.pass,
    })),
    mismatchLog,
    interceptaScreenScenario: screen,
    allCorePassed,
  };

  writeFileSync(RESULTS_PATH, JSON.stringify(output, bigintSafeReplacer, 2) + '\n', 'utf8');
  console.log(`\nWrote ${RESULTS_PATH}`);

  if (!allCorePassed) {
    process.exitCode = 1;
  }
}

function bigintSafeReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value;
}

// Only run `main()` when this file is executed directly (`tsx harness/run.ts`,
// this package's own `demo` script), never as a side effect of another module
// importing it — `harness/__tests__/run.test.ts` imports `buildScenario1`/
// `runScenario` etc. directly and must not trigger a full harness run (with
// its live-Intercepta-gated scenario and `results.json` write) just by doing so.
const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  main().catch((error) => {
    console.error('villain-corpus harness failed:', error);
    process.exitCode = 1;
  });
}
