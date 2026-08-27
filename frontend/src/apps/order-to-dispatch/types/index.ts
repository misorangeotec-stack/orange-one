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

/**
 * One stored file in the `fms-dispatch-docs` bucket.
 *
 * `path` is the storage object path — never a URL. The bucket is private, so a
 * link is minted on demand with a short-lived signature (`stepDocumentUrl`);
 * `name` is the original filename, kept only so the link has something to say.
 */
export interface StepDoc {
  path: string;
  name: string;
}

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
  /**
   * Names this company's gate pass series — `OTEC` gives `OTEC-2608-001`.
   *
   * Null falls back to `GP` rather than blocking a sales bill, and the database
   * refuses two companies the same prefix (case-insensitively), because they
   * would otherwise interleave silently into one series.
   */
  gatePassPrefix: string | null;
}

/**
 * One of OUR sites — the place a consignment leaves from.
 *
 * ⚠ NOT `Customer.location`, and the two must not be conflated. That one is free
 *   text describing where the CUSTOMER takes delivery, deliberately un-mastered
 *   so a rename cannot rewrite where a past consignment went. This is a real
 *   master with a real FK on the order, because it decides who sees the work.
 *
 * ⚠ `companyIds`, PLURAL, and it used to be a single `companyId`. A site is a
 *   shed with a gate; more than one of our companies dispatches from it. The old
 *   shape forced one row per (company, site) — NOIDA stored twice, SURAT-HOJIWALA
 *   twice, SURAT-SACHIN twice. That duplication was never load-bearing: every
 *   step's owners were identical across both copies of a site. It did mean each
 *   new company added three more rows to retype, which is the opposite of what a
 *   shared master is for.
 */
export interface CompanyLocation extends NamedMaster {
  companyIds: string[];
}

export interface Customer extends NamedMaster {
  /**
   * WHICH OF OUR COMPANIES MAY BILL THIS CUSTOMER — Tally's company book.
   *
   * Not a mapping anybody maintains: a firm has a separate ledger in every book
   * it trades with, so the same firm is several rows here, one per company, and
   * the book each row sits in is the answer. The sales order form narrows its
   * customer picker on exactly this. Null on nine rows (the open reconcile
   * decisions and two internal Noida entities), which is why the picker treats
   * "no company" as its own group rather than hiding them.
   */
  companyId: string | null;
  code: string | null;
  /**
   * Where this customer normally takes delivery. Seeded onto a new sales order
   * the moment the customer is picked — the order keeps its own copy, so a later
   * rename here cannot rewrite a consignment that already went out.
   */
  location: string | null;
  gstin: string | null;
  contactName: string | null;
  phone: string | null;
  /** Contact detail only — this module sends no mail to customers. */
  email: string | null;
}

export interface Item extends NamedMaster {
  code: string | null;
  /**
   * Which Tally BOOK this stock item is filed under — informational, and
   * deliberately NOT what narrows the order form's item picker.
   *
   * Tally files one stock item per company book, and 209 of the 234 items
   * Dispatch has ever ordered are filed under the O-tec book while both firms
   * sell them. Narrowing on this column would offer an Enterprise order 21 items
   * instead of ~230 and invalidate 589 of its 619 existing lines. The customer's
   * own mapping is the authority instead — see `itemsForCustomer`.
   */
  companyId: string | null;
  /**
   * How the item is measured — plain text (KGS, LTR, PCS). There is no unit
   * master: a unit is one word per item, and a separate list only ever let an
   * order line pick a DIFFERENT unit from the item's own.
   */
  unit: string | null;
  hsnCode: string | null;
  /**
   * MS-1's classification — what KIND of thing this is (ink, spare part, head…).
   *
   * It is what the intake form's Item type narrows on (OD-10). Read straight off
   * `mst_items`, never copied onto the mapping: an item is ink whoever buys it,
   * so correcting one item's type fixes every customer line pointing at it.
   *
   * ⚠ NOT the receivables sale type, though the two line up. This is MS-1's
   *   13-word vocabulary; `ITEM_TYPES` in liveMasters carries each one's
   *   `saleType` bucket for when OD-7 needs to join the two.
   *
   * `string | null` rather than a union, deliberately — the vocabulary is still
   * settling and an unrecognised word must render, not fail to compile.
   */
  itemType: string | null;
}

