import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Lock } from "lucide-react";
import Card from "@/shared/components/ui/Card";
import { formatDate, formatDateTime, todayIso } from "@/shared/lib/time";
import { useEffectiveIdentity } from "@/shared/sandbox/useEffectiveIdentity";
import StageTabs, { type StageMode, type StageScope } from "@/shared/components/ui/StageTabs";
import { useImportStore } from "../../store";
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
  grnQty,
  sinceIso,
  unbookedQty,
  type StageEntry,
} from "../../lib/queues";
import type { StepKey } from "../../lib/steps";
import DueCell, { overdueRowClass } from "@/shared/components/ui/DueCell";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import StageRowAction from "@/shared/components/ui/StageRowAction";
import { useEntryModal } from "@/shared/lib/useEntryModal";
import { SharePoModal, AddPiModal, PaymentModal, FollowupModal, GrnModal, TallyModal } from "../../components/PoModals";
import type { PurchaseOrder, Pi, Payment, Followup, Grn, TallyBooking } from "../../types";

const PILL = "inline-flex items-center text-[11px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5";

/** Goods quantities are plain counts, not money — group them the Indian way. */
const numFmt = (n: number) => n.toLocaleString("en-IN");

/**
 * Generic per-step STAGE view.
 *
 * Two tabs over the same step: the work still owed (the original queue — the
 * default, unchanged) and, optionally, the work already done here. Without a
 * `completed` config this renders exactly the queue it always did.
 */
