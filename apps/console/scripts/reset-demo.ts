/**
 * Resets the console demo so every scenario can be shown again from the start.
 *
 *   pnpm --filter @bonded/console demo:reset                 # archive state + fresh vault (default 40,000 USDSUI)
 *   pnpm --filter @bonded/console demo:reset -- --fund 60000 # choose how much USDSUI to put in the new vault
 *   pnpm --filter @bonded/console demo:reset -- --keep-vault # only archive the local state, no chain calls
 *   pnpm --filter @bonded/console demo:reset -- --no-agent   # skip the automatic AP agent run at the end
 *
 * What "from the start" needs, and why each step exists:
 *  1. Local demo state is ARCHIVED (moved, never deleted) to .data/archive/<timestamp>/:
 *     - .data/console/settlements.json          the pay-once ledger ("Already paid")
 *     - .data/console/verdicts.json             the agent's latest verdict per invoice (inbox status)
 *     - .data/vendor-master-changes.json        approved bank changes (else the bank-change
 *                                               invoices would clear straight away, not hold)
 *     - .data/vendor-bank-change-requests.json  IDKit-verified vendor requests
 *     - .data/world-agents/stepup-store.json    World ID step-up attempts
 *     Intercepta evidence (.data/intercepta/) is kept; it is an audit record, not demo state.
 *  2. A FRESH Vault<USDSUI> is created on Sui testnet and funded. The policy's budget is a
 *     vault-lifetime total checked against the vault's on-chain `spent_this_period`, which
 *     never resets, so reusing one vault would eventually refuse every invoice as
 *     BUDGET_EXCEEDED. Funding mints test USDSUI with the TreasuryCap this wallet holds.
 *  3. SUI_VAULT_ID in the repo-root .env is pointed at the new vault (a public object id).
 *
 * Signing uses the Sui CLI keystore (CLAUDE.md rule 3); every transaction is dry-run first,
 * and the script refuses to run unless the CLI's active environment is testnet. The old vault
 * and every past transaction stay on-chain; nothing is erased there.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DATA = join(REPO_ROOT, '.data');
const ROOT_ENV = join(REPO_ROOT, '.env');

const STATE_FILES = [
  'console/settlements.json',
  'console/verdicts.json',
  'vendor-master-changes.json',
  'vendor-bank-change-requests.json',
  'world-agents/stepup-store.json',
];

/** USDSUI TreasuryCap held by the demo wallet (see move/DEPLOYMENTS.md); override with env. */
const DEFAULT_TREASURY_CAP = '0x9de96939d2ed17528acbec3abffefcc6e9a14bd79640b54317b49b9ea574316b';
const USDC_DECIMALS = 6n;

function loadRootEnv(): void {
  // Same rule as next.config.ts: never overrides a variable already set. Values never printed.
  if (existsSync(ROOT_ENV)) process.loadEnvFile(ROOT_ENV);
}

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is not set (repo-root .env; see .env.example).`);
  return v;
}

function sui(args: string[]): string {
  return execFileSync('sui', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

function parseJson(out: string): unknown {
  const start = out.indexOf('{');
  if (start < 0) throw new Error(`Sui CLI returned no JSON:\n${out.slice(0, 500)}`);
  return JSON.parse(out.slice(start));
}

/** Runs a PTB: dry run first (must succeed), then executes and returns the parsed result. */
function runPtb(label: string, ptbArgs: string[]): Record<string, unknown> {
  const dry = sui(['client', 'ptb', ...ptbArgs, '--gas-budget', '50000000', '--dry-run']);
  if (!/execution status: success/i.test(dry)) {
    throw new Error(`${label}: dry run did not succeed; nothing was submitted.\n${dry.slice(0, 800)}`);
  }
  const result = parseJson(sui(['client', 'ptb', ...ptbArgs, '--gas-budget', '50000000', '--json'])) as Record<string, unknown>;
  const status = (result.effects as { status?: { status?: string } } | undefined)?.status?.status;
  if (status !== 'success') throw new Error(`${label}: transaction status ${String(status)} (digest ${String(result.digest)}).`);
  console.log(`  ${label}: ${String(result.digest)}  https://suiscan.xyz/testnet/tx/${String(result.digest)}`);
  return result;
}

/** Finds the created shared Vault<T> in a transaction result (objectChanges). */
function createdVaultId(result: Record<string, unknown>, pkg: string): string {
  const changes = (result.objectChanges ?? []) as Array<{ type?: string; objectType?: string; objectId?: string }>;
  const hit = changes.find(
    (c) => c.type === 'created' && typeof c.objectType === 'string' && c.objectType.startsWith(`${pkg}::bonded_vault::Vault<`),
  );
  if (!hit?.objectId) throw new Error('Could not find the created Vault in the transaction result.');
  return hit.objectId;
}

function readVaultBalance(vaultId: string): string {
  const obj = parseJson(sui(['client', 'object', vaultId, '--json'])) as { content?: { balance?: string } };
  return obj.content?.balance ?? 'unknown';
}

