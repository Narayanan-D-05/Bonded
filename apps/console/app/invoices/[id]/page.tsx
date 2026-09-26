'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import type { EnforceApiResponse } from '../../../lib/enforce-deps';

interface Props {
  params: Promise<{ id: string }>;
}

interface ApiError {
  error: string;
}

/**
 * Invoice detail page. Calls the real `POST /api/enforce` route for this invoice id (a genuine
 * network round trip from the browser — the verdict is never precomputed on the server render),
 * and renders a premise-diff table (claimed vs. re-derived, one row per premise) plus a plain
 * CLEARED / REFUSED / HELD_FOR_STEPUP badge. For the held case, links to `/stepup?proposal=<hash>`.
 */
export default function InvoiceDetailPage({ params }: Props) {
  const { id } = use(params);
  const [result, setResult] = useState<EnforceApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setError(null);
    fetch('/api/enforce', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ invoiceId: id }),
    })
      .then(async (res) => {
        const json = (await res.json()) as EnforceApiResponse | ApiError;
        if (cancelled) return;
        if (!res.ok) {
          setError('error' in json ? json.error : 'Request failed.');
          return;
        }
        setResult(json as EnforceApiResponse);
      })
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

          <p className="mt-3 text-xs text-slate-400">
            proposalHash={result.verdict.proposalHash} · policyHash={result.verdict.policyHash} · blockChecked=
            {result.verdict.blockChecked} · logRef={result.verdict.logRef}
          </p>

          {result.verdict.outcomeLabel === 'HELD_FOR_STEPUP' && (
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
