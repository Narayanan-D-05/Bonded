/**
 * One-time Xero connection + demo data seeding, against a REAL Xero Demo
 * Company over the real Accounting API.
 *
 *   pnpm --filter @bonded/issuer-oracle xero:setup
 *
 * What it does:
 *  1. Prints the Xero developer portal steps (always, even without creds).
 *  2. Reads XERO_CLIENT_ID / XERO_CLIENT_SECRET (optional XERO_TENANT_ID)
 *     from the environment or the repo-root .env. Values are never printed.
 *     If any are missing, it exits 1 naming them.
 *  3. Refuses to write anywhere but a Demo Company (`Organisation.IsDemoCompany`)
 *     whose BaseCurrency is USD.
 *  4. Creates or updates the four seeded suppliers from `vendor-fixture.ts`
 *     (ContactNumber = vendor id, Name = legalName, BankAccountDetails =
 *     `bonded:v1;sui=<payoutAddress>;evm=<evmAddress>`), gives each an
 *     AUTHORISED USD ACCPAY bill for its invoice amount, and archives
 *     `vnd-suspended-corp` (ARCHIVED maps to 'suspended'). It only writes
 *     what differs, so re-running is safe. Note that the Demo Company resets
 *     itself 28 days after creation, so re-run this script after a reset.
 *  5. Reads all four back through the SAME `createXeroVendorSource` the
 *     enforcer would use, and exits 1 on any mismatch with the fixture.
 *
 * Every endpoint/field used is cited in `src/sources/xero.ts`'s header.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  XERO_SETUP_SCOPES,
  XeroClient,
  XeroConfigError,
  baseUnits6ToDecimal2,
  contactsFromResponse,
  createXeroVendorSource,
  decimalToBaseUnits6,
  encodePayoutDetails,
  readXeroCredentials,
  selectContactByNumber,
  selectLatestOpenBill,
  type XeroContact,
} from '../src/sources/xero.js';
import { fetchVendorTruth, type VendorTruth } from '../src/vendor-fixture.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
// vnd-halcyon-machining (the $15,000 over-the-irreversible-threshold bill) was added with the
// console's one-policy-per-agent restructure; re-run this script to seed it into an existing org.
const VENDOR_IDS = ['vnd-acme-supplies', 'vnd-globex-freight', 'vnd-suspended-corp', 'vnd-halcyon-machining'] as const;

const PORTAL_STEPS = `
Xero one-time setup (Custom Connection + Demo Company, free for development)
Docs: https://developer.xero.com/documentation/guides/oauth2/custom-connections/

 1. Sign up / log in at https://developer.xero.com (a free Xero account is enough).
 2. Open https://my.xero.com, enter the Demo Company, and set its country to
    "United States" (Change country, which also resets it) so the base currency
    is USD. Bills in any other currency are refused by this connector.
 3. Go to https://developer.xero.com/app/manage, click "New app", and pick the
    integration type "Custom connection". Any name works (e.g. "Bonded vendor master").
 4. Select these scopes (granular, as custom connections use since 29 Apr 2026):
      accounting.contacts   accounting.invoices   accounting.settings.read
    (Read-only use needs just accounting.contacts.read + accounting.invoices.read.)
    Choose YOURSELF as the authorising user.
 5. Open the authorisation email from Xero, click Connect, and pick the Demo
    Company. Demo Company connections need no paid subscription.
 6. Back on the app's page, copy the Client ID and generate a Client Secret.
 7. Put them in the repo-root .env (never commit it):
      XERO_CLIENT_ID=...
      XERO_CLIENT_SECRET=...
      VENDOR_MASTER_SOURCE=xero        # only when you want the live source
    XERO_TENANT_ID is optional. The custom-connection guide sends no tenant
    header, but Xero's OpenAPI spec marks it required. Set it only if calls
    fail asking for it.
 8. Re-run this script. Then run: pnpm --filter @bonded/issuer-oracle xero:check
`;

function loadRepoEnv(): void {
  const envPath = join(REPO_ROOT, '.env');
  if (existsSync(envPath)) process.loadEnvFile(envPath); // never overrides an already-set variable; values never printed
}

function isoDate(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

async function checkOrganisation(client: XeroClient): Promise<void> {
  const body = (await client.request('GET', '/Organisation')) as { Organisations?: Array<Record<string, unknown>> };
  const org = body.Organisations?.[0];
  if (org === undefined) throw new Error('GET /Organisation returned no organisation');
  console.log(`Connected org: "${String(org.Name)}", IsDemoCompany=${String(org.IsDemoCompany)}, BaseCurrency=${String(org.BaseCurrency)}`);
  if (org.IsDemoCompany !== true) {
    throw new Error('Refusing to write: this connection is not to the Xero Demo Company. Seeding test suppliers into a real ledger is not what this script is for.');
  }
  if (org.BaseCurrency !== 'USD') {
    throw new Error(`Demo Company base currency is ${String(org.BaseCurrency)}, not USD. Change its country to United States at https://my.xero.com and re-run.`);
  }
}

async function pickExpenseAccountCode(client: XeroClient): Promise<string> {
  const body = (await client.request('GET', '/Accounts', { where: 'Class=="EXPENSE"' })) as { Accounts?: Array<Record<string, unknown>> };
  const account = (body.Accounts ?? []).find((a) => a.Status === 'ACTIVE' && typeof a.Code === 'string' && a.Code !== '' && !a.SystemAccount);
  if (account === undefined) throw new Error('No ACTIVE, non-system EXPENSE account with a Code found in the chart of accounts');
  console.log(`Bill line account: ${String(account.Code)} "${String(account.Name)}"`);
  return account.Code as string;
}

async function upsertContact(client: XeroClient, truth: VendorTruth, needsActive: boolean): Promise<XeroContact> {
  const bankDetails = encodePayoutDetails(truth.payoutAddress, truth.evmAddress);
  const existing = selectContactByNumber(await client.findContactsByNumber(truth.vendorId), truth.vendorId);
  if (existing === null) {
    const created = contactsFromResponse(
      await client.request('PUT', '/Contacts', {}, { Contacts: [{ Name: truth.legalName, ContactNumber: truth.vendorId, BankAccountDetails: bankDetails }] }),
    );
    console.log(`  created contact ${String(created[0]?.ContactID)}`);
    return created[0]!;
  }
  const update: Record<string, unknown> = {};
  if (existing.Name !== truth.legalName) update.Name = truth.legalName;
  if (existing.BankAccountDetails !== bankDetails) update.BankAccountDetails = bankDetails;
  if (needsActive && existing.ContactStatus !== 'ACTIVE') update.ContactStatus = 'ACTIVE';
  if (Object.keys(update).length === 0) {
    console.log(`  contact ${String(existing.ContactID)} already up to date (not touched, so UpdatedDateUTC is preserved)`);
    return existing;
  }
  const updated = contactsFromResponse(await client.request('POST', '/Contacts', {}, { Contacts: [{ ContactID: existing.ContactID, ...update }] }));
  console.log(`  updated contact ${String(existing.ContactID)}: ${Object.keys(update).join(', ')}`);
  return updated[0]!;
}

async function main(): Promise<void> {
  console.log(PORTAL_STEPS);
  loadRepoEnv();

  let creds;
  try {
    creds = readXeroCredentials();
  } catch (e) {
    if (e instanceof XeroConfigError) {
      console.error(`FAILED: ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
  const client = new XeroClient(creds, { scopes: XERO_SETUP_SCOPES });
  await checkOrganisation(client);
  const accountCode = await pickExpenseAccountCode(client);

  for (const id of VENDOR_IDS) {
    const truth = await fetchVendorTruth(id);
    if (truth === null) throw new Error(`fixture has no ${id}`);
    console.log(`\n${id} (${truth.legalName})`);

    const wantAmount = baseUnits6ToDecimal2(BigInt(truth.invoiceAmountUSD));
    const billNumber = `BONDED-${id}`;
    const probe = selectContactByNumber(await client.findContactsByNumber(id), id);
    const openBills = probe && typeof probe.ContactID === 'string' ? await client.openBillsForContact(probe.ContactID) : [];
    const ours = openBills.filter((b) => b.InvoiceNumber === billNumber);
    const needBill = ours.length === 0;

    // A bill can't be raised against an ARCHIVED contact, so un-archive first if one is needed.
    const contact = await upsertContact(client, truth, needBill);
    const contactId = contact.ContactID as string;

    if (needBill) {
      const res = (await client.request('PUT', '/Invoices', {}, {
        Invoices: [{
          Type: 'ACCPAY',
          Contact: { ContactID: contactId }, // docs: only ContactID in Contact
          InvoiceNumber: billNumber,
          Reference: 'Bonded demo bill',
          Date: isoDate(0),
          DueDate: isoDate(30),
          CurrencyCode: 'USD',
          LineAmountTypes: 'NoTax',
          Status: 'AUTHORISED',
          LineItems: [{ Description: `Bonded demo bill for ${id}`, Quantity: '1', UnitAmount: wantAmount, AccountCode: accountCode }],
        }],
      })) as { Invoices?: Array<Record<string, unknown>> };
      console.log(`  created AUTHORISED bill ${billNumber} for USD ${wantAmount} (InvoiceID ${String(res.Invoices?.[0]?.InvoiceID)})`);
    } else {
      const latest = selectLatestOpenBill(openBills);
      if (latest?.InvoiceNumber !== billNumber || decimalToBaseUnits6(latest.Total) !== BigInt(truth.invoiceAmountUSD)) {
        throw new Error(
          `${id}: open bill ${billNumber} exists but the latest open bill is ${String(latest?.InvoiceNumber)} for ${String(latest?.Total)}, not ${wantAmount}. ` +
            'Void the stale bill(s) in Xero (Purchases > Bills) and re-run; this script never voids anything itself.',
        );
      }
      console.log(`  open bill ${billNumber} for ${wantAmount} already present`);
    }

    const wantStatus = truth.status === 'suspended' ? 'ARCHIVED' : 'ACTIVE';
    const current = selectContactByNumber(await client.findContactsByNumber(id), id);
    if (current?.ContactStatus !== wantStatus) {
      await client.request('POST', '/Contacts', {}, { Contacts: [{ ContactID: contactId, ContactStatus: wantStatus }] });
      console.log(`  set ContactStatus=${wantStatus}`);
    }
  }

  console.log('\nRead-back through createXeroVendorSource (the same path the enforcer uses):');
  const source = createXeroVendorSource(client);
  let failures = 0;
  for (const id of VENDOR_IDS) {
    const want = (await fetchVendorTruth(id))!;
    const got = await source(id);
    const fields = ['legalName', 'payoutAddress', 'evmAddress', 'invoiceAmountUSD', 'status'] as const;
    const bad = got === null ? ['<not found>'] : fields.filter((f) => got[f] !== want[f]);
    console.log(`  ${id}: ${bad.length === 0 ? 'OK' : `MISMATCH ${bad.join(', ')}`}`);
    if (got !== null) {
      console.log(`    payoutAddressLastChangedAt=${got.payoutAddressLastChangedAt} (${new Date(got.payoutAddressLastChangedAt * 1000).toISOString()}), which is the LAST CONTACT UPDATE, not a bank-change time`);
    }
    if (bad.length > 0) failures += 1;
  }
  if (failures > 0) {
    console.error(`\nFAILED: ${failures} vendor(s) did not round-trip. If BankAccountDetails differs, Xero may have truncated or rejected the value; check the contact in Xero.`);
    process.exit(1);
  }
  console.log('\nDone. The demo suppliers now live in the Xero Demo Company.');
}

main().catch((e: unknown) => {
  console.error(`FAILED: ${(e as Error).name}: ${(e as Error).message}`);
  process.exit(1);
});
