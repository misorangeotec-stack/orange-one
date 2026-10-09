import { Link } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import StageRowAction from "@/shared/components/ui/StageRowAction";
import StageTabs from "@/shared/components/ui/StageTabs";
import { useEntryModal } from "@/shared/lib/useEntryModal";
import { useStageMode } from "@/shared/lib/useStageMode";
import { formatDateTime } from "@/shared/lib/time";
import { useDispatchStore } from "../../store";
import {
  CANCELLED_BEFORE_DISPATCH, dmy, ROUND_RETURN_ORIGIN_LABEL, SALES_RETURN_MODE_LABEL,
} from "../../lib/format";
import SalesReturnModal from "../../components/SalesReturnModal";
import { returnLinesText } from "../../components/ReturnLines";
import type { DispatchOrder, RoundReturn, SalesReturnMode } from "../../types";

/**
 * The Sales Return queue: every sales bill somebody has to unwind in Tally.
 *
 * TWO KINDS OF WORK, ONE LIST:
 *   · a CANCELLATION — an order cancelled after its bill was raised, while the
 *     goods were still in the plant. Recording it is what cancels the order.
 *   · a RETURN AGAINST A FINISHED INVOICE — raised by hand on a delivered
 *     invoice (usually a closed order), or opened automatically when a round is
 *     recorded as Returned. Paperwork only; the order is not changed.
 * Both are normalised into `Row` below so they sort, filter and export as one
 * table — the person doing the Tally entry does the same job either way. The
 * "Type" column says which is which.
 *
 * ⚠ NOT a `StageQueue`. That component renders the chain steps off
 *   `STEP_CONFIG[stepKey]` and `store.myQueue(step)`, both keyed on `QueueStep`
 *   with no arm for this one — deliberately, because Sales Return sits beside
 *   the workflow rather than inside it (see lib/steps.ts). So the page is
 *   hand-built out of the same shared parts (StageTabs, useStageMode,
 *   useEntryModal, QueueTable, StageRowAction) so it behaves like every queue.
 *
 * ⚠ NO DUE COLUMN, AND NO OVERDUE TINT. Every other queue has an SLA an admin
 *   can tune; this one has a tax rule it cannot. Painting a row red would be the
 *   app inventing a deadline it has no way to know.
 *
 * FLAT — no `groupBy`, per the standing rule for FMS list views.
 */
interface Row {
  /** Unique across both kinds — an order id and a return id never collide, but prefix anyway. */
  id: string;
  order: DispatchOrder;
  /** Set ⇒ a return against a finished invoice; null ⇒ the cancellation kind. */
  ret: RoundReturn | null;
  type: string;
  roundNo: number | null;
  invoiceNo: string | null;
  invoiceDate: string | null;
  eway: boolean;
  requestedBy: string | null;
  requestedAt: string;
  reason: string;
  mode: SalesReturnMode | null;
  referenceNo: string | null;
  /** Completed tab: who recorded it and when. */
  actorId: string | null;
  atIso: string;
  editedAt: string | null;
  editedBy: string | null;
}

const fromCancellation = (o: DispatchOrder): Row => ({
  id: `o:${o.id}`,
  order: o,
  ret: null,
  type: CANCELLED_BEFORE_DISPATCH,
  roundNo: o.srRoundNo,
  invoiceNo: o.srInvoiceNo,
  invoiceDate: o.srInvoiceDate,
  eway: !!o.srEwayExpected,
  requestedBy: o.cancelRequestedBy,
  requestedAt: o.cancelRequestedAt ?? "",
  reason: o.cancelReason ?? "",
  mode: o.srMode,
  referenceNo: o.srReferenceNo,
  actorId: o.srBy,
  atIso: o.srAt ?? "",
  editedAt: o.srEditedAt,
  editedBy: o.srEditedBy,
});

const fromRoundReturn = (ret: RoundReturn, o: DispatchOrder): Row => ({
  id: `r:${ret.id}`,
  order: o,
  ret,
  type: ROUND_RETURN_ORIGIN_LABEL[ret.origin] + (ret.scope === "partial" ? " (part)" : ""),
  roundNo: ret.roundNo,
  invoiceNo: ret.invoiceNo,
  invoiceDate: ret.invoiceDate,
  eway: ret.ewayExpected,
  requestedBy: ret.requestedBy,
  requestedAt: ret.requestedAt,
  reason: ret.reason,
  mode: ret.srMode,
  referenceNo: ret.referenceNo,
  actorId: ret.recordedBy,
  atIso: ret.recordedAt ?? "",
  editedAt: ret.editedAt,
  editedBy: ret.editedBy,
});

