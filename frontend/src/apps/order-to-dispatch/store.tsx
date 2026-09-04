import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { useDirectory } from "@/core/platform/store";
import { fetchOrgPeople } from "@/core/platform/orgPeople";
import { CUSTOMER_ACTORS_QK, fetchCustomerOrderActors } from "./data/customerOrgs";
import type { Department as OrgDepartment, Profile } from "@/core/platform/types";
import {
  DISPATCH_QK, DISPATCH_MASTERS_QK, fetchDispatchData, fetchDispatchMasters, dispatchQueryKey,
  fetchOrderActivity, orderActivityQueryKey, fetchDispatchDelta, type DispatchData,
} from "./data/dispatchFetch";
import {
  announce as announceWrite,
  amendRound as amendRoundWrite,
  cancelOrder as cancelOrderWrite,
  closeOrder as closeOrderWrite,
  holdOrder as holdOrderWrite,
  holdSalesBill as holdSalesBillWrite,
  insertMaster as insertMasterWrite,
  insertMasters as insertMastersWrite,
  mapCustomerItems as mapCustomerItemsWrite,
  markNotificationsRead as markNotificationsReadWrite,
  materialNothingAvailable as materialNothingAvailableWrite,
  recordSalesReturn as recordSalesReturnWrite,
  recordStep as recordStepWrite,
  requestNewMaster as requestNewMasterWrite,
  resolveMasterRequest as resolveMasterRequestWrite,
  setConfig as setConfigWrite,
  reassignStep as reassignStepWrite,
  setMasterManagers as setMasterManagersWrite,
  setStepOwner as setStepOwnerWrite,
  deleteStepOwner as deleteStepOwnerWrite,
  stepDocumentUrl as stepDocumentUrlWrite,
  submitOrder as submitOrderWrite,
  updateMaster as updateMasterWrite,
  updateOrder as updateOrderWrite,
  updateSalesReturn as updateSalesReturnWrite,
  updateStep as updateStepWrite,
  uploadStepDocument as uploadStepDocumentWrite,
  withdrawCancelRequest as withdrawCancelRequestWrite,
  type AmendRoundLine,
  type MapCustomerItemResult,
  type MasterInput,
  type OrderInput,
  type SalesReturnPayload,
  type StepOwnerInput,
  type StepPayload,
} from "./data/dispatchWrites";
import {
  buildQueueEntries,
  completedFor as completedForPure,
  dispatchDueIso,
  dispatchSnapshotFrom,
  isOpenOrder,
  type DispatchSnapshot,
  type QueueEntry,
  type QueueStep,
  type StageEntry,
} from "./lib/queues";
import { describePayload, masterTypeLabel } from "./lib/masterFields";
import { isSalesReturnDone, isSalesReturnPending } from "./lib/salesReturn";
import { DEFAULT_STEP_SLA, type StepSlaMap } from "./lib/sla";
import type { OwnerStepKey } from "./lib/steps";
import type {
  Company, CompanyLocation, Customer, Designation, DispatchActivity, DispatchMasterRequest,
  CustomerItem, DispatchMasterType, DispatchNotification, DispatchOrder, Item, MasterManager, NamedMaster, StepDoc, StepOwner, } from "./types";

const QK = DISPATCH_QK;

export interface DispatchStoreValue {
  isLoading: boolean;
  /**
   * A refresh is in flight over data we ALREADY have. Distinct from `isLoading`,
   * which is only true on the very first load.
   *
   * ⚠ A screen that looks up one row by id must consult this before declaring
   *   the row missing. Writes no longer wait for the refetch (see `invalidate`
   *   below), so for a moment after a save the row can be real in the database
   *   and absent from the cache — and `isLoading` is FALSE throughout, because
   *   there is cached data. See OrderDetail.
   */
  isFetching: boolean;
  error: unknown;

  // identity / capability
  userId: string;
  isAdmin: boolean;
  isProcessCoordinator: boolean;
  /**
   * Does this person's grant on Order to Dispatch allow CHANGING anything? False
   * only on a view-only grant (Admin → Module Access).
   *
   * ⚠ A CEILING, never a permission — it grants nothing and only takes away. Kept
   *   OUT of canActOn / canSeeQueue / isProcessCoordinator, which decide what a
   *   person can SEE.
   */
  canEdit: boolean;
  canRaise: boolean;
  /**
   * Does this person hold a VIEW-ONLY grant on this module? If so they read every
   * screen in it — every queue, the register, the Control Center — and have no
   * buttons anywhere.
   *
   * ⚠ VISIBILITY ONLY, and never an arm on an action predicate. It is folded into
   *   canSeeQueue and canMonitor and nowhere else; canEdit is false for exactly
   *   these users, which is what keeps the pages read-only.
   */
  isModuleViewer: boolean;
  /**
   * May this person see the Control Center — the nav link and the route. The
   * visibility half of `isProcessCoordinator`, split off so a view-only reader can
   * open it without also gaining that flag's authority inside canActOn.
   */
  canMonitor: boolean;
  /**
   * ⚠ TAKES `OwnerStepKey`, NOT `QueueStep` — "sales_return" is a real owner key
   *   that is deliberately absent from the six-step chain. These four are safe to
   *   widen because they only ever consult `fms_dispatch_step_owners`; anything
   *   that INDEXES a `Record<QueueStep, …>` (dueIsoFor, myQueue, completedFor,
   *   recordStep, updateStep) must stay narrow, or it reads `undefined` off a
   *   lookup table that has no arm for it.
   */
  canActOn: (step: OwnerStepKey, order: DispatchOrder) => boolean;
  /** Who is holding (order, step), or null. */
  assigneeOfStep: (orderId: string | null, step: string) => string | null;
  /** May I reassign this step, or take it back? Broader than acting on it. */
  canReassignStep: (step: OwnerStepKey, order: DispatchOrder) => boolean;
  /** Who it may go to: the pool plus THIS ORDER'S LOCATION owners, minus me. */
  reassignCandidates: (step: OwnerStepKey, order: DispatchOrder) => { id: string; name: string }[];
  /** Reassign one step, or pass assignee: null to return it to the location's owners. */
  reassignStep: (input: { order: DispatchOrder; step: OwnerStepKey; assignee: string | null; note?: string | null }) => Promise<void>;
  /** Departments the Setup picker filters candidates by. A UI FILTER - grants nothing. */
  reassignPoolDepartmentIds: string[];
  /** Everyone who may be handed a step. The authority. */
  reassignPoolUserIds: string[];
  /** May this person see the step's queue at all — nav link, route, page. */
  canSeeQueue: (step: OwnerStepKey) => boolean;
  canEditOrder: (order: DispatchOrder) => boolean;
  /** Omit the location to ask "owns this step anywhere". */
  isStepOwner: (stepKey: OwnerStepKey, locationId?: string | null) => boolean;
  /** `null` is the FALLBACK owner-set (all locations), not "any". */
  stepOwnerFor: (stepKey: OwnerStepKey, locationId?: string | null) => StepOwner | undefined;
  /**
   * The owner-set covering a location — its own row, else the fallback. Use this
   * to CAPTION a step; `stepOwnerFor(step)` on its own finds only the fallback.
   */
  stepOwnerCovering: (stepKey: OwnerStepKey, locationId: string | null) => StepOwner | undefined;
  ownerNamesFor: (stepKey: OwnerStepKey, locationId?: string | null) => string[];
  /**
   * The staff we named against the CUSTOMER who raised this order, or [] for a
   * staff-raised one. Mirrors `fms_dispatch_is_customer_recipient`'s notify list.
   */
  customerRecipientIdsOf: (raisedBy: string | null) => string[];
  personName: (id: string | null) => string;
  /**
   * May this person cancel the order? The RAISER may, at any open stage — that is
   * the point, and why this is not `isProcessCoordinator`. Mirrors
   * fms_dispatch_cancel_order.
   *
   * `closed` is excluded because a fully delivered order has nothing to withdraw
   * ("Correct this round" re-opens it first), and `awaiting_sales_return` because
   * it is already being cancelled — cancelling again would skip the Tally unwind.
   */
  canCancelOrder: (order: DispatchOrder) => boolean;
  /** Take back a cancellation that is still waiting on its sales return. */
  canWithdrawCancel: (order: DispatchOrder) => boolean;

