/**
 * Live Intercepta risk quote. PRD Part H (Intercepta: "at least one live call...
 * decides what happens next").
 *
 *   pnpm --filter @bonded/agents exec tsx scripts/risk-live.ts [--price 1.00] <addr|ens> [...]
 *
 * For each subject it runs a live Quick Scan quote and a live Deep Scan quote.
 * Each quote also makes a live Check Address Activity call when there is no hard
 * flag. It prints the decision and the sha256 of every response, whose raw
 * bytes are in <repo>/.data/intercepta/<sha256>.json.
 *
 * The key comes from INTERCEPTA_API_KEY in the environment. If the repo-root
 * .env exists, Node's own loader (process.loadEnvFile) adds it to process.env.
 * This script never prints .env or any value from it; it only checks whether
 * the variable is set. Exit codes: 0 all quotes produced, 1 any failure
 * (including a missing key), 2 bad usage.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { formatUnits6, parseUnits6 } from '@bonded/seam';
import {
  ENV_LINE_TO_ADD,
  INTERCEPTA_API_KEY_ENV,
  InterceptaHttpError,
  InterceptaShapeError,
  ToxicScoreRangeUnconfirmedError,
  defaultEvidenceDir,
  parseScreeningSubject,
  quoteRisk,
  type AddressScanKind,
  type RiskQuote,
} from '../src/index.js';

const USAGE = 'usage: tsx scripts/risk-live.ts [--price <decimal USD, default 1>] <evm-address|ens-name> [...]';

function fail(code: number, lines: string[]): never {
  for (const l of lines) console.error(l);
  process.exit(code);
}

function parseArgs(argv: string[]): { price: bigint; subjects: string[] } {
  let priceText = '1';
  const subjects: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] as string;
    if (a === '--price') {
      const next = argv[i + 1];
      if (next === undefined) fail(2, ['--price needs a value', USAGE]);
      priceText = next;
      i += 1;
    } else if (a.startsWith('--')) {
      fail(2, [`unknown flag ${a}`, USAGE]);
    } else {
      subjects.push(a);
    }
  }
  if (subjects.length === 0) fail(2, [USAGE]);
  let price: bigint;
  try {
    price = parseUnits6(priceText);
  } catch (e) {
    fail(2, [`bad --price: ${(e as Error).message}`]);
  }
  if (price <= 0n) fail(2, ['--price must be positive']);
  for (const s of subjects) {
    try {
      parseScreeningSubject(s);
    } catch (e) {
      fail(2, [`bad subject: ${(e as Error).message}`]);
    }
  }
  return { price, subjects };
}

function loadRepoEnv(): void {
  // defaultEvidenceDir() finds the repo root (the pnpm-workspace.yaml directory).
  const envPath = join(dirname(dirname(defaultEvidenceDir())), '.env');
  if (existsSync(envPath)) process.loadEnvFile(envPath); // never overrides an already-set variable
}

function printQuote(q: RiskQuote): void {
  const ev = (e: { endpoint: string; sha256: string; fetchedAtMs: number; storedAt: string }) =>
    `    ${e.endpoint.padEnd(14)} sha256 ${e.sha256}  at ${new Date(e.fetchedAtMs).toISOString()}\n` +
    `    ${''.padEnd(14)} stored ${e.storedAt}`;
  if (q.decision === 'BLOCK') {
    console.log(`  BLOCK  ${q.reason}`);
    console.log(ev(q.evidence));
    return;
  }
  console.log(
    `  PRICE  basis=${q.basis} R=${q.riskBps} bps  m=${q.multiplierBps} bps  ` +
      `price=${formatUnits6(q.price)}  stake/side=${formatUnits6(q.requiredStake)} (${q.requiredStake} base units)`,
  );
  console.log(ev(q.evidence));
  console.log(ev(q.activityEvidence));
}

async function main(): Promise<void> {
  const { price, subjects } = parseArgs(process.argv.slice(2));

  loadRepoEnv();
  const key = process.env[INTERCEPTA_API_KEY_ENV];
  if (key === undefined || key.trim() === '') {
    fail(1, [
      `risk-live: ${INTERCEPTA_API_KEY_ENV} is not set. No live call was made and no quote exists.`,
      'There is no fallback value (CLAUDE.md rule 1). Add this exact line to the repo-root .env:',
      '',
      `  ${ENV_LINE_TO_ADD}`,
      '',
    ]);
  }

  let failures = 0;
  for (const subject of subjects) {
    for (const scan of ['quick-scan', 'toxic-score'] as AddressScanKind[]) {
      console.log(`${subject}  [${scan}]`);
      try {
        printQuote(await quoteRisk(subject, price, { scan }));
      } catch (e) {
        failures += 1;
        const err = e as Error;
        console.log(`  FAILED ${err.name}: ${err.message}`);
        if (e instanceof ToxicScoreRangeUnconfirmedError) {
          console.log(`    observed toxicScore = ${e.observedToxicScore} (record this to confirm the range)`);
        }
        if (e instanceof InterceptaShapeError && e.evidence) {
          console.log(`    offending body sha256 ${e.evidence.sha256}`);
        }
        if (e instanceof InterceptaHttpError && e.httpStatus === 403) {
          console.log('    (403 = key rejected by Intercepta; check the key value)');
        }
      }
    }
  }
  if (failures > 0) {
    console.error(`risk-live: ${failures} quote(s) failed; see above. Nothing failed silently.`);
    process.exit(1);
  }
}

main().catch((e: unknown) => {
  console.error(`risk-live: ${(e as Error).stack ?? String(e)}`);
  process.exit(1);
});
