import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import { formatDate, todayIso } from "@/shared/lib/time";
import { useProcurementStore } from "../../store";
import { inr } from "../../lib/format";
import { dueInfo } from "../../lib/sla";
import DueCell, { overdueRowClass } from "../../components/DueCell";
import QueueTable, { type QueueColumn } from "../../components/QueueTable";
import { SharePoModal, AddPiModal, PaymentModal, FollowupModal, GrnModal, TallyModal } from "../../components/PoModals";
import type { PurchaseOrder, Pi } from "../../types";

const isOpen = (p: PurchaseOrder) => p.currentStage !== "closed" && p.currentStage !== "cancelled";

const PILL = "inline-flex items-center text-[11px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5";

/** All PO lines fully received (and there is at least one line). */
function allReceived(s: ReturnType<typeof useProcurementStore>, po: PurchaseOrder): boolean {
  const items = s.poItemsForPo(po.id);
  return items.length > 0 && items.every((it) => it.receivedQty >= it.qty);
}

/**
 * How much of a PO's lines are covered by collected PI(s). A PO line is "covered"
 * once the PI-item qty booked against it reaches the ordered qty. Used to keep a
 * PO in the Collect-PI queue until EVERY line has a PI (partial collection stays).
 */
function piCoverage(s: ReturnType<typeof useProcurementStore>, po: PurchaseOrder) {
  const items = s.poItemsForPo(po.id);
  const covered = new Map<string, number>();
  for (const pi of s.pisForPo(po.id))
    for (const pii of s.piItemsForPi(pi.id))
      covered.set(pii.poItemId, (covered.get(pii.poItemId) ?? 0) + pii.qty);
  let full = 0;
  for (const it of items) if ((covered.get(it.id) ?? 0) >= it.qty) full++;
  return { total: items.length, full, hasPi: s.pisForPo(po.id).length > 0 };
}

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
  // When the PO entered its CURRENT stage — the latest activity on the PO (or its
  // PIs); falls back to PO creation for entries with no activity yet. This is what
  // the queue "since" + SLA due should key off, not the original PO creation date.
  const sinceIso = (p: PurchaseOrder): string => {
    const piIds = new Set(s.pisForPo(p.id).map((x) => x.id));
    let latest = p.createdAt;
    for (const a of s.activity)
      if (((a.entityType === "po" && a.entityId === p.id) || (a.entityType === "pi" && piIds.has(a.entityId))) && a.createdAt > latest)
        latest = a.createdAt;
    return latest;
  };
  // Local yyyy-mm-dd of the due date (matches the displayed Due date; avoids UTC drift).
  const dueIso = (p: PurchaseOrder) => {
    const d = dueInfo(sinceIso(p), p.currentStage).due;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  const columns: QueueColumn<PurchaseOrder>[] = [
    { key: "po", header: "PO No.", cell: (p) => <span className="font-semibold text-navy">{p.poNo}</span>, sortValue: (p) => p.poNo, filter: { kind: "text", get: (p) => p.poNo }, tdClassName: "whitespace-nowrap" },
    { key: "vendor", header: "Vendor", cell: (p) => vendorName(p), sortValue: (p) => vendorName(p), filter: { kind: "select", get: (p) => vendorName(p) }, tdClassName: "whitespace-nowrap" },
    ...(hideMoney
      ? []
      : [
          { key: "value", header: "Value", cell: (p: PurchaseOrder) => inr(p.totalValue), sortValue: (p: PurchaseOrder) => p.totalValue, filter: { kind: "number" as const, get: (p: PurchaseOrder) => p.totalValue }, tdClassName: "whitespace-nowrap" },
          { key: "pending", header: "Pending", cell: (p: PurchaseOrder) => inr(s.pendingAmount(p)), sortValue: (p: PurchaseOrder) => s.pendingAmount(p), filter: { kind: "number" as const, get: (p: PurchaseOrder) => s.pendingAmount(p) }, tdClassName: "whitespace-nowrap" },
        ]),
    { key: "created", header: "In stage since", cell: (p) => formatDate(sinceIso(p)), sortValue: (p) => sinceIso(p), filter: { kind: "date", get: (p) => sinceIso(p).slice(0, 10) }, tdClassName: "whitespace-nowrap" },
    ...(!hideDue ? [{ key: "due", header: "Due", cell: (p: PurchaseOrder) => <DueCell createdAt={sinceIso(p)} step={p.currentStage} />, sortValue: (p: PurchaseOrder) => dueIso(p), filter: { kind: "date" as const, get: (p: PurchaseOrder) => dueIso(p) }, tdClassName: "whitespace-nowrap" }] : []),
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
          rowClassName={rowClassName ?? ((p) => overdueRowClass(sinceIso(p), p.currentStage))}
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
  const [sharePo, setSharePo] = useState<PurchaseOrder | null>(null);
  return (
    <>
      <StepQueuePage
        title="Share PO Queue"
        subtitle="POs to send to the vendor — attach the PO PDF and mark shared."
        filter={(p) => isOpen(p) && p.currentStage === "share_po"}
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
  // Keep a PO here until EVERY line has a PI — partial collection stays, so the
  // remaining lines can still get their PI.
  const needsPi = (p: PurchaseOrder) => {
    const c = piCoverage(s, p);
    return c.total > 0 && c.full < c.total;
  };
  const piStatusLabel = (p: PurchaseOrder) => (piCoverage(s, p).hasPi ? "Partial PI" : "Awaiting PI");
  return (
    <>
      <StepQueuePage
        title="Collect PI Queue"
        subtitle="Shared POs awaiting the vendor's PI(s) — partially-collected POs stay until every line has a PI."
        filter={(p) => isOpen(p) && p.currentStage !== "share_po" && needsPi(p)}
        extraColumns={[
          {
            key: "piStatus",
            header: "PI Status",
            after: "vendor",
            sortValue: (p) => piStatusLabel(p),
            filter: { kind: "select", get: (p) => piStatusLabel(p), options: ["Awaiting PI", "Partial PI"] },
            tdClassName: "whitespace-nowrap",
            cell: (p) => {
              const c = piCoverage(s, p);
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
  const [advPi, setAdvPi] = useState<Pi | null>(null);
  // First PI on the PO that carries advance terms, still has a balance, and has no advance yet.
  // Default PI to advance against: advance terms, still has a balance, and NOTHING
  // paid against it yet (any payment — advance or installment — counts as done).
  const advancePi = (po: PurchaseOrder): Pi | undefined =>
    s.pisForPo(po.id).find(
      (pi) =>
        (pi.paymentTerms === "full_advance" || pi.paymentTerms === "partial_advance") &&
        s.pendingForPi(pi) > 0 &&
        s.paymentsForPi(pi.id).length === 0,
    );
  return (
    <>
      <StepQueuePage
        title="Advance Queue"
        subtitle="POs still awaiting their first payment against an advance-terms PI."
        filter={(p) => isOpen(p) && p.currentStage === "advance_payment"}
        renderAction={(p) => {
          const pi = advancePi(p);
          return pi ? <ActionButton label="Record Advance" onClick={() => setAdvPi(pi)} /> : null;
        }}
      />
      {advPi && <PaymentModal po={s.poById(advPi.poId)!} pi={advPi} open onClose={() => setAdvPi(null)} kind="advance" />}
    </>
  );
}

/* --------------------------- Step 7: Follow-up ----------------------------- */
export function FollowUpQueue() {
  const s = useProcurementStore();
  const [followPi, setFollowPi] = useState<Pi | null>(null);
  const pendingPi = (po: PurchaseOrder): Pi | undefined =>
    s.pisForPo(po.id).find((pi) => pi.status !== "received" && pi.dispatchStatus !== "dispatched");
  // Tint red only when the DISPATCH due (not the generic SLA) is actually past.
  const dispatchOverdue = (p: PurchaseOrder): string => {
    const pi = pendingPi(p);
    const due = pi?.revisedDispatchDate ?? pi?.dispatchDate ?? null;
    return due && due < todayIso() ? "bg-[#FDECEC]/40" : "";
  };
  return (
    <>
      <StepQueuePage
        title="Follow-up Queue"
        subtitle="POs with PI(s) awaiting dispatch — chase the vendor and record dispatch."
        filter={(p) => isOpen(p) && p.currentStage === "follow_up"}
        hideDue
        rowClassName={dispatchOverdue}
        extraColumns={[
          {
            key: "followups",
            header: "Follow-ups",
            tdClassName: "whitespace-nowrap",
            cell: (p) => {
              const pi = pendingPi(p);
              const count = pi ? s.followupsForPi(pi.id).length : 0;
              return count === 0 ? (
                <span className="text-grey-2">—</span>
              ) : (
                <span
                  className="inline-flex items-center justify-center min-w-[1.5rem] px-2 py-0.5 rounded-full bg-orange/10 text-orange text-[12px] font-semibold"
                  title={`${count} follow-up${count === 1 ? "" : "s"} recorded on this PI`}
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
              const pi = pendingPi(p);
              const due = pi?.revisedDispatchDate ?? pi?.dispatchDate ?? null;
              if (!due) return <span className="text-grey-2">—</span>;
              const overdue = due < todayIso();
              return <span className={overdue ? "font-semibold text-ryg-red" : ""}>{formatDate(due)}</span>;
            },
          },
        ]}
        renderAction={(p) => {
          const pi = pendingPi(p);
          return pi ? <ActionButton label="Follow-up" onClick={() => setFollowPi(pi)} /> : null;
        }}
      />
      <FollowupModal pi={followPi} open={followPi !== null} onClose={() => setFollowPi(null)} />
    </>
  );
}

/* ---------------------------- Step 8: Inward ------------------------------- */
export function InwardQueue() {
  const s = useProcurementStore();
  const [grnPo, setGrnPo] = useState<PurchaseOrder | null>(null);
  // Goods quantities (summed across the PO's lines) — the meaningful numbers for inward.
  const qty = (p: PurchaseOrder) => {
    const its = s.poItemsForPo(p.id);
    const ordered = its.reduce((a, it) => a + it.qty, 0);
    const received = its.reduce((a, it) => a + it.receivedQty, 0);
    return { ordered, received, pending: Math.max(0, ordered - received) };
  };
  const numFmt = (n: number) => n.toLocaleString("en-IN");
  return (
    <>
      <StepQueuePage
        title="Inward Queue"
        subtitle="POs with dispatched goods still to be received (GRN)."
        filter={(p) => isOpen(p) && p.currentStage === "inward"}
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
        subtitle="Fully-received POs to book in Tally."
        filter={(p) => isOpen(p) && allReceived(s, p) && s.tallyForPo(p.id).length === 0}
        renderAction={(p) => <ActionButton label="Book in Tally" onClick={() => setTallyPo(p)} />}
      />
      {tallyPo && <TallyModal po={tallyPo} open onClose={() => setTallyPo(null)} />}
    </>
  );
}

/* -------------------------- Step 10: Final Pay ----------------------------- */
export function FinalPaymentQueue() {
  const s = useProcurementStore();
  const [payPo, setPayPo] = useState<PurchaseOrder | null>(null);
  return (
    <>
      <StepQueuePage
        title="Final Pay Queue"
        subtitle="Received + Tally-booked POs with a balance to settle."
        filter={(p) => isOpen(p) && allReceived(s, p) && s.tallyForPo(p.id).length > 0 && s.pendingAmount(p) > 0}
        renderAction={(p) => <ActionButton label="Record Payment" onClick={() => setPayPo(p)} />}
      />
      {payPo && <PaymentModal po={payPo} open onClose={() => setPayPo(null)} kind="installment" />}
    </>
  );
}
