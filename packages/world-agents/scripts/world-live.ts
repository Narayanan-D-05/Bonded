/**
 * Live World ID for Agents step-up: prints the real authorize URL, then runs a one-shot
 * local callback listener that completes a real code exchange and a real JWKS-verified
 * decision. Migration PRD D.6 / H.2, PRD G "World flow" row (manual: "the denied/expired
 * path genuinely blocks settlement").
 *
 *   pnpm --filter @bonded/world-agents exec tsx scripts/world-live.ts \
 *     [--proposal-hash 0x<64 hex chars>] [--reason "confirm purchase of 2 tickets, $90.00, non-refundable"]
 *
 * ── What you need before this does anything but fail loudly ────────────────────────────
 *
 * 1. Register a confidential OIDC client at https://sandbox.auth.world.org/portal
 *    (Google sign-in). Copy the client id and the ONE-TIME-SHOWN client secret.
 * 2. The sandbox rejects http callbacks, including http://localhost (VERIFY_FINDINGS 3b) —
 *    an HTTPS tunnel to this script's local listener is required, e.g. (either works; pick
 *    whichever installs cleanly for you — both are on the npm registry and run via `npx`
 *    without a system-wide install, and this script never runs them for you):
 *
 *      npx cloudflared tunnel --url http://localhost:8787
 *      # or:
 *      npx localtunnel --port 8787
 *
 *    Register the printed HTTPS URL + "/callback" (exact scheme/host/path/port — no
 *    wildcards, per VERIFY_FINDINGS 3b) as the client's redirect URI in the portal, then set:
 *
 *      WORLD_SANDBOX_CLIENT_ID=<from the portal>
 *      WORLD_SANDBOX_CLIENT_SECRET=<from the portal, shown once>
 *      WORLD_REDIRECT_URI=https://<your-tunnel-host>/callback
 *      WORLD_LOCAL_CALLBACK_PORT=8787   # optional; must match the --url/--port above
 *
 *    in the repo-root .env (never committed; loaded below via process.loadEnvFile, which
 *    never overrides an already-set variable and is never printed).
 * 3. A phone with the sandbox World ID app and its test proof-of-human flow completed
 *    (VERIFY_FINDINGS 3c: "have the sandbox World ID app ready ... A staging or production
 *    verification is not a substitute for sandbox setup." Where to install it is itself
 *    UNCONFIRMED by VERIFY_FINDINGS — ask the event organizers.)
 *
 * Without WORLD_SANDBOX_CLIENT_ID / WORLD_SANDBOX_CLIENT_SECRET / WORLD_REDIRECT_URI, this
 * exits 1 and names exactly which are missing, BEFORE starting any server or making any
 * network call — there is nothing left running afterward. This is not a fallback path; per
 * CLAUDE.md rule 1 ("no mocked or hard-coded ... responses, ever") and rule 7 ("never
 * fabricate ... including in tests"), a missing credential is a real, visible failure, not
 * a reason to substitute a fake success.
 */
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Hash32 } from '@bonded/seam';
import {
  WORLD_ENV,
  WorldConfigError,
  discover,
  initiateStepUp,
  handleCallback,
  parseCallback,
  readWorldClientConfig,
} from '../src/flow.js';
import { findWorkspaceRoot } from '../src/store.js';

const DEFAULT_PORT = 8787;
/** Matches ATTEMPT_TTL_SECONDS in flow.ts — no point waiting longer than the attempt lives. */
const MAX_WAIT_MS = 10 * 60 * 1000;

function loadRepoEnv(): void {
  const envPath = join(findWorkspaceRoot(), '.env');
  if (existsSync(envPath)) process.loadEnvFile(envPath); // never overrides an already-set variable
}

function fail(code: number, lines: string[]): never {
  for (const l of lines) console.error(l);
  process.exit(code);
}

