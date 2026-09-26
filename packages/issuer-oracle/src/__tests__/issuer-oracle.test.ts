/**
 * PRD Part G, row "Issuer oracle" (`issuer-oracle.test.ts`):
 * "All three seeded scenarios (price drift, cancelled event, unauthorized
 * seller) resolve correctly."
 *
 * Also covers the fourth seeded case the task called for (a second,
 * independent price-drift event distinct from the first), and the
 * unknown-id `null` path for both the tickets and e-commerce fixtures.
 */

import { fetchTicketTruth } from '../tickets-fixture.js';
import { fetchProductTruth } from '../ecomm-fixture.js';
import { fetchVendorTruth } from '../vendor-fixture.js';
import { issuerOracleTickets, issuerOracleEcomm, issuerOracleVendors } from '../schemas.js';

describe('fetchTicketTruth', () => {
  it('returns the seeded clean scheduled event (evt-tokyo-showcase)', async () => {
    const truth = await fetchTicketTruth('evt-tokyo-showcase');
    expect(truth).toEqual({
      eventId: 'evt-tokyo-showcase',
      faceValueUSD: '45000000',
      status: 'scheduled',
      authorizedSellers: ['issuer-primary', 'resale-verified-1'],
    });
  });

  it('returns a second, independently-priced scheduled event (evt-osaka-arena)', async () => {
    const truth = await fetchTicketTruth('evt-osaka-arena');
    expect(truth).toEqual({
      eventId: 'evt-osaka-arena',
      faceValueUSD: '120000000',
      status: 'scheduled',
      authorizedSellers: ['issuer-primary', 'resale-verified-2'],
    });
    // distinct real face value from evt-tokyo-showcase, so a price-drift
    // mismatch against this event is testable independently
    expect(truth?.faceValueUSD).not.toBe((await fetchTicketTruth('evt-tokyo-showcase'))?.faceValueUSD);
  });

  it('returns the seeded cancelled event (evt-cancelled-fest)', async () => {
    const truth = await fetchTicketTruth('evt-cancelled-fest');
    expect(truth?.status).toBe('cancelled');
  });

  it('returns null for an unknown event id', async () => {
    await expect(fetchTicketTruth('evt-does-not-exist')).resolves.toBeNull();
  });
});

describe('fetchProductTruth', () => {
  it('returns each seeded product', async () => {
    await expect(fetchProductTruth('prod-camera-x200')).resolves.toEqual({
      productId: 'prod-camera-x200',
      listedPriceUSD: '299990000',
    });
    await expect(fetchProductTruth('prod-headphones-acme')).resolves.toEqual({
      productId: 'prod-headphones-acme',
      listedPriceUSD: '89000000',
    });
    await expect(fetchProductTruth('prod-sneakers-zeta')).resolves.toEqual({
      productId: 'prod-sneakers-zeta',
      listedPriceUSD: '150000000',
    });
  });

  it('returns null for an unknown product id', async () => {
    await expect(fetchProductTruth('prod-does-not-exist')).resolves.toBeNull();
  });
});

describe('issuerOracleTickets.fields — resolvePremise adapter convention', () => {
  it('ticket.faceValueUSD resolves to a bigint in 6-decimal base units (price-drift scenario, event 1)', async () => {
    const value = await issuerOracleTickets.fields['ticket.faceValueUSD']('evt-tokyo-showcase');
    expect(value).toBe(45_000_000n);
    expect(typeof value).toBe('bigint');
  });

  it('ticket.faceValueUSD resolves independently for the second price-drift event', async () => {
    const value = await issuerOracleTickets.fields['ticket.faceValueUSD']('evt-osaka-arena');
    expect(value).toBe(120_000_000n);
  });

  it('ticket.faceValueUSD resolves to null for an unknown event', async () => {
    await expect(issuerOracleTickets.fields['ticket.faceValueUSD']('evt-does-not-exist')).resolves.toBeNull();
  });

  it('ticket.status resolves "cancelled" for the cancelled-event scenario', async () => {
    const status = await issuerOracleTickets.fields['ticket.status']('evt-cancelled-fest');
    expect(status).toBe('cancelled');
  });

  it('ticket.status resolves "scheduled" for a scheduled event', async () => {
    const status = await issuerOracleTickets.fields['ticket.status']('evt-tokyo-showcase');
    expect(status).toBe('scheduled');
  });

  it('ticket.status resolves to null for an unknown event', async () => {
    await expect(issuerOracleTickets.fields['ticket.status']('evt-does-not-exist')).resolves.toBeNull();
  });

  it('ticket.sellerAuthorized resolves 1n for an authorized seller', async () => {
    const value = await issuerOracleTickets.fields['ticket.sellerAuthorized']('evt-tokyo-showcase', 'issuer-primary');
    expect(value).toBe(1n);
  });

  it('ticket.sellerAuthorized resolves 0n for the unauthorized-seller scenario (event 1, reused)', async () => {
    const value = await issuerOracleTickets.fields['ticket.sellerAuthorized'](
      'evt-tokyo-showcase',
      'seller-unauthorized-scalper',
    );
    expect(value).toBe(0n);
  });

  it('ticket.sellerAuthorized resolves to null for an unknown event', async () => {
    await expect(
      issuerOracleTickets.fields['ticket.sellerAuthorized']('evt-does-not-exist', 'issuer-primary'),
    ).resolves.toBeNull();
  });
});

