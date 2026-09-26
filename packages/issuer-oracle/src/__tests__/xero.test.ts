/**
 * Tests for OUR Xero parser/mapper and request construction. They are NOT
 * Xero data.
 *
 * Every response body below is hand-built from the shapes Xero documents, and
 * none of it was returned by a live Xero organisation:
 *  - Contacts example response:
 *    https://developer.xero.com/documentation/api/accounting/contacts/ ("Example response for GET Contacts")
 *  - Invoices example response (note it shows amounts both as JSON strings and
 *    as JSON numbers):
 *    https://developer.xero.com/documentation/api/accounting/invoices/
 *  - /Date(ms+0000)/ format:
 *    https://developer.xero.com/documentation/api/accounting/requests-and-responses/
 *  - ApiException 400 body:
 *    https://developer.xero.com/documentation/api/accounting/responsecodes/
 *  - 429 + X-Rate-Limit-Problem / Retry-After:
 *    https://developer.xero.com/documentation/guides/oauth2/limits/
 * Addresses/amounts are the fixture's seeded values, reused so the mapping is
 * checked against a known answer.
 *
 * The live check against a real Xero org is `scripts/xero-live-check.ts`,
 * which fails visibly without credentials. Nothing here stands in for it.
 */

import {
  XeroApiError,
  XeroClient,
  XeroConfigError,
  XeroDataError,
  apiExceptionMessages,
  baseUnits6ToDecimal2,
  createXeroVendorSource,
  decimalToBaseUnits6,
  encodePayoutDetails,
  mapContactStatus,
  mapToVendorTruth,
  parsePayoutDetails,
  parseXeroDateToUnixSeconds,
  parseXeroJson,
  quoteJsonNumbers,
  readXeroCredentials,
  selectContactByNumber,
  selectLatestOpenBill,
  type FetchLike,
  type XeroInvoice,
} from '../sources/xero.js';
import { createVendorSource, vendorSourceKind } from '../sources/select.js';
import { fetchVendorTruth } from '../vendor-fixture.js';
import { issuerOracleVendors, vendorTruthFields } from '../schemas.js';

const SUI = '0xcbd8e5f2ff0c192633404d5a6774818e9ba8b5c2cfdce9f603101d2a3744515e';
const EVM = '0x98062f7075cd7a6b07379e88eb76e978fad188f6';
const CONTACT_ID = 'bd2270c3-8706-4c11-9cfb-000b551c3f51'; // the documented example's ContactID

/** Contact JSON text in the documented shape (Contacts page example), with Bonded-format bank details. */
function contactsBody(overrides: Record<string, string> = {}): string {
  const c: Record<string, string> = {
    ContactID: `"${CONTACT_ID}"`,
    ContactNumber: '"vnd-globex-freight"',
    ContactStatus: '"ACTIVE"',
    Name: '"Globex Freight & Logistics Inc."',
    BankAccountDetails: `"bonded:v1;sui=${SUI};evm=${EVM}"`,
    UpdatedDateUTC: '"\\/Date(1790172000000+0000)\\/"',
    IsSupplier: 'true',
    IsCustomer: 'false',
    ...overrides,
  };
  return `{"Contacts":[{${Object.entries(c).map(([k, v]) => `"${k}":${v}`).join(',')}}]}`;
}

/** Invoices JSON text in the documented shape; `Total` deliberately a JSON NUMBER, as the OpenAPI spec types it. */
function invoicesBody(): string {
  return `{"Invoices":[
    {"Type":"ACCPAY","InvoiceID":"00000000-0000-0000-0000-000000000001","InvoiceNumber":"BONDED-vnd-globex-freight","Status":"AUTHORISED",
     "Date":"\\/Date(1790121600000+0000)\\/","UpdatedDateUTC":"\\/Date(1790172000000+0000)\\/",
     "SubTotal":8450.00,"TotalTax":0.00,"Total":8450.00,"AmountDue":"8450.00","CurrencyCode":"USD"}]}`;
}

