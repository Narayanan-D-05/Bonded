/**
 * Pure-logic tests over `flow.ts`'s own types: PKCE/state generation, authorization-URL
 * and token-request construction, config validation, and discovery-document validation.
 * None of these need the network. Real cryptographic primitives throughout (Node's actual
 * `crypto.randomBytes`/`createHash`, per CLAUDE.md rule 7) — nothing here fabricates a
 * World-signed token.
 *
 * `WorldStepUpFlow`'s intake-only paths (state/nonce replay, attempt TTL) are also covered
 * here with `MemoryStepUpStore`, because they resolve entirely inside one store update and
 * never reach the network — everything past that point (`exchangeCode`, `verifyIdToken`)
 * needs a live call and is exercised instead by `scripts/world-live.ts` and
 * `world-jwks.test.ts`.
 */
import {
  ACR_ORB_V3,
  WORLD_SCOPE,
  WORLD_SANDBOX_ISSUER,
  ATTEMPT_TTL_SECONDS,
  assertDiscoveryUsable,
  buildAuthorizationUrl,
  buildTokenRequest,
  createPkce,
  pkceChallengeFor,
  randomToken,
  readWorldClientConfig,
  WorldConfigError,
  WorldDiscoveryError,
  WorldStepUpFlow,
  type DiscoveryDocument,
  type WorldClientConfig,
} from '../flow.js';
import { MemoryStepUpStore } from '../store.js';

/**
 * The live discovery document's shape, re-probed 2026-09-26 (see FEEDBACK/world.md) — a
 * public, non-secret metadata document, not a credential or a signed token. Used here only
 * so the pure structural checks (`assertDiscoveryUsable`, URL building) don't need a
 * network round trip in every test run.
 */
function fixtureDiscovery(): DiscoveryDocument {
  return {
    issuer: WORLD_SANDBOX_ISSUER,
    authorization_endpoint: 'https://sandbox.auth.world.org/api/v1/authorize',
    token_endpoint: 'https://sandbox.auth.world.org/api/v1/token',
    device_authorization_endpoint: 'https://sandbox.auth.world.org/api/v1/device_authorization',
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'private_key_jwt'],
    jwks_uri: 'https://sandbox.auth.world.org/.well-known/jwks.json',
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'urn:ietf:params:oauth:grant-type:device_code'],
    scopes_supported: ['openid'],
    claims_supported: ['iss', 'sub', 'aud', 'exp', 'iat', 'jti', 'nonce', 'auth_time', 'acr', 'amr'],
    prompt_values_supported: ['none', 'login'],
    acr_values_supported: [ACR_ORB_V3],
    subject_types_supported: ['pairwise'],
    id_token_signing_alg_values_supported: ['RS256'],
    code_challenge_methods_supported: ['S256'],
    request_uri_parameter_supported: false,
  };
}

const CONFIG: WorldClientConfig = {
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  redirectUri: 'https://example.invalid/callback',
  authMethod: 'client_secret_basic',
};

describe('PKCE and token generation (real crypto)', () => {
  test('createPkce produces a verifier at least the RFC 7636 minimum length', () => {
    const pkce = createPkce();
    expect(pkce.verifier.length).toBeGreaterThanOrEqual(43);
    expect(pkce.method).toBe('S256');
  });

  test('pkceChallengeFor is deterministic and matches createPkce', () => {
    const pkce = createPkce();
    expect(pkceChallengeFor(pkce.verifier)).toBe(pkce.challenge);
  });

  test('pkceChallengeFor(verifier) is base64url with no padding', () => {
    const challenge = pkceChallengeFor('abc');
    expect(challenge).not.toMatch(/[+/=]/);
  });

  test('two PKCE pairs never collide', () => {
    const a = createPkce();
    const b = createPkce();
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.challenge).not.toBe(b.challenge);
  });

  test('randomToken defaults to 32 bytes -> 43-char base64url and is unique per call', () => {
    const a = randomToken();
    const b = randomToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(a).not.toMatch(/[+/=]/);
  });
});

