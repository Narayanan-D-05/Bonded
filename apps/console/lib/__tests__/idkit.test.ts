/**
 * The vendor side of a bank change: signal construction, the append-only request store, the AP
 * gate's matching, the IDKit config, the server's pre-verify envelope checks, and every
 * `submitVendorBankChange` failure path recording nothing.
 *
 * CLAUDE.md rule 7, stated plainly: NO IDKit proof and NO World verify response is constructed
 * anywhere in this file.
 *  - `envelope(...)` builds only the non-proof ENVELOPE fields our own pre-checks read (protocol,
 *    action, environment, identifier, signal_hash, nullifier placeholder). It has no `proof` field,
 *    so it is not, and cannot pass for, an IDKit proof; it exists to show the server refuses a
 *    mismatched envelope BEFORE World is ever asked.
 *  - The only `fetch` used is a stub that records the request and then fails like a network error.
 *    It never returns a World-shaped answer, so the success path (World answers 200) is never
 *    exercised here; it is proven live by the user against World (README "World — IDKit").
 */
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { hashSignal } from '@worldcoin/idkit-core/hashing';
import { fetchVendorTruth } from '@bonded/issuer-oracle';
import {
  IDKIT_ENV,
  checkIdkitEnvelope,
  interpretVerifyResponse,
  nullifierToDecimal,
  readIdkitConfig,
  submitVendorBankChange,
  verifyUrl,
  type SubmitDeps,
} from '../idkit.js';
import {
  DuplicateVendorRequestError,
  VendorBankChangeInputError,
  VendorRequestStoreError,
  appendVerifiedVendorBankChangeRequest,
  buildVendorBankChangeSignal,
  checkVendorRequestGate,
  readVendorBankChangeRequests,
  sameFieldElement,
  type VerifiedVendorBankChangeRequest,
} from '../vendor-bank-change.js';
import { HALCYON_NEW_BANK_PAYOUT_ADDRESS } from '../enforce-deps.js';

const HALCYON = 'vnd-halcyon-machining';
const HALCYON_EVM = '0xbae3858539c96526d2bd0a89c95a6c98caeb683a';
const OTHER_PAYOUT = `0x${'ab'.repeat(32)}`;

/** Our own test config values. Obviously not real portal ids; nothing here is sent anywhere real. */
const TEST_ENV = {
  [IDKIT_ENV.appId]: 'app_test_not_a_real_app',
  [IDKIT_ENV.rpId]: 'rp_test_not_a_real_rp',
  [IDKIT_ENV.action]: 'vendor-bank-change',
  [IDKIT_ENV.environment]: 'staging',
};

const claim = { vendorId: HALCYON, newPayoutAddress: HALCYON_NEW_BANK_PAYOUT_ADDRESS, newEvmAddress: HALCYON_EVM };

/** Envelope fields only. No `proof` field: see the file header. */
function envelope(over: { protocol?: '3.0' | '4.0'; action?: string; environment?: string; identifier?: string; issuerSchemaId?: number; signalHash?: string; extra?: object } = {}) {
  const protocol = over.protocol ?? '4.0';
  return {
    protocol_version: protocol,
    nonce: 'test-envelope-not-a-proof',
    action: over.action ?? 'vendor-bank-change',
    environment: over.environment ?? 'staging',
    responses: [
      {
        identifier: over.identifier ?? (protocol === '4.0' ? 'passport' : 'document'),
        ...(protocol === '4.0' ? { issuer_schema_id: over.issuerSchemaId ?? 9303 } : {}),
        signal_hash: over.signalHash ?? hashSignal(buildVendorBankChangeSignal(claim)),
        nullifier: '0x1',
      },
    ],
    ...(over.extra ?? {}),
  };
}

function tempStore(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), 'bonded-idkit-')), 'vendor-bank-change-requests.json');
}

function record(over: Partial<VerifiedVendorBankChangeRequest> = {}): VerifiedVendorBankChangeRequest {
  const c = { vendorId: over.vendorId ?? HALCYON, newPayoutAddress: over.newPayoutAddress ?? HALCYON_NEW_BANK_PAYOUT_ADDRESS, newEvmAddress: over.newEvmAddress ?? HALCYON_EVM };
  const signal = buildVendorBankChangeSignal(c);
  // TEST-ONLY record in our own store format (placeholder nullifier); see enforce-deps.test.ts.
  return {
    ...c,
    signal,
    signalHash: hashSignal(signal),
    action: 'vendor-bank-change',
    environment: 'staging',
    protocolVersion: '4.0',
    credentialType: 'passport',
    issuerSchemaId: 9303,
    nullifier: '1',
    verifiedAtMs: 1_790_400_000_000,
    ...over,
  };
}

