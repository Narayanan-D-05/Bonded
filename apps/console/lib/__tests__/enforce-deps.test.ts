/**
 * Console composition tests: the one AP policy, the five invoices, real `enforce()` calls, the
 * settle-once ledger, and the World approval → vendor-master write → re-enforce → settle chain.
 *
 * What is real here and what stands in, stated plainly:
 *  - REAL: `enforce()`, the dispatcher (incl. `bindClaimArgs`, `failClosedTable`), the vendor
 *    fixture + change-log overlay (written to a temp dir), the settlement ledger (temp dir),
 *    `approveStepUpForSettlement` → the real `decideStepUp`, `deriveVendorRecipient`.
 *  - STAND-INS, unit tests only, at the chain/sponsor boundary:
 *    · `chain`: `readPolicyHash` returns the canonicalHash of the committed policy (the live read
 *      is exercised by the console route against testnet, recorded in move/DEPLOYMENTS.md);
 *      `readVaultSpent` returns a fixed number; `settleCleared`/`settleWithStepUp` RECORD the call
 *      and return a result whose digest is the literal 'TEST-ONLY-NOT-A-DIGEST'. Nothing is
 *      submitted.
 *    · World: `HandleCallbackResult` values stand in for "handleCallback already ran and returned
 *      this", the convention @bonded/world-agents' own gate tests use.
 *    · Intercepta: INTERCEPTA_API_KEY is removed for the whole file, so the real adapter fails
 *      closed. Only the two held-chain tests pass `screening: ZERO_TRAITS_STANDIN` to reach the
 *      held branch; that table is never reachable from any route.
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Address, Hash32 } from '@bonded/seam';
import { ReasonCode } from '@bonded/seam';
import { canonicalHash, type SchemaFieldTable } from '@bonded/dispatcher';
import {
  createFixtureVendorSourceWithChanges,
  createVendorMasterBankChangeWriter,
  fetchVendorTruth,
  readVendorMasterChanges,
} from '@bonded/issuer-oracle';
import type { SettleClearedInput, SettlementResult, SettleWithStepUpInput } from '@bonded/sui-settlement';
import { STEPUP_FRESHNESS_WINDOW_MS } from '@bonded/world-agents';
import { AP_AGENT_ADDRESS, AP_AGENT_POLICY } from '../ap-policy.js';
import {
  DEMO_INVOICE_IDS,
  GLOBEX_NEW_BANK_PAYOUT_ADDRESS,
  OnchainPolicyError,
  buildDemoInvoice,
  findInvoiceIdByProposalHash,
  isDemoInvoiceId,
  listDemoInvoices,
  missingWorldEnvVars,
  proposalIdFor,
  runEnforceForInvoice,
  serializeVerdict,
  type ChainPort,
  type ConsoleContext,
} from '../enforce-deps.js';
import { completeStepUp, proposePayment } from '../payment.js';
import { SettlementLedger, isPreSubmissionFailure } from '../settlement-ledger.js';

let savedKey: string | undefined;
beforeAll(() => {
  savedKey = process.env['INTERCEPTA_API_KEY'];
  delete process.env['INTERCEPTA_API_KEY'];
});
afterAll(() => {
  if (savedKey !== undefined) process.env['INTERCEPTA_API_KEY'] = savedKey;
});

const NOW = 1_790_400_000_000;
const COMMITTED_HASH = canonicalHash(AP_AGENT_POLICY);

/** Test-only: stands in for "the live Intercepta deep scan returned zero traits". Never used by app code. */
const ZERO_TRAITS_STANDIN: SchemaFieldTable = { fields: { 'payment.payTo.traitCount': async () => 0n } };

interface Recorder {
  cleared: SettleClearedInput[];
  stepup: SettleWithStepUpInput[];
}

function fakeResult(input: SettleClearedInput): SettlementResult {
  return {
    digest: 'TEST-ONLY-NOT-A-DIGEST',
    explorerUrl: 'https://suiscan.xyz/testnet/tx/TEST-ONLY-NOT-A-DIGEST',
    vendorId: input.recipient.vendorId,
    recipient: input.recipient.address,
    valueUsdc: input.valueUsdc,
    settled: { vaultId: '0x1', recipient: input.recipient.address, valueUsdc: input.valueUsdc, spentThisPeriod: 0n, viaStepup: false },
    recipientBalanceDelta: input.valueUsdc,
    payoutCoinId: '0x2',
    payoutCoinBalance: input.valueUsdc,
    gas: { computationCost: 0n, storageCost: 0n, storageRebate: 0n, netMist: 0n },
  };
}

