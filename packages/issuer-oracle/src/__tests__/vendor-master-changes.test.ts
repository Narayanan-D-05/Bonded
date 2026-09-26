/**
 * The vendor-master change log + fixture overlay, and the bank-change writer.
 *
 * Every test writes to its own temp directory, never to the workspace
 * `.data/`. The Xero half uses a recording fake fetch in place of the
 * network, in the same convention as `xero.test.ts` (hand-built bodies in
 * Xero's documented shapes, NOT Xero data). The live Xero write needs real
 * credentials and is not exercised here.
 */

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fetchVendorTruth } from '../vendor-fixture.js';
import {
  VendorMasterChangeError,
  appendVendorMasterChange,
  applyVendorMasterChanges,
  createFixtureVendorSourceWithChanges,
  defaultVendorMasterChangeLogPath,
  readVendorMasterChanges,
  type VendorMasterChange,
} from '../vendor-master-changes.js';
import { createVendorSource } from '../sources/select.js';
import { createVendorMasterBankChangeWriter } from '../sources/bank-change.js';
import { XeroClient, XeroDataError, type FetchLike } from '../sources/xero.js';

const GLOBEX_ON_FILE = '0xcbd8e5f2ff0c192633404d5a6774818e9ba8b5c2cfdce9f603101d2a3744515e' as const;
const GLOBEX_NEW = '0x053cbe6fe7b37c2f10a0d30eab88de7466cb9f63a6145a3d963fb9ccd81631ad' as const;
const GLOBEX_EVM = '0x98062f7075cd7a6b07379e88eb76e978fad188f6';
const PROPOSAL = `0x${'5a'.repeat(32)}` as const;
const RECORDED_AT_MS = 1_790_400_123_456;

function tempLog(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), 'bonded-vm-')), 'vendor-master-changes.json');
}

function change(over: Partial<VendorMasterChange> = {}): VendorMasterChange {
  return {
    vendorId: 'vnd-globex-freight',
    field: 'payoutAddress',
    previousPayoutAddress: GLOBEX_ON_FILE,
    newPayoutAddress: GLOBEX_NEW,
    appliedTo: 'fixture-overlay',
    approvedBy: { worldSub: 'world-sub-1', authTimeMs: RECORDED_AT_MS - 1_000 },
    proposalHash: PROPOSAL,
    recordedAtMs: RECORDED_AT_MS,
    ...over,
  };
}

describe('fixture overlay: applyVendorMasterChanges / createFixtureVendorSourceWithChanges', () => {
  it('a missing change log leaves every vendor exactly as seeded', async () => {
    const source = createFixtureVendorSourceWithChanges(tempLog());
    for (const id of ['vnd-acme-supplies', 'vnd-globex-freight', 'vnd-suspended-corp', 'vnd-halcyon-machining']) {
      expect(await source(id)).toEqual(await fetchVendorTruth(id));
    }
    await expect(source('vnd-does-not-exist')).resolves.toBeNull();
  });

  it('an appended change becomes the payout truth, with payoutAddressLastChangedAt = recordedAt (seconds)', async () => {
    const log = tempLog();
    await appendVendorMasterChange(log, change());
    const truth = await createFixtureVendorSourceWithChanges(log)('vnd-globex-freight');
    expect(truth?.payoutAddress).toBe(GLOBEX_NEW);
    expect(truth?.payoutAddressLastChangedAt).toBe(Math.floor(RECORDED_AT_MS / 1000));
    // Everything else is untouched.
    const seeded = (await fetchVendorTruth('vnd-globex-freight'))!;
    expect({ ...truth, payoutAddress: seeded.payoutAddress, payoutAddressLastChangedAt: seeded.payoutAddressLastChangedAt }).toEqual(seeded);
  });

  it('never mutates the seeded fixture, and never touches other vendors', async () => {
    const log = tempLog();
    await appendVendorMasterChange(log, change());
    expect((await fetchVendorTruth('vnd-globex-freight'))?.payoutAddress).toBe(GLOBEX_ON_FILE);
    const source = createFixtureVendorSourceWithChanges(log);
    expect(await source('vnd-acme-supplies')).toEqual(await fetchVendorTruth('vnd-acme-supplies'));
  });

  it('xero entries are audit-only and are not overlaid on the fixture', async () => {
    const seeded = (await fetchVendorTruth('vnd-globex-freight'))!;
    expect(applyVendorMasterChanges(seeded, [change({ appliedTo: 'xero' })])).toEqual(seeded);
  });

  it('entries apply in log order (the latest change wins)', async () => {
    const seeded = (await fetchVendorTruth('vnd-globex-freight'))!;
    const third = `0x${'77'.repeat(32)}` as const;
    const out = applyVendorMasterChanges(seeded, [
      change(),
      change({ previousPayoutAddress: GLOBEX_NEW, newPayoutAddress: third, recordedAtMs: RECORDED_AT_MS + 5_000 }),
    ]);
    expect(out.payoutAddress).toBe(third);
    expect(out.payoutAddressLastChangedAt).toBe(Math.floor((RECORDED_AT_MS + 5_000) / 1000));
  });
});

