'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import type { EnforceApiResponse } from '../../../lib/payment';
import { formatUsdc6 } from '../../../lib/activity';
import { buttonClass } from '../../../components/ui/button';
import { SuiscanLink } from '../../../components/ui/ExternalLink';
import { formatUtc, premiseLabel } from '../../../components/ui/format';
import { Notice } from '../../../components/ui/Notice';
import { Accent, PageHero, Section } from '../../../components/ui/PageHeader';
import { Field, Panel } from '../../../components/ui/Panel';
import { SponsorLogo } from '../../../components/ui/SponsorLogo';
import { Stamp, VerdictChip } from '../../../components/ui/Stamp';

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
    <>
      <PageHero
        back={{ href: '/invoices', label: 'Invoice Inbox' }}
        eyebrow={`Form AP-2 · Invoice review · ${id}`}
        title={result ? result.legalName : 'Invoice review'}
        lede={
          result ? (
            <div className="flex flex-wrap items-center gap-3">
              <VerdictChip outcome={result.verdict.outcomeLabel} />
              <span className="font-mono text-sm text-navy">{result.verdict.reasonCodeLabel}</span>
              <span className="basis-full text-muted">{result.scenarioLabel}</span>
            </div>
          ) : (
            'The agent is proposing this payment now.'
          )
        }
      >
        <div className="box mt-8 max-w-4xl">
          <div className="box-head px-5 py-2.5 font-mono text-xs font-bold uppercase tracking-[0.16em] text-navy sm:px-6">The AP agent runs on open</div>
          <p className="px-5 py-4 text-sm leading-relaxed text-muted sm:px-6">
            Opening this page is the agent proposing the payment: it calls <code className="font-mono text-navy">POST /api/enforce</code>. A CLEARED
            verdict settles on Sui with no human click. Each proposal is paid at most once, so reopening shows the recorded payment instead of paying
            again.
          </p>
        </div>
      </PageHero>

      {error && (
        <Section tone="deep">
          <Notice tone="error" role="alert" title="The agent’s proposal failed">
            <span className="font-mono text-xs">{error}</span>
          </Notice>
        </Section>
      )}

      {!error && !result && (
        <Section tone="deep">
          <div role="status" aria-live="polite">
            <Panel label="Inspection in progress">
              <p className="text-navy">
                The AP agent is proposing this payment. Bonded is re-deriving each fact from its source and reading the policy hash from Sui…
              </p>
              <p className="mt-1 font-mono text-xs text-muted">POST /api/enforce {'{'} invoiceId: “{id}” {'}'}</p>
              <div className="mt-5 space-y-2" aria-hidden="true">
                <div className="h-3 w-3/4 animate-pulse rounded bg-sui/10 motion-reduce:animate-none" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-sui/10 motion-reduce:animate-none" />
                <div className="h-3 w-2/3 animate-pulse rounded bg-sui/10 motion-reduce:animate-none" />
              </div>
            </Panel>
          </div>
        </Section>
      )}

      {result && <Review result={result} />}
    </>
  );
}

