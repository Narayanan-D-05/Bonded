/**
 * PRD Part G, "Intercepta adapter" row: "`cache: 'no-store'` is asserted, not
 * assumed."
 *
 * What this file does NOT contain, on purpose (CLAUDE.md rule 7 / the
 * project's no-mocks rule): no fabricated Intercepta response body — clean,
 * flagged, or otherwise. Every test below is one of two kinds:
 *
 *   1. A spy on `global.fetch` that asserts what THIS CODE sends (URL,
 *      method, headers, body, and the `cache: 'no-store'` option) and then
 *      returns a generic HTTP error (500, `{}`) so the call fails before any
 *      "clean" or "flagged" shape is ever interpreted. This tests our
 *      request construction, not Intercepta's behaviour — a different thing
 *      from fabricating a sponsor response, per the task brief.
 *   2. A direct call to the strict parsers (`parseToxicScoreResponse` etc.)
 *      with deliberately malformed objects (empty object, wrong types, an
 *      array) that are not stand-ins for any real Intercepta response — they
 *      exist only to prove the validator fails closed on a shape that does
 *      not match the documented schema.
 *
 * The positive parse of a real response — the actual value of a live
 * `toxicScore` or `riskScore` — is exercised only by `scripts/probe.ts`
 * against the live API, once a key and the pinned Discord test addresses
 * exist (Migration PRD D.5).
 */
import { jest } from '@jest/globals';
import {
  DOCUMENTED_TRAIT_NAMES,
  ENV_LINE_TO_ADD,
  INTERCEPTA_API_KEY_ENV,
  INTERCEPTA_BASE_URL,
  InterceptaKeyMissingError,
  InterceptaShapeError,
  InterceptaSubjectError,
  SCAN_MESSAGE_URL,
  TOKEN_CHAIN_IDS,
  defaultEvidenceDir,
  isTokenChainId,
  parseScreeningSubject,
  parseSignatureAnalysisResponse,
  parseTokenAddress,
  parseTokenRiskAnalysisResponse,
  parseToxicScoreResponse,
  readApiKey,
  scanAddress,
  scanMessage,
  scanToken,
} from '../client.js';

// The docs' own example path parameter (https://docs.web3antivirus.io/reference/quick-scan-address),
// not any response content.
const EVM = '0x0d775e010f0b6c32c9468d43ba599ef47d596e47';
const SUI = `0x${'990acf44'}${'a'.repeat(52)}${'0d43'}`;

function jsonResponse(status: number, body: unknown): Response {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  return {
    status,
    arrayBuffer: async () => bytes.buffer,
  } as unknown as Response;
}

type FetchFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