function testContext(over: Partial<ChainPort> = {}, screening?: SchemaFieldTable): { ctx: ConsoleContext; rec: Recorder; logPath: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'bonded-console-'));
  const logPath = path.join(dir, 'vendor-master-changes.json');
  const rec: Recorder = { cleared: [], stepup: [] };
  const chain: ChainPort = {
    readPolicyHash: async () => COMMITTED_HASH,
    readVaultSpent: async () => 1_251_000_000n,
    settleCleared: async (input) => {
      rec.cleared.push(input);
      return fakeResult(input);
    },
    settleWithStepUp: async (input) => {
      rec.stepup.push(input);
      return fakeResult(input);
    },
    ...over,
  };
  const ctx: ConsoleContext = {
    chain,
    vendorSource: createFixtureVendorSourceWithChanges(logPath),
    ledger: new SettlementLedger(path.join(dir, 'settlements.json')),
    writeBankChange: createVendorMasterBankChangeWriter({} as NodeJS.ProcessEnv, { changeLogPath: logPath }),
    ...(screening ? { screening } : {}),
  };
  return { ctx, rec, logPath };
}

describe('the ONE AP agent policy', () => {
  it('has per-vendor premise ids, and no premise value embeds a vendor-master fact (hash stays stable across bank changes)', async () => {
    const ids = AP_AGENT_POLICY.premises.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^p-(acme|globex|suspended|halcyon)-(payout|status|screen|evm-identity)$/);
    const values = AP_AGENT_POLICY.premises.map((p) => p.value);
    for (const id of ['vnd-acme-supplies', 'vnd-globex-freight', 'vnd-suspended-corp', 'vnd-halcyon-machining']) {
      const t = (await fetchVendorTruth(id))!;
      expect(values).not.toContain(t.payoutAddress);
      expect(values).not.toContain(t.evmAddress);
    }
  });

  it('every invoice claims only its own vendor\'s premises, each defined in the policy; holds come last', async () => {
    for (const invoiceId of DEMO_INVOICE_IDS) {
      const inv = await buildDemoInvoice(invoiceId, fetchVendorTruth);
      expect(inv.policy).toBe(AP_AGENT_POLICY);
      const prefix = inv.proposal.premises[0]!.premiseId.split('-')[1];
      for (const [i, claim] of inv.proposal.premises.entries()) {
        const def = AP_AGENT_POLICY.premises.find((p) => p.id === claim.premiseId);
        expect(def).toBeDefined();
        expect(claim.premiseId.split('-')[1]).toBe(prefix);
        if (def!.holdOnMismatch) expect(i).toBe(inv.proposal.premises.length - 1);
      }
    }
  });

  it('screens bind to the claimed EVM identity; irreversible threshold holds only halcyon', async () => {
    const screens = AP_AGENT_POLICY.premises.filter((p) => p.schema === 'intercepta-risk');
    expect(screens.map((p) => p.args)).toEqual([['claim:p-globex-evm-identity'], ['claim:p-halcyon-evm-identity']]);
    const threshold = BigInt(AP_AGENT_POLICY.irreversibleAboveUSDC);
    for (const invoiceId of DEMO_INVOICE_IDS) {
      const inv = await buildDemoInvoice(invoiceId, fetchVendorTruth);
      expect(BigInt(inv.proposal.action.valueUSDC) > threshold).toBe(invoiceId === 'inv-halcyon-machining');
    }
  });
});

describe('demo invoices', () => {
  it('lists five invoices with distinct deterministic proposal ids, recoverable by hash', async () => {
    const invoices = await listDemoInvoices(fetchVendorTruth);
    expect(invoices.map((i) => i.invoiceId)).toEqual([...DEMO_INVOICE_IDS]);
    expect(new Set(invoices.map((i) => i.proposal.id)).size).toBe(5);
    for (const inv of invoices) {
      expect(inv.proposal.id).toBe(proposalIdFor(inv.invoiceId));
      expect(findInvoiceIdByProposalHash(inv.proposal.id.toUpperCase().replace('0X', '0x'))).toBe(inv.invoiceId);
      expect(inv.proposal.agent).toBe(AP_AGENT_ADDRESS);
    }
    expect(findInvoiceIdByProposalHash(`0x${'33'.repeat(32)}`)).toBeNull();
    expect(isDemoInvoiceId('inv-acme-supplies')).toBe(true);
    expect(isDemoInvoiceId('vnd-acme-supplies')).toBe(false);
  });

  it('the spoofed globex claims match site/spoofed-invoice.html exactly (no drift)', async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const html = readFileSync(join(here, '..', '..', '..', '..', 'packages', 'villain-corpus', 'site', 'spoofed-invoice.html'), 'utf8');
    const inv = await buildDemoInvoice('inv-globex-spoofed', fetchVendorTruth);
    expect(html).toMatch(new RegExp(`id="fraudulent-payout-address"[^>]*data-address="${inv.claimedPayoutAddress}"`));
    expect(html).toMatch(new RegExp(`id="claimed-evm-identity"[^>]*data-address="${inv.claimedPayeeEvmAddress}"`));
  });

  it('the genuine bank change claims globex\'s registered EVM identity and a new, documented synthetic payout address', async () => {
    const inv = await buildDemoInvoice('inv-globex-bank-change', fetchVendorTruth);
    const truth = (await fetchVendorTruth('vnd-globex-freight'))!;
    expect(inv.claimedPayeeEvmAddress).toBe(truth.evmAddress);
    expect(inv.claimedPayoutAddress).not.toBe(truth.payoutAddress);
    const { createHash } = await import('node:crypto');
    expect(GLOBEX_NEW_BANK_PAYOUT_ADDRESS).toBe(
      `0x${createHash('sha256').update('bonded-synthetic-sui-payout:vnd-globex-freight:bank-change', 'utf8').digest('hex')}`,
    );
  });
});

