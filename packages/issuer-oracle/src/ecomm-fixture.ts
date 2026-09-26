/**
 * The e-commerce counterpart to `tickets-fixture.ts` — the same disclosure
 * applies verbatim (see that file's header and docs/THREATMODEL.md): this is
 * a controlled, seeded reference service we run ourselves, not a real
 * merchant inventory feed, and it is never described as one.
 *
 * Generalizes the ticket-truth pattern to the bait-and-switch checkout
 * villain (Migration PRD D.8): a merchant page that shows one price and
 * silently inflates it at the payment step. This file only ever knows the
 * real listed price. The inflated "actual charge" is deliberately NOT a
 * field here — it is not part of the truth record, because in the real
 * attack it isn't truth, it's the lie. That number belongs to (and is
 * fabricated by) the villain corpus's checkout flow, built separately; this
 * package's job is to give an enforcer something honest to check the claim
 * against, not to be told about the mismatch in advance.
 */

/**
 * `listedPriceUSD` uses the identical convention as
 * `TicketTruth.faceValueUSD`: a 6-decimal fixed-point USD amount as an
 * already-scaled integer base-unit STRING (`"89000000"` === $89.00).
 * Convert with `BigInt(str)`, not `parseUnits6`.
 */
export interface ProductTruth {
  productId: string;
  listedPriceUSD: string;
}

/**
 * Seeded scenarios. Ids and prices are stable on purpose, for the same
 * reason as `tickets-fixture.ts`'s `TRUTH` map — the villain corpus's
 * bait-and-switch checkout page references these ids by these exact listed
 * prices, then constructs its own, separate, inflated charge at checkout.
 */
const TRUTH: Record<string, ProductTruth> = {
  'prod-camera-x200': {
    productId: 'prod-camera-x200',
    listedPriceUSD: '299990000', // $299.99
  },
  'prod-headphones-acme': {
    productId: 'prod-headphones-acme',
    listedPriceUSD: '89000000', // $89.00
  },
  'prod-sneakers-zeta': {
    productId: 'prod-sneakers-zeta',
    listedPriceUSD: '150000000', // $150.00
  },
};

/**
 * Returns the seeded truth record for `productId`, or `null` if the id is
 * unknown. Genuinely `async`/`Promise`-shaped, same reasoning as
 * `fetchTicketTruth`.
 */
export async function fetchProductTruth(productId: string): Promise<ProductTruth | null> {
  return TRUTH[productId] ?? null;
}
