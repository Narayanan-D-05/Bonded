/**
 * @bonded/dispatcher — the `resolvePremise()` router.
 *
 * `packages/enforcer/src/enforce.ts`'s own `EnforceDeps.resolvePremise` doc
 * comment already says it "routes to whichever adapter owns `def.schema`"
 * and that "this package never inspects that string itself, only passes it
 * through" — but nothing in the repo actually implemented that router before
 * this package. Every existing `enforce()` caller so far is a unit test with
 * a hand-rolled `jest.fn()` mock for `resolvePremise`. This package is that
 * router, plus the one other piece `EnforceDeps` needs that has nowhere
 * else to live: a real (non-test-stub) `canonicalHash`/`computeLogRef`.
 *
 * Zero runtime dependency beyond `@bonded/seam` (and that only for the
 * `Premise` type, imported type-only). `@bonded/enforcer` is a devDependency
 * only, imported type-only (`EnforceDeps`, `LogRefInput`) so this file's
 * exported function signatures line up with the real interface — that is
 * not a runtime dependency on `@bonded/enforcer`, since nothing here calls
 * `enforce()` or imports any of its runtime values.
 */

import { createHash } from 'node:crypto';
import type { Hash32, PolicyArtifact, Premise, Proposal } from '@bonded/seam';
import type { EnforceDeps, LogRefInput } from '@bonded/enforcer';

/**
 * One adapter's field table, matching the calling convention every existing
 * adapter (`@bonded/issuer-oracle`'s `issuerOracleTickets`/`issuerOracleEcomm`/
 * `issuerOracleVendors`, `@bonded/intercepta-adapter`'s `interceptaRisk`)
 * already implements: a plain object of `async` functions keyed by dot-path
 * field name, each taking the subject's ordered string args (vendor id,
 * address, chain, ...) and resolving to the same `bigint | string | null`
 * union `EnforceDeps.resolvePremise` itself returns.
 */
export interface SchemaFieldTable {
  fields: Record<string, (...args: string[]) => Promise<bigint | string | null>>;
}

/** Every schema name this deployment knows how to resolve, keyed by `Premise.schema`. */
export type SchemaRegistry = Record<string, SchemaFieldTable>;

/**
 * Builds `EnforceDeps.resolvePremise` from a `SchemaRegistry`. Looks up
 * `registry[def.schema]`; if that schema isn't registered, resolves `null`
 * (the enforcer's existing "unresolvable" contract — see `enforce.ts`,
 * `derived === null` -> `ReasonCode.PREMISE_UNRESOLVABLE`). Looks up
 * `table.fields[def.field]`; if that field isn't in the table, also `null`.
 * Otherwise calls the field function with `def.args` spread in the exact
 * order given (`def.args ?? []` when the premise declares no args at all)
 * and returns whatever it resolves to, unmodified.
 *
 * `at` (the pinned checkpoint `enforce()` resolved once for the whole
 * proposal) is accepted, to match `EnforceDeps['resolvePremise']`'s real
 * signature exactly, but intentionally unused: no adapter in this repo today
 * (issuer-oracle, intercepta-risk) pins its answer to a chain checkpoint —
 * they all read whatever their backing fixture/API says "now". A future
 * chain-pinned adapter would consume `at` itself; this dispatcher has no
 * opinion on checkpoints and simply threads the parameter through unused
 * rather than silently dropping it from the signature.
 */
export function createResolvePremise(registry: SchemaRegistry): EnforceDeps['resolvePremise'] {
  return async (def: Premise, _at: bigint): Promise<bigint | string | null> => {
    const table = registry[def.schema];
    if (table === undefined) {
      return null;
    }
    const fieldFn = table.fields[def.field];
    if (fieldFn === undefined) {
      return null;
    }
    return fieldFn(...(def.args ?? []));
  };
}

/** Prefix of a premise arg that names another premise's CLAIMED value: `claim:<premiseId>`. */
export const CLAIM_ARG_PREFIX = 'claim:';

