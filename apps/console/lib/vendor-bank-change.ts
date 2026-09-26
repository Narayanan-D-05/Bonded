/**
 * The VENDOR side of a bank-detail change: a vendor's request to change its payout address is only
 * on file if the person who submitted it verified with World ID through IDKit, and the AP
 * controller's step-up for a PREMISE_HELD_FOR_REVIEW payout change may only succeed when such a
 * request matches the invoice's claim (`payment.ts`).
 *
 * Two World products, two different people, two different jobs:
 *  - the vendor's representative proves who they are with IDKit (this file, `idkit.ts`, the
 *    `/vendor/bank-change` page);
 *  - the payer's controller freshly approves the payment with World ID for Agents (`/stepup`).
 *
 * === The signal ===
 * `buildVendorBankChangeSignal` binds vendorId + new Sui payout address + new EVM identity into
 * the proof's `signal` ("Binds app context into the proof ... Your backend should enforce the same
 * value": https://docs.world.org/world-id/idkit/credentials, "Common parameters"). The server
 * rebuilds the signal from the submitted fields and checks every response item's `signal_hash`
 * against `hashSignal(signal)` (`@worldcoin/idkit-core/hashing`, the SDK's own keccak-based
 * hash-to-field) before it forwards anything to World. A proof made for one address therefore
 * cannot be replayed for another.
 *
 * === The record ===
 * Append-only JSON at `<workspace>/.data/vendor-bank-change-requests.json` (`.data/` is
 * gitignored, repo .gitignore). A record is written ONLY after World's
 * `POST /api/v4/verify/{rp_id}` answered success; every failure path writes nothing
 * (`idkit.ts#submitVendorBankChange`). A corrupt file throws and is never reset.
 *
 * === Nullifiers and repeat requests ===
 * "The same person verifying the same action always produces the same nullifier"
 * (https://docs.world.org/world-id/idkit/integrate, Step 6). The docs' default is to reject a
 * reused (action, nullifier). That pattern fits one-per-human claims (airdrops, votes); it does
 * NOT fit this trust moment, because a vendor's representative may legitimately change banks
 * twice under the same action. So the store rejects a replay of the SAME request (same action,
 * nullifier AND signal hash), and keeps the nullifier as a stable pseudonym of the verified person
 * (shown to the AP controller). Whether World itself lets one person verify the same action twice
 * is a per-action Developer Portal setting ("max verifications"; `max_verifications_reached` in
 * https://docs.world.org/world-id/idkit/error-codes). If it is limited to one, the second request
 * fails visibly at World and nothing is recorded. See README "World — IDKit".
 *
 * === What the record does NOT prove ===
 * That the verified person works for the vendor. IDKit proves a unique, document-holding human
 * bound to this exact request; binding that person's nullifier to the vendor at onboarding is not
 * built (docs/THREATMODEL.md). The AP controller still calls the vendor on the number on file.
 */

import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';

// ─── Signal ────────────────────────────────────────────────────────────────

export const VENDOR_BANK_CHANGE_SIGNAL_PREFIX = 'bonded-vendor-bank-change:v1';

const VENDOR_ID = /^vnd-[a-z0-9-]{1,64}$/;
const SUI_ADDRESS = /^0x[0-9a-f]{64}$/;
const EVM_ADDRESS = /^0x[0-9a-f]{40}$/;

export interface VendorBankChangeClaim {
  vendorId: string;
  /** The new Sui payout address, 0x + 64 hex. */
  newPayoutAddress: string;
  /** The vendor's EVM identity for the new details, 0x + 40 hex (screened by Intercepta on the invoice). */
  newEvmAddress: string;
}

export class VendorBankChangeInputError extends Error {
  constructor(
    readonly field: keyof VendorBankChangeClaim,
    message: string,
  ) {
    super(message);
    this.name = 'VendorBankChangeInputError';
  }
}

/** Lower-cases and validates the three fields. Throws `VendorBankChangeInputError` naming the bad field. */
export function normalizeVendorBankChangeClaim(input: Partial<Record<keyof VendorBankChangeClaim, unknown>>): VendorBankChangeClaim {
  const str = (field: keyof VendorBankChangeClaim): string => {
    const v = input[field];
    if (typeof v !== 'string') throw new VendorBankChangeInputError(field, `${field} is required.`);
    return v.trim().toLowerCase();
  };
  const vendorId = str('vendorId');
  const newPayoutAddress = str('newPayoutAddress');
  const newEvmAddress = str('newEvmAddress');
  if (!VENDOR_ID.test(vendorId)) throw new VendorBankChangeInputError('vendorId', 'vendorId must look like vnd-<name>.');
  if (!SUI_ADDRESS.test(newPayoutAddress)) {
    throw new VendorBankChangeInputError('newPayoutAddress', 'newPayoutAddress must be a Sui address: 0x followed by 64 hex characters.');
  }
  if (!EVM_ADDRESS.test(newEvmAddress)) {
    throw new VendorBankChangeInputError('newEvmAddress', 'newEvmAddress must be an EVM address: 0x followed by 40 hex characters.');
  }
  return { vendorId, newPayoutAddress, newEvmAddress };
}

