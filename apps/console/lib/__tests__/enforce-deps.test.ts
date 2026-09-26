import { ReasonCode } from '@bonded/seam';
import {
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
} from '../enforce-deps.js';

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
  it('wires exactly issuer-oracle-vendors, matching @bonded/dispatcher\'s SchemaRegistry shape', () => {
    expect(Object.keys(registry)).toEqual(['issuer-oracle-vendors']);
    expect(typeof registry['issuer-oracle-vendors']?.fields['vendor.payoutAddress']).toBe('function');
  });
});

describe('buildDemoInvoice', () => {
  it('vnd-globex-freight claims a payout address that differs from the real fixture value (the fraud)', async () => {
    const invoice = await buildDemoInvoice('vnd-globex-freight');
    expect(invoice.policy.premises).toHaveLength(1);
    expect(invoice.policy.premises[0]?.holdOnMismatch).toBe(true);
    const claim = invoice.proposal.premises.find((p) => p.premiseId === 'p-vendor-payout');
    expect(claim?.claimedValue).toBe(invoice.claimedPayoutAddress);
    // The whole point of this scenario: the claimed address is NOT the policy's own
    // documentation-only `value` field (which mirrors the real fixture's true address).
    expect(claim?.claimedValue).not.toBe(invoice.policy.premises[0]?.value);
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
  it('resolves every premise, pairing claimed with the real re-derived value', async () => {
    const invoice = await buildDemoInvoice('vnd-globex-freight');
    const diffs = await buildPremiseDiffs(invoice.policy, invoice.proposal, 4200n);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]?.claimedValue).toBe(invoice.claimedPayoutAddress);
    // The real fixture's true address, independently re-derived — not the fraudulent claim.
    expect(diffs[0]?.derivedValue).not.toBe(invoice.claimedPayoutAddress);
    expect(diffs[0]?.derivedValue).toBe(invoice.policy.premises[0]?.value);
  });
});

describe('runEnforceForInvoice — real enforce() calls, no mocks', () => {
  it('vnd-globex-freight resolves HELD_FOR_STEPUP / PREMISE_HELD_FOR_REVIEW', async () => {
    const result = await runEnforceForInvoice('vnd-globex-freight');
    expect(result.verdict.outcome).toBe(2);
    expect(result.verdict.reasonCode).toBe(ReasonCode.PREMISE_HELD_FOR_REVIEW);
    expect(result.mismatches).toHaveLength(1);
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
