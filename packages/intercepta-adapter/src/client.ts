/**
 * Live Intercepta (Web3 Antivirus) HTTP client — Commerce Edition.
 * Migration PRD D.5: "the one adapter in the whole migration with zero
 * disclosure caveats — a real API, called live, exactly as their
 * qualification requires." No cache, ever, on this path.
 *
 * Endpoint paths, the base URL, and every response field validated below are
 * taken from two sources, cross-checked against each other, NOT guessed:
 *   1. `docs/reference/intercepta-api-docs.md` (this repo, a crawl of
 *      https://docs.web3antivirus.io/reference/*) — confirms the base URL
 *      `https://api.web3antivirus.io/api/public/v2/extension`, the four
 *      endpoint paths, and their path/body parameters.
 *   2. `docs/VERIFY_FINDINGS.md` item 5 (fetched 2026-09-25, one day before
 *      this package was written) — confirms the exact OAS response schemas
 *      for Quick Scan Address, Deep Scan Address, Scan Token and Scan
 *      Message, because the local doc crawl above does not itself embed
 *      field-level JSON schemas (it is prose + curl examples only).
 *
 * The PRD's own D.5 sketch (`INTERCEPTA_BASE = 'https://api.web3antivirus.io'`,
 * `scanToken` returning `{isLookalike, riskScore}`, a bare `scanAddress`
 * returning `{sanctioned, scamExposure, riskScore}`) is marked [VERIFY] in
 * the PRD text itself and does NOT match either confirmed source: the real
 * base URL needs the `/api/public/v2/extension` prefix, and neither
 * `isLookalike` nor `sanctioned`/`scamExposure` is a field either endpoint's
 * OAS schema documents. This file follows the two confirmed sources, not the
 * PRD sketch. See the package report for the full diff.
 *
 * Rules this file enforces (CLAUDE.md rules 1 and 3, Migration PRD Part G):
 *  - No cache, ever. Every call passes `cache: 'no-store'` on the raw
 *    `fetch()`, asserted by `__tests__/client.test.ts` via a fetch spy, not
 *    assumed.
 *  - No fallback value, ever. A missing key, a non-2xx, a timeout, non-JSON,
 *    or an unexpected shape all THROW. None of them is ever read as "clean"
 *    or silently priced as anything.
 *  - The exact response bytes are kept. Their sha256 is the evidence hash,
 *    and the bytes are written to `<repo>/.data/intercepta/<sha256>.json`
 *    (gitignored) before the body is interpreted, so a later mismatch can
 *    cite the precise response that justified it.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Hash32 } from '@bonded/seam';

// ─── Endpoints (confirmed against docs/reference/intercepta-api-docs.md and
//     docs/VERIFY_FINDINGS.md item 5, not the PRD's [VERIFY] placeholder) ───

/** OAS `servers[0].url`, per both confirmed sources. */
export const INTERCEPTA_HOST = 'https://api.web3antivirus.io';
/** Prefix of Quick Scan, Deep Scan, Scan Token and Scan Message. */
export const INTERCEPTA_BASE_URL = `${INTERCEPTA_HOST}/api/public/v2/extension`;

export type AddressScanKind = 'quick-scan' | 'toxic-score';

export function addressScanUrl(kind: AddressScanKind, subject: ScreeningSubject): string {
  const addr = encodeURIComponent(subject.value);
  // quick-scan: OAS operationId quick-scan-address, "Quick Scan Address".
  // toxic-score: OAS operationId scan-address, "Deep Scan Address".
  // Neither takes a chainId query parameter (VERIFY_FINDINGS item 5: "there
  // is no chainId parameter"), unlike Scan Token below.
  return `${INTERCEPTA_BASE_URL}/account/${addr}/${kind}`;
}

/**
 * OAS `chainId` enum for Scan Token (VERIFY_FINDINGS item 5, fetched from the
 * live OAS). No Sui id and no Sepolia/testnet id is in this enum — Intercepta
 * cannot score a token on the settlement chain this migration actually uses;
 * see docs/THREATMODEL.md's existing entry on this exact gap.
 */
export const TOKEN_CHAIN_IDS = [
  '1868', '7777777', '1', '8453', '130', '146', '56', '137', '10', '42161',
  '480', '42220', '43114', '324', '81457', '59144', '999', '33139', 'solana', '57073',
] as const;
export type TokenChainId = (typeof TOKEN_CHAIN_IDS)[number];

