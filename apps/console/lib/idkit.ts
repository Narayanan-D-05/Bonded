/**
 * IDKit (World ID) for the vendor side of a bank change: config, the RP-context signing input, the
 * checks the server runs on an IDKit result BEFORE forwarding it, the reading of World's verify
 * answer, and `submitVendorBankChange`, which records a request only on World's success.
 *
 * Verified against the docs and the installed types (IDKit 4.3.0), not guessed:
 *  - Portal values `app_id` (app_…), `rp_id` (rp_…) and a backend `signing_key` secret
 *    (https://docs.world.org/world-id/idkit/integrate, Step 2).
 *  - The backend signs with `signRequest({ signingKeyHex, action?, ttl? })` from
 *    `@worldcoin/idkit-core/signing` (re-exported from `@worldcoin/idkit-server` 1.1.1), returning
 *    `{ sig, nonce, createdAt, expiresAt }`; the client's `RpContext` is
 *    `{ rp_id, nonce, created_at, expires_at, signature }` (integrate Step 3/4; idkit-core
 *    index.d.ts `RpContext`). The action MUST be signed for uniqueness proofs (idkit-server
 *    index.d.ts: "This is required for non-session proofs").
 *  - The IDKit result is forwarded as-is to `POST https://developer.world.org/api/v4/verify/{rp_id}`
 *    ("Forward the IDKit result payload as-is. No field remapping is required", integrate Step 5;
 *    https://docs.world.org/api-reference/developer-portal/verify). 200 = `{ success: true, nullifier?,
 *    environment?, results[] }`; 400 = `{ success: false, code, detail }`. "Check that the verify
 *    response's `environment` matches your backend's expected environment".
 *  - Environments: "production" | "staging" | "sandbox" (idkit-core `IDKitRequestConfig.environment`).
 *    "A staging action only verifies against the World ID Simulator" (https://docs.world.org/world-id/SKILL.md,
 *    Phase 5); Sandbox uses the TestFlight / private-Play sandbox World ID app
 *    (https://docs.world.org/world-id/sandbox/sandbox-access).
 *
 * === Credential: `passport` (NFC passport, credential 9303) ===
 * A bank-change request is a financial-identity event: the question is "which accountable person
 * asked for money to go somewhere else?". Proof of Human (credential 1) proves a unique live human
 * but ties nothing to a legal identity document; Selfie Check (credential 11) is explicitly
 * "medium-assurance" with no strict one-person-one-account guarantee. The NFC passport credential
 * is "guaranteed to be issued to a single World ID per unique document"
 * (https://docs.world.org/world-id/credentials/9303) and is the lowest tier that is backed by a
 * government document, so it is the minimum sufficient assurance here. It proves the person holds
 * a verified passport, never who they are: no document data reaches us.
 *
 * What can actually be DEMOED: the `passport` preset is "World ID 4.0 passport credential with
 * legacy document fallback" (idkit-core index.d.ts `PassportPreset`); the Rust preset sets
 * `legacy_verification_level: Document` and forces `allow_legacy_proofs` on
 * (github.com/worldcoin/idkit rust/core/src/preset.rs). The staging Simulator
 * (https://simulator.worldcoin.org) only implements the legacy 3.0 levels orb / secure_document /
 * document / device (read from its shipped bundle; its page says it "will change with the adoption
 * of World ID 4.0"). So on the Simulator, the same `passport` request completes with a 3.0
 * `document`-level proof (or `secure_document` / `orb`, the fallback returns the user's highest),
 * and the record says exactly which one World verified (`credentialType`, `protocolVersion`).
 * Production accepts the 4.0 `passport` item (issuer_schema_id 9303).
 */

import type { VendorTruth } from '@bonded/issuer-oracle';
import { hashSignal } from '@worldcoin/idkit-core/hashing';
import {
  DuplicateVendorRequestError,
  VendorBankChangeInputError,
  appendVerifiedVendorBankChangeRequest,
  buildVendorBankChangeSignal,
  normalizeVendorBankChangeClaim,
  sameFieldElement,
  type VendorBankChangeClaim,
  type VerifiedVendorBankChangeRequest,
} from './vendor-bank-change';

// ─── Config (names only; values are never logged or returned) ──────────────

export const IDKIT_ENV = {
  appId: 'WORLD_IDKIT_APP_ID',
  rpId: 'WORLD_IDKIT_RP_ID',
  action: 'WORLD_IDKIT_ACTION',
  signingKey: 'WORLD_IDKIT_SIGNING_KEY',
  environment: 'WORLD_IDKIT_ENVIRONMENT',
} as const;

export const IDKIT_ENVIRONMENTS = ['production', 'staging', 'sandbox'] as const;
export type IdkitEnvironment = (typeof IDKIT_ENVIRONMENTS)[number];