describe('issuerOracleEcomm.fields — resolvePremise adapter convention', () => {
  it('ecomm.listedPriceUSD resolves to a bigint in 6-decimal base units', async () => {
    const value = await issuerOracleEcomm.fields['ecomm.listedPriceUSD']('prod-headphones-acme');
    expect(value).toBe(89_000_000n);
    expect(typeof value).toBe('bigint');
  });

  it('ecomm.listedPriceUSD resolves to null for an unknown product', async () => {
    await expect(issuerOracleEcomm.fields['ecomm.listedPriceUSD']('prod-does-not-exist')).resolves.toBeNull();
  });
});

/**
 * The vendor-master/AP (BEC / vendor-invoice-payment-fraud) counterpart to
 * the tickets/ecomm blocks above. Seeded scenarios:
 *  - `vnd-acme-supplies`   — clean, active, old payout-address change.
 *  - `vnd-globex-freight`  — active, RECENT legitimate payout-address change
 *    (the villain corpus separately claims a different, fraudulent address
 *    for this same id — not exercised here, since that fraudulent value
 *    intentionally does not live in this package).
 *  - `vnd-suspended-corp`  — suspended; the hard-refuse case.
 */
describe('fetchVendorTruth', () => {
  it('returns the seeded clean active vendor (vnd-acme-supplies)', async () => {
    const truth = await fetchVendorTruth('vnd-acme-supplies');
    expect(truth).toEqual({
      vendorId: 'vnd-acme-supplies',
      legalName: 'Acme Supplies LLC',
      payoutAddress: '0x4d5a6774818e9ba8b5c2cfdce9f603101d2a3744515e6b7885929facb9c6d3e0',
      invoiceAmountUSD: '1250000000',
      status: 'active',
      payoutAddressLastChangedAt: 1736899200,
      evmAddress: '0xec07a00bcc0e68b93dd8100b6488d4ec4bfeb5a1',
    });
  });

  it('returns the seeded active vendor with a recent payout-address change (vnd-globex-freight)', async () => {
    const truth = await fetchVendorTruth('vnd-globex-freight');
    expect(truth).toEqual({
      vendorId: 'vnd-globex-freight',
      legalName: 'Globex Freight & Logistics Inc.',
      payoutAddress: '0xcbd8e5f2ff0c192633404d5a6774818e9ba8b5c2cfdce9f603101d2a3744515e',
      invoiceAmountUSD: '8450000000',
      status: 'active',
      payoutAddressLastChangedAt: 1790172000,
      evmAddress: '0x98062f7075cd7a6b07379e88eb76e978fad188f6',
    });
    // the recent change is more recent than acme-supplies' old one — the
    // legitimate-bank-change signal this vendor exists to represent
    expect(truth!.payoutAddressLastChangedAt).toBeGreaterThan(
      (await fetchVendorTruth('vnd-acme-supplies'))!.payoutAddressLastChangedAt,
    );
  });

  it('returns the seeded suspended vendor (vnd-suspended-corp)', async () => {
    const truth = await fetchVendorTruth('vnd-suspended-corp');
    expect(truth?.status).toBe('suspended');
  });

  it('returns null for an unknown vendor id', async () => {
    await expect(fetchVendorTruth('vnd-does-not-exist')).resolves.toBeNull();
  });
});