/**
 * One row of a company's whole Tally stock book, for the mapping modal only.
 *
 * ⚠ NOT an `Item`, and not interchangeable with one. `Item` is a row the module
 *   already carries — every one of them reachable through some customer's
 *   mapping — and it holds the unit and HSN an order line renders. This is the
 *   other 12,500: items the module has never had reason to load, fetched per
 *   company the moment somebody goes looking for one. It carries only what
 *   choosing needs, so the two cannot be quietly substituted for each other.
 *
 * `itemType` is the whole reason a book of 8,340 is usable — it is the filter,
 * and it is `string | null` rather than a union because MS-1's vocabulary is 13
 * words and still settling; the modal renders whatever it finds.
 */
export interface CompanyItem {
  id: string;
  name: string;
  code: string | null;
  itemType: string | null;
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

export type DispatchMasterType =
  | "company" | "customer" | "item" | "customer_item" | "company_location";

export interface MasterTypeDef {
  value: DispatchMasterType;
  label: string;
  plural: string;
}

/**
 * Every master type, in Masters-tab order. All are OWNABLE (they take an owner
 * list and are editable by their owner) and all have a tab.
 *
 * The reshape cut this from eighteen, and the mapping change cut two more: UNIT
 * is one word per item and now lives on the item as text, and CATEGORY was read
 * by a single display column and nothing in the flow. Their tables are dropped —
 * do not re-add a type here without the matching table and an arm in
 * `fms_dispatch_resolve_master_request`.
 *
 * COMPANY LOCATION sits directly after Company because it is read as its child:
 * a location is meaningless without the company it hangs off.
 */
export const DISPATCH_MASTER_TYPES: MasterTypeDef[] = [
  { value: "customer",         label: "Customer",              plural: "Customers" },
  { value: "item",             label: "Item",                  plural: "Items" },
  { value: "customer_item",    label: "Customer-Item Mapping", plural: "Customer-Item Mappings" },
  { value: "company",          label: "Company",               plural: "Companies" },
  { value: "company_location", label: "Company Location",      plural: "Company Locations" },
];

/**
 * What the "What do you need?" picker offers — and it is now TWO of the five,
 * because the question "who owns this master?" has three different answers.
 *
 *   · COMPANY, CUSTOMER, ITEM — Tally's. Not requestable (OD-2). They are
 *     created in Tally and appear here on the sync. A row invented in Orange One
 *     arrives with no Tally guid and no company book, and the sync never adopts
 *     it; for a customer that is the exact mechanism behind OD-4, where an order
 *     ended up naming a ledger a different company was billing. `company` was
 *     already excluded and `fms_dispatch_resolve_master_request` refuses it
 *     outright — customer and item now join it.
 *
 *   · CUSTOMER-ITEM MAPPING — ours, and no longer a request AT ALL (OD-9). It
 *     stays in this list because "what do you need?" is still the way in, but
 *     choosing it opens the mapping modal and writes immediately. Of the 122
 *     requests ever raised here, 85 were mappings and 5 were rejected: the
 *     approval was ceremony, and it blocked the one person who could see what
 *     was missing.
 *
 *   · COMPANY LOCATION — ours, and genuinely a request. Our own dispatch site,
 *     nothing to do with Tally, and it decides who can see an order, so an owner
 *     reviewing it is worth the wait.
 *
 * ⚠ TWO KINDS OF ENTRY LIVE IN ONE LIST, so anything reading it must not assume
 *   "requestable" means "goes to an owner" — see `isDirectMaster` below, and the
 *   How it's raised column in MasterOwnersSection.
 *
 * ⚠ Kept as its own export (not an alias) because it is the picker's list: a
 *   master that should never appear is removed HERE, not from
 *   DISPATCH_MASTER_TYPES, which is the Masters-tab order.
 */
export const REQUESTABLE_DISPATCH_MASTER_TYPES: MasterTypeDef[] =
  DISPATCH_MASTER_TYPES.filter((t) => t.value === "customer_item" || t.value === "company_location");

/**
 * Masters the user completes THEMSELVES, with no approval — as opposed to the
 * ones that raise a request for an owner to review.
 *
 * A list rather than a boolean on one type, because the distinction is about to
 * matter in more than one place (the modal's mode, the footer button, the
 * owners screen) and a scattered `mt === "customer_item"` is how those drift.
 */
export const DIRECT_DISPATCH_MASTER_TYPES: DispatchMasterType[] = ["customer_item"];
export const isDirectMaster = (mt: DispatchMasterType) => DIRECT_DISPATCH_MASTER_TYPES.includes(mt);

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

/**
 * One owner-set: who owns a step, at a location.
 *
 * ⚠ `locationId: null` IS THE FALLBACK GRANT — it covers every location, and
 *   every order whose own location is unset. It is not "no location": there is
 *   at most one such row per step, and every owner-set that existed before
 *   locations did is one.
 */
/**
 * Who is currently holding one step of one order.
 *
 * ⚠ Keyed on (orderId, stepKey), NOT on (step, location). Ownership in this
 *   module is per (step, location) and has no answer without the order, so the
 *   order is the natural key - and an assignee is a person put on ONE order,
 *   which is what makes it a stand-in rather than a change of the roster.
 */
export interface StepAssignee {
  orderId: string;
  stepKey: string;
  assignedTo: string;
  assignedBy: string | null;
  assignedAt: string;
  note: string | null;
}

export interface StepOwner {
  id: string;
  stepKey: string;
  locationId: string | null;
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

/**
 * STATUSES ARE NOT STEP KEYS — closed / on_hold / cancelled live only here.
 *
 * `awaiting_sales_return` is the one status that maps to a step, and even then
 * the step is off the chain (`lib/steps.ts`, SALES_RETURN_KEY). It means: the
 * order has been cancelled, but its sales bill was already raised in Tally, so
 * it is not cancelled yet — somebody has to unwind the invoice first. The order
 * is frozen while it sits here: out of every queue, un-holdable, un-cancellable,
 * and no earlier step can be edited underneath it.
 */
export type DispatchStatus =
  | "awaiting_credit_check"
  | "awaiting_material_status"
  | "awaiting_sales_bill"
  | "awaiting_gate_out"
  | "awaiting_dispatch_confirm"
  | "awaiting_sales_return"
  | "closed"
  | "on_hold"
  | "cancelled";

/**
 * How a raised invoice was unwound.
 *
 * ⚠ CHOSEN BY A PERSON, NEVER DERIVED. Whether the bill could still be
 *   cancelled outright or needed a sales return against it is a judgement made
 *   against Tally and GST outside this system. There is deliberately no
 *   24-hour rule, no clock and no deadline anywhere in this module.
 */
export type SalesReturnMode = "invoice_cancelled" | "sales_return";

/**
 * `credit_hold`, not `on_hold`: the ORDER-level status already owns that word,
 * and a credit hold is a different thing — the order stays in the credit queue
 * and its own owner releases it. Two holds sharing one token is how the wrong
 * one gets read.
 *
 * `partial` releases a QUANTITY rather than the order: it advances exactly like
 * `approved`, and the figure it carries (`ccApprovedQty`) is what caps the
 * material-status check downstream.
 */
export type CreditStatus = "approved" | "partial" | "credit_hold";

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
  /** Frozen with the company, so a historic round stays self-describing. */
  locationId: string | null;