describe('buildAuthorizationUrl', () => {
  test('scope is exactly openid, method is S256, max_age=0 is sent', () => {
    const url = new URL(
      buildAuthorizationUrl({
        discovery: fixtureDiscovery(),
        clientId: 'cid',
        redirectUri: 'https://example.invalid/callback',
        state: 'state-1',
        nonce: 'nonce-1',
        codeChallenge: 'chal-1',
        maxAge: 0,
        acrValues: [ACR_ORB_V3],
      }),
    );
    expect(url.origin + url.pathname).toBe('https://sandbox.auth.world.org/api/v1/authorize');
    expect(url.searchParams.get('scope')).toBe(WORLD_SCOPE);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe('chal-1');
    expect(url.searchParams.get('state')).toBe('state-1');
    expect(url.searchParams.get('nonce')).toBe('nonce-1');
    expect(url.searchParams.get('max_age')).toBe('0');
    expect(url.searchParams.get('acr_values')).toBe(ACR_ORB_V3);
  });

  test('the PKCE verifier never appears in the URL', () => {
    const pkce = createPkce();
    const url = buildAuthorizationUrl({
      discovery: fixtureDiscovery(),
      clientId: 'cid',
      redirectUri: 'https://example.invalid/callback',
      state: 's',
      nonce: 'n',
      codeChallenge: pkce.challenge,
    });
    expect(url).not.toContain(pkce.verifier);
  });

  test('rejects a negative or non-integer max_age', () => {
    const base = {
      discovery: fixtureDiscovery(),
      clientId: 'cid',
      redirectUri: 'https://example.invalid/callback',
      state: 's',
      nonce: 'n',
      codeChallenge: 'c',
    };
    expect(() => buildAuthorizationUrl({ ...base, maxAge: -1 })).toThrow(RangeError);
    expect(() => buildAuthorizationUrl({ ...base, maxAge: 1.5 })).toThrow(RangeError);
  });
});

describe('buildTokenRequest', () => {
  test('client_secret_basic puts credentials in the Authorization header, not the body', () => {
    const req = buildTokenRequest(fixtureDiscovery(), CONFIG, 'code-1', 'verifier-1');
    expect(req.headers['authorization']).toMatch(/^Basic /);
    expect(req.body).not.toContain('client_secret');
    expect(req.body).toContain('code_verifier=verifier-1');
    expect(req.body).toContain('grant_type=authorization_code');
  });

  test('client_secret_post puts the secret in the body and sends no Authorization header', () => {
    const postConfig: WorldClientConfig = { ...CONFIG, authMethod: 'client_secret_post' };
    const req = buildTokenRequest(fixtureDiscovery(), postConfig, 'code-1', 'verifier-1');
    expect(req.headers['authorization']).toBeUndefined();
    expect(req.body).toContain(`client_secret=${postConfig.clientSecret}`);
  });
});

