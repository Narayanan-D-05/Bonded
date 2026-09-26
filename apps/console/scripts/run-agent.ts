/**
 * The AP agent's run over the whole Invoice Inbox: it proposes payment for every invoice through
 * the SAME `proposePayment` the console uses (real enforce(), live Intercepta screen, on-chain
 * policy hash and budget), so:
 *  - CLEARED invoices are paid on Sui automatically (once; the ledger makes repeats a no-op),
 *  - REFUSED invoices pay nothing and show their reason in the inbox,
 *  - HELD invoices wait in the inbox for a verified human (World ID step-up), the only thing a
 *    person has to look at.
 * No human approval happens here (CLAUDE.md rule 4): held invoices are left held.
 *
 *   pnpm --filter @bonded/console demo:agent
 *
 * `demo:reset` runs this automatically at the end. Keys come from the repo-root .env and
 * apps/console/.env.local (neither ever printed); Sui signing uses the Sui CLI keystore.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONSOLE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(CONSOLE_DIR, '..', '..');

/** Loads apps/console/.env.local first, then the repo-root .env. Never overrides a set variable. */
export function loadAgentEnv(): void {
  for (const f of [join(CONSOLE_DIR, '.env.local'), join(REPO_ROOT, '.env')]) {
    if (existsSync(f)) process.loadEnvFile(f);
  }
}

export interface AgentRunLine {
  invoiceId: string;
  outcome: string;
  reason: string;
  detail: string;
}

/** Proposes payment for every demo invoice, one after another, and reports each outcome. */
export async function runAgentOverInbox(log: (line: string) => void = console.log): Promise<AgentRunLine[]> {
  // Imported after the env is loaded: the console context reads process.env when first built.
  const { DEMO_INVOICE_IDS, defaultConsoleContext } = await import('../lib/enforce-deps');
  const { proposePayment } = await import('../lib/payment');
  const ctx = defaultConsoleContext();
  const lines: AgentRunLine[] = [];
  for (const invoiceId of DEMO_INVOICE_IDS) {
    try {
      const r = await proposePayment(invoiceId, ctx);
      const s = r.settlement;
      const detail =
        s.status === 'settled'
          ? `${s.alreadySettled ? 'already paid' : 'PAID'} ${s.explorerUrl}`
          : s.status === 'not-settled'
            ? s.reason
            : s.status === 'in-progress'
              ? 'settlement in progress'
              : `${s.status}: ${s.error}`;
      const extra = r.screeningErrors.length > 0 ? ` (screening: ${r.screeningErrors.map((e) => e.errorName).join(', ')})` : '';
      const line = { invoiceId, outcome: r.verdict.outcomeLabel, reason: r.verdict.reasonCodeLabel, detail: detail + extra };
      lines.push(line);
      log(`  ${invoiceId.padEnd(24)} ${line.outcome.padEnd(16)} ${line.reason.padEnd(26)} ${line.detail}`);
    } catch (err) {
      const line = { invoiceId, outcome: 'ERROR', reason: '', detail: err instanceof Error ? err.message : String(err) };
      lines.push(line);
      log(`  ${invoiceId.padEnd(24)} ERROR            ${line.detail}`);
    }
  }
  return lines;
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  loadAgentEnv();
  console.log('AP agent: reviewing every invoice in the inbox');
  runAgentOverInbox()
    .then((lines) => {
      const held = lines.filter((l) => l.outcome === 'HELD_FOR_STEPUP').length;
      console.log(`\nDone. ${held} invoice(s) held for a verified human: open them from the Invoice Inbox.`);
      if (lines.some((l) => l.outcome === 'ERROR')) process.exitCode = 1;
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exitCode = 1;
    });
}
