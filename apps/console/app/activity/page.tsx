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
import { PageHeader } from '../../components/ui/PageHeader';

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

  return (
    <div>
      <PageHeader
        kicker="Form AP-9 · Audit trail"
        title="Activity"
        lede="Every payment, vendor-record change and verified vendor request, newest first, read from the records themselves. People appear only as World pseudonyms: the World subject of an approving controller, or the IDKit nullifier of a verifying vendor representative."
      />

      <dl className="mb-8 grid grid-cols-1 gap-px overflow-hidden rounded-doc border border-hairline bg-hairline sm:grid-cols-3">
        <Count label="Settlements (ledger)" value={ledger.ok ? ledgerEntries.length : null} />
        <Count label="Vendor-master changes" value={changes.ok ? changes.value.length : null} />
        <Count label="Verified vendor requests" value={requests.ok ? requests.value.length : null} />
      </dl>

      {failures.map((f) => (
        <Notice key={f.store} tone="error" role="alert" title={`${f.store} could not be read`} className="mb-4">
          <span className="font-mono text-xs">{f.error}</span>
        </Notice>
      ))}

      {events.length === 0 ? (
        <p className="text-sm text-fog">Nothing recorded yet.</p>
      ) : (
        <ol className="relative space-y-0 border-l border-hairline pl-0" aria-label="Audit trail, newest first">
          {events.map((e) => (
            <TimelineItem key={eventKey(e)} event={e} />
          ))}
        </ol>
      )}
    </div>
  );
}

function Count({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="bg-deepwater px-5 py-4">
      <dt className="text-xs uppercase tracking-wider text-fog">{label}</dt>
      <dd className="mt-1 font-mono text-2xl font-semibold text-manifest">{value === null ? <span className="text-stamp-lit">unreadable</span> : value}</dd>
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
    <Link href={`/invoices/${id}`} className="font-mono text-manifest underline-offset-2 hover:underline">
      {id}
    </Link>
  ) : (
    <Hash value={proposalHash} className="text-manifest" />
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-fog">{label}</dt>
      <dd className="min-w-0 break-all font-mono text-manifest">{children}</dd>
    </>
  );
}

function TimelineItem({ event }: { event: ActivityEvent }) {
  let dot = 'bg-fog';
  let tag = '';
  let tagCls = 'text-fog border-hairline';
  let title: ReactNode = null;
  let body: ReactNode = null;

  if (event.kind === 'settlement') {
    const e = event.entry;
    if (e.status === 'settled') {
      dot = 'bg-seal';
      tag = e.viaStepup ? 'Paid · step-up' : 'Paid';
      tagCls = 'text-seal border-seal/60';
      title = (
        <>
          <InvoiceRef proposalHash={e.proposalHash} invoiceId={e.invoiceId} /> paid{' '}
          <span className="font-mono text-seal">{formatUsdc6(e.valueUsdc)} USDSUI</span> to {e.vendorId}
        </>
      );
      body = (
        <>
          <Row label="Digest">
            <SuiscanLink explorerUrl={e.explorerUrl} digest={e.digest} full />
          </Row>
          <Row label="Recipient">{e.recipient}</Row>
          <Row label="Path">{e.viaStepup ? 'settle_with_stepup' : 'settle (cleared, no human)'}</Row>
        </>
      );
    } else {
      dot = e.status === 'unknown' ? 'bg-stamp-lit' : 'bg-hold';
      tag = e.status === 'unknown' ? 'Settlement unknown' : 'Settling';
      tagCls = e.status === 'unknown' ? 'text-stamp-lit border-stamp/70' : 'text-hold border-hold/60';
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
    dot = 'bg-manifest';
    tag = 'Vendor record changed';
    tagCls = 'text-manifest border-manifest/50';
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
    dot = 'bg-fog';
    tag = 'Vendor request verified';
    tagCls = 'text-fog border-hairline';
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

  return (
    <li className="relative pb-8 pl-6 last:pb-0 sm:pl-8">
      <span className={`absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-harbor ${dot}`} aria-hidden="true" />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <time className="font-mono text-xs text-fog" dateTime={new Date(event.atMs).toISOString()}>
          {formatUtc(event.atMs)}
        </time>
        <span className={`rounded-sm border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider ${tagCls}`}>{tag}</span>
      </div>
      <p className="mt-1.5 break-words text-sm text-manifest">{title}</p>
      {body && <dl className="mt-2 grid gap-x-4 gap-y-1 rounded-doc border border-hairline bg-deepwater px-3 py-2 text-xs sm:grid-cols-[10rem_minmax(0,1fr)]">{body}</dl>}
    </li>
  );
}
