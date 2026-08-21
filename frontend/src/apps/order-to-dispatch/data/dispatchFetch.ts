import { supabase } from "@/core/platform/supabase";
// fms_dispatch_* tables are not in the generated Database types; route table/rpc
// calls through an untyped alias (the row mappers below already treat rows as any).
// This is the standing FMS convention — see production-entry/data/productionFetch.ts.
const db = supabase as any;

import { resolveStepSla, type StepSlaMap } from "../lib/sla";
import type {
  Company, CompanyItem, CompanyLocation, Customer, Designation, DispatchActivity,
  DispatchMasterRequest, CustomerItem, DispatchMasterType, DispatchNotification, DispatchOrder,
  DispatchRound, Item, MasterManager, NamedMaster, OrderLine, RoundItem, StepDoc, StepOwner,
} from "../types";

/**
 * Order to Dispatch FMS read layer. One paginated pass over the module's tables,
 * mapped snake_case → camelCase. The whole module loads in one snapshot so the
 * pure queue rules (lib/queues.ts) get plain data, and the Control Center adapter
 * + My Work provider can reuse this exact react-query cache entry.
 *
 * ⚠ Order lines and ROUNDS are fetched as their OWN paginated passes and grouped
 *   in memory, not as nested PostgREST selects (`orders(*, items(*))`) — a nested
 *   select silently truncates at the API row limit once the order count grows.
 *
 * ⚠ The Promise.all below destructures BY POSITION. Adding or removing a call
 *   without moving its name shifts every binding after it, and because every row
 *   is `any` the compiler cannot see it — you get silently wrong data everywhere.
 *   Change one line at a time and re-count both lists.
 */

const PAGE = 1000;

type Tbl =
  | "fms_dispatch_step_owners"
  | "fms_dispatch_config"
  | "mst_companies"
  | "mst_locations"
  | "mst_company_locations"
  | "mst_parties"
  | "mst_items"
  | "mst_units"
  | "mst_party_items"
  | "fms_dispatch_master_managers"
  | "fms_dispatch_master_requests"
  | "fms_dispatch_orders"
  | "fms_dispatch_order_items"
  | "fms_dispatch_rounds"
  | "fms_dispatch_round_items"
  | "fms_dispatch_activity"
  | "fms_dispatch_notifications"
  | "designations";

/**
 * ⚠ EVERY PAGED READ IS ORDERED BY A *UNIQUE* KEY, and `created_at` is not one.
 *
 * `.range()` is OFFSET paging: each page is a separate query, and Postgres only
 * guarantees an order for the columns you name. `created_at` is full of ties here
 * — the sales-register derivation writes mst_party_items in 500-row batches that
 * share a timestamp to the microsecond, and one batch of 1,036 — so rows inside a
 * tie group can land on either side of a page boundary from one request to the
 * next. Measured on the live table: 8,052 rows fetched, 7,754 distinct — ~300
 * mappings duplicated and ~300 silently NEVER LOADED, which is what took an item
 * out of its customer's picker while the mapping sat there in Masters.
 *
 * `id` (the primary key) is appended as the tiebreaker, so the order is total and
 * the walk is exact. Same rule the receivables fetchers and liveMasters carry.
 */
/**
 * ⚠ PAGES ARE FETCHED IN PARALLEL, NOT ONE AFTER THE OTHER, and the first page
 *   is what tells us how many there are.
 *
 *   Walking serially meant page 2 could not start until page 1 landed. On
 *   mst_party_items — 8,052 rows, nine pages — that was 1.86 s of pure latency in
 *   a traced load, and it is paid again on every refresh. Asking the first page
 *   for `count: "exact"` costs nothing extra and turns the other eight into one
 *   concurrent round.
 *
 * ⚠ THE SERIAL TAIL IS NOT REDUNDANT. The count is read at the start; rows can be
 *   inserted while the other pages are in flight. So if the LAST page still comes
 *   back full, we keep walking from there exactly as before, until a short page
 *   proves the end. That preserves the old termination guarantee — the parallel
 *   round is an optimisation on top of it, not a replacement for it.
 */
/**
 * The paged walk itself. `build(withCount)` must return a fresh, fully-ordered
 * query each time it is called; this adds the `.range()`.
 */
