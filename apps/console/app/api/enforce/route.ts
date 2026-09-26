import { NextResponse } from 'next/server';
import { DEMO_INVOICE_IDS, isDemoInvoiceId, OnchainPolicyError } from '../../../lib/enforce-deps';
import { proposePayment } from '../../../lib/payment';

/**
 * `POST /api/enforce { invoiceId }`: the AP agent proposing payment of one invoice. Runs the real
 * `enforce()` against the agent's ONE policy, whose hash is read from BondedRegistry on-chain, and
 * returns the verdict plus the claimed/derived pair for every premise checked (CLAUDE.md rule 5).
 * On CLEARED it settles on Sui through `settleCleared`, once per proposal: a repeat POST returns
 * the recorded digest instead of paying again. There is no human button in this path.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }

  const invoiceId = (body as { invoiceId?: unknown } | null)?.invoiceId;
  if (typeof invoiceId !== 'string' || !isDemoInvoiceId(invoiceId)) {
    return NextResponse.json(
      { error: `invoiceId must be one of: ${DEMO_INVOICE_IDS.join(', ')}`, received: invoiceId ?? null },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(await proposePayment(invoiceId));
  } catch (error) {
    // Visible failure, never a fallback (e.g. the on-chain policy hash or vault read failed).
    const status = error instanceof OnchainPolicyError ? 503 : 500;
    return NextResponse.json(
      { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) },
      { status },
    );
  }
}