export function isTokenChainId(v: string): v is TokenChainId {
  return (TOKEN_CHAIN_IDS as readonly string[]).includes(v);
}

export function scanTokenUrl(tokenAddress: string, chainId: TokenChainId): string {
  const addr = encodeURIComponent(tokenAddress);
  return `${INTERCEPTA_BASE_URL}/token-intelligence/token/${addr}/risks?chainId=${encodeURIComponent(chainId)}`;
}

export const SCAN_MESSAGE_URL = `${INTERCEPTA_BASE_URL}/analysis/signature`;

// ─── Errors: every failure is visible and typed ─────────────────────────────

export const INTERCEPTA_API_KEY_ENV = 'INTERCEPTA_API_KEY';
export const INTERCEPTA_KEY_SIGNUP_URL = 'https://intercepta.io/ethglobal';
/** The exact line the user adds to `<repo>/.env`. */
export const ENV_LINE_TO_ADD = `${INTERCEPTA_API_KEY_ENV}=<your key from ${INTERCEPTA_KEY_SIGNUP_URL}>`;

export class InterceptaKeyMissingError extends Error {
  constructor() {
    super(
      `${INTERCEPTA_API_KEY_ENV} is not set, so no live Intercepta call can be made and no result ` +
        `exists. There is no fallback value (CLAUDE.md rule 1). Add this line to the repo-root ` +
        `.env: ${ENV_LINE_TO_ADD}`,
    );
    this.name = 'InterceptaKeyMissingError';
  }
}

export class InterceptaSubjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InterceptaSubjectError';
  }
}

export class InterceptaHttpError extends Error {
  constructor(
    readonly endpoint: string,
    readonly httpStatus: number | null,
    readonly bodyExcerpt: string,
    message: string,
  ) {
    super(message);
    this.name = 'InterceptaHttpError';
  }
}

export class InterceptaShapeError extends Error {
  /** Set when the offending body was stored, so it can be inspected by hash. */
  evidence: ScanEvidence | null = null;
  constructor(message: string) {
    super(message);
    this.name = 'InterceptaShapeError';
  }
}

// ─── Subjects: EVM address or ENS name only (address endpoints) ────────────

