/**
 * The recipient rule: settlement pays the vendor-master truth, never the
 * invoice's claim. Run against the real @bonded/issuer-oracle fixture.
 */
import { describe, expect, it } from '@jest/globals';
import { fetchVendorTruth } from '@bonded/issuer-oracle';
import { loadSettlementConfig } from '../config.js';
import { buildSettleClearedArgs, buildSettleWithStepUpArgs } from '../ptb.js';
import {
  assertDerivedRecipient,
  deriveVendorRecipient,
  isDerivedRecipient,
  RecipientDerivationError,
  type DerivedRecipient,
} from '../recipient.js';
import { settleCleared, settleWithStepUp } from '../settle.js';
import { approveStepUpForSettlement, isCertifiedStepUpApproval } from '../stepup.js';
import { ReasonCode } from '@bonded/seam';
import { clearedVerdict, FRAUDULENT_GLOBEX_CLAIM, heldVerdict, REAL_ENV } from './fixtures.js';

const cfg = loadSettlementConfig({ ...REAL_ENV });

describe('deriveVendorRecipient', () => {
  it('returns the vendor-master payout address, not anything the caller supplies', async () => {
    const truth = await fetchVendorTruth('vnd-acme-supplies');
    const r = await deriveVendorRecipient('vnd-acme-supplies');
    expect(r.address).toBe(truth!.payoutAddress);
    expect(r.source).toBe('vendor-master');
    expect(isDerivedRecipient(r)).toBe(true);
    expect(Object.isFrozen(r)).toBe(true);
  });

  it('for the BEC scenario, pays the true globex address, never the spoofed invoice claim', async () => {
    const r = await deriveVendorRecipient('vnd-globex-freight');
    expect(r.address).toBe('0xcbd8e5f2ff0c192633404d5a6774818e9ba8b5c2cfdce9f603101d2a3744515e');
    expect(r.address).not.toBe(FRAUDULENT_GLOBEX_CLAIM);
    const args = buildSettleWithStepUpArgs(cfg, heldVerdict(), 8_450_000_000n, r);
    expect(args).toContain(`@${r.address}`);
    expect(args.join(' ')).not.toContain(FRAUDULENT_GLOBEX_CLAIM.slice(2));
  });

  it('refuses a suspended vendor', async () => {
    await expect(deriveVendorRecipient('vnd-suspended-corp')).rejects.toThrow(/suspended in the vendor-master source/);
  });

  it('refuses an unknown vendor', async () => {
    await expect(deriveVendorRecipient('vnd-nobody')).rejects.toThrow(RecipientDerivationError);
  });

  it('refuses a vendor-master record for a different vendor id', async () => {
    const acme = await fetchVendorTruth('vnd-acme-supplies');
    await expect(deriveVendorRecipient('vnd-globex-freight', async () => acme)).rejects.toThrow(/refusing to settle to a different vendor/);
  });

  it('refuses a non-Sui-shaped payout address from the source', async () => {
    const acme = (await fetchVendorTruth('vnd-acme-supplies'))!;
    await expect(
      deriveVendorRecipient('vnd-acme-supplies', async () => ({ ...acme, payoutAddress: `0x${'ab'.repeat(20)}` })),
    ).rejects.toThrow(/not a 32-byte Sui address/);
  });
});

describe('a claimed (non-derived) recipient is refused everywhere', () => {
  const handBuilt = {
    vendorId: 'vnd-globex-freight',
    legalName: 'Globex Freight & Logistics Inc.',
    address: FRAUDULENT_GLOBEX_CLAIM,
    source: 'vendor-master',
  };

  it('does not typecheck as a DerivedRecipient', () => {
    // @ts-expect-error a plain object literal lacks the module-private brand
    const r: DerivedRecipient = handBuilt;
    expect(isDerivedRecipient(r)).toBe(false);
  });

  it('is rejected by assertDerivedRecipient even when cast', () => {
    expect(() => assertDerivedRecipient(handBuilt as unknown as DerivedRecipient)).toThrow(/never an address taken from an invoice/);
  });

  it('a spread copy of a real derived recipient is rejected too (it is a different object)', async () => {
    const real = await deriveVendorRecipient('vnd-globex-freight');
    const tampered = { ...real, address: FRAUDULENT_GLOBEX_CLAIM } as unknown as DerivedRecipient;
    expect(() => assertDerivedRecipient(tampered)).toThrow(RecipientDerivationError);
  });

  it('the PTB builders refuse it', () => {
    const fake = handBuilt as unknown as DerivedRecipient;
    expect(() => buildSettleClearedArgs(cfg, clearedVerdict(), 1n, fake)).toThrow(RecipientDerivationError);
    expect(() => buildSettleWithStepUpArgs(cfg, heldVerdict(), 1n, fake)).toThrow(RecipientDerivationError);
  });

  it('settleCleared refuses it before loading config or touching the CLI', async () => {
    // env is empty. If the recipient check did not run first, this would be a SettlementConfigError instead.
    await expect(
      settleCleared({ verdict: clearedVerdict(), valueUsdc: 1n, recipient: handBuilt as unknown as DerivedRecipient }, { env: {} }),
    ).rejects.toThrow(RecipientDerivationError);
  });

  it('settleWithStepUp refuses it even with a certified step-up approval, before config or the CLI', async () => {
    const now = 1_790_400_000_000;
    const approval = approveStepUpForSettlement(
      { proposalHash: heldVerdict().proposalHash, holdReason: ReasonCode.PREMISE_HELD_FOR_REVIEW },
      { verified: true, sub: 'sub-1', authTimeMs: now },
      now,
    );
    if (!isCertifiedStepUpApproval(approval)) throw new Error('expected a certified approval');
    await expect(
      settleWithStepUp(
        { verdict: heldVerdict(), valueUsdc: 1n, recipient: handBuilt as unknown as DerivedRecipient, stepUpDecision: approval },
        { env: {}, nowMs: now },
      ),
    ).rejects.toThrow(RecipientDerivationError);
  });
});
