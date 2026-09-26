/**
 * Vendor-master source selection: `VENDOR_MASTER_SOURCE=fixture|xero`.
 *
 *  - unset / empty / `fixture` -> `fetchVendorTruth` from `vendor-fixture.ts`
 *    (the disclosed, seeded stand-in; the default, so every existing test and
 *    demo is unchanged).
 *  - `xero` -> the live Xero Accounting API source (`./xero.ts`). Missing
 *    credentials throw `XeroConfigError` naming the missing vars, right here
 *    at construction time. There is never a fallback to the fixture.
 *  - anything else -> throws. A typo must not silently select the fixture.
 */

import { fetchVendorTruth, type VendorTruth } from '../vendor-fixture.js';
import { XeroClient, XeroConfigError, createXeroVendorSource, readXeroCredentials } from './xero.js';

export type VendorSource = (vendorId: string) => Promise<VendorTruth | null>;
export type VendorSourceKind = 'fixture' | 'xero';

export const VENDOR_MASTER_SOURCE_ENV = 'VENDOR_MASTER_SOURCE';

export function vendorSourceKind(env: NodeJS.ProcessEnv = process.env): VendorSourceKind {
  const raw = env[VENDOR_MASTER_SOURCE_ENV];
  const value = raw === undefined ? '' : raw.trim();
  if (value === '' || value === 'fixture') return 'fixture';
  if (value === 'xero') return 'xero';
  throw new XeroConfigError(`${VENDOR_MASTER_SOURCE_ENV}=${JSON.stringify(value)} is not one of: fixture, xero`);
}

export function createVendorSource(env: NodeJS.ProcessEnv = process.env): VendorSource {
  if (vendorSourceKind(env) === 'fixture') return fetchVendorTruth;
  return createXeroVendorSource(new XeroClient(readXeroCredentials(env)));
}