describe('request construction: cache, headers, method and URL are asserted, not assumed', () => {
  const originalFetch = global.fetch;
  const originalKey = process.env[INTERCEPTA_API_KEY_ENV];
  let fetchSpy: jest.Mock<FetchFn>;

  beforeEach(() => {
    process.env[INTERCEPTA_API_KEY_ENV] = 'test-key-not-real';
    fetchSpy = jest.fn<FetchFn>(async () => jsonResponse(500, {}));
    global.fetch = fetchSpy;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env[INTERCEPTA_API_KEY_ENV];
    else process.env[INTERCEPTA_API_KEY_ENV] = originalKey;
  });

  test('scanAddress (quick-scan): GET, no-store, X-API-KEY header, correct URL', async () => {
    await expect(scanAddress(EVM, 'quick-scan')).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${INTERCEPTA_BASE_URL}/account/${EVM}/quick-scan`);
    expect(init.method).toBe('GET');
    expect(init.cache).toBe('no-store');
    expect((init.headers as Record<string, string>)['X-API-KEY']).toBe('test-key-not-real');
    expect(init.body).toBeUndefined();
  });

  test('scanAddress (toxic-score / Deep Scan): correct URL, still no-store', async () => {
    await expect(scanAddress(EVM, 'toxic-score')).rejects.toThrow();
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${INTERCEPTA_BASE_URL}/account/${EVM}/toxic-score`);
    expect(init.cache).toBe('no-store');
  });

  test('scanToken: GET, no-store, correct URL with chainId query param', async () => {
    await expect(scanToken(EVM, '1')).rejects.toThrow();
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${INTERCEPTA_BASE_URL}/token-intelligence/token/${EVM}/risks?chainId=1`);
    expect(init.method).toBe('GET');
    expect(init.cache).toBe('no-store');
  });

  test('scanMessage: POST, no-store, JSON content-type, correct URL and body', async () => {
    await expect(scanMessage({ from: EVM, message: { domain: {}, types: {}, primaryType: 'X', message: {} } })).rejects.toThrow();
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(SCAN_MESSAGE_URL);
    expect(init.method).toBe('POST');
    expect(init.cache).toBe('no-store');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    const sentBody = JSON.parse(init.body as string) as { from: string; chainId: string };
    expect(sentBody.from).toBe(EVM);
    expect(sentBody.chainId).toBe('1'); // documented default
  });

  test('a non-2xx status throws InterceptaHttpError and never returns a value', async () => {
    let result: unknown = 'never assigned';
    await expect(
      (async () => {
        result = await scanAddress(EVM, 'quick-scan');
      })(),
    ).rejects.toThrow(/HTTP 500/);
    expect(result).toBe('never assigned');
  });
});

describe('missing INTERCEPTA_API_KEY: throws, never returns a value, never touches the network', () => {
  const originalFetch = global.fetch;
  const originalKey = process.env[INTERCEPTA_API_KEY_ENV];
  let fetchSpy: jest.Mock<FetchFn>;

  beforeEach(() => {
    delete process.env[INTERCEPTA_API_KEY_ENV];
    fetchSpy = jest.fn<FetchFn>();
    global.fetch = fetchSpy;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env[INTERCEPTA_API_KEY_ENV];
    else process.env[INTERCEPTA_API_KEY_ENV] = originalKey;
  });

  test('readApiKey throws a visible error naming the .env line', () => {
    expect(() => readApiKey()).toThrow(InterceptaKeyMissingError);
    expect(() => readApiKey()).toThrow(ENV_LINE_TO_ADD);
  });

  test('empty and whitespace-only keys are treated as missing', () => {
    process.env[INTERCEPTA_API_KEY_ENV] = '';
    expect(() => readApiKey()).toThrow(InterceptaKeyMissingError);
    process.env[INTERCEPTA_API_KEY_ENV] = '   ';
    expect(() => readApiKey()).toThrow(InterceptaKeyMissingError);
  });

  test('scanAddress, scanToken and scanMessage all reject before calling fetch', async () => {
    await expect(scanAddress(EVM, 'quick-scan')).rejects.toBeInstanceOf(InterceptaKeyMissingError);
    await expect(scanToken(EVM, '1')).rejects.toBeInstanceOf(InterceptaKeyMissingError);
    await expect(scanMessage({ from: EVM, message: {} })).rejects.toBeInstanceOf(InterceptaKeyMissingError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('the key is read at call time, not captured at import', () => {
    expect(() => readApiKey()).toThrow(InterceptaKeyMissingError);
    process.env[INTERCEPTA_API_KEY_ENV] = 'present-for-this-assertion-only';
    expect(readApiKey()).toBe('present-for-this-assertion-only');
  });
});

describe('input validation happens before any network call', () => {
  const originalFetch = global.fetch;
  const originalKey = process.env[INTERCEPTA_API_KEY_ENV];
  let fetchSpy: jest.Mock<FetchFn>;

  beforeEach(() => {
    delete process.env[INTERCEPTA_API_KEY_ENV]; // reaching the network would be impossible anyway
    fetchSpy = jest.fn<FetchFn>();
    global.fetch = fetchSpy;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env[INTERCEPTA_API_KEY_ENV];
    else process.env[INTERCEPTA_API_KEY_ENV] = originalKey;
  });

  test('a Sui address is rejected with an explanation, not sent to Intercepta', async () => {
    await expect(scanAddress(SUI, 'quick-scan')).rejects.toBeInstanceOf(InterceptaSubjectError);
    await expect(scanAddress(SUI, 'quick-scan')).rejects.toThrow(/Sui/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('scanToken rejects a chainId outside the documented enum, including "sui" and a testnet id', async () => {
    await expect(scanToken(EVM, 'sui')).rejects.toBeInstanceOf(InterceptaSubjectError);
    await expect(scanToken(EVM, 'sepolia')).rejects.toBeInstanceOf(InterceptaSubjectError);
    await expect(scanToken(EVM, '11155111')).rejects.toBeInstanceOf(InterceptaSubjectError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('scanToken rejects an ENS name (Scan Token takes a contract address, not ETH address/ENS)', async () => {
    await expect(scanToken('vitalik.eth', '1')).rejects.toBeInstanceOf(InterceptaSubjectError);
  });

  test('scanMessage requires "from" and "message"', async () => {
    await expect(scanMessage({ from: '', message: {} })).rejects.toBeInstanceOf(InterceptaSubjectError);
    // @ts-expect-error deliberately omitting the required "message" field
    await expect(scanMessage({ from: EVM })).rejects.toBeInstanceOf(InterceptaSubjectError);
  });
});

describe('parseScreeningSubject / parseTokenAddress', () => {
  test('accepts a 20-byte EVM address in any case', () => {
    expect(parseScreeningSubject(EVM)).toEqual({ kind: 'evm', value: EVM });
    expect(parseScreeningSubject(EVM.toUpperCase().replace('0X', '0x')).kind).toBe('evm');
  });

  test('accepts a normalised ENS name', () => {
    expect(parseScreeningSubject('vitalik.eth')).toEqual({ kind: 'ens', value: 'vitalik.eth' });
  });

  test('rejects malformed input without normalising it', () => {
    for (const bad of ['', ' ', `${EVM} `, EVM.slice(0, -1), 'Vitalik.eth', '../../account']) {
      expect(() => parseScreeningSubject(bad)).toThrow(InterceptaSubjectError);
    }
  });

  test('parseTokenAddress accepts an EVM address and rejects an ENS name or Sui address', () => {
    expect(parseTokenAddress(EVM)).toBe(EVM);
    expect(() => parseTokenAddress('vitalik.eth')).toThrow(InterceptaSubjectError);
    expect(() => parseTokenAddress(SUI)).toThrow(InterceptaSubjectError);
  });
});

describe('TOKEN_CHAIN_IDS / isTokenChainId', () => {
  test('has no Sui id and no Sepolia/testnet id (VERIFY_FINDINGS item 5)', () => {
    expect(isTokenChainId('sui')).toBe(false);
    expect(isTokenChainId('sepolia')).toBe(false);
    expect(isTokenChainId('11155111')).toBe(false);
  });

  test('accepts every documented enum value', () => {
    for (const id of TOKEN_CHAIN_IDS) {
      expect(isTokenChainId(id)).toBe(true);
    }
  });
});

// ─── Response validation fails closed on a shape that is NOT a real
//     Intercepta response — no sponsor data is fabricated here ───────────────

describe('parseToxicScoreResponse: fails closed on a non-conforming shape', () => {
  const notResponses: unknown[] = [null, undefined, 0, 'ok', true, [], {}];

  test.each(notResponses)('rejects %p', (v) => {
    expect(() => parseToxicScoreResponse(v)).toThrow(InterceptaShapeError);
  });

  test('rejects a trait name outside the documented enum', () => {
    expect(() =>
      parseToxicScoreResponse({ toxicScore: 1, traits: [{ risk: 1, name: 'not_a_real_trait', txsCount: 0, description: 'x' }] }),
    ).toThrow(InterceptaShapeError);
  });

  test('rejects an undocumented extra top-level key (fully-confirmed schema, strict)', () => {
    expect(() => parseToxicScoreResponse({ toxicScore: 1, traits: [], somethingElse: true })).toThrow(InterceptaShapeError);
  });

  test('every documented trait name is accepted by the enum guard', () => {
    for (const name of DOCUMENTED_TRAIT_NAMES) {
      expect(() =>
        parseToxicScoreResponse({ toxicScore: 1, traits: [{ risk: 1, name, txsCount: 0, description: 'x' }] }),
      ).not.toThrow();
    }
  });
});

describe('parseTokenRiskAnalysisResponse: fails closed on a non-conforming shape', () => {
  const notResponses: unknown[] = [null, undefined, 0, 'ok', true, [], {}];

  test.each(notResponses)('rejects %p', (v) => {
    expect(() => parseTokenRiskAnalysisResponse(v)).toThrow(InterceptaShapeError);
  });

  test('rejects a riskLevel outside the documented enum', () => {
    expect(() =>
      parseTokenRiskAnalysisResponse({
        apiVersion: 1,
        saleTax: 0,
        buyTax: 0,
        riskScore: 10,
        riskLevel: 'extreme', // not documented
        category: 'info',
        trust: 'neutral',
        action: 'info',
        detectors: [],
        token: {},
      }),
    ).toThrow(InterceptaShapeError);
  });

  test('accepts every documented riskLevel/category/trust/action combination shape', () => {
    expect(() =>
      parseTokenRiskAnalysisResponse({
        apiVersion: 1,
        saleTax: 0,
        buyTax: 0,
        riskScore: 10,
        riskLevel: 'low',
        category: 'unverified',
        trust: 'neutral',
        action: 'info',
        detectors: [],
        token: {},
      }),
    ).not.toThrow();
  });
});

describe('parseSignatureAnalysisResponse: fails closed on a non-conforming shape', () => {
  const notResponses: unknown[] = [null, undefined, 0, 'ok', true, []];

  test.each(notResponses)('rejects %p', (v) => {
    expect(() => parseSignatureAnalysisResponse(v)).toThrow(InterceptaShapeError);
  });

  test('rejects a riskGroup outside Low|Medium|High', () => {
    expect(() =>
      parseSignatureAnalysisResponse({ from: EVM, detectors: [], riskGroup: 'Severe', addresses: [] }),
    ).toThrow(InterceptaShapeError);
  });
});

describe('defaultEvidenceDir', () => {
  test('resolves to <repo root>/.data/intercepta without throwing', () => {
    const dir = defaultEvidenceDir();
    expect(dir.replace(/\\/g, '/')).toMatch(/\.data\/intercepta$/);
  });
});
