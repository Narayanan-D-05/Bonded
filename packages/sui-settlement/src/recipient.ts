/**
 * The settlement recipient.
 *
 * ── SECURITY RULE: SETTLEMENT PAYS THE TRUTH, NOT THE CLAIM ────────────────
 *
 * The `recipient` of every settlement is ALWAYS the vendor's payout address
 * RE-DERIVED from the vendor-master source (`@bonded/issuer-oracle`'s
 * `fetchVendorTruth`, standing in for SAP/NetSuite/a bank beneficiary
 * registry). It is NEVER the address the invoice, the email, or the agent's
 * proposal claimed. That holds even when `enforce()` returned CLEARED, and
 * even when the claim and the truth are byte-identical.
 *
 * Why, even after CLEARED: `enforce()` checks the claim against the truth at
 * one moment. If settlement then pays the claimed string, any bug, race, or
 * mis-wired premise between "checked" and "paid" sends money to the
 * attacker's address. That's the whole BEC attack. If settlement only ever
 * pays a freshly re-derived vendor-master address, a fraudulent claim can at
 * worst get a payment refused or held. It can never redirect one.
 *
 * Enforcement, by type and at runtime:
 *   - `DerivedRecipient` can only be produced by `deriveVendorRecipient`
 *     below. The brand is a module-private `unique symbol`, so a hand-built
 *     `{ vendorId, address }` literal doesn't typecheck as one.
 *   - Every instance `deriveVendorRecipient` returns is frozen and recorded
 *     in a module-private `WeakSet`. `assertDerivedRecipient` (called by every
 *     settle path and every PTB builder) rejects anything not in that set.
 *     This catches `as any`/`as DerivedRecipient` casts and spread copies.
 *   - There's deliberately no function anywhere in this package that takes a
 *     plain address string and returns a `DerivedRecipient`.
 */

import { fetchVendorTruth, type VendorTruth } from '@bonded/issuer-oracle';
import type { Address } from '@bonded/seam';

declare const derivedRecipientBrand: unique symbol;

export interface DerivedRecipient {
  readonly vendorId: string;
  readonly legalName: string;
  /** Sui address, lower-case, 0x + 64 hex. Re-derived from the vendor-master source, never from a claim. */
  readonly address: Address;
  /** Where the address came from. Recorded so an audit trail can show it wasn't the invoice. */
  readonly source: 'vendor-master';
  readonly [derivedRecipientBrand]: true;
}

/** The vendor-master lookup. Defaults to the issuer-oracle fixture; a production swap passes the real ERP/beneficiary-registry call with the same signature. */
export type VendorMasterLookup = (vendorId: string) => Promise<VendorTruth | null>;

export class RecipientDerivationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecipientDerivationError';
  }
}

const SUI_ADDRESS = /^0x[0-9a-f]{64}$/;
const issued = new WeakSet<object>();

/**
 * Re-derives the payout recipient for `vendorId` from the vendor-master
 * source. There is intentionally no parameter for a claimed/invoice address:
 * the claim has no path into settlement at all.
 *
 * Refuses (throws) when the vendor is unknown, suspended, or has a payout
 * address that isn't a well-formed 32-byte Sui address. Paying a suspended
 * vendor is never correct, whatever verdict reached this point.
 */
export async function deriveVendorRecipient(
  vendorId: string,
  lookup: VendorMasterLookup = fetchVendorTruth,
): Promise<DerivedRecipient> {
  const truth = await lookup(vendorId);
  if (truth === null) {
    throw new RecipientDerivationError(`Vendor "${vendorId}" is not in the vendor-master source; refusing to settle.`);
  }
  if (truth.vendorId !== vendorId) {
    throw new RecipientDerivationError(
      `Vendor-master returned record "${truth.vendorId}" for lookup "${vendorId}"; refusing to settle to a different vendor.`,
    );
  }
  if (truth.status !== 'active') {
    throw new RecipientDerivationError(`Vendor "${vendorId}" is ${truth.status} in the vendor-master source; refusing to settle.`);
  }
  const address = truth.payoutAddress.toLowerCase();
  if (!SUI_ADDRESS.test(address)) {
    throw new RecipientDerivationError(
      `Vendor "${vendorId}" payout address "${truth.payoutAddress}" is not a 32-byte Sui address; refusing to settle.`,
    );
  }
  const recipient = Object.freeze({
    vendorId,
    legalName: truth.legalName,
    address: address as Address,
    source: 'vendor-master' as const,
  }) as DerivedRecipient;
  issued.add(recipient);
  return recipient;
}

/** True only for an object `deriveVendorRecipient` itself returned in this process. */
export function isDerivedRecipient(value: unknown): value is DerivedRecipient {
  return typeof value === 'object' && value !== null && issued.has(value);
}

/**
 * Runtime half of the rule. Every settle path and PTB builder calls this
 * before an address reaches the transaction.
 */
export function assertDerivedRecipient(value: unknown): asserts value is DerivedRecipient {
  if (!isDerivedRecipient(value)) {
    throw new RecipientDerivationError(
      'Settlement recipient was not produced by deriveVendorRecipient(). Settlement pays the vendor-master ' +
        'payout address re-derived at settle time, never an address taken from an invoice, email, or proposal claim.',
    );
  }
}