async function pagedWalk(build: (withCount: boolean) => any): Promise<any[]> {
  const page = (from: number, withCount = false) =>
    build(withCount).range(from, from + PAGE - 1);

  const first = await page(0, true);
  if (first.error) throw new Error(first.error.message);

  const out: any[] = [...(first.data ?? [])];
  if (out.length < PAGE) return out;

  const total: number | null = first.count ?? null;
  const known = total === null ? 0 : Math.ceil(total / PAGE);
  if (known > 1) {
    const rest = await Promise.all(
      Array.from({ length: known - 1 }, (_, i) => page((i + 1) * PAGE)),
    );
    for (const r of rest) {
      if (r.error) throw new Error(r.error.message);
      out.push(...(r.data ?? []));
    }
    if ((rest[rest.length - 1]?.data?.length ?? 0) < PAGE) return out;
  }

  // Either the count was unavailable, or rows arrived mid-read: walk on serially.
  for (let from = Math.max(known, 1) * PAGE; ; from += PAGE) {
    const { data, error } = await page(from);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * `cols` names the columns to fetch. Default "*" — pass a list only where the
 * saving is worth the care, i.e. the catalogue. See COLS below.
 */
async function fetchAll(table: Tbl, orderBy = "created_at", cols = "*"): Promise<any[]> {
  return pagedWalk((withCount) => {
    let q = db.from(table).select(cols, withCount ? { count: "exact" } : undefined)
      .order(orderBy, { ascending: true });
    // fms_dispatch_config is the one caller that names its own key, and `key` IS
    // its primary key — it has no `id` column, so asking for one would 400.
    if (orderBy !== "key") q = q.order("id", { ascending: true });
    return q;
  });
}

/**
 * THE COLUMNS THE CATALOGUE ACTUALLY USES — every one of them read off a mapper,
 * not guessed. `select("*")` was fetching 26 columns of mst_parties to map 11.
 * Measured: the catalogue drops from 2.1 MB to ~680 kB.
 *
 * ⚠ THE MAPPER IS THE CONTRACT. Every row here is typed `any`, so dropping a
 *   column the mapper reads produces `undefined` in the UI, silently, with no
 *   compiler error. If you change a mapper, change its line here in the same
 *   edit — and re-run the equivalence check (fetch both ways, map both, compare).
 *
 * ⚠ TWO OF THESE TABLES HAVE NO `name` COLUMN — mst_party_items and
 *   mst_company_locations. Asking for one is a "column does not exist" 400, not
 *   an empty field. mapMaster reads `r.name` on both anyway and gets undefined;
 *   the pair mapper then overwrites it with "".
 *
 * ⚠ `created_at` is carried on every line even though nothing maps it: the paged
 *   walk ORDERS by it, and ordering by a column outside the select list is not a
 *   guarantee worth resting a silent-truncation bug on.
 */
const COLS = {
  companies: "id,name,active,sort_order,created_at,alias,location,gstin,address,gate_pass_prefix",
  locations: "id,name,active,sort_order,created_at",
  companySites: "id,active,sort_order,created_at,location_id,company_id",
  partyItems: "id,active,sort_order,created_at,party_id,item_id",
  parties: "id,name,active,sort_order,created_at,company_id,code,location,gstin,contact_name,phone,email",
  items: "id,name,active,sort_order,created_at,code,unit_id,hsn_code,company_id,item_type",
  units: "id,name,created_at",
  /**
   * ONE COMPANY'S WHOLE STOCK BOOK — read only when the mapping modal opens.
   *
   * Narrower than COLS.items on purpose: the modal picks an item, it does not
   * render an order line, so the unit and the HSN are the picker's business
   * rather than this list's. `item_type` earns its place — it is the filter that
   * makes 8,340 rows usable.
   */
  companyItems: "id,name,active,sort_order,created_at,code,item_type",
} as const;

/**
 * CENTRAL MASTERS — customers and items live in mst_*, shared with every module.
 *
 * ⚠ THE `modules` TICK NO LONGER SCOPES THIS APP, and dropping it was the point
 *   of the change rather than an oversight.
 *
 *   The tick existed to keep a picker usable: mst_parties holds ~7,800 ledgers
 *   and mst_items ~14,200 stock items, so an unfiltered customer dropdown showed
 *   eight thousand names. But it also meant a customer Tally already knew about
 *   could not be ordered from until somebody remembered to tick it — and the
 *   list it produced (328 customers, 234 items) was one flat list regardless of
 *   which company was billing.
 *
 *   THE COMPANY DOES THAT JOB NOW, and does it better, because Tally already
 *   knows the answer: a firm has a separate ledger in every book it trades with,
 *   so `mst_parties.company_id` IS "which of our companies may bill this
 *   customer". Pick the company and the picker narrows to that book's own
 *   customers on its own, with no list to maintain.
 *
 *   What that costs was measured before it was written, not assumed:
 *     • customers — 1,850 rows in total, the largest single book 1,184
 *     • items — the picker can only ever offer what a customer↔item pair names,
 *       and there are 1,656 distinct items across all 8,555 pairs. Not 14,200.
 *     • every item on all 303 existing orders is inside that 1,656.
 *   So the whole thing still loads up front, in one wave, as it always did.
 */

/** Everything Dispatch reads is per-table and unfiltered except these two. */
async function fetchWhere(table: Tbl, extra: (q: any) => any, cols = "*"): Promise<any[]> {
  return pagedWalk((withCount) =>
    extra(db.from(table).select(cols, withCount ? { count: "exact" } : undefined))
      .order("created_at", { ascending: true })
      // The unique tiebreaker — see the note on fetchAll. mst_parties has 1,887
      // customers over 216 distinct timestamps, so page 2 starts inside a tie.
      .order("id", { ascending: true }),
  );
}

/**
 * Rows by id, chunked.
 *
 * `in` builds a query STRING, and a few thousand uuids exceeds what the gateway
 * accepts as one — so this is chunked for the same reason setMasterModules is.
 */
async function fetchByIds(table: Tbl, ids: string[], cols = "*"): Promise<any[]> {
  const CHUNK = 200;
  // ⚠ CONCURRENT, not one chunk after another. This wave cannot even START until
  //   the whole first wave has landed (it needs the item list), so its latency is
  //   added to the end of every load and every refresh — 1,693 items is nine
  //   chunks, ~0.7 s serial in a traced load, for requests of ~25 ms each. The
  //   chunking itself stays: `in` builds a query STRING and a few thousand uuids
  //   exceed what the gateway accepts as one.
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));

  const results = await Promise.all(
    chunks.map((c) => db.from(table).select(cols).in("id", c)),
  );
  const out: any[] = [];
  for (const { data, error } of results) {
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
  }
  return out;
}

/**
 * Just the item ids referenced by order lines — two narrow columns, not the row.
 *
 * The catalogue must contain every item ALREADY ON AN ORDER, not only the ones a
 * customer↔item pair names, or a line whose mapping was later switched off would
 * render blank (OrderLine carries `itemId` and no name). That arm used to come
 * free because the working set had already fetched every line; now the catalogue
 * is a separate query and has to ask for itself.
 *
 * ⚠ Ordered by `id`, not `created_at`. The paged walk needs a UNIQUE ordering and
 *   `created_at` is not one here — see the note on fetchAll. `id` is also one of
 *   the two columns being selected, which keeps the request honest.
 */
async function fetchOrderLineItemIds(): Promise<string[]> {
  const rows = await pagedWalk((withCount) =>
    db
      .from("fms_dispatch_order_items")
      .select("id,item_id", withCount ? { count: "exact" } : undefined)
      .order("id", { ascending: true }),
  );
  const out = new Set<string>();
  for (const r of rows as any[]) if (r.item_id) out.add(r.item_id);
  return [...out];
}

/**
 * The activity trail for ONE order, fetched when that order is opened.
 *
 * ⚠ IT USED TO RIDE IN THE SNAPSHOT, and that was 2,943 rows / 743 kB pulled on
 *   every load and again after every save — for a panel with exactly one reader,
 *   showing exactly one order. Master-request activity was fetched too and never
 *   displayed at all. A window (120 days) had already been put round it once to
 *   stop the bleeding; asking per order stops it properly.
 *
 * No paging: one order's trail is tens of rows, not thousands.
 */