/**
 * Binds `claim:<premiseId>` args to one proposal's claimed values, so a
 * committed policy can say "screen whatever payee identity this proposal
 * claims" without the policy (and its on-chain hash) changing per invoice.
 *
 * Why this exists: `BondedRegistry` holds ONE policy hash per agent, so one
 * policy has to serve every invoice that agent pays. A screening premise's
 * subject (e.g. the claimed payee EVM identity) differs per invoice, and
 * `Premise.args` are fixed in the policy. A plain arg passes through
 * unchanged; `claim:<id>` is replaced by `proposal.premises[i].claimedValue`
 * for that premise id.
 *
 * Fails closed: if the proposal makes no claim for the named premise (or
 * claims it more than once), this resolves `null` without calling the
 * adapter, which `enforce()` turns into REFUSED / PREMISE_UNRESOLVABLE.
 *
 * Opt-in: `createResolvePremise` itself never interprets args.
 */
export function bindClaimArgs(
  resolvePremise: EnforceDeps['resolvePremise'],
  proposal: Pick<Proposal, 'premises'>,
): EnforceDeps['resolvePremise'] {
  return async (def: Premise, at: bigint): Promise<bigint | string | null> => {
    if (def.args === undefined || !def.args.some((a) => a.startsWith(CLAIM_ARG_PREFIX))) {
      return resolvePremise(def, at);
    }
    const bound: string[] = [];
    for (const arg of def.args) {
      if (!arg.startsWith(CLAIM_ARG_PREFIX)) {
        bound.push(arg);
        continue;
      }
      const premiseId = arg.slice(CLAIM_ARG_PREFIX.length);
      const claims = proposal.premises.filter((p) => p.premiseId === premiseId);
      if (claims.length !== 1) return null;
      bound.push(claims[0]!.claimedValue);
    }
    return resolvePremise({ ...def, args: bound }, at);
  };
}

/** One adapter call that threw and was converted to `null` by `failClosedTable`. */
export interface ResolveFailure {
  schema: string;
  field: string;
  args: string[];
  /** `error.name` (e.g. `InterceptaKeyMissingError`), or `'NonError'` if something other than an Error was thrown. */
  errorName: string;
  message: string;
}

/**
 * Opt-in, per-table fail-closed wrapper. Every field function of `table` is
 * wrapped so that a THROW becomes `null`, and the error is handed to
 * `onFailure` first. Nothing is dropped silently.
 *
 * Why this exists: `EnforceDeps.resolvePremise`'s own contract
 * (`packages/enforcer/src/enforce.ts`) says it returns `null` when a premise
 * "cannot be resolved at all (unknown schema, unknown field, adapter error)",
 * and `enforce()` maps `null` to REFUSED / PREMISE_UNRESOLVABLE. But
 * `@bonded/intercepta-adapter` deliberately THROWS on a missing key, an HTTP
 * error or an unexpected shape, so that no failure can be read as a value.
 * Without this wrapper, such a throw escapes `enforce()` as a rejected
 * promise, and no verdict is produced. With it, an unscreenable payee is a
 * REFUSED verdict (fail closed), and the caller keeps the exact error to
 * show next to that verdict.
 *
 * Opt-in on purpose: `createResolvePremise`'s default behaviour (a throw
 * propagates) is unchanged for every table not wrapped here.
 */
