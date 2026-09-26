'use client';

import { useRef, useState } from 'react';
import { IDKitRequestWidget, passport, type IDKitErrorCodes, type IDKitResult, type RpContext } from '@worldcoin/idkit';
import { buttonClass } from '../../../components/ui/button';
import { Notice } from '../../../components/ui/Notice';

/**
 * The vendor's side of a bank change: pick the vendor, enter the new Sui payout address and EVM
 * identity, then verify with World ID through IDKit using the `passport` credential preset.
 *
 * Flow (https://docs.world.org/world-id/idkit/integrate, Steps 3–5; React widget props from the
 * installed `@worldcoin/idkit` 4.3.0 `IDKitRequestWidgetProps`):
 *  1. `POST /api/idkit/rp-context` signs a fresh RP request server-side and returns the signal the
 *     server built from these exact fields.
 *  2. `IDKitRequestWidget` (controlled: `open` / `onOpenChange`) with `preset={passport({ signal })}`,
 *     `allow_legacy_proofs` (the passport preset forces legacy Document fallback on anyway) and the
 *     configured `environment`.
 *  3. `handleVerify` posts the result as-is to `/api/vendor/bank-change`, which verifies it with
 *     World and records it. If that throws, the widget emits `onError("failed_by_host_app")` and
 *     never calls `onSuccess` (docs: /world-id/idkit/react "Widget callbacks").
 *
 * This is the vendor's page, not a payment-approval button: nothing here moves money or edits the
 * vendor master (CLAUDE.md rule 4). It only files a verified request that the AP controller's own
 * World ID step-up then has to match.
 */

export interface VendorOption {
  vendorId: string;
  legalName: string;
  payoutAddress: string;
  evmAddress: string;
}

interface Session {
  app_id: `app_${string}`;
  action: string;
  environment: 'production' | 'staging' | 'sandbox';
  signal: string;
  rp_context: RpContext;
  claim: { vendorId: string; newPayoutAddress: string; newEvmAddress: string };
}

interface RecordedRequest {
  vendorId: string;
  newPayoutAddress: string;
  newEvmAddress: string;
  credentialType: string;
  protocolVersion: string;
  issuerSchemaId: number | null;
  nullifier: string;
  environment: string;
  verifiedAtMs: number;
}

type Outcome =
  | { kind: 'idle' }
  | { kind: 'error'; title: string; detail: string; missingEnv?: string[] }
  | { kind: 'recorded'; record: RecordedRequest };

/** Distinct, visible reasons for the client-side IDKit outcomes (codes from idkit-core `IDKitErrorCodes`). */
function describeIdkitError(code: IDKitErrorCodes | string): { title: string; detail: string } {
  switch (code) {
    case 'cancelled':
    case 'user_rejected':
    case 'verification_rejected':
      return { title: 'Cancelled', detail: `The verification was cancelled (${code}). Nothing was recorded; the request is not on file.` };
    case 'credential_unavailable':
    case 'world_id_4_not_available':
    case 'world_id_3_not_available':
      return {
        title: 'Credential unavailable',
        detail: `This World ID holds no passport credential (nor the legacy Document fallback) (${code}). A bank-change request needs a verified document; nothing was recorded.`,
      };
    case 'max_verifications_reached':
    case 'nullifier_replayed':
      return {
        title: 'Already verified for this action',
        detail: `World refused a repeat verification for this action (${code}). See the action's max-verifications setting in the Developer Portal. Nothing was recorded.`,
      };
    case 'timeout':
      return { title: 'Timed out', detail: 'The World ID request timed out before a proof arrived. Nothing was recorded.' };
    default:
      return { title: 'World ID error', detail: `IDKit reported "${code}". Nothing was recorded.` };
  }
}

