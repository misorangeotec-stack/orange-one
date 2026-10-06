import { useState } from "react";
import { Link } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { formatDateTime } from "@/shared/lib/time";
import { useDispatchStore } from "../../store";
import { CANCELLED_BEFORE_DISPATCH, dmy, ROUND_RETURN_ORIGIN_LABEL } from "../../lib/format";
import { hasSalesReturn } from "../../lib/salesReturn";
import SalesReturnModal from "../../components/SalesReturnModal";
import { returnLinesText } from "../../components/ReturnLines";
import StepDocLink from "../../components/StepDocLink";
import type { DispatchOrder, RoundReturn } from "../../types";

/**
 * Every sales return, whatever state it is in — the register beside All Orders.
 *
 * The Generate Sales Return queue shows only what the viewer owns, and only
 * pending or generated; this page answers "what happened to the return on
 * invoice X?" for anyone who can see the order (RLS on the returns table admits
 * exactly the readers of the order), including withdrawn ones.
 *
 * Both kinds are listed, the same way the queue lists them: returns raised
 * against an invoice that went out, and orders cancelled after their bill was
 * raised.
 *
 * FLAT — no `groupBy`, per the standing rule for FMS list views.
 */
type Status = "Pending" | "Generated" | "Invoice cancelled" | "Withdrawn";

interface Row {
  id: string;
  order: DispatchOrder;
  ret: RoundReturn | null;
  status: Status;
  type: string;
  roundNo: number | null;
  invoiceNo: string | null;
  invoiceDate: string | null;
  requestedBy: string | null;
  requestedAt: string;
  reason: string;
  referenceNo: string | null;
  actualDate: string | null;
  docPath: string | null;
  docName: string | null;
  doneBy: string | null;
  doneAt: string | null;
}

const STATUS_TONE: Record<Status, string> = {
  Pending: "bg-ryg-red/10 text-ryg-red",
  Generated: "bg-ryg-green/10 text-ryg-green",
  "Invoice cancelled": "bg-[#F1F4F9] text-navy",
  Withdrawn: "bg-[#F1F4F9] text-grey-2",
};

const fromRoundReturn = (ret: RoundReturn, o: DispatchOrder): Row => ({
  id: `r:${ret.id}`,
  order: o,
  ret,
  status:
    ret.status === "pending"
      ? "Pending"
      : ret.status === "withdrawn"
        ? "Withdrawn"
        : ret.srMode === "invoice_cancelled"
          ? "Invoice cancelled"
          : "Generated",
  type: ROUND_RETURN_ORIGIN_LABEL[ret.origin] + (ret.scope === "partial" ? " (part)" : ""),
  roundNo: ret.roundNo,
  invoiceNo: ret.invoiceNo,
  invoiceDate: ret.invoiceDate,
  requestedBy: ret.requestedBy,
  requestedAt: ret.requestedAt,
  reason: ret.reason,
  referenceNo: ret.referenceNo,
  actualDate: ret.actualDate,
  docPath: ret.attachmentPath,
  docName: ret.attachmentName,
  doneBy: ret.status === "withdrawn" ? ret.withdrawnBy : ret.recordedBy,
  doneAt: ret.status === "withdrawn" ? ret.withdrawnAt : ret.recordedAt,
});

const fromCancellation = (o: DispatchOrder): Row => ({
  id: `o:${o.id}`,
  order: o,
  ret: null,
  status: o.srAt == null ? "Pending" : o.srMode === "invoice_cancelled" ? "Invoice cancelled" : "Generated",
  type: CANCELLED_BEFORE_DISPATCH,
  roundNo: o.srRoundNo,
  invoiceNo: o.srInvoiceNo,
  invoiceDate: o.srInvoiceDate,
  requestedBy: o.cancelRequestedBy,
  requestedAt: o.cancelRequestedAt ?? "",
  reason: o.cancelReason ?? "",
  referenceNo: o.srReferenceNo,
  actualDate: o.srActualDate,
  docPath: o.srAttachmentPath,
  docName: o.srAttachmentName,
  doneBy: o.srBy,
  doneAt: o.srAt,
});

export type SalesReturnRow = Row;

/** Every sales return this person can see, both kinds, as one list. */
export function useSalesReturnRows(): Row[] {
  const s = useDispatchStore();
  const orderIndex = new Map(s.orders.map((o) => [o.id, o]));
  return [
    ...s.roundReturns.flatMap((ret) => {
      const o = orderIndex.get(ret.orderId);
      return o ? [fromRoundReturn(ret, o)] : [];
    }),
    ...s.orders.filter(hasSalesReturn).map(fromCancellation),
  ];
}

/**
 * The register table, shared by All Sales Returns and the Sales Return request
 * page. The assigned Tally owner gets the Generate button on a pending row;
 * everybody else gets View.
 */
