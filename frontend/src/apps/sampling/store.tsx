import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { useDirectory } from "@/core/platform/store";
import { fetchOrgPeople } from "@/core/platform/orgPeople";
import type { Department as OrgDepartment, Profile } from "@/core/platform/types";
import { SAMPLING_QK, fetchSamplingData, samplingQueryKey } from "./data/samplingFetch";
import {
  announce as announceWrite,
  cancelRequest as cancelRequestWrite,
  holdRequest as holdRequestWrite,
  insertCompany as insertCompanyWrite,
  markNotificationsRead as markNotificationsReadWrite,
  recordConfirm as recordConfirmWrite,
  recordHandover as recordHandoverWrite,
  recordReceipt as recordReceiptWrite,
  recordResult as recordResultWrite,
  recordSend as recordSendWrite,
  recordTesting as recordTestingWrite,
  resultDocumentUrl as resultDocumentUrlWrite,
  setConfig as setConfigWrite,
  setMasterManagers as setMasterManagersWrite,
  setStepOwner as setStepOwnerWrite,
  submitRequest as submitRequestWrite,
  updateCompany as updateCompanyWrite,
  updateConfirm as updateConfirmWrite,
  updateHandover as updateHandoverWrite,
  updateReceipt as updateReceiptWrite,
  updateResult as updateResultWrite,
  updateSend as updateSendWrite,
  updateTesting as updateTestingWrite,
  type CompanyInput,
  type ConfirmInput,
  type HandoverInput,
  type ReceiptInput,
  type RequestInput,
  type ResultInput,
  type SendInput,
  type StepOwnerInput,
  type TestingInput,
} from "./data/samplingWrites";
import {
  buildQueueEntries,
  completedConfirmEntries,
  completedHandoverEntries,
  completedReceiveEntries,
  completedResultEntries,
  completedSendEntries,
  completedTestingEntries,
  isOpenRequest,
  samplingDueIso,
  samplingSnapshotFrom,
  type QueueEntry,
  type SamplingSnapshot,
  type StageEntry,
} from "./lib/queues";
import { DEFAULT_STEP_SLA, type StepSlaMap } from "./lib/sla";
import type { StepKey } from "./lib/steps";
import type {
  Company,
  Designation,
  SamplingActivity,
  SamplingEntityType,
  SamplingMasterManager,
  SamplingMasterType,
  SamplingNotification,
  SamplingRequest,
  StepOwner,
} from "./types";

const QK = SAMPLING_QK;

interface SamplingStoreValue {
  isLoading: boolean;
  error: unknown;

  // directory (portal)
  profiles: Profile[];
  /** Users granted the Sampling app — the candidate collectors. */
  samplingUsers: Profile[];
  orgDepartments: OrgDepartment[];
  designations: Designation[];
  profileById: (id: string) => Profile | undefined;

  // masters
  companies: Company[];
  activeCompanies: Company[];
  companyById: (id: string) => Company | undefined;

  // config
  stepOwners: StepOwner[];
  stepOwnerFor: (stepKey: StepKey) => StepOwner | undefined;
  processCoordinatorIds: string[];
  stepSla: StepSlaMap;

  // capabilities
  isAdmin: boolean;
  isProcessCoordinator: boolean;
  isStepOwner: (stepKey: StepKey) => boolean;
  canActOn: (stepKey: StepKey, r: SamplingRequest) => boolean;

  // master governance (company only)
  masterManagers: SamplingMasterManager[];
  managerIdsFor: (masterType: SamplingMasterType) => string[];
  canManage: (masterType: SamplingMasterType) => boolean;
  isAnyMasterManager: boolean;
  setMasterManagers: (masterType: SamplingMasterType, userIds: string[]) => Promise<void>;

  // requests
  requests: SamplingRequest[];
  requestById: (id: string) => SamplingRequest | undefined;
  myRequests: SamplingRequest[];
  isOpenRequest: (r: SamplingRequest) => boolean;

  // queues
  queueEntries: QueueEntry[];
  myQueue: (stepKey: StepKey) => QueueEntry[];
  dueIsoFor: (r: SamplingRequest, stepKey: StepKey) => string | null;
  queueOwnerIds: (e: QueueEntry) => string[];

  /** Every completed entry for one step — what RequestQueue renders. */
  completedFor: (stepKey: StepKey) => StageEntry<SamplingRequest>[];
  /** Org-wide name lookup for a stage actor. */
  personName: (id: string | null) => string;

  // activity + bell
  activity: SamplingActivity[];
  activityFor: (entityType: SamplingEntityType, entityId: string) => SamplingActivity[];
  notifications: SamplingNotification[];
  unreadCount: number;
  markNotificationsRead: (ids: string[]) => Promise<void>;

