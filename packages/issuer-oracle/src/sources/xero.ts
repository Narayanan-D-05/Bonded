/**
 * A REAL vendor-master source for `fetchVendorTruth`, backed by the Xero
 * Accounting API (a real accounting system; not a hackathon sponsor). This is
 * the production-shaped swap that `vendor-fixture.ts`'s header describes: same
 * contract (async, one vendor id in, one `VendorTruth` or `null` out), but the
 * record comes from a live Xero organisation over HTTPS instead of an
 * in-memory map. Selected only when `VENDOR_MASTER_SOURCE=xero` (see
 * `./select.ts`); the default stays the disclosed fixture.
 *
 * Every Xero fact this file relies on was read from Xero's own docs on
 * 2026-09-26 (the pages are client-rendered; they were read via their
 * published page-data JSON) and from Xero's official OpenAPI spec
 * (https://github.com/XeroAPI/Xero-OpenAPI, `xero_accounting.yaml`, v19.0.0):
 *
 *  AUTH — Custom Connections (client_credentials grant), single organisation:
 *    https://developer.xero.com/documentation/guides/oauth2/custom-connections/
 *    - "Custom Connections are a premium integration option that utilise the
 *      client credentials grant type to access data from a single Xero
 *      organisation."
 *    - Paid monthly subscription for a real org (AU/NZ/UK/US only), BUT:
 *      "Custom Connections can be connected to the Xero Demo Company for free
 *      for development purposes".
 *    - Token: POST https://identity.xero.com/connect/token,
 *      `Authorization: Basic base64(client_id:client_secret)`,
 *      form body `grant_type=client_credentials&scope=<space separated>`.
 *      Response: access_token, expires_in, token_type Bearer, scope. No
 *      refresh token in this grant (none is needed: just request a new one).
 *    - Step 7 ("Call the Xero API") shows ONLY the `Authorization: Bearer`
 *      header — no `xero-tenant-id`. The OpenAPI spec, however, declares
 *      `xero-tenant-id` as `required: true` on every Accounting endpoint.
 *      Those two sources disagree; this file sends `xero-tenant-id` only when
 *      `XERO_TENANT_ID` is set, and otherwise follows the custom-connection
 *      guide (the connection is bound to exactly one org).
 *    - Scopes: https://developer.xero.com/documentation/guides/oauth2/scopes/
 *      Since 29 April 2026 custom connections use GRANULAR scopes;
 *      `accounting.transactions(.read)` is deprecated in favour of
 *      `accounting.invoices(.read)`. `accounting.contacts(.read)` and
 *      `accounting.settings(.read)` are unchanged.
 *
 *  BASE URL — `https://api.xero.com/api.xro/2.0` (Contacts/Invoices overview
 *    tables; OpenAPI `servers[0].url`). JSON needs `Accept: application/json`
 *    (https://developer.xero.com/documentation/api/accounting/requests-and-responses/).
 *
 *  CONTACTS — https://developer.xero.com/documentation/api/accounting/contacts/
 *    - `ContactNumber`: "used to identify contacts in external systems",
 *      settable "via the API only", max length 50. THIS is where the Bonded
 *      vendor id (e.g. `vnd-globex-freight`) lives. Xero itself warns
 *      "'Contact Name' may no longer be a unique field", so we never look a
 *      vendor up by Name.
 *    - `ContactStatus`: ACTIVE | ARCHIVED | GDPRREQUEST
 *      (https://developer.xero.com/documentation/api/accounting/types/#contacts):
 *      ARCHIVED "can no longer be used in transactions"; GDPRREQUEST likewise.
 *    - `IsSupplier`: "Cannot be set via PUT or POST — it is automatically set
 *      when an accounts payable invoice is generated against this contact."
 *    - `BankAccountDetails`: "Bank account number of contact. You must have
 *      the BankAccountAdmin permission enabled to add or edit bank account
 *      details". A free-text string; the OpenAPI spec declares NO maxLength
 *      for it (unlike most sibling fields) — so the setup script verifies
 *      the value round-trips exactly rather than assuming it fits.
 *    - `UpdatedDateUTC`: "UTC timestamp of last update to contact" — the
 *      WHOLE contact, not the bank details specifically. Xero exposes no
 *      field that timestamps a bank-detail change. (Contact History records,
 *      `GET Contacts/{id}/History`, carry only a free-text `Details` string
 *      and "Changes": "Updated" — not a documented, parseable signal of
 *      WHICH field changed, so it is not used.)
 *    - `where` + `includeArchived=true` on GET Contacts; archived contacts are
 *      excluded unless `includeArchived=true` is passed.
 *
 *  INVOICES (bills) — https://developer.xero.com/documentation/api/accounting/invoices/
 *    - `Type` ACCPAY = "A bill – commonly known as an Accounts Payable or
 *      supplier invoice" (types page).
 *    - Status DRAFT | SUBMITTED | DELETED | AUTHORISED | PAID | VOIDED;
 *      AUTHORISED is the approved state that payments are applied to.
 *    - `Total` = "Total of Invoice tax inclusive"; `AmountDue` = "Amount
 *      remaining to be paid"; "Amounts are in the invoice's currency"
 *      (`CurrencyCode`).
 *    - GET filters: `ContactIDs`, `Statuses` (comma lists), `where`
 *      (`Type=="ACCPAY"` is an optimised filter), `order`.
 *    - Amount representation: the OpenAPI spec types money as
 *      `type: number, format: double` (a JSON NUMBER), while the doc page's
 *      own examples show both `"AmountDue": "1025.00"` (string) and
 *      `"SubTotal": 1800.00` (number). Either way, `JSON.parse` would turn a
 *      number token into a JS `number` — forbidden for money (CLAUDE.md rule
 *      2). So every response body is passed through `quoteJsonNumbers` FIRST,
 *      which rewrites every JSON number token to a JSON string token of the
 *      exact same characters, and only then `JSON.parse`d. Money never exists
 *      as a JS `number`, not even transiently.
 *
 *  DATES — requests-and-responses page: "/Date(1439434356790)/" or
 *    "/Date(1419937200000+0000)/" — "a unix timestamp value, but in
 *    miliseconds rather than seconds".
 *
 *  LIMITS / ERRORS — https://developer.xero.com/documentation/guides/oauth2/limits/
 *    and https://developer.xero.com/documentation/api/accounting/responsecodes/
 *    - Per tenant: 5 concurrent, 60/minute, 1,000/day (starter tier); app-wide
 *      10,000/minute. Exceeding -> HTTP 429 with `X-Rate-Limit-Problem`, and
 *      `Retry-After` (seconds) for minute/day limits.
 *    - 400 bodies are an ApiException: `{ ErrorNumber, Type, Message,
 *      Elements: [{ ValidationErrors: [{ Message }] }] }`. 401 = invalid
 *      credentials / disconnected; 403 = not permitted; 503 = offline.
 *    This client never retries silently: every non-2xx becomes a visible
 *    `XeroApiError` carrying status, `X-Rate-Limit-Problem`, `Retry-After`,
 *    and the ApiException messages.
 *
 * FIELD MAPPING (Xero Contact + latest open bill -> VendorTruth):
 *
 *   vendorId                    <- Contact.ContactNumber (exact match)
 *   legalName                   <- Contact.Name
 *   payoutAddress, evmAddress   <- Contact.BankAccountDetails (hex lowercased), in the format
 *                                  `bonded:v1;sui=0x<64 hex>;evm=0x<40 hex>`.
 *                                  Xero has NO crypto-wallet field. The bank
 *                                  details field is the honest home for a
 *                                  payout destination: it is exactly the field
 *                                  a BEC attacker asks AP to change, and Xero
 *                                  gates editing it behind the
 *                                  BankAccountAdmin permission.
 *   status                      <- ContactStatus: ACTIVE -> 'active';
 *                                  ARCHIVED / GDPRREQUEST -> 'suspended'
 *                                  (neither "can be used in transactions").
 *   invoiceAmountUSD            <- `Total` of the latest (by `Date`) ACCPAY
 *                                  bill for that contact with Status
 *                                  AUTHORISED and AmountDue > 0, CurrencyCode
 *                                  must be USD; decimal string -> 6-decimal
 *                                  base units via integer string math.
 *   payoutAddressLastChangedAt  <- Contact.UpdatedDateUTC, in unix seconds.
 *                                  LABELLED HONESTLY: this is "last contact
 *                                  update", an upper bound on how recently
 *                                  the bank details could have changed, NOT a
 *                                  bank-change timestamp (Xero has none). It
 *                                  errs toward "recent", i.e. toward MORE
 *                                  step-up holds, never fewer.
 *
 * Anything that doesn't fit this mapping (no contact -> `null`; two contacts
 * with the same ContactNumber, bank details not in the Bonded format, no open
 * USD bill, a malformed amount or date) throws a visible `XeroDataError`.
 * Nothing is defaulted, guessed or filled in from the fixture.
 */

