/**
 * The only place this package signs anything. It does that by shelling out
 * to the Sui CLI, which signs with its own keystore
 * (~/.sui/sui_config/sui.keystore, outside the repo). CLAUDE.md rule 3: no key
 * bytes ever pass through TypeScript. This file never reads, copies, or
 * prints the keystore, and nothing here goes in `.env`.
 *
 * `execFile` with an argument array, never a shell string. No argument is
 * ever parsed by a shell.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SettlementConfig } from './config.js';
import { toDryRunArgs } from './ptb.js';

const execFileAsync = promisify(execFile);

export class SuiCliError extends Error {
  constructor(
    message: string,
    readonly output?: string,
  ) {
    super(message);
    this.name = 'SuiCliError';
  }
}

/** Only the parts of `sui client ptb --json` output this package reads. */
export interface PtbJsonOutput {
  digest: string;
  effects: {
    status: { status: string; error?: string };
    gasUsed: { computationCost: string; storageCost: string; storageRebate: string; nonRefundableStorageFee?: string };
  };
}

async function runSui(config: SettlementConfig, args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync(config.suiBin, args, { maxBuffer: 32 * 1024 * 1024, windowsHide: true });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string; code?: unknown };
    throw new SuiCliError(
      `sui ${args.slice(0, 2).join(' ')} failed (exit ${String(e.code)}): ${e.message ?? 'unknown error'}`,
      `${e.stdout ?? ''}\n${e.stderr ?? ''}`,
    );
  }
}

/**
 * Refuses to submit unless the CLI's active environment is `testnet`. The
 * CLI, not this package, decides which network it signs for, so this is
 * checked against the CLI itself before every submission.
 */
export async function assertCliOnTestnet(config: SettlementConfig): Promise<void> {
  const { stdout } = await runSui(config, ['client', 'active-env']);
  const env = stdout.trim().split(/\r?\n/).pop()?.trim();
  if (env !== 'testnet') {
    throw new SuiCliError(`Sui CLI active env is "${env ?? ''}", not "testnet". @bonded/sui-settlement only submits to testnet.`);
  }
}

/**
 * Dry-runs the PTB (free), then executes it for real if the dry run
 * succeeded. Returns the parsed `--json` output of the real execution.
 * Throws with the CLI's own output on a failed dry run, and with the digest
 * on a transaction that executed but failed on-chain.
 */
export async function executePtb(config: SettlementConfig, args: string[]): Promise<PtbJsonOutput> {
  await assertCliOnTestnet(config);

  const dry = await runSui(config, toDryRunArgs(args));
  const dryText = `${dry.stdout}\n${dry.stderr}`;
  if (!/Dry run completed, execution status: success/.test(dryText)) {
    const statusLine = dryText.split(/\r?\n/).find((l) => /execution status|MoveAbort|Error/i.test(l)) ?? 'no status line';
    throw new SuiCliError(`Dry run did not succeed; nothing was submitted. ${statusLine.trim()}`, dryText);
  }

  const { stdout } = await runSui(config, args);
  const start = stdout.indexOf('{');
  if (start < 0) {
    throw new SuiCliError('sui client ptb --json produced no JSON object on stdout.', stdout);
  }
  let parsed: PtbJsonOutput;
  try {
    parsed = JSON.parse(stdout.slice(start)) as PtbJsonOutput;
  } catch {
    throw new SuiCliError('Could not parse sui client ptb --json output.', stdout);
  }
  if (typeof parsed.digest !== 'string' || parsed.effects?.status?.status === undefined) {
    throw new SuiCliError('sui client ptb --json output is missing digest/effects.status.', stdout);
  }
  if (parsed.effects.status.status !== 'success') {
    throw new SuiCliError(
      `Transaction ${parsed.digest} executed but failed on-chain: ${parsed.effects.status.error ?? parsed.effects.status.status}`,
      stdout,
    );
  }
  return parsed;
}
