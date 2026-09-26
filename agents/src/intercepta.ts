/**
 * Live Intercepta (Web3 Antivirus) HTTP client. PRD Parts C.2, G and H.
 *
 * Every endpoint, path, parameter, header and response field below was checked
 * on 2026-09-25 against the OpenAPI definition each reference page embeds
 * (fetch `<page>.md`, e.g. https://docs.web3antivirus.io/reference/quick-scan-address.md).
 * docs/VERIFY_FINDINGS.md item 5 has the same findings.
 *
 * Rules this file enforces:
 *  - No cache (PRD Part H: "live scans, no cache"). Every call is a fresh
 *    request, and nothing here memoises a response.
 *  - No fallback value, ever (CLAUDE.md rule 1). A missing key, a non-2xx, a
 *    timeout, non-JSON, or an unexpected shape all THROW. None of them is ever
 *    read as "clean".
 *  - The exact response bytes are kept. Their sha256 is the evidence hash, and
 *    the bytes are written to `<repo>/.data/intercepta/<sha256>.json` (gitignored)
 *    before the body is interpreted. That way a slash can later cite the precise
 *    response that justified it (CLAUDE.md rule 5), and anyone can re-hash the file.
 *
 * Probe without a key (2026-09-25): all three paths below answer
 * `403 {"status":403,"response":"This authentication key is incorrect or doesn’t exist",...}`,
 * while an unknown path on the same host answers 404. Routing therefore runs before auth, so
 * the 403 confirms each path exists.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Hash32 } from '@bonded/seam';

// ─── Endpoints (documented) ─────────────────────────────────────────────────

/** OAS `servers[0].url`. */
export const INTERCEPTA_HOST = 'https://api.web3antivirus.io';
/** Prefix of the Quick Scan and Deep Scan paths. */
export const INTERCEPTA_BASE_URL = `${INTERCEPTA_HOST}/api/public/v2/extension`;
/**
 * Prefix of Check Address Activity. It is **v1**, not v2. OAS path:
 * `/api/public/v1/extension/account/{address}/check-activity`.
 */
export const INTERCEPTA_V1_BASE_URL = `${INTERCEPTA_HOST}/api/public/v1/extension`;

export type InterceptaEndpoint = 'quick-scan' | 'toxic-score' | 'check-activity';

/**
 * Check Address Activity takes an optional `chainId` (OAS enum:
 * 1, 8453, 42161, 43114, 56, 146, 130, 59144, 81457, 57073, 137, 33139). The
 * default when it is omitted is not documented, so it is always sent
 * explicitly. Mainnet is the choice because Intercepta's intelligence is
 * mainnet activity, and Sepolia is not in the enum.
 * UNCONFIRMED: which chains the Quick/Deep Scan verdicts cover. Neither
 * endpoint takes a chainId.
 */
export const ACTIVITY_CHAIN_ID = '1';

export function endpointUrl(endpoint: InterceptaEndpoint, subject: ScreeningSubject): string {
  const addr = encodeURIComponent(subject.value);
  switch (endpoint) {
    case 'quick-scan': // OAS operationId quick-scan-address, "Quick Scan Address"
      return `${INTERCEPTA_BASE_URL}/account/${addr}/quick-scan`;
    case 'toxic-score': // OAS operationId scan-address, "Deep Scan Address"
      return `${INTERCEPTA_BASE_URL}/account/${addr}/toxic-score`;
    case 'check-activity': // OAS operationId check-address-activity
      return `${INTERCEPTA_V1_BASE_URL}/account/${addr}/check-activity?chainId=${ACTIVITY_CHAIN_ID}`;
  }
}

// ─── Errors: every failure is visible and typed ─────────────────────────────

export const INTERCEPTA_API_KEY_ENV = 'INTERCEPTA_API_KEY';
export const INTERCEPTA_KEY_SIGNUP_URL = 'https://intercepta.io/ethglobal';
/** The exact line the user adds to `<repo>/.env`. */
export const ENV_LINE_TO_ADD = `${INTERCEPTA_API_KEY_ENV}=<your key from ${INTERCEPTA_KEY_SIGNUP_URL}>`;

