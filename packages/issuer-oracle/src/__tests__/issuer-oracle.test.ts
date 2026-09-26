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
import { issuerOracleTickets, issuerOracleEcomm } from '../schemas.js';

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
