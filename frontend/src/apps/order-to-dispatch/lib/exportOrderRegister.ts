/**
 * The Order Register — the .xlsx that replaces the source spreadsheet.
 *
 * WARNING: ONE ROW PER ROUND, not per order. An order that shipped in three goes
 * raised three invoices, made three gate entries and had three delivery
 * outcomes. Collapsing that into one row would have to pick one of each and
 * silently drop the rest — and "one row per order" stopped being meaningful the
 * moment partial dispatch existed.
 *
 * Built from `lib/orderVm.ts`, the same round-scoped row model the Control
 * Centre's variance card reads, so the export and the screens cannot disagree
 * about whether a step ran late.
 */
import { exportRowsToXlsx, type ExportColumn } from "@/shared/lib/exportXlsx";
import { STEPS } from "./steps";
import { orderStepRows, type OrderVmDeps } from "./orderVm";
import { allRoundViews, type RoundView } from "./rounds";
import { DISPATCH_TYPE_LABEL, STATUS_LABEL, dmy } from "./format";
import type { DispatchOrder } from "../types";

export interface RegisterDeps extends OrderVmDeps {
  customerName: (id: string | null) => string;
  itemName: (id: string | null) => string;
  companyName: (id: string | null) => string;
  /** OUR site the round left from — not `customerLocation`, which is free text. */
  locationName: (id: string | null) => string;
}

/** A flat row: one round of one order, plus that round's step cells. */
type Row = { order: DispatchOrder; view: RoundView; steps: ReturnType<typeof orderStepRows> };

export function exportOrderRegister(
  orders: DispatchOrder[],
  deps: RegisterDeps,
  filters: string[] = [],
): void {
  const rows: Row[] = orders.flatMap((o) =>
    allRoundViews(o).map((v) => ({ order: o, view: v, steps: orderStepRows(o, deps, v) })),
  );

  const stepCell = (idx: number, pick: (r: Row["steps"][number]) => string) => (row: Row) => {
    const st = row.steps[idx];
    return st ? pick(st) : "";
  };

  const columns: ExportColumn<Row>[] = [
    { header: "SR No.", width: 16, value: (r) => `${r.order.orderNo} - R${r.view.roundNo}` },
    { header: "Order No.", width: 14, value: (r) => r.order.orderNo },
    { header: "Round", width: 8, value: (r) => r.view.roundNo },
    { header: "Type", width: 12, value: (r) => DISPATCH_TYPE_LABEL[r.order.dispatchType] },
    { header: "Order Date", width: 13, value: (r) => dmy(r.order.orderDate) },
    { header: "Customer Name", width: 26, value: (r) => deps.customerName(r.order.customerId) },
    { header: "Customer Location", width: 20, value: (r) => r.order.customerLocation ?? "" },
    { header: "Customer PO No.", width: 18, value: (r) => r.order.customerPoNo ?? "" },
    { header: "Company", width: 24, value: (r) => deps.companyName(r.view.companyId ?? r.order.companyId) },
    // Round first, header as the fallback — an archived round keeps its own copy,
    // and an order raised before locations existed has neither.
    { header: "Dispatch Location", width: 20, value: (r) => deps.locationName(r.view.locationId ?? r.order.locationId) },
    {
      header: "Item",
      width: 30,
      value: (r) => r.order.lines.map((l) => deps.itemName(l.itemId)).join(", "),
    },
    {
      header: "Ordered Qty",
      width: 18,
      value: (r) =>
        r.order.lines.map((l) => `${l.quantity} ${l.unit ?? ""}`.trim()).join(", "),
    },
    {
      // The ceiling credit had set when this round ran. Blank on an uncapped
      // order — every one raised before partial approval existed — rather than
      // a zero, which would read as "credit approved nothing".
      header: "Credit Approved Qty",
      width: 18,
      value: (r) => (r.order.ccApprovedQty == null ? "" : r.order.ccApprovedQty),
    },
    {
      header: "Dispatched This Round",
      width: 24,
      value: (r) => r.view.items.map((i) => `${i.itemName} ${i.shipQty}`).join(", "),
    },
    {
      header: "LOT No.",
      width: 18,
      value: (r) => r.view.items.map((i) => i.lotNo ?? "").filter(Boolean).join(", "),
    },
    {
      header: "Pending On Order",
      width: 16,
      value: (r) => r.order.lines.reduce((a, l) => a + Math.max(l.quantity - l.dispatchedQty, 0), 0),
    },
  ];

  // One Planned / Actual / Status / Remarks block per step, exactly as the sheet.
  STEPS.forEach((st, idx) => {
    if (st.key === "sales_order") return; // the origin step's data is in the header block
    columns.push(
      { header: `Planned Date - ${st.short}`, width: 15, value: stepCell(idx, (r) => (r.plannedIso ? dmy(r.plannedIso) : "")) },
      { header: `Actual Date - ${st.short}`, width: 15, value: stepCell(idx, (r) => (r.actualIso ? dmy(r.actualIso) : "")) },
      { header: `Status - ${st.short}`, width: 20, value: stepCell(idx, (r) => (r.statusLabel === "—" ? "" : r.statusLabel)) },
      { header: `Remarks - ${st.short}`, width: 24, value: stepCell(idx, (r) => r.remarks ?? "") },
      { header: `Days late - ${st.short}`, width: 11, value: stepCell(idx, (r) => (r.lateDays === null ? "" : String(r.lateDays))) },
    );
  });

  // The documents each step produced, and the closing state.
  columns.push(
    // Per round, from the stock check. Both optional, so blank is a real answer.
    { header: "Tempo No.", width: 16, value: (r) => r.view.msTempoNo ?? "" },
    { header: "Porter", width: 10, value: (r) => (r.view.msPorter === null ? "" : r.view.msPorter ? "Yes" : "No") },
    { header: "Tally Invoice No.", width: 18, value: (r) => r.view.sbInvoiceNo ?? "" },
    // One pass per invoice, so it sits beside the invoice it was issued for.
    { header: "Gate Pass No.", width: 16, value: (r) => r.view.gpNo ?? "" },
    { header: "Sales Invoice Attached", width: 14, value: (r) => (r.view.sbAttachmentPath ? "Yes" : "No") },
    { header: "Gate Outward No.", width: 18, value: (r) => r.view.goOutwardNo ?? "" },
    { header: "Receiver Copy Attached", width: 14, value: (r) => (r.view.dcAttachmentPath ? "Yes" : "No") },
    { header: "Round Corrected", width: 26, value: (r) => r.view.amendReason ?? "" },
    { header: "Order Status", width: 20, value: (r) => STATUS_LABEL[r.order.status] },
    { header: "Closed Early", width: 26, value: (r) => r.order.closedReason ?? "" },
    { header: "Raised By", width: 20, value: (r) => r.order.requesterName },
  );

  exportRowsToXlsx<Row>({
    fileName: "Order_To_Dispatch_Register",
    sheetName: "Order to Dispatch",
    title: "Order to Dispatch — Register",
    columns,
    rows,
    filters,
    notes: [
      "ONE ROW PER DISPATCH ROUND. An order shipped in two goes appears twice - R1 and R2 - each with its own invoice, gate outward number and delivery outcome.",
      "Planned dates come from the configured per-step SLA (Setup → Due Dates). The material-status check uses an hour-of-day cut-off, not a day count.",
      "Days late = actual date minus planned date, floored at zero. Blank means the step has not been recorded yet.",
      "Pending On Order is the balance still owed once every delivered round is counted. A returned round counts for nothing - the goods came back.",
    ],
  });
}
