/**
 * World ID for Agents: the OIDC relying-party step-up flow. Server-side only.
 *
 * Migration PRD D.6: "Validate identity results in a secure backend; do not expose client
 * secrets or treat an unvalidated client response as authorization." Nothing in this file
 * may be imported into browser code. It reads the confidential client's secret from the
 * environment, holds the PKCE verifier, and redeems the authorization code. None of those
 * three may ever reach a browser.
 *
 * This is the OIDC-mechanics half of `packages/world-agents`, ported from the now-deleted
 * `identity/src/world-flow.ts` (built for the Hostage Protocol's Recovery Desk). The
 * mechanics — discovery, PKCE, the authorization URL, token exchange, JWKS verification —
 * do not change at all in this migration; PRD D.6 itself says so: "The underlying OIDC
 * mechanics ... are exactly what the Commerce Edition's step-up needs too." What changes is
 * what the flow is FOR: instead of gating an agent-wide LOCKED state keyed by `agentName`,
 * `initiateStepUp`/`handleCallback` below gate one specific `proposalHash` — see
 * `stepup-gate.ts` for the fresh-enough/matching-enough decision built on top of this file's
 * `handleCallback` result.
 *
 * Every endpoint, value and claim below was confirmed against the live sandbox, re-probed
 * 2026-09-26 immediately before writing this file (`FEEDBACK/world.md` records the
 * re-probe): the discovery document and JWKS matched docs/VERIFY_FINDINGS.md items 3a-3d
 * exactly, no drift.
 *
 *   issuer                      https://sandbox.auth.world.org
 *   authorization_endpoint      /api/v1/authorize        (code flow, query response mode)
 *   token_endpoint               /api/v1/token            (client_secret_basic | _post | private_key_jwt)
 *   jwks_uri                    /.well-known/jwks.json   (one RSA-2048 RS256 key, kid = RFC 7638 thumbprint)
 *   scopes_supported            ["openid"]               ("exactly scope=openid")
 *   code_challenge_methods      ["S256"]
 *   id_token_signing_alg        ["RS256"]
 *   subject_types_supported     ["pairwise"]
 *   acr_values_supported        ["https://world.org/oidc/acr/orb-v3"]
 *   no userinfo_endpoint        ("read claims from the validated ID token")
 *
 * From the sandbox's own `oidc`/`step-up` guides (VERIFY_FINDINGS 3a):
 *   - "Codes are single-use and last five minutes." "ID tokens last five minutes."
 *   - The ID token carries iss, sub, aud, exp, iat, jti, auth_time, acr and amr. It
 *     "includes nonce only when supplied in the authorization request". This flow always
 *     supplies one.
 *   - "Use auth_time for freshness, never iat."
 *   - Step-up: "max_age=0: Require this transaction's own fresh World proof, even with an
 *     existing browser session." `amr` is `["pop"]`.
 *   - "Dependency failures must remain distinguishable from invalid authentication."
 *   - "Never log request bodies, Authorization headers, or callback query strings."
 */

import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { Hash32 } from '@bonded/seam';
import {
  JsonFileStepUpStore,
  type StepUpAttempt,
  type StepUpState,
  type StepUpStore,
} from './store.js';

export const WORLD_SANDBOX_ISSUER = 'https://sandbox.auth.world.org';
/** The only scope the IdP supports. */
export const WORLD_SCOPE = 'openid';
/** The only authentication class the sandbox implements (discovery `acr_values_supported`). */
export const ACR_ORB_V3 = 'https://world.org/oidc/acr/orb-v3';
/** `amr` is `["pop"]`: proof of possession of the World credential (step-up guide). */
export const AMR_PROOF_OF_POSSESSION = 'pop';
/** The only ID-token signing algorithm the discovery document advertises. */
export const ID_TOKEN_ALG = 'RS256';
/**
 * Explicit clock tolerance, in seconds, for `exp` and implausibly future `auth_time`. The
 * step-up guide asks for "a small, explicit clock tolerance". 30 s is the tolerance the
 * `oidc` guide itself states for client assertions.
 */
export const CLOCK_SKEW_SECONDS = 30;
/** Bounded requests; the guide says "use bounded requests". */
export const REQUEST_TIMEOUT_MS = 10_000;
/** How long a started attempt waits for its callback before it is `expired`. */
export const ATTEMPT_TTL_SECONDS = 600;

