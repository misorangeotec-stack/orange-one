import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { OCPI_QK, ocpiQueryKey, fetchOcpiData, type OcpiConfig } from "./data/ocpiFetch";
import {
  markNotificationsRead as markNotificationsReadWrite,
  setConfig as setConfigWrite,
  setQuotationSeries as setQuotationSeriesWrite,
} from "./data/ocpiWrites";
import { buildQueueEntries, type QueueEntry, type QueueStep } from "./lib/queues";
import { resolveStepSla, type StepSlaMap } from "./lib/sla";
import type { StepKey } from "./lib/steps";
import type {
  OcpiCompanyProfile, OcpiDeal, OcpiMachine, OcpiMachineSection, OcpiNotification,
  OcpiStepOwner, QuotationVersion,
  OcpiMasterManager, OcpiMasterRequest, OcpiMasterType, OcpiNamedMaster,
} from "./types";

/**
 * The OCPI store — one snapshot of the module, plus the capability answers every
 * screen asks.
 *
 * ⚠ THREE SEPARATE QUESTIONS, DELIBERATELY NOT ONE FLAG:
 *     canEdit    — may this person change ANYTHING here? False only on a
 *                  view-only grant. A CEILING, never a permission: it grants
 *                  nothing and only takes away.
 *     canSee*    — may this person OPEN this screen? Includes viewers.
 *     canActOn   — may this person ACTION this step? Ownership plus canEdit.
 *   Folding them together is how a view-only user ends up bounced off a screen
 *   they are entitled to read, or an owner without an edit grant is shown a
 *   button the database will refuse. The database says the same thing in
 *   fms_ocpi_can_act / fms_ocpi_can_see_deal, and that is the real boundary —
 *   everything here is a courtesy so the UI does not offer what will be refused.
 */

const QK = OCPI_QK;

interface OcpiStoreValue {
  isLoading: boolean;
  error: unknown;

  userId: string;
  isAdmin: boolean;
  isProcessCoordinator: boolean;
  /** Ceiling only — see the note above. */
  canEdit: boolean;
  isViewer: boolean;
  /**
   * The TALLY salesperson name(s) this user is tagged with
   * (profiles.receivables_salespersons).
   *
   * ⚠ REUSED, NOT REINVENTED. That tag already maps a portal user to their Tally
   *   salesperson name and an admin sets it in the User form. A second mapping
   *   owned by OCPI would be a second thing to keep in step, and the two would
   *   disagree inside a month. Used to prefill a new quotation's salesperson and
   *   to answer "which of these deals are mine".
   */
  salespersonTags: string[];

  stepOwners: OcpiStepOwner[];
  config: OcpiConfig;
  /**
   * The live per-step due-date rules, defaults already merged in.
   *
   * ⚠ ALWAYS A COMPLETE MAP. `resolveStepSla` fills every step from the
   *   defaults, so a screen never has to ask whether a rule exists — an unset or
   *   since-renamed step falls back rather than silently losing its due date.
   */
  stepSla: StepSlaMap;
  companyProfiles: OcpiCompanyProfile[];
  machines: OcpiMachine[];
  machineSections: OcpiMachineSection[];
  deals: OcpiDeal[];
  versions: QuotationVersion[];
  notifications: OcpiNotification[];

  headTypes: OcpiNamedMaster[];
  inkTypes: OcpiNamedMaster[];
  dryerTypes: OcpiNamedMaster[];
  masterManagers: OcpiMasterManager[];
  masterRequests: OcpiMasterRequest[];

  /**
   * May this person EDIT this master directly, and resolve requests against it?
   *
   * ⚠ Ownership here is separate from step ownership and from the edit grant.
   *   The database says the same in fms_ocpi_is_master_manager, which is the
   *   boundary; this only stops the UI offering what would be refused.
   */
  canManageMaster: (type: OcpiMasterType) => boolean;
  /** Master requests still waiting on somebody. */
  pendingMasterRequests: OcpiMasterRequest[];

  /** Every open work-item, one per deal waiting at a queue step. */
  entries: QueueEntry[];

