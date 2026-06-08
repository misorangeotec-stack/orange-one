import type { StageDef } from "../types";

/**
 * The Purchase FMS pipeline — decoded from the "Enterprise" tab of
 * `files/FMS- Enterprise Purchase.xlsx`. Each block of columns in that sheet is
 * one stage here, annotated with What / Who / How / When. This single array is
 * the source of truth for the front end (stepper, timeline, forms) and will seed
 * the Phase-2 `fms_workflow_steps` / `fms_step_fields` tables.
 *
 * To add another FMS later: define a second StageDef[] (or load it from the
 * engine) — the components render any workflow shaped like this.
 */
const STATUS_OPTS = ["Done", "Pending", "On Hold"];

export const PURCHASE_STAGES: StageDef[] = [
  {
    key: "generate_order",
    index: 1,
    short: "Order",
    title: "Generate Order",
    what: "Raise a purchase requirement: pick the category, name the item, set the quantity.",
    how: "Entered directly here (was: the sheet).",
    when: "Whenever needed",
    ownerKey: "generate_order",
    defaultOwner: "Manisha Rane / Bharat Singh",
    isOrigin: true,
    fields: [
      { key: "category", label: "Category", type: "text" },
      { key: "itemName", label: "Item Name", type: "text" },
      { key: "quantity", label: "Quantity", type: "number", half: true },
      { key: "unit", label: "Unit", type: "text", half: true },
      { key: "remarks", label: "Remarks", type: "textarea" },
    ],
  },
  {
    key: "approval",
    index: 2,
    short: "Approval",
    title: "Approval — Purchase Dept",
    what: "Approve the order, then capture the vendor, final quantity and final rate.",
    how: "Approve here.",
    when: "+24 working hrs after the previous step",
    ownerKey: "approval",
    defaultOwner: "Hemant Sir / Rohan Jariwala",
    fields: [
      { key: "status", label: "Approval Status", type: "select", options: ["Approved", "Rejected", "On Hold"], required: true, half: true },
      { key: "vendorName", label: "Vendor Name", type: "text", half: true },
      { key: "finalQty", label: "Final Qty", type: "number", half: true },
      { key: "finalRate", label: "Final Rate", type: "number", half: true },
      { key: "purchaseRemarks", label: "Remarks (Purchase Dept.)", type: "textarea" },
    ],
  },
  {
    key: "po_generation",
    index: 3,
    short: "PO Gen",
    title: "Generate PO in System",
    what: "Generate the PO in the ERP and share it back to the purchase department.",
    how: "Via mail (sent to Rohan, who forwards to the supplier).",
    when: "+24 working hrs after the previous step",
    ownerKey: "po_generation",
    defaultOwner: "Jyoti",
    fields: [
      { key: "status", label: "PO Status", type: "select", options: STATUS_OPTS, required: true, half: true },
      { key: "systemPoNo", label: "System-generated PO No.", type: "text", half: true },
      { key: "poRemarks", label: "Remarks (if any in PO)", type: "textarea" },
    ],
  },
  {
    key: "share_po",
    index: 4,
    short: "Share PO",
    title: "Share PO to Vendor & Collect PI",
    what: "Share the PO with the vendor, collect the PI, and capture commercial terms.",
    how: "Via mail & sheet.",
    when: "+24 working hrs after the previous step",
    ownerKey: "share_po",
    defaultOwner: "Rohan Jariwala",
    fields: [
      { key: "status", label: "PO Shared Status", type: "select", options: STATUS_OPTS, required: true, half: true },
      { key: "vendorPiNo", label: "Vendor PI No.", type: "text", half: true },
      { key: "materialDispatchDate", label: "Material Dispatch Date (from vendor)", type: "date", half: true },
      { key: "paymentTerms", label: "Payment Terms", type: "select", options: ["Advance", "Credit", "Partial Advance", "On Delivery"], half: true },
      { key: "totalGstValue", label: "Total PO Value (incl. GST)", type: "number", half: true },
      { key: "sharedRemarks", label: "Remarks (if any)", type: "textarea" },
    ],
  },
  {
    key: "advance_payment",
    index: 5,
    short: "Adv. Pay",
    title: "Advance Payment — Accounts",
    what: "Release the advance payment per the agreed payment terms.",
    how: "Via mail & sheet.",
    when: "+24 working hrs (driven by payment terms)",
    ownerKey: "advance_payment",
    defaultOwner: "Ravina Madam",
    fields: [
      { key: "status", label: "Advance Payment Status", type: "select", options: STATUS_OPTS, required: true, half: true },
      { key: "advRemarks", label: "Remarks (if any)", type: "textarea" },
    ],
  },
  {
    key: "follow_up",
    index: 6,
    short: "Follow Up",
    title: "Follow Up with Vendor",
    what: "Follow up for dispatch; capture transport / LR details and the actual dispatch.",
    how: "Based on the expected material-receipt delay.",
    when: "Day before the vendor's dispatch date",
    ownerKey: "follow_up",
    defaultOwner: "Rohan Jariwala",
    fields: [
      { key: "status", label: "Dispatch Status", type: "select", options: ["Dispatched", "Pending", "Delayed"], required: true, half: true },
      { key: "dispatchLr", label: "Dispatch Details (LR No.)", type: "text", half: true },
      { key: "transportDetails", label: "Transport Details", type: "text" },
      { key: "followUpRemarks", label: "Remarks (in follow-up)", type: "textarea" },
    ],
  },
  {
    key: "inward_entry",
    index: 7,
    short: "Inward",
    title: "Inward (Gate) Entry",
    what: "Record gate entry when material reaches the factory and check condition.",
    how: "As per the Material Receiving Checklist register.",
    when: "+24 working hrs after dispatch",
    ownerKey: "inward_entry",
    defaultOwner: "Bharat Singh",
    fields: [
      { key: "status", label: "Inward Status", type: "select", options: ["Received", "Partial", "Pending"], required: true, half: true },
      { key: "gateRegisterNo", label: "Gate Register Entry No.", type: "text", half: true },
      { key: "receivedQty", label: "Received Qty", type: "number", half: true },
      { key: "receivedCondition", label: "Received Material Condition", type: "select", options: ["Good", "Damaged", "Partial Damage"], half: true },
      { key: "remarks", label: "Remarks (if any)", type: "textarea" },
    ],
  },
  {
    key: "system_entry",
    index: 8,
    short: "Tally",
    title: "System Entry (Tally)",
    what: "Book the purchase entry in Tally and record the Tally PI number.",
    how: "Purchase entry in Tally.",
    when: "+24 working hrs after inward entry",
    ownerKey: "system_entry",
    defaultOwner: "Bharat Kale",
    fields: [
      { key: "status", label: "System Status", type: "select", options: STATUS_OPTS, required: true, half: true },
      { key: "tallyPiNo", label: "Tally PI No.", type: "text", half: true },
      { key: "systemRemarks", label: "Remarks (system entry)", type: "textarea" },
    ],
  },
  {
    key: "final_payment",
    index: 9,
    short: "Final Pay",
    title: "Final Payment",
    what: "Settle the pending amount on the payment due date.",
    how: "Update once done.",
    when: "On the payment due date",
    ownerKey: "final_payment",
    defaultOwner: "Ravina Madam",
    fields: [
      { key: "dueDate", label: "Due Date of Final Payment", type: "date", half: true },
      { key: "pendingAmount", label: "Pending Amount for Payment", type: "number", half: true },
      { key: "datePaid", label: "Date Pending Amount Paid", type: "date", half: true },
    ],
  },
];

/** Total stage count — used for progress (done / TOTAL). */
export const STAGE_COUNT = PURCHASE_STAGES.length;

export const stageByKey = (key: string): StageDef | undefined =>
  PURCHASE_STAGES.find((s) => s.key === key);
