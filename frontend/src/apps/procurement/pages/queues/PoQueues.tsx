import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import { formatDate, todayIso } from "@/shared/lib/time";
import { useProcurementStore } from "../../store";
import { inr } from "../../lib/format";
import {
  allReceived,
  piCoverage,
  poInAdvance,
  poInCollectPi,
  poInFollowUp,
  poInInward,
  poInSharePo,
  poInTally,
  poQty,
  sinceIso,
  unbookedQty,
} from "../../lib/queues";
import type { StepKey } from "../../lib/steps";
import DueCell, { overdueRowClass } from "../../components/DueCell";
import QueueTable, { type QueueColumn } from "../../components/QueueTable";
import { SharePoModal, AddPiModal, PaymentModal, FollowupModal, GrnModal, TallyModal } from "../../components/PoModals";
import type { PurchaseOrder } from "../../types";

const PILL = "inline-flex items-center text-[11px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5";

/** Goods quantities are plain counts, not money — group them the Indian way. */
const numFmt = (n: number) => n.toLocaleString("en-IN");

/**
 * Generic per-step queue: a filtered work-list of POs awaiting THIS step's owner,
 * with an inline action (rendered by `renderAction`) plus an Open link. One queue
 * per workflow step — see the six exports below.
 */
function StepQueuePage({
  title,
  subtitle,
  filter,
  renderAction,
  extraColumns,
  hideDue = false,
  hideMoney = false,
  rowClassName,
}: {
  title: string;
  subtitle: string;
  filter: (po: PurchaseOrder) => boolean;
  renderAction: (po: PurchaseOrder) => ReactNode;
  /**
   * Optional queue-specific columns. Full QueueColumn configs (so they can carry
   * their own filter/sort). `after` places the column right after the column with
   * that key (e.g. "stage"); omitted ⇒ appended just before Actions.
   */
  extraColumns?: (QueueColumn<PurchaseOrder> & { after?: string })[];
  /** Hide the generic SLA "Due" column (e.g. Follow-up, where dispatch date is the only due). */
  hideDue?: boolean;
  /** Hide the Value + Pending (₹) columns (e.g. Inward, which shows qty instead). */
  hideMoney?: boolean;
  /** Override the row tint. Defaults to the generic SLA overdue tint (created + SLA). */
  rowClassName?: (po: PurchaseOrder) => string;
}) {
  const s = useProcurementStore();
  const rows = useMemo(() => s.pos.filter(filter).sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [s.pos, filter]);

  const vendorName = (p: PurchaseOrder) => s.vendorById(p.vendorId)?.name ?? "—";
  const companyName = (id: string) => s.companyById(id)?.name ?? "—";
  // "In stage since" and the due date come from lib/queues.ts — the same functions
  // the FMS Control Center uses, so the two can never disagree. The due date is the
  // step's admin-configured anchor + working days (Setup → Due Dates); for follow_up
  // it is the vendor's promised dispatch date, and may be null.
  const since = (p: PurchaseOrder) => sinceIso(s.procIndex, p);
  const dueIso = (p: PurchaseOrder) => s.dueIsoForPo(p, p.currentStage as StepKey);

  const columns: QueueColumn<PurchaseOrder>[] = [
    { key: "po", header: "PO No.", cell: (p) => <span className="font-semibold text-navy">{p.poNo}</span>, sortValue: (p) => p.poNo, filter: { kind: "text", get: (p) => p.poNo }, tdClassName: "whitespace-nowrap" },
    { key: "vendor", header: "Vendor", cell: (p) => vendorName(p), sortValue: (p) => vendorName(p), filter: { kind: "select", get: (p) => vendorName(p) }, tdClassName: "whitespace-nowrap" },
    ...(hideMoney
      ? []
      : [
          { key: "value", header: "Value", cell: (p: PurchaseOrder) => inr(p.totalValue), sortValue: (p: PurchaseOrder) => p.totalValue, filter: { kind: "number" as const, get: (p: PurchaseOrder) => p.totalValue }, tdClassName: "whitespace-nowrap" },
          { key: "pending", header: "Pending", cell: (p: PurchaseOrder) => inr(s.pendingAmount(p)), sortValue: (p: PurchaseOrder) => s.pendingAmount(p), filter: { kind: "number" as const, get: (p: PurchaseOrder) => s.pendingAmount(p) }, tdClassName: "whitespace-nowrap" },
        ]),
    { key: "created", header: "In stage since", cell: (p) => formatDate(since(p)), sortValue: (p) => since(p), filter: { kind: "date", get: (p) => since(p).slice(0, 10) }, tdClassName: "whitespace-nowrap" },
    ...(!hideDue ? [{ key: "due", header: "Due", cell: (p: PurchaseOrder) => <DueCell dueIso={dueIso(p)} />, sortValue: (p: PurchaseOrder) => dueIso(p) ?? "9999-99-99", filter: { kind: "date" as const, get: (p: PurchaseOrder) => dueIso(p) ?? "" }, tdClassName: "whitespace-nowrap" }] : []),
  ];
  // Splice in any queue-specific columns at their requested position.
  for (const ec of extraColumns ?? []) {
    const { after, ...col } = ec;
    const idx = after ? columns.findIndex((c) => c.key === after) : -1;
    if (idx >= 0) columns.splice(idx + 1, 0, col);
    else columns.push(col);
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">{title}</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">{subtitle}</p>
      </div>
      <Card className="p-4">
        <QueueTable
          rows={rows}
          rowKey={(p) => p.id}
          columns={columns}
          companyIdOf={(p) => p.companyId}
          companyNameOf={companyName}
          rowClassName={rowClassName ?? ((p) => overdueRowClass(dueIso(p)))}
          rowsLabel="POs"
          emptyMessage="POs needing your action will appear here."
          actions={(p) => (
            <div className="flex items-center justify-end gap-3">
              {renderAction(p)}
              <Link to={`/procurement/pos/${p.id}`} className="text-[12.5px] font-semibold text-orange hover:underline">Open</Link>
            </div>
          )}
        />
      </Card>
    </div>
  );
}