  // workflow writes
  submitRequest: (input: RequestInput) => Promise<string>;
  recordReceipt: (r: SamplingRequest, input: ReceiptInput) => Promise<void>;
  updateReceipt: (r: SamplingRequest, input: ReceiptInput) => Promise<void>;
  recordSend: (r: SamplingRequest, input: SendInput) => Promise<void>;
  updateSend: (r: SamplingRequest, input: SendInput) => Promise<void>;
  recordConfirm: (r: SamplingRequest, input: ConfirmInput) => Promise<void>;
  updateConfirm: (r: SamplingRequest, input: ConfirmInput) => Promise<void>;
  recordTesting: (r: SamplingRequest, input: TestingInput) => Promise<void>;
  updateTesting: (r: SamplingRequest, input: TestingInput) => Promise<void>;
  recordResult: (r: SamplingRequest, input: ResultInput) => Promise<void>;
  updateResult: (r: SamplingRequest, input: ResultInput) => Promise<void>;
  recordHandover: (r: SamplingRequest, input: HandoverInput) => Promise<void>;
  updateHandover: (r: SamplingRequest, input: HandoverInput) => Promise<void>;
  holdRequest: (r: SamplingRequest, hold: boolean, reason: string) => Promise<void>;
  cancelRequest: (r: SamplingRequest, reason: string) => Promise<void>;

  // documents
  resultDocumentUrl: (path: string) => Promise<string>;

  // config writes
  setStepOwner: (stepKey: StepKey, input: StepOwnerInput) => Promise<void>;
  setStepSla: (map: StepSlaMap) => Promise<void>;
  setCoordinators: (userIds: string[]) => Promise<void>;

  // master writes
  insertCompany: (input: CompanyInput) => Promise<void>;
  updateCompany: (id: string, input: CompanyInput) => Promise<void>;
}

const Ctx = createContext<SamplingStoreValue | null>(null);

