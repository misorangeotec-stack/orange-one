import { Link } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import StageRowAction from "@/shared/components/ui/StageRowAction";
import StageTabs from "@/shared/components/ui/StageTabs";
import { useEntryModal } from "@/shared/lib/useEntryModal";
import { useStageMode } from "@/shared/lib/useStageMode";
import { formatDateTime } from "@/shared/lib/time";
import { useDispatchStore } from "../../store";
import { dmy, SALES_RETURN_MODE_LABEL } from "../../lib/format";
import SalesReturnModal from "../../components/SalesReturnModal";
import type { DispatchOrder } from "../../types";

/**
 * The Sales Return queue: orders cancelled AFTER their sales bill was raised,
 * waiting for somebody to unwind the invoice in Tally.
 *
 * ⚠ NOT a `StageQueue`. That component renders the five chain steps off
 *   `STEP_CONFIG[stepKey]` and `store.myQueue(step)`, both of which are keyed on
 *   `QueueStep` and have no arm for this one — deliberately, because Sales
 *   Return sits beside the six-step workflow rather than inside it (see
 *   lib/steps.ts). So the page is hand-built, but out of the same shared parts
 *   (StageTabs, useStageMode, useEntryModal, QueueTable, StageRowAction) so it
 *   reads and behaves like every other queue.
 *
 * ⚠ NO DUE COLUMN, AND NO OVERDUE TINT. Every other queue has an SLA an admin
 *   can tune; this one has a tax rule it cannot. Painting a row red would be the
 *   app inventing a deadline it has no way to know.
 *
 * FLAT — no `groupBy`, per the standing rule for FMS list views.
 */
interface DoneRow {
  id: string;
  order: DispatchOrder;
  actorId: string | null;
  atIso: string;
}