describe('appendVendorMasterChange: append-only, compare-and-set, never resets', () => {
  it('appends, keeping every earlier entry and the approver details', async () => {
    const log = tempLog();
    await appendVendorMasterChange(log, change());
    await appendVendorMasterChange(log, change({ previousPayoutAddress: GLOBEX_NEW, newPayoutAddress: GLOBEX_ON_FILE, recordedAtMs: RECORDED_AT_MS + 1 }));
    const entries = await readVendorMasterChanges(log);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual(change());
    expect(entries[0]?.approvedBy).toEqual({ worldSub: 'world-sub-1', authTimeMs: RECORDED_AT_MS - 1_000 });
    expect(entries[0]?.proposalHash).toBe(PROPOSAL);
  });

  it('refuses when the named previous address is no longer the one on file (a racing second approval)', async () => {
    const log = tempLog();
    await appendVendorMasterChange(log, change());
    await expect(appendVendorMasterChange(log, change({ newPayoutAddress: `0x${'66'.repeat(32)}` }))).rejects.toThrow(
      /changed since this approval was requested/,
    );
    expect(await readVendorMasterChanges(log)).toHaveLength(1);
  });

  it('refuses a no-op change and an unknown vendor', async () => {
    const log = tempLog();
    await expect(appendVendorMasterChange(log, change({ newPayoutAddress: GLOBEX_ON_FILE }))).rejects.toThrow(/nothing to change/);
    await expect(appendVendorMasterChange(log, change({ vendorId: 'vnd-nope' }))).rejects.toThrow(/not in the vendor master/);
  });

  it('refuses malformed entries, naming the field (no coercion)', async () => {
    const log = tempLog();
    await expect(appendVendorMasterChange(log, change({ newPayoutAddress: '0xABC' as `0x${string}` }))).rejects.toThrow(/newPayoutAddress/);
    await expect(
      appendVendorMasterChange(log, change({ approvedBy: { worldSub: '', authTimeMs: 1 } })),
    ).rejects.toThrow(/approvedBy.worldSub/);
    await expect(appendVendorMasterChange(log, change({ proposalHash: '0x12' as `0x${string}` }))).rejects.toThrow(/proposalHash/);
  });

  it('a corrupt log throws on read and is never overwritten by an append', async () => {
    const log = tempLog();
    await appendVendorMasterChange(log, change()); // creates the directory
    writeFileSync(log, '{not json', 'utf8');
    await expect(readVendorMasterChanges(log)).rejects.toThrow(VendorMasterChangeError);
    await expect(appendVendorMasterChange(log, change())).rejects.toThrow(/not valid JSON/);
    expect(readFileSync(log, 'utf8')).toBe('{not json');
    await expect(createFixtureVendorSourceWithChanges(log)('vnd-globex-freight')).rejects.toThrow(VendorMasterChangeError);
  });
});

describe('createVendorSource with changeLogPath', () => {
  it('fixture mode + changeLogPath overlays the log; without it the source is still exactly fetchVendorTruth', async () => {
    const log = tempLog();
    await appendVendorMasterChange(log, change());
    expect(createVendorSource({})).toBe(fetchVendorTruth);
    const overlaid = createVendorSource({}, { changeLogPath: log });
    expect((await overlaid('vnd-globex-freight'))?.payoutAddress).toBe(GLOBEX_NEW);
  });

  it('defaultVendorMasterChangeLogPath is <workspace>/.data/vendor-master-changes.json, or the env override', () => {
    const p = defaultVendorMasterChangeLogPath({});
    expect(p.endsWith(path.join('.data', 'vendor-master-changes.json'))).toBe(true);
    expect(defaultVendorMasterChangeLogPath({ BONDED_VENDOR_MASTER_CHANGELOG: '/tmp/x.json' })).toBe(path.resolve('/tmp/x.json'));
  });
});