describe('runEnforceForInvoice: real enforce(), on-chain policy hash, no key', () => {
  it('acme CLEARS, reading the vault spend for the budget step', async () => {
    const { ctx } = testContext();
    const r = await runEnforceForInvoice('inv-acme-supplies', ctx);
    expect(r.verdict.outcome).toBe(0);
    expect(r.onchainPolicyHash).toBe(COMMITTED_HASH);
    expect(r.vaultSpentUsdc).toBe(1_251_000_000n);
    expect(r.premises.map((p) => p.derivedValue === p.claimedValue)).toEqual([true, true]);
  });

  it('both globex invoices and halcyon REFUSE fail-closed without a key, with the key error attached', async () => {
    const { ctx } = testContext();
    for (const id of ['inv-globex-spoofed', 'inv-globex-bank-change', 'inv-halcyon-machining'] as const) {
      const r = await runEnforceForInvoice(id, ctx);
      expect(r.verdict.outcome).toBe(1);
      expect(r.verdict.reasonCode).toBe(ReasonCode.PREMISE_UNRESOLVABLE);
      expect(r.screeningErrors[0]?.errorName).toBe('InterceptaKeyMissingError');
      // The screen was asked about the CLAIMED identity (bound from the proposal).
      expect(r.screeningErrors[0]?.args).toEqual([r.invoice.claimedPayeeEvmAddress]);
      expect(r.premises).toHaveLength(1);
    }
  });

  it('suspended-corp REFUSES / PREMISE_MISMATCH', async () => {
    const { ctx } = testContext();
    const r = await runEnforceForInvoice('inv-suspended-corp', ctx);
    expect(r.verdict.outcome).toBe(1);
    expect(r.verdict.reasonCode).toBe(ReasonCode.PREMISE_MISMATCH);
    expect(r.mismatches[0]?.derivedValue).toBe('suspended');
  });

  it('a spoofed identity is refused by the identity premise even when the screen passes (never held)', async () => {
    const { ctx } = testContext({}, ZERO_TRAITS_STANDIN);
    const r = await runEnforceForInvoice('inv-globex-spoofed', ctx);
    expect(r.verdict.outcome).toBe(1);
    expect(r.mismatches[0]?.premiseId).toBe('p-globex-evm-identity');
  });

  it('fails visibly when the on-chain policy read fails or is missing, never recomputing locally', async () => {
    await expect(runEnforceForInvoice('inv-acme-supplies', testContext({ readPolicyHash: async () => null }).ctx)).rejects.toThrow(OnchainPolicyError);
    await expect(
      runEnforceForInvoice('inv-acme-supplies', testContext({ readPolicyHash: async () => { throw new Error('grpc down'); } }).ctx),
    ).rejects.toThrow(/grpc down.*never recomputed locally/);
  });

  it('a stale on-chain hash REFUSES / STALE_POLICY', async () => {
    const r = await runEnforceForInvoice('inv-acme-supplies', testContext({ readPolicyHash: async () => `0x${'00'.repeat(32)}` as Hash32 }).ctx);
    expect(r.verdict.reasonCode).toBe(ReasonCode.STALE_POLICY);
  });

  it('the vault\'s on-chain spend feeds the budget: over budget REFUSES / BUDGET_EXCEEDED', async () => {
    const r = await runEnforceForInvoice('inv-acme-supplies', testContext({ readVaultSpent: async () => 99_999_000_000n }).ctx);
    expect(r.verdict.reasonCode).toBe(ReasonCode.BUDGET_EXCEEDED);
  });
});

