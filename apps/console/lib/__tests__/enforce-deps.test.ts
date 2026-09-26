import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReasonCode } from '@bonded/seam';
import {
  PAYEE_EVM_SCREEN_PREMISE_ID,
  DEMO_VENDOR_IDS,
  buildConsoleEnforceDeps,
  buildDemoInvoice,
  buildPremiseDiffs,
  findHeldInvoiceByProposalHash,
  isDemoVendorId,
  listDemoInvoices,
  missingWorldEnvVars,
  reasonCodeLabel,
  registry,
  runEnforceForInvoice,
  serializeVerdict,
  toApiResponse,
} from '../enforce-deps.js';

/**
 * Every test in this file is KEY-FREE and deterministic: INTERCEPTA_API_KEY is
 * forcibly removed for the whole file. The globex invoice's Intercepta screen
 * therefore fails CLOSED here (REFUSED / PREMISE_UNRESOLVABLE), which is what
 * these tests assert. No live screen is asserted or reported as passing.
 */
let savedInterceptaKey: string | undefined;
beforeAll(() => {
  savedInterceptaKey = process.env['INTERCEPTA_API_KEY'];
  delete process.env['INTERCEPTA_API_KEY'];
});
afterAll(() => {
  if (savedInterceptaKey !== undefined) process.env['INTERCEPTA_API_KEY'] = savedInterceptaKey;
});

describe('isDemoVendorId', () => {
  it('accepts exactly the three seeded demo vendor ids', () => {
    expect(isDemoVendorId('vnd-globex-freight')).toBe(true);
    expect(isDemoVendorId('vnd-suspended-corp')).toBe(true);
    expect(isDemoVendorId('vnd-acme-supplies')).toBe(true);
  });

  it('rejects an unknown or empty id', () => {
    expect(isDemoVendorId('vnd-does-not-exist')).toBe(false);
    expect(isDemoVendorId('')).toBe(false);
  });
});

describe('registry', () => {
  it('wires issuer-oracle-vendors and intercepta-risk, matching @bonded/dispatcher\'s SchemaRegistry shape', () => {
    expect(Object.keys(registry)).toEqual(['issuer-oracle-vendors', 'intercepta-risk']);
    expect(typeof registry['issuer-oracle-vendors']?.fields['vendor.payoutAddress']).toBe('function');
    expect(typeof registry['intercepta-risk']?.fields['payment.payTo.traitCount']).toBe('function');
  });
});

