/**
 * Storage for pending step-up attempts and replay ledgers, keyed by proposal instead of
 * by agent.
 *
 * Adapted from the now-deleted `identity/src/store.ts` (the Hostage Protocol's Recovery
 * Desk, which keyed everything by `agentName` because it gated an agent-wide lock state).
 * Migration PRD D.6 gates a specific irreversible *proposal* instead — "the fresh World
 * check gates only the moment a proposal crosses `irreversibleAboveUSDC` or is flagged
 * non-refundable" — so every record here is keyed by `proposalHash`, not an agent name,
 * and there is no `AgentIdentityRecord`/`LOCKED` concept: a proposal either gets a fresh
 * approval or it doesn't, and nothing here persists across proposals.
 *
 * What the file holds and why that is acceptable (same reasoning as the original):
 *  - pending attempts' PKCE verifiers, one per `state`. Each is short-lived and useless
 *    without a matching authorization code. Attempts are pruned after a day.
 *  - SHA-256 hashes of redeemed authorization codes, never the codes themselves.
 *  - the pairwise `sub` and `auth_time` of a *decided* step-up, per proposal hash — kept so
 *    `settle_with_stepup`'s off-chain caller and `/api/stepup` can both look up the same
 *    decision idempotently instead of re-deciding on every poll.
 *  - no client secret, no ID token, no access token.
 */

import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import type { Hash32 } from '@bonded/seam';

export interface StepUpAttempt {
  state: string;
  nonce: string;
  codeVerifier: string;
  proposalHash: Hash32;
  /** Shown to the human at authorization time (Migration PRD D.6's `reason`). */
  reason: string;
  /** Unix seconds (our clock). `auth_time` must not predate this (max_age=0). */
  createdAt: number;
  /** Set when a callback for this attempt was taken; the state/nonce pair is single-use. */
  spentAt?: number;
  /** Set when a verified token was concluded against this attempt (approved or denied). */
  concludedAt?: number;
}

/** A decided step-up, keyed by the proposal it gates. Overwritten by a later attempt. */
export interface StepUpDecisionRecord {
  proposalHash: Hash32;
  approved: boolean;
  reason?: string;
  sub?: string;
  authTimeMs?: number;
  decidedAt: number;
}

export type StepUpEventKind = 'started' | 'approved' | 'denied';

export interface StepUpEvent {
  at: number;
  kind: StepUpEventKind;
  proposalHash?: Hash32;
  reason?: string;
  detail?: string;
}

export interface StepUpState {
  version: 1;
  /** Keyed by `state` (the OAuth state parameter), not by proposal — one proposal may be
   *  retried across several attempts if an earlier one expired or was denied. */
  attempts: Record<string, StepUpAttempt>;
  /** sha256(code) -> unix seconds first seen. */
  usedCodeHashes: Record<string, number>;
  /** nonce -> unix seconds concluded. */
  concludedNonces: Record<string, number>;
  /** proposalHash -> most recent decision. */
  decisions: Record<string, StepUpDecisionRecord>;
  log: StepUpEvent[];
}

export function emptyStepUpState(): StepUpState {
  return { version: 1, attempts: {}, usedCodeHashes: {}, concludedNonces: {}, decisions: {}, log: [] };
}

export interface StepUpStore {
  read(): Promise<StepUpState>;
  /**
   * Atomic read-modify-write. `fn` mutates the state it is given and returns a value.
   * Concurrent updates are serialised, so two callbacks carrying the same code cannot
   * both pass the replay check.
   */
  update<T>(fn: (state: StepUpState) => T): Promise<T>;
}

const RETENTION_SECONDS = 24 * 60 * 60;
const LOG_CAP = 500;

function prune(state: StepUpState, nowSec: number): void {
  for (const [k, a] of Object.entries(state.attempts)) {
    if (nowSec - a.createdAt > RETENTION_SECONDS) delete state.attempts[k];
  }
  for (const [k, t] of Object.entries(state.usedCodeHashes)) {
    if (nowSec - t > RETENTION_SECONDS) delete state.usedCodeHashes[k];
  }
  for (const [k, t] of Object.entries(state.concludedNonces)) {
    if (nowSec - t > RETENTION_SECONDS) delete state.concludedNonces[k];
  }
  if (state.log.length > LOG_CAP) state.log.splice(0, state.log.length - LOG_CAP);
}