function Review({ result }: { result: EnforceApiResponse }) {
  const { verdict } = result;
  const refused = verdict.outcomeLabel === 'REFUSED';
  const held = verdict.outcomeLabel === 'HELD_FOR_STEPUP';

  const nextStep = held && result.settlement.status === 'not-settled';
  return (
    <>
      <Section tone="deep" eyebrow="The inspection certificate" title="Claimed vs. re-derived, just now">
        {/* The inspection certificate: verdict stamp + premise diff, on the black document */}
        <article className="box" aria-labelledby="verdict-heading">
          <div className="box-head flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 font-mono text-xs font-bold uppercase tracking-[0.16em] text-navy sm:px-7">
            <span>Invoice document</span>
            <span className="break-all">
              {result.invoiceId} · {result.vendorId}
            </span>
          </div>
          <div className="grid gap-6 p-5 sm:p-7 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <div className="min-w-0">
              <h2 id="verdict-heading" className="font-display text-2xl font-bold tracking-[-0.01em] text-navy sm:text-3xl">
                Verdict: {verdict.outcomeLabel} <span className="font-mono text-base font-medium text-muted">/ {verdict.reasonCodeLabel}</span>
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">{result.scenarioLabel}</p>
            </div>
            <div className="justify-self-center md:justify-self-end md:pr-2">
              <Stamp outcome={verdict.outcomeLabel} reason={verdict.reasonCodeLabel} press />
            </div>
          </div>

          <PremiseDiff result={result} tone={refused ? 'stamp' : 'hold'} />
        </article>
      </Section>

      {nextStep && (
        <Section
          tone="band"
          eyebrow="Next step"
          title={
            <>
              Held for a <Accent>verified human.</Accent>
            </>
          }
        >
          <Panel label="World ID step-up" sponsor="world" aside={<span className="font-semibold text-held">Held · nothing paid</span>}>
            <p className="max-w-3xl text-sm leading-relaxed text-muted">
              Nothing is paid until a live person approves this exact proposal with a fresh World ID check. This is the only human step in the
              flow.
            </p>
            <Link href={`/stepup?proposal=${encodeURIComponent(verdict.proposalHash)}`} className={buttonClass('primary', 'mt-5')}>
              Continue to World ID step-up <span aria-hidden="true">→</span>
            </Link>
          </Panel>
        </Section>
      )}

      <Section tone={nextStep ? 'deep' : 'band'} eyebrow="Screening and settlement" title="Who checked what">
        <div className="grid gap-6 lg:grid-cols-2">
          <Screening result={result} />
          <SettlementPanel settlement={result.settlement} />
        </div>
      </Section>

      <Section tone={nextStep ? 'band' : 'deep'} eyebrow="Audit" title="Verdict record">
      <Panel label="Verdict record">
        <dl>
          <Field label="proposalHash">{verdict.proposalHash}</Field>
          <Field label="policyHash">{verdict.policyHash}</Field>
          <Field label="On-chain registry">{result.onchainPolicyHash}</Field>
          <Field label="Vault spent (period)">
            {result.vaultSpentUsdc === null ? <span className="font-sans text-muted">not reached</span> : `${formatUsdc6(result.vaultSpentUsdc)} USDSUI`}
          </Field>
          <Field label="blockChecked">
            {verdict.blockChecked} <span className="font-sans text-xs text-muted">(unix seconds, not a Sui checkpoint)</span>
          </Field>
          <Field label="logRef">{verdict.logRef}</Field>
        </dl>
      </Panel>
      </Section>
    </>
  );
}