export async function fetchOrderActivity(orderId: string): Promise<DispatchActivity[]> {
  const { data, error } = await db
    .from("fms_dispatch_activity")
    .select("*")
    .eq("entity_type", "order")
    .eq("entity_id", orderId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapActivity);
}

/** The react-query key for one order's trail. */
export const orderActivityQueryKey = (orderId: string) => ["dispatchOrderActivity", orderId] as const;

export interface DispatchConfig {
  processCoordinatorIds: string[];
  stepSla: StepSlaMap;
}

/** The react-query key. Keyed on the REAL session user id, shared with the adapter. */
export const DISPATCH_QK = ["orderToDispatchData"] as const;
export const dispatchQueryKey = (userId: string | null) => [...DISPATCH_QK, userId] as const;

/**
 * The catalogue's own key — NOT scoped to the user, because RLS on the mst_*
 * tables is `true` and everyone gets the same rows. One entry serves every tab
 * and every person on the machine.
 *
 * ⚠ `dispatchMasters` is also the name on the IndexedDB persistence allowlist in
 *   main.tsx. Renaming this key without renaming it there silently stops the
 *   catalogue being kept between visits — the symptom is a slow first load, not
 *   an error.
 */
export const DISPATCH_MASTERS_QK = ["dispatchMasters"] as const;

/**
 * One company's stock book — see `fetchCompanyItems`.
 *
 * ⚠ ITS OWN KEY, and NOT a child of DISPATCH_MASTERS_QK. Nesting it there would
 *   put every book behind `invalidateAll()`, so mapping one item would re-fetch
 *   8,340 rows to learn about the one that changed. Nothing invalidates this:
 *   a company's Tally book changes on the sync's schedule, not on ours, and the
 *   30-minute staleTime is the right granularity for that.
 */
export const COMPANY_ITEMS_QK = (companyId: string) =>
  ["dispatchCompanyItems", companyId] as const;

/**
 * The LIVE working set — everything a save can change.
 *
 * ⚠ The catalogue (companies / customers / items / pairs) deliberately is NOT
 *   here: it is `DispatchMasters`, on its own key, so a write stops dragging
 *   ~2 MB of ledgers behind it. Putting an mst_* field back on this interface
 *   undoes the whole split.
 */
export interface DispatchData {
  stepOwners: StepOwner[];
  designations: Designation[];
  config: DispatchConfig;

  masterManagers: MasterManager[];
  masterRequests: DispatchMasterRequest[];
  orders: DispatchOrder[];

  notifications: DispatchNotification[];
  /** The next order number that will be issued (preview — does not consume it). */
  orderNoPreview: string;
}

const num = (v: any): number | null => (v === null || v === undefined || v === "" ? null : Number(v));
const str = (v: any): string | null => (v === null || v === undefined || v === "" ? null : String(v));

/**
 * The receiver copy's extra pages (`dc_attachment_pages`), normalised to an
 * array so nothing downstream tests for two spellings of "nothing".
 *
 * The column is nullable jsonb and holds NULL — not `[]` — when there are no
 * extra pages, which is also what every row written before the column existed
 * holds. Entries without a usable `path` are dropped rather than rendered as a
 * link to nowhere; PostgREST hands jsonb back already parsed, but the defensive
 * shape check costs nothing and this is the one field the server does not
 * type-check per element.
 */
const docs = (v: any): StepDoc[] =>
  Array.isArray(v)
    ? v
        .filter((d) => d && typeof d.path === "string" && d.path !== "")
        .map((d) => ({ path: String(d.path), name: String(d.name ?? d.path) }))
    : [];

const mapMaster = (r: any): NamedMaster => ({
  id: r.id, name: r.name, active: r.active, sortOrder: r.sort_order ?? 0,
});

const mapCustomer = (r: any): Customer => ({
  ...mapMaster(r),
  companyId: r.company_id ?? null,
  code: str(r.code), location: str(r.location), gstin: str(r.gstin),
  contactName: str(r.contact_name), phone: str(r.phone), email: str(r.email),
});

const mapMasterManager = (r: any): MasterManager => ({
  id: r.id, masterType: r.master_type as DispatchMasterType, managerUserId: r.manager_user_id,
});

const mapMasterRequest = (r: any): DispatchMasterRequest => ({
  id: r.id,
  masterType: r.master_type as DispatchMasterType,
  proposedPayload: (r.proposed_payload ?? {}) as Record<string, unknown>,
  status: r.status,
  requestedBy: r.requested_by ?? null,
  reviewedBy: r.reviewed_by ?? null,
  reviewNote: r.review_note ?? null,
  resolvedMasterId: r.resolved_master_id ?? null,
  createdAt: r.created_at,
});

const mapLine = (r: any): OrderLine => ({
  id: r.id,
  orderId: r.order_id,
  lineNo: r.line_no,
  itemId: r.item_id,
  quantity: Number(r.quantity ?? 0),
  unit: str(r.unit),
  lineRemark: str(r.line_remark),
  dispatchedQty: Number(r.dispatched_qty ?? 0),
  shipQty: num(r.ship_qty),
  lotNo: str(r.lot_no),
});

const mapRoundItem = (r: any): RoundItem => ({
  id: r.id,
  roundId: r.round_id,
  orderItemId: r.order_item_id ?? null,
  lineNo: r.line_no,
  itemId: r.item_id ?? null,
  itemName: r.item_name ?? "Item",
  unitName: str(r.unit_name),
  orderedQty: Number(r.ordered_qty ?? 0),
  shipQty: Number(r.ship_qty ?? 0),
  lotNo: str(r.lot_no),
});

