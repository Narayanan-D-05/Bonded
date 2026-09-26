import type { ReactNode } from 'react';
import Link from 'next/link';
import { buildActivityTimeline, formatUsdc6, summarizeSettlements, type ActivityEvent } from '../lib/activity';
import { readDemoLedger, readVendorMasterChangeLog, readVendorRequests } from '../lib/activity-source';
import type { LedgerEntry } from '../lib/settlement-ledger';
import { HeroVideo } from '../components/HeroVideo';
import { SiteFooter } from '../components/SiteFooter';
import { buttonClass } from '../components/ui/button';
import { ExternalLink, SuiscanLink } from '../components/ui/ExternalLink';
import { formatUtc } from '../components/ui/format';
import { Notice } from '../components/ui/Notice';
import { Accent, Container, Eyebrow, Section } from '../components/ui/PageHeader';
import { Panel, Stat } from '../components/ui/Panel';
import { SponsorLogo, SponsorTag, type Sponsor } from '../components/ui/SponsorLogo';
import { VerdictChip, type Outcome } from '../components/ui/Stamp';

// The live figures are read from the settlement ledger and the audit stores on every request.
export const dynamic = 'force-dynamic';

const IC3_2025 = 'https://www.ic3.gov/AnnualReport/Reports/2025_IC3Report.pdf';

/** FBI IC3 2025 figures, as cited in docs/PROJECT_OVERVIEW.md §2 and USECASE.md. */
const PROBLEM_STATS = [
  { label: 'Lost to BEC in 2025', value: '$3.04B', note: 'Business Email Compromise losses reported to the FBI, up from $2.77B in 2024.' },
  { label: 'Rank by dollar loss', value: '#2', note: 'The second-largest cybercrime by total dollar loss.' },
  { label: 'Average per incident', value: '~$123K', note: 'Enough to erase a quarter’s margin at a mid-size company.' },
  { label: 'Moved by wire or ACH', value: '86%', note: 'Usually unrecoverable once it lands in a mule account.' },
] as const;

const STEPS: readonly { n: string; title: string; body: ReactNode; sponsors: Sponsor[] }[] = [
  {
    n: '01',
    title: 'The agent proposes',
    body: 'The AP agent does not pay. It submits what the invoice claims: the vendor, the payout address, the amount and the payee’s identity.',
    sponsors: [],
  },
  {
    n: '02',
    title: 'Bonded re-derives the facts',
    body: 'It reads the vendor’s real payout address and status from the vendor master, screens the claimed payee identity with Intercepta, and reads the agent’s approved policy from Sui.',
    sponsors: ['intercepta', 'sui'],
  },
  {
    n: '03',
    title: 'A verdict, with the evidence',
    body: 'Every claim is shown next to the value re-derived just now. The result is CLEARED, REFUSED or HELD, with the reason code that decided it.',
    sponsors: [],
  },
  {
    n: '04',
    title: 'Pay on Sui, or hold for a person',
    body: 'A cleared invoice settles on Sui automatically, once. A held one waits for a fresh World ID check by a live person. There is no approve button on routine payments.',
    sponsors: ['sui', 'world'],
  },
];

const OUTCOMES: readonly { outcome: Outcome; title: string; body: string; codes: { code: string; when: string }[] }[] = [
  {
    outcome: 'CLEARED',
    title: 'Paid automatically',
    body: 'Every premise matches its re-derived value and the amount is inside the policy. The agent settles on Sui with no human click, once per proposal.',
    codes: [{ code: 'OK', when: 'All facts match; within budget and threshold.' }],
  },
  {
    outcome: 'REFUSED',
    title: 'Nothing is paid',
    body: 'A fact is wrong in a way no human should wave through, or it cannot be checked at all. Fail-closed: no screen result means no payment.',
    codes: [
      { code: 'PREMISE_MISMATCH', when: 'A sanctioned payee trait, a suspended vendor, a wrong identity.' },
      { code: 'PREMISE_UNRESOLVABLE', when: 'A source could not be read, so the fact is unverified.' },
      { code: 'BUDGET_EXCEEDED', when: 'The period’s spend limit would be crossed.' },
      { code: 'STALE_POLICY', when: 'The policy does not match the one committed on Sui.' },
      { code: 'POLICY_FORBIDDEN_ACTION', when: 'The action is forbidden by the policy.' },
    ],
  },
  {
    outcome: 'HELD_FOR_STEPUP',
    title: 'Waits for a verified person',
    body: 'Genuinely ambiguous cases: it might be a real bank change, or it is too large to reverse. A live person approves with a fresh World ID check.',
    codes: [
      { code: 'PREMISE_HELD_FOR_REVIEW', when: 'The payout address differs from the one on file.' },
      { code: 'IRREVERSIBLE_UNCONFIRMED', when: 'The amount is over the irreversible threshold.' },
    ],
  },
];

