/**
 * Storage for owner bindings, pending authorization attempts, and replay ledgers.
 *
 * Behind an interface so `web/` (the Recovery Desk route) and `agents/` (checking
 * whether an agent may open a bond) share one source of truth. The default
 * implementation is a small JSON file at `<workspace>/.data/identity/identity-store.json`.
 * `.data/` is gitignored (.gitignore line 50), so the file is never committed.
 *
 * What the file holds and why that is acceptable:
 *  - pairwise `sub` per bound agent. It is meaningless outside this relying party's sector.
 *  - pending attempts' PKCE verifiers. Each is short-lived and useless without a matching
 *    code. Attempts are pruned after a day.
 *  - SHA-256 hashes of redeemed authorization codes, never the codes themselves.
 *  - no client secret, no ID token, no access token.
 */

import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';

export type AgentStatus = 'ACTIVE' | 'LOCKED';

export interface OwnerBinding {
  issuer: string;
  /** Pairwise subject of the human who created this agent. */
  sub: string;
  /** Unix seconds (our clock) when the binding was written. */
  boundAt: number;
  /** Unix seconds (IdP's `auth_time`) of the verification that created the binding. */
  authTime: number;
}

export interface ScarRecord {
  /** Sui object id of the slashed bond. */
  bondId: string;
  /** Sui transaction digest of the slash. */
  slashTxDigest: string;
  /** Hash of the evidence attached to the slash (PRD C.4, CLAUDE.md rule 5). */
  evidenceHash: string;
  at: number;
}

export interface AgentIdentityRecord {
  agentName: string;
  owner: OwnerBinding;
  status: AgentStatus;
  scars: ScarRecord[];
  lockedSince?: number;
  lastRecovery?: { at: number; authTime: number };
}

export type AttemptPurpose = 'bind' | 'recover';

export interface AuthorizationAttempt {
  state: string;
  nonce: string;
  codeVerifier: string;
  purpose: AttemptPurpose;
  agentName: string;
  /** Unix seconds (our clock). `auth_time` must not predate this (max_age=0). */
  createdAt: number;
  /** Set when a callback for this attempt was taken; the state/nonce pair is single-use. */
  spentAt?: number;
  /** Set when a verified token was concluded against this attempt. */
  concludedAt?: number;
}

export type DeskEventKind = 'bound' | 'scarred' | 'recovery_started' | 'recovered' | 'denied';

export interface DeskEvent {
  at: number;
  kind: DeskEventKind;
  agentName?: string;
  purpose?: AttemptPurpose;
  reason?: string;
  detail?: string;
}

export interface IdentityState {
  version: 1;
  agents: Record<string, AgentIdentityRecord>;
  attempts: Record<string, AuthorizationAttempt>;
  /** sha256(code) -> unix seconds first seen. */
  usedCodeHashes: Record<string, number>;
  /** nonce -> unix seconds concluded. */
  concludedNonces: Record<string, number>;
  log: DeskEvent[];
}

export function emptyIdentityState(): IdentityState {
  return { version: 1, agents: {}, attempts: {}, usedCodeHashes: {}, concludedNonces: {}, log: [] };
}

export interface IdentityStore {
  read(): Promise<IdentityState>;
  /**
   * Atomic read-modify-write. `fn` mutates the state it is given and returns a value.
   * Concurrent updates are serialised, so two callbacks carrying the same code
   * cannot both pass the replay check.
   */
  update<T>(fn: (state: IdentityState) => T): Promise<T>;
}

const RETENTION_SECONDS = 24 * 60 * 60;
const LOG_CAP = 500;

function prune(state: IdentityState, nowSec: number): void {
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

/** In-process store. Used by unit tests of the desk's own logic. */
export class MemoryIdentityStore implements IdentityStore {
  private state: IdentityState = emptyIdentityState();
  private chain: Promise<unknown> = Promise.resolve();

  async read(): Promise<IdentityState> {
    return structuredClone(this.state);
  }

  update<T>(fn: (state: IdentityState) => T): Promise<T> {
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

export class IdentityStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdentityStoreError';
  }
}

/**
 * Find the workspace root (the directory holding pnpm-workspace.yaml), walking up from
 * `from`. `web/` and `agents/` run from different working directories and must resolve
 * the same file.
 */
export function findWorkspaceRoot(from: string = process.cwd()): string {
  let dir = path.resolve(from);
  for (;;) {
    if (existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new IdentityStoreError(
        `Could not find the workspace root (pnpm-workspace.yaml) above ${from}. Set BONDED_IDENTITY_STORE to an explicit path.`,
      );
    }
    dir = parent;
  }
}

/** `BONDED_IDENTITY_STORE` if set, else `<workspace>/.data/identity/identity-store.json`. */
export function defaultIdentityStorePath(env: NodeJS.ProcessEnv = process.env, from?: string): string {
  const override = env['BONDED_IDENTITY_STORE']?.trim();
  if (override) return path.resolve(override);
  return path.join(findWorkspaceRoot(from), '.data', 'identity', 'identity-store.json');
}

const LOCK_STALE_MS = 10_000;
const LOCK_WAIT_MS = 5_000;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * JSON-file store. Cross-process safety comes from an exclusive lock file
 * (`<file>.lock`, created with O_EXCL) around each read-modify-write, and writes go
 * through a temp file plus rename. A corrupt file throws. It is never silently reset,
 * because resetting would unlock every scarred agent.
 */
export class JsonFileIdentityStore implements IdentityStore {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    readonly filePath: string = defaultIdentityStorePath(),
    private readonly nowSec: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  private async load(): Promise<IdentityState> {
    let text: string;
    try {
      text = await fs.readFile(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyIdentityState();
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new IdentityStoreError(`Identity store ${this.filePath} is not valid JSON; refusing to overwrite it.`);
    }
    const s = parsed as Partial<IdentityState>;
    if (s.version !== 1 || typeof s.agents !== 'object' || typeof s.attempts !== 'object') {
      throw new IdentityStoreError(`Identity store ${this.filePath} has an unrecognised shape; refusing to overwrite it.`);
    }
    return {
      ...emptyIdentityState(),
      ...s,
    } as IdentityState;
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
          throw new IdentityStoreError(`Timed out waiting for lock ${lockPath}`);
        }
        await delay(25);
      }
    }
  }

  private async writeAtomic(state: IdentityState): Promise<void> {
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

  async read(): Promise<IdentityState> {
    return this.load();
  }

  update<T>(fn: (state: IdentityState) => T): Promise<T> {
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
