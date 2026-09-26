import Link from 'next/link';
import { formatUsdc6, summarizeSettlements } from '../lib/activity';
import { readDemoLedger } from '../lib/activity-source';
import type { LedgerEntry } from '../lib/settlement-ledger';
import { buttonClass } from '../components/ui/button';
import { ExternalLink, SuiscanLink } from '../components/ui/ExternalLink';
import { formatUtc } from '../components/ui/format';
import { Notice } from '../components/ui/Notice';

// The live figures are read from the settlement ledger on every request.
export const dynamic = 'force-dynamic';

const IC3_2025 = 'https://www.ic3.gov/AnnualReport/Reports/2025_IC3Report.pdf';

const STEPS = [
  {
    n: '01',
    title: 'Re-derive the facts',
    body: 'Before paying, the AP agent states what it believes: this vendor, this payout address, this amount. Bonded does not take the invoice’s word. It screens the claimed payee identity and looks up the vendor master record, a source the email cannot touch.',
  },
  {
    n: '02',
    title: 'Reach a verdict',
    body: 'Every claim is compared with the value re-derived just now. A sanctioned payee or a suspended vendor is refused. A changed bank account, or an amount over the irreversible threshold, is held. Everything else clears.',
  },
  {
    n: '03',
    title: 'Pay on Sui, or hold for a verified human',
    body: 'A cleared invoice settles on Sui automatically, once, to the address on file. A held one waits for a fresh World ID check by a live person. There is no approve button on routine payments.',
  },
] as const;

const SPONSORS = [
  {
    name: 'Intercepta',
    body: 'Screens the payee identity an invoice claims against live threat intelligence, first, so a sanctioned or known-bad payee is refused outright instead of being held for a human who might approve it.',
  },
  {
    name: 'World',
    body: 'World ID proves a live person approves a held payment right now (World ID for Agents), and IDKit proves the vendor’s own representative filed the bank change.',
  },
  {
    name: 'Sui',
    body: 'Holds the funds and settles cleared invoices. A verdict is a one-use object consumed when it settles, so an approval can never be replayed.',
  },
] as const;