  /** May this person raise a new deal? */
  canRaise: boolean;
  /** May this person ACTION this step? */
  canActOn: (step: StepKey) => boolean;
  /** May this person OPEN this step's queue? Viewers included. */
  canSeeQueue: (step: QueueStep) => boolean;
  /** May this person open the settings screens? */
  canSetup: boolean;

  ownersOf: (step: StepKey) => string[];
  machineById: (id: string | null) => OcpiMachine | undefined;
  sectionsFor: (machineId: string) => OcpiMachineSection[];
  /** The selling entity's identity for a deal's company, falling back to the default row. */
  profileFor: (companyId: string | null) => OcpiCompanyProfile | undefined;
  /** The same, plus whether the answer came from the default rather than the deal's own company. */
  profileStatusFor: (companyId: string | null) => {
    profile: OcpiCompanyProfile | undefined;
    isFallback: boolean;
    hasAny: boolean;
  };

  markNotificationsRead: (ids: string[]) => Promise<void>;
  /** Admin: per-step due-date targets. */
  setStepSla: (map: StepSlaMap) => Promise<void>;
  /** Admin: who may act on any step and open the Control Center. */
  setCoordinators: (userIds: string[]) => Promise<void>;
  /** Admin: confirm the last quotation number already issued. Forward-only. */
  setQuotationSeries: (lastUsed: number) => Promise<number>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<OcpiStoreValue | null>(null);

const EMPTY_CONFIG: OcpiConfig = {
  processCoordinatorIds: [],
  quotationValidityDays: 30,
  defaultGstRate: 18,
  quotationSeries: { confirmed: false, confirmedAtValue: null, confirmedAt: null, confirmedBy: null },
};

export function OcpiStoreProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const qc = useQueryClient();
  const userId = session.user?.id ?? "";

  const { data, isLoading, error } = useQuery({
    queryKey: ocpiQueryKey(userId || null),
    queryFn: fetchOcpiData,
    enabled: !!userId,
  });