  /**
   * The credit decision MADE DURING this round, or null when the round ran
   * under a decision an earlier round had already made.
   *
   * ⚠ NOT "the decision governing the order" — that lives on the order header.
   *   A partial approval big enough to cover two rounds is archived onto the
   *   first only; the second inherits it and archives nothing, so one decision
   *   never appears twice in a Completed tab.
   */
  ccStatus: CreditStatus | null;
  ccApprovedQty: number | null;
  ccRemarks: string | null;
  ccAt: string | null;
  ccBy: string | null;

  msActualDate: string | null;
  msTempoNo: string | null;
  msPorter: boolean | null;
  msRemarks: string | null;
  msAt: string | null;
  msBy: string | null;

  sbActualDate: string | null;
  sbInvoiceNo: string | null;
  sbAttachmentPath: string | null;
  sbAttachmentName: string | null;
  /** The e-way bill for this invoice. OPTIONAL — a consignment below the threshold has none. */
  sbEwayPath: string | null;
  sbEwayName: string | null;
  sbRemarks: string | null;
  sbAt: string | null;
  sbBy: string | null;
  /**
   * Was this round's invoice ever parked, and for how long? Recording the bill
   * leaves the stamps in place, so a finished round still says so.
   */
  sbHoldAt: string | null;
  sbHoldReason: string | null;
  sbHoldBy: string | null;
  /** The gate pass issued for THIS round's invoice. One pass per invoice. */
  gpNo: string | null;

