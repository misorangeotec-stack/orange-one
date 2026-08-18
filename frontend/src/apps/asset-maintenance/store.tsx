import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { fetchOrgPeople } from "@/core/platform/orgPeople";
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import { ASSET_QK, assetQueryKey, fetchAssetData, DEFAULT_REMINDER_LADDER } from "./data/assetFetch";
import {
  cancelJob as cancelJobWrite,
  deleteSchedule as deleteScheduleWrite,
  holdJob as holdJobWrite,
  insertMaster as insertMasterWrite,
  markNotificationsRead as markNotificationsReadWrite,
  raiseJobNow as raiseJobNowWrite,
  recordReading as recordReadingWrite,
  recordStep as recordStepWrite,
  requestNewMaster as requestNewMasterWrite,
  resolveMasterRequest as resolveMasterRequestWrite,
  resumeJob as resumeJobWrite,
  retireAsset as retireAssetWrite,
  setConfig as setConfigWrite,
  setMasterActive as setMasterActiveWrite,
  setMasterManagers as setMasterManagersWrite,
  setStepOwner as setStepOwnerWrite,
  signedUrlFor as signedUrlForWrite,
  skipJob as skipJobWrite,
  submitAsset as submitAssetWrite,
  updateAsset as updateAssetWrite,
  updateMaster as updateMasterWrite,
  updateStep as updateStepWrite,
  uploadDocument as uploadDocumentWrite,
  upsertSchedule as upsertScheduleWrite,
  type MasterInput,
  type StepPayload,
} from "./data/assetWrites";
import {
  assetSnapshotFrom,
  buildQueueEntries,
  completedFor as completedForPure,
  isOpenJob,
  isOverdue,
  jobDueIso,
  jobRef as jobRefPure,
  type AssetSnapshot,
  type QueueEntry,
  type QueueStep,
  type StageEntry,
} from "./lib/queues";
import { DEFAULT_STEP_SLA, type StepSlaMap } from "./lib/sla";
import type { StepKey } from "./lib/steps";
import type {
  ActivityEntry, Asset, AssetCategory, AssetLocation, AssetNotification, AssetReading,
  AssetSchedule, AssetMasterType, Company, Department, Designation, MasterManager, MasterRequest,
  NamedMaster, ScheduleType, ServiceJob, StepOwner, Vendor,
} from "./types";

const QK = ASSET_QK;

interface AssetStoreValue {
  isLoading: boolean;
  error: unknown;

  // identity / capability
  userId: string;
  isAdmin: boolean;
  isProcessCoordinator: boolean;
  /**
   * Does this person's grant on Asset Maintenance allow CHANGING anything? False
   * only on a view-only grant (Admin → Module Access).
   *
   * ⚠ A CEILING, never a permission — it grants nothing and only takes away. Kept
   *   OUT of canActOn / canSeeQueue / isProcessCoordinator, which decide what a
   *   person can SEE.
   */
  canEdit: boolean;
  canRaise: boolean;
  canMonitor: boolean;
  canActOn: (step: QueueStep, job: ServiceJob) => boolean;
  /** May this person see the step's queue at all — nav link, route, page. */
  canSeeQueue: (step: QueueStep) => boolean;
  isStepOwner: (stepKey: StepKey) => boolean;
  stepOwnerFor: (stepKey: StepKey) => StepOwner | undefined;
  ownerNamesFor: (stepKey: StepKey) => string[];
  personName: (id: string | null) => string;
  people: { id: string; name: string }[];

  // directory
  designations: Designation[];
  departments: Department[];

  // masters
  scheduleTypes: ScheduleType[];
  categories: AssetCategory[];
  locations: AssetLocation[];
  vendors: Vendor[];
  makes: NamedMaster[];
  companies: Company[];
  conditions: NamedMaster[];
  usageUnits: NamedMaster[];
  costHeads: NamedMaster[];
  activeOf: <T extends NamedMaster>(rows: T[]) => T[];
  masterList: (mt: AssetMasterType) => NamedMaster[];
  masterName: (mt: AssetMasterType, id: string | null) => string;
  scheduleTypeName: (id: string | null) => string;
  vendorName: (id: string | null) => string;

  // the register
  assets: Asset[];
  assetById: (id: string) => Asset | undefined;
  activeAssets: Asset[];
  assetLabel: (id: string | null) => string;
  schedulesFor: (assetId: string) => AssetSchedule[];
  readingsFor: (assetId: string) => AssetReading[];