export interface IdkitPublicConfig {
  appId: `app_${string}`;
  rpId: string;
  action: string;
  environment: IdkitEnvironment;
}

export interface IdkitConfig extends IdkitPublicConfig {
  /** Present only when requested (`needSigningKey`). Server-only. */
  signingKeyHex?: string;
}

export type IdkitConfigResult = { ok: true; config: IdkitConfig } | { ok: false; missing: string[]; invalid: string[] };

/**
 * Reads the IDKit config. Missing variables are named; malformed ones are named with the rule they
 * break, never with their value.
 */
export function readIdkitConfig(env: Record<string, string | undefined>, options: { needSigningKey: boolean }): IdkitConfigResult {
  const names = [IDKIT_ENV.appId, IDKIT_ENV.rpId, IDKIT_ENV.action, IDKIT_ENV.environment, ...(options.needSigningKey ? [IDKIT_ENV.signingKey] : [])];
  const get = (name: string) => env[name]?.trim() ?? '';
  const missing = names.filter((n) => get(n) === '');
  const invalid: string[] = [];
  if (get(IDKIT_ENV.appId) !== '' && !get(IDKIT_ENV.appId).startsWith('app_')) invalid.push(`${IDKIT_ENV.appId} (must start with app_)`);
  if (get(IDKIT_ENV.rpId) !== '' && !get(IDKIT_ENV.rpId).startsWith('rp_')) invalid.push(`${IDKIT_ENV.rpId} (must start with rp_)`);
  const envValue = get(IDKIT_ENV.environment);
  if (envValue !== '' && !(IDKIT_ENVIRONMENTS as readonly string[]).includes(envValue)) {
    invalid.push(`${IDKIT_ENV.environment} (must be one of ${IDKIT_ENVIRONMENTS.join(', ')})`);
  }
  if (missing.length > 0 || invalid.length > 0) return { ok: false, missing, invalid };
  return {
    ok: true,
    config: {
      appId: get(IDKIT_ENV.appId) as `app_${string}`,
      rpId: get(IDKIT_ENV.rpId),
      action: get(IDKIT_ENV.action),
      environment: envValue as IdkitEnvironment,
      ...(options.needSigningKey ? { signingKeyHex: get(IDKIT_ENV.signingKey) } : {}),
    },
  };
}

export function describeConfigProblem(r: { missing: string[]; invalid: string[] }): string {
  const parts: string[] = [];
  if (r.missing.length > 0) parts.push(`missing env var(s): ${r.missing.join(', ')}`);
  if (r.invalid.length > 0) parts.push(`invalid env var(s): ${r.invalid.join('; ')}`);
  return `World IDKit is not configured (${parts.join('; ')}). Set them in apps/console/.env.local; see the root .env.example.`;
}

// ─── Accepted credentials for the `passport` preset ────────────────────────

/** 4.0: the NFC passport credential (issuer_schema_id 9303, idkit-core `ResponseItemV4`). */
export const ACCEPTED_V4_CREDENTIALS: Readonly<Record<string, number>> = { passport: 9303 };
/**
 * 3.0: what the `passport` preset's legacy Document fallback can return ("Returns the user's
 * highest legacy credential: Document, Secure Document, or Orb", https://docs.world.org/world-id/idkit/credentials).
 */
export const ACCEPTED_V3_CREDENTIALS: readonly string[] = ['document', 'secure_document', 'orb'];

// ─── Pre-verify checks on the IDKit result (pure) ──────────────────────────

export type EnvelopeFailureReason =
  | 'malformed_result'
  | 'session_proof_not_accepted'
  | 'action_mismatch'
  | 'environment_mismatch'
  | 'credential_not_accepted'
  | 'signal_mismatch';

export type EnvelopeCheck =
  | { ok: true; protocolVersion: '3.0' | '4.0'; credentialType: string; issuerSchemaId: number | null; nullifierHex: string }
  | { ok: false; reason: EnvelopeFailureReason; detail: string };

/**
 * Checks what the server can check about an IDKit result without World: the protocol shape, that
 * it is a uniqueness proof for OUR action and environment, that the credential is one the
 * `passport` preset can legitimately return, and that EVERY response item's `signal_hash` equals
 * the hash of the signal rebuilt from the submitted fields. It never looks at, or vouches for, the
 * proof itself: only World's verify endpoint decides that.
 */
