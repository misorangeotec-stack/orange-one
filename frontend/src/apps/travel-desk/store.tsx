import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { TRAVEL_QK, travelQueryKey, fetchTravelData } from "./data/travelFetch";
import {
  markNotificationsRead as markNotificationsReadWrite,
  setCoordinators as setCoordinatorsWrite,
  setStepSla as setStepSlaWrite,
  setStepOwners as setStepOwnersWrite,
  setPolicy as setPolicyWrite,
  setCompanyIdentity as setCompanyIdentityWrite,
  saveEmployeeSettings as saveEmployeeSettingsWrite,
  reassignStep as reassignStepWrite,
  setReassignPool as setReassignPoolWrite,
} from "./data/travelWrites";
import { buildQueueEntries, parkedTrips, type QueueEntry, type QueueStep } from "./lib/queues";
import { resolveStepSla, type StepSlaMap } from "./lib/sla";
import { isManagerStep, type StepKey } from "./lib/steps";
import {
  saveTripDraft as saveTripDraftWrite,
  deleteTripDraft as deleteTripDraftWrite,
  submitTrip as submitTripWrite,
  setPassengers as setPassengersWrite,
  type TripDraftInput,
  type PassengerInput,
} from "./data/travelTripWrites";
import { resolveEntitlement, type Entitlement } from "./lib/entitlement";
import {
  approveAdvance as approveAdvanceWrite,
  disburseAdvance as disburseAdvanceWrite,
  recordAdvanceRecovery as recordAdvanceRecoveryWrite,
} from "./data/travelAdvanceWrites";
import { outstandingAdvanceFor, advanceCeiling } from "./lib/advance";
import {
  saveLeg as saveLegWrite,
  removeLeg as removeLegWrite,
  completeBooking as completeBookingWrite,
  requestCancellation as requestCancellationWrite,
  processCancellation as processCancellationWrite,
} from "./data/travelBookingWrites";
import {
  previewClaim as previewClaimRead,
  recordActualTravel as recordActualTravelWrite,
  saveClaimDraft as saveClaimDraftWrite,
  submitClaim as submitClaimWrite,
  noClaim as noClaimWrite,
  decideClaim as decideClaimWrite,
} from "./data/travelClaimWrites";
import {
  setLineSettlement as setLineSettlementWrite,
  overrideDaDay as overrideDaDayWrite,
  completeFinanceReview as completeFinanceReviewWrite,
  settleTrip as settleTripWrite,
} from "./data/travelSettlementWrites";
import {
  decideApproval as decideApprovalWrite,
  holdTrip as holdTripWrite,
  resumeTrip as resumeTripWrite,
  cancelTrip as cancelTripWrite,
  setApprovalMatrix as setApprovalMatrixWrite,
  type Decision,
} from "./data/travelApprovalWrites";
import {
  saveMaster as saveMasterWrite,
  setMasterActive as setMasterActiveWrite,
  requestMaster as requestMasterWrite,
  resolveMasterRequest as resolveMasterRequestWrite,
  setMasterOwners as setMasterOwnersWrite,
  setRate as setRateWrite,
  confirmRateCard as confirmRateCardWrite,
  cloneRateCard as cloneRateCardWrite,
  type MasterValues,
} from "./data/travelMasterWrites";
import type {
  Trip, TravelConfig, TravelPolicyConfig, TravelStepAssignee, TravelStepOwner,
  TravelEmployeeSettings, TravelNotification,
  TravelCity, TravelPurpose, TravelExpenseCategory, TravelHotel, TravelNamedMaster,
  TravelMasterManager, TravelMasterRequest, TravelRateCard, TravelRate,
  TravelMasterType, TravelRequestableMaster, TravelCategory, CityTier, RateType,
  TripPassenger, ApprovalMatrix, TripLeg, TripLegInput,
  ClaimLine, ClaimLineInput, ClaimPreview, DaDay, ActualTravelInput, SettlementInput,
} from "./types";

/**
 * The Travel Desk store — one snapshot of the module, plus the capability
 * answers every screen asks.
 *
 * ⚠ THREE SEPARATE QUESTIONS, DELIBERATELY NOT ONE FLAG:
 *     canEdit    — may this person change ANYTHING here? False only on a
 *                  view-only grant. A CEILING, never a permission: it grants
 *                  nothing and only takes away.
 *     canSee*    — may this person OPEN this screen? Includes viewers.
 *     canActOn   — may this person ACTION this step, on THIS trip? Ownership
 *                  plus canEdit — and for the two manager steps, the trip's own
 *                  approvers.
 *   Folding them together is how a view-only user ends up bounced off a screen
 *   they are entitled to read, or an owner without an edit grant is shown a
 *   button the database will refuse. The database says the same thing in
 *   fms_travel_can_act / fms_travel_can_see_trip, and THAT is the real boundary
 *   — everything here is a courtesy so the UI does not offer what will be
 *   refused.
 *
 * ⚠ `canActOn` TAKES A TRIP, and most FMS stores' equivalent does not. Two of
 *   these steps are owned per-trip by the traveller's own reporting managers
 *   (snapshotted at submit), so "may I approve" has no answer without knowing
 *   WHICH trip. hr-exit's store does the same for its three manager steps.
 */