export function failClosedTable(
  schema: string,
  table: SchemaFieldTable,
  onFailure: (failure: ResolveFailure) => void,
): SchemaFieldTable {
  const fields: SchemaFieldTable['fields'] = {};
  for (const [field, fn] of Object.entries(table.fields)) {
    fields[field] = async (...args: string[]) => {
      try {
        return await fn(...args);
      } catch (error) {
        onFailure({
          schema,
          field,
          args: [...args],
          errorName: error instanceof Error ? error.name : 'NonError',
          message: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    };
  }
  return { fields };
}

/**
 * Recursively sorts every object's keys (arrays keep their original order)
 * and tags `bigint` values so they survive `JSON.stringify` — which throws
 * on a raw `bigint` — without colliding with a legitimate string field that
 * happens to look like a number. This is the one and only canonicalization
 * rule `canonicalHash`/`computeLogRef` below rely on; nothing else in this
 * file reimplements key-sorting or bigint handling separately.
 */
function sortValue(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return { $bigint: value.toString() };
  }
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortValue((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/** `JSON.stringify` over the key-sorted, bigint-tagged shape `sortValue` produces. */
function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sha256Hex(input: string): Hash32 {
  return `0x${createHash('sha256').update(input, 'utf8').digest('hex')}`;
}

/**
 * Deterministic `PolicyArtifact` -> `Hash32`: stable-sort every object key
 * recursively (arrays keep their order), `JSON.stringify` the result, then
 * sha256 (Node's `node:crypto`, no new dependency) the UTF-8 bytes,
 * formatted as a `0x`-prefixed hex `Hash32`.
 *
 * Why this package, and not the caller, owns this: `move/sources/
 * bonded_registry.move`'s `commit_policy` stores an opaque `vector<u8>`
 * that Move compares only for byte-equality — there is no on-chain-enforced
 * hash scheme to conform to (confirmed by reading the actual Move source,
 * not guessed). Since nothing external dictates the hash function, THIS
 * implementation is authoritative for the whole repo. Every caller that
 * needs its locally-computed policy hash to actually equal the on-chain
 * `onchainPolicyHash` (console, mcp-server, villain-corpus, or a future
 * commit-policy script) MUST import and call this exact `canonicalHash`
 * rather than re-deriving its own JSON-canonicalization-plus-hash scheme —
 * two different "reasonable" canonicalizations of the same object produce
 * different bytes and therefore different hashes, and `STALE_POLICY` would
 * trip spuriously (or, worse, silently line up by accident on one shape and
 * silently diverge on the next).
 */
export function canonicalHash(policy: PolicyArtifact): Hash32 {
  return sha256Hex(stableStringify(policy));
}

/**
 * Deterministic `LogRefInput` -> `Hash32`, same stable-JSON-then-sha256
 * approach as `canonicalHash` above (including the `bigint` tagging in
 * `sortValue`, needed here because `LogRefInput.checkpoint` is a `bigint`).
 * Same authority note applies: `enforce.ts`'s own header says `Verdict.logRef`
 * "has no defined derivation anywhere" in the PRD pseudocode, so this is
 * this package's own choice, not a guess at an external format.
 */
export function computeLogRef(entry: LogRefInput): Hash32 {
  return sha256Hex(stableStringify(entry));
}

/**
 * Composes the real, non-test-stub `EnforceDeps` this repo's `enforce()`
 * needs: `resolvePremise` from `createResolvePremise(registry)`,
 * `canonicalHash`/`computeLogRef` from this file (see their doc comments —
 * this package is authoritative for both), and the three remaining pieces
 * (`getCheckpoint`, `sumRecentSpend`, `logMismatch`) passed straight through
 * from `extras`, because those are genuinely chain/storage-specific and this
 * package has no opinion on them (it must stay zero-chain-dependency, same
 * as `@bonded/enforcer` itself).
 */
export function createEnforceDeps(
  registry: SchemaRegistry,
  extras: {
    getCheckpoint: EnforceDeps['getCheckpoint'];
    sumRecentSpend: EnforceDeps['sumRecentSpend'];
    logMismatch: EnforceDeps['logMismatch'];
  },
): EnforceDeps {
  return {
    resolvePremise: createResolvePremise(registry),
    getCheckpoint: extras.getCheckpoint,
    sumRecentSpend: extras.sumRecentSpend,
    logMismatch: extras.logMismatch,
    canonicalHash,
    computeLogRef,
  };
}