/** Env var names, read at call time and never at import. */
export const WORLD_ENV = {
  clientId: 'WORLD_SANDBOX_CLIENT_ID',
  clientSecret: 'WORLD_SANDBOX_CLIENT_SECRET',
  redirectUri: 'WORLD_REDIRECT_URI',
  /** Optional. Must match the method registered in the portal; the portal default is basic. */
  authMethod: 'WORLD_TOKEN_AUTH_METHOD',
} as const;

// ─── Configuration ──────────────────────────────────────────────────────────

export type TokenAuthMethod = 'client_secret_basic' | 'client_secret_post';

export interface WorldClientConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authMethod: TokenAuthMethod;
}

export class WorldConfigError extends Error {
  constructor(
    message: string,
    readonly missing: readonly string[] = [],
  ) {
    super(message);
    this.name = 'WorldConfigError';
  }
}

/**
 * Read the confidential client's configuration from the environment, at call time.
 *
 * Missing values throw, and the error names every missing variable (names only, never
 * values). The sandbox accepts only HTTPS callbacks (VERIFY_FINDINGS 3b), so an http
 * redirect URI is rejected here rather than at the IdP with a less legible error.
 */
export function readWorldClientConfig(env: NodeJS.ProcessEnv = process.env): WorldClientConfig {
  const required = [WORLD_ENV.clientId, WORLD_ENV.clientSecret, WORLD_ENV.redirectUri] as const;
  const missing = required.filter((name) => !env[name] || env[name]?.trim() === '');
  if (missing.length > 0) {
    throw new WorldConfigError(
      `World sandbox client is not configured. Missing env: ${missing.join(', ')}. ` +
        'Register a confidential client at https://sandbox.auth.world.org/portal and set them in the backend environment.',
      missing,
    );
  }
  const redirectUri = (env[WORLD_ENV.redirectUri] as string).trim();
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    throw new WorldConfigError(`${WORLD_ENV.redirectUri} is not a valid URL.`);
  }
  if (parsed.protocol !== 'https:') {
    throw new WorldConfigError(
      `${WORLD_ENV.redirectUri} must be an https:// URL. The sandbox rejects http callbacks, including http://localhost, so a local run needs an HTTPS tunnel.`,
    );
  }
  const rawMethod = env[WORLD_ENV.authMethod]?.trim() || 'client_secret_basic';
  if (rawMethod !== 'client_secret_basic' && rawMethod !== 'client_secret_post') {
    throw new WorldConfigError(
      `${WORLD_ENV.authMethod} must be client_secret_basic or client_secret_post (got an unsupported value).`,
    );
  }
  return {
    clientId: (env[WORLD_ENV.clientId] as string).trim(),
    clientSecret: env[WORLD_ENV.clientSecret] as string,
    redirectUri,
    authMethod: rawMethod,
  };
}

// ─── Discovery ──────────────────────────────────────────────────────────────

export interface DiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  device_authorization_endpoint?: string;
  token_endpoint_auth_methods_supported?: string[];
  token_endpoint_auth_signing_alg_values_supported?: string[];
  response_types_supported: string[];
  response_modes_supported?: string[];
  grant_types_supported?: string[];
  scopes_supported: string[];
  claims_supported?: string[];
  prompt_values_supported?: string[];
  acr_values_supported?: string[];
  subject_types_supported: string[];
  id_token_signing_alg_values_supported: string[];
  code_challenge_methods_supported: string[];
  request_uri_parameter_supported?: boolean;
}

export class WorldDiscoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorldDiscoveryError';
  }
}

function sameOriginHttps(url: string, issuer: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.origin === new URL(issuer).origin;
  } catch {
    return false;
  }
}

/**
 * Validate a discovery document against everything this flow relies on. If the IdP
 * stops advertising any of it, this throws, rather than quietly running a flow whose
 * security properties have changed.
 */