function archiveState(): string | null {
  const present = STATE_FILES.filter((f) => existsSync(join(DATA, f)));
  if (present.length === 0) {
    console.log('  No demo state to archive.');
    return null;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = join(DATA, 'archive', stamp);
  for (const f of present) {
    const to = join(dest, f);
    mkdirSync(dirname(to), { recursive: true });
    renameSync(join(DATA, f), to);
    console.log(`  archived ${f}`);
  }
  return dest;
}

function setRootEnv(name: string, value: string): void {
  const text = existsSync(ROOT_ENV) ? readFileSync(ROOT_ENV, 'utf8') : '';
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const line = `${name}=${value}`;
  const re = new RegExp(`^${name}=.*$`, 'm');
  const next = re.test(text) ? text.replace(re, line) : `${text}${text.endsWith(nl) || text === '' ? '' : nl}${line}${nl}`;
  writeFileSync(ROOT_ENV, next);
}

function parseArgs(argv: string[]): { keepVault: boolean; fundUsdsui: bigint; runAgent: boolean } {
  let keepVault = false;
  let runAgent = true;
  let fundUsdsui = 40_000n;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--keep-vault') keepVault = true;
    else if (argv[i] === '--no-agent') runAgent = false;
    else if (argv[i] === '--fund') {
      const v = argv[++i] ?? '';
      if (!/^[1-9][0-9]{0,9}$/.test(v)) throw new Error('--fund takes a whole number of USDSUI, e.g. --fund 40000');
      fundUsdsui = BigInt(v);
    }
  }
  return { keepVault, fundUsdsui, runAgent };
}

async function main(): Promise<void> {
  const { keepVault, fundUsdsui, runAgent } = parseArgs(process.argv.slice(2));
  loadRootEnv();

  console.log('1) Archiving local demo state');
  const archived = archiveState();
  if (archived) console.log(`  -> ${archived}`);

  if (keepVault) {
    console.log('2) --keep-vault: no chain calls. Note the vault budget is lifetime; see the header.');
  } else {
    const activeEnv = sui(['client', 'active-env']).trim().split(/\r?\n/).pop()?.trim();
    if (activeEnv !== 'testnet') throw new Error(`Sui CLI active env is "${activeEnv}", not testnet. Refusing to continue.`);
    const pkg = requireEnv('SUI_BONDED_PACKAGE_ID');
    const coinType = requireEnv('SUI_BOND_COIN_TYPE');
    const cap = process.env.SUI_USDSUI_TREASURY_CAP_ID?.trim() || DEFAULT_TREASURY_CAP;
    const capType = (parseJson(sui(['client', 'object', cap, '--json'])) as { objType?: string }).objType ?? '';
    if (!capType.includes(`TreasuryCap<${coinType}>`)) {
      throw new Error(`${cap} is not the TreasuryCap for ${coinType} (got ${capType || 'nothing'}); cannot fund a new vault.`);
    }

    console.log('2) Creating a fresh Vault<USDSUI> on Sui testnet');
    const created = runPtb('create + share vault', ['--move-call', `${pkg}::bonded_vault::new_and_share_vault`, `<${coinType}>`]);
    const vaultId = createdVaultId(created, pkg);
    console.log(`  new vault: ${vaultId}`);

    console.log(`3) Funding it with ${fundUsdsui} USDSUI`);
    const amount = (fundUsdsui * 10n ** USDC_DECIMALS).toString();
    runPtb('mint + fund_vault', [
      '--move-call', '0x2::coin::mint', `<${coinType}>`, `@${cap}`, amount,
      '--assign', 'minted',
      '--move-call', `${pkg}::bonded_vault::fund_vault`, `<${coinType}>`, `@${vaultId}`, 'minted',
    ]);
    console.log(`  vault balance (base units): ${readVaultBalance(vaultId)}`);

    console.log('4) Pointing the app at the new vault');
    setRootEnv('SUI_VAULT_ID', vaultId);
    process.env.SUI_VAULT_ID = vaultId; // this process already loaded the old value
    console.log(`  SUI_VAULT_ID updated in ${ROOT_ENV}`);
  }

  if (runAgent) {
    console.log('5) The AP agent reviews every invoice (pays cleared ones; refused and held ones wait)');
    const { loadAgentEnv, runAgentOverInbox } = await import('./run-agent');
    loadAgentEnv();
    await runAgentOverInbox();
  }

  console.log(`
Done. Next:
  - Restart the console (Ctrl+C, then: pnpm --filter @bonded/console dev) so it reads the new vault.
  - IDKit: World allows one verification per person per action, so in the Simulator use a
    NEW identity for the vendor verification (the previous identity will be rejected).
  - The agent has already reviewed the inbox: only the HELD invoices need a person
    (the two bank changes and the $15,000 invoice). Run the agent again any time with
    pnpm --filter @bonded/console demo:agent`);
}

main().catch((err: unknown) => {
  console.error(`\nReset stopped: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