const QK = TRAVEL_QK;

const EMPTY_CONFIG: TravelConfig = {
  reassignPoolDepartmentIds: [],
  reassignPoolUserIds: [],
  stepSla: null,
  processCoordinators: [],
  approvalMatrix: { directorFromBand: 6, managerAlsoForDirectorBands: true },
  policy: {
    maxPassengers: 5,
    bookingWindowDays: 30,
    advanceBookingWarnDays: 7,
    claimDeadlineDays: 5,
    claimHardStopDays: 30,
    advanceMaxPct: 90,
    advanceRecoveryDays: 30,
    hodReviewDays: 2,
    financeProcessDays: 5,
    creditDays: 7,
    disputeThreshold: 10000,
    hotelCapHardMultiple: 1.5,
    emergencyWindowHours: 24,
  },
  companyIdentity: { legalName: "", gstin: "", address: "" },
};

interface TravelStoreValue {
  isLoading: boolean;
  error: unknown;

  userId: string;
  isAdmin: boolean;
  isProcessCoordinator: boolean;
  /** Ceiling only — see the note above. */
  canEdit: boolean;
  isViewer: boolean;

  trips: Trip[];
  passengers: TripPassenger[];
  stepOwners: TravelStepOwner[];
  config: TravelConfig;
  stepSla: StepSlaMap;
  entries: QueueEntry[];
  /** Open, but owing nobody an action today — the Control Center's Parked strip. */
  parked: Trip[];
  employeeSettings: TravelEmployeeSettings[];
  notifications: TravelNotification[];

  tripById: (id: string | null) => Trip | undefined;
  /** This trip's passengers, in the order the form put them in. */
  passengersOf: (tripId: string) => TripPassenger[];
  legs: TripLeg[];
  /** This trip's booked legs, in the order they were added. */
  legsOf: (tripId: string) => TripLeg[];
  /**
   * The flat arrays, alongside the per-trip selectors.
   *
   * ⚠ THE REPORTS NEED THEM WHOLE. Policy Exceptions and the ITC register are
   *   both line-level reports ACROSS every trip, so walking trips and calling
   *   `claimLinesOf` on each would be the same read done N times.
   */
  claimLines: ClaimLine[];
  daDays: DaDay[];
  /** Trips this person is travelling on, or filed for somebody else. */
  myTrips: Trip[];
  /** Unfinished requests - private to their author, and carrying no number yet. */
  myDrafts: Trip[];
  ownersOf: (step: StepKey) => string[];
  /** This person's own travel defaults, if they have set any. */
  mySettings: TravelEmployeeSettings | undefined;

  // ---- masters & the policy (phase 2) ------------------------------------
  cities: TravelCity[];
  purposes: TravelPurpose[];
  expenseCategories: TravelExpenseCategory[];
  airlines: TravelNamedMaster[];
  hotels: TravelHotel[];
  busOperators: TravelNamedMaster[];
  masterManagers: TravelMasterManager[];
  masterRequests: TravelMasterRequest[];
  pendingMasterRequests: TravelMasterRequest[];

  rateCards: TravelRateCard[];
  rates: TravelRate[];
  /** The card a trip raised today would freeze — confirmed if there is one, else the newest draft. */
  effectiveCard: TravelRateCard | undefined;
  ratesFor: (cardId: string) => TravelRate[];
  /** How many disputed figures still stand between a card and sign-off. */
  blockersOn: (cardId: string) => number;
  cityById: (id: string | null) => TravelCity | undefined;

  /**
   * What the policy allows a band, ON A NAMED CARD.
   *
   * ⚠ THE CARD IS AN ARGUMENT, NOT AN ASSUMPTION, and that is the whole
   *   freeze doctrine in one signature. A request being typed prices on
   *   `effectiveCard` — the card a trip raised today would freeze. A trip
   *   already submitted prices on its own `snapRateCardId`, which may since have
   *   been superseded. A function that reached for "the current card" by itself
   *   would re-price last March's trip with January's revision.
   */
  entitlementOn: (cardId: string | null, bandNo: number | null, tier: CityTier | null) => Entitlement;