describe('buildDemoInvoice', () => {
  it('vnd-globex-freight claims a payout address that differs from the real fixture value (the fraud)', async () => {
    const invoice = await buildDemoInvoice('vnd-globex-freight');
    expect(invoice.policy.premises).toHaveLength(2);
    const payout = invoice.policy.premises.find((p) => p.id === 'p-vendor-payout');
    expect(payout?.holdOnMismatch).toBe(true);
    const claim = invoice.proposal.premises.find((p) => p.premiseId === 'p-vendor-payout');
    expect(claim?.claimedValue).toBe(invoice.claimedPayoutAddress);
    // The whole point of this scenario: the claimed address is NOT the policy's own
    // documentation-only `value` field (which mirrors the real fixture's true address).
    expect(claim?.claimedValue).not.toBe(payout?.value);
  });

  it('vnd-globex-freight screens the claimed EVM identity FIRST, as a hard-refuse premise, before the payout hold', async () => {
    const invoice = await buildDemoInvoice('vnd-globex-freight');
    expect(invoice.proposal.premises.map((p) => p.premiseId)).toEqual([PAYEE_EVM_SCREEN_PREMISE_ID, 'p-vendor-payout']);
    expect(invoice.policy.premises[0]).toMatchObject({
      id: PAYEE_EVM_SCREEN_PREMISE_ID,
      schema: 'intercepta-risk',
      field: 'payment.payTo.traitCount',
      op: 'lte',
      value: '0',
      args: [invoice.claimedPayeeEvmAddress],
    });
    expect(invoice.policy.premises[0]?.holdOnMismatch).toBeUndefined();
  });

  it('the globex claimed payout address and EVM identity match site/spoofed-invoice.html exactly (no drift)', async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const html = readFileSync(
      join(here, '..', '..', '..', '..', 'packages', 'villain-corpus', 'site', 'spoofed-invoice.html'),
      'utf8',
    );
    const invoice = await buildDemoInvoice('vnd-globex-freight');
    expect(html).toMatch(new RegExp(`id="fraudulent-payout-address"[^>]*data-address="${invoice.claimedPayoutAddress}"`));
    expect(html).toMatch(new RegExp(`id="claimed-evm-identity"[^>]*data-address="${invoice.claimedPayeeEvmAddress}"`));
  });

  it('vnd-suspended-corp and vnd-acme-supplies are key-free policies (no intercepta-risk premise), by design', async () => {
    for (const id of ['vnd-suspended-corp', 'vnd-acme-supplies'] as const) {
      const invoice = await buildDemoInvoice(id);
      expect(invoice.policy.premises.map((p) => p.schema)).not.toContain('intercepta-risk');
    }
  });

  it('vnd-suspended-corp claims active status with no holdOnMismatch (hard refuse shape)', async () => {
    const invoice = await buildDemoInvoice('vnd-suspended-corp');
    expect(invoice.policy.premises).toHaveLength(1);
    expect(invoice.policy.premises[0]?.field).toBe('vendor.status');
    expect(invoice.policy.premises[0]?.holdOnMismatch).toBeUndefined();
    const claim = invoice.proposal.premises.find((p) => p.premiseId === 'p-vendor-status');
    expect(claim?.claimedValue).toBe('active');
  });

  it('vnd-acme-supplies claims exactly the real fixture values on both premises', async () => {
    const invoice = await buildDemoInvoice('vnd-acme-supplies');
    expect(invoice.policy.premises).toHaveLength(2);
    for (const def of invoice.policy.premises) {
      const claim = invoice.proposal.premises.find((p) => p.premiseId === def.id);
      expect(claim?.claimedValue).toBe(def.value);
    }
  });

  it('listDemoInvoices returns exactly the 3 seeded vendors, in DEMO_VENDOR_IDS order', async () => {
    const invoices = await listDemoInvoices();
    expect(invoices.map((i) => i.vendorId)).toEqual([...DEMO_VENDOR_IDS]);
  });
});

describe('buildPremiseDiffs', () => {
  it('pairs each claimed value with the real re-derived value, for every premise of a passing policy', async () => {
    const invoice = await buildDemoInvoice('vnd-acme-supplies');
    const diffs = await buildPremiseDiffs(invoice.policy, invoice.proposal, 4200n);
    expect(diffs).toHaveLength(2);
    for (const row of diffs) {
      expect(row.derivedValue).toBe(row.claimedValue);
    }
  });

  it('without a key, the globex screen row has no derived value, carries the key error, and nothing after it is claimed as checked', async () => {
    const invoice = await buildDemoInvoice('vnd-globex-freight');
    const diffs = await buildPremiseDiffs(invoice.policy, invoice.proposal, 4200n);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]?.premiseId).toBe(PAYEE_EVM_SCREEN_PREMISE_ID);
    expect(diffs[0]?.derivedValue).toBeNull();
    expect(diffs[0]?.resolveError).toMatch(/InterceptaKeyMissingError/);
  });

  it('stops at the first mismatch, like enforce() does', async () => {
    const invoice = await buildDemoInvoice('vnd-suspended-corp');
    const diffs = await buildPremiseDiffs(invoice.policy, invoice.proposal, 4200n);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]?.derivedValue).toBe('suspended');
  });
});