const mapRound = (r: any): DispatchRound => ({
  id: r.id,
  orderId: r.order_id,
  roundNo: r.round_no,
  roundStartedAt: r.round_started_at ?? null,
  companyId: r.company_id ?? null,
  locationId: r.location_id ?? null,

  ccStatus: r.cc_status ?? null,
  ccApprovedQty: num(r.cc_approved_qty),
  ccRemarks: str(r.cc_remarks),
  ccAt: r.cc_at ?? null,
  ccBy: r.cc_by ?? null,

  msActualDate: r.ms_actual_date ?? null,
  msTempoNo: str(r.ms_tempo_no),
  msPorter: r.ms_porter ?? null,
  msRemarks: str(r.ms_remarks),
  msAt: r.ms_at ?? null,
  msBy: r.ms_by ?? null,

  sbActualDate: r.sb_actual_date ?? null,
  sbInvoiceNo: str(r.sb_invoice_no),
  sbAttachmentPath: str(r.sb_attachment_path),
  sbAttachmentName: str(r.sb_attachment_name),
  sbEwayPath: str(r.sb_eway_path),
  sbEwayName: str(r.sb_eway_name),
  sbRemarks: str(r.sb_remarks),
  sbAt: r.sb_at ?? null,
  sbBy: r.sb_by ?? null,
  sbHoldAt: r.sb_hold_at ?? null,
  sbHoldReason: str(r.sb_hold_reason),
  sbHoldBy: r.sb_hold_by ?? null,
  gpNo: str(r.gp_no),

  goActualDate: r.go_actual_date ?? null,
  goOutwardNo: str(r.go_outward_no),
  goRemarks: str(r.go_remarks),
  goAt: r.go_at ?? null,
  goBy: r.go_by ?? null,

  dcActualDate: r.dc_actual_date ?? null,
  dcStatus: r.dc_status ?? null,
  dcAttachmentPath: str(r.dc_attachment_path),
  dcAttachmentName: str(r.dc_attachment_name),
  dcAttachmentPages: docs(r.dc_attachment_pages),
  dcRemarks: str(r.dc_remarks),
  dcAt: r.dc_at ?? null,
  dcBy: r.dc_by ?? null,

  editedAt: r.edited_at ?? null,
  editedBy: r.edited_by ?? null,
  amendedAt: r.amended_at ?? null,
  amendedBy: r.amended_by ?? null,
  amendReason: str(r.amend_reason),
  archivedReason: r.archived_reason ?? "looped",
  archivedAt: r.archived_at,

  items: [],
});

const mapOrder = (r: any): DispatchOrder => ({
  id: r.id,
  orderNo: r.order_no,

  dispatchType: r.dispatch_type,
  companyId: r.company_id ?? null,
  locationId: r.location_id ?? null,
  customerId: r.customer_id,
  customerLocation: str(r.customer_location),
  customerPoNo: str(r.customer_po_no),
  orderDate: r.order_date,
  orderRemarks: str(r.order_remarks),

  raisedBy: r.raised_by ?? null,
  requesterName: r.requester_name,
  status: r.status,
  currentStep: r.current_step,
  submittedAt: r.submitted_at,
  updatedAt: r.updated_at,

  roundNo: Number(r.round_no ?? 1),
  roundStartedAt: r.round_started_at ?? r.submitted_at,

  ccStatus: r.cc_status ?? null,
  ccRemarks: str(r.cc_remarks),
  ccApprovedQty: num(r.cc_approved_qty),
  ccRoundNo: num(r.cc_round_no),
  ccDecidedAt: r.cc_decided_at ?? null,
  ccDecidedBy: r.cc_decided_by ?? null,
  ccAt: r.cc_at ?? null,
  ccBy: r.cc_by ?? null,
  ccEditedAt: r.cc_edited_at ?? null,
  ccEditedBy: r.cc_edited_by ?? null,

  msActualDate: r.ms_actual_date ?? null,
  msTempoNo: str(r.ms_tempo_no),
  msPorter: r.ms_porter ?? null,
  msRemarks: str(r.ms_remarks),
  msAt: r.ms_at ?? null,
  msBy: r.ms_by ?? null,

  sbActualDate: r.sb_actual_date ?? null,
  sbInvoiceNo: str(r.sb_invoice_no),
  sbAttachmentPath: str(r.sb_attachment_path),
  sbAttachmentName: str(r.sb_attachment_name),
  sbEwayPath: str(r.sb_eway_path),
  sbEwayName: str(r.sb_eway_name),
  sbRemarks: str(r.sb_remarks),
  sbAt: r.sb_at ?? null,
  sbBy: r.sb_by ?? null,
  sbHoldAt: r.sb_hold_at ?? null,
  sbHoldReason: str(r.sb_hold_reason),
  sbHoldBy: r.sb_hold_by ?? null,
  gpNo: str(r.gp_no),

  goActualDate: r.go_actual_date ?? null,
  goOutwardNo: str(r.go_outward_no),
  goRemarks: str(r.go_remarks),
  goAt: r.go_at ?? null,
  goBy: r.go_by ?? null,

  dcActualDate: r.dc_actual_date ?? null,
  dcStatus: r.dc_status ?? null,
  dcAttachmentPath: str(r.dc_attachment_path),
  dcAttachmentName: str(r.dc_attachment_name),
  dcAttachmentPages: docs(r.dc_attachment_pages),
  dcRemarks: str(r.dc_remarks),
  dcAt: r.dc_at ?? null,
  dcBy: r.dc_by ?? null,

  closedAt: r.closed_at ?? null,
  closedReason: str(r.closed_reason),
  closedBy: r.closed_by ?? null,

  editedAt: r.edited_at ?? null,
  editedBy: r.edited_by ?? null,
  holdAt: r.hold_at ?? null,
  holdReason: str(r.hold_reason),
  cancelledAt: r.cancelled_at ?? null,
  cancelReason: str(r.cancel_reason),

  // Every one of these defaults, so the app loads cleanly against a database
  // that has not had 20260827120000 applied yet. That is what lets the frontend
  // ship FIRST — the reverse order would let the new RPC write a status this
  // build has never heard of, and `status` below is an unvalidated passthrough.
  cancelRequestedAt: r.cancel_requested_at ?? null,
  cancelRequestedBy: r.cancel_requested_by ?? null,
  srRoundNo: num(r.sr_round_no),
  srInvoiceNo: str(r.sr_invoice_no),
  srInvoiceAt: r.sr_invoice_at ?? null,
  srInvoiceDate: r.sr_invoice_date ?? null,
  srEwayExpected: r.sr_eway_expected ?? null,
  srMode: r.sr_mode ?? null,
  srReferenceNo: str(r.sr_reference_no),
  srActualDate: r.sr_actual_date ?? null,
  srRemarks: str(r.sr_remarks),
  srAttachmentPath: str(r.sr_attachment_path),
  srAttachmentName: str(r.sr_attachment_name),
  srAt: r.sr_at ?? null,
  srBy: r.sr_by ?? null,
  srEditedAt: r.sr_edited_at ?? null,
  srEditedBy: r.sr_edited_by ?? null,

  createdAt: r.created_at,
  lines: [],
  rounds: [],
});

