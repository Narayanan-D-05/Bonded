import { NextResponse } from 'next/server';
import { DEMO_VENDOR_IDS, isDemoVendorId, runEnforceForInvoice, toApiResponse } from '../../../lib/enforce-deps';

/**
 * `POST /api/enforce` — takes `{ invoiceId }`, builds the matching real `Proposal`/
 * `PolicyArtifact` (`lib/enforce-deps.ts`), calls the real `enforce()` from `@bonded/enforcer`,
 * and returns the `Verdict` JSON plus the claimed/derived pair for EVERY premise checked, not
 * just the mismatched one (CLAUDE.md rule 5 — the actual re-derived value must be visible,
 * never a bare claim; showing every premise keeps the diff table honest for the clean-clearing
 * case too).
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }

  const invoiceId = (body as { invoiceId?: unknown } | null)?.invoiceId;
  if (typeof invoiceId !== 'string' || !isDemoVendorId(invoiceId)) {
    return NextResponse.json(
      { error: `invoiceId must be one of: ${DEMO_VENDOR_IDS.join(', ')}`, received: invoiceId ?? null },
      { status: 400 },
    );
  }

  const result = await runEnforceForInvoice(invoiceId);
  return NextResponse.json(toApiResponse(result));
}