export function VendorBankChangeForm({ vendors, defaults }: { vendors: VendorOption[]; defaults: { vendorId: string; newPayoutAddress: string; newEvmAddress: string } }) {
  const [vendorId, setVendorId] = useState(defaults.vendorId);
  const [newPayoutAddress, setNewPayoutAddress] = useState(defaults.newPayoutAddress);
  const [newEvmAddress, setNewEvmAddress] = useState(defaults.newEvmAddress);
  const [session, setSession] = useState<Session | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });
  // The server's answer from handleVerify, read by onSuccess / onError("failed_by_host_app").
  const serverAnswer = useRef<{ ok: boolean; reason?: string; detail?: string; record?: RecordedRequest } | null>(null);

  const selected = vendors.find((v) => v.vendorId === vendorId);

  async function start() {
    setLoading(true);
    setOutcome({ kind: 'idle' });
    serverAnswer.current = null;
    try {
      const claim = { vendorId, newPayoutAddress: newPayoutAddress.trim(), newEvmAddress: newEvmAddress.trim() };
      const res = await fetch('/api/idkit/rp-context', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(claim) });
      const json = await res.json();
      if (!res.ok) {
        setOutcome({ kind: 'error', title: json.reason ?? `HTTP ${res.status}`, detail: json.error ?? 'Could not start the World ID request.', missingEnv: json.missingEnv });
        return;
      }
      setSession({ ...(json as Omit<Session, 'claim'>), claim });
      setOpen(true);
    } catch (error) {
      setOutcome({ kind: 'error', title: 'Could not start', detail: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify(result: IDKitResult) {
    if (session === null) throw new Error('no session');
    const res = await fetch('/api/vendor/bank-change', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...session.claim, idkitResult: result }),
    });
    const json = await res.json();
    serverAnswer.current = json;
    if (!res.ok || json.ok !== true) throw new Error(json.reason ?? `HTTP ${res.status}`);
  }

  function reset() {
    setSession(null);
    setOpen(false);
    setOutcome({ kind: 'idle' });
    serverAnswer.current = null;
  }

  const locked = session !== null;

  const inputClass =
    'mt-1.5 block w-full min-w-0 rounded-control border border-hairline bg-harbor px-3 py-2 font-mono text-xs text-manifest focus:border-fog focus:outline-none disabled:opacity-60';

  return (
    <div>
      <div className="space-y-5">
        <label className="block text-sm">
          <span className="font-medium text-manifest">Vendor</span>
          <select
            className="mt-1.5 block w-full min-w-0 rounded-control border border-hairline bg-harbor px-3 py-2 text-sm text-manifest focus:border-fog focus:outline-none disabled:opacity-60"
            value={vendorId}
            disabled={locked}
            onChange={(e) => setVendorId(e.target.value)}
          >
            {vendors.map((v) => (
              <option key={v.vendorId} value={v.vendorId}>
                {v.legalName} ({v.vendorId})
              </option>
            ))}
          </select>
        </label>
        {selected && (
          <dl className="grid gap-x-4 gap-y-1 rounded-doc border border-hairline bg-harbor/60 px-3 py-2 text-xs sm:grid-cols-[10rem_minmax(0,1fr)]">
            <dt className="text-fog">On file: payout</dt>
            <dd className="break-all font-mono text-manifest">{selected.payoutAddress}</dd>
            <dt className="text-fog">Registered EVM identity</dt>
            <dd className="break-all font-mono text-manifest">{selected.evmAddress}</dd>
          </dl>
        )}
        <label className="block text-sm">
          <span className="font-medium text-manifest">New Sui payout address</span>
          <input className={inputClass} value={newPayoutAddress} disabled={locked} spellCheck={false} onChange={(e) => setNewPayoutAddress(e.target.value)} />
        </label>
        <label className="block text-sm">
          <span className="font-medium text-manifest">New EVM identity</span>
          <input className={inputClass} value={newEvmAddress} disabled={locked} spellCheck={false} onChange={(e) => setNewEvmAddress(e.target.value)} />
        </label>
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        {!locked && (
          <button onClick={start} disabled={loading} className={buttonClass('primary')}>
            {loading ? 'Signing request…' : 'Verify with World ID (passport) and submit'}
          </button>
        )}
        {locked && outcome.kind !== 'recorded' && (
          <button onClick={() => setOpen(true)} className={buttonClass('primary')}>
            Reopen World ID
          </button>
        )}
        {locked && (
          <button onClick={reset} className={buttonClass('secondary')}>
            Start over
          </button>
        )}
      </div>

      {session && (
        <dl className="mt-4 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[10rem_minmax(0,1fr)]">
          <dt className="text-fog">Signal bound into the proof</dt>
          <dd className="break-all font-mono text-manifest">{session.signal}</dd>
          <dt className="text-fog">Action · environment</dt>
          <dd className="break-all font-mono text-manifest">
            {session.action} · {session.environment}
          </dd>
        </dl>
      )}

      {session && (
        <IDKitRequestWidget
          open={open}
          onOpenChange={setOpen}
          app_id={session.app_id}
          action={session.action}
          rp_context={session.rp_context}
          allow_legacy_proofs={true}
          environment={session.environment}
          preset={passport({ signal: session.signal })}
          handleVerify={handleVerify}
          onSuccess={() => {
            const record = serverAnswer.current?.record;
            if (record) setOutcome({ kind: 'recorded', record });
          }}
          onError={(code) => {
            if (code === 'failed_by_host_app') {
              const answer = serverAnswer.current;
              setOutcome({
                kind: 'error',
                title: answer?.reason ?? 'Rejected by the server',
                detail: `${answer?.detail ?? 'The server did not accept the proof.'} Nothing was recorded.`,
              });
              return;
            }
            setOutcome({ kind: 'error', ...describeIdkitError(code) });
          }}
        />
      )}
      {outcome.kind === 'error' && (
        <Notice tone="error" role="alert" title={outcome.title} className="mt-5">
          <div>{outcome.detail}</div>
          {outcome.missingEnv && outcome.missingEnv.length > 0 && (
            <div className="mt-1">
              Env: <span className="font-mono">{outcome.missingEnv.join(', ')}</span>
            </div>
          )}
        </Notice>
      )}

      {outcome.kind === 'recorded' && (
        <Notice tone="ok" role="status" title="Verified by World and recorded." className="mt-5">
          <div>
            {outcome.record.vendorId}: payout <span className="break-all font-mono text-xs">{outcome.record.newPayoutAddress}</span>, EVM identity{' '}
            <span className="break-all font-mono text-xs">{outcome.record.newEvmAddress}</span>
          </div>
          <div className="mt-1 text-xs">
            Credential: {outcome.record.credentialType} (World ID {outcome.record.protocolVersion}
            {outcome.record.issuerSchemaId !== null ? `, issuer schema ${outcome.record.issuerSchemaId}` : ''}) · environment {outcome.record.environment} ·
            nullifier <span className="break-all font-mono">{outcome.record.nullifier}</span> · {new Date(outcome.record.verifiedAtMs).toISOString()}
          </div>
          <div className="mt-2 text-xs">
            Nothing is paid and the vendor master is unchanged. The payer&apos;s AP controller still has to approve the held invoice with their own World
            ID step-up, which only succeeds because this request matches it.
          </div>
        </Notice>
      )}
    </div>
  );
}
