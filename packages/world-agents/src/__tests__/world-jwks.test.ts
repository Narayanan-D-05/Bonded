/**
 * Verifier-against-real-JWKS test (docs/VERIFY_FINDINGS.md item 3a; PRD G "World flow" row).
 *
 * This test fetches the REAL, live sandbox discovery document and its REAL, live JWKS —
 * network calls, not fixtures. It then builds a JWT whose CLAIMS look like a genuine World
 * ID token (same issuer, same claim names, same `acr`/`amr`), but which is SIGNED WITH A
 * LOCALLY GENERATED RSA KEY that has nothing to do with World — clearly not a World-issued
 * credential, and never treated as one. The only thing asserted is REJECTION:
 * `verifyIdToken` must refuse it, because it does not actually carry a valid signature from
 * the key `https://sandbox.auth.world.org/.well-known/jwks.json` publishes.
 *
 * This is deliberately NOT the thing CLAUDE.md rule 7 forbids ("no self-signed World
 * tokens standing in for a real sandbox token"): it never asserts `verified`, only
 * `rejected`, and the token is clearly local/fake in every claim and in this file's own
 * name. What it tests is OUR rejection logic against REAL key material — a different thing
 * from fabricating an approval.
 */
import { generateKeyPair, SignJWT } from 'jose';
import {
  ACR_ORB_V3,
  AMR_PROOF_OF_POSSESSION,
  IdTokenError,
  discover,
  verifyIdToken,
  type DiscoveryDocument,
} from '../flow.js';

const LIVE_NETWORK_TIMEOUT_MS = 20_000;

describe('verifyIdToken against the real live sandbox JWKS (network)', () => {
  let discovery: DiscoveryDocument;

  beforeAll(async () => {
    discovery = await discover();
  }, LIVE_NETWORK_TIMEOUT_MS);

  test('the live discovery document still matches VERIFY_FINDINGS 3a (no drift)', () => {
    expect(discovery.issuer).toBe('https://sandbox.auth.world.org');
    expect(discovery.scopes_supported).toEqual(['openid']);
    expect(discovery.code_challenge_methods_supported).toEqual(['S256']);
    expect(discovery.id_token_signing_alg_values_supported).toEqual(['RS256']);
    expect(discovery.subject_types_supported).toEqual(['pairwise']);
    expect(discovery.acr_values_supported).toEqual([ACR_ORB_V3]);
    expect(discovery.jwks_uri).toBe('https://sandbox.auth.world.org/.well-known/jwks.json');
  });

  test(
    'a token signed by a locally generated, clearly-not-World RSA key (kid spoofed to the real key id) is rejected as token_invalid',
    async () => {
      // Fetch the real JWKS directly (a second, independent live call from the one inside
      // verifyIdToken) purely to read the real key's `kid`, so the forged token's header can
      // deliberately claim to be that key — the sharper negative test: jose must actually
      // attempt and fail the cryptographic signature check, not just fail to find a
      // same-named key.
      const jwksRes = await fetch(discovery.jwks_uri, { signal: AbortSignal.timeout(LIVE_NETWORK_TIMEOUT_MS) });
      expect(jwksRes.ok).toBe(true);
      const jwks = (await jwksRes.json()) as { keys: Array<{ kid: string }> };
      expect(jwks.keys.length).toBeGreaterThan(0);
      const realKid = jwks.keys[0]!.kid;

      // A locally generated RSA key pair. Not World's. Never claimed to be.
      const { privateKey } = await generateKeyPair('RS256', { extractable: true });

      const nowSec = Math.floor(Date.now() / 1000);
      const fakeIdToken = await new SignJWT({
        nonce: 'test-nonce-not-a-real-attempt',
        auth_time: nowSec,
        acr: ACR_ORB_V3,
        amr: [AMR_PROOF_OF_POSSESSION],
      })
        .setProtectedHeader({ alg: 'RS256', kid: realKid })
        .setIssuer(discovery.issuer) // matches the real issuer on purpose — everything else about this token is fake except the claim VALUES; the point is the SIGNATURE is not World's.
        .setAudience('test-client-id-not-a-real-world-client')
        .setSubject('test-sub-not-a-real-human')
        .setIssuedAt(nowSec)
        .setExpirationTime(nowSec + 300)
        .sign(privateKey);

      await expect(
        verifyIdToken({
          discovery,
          idToken: fakeIdToken,
          clientId: 'test-client-id-not-a-real-world-client',
          expectedNonce: 'test-nonce-not-a-real-attempt',
        }),
      ).rejects.toMatchObject({ reason: 'token_invalid' });
    },
    LIVE_NETWORK_TIMEOUT_MS,
  );

  test('a token with an unrecognized kid is also rejected (never silently accepted by falling back to another key)', async () => {
    const { privateKey } = await generateKeyPair('RS256', { extractable: true });
    const nowSec = Math.floor(Date.now() / 1000);
    const fakeIdToken = await new SignJWT({
      nonce: 'test-nonce-2',
      auth_time: nowSec,
      acr: ACR_ORB_V3,
      amr: [AMR_PROOF_OF_POSSESSION],
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'not-a-real-kid-deliberately-unknown' })
      .setIssuer(discovery.issuer)
      .setAudience('test-client-id-not-a-real-world-client')
      .setSubject('test-sub-not-a-real-human')
      .setIssuedAt(nowSec)
      .setExpirationTime(nowSec + 300)
      .sign(privateKey);

    await expect(
      verifyIdToken({
        discovery,
        idToken: fakeIdToken,
        clientId: 'test-client-id-not-a-real-world-client',
        expectedNonce: 'test-nonce-2',
      }),
    ).rejects.toBeInstanceOf(IdTokenError);
  });
});