  canManageMaster: (type: TravelMasterType) => boolean;
  canManageAnyMaster: boolean;

  canRaise: boolean;
  canActOn: (step: StepKey, trip?: Trip | null) => boolean;
  /** Who is holding (trip, step), or null. */
  assigneeOfStep: (tripId: string | null | undefined, step: string) => string | null;
  /** May I reassign this step, or take it back? Broader than acting on it. */
  canReassignStep: (step: StepKey, trip: Trip) => boolean;
  /** Who it may be reassigned to: the pool plus the step's natural owners, minus me. */
  /**
   * Who it may be reassigned to, as IDS. Names are resolved by the caller: this
   * store has no directory dependency and should not grow one for a single
   * dialog - ReassignStepModal maps them through useOrgPeople.
   */
  reassignCandidates: (step: StepKey, trip: Trip) => string[];
  /** Reassign one step, or pass assignee: null to return it to its natural owner. */
  reassignStep: (input: { trip: Trip; step: StepKey; assignee: string | null; note?: string | null }) => Promise<void>;
  /** Departments the Setup picker filters candidates by. A UI FILTER - grants nothing. */
  reassignPoolDepartmentIds: string[];
  /** Everyone who may be handed a step. The authority. */
  reassignPoolUserIds: string[];
  /** Save who may be handed a step (admin). */
  setReassignPool: (input: { departmentIds: string[]; userIds: string[] }) => Promise<void>;
  canSeeQueue: (step: QueueStep) => boolean;
  canSetup: boolean;

  markNotificationsRead: (ids: string[]) => Promise<void>;
  setStepOwners: (
    step: StepKey,
    input: { departmentIds?: string[]; designationId?: string | null; employeeIds: string[] },
  ) => Promise<void>;
  setCoordinators: (userIds: string[]) => Promise<void>;
  setStepSla: (map: StepSlaMap) => Promise<void>;
  setPolicy: (policy: TravelPolicyConfig) => Promise<void>;
  setCompanyIdentity: (v: { legalName: string; gstin: string; address: string }) => Promise<void>;
  saveEmployeeSettings: (
    userId: string,
    input: {
      baseCityId?: string | null;
      seatPreference?: string | null;
      mealPreference?: string | null;
      frequentFlyerNo?: string | null;
    },
  ) => Promise<void>;

  saveMaster: (
    type: Exclude<TravelMasterType, "rate_card">,
    id: string | null,
    values: MasterValues,
    active: boolean,
  ) => Promise<void>;
  setMasterActive: (
    type: Exclude<TravelMasterType, "rate_card">,
    id: string,
    active: boolean,
  ) => Promise<void>;
  requestMaster: (type: TravelRequestableMaster, payload: Record<string, unknown>) => Promise<void>;
  resolveMasterRequest: (
    id: string,
    decision: "approved" | "rejected",
    note?: string | null,
    payload?: Record<string, unknown> | null,
  ) => Promise<void>;
  setMasterOwners: (type: TravelMasterType, userIds: string[]) => Promise<void>;

  /**
   * Does this band need a Director as well (§3.2)?
   *
   * ⚠ READS THE MATRIX, NOT A CONSTANT. Mirrored in SQL by
   *   fms_travel_next_stop, which is the only thing that actually routes — this
   *   exists so the form can warn "band 7 needs a Director too" before somebody
   *   submits and finds out.
   */
  needsDirector: (bandNo: number | null) => boolean;

  /**
   * What this person still owes in unreconciled advance — the figure §11.2 hangs
   * its hardest rule on.
   *
   * ⚠ COMPUTED FROM THE SAME SNAPSHOT EVERY SCREEN READS, so the warning on the
   *   request form, the Outstanding Advances report and the KPI on the dashboard
   *   cannot disagree. The DATABASE still decides — `fms_travel_outstanding_advance`
   *   is what actually refuses a second advance — and this mirrors it so the
   *   refusal is never a surprise.
   */
  outstandingAdvanceFor: (userId: string | null, excludeTripId?: string | null) => number;
  /** §11.1 — the most that may be advanced on this trip. Null with no estimate. */
  advanceCeiling: (trip: Trip) => number | null;

