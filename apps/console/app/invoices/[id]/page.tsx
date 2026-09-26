'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import type { EnforceApiResponse } from '../../../lib/payment';

interface Props {
  params: Promise<{ id: string }>;
}

interface ApiError {
  error: string;
}

/**
 * Invoice detail page. Opening it is the AP agent proposing this payment: it calls the real
 * `POST /api/enforce` (a real round trip; nothing precomputed). The route runs `enforce()` and, on
 * CLEARED, settles on Sui once per proposal. Renders the verdict, the premise diff (claimed vs.
 * re-derived), screening errors, and for a settled payment the digest with its suiscan link. For a
 * held verdict, links to the World ID step-up, the only human button in the flow.
 */
export default function InvoiceDetailPage({ params }: Props) {
  const { id } = use(params);
  const [result, setResult] = useState<EnforceApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setError(null);
    const propose = (attempt: number): Promise<void> =>
      fetch('/api/enforce', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ invoiceId: id }),
      }).then(async (res) => {
        const json = (await res.json()) as EnforceApiResponse | ApiError;
        if (cancelled) return;
        if (!res.ok) {
          setError('error' in json ? json.error : 'Request failed.');
          return;
        }
        const r = json as EnforceApiResponse;
        setResult(r);
        // Another request is mid-settlement for this proposal: ask again; the ledger never pays twice.
        if (r.settlement.status === 'in-progress' && attempt < 20) {
          await new Promise((done) => setTimeout(done, 3000));
          if (!cancelled) await propose(attempt + 1);
        }
      });
    propose(0)
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div>
      <Link href="/invoices" className="text-sm text-blue-600 hover:underline">
        ← Invoice Inbox
      </Link>

      {error && (
        <div className="mt-4 rounded bg-red-50 px-4 py-3 text-sm text-red-800">Error: {error}</div>
      )}

      {!error && !result && <div className="mt-4 text-slate-500">Calling /api/enforce…</div>}

      {result && (
        <>
          <h1 className="mt-2 mb-1 text-2xl font-bold">{result.legalName}</h1>
          <p className="mb-4 text-slate-500">{result.scenarioLabel}</p>

          <VerdictBadge outcomeLabel={result.verdict.outcomeLabel} reasonCodeLabel={result.verdict.reasonCodeLabel} />

          <table className="mt-6 w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-300 text-slate-500">
                <th className="py-2 pr-4">Premise</th>
                <th className="py-2 pr-4">Claimed</th>
                <th className="py-2">Derived (re-checked just now)</th>
              </tr>
            </thead>
            <tbody>
              {result.premises.map((premise) => {
                const mismatched = premise.claimedValue !== premise.derivedValue;
                return (
                  <tr
                    key={premise.premiseId}
                    className={`border-b border-slate-100 ${mismatched ? 'bg-amber-50' : ''}`}
                  >
                    <td className="py-2 pr-4 font-mono text-xs">{premise.field}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{premise.claimedValue ?? '—'}</td>
                    <td className="py-2 font-mono text-xs">{premise.derivedValue ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {result.screeningErrors.length > 0 && (
            <div className="mt-4 rounded bg-red-50 px-4 py-3 text-xs text-red-800">
              {result.screeningErrors.map((e, i) => (
                <div key={i}>
                  Screen not resolved ({e.schema} {e.field} {e.args.join(', ')}): {e.errorName}: {e.message}
                </div>
              ))}
            </div>
          )}

          <SettlementPanel settlement={result.settlement} />

          <p className="mt-3 text-xs text-slate-400">
            proposalHash={result.verdict.proposalHash} · policyHash={result.verdict.policyHash} (on-chain registry:{' '}
            {result.onchainPolicyHash}) · vault spent_this_period={result.vaultSpentUsdc ?? 'not reached'} · blockChecked=
            {result.verdict.blockChecked} (unix seconds, not a Sui checkpoint) · logRef={result.verdict.logRef}
          </p>

          {result.verdict.outcomeLabel === 'HELD_FOR_STEPUP' && result.settlement.status === 'not-settled' && (
            <Link
              href={`/stepup?proposal=${encodeURIComponent(result.verdict.proposalHash)}`}
              className="mt-6 inline-block rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Continue to World ID step-up →
            </Link>
          )}
        </>
      )}
    </div>
  );
}

function SettlementPanel({ settlement }: { settlement: EnforceApiResponse['settlement'] }) {
  if (settlement.status === 'settled') {
    return (
      <div className="mt-4 rounded bg-green-50 px-4 py-3 text-sm text-green-900">
        {settlement.alreadySettled ? 'Already paid (recorded settlement, not paid again)' : 'Paid on Sui testnet'}
        {settlement.viaStepup ? ' via settle_with_stepup' : ''}: {settlement.valueUsdc} USDSUI base units to{' '}
        <span className="font-mono text-xs">{settlement.recipient}</span>. Digest{' '}
        <a href={settlement.explorerUrl} className="font-mono text-blue-700 hover:underline" target="_blank" rel="noreferrer">
          {settlement.digest}
        </a>
      </div>
    );
  }
  if (settlement.status === 'not-settled') {
    return <div className="mt-4 text-sm text-slate-500">{settlement.reason}</div>;
  }
  if (settlement.status === 'in-progress') {
    return <div className="mt-4 text-sm text-amber-700">Settlement in progress…</div>;
  }
  return (
    <div className="mt-4 rounded bg-red-50 px-4 py-3 text-sm text-red-800">
      Settlement {settlement.status}: {settlement.error}
    </div>
  );
}

function VerdictBadge({
  outcomeLabel,
  reasonCodeLabel,
}: {
  outcomeLabel: 'CLEARED' | 'REFUSED' | 'HELD_FOR_STEPUP';
  reasonCodeLabel: string;
}) {
  const className =
    outcomeLabel === 'CLEARED'
      ? 'bg-green-100 text-green-800'
      : outcomeLabel === 'REFUSED'
        ? 'bg-red-100 text-red-800'
        : 'bg-amber-100 text-amber-800';
  return (
    <span className={`inline-block rounded px-3 py-1 text-sm font-semibold ${className}`}>
      {outcomeLabel} — {reasonCodeLabel}
    </span>
  );
}
