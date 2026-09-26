/**
 * The Recovery Desk (PRD D.2 screen 3), plus owner binding at agent creation.
 *
 * An agent is bound at creation to the pairwise World `sub` of the human who made it.
 * When the agent is scarred (a slash landed against it on-chain), it is LOCKED: it may
 * not open new bonds until that same human completes a FRESH World ID verification.
 * These two human moments are the only human buttons CLAUDE.md rule 4 allows.
 *
 * Freshness, documented:
 *  - Every attempt asks the IdP for `max_age=0`, which means "this transaction's own
 *    fresh World proof, even with an existing browser session", and for
 *    `acr_values=orb-v3` (step-up guide).
 *  - On the way back, `auth_time` must satisfy both of these:
 *      (a) it is not before the attempt started, less CLOCK_SKEW_SECONDS. That makes it
 *          this attempt's proof, not a reused session ("check that authentication
 *          belongs to the newly initiated attempt").
 *      (b) now - auth_time <= FRESHNESS_WINDOW_SECONDS (300 s = 5 minutes). This is the
 *          same lifetime the IdP gives codes and ID tokens.
 *    It must also not be more than CLOCK_SKEW_SECONDS in the future.
 *  - An attempt itself lives ATTEMPT_TTL_SECONDS (10 min) so the human has time to open
 *    the World app. Condition (b) still bounds the proof itself to 5 minutes.
 *
 * Every denial returns a distinct, typed reason, leaves the agent LOCKED, spends the
 * attempt, and is written to the desk log (reason only, never the `sub`).
 *
 * Structure, so the logic is testable without any token:
 *   acceptCallback()    callback intake: IdP error, state, code/nonce replay, attempt expiry
 *   concludeVerified()  the decision, given claims that `verifyIdToken` already verified
 *   handleCallback()    acceptCallback -> exchangeCode -> verifyIdToken -> concludeVerified
 *                       (network; proven live by scripts/world-live.ts)
 */

import { createHash } from 'node:crypto';
import type { Hash32 } from '@bonded/seam';
import {
  ACR_ORB_V3,
  CLOCK_SKEW_SECONDS,
  IdTokenError,
  TokenExchangeError,
  assuranceProblem,
  buildAuthorizationUrl,
  createPkce,
  discover,
  exchangeCode,
  randomToken,
  readWorldClientConfig,
  verifyIdToken,
  type CallbackParams,
  type DiscoveryDocument,
  type VerifiedIdToken,
  type WorldClientConfig,
} from './world-flow.js';
import {
  JsonFileIdentityStore,
  type AgentIdentityRecord,
  type AgentStatus,
  type AttemptPurpose,
  type AuthorizationAttempt,
  type DeskEvent,
  type IdentityState,
  type IdentityStore,
} from './store.js';

/** How old a World proof may be when the desk acts on it. */
export const FRESHNESS_WINDOW_SECONDS = 300;
/** How long a started attempt waits for its callback. */
export const ATTEMPT_TTL_SECONDS = 600;

export type DeniedReason =
  /** The callback carried `error=` (e.g. access_denied); the human denied or the IdP refused. */
  | 'idp_error'
  /** Callback without a code. */
  | 'malformed_callback'
  /** RFC 9207 `iss` on the callback, or the verified issuer, is not the sandbox issuer. */
  | 'issuer_mismatch'
  /** No pending attempt for this `state` (CSRF, or a stale or foreign callback). */
  | 'state_mismatch'
  /** The attempt outlived ATTEMPT_TTL_SECONDS before its callback arrived. */
  | 'attempt_expired'
  /** This authorization code was already presented once. */
  | 'replayed_code'
  /** This attempt's state/nonce pair was already spent. */
  | 'replayed_nonce'
  /** The token endpoint refused the code (an OAuth error such as invalid_grant). */
  | 'token_exchange_failed'
  /** The IdP or its JWKS was unreachable or returned 5xx/429. Never treated as a verdict. */
  | 'idp_unavailable'
  /** Signature, issuer, audience, algorithm or claim shape failed. */
  | 'token_invalid'
  /** The ID token's `exp` has passed. */
  | 'token_expired'
  /** The ID token's nonce is not this attempt's nonce. */
  | 'nonce_mismatch'
  /** `acr` is not orb-v3, or `amr` lacks `pop`. */
  | 'assurance_mismatch'
  /** `auth_time` is too old, predates the attempt, or is in the future. */
  | 'stale_authentication'
  /** A different human (`sub`) than the one bound at creation. */
  | 'wrong_subject'
  /** Recovery requested for an agent that is not scarred. */
  | 'agent_not_locked'
  /** Binding requested for an agent that already has an owner. */
  | 'agent_already_bound'
  /** Recovery requested for an agent with no owner binding. */
  | 'agent_not_bound';

