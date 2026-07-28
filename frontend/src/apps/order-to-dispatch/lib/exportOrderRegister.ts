/**
 * The Order Register — the .xlsx that replaces the source spreadsheet.
 *
 * One row per order with all seven step column groups (Planned / Actual / Status /
 * Remarks), laid out in the same order the sheet used, so anyone handed this file
 * recognises it immediately.
 *
 * It is built from `lib/orderVm.ts` — the SAME row model
 * `components/PlannedVsActualTable.tsx` renders on screen — so the export and the
 * order page can never disagree about whether a step ran late.
 */
import { exportRowsToXlsx, type ExportColumn } from "@/shared/lib/exportXlsx";
import { STEPS } from "./steps";
import { orderStepRows, type OrderVmDeps } from "./orderVm";
import { DISPATCH_TYPE_LABEL, STATUS_LABEL, dmy } from "./format";
import type { DispatchOrder } from "../types";

export interface RegisterDeps extends OrderVmDeps {
  customerName: (id: string | null) => string;
  itemName: (id: string | null) => string;
  unitName: (id: string | null) => string;
  vehicleName: (id: string | null) => string;
  transporterName: (id: string | null) => string;
}

/** A flat row: the order's header fields plus four cells per step. */
type Row = { order: DispatchOrder; steps: ReturnType<typeof orderStepRows> };

export function exportOrderRegister(
  orders: DispatchOrder[],
  deps: RegisterDeps,
  filters: string[] = [],
): void {
  const rows: Row[] = orders.map((o) => ({ order: o, steps: orderStepRows(o, deps) }));

  const stepCell = (idx: number, pick: (r: Row["steps"][number]) => string) => (row: Row) => {
    const st = row.steps[idx];
    return st ? pick(st) : "";
  };

  const columns: ExportColumn<Row>[] = [
    { header: "SR No.", width: 10, value: (r) => r.order.orderNo },
    { header: "Type", width: 12, value: (r) => DISPATCH_TYPE_LABEL[r.order.dispatchType] },
    { header: "Order Date", width: 13, value: (r) => dmy(r.order.orderDate) },
    { header: "Customer Name", width: 26, value: (r) => deps.customerName(r.order.customerId) },
    {
      header: "Item",
      width: 30,
      value: (r) => r.order.lines.map((l) => deps.itemName(l.itemId)).join(", "),
    },
    {
      header: "Quantity",
      width: 18,
      value: (r) =>
        r.order.lines.map((l) => `${l.quantity} ${deps.unitName(l.unitId)}`.trim()).join(", "),
    },
    { header: "TAT for Material Dispatch", width: 14, value: (r) => r.order.tatDays ?? "" },
    { header: "Promised Dispatch", width: 15, value: (r) => dmy(r.order.promisedDate) },
    { header: "Customer Ref.", width: 16, value: (r) => r.order.customerRef ?? "" },
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
    { header: "Sales Invoice No.", width: 18, value: (r) => r.order.sbInvoiceNo ?? "" },
    { header: "Sales Invoice Attached", width: 14, value: (r) => (r.order.sbAttachmentPath ? "Yes" : "No") },
    { header: "Gate Pass No.", width: 16, value: (r) => r.order.goGatePassNo ?? "" },
    { header: "Vehicle", width: 16, value: (r) => (r.order.goVehicleId ? deps.vehicleName(r.order.goVehicleId) : "") },
    { header: "Transporter", width: 20, value: (r) => (r.order.dcTransporterId ? deps.transporterName(r.order.dcTransporterId) : "") },
    { header: "LR No.", width: 14, value: (r) => r.order.dcLrNo ?? "" },
    { header: "Received By", width: 20, value: (r) => r.order.dcReceiverName ?? "" },
    { header: "Receiver Copy Attached", width: 14, value: (r) => (r.order.dcAttachmentPath ? "Yes" : "No") },
    { header: "Order Status", width: 20, value: (r) => STATUS_LABEL[r.order.status] },
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
      "One row per sales order, with the Planned / Actual / Status / Remarks block for each of the six workflow steps.",
      "Planned dates come from the configured per-step SLA (Setup → Due Dates). The material-status check uses an hour-of-day cut-off, not a day count.",
      "Days late = actual date minus planned date, floored at zero. Blank means the step has not been recorded yet.",
      "Promised Dispatch is what the customer was told; it is deliberately separate from the internal step deadlines.",
    ],
  });
}
