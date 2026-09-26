/**
 * The `resolvePremise()` adapter side — Migration PRD D.4.
 *
 * `packages/enforcer` does not exist in this repo yet (see
 * docs/THREATMODEL.md's "Not yet built" list, 2026-09-26), so there is no
 * live `resolvePremise` signature to read and match. This file therefore
 * DEFINES the calling convention `packages/enforcer` and the villain-corpus /
 * console agents must match once they're built, rather than conforming to
 * one that already exists. Written down plainly, once, here:
 *
 *   - Every field resolver is `async` and returns a `Promise`, keyed by a
 *     dot-path string exactly as the Migration PRD's own D.4 sketch shows
 *     (`fields['ticket.faceValueUSD']`, etc.) — a plain object of functions,
 *     not a class, so `resolvePremise` can do `schemaObj.fields[def.field](...)`
 *     directly off `def.schema` / `def.field`.
 *   - Numeric/money fields (`ticket.faceValueUSD`, `ecomm.listedPriceUSD`)
 *     resolve to `bigint | null` — already-scaled 6-decimal base units,
 *     exactly the amount convention `packages/seam/src/money.ts` uses
 *     everywhere else, and NEVER a `number` (CLAUDE.md rule 2). `null` means
 *     "unknown id," the same signal `fetchTicketTruth`/`fetchProductTruth`
 *     themselves return.
 *   - The seller-authorization check (`ticket.sellerAuthorized`) is a
 *     boolean fact, but it is coerced to the SAME `bigint | null` return
 *     type as the money fields rather than a native JS `boolean`: `1n` means
 *     authorized, `0n` means not authorized, `null` means the event id
 *     itself is unknown. This is a deliberate, documented choice (the PRD
 *     text explicitly leaves it open) — one uniform return type across every
 *     field a given schema exposes keeps a generic `resolvePremise` dispatch
 *     loop simple; a caller that wants a JS boolean does `=== 1n`.
 *   - `ticket.status` is the one field that stays a plain string
 *     (`'scheduled' | 'cancelled' | 'postponed'` — see `TicketTruth`), or
 *     `null` for an unknown event. It is not bigint-coerced: it is
 *     categorical, not numeric, and inventing an integer wire format for it
 *     that nothing in the seam or Move side has ever asked for would be
 *     guessing an API this package doesn't own. A `Premise` with
 *     `op: 'eq'` compares it directly against `def.value` as a string.
 *
 * Any caller of this module — `packages/enforcer` once built, or the
 * villain-corpus/console agents in the meantime — matches these three rules
 * exactly, or the mismatch is a bug in the caller, not an ambiguity in this
 * file.
 */

import { fetchTicketTruth } from './tickets-fixture.js';
import { fetchProductTruth } from './ecomm-fixture.js';
import { fetchVendorTruth } from './vendor-fixture.js';

export const issuerOracleTickets = {
  fields: {
    'ticket.faceValueUSD': async (eventId: string): Promise<bigint | null> => {
      const truth = await fetchTicketTruth(eventId);
      return truth === null ? null : BigInt(truth.faceValueUSD);
    },
    'ticket.status': async (eventId: string): Promise<string | null> => {
      const truth = await fetchTicketTruth(eventId);
      return truth === null ? null : truth.status;
    },
    'ticket.sellerAuthorized': async (eventId: string, seller: string): Promise<bigint | null> => {
      const truth = await fetchTicketTruth(eventId);
      if (truth === null) return null;
      return truth.authorizedSellers.includes(seller) ? 1n : 0n;
    },
  },
};

export const issuerOracleEcomm = {
  fields: {
    'ecomm.listedPriceUSD': async (productId: string): Promise<bigint | null> => {
      const truth = await fetchProductTruth(productId);
      return truth === null ? null : BigInt(truth.listedPriceUSD);
    },
  },
};

/**
 * The vendor-master/AP counterpart to `issuerOracleTickets`/`issuerOracleEcomm`
 * above — same calling convention, same `fields['vendor.<field>'](vendorId)`
 * shape, matched against `vendor-fixture.ts`'s `fetchVendorTruth`.
 *
 * `vendor.payoutAddress` and `vendor.status` resolve to plain strings rather
 * than the `1n`/`0n`-coerced bigint convention `ticket.sellerAuthorized` uses
 * for its boolean fact. This is intended, not a mismatch to flag:
 * `packages/enforcer`'s `EnforceDeps.resolvePremise` dependency type is
 * `Promise<bigint | string | null>` (confirmed — it was widened in a
 * parallel change specifically to support this kind of categorical/string
 * field, the same widening `ticket.status` above already relies on). A
 * `Premise` with `op: 'eq'` compares a string field directly against
 * `def.value` as a string, exactly like `ticket.status`.
 *
 * `vendor.invoiceAmountUSD` and `vendor.payoutAddressLastChangedAt` stay on
 * the `bigint | null` convention — the former is a 6-decimal fixed-point USD
 * amount (same scale as every other money field in this package), the
 * latter a unix-seconds timestamp suitable for an `older_than`/`younger_than`
 * op, both never a native JS `number` (CLAUDE.md rule 2).
 */
export const issuerOracleVendors = {
  fields: {
    'vendor.payoutAddress': async (vendorId: string): Promise<string | null> => {
      const truth = await fetchVendorTruth(vendorId);
      return truth === null ? null : truth.payoutAddress;
    },
    'vendor.invoiceAmountUSD': async (vendorId: string): Promise<bigint | null> => {
      const truth = await fetchVendorTruth(vendorId);
      return truth === null ? null : BigInt(truth.invoiceAmountUSD);
    },
    'vendor.status': async (vendorId: string): Promise<string | null> => {
      const truth = await fetchVendorTruth(vendorId);
      return truth === null ? null : truth.status;
    },
    'vendor.payoutAddressLastChangedAt': async (vendorId: string): Promise<bigint | null> => {
      const truth = await fetchVendorTruth(vendorId);
      return truth === null ? null : BigInt(truth.payoutAddressLastChangedAt);
    },
  },
};
