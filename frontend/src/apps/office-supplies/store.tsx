import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { useDirectory } from "@/core/platform/store";
import type { Department as OrgDepartment, Profile } from "@/core/platform/types";
import { SUPPLIES_QK, fetchSuppliesData, suppliesQueryKey } from "./data/suppliesFetch";
import {
  announce as announceWrite,
  cancelRequest as cancelRequestWrite,
  decideFirstApproval as decideFirstApprovalWrite,
  decideSecondApproval as decideSecondApprovalWrite,
  holdRequest as holdRequestWrite,
  insertCategory as insertCategoryWrite,
  insertCompany as insertCompanyWrite,
  insertDepartment as insertDepartmentWrite,
  insertItem as insertItemWrite,
  insertServiceType as insertServiceTypeWrite,
  markNotificationsRead as markNotificationsReadWrite,
  recordHandover as recordHandoverWrite,
  requestNewMaster as requestNewMasterWrite,
  resolveMasterRequest as resolveMasterRequestWrite,
  setConfig as setConfigWrite,
  setMasterManagers as setMasterManagersWrite,
  setStepOwner as setStepOwnerWrite,
  submitRequest as submitRequestWrite,
  updateCategory as updateCategoryWrite,
  updateCompany as updateCompanyWrite,
  updateDepartment as updateDepartmentWrite,
  updateItem as updateItemWrite,
  updateServiceType as updateServiceTypeWrite,
  type CategoryInput,
  type CompanyInput,
  type DepartmentInput,
  type HandoverInput,
  type ItemInput,
  type RequestInput,
  type ServiceTypeInput,
  type StepOwnerInput,
} from "./data/suppliesWrites";
import { buildQueueEntries, isOpenRequest, supplyDueIso, supplySnapshotFrom, type QueueEntry, type SupplySnapshot } from "./lib/queues";
import { DEFAULT_STEP_SLA, type StepSlaMap } from "./lib/sla";
import { masterTypeLabel } from "./lib/masterFields";
import type { StepKey } from "./lib/steps";
import type {
  Category,
  Company,
  Department,
  Designation,
  Item,
  ServiceType,
  StepOwner,
  SupplyActivity,
  SupplyEntityType,
  SupplyMasterManager,
  SupplyMasterRequest,
  SupplyMasterType,
  SupplyNotification,
  SupplyRequest,
} from "./types";

const QK = SUPPLIES_QK;

const FULFILMENT_STEPS: StepKey[] = ["second_approval", "handover"];

interface SuppliesStoreValue {
  isLoading: boolean;
  error: unknown;

  // directory (portal)
  profiles: Profile[];
  orgDepartments: OrgDepartment[];
  designations: Designation[];
  profileById: (id: string) => Profile | undefined;

  // masters
  companies: Company[];
  departments: Department[];
  categories: Category[];
  items: Item[];
  serviceTypes: ServiceType[];
  activeCompanies: Company[];
  activeDepartments: Department[];
  activeCategories: Category[];
  activeServiceTypes: ServiceType[];
  itemsForCategory: (categoryId: string) => Item[];
  companyById: (id: string) => Company | undefined;
  departmentById: (id: string) => Department | undefined;
  categoryById: (id: string) => Category | undefined;
  serviceTypeById: (id: string) => ServiceType | undefined;

  // config
  stepOwners: StepOwner[];
  stepOwnerFor: (stepKey: StepKey) => StepOwner | undefined;
  processCoordinatorIds: string[];
  stepSla: StepSlaMap;

  // capabilities
  isAdmin: boolean;
  isProcessCoordinator: boolean;
  isStepOwner: (stepKey: StepKey) => boolean;
  isFulfilmentStaff: boolean;
  /** Departments this user is the HOD of — drives the First Approval queue visibility. */
  hodDepartmentIds: string[];
  canActOn: (stepKey: StepKey, r: SupplyRequest) => boolean;

  // master governance
  masterManagers: SupplyMasterManager[];
  masterRequests: SupplyMasterRequest[];
  pendingRequests: SupplyMasterRequest[];
  managerIdsFor: (masterType: SupplyMasterType) => string[];
  canManage: (masterType: SupplyMasterType) => boolean;
  isAnyMasterManager: boolean;
  canManageMasters: boolean;
  resolvableRequests: SupplyMasterRequest[];
  myMasterRequests: SupplyMasterRequest[];
  masterReviewersFor: (masterType: SupplyMasterType) => string[];
  isMasterUnassigned: (masterType: SupplyMasterType) => boolean;
  setMasterManagers: (masterType: SupplyMasterType, userIds: string[]) => Promise<void>;
  requestNewMaster: (masterType: SupplyMasterType, payload: Record<string, unknown>) => Promise<string>;
  resolveMasterRequest: (
    requestId: string,
    approve: boolean,
    payload: Record<string, unknown> | null,
    note: string | null,
  ) => Promise<string | null>;