const mapStepOwner = (r: any): StepOwner => ({
  id: r.id,
  stepKey: r.step_key,
  locationId: r.location_id ?? null,
  departmentIds: (r.department_ids ?? []) as string[],
  designationId: r.designation_id ?? null,
  employeeIds: (r.employee_ids ?? []) as string[],
});

const mapDesignation = (r: any): Designation => ({ id: r.id, name: r.name });

const mapActivity = (r: any): DispatchActivity => ({
  id: r.id,
  entityType: r.entity_type,
  entityId: r.entity_id,
  type: r.type,
  actorId: r.actor_id ?? null,
  note: str(r.note),
  meta: (r.meta ?? {}) as Record<string, unknown>,
  createdAt: r.created_at,
});

const mapNotification = (r: any): DispatchNotification => ({
  id: r.id,
  userId: r.user_id,
  type: r.type,
  entityType: r.entity_type,
  entityId: r.entity_id,
  text: r.text,
  actorId: r.actor_id ?? null,
  readAt: r.read_at ?? null,
  createdAt: r.created_at,
});

/**
 * ⚠ THE ARGUMENT IS REACT-QUERY'S OWN CONTEXT, so all three call sites can keep
 *   passing `queryFn: fetchDispatchData` untouched. The only thing read from it
 *   is the user id, which `dispatchQueryKey` already puts in the key — see the
 *   notifications read below for why it is worth having.
 */
/** The catalogue the order form picks from. Split out of the working set so a
 *  save stops re-downloading it — see fetchDispatchMasters below. */
export interface DispatchMasters {
  companies: Company[];
  companyLocations: CompanyLocation[];
  customers: Customer[];
  items: Item[];
  customerItems: CustomerItem[];
}

/**
 * THE CATALOGUE — customers, items and the pairs that join them.
 *
 * ⚠ ITS OWN QUERY, AND THAT IS THE WHOLE POINT. It used to ride inside
 *   fetchDispatchData, so every write — all 23 of them — invalidated it and
 *   pulled ~2 MB of ledgers and stock items back down to learn that a Tally bill
 *   number had been typed. Saving a bill cannot change who the customers are.
 *   Now it is keyed separately, refreshed on a 30-minute timer rather than by
 *   saves, and persisted to IndexedDB so a reload does not re-fetch it either.
 *
 * ⚠ NOT KEYED ON THE USER. RLS on the mst_* tables is `true` — every signed-in
 *   person gets the same catalogue — so one cache entry serves everybody and a
 *   second tab reuses the first one's copy.
 *
 * ⚠ ONLY FOUR WRITES MAY INVALIDATE THIS: insertMaster / insertMasters /
 *   updateMaster (they write mst_* directly) and resolveMasterRequest (approving
 *   creates the ledger). See store.tsx. Anything else invalidating this is a bug
 *   — it is what the split exists to prevent.
 */
