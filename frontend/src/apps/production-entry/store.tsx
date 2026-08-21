import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { useDirectory } from "@/core/platform/store";
import { fetchOrgPeople } from "@/core/platform/orgPeople";
import type { Department as OrgDepartment, Profile } from "@/core/platform/types";
import {
  PRODUCTION_QK,
  fetchProductionData,
  fetchProductionWorkflow,
  productionQueryKey,
  type ProductionData,
} from "./data/productionFetch";
import {
  announce as announceWrite,
  cancelRequest as cancelRequestWrite,
  holdRequest as holdRequestWrite,
  importBoms as importBomsWrite,
  insertMaster as insertMasterWrite,
  markNotificationsRead as markNotificationsReadWrite,
  markReadyToDispatch as markReadyToDispatchWrite,
  qualityDocumentUrl as qualityDocumentUrlWrite,
  recordFgTransferBulk as recordFgTransferBulkWrite,
  recordStep as recordStepWrite,
  requestNewMaster as requestNewMasterWrite,
  resolveMasterRequest as resolveMasterRequestWrite,
  saveBom as saveBomWrite,
  setConfig as setConfigWrite,
  setMasterManagers as setMasterManagersWrite,
  setStepOwner as setStepOwnerWrite,
  submitRequest as submitRequestWrite,
  updateRequest as updateRequestWrite,
  updateMaster as updateMasterWrite,
  updateStep as updateStepWrite,
  uploadStepDocument as uploadStepDocumentWrite,
  type BomImportBlock,
  type BomImportResult,
  type BomInput,
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
  trackingRequestsFor,
  type ProductionSnapshot,
  type QueueEntry,
  type QueueStep,
  type StageEntry,
} from "./lib/queues";
import { masterTypeLabel } from "./lib/masterFields";
import { DEFAULT_STEP_SLA, type StepSlaMap } from "./lib/sla";
import type { StepKey } from "./lib/steps";
import type {
  Bom,
  BomComponent,
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
  PackagingItem,
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
  packagingItems: PackagingItem[];
  fgItems: FgItem[];
  units: Unit[];
  activeCategories: Category[];
  activeRawMaterials: RawMaterial[];
  activePackagingItems: PackagingItem[];
  activeFgItems: FgItem[];
  activeUnits: Unit[];
  categoryById: (id: string | null) => Category | undefined;
  rawMaterialById: (id: string | null) => RawMaterial | undefined;
  packagingItemById: (id: string | null) => PackagingItem | undefined;
  fgItemById: (id: string | null) => FgItem | undefined;
  unitById: (id: string | null) => Unit | undefined;
  masterList: (mt: ProductionMasterType) => NamedMaster[];

  // BOM master
  boms: Bom[];
  activeBoms: Bom[];
  bomById: (id: string | null) => Bom | undefined;
  /** That FG's active BOMs, default first. Empty when the FG has none — in which
   *  case the job card simply falls back to manual entry. */
  bomsForFg: (fgItemId: string | null) => Bom[];
  /** The BOM a job card should reach for when this FG is picked, if any. */
  defaultBomForFg: (fgItemId: string | null) => Bom | undefined;
  /** A BOM's components in display order. */
  bomComponentsFor: (bomId: string | null) => BomComponent[];

  // config
  stepOwners: StepOwner[];
  stepOwnerFor: (stepKey: StepKey) => StepOwner | undefined;
  processCoordinatorIds: string[];
  stepSla: StepSlaMap;
  batchSeqStart: number;
  batchNoPreview: string;

  // capabilities
  isAdmin: boolean;
  isProcessCoordinator: boolean;
  isStepOwner: (stepKey: StepKey) => boolean;
  canActOn: (stepKey: QueueStep, r: ProductionRequest) => boolean;
  /** May this person see the step's queue at all — nav link, route, page. */
  canSeeQueue: (stepKey: QueueStep) => boolean;
  /**
   * Does this person's grant on Production Entry allow CHANGING anything? False
   * only on a view-only grant (Admin → Module Access).
   *
   * ⚠ A CEILING, never a permission — it grants nothing and only takes away, so it
   *   is ANDed into the write predicates and each button site. Kept OUT of
   *   canActOn / canSeeQueue / isProcessCoordinator, which decide what is SEEN.
   */
  canEdit: boolean;
  canRaise: boolean;

  // master governance
  masterManagers: ProductionMasterManager[];
  managerIdsFor: (masterType: ProductionMasterType) => string[];
  canManage: (masterType: ProductionMasterType) => boolean;
  /**
   * Does this person hold a VIEW-ONLY grant on this module? They read every
   * screen in it and have no buttons anywhere.
   *
   * ⚠ VISIBILITY ONLY. Folded into canSeeQueue, canMonitor and canSeeMasters and
   *   nowhere else; canEdit is false for exactly these users, which is what keeps
   *   the pages read-only.
   */
  isModuleViewer: boolean;
  /** Visibility half of isProcessCoordinator — the Control Center nav link and route. */
  canMonitor: boolean;
  /** Visibility half of isAnyMasterManager — the Masters nav link and route. */
  canSeeMasters: boolean;
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
  /** Whether the issue slip may still be edited (raiser/admin/coordinator, and the
   *  card is still awaiting its first material handover). Mirrors the RPC gate. */
  canEditRequest: (r: ProductionRequest) => boolean;

  // queues
  queueEntries: QueueEntry[];
  myQueue: (stepKey: QueueStep) => QueueEntry[];
  /** Read-only visibility rows shown in a step's Pending list though the card's
   *  actionable step is elsewhere (e.g. a QC-rejected lot in the AIS loop). */
  trackingFor: (stepKey: QueueStep) => { requestId: string; dueIso: string | null }[];
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
  updateRequest: (requestId: string, input: RequestInput) => Promise<void>;
  recordStep: (stepKey: QueueStep, r: ProductionRequest, payload: StepPayload) => Promise<void>;
  updateStep: (stepKey: QueueStep, r: ProductionRequest, payload: StepPayload) => Promise<void>;
  markReadyToDispatch: (requestIds: string[]) => Promise<number>;
  transferFgBulk: (requestIds: string[], file: File) => Promise<number>;
  holdRequest: (r: ProductionRequest, hold: boolean, reason: string) => Promise<void>;
  cancelRequest: (r: ProductionRequest, reason: string) => Promise<void>;

  // documents
  qcDocumentUrl: (path: string) => Promise<string>;

  // config writes
  setStepOwner: (stepKey: StepKey, input: StepOwnerInput) => Promise<void>;
  setStepSla: (map: StepSlaMap) => Promise<void>;
  setCoordinators: (userIds: string[]) => Promise<void>;
  setBatchSeqStart: (start: number) => Promise<void>;

  // master writes
  insertMaster: (mt: ProductionMasterType, input: MasterInput) => Promise<void>;
  updateMaster: (mt: ProductionMasterType, id: string, input: MasterInput) => Promise<void>;
  saveBom: (input: BomInput) => Promise<void>;
  importBoms: (blocks: BomImportBlock[]) => Promise<BomImportResult>;
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
    // Serve cached data instantly instead of re-running the heavy 13-table fetch on
    // every mount / window-focus (which left step modals showing 0s while it ran).
    // Writes call invalidate(), so data still refreshes immediately after any change.
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  // Org-wide names so a colleague's completed entry never renders blank.
  const { data: orgPeople } = useQuery({ queryKey: ["orgPeople"], queryFn: fetchOrgPeople, staleTime: 5 * 60 * 1000 });

  const stepOwners = data?.stepOwners ?? [];
  const designations = data?.designations ?? [];
  const categories = data?.categories ?? [];
  const rawMaterials = data?.rawMaterials ?? [];
  const packagingItems = data?.packagingItems ?? [];
  const fgItems = data?.fgItems ?? [];
  const units = data?.units ?? [];
  const boms = data?.boms ?? [];
  const bomComponents = data?.bomComponents ?? [];
  const masterManagers = data?.masterManagers ?? [];
  const masterRequests = data?.masterRequests ?? [];
  const requests = data?.requests ?? [];
  const activity = data?.activity ?? [];
  const notifications = data?.notifications ?? [];
  const processCoordinatorIds = data?.config.processCoordinatorIds ?? [];
  const stepSla = data?.config.stepSla ?? DEFAULT_STEP_SLA;
  const batchSeqStart = data?.config.batchSeqStart ?? 1;
  const batchNoPreview = data?.batchNoPreview ?? "";

  const value = useMemo<ProductionStoreValue>(() => {
    const uid = userId ?? "";
    /** Full re-read — for anything that can move a MASTER (items, BOMs, owners,
     *  config, master requests). Fifteen tables plus the lot-number peek. */
    const invalidate = () => queryClient.invalidateQueries({ queryKey: QK });

    /**
     * Re-read ONLY what a workflow write can have changed — the cards, the
     * activity trail, the notifications, the next lot number.
     *
     * Every save awaits its refresh before the modal closes, which is right: the
     * queue behind it must already show the new state, or the person clicks the
     * button again. What was wrong was WHAT it waited for — a full re-read of a
     * dozen master tables that recording a step cannot touch. This cuts the wait
     * to the four calls that can actually differ.
     *
     * Falls back to a full invalidate when there is no cached data to merge into
     * (a save cannot realistically happen then, but a partial write into an empty
     * cache would leave the app with cards and no items to name them with).
     */
    const refreshWorkflow = async () => {
      const key = productionQueryKey(userId);
      const prev = queryClient.getQueryData<ProductionData>(key);
      if (!prev) {
        await invalidate();
        return;
      }
      const slice = await fetchProductionWorkflow();
      queryClient.setQueryData<ProductionData>(key, { ...prev, ...slice });
    };

    const stepOwnerFor = (stepKey: StepKey) => stepOwners.find((o) => o.stepKey === stepKey);

    const isStepOwner = (stepKey: StepKey): boolean =>
      isAdmin || stepOwners.some((o) => o.stepKey === stepKey && o.employeeIds.includes(uid));

    const isProcessCoordinator = isAdmin || processCoordinatorIds.includes(uid);

    /**
     * A "View only" grant on this module is a READ-THE-WHOLE-MODULE grant: every
     * queue, every list, the Control Center, the Masters screens — with no
     * buttons anywhere.
     *
     * ⚠ VISIBILITY ONLY, which is why it is a flag of its own rather than an
     *   extra arm on `isProcessCoordinator`. That one is a route guard AND an
     *   authority short-circuit inside canActOn / canRaise / canEditRequest, so
     *   widening it would hand a viewer act-authority on every step. `canMonitor`
     *   and `canSeeMasters` below are the visibility halves, split off for the
     *   nav and the route guards.
     *
     * ⚠ From the REAL `session`, never a demo persona — same reason as canEdit.
     *
     * A viewer therefore sees MORE screens than an editor who owns no step. That
     * inversion is deliberate: ownership answers "whose work is this", the grant
     * answers "may this person read the module".
     */
    const isModuleViewer = session.isModuleViewer("production-entry");

    /** Visibility half of the coordinator flag — nav link + RequireMonitor only. */
    const canMonitor = isModuleViewer || isProcessCoordinator;

    // Mirrors fms_production_can_act(step, req, uid): admin / coordinator / step owner.
    const canActOn = (stepKey: QueueStep, _r: ProductionRequest): boolean =>
      isAdmin || isProcessCoordinator || isStepOwner(stepKey);

    /**
     * May this person see the step's QUEUE at all — the nav link, the route, the page?
     *
     * The same disjunction `canActOn` reduces to once the row is dropped, which is
     * the whole rule here: this module has no per-request actor. The nav carried a
     * third `myQueue(step).length > 0` clause that could never add anything (that
     * queue is itself filtered by `canActOn`), so both now ask this instead.
     */
    const canSeeQueue = (stepKey: QueueStep): boolean =>
      isModuleViewer || isProcessCoordinator || isStepOwner(stepKey);

    // Who may raise a job card: open to all module users unless issue_slip has
    // owners configured, then only those owners (or admin / coordinator).
    const issueSlipOwners = stepOwnerFor("issue_slip")?.employeeIds ?? [];
    // Module-level write ceiling. From `session`, never a demo persona.
    const canEdit = session.canEditModule("production-entry");
    const canRaise =
      canEdit && (issueSlipOwners.length === 0 || isAdmin || isProcessCoordinator || issueSlipOwners.includes(uid));

    // Mirrors fms_production_request_editable + the RPC authz: the raiser / admin /
    // coordinator may edit an issue slip until its FIRST real step is recorded.
    // Production: awaiting the first material handover (mh_at null excludes the AIS
    // re-loop, which re-enters the same status). Repackaging: awaiting the
    // packing-material transfer, which IS its first step — it has no handover.
    // ⚠ Both branches must track fms_production_request_editable; the disabled
    // button is a courtesy, the RPC re-checks this.
    const canEditRequest = (r: ProductionRequest): boolean =>
      canEdit &&
      (r.raisedBy === uid || isAdmin || isProcessCoordinator) &&
      (r.cardType === "repackaging"
        ? r.status === "awaiting_pm_transfer" && r.pmtAt == null
        : r.status === "awaiting_material_handover" && r.mhAt == null);

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
      packaging_item: packagingItems,
      fg_item: fgItems,
      unit: units,
      bom: boms,
    };

    /* ------------------------------ BOM master ------------------------------ */

    const componentsByBom = new Map<string, BomComponent[]>();
    for (const c of bomComponents) {
      const list = componentsByBom.get(c.bomId);
      if (list) list.push(c);
      else componentsByBom.set(c.bomId, [c]);
    }
    for (const list of componentsByBom.values()) list.sort((a, b) => a.sortOrder - b.sortOrder);

    const activeBoms = byOrder(boms);
    // Default first so a picker's first entry is the one a job card would use.
    const bomsForFg = (fgItemId: string | null): Bom[] =>
      fgItemId
        ? activeBoms
            .filter((b) => b.fgItemId === fgItemId)
            .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
        : [];
    // Auto-apply only when the choice is unambiguous: an explicitly flagged
    // default, or a lone BOM. Several BOMs and none flagged means the user picks
    // — quietly loading one of three recipes is how a wrong batch gets made.
    const defaultBomForFg = (fgItemId: string | null): Bom | undefined => {
      const list = bomsForFg(fgItemId);
      return list.find((b) => b.isDefault) ?? (list.length === 1 ? list[0] : undefined);
    };

    /* --------------------------- master governance --------------------------- */

    const managerIdsFor = (mt: ProductionMasterType) =>
      masterManagers.filter((m) => m.masterType === mt).map((m) => m.managerUserId);
    // Pure write gate (MasterCrud Add + Actions column). isAnyMasterManager is
    // left alone — it guards the Masters ROUTE, which a view-only manager may read.
    const canManage = (mt: ProductionMasterType) => canEdit && (isAdmin || managerIdsFor(mt).includes(uid));
    const isAnyMasterManager = isAdmin || masterManagers.some((m) => m.managerUserId === uid);
    /** Visibility half — nav link + RequireMasterAccess. A viewer reads the masters, canManage still gates every write. */
    const canSeeMasters = isModuleViewer || isAnyMasterManager;

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

    const trackingFor = (stepKey: QueueStep): { requestId: string; dueIso: string | null }[] =>
      trackingRequestsFor(snapshot, stepKey)
        .filter((r) => canActOn(stepKey, r))
        .map((r) => ({ requestId: r.id, dueIso: productionDueIso(snapshot, r, stepKey) }));

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
      packagingItems,
      fgItems,
      units,
      activeCategories: byOrder(categories),
      activeRawMaterials: byOrder(rawMaterials),
      activePackagingItems: byOrder(packagingItems),
      activeFgItems: byOrder(fgItems),
      activeUnits: byOrder(units),
      categoryById: (id) => idById(categories, id),
      rawMaterialById: (id) => idById(rawMaterials, id),
      packagingItemById: (id) => idById(packagingItems, id),
      fgItemById: (id) => idById(fgItems, id),
      unitById: (id) => idById(units, id),
      masterList: (mt) => MASTER_LIST[mt],

      boms,
      activeBoms,
      bomById: (id) => idById(boms, id),
      bomsForFg,
      defaultBomForFg,
      bomComponentsFor: (bomId) => (bomId ? componentsByBom.get(bomId) ?? [] : []),

      stepOwners,
      stepOwnerFor,
      processCoordinatorIds,
      stepSla,
      batchSeqStart,
      batchNoPreview,

      isAdmin,
      canEdit,
      isProcessCoordinator,
      isStepOwner,
      canActOn,
      canSeeQueue,
      canRaise,

      masterManagers,
      managerIdsFor,
      canManage,
      isAnyMasterManager,
      isModuleViewer,
      canMonitor,
      canSeeMasters,
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
      canEditRequest,

      queueEntries,
      myQueue,
      trackingFor,
      dueIsoFor: (r, stepKey) => productionDueIso(snapshot, r, stepKey),
      completedFor: (stepKey) => completedForPure(snapshot, stepKey),
      personName,

      activity,
      activityFor: (entityType, entityId) => activityByEntity.get(`${entityType}:${entityId}`) ?? [],
      notifications: mine,
      unreadCount: mine.filter((n) => !n.readAt).length,
      markNotificationsRead: async (ids) => {
        await markNotificationsReadWrite(ids);
        await refreshWorkflow();
      },

      /* ------------------------------ workflow ------------------------------ */
      // These write CARDS, never masters — so they refresh the workflow slice
      // rather than re-reading every master table. See `refreshWorkflow`.

      submitRequest: async (input) => {
        const id = await submitRequestWrite(input);
        await refreshWorkflow();
        return id;
      },
      updateRequest: async (requestId, input) => {
        await updateRequestWrite(requestId, input);
        await refreshWorkflow();
      },
      recordStep: async (stepKey, r, payload) => {
        await recordStepWrite(stepKey, r.id, payload);
        await refreshWorkflow();
      },
      updateStep: async (stepKey, r, payload) => {
        await updateStepWrite(stepKey, r.id, payload);
        await refreshWorkflow();
      },
      markReadyToDispatch: async (requestIds) => {
        const moved = await markReadyToDispatchWrite(requestIds);
        await refreshWorkflow();
        return moved;
      },
      transferFgBulk: async (requestIds, file) => {
        // Upload the shared Tally voucher once, then close every selected card with it.
        const up = await uploadStepDocumentWrite(requestIds[0] ?? "shared", "fgtransfer", file);
        const moved = await recordFgTransferBulkWrite(requestIds, up.path, up.name);
        await refreshWorkflow();
        return moved;
      },
      holdRequest: async (r, hold, reason) => {
        await holdRequestWrite(r.id, hold, reason);
        await refreshWorkflow();
      },
      cancelRequest: async (r, reason) => {
        await cancelRequestWrite(r.id, reason);
        await refreshWorkflow();
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
      setBatchSeqStart: async (start) => {
        await setConfigWrite("batch_seq_start", { start });
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
      saveBom: async (input) => {
        await saveBomWrite(input);
        await invalidate();
      },
      importBoms: async (blocks) => {
        const result = await importBomsWrite(blocks);
        await invalidate();
        return result;
      },
    };
    // ⚠ Hand-maintained. Every list read above must appear here — omit one and the
    // store keeps serving the previous snapshot after an invalidate, silently.
  }, [
    isLoading, error, dir, userId, isAdmin, designations, categories, rawMaterials, packagingItems, fgItems, units,
    boms, bomComponents,
    masterManagers, masterRequests, requests, activity, notifications, stepOwners, processCoordinatorIds,
    stepSla, batchSeqStart, batchNoPreview, queryClient, session.user, orgPeople,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProductionStore(): ProductionStoreValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useProductionStore must be used within ProductionStoreProvider");
  return ctx;
}