  claimLinesOf: (tripId: string) => ClaimLine[];
  daDaysOf: (tripId: string) => DaDay[];
  /**
   * Ask the server what this claim comes to.
   *
   * ⚠ IT IS NOT A STORE ACTION IN THE USUAL SENSE — it writes nothing and
   *   invalidates nothing. It is here rather than imported directly by the form
   *   only so every consumer goes through one place, and it exists at all
   *   because the money rules have exactly one author and it is the database.
   */
  previewClaim: (tripId: string, lines: ClaimLineInput[]) => Promise<ClaimPreview>;
  recordActualTravel: (tripId: string, input: ActualTravelInput) => Promise<void>;
  saveClaimDraft: (tripId: string, lines: ClaimLineInput[]) => Promise<number>;
  submitClaim: (tripId: string) => Promise<string>;
  noClaim: (tripId: string, reason?: string | null) => Promise<string>;
  decideClaim: (
    tripId: string,
    decision: "approve" | "return",
    note?: string | null,
  ) => Promise<string>;

  /**
   * Finance settles one line at its own figure, in either direction.
   *
   * ⚠ `null` CLEARS IT AND IS NOT THE SAME AS ZERO. Zero is Finance deciding
   *   the line is worth nothing and needs a reason like any other figure;
   *   null is undoing a decision and lets the engine's answer stand again.
   */
  setLineSettlement: (
    lineId: string,
    amount: number | null,
    reason: string | null,
  ) => Promise<Record<string, number>>;
  overrideDaDay: (dayId: string, amount: number | null, reason: string | null) => Promise<number>;
  completeFinanceReview: (tripId: string, note?: string | null) => Promise<string>;
  settleTrip: (tripId: string, input: SettlementInput) => Promise<string>;

  saveLeg: (tripId: string, input: TripLegInput, legId?: string | null) => Promise<string>;
  removeLeg: (legId: string) => Promise<void>;
  completeBooking: (tripId: string) => Promise<string>;
  requestCancellation: (tripId: string, reason: string) => Promise<void>;
  processCancellation: (
    tripId: string,
    decision: "cancel" | "refuse",
    kind?: "business" | "personal" | null,
    note?: string | null,
  ) => Promise<string>;

  approveAdvance: (tripId: string, amount: number, note?: string | null) => Promise<number>;
  disburseAdvance: (
    tripId: string,
    input: { amount: number; paidOn: string; mode?: string | null; ref?: string | null },
  ) => Promise<string>;
  recordAdvanceRecovery: (tripId: string, amount: number, ref?: string | null) => Promise<number>;

  decideApproval: (
    step: "manager_approval" | "director_approval",
    tripId: string,
    decision: Decision,
    note?: string | null,
  ) => Promise<string>;
  holdTrip: (tripId: string, reason: string) => Promise<void>;
  resumeTrip: (tripId: string) => Promise<string>;
  cancelTrip: (tripId: string, reason: string) => Promise<void>;
  setApprovalMatrix: (m: ApprovalMatrix) => Promise<void>;

  saveTripDraft: (input: TripDraftInput, tripId?: string | null) => Promise<string>;
  deleteTripDraft: (tripId: string) => Promise<void>;
  submitTrip: (tripId: string) => Promise<string>;
  setPassengers: (tripId: string, rows: PassengerInput[]) => Promise<void>;

  setRate: (
    rateId: string,
    patch: { amount?: number | null; textValue?: string | null; notes?: string | null },
  ) => Promise<void>;
  confirmRateCard: (cardId: string) => Promise<void>;
  cloneRateCard: (fromCardId: string, label: string, effectiveFrom: string) => Promise<string>;

  refresh: () => Promise<void>;
}

const Ctx = createContext<TravelStoreValue | null>(null);