  // requests
  requests: SupplyRequest[];
  requestById: (id: string) => SupplyRequest | undefined;
  myRequests: SupplyRequest[];
  isOpenRequest: (r: SupplyRequest) => boolean;

  // queues
  queueEntries: QueueEntry[];
  myQueue: (stepKey: StepKey) => QueueEntry[];
  dueIsoFor: (r: SupplyRequest, stepKey: StepKey) => string | null;
  queueOwnerIds: (e: QueueEntry) => string[];

  // activity + bell
  activity: SupplyActivity[];
  activityFor: (entityType: SupplyEntityType, entityId: string) => SupplyActivity[];
  notifications: SupplyNotification[];
  unreadCount: number;
  markNotificationsRead: (ids: string[]) => Promise<void>;

  // workflow writes
  submitRequest: (input: RequestInput) => Promise<string>;
  decideFirstApproval: (r: SupplyRequest, approve: boolean, remarks: string) => Promise<void>;
  decideSecondApproval: (r: SupplyRequest, approve: boolean, remarks: string) => Promise<void>;
  recordHandover: (r: SupplyRequest, input: HandoverInput) => Promise<void>;
  holdRequest: (r: SupplyRequest, hold: boolean, reason: string) => Promise<void>;
  cancelRequest: (r: SupplyRequest, reason: string) => Promise<void>;

  // config writes
  setStepOwner: (stepKey: StepKey, input: StepOwnerInput) => Promise<void>;
  setStepSla: (map: StepSlaMap) => Promise<void>;
  setCoordinators: (userIds: string[]) => Promise<void>;

  // master writes
  insertCompany: (input: CompanyInput) => Promise<void>;
  updateCompany: (id: string, input: CompanyInput) => Promise<void>;
  insertDepartment: (input: DepartmentInput) => Promise<void>;
  updateDepartment: (id: string, input: DepartmentInput) => Promise<void>;
  insertCategory: (input: CategoryInput) => Promise<void>;
  updateCategory: (id: string, input: CategoryInput) => Promise<void>;
  insertItem: (input: ItemInput) => Promise<void>;
  updateItem: (id: string, input: ItemInput) => Promise<void>;
  insertServiceType: (input: ServiceTypeInput) => Promise<void>;
  updateServiceType: (id: string, input: ServiceTypeInput) => Promise<void>;
}

const Ctx = createContext<SuppliesStoreValue | null>(null);

