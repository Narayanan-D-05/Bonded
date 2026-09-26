import { NextResponse } from 'next/server';
import type { Hash32 } from '@bonded/seam';
import { ReasonCode } from '@bonded/seam';
import { WorldConfigError, handleCallback, initiateStepUp, JsonFileStepUpStore } from '@bonded/world-agents';
import {
  defaultConsoleContext,
  findInvoiceIdByProposalHash,
  missingWorldEnvVars,
  runEnforceForInvoice,
} from '../../../lib/enforce-deps';
import { completeStepUp } from '../../../lib/payment';

/**
 * The World ID step-up: the one human button in the payment flow (CLAUDE.md rule 4).
 *
 * `POST { proposalHash }` re-derives the real verdict for that proposal (never trusting a
 * client-supplied proposal), confirms it is HELD_FOR_STEPUP and not already paid, and starts a
 * World attempt. `GET ?code=&state=` is the OIDC callback: `handleCallback`, then
 * `completeStepUp` (lib/payment.ts), which certifies the approval through the real `decideStepUp`
 * and settles (IRREVERSIBLE) or writes the confirmed bank change to the vendor master,
 * re-enforces and settles (PREMISE_HELD_FOR_REVIEW).
 *
 * Without World credentials this answers a visible 501 naming the missing vars. Nothing here
 * fakes an approval.
 */

const PROPOSAL_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

function isProposalHash(value: unknown): value is Hash32 {
  return typeof value === 'string' && PROPOSAL_HASH_PATTERN.test(value);
}

function usd(baseUnits: string): string {
  const v = BigInt(baseUnits);
  return `$${(v / 1_000_000n).toLocaleString('en-US')}.${((v % 1_000_000n) / 10_000n).toString().padStart(2, '0')}`;
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }
  const proposalHash = (body as { proposalHash?: unknown } | null)?.proposalHash;
  if (!isProposalHash(proposalHash)) {
    return NextResponse.json({ error: 'proposalHash must be a 32-byte 0x-hash.' }, { status: 400 });
  }

  const missingEnv = missingWorldEnvVars();
  if (missingEnv.length > 0) {
    return NextResponse.json(
      { error: `World sandbox is not configured. Missing env var(s): ${missingEnv.join(', ')}. See apps/console/.env.local.example.`, missingEnv },
      { status: 501 },
    );
  }

  const invoiceId = findInvoiceIdByProposalHash(proposalHash);
  if (invoiceId === null) {
    return NextResponse.json({ error: 'No demo invoice has that proposal hash.' }, { status: 404 });
  }
  const ctx = defaultConsoleContext();
  const prior = await ctx.ledger.get(proposalHash);
  if (prior !== null) {
    return NextResponse.json({ error: `That proposal is already ${prior.status} in the settlement ledger; it is never paid twice.` }, { status: 409 });
  }

  let run;
  try {
    run = await runEnforceForInvoice(invoiceId, ctx);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }, { status: 503 });
  }
  if (run.verdict.outcome !== 2) {
    return NextResponse.json({ error: `That proposal is not held for step-up (verdict outcome ${run.verdict.outcome}).` }, { status: 409 });
  }

  const inv = run.invoice;
  const reason =
    run.verdict.reasonCode === ReasonCode.PREMISE_HELD_FOR_REVIEW
      ? `Confirm a bank-detail change for ${inv.legalName} (${inv.vendorId}): new payout address ${inv.claimedPayoutAddress} replaces the one on file. ` +
        `Approving updates the vendor master, then pays ${usd(inv.claimedInvoiceAmountUSD)} to the updated record.`
      : `Confirm an irreversible payment of ${usd(inv.claimedInvoiceAmountUSD)} to ${inv.legalName} (${inv.vendorId}) at the payout address on file.`;

  try {
    const { authUrl, state } = await initiateStepUp({ proposalHash: run.verdict.proposalHash, reason });
    return NextResponse.json({ authUrl, state });
  } catch (error) {
    if (error instanceof WorldConfigError) {
      return NextResponse.json({ error: error.message, missingEnv: error.missing }, { status: 501 });
    }
    throw error;
  }
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const idpError = url.searchParams.get('error');

  if (idpError) {
    return NextResponse.redirect(new URL(`/stepup?decision=denied&reason=${encodeURIComponent(idpError)}`, request.url));
  }
  if (!code || !state) {
    return NextResponse.redirect(new URL('/stepup?decision=denied&reason=missing_code_or_state', request.url));
  }

  const callback = await handleCallback(code, state);

  // Which proposal this attempt was for, from world-agents' own store.
  const stored = await new JsonFileStepUpStore().read();
  const attempt = stored.attempts[state];
  if (!attempt) {
    return NextResponse.redirect(new URL('/stepup?decision=denied&reason=unknown_attempt', request.url));
  }

  let query: string;
  try {
    const outcome = await completeStepUp(attempt.proposalHash, callback);
    if (outcome.kind === 'approved') {
      query = `decision=approved&sub=${encodeURIComponent(outcome.sub)}`;
    } else if (outcome.kind === 'denied') {
      query = `decision=denied&reason=${encodeURIComponent(outcome.reason)}`;
    } else if (outcome.kind === 'refused') {
      query = `decision=denied&reason=${encodeURIComponent(outcome.detail)}`;
    } else if (outcome.kind === 'not-held') {
      query = `decision=denied&reason=${encodeURIComponent(`not held (${outcome.verdict.outcomeLabel})`)}`;
    } else {
      query = 'decision=denied&reason=unknown_proposal';
    }
  } catch (error) {
    query = `decision=error&reason=${encodeURIComponent(error instanceof Error ? `${error.name}: ${error.message}` : String(error))}`;
  }
  return NextResponse.redirect(new URL(`/stepup?proposal=${attempt.proposalHash}&${query}`, request.url));
}