export interface Denied {
  ok: false;
  reason: DeniedReason;
  detail: string;
  agentName?: string;
  purpose?: AttemptPurpose;
  /** The IdP's `error` code, for idp_error / token_exchange_failed. */
  idpError?: string;
  /** Present when the denial happened after the token verified (e.g. wrong_subject). */
  verified?: VerifiedIdToken;
}

export interface Concluded {
  ok: true;
  purpose: AttemptPurpose;
  agentName: string;
  status: AgentStatus;
  sub: string;
  authTime: number;
  verified: VerifiedIdToken;
}

export type DeskResult = Concluded | Denied;

export type StartResult =
  | { ok: true; purpose: AttemptPurpose; agentName: string; state: string; authorizeUrl: string }
  | Denied;

export type IntakeResult = { ok: true; attempt: AuthorizationAttempt; code: string } | Denied;

export type BondEligibility =
  | { allowed: true; agentName: string }
  | { allowed: false; agentName: string; reason: 'agent_not_bound' | 'agent_locked'; detail: string };

export interface ScarEvidence {
  bondId: string;
  slashTxDigest: string;
  evidenceHash: Hash32;
}

export class RecoveryDeskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecoveryDeskError';
  }
}

/**
 * Pure freshness check (documented at the top of this file). Returns why the proof is
 * not fresh, or null.
 */
export function freshnessProblem(
  authTime: number,
  attemptCreatedAt: number,
  now: number,
  windowSeconds: number = FRESHNESS_WINDOW_SECONDS,
): string | null {
  if (authTime > now + CLOCK_SKEW_SECONDS) {
    return `auth_time is ${authTime - now}s in the future`;
  }
  if (authTime < attemptCreatedAt - CLOCK_SKEW_SECONDS) {
    return `auth_time predates this attempt by ${attemptCreatedAt - authTime}s; a reused session is not a fresh proof`;
  }
  if (now - authTime > windowSeconds) {
    return `World proof is ${now - authTime}s old, past the ${windowSeconds}s window`;
  }
  return null;
}

const AGENT_NAME = /^[a-z0-9][a-z0-9.-]{0,254}$/i;
const HASH32 = /^0x[0-9a-fA-F]{64}$/;

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export interface RecoveryDeskOptions {
  store: IdentityStore;
  discovery: DiscoveryDocument;
  /** Read at call time. Defaults to the WORLD_* env vars; missing values throw. */
  config?: () => WorldClientConfig;
  /** Unix seconds. */
  now?: () => number;
  freshnessWindowSeconds?: number;
}

export class RecoveryDesk {
  private readonly store: IdentityStore;
  private readonly discovery: DiscoveryDocument;
  private readonly config: () => WorldClientConfig;
  private readonly now: () => number;
  private readonly window: number;

  constructor(options: RecoveryDeskOptions) {
    this.store = options.store;
    this.discovery = options.discovery;
    this.config = options.config ?? (() => readWorldClientConfig());
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.window = options.freshnessWindowSeconds ?? FRESHNESS_WINDOW_SECONDS;
  }

  /** Live discovery plus the shared JSON-file store. For web/ and agents/. */
  static async create(options: { store?: IdentityStore; issuer?: string } = {}): Promise<RecoveryDesk> {
    const discovery = await discover(options.issuer);
    return new RecoveryDesk({ store: options.store ?? new JsonFileIdentityStore(), discovery });
  }

  // ─── Reads ────────────────────────────────────────────────────────────────

  async getAgent(agentName: string): Promise<AgentIdentityRecord | null> {
    const s = await this.store.read();
    return s.agents[agentName] ?? null;
  }

  /** What agents/ asks before opening a bond. Unbound and scarred agents may not. */
  async canOpenBond(agentName: string): Promise<BondEligibility> {
    const rec = await this.getAgent(agentName);
    if (!rec) {
      return { allowed: false, agentName, reason: 'agent_not_bound', detail: 'No owner is bound to this agent.' };
    }
    if (rec.status === 'LOCKED') {
      return {
        allowed: false,
        agentName,
        reason: 'agent_locked',
        detail: `Scarred (${rec.scars.length} scar(s)); locked until its owner completes a fresh World ID verification at the Recovery Desk.`,
      };
    }
    return { allowed: true, agentName };
  }