export type ScreeningSubject =
  | { kind: 'evm'; value: `0x${string}` }
  | { kind: 'ens'; value: string };

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SUI_ADDRESS = /^0x[0-9a-fA-F]{64}$/;
/** Lowercase ASCII labels, at least two, no empty label. */
const ENS_NAME = /^(?:[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

const SUI_EXPLANATION =
  "Intercepta's address endpoints take an \"ETH address/ENS\" (the path parameter's documented " +
  'description) and cannot screen a Sui address (docs/THREATMODEL.md, docs/VERIFY_FINDINGS.md item 5). ' +
  'Screen the EVM address linked to the party instead.';

/**
 * Accept an EVM address or an ENS name for the address-scan endpoints. Reject
 * everything else with a reason, and never normalise silently.
 *
 * - EVM: `0x` plus 40 hex characters, any case. The EIP-55 checksum is NOT
 *   verified, because no keccak implementation is a dependency of this
 *   package. A mistyped address is caught only if its length or alphabet is
 *   wrong.
 * - ENS: lowercase ASCII labels only. A name that is not already normalised
 *   is rejected rather than lowercased here. Full ENSIP-15 (unicode)
 *   normalisation is out of scope.
 * - The chain this migration settles on is Sui, so a Sui address reaching
 *   this function is very likely a caller bug, not a valid subject; it is
 *   rejected with an explanation rather than silently mis-encoded.
 */
export function parseScreeningSubject(input: string): ScreeningSubject {
  if (typeof input !== 'string') {
    throw new InterceptaSubjectError(`screening subject must be a string, got ${typeof input}`);
  }
  if (SUI_ADDRESS.test(input)) {
    throw new InterceptaSubjectError(`${input} is a 32-byte Sui address. ${SUI_EXPLANATION}`);
  }
  if (EVM_ADDRESS.test(input)) {
    return { kind: 'evm', value: input as `0x${string}` };
  }
  if (/^0x/i.test(input)) {
    throw new InterceptaSubjectError(
      `${JSON.stringify(input)} is not a 20-byte EVM address (expected 0x + 40 hex characters)`,
    );
  }
  if (input.endsWith('.sui')) {
    throw new InterceptaSubjectError(`${input} is a SuiNS name. ${SUI_EXPLANATION}`);
  }
  if (ENS_NAME.test(input)) {
    return { kind: 'ens', value: input };
  }
  throw new InterceptaSubjectError(
    `${JSON.stringify(input)} is neither an EVM address (0x + 40 hex) nor a normalised ` +
      `lowercase ENS name (e.g. agent.example.eth)`,
  );
}

/**
 * Scan Token's `address` parameter is documented as "Contract address", not
 * "ETH address/ENS" — no ENS name is accepted here, on purpose.
 */
export function parseTokenAddress(input: string): `0x${string}` {
  if (typeof input !== 'string' || !EVM_ADDRESS.test(input)) {
    throw new InterceptaSubjectError(
      `${JSON.stringify(input)} is not a 20-byte EVM contract address (expected 0x + 40 hex characters); ` +
        'Scan Token takes a contract address, not an ENS name',
    );
  }
  return input as `0x${string}`;
}

// ─── API key, read at call time ─────────────────────────────────────────────

/** Read the key from the environment at call time. Throws if it is absent or blank. */
export function readApiKey(): string {
  const key = process.env[INTERCEPTA_API_KEY_ENV];
  if (key === undefined || key.trim() === '') {
    throw new InterceptaKeyMissingError();
  }
  return key;
}

// ─── Evidence storage ───────────────────────────────────────────────────────

export interface ScanEvidence {
  endpoint: string;
  url: string;
  httpStatus: number;
  /** Wall-clock time (ms since epoch) at which the response finished arriving. */
  fetchedAtMs: number;
  /** sha256 of the exact response body bytes, 0x-prefixed. */
  sha256: Hash32;
  /** Absolute path of the stored body: `<evidenceDir>/<sha256 hex>.json`. */
  storedAt: string;
}

/**
 * `<repo root>/.data/intercepta`. The repo root is the nearest ancestor of the
 * working directory that contains `pnpm-workspace.yaml`. Throws if there is
 * none, rather than writing evidence to some unexpected place. `.data/` is
 * confirmed gitignored (`.gitignore` line `.data/`).
 */
export function defaultEvidenceDir(startDir: string = process.cwd()): string {
  let dir = resolve(startDir);
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return join(dir, '.data', 'intercepta');
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `cannot locate the Bonded repo root (no pnpm-workspace.yaml above ${startDir}); ` +
          'pass evidenceDir explicitly',
      );
    }
    dir = parent;
  }
}