function StepQueuePage<E>({
  title,
  subtitle,
  filter,
  renderAction,
  extraColumns,
  hideDue = false,
  hideMoney = false,
  rowClassName,
  completed,
}: {
  title: string;
  subtitle: string;
  filter: (po: PurchaseOrder) => boolean;
  renderAction: (po: PurchaseOrder) => ReactNode;
  /**
   * Optional queue-specific columns. Full QueueColumn configs (so they can carry
   * their own filter/sort). `after` places the column right after the column with
   * that key (e.g. "stage"); omitted ⇒ appended as the last column.
   */
  extraColumns?: (QueueColumn<PurchaseOrder> & { after?: string })[];
  /** Hide the generic SLA "Due" column (e.g. Follow-up, where dispatch date is the only due). */
  hideDue?: boolean;
  /** Hide the Value + Pending (₹) columns (e.g. Inward, which shows qty instead). */
  hideMoney?: boolean;
  /** Override the row tint. Defaults to the generic SLA overdue tint (created + SLA). */
  rowClassName?: (po: PurchaseOrder) => string;
  /**
   * The "what was done here" tab. Omit for a pending-only stage.
   *
   * Entries, not POs — deliberately. Collect PI / Inward / Tally are state-derived,
   * so one PO is legitimately pending AND has completed work at the same time (two
   * of three lines PI-covered, say). Listing rows keeps that honest; listing POs
   * would show the same PO in both tabs and read as a bug.
   */
  completed?: {
    entries: StageEntry<E>[];
    columns: QueueColumn<StageEntry<E>>[];
    renderAction: (entry: StageEntry<E>) => ReactNode;
    subtitle: string;
    emptyMessage: string;
  };
}) {
  const s = useImportStore();
  const { user } = useEffectiveIdentity();
  const [mode, setMode] = useState<StageMode>("pending");
  const [scope, setScope] = useState<StageScope>("mine");
  const rows = useMemo(() => s.pos.filter(filter).sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [s.pos, filter]);

  // Owner scoping lives HERE, not in lib/queues.ts: those predicates stay
  // user-agnostic so the Control Center can count everyone's work. Newest first —
  // "what did I just do" is the question this tab answers.
  const completedRows = useMemo(() => {
    const all = completed?.entries ?? [];
    const mine = scope === "mine" ? all.filter((e) => e.actorId === user.id) : all;
    return mine.slice().sort((a, b) => b.atIso.localeCompare(a.atIso));
  }, [completed?.entries, scope, user.id]);

  const vendorName = (p: PurchaseOrder) => s.vendorById(p.vendorId)?.name ?? "—";
  const companyName = (id: string) => s.companyById(id)?.name ?? "—";
  // "In stage since" and the due date come from lib/queues.ts — the same functions
  // the FMS Control Center uses, so the two can never disagree. The due date is the
  // step's admin-configured anchor + working days (Setup → Due Dates); for follow_up
  // it is the vendor's promised dispatch date, and may be null.
  const since = (p: PurchaseOrder) => sinceIso(s.importIndex, p);
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

  const showingCompleted = completed && mode === "completed";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">{title}</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">{showingCompleted ? completed.subtitle : subtitle}</p>
      </div>
      {completed && (
        <StageTabs
          mode={mode}
          onMode={setMode}
          pendingCount={rows.length}
          completedCount={completed.entries.length}
          scope={scope}
          onScope={setScope}
          scopeNote={`Showing ${user.name}'s entries`}
        />
      )}
      <Card className="p-4">
        {showingCompleted ? (
          <QueueTable
            rows={completedRows}
            rowKey={(e) => e.id}
            columns={completed.columns}
            // companyId is stamped onto the entry at build time on purpose: QueueTable
            // calls idOf from inside its sort comparator, so a lookup here would be
            // O(n·m) over a list that grows for the life of the business.
            groupBy={{ idOf: (e) => e.companyId, nameOf: companyName, allLabel: "All companies" }}
            rowsLabel="entries"
            emptyTitle="Nothing here yet"
            emptyMessage={completed.emptyMessage}
            actions={(e) => (
              <div className="flex items-center gap-3">
                {completed.renderAction(e)}
                <Link to={`/import/pos/${e.poId}`} className="text-[12.5px] font-semibold text-orange hover:underline">Open</Link>
              </div>
            )}
          />
        ) : (
          <QueueTable
            rows={rows}
            rowKey={(p) => p.id}
            columns={columns}
            groupBy={{ idOf: (p) => p.companyId, nameOf: companyName, allLabel: "All companies" }}
            rowClassName={rowClassName ?? ((p) => overdueRowClass(dueIso(p)))}
            rowsLabel="POs"
            emptyMessage="POs needing your action will appear here."
            actions={(p) => (
              <div className="flex items-center gap-3">
                {renderAction(p)}
                <Link to={`/import/pos/${p.id}`} className="text-[12.5px] font-semibold text-orange hover:underline">Open</Link>
              </div>
            )}
          />
        )}
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

const TERMS_LABEL: Record<string, string> = {
  full_advance: "Full advance",
  partial_advance: "Partial advance",
  credit: "Credit",
  on_delivery: "On delivery",
};

/**
 * The three columns every stage's Completed tab ends with: when the step was
 * done, who did it, and whether it has since been corrected.
 *
 * `formatDateTime`, not `formatDate`: these are timestamptz, and formatDate
 * slices the raw UTC string — an entry made at 02:00 IST would read as the
 * previous day, which is exactly the wrong thing to tell someone checking their
 * own work.
 */
function entryMetaColumns<T>(
  s: ReturnType<typeof useImportStore>,
  doneLabel: string,
): QueueColumn<StageEntry<T>>[] {
  return [
    {
      key: "doneAt",
      header: doneLabel,
      cell: (e) => formatDateTime(e.atIso),
      sortValue: (e) => e.atIso,
      filter: { kind: "date", get: (e) => e.atIso.slice(0, 10) },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "doneBy",
      header: "By",
      cell: (e) =>
        e.actorId ? (
          s.personName(e.actorId)
        ) : (
          // Pre-dates its actor column. Deliberately never backfilled — we don't
          // guess who did something.
          <span className="text-grey-2" title="Recorded before the app captured who did this step.">Not recorded</span>
        ),
      sortValue: (e) => s.personName(e.actorId),
      filter: { kind: "select", get: (e) => (e.actorId ? s.personName(e.actorId) : "Not recorded") },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "edited",
      header: "Edited",
      cell: (e) =>
        e.editedAtIso ? (
          <span className="text-[12px] text-grey-2" title={`Last edited by ${s.personName(e.editedById)}`}>
            {formatDateTime(e.editedAtIso)}
          </span>
        ) : (
          <span className="text-grey-2">—</span>
        ),
      sortValue: (e) => e.editedAtIso ?? "",
      tdClassName: "whitespace-nowrap",
    },
  ];
}

/** PO No. + Vendor — the first two columns of every PO-scope Completed tab. */
function poRefColumns<T>(s: ReturnType<typeof useImportStore>, vendorOf: (e: StageEntry<T>) => string): QueueColumn<StageEntry<T>>[] {
  return [
    { key: "po", header: "PO No.", cell: (e) => <span className="font-semibold text-navy">{e.ref}</span>, sortValue: (e) => e.ref, filter: { kind: "text", get: (e) => e.ref }, tdClassName: "whitespace-nowrap" },
    { key: "vendor", header: "Vendor", cell: (e) => vendorOf(e), sortValue: (e) => vendorOf(e), filter: { kind: "select", get: (e) => vendorOf(e) }, tdClassName: "whitespace-nowrap" },
  ];
}

/**
 * The Edit / View action. Two gates, both shown honestly: the entry's own lock
 * rule, then whether this user owns the step at all. Either way the server
 * re-checks and refuses — this only decides what the button looks like.
 */
function editAction<T>(
  e: StageEntry<T>,
  canEditStep: boolean,
  onEdit: () => void,
  onView: () => void,
): ReactNode {
  return (
    <StageRowAction
      lockReason={e.lockReason}
      canEdit={canEditStep}
      permissionReason="Only an owner of this step can edit the entry."
      onEdit={onEdit}
      onView={onView}
      tone="navy"
    />
  );
}

/* ----------------------------- Step 5: Share PO --------------------------- */
export function SharePoQueue() {
  const s = useImportStore();
  const [sharePo, setSharePo] = useState<PurchaseOrder | null>(null);
  const editPo = useEntryModal<PurchaseOrder>();

  // The completed side of this stage: the POs shared. The entry IS the PO — the
  // share details live on the PO row, not on a child of their own.
  const vendorOf = (e: StageEntry<PurchaseOrder>) => s.vendorById(e.row.vendorId)?.name ?? "—";
  const completedColumns: QueueColumn<StageEntry<PurchaseOrder>>[] = [
    ...poRefColumns<PurchaseOrder>(s, vendorOf),
    { key: "tallyPo", header: "Tally PO No.", cell: (e) => e.row.tallyPoNo ?? "—", sortValue: (e) => e.row.tallyPoNo ?? "", filter: { kind: "text", get: (e) => e.row.tallyPoNo ?? "" }, tdClassName: "whitespace-nowrap" },
    { key: "terms", header: "Terms", cell: (e) => (e.row.paymentTerms ? TERMS_LABEL[e.row.paymentTerms] ?? e.row.paymentTerms : "—"), sortValue: (e) => e.row.paymentTerms ?? "", filter: { kind: "select", get: (e) => (e.row.paymentTerms ? TERMS_LABEL[e.row.paymentTerms] ?? e.row.paymentTerms : "—") }, tdClassName: "whitespace-nowrap" },
    { key: "dispatch", header: "Dispatch Date", cell: (e) => formatDate(e.row.dispatchDate), sortValue: (e) => e.row.dispatchDate ?? "", filter: { kind: "date", get: (e) => e.row.dispatchDate ?? "" }, tdClassName: "whitespace-nowrap" },
    ...entryMetaColumns<PurchaseOrder>(s, "Shared On"),
  ];

  return (
    <>
      <StepQueuePage<PurchaseOrder>
        title="Share PO Stage"
        subtitle="POs to send to the vendor — attach the PO PDF and mark shared."
        filter={(p) => poInSharePo(s.importIndex, p)}
        renderAction={(p) => <ActionButton label="Share PO" onClick={() => setSharePo(p)} />}
        completed={{
          entries: s.completedShareEntries,
          columns: completedColumns,
          subtitle: "POs already shared. Details stay editable until the next step is done.",
          emptyMessage: "POs you share will appear here, and stay editable until a PI, payment, follow-up or goods receipt lands against them.",
          renderAction: (e) => editAction(e, s.canSharePo, () => editPo.openEdit(e.row), () => editPo.openView(e.row)),
        }}
      />
      {sharePo && <SharePoModal po={sharePo} open onClose={() => setSharePo(null)} />}
      {editPo.row && <SharePoModal po={editPo.row} open editing readOnly={editPo.isView} onClose={editPo.close} />}
    </>
  );
}

/* ---------------------------- Step 6: Collect PI -------------------------- */
export function CollectPiQueue() {
  const s = useImportStore();
  const [piPo, setPiPo] = useState<PurchaseOrder | null>(null);
  const editPi = useEntryModal<Pi>();
  const piStatusLabel = (p: PurchaseOrder) => (piCoverage(s.importIndex, p).hasPi ? "Partial PI" : "Awaiting PI");

  // Entries are PI ROWS, not POs — a PO with two of three lines covered is
  // legitimately still pending here AND has two completed PIs.
  const vendorOf = (e: StageEntry<Pi>) => s.vendorById(s.poById(e.poId)?.vendorId ?? null)?.name ?? "—";
  const piColumns: QueueColumn<StageEntry<Pi>>[] = [
    ...poRefColumns<Pi>(s, vendorOf),
    { key: "piNo", header: "Vendor PI No.", cell: (e) => <span className="font-semibold text-navy">{e.row.vendorPiNo}</span>, sortValue: (e) => e.row.vendorPiNo, filter: { kind: "text", get: (e) => e.row.vendorPiNo }, tdClassName: "whitespace-nowrap" },
    { key: "piValue", header: "PI Value", cell: (e) => inr(e.row.piValue), sortValue: (e) => e.row.piValue, filter: { kind: "number", get: (e) => e.row.piValue }, tdClassName: "whitespace-nowrap" },
    { key: "lines", header: "Lines", cell: (e) => numFmt(s.piItemsForPi(e.row.id).length), sortValue: (e) => s.piItemsForPi(e.row.id).length, tdClassName: "whitespace-nowrap" },
    { key: "piStatus", header: "Status", cell: (e) => <span className={`${PILL} text-grey-2 bg-page`}>{e.row.status.replace(/_/g, " ")}</span>, sortValue: (e) => e.row.status, filter: { kind: "select", get: (e) => e.row.status.replace(/_/g, " ") }, tdClassName: "whitespace-nowrap" },
    ...entryMetaColumns<Pi>(s, "Collected On"),
  ];

  return (
    <>
      <StepQueuePage<Pi>
        title="Collect PI Stage"
        subtitle="Shared POs awaiting the vendor's PI(s) — partially-collected POs stay until every line has a PI."
        filter={(p) => poInCollectPi(s.importIndex, p)}
        completed={{
          entries: s.completedPiEntries,
          columns: piColumns,
          subtitle: "PIs already collected. Each stays editable until a payment lands against it or goods arrive.",
          emptyMessage: "PIs you collect will appear here, and stay editable until a payment or a goods receipt lands.",
          renderAction: (e) => editAction(e, s.canCollectPi, () => editPi.openEdit(e.row), () => editPi.openView(e.row)),
        }}
        extraColumns={[
          {
            key: "piStatus",
            header: "PI Status",
            after: "vendor",
            sortValue: (p) => piStatusLabel(p),
            filter: { kind: "select", get: (p) => piStatusLabel(p), options: ["Awaiting PI", "Partial PI"] },
            tdClassName: "whitespace-nowrap",
            cell: (p) => {
              const c = piCoverage(s.importIndex, p);
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
      {editPi.row && <AddPiModal po={s.poById(editPi.row.poId)!} open editing={editPi.row} readOnly={editPi.isView} onClose={editPi.close} />}
    </>
  );
}

/* ---------------------------- Step 6: Payment ------------------------------- */
export function AdvanceQueue() {
  const s = useImportStore();
  const [advPo, setAdvPo] = useState<PurchaseOrder | null>(null);
  const editPay = useEntryModal<Payment>();

  // Import pays in the vendor's currency, so the foreign amount is the number
  // that matters here — the INR figure is a derived equivalent at the day's rate.
  // Both are shown: the FX amount is what was agreed, the INR is what left the bank.
  const vendorOf = (e: StageEntry<Payment>) => s.vendorById(s.poById(e.poId)?.vendorId ?? null)?.name ?? "—";
  const fxAmount = (e: StageEntry<Payment>) => `${e.row.currency ?? ""} ${(e.row.amountFx ?? 0).toLocaleString("en-IN")}`.trim();
  const payColumns: QueueColumn<StageEntry<Payment>>[] = [
    ...poRefColumns<Payment>(s, vendorOf),
    { key: "amountFx", header: "Amount", cell: (e) => <span className="font-semibold text-navy">{fxAmount(e)}</span>, sortValue: (e) => e.row.amountFx ?? 0, filter: { kind: "number", get: (e) => e.row.amountFx ?? 0 }, tdClassName: "whitespace-nowrap" },
    { key: "fxRate", header: "Rate", cell: (e) => (e.row.fxRate ? e.row.fxRate.toLocaleString("en-IN") : "—"), sortValue: (e) => e.row.fxRate ?? 0, tdClassName: "whitespace-nowrap" },
    { key: "amount", header: "INR Value", cell: (e) => inr(e.row.amount), sortValue: (e) => e.row.amount, filter: { kind: "number", get: (e) => e.row.amount }, tdClassName: "whitespace-nowrap" },
    { key: "paidOn", header: "Paid On", cell: (e) => formatDate(e.row.paidOn), sortValue: (e) => e.row.paidOn, filter: { kind: "date", get: (e) => e.row.paidOn }, tdClassName: "whitespace-nowrap" },
    { key: "utr", header: "UTR / Ref", cell: (e) => e.row.utrRef ?? "—", sortValue: (e) => e.row.utrRef ?? "", filter: { kind: "text", get: (e) => e.row.utrRef ?? "" }, tdClassName: "whitespace-nowrap" },
    ...entryMetaColumns<Payment>(s, "Recorded On"),
  ];

  return (
    <>
      <StepQueuePage<Payment>
        title="Payment Stage"
        subtitle="Import POs awaiting their 100% advance payment (accounts records the transfer)."
        filter={(p) => poInAdvance(s.importIndex, p)}
        renderAction={(p) => <ActionButton label="Record Payment" onClick={() => setAdvPo(p)} />}
        completed={{
          entries: s.completedAdvanceEntries,
          columns: payColumns,
          subtitle: "Payments already recorded. Each stays editable until a follow-up is logged against the PO.",
          emptyMessage: "Payments you record will appear here, and stay editable until a follow-up is logged.",
          renderAction: (e) => editAction(e, s.canRecordPayment, () => editPay.openEdit(e.row), () => editPay.openView(e.row)),
        }}
      />
      {advPo && <PaymentModal po={advPo} open onClose={() => setAdvPo(null)} kind="advance" />}
      {editPay.row && <PaymentModal po={s.poById(editPay.row.poId)!} open editing={editPay.row} readOnly={editPay.isView} onClose={editPay.close} kind={editPay.row.kind} />}
    </>
  );
}

/* --------------------------- Step 7: Follow-up ----------------------------- */
export function FollowUpQueue() {
  const s = useImportStore();
  const [followPo, setFollowPo] = useState<PurchaseOrder | null>(null);
  const editFollowup = useEntryModal<Followup>();
  const dispatchDue = (p: PurchaseOrder): string | null => s.dispatchDueForPo(p.id);

  // ANY follow-up is editable until goods arrive — not merely "the latest".
  // There is no reliable ordering to single one out: created_at is now() (two
  // rows written in one transaction share it) and the id is a random uuid.
  const vendorOf = (e: StageEntry<Followup>) => s.vendorById(s.poById(e.poId)?.vendorId ?? null)?.name ?? "—";
  const fupColumns: QueueColumn<StageEntry<Followup>>[] = [
    ...poRefColumns<Followup>(s, vendorOf),
    { key: "status", header: "Dispatch", cell: (e) => <span className={`${PILL} ${e.row.dispatchStatus === "dispatched" ? "text-ryg-green bg-[#EAF7EE]" : e.row.dispatchStatus === "delayed" ? "text-ryg-red bg-[#FDECEC]" : "text-grey-2 bg-page"}`}>{e.row.dispatchStatus}</span>, sortValue: (e) => e.row.dispatchStatus, filter: { kind: "select", get: (e) => e.row.dispatchStatus }, tdClassName: "whitespace-nowrap" },
    { key: "actual", header: "Actual Dispatch", cell: (e) => formatDate(e.row.actualDispatchDate), sortValue: (e) => e.row.actualDispatchDate ?? "", filter: { kind: "date", get: (e) => e.row.actualDispatchDate ?? "" }, tdClassName: "whitespace-nowrap" },
    { key: "revised", header: "Revised Dispatch", cell: (e) => formatDate(e.row.revisedDispatchDate), sortValue: (e) => e.row.revisedDispatchDate ?? "", filter: { kind: "date", get: (e) => e.row.revisedDispatchDate ?? "" }, tdClassName: "whitespace-nowrap" },
    { key: "lr", header: "LR No.", cell: (e) => e.row.lrNo ?? "—", sortValue: (e) => e.row.lrNo ?? "", filter: { kind: "text", get: (e) => e.row.lrNo ?? "" }, tdClassName: "whitespace-nowrap" },
    ...entryMetaColumns<Followup>(s, "Logged On"),
  ];
  // Tint red only when the DISPATCH due (not the generic SLA) is actually past.
  const dispatchOverdue = (p: PurchaseOrder): string => {
    const due = dispatchDue(p);
    return due && due < todayIso() ? "bg-[#FDECEC]/40" : "";
  };
  return (
    <>
      <StepQueuePage<Followup>
        title="Follow-up Stage"
        subtitle="POs awaiting dispatch — chase the vendor and record dispatch."
        filter={(p) => poInFollowUp(s.importIndex, p)}
        hideDue
        rowClassName={dispatchOverdue}
        completed={{
          entries: s.completedFollowupEntries,
          columns: fupColumns,
          subtitle: "Follow-ups already logged. Each stays editable until goods are received against the PO.",
          emptyMessage: "Follow-ups you log will appear here, and stay editable until goods arrive.",
          renderAction: (e) => editAction(e, s.canFollowup, () => editFollowup.openEdit(e.row), () => editFollowup.openView(e.row)),
        }}
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
      {editFollowup.row && (
        <FollowupModal
          po={s.poById(editFollowup.row.poId) ?? null}
          open
          editing={editFollowup.row}
          readOnly={editFollowup.isView}
          onClose={editFollowup.close}
        />
      )}
    </>
  );
}

/* ---------------------------- Step 8: Inward ------------------------------- */
export function InwardQueue() {
  const s = useImportStore();
  const [grnPo, setGrnPo] = useState<PurchaseOrder | null>(null);
  const editGrn = useEntryModal<Grn>();
  // Goods quantities (summed across the PO's lines) — the meaningful numbers for inward.
  const qty = (p: PurchaseOrder) => poQty(s.importIndex, p);

  const vendorOf = (e: StageEntry<Grn>) => s.vendorById(s.poById(e.poId)?.vendorId ?? null)?.name ?? "—";
  const grnQtyOf = (e: StageEntry<Grn>) => grnQty(s.importIndex, e.row.id);
  const grnColumns: QueueColumn<StageEntry<Grn>>[] = [
    ...poRefColumns<Grn>(s, vendorOf),
    { key: "poRef", header: "PO Ref", cell: (e) => e.row.poRef ?? "—", sortValue: (e) => e.row.poRef ?? "", filter: { kind: "text", get: (e) => e.row.poRef ?? "" }, tdClassName: "whitespace-nowrap" },
    { key: "gate", header: "Gate Reg No.", cell: (e) => e.row.gateRegisterNo ?? "—", sortValue: (e) => e.row.gateRegisterNo ?? "", filter: { kind: "text", get: (e) => e.row.gateRegisterNo ?? "" }, tdClassName: "whitespace-nowrap" },
    { key: "qty", header: "Qty Received", cell: (e) => <span className="font-semibold text-navy">{numFmt(grnQtyOf(e))}</span>, sortValue: (e) => grnQtyOf(e), filter: { kind: "number", get: (e) => grnQtyOf(e) }, tdClassName: "whitespace-nowrap" },
    { key: "condition", header: "Condition", cell: (e) => <span className={`${PILL} ${e.row.condition === "good" ? "text-ryg-green bg-[#EAF7EE]" : "text-ryg-red bg-[#FDECEC]"}`}>{e.row.condition.replace(/_/g, " ")}</span>, sortValue: (e) => e.row.condition, filter: { kind: "select", get: (e) => e.row.condition.replace(/_/g, " ") }, tdClassName: "whitespace-nowrap" },
    ...entryMetaColumns<Grn>(s, "Received On"),
  ];
  // Inward has no SLA due of its own (poDueIso returns null for `inward`), so the
  // generic Due column is hidden and the dispatch date the vendor promised at
  // follow-up is carried forward here instead — the same value the Follow-up queue
  // shows, so the two screens agree on when the goods were owed.
  const dispatchDue = (p: PurchaseOrder): string | null => s.dispatchDueForPo(p.id);
  return (
    <>
      <StepQueuePage<Grn>
        title="Inward Stage"
        subtitle="POs with goods still to be received — a partially-received PO stays here until every line lands."
        filter={(p) => poInInward(s.importIndex, p)}
        hideMoney
        hideDue
        completed={{
          entries: s.completedGrnEntries,
          columns: grnColumns,
          subtitle: "Goods receipts already recorded. Each stays editable until it is booked in Tally.",
          emptyMessage: "Receipts you record will appear here, and stay editable until they are booked in Tally.",
          renderAction: (e) => editAction(e, s.canInward, () => editGrn.openEdit(e.row), () => editGrn.openView(e.row)),
        }}
        extraColumns={[
          { key: "ordered", header: "Ordered", after: "vendor", cell: (p) => numFmt(qty(p).ordered), sortValue: (p) => qty(p).ordered, filter: { kind: "number", get: (p) => qty(p).ordered }, tdClassName: "whitespace-nowrap" },
          { key: "received", header: "Received", after: "ordered", cell: (p) => numFmt(qty(p).received), sortValue: (p) => qty(p).received, filter: { kind: "number", get: (p) => qty(p).received }, tdClassName: "whitespace-nowrap" },
          { key: "pending", header: "Pending", after: "received", cell: (p) => <span className="font-semibold text-navy">{numFmt(qty(p).pending)}</span>, sortValue: (p) => qty(p).pending, filter: { kind: "number", get: (p) => qty(p).pending }, tdClassName: "whitespace-nowrap" },
          {
            key: "dispatchDue",
            header: "Dispatch Due",
            after: "created",
            tdClassName: "whitespace-nowrap",
            sortValue: (p) => dispatchDue(p) ?? "9999-99-99",
            filter: { kind: "date", get: (p) => dispatchDue(p) ?? "" },
            cell: (p) => {
              const due = dispatchDue(p);
              if (!due) return <span className="text-grey-2">—</span>;
              const overdue = due < todayIso();
              return <span className={overdue ? "font-semibold text-ryg-red" : ""}>{formatDate(due)}</span>;
            },
          },
        ]}
        renderAction={(p) => <ActionButton label="Record GRN" onClick={() => setGrnPo(p)} />}
      />
      {grnPo && <GrnModal po={grnPo} open onClose={() => setGrnPo(null)} />}
      {editGrn.row && <GrnModal po={s.poById(editGrn.row.poId)!} open editing={editGrn.row} readOnly={editGrn.isView} onClose={editGrn.close} />}
    </>
  );
}

/* ----------------------------- Step 9: Tally ------------------------------- */
export function TallyQueue() {
  const s = useImportStore();
  const [tallyPo, setTallyPo] = useState<PurchaseOrder | null>(null);
  const editBooking = useEntryModal<TallyBooking>();

  const vendorOf = (e: StageEntry<TallyBooking>) => s.vendorById(s.poById(e.poId)?.vendorId ?? null)?.name ?? "—";
  const tallyColumns: QueueColumn<StageEntry<TallyBooking>>[] = [
    ...poRefColumns<TallyBooking>(s, vendorOf),
    { key: "invoice", header: "Tally Invoice No.", cell: (e) => <span className="font-semibold text-navy">{e.row.tallyPiNo}</span>, sortValue: (e) => e.row.tallyPiNo, filter: { kind: "text", get: (e) => e.row.tallyPiNo }, tdClassName: "whitespace-nowrap" },
    { key: "remarks", header: "Remarks", cell: (e) => e.row.remarks ?? "—", sortValue: (e) => e.row.remarks ?? "", filter: { kind: "text", get: (e) => e.row.remarks ?? "" } },
    ...entryMetaColumns<TallyBooking>(s, "Booked On"),
  ];

  return (
    <>
      <StepQueuePage<TallyBooking>
        title="Tally Stage"
        subtitle="POs with a goods receipt — partial or full — still to be booked in Tally. One invoice per receipt."
        filter={(p) => poInTally(s.importIndex, p)}
        completed={{
          entries: s.completedTallyEntries,
          columns: tallyColumns,
          // Which receipt an invoice belongs to is not a typo, so it is not editable
          // here — the invoice number, document and remarks are.
          subtitle: "Invoices already booked. The invoice number, document and remarks stay editable until the PO closes.",
          emptyMessage: "Invoices you book will appear here. Note a booking that closes the PO is final immediately — the PO is then locked.",
          renderAction: (e) => editAction(e, s.canTally, () => editBooking.openEdit(e.row), () => editBooking.openView(e.row)),
        }}
        extraColumns={[
          // Quantities mirror the Inward queue's columns so the two screens reconcile:
          // Inward's "Received" is what Tally must book ("Qty to Book").
          {
            key: "ordered",
            header: "Ordered",
            after: "vendor",
            cell: (p) => numFmt(poQty(s.importIndex, p).ordered),
            sortValue: (p) => poQty(s.importIndex, p).ordered,
            filter: { kind: "number", get: (p) => poQty(s.importIndex, p).ordered },
            tdClassName: "whitespace-nowrap",
          },
          {
            key: "received",
            header: "Received",
            after: "ordered",
            cell: (p) => numFmt(poQty(s.importIndex, p).received),
            sortValue: (p) => poQty(s.importIndex, p).received,
            filter: { kind: "number", get: (p) => poQty(s.importIndex, p).received },
            tdClassName: "whitespace-nowrap",
          },
          {
            key: "qtyToBook",
            header: "Qty to Book",
            after: "received",
            cell: (p) => <span className="font-semibold text-navy">{numFmt(unbookedQty(s.importIndex, p.id))}</span>,
            sortValue: (p) => unbookedQty(s.importIndex, p.id),
            filter: { kind: "number", get: (p) => unbookedQty(s.importIndex, p.id) },
            tdClassName: "whitespace-nowrap",
          },
          {
            key: "unbooked",
            header: "To Book",
            after: "qtyToBook",
            tdClassName: "whitespace-nowrap",
            cell: (p) => {
              const n = s.unbookedGrnsForPo(p.id).length;
              const partial = !allReceived(s.importIndex, p);
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
      {editBooking.row && <TallyModal po={s.poById(editBooking.row.poId)!} open editing={editBooking.row} readOnly={editBooking.isView} onClose={editBooking.close} />}
    </>
  );
}