export function assertDiscoveryUsable(
  doc: DiscoveryDocument,
  expectedIssuer: string = WORLD_SANDBOX_ISSUER,
): DiscoveryDocument {
  const fail = (why: string): never => {
    throw new WorldDiscoveryError(`Discovery document is not usable: ${why}`);
  };
  if (doc.issuer !== expectedIssuer) fail(`issuer is ${doc.issuer}, expected ${expectedIssuer}`);
  for (const key of ['authorization_endpoint', 'token_endpoint', 'jwks_uri'] as const) {
    if (!sameOriginHttps(doc[key], expectedIssuer)) fail(`${key} is not https on the issuer origin`);
  }
  if (!doc.response_types_supported?.includes('code')) fail('code flow not advertised');
  if (doc.response_modes_supported && !doc.response_modes_supported.includes('query')) {
    fail('query response mode not advertised');
  }
  if (!doc.scopes_supported?.includes(WORLD_SCOPE)) fail('openid scope not advertised');
  if (!doc.code_challenge_methods_supported?.includes('S256')) fail('PKCE S256 not advertised');
  if (!doc.id_token_signing_alg_values_supported?.includes(ID_TOKEN_ALG)) fail('RS256 not advertised');
  if (!doc.subject_types_supported?.includes('pairwise')) fail('pairwise subjects not advertised');
  if (!doc.acr_values_supported?.includes(ACR_ORB_V3)) fail(`acr ${ACR_ORB_V3} not advertised`);
  if (doc.claims_supported) {
    for (const claim of ['auth_time', 'nonce', 'acr', 'amr', 'sub']) {
      if (!doc.claims_supported.includes(claim)) fail(`claim ${claim} not advertised`);
    }
  }
  return doc;
}

/** Fetch the live discovery document and validate it. */
export async function discover(issuer: string = WORLD_SANDBOX_ISSUER): Promise<DiscoveryDocument> {
  const url = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new WorldDiscoveryError(`Discovery fetch failed for ${url}: ${describe(error)}`);
  }
  if (!res.ok) throw new WorldDiscoveryError(`Discovery returned HTTP ${res.status} from ${url}`);
  let doc: DiscoveryDocument;
  try {
    doc = (await res.json()) as DiscoveryDocument;
  } catch {
    throw new WorldDiscoveryError(`Discovery at ${url} was not JSON`);
  }
  return assertDiscoveryUsable(doc, issuer.replace(/\/$/, ''));
}

// ─── PKCE, state, nonce ─────────────────────────────────────────────────────

export interface Pkce {
  verifier: string;
  challenge: string;
  method: 'S256';
}

/** base64url(SHA-256(verifier)), per RFC 7636 section 4.2. */
export function pkceChallengeFor(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

/** 32 CSPRNG bytes -> a 43-character verifier, the RFC 7636 minimum length. */
export function createPkce(): Pkce {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: pkceChallengeFor(verifier), method: 'S256' };
}

/** CSPRNG token for `state` and `nonce`. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

// ─── Authorization request ──────────────────────────────────────────────────

export interface AuthorizationUrlInput {
  discovery: DiscoveryDocument;
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
  /**
   * `0` asks for "this transaction's own fresh World proof, even with an existing browser
   * session". Every flow in this package uses 0, because a step-up above the irreversible
   * threshold is exactly that kind of moment.
   */
  maxAge?: number;
  acrValues?: readonly string[];
}

