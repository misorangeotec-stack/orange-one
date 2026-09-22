import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { useDirectory } from "@/core/platform/store";
import { fetchOrgPeople, type OrgPerson } from "@/core/platform/orgPeople";
import type { Department, Profile } from "@/core/platform/types";
import { fetchLdData, ldQueryKey, LD_QK, type LdData } from "./data/ldFetch";
import * as W from "./data/ldWrites";
import { buildQueueEntries, dueIsoFor, isOpen, stepOf } from "./lib/queues";
import { ROW_OWNED_STEPS, type StepKey } from "./lib/steps";
import type {
  ApprovalRule,
  LdMasterType,
  LdNotification,
  MasterRequest,
  QueueEntry,
  TrainingRequest,
  TrainingSession,
} from "./types";

/**
 * The Learning & Development store: one react-query snapshot of the module, plus
 * the capability flags every screen and the sidebar read.
 *
 * ⚠ THE MODULE IS UNIVERSAL, SO "CAN OPEN IT" IS NOT A PERMISSION HERE.
 *   Every signed-in employee loads this store — they are all potential
 *   participants. What each person may SEE and DO is decided by the flags below
 *   and, authoritatively, by RLS and the RPCs' own authz. A plain employee gets
 *   an empty `requests` array and a full `sessions` array, and that is correct,
 *   not a failure (see the ⚠ in data/ldFetch.ts).
 */

interface LdStoreValue {
  loading: boolean;
  error: string | null;

  requests: TrainingRequest[];
  sessions: TrainingSession[];
  notifications: LdNotification[];
  data: LdData | null;

  profiles: Profile[];
  orgDepartments: Department[];
  orgPeople: OrgPerson[];
  profileById: (id: string | null) => Profile | undefined;
  /**
   * A person's NAME, for display.
   *
   * ⚠ USE THIS, NOT `profileById(id)?.name`. `profiles` is RLS-scoped — a reader
   *   sees themselves, their own downline and (for admins) everyone — so a
   *   colleague in another department resolves to nothing and the cell renders
   *   "—". That is exactly what "Raised by" did on every row of the request list
   *   until 22-09-2026: the L&D executive could not see who had asked for any of
   *   the training she was validating. The org-wide list (`orgPeople`, a name-only
   *   read) is the backup.
   */
  personName: (id: string | null) => string;
  departmentName: (id: string | null) => string;

  /** Admin or a named process coordinator: oversight over every step. */
  isProcessCoordinator: boolean;
  /** Visibility half of the above — the Control Center link and route. */
  canMonitor: boolean;
  /** May this person raise a training need? */
  canRaise: boolean;
  /** May this person own/approve ANY master, and so see the Masters screen? */
  canSeeMasters: boolean;
  /**
   * May this person edit ONE master, and resolve requests against it?
   *
   * ⚠ PER LIST, NEVER "can I see the screen". The RLS policy on each master table
   *   is written per type, so somebody who owns Venues opens the Masters screen
   *   and finds every other tab read-only. A single flag would offer them an Add
   *   button that the database then refuses.
   */
  canManageMaster: (mt: LdMasterType) => boolean;
  /**
   * May this person edit the POSH / Safety programme list?
   *
   * ⚠ A DIFFERENT GATE. `fms_ld_mandatory_programs` is governed by
   *   `is_admin OR fms_ld_is_coordinator`, not by the master owners — so this is
   *   `isProcessCoordinator`, not `canManageMaster(...)`.
   */
  canManageMandatory: boolean;
  /** Requests for values that are not on a list yet. */
  masterRequests: MasterRequest[];
  /** How many of those are still waiting on somebody — the sidebar badge. */
  pendingMasterRequests: number;
  /** Should this person be offered the Master Requests screen at all? */
  canUseMasterRequests: boolean;
  /** Does this person own any step at all — i.e. is the request pipeline theirs? */
  isPipelineStaff: boolean;

  /** May this person ACT on one step of one request? Mirrors fms_ld_can_act(). */
  canActOn: (stepKey: StepKey, requestId: string | null) => boolean;
  /** Should this person be offered this step's queue at all? */
  canSeeQueue: (stepKey: StepKey) => boolean;
  /**
   * Should this step's queue be OFFERED right now — `canSeeQueue` plus the
   * conditional-gate rule.
   *
   * ⚠ THE SIDEBAR AND THE DASHBOARD MUST BOTH READ THIS ONE. They showed
   *   different answers on 21-09-2026: the sidebar hid Management Approval under
   *   a "never" rule and the dashboard strip still listed it, so the same screen
   *   said the gate both did and did not exist. One predicate, two readers.
   */
  offersQueue: (stepKey: StepKey) => boolean;
  /**
   * May this person act on a SESSION-scoped step? Mirrors
   * `fms_ld_can_act_session()`.
   *
   * ⚠ KEEP IT IN STEP WITH THE SERVER. The internal-trainer arm and the
   *   HOD-of-a-nominee arm exist in both; the server is the authority and this
   *   only decides whether a control is offered.
   */
  canActOnSession: (stepKey: StepKey, sessionId: string) => boolean;
  /** Is this person an approved nominee on that session? */
  isParticipant: (sessionId: string) => boolean;