export function SamplingStoreProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const dir = useDirectory();
  const queryClient = useQueryClient();
  const userId = session.user?.id ?? null;
  const isAdmin = session.isAdmin;

  const { data, isLoading, error } = useQuery({
    queryKey: samplingQueryKey(userId),
    queryFn: fetchSamplingData,
    enabled: !!session.user,
  });

  // Org-wide names so a colleague's completed entry never renders blank: the
  // directory `profiles` are RLS-scoped, so a cross-team actor would not resolve.
  const { data: orgPeople } = useQuery({ queryKey: ["orgPeople"], queryFn: fetchOrgPeople, staleTime: 5 * 60 * 1000 });

  const stepOwners = data?.stepOwners ?? [];
  const designations = data?.designations ?? [];
  const companies = data?.companies ?? [];
  const masterManagers = data?.masterManagers ?? [];
  const requests = data?.requests ?? [];
  const activity = data?.activity ?? [];
  const notifications = data?.notifications ?? [];
  const processCoordinatorIds = data?.config.processCoordinatorIds ?? [];
  const stepSla = data?.config.stepSla ?? DEFAULT_STEP_SLA;

  const value = useMemo<SamplingStoreValue>(() => {
    const uid = userId ?? "";
    const invalidate = () => queryClient.invalidateQueries({ queryKey: QK });

    const stepOwnerFor = (stepKey: StepKey) => stepOwners.find((o) => o.stepKey === stepKey);
    const ownerIdsOf = (stepKey: StepKey): string[] => stepOwnerFor(stepKey)?.employeeIds ?? [];

    const isStepOwner = (stepKey: StepKey): boolean =>
      isAdmin || stepOwners.some((o) => o.stepKey === stepKey && o.employeeIds.includes(uid));

    const isProcessCoordinator = isAdmin || processCoordinatorIds.includes(uid);

    // Mirrors fms_sampling_can_act(step, req, uid): admin / coordinator / the
    // step's owner — PLUS the chosen collector for that request's receive_sample.
    // Sampling steps are otherwise owned globally (no per-request HOD).
    const canActOn = (stepKey: StepKey, r: SamplingRequest): boolean =>
      isAdmin ||
      isProcessCoordinator ||
      isStepOwner(stepKey) ||
      (stepKey === "receive_sample" && !!r.collectorId && r.collectorId === uid);

    const personName = (id: string | null): string => {
      if (!id) return "—";
      return (orgPeople ?? []).find((p) => p.id === id)?.name ?? "Unknown user";
    };

    /* --------------------------- master governance --------------------------- */

    const managerIdsFor = (mt: SamplingMasterType) =>
      masterManagers.filter((m) => m.masterType === mt).map((m) => m.managerUserId);
    const canManage = (mt: SamplingMasterType) => isAdmin || managerIdsFor(mt).includes(uid);
    const isAnyMasterManager = isAdmin || masterManagers.some((m) => m.managerUserId === uid);

    /* --------------------------------- indexes ------------------------------- */

    const activityByEntity = new Map<string, SamplingActivity[]>();
    for (const a of activity) {
      const k = `${a.entityType}:${a.entityId}`;
      const list = activityByEntity.get(k) ?? [];
      list.push(a);
      activityByEntity.set(k, list);
    }

    // Newest first — the base fetch orders ascending.
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

    const snapshot: SamplingSnapshot = samplingSnapshotFrom({ requests, stepSla });
    const queueEntries = buildQueueEntries(snapshot);

    const receiveEntries = completedReceiveEntries(snapshot);
    const sendEntries = completedSendEntries(snapshot);
    const confirmEntries = completedConfirmEntries(snapshot);
    const testingEntries = completedTestingEntries(snapshot);
    const resultEntries = completedResultEntries(snapshot);
    const handoverEntries = completedHandoverEntries(snapshot);

    const completedFor = (stepKey: StepKey): StageEntry<SamplingRequest>[] =>
      stepKey === "receive_sample" ? receiveEntries
      : stepKey === "send_sample" ? sendEntries
      : stepKey === "confirm_receipt" ? confirmEntries
      : stepKey === "testing" ? testingEntries
      : stepKey === "result" ? resultEntries
      : stepKey === "result_handover" ? handoverEntries
      : [];

    const myQueue = (stepKey: StepKey): QueueEntry[] =>
      queueEntries.filter((e) => {
        if (e.stepKey !== stepKey) return false;
        const r = requestMap.get(e.requestId);
        return r ? canActOn(stepKey, r) : false;
      });

    const queueOwnerIds = (e: QueueEntry): string[] => ownerIdsOf(e.stepKey);

    const byOrder = (rows: Company[]): Company[] =>
      rows.filter((r) => r.active).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

    return {
      isLoading,
      error,

      profiles: dir.profiles,
      // Candidate collectors = users granted the Sampling app (admins bypass
      // module access, so they carry no `sampling` tag — include them explicitly).
      samplingUsers: dir.profiles.filter((p) => p.role === "admin" || p.moduleAccess.includes("sampling")),
      orgDepartments: dir.departments,
      designations,
      profileById: dir.profileById,

      companies,
      activeCompanies: byOrder(companies),
      companyById: (id) => companies.find((c) => c.id === id),

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
      setMasterManagers: async (masterType, userIds) => {
        await setMasterManagersWrite(masterType, userIds);
        await invalidate();
      },

      requests,
      requestById: (id) => requestMap.get(id),
      myRequests: requests.filter((r) => r.raisedBy === uid),
      isOpenRequest,

      queueEntries,
      myQueue,
      dueIsoFor: (r, stepKey) => samplingDueIso(snapshot, r, stepKey),
      queueOwnerIds,

      completedFor,
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
        // The RPC already fanned out from its SECURITY DEFINER context.
        await invalidate();
        return id;
      },
      recordReceipt: async (r, input) => {
        await recordReceiptWrite(r.id, input);
        await invalidate();
      },
      updateReceipt: async (r, input) => {
        await updateReceiptWrite(r.id, input);
        await invalidate();
      },
      recordSend: async (r, input) => {
        await recordSendWrite(r.id, input);
        await invalidate();
      },
      updateSend: async (r, input) => {
        await updateSendWrite(r.id, input);
        await invalidate();
      },
      recordConfirm: async (r, input) => {
        await recordConfirmWrite(r.id, input);
        await invalidate();
      },
      updateConfirm: async (r, input) => {
        await updateConfirmWrite(r.id, input);
        await invalidate();
      },
      recordTesting: async (r, input) => {
        await recordTestingWrite(r.id, input);
        await invalidate();
      },
      updateTesting: async (r, input) => {
        await updateTestingWrite(r.id, input);
        await invalidate();
      },
      recordResult: async (r, input) => {
        await recordResultWrite(r.id, input);
        // The RPC already fanned out to the result_handover owners.
        await invalidate();
      },
      updateResult: async (r, input) => {
        await updateResultWrite(r.id, input);
        await invalidate();
      },
      recordHandover: async (r, input) => {
        await recordHandoverWrite(r.id, input);
        // The RPC already notified the raiser that the request is closed.
        await invalidate();
      },
      updateHandover: async (r, input) => {
        await updateHandoverWrite(r.id, input);
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

      resultDocumentUrl: (path) => resultDocumentUrlWrite(path),

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
    };
  }, [
    isLoading, error, dir, userId, isAdmin, designations, companies, masterManagers, requests, activity,
    notifications, stepOwners, processCoordinatorIds, stepSla, queryClient,
    // personName closes over orgPeople; without this the names stay "Unknown user".
    orgPeople,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSamplingStore(): SamplingStoreValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSamplingStore must be used within SamplingStoreProvider");
  return ctx;
}