/** The URL to send the human to. The PKCE verifier is never in it. */
export function buildAuthorizationUrl(input: AuthorizationUrlInput): string {
  const url = new URL(input.discovery.authorization_endpoint);
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', WORLD_SCOPE);
  url.searchParams.set('state', input.state);
  url.searchParams.set('nonce', input.nonce);
  url.searchParams.set('code_challenge', input.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (input.maxAge !== undefined) {
    if (!Number.isInteger(input.maxAge) || input.maxAge < 0) {
      throw new RangeError('max_age must be a nonnegative integer');
    }
    url.searchParams.set('max_age', String(input.maxAge));
  }
  if (input.acrValues && input.acrValues.length > 0) {
    url.searchParams.set('acr_values', input.acrValues.join(' '));
  }
  return url.toString();
}

// ─── Callback ───────────────────────────────────────────────────────────────

export interface CallbackParams {
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
  /** RFC 9207 `iss`, checked when present. The guides do not say the OIDC callback sends it. */
  iss?: string;
}

/** Parse the redirect's query. The raw query string itself must never be logged. */
export function parseCallback(input: URL | string | URLSearchParams): CallbackParams {
  const params =
    input instanceof URLSearchParams
      ? input
      : (input instanceof URL ? input : new URL(input, 'https://callback.invalid')).searchParams;
  const out: CallbackParams = {};
  const code = params.get('code');
  const state = params.get('state');
  const error = params.get('error');
  const errorDescription = params.get('error_description');
  const iss = params.get('iss');
  if (code !== null) out.code = code;
  if (state !== null) out.state = state;
  if (error !== null) out.error = error;
  if (errorDescription !== null) out.errorDescription = errorDescription;
  if (iss !== null) out.iss = iss;
  return out;
}

// ─── Token exchange ─────────────────────────────────────────────────────────

export interface TokenResponse {
  id_token: string;
  access_token?: string;
  token_type?: string;
  expires_in?: number;
}

export type TokenExchangeFailure = 'oauth_error' | 'idp_unavailable' | 'malformed_response';

export class TokenExchangeError extends Error {
  constructor(
    readonly kind: TokenExchangeFailure,
    message: string,
    readonly status?: number,
    readonly oauthError?: string,
  ) {
    super(message);
    this.name = 'TokenExchangeError';
  }
}

/** application/x-www-form-urlencoded encoding, as RFC 6749 2.3.1 requires for Basic. */
function formEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, '+');
}

export interface TokenRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/**
 * Build the code-redemption request exactly as the `oidc` guide specifies. This is pure,
 * so its shape is unit-testable without calling anything.
 *  - basic: form-encoded `client_id:secret` in the Authorization header; the body
 *    `client_id` is allowed if it matches.
 *  - post: `client_id` and `client_secret` in the body, no Authorization header.
 *  - "Do not mix authentication methods."
 */
export function buildTokenRequest(
  discovery: DiscoveryDocument,
  config: WorldClientConfig,
  code: string,
  codeVerifier: string,
): TokenRequest {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    code_verifier: codeVerifier,
    client_id: config.clientId,
  });
  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/x-www-form-urlencoded',
  };
  if (config.authMethod === 'client_secret_basic') {
    const creds = `${formEncode(config.clientId)}:${formEncode(config.clientSecret)}`;
    headers['authorization'] = `Basic ${Buffer.from(creds, 'utf8').toString('base64')}`;
  } else {
    body.set('client_secret', config.clientSecret);
  }
  return { url: discovery.token_endpoint, headers, body: body.toString() };
}

/**
 * Redeem the code. Error messages carry the HTTP status and the OAuth `error` code only:
 * never the request body, the secret, or the code.
 */