  // directory
  profiles: Profile[];
  orgDepartments: OrgDepartment[];
  designations: Designation[];
  dispatchUsers: Profile[];

  // masters
  companies: Company[];
  companyLocations: CompanyLocation[];
  customers: Customer[];
  items: Item[];
  customerItems: CustomerItem[];
  /**
   * The sites a given company dispatches from — ACTIVE only, sorted.
   *
   * ⚠ Empty is a legitimate answer, and the intake form must treat it as one: a
   *   company nobody has added sites to asks nothing extra of the person raising
   *   the order. The RPC applies the same rule.
   */
  locationsForCompany: (companyId: string | null) => CompanyLocation[];
  /**
   * The intake pickers, narrowed to the sites this person is assigned to in
   * Setup → Step Owners. Unassigned-anywhere, admin and coordinator all see
   * everything. `includeId` always survives the filter, so editing an order
   * raised elsewhere still shows its own company / site rather than blanking.
   */
  assignedCompanies: (includeId?: string | null) => Company[];
  assignedLocationsForCompany: (companyId: string | null, includeId?: string | null) => CompanyLocation[];
  /**
   * The customers a company may bill — ACTIVE, sorted, narrowed to that
   * company's own Tally ledgers.
   *
   * No company chosen yet returns [], so the form asks for the company first
   * rather than offering 1,850 names and narrowing them afterwards.
   *
   * `includeId` always survives, and it is not a nicety: 71 of the 303 orders
   * already raised were billed by a company that is not the one on their
   * customer's ledger. Opening one of those to edit would otherwise find the
   * customer missing from the list and blank the field — silent data loss.
   */
  customersForCompany: (companyId: string | null, includeId?: string | null) => Customer[];
  /**
   * The items a customer may order — ACTIVE mappings only, sorted by item name.
   * The sales-order picker is built from this, never from the full catalogue.
   * An unmapped customer returns [], which is the honest answer: nothing is
   * offered to them until someone maps it.
   *
   * ⚠ THIS IS ALREADY "THAT COMPANY'S ITEMS FOR THAT CUSTOMER", with no second
   *   filter on the company, and that is the whole subtlety of the rule. The
   *   customer row IS company-specific — ANUPAM is four rows, one per book — so
   *   the mappings hanging off the row picked under Enterprise are Enterprise's.
   *   Filtering again on the ITEM's own book would break it rather than tighten
   *   it: 1,326 of the 8,531 mappings deliberately cross books, because Tally
   *   files one stock item under one company while both firms sell it.
   *
   * `includeIds` keeps whatever the order already has on it. An item whose
   *   mapping was switched off after the order was raised must still show, or
   *   editing the order would drop the line's unit and read as a blank cell.
   *
   * ⚠ AND THE RESULT IS ONE ROW PER PRODUCT NAME. Tally files a separate stock
   *   item in every company book that stocks it, so the same ink reached the
   *   intake picker twice with nothing on screen to choose between. Broken by
   *   the customer's own book — see the implementation, where the measurement
   *   that makes that exact rather than a guess is written down. Anything
   *   already on the order wins outright.
   */
  itemsForCustomer: (customerId: string | null, includeIds?: readonly string[]) => Item[];
  /**
   * How many items `itemsForCustomer` would offer — shown against every name in
   * the intake form's customer picker.
   *
   * ⚠ IT EXISTS TO SAY ZERO. Only 781 of the 1,850 customers have any mapping at
   *   all, so picking a name and THEN discovering the item box is empty is the
   *   common case, not the rare one — and at that point the customer, the
   *   location and the reset are already spent. Read before choosing, it costs
   *   nothing; read after, it costs the whole form.
   *
   * Precomputed into a Map rather than derived per name: the picker asks this
   * question 1,850 times per render, and `itemsForCustomer` is a scan.
   */
  mappedItemCount: (customerId: string | null) => number;
  /**
   * The product NAMES this customer can already order, upper-cased and trimmed.
   *
   * ⚠ NAMES, NOT IDS, AND THE DIFFERENCE IS A BUG THE MAPPING MODAL WOULD
   *   OTHERWISE SHIP WITH. `itemsForCustomer` collapses the picker to one row
   *   per product name — Tally files the same physical goods as a separate
   *   stock item in every book that stocks it. So a customer mapped to the
   *   Enterprise copy of a name has nothing left to gain from the O-tec copy:
   *   excluding by id would still OFFER it, the write would succeed, and the
   *   item picker would look identical afterwards, because both copies fold
   *   into the same row. The user reads that as "it didn't work" and does it
   *   again. 22 name-groups across 18 customers already carry such twins.
   *
   * Same reasoning as `mappedItemCount`, which counts distinct names for
   * exactly this reason — the two must agree or the count promises rows the
   * picker will not produce.
   */
  mappedItemNames: (customerId: string | null) => Set<string>;
  /**
   * The item TYPES this customer actually has mapped — the intake form's Item
   * type dropdown (OD-10).
   *
   * ⚠ IT CASCADES, like every other filter here: only types the customer holds
   *   are offered, never the full 13-word vocabulary. Otherwise a picker of 13
   *   words sits above a list where 12 of them return nothing, and the reader
   *   cannot tell "wrong type" from "nothing mapped". Of the 789 customers with
   *   any mapping, ink 677 · spare_parts 306 · head 156 · machine 52 · paper 11
   *   — most customers hold two or three.
   *
   * ⚠ DERIVED FROM `itemsForCustomer`, not from the raw mappings, so the
   *   dropdown and the list it filters cannot disagree. That selector collapses
   *   twins to one row per product name; deriving types from the mappings
   *   instead would offer a type whose only item is the copy that got dropped.
   */
  itemTypesForCustomer: (customerId: string | null) => string[];
  /**
   * Every delivery location anyone has used — off the customer master AND off
   * orders already raised, so a location typed once on an order is offered to
   * the next person instead of being retyped (and mistyped).
   *
   * ⚠ There is no location MASTER. The intake picker lets a new one be typed on
   *   the spot, which is the whole point; a governed master would put an
   *   approval queue between a driver and a delivery address.
   */
  knownLocations: string[];
  /** Active + sorted, for dropdowns. The full lists above back display lookups. */
  activeOf: <T extends NamedMaster>(rows: T[]) => T[];
  masterList: (mt: DispatchMasterType) => NamedMaster[];

  // name lookups — no component resolves a master name itself
  customerName: (id: string | null) => string;
  itemName: (id: string | null) => string;
  masterName: (mt: DispatchMasterType, id: string | null) => string;

  // orders
  orders: DispatchOrder[];
  orderById: (id: string) => DispatchOrder | undefined;
  openOrders: DispatchOrder[];
  myOrders: DispatchOrder[];
  orderNoPreview: string;
  snapshot: DispatchSnapshot;
  queueEntries: QueueEntry[];
  stepSla: StepSlaMap;
  dueIsoFor: (order: DispatchOrder, step: QueueStep) => string | null;
  /** The step's pending queue — the same entries the Control Centers count. */
  myQueue: (step: QueueStep) => { order: DispatchOrder; dueIso: string | null }[];
  completedFor: (step: QueueStep) => StageEntry<DispatchOrder>[];

  /**
   * The Sales Return step's two lists, scoped to what this person may action.
   *
   * ⚠ NOT `QueueEntry`s, and not built from `buildQueueEntries`. Sales Return is
   *   off the six-step chain, so a cancelled order stays out of `queueEntries`,
   *   `openOrders`, the Control Center rail and the cross-FMS scoreboard — all of
   *   which read that one builder precisely so their counts cannot disagree.
   *   There is no due date here either: the window is a matter for Tally, not an
   *   SLA this app can set.
   */
  salesReturnPending: DispatchOrder[];
  salesReturnCompleted: DispatchOrder[];

  // master governance
  masterManagers: MasterManager[];
  masterRequests: DispatchMasterRequest[];
  myMasterRequests: DispatchMasterRequest[];
  resolvableRequests: DispatchMasterRequest[];
  canManage: (mt: DispatchMasterType) => boolean;
  isAnyMasterManager: boolean;
  managerIdsFor: (mt: DispatchMasterType) => string[];
  masterReviewersFor: (mt: DispatchMasterType) => string[];
  isMasterUnassigned: (mt: DispatchMasterType) => boolean;