  goActualDate: string | null;
  goOutwardNo: string | null;
  goRemarks: string | null;
  goAt: string | null;
  goBy: string | null;

  dcActualDate: string | null;
  dcStatus: DeliveryStatus | null;
  dcAttachmentPath: string | null;
  dcAttachmentName: string | null;
  /** Pages 2..N of the receiver copy — see the note on `DispatchOrder`. */
  dcAttachmentPages: StepDoc[];
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
  /**
   * WHICH OF OUR ENTITIES BILLS THIS ORDER. Asked once, on the intake form, by
   * the person who actually knows the answer.
   *
   * ⚠ It is ORDER-scoped, not round-scoped, so `fms_dispatch_archive_round` must
   *   NOT wipe it — every round of an order bills the same entity. Null only on
   *   orders raised before 20260817120000 moved the question here.
   */
  companyId: string | null;
  /**
   * WHICH OF OUR SITES THIS LEAVES FROM. Chosen at intake beside the company and,
   * like it, true for every round — `fms_dispatch_archive_round` must not wipe it.
   *
   * ⚠ NOT `customerLocation`. That is free text for where the CUSTOMER takes
   *   delivery; this is a governed master pointing at one of our own places.
   *
   * Null on orders raised before this existed, and on any company that has no
   * locations configured — the form asks for one only where one exists.
   */
  locationId: string | null;
  customerId: string;
  /** Where this consignment goes. Seeded from the customer master, overridable. */
  customerLocation: string | null;
  /** The customer's own PO reference, quoted back to them. Optional. */
  customerPoNo: string | null;
  /** When the customer's order arrived. */
  orderDate: string;
  orderRemarks: string | null;

  raisedBy: string | null;
  requesterName: string;
  status: DispatchStatus;
  currentStep: string;
  submittedAt: string;
  /**
   * Server-side "last touched", including by its own lines and rounds — a trigger
   * bumps it when a child moves (migration 20260926120000).
   *
   * ⚠ NOT FOR DISPLAY. It exists so the refresh after a save can ask Supabase for
   *   the orders that CHANGED instead of re-downloading all of them, which was
   *   2.9 MB a save. Rendering it would be wrong as well as useless: it moves when
   *   a line is edited, not when a human did something worth showing.
   */
  updatedAt: string;

  /** Which round is in progress. 1 for an ordinary single-consignment order. */
  roundNo: number;
  /**
   * When THIS round's clock started. The SLA anchor for the material check —
   * anchoring on `submittedAt` instead would make every looped order
   * permanently overdue from the moment it loops.
   */
  roundStartedAt: string;

  /* ---- step 2: credit_check — the decision GOVERNING the order right now ----
   *
   * ⚠ NO LONGER ONCE PER ORDER. A partial approval releases a quantity, and once
   *   that quantity has all gone out the order comes back here for a fresh
   *   decision on the balance. This block is therefore the CURRENT decision;
   *   `DispatchRound` holds the ones earlier rounds were run under.
   */
  ccStatus: CreditStatus | null;
  ccRemarks: string | null;
  /**
   * CUMULATIVE quantity credit has authorised across every decision on this
   * order. What may still go out is this minus everything already dispatched —
   * see `creditHeadroomOf`.
   *
   * ⚠ NULL MEANS UNCAPPED, not "nothing approved". Every order raised before
   *   partial approval existed carries a null here.
   */
  ccApprovedQty: number | null;
  /** Which round the current decision was made for. Null ⇒ none made yet. */
  ccRoundNo: number | null;
  /** When the outcome was last set — Approve OR On hold. The credit SLA anchor. */
  ccDecidedAt: string | null;
  ccDecidedBy: string | null;
  /** STEP COMPLETION. Stamped on a release; null while the order is held. */
  ccAt: string | null;
  ccBy: string | null;
  ccEditedAt: string | null;
  ccEditedBy: string | null;