export async function exchangeCode(input: {
  discovery: DiscoveryDocument;
  config: WorldClientConfig;
  code: string;
  codeVerifier: string;
}): Promise<TokenResponse> {
  const req = buildTokenRequest(input.discovery, input.config, input.code, input.codeVerifier);
  let res: Response;
  try {
    res = await fetch(req.url, {
      method: 'POST',
      headers: req.headers,
      body: req.body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new TokenExchangeError('idp_unavailable', `Token endpoint unreachable: ${describe(error)}`);
  }
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const oauthError = typeof json?.['error'] === 'string' ? (json['error'] as string) : undefined;
    // "HTTP 503 indicates temporary unavailability, never invalid identity."
    if (res.status >= 500 || res.status === 429) {
      throw new TokenExchangeError('idp_unavailable', `Token endpoint HTTP ${res.status}`, res.status, oauthError);
    }
    if (oauthError) {
      throw new TokenExchangeError(
        'oauth_error',
        `Token endpoint rejected the code: HTTP ${res.status} ${oauthError}`,
        res.status,
        oauthError,
      );
    }
    throw new TokenExchangeError('malformed_response', `Token endpoint HTTP ${res.status} without an OAuth error`, res.status);
  }
  if (!json || typeof json['id_token'] !== 'string' || json['id_token'] === '') {
    throw new TokenExchangeError('malformed_response', 'Token response carried no id_token', res.status);
  }
  return json as unknown as TokenResponse;
}

// ─── ID token verification ──────────────────────────────────────────────────

export type IdTokenFailure =
  | 'token_expired'
  | 'token_invalid'
  | 'nonce_mismatch'
  | 'assurance_mismatch'
  | 'jwks_unavailable';

export class IdTokenError extends Error {
  constructor(
    readonly reason: IdTokenFailure,
    message: string,
  ) {
    super(message);
    this.name = 'IdTokenError';
  }
}

/** What a verified sandbox ID token proved. The raw token is not kept. */
export interface VerifiedIdToken {
  issuer: string;
  /** Pairwise subject: stable for this relying party's sector, meaningless elsewhere. */
  sub: string;
  /** Unix seconds: when the human actually proved with World. The freshness signal. */
  authTime: number;
  /** Unix seconds: when this token was minted. Never used for freshness. */
  iat: number;
  exp: number;
  acr: string;
  amr: string[];
  nonce: string;
  jti?: string;
  /** Signing key id from the protected header. */
  kid?: string;
}

/** Cache the remote key set per JWKS URL, as jose intends (bounded refresh, key overlap). */
const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
function remoteKeySet(jwksUri: string): ReturnType<typeof createRemoteJWKSet> {
  let set = keySets.get(jwksUri);
  if (!set) {
    set = createRemoteJWKSet(new URL(jwksUri), { timeoutDuration: REQUEST_TIMEOUT_MS });
    keySets.set(jwksUri, set);
  }
  return set;
}

/** `acr` must be orb-v3 and `amr` must include `pop`. Shared with `stepup-gate.ts`. */
export function assuranceProblem(acr: unknown, amr: unknown, requiredAcr: string = ACR_ORB_V3): string | null {
  if (acr !== requiredAcr) return `acr is ${typeof acr === 'string' ? acr : 'absent'}, required ${requiredAcr}`;
  if (!Array.isArray(amr) || !amr.includes(AMR_PROOF_OF_POSSESSION)) {
    return `amr does not include "${AMR_PROOF_OF_POSSESSION}"`;
  }
  return null;
}

function joseCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

/**
 * Verify an ID token against the IdP's live JWKS (`discovery.jwks_uri`) and nothing else.
 * There is deliberately no parameter for supplying a key.
 *
 * Checks: RS256 signature by a published key, exact `iss`, `aud` = our client id, `exp`
 * (with explicit skew), `nonce` = the one this attempt sent, `acr` = orb-v3, `amr` has
 * `pop`, and `sub`/`auth_time`/`iat` present and well-typed. Freshness policy (how old
 * `auth_time` may be) is the caller's decision; see `stepup-gate.ts`.
 */
export async function verifyIdToken(input: {
  discovery: DiscoveryDocument;
  idToken: string;
  clientId: string;
  expectedNonce: string;
  requiredAcr?: string;
  /** Unix seconds; one clock for jose's `exp` check and the caller's freshness checks. */
  now?: () => number;
}): Promise<VerifiedIdToken> {
  const now = input.now ?? (() => Math.floor(Date.now() / 1000));
  let payload: JWTPayload;
  let kid: string | undefined;
  try {
    const result = await jwtVerify(input.idToken, remoteKeySet(input.discovery.jwks_uri), {
      issuer: input.discovery.issuer,
      audience: input.clientId,
      algorithms: [ID_TOKEN_ALG],
      currentDate: new Date(now() * 1000),
      clockTolerance: CLOCK_SKEW_SECONDS,
      requiredClaims: ['exp', 'iat', 'sub'],
    });
    payload = result.payload;
    kid = result.protectedHeader.kid;
  } catch (error) {
    const code = joseCode(error);
    if (code === 'ERR_JWT_EXPIRED') {
      throw new IdTokenError('token_expired', 'ID token has expired');
    }
    const isJose = code !== undefined && code.startsWith('ERR_');
    if (
      code === 'ERR_JWKS_TIMEOUT' ||
      !isJose ||
      (code === 'ERR_JOSE_GENERIC' && /JSON Web Key Set/.test(describe(error)))
    ) {
      throw new IdTokenError('jwks_unavailable', `Could not load the IdP signing keys: ${describe(error)}`);
    }
    throw new IdTokenError('token_invalid', `ID token did not verify: ${code}: ${describe(error)}`);
  }

  if (typeof payload['nonce'] !== 'string' || payload['nonce'] !== input.expectedNonce) {
    throw new IdTokenError('nonce_mismatch', 'ID token nonce does not match the nonce this attempt sent');
  }
  if (typeof payload.sub !== 'string' || payload.sub === '') {
    throw new IdTokenError('token_invalid', 'ID token has no subject');
  }
  const authTime = payload['auth_time'];
  if (typeof authTime !== 'number' || !Number.isFinite(authTime)) {
    throw new IdTokenError('token_invalid', 'ID token has no numeric auth_time; freshness cannot be established');
  }
  if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number') {
    throw new IdTokenError('token_invalid', 'ID token iat/exp are not numeric');
  }
  const problem = assuranceProblem(payload['acr'], payload['amr'], input.requiredAcr ?? ACR_ORB_V3);
  if (problem) throw new IdTokenError('assurance_mismatch', problem);

  const verified: VerifiedIdToken = {
    issuer: input.discovery.issuer,
    sub: payload.sub,
    authTime,
    iat: payload.iat,
    exp: payload.exp,
    acr: payload['acr'] as string,
    amr: (payload['amr'] as unknown[]).map(String),
    nonce: payload['nonce'],
  };
  if (typeof payload.jti === 'string') verified.jti = payload.jti;
  if (kid !== undefined) verified.kid = kid;
  return verified;
}

