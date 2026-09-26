import Link from 'next/link';
import { formatUsdc6 } from '../../lib/activity';
import { readDemoLedger } from '../../lib/activity-source';
import { defaultConsoleContext, listDemoInvoices } from '../../lib/enforce-deps';
import type { LedgerEntry } from '../../lib/settlement-ledger';
import { Hash } from '../../components/ui/Hash';
import { LedgerStatus } from '../../components/ui/LedgerStatus';
import { readVerdictLog, type VerdictLogEntry } from '../../lib/verdict-log';
import { Notice } from '../../components/ui/Notice';
import { Accent, PageHero, Section } from '../../components/ui/PageHeader';
import { Panel, Stat } from '../../components/ui/Panel';
import { SponsorTag } from '../../components/ui/SponsorLogo';
import { VerdictChip } from '../../components/ui/Stamp';

// Always re-reads the vendor master and the ledger: this is a demo of live re-derivation.
export const dynamic = 'force-dynamic';

/**
 * Invoice Inbox: the six demo invoices the AP agent has to pay. Opening one is the agent
 * proposing that payment (`POST /api/enforce`); a CLEARED verdict settles on Sui without any human
 * click. No verdict is computed on this list: the status column is read from the settlement ledger
 * and the agent's verdict log only, and the summary counts are tallied from those same records.
 */
