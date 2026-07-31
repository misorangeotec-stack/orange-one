/**
 * Order to Dispatch FMS domain types — the camelCase shape the store hands out,
 * mapped from the snake_case `fms_dispatch_*` tables in data/dispatchFetch.ts.
 *
 * ⚠ THE ONE RULE OF THIS MODULE (see supabase/migrations/20260810120000):
 *   The order row holds THE ROUND CURRENTLY IN PROGRESS. Every finished round
 *   lives in `DispatchOrder.rounds`. A closed order therefore has NULL in every
 *   ms/sb/go/dc field and all of its history in that array — read history from
 *   `lib/rounds.ts`, never off the order.
 */

/* -------------------------------------------------------------------------- */
/*  Masters — five of them, after the 2026-08 reshape                          */
/* -------------------------------------------------------------------------- */

/** Every master satisfies MasterCrud's contract: id / name / active. */
export interface NamedMaster {
  id: string;
  name: string;
  active: boolean;
  sortOrder: number;
}

export interface Company extends NamedMaster {
  gstin: string | null;
  address: string | null;
}

export interface Customer extends NamedMaster {
  /**
   * THE COMPANY↔CUSTOMER MAPPING. Which of our companies bills this customer.
   * Required, because the sales order no longer asks — `fms_dispatch_submit_order`
   * reads it and refuses to raise an order without it.
   */
  companyId: string | null;
  code: string | null;
  gstin: string | null;
  contactName: string | null;
  phone: string | null;
  /** Contact detail only — this module sends no mail to customers. */
  email: string | null;
}

export interface Item extends NamedMaster {
  code: string | null;
  /**
   * How the item is measured — plain text (KGS, LTR, PCS). There is no unit
   * master: a unit is one word per item, and a separate list only ever let an
   * order line pick a DIFFERENT unit from the item's own.
   */
  unit: string | null;
  hsnCode: string | null;
}

/**
 * WHICH ITEMS A CUSTOMER MAY ORDER. A row is what makes an item selectable on
 * that customer's sales order; no row means it is not offered to them.
 *
 * ⚠ It carries no name of its own — it is described by the pair it names. Every
 *   surface that shows one (Masters list, request modal) synthesises
 *   "Customer — Item", and the resolve RPC exempts this type from the
 *   name-is-required check for the same reason.
 */
export interface CustomerItem extends NamedMaster {
  customerId: string;
  itemId: string;
}

/* -------------------------------------------------------------------------- */
/*  Master governance                                                          */
/* -------------------------------------------------------------------------- */

export type DispatchMasterType = "company" | "customer" | "item" | "customer_item";

export interface MasterTypeDef {
  value: DispatchMasterType;
  label: string;
  plural: string;
}

/**
 * Every master type, in Masters-tab order. All four are OWNABLE (they take an
 * owner list and are editable by their owner) and all four have a tab.
 *
 * The reshape cut this from eighteen, and the mapping change cut two more: UNIT
 * is one word per item and now lives on the item as text, and CATEGORY was read
 * by a single display column and nothing in the flow. Their tables are dropped —
 * do not re-add a type here without the matching table and an arm in
 * `fms_dispatch_resolve_master_request`.
 */
export const DISPATCH_MASTER_TYPES: MasterTypeDef[] = [
  { value: "customer",      label: "Customer",              plural: "Customers" },
  { value: "item",          label: "Item",                  plural: "Items" },
  { value: "customer_item", label: "Customer-Item Mapping", plural: "Customer-Item Mappings" },
  { value: "company",       label: "Company",               plural: "Companies" },
];

/**
 * The subset offered in the "Request a new entry" picker.
 *
 * A master is REQUESTABLE when it feeds a dropdown a non-owner has to pick from
 * and could plausibly find missing mid-task. Company is excluded: it is one-time
 * configuration a coordinator sets up, and it is now the customer↔company
 * mapping, so inventing one mid-order is exactly what should not happen.
 */
