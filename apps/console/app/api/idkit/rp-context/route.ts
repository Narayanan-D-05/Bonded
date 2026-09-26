import { NextResponse } from 'next/server';
import { signRequest } from '@worldcoin/idkit-core/signing';
import { defaultConsoleContext } from '../../../../lib/enforce-deps';
import { describeConfigProblem, readIdkitConfig } from '../../../../lib/idkit';
import { VendorBankChangeInputError, buildVendorBankChangeSignal, normalizeVendorBankChangeClaim } from '../../../../lib/vendor-bank-change';

/**
 * `POST /api/idkit/rp-context` `{ vendorId, newPayoutAddress, newEvmAddress }`: signs a fresh RP
 * request for the vendor bank-change action, server-side. The signing key never reaches the browser.
 *
 * "Never generate RP signatures on the client and never expose your RP signing key"
 * (https://docs.world.org/world-id/idkit/integrate, Step 3). `signRequest({ signingKeyHex, action })`
 * from `@worldcoin/idkit-core/signing` returns `{ sig, nonce, createdAt, expiresAt }`; the action is
 * signed because this is a uniqueness proof (idkit-server `SignRequestParams`). One signature per
 * request: the nonce is fresh each call (`duplicate_nonce` otherwise, error-codes page).
 *
 * The answer also carries the non-secret values the widget needs (app_id, action, environment) and
 * the `signal` the server itself built from the submitted fields, so the browser never composes it.
 */
export async function POST(request: Request): Promise<Response> {
  const cfg = readIdkitConfig(process.env, { needSigningKey: true });
  if (!cfg.ok) {
    return NextResponse.json({ reason: 'missing_env', error: describeConfigProblem(cfg), missingEnv: [...cfg.missing, ...cfg.invalid] }, { status: 501 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ reason: 'invalid_request', error: 'Request body must be JSON.' }, { status: 400 });
  }
  let claim;
  try {
    claim = normalizeVendorBankChangeClaim((body ?? {}) as Record<string, unknown>);
  } catch (error) {
    if (error instanceof VendorBankChangeInputError) return NextResponse.json({ reason: 'invalid_request', error: error.message }, { status: 400 });
    throw error;
  }
  const truth = await defaultConsoleContext().vendorSource(claim.vendorId);
  if (truth === null) return NextResponse.json({ reason: 'unknown_vendor', error: `${claim.vendorId} is not in the vendor master.` }, { status: 404 });
  if (truth.payoutAddress.toLowerCase() === claim.newPayoutAddress) {
    return NextResponse.json({ reason: 'payout_unchanged', error: `${claim.newPayoutAddress} is already the payout address on file.` }, { status: 400 });
  }

  const { config } = cfg;
  let sig;
  try {
    sig = signRequest({ signingKeyHex: config.signingKeyHex!, action: config.action });
  } catch (error) {
    // The error's message is not echoed: it could quote the key material.
    return NextResponse.json(
      { reason: 'signing_failed', error: `signRequest failed (${error instanceof Error ? error.name : 'error'}). Check the format of WORLD_IDKIT_SIGNING_KEY.` },
      { status: 500 },
    );
  }
  return NextResponse.json({
    app_id: config.appId,
    action: config.action,
    environment: config.environment,
    signal: buildVendorBankChangeSignal(claim),
    rp_context: {
      rp_id: config.rpId,
      nonce: sig.nonce,
      created_at: sig.createdAt,
      expires_at: sig.expiresAt,
      signature: sig.sig,
    },
  });
}
