/**
 * Settle-once ledger, keyed by `proposalHash`.
 *
 * The on-chain `Verdict` is deleted when it settles, so one verdict can never
 * be replayed. But nothing on-chain stops the enforcer minting a FRESH verdict
 * for a proposal it already paid. This ledger is that guard, for the console:
 * the same proposal settles at most once, and a repeat returns the recorded
 * digest instead of paying again.
 *
 * Stored at `<workspace>/.data/console/settlements.json` (`.data/` is
 * gitignored). Entry states:
 *  - `pending`: a settlement is being submitted. A second request in this
 *    process awaits the same in-flight promise; one from another process sees
 *    `in-progress`.
 *  - `settled`: confirmed on-chain (digest read back by `@bonded/sui-settlement`).
 *  - `unknown`: the settlement call failed at a point where a transaction may
 *    already have been submitted. It is never retried automatically, because
 *    a retry could pay twice. Someone checks the digest/explorer and clears
 *    the entry by hand.
 * A failure that provably happened before anything was submitted (config,
 * recipient derivation, argument or step-up refusal, a failed dry run)
 * removes the pending entry, so the proposal can be retried.
 *
 * A corrupt file throws and is never reset (resetting would forget payments).
 */

import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import type { Hash32 } from '@bonded/seam';

export interface SettledRecord {
  digest: string;
  explorerUrl: string;
  vendorId: string;
  recipient: string;
  /** 6-decimal base units, as a decimal string (JSON has no bigint). */
  valueUsdc: string;
  viaStepup: boolean;
  settledAtMs: number;
}

export type LedgerEntry =
  | { status: 'pending'; proposalHash: Hash32; invoiceId: string; startedAtMs: number }
  | ({ status: 'settled'; proposalHash: Hash32; invoiceId: string; startedAtMs: number } & SettledRecord)
  | { status: 'unknown'; proposalHash: Hash32; invoiceId: string; startedAtMs: number; error: string };

interface LedgerFile {
  version: 1;
  entries: Record<string, LedgerEntry>;
}

export type RunOnceResult =
  | { kind: 'settled-now'; entry: Extract<LedgerEntry, { status: 'settled' }> }
  | { kind: 'already-settled'; entry: Extract<LedgerEntry, { status: 'settled' }> }
  | { kind: 'in-progress'; entry: Extract<LedgerEntry, { status: 'pending' }> }
  | { kind: 'unknown'; entry: Extract<LedgerEntry, { status: 'unknown' }> };

export class SettlementLedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettlementLedgerError';
  }
}

/** Error names from `@bonded/sui-settlement` that are thrown before anything is submitted. */
const PRE_SUBMISSION_ERRORS = new Set(['SettlementConfigError', 'RecipientDerivationError', 'PtbArgumentError', 'StepUpRefusedError']);

/** True only when the error provably happened before a transaction could have been submitted. */
export function isPreSubmissionFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (PRE_SUBMISSION_ERRORS.has(error.name)) return true;
  if (error.name === 'SuiCliError') {
    return /^Dry run did not succeed; nothing was submitted/.test(error.message) || /^Sui CLI active env is/.test(error.message);
  }
  return false;
}

export function defaultLedgerPath(from: string = process.cwd()): string {
  const override = process.env['BONDED_SETTLEMENT_LEDGER']?.trim();
  if (override) return path.resolve(override);
  let dir = path.resolve(from);
  for (;;) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return path.join(dir, '.data', 'console', 'settlements.json');
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new SettlementLedgerError(`Could not find the workspace root above ${from}. Set BONDED_SETTLEMENT_LEDGER.`);
    }
    dir = parent;
  }
}

const LOCK_STALE_MS = 10_000;
const LOCK_WAIT_MS = 5_000;

export class SettlementLedger {
  private readonly inflight = new Map<string, Promise<RunOnceResult>>();

  constructor(
    readonly filePath: string = defaultLedgerPath(),
    private readonly now: () => number = Date.now,
  ) {}

