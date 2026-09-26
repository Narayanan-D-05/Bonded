import type { ReactNode } from 'react';
import Link from 'next/link';
import { buildActivityTimeline, formatUsdc6, type ActivityEvent } from '../../lib/activity';
import { readDemoLedger, readVendorMasterChangeLog, readVendorRequests } from '../../lib/activity-source';
import { findInvoiceIdByProposalHash } from '../../lib/enforce-deps';
import type { LedgerEntry } from '../../lib/settlement-ledger';
import { SuiscanLink } from '../../components/ui/ExternalLink';
import { formatUtc } from '../../components/ui/format';
import { Hash } from '../../components/ui/Hash';
import { Notice } from '../../components/ui/Notice';
import { Accent, PageHero, Section } from '../../components/ui/PageHeader';
import { Panel, Stat } from '../../components/ui/Panel';
import type { Sponsor } from '../../components/ui/SponsorLogo';

// Read-only, re-read on every request from the existing stores.
export const dynamic = 'force-dynamic';

/**
 * `/activity`: the audit trail. One timeline over three existing stores, read-only:
 *  - the settlement ledger (`.data/console/settlements.json`),
 *  - the vendor-master change log (World-approved bank changes, `readVendorMasterChanges`),
 *  - the IDKit-verified vendor bank-change requests (`lib/vendor-bank-change.ts`).
 * A store that cannot be read is named with its error; the others still render.
 */
export default async function ActivityPage() {
  const [ledger, changes, requests] = await Promise.all([readDemoLedger(), readVendorMasterChangeLog(), readVendorRequests()]);
  const ledgerEntries: LedgerEntry[] = ledger.ok ? ledger.value.flatMap((r) => (r.entry === null ? [] : [r.entry])) : [];
  const events = buildActivityTimeline({
    ledger: ledgerEntries,
    vendorMasterChanges: changes.ok ? changes.value : [],
    vendorRequests: requests.ok ? requests.value : [],
  });

  const failures = [
    !ledger.ok && { store: 'Settlement ledger', error: ledger.error },
    !changes.ok && { store: 'Vendor-master change log', error: changes.error },
    !requests.ok && { store: 'IDKit vendor bank-change requests', error: requests.error },
  ].filter((f): f is { store: string; error: string } => Boolean(f));

  const settledCount = ledgerEntries.filter((e) => e.status === 'settled').length;

  return (
    <>
      <PageHero
        eyebrow="Form AP-9 · Audit trail"
        title={
          <>
            Activity, <Accent>from the records.</Accent>
          </>
        }
        lede="Every payment, vendor-record change and verified vendor request, newest first, read from the records themselves. People appear only as World pseudonyms: the World subject of an approving controller, or the IDKit nullifier of a verifying vendor representative."
      >
        <dl className="mt-10 grid gap-5 sm:grid-cols-3">
          <Count label="Settlements (ledger)" sponsor="sui" value={ledger.ok ? ledgerEntries.length : null} note={ledger.ok ? `${settledCount} settled on Sui` : undefined} />
          <Count label="Vendor-master changes" sponsor="world" value={changes.ok ? changes.value.length : null} note="Approved with World ID" />
          <Count label="Verified vendor requests" sponsor="world" value={requests.ok ? requests.value.length : null} note="Verified with IDKit" />
        </dl>
      </PageHero>

      <Section tone="deep" eyebrow="Timeline" title="Newest first">
        {failures.map((f) => (
          <Notice key={f.store} tone="error" role="alert" title={`${f.store} could not be read`} className="mb-4">
            <span className="font-mono text-xs">{f.error}</span>
          </Notice>
        ))}

        {events.length === 0 ? (
          <Panel label="Audit trail">
            <p className="text-sm text-muted">Nothing recorded yet.</p>
          </Panel>
        ) : (
          <ol className="relative space-y-5 border-l-2 border-sui/40 pl-5 sm:pl-8" aria-label="Audit trail, newest first">
            {events.map((e) => (
              <TimelineItem key={eventKey(e)} event={e} />
            ))}
          </ol>
        )}
      </Section>
    </>
  );
}

function Count({ label, value, sponsor, note }: { label: string; value: number | null; sponsor: Sponsor; note?: string | undefined }) {
  return (
    <div>
      <dt className="sr-only">{label}</dt>
      <dd>
        <Stat label={label} sponsor={sponsor} value={value === null ? <span className="text-refused">unreadable</span> : value} tone="sui" note={note} />
      </dd>
    </div>
  );
}

function eventKey(e: ActivityEvent): string {
  if (e.kind === 'settlement') return `s-${e.entry.proposalHash}`;
  if (e.kind === 'vendor-master-change') return `c-${e.change.proposalHash}-${e.change.recordedAtMs}`;
  return `r-${e.request.nullifier}-${e.request.signalHash}`;
}