describe('runEnforceForInvoice — real enforce() calls, no mocks', () => {
  it('vnd-globex-freight with NO key resolves REFUSED / PREMISE_UNRESOLVABLE (fail closed), never HELD, with the key error attached', async () => {
    const result = await runEnforceForInvoice('vnd-globex-freight');
    expect(result.verdict.outcome).toBe(1);
    expect(result.verdict.reasonCode).toBe(ReasonCode.PREMISE_UNRESOLVABLE);
    expect(result.mismatches).toHaveLength(0);
    expect(result.screeningErrors).toHaveLength(1);
    expect(result.screeningErrors[0]).toMatchObject({
      schema: 'intercepta-risk',
      field: 'payment.payTo.traitCount',
      errorName: 'InterceptaKeyMissingError',
    });
    // Premise rows are exactly what enforce() resolved: the screen, and nothing after it.
    expect(result.premises.map((p) => p.premiseId)).toEqual([PAYEE_EVM_SCREEN_PREMISE_ID]);
    expect(result.premises[0]?.derivedValue).toBeNull();
    // Surfaced in the API response too.
    expect(toApiResponse(result).screeningErrors).toHaveLength(1);
  });

  it('vnd-suspended-corp resolves REFUSED / PREMISE_MISMATCH', async () => {
    const result = await runEnforceForInvoice('vnd-suspended-corp');
    expect(result.verdict.outcome).toBe(1);
    expect(result.verdict.reasonCode).toBe(ReasonCode.PREMISE_MISMATCH);
    expect(result.mismatches).toHaveLength(1);
  });

  it('vnd-acme-supplies resolves CLEARED / OK with no mismatches', async () => {
    const result = await runEnforceForInvoice('vnd-acme-supplies');
    expect(result.verdict.outcome).toBe(0);
    expect(result.verdict.reasonCode).toBe(ReasonCode.OK);
    expect(result.mismatches).toHaveLength(0);
  });
});

describe('findHeldInvoiceByProposalHash', () => {
  it('finds the globex proposal by its real proposalHash', async () => {
    const held = await runEnforceForInvoice('vnd-globex-freight');
    const found = await findHeldInvoiceByProposalHash(held.verdict.proposalHash);
    expect(found?.invoice.vendorId).toBe('vnd-globex-freight');
  });

  it('returns null for an unrecognized hash', async () => {
    const found = await findHeldInvoiceByProposalHash(`0x${'ff'.repeat(32)}` as `0x${string}`);
    expect(found).toBeNull();
  });
});

describe('serializeVerdict / reasonCodeLabel', () => {
  it('labels every outcome and turns blockChecked into a string (JSON has no bigint)', async () => {
    const result = await runEnforceForInvoice('vnd-acme-supplies');
    const serialized = serializeVerdict(result.verdict);
    expect(serialized.outcomeLabel).toBe('CLEARED');
    expect(typeof serialized.blockChecked).toBe('string');
    expect(reasonCodeLabel(ReasonCode.PREMISE_HELD_FOR_REVIEW)).toBe('PREMISE_HELD_FOR_REVIEW');
  });
});

describe('missingWorldEnvVars', () => {
  it('names every missing var and nothing else, never reading a real value', () => {
    const missing = missingWorldEnvVars({});
    expect(missing).toEqual(['WORLD_SANDBOX_CLIENT_ID', 'WORLD_SANDBOX_CLIENT_SECRET', 'WORLD_REDIRECT_URI']);
  });

  it('reports no missing vars once all three are set (values are irrelevant to this check)', () => {
    const missing = missingWorldEnvVars({
      WORLD_SANDBOX_CLIENT_ID: 'x',
      WORLD_SANDBOX_CLIENT_SECRET: 'y',
      WORLD_REDIRECT_URI: 'https://example.test/callback',
    });
    expect(missing).toEqual([]);
  });
});

describe('buildConsoleEnforceDeps', () => {
  it('sumRecentSpend is always 0n (no persistent ledger — documented, not silently fabricated)', async () => {
    const deps = buildConsoleEnforceDeps();
    await expect(deps.sumRecentSpend(`0x${'11'.repeat(20)}` as `0x${string}`, 'daily')).resolves.toBe(0n);
  });

  it('getCheckpoint resolves a bigint (a monotonic-enough stand-in, not a real Sui checkpoint)', async () => {
    const deps = buildConsoleEnforceDeps();
    const checkpoint = await deps.getCheckpoint();
    expect(typeof checkpoint).toBe('bigint');
  });
});