describe('quoteJsonNumbers / parseXeroJson: money never becomes a JS number', () => {
  it('turns JSON number tokens into strings of the exact same characters', () => {
    const parsed = parseXeroJson('{"SubTotal": 1800.00, "AmountDue": "1025.00", "IsSupplier": false, "X": null}') as Record<string, unknown>;
    expect(parsed.SubTotal).toBe('1800.00'); // a JSON number in the doc example, and it survives with its trailing zeros
    expect(parsed.AmountDue).toBe('1025.00');
    expect(parsed.IsSupplier).toBe(false);
    expect(parsed.X).toBeNull();
  });

  it('leaves digits and escaped quotes inside strings untouched', () => {
    const text = '{"Details":"INV-0041 to ABC \\"Furniture\\" for 100.00.","n":-5}';
    expect(quoteJsonNumbers(text)).toBe('{"Details":"INV-0041 to ABC \\"Furniture\\" for 100.00.","n":"-5"}');
  });

  it('keeps a >2^53 number exact (it would lose precision as a JS number)', () => {
    const parsed = parseXeroJson('{"Total": 9007199254740993.25}') as Record<string, unknown>;
    expect(parsed.Total).toBe('9007199254740993.25');
    expect(decimalToBaseUnits6(parsed.Total)).toBe(9007199254740993250000n);
  });

  it('throws a visible XeroDataError on non-JSON', () => {
    expect(() => parseXeroJson('<html>')).toThrow(XeroDataError);
  });
});

describe('decimalToBaseUnits6 / baseUnits6ToDecimal2', () => {
  it('converts with integer math', () => {
    expect(decimalToBaseUnits6('8450.00')).toBe(8_450_000_000n);
    expect(decimalToBaseUnits6('1250')).toBe(1_250_000_000n);
    expect(decimalToBaseUnits6('0.1')).toBe(100_000n);
    expect(decimalToBaseUnits6('0.000001')).toBe(1n);
    expect(decimalToBaseUnits6('0.00')).toBe(0n);
  });

  it('rejects numbers, negatives, exponents and >6 fractional digits', () => {
    expect(() => decimalToBaseUnits6(1250)).toThrow(XeroDataError);
    expect(() => decimalToBaseUnits6('-1.00')).toThrow(XeroDataError);
    expect(() => decimalToBaseUnits6('1e3')).toThrow(XeroDataError);
    expect(() => decimalToBaseUnits6('1.0000001')).toThrow(XeroDataError);
    expect(() => decimalToBaseUnits6('')).toThrow(XeroDataError);
  });

  it('round-trips the fixture amounts to 2dp Xero amounts', () => {
    expect(baseUnits6ToDecimal2(1_250_000_000n)).toBe('1250.00');
    expect(baseUnits6ToDecimal2(8_450_000_000n)).toBe('8450.00');
    expect(baseUnits6ToDecimal2(4_200_050_000n)).toBe('4200.05');
    expect(decimalToBaseUnits6(baseUnits6ToDecimal2(8_450_000_000n))).toBe(8_450_000_000n);
    expect(() => baseUnits6ToDecimal2(1n)).toThrow(XeroDataError);
  });
});

describe('parseXeroDateToUnixSeconds', () => {
  it('parses both documented forms, with and without offset', () => {
    expect(parseXeroDateToUnixSeconds('/Date(1488391422280+0000)/')).toBe(1488391422);
    expect(parseXeroDateToUnixSeconds('/Date(1573755038314)/')).toBe(1573755038);
    // what JSON.parse yields for the documented "\/Date(...)\/" text
    expect(parseXeroDateToUnixSeconds((parseXeroJson('{"d":"\\/Date(1439434356790)\\/"}') as { d: string }).d)).toBe(1439434356);
  });

  it('rejects anything else', () => {
    expect(() => parseXeroDateToUnixSeconds('2018-02-15T09:12:30Z')).toThrow(XeroDataError);
    expect(() => parseXeroDateToUnixSeconds(1488391422280)).toThrow(XeroDataError);
  });
});

describe('BankAccountDetails payout format', () => {
  it('encodes and parses bonded:v1;sui=...;evm=... and lowercases hex', () => {
    const enc = encodePayoutDetails(SUI, EVM);
    expect(enc).toBe(`bonded:v1;sui=${SUI};evm=${EVM}`);
    expect(parsePayoutDetails(enc)).toEqual({ payoutAddress: SUI, evmAddress: EVM });
    expect(parsePayoutDetails(`bonded:v1;sui=${SUI.toUpperCase().replace('0X', '0x')};evm=${EVM}`).payoutAddress).toBe(SUI);
  });

  it('rejects the plain bank account number from the documented example, and empty details', () => {
    expect(() => parsePayoutDetails('45465844')).toThrow(XeroDataError);
    expect(() => parsePayoutDetails('')).toThrow(XeroDataError);
    expect(() => parsePayoutDetails(undefined)).toThrow(XeroDataError);
    expect(() => encodePayoutDetails('0x1234', EVM)).toThrow(XeroDataError);
  });
});

