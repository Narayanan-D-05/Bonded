/**
 * Vendor-master bank-detail changes: an append-only change log, and the
 * overlay that applies it on top of the seeded fixture.
 *
 * ── DISCLOSURE (same as vendor-fixture.ts) ─────────────────────────────────
 * This is part of the disclosed, controlled stand-in for a vendor master. It
 * is NOT a real ERP. In a real AP department, a changed bank detail only
 * becomes truth after a verified person updates the vendor record; in SAP or
 * NetSuite that is a change document written under that person's login. Here
 * that record is a JSON file we run ourselves:
 * `<workspace>/.data/vendor-master-changes.json` (gitignored: `.data/`).
 * With `VENDOR_MASTER_SOURCE=xero` the change goes to the real Xero contact
 * instead (see `sources/bank-change.ts`), and this log only keeps the audit
 * entry; it is not overlaid.
 *
 * Rules this file enforces:
 *  - Append-only. Entries are never edited or removed. A corrupt or
 *    unrecognised file throws; it is never reset (resetting would erase who
 *    approved what).
 *  - Every entry carries the approving human's World `sub` and `authTimeMs`,
 *    the `proposalHash` the approval was for, and when it was recorded.
 *  - Compare-and-set: an append must name the payout address it replaces,
 *    and that must equal the current (overlaid) truth, checked under the
 *    file lock. Two approvals racing on one vendor can't both land.
 *  - The overlay is explicit and opt-in: `fetchVendorTruth` is unchanged.
 *    Callers ask for `createFixtureVendorSourceWithChanges(path)`, or pass
 *    `changeLogPath` to `createVendorSource`.
 */

import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { fetchVendorTruth, type VendorTruth } from './vendor-fixture.js';

export const VENDOR_MASTER_CHANGELOG_ENV = 'BONDED_VENDOR_MASTER_CHANGELOG';

/** Where a change was applied. Only `fixture-overlay` entries are overlaid on the fixture. */
export type VendorMasterChangeTarget = 'fixture-overlay' | 'xero';

export interface VendorMasterChange {
  vendorId: string;
  field: 'payoutAddress';
  previousPayoutAddress: `0x${string}`;
  newPayoutAddress: `0x${string}`;
  appliedTo: VendorMasterChangeTarget;
  /** The World-verified human who confirmed the change. */
  approvedBy: { worldSub: string; authTimeMs: number };
  /** The held proposal whose step-up approval authorised this change. */
  proposalHash: `0x${string}`;
  /** Unix milliseconds, our clock. Becomes `payoutAddressLastChangedAt` (in seconds). */
  recordedAtMs: number;
}

interface ChangeLogFile {
  version: 1;
  entries: VendorMasterChange[];
}

export class VendorMasterChangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VendorMasterChangeError';
  }
}

const SUI_ADDRESS = /^0x[0-9a-f]{64}$/;
const HASH32 = /^0x[0-9a-fA-F]{64}$/;

/** `BONDED_VENDOR_MASTER_CHANGELOG` if set, else `<workspace root>/.data/vendor-master-changes.json`. */
export function defaultVendorMasterChangeLogPath(env: NodeJS.ProcessEnv = process.env, from: string = process.cwd()): string {
  const override = env[VENDOR_MASTER_CHANGELOG_ENV]?.trim();
  if (override) return path.resolve(override);
  let dir = path.resolve(from);
  for (;;) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return path.join(dir, '.data', 'vendor-master-changes.json');
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new VendorMasterChangeError(
        `Could not find the workspace root (pnpm-workspace.yaml) above ${from}. Set ${VENDOR_MASTER_CHANGELOG_ENV} to an explicit path.`,
      );
    }
    dir = parent;
  }
}

/** Throws naming the first bad field. Never coerces. */
export function assertVendorMasterChange(value: unknown): asserts value is VendorMasterChange {
  const bad = (msg: string): never => {
    throw new VendorMasterChangeError(`Invalid vendor-master change entry: ${msg}`);
  };
  if (value === null || typeof value !== 'object') bad('not an object');
  const c = value as Record<string, unknown>;
  if (typeof c.vendorId !== 'string' || c.vendorId === '') bad('vendorId');
  if (c.field !== 'payoutAddress') bad('field must be "payoutAddress"');
  if (typeof c.previousPayoutAddress !== 'string' || !SUI_ADDRESS.test(c.previousPayoutAddress)) bad('previousPayoutAddress');
  if (typeof c.newPayoutAddress !== 'string' || !SUI_ADDRESS.test(c.newPayoutAddress)) bad('newPayoutAddress');
  if (c.appliedTo !== 'fixture-overlay' && c.appliedTo !== 'xero') bad('appliedTo');
  const by = c.approvedBy as Record<string, unknown> | undefined;
  if (by === undefined || by === null || typeof by !== 'object') bad('approvedBy');
  if (typeof by!.worldSub !== 'string' || by!.worldSub === '') bad('approvedBy.worldSub');
  if (typeof by!.authTimeMs !== 'number' || !Number.isSafeInteger(by!.authTimeMs)) bad('approvedBy.authTimeMs');
  if (typeof c.proposalHash !== 'string' || !HASH32.test(c.proposalHash)) bad('proposalHash');
  if (typeof c.recordedAtMs !== 'number' || !Number.isSafeInteger(c.recordedAtMs) || c.recordedAtMs <= 0) bad('recordedAtMs');
}