/**
 * The IDKit `signal` for one request. Starts with a non-hex prefix on purpose: `hashSignal` treats a
 * string that starts with "0x" and is valid hex as raw bytes, so this is always hashed as UTF-8 text.
 */
export function buildVendorBankChangeSignal(claim: VendorBankChangeClaim): string {
  const c = normalizeVendorBankChangeClaim(claim);
  return `${VENDOR_BANK_CHANGE_SIGNAL_PREFIX}|${c.vendorId}|${c.newPayoutAddress}|${c.newEvmAddress}`;
}

/** Compares two 0x field-element hex strings numerically (World returns e.g. "0x0" unpadded). */
export function sameFieldElement(a: string, b: string): boolean {
  try {
    return BigInt(a) === BigInt(b);
  } catch {
    return false;
  }
}

// ─── Record ────────────────────────────────────────────────────────────────

export interface VerifiedVendorBankChangeRequest {
  vendorId: string;
  newPayoutAddress: string;
  newEvmAddress: string;
  /** The exact signal string the proof was bound to, and its hash as the proof carried it. */
  signal: string;
  signalHash: string;
  /** The IDKit action and environment the proof was made for. */
  action: string;
  environment: string;
  /** "3.0" (legacy fallback) or "4.0". */
  protocolVersion: string;
  /** The response item's `identifier` World verified, e.g. "passport" (4.0) or "document" (3.0 fallback). */
  credentialType: string;
  /** 4.0 only: the credential's issuer schema id (9303 = NFC passport). null for 3.0 proofs. */
  issuerSchemaId: number | null;
  /** The nullifier as a DECIMAL string (docs: store as a number, not hex, to avoid casing issues). */
  nullifier: string;
  /** Our clock, when World's verify endpoint answered success. */
  verifiedAtMs: number;
}

interface RequestFile {
  version: 1;
  entries: VerifiedVendorBankChangeRequest[];
}

export class VendorRequestStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VendorRequestStoreError';
  }
}

export class DuplicateVendorRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DuplicateVendorRequestError';
  }
}

export function assertVerifiedVendorBankChangeRequest(value: unknown): asserts value is VerifiedVendorBankChangeRequest {
  const bad = (msg: string): never => {
    throw new VendorRequestStoreError(`Invalid vendor bank-change request entry: ${msg}`);
  };
  if (value === null || typeof value !== 'object') bad('not an object');
  const r = value as Record<string, unknown>;
  if (typeof r.vendorId !== 'string' || !VENDOR_ID.test(r.vendorId)) bad('vendorId');
  if (typeof r.newPayoutAddress !== 'string' || !SUI_ADDRESS.test(r.newPayoutAddress)) bad('newPayoutAddress');
  if (typeof r.newEvmAddress !== 'string' || !EVM_ADDRESS.test(r.newEvmAddress)) bad('newEvmAddress');
  if (typeof r.signal !== 'string' || r.signal !== `${VENDOR_BANK_CHANGE_SIGNAL_PREFIX}|${r.vendorId}|${r.newPayoutAddress}|${r.newEvmAddress}`) {
    bad('signal does not bind this vendorId and these addresses');
  }
  if (typeof r.signalHash !== 'string' || !/^0x[0-9a-fA-F]+$/.test(r.signalHash)) bad('signalHash');
  if (typeof r.action !== 'string' || r.action === '') bad('action');
  if (typeof r.environment !== 'string' || r.environment === '') bad('environment');
  if (r.protocolVersion !== '3.0' && r.protocolVersion !== '4.0') bad('protocolVersion');
  if (typeof r.credentialType !== 'string' || r.credentialType === '') bad('credentialType');
  if (r.issuerSchemaId !== null && (typeof r.issuerSchemaId !== 'number' || !Number.isSafeInteger(r.issuerSchemaId))) bad('issuerSchemaId');
  if (typeof r.nullifier !== 'string' || !/^[0-9]+$/.test(r.nullifier)) bad('nullifier must be a decimal string');
  if (typeof r.verifiedAtMs !== 'number' || !Number.isSafeInteger(r.verifiedAtMs) || r.verifiedAtMs <= 0) bad('verifiedAtMs');
}

/** `<workspace root>/.data/vendor-bank-change-requests.json` (the root holds pnpm-workspace.yaml). */
export function defaultVendorRequestStorePath(from: string = process.cwd()): string {
  let dir = path.resolve(from);
  for (;;) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return path.join(dir, '.data', 'vendor-bank-change-requests.json');
    const parent = path.dirname(dir);
    if (parent === dir) throw new VendorRequestStoreError(`Could not find the workspace root (pnpm-workspace.yaml) above ${from}.`);
    dir = parent;
  }
}