export function SalesReturnTable({
  rows,
  exportName,
  emptyTitle = "No sales returns yet",
  emptyMessage = "Sales returns raised against invoices will appear here.",
}: {
  rows: Row[];
  exportName: string;
  emptyTitle?: string;
  emptyMessage?: string;
}) {
  const s = useDispatchStore();
  const B = "/order-to-dispatch";
  const [acting, setActing] = useState<{ row: Row; view: boolean } | null>(null);

  const mayGenerate = (r: Row) => r.status === "Pending" && s.canEdit && s.canActOn("sales_return", r.order);
  const linesText = (r: Row) => (r.ret ? returnLinesText(r.ret, s.itemName) : "Whole invoice");

  const columns: QueueColumn<Row>[] = [
    {
      key: "status",
      header: "Status",
      cell: (r) => (
        <span className={`inline-block rounded-full px-2 py-0.5 text-[12px] font-semibold ${STATUS_TONE[r.status]}`}>
          {r.status}
        </span>
      ),
      sortValue: (r) => r.status,
      filter: { kind: "select", get: (r) => r.status },
      exportValue: (r) => r.status,
    },
    {
      key: "orderNo",
      header: "Order",
      // Plain inline, not inline-flex (PF-20) — same as the queue.
      cell: (r) => (
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
      ),
      sortValue: (r) => r.order.orderNo,
      filter: { kind: "text", get: (r) => r.order.orderNo },
      exportValue: (r) => r.order.orderNo,
    },
    {
      key: "type",
      header: "Type",
      cell: (r) => <span className={r.ret ? "text-navy" : "text-grey"}>{r.type}</span>,
      sortValue: (r) => r.type,
      filter: { kind: "select", get: (r) => r.type },
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
      cell: (r) => <span className="text-grey">{linesText(r) || "—"}</span>,
      sortValue: (r) => linesText(r),
      filter: { kind: "text", get: (r) => linesText(r) },
      exportValue: (r) => linesText(r),
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
      filter: { kind: "date", get: (r) => r.requestedAt.slice(0, 10) },
      exportValue: (r) => formatDateTime(r.requestedAt),
    },
    {
      key: "reason",
      header: "Reason",
      cell: (r) => <span className="text-grey">{r.reason || "—"}</span>,
      sortValue: (r) => r.reason,
      filter: { kind: "text", get: (r) => r.reason },
    },
    {
      key: "reference",
      header: "Sales return no.",
      cell: (r) => <span className="font-semibold text-navy">{r.referenceNo ?? "—"}</span>,
      sortValue: (r) => r.referenceNo ?? "",
      filter: { kind: "text", get: (r) => r.referenceNo ?? "" },
    },
    {
      key: "actualDate",
      header: "Sales return date",
      cell: (r) => <span className="text-grey whitespace-nowrap">{r.doneAt ? dmy(r.actualDate) : "—"}</span>,
      sortValue: (r) => r.actualDate ?? "",
      exportValue: (r) => (r.doneAt ? dmy(r.actualDate) : ""),
    },
    {
      key: "doc",
      header: "Document",
      cell: (r) =>
        r.docPath ? <StepDocLink path={r.docPath} name={r.docName ?? "Sales return"} /> : <span className="text-grey-2">—</span>,
      exportValue: (r) => r.docName ?? "",
    },
    {
      key: "doneBy",
      header: "Done by",
      cell: (r) => <span className="text-grey">{r.doneBy ? s.personName(r.doneBy) : "—"}</span>,
      sortValue: (r) => (r.doneBy ? s.personName(r.doneBy) : ""),
      filter: { kind: "select", get: (r) => (r.doneBy ? s.personName(r.doneBy) : "—") },
    },
    {
      key: "doneAt",
      header: "Done on",
      cell: (r) => <span className="text-grey whitespace-nowrap">{r.doneAt ? formatDateTime(r.doneAt) : "—"}</span>,
      sortValue: (r) => r.doneAt ?? "",
      exportValue: (r) => (r.doneAt ? formatDateTime(r.doneAt) : ""),
    },
    {
      key: "company",
      header: "Company",
      cell: (r) => <span className="text-grey">{s.masterName("company", r.order.companyId)}</span>,
      sortValue: (r) => s.masterName("company", r.order.companyId),
      filter: { kind: "select", get: (r) => s.masterName("company", r.order.companyId) },
    },
  ];

  return (
    <>
      <QueueTable<Row>
        rows={rows}
        rowKey={(r) => r.id}
        columns={columns}
        actions={(r) =>
          mayGenerate(r) ? (
            <Button size="sm" onClick={() => setActing({ row: r, view: false })}>
              {r.ret ? "Generate sales return" : "Record sales return"}
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setActing({ row: r, view: true })}>
              View
            </Button>
          )
        }
        loading={s.isLoading}
        rowsLabel="sales returns"
        initialSort={{ key: "requestedAt", dir: "desc" }}
        emptyTitle={emptyTitle}
        emptyMessage={emptyMessage}
        exportName={exportName}
      />

      <SalesReturnModal
        order={acting?.row.order ?? null}
        roundReturn={acting?.row.ret ?? null}
        open={!!acting}
        onClose={() => setActing(null)}
        readOnly={!!acting?.view}
      />
    </>
  );
}

export default function AllSalesReturns() {
  const rows = useSalesReturnRows();
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">All Sales Returns</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          Every sales return raised in the system — waiting for Tally, generated, or withdrawn.
        </p>
      </div>
      <Card className="p-4">
        <SalesReturnTable rows={rows} exportName="Order_To_Dispatch_All_Sales_Returns" />
      </Card>
    </div>
  );
}
