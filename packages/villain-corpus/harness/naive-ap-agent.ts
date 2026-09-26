/**
 * `naive-ap-agent.ts` — the villain corpus's stand-in for an autonomous AP
 * (accounts-payable) agent that pays whatever a vendor-invoice email/notice
 * tells it to, with no independent re-derivation of the facts the payment
 * decision relies on. This is the failure mode Bonded's `enforce()` exists to
 * catch: an agent that trusts the claim in the inbox instead of checking it
 * against a vendor-master/ERP source of truth.
 *
 * DELIBERATE SIMPLIFICATION, STATED PLAINLY (not a shortcut taken silently):
 * unlike the older `packages/attack-corpus`, which drives real third-party
 * agent-framework starter kits (LLM providers, multiple crypto-agent
 * scaffolds), this file does not clone or wrap any AP-automation agent
 * framework. AP-agent platforms (the real target market for this use case)
 * aren't a shared open-source starter-kit ecosystem the way EVM agent kits
 * are, so there is nothing equivalent to adapt here. Instead this is a small,
 * deterministic, hand-written function that reproduces the ONE behavior that
 * matters for this demo: read the claimed payout address off the spoofed
 * page, and propose paying it, unconditionally, with zero verification. That
 * naive proposal is then handed to the REAL `enforce()` (in `run.ts`), which
 * is what actually re-derives the true payout address from
 * `@bonded/issuer-oracle` and catches the mismatch — this file's job is only
 * to honestly represent the naive, pre-Bonded behavior being guarded against.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Absolute path to `site/spoofed-invoice.html`, resolved relative to this
 * source file's own location (not `process.cwd()`), so it works the same way
 * whether this module is run directly via `tsx harness/run.ts` (this task's
 * own verification command) or imported from a test under
 * `harness/__tests__/`. This intentionally resolves against the SOURCE tree
 * (`site/` lives next to `harness/`, not inside `dist/`) — the demo is run
 * from source via `tsx`, per this package's own `demo` script; a `tsc` build
 * does not copy `site/` into `dist/`, so a compiled `dist/harness/*.js` would
 * not find it if run standalone. That's fine: nothing in this package's build
 * or test pipeline runs the compiled output, only `tsc --noEmit`-shaped
 * typechecking and `ts-jest` against the source.
 */
export function spoofedInvoicePath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', 'site', 'spoofed-invoice.html');
}

/** Matches `id="fraudulent-payout-address" ... data-address="0x<64 hex>"`. */
const FRAUDULENT_ADDRESS_PATTERN =
  /id="fraudulent-payout-address"[^>]*data-address="(0x[0-9a-fA-F]{64})"/;

/**
 * Parses the claimed fraudulent payout address straight out of the spoofed
 * page's own markup — not a separately hand-typed constant that could drift
 * out of sync with the HTML. If the page's markup ever changes shape without
 * updating this pattern, this throws rather than silently returning a stale
 * or wrong address.
 */
export function extractFraudulentPayoutAddress(html: string): `0x${string}` {
  const match = FRAUDULENT_ADDRESS_PATTERN.exec(html);
  if (match === null) {
    throw new Error(
      'naive-ap-agent: could not find #fraudulent-payout-address[data-address] in the spoofed invoice HTML — ' +
        'the page markup and this parser have drifted out of sync.',
    );
  }
  return match[1] as `0x${string}`;
}

/** Reads `site/spoofed-invoice.html` off disk and extracts the claimed fraudulent address. */
export function readFraudulentPayoutAddress(): `0x${string}` {
  const html = readFileSync(spoofedInvoicePath(), 'utf8');
  return extractFraudulentPayoutAddress(html);
}

/** Matches `id="claimed-evm-identity" ... data-address="0x<40 hex>"` (a 20-byte EVM address). */
const CLAIMED_EVM_IDENTITY_PATTERN = /id="claimed-evm-identity"[^>]*data-address="(0x[0-9a-fA-F]{40})"/;

/**
 * Parses the attacker's claimed EVM identity out of the spoofed page's own
 * markup, exactly like `extractFraudulentPayoutAddress`: one source (the
 * HTML), never a second hand-typed constant. Throws on drift.
 *
 * The value on the page is a real OFAC-listed address (see the note beside
 * it in site/spoofed-invoice.html). It exists because Intercepta can screen
 * only EVM addresses; the Sui payout address above cannot be screened.
 */
export function extractClaimedEvmIdentity(html: string): `0x${string}` {
  const match = CLAIMED_EVM_IDENTITY_PATTERN.exec(html);
  if (match === null) {
    throw new Error(
      'naive-ap-agent: could not find #claimed-evm-identity[data-address] (0x + 40 hex) in the spoofed invoice HTML — ' +
        'the page markup and this parser have drifted out of sync.',
    );
  }
  return match[1] as `0x${string}`;
}

/** Reads `site/spoofed-invoice.html` off disk and extracts the claimed EVM identity. */
export function readClaimedEvmIdentity(): `0x${string}` {
  return extractClaimedEvmIdentity(readFileSync(spoofedInvoicePath(), 'utf8'));
}

/**
 * The naive AP agent's payment proposal: it read a vendor id, a claimed
 * payout address (from the spoofed page, unverified), and a claimed invoice
 * amount, and it will pay them exactly as claimed. No lookup against any
 * vendor-master/ERP source of truth happens here — that is the entire point.
 */
export interface NaivePaymentProposal {
  vendorId: string;
  claimedPayoutAddress: `0x${string}`;
  /** The payee's claimed EVM identity (20-byte), read off the same spoofed page. Screened, never settled to. */
  claimedPayeeEvmAddress: `0x${string}`;
  claimedInvoiceAmountUSD: string;
}

/**
 * Proposes paying `vendorId`'s invoice at whatever payout address the spoofed
 * page claims, unconditionally. This is the naive, pre-Bonded behavior:
 * `enforce()` (called separately, in `run.ts`) is what actually catches the
 * mismatch against `@bonded/issuer-oracle`'s real vendor-master fixture — an
 * agent built like this one, on its own, would simply pay the fraud.
 */
export function proposeNaivePayment(vendorId: string, claimedInvoiceAmountUSD: string): NaivePaymentProposal {
  return {
    vendorId,
    claimedPayoutAddress: readFraudulentPayoutAddress(),
    claimedPayeeEvmAddress: readClaimedEvmIdentity(),
    claimedInvoiceAmountUSD,
  };
}
