/**
 * The vendor-master WRITE for a World-approved bank-detail change.
 *
 * A changed bank detail only becomes truth after a verified person updates
 * the vendor record. This is that update, and nothing else calls it:
 *
 *  - `VENDOR_MASTER_SOURCE=fixture` (default): appends a `fixture-overlay`
 *    entry to the change log (`../vendor-master-changes.ts`), which the
 *    fixture source overlays. Part of the disclosed stand-in, not a real ERP.
 *  - `VENDOR_MASTER_SOURCE=xero`: updates the supplier's `BankAccountDetails`
 *    through the real Xero API (`updateXeroPayoutAddress`), then appends an
 *    audit-only `xero` entry (World sub, auth time, proposal hash) to the same
 *    log, because Xero's contact has no field for who approved the change.
 *
 * Either way the write is compare-and-set against the address the approval
 * was requested for, and the result is read back through the same source the
 * enforcer uses before this returns.
 */

import type { VendorTruth } from '../vendor-fixture.js';
import { appendVendorMasterChange, createFixtureVendorSourceWithChanges, type VendorMasterChange } from '../vendor-master-changes.js';
import { vendorSourceKind } from './select.js';
import { XERO_BANK_CHANGE_SCOPES, XeroClient, createXeroVendorSource, readXeroCredentials, updateXeroPayoutAddress } from './xero.js';

export interface BankChangeRequest {
  vendorId: string;
  previousPayoutAddress: `0x${string}`;
  newPayoutAddress: `0x${string}`;
  approvedBy: { worldSub: string; authTimeMs: number };
  proposalHash: `0x${string}`;
  /** Defaults to Date.now(). */
  recordedAtMs?: number;
}

export interface BankChangeResult {
  change: VendorMasterChange;
  /** The vendor record read back after the write, through the enforcer's own source. */
  truthAfter: VendorTruth;
}

export type VendorMasterBankChangeWriter = (request: BankChangeRequest) => Promise<BankChangeResult>;

export class BankChangeVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BankChangeVerificationError';
  }
}

export function createVendorMasterBankChangeWriter(
  env: NodeJS.ProcessEnv,
  options: { changeLogPath: string; xeroClient?: XeroClient },
): VendorMasterBankChangeWriter {
  const kind = vendorSourceKind(env);
  const xeroClient =
    kind === 'xero' ? (options.xeroClient ?? new XeroClient(readXeroCredentials(env), { scopes: XERO_BANK_CHANGE_SCOPES })) : undefined;

  return async (request) => {
    const newPayoutAddress = request.newPayoutAddress.toLowerCase() as `0x${string}`;
    const previousPayoutAddress = request.previousPayoutAddress.toLowerCase() as `0x${string}`;
    const change: VendorMasterChange = {
      vendorId: request.vendorId,
      field: 'payoutAddress',
      previousPayoutAddress,
      newPayoutAddress,
      appliedTo: kind === 'xero' ? 'xero' : 'fixture-overlay',
      approvedBy: { ...request.approvedBy },
      proposalHash: request.proposalHash,
      recordedAtMs: request.recordedAtMs ?? Date.now(),
    };

    let readBack: (vendorId: string) => Promise<VendorTruth | null>;
    let recorded: VendorMasterChange;
    if (xeroClient !== undefined) {
      await updateXeroPayoutAddress(xeroClient, {
        vendorId: request.vendorId,
        expectedPreviousPayoutAddress: previousPayoutAddress,
        newPayoutAddress,
      });
      recorded = await appendVendorMasterChange(options.changeLogPath, change);
      readBack = createXeroVendorSource(xeroClient);
    } else {
      recorded = await appendVendorMasterChange(options.changeLogPath, change);
      readBack = createFixtureVendorSourceWithChanges(options.changeLogPath);
    }

    const truthAfter = await readBack(request.vendorId);
    if (truthAfter === null || truthAfter.payoutAddress !== newPayoutAddress) {
      throw new BankChangeVerificationError(
        `Vendor-master write for ${request.vendorId} did not read back: payout address is ${truthAfter?.payoutAddress ?? '<vendor not found>'}, expected ${newPayoutAddress}.`,
      );
    }
    return { change: recorded, truthAfter };
  };
}