const NOT_REQUESTABLE: DispatchMasterType[] = ["company"];
export const REQUESTABLE_DISPATCH_MASTER_TYPES: MasterTypeDef[] =
  DISPATCH_MASTER_TYPES.filter((m) => !NOT_REQUESTABLE.includes(m.value));

export interface MasterManager {
  id: string;
  masterType: DispatchMasterType;
  managerUserId: string;
}

export interface DispatchMasterRequest {
  id: string;
  masterType: DispatchMasterType;
  proposedPayload: Record<string, unknown>;
  status: "pending" | "approved" | "rejected";
  requestedBy: string | null;
  reviewedBy: string | null;
  reviewNote: string | null;
  resolvedMasterId: string | null;
  createdAt: string;
}

/* -------------------------------------------------------------------------- */
/*  Config / owners / feed                                                     */
/* -------------------------------------------------------------------------- */

export interface StepOwner {
  id: string;
  stepKey: string;
  departmentIds: string[];
  designationId: string | null;
  employeeIds: string[];
}

export interface Designation {
  id: string;
  name: string;
}

export interface OrgDepartment {
  id: string;
  name: string;
}

export interface DispatchActivity {
  id: string;
  entityType: "order" | "master_request";
  entityId: string;
  type: string;
  actorId: string | null;
  note: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
}

export interface DispatchNotification {
  id: string;
  userId: string;
  type: string;
  entityType: string;
  entityId: string;
  text: string;
  actorId: string | null;
  readAt: string | null;
  createdAt: string;
}

/* -------------------------------------------------------------------------- */
/*  The order                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * How the consignment travels. A CODE ENUM, never a master.
 *
 * Since the reshape this is a LABEL: the delivery-confirmation step no longer
 * branches on it (it collects one outcome and a receiver copy either way). It is
 * kept because it is how the sales team describes the order, and it is still
 * NOT NULL on the table.
 */
export type DispatchType = "local" | "transport";

/** STATUSES ARE NOT STEP KEYS — closed / on_hold / cancelled live only here. */
export type DispatchStatus =
  | "awaiting_credit_check"
  | "awaiting_material_status"
  | "awaiting_sales_bill"
  | "awaiting_gate_out"
  | "awaiting_dispatch_confirm"
  | "closed"
  | "on_hold"
  | "cancelled";

/**
 * `credit_hold`, not `on_hold`: the ORDER-level status already owns that word,
 * and a credit hold is a different thing — the order stays in the credit queue
 * and its own owner releases it. Two holds sharing one token is how the wrong
 * one gets read.
 */
export type CreditStatus = "approved" | "credit_hold";

export type DeliveryStatus = "delivered" | "returned";

export interface OrderLine {
  id: string;
  orderId: string;
  lineNo: number;
  itemId: string;
  /** Ordered. Intake only — never changes once a dispatch has gone out. */
  quantity: number;
  /** The item's unit AS AT the moment the order was raised — a snapshot, so a
   *  later edit to the item master does not rewrite an old order's line. */
  unit: string | null;
  lineRemark: string | null;

  /**
   * Delivered so far, across every round. RECALCULATED server-side from the
   * round archive — never incremented — so it cannot drift from the history it
   * summarises.
   */
  dispatchedQty: number;
  /** This round's selection. Null ⇒ this line is not going out this time. */
  shipQty: number | null;
  /** Typed by the store keeper. Free text — there is no LOT master. */
  lotNo: string | null;
}

/* -------------------------------------------------------------------------- */
/*  Rounds                                                                     */
/* -------------------------------------------------------------------------- */

export type RoundArchivedReason = "looped" | "closed" | "cancelled";

/** One line of one round's consignment, with the master labels frozen in. */
export interface RoundItem {
  id: string;
  roundId: string;
  orderItemId: string | null;
  lineNo: number;
  itemId: string | null;
  itemName: string;
  unitName: string | null;
  orderedQty: number;
  shipQty: number;
  lotNo: string | null;
}