  // ---- the round in progress ----
  msActualDate: string | null;
  /** The vehicle carrying THIS round. Optional — blank is a legitimate answer. */
  msTempoNo: string | null;
  /** Did this round go by porter? Null means nobody answered. */
  msPorter: boolean | null;
  msRemarks: string | null;
  msAt: string | null;
  msBy: string | null;

  sbActualDate: string | null;
  sbInvoiceNo: string | null;
  sbAttachmentPath: string | null;
  sbAttachmentName: string | null;
  /** The e-way bill for this invoice. OPTIONAL — a consignment below the threshold has none. */
  sbEwayPath: string | null;
  sbEwayName: string | null;
  sbRemarks: string | null;
  sbAt: string | null;
  sbBy: string | null;
  /**
   * The bill is parked — payment not cleared, the customer has asked us to
   * wait, a document missing — and this is why, since when and by whom.
   *
   * ⚠ LIVE ONLY WHILE `sbAt` IS NULL. Recording the bill leaves all three
   *   standing as history, so read `isBillHeld`, never `sbHoldAt` alone.
   *
   * ⚠ NOT `holdAt` / `holdReason`. Those are the ORDER-level hold, which pulls
   *   the order out of every queue; this one leaves it exactly where it is.
   */
  sbHoldAt: string | null;
  sbHoldReason: string | null;
  sbHoldBy: string | null;
  /**
   * Gate pass number for the round in progress, e.g. `OTEC-2608-001`.
   *
   * Allocated by the server when the sales bill is recorded — one pass per
   * invoice — and cleared when the round is archived, because the next round
   * raises its own invoice. Printing never allocates: press it ten times and
   * the same number comes out ten times.
   */
  gpNo: string | null;

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
  /**
   * Pages 2..N of the receiver copy — the back of the LR, a second sheet, a
   * photo of the stamp.
   *
   * ⚠ PAGE ONE IS NOT IN HERE. It stays in dcAttachmentPath/dcAttachmentName,
   *   which the register export and the documents strip already read. Empty
   *   array, never null: the column is nullable server-side and the fetch layer
   *   normalises it, so nothing downstream has to test for two empty forms.
   */
  dcAttachmentPages: StepDoc[];
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

  /* ---- cancellation, and the sales return it may owe --------------------- *
   *
   * The whole `sr` block is ORDER-scoped and TERMINAL: an order is cancelled
   * once and there is no way back, so there is no copy on `DispatchRound` and
   * `fms_dispatch_archive_round` must NEVER wipe it. That matters more than it
   * looks — the archive runs when the sales return is RECORDED, so this block
   * is the only surviving record of which invoice was unwound and how.
   *
   * `cancelRequestedAt` is stamped on every cancellation, immediate or not.
   * `srRequired` is really "srInvoiceAt is not null" — see lib/salesReturn.ts.
   */
  cancelRequestedAt: string | null;
  cancelRequestedBy: string | null;

  /** Which round's invoice is being unwound — the pointer into `rounds`. */
  srRoundNo: number | null;
  /** Snapshot of the invoice, taken before the archive could wipe it. */
  srInvoiceNo: string | null;
  srInvoiceAt: string | null;
  srInvoiceDate: string | null;
  /** The consignment carried an e-way bill: a reminder to cancel it on the portal. */
  srEwayExpected: boolean | null;

  srMode: SalesReturnMode | null;
  /** The sales return / credit note number. Required only when mode is `sales_return`. */
  srReferenceNo: string | null;
  srActualDate: string | null;
  srRemarks: string | null;
  srAttachmentPath: string | null;
  srAttachmentName: string | null;
  srAt: string | null;
  srBy: string | null;
  srEditedAt: string | null;
  srEditedBy: string | null;

  createdAt: string;

  /** Attached by the fetch layer — the order's lines, in line_no order. */
  lines: OrderLine[];
  /** Attached by the fetch layer — every FINISHED round, in round order. */
  rounds: DispatchRound[];
}