  private async load(): Promise<LedgerFile> {
    let text: string;
    try {
      text = await fs.readFile(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, entries: {} };
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new SettlementLedgerError(`Settlement ledger ${this.filePath} is not valid JSON; refusing to use or overwrite it.`);
    }
    const file = parsed as Partial<LedgerFile>;
    if (file.version !== 1 || file.entries === null || typeof file.entries !== 'object') {
      throw new SettlementLedgerError(`Settlement ledger ${this.filePath} has an unrecognised shape; refusing to use or overwrite it.`);
    }
    return file as LedgerFile;
  }

  private async save(file: LedgerFile): Promise<void> {
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(file, null, 2), 'utf8');
    for (let attempt = 0; ; attempt += 1) {
      try {
        await fs.rename(tmp, this.filePath);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if ((code === 'EPERM' || code === 'EACCES' || code === 'EBUSY') && attempt < 20) {
          await new Promise((r) => setTimeout(r, 25));
          continue;
        }
        await fs.rm(tmp, { force: true });
        throw error;
      }
    }
  }

  private async locked<T>(fn: (file: LedgerFile) => T | Promise<T>, write: boolean): Promise<T> {
    const lockPath = `${this.filePath}.lock`;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const started = Date.now();
    for (;;) {
      try {
        const handle = await fs.open(lockPath, 'wx');
        await handle.close();
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        try {
          const st = await fs.stat(lockPath);
          if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
            await fs.rm(lockPath, { force: true });
            continue;
          }
        } catch {
          continue;
        }
        if (Date.now() - started > LOCK_WAIT_MS) throw new SettlementLedgerError(`Timed out waiting for lock ${lockPath}`);
        await new Promise((r) => setTimeout(r, 25));
      }
    }
    try {
      const file = await this.load();
      const out = await fn(file);
      if (write) await this.save(file);
      return out;
    } finally {
      await fs.rm(lockPath, { force: true });
    }
  }

  async get(proposalHash: Hash32): Promise<LedgerEntry | null> {
    const file = await this.load();
    return file.entries[proposalHash.toLowerCase()] ?? null;
  }

  /**
   * Runs `settle` at most once for `proposalHash`. A proposal already in the
   * ledger is never settled again: its recorded state is returned instead.
   * Errors from `settle` are re-thrown after the entry is either removed
   * (pre-submission failure) or marked `unknown`.
   */
  runOnce(proposalHash: Hash32, invoiceId: string, settle: () => Promise<SettledRecord>): Promise<RunOnceResult> {
    const key = proposalHash.toLowerCase();
    const existing = this.inflight.get(key);
    if (existing !== undefined) {
      return existing.then((r) => (r.kind === 'settled-now' ? { kind: 'already-settled', entry: r.entry } : r));
    }
    const run = this.runOnceUncached(key as Hash32, invoiceId, settle).finally(() => this.inflight.delete(key));
    this.inflight.set(key, run);
    return run;
  }

  private async runOnceUncached(key: Hash32, invoiceId: string, settle: () => Promise<SettledRecord>): Promise<RunOnceResult> {
    const startedAtMs = this.now();
    const prior = await this.locked((file): RunOnceResult | null => {
      const entry = file.entries[key];
      if (entry === undefined) {
        file.entries[key] = { status: 'pending', proposalHash: key, invoiceId, startedAtMs };
        return null;
      }
      if (entry.status === 'settled') return { kind: 'already-settled', entry };
      if (entry.status === 'pending') return { kind: 'in-progress', entry };
      return { kind: 'unknown', entry };
    }, true);
    if (prior !== null) return prior;

    let record: SettledRecord;
    try {
      record = await settle();
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      await this.locked((file) => {
        if (isPreSubmissionFailure(error)) {
          delete file.entries[key];
        } else {
          file.entries[key] = { status: 'unknown', proposalHash: key, invoiceId, startedAtMs, error: message };
        }
      }, true);
      throw error;
    }
    const entry = { status: 'settled' as const, proposalHash: key, invoiceId, startedAtMs, ...record };
    await this.locked((file) => {
      file.entries[key] = entry;
    }, true);
    return { kind: 'settled-now', entry };
  }
}