import { Buffer } from 'node:buffer';
import type { VendorTruth } from '../vendor-fixture.js';

// ---------------------------------------------------------------------------
// Constants (all cited above)
// ---------------------------------------------------------------------------

export const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token';
export const XERO_ACCOUNTING_BASE_URL = 'https://api.xero.com/api.xro/2.0';

/** Granular read scopes: all `fetchVendorTruth` needs. */
export const XERO_READ_SCOPES = ['accounting.contacts.read', 'accounting.invoices.read'] as const;

/** Scopes `scripts/xero-setup.ts` needs to create suppliers/bills and check the org. */
export const XERO_SETUP_SCOPES = ['accounting.contacts', 'accounting.invoices', 'accounting.settings.read'] as const;

export const XERO_CLIENT_ID_ENV = 'XERO_CLIENT_ID';
export const XERO_CLIENT_SECRET_ENV = 'XERO_CLIENT_SECRET';
/** Optional: see the tenant-header note in the header comment. */
export const XERO_TENANT_ID_ENV = 'XERO_TENANT_ID';
export const XERO_REQUIRED_ENV = [XERO_CLIENT_ID_ENV, XERO_CLIENT_SECRET_ENV] as const;


// ---------------------------------------------------------------------------
// Errors: always visible, never swallowed
// ---------------------------------------------------------------------------

