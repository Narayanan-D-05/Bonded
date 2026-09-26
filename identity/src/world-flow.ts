/**
 * World ID for Agents: the OIDC relying-party flow. Server-side only.
 *
 * PRD Part H, World row 2: "Validate in a secure backend." Nothing in this file may be
 * imported into browser code. It reads the confidential client's secret from the
 * environment, holds the PKCE verifier, and redeems the authorization code. None of
 * those three may ever reach a browser.
 *
 * Every endpoint, value and claim below was confirmed against the live sandbox, not
 * assumed. The discovery document and JWKS were re-fetched 2026-09-25 23:44 UTC, and the
 * public `oidc` and `step-up` guides were re-read through the sandbox MCP `get_idp_guide`:
 *
 *   issuer                      https://sandbox.auth.world.org
 *   authorization_endpoint      /api/v1/authorize        (code flow, query response mode)
 *   token_endpoint              /api/v1/token            (client_secret_basic | _post | private_key_jwt)
 *   jwks_uri                    /.well-known/jwks.json   (one RSA-2048 RS256 key, kid = RFC 7638 thumbprint)
 *   scopes_supported            ["openid"]               ("exactly scope=openid")
 *   code_challenge_methods      ["S256"]
 *   id_token_signing_alg        ["RS256"]
 *   subject_types_supported     ["pairwise"]
 *   acr_values_supported        ["https://world.org/oidc/acr/orb-v3"]
 *   no userinfo_endpoint        ("read claims from the validated ID token")
 *
 * From the guides:
 *   - "Codes are single-use and last five minutes." "ID tokens last five minutes."
 *   - The ID token carries iss, sub, aud, exp, iat, jti, auth_time, acr and amr. It
 *     "includes nonce only when supplied in the authorization request". This flow always
 *     supplies one.
 *   - "Use auth_time for freshness, never iat."
 *   - Step-up: "max_age=0: Require this transaction's own fresh World proof, even with an
 *     existing browser session." "acr_values: Voluntary preferences ... validate the
 *     achieved acr yourself." "amr is ["pop"]."
 *   - "Dependency failures must remain distinguishable from invalid authentication."
 *   - "Never log request bodies, Authorization headers, or callback query strings."
 */

import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

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
   * session". Every flow in this package uses 0, because both are human moments.
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

/** `acr` must be orb-v3 and `amr` must include `pop`. Shared with the Recovery Desk. */
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
 * `auth_time` may be) is the caller's decision; see `recovery-desk.ts`.
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