function InvoiceRef({ proposalHash, invoiceId }: { proposalHash: string; invoiceId?: string }) {
  const id = invoiceId ?? findInvoiceIdByProposalHash(proposalHash);
  return id ? (
    <Link href={`/invoices/${id}`} className="font-mono text-sui underline-offset-2 hover:underline">
      {id}
    </Link>
  ) : (
    <Hash value={proposalHash} className="text-navy" />
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-all font-mono text-navy">{children}</dd>
    </>
  );
}

function TimelineItem({ event }: { event: ActivityEvent }) {
  let dot = 'bg-muted';
  let tag = '';
  let tagCls = 'text-muted border-rule';
  let sponsor: Sponsor = 'sui';
  let title: ReactNode = null;
  let body: ReactNode = null;

  if (event.kind === 'settlement') {
    const e = event.entry;
    if (e.status === 'settled') {
      dot = 'bg-cleared';
      tag = e.viaStepup ? 'Paid · step-up' : 'Paid';
      tagCls = 'text-cleared border-cleared/70';
      title = (
        <>
          <InvoiceRef proposalHash={e.proposalHash} invoiceId={e.invoiceId} /> paid{' '}
          <span className="font-mono text-cleared">{formatUsdc6(e.valueUsdc)} USDSUI</span> to {e.vendorId}
        </>
      );
      body = (
        <>
          <Row label="Digest">
            <SuiscanLink explorerUrl={e.explorerUrl} digest={e.digest} full className="text-sui" />
          </Row>
          <Row label="Recipient">{e.recipient}</Row>
          <Row label="Path">{e.viaStepup ? 'settle_with_stepup' : 'settle (cleared, no human)'}</Row>
        </>
      );
    } else {
      dot = e.status === 'unknown' ? 'bg-refused' : 'bg-held';
      tag = e.status === 'unknown' ? 'Settlement unknown' : 'Settling';
      tagCls = e.status === 'unknown' ? 'text-refused border-refused/70' : 'text-held border-held/70';
      title = (
        <>
          <InvoiceRef proposalHash={e.proposalHash} invoiceId={e.invoiceId} />{' '}
          {e.status === 'unknown' ? 'settlement outcome unknown; never retried automatically' : 'settlement being submitted'}
        </>
      );
      body = e.status === 'unknown' ? <Row label="Error">{e.error}</Row> : null;
    }
  } else if (event.kind === 'vendor-master-change') {
    const c = event.change;
    dot = 'bg-navy';
    tag = 'Vendor record changed';
    tagCls = 'text-navy border-navy/50';
    sponsor = 'world';
    title = (
      <>
        {c.vendorId} payout address changed ({c.appliedTo}), approved for <InvoiceRef proposalHash={c.proposalHash} />
      </>
    );
    body = (
      <>
        <Row label="Previous">{c.previousPayoutAddress}</Row>
        <Row label="New">{c.newPayoutAddress}</Row>
        <Row label="Approver (World sub)">
          <span title="World ID for Agents subject: a stable pseudonym of the verified controller">{c.approvedBy.worldSub}</span>
        </Row>
        <Row label="World auth time">{formatUtc(c.approvedBy.authTimeMs)}</Row>
      </>
    );
  } else {
    const r = event.request;
    dot = 'bg-muted';
    tag = 'Vendor request verified';
    tagCls = 'text-muted border-muted/50';
    sponsor = 'world';
    title = (
      <>
        {r.vendorId} filed a bank change, verified with World ID via IDKit ({r.credentialType}, World ID {r.protocolVersion}, {r.environment})
      </>
    );
    body = (
      <>
        <Row label="New payout">{r.newPayoutAddress}</Row>
        <Row label="EVM identity">{r.newEvmAddress}</Row>
        <Row label="Person (nullifier)">
          <span title="IDKit nullifier: a stable pseudonym of the verified person for this action">{r.nullifier}</span>
        </Row>
        <Row label="Action">{r.action}</Row>
      </>
    );
  }

  const label = sponsor === 'sui' ? 'Payment · Sui' : event.kind === 'vendor-master-change' ? 'Approval · World ID' : 'Vendor request · World IDKit';
  return (
    <li className="relative">
      <span className={`absolute -left-[27px] top-5 h-3 w-3 rounded-full ring-4 ring-ocean-950 sm:-left-[39px] ${dot}`} aria-hidden="true" />
      <Panel
        as="div"
        label={label}
        sponsor={sponsor}
        aside={
          <time className="font-mono" dateTime={new Date(event.atMs).toISOString()}>
            {formatUtc(event.atMs)}
          </time>
        }
      >
        <span className={`inline-flex rounded-full border bg-white px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${tagCls}`}>{tag}</span>
        <p className="mt-2 break-words text-sm text-navy">{title}</p>
        {body && <dl className="mt-3 grid gap-x-4 gap-y-1 rounded-xl border border-rule bg-raised px-3 py-2 text-xs sm:grid-cols-[10rem_minmax(0,1fr)]">{body}</dl>}
      </Panel>
    </li>
  );
}