  const value = useMemo<OcpiStoreValue>(() => {
    const stepOwners = data?.stepOwners ?? [];
    const config = data?.config ?? EMPTY_CONFIG;
    const deals = data?.deals ?? [];
    const machines = data?.machines ?? [];
    const machineSections = data?.machineSections ?? [];
    const companyProfiles = data?.companyProfiles ?? [];

    const isAdmin = session.isAdmin;
    const canEdit = session.canEditModule("ocpi");
    const isViewer = session.isModuleViewer("ocpi");
    const isProcessCoordinator = isAdmin || config.processCoordinatorIds.includes(userId);

    const ownersOf = (step: StepKey): string[] =>
      stepOwners.find((o) => o.stepKey === step)?.employeeIds ?? [];

    const isOwner = (step: StepKey): boolean => ownersOf(step).includes(userId);

    // Mirrors fms_ocpi_can_act. The origin step is open to any editor while it
    // has no owners; naming owners closes it to them, admins and coordinators.
    const canActOn = (step: StepKey): boolean => {
      if (!canEdit) return false;
      if (isProcessCoordinator) return true;
      if (isOwner(step)) return true;
      return step === "quotation" && ownersOf("quotation").length === 0;
    };

    const canRaise = canActOn("quotation");

    /**
     * A queue OPENS for its owners, for coordinators, and for a module viewer —
     * who reads everything and can action nothing.
     *
     * ⚠ PLUS ANY SALESPERSON, FOR THE TWO STEPS THEY THEMSELVES ACT ON. The
     *   salesperson completes the order confirmation and files the customer's
     *   signed copy — the RPCs let them, whether or not anyone made them a step
     *   owner — so hiding those two queues would leave the one person who owes
     *   the work with no list of what they owe. It is not a widening of what
     *   they can SEE: the deals policy still hands a non-owner only their own
     *   deals, so the list they open is their own.
     */
    const RAISER_STEPS: QueueStep[] = ["order_confirmation", "customer_signoff"];
    const canSeeQueue = (step: QueueStep): boolean =>
      isProcessCoordinator ||
      isViewer ||
      isOwner(step) ||
      (RAISER_STEPS.includes(step) && canRaise);

    // ⚠ The SLA map is passed IN rather than read inside the builder, which is
    //   what keeps lib/queues.ts pure and lets the Control Center adapter build
    //   the identical entries from the identical cache entry.
    const stepSla = resolveStepSla(data?.stepSla);
    const entries = buildQueueEntries(deals, stepSla);

    const headTypes = data?.headTypes ?? [];
    const inkTypes = data?.inkTypes ?? [];
    const dryerTypes = data?.dryerTypes ?? [];
    const masterManagers = data?.masterManagers ?? [];
    const masterRequests = data?.masterRequests ?? [];

    // Mirrors fms_ocpi_is_master_manager, plus the admin bypass every table
    // policy carries. NOT gated on canEdit: master ownership is granted
    // separately and is about the reference data, not the workflow.
    const canManageMaster = (type: OcpiMasterType): boolean =>
      isAdmin || masterManagers.some((m) => m.masterType === type && m.managerUserId === userId);

    const machineById = (id: string | null) =>
      id ? machines.find((m) => m.id === id) : undefined;

    const sectionsFor = (machineId: string) =>
      machineSections
        .filter((s) => s.machineId === machineId && s.active)
        .sort((a, b) => a.sortOrder - b.sortOrder);

    const profileFor = (companyId: string | null) =>
      (companyId ? companyProfiles.find((p) => p.companyId === companyId && p.active) : undefined) ??
      companyProfiles.find((p) => p.isDefault && p.active);

    /**
     * The same lookup, but saying WHICH profile answered.
     *
     * ⚠ THE FALLBACK IS THE DANGEROUS CASE, and until now it was silent. A deal
     *   booked under Colorix or either Noida arm, with no profile of its own,
     *   quietly prints Orange O Tec Pvt Ltd's bank account, CIN and registered
     *   address on a contract the customer pays against — `loadLetterhead` even
     *   computes a `usedDefault` flag for it, which nothing read. The fallback
     *   itself is right (a blank bank block is worse than a wrong one only if
     *   nobody is told), so what changes is that the screens that produce a
     *   document now say so.
     */
    const profileStatusFor = (companyId: string | null) => {
      const own = companyId
        ? companyProfiles.find((p) => p.companyId === companyId && p.active)
        : undefined;
      const profile = own ?? companyProfiles.find((p) => p.isDefault && p.active);
      return {
        profile,
        // No company on the deal is NOT a fallback: the default row exists
        // precisely to cover that, and warning about it would cry wolf on the
        // ten-odd customers Tally has never assigned a company.
        isFallback: !!companyId && !own,
        hasAny: !!profile,
      };
    };

    return {
      isLoading,
      error,
      userId,
      isAdmin,
      isProcessCoordinator,
      canEdit,
      isViewer,
      salespersonTags: session.user?.receivablesSalespersons ?? [],

      stepOwners,
      config,
      stepSla,
      companyProfiles,
      machines,
      machineSections,
      deals,
      versions: data?.versions ?? [],
      notifications: data?.notifications ?? [],

      headTypes,
      inkTypes,
      dryerTypes,
      masterManagers,
      masterRequests,
      canManageMaster,
      pendingMasterRequests: masterRequests.filter((r) => r.status === "pending"),

      entries,

      canRaise,
      canActOn,
      canSeeQueue,
      canSetup: isAdmin,

      ownersOf,
      machineById,
      sectionsFor,
      profileFor,
      profileStatusFor,

      markNotificationsRead: async (ids: string[]) => {
        await markNotificationsReadWrite(ids);
        await qc.invalidateQueries({ queryKey: QK });
      },
      setStepSla: async (map) => {
        await setConfigWrite('step_sla', map as unknown as Record<string, unknown>);
        await qc.invalidateQueries({ queryKey: QK });
      },
      setCoordinators: async (userIds) => {
        await setConfigWrite('process_coordinators', { user_ids: userIds });
        await qc.invalidateQueries({ queryKey: QK });
      },
      setQuotationSeries: async (lastUsed) => {
        const v = await setQuotationSeriesWrite(lastUsed);
        await qc.invalidateQueries({ queryKey: QK });
        return v;
      },
      refresh: async () => {
        await qc.invalidateQueries({ queryKey: QK });
      },
    };
  }, [data, isLoading, error, session, userId, qc]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOcpiStore(): OcpiStoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useOcpiStore must be used inside OcpiStoreProvider");
  return v;
}