  stepOwnerIds: (stepKey: string) => string[];
  approvalRule: ApprovalRule;
  queueEntries: QueueEntry[];
  entriesForStep: (stepKey: StepKey) => QueueEntry[];
  dueIsoOf: (r: TrainingRequest) => string | null;
  requestById: (id: string) => TrainingRequest | undefined;

  refresh: () => Promise<void>;
  writes: typeof W;
  markNotificationsRead: (ids: string[]) => Promise<void>;
}

const Ctx = createContext<LdStoreValue | null>(null);

export function LdStoreProvider({ children }: { children: ReactNode }) {
  const { user, isAdmin } = useSession();
  const dir = useDirectory();
  const qc = useQueryClient();
  const uid = user?.id ?? null;

  const q = useQuery({
    queryKey: ldQueryKey(uid),
    queryFn: fetchLdData,
    enabled: !!uid,
    staleTime: 30_000,
  });

  const orgQ = useQuery({
    queryKey: ["orgPeople"],
    queryFn: fetchOrgPeople,
    staleTime: 5 * 60_000,
  });

  const value = useMemo<LdStoreValue>(() => {
    const d = q.data ?? null;
    const requests = d?.requests ?? [];
    const sessions = d?.sessions ?? [];
    const owners = d?.stepOwners ?? [];
    const assignees = d?.stepAssignees ?? [];
    const sla = d?.stepSla;
    const me = uid ?? "";

    const stepOwnerIds = (stepKey: string): string[] =>
      owners.find((o) => o.stepKey === stepKey)?.employeeIds ?? [];

    const isProcessCoordinator = isAdmin || (d?.coordinatorIds ?? []).includes(me);
    const canMonitor = isProcessCoordinator;

    /**
     * ⚠ NO OWNERS ON `need_raised` MEANS EVERYONE MAY RAISE, not nobody.
     *   The document asks for "HOD / HR / Management creates a Training Request",
     *   i.e. open by default; naming owners in Setup narrows it. The RPC enforces
     *   the same rule server-side — this flag only decides whether the button is
     *   offered, never whether the write is allowed.
     */
    const raiseOwners = stepOwnerIds("need_raised");
    const canRaise = raiseOwners.length === 0 || isAdmin || raiseOwners.includes(me);

    /*
     * Does anybody report to this person? `Profile.hodIds` is the directory's own
     * copy of user_hods, so this is a real check rather than a guess from the
     * role name — a `hod` role does not by itself mean anyone reports to you, and
     * plenty of people who ARE somebody's HOD do not carry that role.
     *
     * ⚠ THE DIRECTORY IS RLS-SCOPED, so this can answer false for somebody who
     *   really is a HOD of people this reader cannot see. It only decides whether
     *   the nominate box is offered; `fms_ld_can_act_session` does the real
     *   resolution server-side and will accept them either way.
     */
    const isHod = dir.profiles.some((p) => p.id !== me && p.hodIds.includes(me));

    const ownsAnyStep = owners.some((o) => o.employeeIds.includes(me));
    const isPipelineStaff = isAdmin || isProcessCoordinator || ownsAnyStep;

    const managers = d?.masterManagers ?? [];
    const canManageMaster = (mt: LdMasterType): boolean =>
      isAdmin || managers.some((m) => m.masterType === mt && m.managerUserId === me);
    const canSeeMasters = isAdmin || managers.some((m) => m.managerUserId === me);
    const masterRequests = d?.masterRequests ?? [];
    const pendingMasterRequests = masterRequests.filter(
      (r) => r.status === "pending" && canManageMaster(r.masterType),
    ).length;

    /**
     * Mirrors `fms_ld_can_act()` — coordinator, then a per-row reassignment,
     * then the raiser for `need_resubmit`, then the global step owner.
     *
     * ⚠ THE SERVER IS THE AUTHORITY. This exists so a screen does not offer a
     *   button that then fails; it is not the gate. Every RPC re-checks.
     *
     * ⚠ ROW_OWNED_STEPS are answered `false` here for now. LD-1 implements only
     *   the request-scoped steps; the nominee- and HOD-owned ones arrive with
     *   LD-3 … LD-8, and claiming they are actionable before their screens exist
     *   would offer a control that goes nowhere.
     */
    const canActOn = (stepKey: StepKey, requestId: string | null): boolean => {
      if (!me) return false;
      if (ROW_OWNED_STEPS.includes(stepKey)) return false;
      if (isProcessCoordinator) return true;
      if (requestId) {
        const a = assignees.find((x) => x.requestId === requestId && x.stepKey === stepKey);
        if (a) return a.assignedTo === me;
        if (stepKey === "need_resubmit") {
          return requests.find((r) => r.id === requestId)?.requestedBy === me;
        }
      }
      return stepOwnerIds(stepKey).includes(me);
    };

    const canSeeQueue = (stepKey: StepKey): boolean => {
      if (!me) return false;
      if (isProcessCoordinator) return true;
      if (ROW_OWNED_STEPS.includes(stepKey)) return false;
      if (stepOwnerIds(stepKey).includes(me)) return true;
      // Somebody handed this person one row of this step.
      return assignees.some((a) => a.stepKey === stepKey && a.assignedTo === me);
    };

    const noms = d?.nominations ?? [];

    const canActOnSession = (stepKey: StepKey, sessionId: string): boolean => {
      if (!me) return false;
      if (isProcessCoordinator) return true;

      const a = assignees.find((x) => x.sessionId === sessionId && x.stepKey === stepKey);
      if (a) return a.assignedTo === me;

      // An INTERNAL trainer owns their own session's material and delivery. An
      // external one has no login at all, so HR does it for them.
      if (["pre_material", "conducted", "attendance", "assignment_issue"].includes(stepKey)) {
        const sess = sessions.find((x) => x.id === sessionId);
        const tr = (d?.trainers ?? []).find((t) => t.id === sess?.trainerId);
        if (tr?.trainerType === "internal" && tr.employeeId === me) return true;
      }

      // Nomination is owed by the HOD of the people being nominated. The client
      // list cannot resolve HODs (that is a server function), so it offers the
      // screen to any HOD and lets the RPC refuse — better than hiding it from
      // the person whose job it is.
      if (stepKey === "nomination" && isHod) return true;

      return stepOwnerIds(stepKey).includes(me);
    };

    const isParticipant = (sessionId: string): boolean =>
      noms.some((n) => n.sessionId === sessionId && n.employeeId === me && n.status === "approved");

    const queueEntries = sla ? buildQueueEntries(requests, sla) : [];

    /**
     * A permanently empty gate is noise — but live work is never hidden. When the
     * rule says Management is not required AND nothing is parked there, the queue
     * is not offered; the moment a request frozen as needing it arrives, it is.
     */
    const offersQueue = (stepKey: StepKey): boolean => {
      if (!canSeeQueue(stepKey)) return false;
      if (stepKey !== "mgmt_approval") return true;
      const rule = d?.approvalRule.mgmt ?? "never";
      if (rule !== "never") return true;
      return queueEntries.some((e) => e.stepKey === "mgmt_approval");
    };

    const byId = new Map(requests.map((r) => [r.id, r] as const));
    const profileMap = new Map(dir.profiles.map((p) => [p.id, p] as const));
    const orgMap = new Map((orgQ.data ?? []).map((p) => [p.id, p] as const));
    const deptMap = new Map(dir.departments.map((x) => [x.id, x] as const));

    return {
      loading: q.isLoading,
      error: q.error ? (q.error as Error).message : null,
      requests,
      sessions,
      notifications: d?.notifications ?? [],
      data: d,

      profiles: dir.profiles,
      orgDepartments: dir.departments,
      orgPeople: orgQ.data ?? [],
      profileById: (id) => (id ? profileMap.get(id) : undefined),
      personName: (id) =>
        !id ? "—" : profileMap.get(id)?.name ?? orgMap.get(id)?.name ?? "—",
      departmentName: (id) => (id ? deptMap.get(id)?.name ?? "—" : "—"),

      isProcessCoordinator,
      canMonitor,
      canRaise,
      canSeeMasters,
      canManageMaster,
      canManageMandatory: isProcessCoordinator,
      masterRequests,
      pendingMasterRequests,
      /*
       * ⚠ NOT EVERYBODY, THOUGH THE MODULE IS UNIVERSAL. The seven lists are
       *   picked from at HR validation, at trainer finalisation, at scheduling
       *   and at closure — all pipeline work. A warehouse operator raising a
       *   training need meets exactly one of them (Need source, which ships with
       *   six entries), so offering them a screen for asking after a delay reason
       *   would be noise. The database is more generous than this (any
       *   authenticated user may insert a request); this only decides who is
       *   OFFERED the screen, and a master owner sees it because resolving is
       *   their job.
       */
      canUseMasterRequests: isPipelineStaff || canSeeMasters,
      isPipelineStaff,
      canActOn,
      canSeeQueue,
      offersQueue,
      canActOnSession,
      isParticipant,
      stepOwnerIds,
      approvalRule: d?.approvalRule ?? { mgmt: "never", aboveAmount: 0 },
      queueEntries,
      entriesForStep: (stepKey) => queueEntries.filter((e) => e.stepKey === stepKey),
      dueIsoOf: (r) => (sla ? dueIsoFor(r, sla) : null),
      requestById: (id) => byId.get(id),

      refresh: async () => {
        await qc.invalidateQueries({ queryKey: LD_QK });
      },
      writes: W,
      markNotificationsRead: async (ids) => {
        await W.markNotificationsRead(ids);
        await qc.invalidateQueries({ queryKey: LD_QK });
      },
    };
  }, [q.data, q.isLoading, q.error, orgQ.data, dir.profiles, dir.departments, uid, isAdmin, qc]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLdStore(): LdStoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useLdStore must be used inside LdStoreProvider");
  return v;
}

export { isOpen, stepOf };
