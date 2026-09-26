'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import type { EnforceApiResponse } from '../../../lib/payment';
import { formatUsdc6 } from '../../../lib/activity';
import { buttonClass } from '../../../components/ui/button';
import { SuiscanLink } from '../../../components/ui/ExternalLink';
import { formatUtc, premiseLabel } from '../../../components/ui/format';
import { Notice } from '../../../components/ui/Notice';
import { Field, Panel } from '../../../components/ui/Panel';
import { Stamp } from '../../../components/ui/Stamp';

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
      <Link href="/invoices" className="mb-5 inline-block text-sm text-fog underline-offset-2 hover:text-manifest hover:underline">
        <span aria-hidden="true">← </span>Invoice Inbox
      </Link>
      <p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-fog">Form AP-2 · Invoice review · {id}</p>
      <h1 className="mt-2 break-words text-3xl font-semibold tracking-tight sm:text-4xl">{result ? result.legalName : 'Invoice review'}</h1>

      <div className="mt-5 flex flex-wrap items-start gap-3 rounded-doc border border-hairline bg-deepwater px-4 py-3 text-sm text-fog">
        <span className="rounded-sm border border-manifest/60 px-1.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-manifest">
          The AP agent runs on open
        </span>
        <span className="min-w-0 flex-1 basis-64">
          Opening this page is the agent proposing the payment: it calls <code className="font-mono text-manifest">POST /api/enforce</code>. A CLEARED
          verdict settles on Sui with no human click. Each proposal is paid at most once, so reopening shows the recorded payment instead of paying
          again.
        </span>
      </div>

      {error && (
        <Notice tone="error" role="alert" title="The agent’s proposal failed" className="mt-6">
          <span className="font-mono text-xs">{error}</span>
        </Notice>
      )}

      {!error && !result && (
        <div role="status" aria-live="polite" className="paper mt-6 p-6">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/70">Inspection in progress</p>
          <p className="mt-2 text-ink">
            The AP agent is proposing this payment. Bonded is re-deriving each fact from its source and reading the policy hash from Sui…
          </p>
          <p className="mt-1 font-mono text-xs text-ink/70">POST /api/enforce {'{'} invoiceId: “{id}” {'}'}</p>
          <div className="mt-5 space-y-2" aria-hidden="true">
            <div className="h-3 w-3/4 animate-pulse rounded bg-ink/10 motion-reduce:animate-none" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-ink/10 motion-reduce:animate-none" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-ink/10 motion-reduce:animate-none" />
          </div>
        </div>
      )}

      {result && <Review result={result} />}
    </div>
  );
}