function parseArgs(argv: string[]): { proposalHash: Hash32; reason: string } {
  let proposalHash = ('0x' + '00'.repeat(31) + '01') as Hash32; // an arbitrary, syntactically valid placeholder
  let reason = 'confirm purchase of 2 tickets, $90.00, non-refundable';
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--proposal-hash') {
      const next = argv[i + 1];
      if (!next || !/^0x[0-9a-fA-F]{64}$/.test(next)) {
        fail(2, ['--proposal-hash needs a 0x + 64 hex char value']);
      }
      proposalHash = next as Hash32;
      i += 1;
    } else if (a === '--reason') {
      const next = argv[i + 1];
      if (!next) fail(2, ['--reason needs a value']);
      reason = next as string;
      i += 1;
    }
  }
  return { proposalHash, reason };
}

async function main(): Promise<void> {
  loadRepoEnv();

  // Fail loudly, before touching the network or opening a socket, if credentials are
  // missing — this is the "run it once now, without credentials" check.
  try {
    readWorldClientConfig();
  } catch (error) {
    if (error instanceof WorldConfigError) {
      fail(1, [
        'World sandbox client is not configured. Missing environment variable(s):',
        ...error.missing.map((name) => `  - ${name}`),
        '',
        `Set ${WORLD_ENV.clientId}, ${WORLD_ENV.clientSecret}, ${WORLD_ENV.redirectUri} in the repo-root .env ` +
          `(never committed) and re-run. ${WORLD_ENV.authMethod} is optional (defaults to client_secret_basic).`,
        'See this file\'s header comment for the portal registration and tunnel steps.',
      ]);
    }
    throw error;
  }

  const port = Number(process.env['WORLD_LOCAL_CALLBACK_PORT'] ?? DEFAULT_PORT);
  const { proposalHash, reason } = parseArgs(process.argv.slice(2));

  console.log('Fetching the live World sandbox discovery document...');
  const discovery = await discover();
  console.log(`  issuer: ${discovery.issuer}`);
  console.log(`  authorization_endpoint: ${discovery.authorization_endpoint}`);
  console.log(`  token_endpoint: ${discovery.token_endpoint}`);
  console.log(`  jwks_uri: ${discovery.jwks_uri}`);

  const { authUrl, state } = await initiateStepUp({ proposalHash, reason });
  console.log('\nStep-up initiated. Open this URL in a browser with the sandbox World ID app ready:\n');
  console.log(`  ${authUrl}\n`);
  console.log(`(state=${state}, proposalHash=${proposalHash})`);
  console.log(`\nListening on http://localhost:${port} for the redirect (waiting up to ${MAX_WAIT_MS / 60_000} minutes)...`);
  console.log('Make sure your HTTPS tunnel is pointed at this port and WORLD_REDIRECT_URI matches it exactly.\n');

  await new Promise<void>((resolve) => {
    let settled = false;
    const server = createServer((req, res) => {
      if (settled) {
        res.writeHead(503).end();
        return;
      }
      const url = new URL(req.url ?? '/', `http://localhost:${port}`);
      const params = parseCallback(url.searchParams);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<html><body>Received. You can close this window.</body></html>');

      settled = true;
      void (async () => {
        try {
          const result = await handleCallback(params.code ?? '', params.state ?? '');
          console.log('\nhandleCallback result:');
          console.log(JSON.stringify(result, null, 2));
        } catch (error) {
          console.error('\nhandleCallback threw (this is a real failure, not a denied/expired result):');
          console.error(error);
          process.exitCode = 1;
        } finally {
          server.close(() => resolve());
        }
      })();
    });
    server.on('error', (error) => {
      console.error(`Could not listen on port ${port}: ${String(error)}`);
      process.exitCode = 1;
      resolve();
    });
    server.listen(port);

    const timer = setTimeout(() => {
      if (settled) return;
      console.error(`\nNo callback arrived within ${MAX_WAIT_MS / 60_000} minutes. Closing the listener.`);
      process.exitCode = 1;
      server.close(() => resolve());
    }, MAX_WAIT_MS);
    server.on('close', () => clearTimeout(timer));

    process.once('SIGINT', () => {
      console.error('\nInterrupted. Closing the listener.');
      server.close(() => resolve());
    });
  });

  console.log('\nDone. The local listener is closed; no server is left running.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