export async function fetchDispatchMasters(): Promise<DispatchMasters> {
  const [companies, locations, companySites, customerItems, customers, units, orderLineItemIds] =
    await Promise.all([
      // ALL of them, deliberately un-filtered by `modules`. Unlike parties and
      // items, where Tally holds thousands and the tick is the only thing making
      // a picker usable, there are five companies. A new one should appear on its
      // own rather than waiting for somebody to remember to tick it.
      fetchAll("mst_companies", "created_at", COLS.companies),
      fetchAll("mst_locations", "created_at", COLS.locations),
      fetchAll("mst_company_locations", "created_at", COLS.companySites),
      // ⚠ THE CATALOGUE IS FETCHED FIRST BECAUSE IT DECIDES THE ITEM LIST. Every
      //   item the order form can offer is one a pair names; nothing else is
      //   reachable. 8,052 rows of two uuids — cheaper than the item rows it saves.
      fetchAll("mst_party_items", "created_at", COLS.partyItems),
      // EVERY customer ledger, all 1,887 of them. The company narrows them on the
      // form; there is no list to tick any more.
      fetchWhere("mst_parties", (q) => q.eq("is_customer", true), COLS.parties),
      fetchAll("mst_units", "created_at", COLS.units),
      fetchOrderLineItemIds(),
    ]);

  const unitNameById = new Map<string, string>(units.map((u: any) => [u.id, u.name]));
  const customerIds = new Set<string>(customers.map((c: any) => c.id));

  /**
   * THE ITEM LIST, DERIVED RATHER THAN TICKED.
   *
   * Two sources, and the second is not optional:
   *   • every item a customer↔item pair names — what the picker may offer;
   *   • every item ALREADY ON AN ORDER — what the app must be able to render.
   *
   * The second exists because a pair can be switched off after an order was
   * raised. The item would then vanish from this list, and the order's line
   * would render as a blank in the queue, on the gate pass and in the export —
   * "deleted" dressed up as an empty cell.
   *
   * ⚠ THE SECOND ARM IS WHY THIS QUERY READS AN fms_ TABLE AT ALL. It costs one
   *   narrow column of fms_dispatch_order_items (see fetchOrderLineItemIds) and
   *   it is the reason the catalogue can be stale for half an hour without an
   *   order line rendering blank. The store carries a self-heal for the case
   *   this cannot cover: an item mapped AFTER this snapshot was taken.
   */
  const wantedItemIds = new Set<string>(orderLineItemIds);
  for (const r of customerItems as any[]) {
    if (customerIds.has(r.party_id)) wantedItemIds.add(r.item_id);
  }
  const items = await fetchByIds("mst_items", [...wantedItemIds], COLS.items);
  const itemIds = new Set<string>(items.map((i: any) => i.id));

  return {
    /**
     * ⚠ THE NAME SHOWN IS THE ALIAS, NEVER mst_companies.name.
     *   `name` is Tally's book name — "ORANGE O TEC PRIVATE LIMITED
     *   (01-04-25TO31-03-27)" — which the sync rewrites and which is re-minted
     *   every April. It reaches a driver at the gate: printGatePass puts the
     *   billing company in the masthead. `alias` is the human's label and no
     *   sync touches it.
     *
     *   The city is appended because Tally keeps a separate book per site, so
     *   "O-tec" alone names two of the five rows and the picker would show the
     *   same word twice with no way to tell them apart.
     */
    companies: companies.map((r): Company => ({
      ...mapMaster(r),
      name: [str(r.alias) || r.name, str(r.location)].filter(Boolean).join(" — "),
      gstin: str(r.gstin), address: str(r.address),
      gatePassPrefix: str(r.gate_pass_prefix),
    })),
    /**
     * A SITE IS A PLACE, AND SEVERAL COMPANIES DISPATCH FROM IT.
     *
     * It used to be one row per (company, site) — NOIDA twice, SURAT-HOJIWALA
     * twice, SURAT-SACHIN twice — so a single `companyId` was enough. The
     * duplication carried no information (every step's owners were identical
     * across both copies) and it meant a new company added three rows to retype.
     * Now there are three sites and a separate list of who dispatches from each,
     * so this carries `companyIds`.
     */
    companyLocations: (() => {
      const byLocation = new Map<string, string[]>();
      for (const cs of companySites as any[]) {
        if (cs.active === false) continue;
        const arr = byLocation.get(cs.location_id);
        if (arr) arr.push(cs.company_id);
        else byLocation.set(cs.location_id, [cs.company_id]);
      }
      return locations.map((r): CompanyLocation => ({
        ...mapMaster(r), companyIds: byLocation.get(r.id) ?? [],
      }));
    })(),
    /**
     * ⚠ `companyId` IS CARRIED AGAIN, and it now means something real.
     *
     *   It was dropped when the masters moved: in Dispatch's own table it had
     *   meant "which of our companies bills this customer" and was filled on 1
     *   of 327 rows, while on mst_parties the same name means Tally's company
     *   BOOK — a different set of ids entirely, which the old 2-row company list
     *   could only render as a blank.
     *
     *   The company list is now Tally's own, so the two agree. And a firm having
     *   a separate ledger in every book it trades with is exactly the fact the
     *   order form needs: this column IS "which of our companies may bill this
     *   customer", kept up to date by the sync rather than by hand.
     */
    customers: customers.map(mapCustomer),
    items: items.map((r): Item => ({
      ...mapMaster(r), code: str(r.code),
      // mst_items points at mst_units; Dispatch's Item carries the unit's NAME.
      unit: unitNameById.get(r.unit_id) ?? "",
      hsnCode: str(r.hsn_code),
      companyId: r.company_id ?? null,
      itemType: str(r.item_type),
    })),
    /**
     * The customer-item catalogue, now shared.
     *
     * Two sources feed it: the pairs Dispatch maintains by hand, and the pairs
     * derived from Tally's sales register (what a customer has ACTUALLY bought).
     * Both live in mst_party_items, so a customer's picker is richer than it was.
     *
     * ⚠ Filtered to this module's masters. The table holds every party-item pair
     *   in the business; a pair whose item is not ticked into Dispatch must not
     *   appear in a Dispatch picker, and `itemsForCustomer` intersects with the
     *   item list anyway — this just avoids carrying thousands of dead rows.
     */
    customerItems: customerItems
      .filter((r: any) => customerIds.has(r.party_id) && itemIds.has(r.item_id))
      .map((r: any): CustomerItem => ({
        ...mapMaster(r), name: "", customerId: r.party_id, itemId: r.item_id,
      })),

  };
}

/**
 * EVERY ITEM IN ONE COMPANY'S TALLY BOOK — the mapping modal's own source.
 *
 * ⚠ IT CANNOT READ THE STORE, and that is the whole reason this exists.
 *   `fetchDispatchMasters` DERIVES its item list from the pairs in
 *   mst_party_items (see the note there): 1,693 items out of 14,264. An item
 *   nobody has mapped to anybody is not in it — which is precisely the item
 *   somebody opens the mapping modal to find. Filtering the store's list by
 *   company would offer a subset of a subset and quietly answer "not in Tally"
 *   about items that are.
 *
 * ⚠ NOT PART OF THE CATALOGUE QUERY, deliberately. This is per-company and
 *   O-tec — Surat alone is 8,340 rows; folding it into fetchDispatchMasters
 *   would put all five books behind every module load. Its own react-query key,
 *   fetched the first time a modal asks for that company and then cached.
 *
 * ⚠ NOT FILTERED ON `modules`. Only 540 of the 14,264 active items carry the
 *   order-to-dispatch tick and 13,724 carry no modules at all, so that filter
 *   would collapse the book to a few hundred rows and defeat the feature. The
 *   company IS the filter here.
 *
 * Sizes, measured: Colorix 254 · Enterprise-Surat 1,450 · Enterprise-Noida 2,092
 * · O-tec-Noida 2,125 · O-tec-Surat 8,340. pagedWalk fires its pages
 * concurrently, so the largest is one round trip rather than nine.
 */