describe('mapContactStatus', () => {
  it('maps the three documented ContactStatus values', () => {
    expect(mapContactStatus('ACTIVE')).toBe('active');
    expect(mapContactStatus('ARCHIVED')).toBe('suspended');
    expect(mapContactStatus('GDPRREQUEST')).toBe('suspended');
    expect(() => mapContactStatus('DELETED')).toThrow(XeroDataError);
  });
});

describe('selectContactByNumber / selectLatestOpenBill', () => {
  it('exact ContactNumber match, null when absent, throws when ambiguous', () => {
    const a = { ContactNumber: 'vnd-a' };
    expect(selectContactByNumber([a, { ContactNumber: 'vnd-b' }], 'vnd-a')).toBe(a);
    expect(selectContactByNumber([a], 'vnd-zzz')).toBeNull();
    expect(() => selectContactByNumber([a, { ContactNumber: 'vnd-a' }], 'vnd-a')).toThrow(XeroDataError);
  });

  const bill = (over: Partial<Record<keyof XeroInvoice, string>>): XeroInvoice => ({
    Type: 'ACCPAY',
    Status: 'AUTHORISED',
    Date: '/Date(1790121600000+0000)/',
    UpdatedDateUTC: '/Date(1790121600000+0000)/',
    Total: '100.00',
    AmountDue: '100.00',
    CurrencyCode: 'USD',
    ...over,
  });

  it('picks the latest-dated AUTHORISED ACCPAY bill with AmountDue > 0', () => {
    const older = bill({ Date: '/Date(1780000000000+0000)/', Total: '1.00' });
    const latest = bill({ Total: '8450.00' });
    const paid = bill({ Date: '/Date(1799999999000+0000)/', AmountDue: '0.00' });
    const sales = bill({ Date: '/Date(1799999999000+0000)/', Type: 'ACCREC' });
    const draft = bill({ Date: '/Date(1799999999000+0000)/', Status: 'DRAFT' });
    expect(selectLatestOpenBill([older, paid, latest, sales, draft])).toBe(latest);
    expect(selectLatestOpenBill([paid, sales])).toBeNull();
  });

  it('breaks a Date tie by UpdatedDateUTC, and throws on a full tie', () => {
    const a = bill({ UpdatedDateUTC: '/Date(1790121700000+0000)/' });
    const b = bill({});
    expect(selectLatestOpenBill([b, a])).toBe(a);
    expect(() => selectLatestOpenBill([bill({}), bill({})])).toThrow(XeroDataError);
  });
});

describe('mapToVendorTruth', () => {
  const contact = () => (parseXeroJson(contactsBody()) as { Contacts: Record<string, unknown>[] }).Contacts[0]!;
  const openBill = () => (parseXeroJson(invoicesBody()) as { Invoices: XeroInvoice[] }).Invoices[0]!;

  it('produces exactly the VendorTruth shape', () => {
    expect(mapToVendorTruth('vnd-globex-freight', contact(), openBill())).toEqual({
      vendorId: 'vnd-globex-freight',
      legalName: 'Globex Freight & Logistics Inc.',
      payoutAddress: SUI,
      evmAddress: EVM,
      invoiceAmountUSD: '8450000000',
      status: 'active',
      payoutAddressLastChangedAt: 1790172000, // UpdatedDateUTC = last CONTACT update
    });
  });

  it('refuses to invent: no bill, non-USD bill, or missing name all throw', () => {
    expect(() => mapToVendorTruth('vnd-globex-freight', contact(), null)).toThrow(XeroDataError);
    expect(() => mapToVendorTruth('vnd-globex-freight', contact(), { ...openBill(), CurrencyCode: 'NZD' })).toThrow(/not USD/);
    expect(() => mapToVendorTruth('vnd-globex-freight', { ...contact(), Name: '' }, openBill())).toThrow(XeroDataError);
  });
});