describe('signal', () => {
  it('binds vendorId + new payout address + new EVM identity, lower-cased, deterministic', () => {
    const s = buildVendorBankChangeSignal(claim);
    expect(s).toBe(`bonded-vendor-bank-change:v1|${HALCYON}|${HALCYON_NEW_BANK_PAYOUT_ADDRESS}|${HALCYON_EVM}`);
    expect(buildVendorBankChangeSignal({ ...claim, newPayoutAddress: HALCYON_NEW_BANK_PAYOUT_ADDRESS.toUpperCase().replace('0X', '0x') })).toBe(s);
  });

  it('a different payout address or EVM identity gives a different signal hash (no cross-address replay)', () => {
    const h = hashSignal(buildVendorBankChangeSignal(claim));
    expect(hashSignal(buildVendorBankChangeSignal({ ...claim, newPayoutAddress: OTHER_PAYOUT }))).not.toBe(h);
    expect(hashSignal(buildVendorBankChangeSignal({ ...claim, newEvmAddress: `0x${'11'.repeat(20)}` }))).not.toBe(h);
    expect(hashSignal(buildVendorBankChangeSignal({ ...claim, vendorId: 'vnd-globex-freight' }))).not.toBe(h);
  });

  it('rejects malformed fields, naming the field', () => {
    const bad = (c: object, field: string) => {
      try {
        buildVendorBankChangeSignal(c as typeof claim);
      } catch (e) {
        expect(e).toBeInstanceOf(VendorBankChangeInputError);
        expect((e as VendorBankChangeInputError).field).toBe(field);
        return;
      }
      throw new Error('expected a VendorBankChangeInputError');
    };
    bad({ ...claim, vendorId: 'halcyon' }, 'vendorId');
    bad({ ...claim, newPayoutAddress: HALCYON_EVM }, 'newPayoutAddress');
    bad({ ...claim, newEvmAddress: HALCYON_NEW_BANK_PAYOUT_ADDRESS }, 'newEvmAddress');
    bad({ vendorId: HALCYON, newPayoutAddress: HALCYON_NEW_BANK_PAYOUT_ADDRESS }, 'newEvmAddress');
  });

  it('compares field elements numerically ("0x0" equals a zero-padded hash)', () => {
    expect(sameFieldElement('0x0', `0x${'00'.repeat(32)}`)).toBe(true);
    expect(sameFieldElement('0x01', '0x1')).toBe(true);
    expect(sameFieldElement('0x1', '0x2')).toBe(false);
    expect(sameFieldElement('nope', '0x2')).toBe(false);
  });
});

describe('request store (append-only)', () => {
  it('appends and reads back; a replay of the same request is refused and writes nothing', async () => {
    const p = tempStore();
    expect(await readVendorBankChangeRequests(p)).toEqual([]);
    await appendVerifiedVendorBankChangeRequest(p, record());
    await expect(appendVerifiedVendorBankChangeRequest(p, record({ verifiedAtMs: 1_790_400_000_001 }))).rejects.toBeInstanceOf(DuplicateVendorRequestError);
    expect(await readVendorBankChangeRequests(p)).toHaveLength(1);
    // The same person may file a DIFFERENT change (a vendor can change banks twice).
    await appendVerifiedVendorBankChangeRequest(p, record({ newPayoutAddress: OTHER_PAYOUT }));
    expect(await readVendorBankChangeRequests(p)).toHaveLength(2);
  });

  it('refuses an entry whose signal does not bind its own fields, and never resets a corrupt file', async () => {
    const p = tempStore();
    await expect(appendVerifiedVendorBankChangeRequest(p, { ...record(), newPayoutAddress: OTHER_PAYOUT })).rejects.toBeInstanceOf(VendorRequestStoreError);
    await expect(appendVerifiedVendorBankChangeRequest(p, { ...record(), nullifier: '0xabc' })).rejects.toThrow(/decimal/);
    expect(existsSync(p)).toBe(false);
    writeFileSync(p, '{not json', 'utf8');
    await expect(readVendorBankChangeRequests(p)).rejects.toBeInstanceOf(VendorRequestStoreError);
    await expect(appendVerifiedVendorBankChangeRequest(p, record())).rejects.toBeInstanceOf(VendorRequestStoreError);
  });
});