describe('readWorldClientConfig', () => {
  test('missing env vars throw and name exactly which ones', () => {
    try {
      readWorldClientConfig({});
      throw new Error('expected readWorldClientConfig to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(WorldConfigError);
      const e = error as InstanceType<typeof WorldConfigError>;
      expect(e.missing).toEqual(['WORLD_SANDBOX_CLIENT_ID', 'WORLD_SANDBOX_CLIENT_SECRET', 'WORLD_REDIRECT_URI']);
      expect(e.message).toContain('WORLD_SANDBOX_CLIENT_ID');
      expect(e.message).toContain('WORLD_SANDBOX_CLIENT_SECRET');
      expect(e.message).toContain('WORLD_REDIRECT_URI');
    }
  });

  test('an http redirect URI is rejected before ever reaching the IdP', () => {
    expect(() =>
      readWorldClientConfig({
        WORLD_SANDBOX_CLIENT_ID: 'id',
        WORLD_SANDBOX_CLIENT_SECRET: 'secret',
        WORLD_REDIRECT_URI: 'http://localhost:3000/callback',
      }),
    ).toThrow(WorldConfigError);
  });

  test('a well-formed https config parses, defaulting authMethod to client_secret_basic', () => {
    const cfg = readWorldClientConfig({
      WORLD_SANDBOX_CLIENT_ID: 'id',
      WORLD_SANDBOX_CLIENT_SECRET: 'secret',
      WORLD_REDIRECT_URI: 'https://example.invalid/callback',
    });
    expect(cfg.authMethod).toBe('client_secret_basic');
    expect(cfg.redirectUri).toBe('https://example.invalid/callback');
  });
});

describe('assertDiscoveryUsable', () => {
  test('accepts the live discovery shape', () => {
    expect(() => assertDiscoveryUsable(fixtureDiscovery())).not.toThrow();
  });

  test('rejects a discovery document missing PKCE S256', () => {
    const bad = { ...fixtureDiscovery(), code_challenge_methods_supported: ['plain'] };
    expect(() => assertDiscoveryUsable(bad)).toThrow(WorldDiscoveryError);
  });

  test('rejects a discovery document with the wrong issuer', () => {
    const bad = { ...fixtureDiscovery(), issuer: 'https://not-world.invalid' };
    expect(() => assertDiscoveryUsable(bad, WORLD_SANDBOX_ISSUER)).toThrow(WorldDiscoveryError);
  });
});

describe('WorldStepUpFlow — intake-only paths (no network)', () => {
  const HASH = '0x' + '11'.repeat(32) as `0x${string}`;

  function makeFlow() {
    return new WorldStepUpFlow({
      store: new MemoryStepUpStore(),
      discovery: fixtureDiscovery(),
      now: () => 1_000_000,
      config: () => CONFIG,
    });
  }

  test('initiateStepUp rejects a malformed proposalHash', async () => {
    const flow = makeFlow();
    await expect(flow.initiateStepUp({ proposalHash: '0xnothex' as `0x${string}`, reason: 'x' })).rejects.toThrow();
  });

  test('initiateStepUp rejects an empty reason', async () => {
    const flow = makeFlow();
    await expect(flow.initiateStepUp({ proposalHash: HASH, reason: '' })).rejects.toThrow();
  });

  test('handleCallback denies an unknown state (state_mismatch)', async () => {
    const flow = makeFlow();
    const result = await flow.handleCallback('some-code', 'never-issued-state');
    expect(result).toEqual({ denied: true, reason: 'state_mismatch' });
  });

  test('handleCallback denies a callback with no code (malformed_callback)', async () => {
    const flow = makeFlow();
    const { state } = await flow.initiateStepUp({ proposalHash: HASH, reason: 'confirm purchase' });
    const result = await flow.handleCallback('', state);
    expect(result).toEqual({ denied: true, reason: 'malformed_callback' });
  });

  test('handleCallback denies a replayed authorization code', async () => {
    const store = new MemoryStepUpStore();
    let now = 1_000_000;
    const flow = new WorldStepUpFlow({ store, discovery: fixtureDiscovery(), now: () => now, config: () => CONFIG });
    const { state } = await flow.initiateStepUp({ proposalHash: HASH, reason: 'confirm purchase' });
    // First presentation marks the code's hash used, then fails downstream because there is
    // no live token endpoint reachable in this test — that failure still consumes the
    // attempt, so the second presentation of the SAME code must be refused as a replay
    // before any network call is attempted.
    await flow.handleCallback('same-code', state).catch(() => undefined);
    const replay = await flow.handleCallback('same-code', state);
    expect(replay).toEqual({ denied: true, reason: 'replayed_code' });
  });

  test('handleCallback expires an attempt older than ATTEMPT_TTL_SECONDS', async () => {
    const store = new MemoryStepUpStore();
    let now = 1_000_000;
    const flow = new WorldStepUpFlow({ store, discovery: fixtureDiscovery(), now: () => now, config: () => CONFIG });
    const { state } = await flow.initiateStepUp({ proposalHash: HASH, reason: 'confirm purchase' });
    now += ATTEMPT_TTL_SECONDS + 1;
    const result = await flow.handleCallback('late-code', state);
    expect(result).toEqual({ expired: true });
  });

  test(
    'handleCallback does not expire an attempt exactly at the TTL boundary minus one second ' +
      '(live: this makes one real, uncredentialed POST to the sandbox token endpoint, which ' +
      "correctly refuses it as an OAuth error — never a mocked response, per CLAUDE.md rule 7)",
    async () => {
      const store = new MemoryStepUpStore();
      let now = 1_000_000;
      const flow = new WorldStepUpFlow({
        store,
        discovery: fixtureDiscovery(),
        now: () => now,
        config: () => CONFIG,
      });
      const { state } = await flow.initiateStepUp({ proposalHash: HASH, reason: 'confirm purchase' });
      now += ATTEMPT_TTL_SECONDS - 1;
      const result = await flow.handleCallback('boundary-code-not-a-real-code', state);
      // A bogus client/code is correctly refused by the real IdP as an OAuth error, not as
      // this package's own attempt-TTL expiry — that is the one thing this test pins. The
      // exact OAuth error the live sandbox picks for a nonexistent client (invalid_client vs
      // invalid_grant) is not itself pinned here — only that it is a real, non-2xx, denied
      // outcome, not a false "expired".
      expect(result).not.toEqual({ expired: true });
      expect(result).toMatchObject({ denied: true });
    },
  );
});
