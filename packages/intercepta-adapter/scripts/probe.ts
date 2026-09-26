/**
 * One live, unpinned probe against the real Intercepta API. Migration PRD
 * D.5 / Part H.1: this is NOT the qualifying "live decision" test — that
 * needs a real `INTERCEPTA_API_KEY` and the pinned known-risk mainnet test
 * addresses from Intercepta's Discord (still owed by the user as of this
 * writing). This script exists only to record the REAL HTTP status and
 * error-body SHAPE right now, with whatever key is or isn't available, so
 * the endpoint paths and headers are proven live rather than assumed.
 *
 *   pnpm --filter @bonded/intercepta-adapter exec tsx scripts/probe.ts
 *
 * If INTERCEPTA_API_KEY is not set, this still runs UNAUTHENTICATED and
 * prints the real HTTP status/body Intercepta actually returns for a missing
 * or invalid key. Note: `client.ts`'s own `scanAddress`/`scanToken` refuse to
 * even attempt the network call without a key (CLAUDE.md rule 1 — no
 * fallback, ever, on the real decision path), so THIS script makes the
 * unauthenticated request directly with the bare `fetch` this package
 * otherwise wraps, using the same URL builders `client.ts` uses. That keeps
 * the real client's "never call out without a key" guarantee intact while
 * still letting this probe record what Intercepta's server itself says.
 *
 * This script never prints `.env`'s contents; it only checks whether the key
 * variable is set.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  INTERCEPTA_API_KEY_ENV,
  SCAN_MESSAGE_URL,
  addressScanUrl,
  defaultEvidenceDir,
  parseScreeningSubject,
  scanAddress,
  scanToken,
  scanTokenUrl,
} from '../src/index.js';

// A syntactically valid but otherwise arbitrary EVM address — NOT a pinned
// known-risk test address. It exists only to exercise a real path parameter;
// whatever this address's real toxicScore/riskScore turns out to be is
// printed as-is and is not treated as a qualifying result.
const ARBITRARY_EVM_ADDRESS = '0x000000000000000000000000000000000000dEaD';
const ARBITRARY_TOKEN_ADDRESS = '0x000000000000000000000000000000000000dEaD';

function loadRepoEnv(): void {
  const envPath = join(dirname(dirname(defaultEvidenceDir())), '.env');
  if (existsSync(envPath)) process.loadEnvFile(envPath); // never overrides an already-set variable
}

/** A bare, unauthenticated GET — only used by this probe, never by client.ts's real calls. */
async function bareUnauthenticatedGet(label: string, url: string): Promise<void> {
  console.log(`\n--- ${label} (UNAUTHENTICATED, no X-API-KEY header) ---`);
  console.log(`  GET ${url}`);
  try {
    const res = await fetch(url, { method: 'GET', cache: 'no-store', headers: { accept: 'application/json' } });
    const text = await res.text();
    console.log(`  real HTTP status: ${res.status}`);
    console.log(`  real body: ${text.slice(0, 500)}`);
  } catch (error) {
    console.log(`  real network error: ${(error as Error).message}`);
  }
}

async function main(): Promise<void> {
  loadRepoEnv();
  const hasKey = process.env[INTERCEPTA_API_KEY_ENV] !== undefined && process.env[INTERCEPTA_API_KEY_ENV]!.trim() !== '';
  console.log(`INTERCEPTA_API_KEY is ${hasKey ? 'set' : 'NOT set'} (value never printed).`);

  const subject = parseScreeningSubject(ARBITRARY_EVM_ADDRESS);
  console.log(`\nquick-scan URL: ${addressScanUrl('quick-scan', subject)}`);
  console.log(`toxic-score URL: ${addressScanUrl('toxic-score', subject)}`);
  console.log(`scan-token URL: ${scanTokenUrl(ARBITRARY_TOKEN_ADDRESS, '1')}`);
  console.log(`scan-message URL: ${SCAN_MESSAGE_URL}`);

  if (!hasKey) {
    console.log(
      '\nNo key is set, so client.ts\'s real scanAddress/scanToken/scanMessage refuse to run at all ' +
        '(CLAUDE.md rule 1 — no fallback, ever, on the real decision path). This probe instead makes ' +
        'bare unauthenticated requests directly, to record what Intercepta\'s server actually returns. ' +
        'This does NOT satisfy the sponsor track\'s "live call before payment" requirement, which needs ' +
        'a real key and, for the qualifying decision, the pinned Discord test addresses.',
    );
    await bareUnauthenticatedGet('quick-scan', addressScanUrl('quick-scan', subject));
    await bareUnauthenticatedGet('toxic-score', addressScanUrl('toxic-score', subject));
    await bareUnauthenticatedGet('scan-token', scanTokenUrl(ARBITRARY_TOKEN_ADDRESS, '1'));
    return;
  }

  for (const [label, run] of [
    ['scanAddress(quick-scan)', () => scanAddress(ARBITRARY_EVM_ADDRESS, 'quick-scan')],
    ['scanAddress(toxic-score)', () => scanAddress(ARBITRARY_EVM_ADDRESS, 'toxic-score')],
    ['scanToken(chainId=1)', () => scanToken(ARBITRARY_TOKEN_ADDRESS, '1')],
  ] as const) {
    console.log(`\n--- ${label} ---`);
    try {
      const { result, evidence } = await run();
      console.log('HTTP', evidence.httpStatus, JSON.stringify(result));
      console.log('evidence sha256', evidence.sha256, 'stored at', evidence.storedAt);
    } catch (error) {
      const err = error as Error & { httpStatus?: number; bodyExcerpt?: string };
      console.log(`FAILED ${err.name}: ${err.message}`);
      if (err.httpStatus !== undefined) console.log('  real HTTP status:', err.httpStatus);
      if (err.bodyExcerpt) console.log('  real body excerpt:', err.bodyExcerpt);
    }
  }
}

main().catch((e: unknown) => {
  console.error(`probe: ${(e as Error).stack ?? String(e)}`);
  process.exit(1);
});