export function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

// ─── Proposal-scoped step-up orchestration (Migration PRD D.6) ─────────────

/**
 * PRD D.6's request shape verbatim: a step-up is always for a specific `proposalHash`,
 * with a `reason` shown to the human ("confirm purchase of 2 tickets, $90.00,
 * non-refundable"). Unlike the old Recovery Desk there is no `agentName` — this gates a
 * purchase, not an agent's owner identity.
 */
export interface WorldStepUpRequest {
  proposalHash: Hash32;
  reason: string;
}

export interface InitiateStepUpResult {
  authUrl: string;
  state: string;
}

/**
 * The three outcomes PRD D.6's sketch names, plus what the gate actually needs:
 * `authTimeMs` (freshness, in milliseconds since `auth_time` is Unix seconds and the rest
 * of this codebase's clocks are `Date.now()`-shaped) and a machine-checkable `reason` for
 * the denied case. `stepup-gate.ts` maps every internal `DeniedReason` onto this string, so
 * the reasons named in the task ("access_denied", state/nonce mismatch, replayed code, ...)
 * are exactly the values that land here.
 */
export type HandleCallbackResult =
  | { verified: true; sub: string; authTimeMs: number }
  | { denied: true; reason: string }
  | { expired: true };

export class StepUpFlowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StepUpFlowError';
  }
}

const AGENT_NAME_SAFE_HASH32 = /^0x[0-9a-fA-F]{64}$/;