  // feed
  /** ⚠ REMOVED — an order's trail is its own query now: useOrderActivity(orderId).
   *  It was 2,943 rows in the snapshot, refetched after every save, for one panel. */
  notifications: DispatchNotification[];
  processCoordinatorIds: string[];

  // actions
  submitOrder: (input: OrderInput) => Promise<string>;
  updateOrder: (orderId: string, input: OrderInput) => Promise<void>;
  recordStep: (step: QueueStep, orderId: string, payload: StepPayload) => Promise<void>;
  updateStep: (step: QueueStep, orderId: string, payload: StepPayload) => Promise<void>;
  holdOrder: (orderId: string, hold: boolean, reason: string) => Promise<void>;
  /**
   * ⚠ THE STEP HOLD, NOT THE ORDER HOLD. The order keeps its status and its
   *   place in the Generate Sales Bill queue; only the `sb_hold_` stamps move.
   *   A reason is compulsory when holding.
   */
  holdSalesBill: (orderId: string, hold: boolean, reason: string) => Promise<void>;
  /**
   * ⚠ ONE CALL, TWO OUTCOMES. With no sales bill raised the order is cancelled
   *   outright; with one, it moves to `awaiting_sales_return` instead and the
   *   Sales Return owners are told. Read the status back — do not assume.
   */
  cancelOrder: (orderId: string, reason: string) => Promise<void>;
  recordSalesReturn: (orderId: string, payload: SalesReturnPayload) => Promise<void>;
  updateSalesReturn: (orderId: string, payload: SalesReturnPayload) => Promise<void>;
  withdrawCancelRequest: (orderId: string, reason: string) => Promise<void>;
  closeOrder: (orderId: string, reason: string) => Promise<void>;
  materialNothingAvailable: (orderId: string, remarks: string) => Promise<void>;
  /** `receiver` OMITTED keeps the round's stored paperwork — see amendRound. */
  amendRound: (roundId: string, input: { dcStatus?: "delivered" | "returned"; reason: string; lines?: AmendRoundLine[]; receiver?: { path: string; name: string; pages: StepDoc[] } }) => Promise<void>;
  uploadStepDocument: (orderId: string, folder: string, file: File, roundNo?: number) => Promise<{ path: string; name: string }>;
  stepDocumentUrl: (path: string) => Promise<string>;
  /** `locationId: null` writes the fallback (all-locations) owner-set. */
  setStepOwner: (stepKey: string, locationId: string | null, input: StepOwnerInput) => Promise<void>;
  /** Hand a location back to the fallback grant. */
  deleteStepOwner: (stepKey: string, locationId: string) => Promise<void>;
  setConfig: (key: string, value: Record<string, unknown>) => Promise<void>;
  insertMaster: (mt: DispatchMasterType, input: MasterInput) => Promise<void>;
  /** Several rows of one master in a single write — the customer↔item mapping form. */
  insertMasters: (mt: DispatchMasterType, inputs: MasterInput[]) => Promise<void>;
  updateMaster: (mt: DispatchMasterType, id: string, input: MasterInput) => Promise<void>;
  setMasterManagers: (mt: DispatchMasterType, userIds: string[]) => Promise<void>;
  requestNewMaster: (mt: DispatchMasterType, payload: Record<string, unknown>) => Promise<void>;
  /**
   * Map a customer to items of that company's book, DIRECTLY — no request, no
   * approval (OD-9). Goes through a SECURITY DEFINER RPC rather than
   * `insertMasters`, because RLS on the mapping table admits only admins and its
   * master manager, which is nobody who raises an order.
   *
   * Returns the three outcomes separately: `reactivated` means somebody had
   * switched that pair OFF and it is now back on, which has to be said out loud
   * rather than folded into a success count.
   */
  mapCustomerItems: (
    customerId: string, companyId: string, itemIds: string[],
  ) => Promise<MapCustomerItemResult>;
  resolveMasterRequest: (
    id: string, approve: boolean, payload: Record<string, unknown> | null, note: string | null,
  ) => Promise<void>;
  markNotificationsRead: (ids: string[]) => Promise<void>;
}

const Ctx = createContext<DispatchStoreValue | null>(null);