export function checkIdkitEnvelope(result: unknown, expected: { action: string; environment: string; signalHash: string }): EnvelopeCheck {
  const fail = (reason: EnvelopeFailureReason, detail: string): EnvelopeCheck => ({ ok: false, reason, detail });
  if (result === null || typeof result !== 'object') return fail('malformed_result', 'The IDKit result is not an object.');
  const r = result as Record<string, unknown>;
  if ('session_id' in r) return fail('session_proof_not_accepted', 'A session proof was submitted; this flow requires a one-time uniqueness proof for the bank-change action.');
  if (r.protocol_version !== '3.0' && r.protocol_version !== '4.0') return fail('malformed_result', 'protocol_version must be "3.0" or "4.0".');
  if (!Array.isArray(r.responses) || r.responses.length === 0) return fail('malformed_result', 'The IDKit result has no responses.');
  if (r.action !== expected.action) return fail('action_mismatch', `The proof is for action "${String(r.action)}", not "${expected.action}".`);
  if (r.environment !== expected.environment) {
    return fail('environment_mismatch', `The proof was made in environment "${String(r.environment)}", but this server expects "${expected.environment}".`);
  }
  let first: { credentialType: string; issuerSchemaId: number | null; nullifierHex: string } | null = null;
  for (const item of r.responses as unknown[]) {
    if (item === null || typeof item !== 'object') return fail('malformed_result', 'A response item is not an object.');
    const it = item as Record<string, unknown>;
    const identifier = it.identifier;
    if (typeof identifier !== 'string') return fail('malformed_result', 'A response item has no identifier.');
    let issuerSchemaId: number | null = null;
    if (r.protocol_version === '4.0') {
      const wanted = ACCEPTED_V4_CREDENTIALS[identifier];
      if (wanted === undefined || it.issuer_schema_id !== wanted) {
        return fail('credential_not_accepted', `Credential "${identifier}" (issuer_schema_id ${String(it.issuer_schema_id)}) is not the NFC passport credential (9303).`);
      }
      issuerSchemaId = wanted;
    } else if (!ACCEPTED_V3_CREDENTIALS.includes(identifier)) {
      return fail('credential_not_accepted', `Legacy credential "${identifier}" is below the passport preset's Document fallback.`);
    }
    if (typeof it.signal_hash !== 'string' || !sameFieldElement(it.signal_hash, expected.signalHash)) {
      return fail(
        'signal_mismatch',
        'The proof is bound to a different signal than this vendor, payout address and EVM identity. A proof made for one address cannot be used for another.',
      );
    }
    if (typeof it.nullifier !== 'string' || !/^0x[0-9a-fA-F]+$/.test(it.nullifier)) return fail('malformed_result', 'A response item has no hex nullifier.');
    first ??= { credentialType: identifier, issuerSchemaId, nullifierHex: it.nullifier };
  }
  return { ok: true, protocolVersion: r.protocol_version, ...first! };
}

// ─── World's verify answer (pure) ──────────────────────────────────────────

export type VerifyInterpretation =
  | { ok: true; nullifierHex: string; environment: string | null }
  | { ok: false; reason: 'verify_rejected' | 'verify_environment_mismatch' | 'verify_response_unrecognised'; detail: string; worldCode?: string };

/**
 * Reads World's `POST /api/v4/verify/{rp_id}` answer. Only `200` with `success: true` is success;
 * the nullifier is taken from World's answer when it gives one, else from the response item World
 * just verified.
 */
export function interpretVerifyResponse(
  httpStatus: number,
  body: unknown,
  expected: { environment: string; credentialType: string; envelopeNullifierHex: string },
): VerifyInterpretation {
  const b = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  if (httpStatus !== 200 || b === null || b.success !== true) {
    const code = typeof b?.code === 'string' ? b.code : undefined;
    const detail = typeof b?.detail === 'string' ? b.detail : `HTTP ${httpStatus}`;
    return { ok: false, reason: 'verify_rejected', detail: code ? `${code}: ${detail}` : detail, ...(code ? { worldCode: code } : {}) };
  }
  const environment = typeof b.environment === 'string' ? b.environment : null;
  if (environment !== null && environment !== expected.environment) {
    return { ok: false, reason: 'verify_environment_mismatch', detail: `World verified the proof for "${environment}", not "${expected.environment}".` };
  }
  const results = Array.isArray(b.results) ? (b.results as Array<Record<string, unknown>>) : [];
  const ours = results.find((x) => x?.identifier === expected.credentialType);
  if (ours !== undefined && ours.success !== true) {
    return { ok: false, reason: 'verify_rejected', detail: `World did not verify the ${expected.credentialType} proof.` };
  }
  const nullifierHex =
    typeof b.nullifier === 'string' ? b.nullifier : typeof ours?.nullifier === 'string' ? (ours.nullifier as string) : expected.envelopeNullifierHex;
  if (!/^0x[0-9a-fA-F]+$/.test(nullifierHex)) return { ok: false, reason: 'verify_response_unrecognised', detail: 'World returned a nullifier that is not hex.' };
  return { ok: true, nullifierHex, environment };
}

/** Hex nullifier → decimal string, as the docs recommend storing it (integrate Step 6). */
export function nullifierToDecimal(hex: string): string {
  return BigInt(hex).toString(10);
}

