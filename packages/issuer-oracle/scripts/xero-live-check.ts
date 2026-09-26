/**
 * Live check of the Xero vendor-master source against a REAL Xero org.
 *
 *   pnpm --filter @bonded/issuer-oracle xero:check
 *
 * Forces VENDOR_MASTER_SOURCE=xero and goes through `createVendorSource()`,
 * the same selection path production code uses. Credentials come from the
 * environment or the repo-root .env, and their values are never printed.
 * Without credentials it FAILS (exit 1) and names the missing vars. It never
 * skips and never falls back to the fixture.
 *
 * For each seeded vendor id, it prints the VendorTruth Xero returns and
 * compares it with the fixture (all fields except payoutAddressLastChangedAt,
 * which in Xero is "last contact update" and can't match a seeded date). Also
 * checks that an unknown id resolves to null. Exit 0 only if all of it holds.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVendorSource } from '../src/sources/select.js';
import { XeroConfigError } from '../src/sources/xero.js';
import { fetchVendorTruth } from '../src/vendor-fixture.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const VENDOR_IDS = ['vnd-acme-supplies', 'vnd-globex-freight', 'vnd-suspended-corp', 'vnd-halcyon-machining'] as const;

async function main(): Promise<void> {
  const envPath = join(REPO_ROOT, '.env');
  if (existsSync(envPath)) process.loadEnvFile(envPath);

  let source;
  try {
    source = createVendorSource({ ...process.env, VENDOR_MASTER_SOURCE: 'xero' });
  } catch (e) {
    if (e instanceof XeroConfigError) {
      console.error(`FAILED (live Xero check could not run): ${e.message}`);
      console.error('One-time setup steps: pnpm --filter @bonded/issuer-oracle xero:setup');
      process.exit(1);
    }
    throw e;
  }

  let failures = 0;
  for (const id of VENDOR_IDS) {
    const want = (await fetchVendorTruth(id))!;
    const got = await source(id);
    console.log(`\n${id} from Xero:`);
    console.log(JSON.stringify(got, null, 2));
    if (got === null) {
      console.log('  FAIL: not found in Xero (run xero:setup)');
      failures += 1;
      continue;
    }
    const fields = ['legalName', 'payoutAddress', 'evmAddress', 'invoiceAmountUSD', 'status'] as const;
    const bad = fields.filter((f) => got[f] !== want[f]);
    console.log(bad.length === 0 ? '  matches seeded fixture values' : `  FAIL: differs from fixture on ${bad.join(', ')}`);
    console.log(`  payoutAddressLastChangedAt = last contact update: ${new Date(got.payoutAddressLastChangedAt * 1000).toISOString()}`);
    if (bad.length > 0) failures += 1;
  }

  const unknown = await source('vnd-does-not-exist');
  console.log(`\nvnd-does-not-exist -> ${JSON.stringify(unknown)}`);
  if (unknown !== null) failures += 1;

  if (failures > 0) {
    console.error(`\nFAILED: ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('\nPASSED: live Xero vendor master returns the VendorTruth shape for all seeded vendors.');
}

main().catch((e: unknown) => {
  console.error(`FAILED: ${(e as Error).name}: ${(e as Error).message}`);
  process.exit(1);
});