export class XeroConfigError extends Error {
  readonly missing: readonly string[];
  constructor(message: string, missing: readonly string[] = []) {
    super(message);
    this.name = 'XeroConfigError';
    this.missing = missing;
  }
}

/** A Xero record that exists but can't be honestly mapped to `VendorTruth`. */
export class XeroDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XeroDataError';
  }
}

export class XeroApiError extends Error {
  readonly status: number;
  readonly rateLimitProblem: string | null;
  readonly retryAfterSeconds: string | null;
  readonly apiMessages: readonly string[];
  constructor(
    message: string,
    details: { status: number; rateLimitProblem: string | null; retryAfterSeconds: string | null; apiMessages: readonly string[] },
  ) {
    super(message);
    this.name = 'XeroApiError';
    this.status = details.status;
    this.rateLimitProblem = details.rateLimitProblem;
    this.retryAfterSeconds = details.retryAfterSeconds;
    this.apiMessages = details.apiMessages;
  }
}

// ---------------------------------------------------------------------------
// Credentials: env only, never printed
// ---------------------------------------------------------------------------

export interface XeroCredentials {
  clientId: string;
  clientSecret: string;
  /** Sent as `xero-tenant-id` only when present. */
  tenantId?: string;
}

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const v = env[name];
  return v === undefined || v.trim() === '' ? undefined : v.trim();
}