export async function fetchCompanyItems(companyId: string): Promise<CompanyItem[]> {
  if (!companyId) return [];
  const rows = await fetchWhere(
    "mst_items",
    (q) => q.eq("company_id", companyId).eq("active", true),
    COLS.companyItems,
  );
  return rows
    .map((r: any): CompanyItem => ({
      id: r.id,
      name: str(r.name) ?? "",
      code: str(r.code),
      itemType: str(r.item_type),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function fetchDispatchData(
  ctx?: { queryKey?: readonly unknown[] },
): Promise<DispatchData> {
  const forUser = typeof ctx?.queryKey?.[1] === "string" ? (ctx.queryKey[1] as string) : null;

  // 10 names, 10 calls. Keep them in step.
  //
  // ⚠ THE CATALOGUE IS NO LONGER HERE — it is fetchDispatchMasters, on its own
  //   key. This list is the LIVE working set, and it is what a save invalidates.
  //   Adding an mst_* read back into it would put ~2 MB behind every write again.
  const [
    stepOwners, configRows, designations,
    masterManagers, masterRequests,
    orders, orderItems, rounds, roundItems,
    notifications,
  ] = await Promise.all([
    fetchAll("fms_dispatch_step_owners"),
    fetchAll("fms_dispatch_config", "key"),
    fetchAll("designations"),
    fetchAll("fms_dispatch_master_managers"),
    fetchAll("fms_dispatch_master_requests"),
    fetchAll("fms_dispatch_orders", "submitted_at"),
    fetchAll("fms_dispatch_order_items"),
    fetchAll("fms_dispatch_rounds", "archived_at"),
    fetchAll("fms_dispatch_round_items"),
    // ⚠ THIS PERSON'S BELL, NOT EVERYONE'S. The store throws away every row whose
    //   user_id is not the signed-in user (`mineNotifications`), so fetching the
    //   whole table only ever cost bandwidth — and it cost the most for an admin,
    //   whose RLS lets all 5,296 rows through where a normal user sees ~400. Same
    //   rows reach the UI either way; four fifths of the payload does not.
    forUser
      ? fetchWhere("fms_dispatch_notifications", (q: any) => q.eq("user_id", forUser))
      : fetchAll("fms_dispatch_notifications"),
  ]);


  const byKey = new Map<string, any>(configRows.map((r) => [r.key, r.value ?? {}]));
  const config: DispatchConfig = {
    processCoordinatorIds: (byKey.get("process_coordinators")?.user_ids ?? []) as string[],
    stepSla: resolveStepSla(byKey.get("step_sla")),
  };

  // Group the lines onto their orders in memory (see the header note).
  const linesByOrder = new Map<string, OrderLine[]>();
  for (const raw of orderItems) {
    const line = mapLine(raw);
    const arr = linesByOrder.get(line.orderId);
    if (arr) arr.push(line);
    else linesByOrder.set(line.orderId, [line]);
  }
  for (const arr of linesByOrder.values()) arr.sort((a, b) => a.lineNo - b.lineNo);

  // Same for the round archive: round items onto rounds, rounds onto orders.
  const itemsByRound = new Map<string, RoundItem[]>();
  for (const raw of roundItems) {
    const ri = mapRoundItem(raw);
    const arr = itemsByRound.get(ri.roundId);
    if (arr) arr.push(ri);
    else itemsByRound.set(ri.roundId, [ri]);
  }
  for (const arr of itemsByRound.values()) arr.sort((a, b) => a.lineNo - b.lineNo);

  const roundsByOrder = new Map<string, DispatchRound[]>();
  for (const raw of rounds) {
    const r = mapRound(raw);
    r.items = itemsByRound.get(r.id) ?? [];
    const arr = roundsByOrder.get(r.orderId);
    if (arr) arr.push(r);
    else roundsByOrder.set(r.orderId, [r]);
  }
  for (const arr of roundsByOrder.values()) arr.sort((a, b) => a.roundNo - b.roundNo);

  const mappedOrders = orders.map((r) => {
    const o = mapOrder(r);
    o.lines = linesByOrder.get(o.id) ?? [];
    o.rounds = roundsByOrder.get(o.id) ?? [];
    return o;
  });

  // The next order number to be issued (preview — does not consume the counter).
  const { data: orderPeek } = await db.rpc("fms_dispatch_peek_order_no");

  return {
    stepOwners: stepOwners.map(mapStepOwner),
    designations: designations.map(mapDesignation),
    config,

    masterManagers: masterManagers.map(mapMasterManager),
    masterRequests: masterRequests.map(mapMasterRequest),
    orders: mappedOrders,

    notifications: notifications.map(mapNotification),
    orderNoPreview: (orderPeek as string) ?? "",
  };
}

/* ===========================================================================
 * THE INCREMENTAL REFRESH — "what changed since I last looked?"
 *
 * A save used to re-download the module's whole working set: 2.9 MB and 11
 * requests, to learn that one order moved a step. This asks for the changed
 * orders instead.
 *
 * ⚠ IT RECONCILES AGAINST A LIST OF IDS, NOT JUST A TIMESTAMP, AND THAT IS AN
 *   ACCESS-CONTROL REQUIREMENT RATHER THAN TIDINESS. fms_dispatch_update_order
 *   can change an order's location_id, which can move the order OUT of this
 *   user's visibility. A watermark-only delta would simply never mention that
 *   order again and the stale copy would sit in their queue for the rest of the
 *   session — an order they are no longer allowed to see. Asking for every
 *   visible id (483 rows of id + timestamp, ~25 kB) means anything absent is
 *   dropped, and deletions come out in the wash too.
 *
 * ⚠ IT RESTS ON A TRIGGER. Children — lines, rounds, round items — do not carry
 *   a usable timestamp of their own (fms_dispatch_rounds has none at all), so
 *   migration 20260926120000 bumps the parent order's updated_at when a child
 *   moves. Without it this silently misses line edits: 447 rows were already
 *   newer than their parent when that was measured.
 *
 * ⚠ ONLY FOR POST-WRITE REFRESHES. A refetch caused by mount or staleness still
 *   does the full fetch, which keeps a cheap regular re-anchor to the truth.
 * ======================================================================== */

/** Orders whose children are re-read wholesale, so a DELETED line disappears. */
async function fetchOrderChildren(orderIds: string[]) {
  if (!orderIds.length) return { orderItems: [], rounds: [], roundItems: [] };
  const inList = (col: string) => (q: any) => q.in(col, orderIds);

  const [orderItems, rounds] = await Promise.all([
    fetchWhere("fms_dispatch_order_items", inList("order_id")),
    pagedWalk((withCount) =>
      db.from("fms_dispatch_rounds")
        .select("*", withCount ? { count: "exact" } : undefined)
        .in("order_id", orderIds)
        .order("id", { ascending: true })),
  ]);
  const roundIds = (rounds as any[]).map((r) => r.id);
  const roundItems = roundIds.length
    ? await pagedWalk((withCount) =>
        db.from("fms_dispatch_round_items")
          .select("*", withCount ? { count: "exact" } : undefined)
          .in("round_id", roundIds)
          .order("id", { ascending: true }))
    : [];
  return { orderItems, rounds, roundItems };
}

export async function fetchDispatchDelta(
  prev: DispatchData,
  forUser: string | null,
): Promise<DispatchData> {
  /*
    ⚠ ONLY THE ORDERS ARE INCREMENTAL. Everything else here is re-read whole, on
      purpose: orders and their children were 2,857 kB of the 2,928 kB a refresh
      cost, and the rest is small enough that delta-ing it would buy noise and
      cost correctness. Setup rows, master requests and the bell all change on
      writes of their own, and each of those writes goes through this same path —
      so they must come back fresh or a Setup save would appear not to save.
  */
  const [stepOwners, configRows, designations, masterManagers, masterRequests, notifications, stamps] =
    await Promise.all([
      fetchAll("fms_dispatch_step_owners"),
      fetchAll("fms_dispatch_config", "key"),
      fetchAll("designations"),
      fetchAll("fms_dispatch_master_managers"),
      fetchAll("fms_dispatch_master_requests"),
      forUser
        ? fetchWhere("fms_dispatch_notifications", (q: any) => q.eq("user_id", forUser))
        : fetchAll("fms_dispatch_notifications"),
      // Every order id this user may see, with its stamp. The cheap part.
      pagedWalk((withCount) =>
        db.from("fms_dispatch_orders")
          .select("id,updated_at", withCount ? { count: "exact" } : undefined)
          .order("id", { ascending: true })),
    ]);

  const byKey = new Map<string, any>(configRows.map((r) => [r.key, r.value ?? {}]));
  const rest = {
    stepOwners: stepOwners.map(mapStepOwner),
    designations: designations.map(mapDesignation),
    config: {
      processCoordinatorIds: (byKey.get("process_coordinators")?.user_ids ?? []) as string[],
      stepSla: resolveStepSla(byKey.get("step_sla")),
    },
    masterManagers: masterManagers.map(mapMasterManager),
    masterRequests: masterRequests.map(mapMasterRequest),
    notifications: notifications.map(mapNotification),
  };

  const visible = new Map<string, string>();
  for (const r of stamps as any[]) visible.set(r.id, r.updated_at);

  const held = new Map(prev.orders.map((o) => [o.id, o]));
  const changed: string[] = [];
  for (const [id, stamp] of visible) {
    const have = held.get(id);
    if (!have || have.updatedAt !== stamp) changed.push(id);
  }

  // Nothing moved and nothing vanished: keep the same order array so the queues
  // do not re-render, but still take the freshly-read rest.
  if (!changed.length && visible.size === held.size) {
    const { data: peek } = await db.rpc("fms_dispatch_peek_order_no");
    return { ...prev, ...rest, orderNoPreview: (peek as string) ?? prev.orderNoPreview };
  }

  // 2. Only the orders that moved, and only their children.
  const [rows, children] = await Promise.all([
    changed.length
      ? fetchWhere("fms_dispatch_orders", (q: any) => q.in("id", changed))
      : Promise.resolve([]),
    fetchOrderChildren(changed),
  ]);

  const linesByOrder = new Map<string, OrderLine[]>();
  for (const raw of children.orderItems as any[]) {
    const line = mapLine(raw);
    const arr = linesByOrder.get(line.orderId);
    if (arr) arr.push(line); else linesByOrder.set(line.orderId, [line]);
  }
  for (const arr of linesByOrder.values()) arr.sort((a, b) => a.lineNo - b.lineNo);

  const itemsByRound = new Map<string, RoundItem[]>();
  for (const raw of children.roundItems as any[]) {
    const ri = mapRoundItem(raw);
    const arr = itemsByRound.get(ri.roundId);
    if (arr) arr.push(ri); else itemsByRound.set(ri.roundId, [ri]);
  }
  for (const arr of itemsByRound.values()) arr.sort((a, b) => a.lineNo - b.lineNo);

  const roundsByOrder = new Map<string, DispatchRound[]>();
  for (const raw of children.rounds as any[]) {
    const r = mapRound(raw);
    r.items = itemsByRound.get(r.id) ?? [];
    const arr = roundsByOrder.get(r.orderId);
    if (arr) arr.push(r); else roundsByOrder.set(r.orderId, [r]);
  }
  for (const arr of roundsByOrder.values()) arr.sort((a, b) => a.roundNo - b.roundNo);

  for (const raw of rows as any[]) {
    const o = mapOrder(raw);
    o.lines = linesByOrder.get(o.id) ?? [];
    o.rounds = roundsByOrder.get(o.id) ?? [];
    held.set(o.id, o);
  }

  // 3. Drop anything no longer visible — see the access-control note above.
  for (const id of [...held.keys()]) if (!visible.has(id)) held.delete(id);

  /*
    ⚠ SORTED BY (submitted_at, id) — THE SAME TOTAL ORDER THE FULL FETCH ASKS FOR.
      fetchAll("fms_dispatch_orders", "submitted_at") appends `id` as the unique
      tiebreaker, and the delta has to agree or two orders sharing a timestamp
      would swap places whenever a refresh switched between the two paths — a list
      that reshuffles itself for no reason the reader can see. There are no ties
      today (486 stamps for 486 orders); this is here so there never can be.
  */
  const orders = [...held.values()].sort(
    (a, b) => a.submittedAt.localeCompare(b.submittedAt) || a.id.localeCompare(b.id),
  );

  // The preview advances when an order is raised, so it cannot be carried over
  // from `prev` — raising an order and going straight back to the form would
  // otherwise offer the number that was just consumed.
  const { data: orderPeek } = await db.rpc("fms_dispatch_peek_order_no");

  return { ...prev, ...rest, orders, orderNoPreview: (orderPeek as string) ?? prev.orderNoPreview };
}