export default async function OverviewPage() {
  const ledger = await readDemoLedger();
  const entries: LedgerEntry[] = ledger.ok ? ledger.value.flatMap((r) => (r.entry === null ? [] : [r.entry])) : [];
  const summary = summarizeSettlements(entries);

  return (
    <div className="space-y-20">
      {/* The problem, in one screen */}
      <section aria-labelledby="problem" className="grid items-start gap-10 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div>
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-fog">Accounts payable · pre-payment inspection</p>
          <h1 id="problem" className="mt-4 text-4xl font-semibold leading-[1.08] tracking-tight text-manifest sm:text-5xl">
            The first payment after a vendor changes banks is where fraud gets paid.
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-fog">
            Business Email Compromise impersonates a real vendor and changes where the money goes. Bonded sits inside the AP agent’s decision:
            it re-checks the facts each payment relies on, right before money moves, and sends only the genuinely ambiguous case to a verified
            human.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/invoices" className={buttonClass('primary')}>
              Open the Invoice Inbox <span aria-hidden="true">→</span>
            </Link>
            <Link href="/vendor/bank-change" className={buttonClass('secondary')}>
              Vendor portal
            </Link>
          </div>
        </div>

        <figure className="paper paper-ruled p-6 sm:p-7">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-ink/70">FBI IC3 · 2025 annual report</p>
          <p className="mt-3 font-mono text-5xl font-semibold tracking-tight text-ink sm:text-6xl">$3.04B</p>
          <figcaption className="mt-3 text-base leading-relaxed text-ink/80">
            lost to Business Email Compromise in 2025, the second-largest cybercrime by dollar loss.
          </figcaption>
          <div className="perforation mt-5 pt-4 text-sm text-ink/80">
            Source:{' '}
            <ExternalLink href={IC3_2025} className="font-medium text-ink">
              FBI Internet Crime Complaint Center, 2025 IC3 Report (PDF)
            </ExternalLink>
          </div>
        </figure>
      </section>

      {/* How it works */}
      <section aria-labelledby="how">
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-fog">How Bonded works</p>
        <h2 id="how" className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          Three steps, on every payment
        </h2>
        <ol className="mt-8 grid gap-px overflow-hidden rounded-doc border border-hairline bg-hairline md:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.n} className="bg-deepwater p-6">
              <span className="font-mono text-sm text-fog">{s.n}</span>
              <h3 className="mt-3 text-lg font-semibold text-manifest">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-fog">{s.body}</p>
              {s.n === '02' && (
                <ul className="mt-4 flex flex-wrap gap-2 font-mono text-[11px] font-semibold uppercase tracking-wider" aria-label="Possible verdicts">
                  <li className="rounded-sm border border-seal px-2 py-0.5 text-seal">Cleared</li>
                  <li className="rounded-sm border border-hold px-2 py-0.5 text-hold">Held</li>
                  <li className="rounded-sm border border-stamp-lit px-2 py-0.5 text-stamp-lit">Refused</li>
                </ul>
              )}
            </li>
          ))}
        </ol>
      </section>

      {/* Live figures from the settlement ledger */}
      <section aria-labelledby="ledger">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-fog">Settlement ledger · live</p>
            <h2 id="ledger" className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              What has actually been paid
            </h2>
          </div>
          <Link href="/activity" className="text-sm text-fog underline-offset-2 hover:text-manifest hover:underline">
            Full audit trail <span aria-hidden="true">→</span>
          </Link>
        </div>

        {!ledger.ok ? (
          <Notice tone="error" role="alert" title="The settlement ledger could not be read" className="mt-6">
            <span className="font-mono text-xs">{ledger.error}</span>
          </Notice>
        ) : (
          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-doc border border-hairline bg-hairline lg:grid-cols-1">
              <div className="bg-deepwater p-5">
                <dt className="text-xs uppercase tracking-wider text-fog">Invoices paid on Sui</dt>
                <dd className="mt-2 font-mono text-4xl font-semibold text-manifest">{summary.paidCount}</dd>
              </div>
              <div className="bg-deepwater p-5">
                <dt className="text-xs uppercase tracking-wider text-fog">Total settled</dt>
                <dd className="mt-2 break-all font-mono text-2xl font-semibold text-manifest sm:text-3xl">
                  {formatUsdc6(summary.totalUsdc)} <span className="text-sm font-medium text-fog">USDSUI</span>
                </dd>
              </div>
            </dl>

            <div className="rounded-doc border border-hairline bg-deepwater">
              {summary.settled.length === 0 ? (
                <p className="p-5 text-sm text-fog">No settlements are recorded yet. Open a clean invoice in the Invoice Inbox to have the agent pay it.</p>
              ) : (
                <ul className="divide-y divide-hairline">
                  {summary.settled.map((e) => (
                    <li key={e.proposalHash} className="grid gap-1 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-baseline sm:gap-4">
                      <div className="min-w-0">
                        <Link href={`/invoices/${e.invoiceId}`} className="font-mono text-sm text-manifest underline-offset-2 hover:underline">
                          {e.invoiceId}
                        </Link>
                        <span className="ml-2 text-xs text-fog">
                          {e.vendorId} · {formatUtc(e.settledAtMs)}
                          {e.viaStepup ? ' · settle_with_stepup' : ''}
                        </span>
                        <div className="mt-1 text-xs text-fog">
                          Digest <SuiscanLink explorerUrl={e.explorerUrl} digest={e.digest} className="text-manifest" />
                        </div>
                      </div>
                      <div className="font-mono text-base font-semibold text-seal sm:text-right">
                        {formatUsdc6(e.valueUsdc)} <span className="text-xs font-medium text-fog">USDSUI</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {summary.unresolved.length > 0 && (
                <p className="border-t border-hairline px-5 py-3 text-xs text-hold">
                  {summary.unresolved.length} ledger entr{summary.unresolved.length === 1 ? 'y is' : 'ies are'} pending or unknown and not counted
                  above; see the audit trail.
                </p>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Sponsors: text names only */}
      <section aria-labelledby="sponsors">
        <p className="font-mono text-xs font-semibold uppercase tracking-[0.2em] text-fog">Built with</p>
        <h2 id="sponsors" className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          What each partner does here
        </h2>
        <dl className="mt-6 divide-y divide-hairline border-y border-hairline">
          {SPONSORS.map((s) => (
            <div key={s.name} className="grid gap-1 py-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-6">
              <dt className="font-semibold text-manifest">{s.name}</dt>
              <dd className="text-sm leading-relaxed text-fog">{s.body}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/invoices" className={buttonClass('primary')}>
            Open the Invoice Inbox <span aria-hidden="true">→</span>
          </Link>
          <Link href="/vendor/bank-change" className={buttonClass('secondary')}>
            Vendor portal
          </Link>
        </div>
      </section>
    </div>
  );
}
