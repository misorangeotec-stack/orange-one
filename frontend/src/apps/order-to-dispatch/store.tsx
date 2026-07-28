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
  cancelOrder as cancelOrderWrite,
  holdOrder as holdOrderWrite,
  insertMaster as insertMasterWrite,
  markNotificationsRead as markNotificationsReadWrite,
  recordStep as recordStepWrite,
  requestNewMaster as requestNewMasterWrite,
  resolveMasterRequest as resolveMasterRequestWrite,
  setConfig as setConfigWrite,
  setMasterManagers as setMasterManagersWrite,
  setStepOwner as setStepOwnerWrite,
  stepDocumentUrl as stepDocumentUrlWrite,
  submitOrder as submitOrderWrite,
  updateMaster as updateMasterWrite,
  updateOrder as updateOrderWrite,
  updateStep as updateStepWrite,
  uploadStepDocument as uploadStepDocumentWrite,
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
  Company, CompanyScopedMaster, Customer, Designation, DispatchActivity, DispatchMasterRequest,
  DispatchMasterType, DispatchNotification, DispatchOrder, Driver, Item, Lot, MailTemplate,
  MasterManager, NamedMaster, PaymentTerm, ShipTo, StepOwner, Transporter, Vehicle,
} from "./types";

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
  canEditOrder: (order: DispatchOrder) => boolean;
  isStepOwner: (stepKey: StepKey) => boolean;
  stepOwnerFor: (stepKey: StepKey) => StepOwner | undefined;
  ownerNamesFor: (stepKey: StepKey) => string[];
  personName: (id: string | null) => string;

  // directory
  profiles: Profile[];
  orgDepartments: OrgDepartment[];
  designations: Designation[];
  dispatchUsers: Profile[];

  // masters
  companies: Company[];
  transporters: Transporter[];
  units: NamedMaster[];
  categories: NamedMaster[];
  orderSources: NamedMaster[];
  paymentTerms: PaymentTerm[];
  shortfallReasons: NamedMaster[];
  packingTypes: NamedMaster[];
  mailTemplates: MailTemplate[];
  drivers: Driver[];
  customers: Customer[];
  shipTos: ShipTo[];
  items: Item[];
  lots: Lot[];
  godowns: CompanyScopedMaster[];
  gates: CompanyScopedMaster[];
  invoiceSeries: CompanyScopedMaster[];
  vehicles: Vehicle[];
  /** Active + sorted, for dropdowns. The full lists above back display lookups. */
  activeOf: <T extends NamedMaster>(rows: T[]) => T[];
  masterList: (mt: DispatchMasterType) => NamedMaster[];

  // name lookups — no component resolves a master name itself
  customerName: (id: string | null) => string;
  itemName: (id: string | null) => string;
  unitName: (id: string | null) => string;
  lotName: (id: string | null) => string;
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
  customerMail: { enabled: boolean; templateCode: string };

  // actions
  submitOrder: (input: OrderInput) => Promise<string>;
  updateOrder: (orderId: string, input: OrderInput) => Promise<void>;
  recordStep: (step: QueueStep, orderId: string, payload: StepPayload) => Promise<void>;
  updateStep: (step: QueueStep, orderId: string, payload: StepPayload) => Promise<void>;
  holdOrder: (orderId: string, hold: boolean, reason: string) => Promise<void>;
  cancelOrder: (orderId: string, reason: string) => Promise<void>;
  uploadStepDocument: (orderId: string, folder: string, file: File) => Promise<{ path: string; name: string }>;
  stepDocumentUrl: (path: string) => Promise<string>;
  setStepOwner: (stepKey: string, input: StepOwnerInput) => Promise<void>;
  setConfig: (key: string, value: Record<string, unknown>) => Promise<void>;
  insertMaster: (mt: DispatchMasterType, input: MasterInput) => Promise<void>;
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
  const transporters = data?.transporters ?? [];
  const units = data?.units ?? [];
  const categories = data?.categories ?? [];
  const orderSources = data?.orderSources ?? [];
  const paymentTerms = data?.paymentTerms ?? [];
  const shortfallReasons = data?.shortfallReasons ?? [];
  const packingTypes = data?.packingTypes ?? [];
  const mailTemplates = data?.mailTemplates ?? [];
  const drivers = data?.drivers ?? [];
  const customers = data?.customers ?? [];
  const shipTos = data?.shipTos ?? [];
  const items = data?.items ?? [];
  const lots = data?.lots ?? [];
  const godowns = data?.godowns ?? [];
  const gates = data?.gates ?? [];
  const invoiceSeries = data?.invoiceSeries ?? [];
  const vehicles = data?.vehicles ?? [];
  const masterManagers = data?.masterManagers ?? [];
  const masterRequests = data?.masterRequests ?? [];
  const orders = data?.orders ?? [];
  const activity = data?.activity ?? [];
  const notifications = data?.notifications ?? [];
  const processCoordinatorIds = data?.config.processCoordinatorIds ?? [];
  const stepSla = data?.config.stepSla ?? DEFAULT_STEP_SLA;
  const customerMail = data?.config.customerMail ?? { enabled: false, templateCode: "dispatch_plan" };
  const orderNoPreview = data?.orderNoPreview ?? "";

  const value = useMemo<DispatchStoreValue>(() => {
    const uid = userId ?? "";
    const invalidate = () => queryClient.invalidateQueries({ queryKey: QK });

    const stepOwnerFor = (stepKey: StepKey) => stepOwners.find((o) => o.stepKey === stepKey);

    const isStepOwner = (stepKey: StepKey): boolean =>
      isAdmin || stepOwners.some((o) => o.stepKey === stepKey && o.employeeIds.includes(uid));

    const isProcessCoordinator = isAdmin || processCoordinatorIds.includes(uid);

    const personName = (id: string | null): string => {
      if (!id) return "—";
      return (orgPeople ?? []).find((p) => p.id === id)?.name ?? "Unknown user";
    };

    /**
     * Mirrors fms_dispatch_can_act(step, order, uid): admin / coordinator / step
     * owner — PLUS, for the last step only, the portal user linked to the order's
     * driver. Without that arm the person who actually delivered cannot close it.
     */
    const canActOn = (stepKey: QueueStep, o: DispatchOrder): boolean => {
      if (isAdmin || isProcessCoordinator || isStepOwner(stepKey)) return true;
      if (stepKey !== "dispatch_confirm") return false;
      const driverId = o.dcDriverId ?? o.goDriverId;
      if (!driverId) return false;
      return drivers.some((d) => d.id === driverId && d.userId === uid);
    };

    /**
     * Who may raise an order: open to every granted user unless `sales_order` has
     * owners configured, then only those owners (or admin / coordinator). The DB
     * deliberately allows owners on the origin step — see the foundations migration.
     */
    const salesOrderOwners = stepOwnerFor("sales_order")?.employeeIds ?? [];
    const canRaise = salesOrderOwners.length === 0 || isAdmin || isProcessCoordinator || salesOrderOwners.includes(uid);

    /** Mirrors fms_dispatch_update_order's authz: the raiser / admin / coordinator,
     *  and only while the order is still at the origin step. */
    const canEditOrder = (o: DispatchOrder): boolean =>
      (o.raisedBy === uid || isAdmin || isProcessCoordinator) &&
      o.status === "awaiting_credit_check" &&
      o.ccAt == null;

    const ownerNamesFor = (stepKey: StepKey): string[] =>
      (stepOwnerFor(stepKey)?.employeeIds ?? [])
        .map((id) => personName(id))
        .filter((n) => n !== "—" && n !== "Unknown user");

    /* --------------------------- masters --------------------------- */

    const activeOf = <T extends NamedMaster>(rows: T[]): T[] =>
      rows.filter((r) => r.active).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

    const MASTER_LIST: Record<DispatchMasterType, NamedMaster[]> = {
      company: companies,
      transporter: transporters,
      unit: units,
      category: categories,
      order_source: orderSources,
      payment_term: paymentTerms,
      shortfall_reason: shortfallReasons,
      packing_type: packingTypes,
      mail_template: mailTemplates,
      driver: drivers,
      customer: customers,
      ship_to: shipTos,
      item: items,
      lot: lots,
      godown: godowns,
      gate: gates,
      invoice_series: invoiceSeries,
      vehicle: vehicles,
    };

    // Display lookups read the FULL list, never the active-only one — a
    // deactivated customer must still render by name on an old order.
    const nameFrom = (rows: NamedMaster[], id: string | null): string =>
      !id ? "—" : rows.find((r) => r.id === id)?.name ?? "—";

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
      canEditOrder,
      isStepOwner,
      stepOwnerFor,
      ownerNamesFor,
      personName,

      profiles: dir.profiles,
      orgDepartments: dir.departments,
      designations,
      dispatchUsers: dir.profiles,

      companies, transporters, units, categories, orderSources, paymentTerms,
      shortfallReasons, packingTypes, mailTemplates, drivers, customers, shipTos,
      items, lots, godowns, gates, invoiceSeries, vehicles,
      activeOf,
      masterList: (mt) => MASTER_LIST[mt],

      customerName: (id) => nameFrom(customers, id),
      itemName: (id) => nameFrom(items, id),
      unitName: (id) => nameFrom(units, id),
      lotName: (id) => nameFrom(lots, id),
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

      // Owner-agnostic on purpose: the page composes "Mine" on top, and the
      // Control Centers must count everyone's work.
      myQueue: (step) =>
        queueEntries
          .filter((e) => e.stepKey === step)
          .map((e) => ({ order: orderIndex.get(e.entityId)!, dueIso: e.dueIso }))
          .filter((r) => !!r.order),
      completedFor: (step) => completedForPure(snapshot, step),

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
      customerMail,

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
      uploadStepDocument: uploadStepDocumentWrite,
      stepDocumentUrl: stepDocumentUrlWrite,
      setStepOwner: async (stepKey, input) => {
        await setStepOwnerWrite(stepKey, input);
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
    stepOwners, designations, companies, transporters, units, categories, orderSources,
    paymentTerms, shortfallReasons, packingTypes, mailTemplates, drivers, customers, shipTos,
    items, lots, godowns, gates, invoiceSeries, vehicles,
    masterManagers, masterRequests, orders, activity, notifications,
    processCoordinatorIds, stepSla, customerMail, orderNoPreview,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDispatchStore(): DispatchStoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDispatchStore must be used inside DispatchStoreProvider");
  return v;
}