/** Small inline action button, styled to sit next to the Open link. */
function ActionButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="text-[12.5px] font-semibold text-navy hover:text-orange hover:underline">
      {label}
    </button>
  );
}

/* ----------------------------- Step 5: Share PO --------------------------- */
export function SharePoQueue() {
  const s = useProcurementStore();
  const [sharePo, setSharePo] = useState<PurchaseOrder | null>(null);
  return (
    <>
      <StepQueuePage
        title="Share PO Queue"
        subtitle="POs to send to the vendor — attach the PO PDF and mark shared."
        filter={(p) => poInSharePo(s.procIndex, p)}
        renderAction={(p) => <ActionButton label="Share PO" onClick={() => setSharePo(p)} />}
      />
      {sharePo && <SharePoModal po={sharePo} open onClose={() => setSharePo(null)} />}
    </>
  );
}

/* ---------------------------- Step 6: Collect PI -------------------------- */
export function CollectPiQueue() {
  const s = useProcurementStore();
  const [piPo, setPiPo] = useState<PurchaseOrder | null>(null);
  const piStatusLabel = (p: PurchaseOrder) => (piCoverage(s.procIndex, p).hasPi ? "Partial PI" : "Awaiting PI");
  return (
    <>
      <StepQueuePage
        title="Collect PI Queue"
        subtitle="Shared POs awaiting the vendor's PI(s) — partially-collected POs stay until every line has a PI."
        filter={(p) => poInCollectPi(s.procIndex, p)}
        extraColumns={[
          {
            key: "piStatus",
            header: "PI Status",
            after: "vendor",
            sortValue: (p) => piStatusLabel(p),
            filter: { kind: "select", get: (p) => piStatusLabel(p), options: ["Awaiting PI", "Partial PI"] },
            tdClassName: "whitespace-nowrap",
            cell: (p) => {
              const c = piCoverage(s.procIndex, p);
              if (!c.hasPi) return <span className={`${PILL} text-grey-2 bg-page`}>Awaiting PI</span>;
              return (
                <span className="inline-flex items-center gap-2">
                  <span className={`${PILL} text-yellow bg-[#FFF7E6]`}>Partial PI</span>
                  <span className="text-[12px] text-grey-2 normal-case tracking-normal">{c.full}/{c.total} lines</span>
                </span>
              );
            },
          },
        ]}
        renderAction={(p) => <ActionButton label="Add PI" onClick={() => setPiPo(p)} />}
      />
      {piPo && <AddPiModal po={piPo} open onClose={() => setPiPo(null)} />}
    </>
  );
}

