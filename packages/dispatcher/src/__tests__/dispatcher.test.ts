/**
 * `@bonded/dispatcher` is the piece `enforce.ts`'s own header already
 * assumed existed ("routes to whichever adapter owns `def.schema`") but
 * nothing in the repo implemented before this package. These tests cover:
 * routing to the right table/field, the two `null` failure paths (unknown
 * schema, unknown field), `args` order, `canonicalHash`/`computeLogRef`
 * stability + divergence, and — the one that actually proves the BEC
 * mismatch machinery works outside of a mock — a real end-to-end resolve
 * against `@bonded/issuer-oracle`'s real `issuerOracleVendors` field table
 * and its real seeded `vnd-globex-freight` fixture record.
 */

import type { Address, Hash32, PolicyArtifact, Premise, Proposal } from '@bonded/seam';
import { ReasonCode } from '@bonded/seam';
import type { LogRefInput } from '@bonded/enforcer';
import { issuerOracleVendors } from '@bonded/issuer-oracle';
import { canonicalHash, computeLogRef, createResolvePremise, type SchemaRegistry } from '../index.js';

const CHECKPOINT = 42n;

function makePremise(overrides: Partial<Premise> = {}): Premise {
  return {
    id: 'p1',
    schema: 'test-schema',
    field: 'test.field',
    op: 'eq',
    value: '',
    ...overrides,
  };
}

describe('createResolvePremise', () => {
  it('routes to the matching table/field for a Premise whose schema/field are registered', async () => {
    const registry: SchemaRegistry = {
      'test-schema': {
        fields: {
          'test.field': async () => 'resolved-value',
        },
      },
    };
    const resolvePremise = createResolvePremise(registry);
    const result = await resolvePremise(makePremise(), CHECKPOINT);
    expect(result).toBe('resolved-value');
  });

  it('returns null for an unknown schema', async () => {
    const registry: SchemaRegistry = {
      'known-schema': { fields: { 'x.y': async () => 1n } },
    };
    const resolvePremise = createResolvePremise(registry);
    const result = await resolvePremise(makePremise({ schema: 'unknown-schema' }), CHECKPOINT);
    expect(result).toBeNull();
  });

  it('returns null for a known schema but an unknown field', async () => {
    const registry: SchemaRegistry = {
      'test-schema': { fields: { 'known.field': async () => 1n } },
    };
    const resolvePremise = createResolvePremise(registry);
    const result = await resolvePremise(makePremise({ schema: 'test-schema', field: 'unknown.field' }), CHECKPOINT);
    expect(result).toBeNull();
  });

  it('passes args through to the field function in the exact order given', async () => {
    let received: string[] = [];
    const registry: SchemaRegistry = {
      'test-schema': {
        fields: {
          'test.field': async (...args: string[]) => {
            received = args;
            return 1n;
          },
        },
      },
    };
    const resolvePremise = createResolvePremise(registry);
    await resolvePremise(makePremise({ args: ['first', 'second', 'third'] }), CHECKPOINT);
    expect(received).toEqual(['first', 'second', 'third']);
  });

  it('calls the field function with no args when def.args is undefined', async () => {
    let callCount = -1;
    const registry: SchemaRegistry = {
      'test-schema': {
        fields: {
          'test.field': async (...args: string[]) => {
            callCount = args.length;
            return 1n;
          },
        },
      },
    };
    const resolvePremise = createResolvePremise(registry);
    await resolvePremise(makePremise(), CHECKPOINT);
    expect(callCount).toBe(0);
  });

  describe('real end-to-end: @bonded/issuer-oracle, no mocks', () => {
    it("resolves 'vendor.payoutAddress' for vnd-globex-freight to the real seeded payout address", async () => {
      // Schema-key convention this package settles on for the vendor field
      // table: 'issuer-oracle-vendors' — issuerOracleVendors does not export
      // its own schema-key string (unlike @bonded/intercepta-adapter's
      // interceptaRisk, which exports `schema: 'intercepta-risk' as const`),
      // so this string is this package's own stable choice. Later consumers
      // wiring the full registry (villain-corpus, console, mcp-server) must
      // use this exact string for @bonded/issuer-oracle's vendor table.
      const registry: SchemaRegistry = {
        'issuer-oracle-vendors': issuerOracleVendors,
      };
      const resolvePremise = createResolvePremise(registry);

      const premise = makePremise({
        schema: 'issuer-oracle-vendors',
        field: 'vendor.payoutAddress',
        args: ['vnd-globex-freight'],
      });

      const result = await resolvePremise(premise, CHECKPOINT);

      // Real value read directly from packages/issuer-oracle/src/vendor-fixture.ts's
      // TRUTH['vnd-globex-freight'].payoutAddress — not guessed, not re-typed
      // from memory.
      expect(result).toBe('0xcbd8e5f2ff0c192633404d5a6774818e9ba8b5c2cfdce9f603101d2a3744515e');
    });

    it('returns null for an unknown vendor id through the real issuer-oracle table', async () => {
      const registry: SchemaRegistry = { 'issuer-oracle-vendors': issuerOracleVendors };
      const resolvePremise = createResolvePremise(registry);
      const result = await resolvePremise(
        makePremise({ schema: 'issuer-oracle-vendors', field: 'vendor.payoutAddress', args: ['vnd-does-not-exist'] }),
        CHECKPOINT,
      );
      expect(result).toBeNull();
    });
  });
});