export default function SalesReturnQueue() {
  const s = useDispatchStore();
  const B = "/order-to-dispatch";

  const pending: Row[] = [
    ...s.salesReturnPending.map(fromCancellation),
    ...s.roundReturnsPending.map((r) => fromRoundReturn(r.ret, r.order)),
  ];
  const completed: Row[] = [
    ...s.salesReturnCompleted.map(fromCancellation),
    ...s.roundReturnsCompleted.map((r) => fromRoundReturn(r.ret, r.order)),
  ];

  const stage = useStageMode<Row>(completed, s.userId);
  const acting = useEntryModal<{ row: Row }>();

  // Plain inline, not inline-flex (PF-20): a column dragged narrow cuts the round chip first.
  // An inline-flex box that overflows is swallowed whole by the "…".
  const orderCell = (r: Row) => (
    <>
      <Link to={`${B}/orders/${r.order.id}`} className="font-semibold text-navy hover:text-orange">
        {r.order.orderNo}
      </Link>
      {(r.roundNo ?? 0) > 1 && (
        <span className="ml-2 inline-block rounded bg-[#F1F4F9] px-1.5 py-0.5 text-[11px] font-semibold text-grey">
          R{r.roundNo}
        </span>
      )}
    </>
  );

  const orderCol: QueueColumn<Row> = {
    key: "orderNo",
    header: "Order",
    cell: orderCell,
    sortValue: (r) => r.order.orderNo,
    filter: { kind: "text", get: (r) => r.order.orderNo },
    exportValue: (r) => r.order.orderNo,
  };
  const typeCol: QueueColumn<Row> = {
    key: "type",
    header: "Type",
    cell: (r) => <span className={r.ret ? "text-navy" : "text-grey"}>{r.type}</span>,
    sortValue: (r) => r.type,
    filter: { kind: "select", get: (r) => r.type },
  };
  const customerCol: QueueColumn<Row> = {
    key: "customer",
    header: "Customer",
    cell: (r) => <span className="text-navy">{s.customerName(r.order.customerId)}</span>,
    sortValue: (r) => s.customerName(r.order.customerId),
    filter: { kind: "select", get: (r) => s.customerName(r.order.customerId) },
  };

  const pendingColumns: QueueColumn<Row>[] = [
    orderCol,
    typeCol,
    customerCol,
    {
      key: "invoiceNo",
      header: "Invoice no.",
      cell: (r) => <span className="font-semibold text-navy">{r.invoiceNo ?? "—"}</span>,
      sortValue: (r) => r.invoiceNo ?? "",
      filter: { kind: "text", get: (r) => r.invoiceNo ?? "" },
    },
    {
      key: "invoiceDate",
      header: "Invoice date",
      cell: (r) => <span className="text-grey whitespace-nowrap">{dmy(r.invoiceDate)}</span>,
      sortValue: (r) => r.invoiceDate ?? "",
      filter: { kind: "date", get: (r) => r.invoiceDate ?? "" },
      exportValue: (r) => dmy(r.invoiceDate),
    },
    {
      key: "items",
      header: "Coming back",
      // Blank on the cancellation kind: the whole bill goes, there is nothing to pick.
      cell: (r) => (
        <span className="text-grey">{r.ret ? returnLinesText(r.ret, s.itemName) || "—" : "Whole invoice"}</span>
      ),
      sortValue: (r) => (r.ret ? returnLinesText(r.ret, s.itemName) : ""),
      filter: { kind: "text", get: (r) => (r.ret ? returnLinesText(r.ret, s.itemName) : "") },
      exportValue: (r) => (r.ret ? returnLinesText(r.ret, s.itemName) : "Whole invoice"),
    },
    {
      key: "eway",
      header: "E-way",
      cell: (r) => (r.eway ? <span className="text-navy">Yes</span> : <span className="text-grey-2">—</span>),
      sortValue: (r) => (r.eway ? 0 : 1),
      filter: { kind: "select", get: (r) => (r.eway ? "Yes" : "—") },
    },
    {
      key: "company",
      header: "Company",
      cell: (r) => <span className="text-grey">{s.masterName("company", r.order.companyId)}</span>,
      sortValue: (r) => s.masterName("company", r.order.companyId),
      filter: { kind: "select", get: (r) => s.masterName("company", r.order.companyId) },
    },
    {
      key: "dispatchLocation",
      header: "Dispatch location",
      cell: (r) => <span className="text-grey">{s.masterName("company_location", r.order.locationId)}</span>,
      sortValue: (r) => s.masterName("company_location", r.order.locationId),
      filter: { kind: "select", get: (r) => s.masterName("company_location", r.order.locationId) },
    },
    {
      key: "requestedBy",
      header: "Raised by",
      cell: (r) => <span className="text-grey">{s.personName(r.requestedBy)}</span>,
      sortValue: (r) => s.personName(r.requestedBy),
      filter: { kind: "select", get: (r) => s.personName(r.requestedBy) },
    },
    {
      key: "requestedAt",
      header: "Raised on",
      cell: (r) => <span className="text-grey whitespace-nowrap">{formatDateTime(r.requestedAt)}</span>,
      sortValue: (r) => r.requestedAt,
    },
    {
      key: "reason",
      header: "Reason",
      cell: (r) => <span className="text-grey">{r.reason || "—"}</span>,
      sortValue: (r) => r.reason,
      filter: { kind: "text", get: (r) => r.reason },
    },
  ];

  const completedColumns: QueueColumn<Row>[] = [
    orderCol,
    typeCol,
    customerCol,
    {
      key: "invoiceNo",
      header: "Invoice no.",
      cell: (r) => <span className="text-grey">{r.invoiceNo ?? "—"}</span>,
      sortValue: (r) => r.invoiceNo ?? "",
      filter: { kind: "text", get: (r) => r.invoiceNo ?? "" },
    },
    {
      key: "mode",
      header: "Outcome",
      cell: (r) => <span className="text-navy">{r.mode ? SALES_RETURN_MODE_LABEL[r.mode] : "—"}</span>,
      sortValue: (r) => (r.mode ? SALES_RETURN_MODE_LABEL[r.mode] : ""),
      filter: { kind: "select", get: (r) => (r.mode ? SALES_RETURN_MODE_LABEL[r.mode] : "—") },
    },
    {
      key: "reference",
      header: "Sales return no.",
      cell: (r) => <span className="text-grey">{r.referenceNo ?? "—"}</span>,
      sortValue: (r) => r.referenceNo ?? "",
      filter: { kind: "text", get: (r) => r.referenceNo ?? "" },
    },
    {
      key: "at",
      header: "Generated",
      cell: (r) => <span className="text-grey whitespace-nowrap">{formatDateTime(r.atIso)}</span>,
      sortValue: (r) => r.atIso,
    },
    {
      key: "by",
      header: "By",
      cell: (r) => <span className="text-grey">{s.personName(r.actorId)}</span>,
      sortValue: (r) => s.personName(r.actorId),
      filter: { kind: "select", get: (r) => s.personName(r.actorId) },
    },
    {
      key: "edited",
      header: "Edited",
      cell: (r) =>
        r.editedAt ? (
          <span className="text-grey-2 whitespace-nowrap">
            {formatDateTime(r.editedAt)} · {s.personName(r.editedBy)}
          </span>
        ) : (
          <span className="text-grey-2">—</span>
        ),
      sortValue: (r) => r.editedAt ?? "",
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-navy">Generate Sales Return (Tally)</h1>
          <p className="text-[13.5px] text-grey-2 mt-1 max-w-[760px]">
            {stage.showingCompleted
              ? "Sales returns already generated in Tally. The entry stays correctable afterwards."
              : "Sales returns raised on the Sales Return page, waiting to be made in Tally. Generate the sales return in Tally, then enter its number and attach it — that closes it. Orders cancelled after billing also land here."}
          </p>
        </div>
      </div>

      <StageTabs
        mode={stage.mode}
        onMode={stage.setMode}
        pendingCount={pending.length}
        completedCount={stage.rows.length}
        scope={stage.scope}
        onScope={stage.setScope}
        scopeNote="Mine shows entries you recorded yourself."
      />

      {stage.showingCompleted ? (
        <QueueTable<Row>
          rows={stage.rows}
          rowKey={(r) => r.id}
          columns={completedColumns}
          actions={(r) => (
            <StageRowAction
              as="button"
              lockReason={null}
              canEdit={s.canEdit && s.canActOn("sales_return", r.order)}
              permissionReason="Only an owner of the Sales Return step can edit the entry."
              onEdit={() => acting.openEdit({ row: r })}
              onView={() => acting.openView({ row: r })}
            />
          )}
          loading={s.isLoading}
          rowsLabel="entries"
          emptyTitle="Nothing recorded here yet"
          emptyMessage="Sales returns you record will appear here."
          exportName="Order_To_Dispatch_Sales_Return_Completed"
        />
      ) : (
        <QueueTable<Row>
          rows={pending}
          rowKey={(r) => r.id}
          columns={pendingColumns}
          actions={(r) =>
            s.canEdit && s.canActOn("sales_return", r.order) ? (
              <Button size="sm" onClick={() => acting.openEdit({ row: r })}>
                {r.ret ? "Generate sales return" : "Record sales return"}
              </Button>
            ) : (
              <Link
                to={`${B}/orders/${r.order.id}`}
                className="text-[13px] font-semibold text-orange hover:underline"
              >
                Open
              </Link>
            )
          }
          loading={s.isLoading}
          rowsLabel="invoices"
          // Oldest first: an invoice left live in Tally is the thing that has been
          // wrong for longest, and it is the only ordering the app can honestly
          // claim to know something about.
          initialSort={{ key: "requestedAt", dir: "asc" }}
          emptyTitle="Nothing waiting here"
          emptyMessage="Sales bills that still need unwinding in Tally will appear here."
          exportName="Order_To_Dispatch_Sales_Return"
        />
      )}

      <SalesReturnModal
        order={acting.row?.row.order ?? null}
        roundReturn={acting.row?.row.ret ?? null}
        open={!!acting.row}
        onClose={acting.close}
        // A row opened from Completed is a correction; from Pending it is the entry.
        editing={!!acting.row && stage.showingCompleted && !acting.isView}
        readOnly={acting.isView}
      />
    </div>
  );
}