function Review({ result }: { result: EnforceApiResponse }) {
  const { verdict } = result;
  const refused = verdict.outcomeLabel === 'REFUSED';
  const held = verdict.outcomeLabel === 'HELD_FOR_STEPUP';

  return (
    <div className="mt-6 space-y-6">
      {/* The inspection certificate: verdict stamp + premise diff, on manifest paper */}
      <article className="paper paper-ruled overflow-hidden" aria-labelledby="verdict-heading">
        <div className="grid gap-6 p-5 sm:p-7 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <div className="min-w-0">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/70">
              {result.invoiceId} · {result.vendorId}
            </p>
            <h2 id="verdict-heading" className="mt-2 text-xl font-semibold text-ink">
              Verdict: {verdict.outcomeLabel} <span className="font-mono text-base font-medium text-ink/70">/ {verdict.reasonCodeLabel}</span>
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink/80">{result.scenarioLabel}</p>
          </div>
          <div className="justify-self-center md:justify-self-end md:pr-2">
            <Stamp outcome={verdict.outcomeLabel} reason={verdict.reasonCodeLabel} press />
          </div>
        </div>

        <PremiseDiff result={result} tone={refused ? 'stamp' : 'hold'} />
      </article>

      {held && result.settlement.status === 'not-settled' && (
        <Notice tone="hold" title="Held for a verified human">
          <p>
            Nothing is paid until a live person approves this exact proposal with a fresh World ID check. This is the only human step in the flow.
          </p>
          <Link
            href={`/stepup?proposal=${encodeURIComponent(verdict.proposalHash)}`}
            className={buttonClass('primary', 'mt-3')}
          >
            Continue to World ID step-up <span aria-hidden="true">→</span>
          </Link>
        </Notice>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Screening result={result} />
        <SettlementPanel settlement={result.settlement} />
      </div>

      <Panel label="Verdict record">
        <dl>
          <Field label="proposalHash">{verdict.proposalHash}</Field>
          <Field label="policyHash">{verdict.policyHash}</Field>
          <Field label="On-chain registry">{result.onchainPolicyHash}</Field>
          <Field label="Vault spent (period)">
            {result.vaultSpentUsdc === null ? <span className="font-sans text-fog">not reached</span> : `${formatUsdc6(result.vaultSpentUsdc)} USDSUI`}
          </Field>
          <Field label="blockChecked">
            {verdict.blockChecked} <span className="font-sans text-xs text-fog">(unix seconds, not a Sui checkpoint)</span>
          </Field>
          <Field label="logRef">{verdict.logRef}</Field>
        </dl>
      </Panel>
    </div>
  );
}

/** Claimed vs. re-derived, exactly the premises enforce() resolved, in order. */
function PremiseDiff({ result, tone }: { result: EnforceApiResponse; tone: 'stamp' | 'hold' }) {
  const rows = result.premises.map((p) => ({ ...p, mismatched: p.claimedValue !== p.derivedValue, meta: premiseLabel(p.field) }));
  const rowTint = tone === 'stamp' ? 'bg-stamp-ink/10' : 'bg-hold/20';
  const badge = tone === 'stamp' ? 'border-stamp-ink text-stamp-ink' : 'border-hold-ink text-hold-ink';
  const mismatchCount = rows.filter((r) => r.mismatched).length;

  const Value = ({ v }: { v: string | null }) =>
    v === null ? <span className="font-sans italic text-ink/70">unresolved</span> : <span className="break-all font-mono">{v}</span>;

  return (
    <section aria-labelledby="diff-heading" className="perforation">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-5 sm:px-7">
        <h3 id="diff-heading" className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/80">
          Premise diff · claimed vs. re-derived just now
        </h3>
        <p className="text-xs text-ink/70">
          {rows.length} checked · {mismatchCount} mismatch{mismatchCount === 1 ? '' : 'es'}
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="px-5 pb-6 pt-3 text-sm text-ink/80 sm:px-7">enforce() decided before resolving any premise ({result.verdict.reasonCodeLabel}).</p>
      ) : (
        <>
          {/* md and up */}
          <table className="mt-3 hidden w-full table-fixed border-collapse text-left text-sm md:table">
            <caption className="sr-only">Each premise the invoice claims, next to the value Bonded re-derived</caption>
            <colgroup>
              <col className="w-[30%]" />
              <col className="w-[31%]" />
              <col className="w-[31%]" />
              <col className="w-[8%]" />
            </colgroup>
            <thead>
              <tr className="font-mono text-[11px] uppercase tracking-wider text-ink/70">
                <th scope="col" className="px-5 py-2 font-semibold sm:pl-7">Premise</th>
                <th scope="col" className="px-3 py-2 font-semibold">Claimed by invoice</th>
                <th scope="col" className="px-3 py-2 font-semibold">Re-derived</th>
                <th scope="col" className="px-3 py-2 font-semibold sm:pr-7">
                  <span className="sr-only">Result</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.premiseId} className={`border-t border-ink/10 align-top ${r.mismatched ? rowTint : ''}`}>
                  <th scope="row" className="px-5 py-3 font-normal sm:pl-7">
                    <div className="font-semibold text-ink">{r.meta.label}</div>
                    <div className="mt-0.5 font-mono text-[11px] text-ink/70">
                      {r.meta.source} · {r.field}
                    </div>
                  </th>
                  <td className="px-3 py-3 text-xs text-ink">
                    <Value v={r.claimedValue} />
                  </td>
                  <td className="px-3 py-3 text-xs text-ink">
                    <Value v={r.derivedValue} />
                    {r.resolveError && <div className="mt-1 break-words font-mono text-[11px] text-stamp-ink">{r.resolveError}</div>}
                  </td>
                  <td className="px-3 py-3 text-right sm:pr-7">
                    {r.mismatched ? (
                      <span className={`inline-block rounded-sm border px-1.5 font-mono text-[11px] font-bold ${badge}`}>
                        <span aria-hidden="true">≠</span>
                        <span className="sr-only">Mismatch</span>
                      </span>
                    ) : (
                      <span className="inline-block rounded-sm border border-seal-ink px-1.5 font-mono text-[11px] font-bold text-seal-ink">
                        <span aria-hidden="true">=</span>
                        <span className="sr-only">Matches</span>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* below md */}
          <ul className="mt-3 md:hidden">
            {rows.map((r) => (
              <li key={r.premiseId} className={`border-t border-ink/10 px-5 py-3 ${r.mismatched ? rowTint : ''}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <div className="font-semibold text-ink">{r.meta.label}</div>
                  <span className={`font-mono text-[11px] font-bold uppercase ${r.mismatched ? (tone === 'stamp' ? 'text-stamp-ink' : 'text-hold-ink') : 'text-seal-ink'}`}>
                    {r.mismatched ? 'Mismatch' : 'Match'}
                  </span>
                </div>
                <div className="font-mono text-[11px] text-ink/70">
                  {r.meta.source} · {r.field}
                </div>
                <dl className="mt-2 space-y-1 text-xs text-ink">
                  <div>
                    <dt className="text-ink/70">Claimed</dt>
                    <dd>
                      <Value v={r.claimedValue} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink/70">Re-derived</dt>
                    <dd>
                      <Value v={r.derivedValue} />
                      {r.resolveError && <div className="mt-1 break-words font-mono text-[11px] text-stamp-ink">{r.resolveError}</div>}
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
          <p className="border-t border-ink/10 px-5 py-3 text-xs text-ink/70 sm:px-7">
            These are exactly the premises enforce() resolved, in order. It stops at the premise that decides the verdict, so later checks are not
            shown.
          </p>
        </>
      )}
    </section>
  );
}

/** The Intercepta screen, readable: a resolve failure (fail-closed), a result, or none ran. */
function Screening({ result }: { result: EnforceApiResponse }) {
  const screenRows = result.premises.filter((p) => p.field === 'payment.payTo.traitCount');
  return (
    <Panel label="Intercepta screen">
      {result.screeningErrors.length > 0 ? (
        <div className="space-y-3">
          <Notice tone="error" title="Screen not resolved: failed closed">
            No screen result means no payment. The error is shown exactly as the adapter raised it.
          </Notice>
          {result.screeningErrors.map((e, i) => (
            <dl key={i} className="rounded-doc border border-hairline px-3 py-1">
              <Field label="Error">{e.errorName}</Field>
              <Field label="Message" mono={false}>
                {e.message}
              </Field>
              <Field label="Screened">
                {e.schema} · {e.field}
              </Field>
              <Field label="Subject">{e.args.join(', ')}</Field>
            </dl>
          ))}
        </div>
      ) : screenRows.length > 0 ? (
        <dl>
          {screenRows.map((r) => {
            const traits = r.derivedValue;
            const clean = traits === '0';
            return (
              <div key={r.premiseId}>
                <Field label="Risk traits found">
                  <span className={clean ? 'text-seal' : 'text-stamp-lit'}>{traits ?? 'unresolved'}</span>
                </Field>
                <Field label="Claimed by invoice">{r.claimedValue ?? 'none'}</Field>
                <Field label="Policy rule" mono={false}>
                  traitCount ≤ 0: any documented risk trait (sanctions, known scammer, mixer use) refuses
                </Field>
                <Field label="Result" mono={false}>
                  {traits === null
                    ? 'Not resolved.'
                    : clean
                      ? 'No documented risk traits on the claimed payee identity.'
                      : `The claimed payee identity carries ${traits} documented risk trait(s).`}
                </Field>
              </div>
            );
          })}
        </dl>
      ) : (
        <p className="text-sm text-fog">No Intercepta screen ran for this proposal. The policy screens payees that claim an EVM identity.</p>
      )}
    </Panel>
  );
}

function SettlementPanel({ settlement }: { settlement: EnforceApiResponse['settlement'] }) {
  if (settlement.status === 'settled') {
    return (
      <Panel
        label="Settlement on Sui"
        aside={<span className="font-semibold text-seal">{settlement.alreadySettled ? 'Already paid' : 'Paid just now'}</span>}
      >
        <p className="mb-2 text-sm text-fog">
          {settlement.alreadySettled
            ? 'This proposal was already paid; the recorded settlement is shown and nothing was paid again.'
            : 'Paid on Sui testnet.'}
          {settlement.viaStepup ? ' Settled with settle_with_stepup.' : ''}
        </p>
        <dl>
          <Field label="Amount">{formatUsdc6(settlement.valueUsdc)} USDSUI</Field>
          <Field label="Recipient">{settlement.recipient}</Field>
          <Field label="Digest">
            <SuiscanLink explorerUrl={settlement.explorerUrl} digest={settlement.digest} full className="text-manifest" />
          </Field>
          <Field label="Settled at">{formatUtc(settlement.settledAtMs)}</Field>
        </dl>
      </Panel>
    );
  }
  if (settlement.status === 'not-settled') {
    return (
      <Panel label="Settlement on Sui" aside="Not paid">
        <p className="text-sm text-fog">{settlement.reason}</p>
      </Panel>
    );
  }
  if (settlement.status === 'in-progress') {
    return (
      <Panel label="Settlement on Sui" aside={<span className="text-hold">In progress</span>}>
        <p role="status" className="text-sm text-hold">
          Settlement in progress… another request is submitting it; checking again every 3 seconds. It is never paid twice.
        </p>
      </Panel>
    );
  }
  return (
    <Panel label="Settlement on Sui" aside={<span className="text-stamp-lit">{settlement.status}</span>}>
      <Notice tone="error" role="alert" title={`Settlement ${settlement.status}`}>
        <span className="font-mono text-xs">{settlement.error}</span>
      </Notice>
    </Panel>
  );
}