describe('the AP gate (pure matching)', () => {
  const input = { vendorId: HALCYON, claimedPayoutAddress: HALCYON_NEW_BANK_PAYOUT_ADDRESS, claimedEvmAddress: HALCYON_EVM, payoutAddressLastChangedAt: 1_743_465_600 };

  it('matches vendor + payout + EVM identity exactly (case-insensitive), newest first', () => {
    const older = record({ verifiedAtMs: 1_790_000_000_000 });
    const newer = record({ verifiedAtMs: 1_790_500_000_000, nullifier: '2' });
    const r = checkVendorRequestGate([older, newer], { ...input, claimedPayoutAddress: HALCYON_NEW_BANK_PAYOUT_ADDRESS.toUpperCase().replace('0X', '0x') });
    expect(r).toEqual({ ok: true, request: newer });
  });

  it('denies no_verified_vendor_request with the reason, for none / wrong payout / wrong EVM / other vendor / stale', () => {
    expect(checkVendorRequestGate([], input)).toMatchObject({ ok: false, reason: 'no_verified_vendor_request', detail: expect.stringMatching(/No IDKit-verified/) });
    for (const r of [
      record({ newPayoutAddress: OTHER_PAYOUT }),
      record({ newEvmAddress: `0x${'11'.repeat(20)}` }),
      record({ vendorId: 'vnd-globex-freight' }),
      record({ verifiedAtMs: input.payoutAddressLastChangedAt * 1000 }),
    ]) {
      expect(checkVendorRequestGate([r], input)).toMatchObject({ ok: false, reason: 'no_verified_vendor_request' });
    }
  });
});

describe('IDKit config', () => {
  it('names every missing variable; the signing key only when signing', () => {
    expect(readIdkitConfig({}, { needSigningKey: false })).toEqual({
      ok: false,
      missing: ['WORLD_IDKIT_APP_ID', 'WORLD_IDKIT_RP_ID', 'WORLD_IDKIT_ACTION', 'WORLD_IDKIT_ENVIRONMENT'],
      invalid: [],
    });
    expect(readIdkitConfig(TEST_ENV, { needSigningKey: true })).toEqual({ ok: false, missing: ['WORLD_IDKIT_SIGNING_KEY'], invalid: [] });
    expect(readIdkitConfig(TEST_ENV, { needSigningKey: false })).toMatchObject({ ok: true, config: { environment: 'staging', action: 'vendor-bank-change' } });
  });

  it('names malformed variables without echoing their values', () => {
    const r = readIdkitConfig({ ...TEST_ENV, [IDKIT_ENV.appId]: 'secretish-value', [IDKIT_ENV.environment]: 'prod' }, { needSigningKey: false });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toMatch(/secretish-value|"prod"/);
    expect(!r.ok && r.invalid).toEqual(['WORLD_IDKIT_APP_ID (must start with app_)', 'WORLD_IDKIT_ENVIRONMENT (must be one of production, staging, sandbox)']);
  });
});

describe('pre-verify envelope checks (never vouch for a proof)', () => {
  const expected = { action: 'vendor-bank-change', environment: 'staging', signalHash: hashSignal(buildVendorBankChangeSignal(claim)) };

  it('refuses each mismatch with a distinct reason', () => {
    expect(checkIdkitEnvelope(null, expected)).toMatchObject({ ok: false, reason: 'malformed_result' });
    expect(checkIdkitEnvelope(envelope({ extra: { session_id: 'session_x' } }), expected)).toMatchObject({ ok: false, reason: 'session_proof_not_accepted' });
    expect(checkIdkitEnvelope(envelope({ action: 'some-other-action' }), expected)).toMatchObject({ ok: false, reason: 'action_mismatch' });
    expect(checkIdkitEnvelope(envelope({ environment: 'production' }), expected)).toMatchObject({ ok: false, reason: 'environment_mismatch' });
    expect(checkIdkitEnvelope(envelope({ identifier: 'proof_of_human', issuerSchemaId: 1 }), expected)).toMatchObject({ ok: false, reason: 'credential_not_accepted' });
    expect(checkIdkitEnvelope(envelope({ identifier: 'selfie', issuerSchemaId: 11 }), expected)).toMatchObject({ ok: false, reason: 'credential_not_accepted' });
    expect(checkIdkitEnvelope(envelope({ identifier: 'passport', issuerSchemaId: 1 }), expected)).toMatchObject({ ok: false, reason: 'credential_not_accepted' });
    expect(checkIdkitEnvelope(envelope({ protocol: '3.0', identifier: 'device' }), expected)).toMatchObject({ ok: false, reason: 'credential_not_accepted' });
    const otherSignal = hashSignal(buildVendorBankChangeSignal({ ...claim, newPayoutAddress: OTHER_PAYOUT }));
    expect(checkIdkitEnvelope(envelope({ signalHash: otherSignal }), expected)).toMatchObject({ ok: false, reason: 'signal_mismatch' });
    expect(checkIdkitEnvelope(envelope({ signalHash: '0x0' }), expected)).toMatchObject({ ok: false, reason: 'signal_mismatch' });
  });

  it('a matching envelope only passes the PRE-check (4.0 passport, or the 3.0 document fallback); World still decides', () => {
    expect(checkIdkitEnvelope(envelope(), expected)).toEqual({ ok: true, protocolVersion: '4.0', credentialType: 'passport', issuerSchemaId: 9303, nullifierHex: '0x1' });
    expect(checkIdkitEnvelope(envelope({ protocol: '3.0' }), expected)).toMatchObject({ ok: true, protocolVersion: '3.0', credentialType: 'document', issuerSchemaId: null });
  });

  it('reads anything other than 200 + success:true as not verified', () => {
    const exp = { environment: 'staging', credentialType: 'passport', envelopeNullifierHex: '0x1' };
    expect(interpretVerifyResponse(502, null, exp)).toMatchObject({ ok: false, reason: 'verify_rejected', detail: 'HTTP 502' });
    expect(interpretVerifyResponse(200, null, exp)).toMatchObject({ ok: false, reason: 'verify_rejected' });
    expect(interpretVerifyResponse(200, 'ok', exp)).toMatchObject({ ok: false, reason: 'verify_rejected' });
    expect(nullifierToDecimal('0xff')).toBe('255');
  });
});