/** Reads credentials from `env`; throws `XeroConfigError` naming every missing var. Never logs values. */
export function readXeroCredentials(env: NodeJS.ProcessEnv = process.env): XeroCredentials {
  const missing = XERO_REQUIRED_ENV.filter((name) => envValue(env, name) === undefined);
  if (missing.length > 0) {
    throw new XeroConfigError(
      `VENDOR_MASTER_SOURCE=xero but required Xero credentials are missing: ${missing.join(', ')}. ` +
        'Set them in the repo-root .env (see .env.example and packages/issuer-oracle/scripts/xero-setup.ts). ' +
        'There is no fallback to the fixture.',
      missing,
    );
  }
  const creds: XeroCredentials = { clientId: envValue(env, XERO_CLIENT_ID_ENV)!, clientSecret: envValue(env, XERO_CLIENT_SECRET_ENV)! };
  const tenantId = envValue(env, XERO_TENANT_ID_ENV);
  if (tenantId !== undefined) creds.tenantId = tenantId;
  return creds;
}

// ---------------------------------------------------------------------------
// Pure parsing: no network, unit-tested in __tests__/xero.test.ts
// ---------------------------------------------------------------------------

/**
 * Rewrites every JSON number token in `text` into a JSON string token of the
 * exact same characters (`1800.00` -> `"1800.00"`), leaving string contents,
 * `true`/`false`/`null` and structure untouched. After this, `JSON.parse`
 * cannot create a JS `number` from the payload, so money never touches one.
 */
