/**
 * The vendor-master/AP counterpart to `tickets-fixture.ts` and
 * `ecomm-fixture.ts` — the same disclosure applies verbatim (see
 * `tickets-fixture.ts`'s header and docs/THREATMODEL.md): this is a
 * controlled, seeded reference service we run ourselves, standing in for
 * what a real vendor-master/ERP system (SAP, NetSuite, a bank's own
 * beneficiary registry, etc.) would tell an AP-automation enforcer in
 * production. It is not a live feed from any real vendor-master or ERP
 * system, and it is never described as one anywhere in this codebase.
 *
 * This is the BEC (Business Email Compromise) / vendor-invoice-payment-fraud
 * scenario: an autonomous AP agent pays a vendor's invoice; the invoice, or a
 * "we changed our bank account" email, was spoofed by an attacker
 * impersonating the real vendor. This file only ever states the TRUE current
 * vendor record (payout address, invoice amount, status, when the payout
 * address last changed). A fraudulent, spoofed claim about any of these
 * fields — the thing an enforcer must catch — is not a field here and is
 * never fabricated by this package; it belongs to (and is constructed by) a
 * separate villain-corpus package, built independently, which references
 * these exact seeded ids.
 *
 * A production swap replaces the `TRUTH` map with a real call to that
 * vendor-master/ERP system. `fetchVendorTruth`'s signature — async, one id
 * in, one truth record or `null` out — does not change at all when that swap
 * happens, matching `fetchTicketTruth`/`fetchProductTruth`'s own contract.
 */

/**
 * `invoiceAmountUSD` uses the identical convention as `TicketTruth.faceValueUSD`
 * / `ProductTruth.listedPriceUSD`: a 6-decimal fixed-point USD amount,
 * expressed as an already-scaled integer base-unit STRING (e.g.
 * `"1250000000"` === $1,250.00). Convert with `BigInt(str)`, never with
 * `parseUnits6` — that parses `"1250.00"`-shaped decimal strings, not
 * pre-scaled base units, and using it here would silently multiply the value
 * by 1e6 a second time (same reasoning as the ticket fixture's own comment).
 *
 * `payoutAddressLastChangedAt` is unix seconds. It exists so a
 * "recently changed bank details" premise can be checked with an
 * `older_than`/`younger_than` op against it — the honest half of the BEC
 * story: legitimate vendors do change banks sometimes, so a recent change is
 * not itself proof of fraud, only a signal that should raise the bar (e.g.
 * a step-up hold) rather than an automatic hard refuse.
 */
export interface VendorTruth {
  vendorId: string;
  legalName: string;
  payoutAddress: `0x${string}`;
  invoiceAmountUSD: string;
  status: 'active' | 'suspended';
  payoutAddressLastChangedAt: number;
  /**
   * The vendor's registered on-chain identity, used for SCREENING, not for
   * settlement: a 20-byte EVM address, lowercase hex (`0x` + 40 chars).
   *
   * Why a second address at all: Intercepta (Web3 Antivirus) address scans
   * take an "ETH address/ENS" and its risk data covers EVM mainnet
   * (docs/VERIFY_FINDINGS.md item 5). Every `payoutAddress` above is a
   * 32-byte Sui address, which Intercepta cannot screen and which
   * `@bonded/intercepta-adapter`'s `parseScreeningSubject` rejects before any
   * network call. So the thing that gets screened is the payee's EVM
   * identity, while `payoutAddress` stays the Sui settlement destination.
   *
   * Field name is fixed (`evmAddress`): a real accounting-system connector
   * built in parallel must produce this same shape.
   *
   * The three seeded values below are SYNTHETIC, like everything else in this
   * disclosed fixture: each is the first 20 bytes of
   * sha256("bonded-synthetic-evm-identity:<vendorId>"). They are not any real
   * company's address, and they were checked absent from the OFAC SDN list
   * (sdn.csv, fetched 2026-09-26) when chosen.
   */
  evmAddress: `0x${string}`;
}

/**
 * Seeded scenarios. Ids, addresses and amounts are stable on purpose — other
 * packages being built in parallel (the villain-corpus spoofed-invoice
 * artifact, the console Invoice Inbox, the mcp-server tool) reference these
 * exact strings, so none of them may change once landed:
 *
 *  - `vnd-acme-supplies`  — the clean case. `status: 'active'`, a
 *    `payoutAddressLastChangedAt` more than a year old (no recent bank
 *    change at all), invoice amount $1,250.00. A correct claim against this
 *    vendor id should resolve `CLEARED`/`OK` straight through.
 *  - `vnd-globex-freight` — `status: 'active'`, invoice amount $8,450.00,
 *    and a `payoutAddressLastChangedAt` only a few days old — representing a
 *    real, legitimate bank change on file (vendors do change banks; this is
 *    not itself the attack). This record states ONLY the true current
 *    payout address below. The villain-corpus package (built separately,
 *    not by this file) constructs its own spoofed invoice claiming a
 *    DIFFERENT, fraudulent payout address for this same `vnd-globex-freight`
 *    id — that fraudulent value is deliberately never referenced or
 *    embedded anywhere in this file; the lie belongs entirely to the
 *    villain artifact, and this fixture's only job is to give an enforcer
 *    the honest fact to check that claim against.
 *  - `vnd-suspended-corp` — `status: 'suspended'`. The hard-refuse case: any
 *    invoice claim against a suspended vendor should resolve to a refusal
 *    regardless of what address or amount is claimed.
 *  - `vnd-halcyon-machining` — clean, but a $15,000.00 bill: the
 *    over-the-irreversible-threshold case (see its record below).
 *
 * `TRUTH` itself is never mutated. A World-approved bank change is recorded
 * in an append-only change log and overlaid on top of this map by
 * `vendor-master-changes.ts` (opt-in; `fetchVendorTruth` below stays the
 * pure seeded record).
 */
