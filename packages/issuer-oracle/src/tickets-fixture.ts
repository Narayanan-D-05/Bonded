/**
 * THE ONE DELIBERATELY CONTROLLED COMPONENT IN THIS PACKAGE'S DOMAIN.
 *
 * Plainly, in our own words: there is no hackathon-accessible API for real
 * primary-ticket-issuer truth to call. This file is not that, and it never
 * pretends to be. It is a controlled reference service — a small, seeded,
 * in-memory table we run ourselves — standing in for what a real issuer's
 * inventory system, or a resale platform's own verified-seller registry,
 * would tell an enforcer in production. Every id, price and seller string
 * below is synthetic, invented for this build, and disclosed as such; it is
 * "ours," never described anywhere in this codebase as a live feed from any
 * real ticketing company. See docs/THREATMODEL.md for the disclosure this
 * fixture exists to make honest (Migration PRD Part D.4, I.4), and CLAUDE.md
 * rule 6/7 for why this comment has to say so before any code below runs.
 *
 * A production swap replaces the `TRUTH` map with a real call to that
 * issuer/resale-platform system. `fetchTicketTruth`'s signature — async, one
 * id in, one truth record or `null` out — does not change at all when that
 * swap happens, and neither does anything in `schemas.ts` that depends on it.
 * That's the point of isolating the fixture in its own file instead of
 * letting fixture-ness leak into the call sites that read from it.
 */

/**
 * `faceValueUSD` is a 6-decimal fixed-point USD amount, expressed as an
 * integer base-unit STRING — the same scale `packages/seam/src/money.ts`
 * uses for every on-chain amount (e.g. `"45000000"` === $45.00). It is
 * already scaled, not a decimal dollar string: convert with `BigInt(str)`,
 * never with `parseUnits6` (that parses `"45.00"`-shaped decimal strings,
 * not pre-scaled base units — using it here would silently multiply the
 * value by 1e6 a second time).
 */
export interface TicketTruth {
  eventId: string;
  faceValueUSD: string;
  status: 'scheduled' | 'cancelled' | 'postponed';
  /** Primary issuer + verified resale partners only. Anyone else is a refusal. */
  authorizedSellers: string[];
}

/**
 * Seeded scenarios (Migration PRD Part E / Part G's `issuer-oracle.test.ts`
 * row). Ids and prices are stable on purpose — the villain-corpus and
 * `/shop` console agents reference these exact strings:
 *
 *  - `evt-tokyo-showcase`  — the "clean" scheduled case. Real face value
 *    $45.00. The villain corpus's scalper page claims $89 for this same
 *    event from a seller not on the allowlist below — this fixture only
 *    ever states the truth side of that mismatch, never the villain's claim.
 *  - `evt-osaka-arena`     — a second scheduled event with its OWN real face
 *    value ($120.00), distinct from `evt-tokyo-showcase`, so a price-drift
 *    refusal is testable independently of the cancelled-event refusal below
 *    (i.e. two different "claimed != issuer price" fixtures, not the same
 *    one reused).
 *  - `evt-cancelled-fest`  — a cancelled event. Any purchase premise checked
 *    against this id must resolve `status !== 'scheduled'` regardless of
 *    what price is claimed.
 *
 * The unauthorized-seller scenario does not need a fourth event: it is
 * exercised by checking `evt-tokyo-showcase`'s `authorizedSellers` against a
 * seller string that isn't in it (see `schemas.ts` and the test file).
 */
const TRUTH: Record<string, TicketTruth> = {
  'evt-tokyo-showcase': {
    eventId: 'evt-tokyo-showcase',
    faceValueUSD: '45000000', // $45.00
    status: 'scheduled',
    authorizedSellers: ['issuer-primary', 'resale-verified-1'],
  },
  'evt-osaka-arena': {
    eventId: 'evt-osaka-arena',
    faceValueUSD: '120000000', // $120.00
    status: 'scheduled',
    authorizedSellers: ['issuer-primary', 'resale-verified-2'],
  },
  'evt-cancelled-fest': {
    eventId: 'evt-cancelled-fest',
    faceValueUSD: '75000000', // $75.00 — the face value the event had before cancellation
    status: 'cancelled',
    authorizedSellers: ['issuer-primary'],
  },
};

/**
 * Returns the seeded truth record for `eventId`, or `null` if the id is
 * unknown. Genuinely `async`/`Promise`-shaped even though the backing store
 * is an in-memory object — so a later swap to a real issuer API changes
 * nothing about any call site.
 */
export async function fetchTicketTruth(eventId: string): Promise<TicketTruth | null> {
  return TRUTH[eventId] ?? null;
}