/** All entries, oldest first. A missing file is an empty store; a malformed one throws (never reset). */
export async function readVendorBankChangeRequests(filePath: string): Promise<VerifiedVendorBankChangeRequest[]> {
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
    throw new VendorRequestStoreError(`${filePath} is not valid JSON; refusing to use or overwrite it.`);
  }
  const file = parsed as Partial<RequestFile>;
  if (file.version !== 1 || !Array.isArray(file.entries)) {
    throw new VendorRequestStoreError(`${filePath} has an unrecognised shape; refusing to use or overwrite it.`);
  }
  for (const entry of file.entries) assertVerifiedVendorBankChangeRequest(entry);
  return file.entries as VerifiedVendorBankChangeRequest[];
}

const LOCK_STALE_MS = 10_000;
const LOCK_WAIT_MS = 5_000;

async function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = `${filePath}.lock`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const started = Date.now();
  for (;;) {
    try {
      await (await fs.open(lockPath, 'wx')).close();
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        if (Date.now() - (await fs.stat(lockPath)).mtimeMs > LOCK_STALE_MS) {
          await fs.rm(lockPath, { force: true });
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() - started > LOCK_WAIT_MS) throw new VendorRequestStoreError(`Timed out waiting for lock ${lockPath}`);
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  try {
    return await fn();
  } finally {
    await fs.rm(lockPath, { force: true });
  }
}

async function writeAtomic(filePath: string, file: RequestFile): Promise<void> {
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
 * Appends one verified request under the file lock. Rejects a replay of the same request (same
 * action + nullifier + signal hash) with `DuplicateVendorRequestError`; writes nothing then.
 */
export async function appendVerifiedVendorBankChangeRequest(
  filePath: string,
  request: VerifiedVendorBankChangeRequest,
): Promise<VerifiedVendorBankChangeRequest> {
  assertVerifiedVendorBankChangeRequest(request);
  return withFileLock(filePath, async () => {
    const entries = await readVendorBankChangeRequests(filePath);
    const dup = entries.find(
      (e) => e.action === request.action && e.nullifier === request.nullifier && sameFieldElement(e.signalHash, request.signalHash),
    );
    if (dup !== undefined) {
      throw new DuplicateVendorRequestError(
        `This exact request (${request.vendorId}, same payout address and EVM identity, same verified person) was already recorded at ${new Date(dup.verifiedAtMs).toISOString()}.`,
      );
    }
    const frozen = Object.freeze({ ...request });
    await writeAtomic(filePath, { version: 1, entries: [...entries, frozen] });
    return frozen;
  });
}

/** Read port used by the AP gate; the default is the JSON file above. */
export interface VendorRequestStore {
  list(): Promise<VerifiedVendorBankChangeRequest[]>;
}

export function fileVendorRequestStore(filePath: string): VendorRequestStore {
  return { list: () => readVendorBankChangeRequests(filePath) };
}

// ─── The AP gate ───────────────────────────────────────────────────────────

export interface VendorRequestGateInput {
  vendorId: string;
  /** The invoice's claimed new payout address (re-derived server-side from the proposal). */
  claimedPayoutAddress: string;
  /** The invoice's claimed payee EVM identity (re-derived server-side from the proposal). */
  claimedEvmAddress: string;
  /**
   * When the vendor's payout address on file last changed (unix SECONDS, `payoutAddressLastChangedAt`).
   * A request verified before that moment was about an earlier state of the record and never matches.
   */
  payoutAddressLastChangedAt: number;
}

export type VendorRequestGateResult =
  | { ok: true; request: VerifiedVendorBankChangeRequest }
  | { ok: false; reason: 'no_verified_vendor_request'; detail: string };

/**
 * Pure. The newest verified request that matches vendorId, the claimed payout address and the
 * claimed EVM identity exactly, and was verified after the payout address on file last changed.
 */
export function checkVendorRequestGate(
  requests: readonly VerifiedVendorBankChangeRequest[],
  input: VendorRequestGateInput,
): VendorRequestGateResult {
  const vendorId = input.vendorId.toLowerCase();
  const payout = input.claimedPayoutAddress.toLowerCase();
  const evm = input.claimedEvmAddress.toLowerCase();
  const sinceMs = input.payoutAddressLastChangedAt * 1000;
  const forVendor = requests.filter((r) => r.vendorId === vendorId);
  const matches = forVendor.filter((r) => r.newPayoutAddress === payout && r.newEvmAddress === evm && r.verifiedAtMs > sinceMs);
  if (matches.length > 0) {
    return { ok: true, request: matches.reduce((a, b) => (b.verifiedAtMs > a.verifiedAtMs ? b : a)) };
  }
  const detail =
    forVendor.length === 0
      ? `No IDKit-verified bank-change request from ${vendorId} is on file. The vendor must submit the change at /vendor/bank-change first.`
      : `${forVendor.length} IDKit-verified request(s) from ${vendorId} are on file, but none matches this invoice's claimed payout address ` +
        `${payout} and EVM identity ${evm} after the payout address on file last changed (${new Date(sinceMs).toISOString()}).`;
  return { ok: false, reason: 'no_verified_vendor_request', detail };
}