  // jobs
  jobs: ServiceJob[];
  jobById: (id: string) => ServiceJob | undefined;
  openJobs: ServiceJob[];
  jobsForAsset: (assetId: string) => ServiceJob[];
  jobRef: (job: ServiceJob) => string;
  snapshot: AssetSnapshot;
  queueEntries: QueueEntry[];
  stepSla: StepSlaMap;
  dueIsoFor: (job: ServiceJob, step: QueueStep) => string | null;
  myQueue: (step: QueueStep) => { job: ServiceJob; dueIso: string | null }[];
  completedFor: (step: QueueStep) => StageEntry<ServiceJob>[];
  /** Open jobs whose own due date has passed with no service recorded. */
  overdueJobs: ServiceJob[];
  todayIso: string;

  // master governance
  masterManagers: MasterManager[];
  masterRequests: MasterRequest[];
  myMasterRequests: MasterRequest[];
  resolvableRequests: MasterRequest[];
  canManage: (mt: AssetMasterType) => boolean;
  isAnyMasterManager: boolean;
  managerIdsFor: (mt: AssetMasterType) => string[];
  isMasterUnassigned: (mt: AssetMasterType) => boolean;

  // feed
  activityFor: (entityType: string, entityId: string) => ActivityEntry[];
  notifications: AssetNotification[];
  processCoordinatorIds: string[];
  reminderLadder: number[];

  // actions
  submitAsset: (payload: Record<string, unknown>) => Promise<string>;
  updateAsset: (assetId: string, payload: Record<string, unknown>) => Promise<void>;
  retireAsset: (assetId: string, reason: string, date?: string | null) => Promise<void>;
  upsertSchedule: (assetId: string, payload: Record<string, unknown>) => Promise<string>;
  deleteSchedule: (scheduleId: string) => Promise<void>;
  recordReading: (assetId: string, payload: Record<string, unknown>) => Promise<void>;
  raiseJobNow: (scheduleId: string) => Promise<string>;
  recordStep: (step: QueueStep, jobId: string, payload: StepPayload) => Promise<void>;
  updateStep: (step: QueueStep, jobId: string, payload: StepPayload) => Promise<void>;
  holdJob: (jobId: string, reason: string) => Promise<void>;
  resumeJob: (jobId: string) => Promise<void>;
  cancelJob: (jobId: string, reason: string) => Promise<void>;
  skipJob: (jobId: string, reason: string) => Promise<void>;
  uploadDocument: (ownerId: string, folder: string, file: File) => Promise<{ path: string; name: string }>;
  documentUrl: (path: string) => Promise<string>;
  setStepOwner: (
    stepKey: string,
    input: { departmentIds: string[]; designationId: string | null; employeeIds: string[] },
  ) => Promise<void>;
  setConfig: (key: string, value: Record<string, unknown>) => Promise<void>;
  insertMaster: (mt: AssetMasterType, input: MasterInput) => Promise<void>;
  updateMaster: (mt: AssetMasterType, id: string, input: MasterInput) => Promise<void>;
  setMasterActive: (mt: AssetMasterType, id: string, active: boolean) => Promise<void>;
  setMasterManagers: (mt: AssetMasterType, userIds: string[]) => Promise<void>;
  requestNewMaster: (mt: AssetMasterType, payload: Record<string, unknown>) => Promise<void>;
  resolveMasterRequest: (
    id: string, approve: boolean, payload: Record<string, unknown> | null, note: string | null,
  ) => Promise<void>;
  markNotificationsRead: (ids: string[]) => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AssetStoreValue | null>(null);

export function AssetStoreProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const queryClient = useQueryClient();
  const userId = session.user?.id ?? null;
  const isAdmin = session.isAdmin;