/** All entries, oldest first. A missing file is an empty log; a malformed one throws. */
export async function readVendorMasterChanges(filePath: string): Promise<VendorMasterChange[]> {
  let text: string;
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new VendorMasterChangeError(`Vendor-master change log ${filePath} is not valid JSON; refusing to use or overwrite it.`);
  }
  const file = parsed as Partial<ChangeLogFile>;
  if (file.version !== 1 || !Array.isArray(file.entries)) {
    throw new VendorMasterChangeError(`Vendor-master change log ${filePath} has an unrecognised shape; refusing to use or overwrite it.`);
  }
  for (const entry of file.entries) assertVendorMasterChange(entry);
  return file.entries as VendorMasterChange[];
}

/**
 * Pure: `truth` with every `fixture-overlay` change for its vendor applied,
 * in log order. `xero` entries are audit-only here and never overlaid.
 */
export function applyVendorMasterChanges(truth: VendorTruth, changes: readonly VendorMasterChange[]): VendorTruth {
  let out = truth;
  for (const change of changes) {
    if (change.vendorId !== truth.vendorId || change.appliedTo !== 'fixture-overlay') continue;
    out = {
      ...out,
      payoutAddress: change.newPayoutAddress,
      payoutAddressLastChangedAt: Math.floor(change.recordedAtMs / 1000),
    };
  }
  return out;
}

/**
 * The fixture source with the change log overlaid. Reads the log on every
 * lookup (no cache), so an approved change is visible to the very next
 * `enforce()` and `deriveVendorRecipient()`.
 */
export function createFixtureVendorSourceWithChanges(
  changeLogPath: string,
  base: (vendorId: string) => Promise<VendorTruth | null> = fetchVendorTruth,
): (vendorId: string) => Promise<VendorTruth | null> {
  return async (vendorId: string) => {
    const truth = await base(vendorId);
    if (truth === null) return null;
    return applyVendorMasterChanges(truth, await readVendorMasterChanges(changeLogPath));
  };
}

const LOCK_STALE_MS = 10_000;
const LOCK_WAIT_MS = 5_000;

async function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = `${filePath}.lock`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
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
      if (Date.now() - started > LOCK_WAIT_MS) throw new VendorMasterChangeError(`Timed out waiting for lock ${lockPath}`);
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  try {
    return await fn();
  } finally {
    await fs.rm(lockPath, { force: true });
  }
}

async function writeAtomic(filePath: string, file: ChangeLogFile): Promise<void> {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(file, null, 2), 'utf8');
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.rename(tmp, filePath);
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

/**
 * Appends one change, under the file lock. For a `fixture-overlay` entry,
 * `previousPayoutAddress` must equal the vendor's current overlaid payout
 * address (compare-and-set) and differ from `newPayoutAddress`; otherwise
 * this throws and nothing is written. `base` is the un-overlaid fixture
 * lookup (default `fetchVendorTruth`).
 */
export async function appendVendorMasterChange(
  changeLogPath: string,
  change: VendorMasterChange,
  base: (vendorId: string) => Promise<VendorTruth | null> = fetchVendorTruth,
): Promise<VendorMasterChange> {
  assertVendorMasterChange(change);
  if (change.previousPayoutAddress === change.newPayoutAddress) {
    throw new VendorMasterChangeError(`New payout address for ${change.vendorId} equals the current one; nothing to change.`);
  }
  return withFileLock(changeLogPath, async () => {
    const entries = await readVendorMasterChanges(changeLogPath);
    if (change.appliedTo === 'fixture-overlay') {
      const seeded = await base(change.vendorId);
      if (seeded === null) throw new VendorMasterChangeError(`Vendor ${change.vendorId} is not in the vendor master.`);
      const current = applyVendorMasterChanges(seeded, entries);
      if (current.payoutAddress !== change.previousPayoutAddress) {
        throw new VendorMasterChangeError(
          `Vendor ${change.vendorId}'s payout address on file is ${current.payoutAddress}, not ${change.previousPayoutAddress}; ` +
            'it changed since this approval was requested. Refusing to overwrite it.',
        );
      }
    }
    const frozen = Object.freeze({ ...change, approvedBy: Object.freeze({ ...change.approvedBy }) });
    await writeAtomic(changeLogPath, { version: 1, entries: [...entries, frozen] });
    return frozen;
  });
}
