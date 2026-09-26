/**
 * The audit-trail merge and the settlement summary behind `/activity` and `/`.
 *
 * CLAUDE.md rule 7: every record below is OUR OWN input shape (a ledger entry, a vendor-master
 * change, a stored IDKit request as this app writes them), with obviously synthetic values. No
 * World proof, World token or Intercepta response is constructed; nothing here is presented as
 * sponsor data. The functions under test only sort, count and format.
 */
import type { Hash32 } from '@bonded/seam';
import type { VendorMasterChange } from '@bonded/issuer-oracle';
import { buildActivityTimeline, formatUsdc6, summarizeSettlements } from '../activity.js';
import type { LedgerEntry } from '../settlement-ledger.js';
import type { VerifiedVendorBankChangeRequest } from '../vendor-bank-change.js';

const H = (n: string) => `0x${n.repeat(64)}` as Hash32;
const ADDR = (n: string) => `0x${n.repeat(64)}` as `0x${string}`;

function settled(p: string, invoiceId: string, valueUsdc: string, settledAtMs: number, viaStepup = false): LedgerEntry {
  return {
    status: 'settled',
    proposalHash: H(p),
    invoiceId,
    startedAtMs: settledAtMs - 5_000,
    digest: `digest-${p}`,
    explorerUrl: `https://example.invalid/tx/digest-${p}`,
    vendorId: 'vnd-test',
    recipient: ADDR('c'),
    valueUsdc,
    viaStepup,
    settledAtMs,
  };
}

const change: VendorMasterChange = {
  vendorId: 'vnd-test',
  field: 'payoutAddress',
  previousPayoutAddress: ADDR('a'),
  newPayoutAddress: ADDR('b'),
  appliedTo: 'fixture-overlay',
  approvedBy: { worldSub: 'TEST_SUB_NOT_A_REAL_WORLD_SUBJECT', authTimeMs: 1_500 },
  proposalHash: H('2'),
  recordedAtMs: 2_000,
};

const request: VerifiedVendorBankChangeRequest = {
  vendorId: 'vnd-test',
  newPayoutAddress: ADDR('b'),
  newEvmAddress: '0x' + '1'.repeat(40),
  signal: 'test-signal',
  signalHash: '0x1',
  action: 'test-action',
  environment: 'staging',
  protocolVersion: '3.0',
  credentialType: 'document',
  issuerSchemaId: null,
  nullifier: '12345',
  verifiedAtMs: 1_000,
};

describe('formatUsdc6', () => {
  it('formats 6-decimal base units with bigint only, truncating below the cent', () => {
    expect(formatUsdc6('1250000000')).toBe('1,250.00');
    expect(formatUsdc6(8_450_000_000n)).toBe('8,450.00');
    expect(formatUsdc6('0')).toBe('0.00');
    expect(formatUsdc6('999999')).toBe('0.99');
    expect(formatUsdc6('123456789012345678')).toBe('123,456,789,012.34');
  });

  it('rejects anything that is not a non-negative integer string', () => {
    expect(() => formatUsdc6('12.5')).toThrow();
    expect(() => formatUsdc6('-1')).toThrow();
    expect(() => formatUsdc6('')).toThrow();
  });
});

describe('summarizeSettlements', () => {
  it('counts and sums only settled entries, as a bigint', () => {
    const entries: LedgerEntry[] = [
      settled('1', 'inv-a', '1250000000', 10),
      settled('2', 'inv-b', '8450000000', 20),
      { status: 'pending', proposalHash: H('3'), invoiceId: 'inv-c', startedAtMs: 30 },
      { status: 'unknown', proposalHash: H('4'), invoiceId: 'inv-d', startedAtMs: 40, error: 'x' },
    ];
    const s = summarizeSettlements(entries);
    expect(s.paidCount).toBe(2);
    expect(s.totalUsdc).toBe(9_700_000_000n);
    expect(s.settled.map((e) => e.invoiceId)).toEqual(['inv-b', 'inv-a']);
    expect(s.unresolved.map((e) => e.status)).toEqual(['pending', 'unknown']);
  });

  it('is zero for an empty ledger', () => {
    expect(summarizeSettlements([])).toEqual({ paidCount: 0, totalUsdc: 0n, settled: [], unresolved: [] });
  });
});

describe('buildActivityTimeline', () => {
  it('merges the three stores into one timeline, newest first', () => {
    const events = buildActivityTimeline({
      ledger: [settled('2', 'inv-b', '8450000000', 3_000, true)],
      vendorMasterChanges: [change],
      vendorRequests: [request],
    });
    expect(events.map((e) => e.kind)).toEqual(['settlement', 'vendor-master-change', 'vendor-request']);
    expect(events.map((e) => e.atMs)).toEqual([3_000, 2_000, 1_000]);
  });

  it('dates a settled entry by settledAtMs and an unfinished one by startedAtMs', () => {
    const events = buildActivityTimeline({
      ledger: [
        settled('1', 'inv-a', '1', 50),
        { status: 'unknown', proposalHash: H('4'), invoiceId: 'inv-d', startedAtMs: 70, error: 'SuiCliError: timeout' },
      ],
      vendorMasterChanges: [],
      vendorRequests: [],
    });
    expect(events.map((e) => e.atMs)).toEqual([70, 50]);
  });

  it('keeps a deterministic order for equal timestamps (settlement, change, request)', () => {
    const events = buildActivityTimeline({
      ledger: [settled('1', 'inv-a', '1', 1_000)],
      vendorMasterChanges: [{ ...change, recordedAtMs: 1_000 }],
      vendorRequests: [request],
    });
    expect(events.map((e) => e.kind)).toEqual(['settlement', 'vendor-master-change', 'vendor-request']);
  });

  it('returns nothing for empty stores', () => {
    expect(buildActivityTimeline({ ledger: [], vendorMasterChanges: [], vendorRequests: [] })).toEqual([]);
  });
});