export function TravelStoreProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const qc = useQueryClient();
  const userId = session.user?.id ?? "";

  const { data, isLoading, error } = useQuery({
    queryKey: travelQueryKey(userId || null),
    queryFn: fetchTravelData,
    enabled: !!userId,
  });

  const value = useMemo<TravelStoreValue>(() => {
    const stepOwners = data?.stepOwners ?? [];
    const stepAssignees = data?.stepAssignees ?? [];
    const config = data?.config ?? EMPTY_CONFIG;
    const trips = data?.trips ?? [];
    const passengers = data?.passengers ?? [];
    const legs = data?.legs ?? [];
    const claimLines = data?.claimLines ?? [];
    const daDays = data?.daDays ?? [];
    const employeeSettings = data?.employeeSettings ?? [];

    const isAdmin = session.isAdmin;
    const canEdit = session.canEditModule("travel-desk");
    const isViewer = session.isModuleViewer("travel-desk");
    const isProcessCoordinator = isAdmin || config.processCoordinators.includes(userId);

    const ownersOf = (step: StepKey): string[] =>
      stepOwners.find((o) => o.stepKey === step)?.employeeIds ?? [];

    const isOwner = (step: StepKey): boolean => ownersOf(step).includes(userId);

    const stepSla = resolveStepSla(data?.stepSla);
    const entries = buildQueueEntries(trips, stepSla);

    /**
     * Mirrors fms_travel_can_act.
     *
     * ⚠ THE MANAGER ARM DOES NOT EARLY-RETURN. If this trip's own approvers do
     *   not include you, the check FALLS THROUGH to the configured step owners —
     *   so HR, named once in Settings, can act on any trip's manager approval
     *   without being on every trip's snapshot. That is the PRD's "HR: same
     *   permissions as HOD", and it is hr-exit's shape, whose comment calls the
     *   early-returning variant (hr-recruitment's) the bug it avoided.
     */
    /**
     * Who is holding (trip, step), or null. Keyed the way fms_travel_can_act
     * authorises, so the client and the server cannot disagree.
     */
    const assigneeByKey = new Map<string, string>();
    for (const a of stepAssignees) assigneeByKey.set(a.tripId + '|' + a.stepKey, a.assignedTo);
    const assigneeOfStep = (tripId: string | null | undefined, step: string): string | null =>
      tripId ? assigneeByKey.get(tripId + '|' + step) ?? null : null;

    /** Who owns a step when nobody is assigned. Mirrors fms_travel_is_natural_step_owner. */
    const isNaturalStepOwner = (step: StepKey, trip: Trip | null | undefined, uid: string): boolean => {
      if (isManagerStep(step) && trip?.approverManagerIds.includes(uid)) return true;
      if (ownersOf(step).includes(uid)) return true;
      return step === 'request' && ownersOf('request').length === 0;
    };

    /**
     * May I reassign this step, or take it back? Broader than acting on it: the
     * snapshot approver keeps this after passing it on, which is how it comes
     * back. Mirrors fms_travel_reassign_step, including its module-edit gate —
     * that RPC applies `module_can_edit` to the caller too, so this is not a way
     * around it.
     */
    const canReassignStep = (step: StepKey, trip: Trip): boolean => {
      if (!canEdit) return false;
      if (trip.status === "draft" || trip.status === "cancelled" || trip.status === "closed" || trip.status === "rejected") {
        return false;
      }
      if (isProcessCoordinator) return true;
      if (assigneeOfStep(trip.id, step) === userId) return true;
      return isNaturalStepOwner(step, trip, userId);
    };

    /**
     * Who this step may be reassigned to: the configured pool plus its natural
     * owners so it can be returned, minus me.
     *
     * ⚠ For manager_approval the natural owners come off the trip's OWN snapshot,
     *   which this feature never rewrites — so "return it" always means the person
     *   the trip was originally raised against, not whoever heads that department
     *   today.
     */
    const reassignCandidates = (step: StepKey, trip: Trip): string[] => {
      const ids = new Set<string>(config.reassignPoolUserIds);
      if (isManagerStep(step)) for (const id of trip.approverManagerIds) ids.add(id);
      for (const id of ownersOf(step)) ids.add(id);
      ids.delete(userId);
      return [...ids];
    };

    const canActOn = (step: StepKey, trip?: Trip | null): boolean => {
      if (!canEdit) return false;
      if (isProcessCoordinator) return true;
      // A REASSIGNMENT MOVES THE WORK. It sits above every ownership arm below,
      // so it REPLACES them rather than joining them - an OR would leave the step
      // in the snapshot approver's queue too. It never touches
      // approverManagerIds, which stays as the record of who the trip was raised
      // against and is where a hand-back returns it. Mirrors fms_travel_can_act.
      const assignee = assigneeOfStep(trip?.id, step);
      if (assignee) return assignee === userId;
      if (isManagerStep(step) && trip?.approverManagerIds.includes(userId)) return true;
      if (isOwner(step)) return true;
      // The origin step is open to any editor while it has no owners; naming
      // owners closes it to them, admins and coordinators.
      return step === "request" && ownersOf("request").length === 0;
    };

    const canRaise = canActOn("request");

    /**
     * A queue OPENS for its owners, for coordinators, and for a module viewer —
     * who reads everything and can action nothing.
     *
     * ⚠ PLUS ANYONE WHO IS A NAMED APPROVER ON AN OPEN TRIP. A reporting manager
     *   owns `manager_approval` per trip and is never in the owners table, so
     *   without this arm the one person who owes the decision would have no list
     *   of what they owe. hr-exit's ApprovalsQueue gates on exactly the same
     *   thing — "anyone with a manager-review row belongs here".
     *
     * ⚠ PLUS THE TRAVELLER, FOR `claim`. Filing your own expenses is not a step
     *   anybody makes you an owner of; it is what the module is for. Hiding the
     *   queue would leave the person who owes the claim unable to see it. This
     *   does not widen what they can SEE — the trips policy hands a non-owner
     *   only their own trips, so the list they open is their own.
     */
    const hasManagerRow = (step: QueueStep): boolean =>
      isManagerStep(step) && entries.some((e) => e.stepKey === step && e.approverManagerIds.includes(userId));

    /** Am I holding anything on this step? The only reason a receiver outside every
     *  owners list may reach the queue at all. */
    const hasAssignedRow = (step: QueueStep): boolean =>
      stepAssignees.some((a) => a.stepKey === step && a.assignedTo === userId);

    const canSeeQueue = (step: QueueStep): boolean =>
      isProcessCoordinator ||
      isViewer ||
      isOwner(step) ||
      hasManagerRow(step) ||
      hasAssignedRow(step) ||
      (step === "claim" && canEdit);

    // ---- masters & the policy ---------------------------------------------
    const cities = data?.cities ?? [];
    const rateCards = data?.rateCards ?? [];
    const rates = data?.rates ?? [];
    const masterManagers = data?.masterManagers ?? [];
    const masterRequests = data?.masterRequests ?? [];

    /**
     * Mirrors fms_travel_is_master_manager, plus the admin bypass every master
     * table policy carries.
     *
     * ⚠ NOT GATED ON canEdit, deliberately. Master ownership is granted
     *   separately from the workflow: somebody may curate the hotel list without
     *   ever travelling, and requiring an edit grant on the module would make
     *   that impossible for exactly the people who know the answer.
     */
    const canManageMaster = (type: TravelMasterType): boolean =>
      isAdmin || masterManagers.some((m) => m.masterType === type && m.managerUserId === userId);

    /**
     * Which card a trip raised today would freeze.
     *
     * Mirrors fms_travel_effective_rate_card: the confirmed card with the latest
     * effective date on or before today, else the newest DRAFT — so the module
     * prices everything before the Directors have signed anything off. A draft
     * card advises; only a confirmed one enforces.
     */
    const today = new Date().toISOString().slice(0, 10);
    const effectiveCard =
      rateCards
        .filter((c) => c.status === "confirmed" && c.effectiveFrom <= today)
        .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]
      ?? rateCards
        .filter((c) => c.status === "draft")
        .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];

    return {
      isLoading,
      error,

      userId,
      isAdmin,
      isProcessCoordinator,
      canEdit,
      isViewer,

      trips,
      passengers,
      stepOwners,
      config,
      stepSla,
      entries,
      parked: parkedTrips(trips),
      employeeSettings,
      notifications: data?.notifications ?? [],

      tripById: (id) => (id ? trips.find((t) => t.id === id) : undefined),
      passengersOf: (tripId: string) =>
        passengers.filter((x) => x.tripId === tripId).sort((a, b) => a.sortOrder - b.sortOrder),
      legs,
      legsOf: (tripId: string) =>
        legs.filter((x) => x.tripId === tripId).sort((a, b) => a.sortOrder - b.sortOrder),
      claimLines,
      daDays,
      claimLinesOf: (tripId: string) =>
        claimLines.filter((x) => x.tripId === tripId).sort((a, b) => a.sortOrder - b.sortOrder),
      // Chronological, because a daily allowance read out of date order is not a
      // list anybody can check against a calendar.
      daDaysOf: (tripId: string) =>
        daDays.filter((x) => x.tripId === tripId).sort((a, b) => a.day.localeCompare(b.day)),
      myTrips: trips.filter(
        (t) => t.status !== "draft" && (t.travellerId === userId || t.raisedBy === userId),
      ),
      // Drafts are already invisible to everybody else at the DATABASE - the
      // SELECT policy hides them - so this filter is for the correctness of the
      // list, not for privacy. An admin, who can see them all, still wants
      // "Drafts" to mean their own unfinished work.
      myDrafts: trips.filter((t) => t.status === "draft" && t.raisedBy === userId),
      ownersOf,
      mySettings: employeeSettings.find((s) => s.userId === userId),

      cities,
      purposes: data?.purposes ?? [],
      expenseCategories: data?.expenseCategories ?? [],
      airlines: data?.airlines ?? [],
      hotels: data?.hotels ?? [],
      busOperators: data?.busOperators ?? [],
      masterManagers,
      masterRequests,
      pendingMasterRequests: masterRequests.filter((r) => r.status === "pending"),

      rateCards,
      rates,
      effectiveCard,
      ratesFor: (cardId: string) => rates.filter((r) => r.rateCardId === cardId),
      blockersOn: (cardId: string) =>
        rates.filter((r) => r.rateCardId === cardId && r.disputed).length,
      cityById: (id) => (id ? cities.find((c) => c.id === id) : undefined),

      entitlementOn: (cardId, bandNo, tier) => resolveEntitlement(rates, cardId, bandNo, tier),

      canManageMaster,
      canManageAnyMaster: isAdmin || masterManagers.some((m) => m.managerUserId === userId),

      canRaise,
      canActOn,
      assigneeOfStep,
      canReassignStep,
      reassignCandidates,
      reassignPoolDepartmentIds: config.reassignPoolDepartmentIds,
      reassignPoolUserIds: config.reassignPoolUserIds,
      reassignStep: async ({ trip, step, assignee, note }) => {
        await reassignStepWrite(trip.id, step, assignee, note ?? null);
        await qc.invalidateQueries({ queryKey: QK });
      },
      setReassignPool: async (input) => {
        await setReassignPoolWrite(input);
        await qc.invalidateQueries({ queryKey: QK });
      },
      canSeeQueue,
      canSetup: isAdmin,

      markNotificationsRead: async (ids: string[]) => {
        await markNotificationsReadWrite(ids);
        await qc.invalidateQueries({ queryKey: QK });
      },
      setStepOwners: async (step, input) => {
        await setStepOwnersWrite(step, input);
        await qc.invalidateQueries({ queryKey: QK });
      },
      setCoordinators: async (userIds) => {
        await setCoordinatorsWrite(userIds);
        await qc.invalidateQueries({ queryKey: QK });
      },
      setStepSla: async (map) => {
        await setStepSlaWrite(map);
        await qc.invalidateQueries({ queryKey: QK });
      },
      setPolicy: async (policy) => {
        await setPolicyWrite(policy);
        await qc.invalidateQueries({ queryKey: QK });
      },
      setCompanyIdentity: async (v) => {
        await setCompanyIdentityWrite(v);
        await qc.invalidateQueries({ queryKey: QK });
      },
      saveEmployeeSettings: async (id, input) => {
        await saveEmployeeSettingsWrite(id, input);
        await qc.invalidateQueries({ queryKey: QK });
      },

      saveMaster: async (type, id, values, active) => {
        await saveMasterWrite(type, id, values, active);
        await qc.invalidateQueries({ queryKey: QK });
      },
      setMasterActive: async (type, id, active) => {
        await setMasterActiveWrite(type, id, active);
        await qc.invalidateQueries({ queryKey: QK });
      },
      requestMaster: async (type, payload) => {
        await requestMasterWrite(type, payload, userId);
        await qc.invalidateQueries({ queryKey: QK });
      },
      resolveMasterRequest: async (id, decision, note, payload) => {
        await resolveMasterRequestWrite(id, decision, note, payload);
        await qc.invalidateQueries({ queryKey: QK });
      },
      setMasterOwners: async (type, userIds) => {
        await setMasterOwnersWrite(type, userIds);
        await qc.invalidateQueries({ queryKey: QK });
      },

      needsDirector: (bandNo) =>
        bandNo !== null && bandNo !== undefined && bandNo >= config.approvalMatrix.directorFromBand,

      outstandingAdvanceFor: (userId, excludeTripId) =>
        outstandingAdvanceFor(trips, userId, excludeTripId ?? null),
      advanceCeiling: (trip) => advanceCeiling(trip, config.policy.advanceMaxPct),

      // Reads only. Nothing to invalidate, because the engine writes nothing.
      previewClaim: (tripId, lines) => previewClaimRead(tripId, lines),

      recordActualTravel: async (tripId, input) => {
        await recordActualTravelWrite(tripId, input);
        await qc.invalidateQueries({ queryKey: QK });
      },
      saveClaimDraft: async (tripId, lines) => {
        const n = await saveClaimDraftWrite(tripId, lines);
        await qc.invalidateQueries({ queryKey: QK });
        return n;
      },
      submitClaim: async (tripId) => {
        const st = await submitClaimWrite(tripId);
        await qc.invalidateQueries({ queryKey: QK });
        return st;
      },
      noClaim: async (tripId, reason) => {
        const st = await noClaimWrite(tripId, reason);
        await qc.invalidateQueries({ queryKey: QK });
        return st;
      },
      decideClaim: async (tripId, decision, note) => {
        const st = await decideClaimWrite(tripId, decision, note);
        await qc.invalidateQueries({ queryKey: QK });
        return st;
      },

      setLineSettlement: async (lineId, amount, reason) => {
        const sum = await setLineSettlementWrite(lineId, amount, reason);
        await qc.invalidateQueries({ queryKey: QK });
        return sum;
      },
      overrideDaDay: async (dayId, amount, reason) => {
        const total = await overrideDaDayWrite(dayId, amount, reason);
        await qc.invalidateQueries({ queryKey: QK });
        return total;
      },
      completeFinanceReview: async (tripId, note) => {
        const st = await completeFinanceReviewWrite(tripId, note);
        await qc.invalidateQueries({ queryKey: QK });
        return st;
      },
      settleTrip: async (tripId, input) => {
        const st = await settleTripWrite(tripId, input);
        await qc.invalidateQueries({ queryKey: QK });
        return st;
      },

      saveLeg: async (tripId, input, legId) => {
        const id = await saveLegWrite(tripId, input, legId ?? null);
        await qc.invalidateQueries({ queryKey: QK });
        return id;
      },
      removeLeg: async (legId) => {
        await removeLegWrite(legId);
        await qc.invalidateQueries({ queryKey: QK });
      },
      completeBooking: async (tripId) => {
        const st = await completeBookingWrite(tripId);
        await qc.invalidateQueries({ queryKey: QK });
        return st;
      },
      requestCancellation: async (tripId, reason) => {
        await requestCancellationWrite(tripId, reason);
        await qc.invalidateQueries({ queryKey: QK });
      },
      processCancellation: async (tripId, decision, kind, note) => {
        const st = await processCancellationWrite(tripId, decision, kind, note);
        await qc.invalidateQueries({ queryKey: QK });
        return st;
      },

      approveAdvance: async (tripId, amount, note) => {
        const v = await approveAdvanceWrite(tripId, amount, note);
        await qc.invalidateQueries({ queryKey: QK });
        return v;
      },
      disburseAdvance: async (tripId, input) => {
        const status = await disburseAdvanceWrite(tripId, input);
        await qc.invalidateQueries({ queryKey: QK });
        return status;
      },
      recordAdvanceRecovery: async (tripId, amount, ref) => {
        const v = await recordAdvanceRecoveryWrite(tripId, amount, ref);
        await qc.invalidateQueries({ queryKey: QK });
        return v;
      },

      decideApproval: async (step, tripId, decision, note) => {
        const next = await decideApprovalWrite(step, tripId, decision, note);
        await qc.invalidateQueries({ queryKey: QK });
        return next;
      },
      holdTrip: async (tripId, reason) => {
        await holdTripWrite(tripId, reason);
        await qc.invalidateQueries({ queryKey: QK });
      },
      resumeTrip: async (tripId) => {
        const next = await resumeTripWrite(tripId);
        await qc.invalidateQueries({ queryKey: QK });
        return next;
      },
      cancelTrip: async (tripId, reason) => {
        await cancelTripWrite(tripId, reason);
        await qc.invalidateQueries({ queryKey: QK });
      },
      setApprovalMatrix: async (m) => {
        await setApprovalMatrixWrite(m);
        await qc.invalidateQueries({ queryKey: QK });
      },

      saveTripDraft: async (input, tripId) => {
        const id = await saveTripDraftWrite(input, tripId ?? null);
        await qc.invalidateQueries({ queryKey: QK });
        return id;
      },
      deleteTripDraft: async (tripId) => {
        await deleteTripDraftWrite(tripId);
        await qc.invalidateQueries({ queryKey: QK });
      },
      submitTrip: async (tripId) => {
        const no = await submitTripWrite(tripId);
        await qc.invalidateQueries({ queryKey: QK });
        return no;
      },
      setPassengers: async (tripId, rows) => {
        await setPassengersWrite(tripId, rows);
        await qc.invalidateQueries({ queryKey: QK });
      },

      setRate: async (rateId, patch) => {
        await setRateWrite(rateId, patch);
        await qc.invalidateQueries({ queryKey: QK });
      },
      confirmRateCard: async (cardId) => {
        await confirmRateCardWrite(cardId);
        await qc.invalidateQueries({ queryKey: QK });
      },
      cloneRateCard: async (fromCardId, label, effectiveFrom) => {
        const id = await cloneRateCardWrite(fromCardId, label, effectiveFrom);
        await qc.invalidateQueries({ queryKey: QK });
        return id;
      },

      refresh: async () => {
        await qc.invalidateQueries({ queryKey: QK });
      },
    };
  }, [data, isLoading, error, session, userId, qc]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTravelStore(): TravelStoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTravelStore must be used inside TravelStoreProvider");
  return v;
}