export class InterceptaKeyMissingError extends Error {
  constructor() {
    super(
      `${INTERCEPTA_API_KEY_ENV} is not set, so no live Intercepta call can be made and no risk ` +
        `quote exists. There is no fallback value (CLAUDE.md rule 1). Add this line to the ` +
        `repo-root .env: ${ENV_LINE_TO_ADD}`,
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
    readonly endpoint: InterceptaEndpoint,
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

// ─── Subjects: EVM address or ENS name only ─────────────────────────────────

export type ScreeningSubject =
  | { kind: 'evm'; value: `0x${string}` }
  | { kind: 'ens'; value: string };

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SUI_ADDRESS = /^0x[0-9a-fA-F]{64}$/;
/** Lowercase ASCII labels, at least two, no empty label. */
const ENS_NAME = /^(?:[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

const SUI_EXPLANATION =
  "Intercepta's address endpoints take an \"ETH address/ENS\" (the path parameter's documented " +
  'description) and cannot screen a Sui address. Screen the EVM address linked to the agent ' +
  'instead (docs/THREATMODEL.md, 2026-09-25).';

/**
 * Accept an EVM address or an ENS name. Reject everything else with a reason,
 * and never normalise silently.
 *
 * - EVM: `0x` plus 40 hex characters, any case. The EIP-55 checksum is NOT
 *   verified, because no keccak implementation is a dependency of this package.
 *   A mistyped address is caught only if its length or alphabet is wrong.
 * - ENS: lowercase ASCII labels only. A name that is not already normalised is
 *   rejected rather than lowercased here. Full ENSIP-15 (unicode) normalisation
 *   is out of scope.
 * - UNCONFIRMED: which chain Intercepta resolves ENS names on. The agents' names
 *   live on Sepolia (ENSv2), which Intercepta very likely does not resolve, so
 *   callers should pass the resolved EVM address.
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
  endpoint: InterceptaEndpoint;
  /** The subject exactly as it was sent (an EVM address or ENS name). */
  subject: string;
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
 * working directory that contains `pnpm-workspace.yaml`. Throws if there is none,
 * rather than writing evidence to some unexpected place.
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

// ─── The one transport ──────────────────────────────────────────────────────

export interface InterceptaCallOptions {
  /** Abort after this many ms. Default 10000. A timeout throws; it is never "clean". */
  timeoutMs?: number;
  /** Where raw bodies are written. Default: `defaultEvidenceDir()`. */
  evidenceDir?: string;
}

const EXCERPT_CHARS = 500;

/**
 * One live GET. Returns the parsed JSON (still unvalidated) and the evidence
 * for the exact bytes, which are already on disk by the time this returns.
 */
async function liveGet(
  endpoint: InterceptaEndpoint,
  rawSubject: string,
  options: InterceptaCallOptions,
): Promise<{ json: unknown; evidence: ScanEvidence }> {
  const subject = parseScreeningSubject(rawSubject);
  const apiKey = readApiKey();
  const evidenceDir = options.evidenceDir ?? defaultEvidenceDir();
  const url = endpointUrl(endpoint, subject);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  let status: number;
  let bytes: Uint8Array;
  try {
    const res = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
      headers: { accept: 'application/json', 'X-API-KEY': apiKey },
    });
    status = res.status;
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    throw new InterceptaHttpError(endpoint, null, '', `Intercepta ${endpoint} request failed: ${why}`);
  } finally {
    clearTimeout(timer);
  }
  const fetchedAtMs = Date.now();

  if (status < 200 || status > 299) {
    const excerpt = new TextDecoder().decode(bytes).slice(0, EXCERPT_CHARS);
    throw new InterceptaHttpError(
      endpoint,
      status,
      excerpt,
      `Intercepta ${endpoint} answered HTTP ${status}: ${excerpt}`,
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    const excerpt = new TextDecoder().decode(bytes).slice(0, EXCERPT_CHARS);
    throw new InterceptaShapeError(`Intercepta ${endpoint} returned a non-JSON 200 body: ${excerpt}`);
  }

  const hex = createHash('sha256').update(bytes).digest('hex');
  const storedAt = await storeBody(evidenceDir, hex, bytes);
  return {
    json,
    evidence: {
      endpoint,
      subject: subject.value,
      url,
      httpStatus: status,
      fetchedAtMs,
      sha256: `0x${hex}`,
      storedAt,
    },
  };
}

// ─── Strict response validation (documented schemas only) ──────────────────

/** OAS `ToxicScoreTraitV2.name` enum, verbatim and in documented order. */
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

/** OAS `ToxicScoreTraitV2`: all four fields required. */
export interface ToxicScoreTrait {
  /** "Risk level of the trait". Range UNCONFIRMED and not used for any decision. */
  risk: number;
  name: TraitName;
  /** "Number of detected transactions related to this trait". */
  txsCount: number;
  description: string;
}

/**
 * OAS `ToxicScoreShortResponseV2`, returned by BOTH Quick Scan and Deep Scan.
 * Both fields are required.
 */
export interface ToxicScoreResponse {
  /** "Evaluates and indicates the risk level of a wallet before interaction." Range UNCONFIRMED. */
  toxicScore: number;
  /** "List of suspicious activities detected on the address". */
  traits: ToxicScoreTrait[];
}

/** OAS `AddressActivityResponseDTO`: `hasActivity` is required. */
export interface AddressActivityResponse {
  hasActivity: boolean;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Exactly the documented keys, all present. Undocumented extra keys are
 * rejected too: the schema is confirmed only from docs, and any divergence is
 * something to see and update, not something to skip past.
 */
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

function requireFiniteNumber(v: unknown, what: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new InterceptaShapeError(`${what} must be a finite number, got ${JSON.stringify(v)}`);
  }
  return v;
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
    requireExactKeys(t, ['risk', 'name', 'txsCount', 'description'], at);
    const name = t['name'];
    if (typeof name !== 'string' || !isDocumentedTraitName(name)) {
      throw new InterceptaShapeError(`${at}.name ${JSON.stringify(name)} is not in the documented trait enum`);
    }
    const txsCount = requireFiniteNumber(t['txsCount'], `${at}.txsCount`);
    if (!Number.isSafeInteger(txsCount) || txsCount < 0) {
      throw new InterceptaShapeError(`${at}.txsCount must be a non-negative integer count, got ${txsCount}`);
    }
    const description = t['description'];
    if (typeof description !== 'string') {
      throw new InterceptaShapeError(`${at}.description must be a string`);
    }
    return { risk: requireFiniteNumber(t['risk'], `${at}.risk`), name, txsCount, description };
  });
  return { toxicScore, traits };
}

export function parseAddressActivityResponse(json: unknown): AddressActivityResponse {
  if (!isPlainObject(json)) {
    throw new InterceptaShapeError(`AddressActivityResponseDTO must be a JSON object, got ${JSON.stringify(json)}`);
  }
  requireExactKeys(json, ['hasActivity'], 'AddressActivityResponseDTO');
  const hasActivity = json['hasActivity'];
  if (typeof hasActivity !== 'boolean') {
    throw new InterceptaShapeError(`hasActivity must be a boolean, got ${JSON.stringify(hasActivity)}`);
  }
  return { hasActivity };
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

export type AddressScanKind = 'quick-scan' | 'toxic-score';

/** Quick Scan (`quick-scan`) or Deep Scan (`toxic-score`), live, validated strictly. */
export async function scanAddress(
  subject: string,
  kind: AddressScanKind,
  options: InterceptaCallOptions = {},
): Promise<{ result: ToxicScoreResponse; evidence: ScanEvidence }> {
  const { json, evidence } = await liveGet(kind, subject, options);
  return { result: validated(parseToxicScoreResponse, json, evidence), evidence };
}

/** Check Address Activity (v1), live, validated strictly. */
export async function checkAddressActivity(
  subject: string,
  options: InterceptaCallOptions = {},
): Promise<{ result: AddressActivityResponse; evidence: ScanEvidence }> {
  const { json, evidence } = await liveGet('check-activity', subject, options);
  return { result: validated(parseAddressActivityResponse, json, evidence), evidence };
}