/** In-process store. Used by unit tests of the flow's own logic — never a real token. */
export class MemoryStepUpStore implements StepUpStore {
  private state: StepUpState = emptyStepUpState();
  private chain: Promise<unknown> = Promise.resolve();

  async read(): Promise<StepUpState> {
    return structuredClone(this.state);
  }

  update<T>(fn: (state: StepUpState) => T): Promise<T> {
    const run = this.chain.then(() => {
      const next = structuredClone(this.state);
      const out = fn(next);
      this.state = next;
      return out;
    });
    this.chain = run.catch(() => undefined);
    return run;
  }
}

export class StepUpStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StepUpStoreError';
  }
}

/**
 * Find the workspace root (the directory holding pnpm-workspace.yaml), walking up from
 * `from`. Console, agent and script callers run from different working directories and
 * must resolve the same file.
 */
export function findWorkspaceRoot(from: string = process.cwd()): string {
  let dir = path.resolve(from);
  for (;;) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new StepUpStoreError(
        `Could not find the workspace root (pnpm-workspace.yaml) above ${from}. Set BONDED_STEPUP_STORE to an explicit path.`,
      );
    }
    dir = parent;
  }
}

/** `BONDED_STEPUP_STORE` if set, else `<workspace>/.data/world-agents/stepup-store.json`. */
export function defaultStepUpStorePath(env: NodeJS.ProcessEnv = process.env, from?: string): string {
  const override = env['BONDED_STEPUP_STORE']?.trim();
  if (override) return path.resolve(override);
  return path.join(findWorkspaceRoot(from), '.data', 'world-agents', 'stepup-store.json');
}

const LOCK_STALE_MS = 10_000;
const LOCK_WAIT_MS = 5_000;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * JSON-file store. Cross-process safety comes from an exclusive lock file
 * (`<file>.lock`, created with O_EXCL) around each read-modify-write, and writes go
 * through a temp file plus rename. A corrupt file throws; it is never silently reset,
 * because resetting would erase the replay ledger that makes a code single-use.
 *
 * `.data/` is gitignored (.gitignore line 50), so this file is never committed.
 */
export class JsonFileStepUpStore implements StepUpStore {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    readonly filePath: string = defaultStepUpStorePath(),
    private readonly nowSec: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  private async load(): Promise<StepUpState> {
    let text: string;
    try {
      text = await fs.readFile(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyStepUpState();
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new StepUpStoreError(`Step-up store ${this.filePath} is not valid JSON; refusing to overwrite it.`);
    }
    const s = parsed as Partial<StepUpState>;
    if (s.version !== 1 || typeof s.attempts !== 'object' || typeof s.decisions !== 'object') {
      throw new StepUpStoreError(`Step-up store ${this.filePath} has an unrecognised shape; refusing to overwrite it.`);
    }
    return {
      ...emptyStepUpState(),
      ...s,
    } as StepUpState;
  }

  private async acquireLock(): Promise<() => Promise<void>> {
    const lockPath = `${this.filePath}.lock`;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const started = Date.now();
    for (;;) {
      try {
        const handle = await fs.open(lockPath, 'wx');
        await handle.writeFile(String(process.pid));
        await handle.close();
        return async () => {
          await fs.rm(lockPath, { force: true });
        };
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
        if (Date.now() - started > LOCK_WAIT_MS) {
          throw new StepUpStoreError(`Timed out waiting for lock ${lockPath}`);
        }
        await delay(25);
      }
    }
  }

  private async writeAtomic(state: StepUpState): Promise<void> {
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
    for (let attempt = 0; ; attempt += 1) {
      try {
        await fs.rename(tmp, this.filePath);
        return;
      } catch (error) {
        // Windows can briefly refuse a rename over a file another process has open.
        const code = (error as NodeJS.ErrnoException).code;
        if ((code === 'EPERM' || code === 'EACCES' || code === 'EBUSY') && attempt < 20) {
          await delay(25);
          continue;
        }
        await fs.rm(tmp, { force: true });
        throw error;
      }
    }
  }

  async read(): Promise<StepUpState> {
    return this.load();
  }

  update<T>(fn: (state: StepUpState) => T): Promise<T> {
    const run = this.chain.then(async () => {
      const release = await this.acquireLock();
      try {
        const state = await this.load();
        const out = fn(state);
        prune(state, this.nowSec());
        await this.writeAtomic(state);
        return out;
      } finally {
        await release();
      }
    });
    this.chain = run.catch(() => undefined);
    return run;
  }
}
