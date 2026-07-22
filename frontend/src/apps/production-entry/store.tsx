import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { useDirectory } from "@/core/platform/store";
import { fetchOrgPeople } from "@/core/platform/orgPeople";
import type { Department as OrgDepartment, Profile } from "@/core/platform/types";
import { PRODUCTION_QK, fetchProductionData, productionQueryKey } from "./data/productionFetch";
import {
  announce as announceWrite,
  cancelRequest as cancelRequestWrite,
  holdRequest as holdRequestWrite,
  insertMaster as insertMasterWrite,
  markNotificationsRead as markNotificationsReadWrite,
  qualityDocumentUrl as qualityDocumentUrlWrite,
  recordStep as recordStepWrite,
  requestNewMaster as requestNewMasterWrite,
  resolveMasterRequest as resolveMasterRequestWrite,
  setConfig as setConfigWrite,
  setMasterManagers as setMasterManagersWrite,
  setStepOwner as setStepOwnerWrite,
  submitRequest as submitRequestWrite,
  updateMaster as updateMasterWrite,
  updateStep as updateStepWrite,
  type MasterInput,
  type RequestInput,
  type StepOwnerInput,
  type StepPayload,
} from "./data/productionWrites";
import {
  buildQueueEntries,
  completedFor as completedForPure,
  isOpenRequest,
  productionDueIso,
  productionSnapshotFrom,
  type ProductionSnapshot,
  type QueueEntry,
  type QueueStep,
  type StageEntry,
} from "./lib/queues";
import { masterTypeLabel } from "./lib/masterFields";
import { DEFAULT_STEP_SLA, type StepSlaMap } from "./lib/sla";
import type { StepKey } from "./lib/steps";
import type {
  Category,
  Designation,
  FgItem,
  NamedMaster,
  ProductionActivity,
  ProductionEntityType,
  ProductionMasterManager,
  ProductionMasterRequest,
  ProductionMasterType,
  ProductionNotification,
  ProductionRequest,
  RawMaterial,
  StepOwner,
  Unit,
} from "./types";

const QK = PRODUCTION_QK;

interface ProductionStoreValue {
  isLoading: boolean;
  error: unknown;

  // directory (portal)
  profiles: Profile[];
  orgDepartments: OrgDepartment[];
  designations: Designation[];
  profileById: (id: string) => Profile | undefined;

  // masters
  categories: Category[];
  rawMaterials: RawMaterial[];
  fgItems: FgItem[];
  units: Unit[];
  activeCategories: Category[];
  activeRawMaterials: RawMaterial[];
  activeFgItems: FgItem[];
  activeUnits: Unit[];
  categoryById: (id: string | null) => Category | undefined;
  rawMaterialById: (id: string | null) => RawMaterial | undefined;
  fgItemById: (id: string | null) => FgItem | undefined;
  unitById: (id: string | null) => Unit | undefined;
  masterList: (mt: ProductionMasterType) => NamedMaster[];

  // config
  stepOwners: StepOwner[];
  stepOwnerFor: (stepKey: StepKey) => StepOwner | undefined;
  processCoordinatorIds: string[];
  stepSla: StepSlaMap;

  // capabilities
  isAdmin: boolean;
  isProcessCoordinator: boolean;
  isStepOwner: (stepKey: StepKey) => boolean;
  canActOn: (stepKey: QueueStep, r: ProductionRequest) => boolean;

  // master governance
  masterManagers: ProductionMasterManager[];
  managerIdsFor: (masterType: ProductionMasterType) => string[];
  canManage: (masterType: ProductionMasterType) => boolean;
  isAnyMasterManager: boolean;
  masterRequests: ProductionMasterRequest[];
  resolvableRequests: ProductionMasterRequest[];
  myMasterRequests: ProductionMasterRequest[];
  masterReviewersFor: (masterType: ProductionMasterType) => string[];
  isMasterUnassigned: (masterType: ProductionMasterType) => boolean;
  setMasterManagers: (masterType: ProductionMasterType, userIds: string[]) => Promise<void>;
  requestNewMaster: (masterType: ProductionMasterType, payload: Record<string, unknown>) => Promise<string>;
  resolveMasterRequest: (
    requestId: string,
    approve: boolean,
    payload: Record<string, unknown> | null,
    note: string | null,
  ) => Promise<string | null>;