/* ---------------------------- Step 6: Advance ------------------------------- */
export function AdvanceQueue() {
  const s = useProcurementStore();
  const [advPo, setAdvPo] = useState<PurchaseOrder | null>(null);
  return (
    <>
      <StepQueuePage
        title="Advance Queue"
        subtitle="POs whose payment terms need an advance, still awaiting their first payment."
        filter={(p) => poInAdvance(s.procIndex, p)}
        renderAction={(p) => <ActionButton label="Record Advance" onClick={() => setAdvPo(p)} />}
      />
      {advPo && <PaymentModal po={advPo} open onClose={() => setAdvPo(null)} kind="advance" />}
    </>
  );
}

/* --------------------------- Step 7: Follow-up ----------------------------- */
export function FollowUpQueue() {
  const s = useProcurementStore();
  const [followPo, setFollowPo] = useState<PurchaseOrder | null>(null);
  const dispatchDue = (p: PurchaseOrder): string | null => s.dispatchDueForPo(p.id);
  // Tint red only when the DISPATCH due (not the generic SLA) is actually past.
  const dispatchOverdue = (p: PurchaseOrder): string => {
    const due = dispatchDue(p);
    return due && due < todayIso() ? "bg-[#FDECEC]/40" : "";
  };
  return (
    <>
      <StepQueuePage
        title="Follow-up Queue"
        subtitle="POs awaiting dispatch — chase the vendor and record dispatch."
        filter={(p) => poInFollowUp(s.procIndex, p)}
        hideDue
        rowClassName={dispatchOverdue}
        extraColumns={[
          {
            key: "followups",
            header: "Follow-ups",
            tdClassName: "whitespace-nowrap",
            cell: (p) => {
              const count = s.followupsForPo(p.id).length;
              return count === 0 ? (
                <span className="text-grey-2">—</span>
              ) : (
                <span
                  className="inline-flex items-center justify-center min-w-[1.5rem] px-2 py-0.5 rounded-full bg-orange/10 text-orange text-[12px] font-semibold"
                  title={`${count} follow-up${count === 1 ? "" : "s"} recorded on this PO`}
                >
                  {count}
                </span>
              );
            },
          },
          {
            key: "dispatchDue",
            header: "Dispatch Due",
            tdClassName: "whitespace-nowrap",
            cell: (p) => {
              const due = dispatchDue(p);
              if (!due) return <span className="text-grey-2">—</span>;
              const overdue = due < todayIso();
              return <span className={overdue ? "font-semibold text-ryg-red" : ""}>{formatDate(due)}</span>;
            },
          },
        ]}
        renderAction={(p) => <ActionButton label="Follow-up" onClick={() => setFollowPo(p)} />}
      />
      <FollowupModal po={followPo} open={followPo !== null} onClose={() => setFollowPo(null)} />
    </>
  );
}

