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