async function storeBody(dir: string, hex: string, bytes: Uint8Array): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${hex}.json`);
  try {
    await writeFile(path, bytes, { flag: 'wx' });
  } catch (error) {
    // Content-addressed: an existing file with this name holds these exact bytes.
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  return path;
}

// ─── The transport: GET and POST, cache: 'no-store' on both ────────────────

export interface InterceptaCallOptions {
  /** Abort after this many ms. Default 10000. A timeout throws; it is never "clean". */
  timeoutMs?: number;
  /** Where raw bodies are written. Default: `defaultEvidenceDir()`. */
  evidenceDir?: string;
}

const EXCERPT_CHARS = 500;

async function liveRequest(
  endpointLabel: string,
  url: string,
  init: { method: 'GET' | 'POST'; body?: string },
  options: InterceptaCallOptions,
): Promise<{ json: unknown; evidence: ScanEvidence }> {
  const apiKey = readApiKey();
  const evidenceDir = options.evidenceDir ?? defaultEvidenceDir();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  let status: number;
  let bytes: Uint8Array;
  try {
    const res = await fetch(url, {
      method: init.method,
      cache: 'no-store', // Migration PRD Part G: asserted by client.test.ts, not assumed.
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'X-API-KEY': apiKey,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
      ...(init.body ? { body: init.body } : {}),
    });
    status = res.status;
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    throw new InterceptaHttpError(endpointLabel, null, '', `Intercepta ${endpointLabel} request failed: ${why}`);
  } finally {
    clearTimeout(timer);
  }
  const fetchedAtMs = Date.now();

  if (status < 200 || status > 299) {
    const excerpt = new TextDecoder().decode(bytes).slice(0, EXCERPT_CHARS);
    throw new InterceptaHttpError(
      endpointLabel,
      status,
      excerpt,
      `Intercepta ${endpointLabel} answered HTTP ${status}: ${excerpt}`,
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    const excerpt = new TextDecoder().decode(bytes).slice(0, EXCERPT_CHARS);
    throw new InterceptaShapeError(`Intercepta ${endpointLabel} returned a non-JSON 200 body: ${excerpt}`);
  }

  const hex = createHash('sha256').update(bytes).digest('hex');
  const storedAt = await storeBody(evidenceDir, hex, bytes);
  return {
    json,
    evidence: { endpoint: endpointLabel, url, httpStatus: status, fetchedAtMs, sha256: `0x${hex}`, storedAt },
  };
}

// ─── Strict response validation (documented schemas only) ──────────────────

/** OAS `ToxicScoreTraitV2.name` enum, verbatim and in documented order (fully confirmed). */
export const DOCUMENTED_TRAIT_NAMES = [
  'known_scammer',
  'initiator_scam_transactions',
  'sanction_address_communication',
  'suspicious_dex_pair_deployer',
  'suspicious_deployer',
  'attack_money_target',
  'zero_address_risk',
  'sanction_address',
  'fake_phishing_transfer',
  'non_kyc_transfers',
  'mixer_transfers',
  'fake_phishing_contract_communication',
  'rug_pull',
  'rug_pull_trader',
  'blacklist',
] as const;
export type TraitName = (typeof DOCUMENTED_TRAIT_NAMES)[number];

export function isDocumentedTraitName(name: string): name is TraitName {
  return (DOCUMENTED_TRAIT_NAMES as readonly string[]).includes(name);
}

/**
 * OAS `ToxicScoreTraitV2`. The OAS marks all four fields required, but the LIVE API
 * disagrees for `txsCount`: a real Deep Scan of the OFAC-listed Lazarus address on
 * 2026-09-26 returned `known_scammer`, `sanction_address` and `blacklist` traits with
 * NO `txsCount` key, while other traits in the same response carried one (evidence body
 * stored under .data/intercepta/, logged in FEEDBACK/intercepta.md). So `txsCount` is
 * treated as optional; every other key stays required and undocumented keys are still
 * rejected.
 */
export interface ToxicScoreTrait {
  /** "Risk level of the trait". Range UNCONFIRMED (the live API returns fractions, e.g. 0.54). Not used for any decision in this package. */
  risk: number;
  name: TraitName;
  /** "Number of detected transactions related to this trait". Absent on some live traits (see above). */
  txsCount?: number;
  description: string;
}

/**
 * OAS `ToxicScoreShortResponseV2`, returned by BOTH Quick Scan and Deep Scan.
 * Both fields required. This schema's complete key set IS fully confirmed
 * (VERIFY_FINDINGS item 5), so extra/undocumented keys are rejected, not just
 * missing ones.
 */
export interface ToxicScoreResponse {
  /** "Evaluates and indicates the risk level of a wallet before interaction." Range UNCONFIRMED — see README/report. */
  toxicScore: number;
  /** "List of suspicious activities detected on the address". */
  traits: ToxicScoreTrait[];
}

/**
 * OAS `TokenRiskAnalysisV2Response` (VERIFY_FINDINGS item 5). Only the
 * REQUIRED fields that source confirmed are validated. `token: TokenDetails`
 * is accepted as an opaque object — TokenDetails' own internal shape was not
 * independently confirmed this session, so this file does not guess it
 * (CLAUDE.md's [VERIFY] rule). Because the complete key set of this response
 * is not confirmed (unlike ToxicScoreResponse above), extra keys are
 * TOLERATED here rather than rejected, to avoid failing closed on a real,
 * merely-undocumented-by-this-session field.
 */
export interface TokenRiskAnalysisResponse {
  apiVersion: unknown;
  saleTax: unknown;
  buyTax: unknown;
  /** "Risk percentage", `example: 70`. No documented bound; treat as UNCONFIRMED range. */
  riskScore: number;
  riskLevel: 'neutral' | 'low' | 'medium' | 'high';
  category: 'malicious' | 'restricted' | 'suspicious' | 'availability' | 'sanctioned' | 'unverified' | 'info';
  trust: 'whitelist' | 'blocklist' | 'neutral';
  action: 'block' | 'warn' | 'info';
  detectors: Array<{ code: string; description: string }>;
  /** Opaque — TokenDetails' internal shape is UNCONFIRMED. */
  token: Record<string, unknown>;
}

/**
 * OAS `SignatureAnalysisResponseDTO` (VERIFY_FINDINGS item 5). Same
 * tolerant-of-extra-keys posture as TokenRiskAnalysisResponse, for the same
 * reason — this response's complete key set beyond the required fields
 * named in that finding is not independently confirmed by this session.
 */
export interface SignatureAnalysisResponse {
  from: string;
  detectors: Array<{ code: string; description: string }>;
  riskGroup: 'Low' | 'Medium' | 'High';
  addresses: Array<{ address: string; type: unknown; detectors: unknown[] }>;
  domain?: unknown;
  assetsMovement?: { approve?: unknown[] };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Exactly the documented keys, all present — used only for the fully-confirmed ToxicScore schema. */
function requireExactKeys(obj: Record<string, unknown>, keys: readonly string[], what: string): void {
  const missing = keys.filter((k) => !Object.prototype.hasOwnProperty.call(obj, k));
  const extra = Object.keys(obj).filter((k) => !keys.includes(k));
  if (missing.length > 0 || extra.length > 0) {
    throw new InterceptaShapeError(
      `${what} does not match the documented schema` +
        (missing.length > 0 ? `; missing ${missing.join(', ')}` : '') +
        (extra.length > 0 ? `; undocumented ${extra.join(', ')}` : ''),
    );
  }
}

/** Only the required keys are checked as present — used for the two partially-confirmed schemas. */
function requireKeys(obj: Record<string, unknown>, keys: readonly string[], what: string): void {
  const missing = keys.filter((k) => !Object.prototype.hasOwnProperty.call(obj, k));
  if (missing.length > 0) {
    throw new InterceptaShapeError(`${what} is missing required field(s): ${missing.join(', ')}`);
  }
}

function requireFiniteNumber(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new InterceptaShapeError(`${what} must be a finite number, got ${JSON.stringify(v)}`);
  }
  return v;
}

function requireString(v: unknown, what: string): string {
  if (typeof v !== 'string') {
    throw new InterceptaShapeError(`${what} must be a string, got ${JSON.stringify(v)}`);
  }
  return v;
}

function requireEnum<T extends string>(v: unknown, allowed: readonly T[], what: string): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    throw new InterceptaShapeError(`${what} must be one of ${allowed.join('|')}, got ${JSON.stringify(v)}`);
  }
  return v as T;
}

function requireDetectorArray(v: unknown, what: string): Array<{ code: string; description: string }> {
  if (!Array.isArray(v)) throw new InterceptaShapeError(`${what} must be an array, got ${JSON.stringify(v)}`);
  return v.map((d: unknown, i: number) => {
    const at = `${what}[${i}]`;
    if (!isPlainObject(d)) throw new InterceptaShapeError(`${at} must be an object`);
    return { code: requireString(d['code'], `${at}.code`), description: requireString(d['description'], `${at}.description`) };
  });
}

export function parseToxicScoreResponse(json: unknown): ToxicScoreResponse {
  if (!isPlainObject(json)) {
    throw new InterceptaShapeError(`ToxicScoreShortResponseV2 must be a JSON object, got ${JSON.stringify(json)}`);
  }
  requireExactKeys(json, ['toxicScore', 'traits'], 'ToxicScoreShortResponseV2');
  const toxicScore = requireFiniteNumber(json['toxicScore'], 'toxicScore');
  const rawTraits = json['traits'];
  if (!Array.isArray(rawTraits)) {
    throw new InterceptaShapeError(`traits must be an array, got ${JSON.stringify(rawTraits)}`);
  }
  const traits = rawTraits.map((t: unknown, i: number): ToxicScoreTrait => {
    const at = `traits[${i}]`;
    if (!isPlainObject(t)) throw new InterceptaShapeError(`${at} must be an object`);
    // Required keys must be present; `txsCount` is optional (see ToxicScoreTrait's doc);
    // anything else is still rejected as undocumented.
    requireKeys(t, ['risk', 'name', 'description'], at);
    const extra = Object.keys(t).filter((k) => !['risk', 'name', 'txsCount', 'description'].includes(k));
    if (extra.length > 0) {
      throw new InterceptaShapeError(`${at} does not match the documented schema; undocumented ${extra.join(', ')}`);
    }
    const name = t['name'];
    if (typeof name !== 'string' || !isDocumentedTraitName(name)) {
      throw new InterceptaShapeError(`${at}.name ${JSON.stringify(name)} is not in the documented trait enum`);
    }
    let txsCount: number | undefined;
    if (Object.prototype.hasOwnProperty.call(t, 'txsCount')) {
      txsCount = requireFiniteNumber(t['txsCount'], `${at}.txsCount`);
      if (!Number.isSafeInteger(txsCount) || txsCount < 0) {
        throw new InterceptaShapeError(`${at}.txsCount must be a non-negative integer count, got ${txsCount}`);
      }
    }
    return {
      risk: requireFiniteNumber(t['risk'], `${at}.risk`),
      name,
      ...(txsCount !== undefined ? { txsCount } : {}),
      description: requireString(t['description'], `${at}.description`),
    };
  });
  return { toxicScore, traits };
}

export function parseTokenRiskAnalysisResponse(json: unknown): TokenRiskAnalysisResponse {
  if (!isPlainObject(json)) {
    throw new InterceptaShapeError(`TokenRiskAnalysisV2Response must be a JSON object, got ${JSON.stringify(json)}`);
  }
  requireKeys(
    json,
    ['apiVersion', 'saleTax', 'buyTax', 'riskScore', 'riskLevel', 'category', 'trust', 'action', 'detectors', 'token'],
    'TokenRiskAnalysisV2Response',
  );
  const token = json['token'];
  if (!isPlainObject(token)) throw new InterceptaShapeError('TokenRiskAnalysisV2Response.token must be an object');
  return {
    apiVersion: json['apiVersion'],
    saleTax: json['saleTax'],
    buyTax: json['buyTax'],
    riskScore: requireFiniteNumber(json['riskScore'], 'riskScore'),
    riskLevel: requireEnum(json['riskLevel'], ['neutral', 'low', 'medium', 'high'], 'riskLevel'),
    category: requireEnum(
      json['category'],
      ['malicious', 'restricted', 'suspicious', 'availability', 'sanctioned', 'unverified', 'info'],
      'category',
    ),
    trust: requireEnum(json['trust'], ['whitelist', 'blocklist', 'neutral'], 'trust'),
    action: requireEnum(json['action'], ['block', 'warn', 'info'], 'action'),
    detectors: requireDetectorArray(json['detectors'], 'detectors'),
    token,
  };
}

export function parseSignatureAnalysisResponse(json: unknown): SignatureAnalysisResponse {
  if (!isPlainObject(json)) {
    throw new InterceptaShapeError(`SignatureAnalysisResponseDTO must be a JSON object, got ${JSON.stringify(json)}`);
  }
  requireKeys(json, ['from', 'detectors', 'riskGroup', 'addresses'], 'SignatureAnalysisResponseDTO');
  const rawAddresses = json['addresses'];
  if (!Array.isArray(rawAddresses)) {
    throw new InterceptaShapeError('SignatureAnalysisResponseDTO.addresses must be an array');
  }
  const addresses = rawAddresses.map((a: unknown, i: number) => {
    const at = `addresses[${i}]`;
    if (!isPlainObject(a)) throw new InterceptaShapeError(`${at} must be an object`);
    const detectors = a['detectors'];
    if (!Array.isArray(detectors)) throw new InterceptaShapeError(`${at}.detectors must be an array`);
    return { address: requireString(a['address'], `${at}.address`), type: a['type'], detectors };
  });
  const result: SignatureAnalysisResponse = {
    from: requireString(json['from'], 'from'),
    detectors: requireDetectorArray(json['detectors'], 'detectors'),
    riskGroup: requireEnum(json['riskGroup'], ['Low', 'Medium', 'High'], 'riskGroup'),
    addresses,
  };
  if ('domain' in json) result.domain = json['domain'];
  if ('assetsMovement' in json) {
    const am = json['assetsMovement'];
    if (isPlainObject(am) && Array.isArray(am['approve'])) {
      result.assetsMovement = { approve: am['approve'] };
    } else if (isPlainObject(am)) {
      result.assetsMovement = {};
    }
  }
  return result;
}

function validated<T>(parse: (j: unknown) => T, json: unknown, evidence: ScanEvidence): T {
  try {
    return parse(json);
  } catch (error) {
    if (error instanceof InterceptaShapeError) {
      error.evidence = evidence;
      error.message += ` (body stored at ${evidence.storedAt})`;
    }
    throw error;
  }
}

// ─── Public calls ───────────────────────────────────────────────────────────

/**
 * Quick Scan (`quick-scan`, fast/low-latency) or Deep Scan (`toxic-score`,
 * covers sanctions/AML/phishing history), live, validated strictly. Both
 * return the same `ToxicScoreShortResponseV2` shape.
 */
export async function scanAddress(
  address: string,
  kind: AddressScanKind,
  options: InterceptaCallOptions = {},
): Promise<{ result: ToxicScoreResponse; evidence: ScanEvidence }> {
  const subject = parseScreeningSubject(address);
  const url = addressScanUrl(kind, subject);
  const { json, evidence } = await liveRequest(kind, url, { method: 'GET' }, options);
  return { result: validated(parseToxicScoreResponse, json, evidence), evidence };
}

/**
 * Scan Token: ERC-20 rug-pull/honeypot/sanctions/fake-token risk. `chainId`
 * must be one of Intercepta's documented enum values (`TOKEN_CHAIN_IDS`),
 * which contains no Sui id — see the module doc comment.
 */
export async function scanToken(
  tokenAddress: string,
  chainId: string,
  options: InterceptaCallOptions = {},
): Promise<{ result: TokenRiskAnalysisResponse; evidence: ScanEvidence }> {
  const addr = parseTokenAddress(tokenAddress);
  if (typeof chainId !== 'string' || !isTokenChainId(chainId)) {
    throw new InterceptaSubjectError(
      `chainId ${JSON.stringify(chainId)} is not in Intercepta's documented Scan Token enum: ${TOKEN_CHAIN_IDS.join(', ')}`,
    );
  }
  const url = scanTokenUrl(addr, chainId);
  const { json, evidence } = await liveRequest('scan-token', url, { method: 'GET' }, options);
  return { result: validated(parseTokenRiskAnalysisResponse, json, evidence), evidence };
}

