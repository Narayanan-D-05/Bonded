/**
 * The AP agent's LATEST verdict per invoice, so the Invoice Inbox can show "Refused" or
 * "Held" for an invoice the agent has already reviewed, instead of "Awaiting agent".
 *
 * Written by `proposePayment` (the agent's action) every time it runs; read by the inbox. It is
 * display state only: it never decides anything, and the settlement ledger stays the only
 * record of what was paid. Stored at `<workspace>/.data/console/verdicts.json` next to the
 * ledger (`.data/` is gitignored). `demo:reset` archives it with the rest of the demo state.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defaultLedgerPath } from './settlement-ledger';

export interface VerdictLogEntry {
  invoiceId: string;
  proposalHash: string;
  outcomeLabel: 'CLEARED' | 'REFUSED' | 'HELD_FOR_STEPUP';
  reasonCodeLabel: string;
  reviewedAtMs: number;
}

export function defaultVerdictLogPath(from: string = process.cwd()): string {
  return path.join(path.dirname(defaultLedgerPath(from)), 'verdicts.json');
}

export async function readVerdictLog(file: string = defaultVerdictLogPath()): Promise<Record<string, VerdictLogEntry>> {
  if (!existsSync(file)) return {};
  const parsed = JSON.parse(await readFile(file, 'utf8')) as { version?: number; latest?: Record<string, VerdictLogEntry> };
  return parsed.latest ?? {};
}

/** Replaces the invoice's latest verdict. Written atomically (temp file, then rename). */
export async function recordVerdict(entry: VerdictLogEntry, file: string = defaultVerdictLogPath()): Promise<void> {
  const latest = await readVerdictLog(file);
  latest[entry.invoiceId] = entry;
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify({ version: 1, latest }, null, 2));
  await rename(tmp, file);
}