describe('canonicalHash', () => {
  function buildPolicy(): PolicyArtifact {
    return {
      version: 1,
      budget: { asset: 'USDC', period: 'daily', max: '100000000' },
      premises: [
        { id: 'p1', schema: 'issuer-oracle-vendors', field: 'vendor.payoutAddress', op: 'eq', value: '0xabc' },
      ],
      forbid: ['self-destruct'],
      irreversibleAboveUSDC: '50000000',
    };
  }

  // Same content, top-level and nested keys constructed in a different
  // insertion order than buildPolicy() above.
  function buildPolicyReorderedKeys(): PolicyArtifact {
    return {
      irreversibleAboveUSDC: '50000000',
      forbid: ['self-destruct'],
      premises: [
        { value: '0xabc', op: 'eq', field: 'vendor.payoutAddress', schema: 'issuer-oracle-vendors', id: 'p1' },
      ],
      budget: { max: '100000000', period: 'daily', asset: 'USDC' },
      version: 1,
    };
  }

  it('produces the identical hash for the same PolicyArtifact constructed with keys in different insertion order', () => {
    const hashA = canonicalHash(buildPolicy());
    const hashB = canonicalHash(buildPolicyReorderedKeys());
    expect(hashA).toBe(hashB);
  });

  it('produces a different hash for a genuinely different policy', () => {
    const base = canonicalHash(buildPolicy());
    const changed = canonicalHash({ ...buildPolicy(), irreversibleAboveUSDC: '99999999' });
    expect(changed).not.toBe(base);
  });

  it('returns a 0x-prefixed 64-hex-char hash (sha256)', () => {
    const hash = canonicalHash(buildPolicy());
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe('computeLogRef', () => {
  const PROPOSAL_ID = `0x${'ab'.repeat(32)}` as Hash32;
  const AGENT = `0x${'01'.repeat(20)}` as Address;
  const TARGET = `0x${'02'.repeat(20)}` as Address;
  const POLICY_HASH = `0x${'cd'.repeat(32)}` as Hash32;

  function buildProposal(): Proposal {
    return {
      id: PROPOSAL_ID,
      agent: AGENT,
      action: { kind: 'transfer', target: TARGET, calldata: '0x', valueUSDC: '10000000' },
      premises: [{ premiseId: 'p1', claimedValue: '45000000' }],
      createdAt: 1_758_000_000,
    };
  }

  function buildEntry(): LogRefInput {
    return {
      proposal: buildProposal(),
      policyHash: POLICY_HASH,
      outcome: 0,
      reasonCode: ReasonCode.OK,
      checkpoint: CHECKPOINT,
    };
  }

  // Same content as buildEntry(), keys (including the nested proposal's own
  // keys) constructed in a different insertion order.
  function buildEntryReorderedKeys(): LogRefInput {
    const proposal: Proposal = {
      createdAt: 1_758_000_000,
      premises: [{ claimedValue: '45000000', premiseId: 'p1' }],
      action: { valueUSDC: '10000000', calldata: '0x', target: TARGET, kind: 'transfer' },
      agent: AGENT,
      id: PROPOSAL_ID,
    };
    return {
      checkpoint: CHECKPOINT,
      reasonCode: ReasonCode.OK,
      outcome: 0,
      policyHash: POLICY_HASH,
      proposal,
    };
  }

  it('produces the identical hash for the same LogRefInput constructed with keys in different insertion order', () => {
    const hashA = computeLogRef(buildEntry());
    const hashB = computeLogRef(buildEntryReorderedKeys());
    expect(hashA).toBe(hashB);
  });

  it('produces a different hash for a different checkpoint (bigint) value', () => {
    const base = computeLogRef(buildEntry());
    const changed = computeLogRef({ ...buildEntry(), checkpoint: CHECKPOINT + 1n });
    expect(changed).not.toBe(base);
  });

  it('produces a different hash for a different reasonCode', () => {
    const base = computeLogRef(buildEntry());
    const changed = computeLogRef({ ...buildEntry(), outcome: 1, reasonCode: ReasonCode.PREMISE_MISMATCH });
    expect(changed).not.toBe(base);
  });
});