  async events(agentName?: string): Promise<DeskEvent[]> {
    const s = await this.store.read();
    return agentName ? s.log.filter((e) => e.agentName === agentName) : s.log;
  }

  // ─── Starting an attempt (the human's button) ─────────────────────────────

  /** The mint step: begin binding a new agent to the human who is creating it. */
  startBinding(agentName: string): Promise<StartResult> {
    return this.startAttempt('bind', agentName);
  }

  /** The Recovery Desk button: begin a fresh verification to unlock a scarred agent. */
  startRecovery(agentName: string): Promise<StartResult> {
    return this.startAttempt('recover', agentName);
  }

  private async startAttempt(purpose: AttemptPurpose, agentName: string): Promise<StartResult> {
    if (!AGENT_NAME.test(agentName)) throw new RecoveryDeskError(`Invalid agent name: ${JSON.stringify(agentName)}`);
    const config = this.config();
    const now = this.now();
    const pkce = createPkce();
    const attempt: AuthorizationAttempt = {
      state: randomToken(),
      nonce: randomToken(),
      codeVerifier: pkce.verifier,
      purpose,
      agentName,
      createdAt: now,
    };
    const precondition = await this.store.update((s): Denied | null => {
      const rec = s.agents[agentName];
      let denied: Denied | null = null;
      if (purpose === 'bind' && rec) {
        denied = { ok: false, reason: 'agent_already_bound', detail: 'This agent already has an owner.', agentName, purpose };
      } else if (purpose === 'recover' && !rec) {
        denied = { ok: false, reason: 'agent_not_bound', detail: 'No owner is bound to this agent.', agentName, purpose };
      } else if (purpose === 'recover' && rec && rec.status !== 'LOCKED') {
        denied = { ok: false, reason: 'agent_not_locked', detail: 'This agent is not scarred.', agentName, purpose };
      }
      if (denied) {
        this.logDenied(s, denied, now);
        return denied;
      }
      s.attempts[attempt.state] = attempt;
      if (purpose === 'recover') s.log.push({ at: now, kind: 'recovery_started', agentName, purpose });
      return null;
    });
    if (precondition) return precondition;
    const authorizeUrl = buildAuthorizationUrl({
      discovery: this.discovery,
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      state: attempt.state,
      nonce: attempt.nonce,
      codeChallenge: pkce.challenge,
      maxAge: 0,
      acrValues: [ACR_ORB_V3],
    });
    return { ok: true, purpose, agentName, state: attempt.state, authorizeUrl };
  }

  // ─── Callback intake ──────────────────────────────────────────────────────

  /**
   * Take a callback. On success the attempt is spent and the code's hash is recorded
   * in one atomic update, before the code is redeemed, so a duplicate callback can
   * never reach the token endpoint twice.
   */
  acceptCallback(params: CallbackParams): Promise<IntakeResult> {
    const now = this.now();
    return this.store.update((s): IntakeResult => {
      const attempt = params.state !== undefined ? s.attempts[params.state] : undefined;
      const deny = (reason: DeniedReason, detail: string, extra: Partial<Denied> = {}): Denied => {
        const d: Denied = { ok: false, reason, detail, ...extra };
        if (attempt) {
          d.agentName = attempt.agentName;
          d.purpose = attempt.purpose;
        }
        this.logDenied(s, d, now);
        return d;
      };
      const spend = () => {
        if (attempt && attempt.spentAt === undefined) attempt.spentAt = now;
      };

      if (params.error !== undefined) {
        spend();
        const desc = params.errorDescription ? ` (${params.errorDescription.slice(0, 200)})` : '';
        return deny('idp_error', `World ID returned error=${params.error}${desc}`, { idpError: params.error });
      }
      if (params.iss !== undefined && params.iss !== this.discovery.issuer) {
        spend();
        return deny('issuer_mismatch', 'Callback iss is not the sandbox issuer');
      }
      if (params.state === undefined || params.state === '') {
        return deny('state_mismatch', 'Callback carried no state');
      }
      if (!attempt) return deny('state_mismatch', 'No attempt was started with this state');
      if (params.code === undefined || params.code === '') {
        spend();
        return deny('malformed_callback', 'Callback carried neither a code nor an error');
      }
      const codeHash = sha256(params.code);
      if (s.usedCodeHashes[codeHash] !== undefined) {
        spend();
        return deny('replayed_code', 'This authorization code was already presented');
      }
      if (attempt.spentAt !== undefined) {
        s.usedCodeHashes[codeHash] = now;
        return deny('replayed_nonce', "This attempt's state and nonce were already spent");
      }
      if (now - attempt.createdAt > ATTEMPT_TTL_SECONDS) {
        spend();
        s.usedCodeHashes[codeHash] = now;
        return deny('attempt_expired', `Attempt is ${now - attempt.createdAt}s old, past ${ATTEMPT_TTL_SECONDS}s`);
      }
      s.usedCodeHashes[codeHash] = now;
      attempt.spentAt = now;
      return { ok: true, attempt: { ...attempt }, code: params.code };
    });
  }