export function SuppliesStoreProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const dir = useDirectory();
  const queryClient = useQueryClient();
  const userId = session.user?.id ?? null;
  const isAdmin = session.isAdmin;

  const { data, isLoading, error } = useQuery({
    queryKey: suppliesQueryKey(userId),
    queryFn: fetchSuppliesData,
    enabled: !!session.user,
  });

  const stepOwners = data?.stepOwners ?? [];
  const designations = data?.designations ?? [];
  const companies = data?.companies ?? [];
  const departments = data?.departments ?? [];
  const categories = data?.categories ?? [];
  const items = data?.items ?? [];
  const serviceTypes = data?.serviceTypes ?? [];
  const masterManagers = data?.masterManagers ?? [];
  const masterRequests = data?.masterRequests ?? [];
  const requests = data?.requests ?? [];
  const activity = data?.activity ?? [];
  const notifications = data?.notifications ?? [];
  const processCoordinatorIds = data?.config.processCoordinatorIds ?? [];
  const stepSla = data?.config.stepSla ?? DEFAULT_STEP_SLA;

  const value = useMemo<SuppliesStoreValue>(() => {
    const uid = userId ?? "";
    const invalidate = () => queryClient.invalidateQueries({ queryKey: QK });

    const stepOwnerFor = (stepKey: StepKey) => stepOwners.find((o) => o.stepKey === stepKey);
    const ownerIdsOf = (stepKey: StepKey): string[] => stepOwnerFor(stepKey)?.employeeIds ?? [];

    const isStepOwner = (stepKey: StepKey): boolean =>
      isAdmin || stepOwners.some((o) => o.stepKey === stepKey && o.employeeIds.includes(uid));

    const isFulfilmentStaff =
      isAdmin || stepOwners.some((o) => FULFILMENT_STEPS.includes(o.stepKey as StepKey) && o.employeeIds.includes(uid));

    const isProcessCoordinator = isAdmin || processCoordinatorIds.includes(uid);

    const hodDepartmentIds = departments.filter((d) => d.hodUserId === uid).map((d) => d.id);

    const departmentById = (id: string) => departments.find((d) => d.id === id);

    const canActOn = (stepKey: StepKey, r: SupplyRequest): boolean => {
      if (isAdmin || isProcessCoordinator) return true;
      if (stepKey === "first_approval") {
        const hod = departmentById(r.departmentId)?.hodUserId;
        if (hod && hod === uid) return true;
      }
      return isStepOwner(stepKey);
    };

    /* --------------------------- master governance --------------------------- */

    const managerIdsFor = (mt: SupplyMasterType) =>
      masterManagers.filter((m) => m.masterType === mt).map((m) => m.managerUserId);
    const canManage = (mt: SupplyMasterType) => isAdmin || managerIdsFor(mt).includes(uid);
    const isAnyMasterManager = isAdmin || masterManagers.some((m) => m.managerUserId === uid);
    const resolvableRequests = masterRequests.filter((r) => r.status === "pending").filter((r) => canManage(r.masterType));
    const adminIds = () => dir.profiles.filter((p) => p.role === "admin").map((p) => p.id);
    const masterReviewersFor = (mt: SupplyMasterType): string[] => {
      const ids = managerIdsFor(mt);
      return ids.length ? ids : adminIds();
    };
    const isMasterUnassigned = (mt: SupplyMasterType) => managerIdsFor(mt).length === 0;

    /* --------------------------------- indexes ------------------------------- */

    const activityByEntity = new Map<string, SupplyActivity[]>();
    for (const a of activity) {
      const k = `${a.entityType}:${a.entityId}`;
      const list = activityByEntity.get(k) ?? [];
      list.push(a);
      activityByEntity.set(k, list);
    }

    const mine = notifications.filter((n) => n.userId === uid);

    const safeAnnounce = async (input: Parameters<typeof announceWrite>[0]) => {
      try {
        await announceWrite(input);
      } catch {
        /* best-effort; state lives on the request row */
      }
    };

    const requestMap = new Map(requests.map((r) => [r.id, r]));

    const itemsByCategory = new Map<string, Item[]>();
    for (const it of items) {
      const list = itemsByCategory.get(it.categoryId) ?? [];
      list.push(it);
      itemsByCategory.set(it.categoryId, list);
    }
    for (const list of itemsByCategory.values()) {
      list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    }

    const snapshot: SupplySnapshot = supplySnapshotFrom({ requests, stepSla });
    const queueEntries = buildQueueEntries(snapshot);

    const myQueue = (stepKey: StepKey): QueueEntry[] =>
      queueEntries.filter((e) => {
        if (e.stepKey !== stepKey) return false;
        const r = requestMap.get(e.requestId);
        return r ? canActOn(stepKey, r) : false;
      });

    const queueOwnerIds = (e: QueueEntry): string[] => {
      if (e.stepKey === "first_approval") {
        const r = requestMap.get(e.requestId);
        const hod = r ? departmentById(r.departmentId)?.hodUserId : null;
        const owners = ownerIdsOf("first_approval");
        return Array.from(new Set([...(hod ? [hod] : []), ...owners]));
      }
      return ownerIdsOf(e.stepKey);
    };

    const byOrder = <T extends { active: boolean; sortOrder: number; name: string }>(rows: T[]): T[] =>
      rows.filter((r) => r.active).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

    return {
      isLoading,
      error,

      profiles: dir.profiles,
      orgDepartments: dir.departments,
      designations,
      profileById: dir.profileById,

      companies,
      departments,
      categories,
      items,
      serviceTypes,
      activeCompanies: byOrder(companies),
      activeDepartments: byOrder(departments),
      activeCategories: byOrder(categories),
      activeServiceTypes: byOrder(serviceTypes),
      itemsForCategory: (categoryId) => (itemsByCategory.get(categoryId) ?? []).filter((i) => i.active),
      companyById: (id) => companies.find((c) => c.id === id),
      departmentById,
      categoryById: (id) => categories.find((c) => c.id === id),
      serviceTypeById: (id) => serviceTypes.find((c) => c.id === id),

      stepOwners,
      stepOwnerFor,
      processCoordinatorIds,
      stepSla,

      isAdmin,
      isProcessCoordinator,
      isStepOwner,
      isFulfilmentStaff,
      hodDepartmentIds,
      canActOn,

      masterManagers,
      masterRequests,
      pendingRequests: masterRequests.filter((r) => r.status === "pending"),
      managerIdsFor,
      canManage,
      isAnyMasterManager,
      canManageMasters: isAnyMasterManager,
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
        const id = await requestNewMasterWrite(masterType, payload, uid);
        const name = String(payload.name ?? "entry");
        await safeAnnounce({
          entityType: "master_request",
          entityId: id,
          type: "master_requested",
          text: `A new ${masterTypeLabel(masterType)} was requested — "${name}". Review it.`,
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
        const name = String((finalPayload as Record<string, unknown>).name ?? "entry");
        const label = req ? masterTypeLabel(req.masterType) : "entry";
        await safeAnnounce({
          entityType: "master_request",
          entityId: requestId,
          type: approve ? "master_approved" : "master_rejected",
          text: approve
            ? `Your ${label} request — "${name}" — was approved. It is now selectable.`
            : `Your ${label} request — "${name}" — was rejected${note ? `: ${note}` : "."}`,
          recipients: req?.requestedBy ? [req.requestedBy] : [],
          meta: { masterType: req?.masterType, resolvedMasterId: newId },
        });
        await invalidate();
        return newId;
      },

      requests,
      requestById: (id) => requestMap.get(id),
      myRequests: requests.filter((r) => r.raisedBy === uid || r.requestedForUserId === uid),
      isOpenRequest,

      queueEntries,
      myQueue,
      dueIsoFor: (r, stepKey) => supplyDueIso(snapshot, r, stepKey),
      queueOwnerIds,

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
        // The RPC already fanned out from its SECURITY DEFINER context (the only way a
        // plain requester can notify approvers they cannot otherwise write to).
        await invalidate();
        return id;
      },
      decideFirstApproval: async (r, approve, remarks) => {
        await decideFirstApprovalWrite(r.id, approve, remarks);
        await safeAnnounce({
          entityType: "request",
          entityId: r.id,
          type: approve ? "first_approved" : "first_rejected",
          text: approve
            ? `${r.reqNo} passed first approval — it now needs the second (Management) approval.`
            : `${r.reqNo} was not approved${remarks ? `: ${remarks}` : "."}`,
          recipients: approve
            ? ownerIdsOf("second_approval")
            : [r.raisedBy, r.requestedForUserId].filter((x): x is string => !!x),
        });
        await invalidate();
      },
      decideSecondApproval: async (r, approve, remarks) => {
        await decideSecondApprovalWrite(r.id, approve, remarks);
        await safeAnnounce({
          entityType: "request",
          entityId: r.id,
          type: approve ? "second_approved" : "second_rejected",
          text: approve
            ? `${r.reqNo} is approved and ready for handover.`
            : `${r.reqNo} was not approved${remarks ? `: ${remarks}` : "."}`,
          recipients: approve
            ? ownerIdsOf("handover")
            : [r.raisedBy, r.requestedForUserId].filter((x): x is string => !!x),
        });
        await invalidate();
      },
      recordHandover: async (r, input) => {
        await recordHandoverWrite(r.id, input);
        if (input.actualDeliveryDate) {
          await safeAnnounce({
            entityType: "request",
            entityId: r.id,
            type: "delivered",
            text: `${r.reqNo} (${r.requestedForName}) has been delivered.`,
            recipients: [r.raisedBy, r.requestedForUserId].filter((x): x is string => !!x),
          });
        }
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

      insertCompany: async (input) => {
        await insertCompanyWrite(input);
        await invalidate();
      },
      updateCompany: async (id, input) => {
        await updateCompanyWrite(id, input);
        await invalidate();
      },
      insertDepartment: async (input) => {
        await insertDepartmentWrite(input);
        await invalidate();
      },
      updateDepartment: async (id, input) => {
        await updateDepartmentWrite(id, input);
        await invalidate();
      },
      insertCategory: async (input) => {
        await insertCategoryWrite(input);
        await invalidate();
      },
      updateCategory: async (id, input) => {
        await updateCategoryWrite(id, input);
        await invalidate();
      },
      insertItem: async (input) => {
        await insertItemWrite(input);
        await invalidate();
      },
      updateItem: async (id, input) => {
        await updateItemWrite(id, input);
        await invalidate();
      },
      insertServiceType: async (input) => {
        await insertServiceTypeWrite(input);
        await invalidate();
      },
      updateServiceType: async (id, input) => {
        await updateServiceTypeWrite(id, input);
        await invalidate();
      },
    };
  }, [
    isLoading, error, dir, userId, isAdmin, designations, companies, departments, categories, items,
    serviceTypes, masterManagers, masterRequests, requests, activity, notifications,
    stepOwners, processCoordinatorIds, stepSla, queryClient,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSuppliesStore(): SuppliesStoreValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSuppliesStore must be used within SuppliesStoreProvider");
  return ctx;
}
