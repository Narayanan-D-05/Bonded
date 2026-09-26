import { NextResponse } from 'next/server';
import type { Hash32 } from '@bonded/seam';
import {
  WorldConfigError,
  decideStepUp,
  fromHeldVerdict,
  handleCallback,
  initiateStepUp,
  JsonFileStepUpStore,
  type HeldProposal,
} from '@bonded/world-agents';
import { findHeldInvoiceByProposalHash, missingWorldEnvVars } from '../../../lib/enforce-deps';

/**
 * Thin wrapper over `@bonded/world-agents`' already-built step-up flow (Migration PRD D.6). No
 * new logic is added to that package here — this route only wires its exported functions
 * (`initiateStepUp`, `handleCallback`, `decideStepUp`, `fromHeldVerdict`) plus its already-
 * exported `JsonFileStepUpStore` (to recover which demo proposal an attempt's `state` belonged
 * to, since `handleCallback`'s own result does not carry `proposalHash`).
 *
 * If the World sandbox env vars are unset, this fails VISIBLY, naming exactly which vars are
 * missing (never their values) — never a faked approval (CLAUDE.md rule 4/1).
 */

const PROPOSAL_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

function isProposalHash(value: unknown): value is Hash32 {
  return typeof value === 'string' && PROPOSAL_HASH_PATTERN.test(value);
}

/** `POST { proposalHash }` — starts a step-up attempt for one of this demo's 3 known held proposals. */
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
      {
        error: `World sandbox is not configured. Missing env var(s): ${missingEnv.join(', ')}. See apps/console/.env.local.example.`,
        missingEnv,
      },
      { status: 501 },
    );
  }

  // Never trust a client-supplied proposal — re-derive the real verdict from the fixed set of
  // 3 demo invoices and confirm it is actually HELD_FOR_STEPUP before starting a World attempt.
  const found = await findHeldInvoiceByProposalHash(proposalHash);
  if (!found) {
    return NextResponse.json({ error: 'No demo invoice re-derives to that proposal hash.' }, { status: 404 });
  }

  let held: HeldProposal;
  try {
    held = fromHeldVerdict(found.verdict);
  } catch (error) {
    return NextResponse.json(
      { error: `That proposal is not held for step-up: ${error instanceof Error ? error.message : String(error)}` },
      { status: 409 },
    );
  }

  try {
    const { authUrl, state } = await initiateStepUp({
      proposalHash: held.proposalHash,
      reason: `Confirm payment to ${found.invoice.legalName} (${found.invoice.vendorId}), claimed payout address ${found.invoice.claimedPayoutAddress}, amount ${found.invoice.claimedInvoiceAmountUSD} (6-decimal USDC base units).`,
    });
    return NextResponse.json({ authUrl, state });
  } catch (error) {
    if (error instanceof WorldConfigError) {
      return NextResponse.json({ error: error.message, missingEnv: error.missing }, { status: 501 });
    }
    throw error;
  }
}

/** `GET ?code=&state=` — the World sandbox's OIDC redirect callback (`WORLD_REDIRECT_URI`). */
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

  // Recover which proposal this attempt (`state`) was for from world-agents' own store — this
  // reads an already-exported store, it does not add logic to that package.
  const store = new JsonFileStepUpStore();
  const stored = await store.read();
  const attempt = stored.attempts[state];
  if (!attempt) {
    return NextResponse.redirect(new URL('/stepup?decision=denied&reason=unknown_attempt', request.url));
  }

  const found = await findHeldInvoiceByProposalHash(attempt.proposalHash);
  if (!found) {
    return NextResponse.redirect(
      new URL(`/stepup?proposal=${attempt.proposalHash}&decision=denied&reason=unknown_proposal`, request.url),
    );
  }

  const held = fromHeldVerdict(found.verdict);
  const decision = decideStepUp(held, callback);

  const query = decision.approved
    ? `decision=approved&sub=${encodeURIComponent(decision.sub)}`
    : `decision=denied&reason=${encodeURIComponent(decision.reason)}`;
  return NextResponse.redirect(new URL(`/stepup?proposal=${attempt.proposalHash}&${query}`, request.url));
}