  // ─── Decision on verified claims ──────────────────────────────────────────

  /**
   * Given claims that `verifyIdToken` has already verified (signature, iss, aud, exp,
   * nonce, acr, amr), apply the desk's own policy: single-use attempt, nonce binding
   * (re-checked), expiry and assurance (re-checked), freshness, and subject match.
   */
  concludeVerified(attempt: AuthorizationAttempt, verified: VerifiedIdToken): Promise<DeskResult> {
    const now = this.now();
    return this.store.update((s): DeskResult => {
      const current = s.attempts[attempt.state];
      const deny = (reason: DeniedReason, detail: string): Denied => {
        const d: Denied = { ok: false, reason, detail, agentName: attempt.agentName, purpose: attempt.purpose, verified };
        this.logDenied(s, d, now);
        return d;
      };
      if (!current || current.spentAt === undefined) {
        return deny('state_mismatch', 'Attempt was not taken through callback intake');
      }
      if (current.concludedAt !== undefined || s.concludedNonces[current.nonce] !== undefined) {
        return deny('replayed_nonce', 'This attempt was already concluded');
      }
      // Terminal from here on: whatever happens below, this attempt is used up.
      current.concludedAt = now;
      s.concludedNonces[current.nonce] = now;

      if (verified.nonce !== current.nonce) return deny('nonce_mismatch', "Token nonce is not this attempt's nonce");
      if (verified.issuer !== this.discovery.issuer) return deny('issuer_mismatch', 'Token issuer is not the sandbox issuer');
      if (verified.exp + CLOCK_SKEW_SECONDS < now) return deny('token_expired', `ID token expired ${now - verified.exp}s ago`);
      const assurance = assuranceProblem(verified.acr, verified.amr);
      if (assurance) return deny('assurance_mismatch', assurance);
      const stale = freshnessProblem(verified.authTime, current.createdAt, now, this.window);
      if (stale) return deny('stale_authentication', stale);

      const name = current.agentName;
      const rec = s.agents[name];
      if (current.purpose === 'bind') {
        if (rec) return deny('agent_already_bound', 'This agent already has an owner');
        const created = this.applyBinding(s, name, verified.sub, verified.issuer, verified.authTime, now);
        return { ok: true, purpose: 'bind', agentName: name, status: created.status, sub: verified.sub, authTime: verified.authTime, verified };
      }
      if (!rec) return deny('agent_not_bound', 'No owner is bound to this agent');
      if (rec.owner.issuer !== verified.issuer || rec.owner.sub !== verified.sub) {
        return deny('wrong_subject', 'A different World ID than the one bound at creation completed this verification');
      }
      if (rec.status !== 'LOCKED') return deny('agent_not_locked', 'This agent is not scarred');
      rec.status = 'ACTIVE';
      delete rec.lockedSince;
      rec.lastRecovery = { at: now, authTime: verified.authTime };
      s.log.push({ at: now, kind: 'recovered', agentName: name, purpose: 'recover' });
      return { ok: true, purpose: 'recover', agentName: name, status: 'ACTIVE', sub: verified.sub, authTime: verified.authTime, verified };
    });
  }

  // ─── The full callback (network) ──────────────────────────────────────────