  // requests
  requests: ProductionRequest[];
  requestById: (id: string) => ProductionRequest | undefined;
  myRequests: ProductionRequest[];
  isOpenRequest: (r: ProductionRequest) => boolean;

  // queues
  queueEntries: QueueEntry[];
  myQueue: (stepKey: QueueStep) => QueueEntry[];
  dueIsoFor: (r: ProductionRequest, stepKey: QueueStep) => string | null;
  completedFor: (stepKey: QueueStep) => StageEntry<ProductionRequest>[];
  personName: (id: string | null) => string;

  // activity + bell
  activity: ProductionActivity[];
  activityFor: (entityType: ProductionEntityType, entityId: string) => ProductionActivity[];
  notifications: ProductionNotification[];
  unreadCount: number;
  markNotificationsRead: (ids: string[]) => Promise<void>;

  // workflow writes
  submitRequest: (input: RequestInput) => Promise<string>;
  recordStep: (stepKey: QueueStep, r: ProductionRequest, payload: StepPayload) => Promise<void>;
  updateStep: (stepKey: QueueStep, r: ProductionRequest, payload: StepPayload) => Promise<void>;
  holdRequest: (r: ProductionRequest, hold: boolean, reason: string) => Promise<void>;
  cancelRequest: (r: ProductionRequest, reason: string) => Promise<void>;

  // documents
  qcDocumentUrl: (path: string) => Promise<string>;

  // config writes
  setStepOwner: (stepKey: StepKey, input: StepOwnerInput) => Promise<void>;
  setStepSla: (map: StepSlaMap) => Promise<void>;
  setCoordinators: (userIds: string[]) => Promise<void>;

  // master writes
  insertMaster: (mt: ProductionMasterType, input: MasterInput) => Promise<void>;
  updateMaster: (mt: ProductionMasterType, id: string, input: MasterInput) => Promise<void>;
}

const Ctx = createContext<ProductionStoreValue | null>(null);