describe('submitVendorBankChange: every failure path records nothing', () => {
  function deps(over: Partial<SubmitDeps> = {}): SubmitDeps & { calls: Array<{ url: string; body: string }> } {
    const calls: Array<{ url: string; body: string }> = [];
    return {
      env: TEST_ENV,
      // Records the request, then fails like a network error. Never answers as World.
      fetch: (async (url: string, init?: RequestInit) => {
        calls.push({ url, body: String(init?.body) });
        throw new TypeError('fetch failed (test stub: no network)');
      }) as unknown as typeof fetch,
      vendorSource: fetchVendorTruth,
      storePath: tempStore(),
      now: () => 1_790_400_000_000,
      calls,
      ...over,
    };
  }
  const body = (over: object = {}) => ({ ...claim, idkitResult: envelope(), ...over });

  it('missing env: 501 naming the variables; World never called', async () => {
    const d = deps({ env: {} });
    const r = await submitVendorBankChange(body(), d);
    expect(r).toMatchObject({ ok: false, status: 501, reason: 'missing_env' });
    expect(!r.ok && r.missingEnv).toEqual(['WORLD_IDKIT_APP_ID', 'WORLD_IDKIT_RP_ID', 'WORLD_IDKIT_ACTION', 'WORLD_IDKIT_ENVIRONMENT']);
    expect(d.calls).toHaveLength(0);
    expect(existsSync(d.storePath)).toBe(false);
  });

  it.each([
    ['invalid_request', { newPayoutAddress: 'not-an-address' }],
    ['unknown_vendor', { vendorId: 'vnd-nobody' }],
    ['payout_unchanged', { newPayoutAddress: '0x37bd5261f170c24c66550dc7c086fcd3c2c29ec5ae2f5fc587acd3ee7d642289' }],
    ['signal_mismatch', { newPayoutAddress: OTHER_PAYOUT }],
    ['action_mismatch', { idkitResult: envelope({ action: 'another-action' }) }],
    ['environment_mismatch', { idkitResult: envelope({ environment: 'production' }) }],
    ['credential_not_accepted', { idkitResult: envelope({ identifier: 'proof_of_human', issuerSchemaId: 1 }) }],
    ['session_proof_not_accepted', { idkitResult: envelope({ extra: { session_id: 'session_x' } }) }],
    ['malformed_result', { idkitResult: undefined }],
  ])('%s: refused before World is asked; nothing recorded', async (reason, over) => {
    const d = deps();
    const r = await submitVendorBankChange(body(over), d);
    expect(r).toMatchObject({ ok: false, reason });
    expect(d.calls).toHaveLength(0);
    expect(existsSync(d.storePath)).toBe(false);
  });

  it('World unreachable: forwards the IDKit result as-is to /api/v4/verify/{rp_id}, then records nothing', async () => {
    const d = deps();
    const b = body();
    const r = await submitVendorBankChange(b, d);
    expect(r).toMatchObject({ ok: false, status: 502, reason: 'verify_unreachable' });
    expect(d.calls).toEqual([{ url: 'https://developer.world.org/api/v4/verify/rp_test_not_a_real_rp', body: JSON.stringify(b.idkitResult) }]);
    expect(verifyUrl('rp_x')).toBe('https://developer.world.org/api/v4/verify/rp_x');
    expect(existsSync(d.storePath)).toBe(false);
  });
});