// ─── The vendor submission ─────────────────────────────────────────────────

export type SubmitFailureReason =
  | 'missing_env'
  | 'invalid_request'
  | 'unknown_vendor'
  | 'payout_unchanged'
  | EnvelopeFailureReason
  | 'verify_unreachable'
  | 'verify_rejected'
  | 'verify_environment_mismatch'
  | 'verify_response_unrecognised'
  | 'duplicate_request';

export type SubmitResult =
  | { ok: true; status: 200; record: VerifiedVendorBankChangeRequest }
  | { ok: false; status: number; reason: SubmitFailureReason; detail: string; missingEnv?: string[]; worldCode?: string };

export interface SubmitDeps {
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  vendorSource: (vendorId: string) => Promise<VendorTruth | null>;
  storePath: string;
  now: () => number;
  /** Default https://developer.world.org (the docs' verify host for every environment). */
  verifyBaseUrl?: string;
}

export const WORLD_VERIFY_BASE_URL = 'https://developer.world.org';
const VERIFY_TIMEOUT_MS = 15_000;

export function verifyUrl(rpId: string, base: string = WORLD_VERIFY_BASE_URL): string {
  return `${base}/api/v4/verify/${encodeURIComponent(rpId)}`;
}

/**
 * The vendor's bank-change submission. Records a request ONLY after World's verify endpoint
 * answered success; every other path returns a distinct reason and records nothing.
 */
export async function submitVendorBankChange(
  body: { vendorId?: unknown; newPayoutAddress?: unknown; newEvmAddress?: unknown; idkitResult?: unknown },
  deps: SubmitDeps,
): Promise<SubmitResult> {
  const cfg = readIdkitConfig(deps.env, { needSigningKey: false });
  if (!cfg.ok) return { ok: false, status: 501, reason: 'missing_env', detail: describeConfigProblem(cfg), missingEnv: [...cfg.missing, ...cfg.invalid] };
  const { config } = cfg;

  let claim: VendorBankChangeClaim;
  try {
    claim = normalizeVendorBankChangeClaim(body);
  } catch (error) {
    if (error instanceof VendorBankChangeInputError) return { ok: false, status: 400, reason: 'invalid_request', detail: error.message };
    throw error;
  }
  const truth = await deps.vendorSource(claim.vendorId);
  if (truth === null) return { ok: false, status: 404, reason: 'unknown_vendor', detail: `${claim.vendorId} is not in the vendor master.` };
  if (truth.payoutAddress.toLowerCase() === claim.newPayoutAddress) {
    return { ok: false, status: 400, reason: 'payout_unchanged', detail: `${claim.newPayoutAddress} is already ${claim.vendorId}'s payout address on file.` };
  }

  const signal = buildVendorBankChangeSignal(claim);
  const signalHash = hashSignal(signal);
  const envelope = checkIdkitEnvelope(body.idkitResult, { action: config.action, environment: config.environment, signalHash });
  if (!envelope.ok) return { ok: false, status: 400, reason: envelope.reason, detail: envelope.detail };

  let httpStatus: number;
  let worldBody: unknown;
  try {
    const res = await deps.fetch(verifyUrl(config.rpId, deps.verifyBaseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // As-is: the exact object IDKit returned, no remapping (integrate Step 5).
      body: JSON.stringify(body.idkitResult),
      cache: 'no-store',
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    httpStatus = res.status;
    const text = await res.text();
    try {
      worldBody = JSON.parse(text);
    } catch {
      worldBody = null;
    }
  } catch (error) {
    return {
      ok: false,
      status: 502,
      reason: 'verify_unreachable',
      detail: `Could not reach World's verify endpoint (${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}). Nothing was recorded.`,
    };
  }

  const verdict = interpretVerifyResponse(httpStatus, worldBody, {
    environment: config.environment,
    credentialType: envelope.credentialType,
    envelopeNullifierHex: envelope.nullifierHex,
  });
  if (!verdict.ok) {
    return { ok: false, status: 400, reason: verdict.reason, detail: verdict.detail, ...(verdict.worldCode ? { worldCode: verdict.worldCode } : {}) };
  }

  try {
    const record = await appendVerifiedVendorBankChangeRequest(deps.storePath, {
      ...claim,
      signal,
      signalHash,
      action: config.action,
      environment: config.environment,
      protocolVersion: envelope.protocolVersion,
      credentialType: envelope.credentialType,
      issuerSchemaId: envelope.issuerSchemaId,
      nullifier: nullifierToDecimal(verdict.nullifierHex),
      verifiedAtMs: deps.now(),
    });
    return { ok: true, status: 200, record };
  } catch (error) {
    if (error instanceof DuplicateVendorRequestError) return { ok: false, status: 409, reason: 'duplicate_request', detail: error.message };
    throw error;
  }
}