/** From sponsers.md and docs/PROJECT_OVERVIEW.md §7. */
const SPONSORS: readonly { id: Sponsor; name: string; role: string; body: string }[] = [
  {
    id: 'intercepta',
    name: 'Intercepta',
    role: 'Live payee screening',
    body: 'Screens the payee identity an invoice claims against live threat intelligence (sanctions, known scammers, mixer use) before any payment. A payee with a documented risk trait is refused outright, never held for a human who might approve it.',
  },
  {
    id: 'world',
    name: 'World',
    role: 'Verified humans',
    body: 'World ID for Agents proves a live person approves a held payment right now, with a fresh check scoped to that one proposal. IDKit proves the vendor’s own representative filed a bank change, with a passport credential.',
  },
  {
    id: 'sui',
    name: 'Sui',
    role: 'Settlement and replay safety',
    body: 'Holds the funds in a vault, keeps the agent’s committed policy in a registry, and settles cleared invoices. A verdict is a one-use object consumed when it settles, so a payment can never be replayed.',
  },
];

/** docs/PROJECT_OVERVIEW.md §6. */
const COMPETITORS = [
  {
    category: 'Vendor bank-account verification',
    examples: 'Trustpair, Eftsure',
    good: 'Verify and monitor supplier bank details; the closest competitors.',
    bonded: 'Built as dashboards for finance teams. Bonded is a check the agent itself calls mid-decision, as an SDK or MCP tool, and it settles the payment.',
  },
  {
    category: 'AP automation platforms',
    examples: 'Bill.com, Tipalti, AvidXchange',
    good: 'Run the whole payables workflow, with their own fraud checks.',
    bonded: 'Their checks live inside their platform. Bonded is an independent layer any agent or platform can call.',
  },
  {
    category: 'Treasury and payment security',
    examples: 'Bottomline, Kyriba',
    good: 'Pattern-based risk scoring across large transaction volumes.',
    bonded: 'They score patterns. Bonded re-derives the specific facts one payment relies on, and shows each one next to its claim.',
  },
  {
    category: 'Agent payment standards',
    examples: 'Google AP2, Visa’s agent guardrails',
    good: 'Prove what the agent was authorized to do (intent, limits).',
    bonded: 'They prove intent. Bonded proves the facts behind the intent are true. The two work together.',
  },
] as const;