export default function SalesReturnQueue() {
  const s = useDispatchStore();
  const B = "/order-to-dispatch";

  const pending = s.salesReturnPending;
  const completed: DoneRow[] = s.salesReturnCompleted.map((o) => ({
    id: o.id,
    order: o,
    actorId: o.srBy,
    atIso: o.srAt ?? "",
  }));

  const stage = useStageMode<DoneRow>(completed, s.userId);
  const acting = useEntryModal<{ order: DispatchOrder }>();

  const orderCell = (o: DispatchOrder) => (
    <span className="inline-flex items-center gap-2">
      <Link to={`${B}/orders/${o.id}`} className="font-semibold text-navy hover:text-orange">
        {o.orderNo}
      </Link>
      {(o.srRoundNo ?? 0) > 1 && (
        <span className="rounded bg-[#F1F4F9] px-1.5 py-0.5 text-[11px] font-semibold text-grey">
          R{o.srRoundNo}
        </span>
      )}
    </span>
  );

  const pendingColumns: QueueColumn<DispatchOrder>[] = [
    {
      key: "orderNo",
      header: "Order",
      cell: orderCell,
      sortValue: (o) => o.orderNo,
      filter: { kind: "text", get: (o) => o.orderNo },
      exportValue: (o) => o.orderNo,
    },
    {
      key: "customer",
      header: "Customer",
      cell: (o) => <span className="text-navy">{s.customerName(o.customerId)}</span>,
      sortValue: (o) => s.customerName(o.customerId),
      filter: { kind: "select", get: (o) => s.customerName(o.customerId) },
    },
    {
      key: "invoiceNo",
      header: "Invoice no.",
      cell: (o) => <span className="font-semibold text-navy">{o.srInvoiceNo ?? "—"}</span>,
      sortValue: (o) => o.srInvoiceNo ?? "",
      filter: { kind: "text", get: (o) => o.srInvoiceNo ?? "" },
    },
    {
      key: "invoiceDate",
      header: "Invoice date",
      cell: (o) => <span className="text-grey whitespace-nowrap">{dmy(o.srInvoiceDate)}</span>,
      sortValue: (o) => o.srInvoiceDate ?? "",
      filter: { kind: "date", get: (o) => o.srInvoiceDate ?? "" },
      exportValue: (o) => dmy(o.srInvoiceDate),
    },
    {
      key: "eway",
      header: "E-way",
      cell: (o) =>
        o.srEwayExpected ? (
          <span className="text-navy">Yes</span>
        ) : (
          <span className="text-grey-2">—</span>
        ),
      sortValue: (o) => (o.srEwayExpected ? 0 : 1),
      filter: { kind: "select", get: (o) => (o.srEwayExpected ? "Yes" : "—") },
    },
    {
      key: "company",
      header: "Company",
      cell: (o) => <span className="text-grey">{s.masterName("company", o.companyId)}</span>,
      sortValue: (o) => s.masterName("company", o.companyId),
      filter: { kind: "select", get: (o) => s.masterName("company", o.companyId) },
    },
    {
      key: "dispatchLocation",
      header: "Dispatch location",
      cell: (o) => <span className="text-grey">{s.masterName("company_location", o.locationId)}</span>,
      sortValue: (o) => s.masterName("company_location", o.locationId),
      filter: { kind: "select", get: (o) => s.masterName("company_location", o.locationId) },
    },
    {
      key: "requestedBy",
      header: "Cancelled by",
      cell: (o) => <span className="text-grey">{s.personName(o.cancelRequestedBy)}</span>,
      sortValue: (o) => s.personName(o.cancelRequestedBy),
      filter: { kind: "select", get: (o) => s.personName(o.cancelRequestedBy) },
    },
    {
      key: "requestedAt",
      header: "Cancelled on",
      cell: (o) => (
        <span className="text-grey whitespace-nowrap">{formatDateTime(o.cancelRequestedAt)}</span>
      ),
      sortValue: (o) => o.cancelRequestedAt ?? "",
    },
    {
      key: "reason",
      header: "Reason",
      cell: (o) => <span className="text-grey">{o.cancelReason ?? "—"}</span>,
      sortValue: (o) => o.cancelReason ?? "",
      filter: { kind: "text", get: (o) => o.cancelReason ?? "" },
    },
  ];

  const completedColumns: QueueColumn<DoneRow>[] = [
    {
      key: "orderNo",
      header: "Order",
      cell: (r) => orderCell(r.order),
      sortValue: (r) => r.order.orderNo,
      filter: { kind: "text", get: (r) => r.order.orderNo },
    },
    {
      key: "customer",
      header: "Customer",
      cell: (r) => <span className="text-navy">{s.customerName(r.order.customerId)}</span>,
      sortValue: (r) => s.customerName(r.order.customerId),
      filter: { kind: "select", get: (r) => s.customerName(r.order.customerId) },
    },
    {
      key: "invoiceNo",
      header: "Invoice no.",
      cell: (r) => <span className="text-grey">{r.order.srInvoiceNo ?? "—"}</span>,
      sortValue: (r) => r.order.srInvoiceNo ?? "",
      filter: { kind: "text", get: (r) => r.order.srInvoiceNo ?? "" },
    },
    {
      key: "mode",
      header: "Outcome",
      cell: (r) => (
        <span className="text-navy">
          {r.order.srMode ? SALES_RETURN_MODE_LABEL[r.order.srMode] : "—"}
        </span>
      ),
      sortValue: (r) => (r.order.srMode ? SALES_RETURN_MODE_LABEL[r.order.srMode] : ""),
      filter: {
        kind: "select",
        get: (r) => (r.order.srMode ? SALES_RETURN_MODE_LABEL[r.order.srMode] : "—"),
      },
    },
    {
      key: "reference",
      header: "Reference",
      cell: (r) => <span className="text-grey">{r.order.srReferenceNo ?? "—"}</span>,
      sortValue: (r) => r.order.srReferenceNo ?? "",
      filter: { kind: "text", get: (r) => r.order.srReferenceNo ?? "" },
    },
    {
      key: "at",
      header: "Recorded",
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
        r.order.srEditedAt ? (
          <span className="text-grey-2 whitespace-nowrap">
            {formatDateTime(r.order.srEditedAt)} · {s.personName(r.order.srEditedBy)}
          </span>
        ) : (
          <span className="text-grey-2">—</span>
        ),
      sortValue: (r) => r.order.srEditedAt ?? "",
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Sales Return</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          {stage.showingCompleted
            ? "Invoices you have already unwound. The entry stays correctable afterwards."
            : "Orders cancelled after their sales bill was raised. Cancel the bill in Tally, or punch a sales return against it, then record which you did — that is what finally cancels the order."}
        </p>
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
        <QueueTable<DoneRow>
          rows={stage.rows}
          rowKey={(r) => r.id}
          columns={completedColumns}
          actions={(r) => (
            <StageRowAction
              as="button"
              lockReason={null}
              canEdit={s.canActOn("sales_return", r.order)}
              permissionReason="Only an owner of the Sales Return step can edit the entry."
              onEdit={() => acting.openEdit({ order: r.order })}
              onView={() => acting.openView({ order: r.order })}
            />
          )}
          rowsLabel="entries"
          emptyTitle="Nothing recorded here yet"
          emptyMessage="Sales returns you record will appear here."
          exportName="Order_To_Dispatch_Sales_Return_Completed"
        />
      ) : (
        <QueueTable<DispatchOrder>
          rows={pending}
          rowKey={(o) => o.id}
          columns={pendingColumns}
          actions={(o) =>
            s.canActOn("sales_return", o) ? (
              <Button size="sm" onClick={() => acting.openEdit({ order: o })}>
                Record sales return
              </Button>
            ) : (
              <Link
                to={`${B}/orders/${o.id}`}
                className="text-[13px] font-semibold text-orange hover:underline"
              >
                Open
              </Link>
            )
          }
          rowsLabel="orders"
          // Oldest cancellation first: an invoice left live in Tally is the thing
          // that has been wrong for longest, and it is the only ordering the app
          // can honestly claim to know something about.
          initialSort={{ key: "requestedAt", dir: "asc" }}
          emptyTitle="Nothing waiting here"
          emptyMessage="Cancelled orders whose sales bill still needs unwinding will appear here."
          exportName="Order_To_Dispatch_Sales_Return"
        />
      )}

      <SalesReturnModal
        order={acting.row?.order ?? null}
        open={!!acting.row}
        onClose={acting.close}
        // A row opened from Completed is a correction; from Pending it is the entry.
        editing={!!acting.row && stage.showingCompleted && !acting.isView}
        readOnly={acting.isView}
      />
    </div>
  );
}
