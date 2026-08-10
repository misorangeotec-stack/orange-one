import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { useDirectory } from "@/core/platform/store";
import { fetchOrgPeople } from "@/core/platform/orgPeople";
import type { Department as OrgDepartment, Profile } from "@/core/platform/types";
import { DISPATCH_QK, fetchDispatchData, dispatchQueryKey } from "./data/dispatchFetch";
import {
  announce as announceWrite,
  amendRound as amendRoundWrite,
  cancelOrder as cancelOrderWrite,
  closeOrder as closeOrderWrite,
  holdOrder as holdOrderWrite,
  insertMaster as insertMasterWrite,
  insertMasters as insertMastersWrite,
  markNotificationsRead as markNotificationsReadWrite,
  materialNothingAvailable as materialNothingAvailableWrite,
  recordStep as recordStepWrite,
  requestNewMaster as requestNewMasterWrite,
  resolveMasterRequest as resolveMasterRequestWrite,
  setConfig as setConfigWrite,
  setMasterManagers as setMasterManagersWrite,
  setStepOwner as setStepOwnerWrite,
  deleteStepOwner as deleteStepOwnerWrite,
  stepDocumentUrl as stepDocumentUrlWrite,
  submitOrder as submitOrderWrite,
  updateMaster as updateMasterWrite,
  updateOrder as updateOrderWrite,
  updateStep as updateStepWrite,
  uploadStepDocument as uploadStepDocumentWrite,
  type AmendRoundLine,
  type MasterInput,
  type OrderInput,
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
import { masterTypeLabel } from "./lib/masterFields";
import { DEFAULT_STEP_SLA, type StepSlaMap } from "./lib/sla";
import type { StepKey } from "./lib/steps";
import type {
  Company, CompanyLocation, Customer, Designation, DispatchActivity, DispatchMasterRequest,
  CustomerItem, DispatchMasterType, DispatchNotification, DispatchOrder, Item, MasterManager, NamedMaster, StepOwner, } from "./types";

const QK = DISPATCH_QK;

interface DispatchStoreValue {
  isLoading: boolean;
  error: unknown;

  // identity / capability
  userId: string;
  isAdmin: boolean;
  isProcessCoordinator: boolean;
  canRaise: boolean;
  canMonitor: boolean;
  canActOn: (step: QueueStep, order: DispatchOrder) => boolean;
  /** May this person see the step's queue at all — nav link, route, page. */
  canSeeQueue: (step: QueueStep) => boolean;
  canEditOrder: (order: DispatchOrder) => boolean;
  /** Omit the location to ask "owns this step anywhere". */
  isStepOwner: (stepKey: StepKey, locationId?: string | null) => boolean;
  /** `null` is the FALLBACK owner-set (all locations), not "any". */
  stepOwnerFor: (stepKey: StepKey, locationId?: string | null) => StepOwner | undefined;
  ownerNamesFor: (stepKey: StepKey, locationId?: string | null) => string[];
  personName: (id: string | null) => string;

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
   * The items a customer may order — ACTIVE mappings only, sorted by item name.
   * The sales-order picker is built from this, never from the full catalogue.
   * An unmapped customer returns [], which is the honest answer: nothing is
   * offered to them until someone maps it.
   */
  itemsForCustomer: (customerId: string | null) => Item[];
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
  activityFor: (entityType: string, entityId: string) => DispatchActivity[];
  notifications: DispatchNotification[];
  processCoordinatorIds: string[];

  // actions
  submitOrder: (input: OrderInput) => Promise<string>;
  updateOrder: (orderId: string, input: OrderInput) => Promise<void>;
  recordStep: (step: QueueStep, orderId: string, payload: StepPayload) => Promise<void>;
  updateStep: (step: QueueStep, orderId: string, payload: StepPayload) => Promise<void>;
  holdOrder: (orderId: string, hold: boolean, reason: string) => Promise<void>;
  cancelOrder: (orderId: string, reason: string) => Promise<void>;
  closeOrder: (orderId: string, reason: string) => Promise<void>;
  materialNothingAvailable: (orderId: string, remarks: string) => Promise<void>;
  amendRound: (roundId: string, input: { dcStatus?: "delivered" | "returned"; reason: string; lines?: AmendRoundLine[] }) => Promise<void>;
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

  const { data, isLoading, error } = useQuery({
    queryKey: dispatchQueryKey(userId),
    queryFn: fetchDispatchData,
    enabled: !!session.user,
    // Serve cached data instantly instead of re-running the heavy multi-table fetch
    // on every mount / window-focus. Writes call invalidate(), so data still
    // refreshes immediately after any change.
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  // Org-wide names so a colleague's completed entry never renders blank (the
  // directory itself is RLS-scoped, which is why this is a separate read).
  const { data: orgPeople } = useQuery({ queryKey: ["orgPeople"], queryFn: fetchOrgPeople, staleTime: 5 * 60 * 1000 });

  const stepOwners = data?.stepOwners ?? [];
  const designations = data?.designations ?? [];
  const companies = data?.companies ?? [];
  const companyLocations = data?.companyLocations ?? [];
  const customers = data?.customers ?? [];
  const items = data?.items ?? [];
  const customerItems = data?.customerItems ?? [];
  const masterManagers = data?.masterManagers ?? [];
  const masterRequests = data?.masterRequests ?? [];
  const orders = data?.orders ?? [];
  const activity = data?.activity ?? [];
  const notifications = data?.notifications ?? [];
  const processCoordinatorIds = data?.config.processCoordinatorIds ?? [];
  const stepSla = data?.config.stepSla ?? DEFAULT_STEP_SLA;
  const orderNoPreview = data?.orderNoPreview ?? "";

  const value = useMemo<DispatchStoreValue>(() => {
    const uid = userId ?? "";
    const invalidate = () => queryClient.invalidateQueries({ queryKey: QK });

    /**
     * The owner-set for a step at a location. `locationId: null` asks for the
     * FALLBACK grant — the one covering every location — not "any of them".
     */
    const stepOwnerFor = (stepKey: StepKey, locationId: string | null = null) =>
      stepOwners.find((o) => o.stepKey === stepKey && (o.locationId ?? null) === locationId);

    /**
     * Does this person own the step?
     *
     * With no location, the question is "anywhere" — which is what the nav and
     * the My Work feed want. With one, it narrows to the sets covering that
     * site: its own, plus the fallback. Mirrors fms_dispatch_is_step_owner.
     */
    const isStepOwner = (stepKey: StepKey, locationId?: string | null): boolean =>
      isAdmin ||
      stepOwners.some(
        (o) =>
          o.stepKey === stepKey &&
          o.employeeIds.includes(uid) &&
          (locationId === undefined || o.locationId === null || o.locationId === locationId),
      );

    const isProcessCoordinator = isAdmin || processCoordinatorIds.includes(uid);

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
    const canActOn = (stepKey: QueueStep, o: DispatchOrder): boolean =>
      isAdmin || isProcessCoordinator || isStepOwner(stepKey, o.locationId);

    /**
     * May this person see the step's QUEUE at all — the nav link, the route, the page?
     *
     * Location-agnostic on purpose: owning gate-out at one site is reason enough for
     * the link to exist, and `canActOn` then decides which rows appear on it.
     *
     * ⚠ A step with NO owner rows resolves to admin / coordinator only — which is
     *   exactly what `canActOn` already says, so the queue disappears rather than
     *   opening with every button dead. Seeding owners is a go-live step, not an
     *   option; StepOwnersSection says so at the top of the file.
     */
    const canSeeQueue = (stepKey: QueueStep): boolean =>
      isProcessCoordinator || isStepOwner(stepKey);

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
    const canRaise = salesOrderOwners.length === 0 || isAdmin || isProcessCoordinator || salesOrderOwners.includes(uid);

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
      (o.raisedBy === uid || isAdmin || isProcessCoordinator) &&
      o.status === "awaiting_credit_check" &&
      o.ccAt == null &&
      o.rounds.length === 0;

    /**
     * The people who own a step, named. With a location, the set that actually
     * covers it — its own if one exists, the fallback otherwise; a location
     * row REPLACES the fallback rather than adding to it, which is what makes
     * "Vapi is handled by these two, everywhere else by the default" sayable.
     * Without one, everybody who owns the step anywhere.
     */
    const ownerNamesFor = (stepKey: StepKey, locationId?: string | null): string[] => {
      const ids =
        locationId === undefined
          ? [...new Set(stepOwners.filter((o) => o.stepKey === stepKey).flatMap((o) => o.employeeIds))]
          : (stepOwnerFor(stepKey, locationId) ?? stepOwnerFor(stepKey, null))?.employeeIds ?? [];
      return ids.map((id) => personName(id)).filter((n) => n !== "—" && n !== "Unknown user");
    };

    /* --------------------------- masters --------------------------- */

    const activeOf = <T extends NamedMaster>(rows: T[]): T[] =>
      rows.filter((r) => r.active).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

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
    const canManage = (mt: DispatchMasterType) => isAdmin || managerIdsFor(mt).includes(uid);
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

    const activityByEntity = new Map<string, DispatchActivity[]>();
    for (const a of activity) {
      const k = `${a.entityType}:${a.entityId}`;
      const list = activityByEntity.get(k) ?? [];
      list.push(a);
      activityByEntity.set(k, list);
    }

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

    return {
      isLoading,
      error,

      userId: uid,
      isAdmin,
      isProcessCoordinator,
      canRaise,
      canMonitor: isProcessCoordinator,
      canActOn,
      canSeeQueue,
      canEditOrder,
      isStepOwner,
      stepOwnerFor,
      ownerNamesFor,
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
      itemsForCustomer: (customerId) => {
        if (!customerId) return [];
        const allowed = new Set(
          customerItems.filter((m) => m.active && m.customerId === customerId).map((m) => m.itemId),
        );
        return activeOf(items).filter((i) => allowed.has(i.id));
      },
      locationsForCompany: (companyId) =>
        !companyId ? [] : activeOf(companyLocations).filter((l) => l.companyId === companyId),
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
          .filter((r) => !!r.order && canActOn(step, r.order)),
      // Scoped the same way, or a queue that no longer lists another site's pending
      // rows would still show that site's finished ones under Completed.
      completedFor: (step) => completedForPure(snapshot, step).filter((e) => canActOn(step, e.row)),

      masterManagers,
      masterRequests,
      myMasterRequests,
      resolvableRequests,
      canManage,
      isAnyMasterManager,
      managerIdsFor,
      masterReviewersFor,
      isMasterUnassigned,

      activityFor: (entityType, entityId) => activityByEntity.get(`${entityType}:${entityId}`) ?? [],
      notifications: mineNotifications,
      processCoordinatorIds,

      submitOrder: async (input) => {
        const id = await submitOrderWrite(input);
        await invalidate();
        return id;
      },
      updateOrder: async (orderId, input) => {
        await updateOrderWrite(orderId, input);
        await invalidate();
      },
      recordStep: async (step, orderId, payload) => {
        await recordStepWrite(step, orderId, payload);
        await invalidate();
      },
      updateStep: async (step, orderId, payload) => {
        await updateStepWrite(step, orderId, payload);
        await invalidate();
      },
      holdOrder: async (orderId, hold, reason) => {
        await holdOrderWrite(orderId, hold, reason);
        await invalidate();
      },
      cancelOrder: async (orderId, reason) => {
        await cancelOrderWrite(orderId, reason);
        await invalidate();
      },
      closeOrder: async (orderId, reason) => {
        await closeOrderWrite(orderId, reason);
        await invalidate();
      },
      materialNothingAvailable: async (orderId, remarks) => {
        await materialNothingAvailableWrite(orderId, remarks);
        await invalidate();
      },
      amendRound: async (roundId, input) => {
        await amendRoundWrite(roundId, input);
        await invalidate();
      },
      uploadStepDocument: uploadStepDocumentWrite,
      stepDocumentUrl: stepDocumentUrlWrite,
      setStepOwner: async (stepKey, locationId, input) => {
        await setStepOwnerWrite(stepKey, locationId, input);
        await invalidate();
      },
      deleteStepOwner: async (stepKey, locationId) => {
        await deleteStepOwnerWrite(stepKey, locationId);
        await invalidate();
      },
      setConfig: async (key, val) => {
        await setConfigWrite(key, val);
        await invalidate();
      },
      insertMaster: async (mt, input) => {
        await insertMasterWrite(mt, input);
        await invalidate();
      },
      insertMasters: async (mt, inputs) => {
        await insertMastersWrite(mt, inputs);
        await invalidate();
      },
      updateMaster: async (mt, id, input) => {
        await updateMasterWrite(mt, id, input);
        await invalidate();
      },
      setMasterManagers: async (mt, userIds) => {
        await setMasterManagersWrite(mt, userIds);
        await invalidate();
      },
      requestNewMaster: async (mt, payload) => {
        // Stamp the REAL session user: RLS checks auth.uid(), so an impersonated
        // persona id here would be silently rejected.
        const id = await requestNewMasterWrite(mt, payload, uid);
        await safeAnnounce({
          entityType: "master_request",
          entityId: id,
          type: "master_requested",
          text: `A new ${masterTypeLabel(mt).toLowerCase()} was requested: ${String(payload.name ?? "")}`,
          recipients: masterReviewersFor(mt),
          meta: { master_type: mt },
        });
        await invalidate();
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
        await invalidate();
      },
      markNotificationsRead: async (ids) => {
        await markNotificationsReadWrite(ids);
        await invalidate();
      },
    };
  }, [
    userId, isAdmin, isLoading, error, queryClient, dir, orgPeople,
    stepOwners, designations, companies, companyLocations, customers, items, customerItems,
    masterManagers, masterRequests, orders, activity, notifications,
    processCoordinatorIds, stepSla, orderNoPreview,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDispatchStore(): DispatchStoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDispatchStore must be used inside DispatchStoreProvider");
  return v;
}