/**
 * Scan Message: analyzes an EIP-712 off-chain signature. Body params per the
 * docs: `from` (required), `message` (required JSON EIP-712 payload:
 * domain/types/primaryType/message), `website` (optional), `chainId`
 * (optional, defaults to `"1"`; the full enum beyond the default is
 * UNCONFIRMED by this session — VERIFY_FINDINGS item 5 says only "EVM-only
 * enum" without listing every value, and the local doc crawl shows "Show 16
 * enum values" without expanding them). A non-default chainId is passed
 * through as given rather than validated against a guessed enum.
 *
 * IMPORTANT FIT NOTE (see package report): the documented `messageType`
 * values this endpoint recognizes are `Permit, PermitSingle, PermitBatch,
 * PermitForAll, PermitTransferFrom, PermitBatchTransferFrom` — the Permit /
 * Permit2 family. x402's EVM `exact` scheme signs an ERC-3009
 * `TransferWithAuthorization` EIP-712 message, which is NOT in that list.
 * This function is built faithfully to the documented schema, but it is very
 * likely NOT the right tool to screen this migration's actual payment
 * authorization signature. Do not wire it into `resolvePremise` on the
 * assumption that it covers the x402 payment payload.
 */
export async function scanMessage(
  payload: { from: string; message: unknown; website?: string; chainId?: string },
  options: InterceptaCallOptions = {},
): Promise<{ result: SignatureAnalysisResponse; evidence: ScanEvidence }> {
  if (typeof payload.from !== 'string' || payload.from.length === 0) {
    throw new InterceptaSubjectError('scanMessage: "from" (signature owner address) is required');
  }
  if (payload.message === undefined || payload.message === null) {
    throw new InterceptaSubjectError('scanMessage: "message" (EIP-712 JSON payload) is required');
  }
  const body = JSON.stringify({
    from: payload.from,
    message: payload.message,
    ...(payload.website !== undefined ? { website: payload.website } : {}),
    chainId: payload.chainId ?? '1', // documented default
  });
  const { json, evidence } = await liveRequest('scan-message', SCAN_MESSAGE_URL, { method: 'POST', body }, options);
  return { result: validated(parseSignatureAnalysisResponse, json, evidence), evidence };
}