export default async function OverviewPage() {
  const [ledger, changes, requests] = await Promise.all([readDemoLedger(), readVendorMasterChangeLog(), readVendorRequests()]);
  const entries: LedgerEntry[] = ledger.ok ? ledger.value.flatMap((r) => (r.entry === null ? [] : [r.entry])) : [];
  const summary = summarizeSettlements(entries);
  const latest = buildActivityTimeline({
    ledger: entries,
    vendorMasterChanges: changes.ok ? changes.value : [],
    vendorRequests: requests.ok ? requests.value : [],
  }).slice(0, 5);

  return (
    <>
      {/* 1. Hero */}
      <section aria-labelledby="hero-title" className="bg-hero relative isolate overflow-hidden">
        <HeroVideo />
        <Container className="relative py-20 sm:py-28 lg:py-32">
          <Eyebrow>Pre-payment verification for AI accounts-payable agents</Eyebrow>
          <h1
            id="hero-title"
            className="mt-6 max-w-4xl font-display text-5xl font-bold leading-[1.02] tracking-[-0.035em] text-navy sm:text-6xl lg:text-7xl"
          >
            Catch vendor-payment fraud <Accent>before</Accent> <span className="text-sui-gradient">your agent pays.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted sm:text-xl">
            Business Email Compromise impersonates a real vendor and changes where the money goes. Bonded sits inside the AP agent’s decision:
            it re-checks every fact a payment relies on, right before money moves, and sends only the genuinely ambiguous case to a verified
            human.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <Link href="/invoices" className={buttonClass('primary', 'px-6 py-3.5 text-base')}>
              Open the Invoice Inbox <span aria-hidden="true">→</span>
            </Link>
            <Link href="/vendor/bank-change" className={buttonClass('secondary', 'px-6 py-3.5 text-base')}>
              Vendor portal
            </Link>
          </div>
          <ul className="mt-14 flex flex-wrap items-center gap-x-8 gap-y-3 text-sm text-muted" aria-label="Built with">
            <li className="flex items-center gap-2">
              <SponsorLogo sponsor="intercepta" size={22} />
              <span>
                Screened by <span className="font-semibold text-navy">Intercepta</span>
              </span>
            </li>
            <li className="flex items-center gap-2">
              <SponsorLogo sponsor="world" size={22} />
              <span>
                Verified by <span className="font-semibold text-navy">World</span>
              </span>
            </li>
            <li className="flex items-center gap-2">
              <SponsorLogo sponsor="sui" size={22} />
              <span>
                Settled on <span className="font-semibold text-navy">Sui</span>
              </span>
            </li>
          </ul>
        </Container>
      </section>

      {/* 2. The problem */}
      <Section
        id="problem"
        tone="deep"
        eyebrow="The problem"
        title={
          <>
            The first payment after a vendor changes banks is <Accent>where fraud gets paid.</Accent>
          </>
        }
        lede="AI agents are moving into payables. The payment moment is where this fraud lands, and an agent makes it worse unless something checks its facts."
      >
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {PROBLEM_STATS.map((s) => (
            <Stat key={s.label} label={s.label} value={s.value} note={s.note} />
          ))}
        </div>
        <p className="mt-6 text-sm text-muted">
          Source:{' '}
          <ExternalLink href={IC3_2025} className="font-medium text-sui">
            FBI Internet Crime Complaint Center, 2025 IC3 Report (PDF)
          </ExternalLink>
        </p>
      </Section>

      {/* 3. How it works */}
      <Section
        id="how"
        tone="band"
        eyebrow="How Bonded works"
        title="Four steps, on every payment"
        lede="Bonded sits between the agent’s decision to pay and the payment itself. Nothing is taken on the invoice’s word."
      >
        <ol className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <Panel key={s.n} as="li" label={`Step ${s.n}`} className="box-lift flex flex-col" bodyClassName="flex flex-1 flex-col px-5 py-5 sm:px-6">
              <h3 className="font-display text-xl font-bold tracking-[-0.01em] text-navy">{s.title}</h3>
              <p className="mt-3 flex-1 text-sm leading-relaxed text-muted">{s.body}</p>
              {s.sponsors.length > 0 && (
                <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 border-t border-rule pt-4 text-xs font-medium text-navy">
                  {s.sponsors.map((sp) => (
                    <SponsorTag key={sp} sponsor={sp} size={18} />
                  ))}
                </div>
              )}
            </Panel>
          ))}
        </ol>
      </Section>

      {/* 4. Live proof */}
      <Section
        id="ledger"
        tone="deep"
        eyebrow="Live proof · Sui testnet"
        title="What has actually been paid"
        lede="Read from the settlement ledger on every request. Each payment links to its transaction on Suiscan."
      >
        {!ledger.ok ? (
          <Notice tone="error" role="alert" title="The settlement ledger could not be read">
            <span className="font-mono text-xs">{ledger.error}</span>
          </Notice>
        ) : (
          <div className="grid gap-5 lg:grid-cols-3">
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1">
              <Stat label="Invoices paid on Sui" sponsor="sui" value={summary.paidCount} />
              <Stat
                label="Total settled on Sui"
                sponsor="sui"
                value={
                  <>
                    {formatUsdc6(summary.totalUsdc)} <span className="text-base font-medium text-muted">USDSUI</span>
                  </>
                }
              />
            </div>

            <Panel label="Settlements" sponsor="sui" aside={`${summary.settled.length} paid`} className="lg:col-span-2" bodyClassName="">
              {summary.settled.length === 0 ? (
                <p className="px-6 py-5 text-sm text-muted">No settlements are recorded yet. Open a clean invoice in the Invoice Inbox to have the agent pay it.</p>
              ) : (
                <ul className="divide-y divide-rule">
                  {summary.settled.map((e) => (
                    <li key={e.proposalHash} className="grid gap-1 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4 sm:px-6">
                      <div className="min-w-0">
                        <Link href={`/invoices/${e.invoiceId}`} className="font-mono text-sm font-semibold text-sui underline-offset-4 hover:underline">
                          {e.invoiceId}
                        </Link>
                        <span className="ml-2 text-xs text-muted">
                          {e.vendorId} · {formatUtc(e.settledAtMs)}
                          {e.viaStepup ? ' · settle_with_stepup' : ''}
                        </span>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                          <SponsorLogo sponsor="sui" size={14} />
                          Sui digest <SuiscanLink explorerUrl={e.explorerUrl} digest={e.digest} className="text-sui" />
                        </div>
                      </div>
                      <div className="font-mono text-base font-semibold text-cleared sm:text-right">
                        {formatUsdc6(e.valueUsdc)} <span className="text-xs font-medium text-muted">USDSUI</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {summary.unresolved.length > 0 && (
                <p className="border-t border-rule px-6 py-3 text-xs text-held">
                  {summary.unresolved.length} ledger entr{summary.unresolved.length === 1 ? 'y is' : 'ies are'} pending or unknown and not counted
                  above; see the audit trail.
                </p>
              )}
            </Panel>
          </div>
        )}

        <Panel
          label="Latest activity"
          className="mt-5"
          aside={
            <Link href="/activity" className="text-sui underline-offset-4 hover:underline">
              Full audit trail <span aria-hidden="true">→</span>
            </Link>
          }
          bodyClassName=""
        >
          {latest.length === 0 ? (
            <p className="px-6 py-5 text-sm text-muted">Nothing recorded yet.</p>
          ) : (
            <ul className="divide-y divide-rule">
              {latest.map((e) => (
                <LatestItem key={latestKey(e)} event={e} />
              ))}
            </ul>
          )}
        </Panel>
      </Section>

      {/* 5. Outcomes */}
      <Section
        id="outcomes"
        tone="band"
        eyebrow="Verdicts"
        title="What happens to each kind of invoice"
        lede="Three outcomes, each with the reason code enforce() returns. Only the genuinely ambiguous case ever reaches a person."
      >
        <div className="grid gap-5 lg:grid-cols-3">
          {OUTCOMES.map((o) => (
            <Panel key={o.outcome} label={o.outcome} className="flex flex-col" bodyClassName="flex flex-1 flex-col px-5 py-5 sm:px-6">
              <VerdictChip outcome={o.outcome} className="self-start" />
              <h3 className="mt-4 font-display text-2xl font-bold tracking-[-0.01em] text-navy">{o.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{o.body}</p>
              <dl className="mt-5 space-y-3 border-t border-rule pt-4">
                {o.codes.map((c) => (
                  <div key={c.code}>
                    <dt className="break-all font-mono text-xs font-semibold text-navy">{c.code}</dt>
                    <dd className="mt-0.5 text-xs leading-relaxed text-muted">{c.when}</dd>
                  </div>
                ))}
              </dl>
            </Panel>
          ))}
        </div>
      </Section>

      {/* 6. Built with */}
      <Section
        id="sponsors"
        tone="deep"
        eyebrow="Built with"
        title="Three partners, three jobs"
        lede="Each one does something the others cannot. Remove any of them and a specific guarantee disappears."
      >
        <dl className="grid gap-5 md:grid-cols-3">
          {SPONSORS.map((s) => (
            <div key={s.id} className="box box-lift flex flex-col">
              <dt className="box-head flex items-center gap-3 px-5 py-3 sm:px-6">
                <span className="inline-flex shrink-0 rounded-full bg-white p-1 ring-1 ring-rule.5">
                  <SponsorLogo sponsor={s.id} size={40} />
                </span>
                <span>
                  <span className="block font-display text-2xl font-bold leading-tight tracking-[-0.01em] text-navy">{s.name}</span>
                  <span className="block font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-navy">{s.role}</span>
                </span>
              </dt>
              <dd className="flex-1 px-5 py-5 text-sm leading-relaxed text-muted sm:px-6">{s.body}</dd>
            </div>
          ))}
        </dl>
      </Section>

      {/* 7. Why it's different */}
      <Section
        id="different"
        tone="band"
        eyebrow="Why it’s different"
        title="A check inside the agent’s own decision"
        lede="Bonded pays the clear cases automatically, brings in a person only when the bank details change, verifies that person’s identity, and settles each payment once and only once."
      >
        <Panel label="Compared with existing categories" bodyClassName="">
          <table className="hidden w-full border-collapse text-left text-sm md:table">
            <caption className="sr-only">How Bonded compares with existing product categories</caption>
            <thead>
              <tr className="border-b border-rule font-mono text-[11px] uppercase tracking-wider text-muted">
                <th scope="col" className="px-6 py-3 font-semibold">Category</th>
                <th scope="col" className="px-4 py-3 font-semibold">What they do well</th>
                <th scope="col" className="px-6 py-3 font-semibold">Where Bonded differs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {COMPETITORS.map((c) => (
                <tr key={c.category} className="align-top">
                  <th scope="row" className="px-6 py-4 font-normal">
                    <div className="font-semibold text-navy">{c.category}</div>
                    <div className="mt-0.5 text-xs text-muted">{c.examples}</div>
                  </th>
                  <td className="px-4 py-4 text-muted">{c.good}</td>
                  <td className="px-6 py-4 text-navy">{c.bonded}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="divide-y divide-rule md:hidden">
            {COMPETITORS.map((c) => (
              <li key={c.category} className="px-5 py-4">
                <div className="font-semibold text-navy">{c.category}</div>
                <div className="text-xs text-muted">{c.examples}</div>
                <p className="mt-2 text-sm text-muted">{c.good}</p>
                <p className="mt-2 text-sm text-navy">{c.bonded}</p>
              </li>
            ))}
          </ul>
        </Panel>
      </Section>

      {/* 8. Closing CTA */}
      <section aria-labelledby="cta-title" className="bg-cta py-20 sm:py-24">
        <Container>
          <div className="box px-6 py-10 text-center sm:px-12 sm:py-14">
            <Eyebrow className="justify-center">See it run</Eyebrow>
            <h2 id="cta-title" className="mx-auto mt-4 max-w-3xl font-display text-3xl font-bold leading-[1.1] tracking-[-0.02em] text-navy sm:text-5xl">
              Open an invoice and watch the agent <Accent>check its facts.</Accent>
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
              The inbox holds six real scenarios: a clean invoice, a spoofed bank change with a sanctioned payee, a suspended vendor, two genuine bank
              changes, and one invoice over the irreversible threshold.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/invoices" className={buttonClass('primary', 'px-6 py-3.5 text-base')}>
                Open the Invoice Inbox <span aria-hidden="true">→</span>
              </Link>
              <Link href="/activity" className={buttonClass('secondary', 'px-6 py-3.5 text-base')}>
                View the audit trail
              </Link>
            </div>
          </div>
        </Container>
      </section>
      <SiteFooter />
    </>
  );
}

function latestKey(e: ActivityEvent): string {
  if (e.kind === 'settlement') return `s-${e.entry.proposalHash}`;
  if (e.kind === 'vendor-master-change') return `c-${e.change.proposalHash}-${e.change.recordedAtMs}`;
  return `r-${e.request.nullifier}-${e.request.signalHash}`;
}

/** One compact line of the audit trail: the sponsor whose technology produced it, what happened, and when. */
function LatestItem({ event }: { event: ActivityEvent }) {
  let sponsor: Sponsor;
  let what: ReactNode;
  if (event.kind === 'settlement') {
    const e = event.entry;
    sponsor = 'sui';
    what =
      e.status === 'settled' ? (
        <>
          <span className="font-mono text-navy">{e.invoiceId}</span> paid <span className="font-mono text-cleared">{formatUsdc6(e.valueUsdc)} USDSUI</span> to{' '}
          {e.vendorId} on Sui
        </>
      ) : (
        <>
          <span className="font-mono text-navy">{e.invoiceId}</span> settlement {e.status === 'unknown' ? 'outcome unknown' : 'being submitted'}
        </>
      );
  } else if (event.kind === 'vendor-master-change') {
    sponsor = 'world';
    what = (
      <>
        {event.change.vendorId} payout address changed, approved with World ID
      </>
    );
  } else {
    sponsor = 'world';
    what = (
      <>
        {event.request.vendorId} filed a bank change, verified with World ID (IDKit)
      </>
    );
  }
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3.5 text-sm sm:px-6">
      <SponsorLogo sponsor={sponsor} size={20} />
      <span className="min-w-0 flex-1 break-words text-muted">{what}</span>
      <time className="font-mono text-xs text-muted" dateTime={new Date(event.atMs).toISOString()}>
        {formatUtc(event.atMs)}
      </time>
    </li>
  );
}