/**
 * A completed round, straight off `fms_dispatch_rounds`.
 *
 * `lib/rounds.ts` projects BOTH this and the live order header into one
 * `RoundView`, so every screen reads one shape and never has to know which of
 * the two it is looking at.
 */
export interface DispatchRound {
  id: string;
  orderId: string;
  roundNo: number;
  roundStartedAt: string | null;
  companyId: string | null;

  msActualDate: string | null;
  msRemarks: string | null;
  msAt: string | null;
  msBy: string | null;

  sbActualDate: string | null;
  sbInvoiceNo: string | null;
  sbAttachmentPath: string | null;
  sbAttachmentName: string | null;
  sbRemarks: string | null;
  sbAt: string | null;
  sbBy: string | null;

  goActualDate: string | null;
  goOutwardNo: string | null;
  goRemarks: string | null;
  goAt: string | null;
  goBy: string | null;

  dcActualDate: string | null;
  dcStatus: DeliveryStatus | null;
  dcAttachmentPath: string | null;
  dcAttachmentName: string | null;
  dcRemarks: string | null;
  dcAt: string | null;
  dcBy: string | null;

  editedAt: string | null;
  editedBy: string | null;
  amendedAt: string | null;
  amendedBy: string | null;
  amendReason: string | null;
  archivedReason: RoundArchivedReason;
  archivedAt: string;

  /** Attached by the fetch layer — only the lines that actually went out. */
  items: RoundItem[];
}

export interface DispatchOrder {
  id: string;
  orderNo: string;

  // ---- intake ----
  dispatchType: DispatchType;
  /** Resolved server-side from the customer's master mapping. Never asked for. */
  companyId: string | null;
  customerId: string;
  /** When the customer's order arrived. */
  orderDate: string;
  orderRemarks: string | null;

  raisedBy: string | null;
  requesterName: string;
  status: DispatchStatus;
  currentStep: string;
  submittedAt: string;

  /** Which round is in progress. 1 for an ordinary single-consignment order. */
  roundNo: number;
  /**
   * When THIS round's clock started. The SLA anchor for the material check —
   * anchoring on `submittedAt` instead would make every looped order
   * permanently overdue from the moment it loops.
   */
  roundStartedAt: string;

  // ---- step 2: credit_check (decided ONCE PER ORDER, survives every round) ----
  ccStatus: CreditStatus | null;
  ccRemarks: string | null;
  /** When the outcome was last set — Approve OR On hold. The credit SLA anchor. */
  ccDecidedAt: string | null;
  ccDecidedBy: string | null;
  /** STEP COMPLETION. Stamped on Approve only; null while the order is held. */
  ccAt: string | null;
  ccBy: string | null;
  ccEditedAt: string | null;
  ccEditedBy: string | null;

  // ---- the round in progress ----
  msActualDate: string | null;
  msRemarks: string | null;
  msAt: string | null;
  msBy: string | null;

  sbActualDate: string | null;
  sbInvoiceNo: string | null;
  sbAttachmentPath: string | null;
  sbAttachmentName: string | null;
  sbRemarks: string | null;
  sbAt: string | null;
  sbBy: string | null;

  goActualDate: string | null;
  /** Typed from the plant's paper register. Not generated, not unique. */
  goOutwardNo: string | null;
  goRemarks: string | null;
  goAt: string | null;
  goBy: string | null;

  dcActualDate: string | null;
  dcStatus: DeliveryStatus | null;
  dcAttachmentPath: string | null;
  dcAttachmentName: string | null;
  dcRemarks: string | null;
  dcAt: string | null;
  dcBy: string | null;

  closedAt: string | null;
  /** Set ⇒ a coordinator closed this order with a balance still outstanding. */
  closedReason: string | null;
  closedBy: string | null;

  editedAt: string | null;
  editedBy: string | null;
  holdAt: string | null;
  holdReason: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;

  createdAt: string;

  /** Attached by the fetch layer — the order's lines, in line_no order. */
  lines: OrderLine[];
  /** Attached by the fetch layer — every FINISHED round, in round order. */
  rounds: DispatchRound[];
}