describe('proposePayment: CLEARED settles once per proposal', () => {
  it('acme settles to the vendor-master address; a second proposal returns the recorded digest without paying again', async () => {
    const { ctx, rec } = testContext();
    const first = await proposePayment('inv-acme-supplies', ctx);
    expect(first.settlement).toMatchObject({ status: 'settled', alreadySettled: false, digest: 'TEST-ONLY-NOT-A-DIGEST' });
    expect(rec.cleared).toHaveLength(1);
    expect(rec.cleared[0]!.recipient.address).toBe((await fetchVendorTruth('vnd-acme-supplies'))!.payoutAddress);
    expect(rec.cleared[0]!.valueUsdc).toBe(1_250_000_000n);

    const second = await proposePayment('inv-acme-supplies', ctx);
    expect(second.settlement).toMatchObject({ status: 'settled', alreadySettled: true, digest: 'TEST-ONLY-NOT-A-DIGEST' });
    expect(rec.cleared).toHaveLength(1);
  });

  it('two concurrent proposals of the same invoice pay once', async () => {
    const { ctx, rec } = testContext();
    const [a, b] = await Promise.all([proposePayment('inv-acme-supplies', ctx), proposePayment('inv-acme-supplies', ctx)]);
    expect(rec.cleared).toHaveLength(1);
    expect([a.settlement, b.settlement].every((s) => s.status === 'settled')).toBe(true);
  });

  it('refused and held verdicts never settle', async () => {
    const { ctx, rec } = testContext();
    expect((await proposePayment('inv-suspended-corp', ctx)).settlement.status).toBe('not-settled');
    expect((await proposePayment('inv-globex-spoofed', ctx)).settlement.status).toBe('not-settled');
    expect(rec.cleared).toHaveLength(0);
  });

  it('a failure after submission may have happened is recorded as unknown and never retried', async () => {
    let calls = 0;
    const { ctx } = testContext({
      settleCleared: async () => {
        calls += 1;
        throw Object.assign(new Error('confirmation timed out'), { name: 'SettlementConfirmationError' });
      },
    });
    expect((await proposePayment('inv-acme-supplies', ctx)).settlement).toMatchObject({ status: 'failed' });
    expect((await proposePayment('inv-acme-supplies', ctx)).settlement).toMatchObject({ status: 'unknown' });
    expect(calls).toBe(1);
  });

  it('a pre-submission failure (e.g. missing SUI config) is retryable', async () => {
    let calls = 0;
    const { ctx } = testContext({
      settleCleared: async () => {
        calls += 1;
        throw Object.assign(new Error('SUI_VAULT_ID is not set'), { name: 'SettlementConfigError' });
      },
    });
    await proposePayment('inv-acme-supplies', ctx);
    await proposePayment('inv-acme-supplies', ctx);
    expect(calls).toBe(2);
    expect(isPreSubmissionFailure(Object.assign(new Error('Dry run did not succeed; nothing was submitted. x'), { name: 'SuiCliError' }))).toBe(true);
    expect(isPreSubmissionFailure(Object.assign(new Error('sui client ptb failed'), { name: 'SuiCliError' }))).toBe(false);
  });
});