function requireProposalHash(proposalHash: string): Hash32 {
  if (!AGENT_NAME_SAFE_HASH32.test(proposalHash)) {
    throw new StepUpFlowError(`proposalHash must be a 32-byte 0x-hash, got ${JSON.stringify(proposalHash)}`);
  }
  return proposalHash as Hash32;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * The stateful half of PRD D.6's sketch, bundled into a class so it is constructible with
 * an injected store/discovery/clock for tests, and so the plain `initiateStepUp`/
 * `handleCallback` functions below can be a thin default-singleton wrapper around it for
 * real callers (the console's `/api/stepup` route, `scripts/world-live.ts`).
 *
 * Everything a proposal-scoped attempt needs beyond the pure OIDC layer above — single-use
 * `state`/`nonce`, single-use authorization codes, and an attempt TTL that turns into the
 * `{ expired: true }` outcome — lives here, adapted directly from the old Recovery Desk's
 * `acceptCallback`. What's deliberately NOT here: any concept of an agent, an owner
 * binding, or a LOCKED status. Those belonged to the abandoned Hostage Protocol.
 */
export class WorldStepUpFlow {
  private readonly store: StepUpStore;
  private readonly discovery: DiscoveryDocument;
  private readonly config: () => WorldClientConfig;
  private readonly now: () => number;

  constructor(options: {
    store: StepUpStore;
    discovery: DiscoveryDocument;
    config?: () => WorldClientConfig;
    /** Unix seconds. */
    now?: () => number;
  }) {
    this.store = options.store;
    this.discovery = options.discovery;
    this.config = options.config ?? (() => readWorldClientConfig());
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
  }

  /** Live discovery plus the default JSON-file store, for real (non-test) callers. */
  static async create(options: { store?: StepUpStore; issuer?: string } = {}): Promise<WorldStepUpFlow> {
    const discovery = await discover(options.issuer);
    return new WorldStepUpFlow({ store: options.store ?? new JsonFileStepUpStore(), discovery });
  }

  async initiateStepUp(req: WorldStepUpRequest): Promise<InitiateStepUpResult> {
    const proposalHash = requireProposalHash(req.proposalHash);
    if (!req.reason || req.reason.trim() === '') {
      throw new StepUpFlowError('reason must be a non-empty, human-readable string');
    }
    const config = this.config();
    const now = this.now();
    const pkce = createPkce();
    const attempt: StepUpAttempt = {
      state: randomToken(),
      nonce: randomToken(),
      codeVerifier: pkce.verifier,
      proposalHash,
      reason: req.reason,
      createdAt: now,
    };
    await this.store.update((s) => {
      s.attempts[attempt.state] = attempt;
      s.log.push({ at: now, kind: 'started', proposalHash, detail: req.reason });
    });
    const authUrl = buildAuthorizationUrl({
      discovery: this.discovery,
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      state: attempt.state,
      nonce: attempt.nonce,
      codeChallenge: pkce.challenge,
      maxAge: 0,
      acrValues: [ACR_ORB_V3],
    });
    return { authUrl, state: attempt.state };
  }

  /**
   * Intake a callback, redeem the code at the live token endpoint, verify the ID token
   * against the live JWKS, and record the decision. Server-side only (PRD H.2).
   *
   * The single-use checks (state lookup, code-hash replay, attempt TTL) happen in one
   * atomic store update *before* the code is ever sent to the token endpoint, exactly like
   * the old Recovery Desk's `acceptCallback` — so a duplicated callback can never reach the
   * IdP twice, and a stolen/leaked code that's replayed here is refused without a network
   * call at all.
   */
  async handleCallback(code: string, state: string): Promise<HandleCallbackResult> {
    const now = this.now();
    const intake = await this.store.update((s): { ok: true; attempt: StepUpAttempt } | HandleCallbackResult => {
      const attempt = s.attempts[state];
      const denyIntake = (reason: string, spend: boolean): HandleCallbackResult => {
        if (spend && attempt && attempt.spentAt === undefined) attempt.spentAt = now;
        this.record(s, now, attempt?.proposalHash, false, reason);
        return { denied: true, reason };
      };
      if (state === '' || state === undefined) return denyIntake('state_mismatch', false);
      if (!attempt) return denyIntake('state_mismatch', false);
      if (code === '' || code === undefined) return denyIntake('malformed_callback', true);

      const codeHash = sha256Hex(code);
      if (s.usedCodeHashes[codeHash] !== undefined) {
        attempt.spentAt = attempt.spentAt ?? now;
        this.record(s, now, attempt.proposalHash, false, 'replayed_code');
        return { denied: true, reason: 'replayed_code' };
      }
      if (attempt.spentAt !== undefined) {
        s.usedCodeHashes[codeHash] = now;
        this.record(s, now, attempt.proposalHash, false, 'replayed_nonce');
        return { denied: true, reason: 'replayed_nonce' };
      }
      if (now - attempt.createdAt > ATTEMPT_TTL_SECONDS) {
        attempt.spentAt = now;
        s.usedCodeHashes[codeHash] = now;
        this.record(s, now, attempt.proposalHash, false, 'attempt_expired');
        return { expired: true };
      }
      s.usedCodeHashes[codeHash] = now;
      attempt.spentAt = now;
      return { ok: true, attempt: { ...attempt } };
    });
    if (!('ok' in intake)) return intake;
    const { attempt } = intake;
    const config = this.config();

    let idToken: string;
    try {
      idToken = (await exchangeCode({ discovery: this.discovery, config, code, codeVerifier: attempt.codeVerifier })).id_token;
    } catch (error) {
      if (!(error instanceof TokenExchangeError)) throw error;
      const reason = error.kind === 'idp_unavailable' ? 'idp_unavailable' : error.oauthError === 'access_denied' ? 'access_denied' : 'token_exchange_failed';
      await this.store.update((s) => this.record(s, this.now(), attempt.proposalHash, false, reason));
      return { denied: true, reason };
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
      const doneAt = this.now();
      if (error.reason === 'token_expired') {
        await this.store.update((s) => this.record(s, doneAt, attempt.proposalHash, false, 'token_expired'));
        return { expired: true };
      }
      const reason = error.reason === 'jwks_unavailable' ? 'idp_unavailable' : error.reason;
      await this.store.update((s) => this.record(s, doneAt, attempt.proposalHash, false, reason));
      return { denied: true, reason };
    }

    if (verified.nonce !== attempt.nonce) {
      const doneAt = this.now();
      await this.store.update((s) => this.record(s, doneAt, attempt.proposalHash, false, 'nonce_mismatch'));
      return { denied: true, reason: 'nonce_mismatch' };
    }

    const authTimeMs = verified.authTime * 1000;
    const doneAt = this.now();
    await this.store.update((s) => {
      s.decisions[attempt.proposalHash] = {
        proposalHash: attempt.proposalHash,
        approved: true,
        sub: verified.sub,
        authTimeMs,
        decidedAt: doneAt,
      };
      this.record(s, doneAt, attempt.proposalHash, true);
    });
    return { verified: true, sub: verified.sub, authTimeMs };
  }

  /**
   * The pairwise `sub` itself is never written here, only to `StepUpDecisionRecord.sub`
   * (set directly by the caller, keyed by proposal hash, before this runs) — the append-only
   * log never carries it, matching the old store's "no client secret, no ID token, no
   * access token" discipline one step further.
   */
  private record(s: StepUpState, at: number, proposalHash: Hash32 | undefined, approved: boolean, reason?: string): void {
    if (!approved) {
      s.log.push({ at, kind: 'denied', ...(proposalHash !== undefined ? { proposalHash } : {}), ...(reason !== undefined ? { reason } : {}) });
      if (proposalHash !== undefined) {
        s.decisions[proposalHash] = { proposalHash, approved: false, ...(reason !== undefined ? { reason } : {}), decidedAt: at };
      }
    } else {
      s.log.push({ at, kind: 'approved', ...(proposalHash !== undefined ? { proposalHash } : {}) });
    }
  }
}

// ─── Default-singleton module functions, matching PRD D.6's literal sketch ─

let defaultFlow: Promise<WorldStepUpFlow> | undefined;

function getDefaultFlow(): Promise<WorldStepUpFlow> {
  if (!defaultFlow) defaultFlow = WorldStepUpFlow.create();
  return defaultFlow;
}

/**
 * `initiateStepUp(req): Promise<{ authUrl, state }>` exactly as PRD D.6 sketches it.
 * Builds the real authorize URL with state, nonce, PKCE S256, scope `openid`, reading
 * `WORLD_SANDBOX_CLIENT_ID` and `WORLD_REDIRECT_URI` from the environment at call time —
 * missing values throw a `WorldConfigError` naming exactly which ones. Uses a lazily
 * created, module-level `WorldStepUpFlow` (live discovery + the default JSON-file store);
 * construct a `WorldStepUpFlow` directly instead when a test needs to inject a store,
 * discovery document, or clock.
 */
export async function initiateStepUp(req: WorldStepUpRequest): Promise<InitiateStepUpResult> {
  const flow = await getDefaultFlow();
  return flow.initiateStepUp(req);
}

/**
 * `handleCallback(code, state): Promise<{verified:true,...} | {denied:true,...} | {expired:true}>`
 * exactly as PRD D.6 sketches it (task's exact shape, with `authTimeMs` added to the
 * verified case for `stepup-gate.ts`'s freshness check). Exchanges the code, verifies the
 * id_token against the real live JWKS (iss, aud, exp, nonce, alg RS256), reading
 * `WORLD_SANDBOX_CLIENT_SECRET` at call time. Server-side only.
 */
export async function handleCallback(code: string, state: string): Promise<HandleCallbackResult> {
  const flow = await getDefaultFlow();
  return flow.handleCallback(code, state);
}