export function DispatchStoreProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const dir = useDirectory();
  const queryClient = useQueryClient();
  const userId = session.user?.id ?? null;
  const isAdmin = session.isAdmin;

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: dispatchQueryKey(userId),
    queryFn: fetchDispatchData,
    enabled: !!session.user,
    // Serve cached data instantly instead of re-running the heavy multi-table fetch
    // on every mount / window-focus. Writes call invalidate(), so data still
    // refreshes immediately after any change.
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  /**
   * THE CATALOGUE — its own query, refreshed on a clock rather than by saves.
   *
   * ⚠ 30 MINUTES IS NOT ARBITRARY, and it is not a compromise on freshness. The
   *   Tally sync that feeds mst_* runs about FIVE TIMES A DAY, so a half-hour
   *   window still leaves this picker fresher than the source it copies. What it
   *   buys is that ~2 MB of ledgers stops moving on every write.
   *
   * ⚠ NOT KEYED ON THE USER — see DISPATCH_MASTERS_QK. Everyone sees the same
   *   catalogue, so one entry serves every tab.
   */
  const {
    data: masters,
    isLoading: mastersLoading,
    error: mastersError,
  } = useQuery({
    queryKey: DISPATCH_MASTERS_QK,
    queryFn: fetchDispatchMasters,
    enabled: !!session.user,
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
  });

  // Org-wide names so a colleague's completed entry never renders blank (the
  // directory itself is RLS-scoped, which is why this is a separate read).
  const { data: orgPeople } = useQuery({ queryKey: ["orgPeople"], queryFn: fetchOrgPeople, staleTime: 5 * 60 * 1000 });

  /**
   * Which logins belong to a CUSTOMER, and who we named to act on their orders.
   *
   * ⚠ ITS OWN QUERY, not a member of fetchDispatchData's Promise.all — that call
   *   destructures BY POSITION and says so in capitals; adding a line there shifts
   *   every binding after it, silently, because every row is `any`.
   *
   * Two rows today, and none until Setup → Customer Logins is used, so `staleTime`
   * is long: this is configuration, not traffic.
   */
  const { data: customerActors } = useQuery({
    queryKey: CUSTOMER_ACTORS_QK,
    queryFn: fetchCustomerOrderActors,
    enabled: !!session.user,
    staleTime: 5 * 60_000,
  });

  const stepOwners = data?.stepOwners ?? [];
  const stepAssignees = data?.stepAssignees ?? [];
  const designations = data?.designations ?? [];
  // The catalogue comes from its own query now — see the useQuery above.
  const companies = masters?.companies ?? [];
  const companyLocations = masters?.companyLocations ?? [];
  const customers = masters?.customers ?? [];
  const items = masters?.items ?? [];
  const customerItems = masters?.customerItems ?? [];
  const masterManagers = data?.masterManagers ?? [];
  const masterRequests = data?.masterRequests ?? [];
  const orders = data?.orders ?? [];
  const notifications = data?.notifications ?? [];
  const processCoordinatorIds = data?.config.processCoordinatorIds ?? [];
  const reassignPoolDepartmentIds = data?.config.reassignPoolDepartmentIds ?? [];
  const reassignPoolUserIds = data?.config.reassignPoolUserIds ?? [];
  const stepSla = data?.config.stepSla ?? DEFAULT_STEP_SLA;
  const orderNoPreview = data?.orderNoPreview ?? "";

  /**
   * SELF-HEAL: an order line naming an item the catalogue has never heard of.
   *
   * The catalogue is allowed to be half an hour old. In that window somebody else
   * can map a new item and raise an order against it, and our copy would have
   * neither — so the line would render as a blank cell on the queue, the gate pass
   * and the export. `fetchDispatchMasters` covers items already on an order AS AT
   * the moment it ran; this covers the ones that appeared afterwards.
   *
   * ⚠ ONCE PER UNKNOWN ID, NOT ONCE PER RENDER. Without the ref this would
   *   invalidate → refetch → re-render → invalidate again, for ever, whenever an
   *   id genuinely cannot be resolved (a hard-deleted item, say). Remembering what
   *   we have already chased turns a possible infinite loop into one wasted fetch.
   */
  const chasedItemIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!masters || !data) return;
    const known = new Set(items.map((i) => i.id));
    const missing: string[] = [];
    for (const o of orders) {
      for (const l of o.lines) {
        if (l.itemId && !known.has(l.itemId) && !chasedItemIds.current.has(l.itemId)) {
          chasedItemIds.current.add(l.itemId);
          missing.push(l.itemId);
        }
      }
    }
    if (missing.length) {
      void queryClient.invalidateQueries({ queryKey: DISPATCH_MASTERS_QK }).catch(() => {});
    }
  }, [masters, data, items, orders, queryClient]);

  const value = useMemo<DispatchStoreValue>(() => {
    const uid = userId ?? "";
    /**
     * Refresh the module snapshot AFTER a write — deliberately NOT awaited.
     *
     * ⚠ `invalidateQueries` resolves only once the query has REFETCHED, and this
     *   query is the module's whole snapshot. Awaiting it made every one of the
     *   23 write paths hold its modal open for the length of a full reload: a
     *   traced save on 21-Aug-2026 took 6.1 s end to end, of which the write
     *   itself was 70 ms. So the write reports success, the modal closes, and the
     *   screen underneath catches up a moment later.
     *
     *   Two consequences, both accepted:
     *     · a list can show the pre-save row for that moment. The server is
     *       authoritative — the RPCs reject a step that is already recorded — so
     *       a fast double-click is a cosmetic race, not a correctness one.
     *     · a screen that looks up a JUST-WRITTEN row by id can miss it. That is
     *       what `isFetching` is exposed for; OrderDetail uses it.
     *
     *   The `.catch` is not optional: a background refetch that fails must not
     *   surface as an unhandled rejection now that nobody is awaiting it.
     */
    const invalidate = () => {
      void refreshWorkingSet();
    };

    /**
     * The post-write refresh: ask for what CHANGED, not for everything.
     *
     * A save used to pull the module's whole working set back down — 2.9 MB and
     * 11 requests to learn that one order moved a step. `fetchDispatchDelta` reads
     * every visible order's id and stamp (~25 kB), then fetches only the rows that
     * moved, and drops any that vanished.
     *
     * ⚠ THIS IS THE ONLY PATH THAT GOES INCREMENTAL. A refetch caused by mount or
     *   staleness still runs the full `fetchDispatchData`, which keeps a cheap,
     *   regular re-anchor to the truth rather than an ever-lengthening chain of
     *   patches.
     *
     * ⚠ ANY FAILURE FALLS BACK TO THE FULL FETCH. A delta that throws must never
     *   leave the screen showing pre-save data: better to spend the 2.9 MB than to
     *   lie about what is on the queue.
     */
    const refreshWorkingSet = async () => {
      const key = dispatchQueryKey(userId);
      const prev = queryClient.getQueryData<DispatchData>(key);
      if (!prev) {
        await queryClient.invalidateQueries({ queryKey: QK }).catch(() => {});
        return;
      }
      try {
        const next = await fetchDispatchDelta(prev, userId);
        if (next !== prev) queryClient.setQueryData(key, next);
      } catch {
        await queryClient.invalidateQueries({ queryKey: QK }).catch(() => {});
      }
    };

    /**
     * Refresh the CATALOGUE as well. Only four writes may call this — the three
     * that write mst_* directly (insertMaster / insertMasters / updateMaster) and
     * resolveMasterRequest, where approving a request creates the ledger row.
     *
     * ⚠ EVERY OTHER WRITE MUST USE `invalidate()` ALONE. Reaching for this one out
     *   of caution is exactly the habit the split exists to break: it puts ~2 MB
     *   of customers and items back behind an ordinary step save.
     */
    const invalidateAll = () => {
      invalidate();
      void queryClient.invalidateQueries({ queryKey: DISPATCH_MASTERS_QK }).catch(() => {});
    };

    /**
     * The owner-set for a step at a location. `locationId: null` asks for the
     * FALLBACK grant — the one covering every location — not "any of them".
     */
    const stepOwnerFor = (stepKey: OwnerStepKey, locationId: string | null = null) =>
      stepOwners.find((o) => o.stepKey === stepKey && (o.locationId ?? null) === locationId);

    /**
     * The owner-set that actually COVERS a location: its own row if one exists,
     * else the all-locations fallback.
     *
     * ⚠ THIS IS THE DISPLAY LOOKUP, and `stepOwnerFor(step)` alone is not it.
     *   That default asks for the FALLBACK ROW, not "any location" — so once a
     *   step is owned per site, a caller that omits the location finds nothing
     *   and captions a fully-staffed step "Unassigned". The rail did exactly
     *   that for every location-scoped step.
     *
     * ⚠ Display only. `isStepOwner` / `canActOn` stay as they are: widening what
     *   someone may DO is a permissions change, and this is a caption.
     */
    const stepOwnerCovering = (stepKey: OwnerStepKey, locationId: string | null): StepOwner | undefined =>
      stepOwnerFor(stepKey, locationId) ?? stepOwnerFor(stepKey, null);

    /**
     * Does this person own the step?
     *
     * With no location, the question is "anywhere" — which is what the nav and
     * the My Work feed want. With one, it narrows to the sets covering that
     * site: its own, plus the fallback. Mirrors fms_dispatch_is_step_owner.
     */
    const isStepOwner = (stepKey: OwnerStepKey, locationId?: string | null): boolean =>
      isAdmin ||
      stepOwners.some(
        (o) =>
          o.stepKey === stepKey &&
          o.employeeIds.includes(uid) &&
          (locationId === undefined || o.locationId === null || o.locationId === locationId),
      );

    const isProcessCoordinator = isAdmin || processCoordinatorIds.includes(uid);

    /**
     * A "View only" grant on this module is a READ-THE-WHOLE-MODULE grant: every
     * queue, the register, the Control Center — with no buttons anywhere.
     *
     * ⚠ VISIBILITY ONLY, and that is why it is a flag of its own rather than an
     *   extra arm on `isProcessCoordinator`. That one is a route guard AND an
     *   authority short-circuit inside canActOn / canRaise / canEditOrder /
     *   canCancelOrder, so widening it would hand a viewer act-authority at every
     *   location. `canMonitor` below is the visibility half, split off for the
     *   nav and RequireMonitor; `isProcessCoordinator` keeps the authority half.
     *
     * ⚠ From the REAL `session`, never a demo persona — same reason as canEdit.
     *   Personas carry their own moduleAccess and must not step around the real
     *   user's grant.
     *
     * A viewer therefore sees MORE screens than an editor who owns no step. That
     * inversion is deliberate: ownership answers "whose work is this", the grant
     * answers "may this person read the module".
     */
    const isModuleViewer = session.isModuleViewer("order-to-dispatch");

    /** Visibility half of the coordinator flag — nav link + RequireMonitor only. */
    const canMonitor = isModuleViewer || isProcessCoordinator;

    const personName = (id: string | null): string => {
      if (!id) return "—";
      return (orgPeople ?? []).find((p) => p.id === id)?.name ?? "Unknown user";
    };

    /**
     * Mirrors fms_dispatch_can_act(step, order, uid): admin / coordinator / step
     * owner AT THAT ORDER'S LOCATION.
     *
     * ⚠ THE ORDER ARGUMENT IS USED NOW. It was named `_o` for as long as
     *   ownership was global; owning gate-out at Vapi no longer lets you record
     *   gate-out on an Ahmedabad consignment.
     *
     * ⚠ The old driver arm is gone with the Drivers master — delivery
     *   confirmation now REQUIRES a configured step owner. Seed one before
     *   go-live or the last step falls back to admins only.
     */
    /**
     * Who is holding (order, step), or null. Keyed the way fms_dispatch_can_act
     * authorises, so the client and the server cannot disagree.
     */
    const assigneeByKey = new Map<string, string>();
    for (const a of stepAssignees) assigneeByKey.set(a.orderId + '|' + a.stepKey, a.assignedTo);
    const assigneeOfStep = (orderId: string | null, stepKey: string): string | null =>
      orderId ? assigneeByKey.get(orderId + '|' + stepKey) ?? null : null;

    /**
     * Was this order raised by a CUSTOMER whose named recipients include me?
     *
     * Mirrors `public.fms_dispatch_is_customer_recipient`. Returns false for every
     * staff-raised order — the map is empty until a customer login exists — so this
     * is a pure widening and changes nothing about how the module behaves today.
     */
    const customerRecipientsByRaiser = new Map<string, string[]>();
    for (const a of customerActors ?? []) customerRecipientsByRaiser.set(a.profileId, a.notifyUserIds);
    const isCustomerRecipientOf = (raisedBy: string | null): boolean =>
      !!raisedBy && (customerRecipientsByRaiser.get(raisedBy)?.includes(uid) ?? false);
    /** Empty for every staff-raised order. Used to name who really owns a customer order. */
    const customerRecipientIdsOf = (raisedBy: string | null): string[] =>
      (raisedBy ? customerRecipientsByRaiser.get(raisedBy) : undefined) ?? [];

    const canActOn = (stepKey: OwnerStepKey, o: DispatchOrder): boolean => {
      if (isAdmin || isProcessCoordinator) return true;
      /**
       * NAMED AGAINST THIS CUSTOMER — the client half of OD-13's recipient rule.
       *
       * ⚠ THE PLACEMENT IS THE POINT, and it mirrors the server line for line.
       *   Before the assignee check, because `fms_dispatch_step_assignees` is
       *   `unique (order_id, step_key)`: once one person is assigned, the branch
       *   below returns early and every OTHER named recipient is refused — which
       *   quietly re-creates the single-point-of-failure that a LIST of recipients
       *   (decision Q8) exists to avoid.
       *
       * ⚠ AND IT IS HERE RATHER THAN IN `isStepOwner`, deliberately. `isStepOwner`
       *   also answers "do I own this step ANYWHERE" for the nav and the My Work
       *   feed; widening it would give a recipient a nav entry for every step of a
       *   module they own no step in. The authority is over THIS ORDER, so it
       *   belongs on the function that takes one.
       *
       *   Without this, the RLS lets the clerk read the order and the client still
       *   drops it out of their queue — the same symptom from two different bugs,
       *   and this one throws no error to find it by.
       */
      if (isCustomerRecipientOf(o.raisedBy)) return true;
      // A REASSIGNMENT MOVES THE WORK. While an assignee is set they are the only
      // non-admin who may act - deliberately NOT an OR with the location's owners,
      // or the step would stay in their queue too. Mirrors fms_dispatch_can_act.
      const assignee = assigneeOfStep(o.id, stepKey);
      if (assignee) return assignee === uid;
      return isStepOwner(stepKey, o.locationId);
    };

    /**
     * VISIBILITY - is this step on MY desk? Here it happens to equal canActOn for
     * everyone except an admin/coordinator, and THAT is the difference that
     * matters: without this the reassignment would never leave an admin's queue.
     */
    const stepIsMine = (stepKey: OwnerStepKey, o: DispatchOrder): boolean => {
      const assignee = assigneeOfStep(o.id, stepKey);
      if (assignee) return assignee === uid;
      return canActOn(stepKey, o);
    };

    /**
     * May I reassign this step, or take it back? Broader than acting on it: the
     * location's owner keeps this after passing it on. Mirrors
     * fms_dispatch_reassign_step, including its module-edit gate.
     */
    const canReassignStep = (stepKey: OwnerStepKey, o: DispatchOrder): boolean => {
      const me = session.user?.id ?? '';
      if (!me || !canEdit) return false;
      if (session.isAdmin || processCoordinatorIds.includes(me)) return true;
      if (assigneeOfStep(o.id, stepKey) === me) return true;
      return isStepOwner(stepKey, o.locationId);
    };

    /**
     * Who this step may be reassigned to: the configured pool plus the owners for
     * THIS ORDER'S LOCATION so it can be returned, minus me.
     */
    const reassignCandidates = (stepKey: OwnerStepKey, o: DispatchOrder): { id: string; name: string }[] => {
      const ids = new Set<string>(reassignPoolUserIds);
      for (const row of stepOwners) {
        if (row.stepKey !== stepKey) continue;
        if (row.locationId && row.locationId !== o.locationId) continue;
        for (const id of row.employeeIds) ids.add(id);
      }
      ids.delete(session.user?.id ?? '');
      return [...ids]
        .map((id) => ({ id, name: personName(id) }))
        .sort((a, b) => a.name.localeCompare(b.name));
    };

    /**
     * May this person see the step's QUEUE at all — the nav link, the route, the page?
     *
     * Location-agnostic on purpose: owning gate-out at one site is reason enough for
     * the link to exist, and `canActOn` then decides which rows appear on it.
     *
     * ⚠ A VIEW-ONLY GRANT SEES EVERY QUEUE, and that arm is first on purpose. It
     *   is a read grant, so it opens the page and nothing more — `canActOn` below
     *   has no viewer arm, and every button on these pages also tests `canEdit`.
     *
     * ⚠ A step with NO owner rows resolves to admin / coordinator only — which is
     *   exactly what `canActOn` already says, so the queue disappears rather than
     *   opening with every button dead. Seeding owners is a go-live step, not an
     *   option; StepOwnersSection says so at the top of the file.
     */
    const canSeeQueue = (stepKey: OwnerStepKey): boolean =>
      isModuleViewer || isProcessCoordinator || isStepOwner(stepKey);

    /**
     * Who may raise an order: open to every granted user unless `sales_order` has
     * owners configured, then only those owners (or admin / coordinator). The DB
     * deliberately allows owners on the origin step — see the foundations migration.
     *
     * ⚠ LOCATION-AGNOSTIC ON PURPOSE, and the server agrees. The location is
     *   chosen ON the form, so there is nothing to scope against until the order
     *   exists; `fms_dispatch_submit_order` then validates the site against the
     *   company. Any owner-set on the origin step, at any location, may raise.
     */
    const salesOrderOwners = [
      ...new Set(stepOwners.filter((o) => o.stepKey === "sales_order").flatMap((o) => o.employeeIds)),
    ];
    // Module-level write ceiling. From the REAL `session`, never a demo persona.
    const canEdit = session.canEditModule("order-to-dispatch");
    const canRaise =
      canEdit && (salesOrderOwners.length === 0 || isAdmin || isProcessCoordinator || salesOrderOwners.includes(uid));

    /**
     * Mirrors fms_dispatch_update_order's authz: the raiser / admin / coordinator,
     * and only while the order is still at the origin step.
     *
     * ⚠ THE "NO ROUNDS YET" CLAUSE IS LOAD-BEARING. A partial credit approval
     *   sends an order back to awaiting_credit_check once its approved quantity
     *   has gone out, and the loop-back clears cc_at — so the first two tests
     *   pass again on an order that has already dispatched. Without this, its
     *   Edit button would light up and offer to change the customer and the
     *   billing entity mid-flight. The RPC refuses on the same test; this is
     *   what stops the button appearing in the first place.
     */
    const canEditOrder = (o: DispatchOrder): boolean =>
      canEdit &&
      (o.raisedBy === uid || isAdmin || isProcessCoordinator) &&
      o.status === "awaiting_credit_check" &&
      o.ccAt == null &&
      o.rounds.length === 0;

    /**
     * Mirrors fms_dispatch_cancel_order's authz and its refusals.
     *
     * ⚠ THE RAISER MAY CANCEL, not just a coordinator. That is the change, and
     *   the reason this is not `isProcessCoordinator`. Step owners are
     *   deliberately absent: owning gate-out is authority over a step, not over
     *   whether the order should exist.
     *
     * ⚠ UP TO THE GATE, AND NOT PAST IT. `goAt` set means this consignment has
     *   physically left the plant; cancelling then would leave goods on a
     *   vehicle with no delivery record and nothing owed against them. Tested on
     *   `goAt` rather than the status, because a held order keeps its timestamps
     *   and a status test would let one through. The way out is to confirm the
     *   delivery (or record it as Returned) and cancel the balance afterwards.
     *
     * ⚠ `awaiting_sales_return` is excluded, and that exclusion is load-bearing.
     *   Without it the Cancel button stays live on an order that is already
     *   being cancelled, and a second press would jump straight past the Tally
     *   unwind — the exact thing this whole flow exists to prevent. The RPC is
     *   idempotent as a backstop; this is what stops the button appearing.
     */
    const canCancelOrder = (o: DispatchOrder): boolean =>
      canEdit &&
      (o.raisedBy === uid || isProcessCoordinator) &&
      o.status !== "cancelled" &&
      o.status !== "closed" &&
      o.status !== "awaiting_sales_return" &&
      o.goAt == null;

    const canWithdrawCancel = (o: DispatchOrder): boolean =>
      canEdit && (o.raisedBy === uid || isProcessCoordinator) && isSalesReturnPending(o);

    /**
     * The people who own a step, named. With a location, the set that actually
     * covers it — its own if one exists, the fallback otherwise; a location
     * row REPLACES the fallback rather than adding to it, which is what makes
     * "Vapi is handled by these two, everywhere else by the default" sayable.
     * Without one, everybody who owns the step anywhere.
     */
    const ownerNamesFor = (stepKey: OwnerStepKey, locationId?: string | null): string[] => {
      const ids =
        locationId === undefined
          ? [...new Set(stepOwners.filter((o) => o.stepKey === stepKey).flatMap((o) => o.employeeIds))]
          : stepOwnerCovering(stepKey, locationId)?.employeeIds ?? [];
      return ids.map((id) => personName(id)).filter((n) => n !== "—" && n !== "Unknown user");
    };

    /* --------------------------- masters --------------------------- */

    const activeOf = <T extends NamedMaster>(rows: T[]): T[] =>
      rows.filter((r) => r.active).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

    /**
     * The sites this person is assigned to — `null` meaning UNRESTRICTED, not
     * "none". The intake form reads this so somebody is offered the site they
     * actually work at rather than every site in the group.
     *
     * ⚠ IT IS DERIVED FROM STEP OWNERSHIP, which is already assigned per location
     *   in Setup → Step Owners. There is no second place to maintain, and no new
     *   column: the assignment the admin already made IS the answer.
     *
     * ⚠ ANY step, not just `sales_order`. RLS shows an order to whoever owns a
     *   step at its location (`fms_dispatch_can_see_order`), so scoping this to
     *   the raising step alone would let someone raise an order at a site where
     *   they own nothing — and then lose sight of it the moment it saved.
     *
     * Each `null` below is a considered "everywhere", never an oversight:
     *   · admins and coordinators already act everywhere;
     *   · a step-owner row with a null location IS the all-locations grant;
     *   · nobody assigned anywhere means owners are not seeded yet, and an empty
     *     picker would stop order entry dead — today's behaviour is kept instead.
     */
    const myLocationIds: string[] | null = (() => {
      if (isAdmin || isProcessCoordinator) return null;
      const mine = stepOwners.filter((o) => o.employeeIds.includes(uid));
      if (mine.some((o) => o.locationId === null)) return null;
      const ids = [...new Set(mine.map((o) => o.locationId).filter((id): id is string => !!id))];
      return ids.length ? ids : null;
    })();

    /**
     * Sites under a company that this person may dispatch from.
     *
     * `includeId` keeps a value the form is ALREADY showing, whatever the
     * assignment says. Editing an order raised at another site would otherwise
     * find its location missing from the list and blank the field — silent data
     * loss dressed up as a permission.
     */
    const assignedLocationsForCompany = (
      companyId: string | null,
      includeId?: string | null,
    ): CompanyLocation[] => {
      const all = !companyId
        ? []
        : activeOf(companyLocations).filter((l) => l.companyIds.includes(companyId));
      if (!myLocationIds) return all;
      return all.filter((l) => myLocationIds.includes(l.id) || l.id === includeId);
    };

    /** Companies this person has at least one assigned site under. */
    const assignedCompanies = (includeId?: string | null): Company[] => {
      const all = activeOf(companies);
      if (!myLocationIds) return all;
      // A site now names several companies, so this flattens rather than maps —
      // an owner assigned to SURAT-HOJIWALA can bill under either firm that
      // dispatches from it, which is what was already true in practice.
      const allowed = new Set(
        companyLocations.filter((l) => myLocationIds.includes(l.id)).flatMap((l) => l.companyIds),
      );
      return all.filter((c) => allowed.has(c.id) || c.id === includeId);
    };

    // Display lookups read the FULL list, never the active-only one — a
    // deactivated customer must still render by name on an old order.
    //
    // ⚠ Declared BEFORE MASTER_LIST, which calls it while building the mapping's
    //   synthetic names. A `const` arrow below that point is in its temporal dead
    //   zone and throws "Cannot access before initialization" on first render.
    const nameFrom = (rows: NamedMaster[], id: string | null): string =>
      !id ? "—" : rows.find((r) => r.id === id)?.name ?? "—";

    // Deduped case-INSENSITIVELY but kept in the casing it was first written in,
    // so "Surat" and "surat" are one option rather than two near-identical rows
    // in the picker. Master locations are seeded first, so they win the casing.
    const knownLocations: string[] = (() => {
      const seen = new Map<string, string>();
      const add = (raw: string | null) => {
        const v = (raw ?? "").trim();
        if (v && !seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v);
      };
      customers.forEach((c) => add(c.location));
      orders.forEach((o) => add(o.customerLocation));
      return [...seen.values()].sort((a, b) => a.localeCompare(b));
    })();

    /**
     * Mapped-item counts, one pass over the catalogue.
     *
     * The test has to be the SAME one `itemsForCustomer` applies — an active
     * mapping to an item that is itself active and loaded — or the picker would
     * promise a number the item box then fails to produce.
     */
    const mappedItemNameSets = (() => {
      // ⚠ DISTINCT NAMES, not mappings. The picker collapses a product filed in
      //   several Tally books to one row, so counting rows here would promise 12
      //   and then show 7 - and the number exists precisely to be trusted before
      //   the customer is chosen.
      //
      // ⚠ THE SETS ARE THE PRODUCT NOW, not merely their sizes. The mapping
      //   modal reads them to decide what NOT to offer, and it must be the same
      //   reading this count rests on: offer a name the customer can already
      //   order and the write succeeds while the item picker stays identical,
      //   which reads as a button that did nothing. See `mappedItemNames`.
      const liveName = new Map(items.filter((i) => i.active).map((i) => [i.id, i.name.trim().toUpperCase()]));
      const seen = new Map<string, Set<string>>();
      for (const m of customerItems) {
        const nm = m.active ? liveName.get(m.itemId) : undefined;
        if (!nm) continue;
        const set = seen.get(m.customerId);
        if (set) set.add(nm);
        else seen.set(m.customerId, new Set([nm]));
      }
      return seen;
    })();
    const EMPTY_NAMES: ReadonlySet<string> = new Set<string>();

    const MASTER_LIST: Record<DispatchMasterType, NamedMaster[]> = {
      company: companies,
      company_location: companyLocations,
      customer: customers,
      item: items,
      // Rows carry a synthetic "Customer - Item" name so the shared MasterCrud
      // (which is keyed on `name` for search, sort and the Excel round trip) has
      // something to work with. Built here, from the live lists, so a renamed
      // customer or item is reflected without touching the mapping row.
      customer_item: customerItems.map((m) => ({
        ...m,
        name: `${nameFrom(customers, m.customerId)} — ${nameFrom(items, m.itemId)}`,
      })),
    };

    /* --------------------------- master governance --------------------------- */

    const managerIdsFor = (mt: DispatchMasterType) =>
      masterManagers.filter((m) => m.masterType === mt).map((m) => m.managerUserId);
    // Pure write gate (MasterCrud Add + Actions column). isAnyMasterManager is
    // left alone — it guards the Masters ROUTE, which a view-only manager may read.
    const canManage = (mt: DispatchMasterType) => canEdit && (isAdmin || managerIdsFor(mt).includes(uid));
    const isAnyMasterManager = isAdmin || masterManagers.some((m) => m.managerUserId === uid);

    const resolvableRequests = masterRequests
      .filter((r) => r.status === "pending")
      .filter((r) => canManage(r.masterType));
    const myMasterRequests = masterRequests.filter((r) => r.requestedBy === uid);

    const adminIds = () => dir.profiles.filter((p) => p.role === "admin").map((p) => p.id);
    const masterReviewersFor = (mt: DispatchMasterType): string[] => {
      const ids = managerIdsFor(mt);
      return ids.length ? ids : adminIds();
    };
    const isMasterUnassigned = (mt: DispatchMasterType) => managerIdsFor(mt).length === 0;

    /* --------------------------------- indexes ------------------------------- */


    const mineNotifications = notifications
      .filter((n) => n.userId === uid)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const orderIndex = new Map(orders.map((o) => [o.id, o]));
    const snapshot = dispatchSnapshotFrom({ orders, stepSla });
    const queueEntries = buildQueueEntries(snapshot);

    /* --------------------------------- actions ------------------------------- */

    /** Best-effort: the bell/audit trail must never fail a workflow write. */
    const safeAnnounce = async (input: Parameters<typeof announceWrite>[0]) => {
      try {
        await announceWrite(input);
      } catch {
        /* state lives on the order row; the announcement is a courtesy */
      }
    };

    /**
     * WHAT THIS CUSTOMER MAY ORDER. Hoisted out of the store object so
     * `itemTypesForCustomer` can derive its dropdown from the very list it
     * filters — a second copy of this logic would drift, and the symptom would
     * be a type in the picker whose items never appear.
     */
    const itemsFor = (customerId: string | null, includeIds?: readonly string[]): Item[] => {
      const keep = new Set(includeIds ?? []);
      if (!customerId) return items.filter((i) => keep.has(i.id));
      const allowed = new Set(
        customerItems.filter((m) => m.active && m.customerId === customerId).map((m) => m.itemId),
      );
      // `items`, not activeOf(items), for the kept ones — an item switched off
      // after the order was raised is still on the order.
      const pool = activeOf(items).filter((i) => allowed.has(i.id))
        .concat(items.filter((i) => keep.has(i.id) && !(allowed.has(i.id) && i.active)));

      /**
       * ONE ROW PER PRODUCT NAME, and this is not cosmetic tidying.
       *
       * Tally files a separate stock item in every company book that stocks it,
       * so "EPN SUBLIMATION INK BLACK" is several rows. 1,582 of the mappings
       * carried over from Dispatch point a customer in one book at an item in
       * another - Dispatch matched its customer to one ledger and its item to a
       * different book's twin. That reached the intake form as the same name
       * twice with nothing on screen to choose between: a coin toss for whoever
       * is punching the order, on 107 of the 783 mapped customers.
       *
       * The tie is broken by the CUSTOMER'S OWN BOOK, which is exact rather than
       * a heuristic. Measured across all 684 affected groups: every one has
       * EXACTLY ONE copy in the customer's own book - never none, never two -
       * and no group's twins differ on unit or HSN. So the survivor is
       * determined, and nothing that reaches the order, the gate pass or the
       * invoice is lost by dropping the other.
       */
      const book = customers.find((c) => c.id === customerId)?.companyId ?? null;
      const nameOf = (i: Item) => i.name.trim().toUpperCase();

      // WHATEVER IS ALREADY ON THE ORDER SURVIVES FIRST, unconditionally. 757
      // lines across 202 of the 303 orders sit on the twin from the OTHER book;
      // deduping to the "right" one would take the line's item out of its own
      // picker and blank the row on the next edit. Only names that nothing on
      // the order already covers go through the tie-break.
      const out = pool.filter((i) => keep.has(i.id));
      const covered = new Set(out.map(nameOf));
      const best = new Map<string, Item>();
      for (const i of pool) {
        if (keep.has(i.id) || covered.has(nameOf(i))) continue;
        const cur = best.get(nameOf(i));
        if (!cur || (i.companyId === book && cur.companyId !== book)) best.set(nameOf(i), i);
      }
      return out.concat([...best.values()]).sort((a, b) => a.name.localeCompare(b.name));
    };

    return {
      /**
       * ⚠ BOTH QUERIES, AND THAT IS LOAD-BEARING. `useSalesOrderForm` seeds its
       *   state in a lazy `useState` that runs on the FIRST render and never
       *   again, so NewOrder / EditOrder gate their whole form on this flag. If
       *   it went false while the catalogue was still in flight, the form would
       *   mount with empty company / customer / item lists and stay that way for
       *   ever — the same trap EditOrder already carries a comment about.
       */
      isLoading: isLoading || mastersLoading,
      /**
       * ⚠ THE WORKING SET ONLY. This answers "might the row I am looking for
       *   still be on its way?", which OrderDetail uses instead of showing
       *   "Order not found" on a freshly raised order. The catalogue refreshing
       *   on its own clock has nothing to do with that question.
       */
      isFetching,
      error: error ?? mastersError,

      userId: uid,
      isAdmin,
      canEdit,
      isProcessCoordinator,
      canRaise,
      canMonitor,
      isModuleViewer,
      canActOn,
      canSeeQueue,
      canEditOrder,
      canCancelOrder,
      canWithdrawCancel,
      isStepOwner,
      stepOwnerFor,
      stepOwnerCovering,
      ownerNamesFor,
      customerRecipientIdsOf,
      personName,

      profiles: dir.profiles,
      orgDepartments: dir.departments,
      designations,
      dispatchUsers: dir.profiles,

      companies, companyLocations, customers, items, customerItems,
      activeOf,
      masterList: (mt) => MASTER_LIST[mt],

      customerName: (id) => nameFrom(customers, id),
      itemName: (id) => nameFrom(items, id),
      customersForCompany: (companyId, includeId) => {
        if (!companyId) return includeId ? customers.filter((c) => c.id === includeId) : [];
        return activeOf(customers).filter((c) =>
          c.companyId === companyId
          // ⚠ NO COMPANY MEANS EVERY COMPANY, not none. A customer nobody has
          //   billed yet sits in no Tally book — the nine open reconcile rows,
          //   and every customer approved through a master request, which is
          //   created here and reaches Tally only after the first invoice.
          //   Hiding them would make a newly approved customer unorderable,
          //   which is the exact moment somebody needs to order from them.
          || c.companyId === null
          || c.id === includeId);
      },
      mappedItemCount: (customerId) => (customerId ? mappedItemNameSets.get(customerId)?.size ?? 0 : 0),
      mappedItemNames: (customerId) =>
        (customerId ? mappedItemNameSets.get(customerId) ?? EMPTY_NAMES : EMPTY_NAMES) as Set<string>,
      itemsForCustomer: itemsFor,
      /* Cascading: only what this customer holds. Derived from `itemsFor` so the
         dropdown and the list it filters cannot disagree — see the interface. */
      itemTypesForCustomer: (customerId) => {
        if (!customerId) return [];
        const seen = new Set<string>();
        for (const i of itemsFor(customerId)) if (i.itemType) seen.add(i.itemType);
        return [...seen].sort();
      },
      locationsForCompany: (companyId) =>
        !companyId ? [] : activeOf(companyLocations).filter((l) => l.companyIds.includes(companyId)),
      assignedCompanies,
      assignedLocationsForCompany,
      knownLocations,
      masterName: (mt, id) => nameFrom(MASTER_LIST[mt], id),

      orders,
      orderById: (id) => orderIndex.get(id),
      openOrders: orders.filter(isOpenOrder),
      myOrders: orders.filter((o) => o.raisedBy === uid),
      orderNoPreview,
      snapshot,
      queueEntries,
      stepSla,
      dueIsoFor: (o, step) => dispatchDueIso(snapshot, o, step),

      /**
       * The step's pending queue AS THIS PERSON MAY ACT ON IT. Ownership is per
       * location, so a Vapi-only owner does not get Ahmedabad's rows.
       *
       * ⚠ THIS WAS ONCE OWNER-AGNOSTIC, AND THAT IS THE BUG IT CAUSED. The nav
       *   asked "does this person have work here?" by calling it, got back
       *   everyone's work, and so showed every queue to everyone who owned one
       *   step. RLS hands a credit checker every order at their location, which
       *   made the answer yes for all five steps.
       *
       * ⚠ NOT the number the Control Centers show. They read `queueEntries`
       *   directly and must keep counting everyone's work; only the two
       *   owner-facing surfaces — the nav and StageQueue — come through here.
       */
      myQueue: (step) =>
        queueEntries
          .filter((e) => e.stepKey === step)
          .map((e) => ({ order: orderIndex.get(e.entityId)!, dueIso: e.dueIso }))
          .filter((r) => !!r.order && stepIsMine(step as OwnerStepKey, r.order)),
      // Scoped the same way, or a queue that no longer lists another site's pending
      // rows would still show that site's finished ones under Completed.
      completedFor: (step) => completedForPure(snapshot, step).filter((e) => canActOn(step, e.row)),

      // Sales Return. Plain filters over `orders`, scoped by the same per-location
      // rule as every other queue — deliberately NOT routed through
      // `buildQueueEntries`, so a cancelled order stays out of the six-step
      // scoreboards. See the interface note above.
      salesReturnPending: orders.filter((o) => isSalesReturnPending(o) && canActOn("sales_return", o)),
      salesReturnCompleted: orders.filter((o) => isSalesReturnDone(o) && canActOn("sales_return", o)),

      masterManagers,
      masterRequests,
      myMasterRequests,
      resolvableRequests,
      canManage,
      isAnyMasterManager,
      managerIdsFor,
      masterReviewersFor,
      isMasterUnassigned,

      notifications: mineNotifications,
      processCoordinatorIds,

      submitOrder: async (input) => {
        const id = await submitOrderWrite(input);
        invalidate();
        return id;
      },
      updateOrder: async (orderId, input) => {
        await updateOrderWrite(orderId, input);
        invalidate();
      },
      recordStep: async (step, orderId, payload) => {
        await recordStepWrite(step, orderId, payload);
        invalidate();
      },
      updateStep: async (step, orderId, payload) => {
        await updateStepWrite(step, orderId, payload);
        invalidate();
      },
      holdOrder: async (orderId, hold, reason) => {
        await holdOrderWrite(orderId, hold, reason);
        invalidate();
      },
      holdSalesBill: async (orderId, hold, reason) => {
        await holdSalesBillWrite(orderId, hold, reason);
        invalidate();
      },
      cancelOrder: async (orderId, reason) => {
        await cancelOrderWrite(orderId, reason);
        invalidate();
      },
      recordSalesReturn: async (orderId, payload) => {
        await recordSalesReturnWrite(orderId, payload);
        invalidate();
      },
      updateSalesReturn: async (orderId, payload) => {
        await updateSalesReturnWrite(orderId, payload);
        invalidate();
      },
      withdrawCancelRequest: async (orderId, reason) => {
        await withdrawCancelRequestWrite(orderId, reason);
        invalidate();
      },
      closeOrder: async (orderId, reason) => {
        await closeOrderWrite(orderId, reason);
        invalidate();
      },
      materialNothingAvailable: async (orderId, remarks) => {
        await materialNothingAvailableWrite(orderId, remarks);
        invalidate();
      },
      amendRound: async (roundId, input) => {
        await amendRoundWrite(roundId, input);
        invalidate();
      },
      uploadStepDocument: uploadStepDocumentWrite,
      stepDocumentUrl: stepDocumentUrlWrite,
      setStepOwner: async (stepKey, locationId, input) => {
        await setStepOwnerWrite(stepKey, locationId, input);
        invalidate();
      },
      deleteStepOwner: async (stepKey, locationId) => {
        await deleteStepOwnerWrite(stepKey, locationId);
        invalidate();
      },
      assigneeOfStep,
      canReassignStep,
      reassignCandidates,
      reassignPoolDepartmentIds,
      reassignPoolUserIds,
      reassignStep: async ({ order, step, assignee, note }) => {
        await reassignStepWrite(order.id, step, assignee ?? null, note ?? null);
        const returned = assignee === null;
        await safeAnnounce({
          entityType: 'order',
          entityId: order.id,
          type: 'step_reassigned',
          text: returned
            ? step + ' on ' + order.orderNo + ' was returned to its usual owners' + (note ? ' - ' + note : '')
            : step + ' on ' + order.orderNo + ' was reassigned to ' + personName(assignee) + (note ? ' - ' + note : ''),
          // On a hand-back it goes to whoever owns the step at THIS order's
          // location - the same rule the server returns it to.
          recipients: returned
            ? stepOwners
                .filter((r) => r.stepKey === step && (!r.locationId || r.locationId === order.locationId))
                .flatMap((r) => r.employeeIds)
            : [assignee as string],
        });
        invalidate();
      },
      setConfig: async (key, val) => {
        await setConfigWrite(key, val);
        invalidate();
      },
      insertMaster: async (mt, input) => {
        await insertMasterWrite(mt, input);
        invalidateAll();
      },
      insertMasters: async (mt, inputs) => {
        await insertMastersWrite(mt, inputs);
        invalidateAll();
      },
      updateMaster: async (mt, id, input) => {
        await updateMasterWrite(mt, id, input);
        invalidateAll();
      },
      setMasterManagers: async (mt, userIds) => {
        await setMasterManagersWrite(mt, userIds);
        invalidate();
      },
      requestNewMaster: async (mt, payload) => {
        // Stamp the REAL session user: RLS checks auth.uid(), so an impersonated
        // persona id here would be silently rejected.
        const id = await requestNewMasterWrite(mt, payload, uid);
        await safeAnnounce({
          entityType: "master_request",
          entityId: id,
          type: "master_requested",
          // ⚠ describePayload, NOT payload.name. A nameless master — the
          //   customer↔item mapping — has no `name` key at all, so reading one
          //   produced "…was requested: " with a trailing colon and left the
          //   reviewer to open the queue to find out what had been asked for.
          text: `A new ${masterTypeLabel(mt).toLowerCase()} was requested: ${describePayload(mt, payload, {
            customerName: (id) => nameFrom(customers, id),
            itemName: (id) => nameFrom(items, id),
            companyName: (id) => nameFrom(companies, id),
          })}`,
          recipients: masterReviewersFor(mt),
          meta: { master_type: mt },
        });
        invalidate();
      },
      mapCustomerItems: async (customerId, companyId, itemIds) => {
        const result = await mapCustomerItemsWrite(customerId, companyId, itemIds);
        // Told, not asked. The owners named on this master keep their oversight
        // — they see what was mapped and by whom — but there is nothing to
        // approve, so this never reaches `resolvableRequests` and never bumps
        // the "To review" badge.
        if (result.created + result.reactivated > 0) {
          await safeAnnounce({
            entityType: "master_request",
            entityId: customerId,
            type: "master_mapped",
            text: `${personName(uid)} mapped ${result.created + result.reactivated} item${
              result.created + result.reactivated === 1 ? "" : "s"
            } to ${nameFrom(customers, customerId)}.`,
            recipients: masterReviewersFor("customer_item").filter((id) => id !== uid),
            meta: { master_type: "customer_item" },
          });
        }
        // MINTS THE MAPPING the item picker reads, so the catalogue has to come
        // back down here — the 30-minute timer would otherwise leave the user
        // staring at the item they just mapped still missing from the box. The
        // self-heal above only chases items on SAVED orders and cannot cover a
        // form still being filled in.
        invalidateAll();
        return result;
      },
      resolveMasterRequest: async (id, approve, payload, note) => {
        await resolveMasterRequestWrite(id, approve, payload, note);
        const req = masterRequests.find((r) => r.id === id);
        if (req?.requestedBy) {
          await safeAnnounce({
            entityType: "master_request",
            entityId: id,
            type: approve ? "master_approved" : "master_rejected",
            text: `Your ${masterTypeLabel(req.masterType).toLowerCase()} request was ${approve ? "approved" : "rejected"}.`,
            recipients: [req.requestedBy],
            meta: { master_type: req.masterType },
          });
        }
        // Approving MINTS the ledger row, so the catalogue must refresh here or
        // the customer the approver just created would not appear in a picker
        // until the 30-minute timer came round.
        invalidateAll();
      },
      markNotificationsRead: async (ids) => {
        await markNotificationsReadWrite(ids);
        invalidate();
      },
    };
  }, [
    userId, isAdmin, isLoading, isFetching, error, queryClient, dir, orgPeople,
    stepOwners, designations, companies, companyLocations, customers, items, customerItems,
    masterManagers, masterRequests, orders, notifications,
    processCoordinatorIds, stepSla, orderNoPreview,
    // Load-bearing and invisible to tsc: without these the memo keeps the
    // assignees and the pool it was built with, so a reassignment would not move
    // anything on screen and Setup Save would never confirm.
    stepAssignees, reassignPoolDepartmentIds, reassignPoolUserIds,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * One order's activity trail, fetched when that order is open.
 *
 * ⚠ NOT PART OF THE SNAPSHOT, deliberately. It used to be: 2,943 rows and 743 kB
 *   riding in the module payload and re-fetched after every save, to feed a panel
 *   that only ever shows one order — and carrying master-request rows that were
 *   never displayed at all.
 *
 * The panel paints a moment after the rest of the page. That is the trade.
 */
export function useOrderActivity(orderId: string): DispatchActivity[] {
  const { data } = useQuery({
    queryKey: orderActivityQueryKey(orderId),
    queryFn: () => fetchOrderActivity(orderId),
    enabled: !!orderId,
    staleTime: 60_000,
  });
  return data ?? [];
}

export function useDispatchStore(): DispatchStoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDispatchStore must be used inside DispatchStoreProvider");
  return v;
}