export default async function InvoiceInboxPage() {
  const invoices = await listDemoInvoices(defaultConsoleContext().vendorSource);
  const ledger = await readDemoLedger();
  const entryOf = new Map<string, LedgerEntry | null>(ledger.ok ? ledger.value.map((r) => [r.invoiceId, r.entry]) : []);
  // The agent's latest verdict per invoice (display only). Unreadable -> no verdicts shown.
  let verdictOf: Record<string, VerdictLogEntry> = {};
  try {
    verdictOf = await readVerdictLog();
  } catch {
    verdictOf = {};
  }

  // Summary counts, from the same records the status column shows.
  const counts = { paid: 0, refused: 0, held: 0, open: 0 };
  for (const inv of invoices) {
    const entry = entryOf.get(inv.invoiceId) ?? null;
    const verdict = verdictOf[inv.invoiceId];
    if (entry?.status === 'settled') counts.paid += 1;
    else if (entry === null && verdict?.outcomeLabel === 'REFUSED') counts.refused += 1;
    else if (entry === null && verdict?.outcomeLabel === 'HELD_FOR_STEPUP') counts.held += 1;
    else counts.open += 1;
  }

  const needsLabel = (needs: string[]) => (needs.length === 0 ? 'No keys' : needs.join(', '));

  return (
    <>
      <PageHero
        eyebrow="Form AP-1 · Invoice manifest"
        title={
          <>
            Invoice Inbox: every payment, <Accent>checked first.</Accent>
          </>
        }
        lede={
          <>
            Opening an invoice has the AP agent propose its payment. The real <code className="font-mono text-navy">enforce()</code> verdict
            decides: a cleared invoice settles on Sui, a held one waits for a World ID step-up, a refused one pays nothing. Nothing is checked on
            this list; each status is what the settlement ledger and the agent’s verdict log record.
          </>
        }
      >
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Paid on Sui" sponsor="sui" value={counts.paid} tone="cleared" note="Settled; the digest is on Suiscan." />
          <Stat label="Refused" value={counts.refused} tone="refused" note="Nothing paid." />
          <Stat label="Held for a person" value={counts.held} tone="held" note="Waiting for a World ID step-up." />
          <Stat label="Not settled yet" value={counts.open} tone="snow" note="Not reviewed, cleared but unpaid, or in progress." />
        </div>
      </PageHero>

      <Section tone="deep" eyebrow="Kestrel Components · accounts payable" title="Invoices awaiting payment">
        {!ledger.ok && (
          <Notice tone="error" role="alert" title="Settlement status unavailable: the ledger could not be read" className="mb-6">
            <span className="font-mono text-xs">{ledger.error}</span>
          </Notice>
        )}

        <Panel label="Invoice manifest" aside={`${invoices.length} invoices`} bodyClassName="">
          {/* md and up: the manifest table */}
          <table className="hidden w-full border-collapse text-left md:table">
            <caption className="sr-only">Demo invoices awaiting payment, with the settlement status from the ledger</caption>
            <thead>
              <tr className="border-b border-rule font-mono text-[11px] uppercase tracking-wider text-muted">
                <th scope="col" className="px-6 py-3 font-semibold">Vendor</th>
                <th scope="col" className="px-3 py-3 text-right font-semibold">Amount</th>
                <th scope="col" className="px-3 py-3 font-semibold">Claimed payout</th>
                <th scope="col" className="px-3 py-3 font-semibold">Status</th>
                <th scope="col" className="px-6 py-3">
                  <span className="sr-only">Review</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {invoices.map((inv) => (
                <tr key={inv.invoiceId} className="align-top transition-colors hover:bg-ocean-900">
                  <td className="px-6 py-4">
                    <div className="font-semibold text-navy">{inv.legalName}</div>
                    <div className="mt-0.5 font-mono text-xs text-muted">{inv.invoiceId}</div>
                    <div className="mt-1 text-xs text-muted">
                      <span className="font-medium">Needs:</span> <span className="break-words font-mono">{needsLabel(inv.needs)}</span>
                    </div>
                  </td>
                  <td className="px-3 py-4 text-right font-mono text-sm font-semibold text-navy">${formatUsdc6(inv.claimedInvoiceAmountUSD)}</td>
                  <td className="px-3 py-4 text-xs text-navy">
                    <Hash value={inv.claimedPayoutAddress} />
                  </td>
                  <td className="px-3 py-4">
                    <LedgerStatus entry={entryOf.get(inv.invoiceId) ?? null} verdict={verdictOf[inv.invoiceId] ?? null} />
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Link
                      href={`/invoices/${inv.invoiceId}`}
                      className="inline-flex whitespace-nowrap rounded-xl border border-sui/70 px-3.5 py-1.5 text-sm font-semibold text-sui transition-colors hover:bg-sui hover:text-white"
                    >
                      Review <span aria-hidden="true">&nbsp;→</span>
                      <span className="sr-only"> {inv.invoiceId}</span>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* below md: one card per invoice, same data */}
          <ul className="divide-y divide-rule md:hidden">
            {invoices.map((inv) => (
              <li key={inv.invoiceId} className="px-5 py-4">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-navy">{inv.legalName}</div>
                    <div className="font-mono text-xs text-muted">{inv.invoiceId}</div>
                  </div>
                  <div className="shrink-0 font-mono text-sm font-semibold text-navy">${formatUsdc6(inv.claimedInvoiceAmountUSD)}</div>
                </div>
                <dl className="mt-3 space-y-1.5 text-xs text-navy">
                  <div className="flex gap-2">
                    <dt className="w-16 shrink-0 text-muted">Payout</dt>
                    <dd className="min-w-0">
                      <Hash value={inv.claimedPayoutAddress} />
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-16 shrink-0 text-muted">Needs</dt>
                    <dd className="min-w-0 break-words font-mono">{needsLabel(inv.needs)}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-16 shrink-0 text-muted">Status</dt>
                    <dd className="min-w-0">
                      <LedgerStatus entry={entryOf.get(inv.invoiceId) ?? null} verdict={verdictOf[inv.invoiceId] ?? null} />
                    </dd>
                  </div>
                </dl>
                <Link
                  href={`/invoices/${inv.invoiceId}`}
                  className="mt-3 inline-flex rounded-xl border border-sui/70 px-3.5 py-1.5 text-sm font-semibold text-sui hover:bg-sui hover:text-white"
                >
                  Review <span aria-hidden="true">&nbsp;→</span>
                  <span className="sr-only"> {inv.invoiceId}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>

        <p className="mt-5 max-w-3xl text-sm leading-relaxed text-muted">
          Amounts are the invoice’s claimed amount in 6-decimal fixed point. “Needs” lists the keys an invoice requires to run live; without them it
          fails visibly (for example, the Intercepta screen fails closed and the invoice is refused). Reviewing an invoice runs the agent.
        </p>
      </Section>

      <Section
        tone="band"
        eyebrow="Reading the status column"
        title="What each status means"
        lede="Every status is a word as well as a colour, and each one is read from a record, never recomputed on this page."
      >
        <div className="grid gap-5 md:grid-cols-3">
          <Panel label="Paid" sponsor="sui">
            <VerdictChip outcome="CLEARED" />
            <p className="mt-4 text-sm leading-relaxed text-muted">
              The verdict was CLEARED and the agent settled it on Sui, once. The digest links to the transaction on Suiscan; reopening the invoice
              shows the recorded payment instead of paying again.
            </p>
            <div className="mt-4 text-xs font-medium text-navy">
              <SponsorTag sponsor="sui" size={16} label="Settled on Sui testnet" />
            </div>
          </Panel>
          <Panel label="Refused">
            <VerdictChip outcome="REFUSED" />
            <p className="mt-4 text-sm leading-relaxed text-muted">
              A premise did not match its re-derived value in a way no person should wave through, or a fact could not be checked at all. The
              reason code is shown next to it. Nothing is paid.
            </p>
            <div className="mt-4 text-xs font-medium text-navy">
              <SponsorTag sponsor="intercepta" size={16} label="A risky payee is refused by the Intercepta screen" />
            </div>
          </Panel>
          <Panel label="Held">
            <VerdictChip outcome="HELD_FOR_STEPUP" />
            <p className="mt-4 text-sm leading-relaxed text-muted">
              The payout address changed, or the amount is over the irreversible threshold. Nothing is paid until a live person approves this exact
              proposal with a fresh World ID check.
            </p>
            <div className="mt-4 text-xs font-medium text-navy">
              <SponsorTag sponsor="world" size={16} label="Released only by World ID" />
            </div>
          </Panel>
        </div>
      </Section>
    </>
  );
}
