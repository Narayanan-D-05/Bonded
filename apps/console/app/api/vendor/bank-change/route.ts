import { NextResponse } from 'next/server';
import { defaultConsoleContext } from '../../../../lib/enforce-deps';
import { submitVendorBankChange } from '../../../../lib/idkit';
import { defaultVendorRequestStorePath } from '../../../../lib/vendor-bank-change';

/**
 * `POST /api/vendor/bank-change` `{ vendorId, newPayoutAddress, newEvmAddress, idkitResult }`: the
 * vendor's bank-change request. `submitVendorBankChange` (lib/idkit.ts) rebuilds the signal from
 * the fields, checks the IDKit result is for our action/environment/credential and bound to that
 * signal, forwards it as-is to `POST https://developer.world.org/api/v4/verify/{rp_id}`, and only
 * on World's success appends the verified request to `.data/vendor-bank-change-requests.json`.
 * Every failure answers a distinct `reason` and records nothing.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, reason: 'invalid_request', detail: 'Request body must be JSON.' }, { status: 400 });
  }
  const result = await submitVendorBankChange((body ?? {}) as Record<string, unknown>, {
    env: process.env,
    fetch,
    vendorSource: defaultConsoleContext().vendorSource,
    storePath: defaultVendorRequestStorePath(),
    now: () => Date.now(),
  });
  return NextResponse.json(result, { status: result.status });
}