export function quoteJsonNumbers(text: string): string {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i]!;
    if (ch === '"') {
      // copy a whole string token verbatim, honouring escapes
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (ch === '-' || (ch >= '0' && ch <= '9')) {
      let j = i + 1;
      while (j < n && /[0-9eE+\-.]/.test(text[j]!)) j += 1;
      out += `"${text.slice(i, j)}"`;
      i = j;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

/** `JSON.parse` after `quoteJsonNumbers`. Throws a visible error on invalid JSON. */
export function parseXeroJson(text: string): unknown {
  try {
    return JSON.parse(quoteJsonNumbers(text));
  } catch (error) {
    throw new XeroDataError(`Xero response was not valid JSON: ${(error as Error).message}`);
  }
}

/**
 * A non-negative plain decimal string (`"8450.00"`, `"1250"`, `"0.5"`) to
 * 6-decimal fixed-point base units, with integer string math only. Rejects
 * negatives, exponent notation, more than 6 fractional digits, and anything
 * that isn't a string (a JS `number` here would mean the money already
 * passed through floating point).
 */
export function decimalToBaseUnits6(value: unknown): bigint {
  if (typeof value !== 'string') {
    throw new XeroDataError(`Expected a decimal string amount, got ${typeof value}`);
  }
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(value);
  if (m === null) {
    throw new XeroDataError(`Amount "${value}" is not a non-negative decimal with at most 6 fractional digits`);
  }
  return BigInt(m[1]!) * 1_000_000n + BigInt((m[2] ?? '').padEnd(6, '0'));
}

/** Inverse of `decimalToBaseUnits6`, used by the setup script to write amounts to Xero: `1250000000n` -> `"1250.00"`. */
export function baseUnits6ToDecimal2(units: bigint): string {
  if (units < 0n) throw new XeroDataError('Negative amounts are not supported');
  if (units % 10_000n !== 0n) {
    throw new XeroDataError(`Amount ${units} base units has sub-cent precision; Xero bills are written to 2 decimal places`);
  }
  const whole = units / 1_000_000n;
  const cents = (units % 1_000_000n) / 10_000n;
  return `${whole}.${cents.toString().padStart(2, '0')}`;
}

/**
 * Xero's MS-JSON date (`/Date(1488391422280+0000)/` or `/Date(1573755038314)/`)
 * to unix seconds (floored). The millisecond value is the UTC epoch; the
 * optional offset suffix is ignored, per the requests-and-responses page.
 */
export function parseXeroDateToUnixSeconds(value: unknown): number {
  if (typeof value !== 'string') throw new XeroDataError(`Expected a Xero date string, got ${typeof value}`);
  const m = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(value);
  if (m === null) throw new XeroDataError(`"${value}" is not a Xero /Date(ms)/ value`);
  const ms = BigInt(m[1]!);
  const seconds = (ms - (((ms % 1000n) + 1000n) % 1000n)) / 1000n; // floor, also for negatives
  return Number(seconds); // a timestamp, not money; well within Number.MAX_SAFE_INTEGER
}

export const BONDED_PAYOUT_PREFIX = 'bonded:v1';

/** The documented `BankAccountDetails` format: `bonded:v1;sui=0x<64 hex>;evm=0x<40 hex>`. */
export function encodePayoutDetails(payoutAddress: string, evmAddress: string): string {
  const encoded = `${BONDED_PAYOUT_PREFIX};sui=${payoutAddress};evm=${evmAddress}`;
  parsePayoutDetails(encoded); // validate: never write something we couldn't read back
  return encoded;
}

export function parsePayoutDetails(value: unknown): { payoutAddress: `0x${string}`; evmAddress: `0x${string}` } {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new XeroDataError('Contact has no BankAccountDetails; no payout destination is on file');
  }
  const m = /^bonded:v1;sui=(0x[0-9a-fA-F]{64});evm=(0x[0-9a-fA-F]{40})$/.exec(value.trim());
  if (m === null) {
    throw new XeroDataError(
      'Contact BankAccountDetails is not in the Bonded payout format ' +
        '"bonded:v1;sui=0x<64 hex>;evm=0x<40 hex>" (a plain bank account number is not a Sui/EVM payout destination)',
    );
  }
  // Hex is case-insensitive; normalise to lowercase, the convention
  // `VendorTruth.evmAddress` documents (and the fixture's Sui addresses use).
  return { payoutAddress: m[1]!.toLowerCase() as `0x${string}`, evmAddress: m[2]!.toLowerCase() as `0x${string}` };
}

export function mapContactStatus(value: unknown): 'active' | 'suspended' {
  if (value === 'ACTIVE') return 'active';
  if (value === 'ARCHIVED' || value === 'GDPRREQUEST') return 'suspended';
  throw new XeroDataError(`Unknown Xero ContactStatus ${JSON.stringify(value)}`);
}

/** Subset of the documented Contact element this source reads. All values are strings/booleans after `parseXeroJson`. */
export interface XeroContact {
  ContactID?: unknown;
  ContactNumber?: unknown;
  ContactStatus?: unknown;
  Name?: unknown;
  BankAccountDetails?: unknown;
  IsSupplier?: unknown;
  UpdatedDateUTC?: unknown;
}

/** Subset of the documented Invoice element this source reads. */
export interface XeroInvoice {
  InvoiceID?: unknown;
  InvoiceNumber?: unknown;
  Type?: unknown;
  Status?: unknown;
  Date?: unknown;
  UpdatedDateUTC?: unknown;
  Total?: unknown;
  AmountDue?: unknown;
  CurrencyCode?: unknown;
}

function arrayField(body: unknown, key: string): unknown[] {
  if (body === null || typeof body !== 'object' || !Array.isArray((body as Record<string, unknown>)[key])) {
    throw new XeroDataError(`Xero response has no "${key}" array`);
  }
  return (body as Record<string, unknown[]>)[key]!;
}

export function contactsFromResponse(body: unknown): XeroContact[] {
  return arrayField(body, 'Contacts') as XeroContact[];
}

export function invoicesFromResponse(body: unknown): XeroInvoice[] {
  return arrayField(body, 'Invoices') as XeroInvoice[];
}

/**
 * The single contact whose ContactNumber is exactly `vendorId`, or `null`.
 * Two or more matches is an ambiguous vendor master; that throws rather than
 * picking one.
 */
export function selectContactByNumber(contacts: XeroContact[], vendorId: string): XeroContact | null {
  const matches = contacts.filter((c) => c.ContactNumber === vendorId);
  if (matches.length > 1) {
    throw new XeroDataError(`${matches.length} Xero contacts share ContactNumber "${vendorId}"; refusing to pick one`);
  }
  return matches[0] ?? null;
}

/**
 * The latest open bill: Type ACCPAY, Status AUTHORISED, AmountDue > 0, the
 * greatest `Date` (ties broken by `UpdatedDateUTC`; an exact tie on both
 * throws). `null` if there is none.
 */
export function selectLatestOpenBill(invoices: XeroInvoice[]): XeroInvoice | null {
  const open = invoices.filter(
    (inv) => inv.Type === 'ACCPAY' && inv.Status === 'AUTHORISED' && decimalToBaseUnits6(inv.AmountDue) > 0n,
  );
  if (open.length === 0) return null;
  const key = (inv: XeroInvoice): [number, number] => [
    parseXeroDateToUnixSeconds(inv.Date),
    parseXeroDateToUnixSeconds(inv.UpdatedDateUTC),
  ];
  const sorted = [...open].sort((a, b) => {
    const [ad, au] = key(a);
    const [bd, bu] = key(b);
    return bd - ad || bu - au;
  });
  if (sorted.length > 1) {
    const [d0, u0] = key(sorted[0]!);
    const [d1, u1] = key(sorted[1]!);
    if (d0 === d1 && u0 === u1) {
      throw new XeroDataError('Two open ACCPAY bills tie on Date and UpdatedDateUTC; cannot tell which is latest');
    }
  }
  return sorted[0]!;
}

/** Contact + its latest open bill -> `VendorTruth` (with `evmAddress`). */
export function mapToVendorTruth(vendorId: string, contact: XeroContact, bill: XeroInvoice | null): VendorTruth {
  if (typeof contact.Name !== 'string' || contact.Name === '') {
    throw new XeroDataError(`Xero contact "${vendorId}" has no Name`);
  }
  const { payoutAddress, evmAddress } = parsePayoutDetails(contact.BankAccountDetails);
  if (bill === null) {
    throw new XeroDataError(`Xero contact "${vendorId}" has no open (AUTHORISED, AmountDue > 0) ACCPAY bill; no invoice amount is on file`);
  }
  if (bill.CurrencyCode !== 'USD') {
    throw new XeroDataError(
      `Latest open bill for "${vendorId}" is in ${JSON.stringify(bill.CurrencyCode)}, not USD; invoiceAmountUSD would be a currency conversion guess`,
    );
  }
  return {
    vendorId,
    legalName: contact.Name,
    payoutAddress,
    evmAddress,
    invoiceAmountUSD: decimalToBaseUnits6(bill.Total).toString(),
    status: mapContactStatus(contact.ContactStatus),
    payoutAddressLastChangedAt: parseXeroDateToUnixSeconds(contact.UpdatedDateUTC),
  };
}

/** ContactNumber is interpolated into a `where` clause, so the id charset is restricted (max 50 per the docs). */
export function assertVendorIdSafe(vendorId: string): void {
  if (!/^[A-Za-z0-9._-]{1,50}$/.test(vendorId)) {
    throw new XeroDataError(`Vendor id ${JSON.stringify(vendorId)} is not a valid ContactNumber (1-50 chars of A-Z a-z 0-9 . _ -)`);
  }
}

/** Extracts the documented ApiException messages from an error body, best-effort, for visibility only. */
export function apiExceptionMessages(body: unknown): string[] {
  const out: string[] = [];
  if (body === null || typeof body !== 'object') return out;
  const b = body as Record<string, unknown>;
  if (typeof b.Message === 'string') out.push(b.Message);
  if (Array.isArray(b.Elements)) {
    for (const el of b.Elements) {
      const errs = (el as Record<string, unknown> | null)?.ValidationErrors;
      if (Array.isArray(errs)) {
        for (const e of errs) {
          const msg = (e as Record<string, unknown> | null)?.Message;
          if (typeof msg === 'string') out.push(msg);
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// HTTP client
// ---------------------------------------------------------------------------

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface XeroClientOptions {
  scopes?: readonly string[];
  fetchImpl?: FetchLike;
  /** Injected clock for token-expiry tests; defaults to Date.now. */
  now?: () => number;
}

export class XeroClient {
  private readonly creds: XeroCredentials;
  private readonly scopes: readonly string[];
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private token: { value: string; expiresAtMs: number } | null = null;

  constructor(creds: XeroCredentials, options: XeroClientOptions = {}) {
    this.creds = creds;
    this.scopes = options.scopes ?? XERO_READ_SCOPES;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? Date.now;
  }

  /** client_credentials token, cached until 60s before `expires_in` runs out. */
  async accessToken(): Promise<string> {
    if (this.token !== null && this.now() < this.token.expiresAtMs) return this.token.value;
    const basic = Buffer.from(`${this.creds.clientId}:${this.creds.clientSecret}`, 'utf8').toString('base64');
    const res = await this.fetchImpl(XERO_TOKEN_URL, {
      method: 'POST',
      headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope: this.scopes.join(' ') }).toString(),
    });
    const text = await res.text();
    if (!res.ok) {
      // The identity server's error body (e.g. OAuth `{"error":"invalid_client"}`) is surfaced as-is; it never echoes the secret.
      throw new XeroApiError(`Xero token request failed: HTTP ${res.status} ${text.slice(0, 300)}`, {
        status: res.status,
        rateLimitProblem: res.headers.get('x-rate-limit-problem'),
        retryAfterSeconds: res.headers.get('retry-after'),
        apiMessages: [],
      });
    }
    const body = parseXeroJson(text) as Record<string, unknown>;
    if (typeof body.access_token !== 'string' || typeof body.expires_in !== 'string' || !/^\d+$/.test(body.expires_in)) {
      throw new XeroDataError('Xero token response is missing access_token/expires_in');
    }
    const lifetimeMs = Number(body.expires_in) * 1000;
    this.token = { value: body.access_token, expiresAtMs: this.now() + Math.max(0, lifetimeMs - 60_000) };
    return this.token.value;
  }

  /** One Accounting API call. `path` is relative to the base URL, e.g. `/Contacts`. */
  async request(method: 'GET' | 'POST' | 'PUT', path: string, query: Record<string, string> = {}, body?: unknown): Promise<unknown> {
    const url = new URL(`${XERO_ACCOUNTING_BASE_URL}${path}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const headers: Record<string, string> = { authorization: `Bearer ${await this.accessToken()}`, accept: 'application/json' };
    if (this.creds.tenantId !== undefined) headers['xero-tenant-id'] = this.creds.tenantId;
    const init: RequestInit = { method, headers }; // Node's fetch (undici) keeps no HTTP cache
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await this.fetchImpl(url.toString(), init);
    const text = await res.text();
    if (!res.ok) {
      let messages: string[] = [];
      try {
        messages = apiExceptionMessages(parseXeroJson(text));
      } catch {
        messages = text.trim() === '' ? [] : [text.slice(0, 300)];
      }
      const rateLimitProblem = res.headers.get('x-rate-limit-problem');
      const retryAfterSeconds = res.headers.get('retry-after');
      const extra = res.status === 429 ? ` (rate limit: ${rateLimitProblem ?? 'unspecified'}, Retry-After: ${retryAfterSeconds ?? 'n/a'}s)` : '';
      throw new XeroApiError(`Xero ${method} ${path} failed: HTTP ${res.status}${extra}${messages.length ? ` — ${messages.join('; ')}` : ''}`, {
        status: res.status,
        rateLimitProblem,
        retryAfterSeconds,
        apiMessages: messages,
      });
    }
    return parseXeroJson(text);
  }

  /** All contacts (including ARCHIVED) whose ContactNumber equals `vendorId`. */
  async findContactsByNumber(vendorId: string): Promise<XeroContact[]> {
    assertVendorIdSafe(vendorId);
    const body = await this.request('GET', '/Contacts', { where: `ContactNumber=="${vendorId}"`, includeArchived: 'true' });
    return contactsFromResponse(body);
  }

  /** AUTHORISED ACCPAY bills for one contact, newest `Date` first (page 1 = 100 bills). */
  async openBillsForContact(contactId: string): Promise<XeroInvoice[]> {
    if (!/^[0-9a-fA-F-]{36}$/.test(contactId)) throw new XeroDataError(`ContactID ${JSON.stringify(contactId)} is not a GUID`);
    const body = await this.request('GET', '/Invoices', {
      ContactIDs: contactId,
      Statuses: 'AUTHORISED',
      where: 'Type=="ACCPAY"',
      order: 'Date DESC',
    });
    return invoicesFromResponse(body);
  }
}

/**
 * Scopes for a World-approved bank-detail change: write contacts, read bills
 * (the read-back goes through `createXeroVendorSource`). Writing
 * `BankAccountDetails` also needs the BankAccountAdmin permission on the
 * authorising user (Contacts docs, cited in the header).
 */
export const XERO_BANK_CHANGE_SCOPES = ['accounting.contacts', 'accounting.invoices.read'] as const;

/**
 * Writes a new Sui payout address into a supplier's `BankAccountDetails`,
 * keeping its registered EVM identity, in the same `bonded:v1;sui=…;evm=…`
 * format and through the same `POST /Contacts` update path
 * `scripts/xero-setup.ts` uses.
 *
 * Compare-and-set: the contact's current payout address must equal
 * `expectedPreviousPayoutAddress`, or this throws before writing. After the
 * write, the returned contact's `BankAccountDetails` must parse back to the
 * new address, or this throws.
 */
export async function updateXeroPayoutAddress(
  client: XeroClient,
  input: { vendorId: string; expectedPreviousPayoutAddress: string; newPayoutAddress: string },
): Promise<{ contactId: string; bankAccountDetails: string }> {
  const contact = selectContactByNumber(await client.findContactsByNumber(input.vendorId), input.vendorId);
  if (contact === null) throw new XeroDataError(`No Xero contact has ContactNumber "${input.vendorId}"`);
  if (typeof contact.ContactID !== 'string') throw new XeroDataError(`Xero contact "${input.vendorId}" has no ContactID`);
  const current = parsePayoutDetails(contact.BankAccountDetails);
  if (current.payoutAddress !== input.expectedPreviousPayoutAddress.toLowerCase()) {
    throw new XeroDataError(
      `Xero contact "${input.vendorId}" pays ${current.payoutAddress}, not ${input.expectedPreviousPayoutAddress}; ` +
        'it changed since this approval was requested. Refusing to overwrite it.',
    );
  }
  const bankAccountDetails = encodePayoutDetails(input.newPayoutAddress.toLowerCase(), current.evmAddress);
  const updated = contactsFromResponse(
    await client.request('POST', '/Contacts', {}, { Contacts: [{ ContactID: contact.ContactID, BankAccountDetails: bankAccountDetails }] }),
  );
  const echoed = parsePayoutDetails(updated[0]?.BankAccountDetails);
  if (echoed.payoutAddress !== input.newPayoutAddress.toLowerCase() || echoed.evmAddress !== current.evmAddress) {
    throw new XeroDataError(`Xero accepted the update for "${input.vendorId}" but echoed different BankAccountDetails; check the contact in Xero.`);
  }
  return { contactId: contact.ContactID, bankAccountDetails };
}

/**
 * The Xero-backed `fetchVendorTruth`: same signature as the fixture's.
 * Two sequential API calls per lookup (contact, then bills), well inside the
 * documented 5-concurrent / 60-per-minute per-tenant limits for a demo.
 */
export function createXeroVendorSource(client: XeroClient): (vendorId: string) => Promise<VendorTruth | null> {
  return async (vendorId: string): Promise<VendorTruth | null> => {
    const contact = selectContactByNumber(await client.findContactsByNumber(vendorId), vendorId);
    if (contact === null) return null;
    if (typeof contact.ContactID !== 'string') throw new XeroDataError(`Xero contact "${vendorId}" has no ContactID`);
    const bill = selectLatestOpenBill(await client.openBillsForContact(contact.ContactID));
    return mapToVendorTruth(vendorId, contact, bill);
  };
}