describe('createVendorMasterBankChangeWriter', () => {
  const approval = { worldSub: 'world-sub-9', authTimeMs: RECORDED_AT_MS - 2_000 };

  it('fixture mode: appends a fixture-overlay entry and reads the new address back through the overlay', async () => {
    const log = tempLog();
    const write = createVendorMasterBankChangeWriter({}, { changeLogPath: log });
    const result = await write({
      vendorId: 'vnd-globex-freight',
      previousPayoutAddress: GLOBEX_ON_FILE,
      newPayoutAddress: GLOBEX_NEW,
      approvedBy: approval,
      proposalHash: PROPOSAL,
      recordedAtMs: RECORDED_AT_MS,
    });
    expect(result.change.appliedTo).toBe('fixture-overlay');
    expect(result.change.approvedBy).toEqual(approval);
    expect(result.truthAfter.payoutAddress).toBe(GLOBEX_NEW);
    expect(await readVendorMasterChanges(log)).toHaveLength(1);
  });

  describe('xero mode (a recording fake fetch in place of the network, for testing only)', () => {
    const CONTACT_ID = 'bd2270c3-8706-4c11-9cfb-000b551c3f51';
    function contactBody(sui: string): string {
      return `{"Contacts":[{"ContactID":"${CONTACT_ID}","ContactNumber":"vnd-globex-freight","ContactStatus":"ACTIVE",` +
        `"Name":"Globex Freight & Logistics Inc.","BankAccountDetails":"bonded:v1;sui=${sui};evm=${GLOBEX_EVM}",` +
        `"UpdatedDateUTC":"\\/Date(1790400000000+0000)\\/"}]}`;
    }
    const billsBody =
      '{"Invoices":[{"Type":"ACCPAY","InvoiceID":"00000000-0000-0000-0000-000000000001","InvoiceNumber":"BONDED-vnd-globex-freight",' +
      '"Status":"AUTHORISED","Date":"\\/Date(1790121600000+0000)\\/","UpdatedDateUTC":"\\/Date(1790172000000+0000)\\/",' +
      '"Total":8450.00,"AmountDue":"8450.00","CurrencyCode":"USD"}]}';
    const tokenOk = { status: 200, body: '{"access_token":"tok","expires_in":1800,"token_type":"Bearer"}' };

    function fakeFetch(responses: Array<{ status: number; body: string }>) {
      const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
      const fetchImpl: FetchLike = async (url, init) => {
        calls.push({ url, init });
        const r = responses.shift();
        if (r === undefined) throw new Error('unexpected extra request');
        return new Response(r.body, { status: r.status });
      };
      return { fetchImpl, calls };
    }

    it('POSTs the new BankAccountDetails (keeping the EVM identity), audits to the log, and reads back through the Xero source', async () => {
      const log = tempLog();
      const { fetchImpl, calls } = fakeFetch([
        tokenOk,
        { status: 200, body: contactBody(GLOBEX_ON_FILE) }, // find contact
        { status: 200, body: contactBody(GLOBEX_NEW) }, // POST /Contacts echo
        { status: 200, body: contactBody(GLOBEX_NEW) }, // read-back: contact
        { status: 200, body: billsBody }, // read-back: bills
      ]);
      const xeroClient = new XeroClient({ clientId: 'id', clientSecret: 's' }, { fetchImpl, scopes: ['accounting.contacts', 'accounting.invoices.read'] });
      const write = createVendorMasterBankChangeWriter({ VENDOR_MASTER_SOURCE: 'xero' }, { changeLogPath: log, xeroClient });
      const result = await write({
        vendorId: 'vnd-globex-freight',
        previousPayoutAddress: GLOBEX_ON_FILE,
        newPayoutAddress: GLOBEX_NEW,
        approvedBy: approval,
        proposalHash: PROPOSAL,
        recordedAtMs: RECORDED_AT_MS,
      });
      const post = calls[2]!;
      expect(post.init?.method).toBe('POST');
      expect(new URL(post.url).pathname).toBe('/api.xro/2.0/Contacts');
      expect(JSON.parse(String(post.init?.body))).toEqual({
        Contacts: [{ ContactID: CONTACT_ID, BankAccountDetails: `bonded:v1;sui=${GLOBEX_NEW};evm=${GLOBEX_EVM}` }],
      });
      expect(result.change.appliedTo).toBe('xero');
      expect(result.truthAfter.payoutAddress).toBe(GLOBEX_NEW);
      const entries = await readVendorMasterChanges(log);
      expect(entries).toHaveLength(1);
      expect(entries[0]?.approvedBy).toEqual(approval);
    });

    it('refuses (compare-and-set) when Xero already holds a different payout address, writing nothing', async () => {
      const log = tempLog();
      const { fetchImpl, calls } = fakeFetch([tokenOk, { status: 200, body: contactBody(`0x${'44'.repeat(32)}`) }]);
      const xeroClient = new XeroClient({ clientId: 'id', clientSecret: 's' }, { fetchImpl });
      const write = createVendorMasterBankChangeWriter({ VENDOR_MASTER_SOURCE: 'xero' }, { changeLogPath: log, xeroClient });
      await expect(
        write({ vendorId: 'vnd-globex-freight', previousPayoutAddress: GLOBEX_ON_FILE, newPayoutAddress: GLOBEX_NEW, approvedBy: approval, proposalHash: PROPOSAL }),
      ).rejects.toThrow(XeroDataError);
      // Only the token request (itself a POST) and the contact lookup ran: no POST /Contacts.
      expect(calls.filter((c) => c.init?.method === 'POST' && c.url.includes('/Contacts'))).toHaveLength(0);
      expect(calls).toHaveLength(2);
      expect(await readVendorMasterChanges(log)).toHaveLength(0);
    });
  });
});