describe('apiExceptionMessages', () => {
  it('extracts Message and ValidationErrors from the documented 400 body', () => {
    const body = parseXeroJson(
      '{"ErrorNumber":10,"Type":"ValidationException","Message":"A validation exception occurred","Elements":[{"ValidationErrors":[{"Message":"Email address must be valid"}]}]}',
    );
    expect(apiExceptionMessages(body)).toEqual(['A validation exception occurred', 'Email address must be valid']);
  });
});

describe('XeroClient request construction (a recording fake fetch in place of the network, for testing only)', () => {
  type Call = { url: string; init: RequestInit | undefined };

  function fakeFetch(responses: Array<{ status: number; body: string; headers?: Record<string, string> }>): { fetchImpl: FetchLike; calls: Call[] } {
    const calls: Call[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push({ url, init });
      const r = responses.shift();
      if (r === undefined) throw new Error('unexpected extra request');
      return new Response(r.body, { status: r.status, headers: r.headers ?? {} });
    };
    return { fetchImpl, calls };
  }

  const tokenOk = { status: 200, body: '{"access_token":"tok-1","expires_in":1800,"token_type":"Bearer","scope":"accounting.contacts.read accounting.invoices.read"}' };

  it('does client_credentials, then GET Contacts by ContactNumber (incl. archived), then GET open ACCPAY bills', async () => {
    const { fetchImpl, calls } = fakeFetch([tokenOk, { status: 200, body: contactsBody() }, { status: 200, body: invoicesBody() }]);
    const source = createXeroVendorSource(new XeroClient({ clientId: 'id', clientSecret: 'secret' }, { fetchImpl }));
    const truth = await source('vnd-globex-freight');
    expect(truth?.invoiceAmountUSD).toBe('8450000000');

    expect(calls[0]!.url).toBe('https://identity.xero.com/connect/token');
    const tokenHeaders = calls[0]!.init!.headers as Record<string, string>;
    expect(tokenHeaders.authorization).toBe(`Basic ${Buffer.from('id:secret').toString('base64')}`);
    expect(String(calls[0]!.init!.body)).toBe('grant_type=client_credentials&scope=accounting.contacts.read+accounting.invoices.read');

    const contactsUrl = new URL(calls[1]!.url);
    expect(contactsUrl.origin + contactsUrl.pathname).toBe('https://api.xero.com/api.xro/2.0/Contacts');
    expect(contactsUrl.searchParams.get('where')).toBe('ContactNumber=="vnd-globex-freight"');
    expect(contactsUrl.searchParams.get('includeArchived')).toBe('true');
    const apiHeaders = calls[1]!.init!.headers as Record<string, string>;
    expect(apiHeaders.authorization).toBe('Bearer tok-1');
    expect(apiHeaders.accept).toBe('application/json');
    expect(apiHeaders['xero-tenant-id']).toBeUndefined(); // only sent when XERO_TENANT_ID is set

    const invUrl = new URL(calls[2]!.url);
    expect(invUrl.pathname).toBe('/api.xro/2.0/Invoices');
    expect(invUrl.searchParams.get('ContactIDs')).toBe(CONTACT_ID);
    expect(invUrl.searchParams.get('Statuses')).toBe('AUTHORISED');
    expect(invUrl.searchParams.get('where')).toBe('Type=="ACCPAY"');
  });

  it('returns null for an unknown vendor, reuses the cached token, and sends xero-tenant-id when configured', async () => {
    const { fetchImpl, calls } = fakeFetch([tokenOk, { status: 200, body: '{"Contacts":[]}' }, { status: 200, body: '{"Contacts":[]}' }]);
    const source = createXeroVendorSource(new XeroClient({ clientId: 'id', clientSecret: 's', tenantId: 'tenant-guid' }, { fetchImpl }));
    await expect(source('vnd-nope')).resolves.toBeNull();
    await expect(source('vnd-nope-2')).resolves.toBeNull();
    expect(calls).toHaveLength(3); // one token call only
    expect((calls[1]!.init!.headers as Record<string, string>)['xero-tenant-id']).toBe('tenant-guid');
  });

  it('surfaces a 429 with X-Rate-Limit-Problem and Retry-After, never retrying silently', async () => {
    const { fetchImpl } = fakeFetch([tokenOk, { status: 429, body: '', headers: { 'x-rate-limit-problem': 'minute', 'retry-after': '37' } }]);
    const source = createXeroVendorSource(new XeroClient({ clientId: 'id', clientSecret: 's' }, { fetchImpl }));
    const err = await source('vnd-globex-freight').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(XeroApiError);
    expect((err as XeroApiError).status).toBe(429);
    expect((err as XeroApiError).rateLimitProblem).toBe('minute');
    expect((err as XeroApiError).retryAfterSeconds).toBe('37');
  });

  it('surfaces a failed token request (e.g. invalid_client) as XeroApiError', async () => {
    const { fetchImpl } = fakeFetch([{ status: 400, body: '{"error":"invalid_client"}' }]);
    const source = createXeroVendorSource(new XeroClient({ clientId: 'id', clientSecret: 's' }, { fetchImpl }));
    await expect(source('vnd-globex-freight')).rejects.toThrow(/token request failed: HTTP 400/);
  });

  it('refuses a vendor id that could break out of the where clause', async () => {
    const { fetchImpl, calls } = fakeFetch([tokenOk]);
    const source = createXeroVendorSource(new XeroClient({ clientId: 'id', clientSecret: 's' }, { fetchImpl }));
    await expect(source('x" OR Name!="')).rejects.toThrow(XeroDataError);
    expect(calls).toHaveLength(0);
  });
});