export function ProductionStoreProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const dir = useDirectory();
  const queryClient = useQueryClient();
  const userId = session.user?.id ?? null;
  const isAdmin = session.isAdmin;

  const { data, isLoading, error } = useQuery({
    queryKey: productionQueryKey(userId),
    queryFn: fetchProductionData,
    enabled: !!session.user,
  });

  // Org-wide names so a colleague's completed entry never renders blank.
  const { data: orgPeople } = useQuery({ queryKey: ["orgPeople"], queryFn: fetchOrgPeople, staleTime: 5 * 60 * 1000 });

  const stepOwners = data?.stepOwners ?? [];
  const designations = data?.designations ?? [];
  const categories = data?.categories ?? [];
  const rawMaterials = data?.rawMaterials ?? [];
  const fgItems = data?.fgItems ?? [];
  const units = data?.units ?? [];
  const masterManagers = data?.masterManagers ?? [];
  const masterRequests = data?.masterRequests ?? [];
  const requests = data?.requests ?? [];
  const activity = data?.activity ?? [];
  const notifications = data?.notifications ?? [];
  const processCoordinatorIds = data?.config.processCoordinatorIds ?? [];
  const stepSla = data?.config.stepSla ?? DEFAULT_STEP_SLA;

  const value = useMemo<ProductionStoreValue>(() => {
    const uid = userId ?? "";
    const invalidate = () => queryClient.invalidateQueries({ queryKey: QK });

    const stepOwnerFor = (stepKey: StepKey) => stepOwners.find((o) => o.stepKey === stepKey);

    const isStepOwner = (stepKey: StepKey): boolean =>
      isAdmin || stepOwners.some((o) => o.stepKey === stepKey && o.employeeIds.includes(uid));

    const isProcessCoordinator = isAdmin || processCoordinatorIds.includes(uid);

    // Mirrors fms_production_can_act(step, req, uid): admin / coordinator / step owner.
    const canActOn = (stepKey: QueueStep, _r: ProductionRequest): boolean =>
      isAdmin || isProcessCoordinator || isStepOwner(stepKey);

    const personName = (id: string | null): string => {
      if (!id) return "—";
      return (orgPeople ?? []).find((p) => p.id === id)?.name ?? "Unknown user";
    };

    /* --------------------------- masters --------------------------- */

    const byOrder = <T extends NamedMaster>(rows: T[]): T[] =>
      rows.filter((r) => r.active).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

    const MASTER_LIST: Record<ProductionMasterType, NamedMaster[]> = {
      category: categories,
      raw_material: rawMaterials,
      fg_item: fgItems,
      unit: units,
    };

    /* --------------------------- master governance --------------------------- */

    const managerIdsFor = (mt: ProductionMasterType) =>
      masterManagers.filter((m) => m.masterType === mt).map((m) => m.managerUserId);
    const canManage = (mt: ProductionMasterType) => isAdmin || managerIdsFor(mt).includes(uid);
    const isAnyMasterManager = isAdmin || masterManagers.some((m) => m.managerUserId === uid);

    const resolvableRequests = masterRequests.filter((r) => r.status === "pending").filter((r) => canManage(r.masterType));

    const adminIds = () => dir.profiles.filter((p) => p.role === "admin").map((p) => p.id);
    const masterReviewersFor = (mt: ProductionMasterType): string[] => {
      const ids = managerIdsFor(mt);
      return ids.length ? ids : adminIds();
    };
    const isMasterUnassigned = (mt: ProductionMasterType) => managerIdsFor(mt).length === 0;

    /* --------------------------------- indexes ------------------------------- */

    const activityByEntity = new Map<string, ProductionActivity[]>();
    for (const a of activity) {
      const k = `${a.entityType}:${a.entityId}`;
      const list = activityByEntity.get(k) ?? [];
      list.push(a);
      activityByEntity.set(k, list);
    }

    const mine = notifications
      .filter((n) => n.userId === uid)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const safeAnnounce = async (input: Parameters<typeof announceWrite>[0]) => {
      try {
        await announceWrite(input);
      } catch {
        /* best-effort; state lives on the request row */
      }
    };

    const requestMap = new Map(requests.map((r) => [r.id, r]));

    const snapshot: ProductionSnapshot = productionSnapshotFrom({ requests, stepSla });
    const queueEntries = buildQueueEntries(snapshot);

    const myQueue = (stepKey: QueueStep): QueueEntry[] =>
      queueEntries.filter((e) => {
        if (e.stepKey !== stepKey) return false;
        const r = requestMap.get(e.requestId);
        return r ? canActOn(stepKey, r) : false;
      });

    const idById = <T extends NamedMaster>(rows: T[], id: string | null): T | undefined =>
      id ? rows.find((c) => c.id === id) : undefined;

    return {
      isLoading,
      error,

      profiles: dir.profiles,
      orgDepartments: dir.departments,
      designations,
      profileById: dir.profileById,

      categories,
      rawMaterials,
      fgItems,
      units,
      activeCategories: byOrder(categories),
      activeRawMaterials: byOrder(rawMaterials),
      activeFgItems: byOrder(fgItems),
      activeUnits: byOrder(units),
      categoryById: (id) => idById(categories, id),
      rawMaterialById: (id) => idById(rawMaterials, id),
      fgItemById: (id) => idById(fgItems, id),
      unitById: (id) => idById(units, id),
      masterList: (mt) => MASTER_LIST[mt],

      stepOwners,
      stepOwnerFor,
      processCoordinatorIds,
      stepSla,

      isAdmin,
      isProcessCoordinator,
      isStepOwner,
      canActOn,

      masterManagers,
      managerIdsFor,
      canManage,
      isAnyMasterManager,
      masterRequests,
      resolvableRequests,
      myMasterRequests: masterRequests
        .filter((r) => r.requestedBy === uid)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      masterReviewersFor,
      isMasterUnassigned,
      setMasterManagers: async (masterType, userIds) => {
        await setMasterManagersWrite(masterType, userIds);
        await invalidate();
      },
      requestNewMaster: async (masterType, payload) => {
        const requesterId = session.user?.id ?? uid;
        const id = await requestNewMasterWrite(masterType, payload, requesterId);
        const name = String(payload.name ?? "entry");
        await safeAnnounce({
          entityType: "master_request",
          entityId: id,
          type: "master_requested",
          text: `requested a new ${masterTypeLabel(masterType)} — “${name}”. Review it.`,
          recipients: masterReviewersFor(masterType),
          meta: { masterType },
        });
        await invalidate();
        return id;
      },
      resolveMasterRequest: async (requestId, approve, payload, note) => {
        const req = masterRequests.find((r) => r.id === requestId);
        const newId = await resolveMasterRequestWrite(requestId, approve, payload, note);
        const finalPayload = payload ?? req?.proposedPayload ?? {};
        const name = String(finalPayload.name ?? "entry");
        const label = req ? masterTypeLabel(req.masterType) : "entry";
        await safeAnnounce({
          entityType: "master_request",
          entityId: requestId,
          type: approve ? "master_approved" : "master_rejected",
          text: approve ? `approved your new ${label} — “${name}”.` : `rejected your new ${label} — “${name}”.`,
          recipients: req?.requestedBy ? [req.requestedBy] : [],
        });
        await invalidate();
        return newId;
      },

      requests,
      requestById: (id) => requestMap.get(id),
      myRequests: requests.filter((r) => r.raisedBy === uid),
      isOpenRequest,

      queueEntries,
      myQueue,
      dueIsoFor: (r, stepKey) => productionDueIso(snapshot, r, stepKey),
      completedFor: (stepKey) => completedForPure(snapshot, stepKey),
      personName,

      activity,
      activityFor: (entityType, entityId) => activityByEntity.get(`${entityType}:${entityId}`) ?? [],
      notifications: mine,
      unreadCount: mine.filter((n) => !n.readAt).length,
      markNotificationsRead: async (ids) => {
        await markNotificationsReadWrite(ids);
        await invalidate();
      },

      /* ------------------------------ workflow ------------------------------ */

      submitRequest: async (input) => {
        const id = await submitRequestWrite(input);
        await invalidate();
        return id;
      },
      recordStep: async (stepKey, r, payload) => {
        await recordStepWrite(stepKey, r.id, payload);
        await invalidate();
      },
      updateStep: async (stepKey, r, payload) => {
        await updateStepWrite(stepKey, r.id, payload);
        await invalidate();
      },
      holdRequest: async (r, hold, reason) => {
        await holdRequestWrite(r.id, hold, reason);
        await invalidate();
      },
      cancelRequest: async (r, reason) => {
        await cancelRequestWrite(r.id, reason);
        await invalidate();
      },

      qcDocumentUrl: (path) => qualityDocumentUrlWrite(path),

      /* ------------------------------- config ------------------------------- */

      setStepOwner: async (stepKey, input) => {
        await setStepOwnerWrite(stepKey, input);
        await invalidate();
      },
      setStepSla: async (map) => {
        await setConfigWrite("step_sla", map as unknown as Record<string, unknown>);
        await invalidate();
      },
      setCoordinators: async (userIds) => {
        await setConfigWrite("process_coordinators", { user_ids: userIds });
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
    };
  }, [
    isLoading, error, dir, userId, isAdmin, designations, categories, rawMaterials, fgItems, units,
    masterManagers, masterRequests, requests, activity, notifications, stepOwners, processCoordinatorIds,
    stepSla, queryClient, session.user, orgPeople,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProductionStore(): ProductionStoreValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useProductionStore must be used within ProductionStoreProvider");
  return ctx;
}