/* ---------------------------- Step 8: Inward ------------------------------- */
export function InwardQueue() {
  const s = useProcurementStore();
  const [grnPo, setGrnPo] = useState<PurchaseOrder | null>(null);
  // Goods quantities (summed across the PO's lines) — the meaningful numbers for inward.
  const qty = (p: PurchaseOrder) => poQty(s.procIndex, p);
  return (
    <>
      <StepQueuePage
        title="Inward Queue"
        subtitle="POs with goods still to be received — a partially-received PO stays here until every line lands."
        filter={(p) => poInInward(s.procIndex, p)}
        hideMoney
        extraColumns={[
          { key: "ordered", header: "Ordered", after: "vendor", cell: (p) => numFmt(qty(p).ordered), sortValue: (p) => qty(p).ordered, filter: { kind: "number", get: (p) => qty(p).ordered }, tdClassName: "whitespace-nowrap" },
          { key: "received", header: "Received", after: "ordered", cell: (p) => numFmt(qty(p).received), sortValue: (p) => qty(p).received, filter: { kind: "number", get: (p) => qty(p).received }, tdClassName: "whitespace-nowrap" },
          { key: "pending", header: "Pending", after: "received", cell: (p) => <span className="font-semibold text-navy">{numFmt(qty(p).pending)}</span>, sortValue: (p) => qty(p).pending, filter: { kind: "number", get: (p) => qty(p).pending }, tdClassName: "whitespace-nowrap" },
        ]}
        renderAction={(p) => <ActionButton label="Record GRN" onClick={() => setGrnPo(p)} />}
      />
      {grnPo && <GrnModal po={grnPo} open onClose={() => setGrnPo(null)} />}
    </>
  );
}

/* ----------------------------- Step 9: Tally ------------------------------- */
export function TallyQueue() {
  const s = useProcurementStore();
  const [tallyPo, setTallyPo] = useState<PurchaseOrder | null>(null);
  return (
    <>
      <StepQueuePage
        title="Tally Queue"
        subtitle="POs with a goods receipt — partial or full — still to be booked in Tally. One invoice per receipt."
        filter={(p) => poInTally(s.procIndex, p)}
        extraColumns={[
          // Quantities mirror the Inward queue's columns so the two screens reconcile:
          // Inward's "Received" is what Tally must book ("Qty to Book").
          {
            key: "ordered",
            header: "Ordered",
            after: "vendor",
            cell: (p) => numFmt(poQty(s.procIndex, p).ordered),
            sortValue: (p) => poQty(s.procIndex, p).ordered,
            filter: { kind: "number", get: (p) => poQty(s.procIndex, p).ordered },
            tdClassName: "whitespace-nowrap",
          },
          {
            key: "received",
            header: "Received",
            after: "ordered",
            cell: (p) => numFmt(poQty(s.procIndex, p).received),
            sortValue: (p) => poQty(s.procIndex, p).received,
            filter: { kind: "number", get: (p) => poQty(s.procIndex, p).received },
            tdClassName: "whitespace-nowrap",
          },
          {
            key: "qtyToBook",
            header: "Qty to Book",
            after: "received",
            cell: (p) => <span className="font-semibold text-navy">{numFmt(unbookedQty(s.procIndex, p.id))}</span>,
            sortValue: (p) => unbookedQty(s.procIndex, p.id),
            filter: { kind: "number", get: (p) => unbookedQty(s.procIndex, p.id) },
            tdClassName: "whitespace-nowrap",
          },
          {
            key: "unbooked",
            header: "To Book",
            after: "qtyToBook",
            tdClassName: "whitespace-nowrap",
            cell: (p) => {
              const n = s.unbookedGrnsForPo(p.id).length;
              const partial = !allReceived(s.procIndex, p);
              return (
                <span className="flex items-center gap-2">
                  <span className="font-semibold text-navy">{n} GRN{n === 1 ? "" : "s"}</span>
                  {partial && <span className={`${PILL} bg-orange/10 text-orange`}>Partial</span>}
                </span>
              );
            },
            sortValue: (p) => s.unbookedGrnsForPo(p.id).length,
          },
        ]}
        renderAction={(p) => <ActionButton label="Book in Tally" onClick={() => setTallyPo(p)} />}
      />
      {tallyPo && <TallyModal po={tallyPo} open onClose={() => setTallyPo(null)} />}
    </>
  );
}