describe('issuerOracleVendors.fields — resolvePremise adapter convention', () => {
  it('vendor.payoutAddress resolves the true current address for each seeded vendor', async () => {
    await expect(issuerOracleVendors.fields['vendor.payoutAddress']('vnd-acme-supplies')).resolves.toBe(
      '0x4d5a6774818e9ba8b5c2cfdce9f603101d2a3744515e6b7885929facb9c6d3e0',
    );
    await expect(issuerOracleVendors.fields['vendor.payoutAddress']('vnd-globex-freight')).resolves.toBe(
      '0xcbd8e5f2ff0c192633404d5a6774818e9ba8b5c2cfdce9f603101d2a3744515e',
    );
    await expect(issuerOracleVendors.fields['vendor.payoutAddress']('vnd-suspended-corp')).resolves.toBe(
      '0x73808d9aa7b4c1cedbe8f5020f1c293643505d6a7784919eabb8c5d2dfecf906',
    );
  });

  it('vendor.payoutAddress resolves to null for an unknown vendor', async () => {
    await expect(issuerOracleVendors.fields['vendor.payoutAddress']('vnd-does-not-exist')).resolves.toBeNull();
  });

  it('vendor.invoiceAmountUSD resolves to a bigint in 6-decimal base units for each seeded vendor', async () => {
    const acme = await issuerOracleVendors.fields['vendor.invoiceAmountUSD']('vnd-acme-supplies');
    expect(acme).toBe(1_250_000_000n);
    expect(typeof acme).toBe('bigint');
    await expect(issuerOracleVendors.fields['vendor.invoiceAmountUSD']('vnd-globex-freight')).resolves.toBe(
      8_450_000_000n,
    );
    await expect(issuerOracleVendors.fields['vendor.invoiceAmountUSD']('vnd-suspended-corp')).resolves.toBe(
      4_200_000_000n,
    );
  });

  it('vendor.invoiceAmountUSD resolves to null for an unknown vendor', async () => {
    await expect(issuerOracleVendors.fields['vendor.invoiceAmountUSD']('vnd-does-not-exist')).resolves.toBeNull();
  });

  it('vendor.status resolves "active" for the two active vendors and "suspended" for the suspended one', async () => {
    await expect(issuerOracleVendors.fields['vendor.status']('vnd-acme-supplies')).resolves.toBe('active');
    await expect(issuerOracleVendors.fields['vendor.status']('vnd-globex-freight')).resolves.toBe('active');
    await expect(issuerOracleVendors.fields['vendor.status']('vnd-suspended-corp')).resolves.toBe('suspended');
  });

  it('vendor.status resolves to null for an unknown vendor', async () => {
    await expect(issuerOracleVendors.fields['vendor.status']('vnd-does-not-exist')).resolves.toBeNull();
  });

  it('vendor.payoutAddressLastChangedAt resolves to a bigint unix-seconds timestamp for each seeded vendor', async () => {
    const acme = await issuerOracleVendors.fields['vendor.payoutAddressLastChangedAt']('vnd-acme-supplies');
    expect(acme).toBe(1736899200n);
    expect(typeof acme).toBe('bigint');
    const globex = await issuerOracleVendors.fields['vendor.payoutAddressLastChangedAt']('vnd-globex-freight');
    expect(globex).toBe(1790172000n);
    // recent globex change is a larger (later) unix-seconds value than acme's old one
    expect(globex).toBeGreaterThan(acme!);
  });

  it('vendor.payoutAddressLastChangedAt resolves to null for an unknown vendor', async () => {
    await expect(
      issuerOracleVendors.fields['vendor.payoutAddressLastChangedAt']('vnd-does-not-exist'),
    ).resolves.toBeNull();
  });

  // Added with the EVM-identity screening change: the vendor's registered
  // on-chain identity (screened by Intercepta), distinct from the Sui
  // settlement payoutAddress. Synthetic, like the rest of this fixture.
  it('vendor.evmAddress resolves the registered EVM identity for each seeded vendor', async () => {
    await expect(issuerOracleVendors.fields['vendor.evmAddress']('vnd-acme-supplies')).resolves.toBe(
      '0xec07a00bcc0e68b93dd8100b6488d4ec4bfeb5a1',
    );
    await expect(issuerOracleVendors.fields['vendor.evmAddress']('vnd-globex-freight')).resolves.toBe(
      '0x98062f7075cd7a6b07379e88eb76e978fad188f6',
    );
    await expect(issuerOracleVendors.fields['vendor.evmAddress']('vnd-suspended-corp')).resolves.toBe(
      '0x3dedb65cd8aed5a70842a9c7ca3dff4a6f83f39f',
    );
  });

  it('vendor.evmAddress resolves to null for an unknown vendor', async () => {
    await expect(issuerOracleVendors.fields['vendor.evmAddress']('vnd-does-not-exist')).resolves.toBeNull();
  });
});

describe('VendorTruth.evmAddress shape', () => {
  it('every seeded vendor has a 20-byte lowercase EVM address, distinct from its 32-byte Sui payoutAddress', async () => {
    const seen = new Set<string>();
    for (const id of ['vnd-acme-supplies', 'vnd-globex-freight', 'vnd-suspended-corp']) {
      const truth = await fetchVendorTruth(id);
      expect(truth).not.toBeNull();
      expect(truth!.evmAddress).toMatch(/^0x[0-9a-f]{40}$/);
      expect(truth!.payoutAddress).toMatch(/^0x[0-9a-fA-F]{64}$/);
      seen.add(truth!.evmAddress);
    }
    expect(seen.size).toBe(3);
  });
});