describe('source selection: VENDOR_MASTER_SOURCE', () => {
  it('defaults to the fixture (unset, empty, or "fixture")', () => {
    expect(vendorSourceKind({})).toBe('fixture');
    expect(vendorSourceKind({ VENDOR_MASTER_SOURCE: '' })).toBe('fixture');
    expect(vendorSourceKind({ VENDOR_MASTER_SOURCE: 'fixture' })).toBe('fixture');
    expect(createVendorSource({})).toBe(fetchVendorTruth);
  });

  it('xero with missing credentials fails visibly, naming the vars, with no fixture fallback', () => {
    let err: unknown;
    try {
      createVendorSource({ VENDOR_MASTER_SOURCE: 'xero', XERO_CLIENT_ID: '  ' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(XeroConfigError);
    expect((err as XeroConfigError).missing).toEqual(['XERO_CLIENT_ID', 'XERO_CLIENT_SECRET']);
    expect((err as Error).message).toMatch(/XERO_CLIENT_ID, XERO_CLIENT_SECRET/);
    expect((err as Error).message).toMatch(/no fallback/);
  });

  it('xero with credentials builds a live source (no network until called)', () => {
    const src = createVendorSource({ VENDOR_MASTER_SOURCE: 'xero', XERO_CLIENT_ID: 'a', XERO_CLIENT_SECRET: 'b' });
    expect(src).not.toBe(fetchVendorTruth);
    expect(readXeroCredentials({ XERO_CLIENT_ID: 'a', XERO_CLIENT_SECRET: 'b' })).toEqual({ clientId: 'a', clientSecret: 'b' });
  });

  it('an unknown value throws rather than silently selecting the fixture', () => {
    expect(() => vendorSourceKind({ VENDOR_MASTER_SOURCE: 'xer0' })).toThrow(XeroConfigError);
  });
});

describe('vendorTruthFields(source)', () => {
  it('over the fixture source resolves identically to issuerOracleVendors for every field', async () => {
    const table = vendorTruthFields(fetchVendorTruth);
    expect(Object.keys(table.fields).sort()).toEqual(Object.keys(issuerOracleVendors.fields).sort());
    for (const id of ['vnd-acme-supplies', 'vnd-globex-freight', 'vnd-suspended-corp', 'vnd-unknown']) {
      for (const field of Object.keys(issuerOracleVendors.fields) as Array<keyof typeof issuerOracleVendors.fields>) {
        await expect(table.fields[field](id)).resolves.toEqual(await issuerOracleVendors.fields[field](id));
      }
    }
  });

  it('keeps money/timestamps bigint over any source', async () => {
    const table = vendorTruthFields(async () => mapToVendorTruth(
      'vnd-globex-freight',
      (parseXeroJson(contactsBody()) as { Contacts: Record<string, unknown>[] }).Contacts[0]!,
      (parseXeroJson(invoicesBody()) as { Invoices: XeroInvoice[] }).Invoices[0]!,
    ));
    await expect(table.fields['vendor.invoiceAmountUSD']('vnd-globex-freight')).resolves.toBe(8_450_000_000n);
    await expect(table.fields['vendor.payoutAddressLastChangedAt']('vnd-globex-freight')).resolves.toBe(1_790_172_000n);
  });
});