/** Claimed vs. re-derived, exactly the premises enforce() resolved, in order. */
function PremiseDiff({ result, tone }: { result: EnforceApiResponse; tone: 'stamp' | 'hold' }) {
  const rows = result.premises.map((p) => ({ ...p, mismatched: p.claimedValue !== p.derivedValue, meta: premiseLabel(p.field) }));
  const rowTint = tone === 'stamp' ? 'bg-refused/10' : 'bg-held/10';
  const badge = tone === 'stamp' ? 'border-refused text-refused' : 'border-held text-held';
  const mismatchCount = rows.filter((r) => r.mismatched).length;

  const Value = ({ v }: { v: string | null }) =>
    v === null ? <span className="font-sans italic text-muted">unresolved</span> : <span className="break-all font-mono">{v}</span>;

  return (
    <section aria-labelledby="diff-heading" className="perforation-dark">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-5 sm:px-7">
        <h3 id="diff-heading" className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-sui">
          Premise diff · claimed vs. re-derived just now
        </h3>
        <p className="text-xs text-muted">
          {rows.length} checked · {mismatchCount} mismatch{mismatchCount === 1 ? '' : 'es'}
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="px-5 pb-6 pt-3 text-sm text-muted sm:px-7">enforce() decided before resolving any premise ({result.verdict.reasonCodeLabel}).</p>
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
              <tr className="font-mono text-[11px] uppercase tracking-wider text-muted">
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
                <tr key={r.premiseId} className={`border-t border-rule align-top ${r.mismatched ? rowTint : ''}`}>
                  <th scope="row" className="px-5 py-3 font-normal sm:pl-7">
                    <div className="font-semibold text-navy">{r.meta.label}</div>
                    <div className="mt-0.5 font-mono text-[11px] text-muted">
                      {r.meta.source} · {r.field}
                    </div>
                  </th>
                  <td className="px-3 py-3 text-xs text-navy">
                    <Value v={r.claimedValue} />
                  </td>
                  <td className="px-3 py-3 text-xs text-navy">
                    <Value v={r.derivedValue} />
                    {r.resolveError && <div className="mt-1 break-words font-mono text-[11px] text-refused">{r.resolveError}</div>}
                  </td>
                  <td className="px-3 py-3 text-right sm:pr-7">
                    {r.mismatched ? (
                      <span className={`inline-block rounded-md border px-1.5 font-mono text-[11px] font-bold ${badge}`}>
                        <span aria-hidden="true">≠</span>
                        <span className="sr-only">Mismatch</span>
                      </span>
                    ) : (
                      <span className="inline-block rounded-md border border-cleared px-1.5 font-mono text-[11px] font-bold text-cleared">
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
              <li key={r.premiseId} className={`border-t border-rule px-5 py-3 ${r.mismatched ? rowTint : ''}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <div className="font-semibold text-navy">{r.meta.label}</div>
                  <span className={`font-mono text-[11px] font-bold uppercase ${r.mismatched ? (tone === 'stamp' ? 'text-refused' : 'text-held') : 'text-cleared'}`}>
                    {r.mismatched ? 'Mismatch' : 'Match'}
                  </span>
                </div>
                <div className="font-mono text-[11px] text-muted">
                  {r.meta.source} · {r.field}
                </div>
                <dl className="mt-2 space-y-1 text-xs text-navy">
                  <div>
                    <dt className="text-muted">Claimed</dt>
                    <dd>
                      <Value v={r.claimedValue} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted">Re-derived</dt>
                    <dd>
                      <Value v={r.derivedValue} />
                      {r.resolveError && <div className="mt-1 break-words font-mono text-[11px] text-refused">{r.resolveError}</div>}
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
          <p className="border-t border-rule px-5 py-3 text-xs text-muted sm:px-7">
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
    <Panel label="Intercepta screen" sponsor="intercepta">
      {result.screeningErrors.length > 0 ? (
        <div className="space-y-3">
          <Notice tone="error" title="Screen not resolved: failed closed">
            No screen result means no payment. The error is shown exactly as the adapter raised it.
          </Notice>
          {result.screeningErrors.map((e, i) => (
            <dl key={i} className="rounded-xl border border-rule bg-raised px-3 py-1">
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
                  <span className={clean ? 'text-cleared' : 'text-refused'}>{traits ?? 'unresolved'}</span>
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
        <p className="text-sm text-muted">No Intercepta screen ran for this proposal. The policy screens payees that claim an EVM identity.</p>
      )}
    </Panel>
  );
}

function SettlementPanel({ settlement }: { settlement: EnforceApiResponse['settlement'] }) {
  if (settlement.status === 'settled') {
    return (
      <Panel
        label="Settlement on Sui" sponsor="sui"
        aside={<span className="font-semibold text-cleared">{settlement.alreadySettled ? 'Already paid' : 'Paid just now'}</span>}
      >
        <p className="mb-2 text-sm text-muted">
          {settlement.alreadySettled
            ? 'This proposal was already paid; the recorded settlement is shown and nothing was paid again.'
            : 'Paid on Sui testnet.'}
          {settlement.viaStepup ? ' Settled with settle_with_stepup.' : ''}
        </p>
        <dl>
          <Field label="Amount">{formatUsdc6(settlement.valueUsdc)} USDSUI</Field>
          <Field label="Recipient">{settlement.recipient}</Field>
          <Field label="Digest">
            <span className="inline-flex items-start gap-1.5">
              <SponsorLogo sponsor="sui" size={16} className="mt-0.5" />
              <SuiscanLink explorerUrl={settlement.explorerUrl} digest={settlement.digest} full className="text-sui" />
            </span>
          </Field>
          <Field label="Settled at">{formatUtc(settlement.settledAtMs)}</Field>
        </dl>
      </Panel>
    );
  }
  if (settlement.status === 'not-settled') {
    return (
      <Panel label="Settlement on Sui" sponsor="sui" aside="Not paid">
        <p className="text-sm text-muted">{settlement.reason}</p>
      </Panel>
    );
  }
  if (settlement.status === 'in-progress') {
    return (
      <Panel label="Settlement on Sui" sponsor="sui" aside={<span className="text-held">In progress</span>}>
        <p role="status" className="text-sm text-held">
          Settlement in progress… another request is submitting it; checking again every 3 seconds. It is never paid twice.
        </p>
      </Panel>
    );
  }
  return (
    <Panel label="Settlement on Sui" sponsor="sui" aside={<span className="text-refused">{settlement.status}</span>}>
      <Notice tone="error" role="alert" title={`Settlement ${settlement.status}`}>
        <span className="font-mono text-xs">{settlement.error}</span>
      </Notice>
    </Panel>
  );
}