  const { data, isLoading, error } = useQuery({
    queryKey: assetQueryKey(userId),
    queryFn: fetchAssetData,
    enabled: !!session.user,
    // Serve cached data instantly instead of re-running the heavy multi-table
    // fetch on every mount / window-focus. Writes call invalidate(), so data
    // still refreshes immediately after any change.
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  // Org-wide names so a colleague's completed entry never renders blank (the
  // directory itself is RLS-scoped, which is why this is a separate read).
  const { data: orgPeople } = useQuery({
    queryKey: ["orgPeople"],
    queryFn: fetchOrgPeople,
    staleTime: 5 * 60 * 1000,
  });

  const stepOwners = data?.stepOwners ?? [];
  const designations = data?.designations ?? [];
  const departments = data?.departments ?? [];
  const scheduleTypes = data?.scheduleTypes ?? [];
  const categories = data?.categories ?? [];
  const locations = data?.locations ?? [];
  const vendors = data?.vendors ?? [];
  const makes = data?.makes ?? [];
  const companies = data?.companies ?? [];
  const conditions = data?.conditions ?? [];
  const usageUnits = data?.usageUnits ?? [];
  const costHeads = data?.costHeads ?? [];
  const masterManagers = data?.masterManagers ?? [];
  const masterRequests = data?.masterRequests ?? [];
  const assets = data?.assets ?? [];
  const jobs = data?.jobs ?? [];
  const readings = data?.readings ?? [];
  const activity = data?.activity ?? [];
  const notifications = data?.notifications ?? [];
  const processCoordinatorIds = data?.config.processCoordinatorIds ?? [];
  const stepSla = data?.config.stepSla ?? DEFAULT_STEP_SLA;
  const reminderLadder = data?.config.reminderLadder ?? DEFAULT_REMINDER_LADDER;

  const value = useMemo<AssetStoreValue>(() => {
    const uid = userId ?? "";
    const invalidate = () => queryClient.invalidateQueries({ queryKey: QK });
    const todayIso = todayLocalIso();

    const stepOwnerFor = (stepKey: StepKey) => stepOwners.find((o) => o.stepKey === stepKey);

    const isStepOwner = (stepKey: StepKey): boolean =>
      isAdmin || stepOwners.some((o) => o.stepKey === stepKey && o.employeeIds.indexOf(uid) !== -1);

    const isProcessCoordinator = isAdmin || processCoordinatorIds.indexOf(uid) !== -1;

    const people = (orgPeople ?? []).map((p) => ({ id: p.id, name: p.name }));

    const personName = (id: string | null): string => {
      if (!id) return "—";
      return people.find((p) => p.id === id)?.name ?? "Unknown user";
    };

    const assetById = (id: string) => assets.find((a) => a.id === id);

    /**
     * Mirrors fms_asset_can_act(step, job, uid): admin / coordinator / step owner
     * — PLUS the asset's CUSTODIAN on the schedule and service steps. They are the
     * person who actually takes the car to the garage, and making them wait on a
     * step owner is how services get missed in the first place.
     *
     * The custodian deliberately does NOT get `verify_close`: verification is the
     * check on their own work.
     */
    const canActOn = (stepKey: QueueStep, j: ServiceJob): boolean => {
      if (isAdmin || isProcessCoordinator || isStepOwner(stepKey)) return true;
      if (stepKey === "verify_close") return false;
      const asset = assetById(j.assetId);
      return !!asset?.custodianUserId && asset.custodianUserId === uid;
    };

    /**
     * Who may add an asset / raise a job by hand: open to every granted user
     * unless `service_due` has owners configured, then only those owners (or
     * admin / coordinator). The DB deliberately allows owners on the origin step
     * — see the foundations migration.
     */
    const dueOwners = stepOwnerFor("service_due")?.employeeIds ?? [];
    // Module-level write ceiling. From `session`, never a demo persona.
    const canEdit = session.canEditModule("asset-maintenance");
    const canRaise =
      canEdit && (dueOwners.length === 0 || isAdmin || isProcessCoordinator || dueOwners.indexOf(uid) !== -1);

    const ownerNamesFor = (stepKey: StepKey): string[] =>
      (stepOwnerFor(stepKey)?.employeeIds ?? [])
        .map((id) => personName(id))
        .filter((n) => n !== "—" && n !== "Unknown user");

    /* --------------------------- masters --------------------------- */

    const activeOf = <T extends NamedMaster>(rows: T[]): T[] =>
      rows.filter((r) => r.active).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

    const MASTER_LIST: Record<AssetMasterType, NamedMaster[]> = {
      schedule_type: scheduleTypes,
      category: categories,
      location: locations,
      vendor: vendors,
      make: makes,
      company: companies,
      condition: conditions,
      usage_unit: usageUnits,
      cost_head: costHeads,
    };

    // Display lookups read the FULL list, never the active-only one — a
    // deactivated vendor must still render by name on an old job.
    const masterList = (mt: AssetMasterType): NamedMaster[] => MASTER_LIST[mt] ?? [];
    const nameFrom = (rows: NamedMaster[], id: string | null): string =>
      !id ? "—" : rows.find((r) => r.id === id)?.name ?? "—";
    const masterName = (mt: AssetMasterType, id: string | null) => nameFrom(masterList(mt), id);
    const scheduleTypeName = (id: string | null) => nameFrom(scheduleTypes, id);
    const vendorName = (id: string | null) => nameFrom(vendors, id);

    const assetLabel = (id: string | null): string => {
      if (!id) return "—";
      const a = assetById(id);
      return a ? `${a.assetNo} ${a.name}` : "—";
    };

    /* --------------------------- jobs --------------------------- */

    const snapshot = assetSnapshotFrom({ jobs, stepSla, assets, scheduleTypes });
    const queueEntries = buildQueueEntries(snapshot);
    const jobById = (id: string) => jobs.find((j) => j.id === id);
    const openJobs = jobs.filter(isOpenJob);

    /**
     * Open work at this step AS THIS PERSON MAY ACT ON IT.
     *
     * ⚠ THIS WAS ONCE UNSCOPED, AND THAT IS THE BUG IT CAUSED. The nav asked "does
     *   this person have work here?" by calling it, got back everyone's work, and so
     *   showed all three queues to every user of the module. Scoping it through
     *   `canActOn` is also what makes the CUSTODIAN arm work: a custodian now gets
     *   the jobs on their own assets, and only those.
     *
     * ⚠ NOT the number the Control Center shows. It reads `queueEntries` directly
     *   and must keep counting everyone's work.
     */
    const myQueue = (step: QueueStep) =>
      queueEntries
        .filter((e) => e.stepKey === step)
        .map((e) => ({ job: jobById(e.jobId) as ServiceJob, dueIso: e.dueIso }))
        .filter((x) => !!x.job && canActOn(step, x.job));

    /**
     * May this person see the step's QUEUE at all — the nav link, the route, the page?
     *
     * ⚠ THE THIRD CLAUSE IS LOAD-BEARING HERE, unlike in Order to Dispatch where the
     *   equivalent was deleted. An asset's CUSTODIAN owns no step and appears in no
     *   owner list, yet `canActOn` lets them record the schedule and the service on
     *   their own assets. Ownership alone cannot express that; having work sitting in
     *   the queue can. Now that `myQueue` is scoped, this asks the right question.
     */
    const canSeeQueue = (step: QueueStep): boolean =>
      isProcessCoordinator || isStepOwner(step) || myQueue(step).length > 0;

    /* --------------------------- governance --------------------------- */

    const managerIdsFor = (mt: AssetMasterType) =>
      masterManagers.filter((m) => m.masterType === mt).map((m) => m.managerUserId);
    const isMasterUnassigned = (mt: AssetMasterType) => managerIdsFor(mt).length === 0;
    // Unassigned ⇒ admins only, never nobody.
    // Pure write gate (MasterCrud Add + Actions column). isAnyMasterManager is
    // left alone — it guards the Masters ROUTE, which a view-only manager may read.
    const canManage = (mt: AssetMasterType) => canEdit && (isAdmin || managerIdsFor(mt).indexOf(uid) !== -1);
    const isAnyMasterManager = isAdmin || masterManagers.some((m) => m.managerUserId === uid);

    return {
      isLoading,
      error,

      userId: uid,
      isAdmin,
      canEdit,
      isProcessCoordinator,
      canRaise,
      canMonitor: isProcessCoordinator,
      canActOn,
      canSeeQueue,
      isStepOwner,
      stepOwnerFor,
      ownerNamesFor,
      personName,
      people,

      designations,
      departments,

      scheduleTypes,
      categories,
      locations,
      vendors,
      makes,
      companies,
      conditions,
      usageUnits,
      costHeads,
      activeOf,
      masterList,
      masterName,
      scheduleTypeName,
      vendorName,

      assets,
      assetById,
      activeAssets: assets.filter((a) => a.active),
      assetLabel,
      schedulesFor: (assetId: string) => assetById(assetId)?.schedules ?? [],
      readingsFor: (assetId: string) =>
        readings.filter((r) => r.assetId === assetId).sort((a, b) => b.readingDate.localeCompare(a.readingDate)),

      jobs,
      jobById,
      openJobs,
      jobsForAsset: (assetId: string) =>
        jobs.filter((j) => j.assetId === assetId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      jobRef: (job: ServiceJob) => jobRefPure(snapshot, job),
      snapshot,
      queueEntries,
      stepSla,
      dueIsoFor: (job: ServiceJob, step: QueueStep) => jobDueIso(snapshot, job, step),
      myQueue,
      completedFor: (step: QueueStep) => completedForPure(snapshot, step),
      overdueJobs: openJobs.filter((j) => isOverdue(j, todayIso)),
      todayIso,

      masterManagers,
      masterRequests,
      myMasterRequests: masterRequests.filter((r) => r.requestedBy === uid),
      resolvableRequests: masterRequests.filter((r) => r.status === "pending" && canManage(r.masterType)),
      canManage,
      isAnyMasterManager,
      managerIdsFor,
      isMasterUnassigned,

      activityFor: (entityType: string, entityId: string) =>
        activity
          .filter((a) => a.entityType === entityType && a.entityId === entityId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      notifications,
      processCoordinatorIds,
      reminderLadder,

      submitAsset: async (payload) => {
        const id = await submitAssetWrite(payload);
        await invalidate();
        return id;
      },
      updateAsset: async (assetId, payload) => {
        await updateAssetWrite(assetId, payload);
        await invalidate();
      },
      retireAsset: async (assetId, reason, date) => {
        await retireAssetWrite(assetId, reason, date ?? null);
        await invalidate();
      },
      upsertSchedule: async (assetId, payload) => {
        const id = await upsertScheduleWrite(assetId, payload);
        await invalidate();
        return id;
      },
      deleteSchedule: async (scheduleId) => {
        await deleteScheduleWrite(scheduleId);
        await invalidate();
      },
      recordReading: async (assetId, payload) => {
        await recordReadingWrite(assetId, payload);
        await invalidate();
      },
      raiseJobNow: async (scheduleId) => {
        const id = await raiseJobNowWrite(scheduleId);
        await invalidate();
        return id;
      },
      recordStep: async (step, jobId, payload) => {
        await recordStepWrite(step, jobId, payload);
        await invalidate();
      },
      updateStep: async (step, jobId, payload) => {
        await updateStepWrite(step, jobId, payload);
        await invalidate();
      },
      holdJob: async (jobId, reason) => {
        await holdJobWrite(jobId, reason);
        await invalidate();
      },
      resumeJob: async (jobId) => {
        await resumeJobWrite(jobId);
        await invalidate();
      },
      cancelJob: async (jobId, reason) => {
        await cancelJobWrite(jobId, reason);
        await invalidate();
      },
      skipJob: async (jobId, reason) => {
        await skipJobWrite(jobId, reason);
        await invalidate();
      },
      uploadDocument: uploadDocumentWrite,
      documentUrl: signedUrlForWrite,
      setStepOwner: async (stepKey, input) => {
        await setStepOwnerWrite(stepKey, input);
        await invalidate();
      },
      setConfig: async (key, value) => {
        await setConfigWrite(key, value);
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
      setMasterActive: async (mt, id, active) => {
        await setMasterActiveWrite(mt, id, active);
        await invalidate();
      },
      setMasterManagers: async (mt, userIds) => {
        await setMasterManagersWrite(mt, userIds);
        await invalidate();
      },
      requestNewMaster: async (mt, payload) => {
        await requestNewMasterWrite(mt, payload, uid);
        await invalidate();
      },
      resolveMasterRequest: async (id, approve, payload, note) => {
        await resolveMasterRequestWrite(id, approve, payload, note);
        await invalidate();
      },
      markNotificationsRead: async (ids) => {
        await markNotificationsReadWrite(ids);
        await invalidate();
      },
      refresh: async () => {
        await invalidate();
      },
    };
  }, [
    data, isLoading, error, userId, isAdmin, orgPeople, queryClient,
    stepOwners, designations, departments, scheduleTypes, categories, locations, vendors,
    makes, companies, conditions, usageUnits, costHeads, masterManagers, masterRequests,
    assets, jobs, readings, activity, notifications, processCoordinatorIds, stepSla, reminderLadder,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAssetStore(): AssetStoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAssetStore must be used inside AssetStoreProvider");
  return v;
}