const TRUTH: Record<string, VendorTruth> = {
  'vnd-acme-supplies': {
    vendorId: 'vnd-acme-supplies',
    legalName: 'Acme Supplies LLC',
    payoutAddress: '0x4d5a6774818e9ba8b5c2cfdce9f603101d2a3744515e6b7885929facb9c6d3e0',
    invoiceAmountUSD: '1250000000', // $1,250.00
    status: 'active',
    payoutAddressLastChangedAt: 1736899200, // 2025-01-15T00:00:00Z — well over a year before this fixture's baseline (2026-09-26)
    evmAddress: '0xec07a00bcc0e68b93dd8100b6488d4ec4bfeb5a1', // synthetic — see VendorTruth.evmAddress
  },
  'vnd-globex-freight': {
    vendorId: 'vnd-globex-freight',
    legalName: 'Globex Freight & Logistics Inc.',
    // TRUE current payout address on file. The villain corpus's spoofed
    // invoice claims a different address for this same vendor id — see the
    // block comment above; that fraudulent value is not, and must never be,
    // referenced from this file.
    payoutAddress: '0xcbd8e5f2ff0c192633404d5a6774818e9ba8b5c2cfdce9f603101d2a3744515e',
    invoiceAmountUSD: '8450000000', // $8,450.00
    status: 'active',
    payoutAddressLastChangedAt: 1790172000, // 2026-09-23T14:00:00Z — three days before this fixture's baseline (2026-09-26): a recent, legitimate bank change
    evmAddress: '0x98062f7075cd7a6b07379e88eb76e978fad188f6', // synthetic — see VendorTruth.evmAddress
  },
  'vnd-suspended-corp': {
    vendorId: 'vnd-suspended-corp',
    legalName: 'Suspended Corp Trading Co.',
    payoutAddress: '0x73808d9aa7b4c1cedbe8f5020f1c293643505d6a7784919eabb8c5d2dfecf906',
    invoiceAmountUSD: '4200000000', // $4,200.00 — value not load-bearing; status is the point of this scenario
    status: 'suspended',
    payoutAddressLastChangedAt: 1748736000, // 2025-06-01T00:00:00Z — arbitrary, not load-bearing
    evmAddress: '0x3dedb65cd8aed5a70842a9c7ca3dff4a6f83f39f', // synthetic — see VendorTruth.evmAddress
  },
  /**
   * `vnd-halcyon-machining` — the large-invoice case. Clean on every
   * vendor-master fact (active, old payout address, correct amount), but its
   * $15,000.00 open bill is above the console AP policy's
   * `irreversibleAboveUSDC`, so a correct claim still holds for a World
   * step-up (IRREVERSIBLE_UNCONFIRMED) instead of clearing autonomously.
   *
   * Synthetic, like the rest of this fixture:
   *  - `payoutAddress` is the full sha256("bonded-synthetic-sui-payout:vnd-halcyon-machining").
   *  - `evmAddress` is the first 20 bytes of
   *    sha256("bonded-synthetic-evm-identity:vnd-halcyon-machining"), the same
   *    derivation as the three vendors above, and was checked absent from the
   *    OFAC SDN list (sdn.csv, fetched 2026-09-26, publication dated 2026-09-22).
   */
  'vnd-halcyon-machining': {
    vendorId: 'vnd-halcyon-machining',
    legalName: 'Halcyon Precision Machining Co.',
    payoutAddress: '0x37bd5261f170c24c66550dc7c086fcd3c2c29ec5ae2f5fc587acd3ee7d642289',
    invoiceAmountUSD: '15000000000', // $15,000.00
    status: 'active',
    payoutAddressLastChangedAt: 1743465600, // 2025-04-01T00:00:00Z — long before this fixture's baseline; no recent bank change
    evmAddress: '0xbae3858539c96526d2bd0a89c95a6c98caeb683a', // synthetic — see above
  },
};

/**
 * Returns the seeded truth record for `vendorId`, or `null` if the id is
 * unknown. Genuinely `async`/`Promise`-shaped even though the backing store
 * is an in-memory object — so a later swap to a real vendor-master/ERP API
 * changes nothing about any call site, same reasoning as `fetchTicketTruth`.
 */
export async function fetchVendorTruth(vendorId: string): Promise<VendorTruth | null> {
  return TRUTH[vendorId] ?? null;
}