  /**
   * Intake, then redeem the code at the live token endpoint, then verify the ID token
   * against the live JWKS, then conclude. Server-side only.
   */
  async handleCallback(params: CallbackParams): Promise<DeskResult> {
    const intake = await this.acceptCallback(params);
    if (!intake.ok) return intake;
    const { attempt, code } = intake;
    const config = this.config();

    let idToken: string;
    try {
      idToken = (await exchangeCode({ discovery: this.discovery, config, code, codeVerifier: attempt.codeVerifier })).id_token;
    } catch (error) {
      if (!(error instanceof TokenExchangeError)) throw error;
      const reason: DeniedReason = error.kind === 'idp_unavailable' ? 'idp_unavailable' : 'token_exchange_failed';
      return this.recordDenied({
        ok: false,
        reason,
        detail: error.message,
        agentName: attempt.agentName,
        purpose: attempt.purpose,
        ...(error.oauthError !== undefined ? { idpError: error.oauthError } : {}),
      });
    }

    let verified: VerifiedIdToken;
    try {
      verified = await verifyIdToken({
        discovery: this.discovery,
        idToken,
        clientId: config.clientId,
        expectedNonce: attempt.nonce,
        requiredAcr: ACR_ORB_V3,
        now: this.now,
      });
    } catch (error) {
      if (!(error instanceof IdTokenError)) throw error;
      const reason: DeniedReason = error.reason === 'jwks_unavailable' ? 'idp_unavailable' : error.reason;
      return this.recordDenied({ ok: false, reason, detail: error.message, agentName: attempt.agentName, purpose: attempt.purpose });
    }
    return this.concludeVerified(attempt, verified);
  }

  // ─── Binding and scarring ─────────────────────────────────────────────────

  /**
   * Bind an agent to its owner's pairwise `sub`. Call this only with a `sub` taken from a
   * token that `verifyIdToken` verified. `handleCallback` does this itself for binding
   * attempts; this entry point exists for callers that already hold such a result.
   * It refuses to rebind.
   */
  bindOwner(agentName: string, sub: string, issuer: string = this.discovery.issuer, authTime: number = this.now()): Promise<AgentIdentityRecord> {
    if (!AGENT_NAME.test(agentName)) throw new RecoveryDeskError(`Invalid agent name: ${JSON.stringify(agentName)}`);
    if (typeof sub !== 'string' || sub === '') throw new RecoveryDeskError('bindOwner needs a non-empty sub');
    if (issuer !== this.discovery.issuer) throw new RecoveryDeskError('bindOwner issuer is not the configured IdP issuer');
    const now = this.now();
    return this.store.update((s) => {
      if (s.agents[agentName]) throw new RecoveryDeskError(`Agent ${agentName} already has an owner`);
      return this.applyBinding(s, agentName, sub, issuer, authTime, now);
    });
  }

  /**
   * Lock an agent after a slash landed against it. Evidence is required (CLAUDE.md
   * rule 5): the bond, the slash transaction, and the evidence hash the slash carried.
   */
  markScarred(agentName: string, evidence: ScarEvidence): Promise<AgentIdentityRecord> {
    if (!evidence.bondId || !evidence.slashTxDigest) {
      throw new RecoveryDeskError('markScarred requires bondId and slashTxDigest');
    }
    if (!HASH32.test(evidence.evidenceHash)) {
      throw new RecoveryDeskError('markScarred requires a 32-byte 0x evidenceHash');
    }
    const now = this.now();
    return this.store.update((s) => {
      const rec = s.agents[agentName];
      if (!rec) throw new RecoveryDeskError(`Agent ${agentName} has no owner binding; bind at creation first`);
      rec.scars.push({ bondId: evidence.bondId, slashTxDigest: evidence.slashTxDigest, evidenceHash: evidence.evidenceHash, at: now });
      if (rec.status !== 'LOCKED') {
        rec.status = 'LOCKED';
        rec.lockedSince = now;
      }
      s.log.push({ at: now, kind: 'scarred', agentName, detail: `bond ${evidence.bondId}, tx ${evidence.slashTxDigest}` });
      return structuredClone(rec);
    });
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private applyBinding(s: IdentityState, agentName: string, sub: string, issuer: string, authTime: number, now: number): AgentIdentityRecord {
    const rec: AgentIdentityRecord = {
      agentName,
      owner: { issuer, sub, boundAt: now, authTime },
      status: 'ACTIVE',
      scars: [],
    };
    s.agents[agentName] = rec;
    s.log.push({ at: now, kind: 'bound', agentName, purpose: 'bind' });
    return structuredClone(rec);
  }

  private logDenied(s: IdentityState, d: Denied, now: number): void {
    const e: DeskEvent = { at: now, kind: 'denied', reason: d.reason, detail: d.detail };
    if (d.agentName !== undefined) e.agentName = d.agentName;
    if (d.purpose !== undefined) e.purpose = d.purpose;
    s.log.push(e);
  }

  private async recordDenied(d: Denied): Promise<Denied> {
    const now = this.now();
    await this.store.update((s) => this.logDenied(s, d, now));
    return d;
  }
}