describe('completeStepUp: real decideStepUp over handleCallback-shaped inputs', () => {
  const verified = (authTimeMs = NOW - 1_000) => ({ verified: true as const, sub: 'world-sub-test', authTimeMs });

  it('bank change: approval writes the claimed address to the vendor master, re-enforces to CLEARED, and settles to the UPDATED truth', async () => {
    const { ctx, rec, logPath } = testContext({}, ZERO_TRAITS_STANDIN);
    const held = await runEnforceForInvoice('inv-globex-bank-change', ctx);
    expect(serializeVerdict(held.verdict)).toMatchObject({ outcomeLabel: 'HELD_FOR_STEPUP', reasonCodeLabel: 'PREMISE_HELD_FOR_REVIEW' });
    // Nothing is paid while held.
    expect((await proposePayment('inv-globex-bank-change', ctx)).settlement.status).toBe('not-settled');

    const out = await completeStepUp(held.verdict.proposalHash, verified(), ctx, NOW);
    expect(out.kind).toBe('approved');
    if (out.kind !== 'approved') return;
    expect(out.holdReason).toBe('PREMISE_HELD_FOR_REVIEW');
    expect(out.vendorMasterChange).toEqual({
      previousPayoutAddress: '0xcbd8e5f2ff0c192633404d5a6774818e9ba8b5c2cfdce9f603101d2a3744515e',
      newPayoutAddress: GLOBEX_NEW_BANK_PAYOUT_ADDRESS,
      appliedTo: 'fixture-overlay',
    });
    expect(out.reenforcedVerdict?.outcomeLabel).toBe('CLEARED');
    expect(out.settlement.status).toBe('settled');

    const log = await readVendorMasterChanges(logPath);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ approvedBy: { worldSub: 'world-sub-test', authTimeMs: NOW - 1_000 }, proposalHash: held.verdict.proposalHash });
    expect(rec.cleared).toHaveLength(1);
    expect(rec.cleared[0]!.recipient.address).toBe(GLOBEX_NEW_BANK_PAYOUT_ADDRESS);
    expect(rec.stepup).toHaveLength(0);

    // The spoofed invoice is still refused against the updated vendor master.
    expect((await runEnforceForInvoice('inv-globex-spoofed', ctx)).verdict.outcome).toBe(1);
    // Proposing the bank-change invoice again returns the recorded payment.
    expect((await proposePayment('inv-globex-bank-change', ctx)).settlement).toMatchObject({ status: 'settled', alreadySettled: true });
    expect(rec.cleared).toHaveLength(1);
  });

  it('a denied or stale World result writes nothing and pays nothing', async () => {
    const { ctx, rec, logPath } = testContext({}, ZERO_TRAITS_STANDIN);
    const hash = proposalIdFor('inv-globex-bank-change');
    expect(await completeStepUp(hash, { denied: true, reason: 'access_denied' }, ctx, NOW)).toMatchObject({ kind: 'denied', reason: 'access_denied' });
    expect(await completeStepUp(hash, verified(NOW - STEPUP_FRESHNESS_WINDOW_MS - 1), ctx, NOW)).toMatchObject({
      kind: 'denied',
      reason: 'stale_authentication',
    });
    expect(await completeStepUp(hash, { expired: true }, ctx, NOW)).toMatchObject({ kind: 'denied', reason: 'token_expired' });
    expect(await readVendorMasterChanges(logPath)).toHaveLength(0);
    expect(rec.cleared.length + rec.stepup.length).toBe(0);
  });

  it('irreversible: approval settles halcyon through settleWithStepUp with a certified approval, to the on-file address, once', async () => {
    const { ctx, rec, logPath } = testContext({}, ZERO_TRAITS_STANDIN);
    const held = await runEnforceForInvoice('inv-halcyon-machining', ctx);
    expect(held.verdict.reasonCode).toBe(ReasonCode.IRREVERSIBLE_UNCONFIRMED);
    const out = await completeStepUp(held.verdict.proposalHash, verified(), ctx, NOW);
    expect(out).toMatchObject({ kind: 'approved', holdReason: 'IRREVERSIBLE_UNCONFIRMED', vendorMasterChange: null });
    expect(rec.stepup).toHaveLength(1);
    expect(rec.stepup[0]!.recipient.address).toBe((await fetchVendorTruth('vnd-halcyon-machining'))!.payoutAddress as Address);
    expect(rec.stepup[0]!.stepUpDecision.proposalHash).toBe(held.verdict.proposalHash);
    expect(rec.stepup[0]!.valueUsdc).toBe(15_000_000_000n);
    expect(await readVendorMasterChanges(logPath)).toHaveLength(0);

    // A second approval for the same proposal never pays again.
    const again = await completeStepUp(held.verdict.proposalHash, verified(), ctx, NOW);
    expect(again.kind === 'approved' && again.settlement).toMatchObject({ status: 'settled', alreadySettled: true });
    expect(rec.stepup).toHaveLength(1);
  });

  it('refuses to step up a proposal that is not held, or unknown', async () => {
    const { ctx } = testContext();
    expect(await completeStepUp(proposalIdFor('inv-acme-supplies'), verified(), ctx, NOW)).toMatchObject({ kind: 'not-held' });
    expect(await completeStepUp(`0x${'ff'.repeat(32)}` as Hash32, verified(), ctx, NOW)).toEqual({ kind: 'unknown-proposal' });
  });
});

describe('missingWorldEnvVars', () => {
  it('names every missing var and nothing else', () => {
    expect(missingWorldEnvVars({})).toEqual(['WORLD_SANDBOX_CLIENT_ID', 'WORLD_SANDBOX_CLIENT_SECRET', 'WORLD_REDIRECT_URI']);
    expect(
      missingWorldEnvVars({ WORLD_SANDBOX_CLIENT_ID: 'x', WORLD_SANDBOX_CLIENT_SECRET: 'y', WORLD_REDIRECT_URI: 'https://example.test/cb' }),
    ).toEqual([]);
  });
});
