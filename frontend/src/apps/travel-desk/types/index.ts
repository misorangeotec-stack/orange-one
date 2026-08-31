import type { StepKey } from "../lib/steps";

/**
 * Travel Desk domain types.
 *
 * ⚠ STATUSES ARE NOT STEP KEYS. A step says whose desk the trip is on; a status
 *   says what state the trip is in, and five of them (draft, returned, rejected,
 *   on_hold, cancelled) are on NOBODY's desk. Keeping them apart is what stops a
 *   parked trip being counted as work somebody owes — see STATUS_STEP below,
 *   which is deliberately Partial.
 */

/**
 * Every state a trip can be in.
 *
 * The source PRD lists twelve; this is fourteen, and the difference is worth
 * recording because it looks like drift and is not:
 *
 *   COLLAPSED (the PRD names two states for one)
 *     Submitted        + Pending Approval → awaiting_manager_approval
 *     Approved         + Pending Booking  → awaiting_booking
 *     Booked           + Ticket Shared    → booked   (uploading IS sharing)
 *
 *   SPLIT (the policy needs states the PRD has no name for)
 *     awaiting_director_approval  §3.2 — bands 6-9
 *     awaiting_advance            §11.1 — money before departure
 *     awaiting_claim_review       §11.1 step 7 — the HOD on the claim
 *     awaiting_finance_review     §11.1 step 8 — policy caps applied
 *     awaiting_settlement         §11.1 step 8 — advance netted, then paid
 *
 *   KEPT AS THE PRD HAS IT
 *     returned (its "Return for Clarification"), rejected, cancellation_requested,
 *     cancelled, closed, draft.
 *
 *   ADDED
 *     on_hold — every other FMS in this portal has it, and without it a trip
 *               whose customer went quiet can only sit in a queue for ever.
 */
export type TripStatus =
  | "draft"
  | "awaiting_manager_approval"
  | "awaiting_director_approval"
  | "returned"
  | "rejected"
  | "awaiting_advance"
  | "awaiting_booking"
  | "booked"
  | "cancellation_requested"
  /**
   * The journey is off but the money is not.
   *
   * ⚠ IT SITS AT THE **CLAIM** STEP, AND THAT IS THE WHOLE POINT. §4.1 makes a
   *   cancellation charge reimbursable when the reason is business — the
   *   customer moved the meeting, the plant shut — and not when it is personal.
   *   A trip sent straight to `cancelled` would take those charges, and any
   *   outstanding advance, out of every queue and every report in the module.
   */
  | "cancelled_pending_claim"
  | "awaiting_claim_review"
  | "awaiting_finance_review"
  | "awaiting_settlement"
  | "closed"
  | "on_hold"
  | "cancelled";

/**
 * Statuses that still represent live work.
 *
 * ⚠ `on_hold` IS OPEN. A held trip is still the business's problem; hiding it is
 *   how a parked trip is never chased again. It is excluded from the QUEUES (it
 *   owes nobody an action today) but counted as open everywhere else, and it
 *   gets its own "Parked" strip on the Control Center.
 */
export const OPEN_STATUSES: TripStatus[] = [
  "draft",
  "awaiting_manager_approval",
  "awaiting_director_approval",
  "returned",
  "awaiting_advance",
  "awaiting_booking",
  "booked",
  "cancellation_requested",
  "cancelled_pending_claim",
  "awaiting_claim_review",
  "awaiting_finance_review",
  "awaiting_settlement",
  "on_hold",
];

/** The three endings. Mirrors `closed_statuses` in master_report_modules. */
export const CLOSED_STATUSES: TripStatus[] = ["closed", "cancelled", "rejected"];

/**
 * Which step a trip at this status is waiting on.
 *
 * Partial ON PURPOSE: a draft, a returned trip, a rejected one, a held one and a
 * cancelled one are at no step at all. `buildQueueEntries` reads this map and
 * skips anything it does not answer for, so adding a status without adding it
 * here makes that status invisible to the queues — which is the safe direction.
 */
export const STATUS_STEP: Partial<Record<TripStatus, StepKey>> = {
  awaiting_manager_approval: "manager_approval",
  awaiting_director_approval: "director_approval",
  awaiting_advance: "advance",
  awaiting_booking: "booking",
  // ⚠ A CANCELLATION REQUEST IS WORK THE DESK OWES, so it belongs to a step and
  //   shows on the Control Center. Without this it would sit at no step at all
  //   and nobody would be chased for it.
  cancellation_requested: "booking",
  booked: "claim",
  // Charges to claim, or an advance to recover — the traveller owes the claim
  // exactly as they would after a journey that happened.
  cancelled_pending_claim: "claim",
  awaiting_claim_review: "claim_review",
  awaiting_finance_review: "finance_review",
  awaiting_settlement: "settlement",
};

/**
 * The four travel categories the Domestic Travel Policy prices everything
 * against (§2). Every cap, rate and class rule is looked up by one of these
 * plus a city tier.
 *
 * ⚠ THE BAND → CATEGORY MAP IS **DATA**, NOT CODE, AND THAT IS NOT AN
 *   ABSTRACTION FOR ITS OWN SAKE. Section 2 of the policy contains TWO tables,
 *   one immediately after the other, that disagree:
 *
 *     table 1 (and Annexure A, and §14.1):  band 8 → TC-A,  band 3 → TC-D
 *     table 2 (and §4.1, §5.1, §6.2, §6.3,
 *              §7.2, §8.2, §10, §10.1):     band 8 → TC-B,  band 3 → TC-C
 *
 *   Live headcount puts 17 people in band 3 and 6 in band 8 — 23 of the 59 real
 *   employees, and band 3 is the field staff who travel most. This cannot be
 *   guessed, so it lives in the rate card as a `band_category` row where HR
 *   answers it once, with an effective date, and the answer is versioned like
 *   every other figure in the policy. Tracked as H1 in TRAVEL-DESK.md.
 */
export type TravelCategory = "TC-A" | "TC-B" | "TC-C" | "TC-D";

export const TRAVEL_CATEGORIES: { value: TravelCategory; label: string }[] = [
  { value: "TC-A", label: "TC-A · Executive" },
  { value: "TC-B", label: "TC-B · Senior Management" },
  { value: "TC-C", label: "TC-C · Management" },
  { value: "TC-D", label: "TC-D · Executive Staff" },
];

/** City tier (§1.3) — drives the hotel cap, the DA rate and the conveyance cap. */
export type CityTier = 1 | 2 | 3;

/** What a leg of the journey is. One trip may hold any number, of any mix. */
export type LegKind = "flight" | "train" | "bus" | "cab" | "hotel";

/** Declared intent at request time; the real shape is whatever the legs say. */
export type JourneyType = "one_way" | "round_trip" | "multi_city";

/**
 * The preferred departure window (PRD §8). Stored as a slot, not a time: the
 * traveller is expressing a preference for the booker, not booking a flight.
 */
export type TimeSlot = "morning" | "afternoon" | "evening" | "night";

export const TIME_SLOTS: { value: TimeSlot; label: string }[] = [
  { value: "morning", label: "Morning · 06:00–11:59" },
  { value: "afternoon", label: "Afternoon · 12:00–16:59" },
  { value: "evening", label: "Evening · 17:00–20:59" },
  { value: "night", label: "Night · 21:00–05:59" },
];

/**
 * One trip — the module's single entity, from the request to the settled claim.
 *
 * ⚠ THE `snap*` FIELDS ARE FROZEN AT SUBMIT AND MUST NEVER BE RECOMPUTED.
 *   A promotion between the trip and the claim must not re-price the trip, and
 *   January's rate revision must not rewrite last March's. This is the same
 *   doctrine as OCPI freezing the resolved document on each quotation version:
 *   a rule change may not rewrite history.
 *
 * The table lands in phase 3; this shape is the contract the store, the queues
 * and the Control Center are written against from phase 1, so all three are real
 * code seeing zero rows rather than stubs to be replaced.
 */
export interface Trip {
  id: string;
  tripNo: string | null;
  status: TripStatus;
  currentStep: StepKey | null;

  /** Who filed it (may be a coordinator acting for someone else). */
  raisedBy: string | null;
  /** Whose trip it is — whose band prices it and whose bank account is paid. */
  travellerId: string | null;
  travellerName: string;
  travellerEmployeeCode: string | null;

  // ---- frozen at submit ---------------------------------------------------
  snapBandNo: number | null;
  snapTravelCategory: TravelCategory | null;
  snapDepartmentId: string | null;
  snapDesignationId: string | null;
  snapBaseCityId: string | null;
  snapRateCardId: string | null;
  /**
   * The category this trip was frozen at before §3.5 downgraded it to TC-D for
   * being regularised late. Null on every trip that was not downgraded.
   *
   * ⚠ THE ORIGINAL IS KEPT, NOT OVERWRITTEN. Without it a band-9 Director sits
   *   silently on TC-D rates with nothing on the row to explain why.
   */
  tcDowngradedFrom: TravelCategory | null;
  tcDowngradedAt: string | null;
  /** The trip's own approvers, snapshotted from user_hods. May hold several. */
  approverManagerIds: string[];
  /** Whoever does not resolve to a portal login. */
  approverManagerNote: string | null;

  // ---- the journey --------------------------------------------------------
  purposeId: string | null;
  purposeOtherRemarks: string | null;
  destinationCityId: string | null;
  journeyType: JourneyType | null;
  preferredSlot: TimeSlot | null;
  plannedDepartureDate: string | null;
  plannedReturnDate: string | null;
  actualDepartureDate: string | null;
  actualReturnDate: string | null;
  /**
   * ⚠ TIMES, NOT TIMESTAMPS, AND ONLY THE ACTUAL ONES. §8.1 turns on the hour
   *   a traveller left and the hour they got back — the 2 PM cut-off and the
   *   6 PM return — so the daily allowance cannot be computed without them.
   *   They are deliberately absent from the PLANNED pair: nobody knows in
   *   advance what time they will actually walk back through the door, and a
   *   planned time used as an actual one is a guess priced as a fact.
   */
  actualDepartureTime: string | null;
  actualReturnTime: string | null;

  // ---- the four daily-allowance inputs only the traveller knows ----------
  /**
   * §8.3 — what the customer supplied: nothing, meals, room, or both.
   *
   * ⚠ MEALS CUT THE ALLOWANCE; A ROOM ON ITS OWN DOES NOT. The daily
   *   allowance is for food and incidentals, and the hotel is claimed
   *   separately against its own cap — so a customer providing a room changes
   *   nothing here. Meals halve it; meals AND a room take it to a quarter.
   */
  customerProvided: "meals" | "room" | "both" | null;
  /**
   * §13 — a company conference pays 50%, which OVERRIDES §8.1's "no DA when
   * all meals are arranged". The narrower rule wins.
   */
  isCompanyConference: boolean;
  /**
   * §14.1 — family present for more than 15 consecutive days cuts the
   * allowance by 25%, for bands below the exempt threshold. Keyed on the BAND
   * NUMBER, not the travel category, so it does not wait on H1.
   */
  familyJoinedFrom: string | null;
  familyJoinedTo: string | null;
  accommodationRequired: boolean;
  estimatedCost: number | null;
  isEmergency: boolean;
  emergencyReason: string | null;

  // ---- skipped steps ------------------------------------------------------
  /**
   * ⚠ A SKIPPED STEP MUST READ AS SKIPPED, NOT AS FOREVER-PENDING.
   *   20260905120000 (General Purchase) documents three real defects that a
   *   skipped step caused when this flag was missing: an approver could
   *   "correct" a decision never made, resuming a held request rerouted it to
   *   the step it had skipped, and the notification pointed at a queue the
   *   recipient could not open. All three are tested in phase 4.
   */
  directorApprovalSkipped: boolean;
  advanceSkipped: boolean;
  /**
   * The approval matrix sent this band straight to a Director.
   *
   * ⚠ OFF ON EVERY TRIP TODAY, and kept anyway. §3.2 sends bands 6-9 to a
   *   Director and then leaves "[⚠ CONFIRM if HOD is also needed]" hanging for
   *   bands 6-8 (H10). The default answer is that BOTH are needed, so nothing
   *   sets this yet — but answering H10 the other way must be a setting, not a
   *   migration, and a flag that only appears once somebody flips a switch is a
   *   flag the rail and the guards will have forgotten to handle.
   */
  managerApprovalSkipped: boolean;

  // ---- the advance (§11.1) ------------------------------------------------
  advanceRequested: boolean;
  advanceRequestedAmount: number | null;
  advanceApprovedAmount: number | null;
  advancePaidAmount: number | null;
  advancePaidAt: string | null;
  advancePaidRef: string | null;
  advancePaidMode: string | null;
  /** Finance's note when the approved figure differs from what was asked for. */
  advNote: string | null;
  /**
   * Advance handed back rather than netted against a claim.
   *
   * ⚠ THE CANCELLED-TRIP CASE, AND THE REASON IT EXISTS. The money left, the
   *   trip never happened, and no claim is coming to net it against — so without
   *   a way to record repayment, §11.2 would bar that person from every future
   *   advance for ever.
   */
  advanceRecoveredAmount: number | null;
  advanceRecoveredAt: string | null;
  advanceRecoveredRef: string | null;

  // ---- money --------------------------------------------------------------
  bookingTotal: number | null;
  claimTotal: number | null;
  daTotal: number | null;
  disallowedTotal: number | null;
  netPayable: number | null;
  /**
   * What moved at settlement, SIGNED.
   *
   * ⚠ POSITIVE WAS PAID OUT; NEGATIVE CAME BACK. Storing the sign is what
   *   lets one register answer "what did travel cost this month" without a
   *   second table for recoveries.
   */
  settledAmount: number | null;
  settledAt: string | null;
  settledRef: string | null;
  settledMode: string | null;
  settledNote: string | null;
  /** Finance's note when it closed the verification step. */
  frNote: string | null;

  // ---- per-step stamps ----------------------------------------------------
  submittedAt: string | null;
  maAt: string | null; maBy: string | null; maDecision: string | null; maNote: string | null;
  daAt: string | null; daBy: string | null; daDecision: string | null; daNote: string | null;
  advAt: string | null; advBy: string | null;
  bkAt: string | null; bkBy: string | null;
  clAt: string | null; clBy: string | null;
  crAt: string | null; crBy: string | null; crDecision: string | null; crNote: string | null;
  frAt: string | null; frBy: string | null;
  stAt: string | null; stBy: string | null;

  // ---- lifecycle ----------------------------------------------------------
  returnedAt: string | null;
  returnedStage: string | null;
  returnedReason: string | null;
  rejectedAt: string | null;
  rejectedStage: string | null;
  rejectReason: string | null;
  holdAt: string | null;
  holdReason: string | null;
  holdFromStatus: TripStatus | null;
  cancelledAt: string | null;
  cancelReason: string | null;

  /**
   * ⚠ `edited*`, NOT `updated*`. `updatedAt` is maintained by a trigger that
   *   fires on EVERY row touch, including the workflow's own writes, so it
   *   answers "when did anything happen" — never "did a human correct this".
   */
  editedAt: string | null;
  editedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Module settings, read from fms_travel_config. */
/**
 * Who is currently holding one step of one trip.
 *
 * ⚠ Deliberately SEPARATE from Trip.approverManagerIds, which is a WRITE-ONCE
 *   snapshot taken when the trip was raised so a re-org cannot silently re-route
 *   a trip somebody is already waiting on (20261005120700). An assignee replaces
 *   who OWES the step without disturbing who the trip was raised against - which
 *   is also how a hand-back knows where to return it.
 */
export interface TravelStepAssignee {
  tripId: string;
  stepKey: string;
  assignedTo: string;
  assignedBy: string | null;
  assignedAt: string;
  note: string | null;
}

export interface TravelConfig {
  stepSla: Record<string, unknown> | null;
  processCoordinators: string[];
  approvalMatrix: ApprovalMatrix;
  policy: TravelPolicyConfig;
  companyIdentity: { legalName: string; gstin: string; address: string };
  /** Departments the Setup picker filters candidates by. A UI FILTER - grants nothing. */
  reassignPoolDepartmentIds: string[];
  /** Everyone who may be handed a STEP of a trip. The authority. */
  reassignPoolUserIds: string[];
}

/**
 * Which bands need which approvals (§3.2).
 *
 * ⚠ `managerAlsoForDirectorBands` IS H10. §3.2 sends bands 6-9 to a Director
 *   and then writes "[⚠ CONFIRM if HOD is also needed]" for bands 6-8. The
 *   default is BOTH — the reading that cannot silently lose an approval nobody
 *   meant to drop — and answering it the other way is a setting rather than a
 *   deploy. Mirrored in SQL by fms_travel_approval_matrix().
 */
export interface ApprovalMatrix {
  /** Bands at or above this also need a Director. */
  directorFromBand: number;
  /** Do those bands still need their reporting manager first? */
  managerAlsoForDirectorBands: boolean;
}

/**
 * The numeric rules that are NOT rates. Every one is a figure from the policy,
 * every one editable in Settings — because "within 30 days" and "5 working days"
 * are exactly the kind of number that changes by memo and would otherwise need a
 * deploy.
 */
export interface TravelPolicyConfig {
  maxPassengers: number;
  bookingWindowDays: number;
  advanceBookingWarnDays: number;
  claimDeadlineDays: number;
  claimHardStopDays: number;
  advanceMaxPct: number;
  advanceRecoveryDays: number;
  hodReviewDays: number;
  financeProcessDays: number;
  creditDays: number;
  disputeThreshold: number;
  hotelCapHardMultiple: number;
  emergencyWindowHours: number;
}

/** Owners assigned to one workflow step. */
export interface TravelStepOwner {
  stepKey: StepKey;
  departmentIds: string[];
  designationId: string | null;
  employeeIds: string[];
}

/** A person's standing travel defaults (fms_travel_employee_settings). */
export interface TravelEmployeeSettings {
  userId: string;
  baseCityId: string | null;
  seatPreference: string | null;
  mealPreference: string | null;
  frequentFlyerNo: string | null;
}

export interface TravelNotification {
  id: string;
  type: string;
  entityType: string;
  entityId: string;
  text: string;
  actorId: string | null;
  readAt: string | null;
  createdAt: string;
}

// ===========================================================================
// MASTERS (phase 2)
// ===========================================================================

/**
 * The lists Travel Desk owns.
 *
 * ⚠ `rate_card` IS OWNABLE BUT NOT REQUESTABLE. Somebody can be made keeper of
 *   the rate card without being a portal administrator, but nobody "requests" a
 *   rate — a rate is decided, not asked for. That is why the requestable subset
 *   below is narrower.
 */
export type TravelMasterType =
  | "city"
  | "purpose"
  | "expense_category"
  | "airline"
  | "hotel"
  | "bus_operator"
  | "rate_card";

/** The subset a person may raise a request against. */
export type TravelRequestableMaster = Exclude<TravelMasterType, "rate_card">;

export const TRAVEL_MASTER_TYPES: {
  value: TravelMasterType;
  label: string;
  plural: string;
  requestable: boolean;
}[] = [
  { value: "city",             label: "City",             plural: "Cities",             requestable: true },
  { value: "purpose",          label: "Purpose",          plural: "Purposes",           requestable: true },
  { value: "expense_category", label: "Expense category", plural: "Expense categories", requestable: true },
  { value: "airline",          label: "Airline",          plural: "Airlines",           requestable: true },
  { value: "hotel",            label: "Hotel",            plural: "Hotels",             requestable: true },
  { value: "bus_operator",     label: "Bus operator",     plural: "Bus operators",      requestable: true },
  { value: "rate_card",        label: "Rate card",        plural: "Rate cards",         requestable: false },
];

export const REQUESTABLE_MASTERS: TravelRequestableMaster[] = TRAVEL_MASTER_TYPES
  .filter((m) => m.requestable)
  .map((m) => m.value as TravelRequestableMaster);

/** Everything a MasterCrud row must carry. */
export interface TravelNamedMaster {
  id: string;
  name: string;
  active: boolean;
  sortOrder: number;
}

export interface TravelCity extends TravelNamedMaster {
  state: string | null;
  /** 1, 2 or 3 — what prices the hotel cap, the DA and the conveyance cap. */
  tier: CityTier;
}

export interface TravelPurpose extends TravelNamedMaster {
  requiresRemarks: boolean;
}

export type ExpenseCategoryKind =
  | "transport" | "transfer" | "hotel" | "conveyance"
  | "meal" | "mileage" | "fee" | "misc" | "non_reimbursable";

export const EXPENSE_KIND_LABEL: Record<ExpenseCategoryKind, string> = {
  transport: "Transport",
  transfer: "Transfer",
  hotel: "Hotel",
  conveyance: "Local conveyance",
  meal: "Meal",
  mileage: "Own vehicle",
  fee: "Fee",
  misc: "Miscellaneous",
  non_reimbursable: "Not reimbursable",
};

export interface TravelExpenseCategory extends TravelNamedMaster {
  kind: ExpenseCategoryKind;
  /** false for every Section 15 row — the category itself refuses. */
  reimbursable: boolean;
  /** Null means a receipt is ALWAYS required (air, train, hotel). */
  receiptRequiredAbove: number | null;
  /** Null means none allowed, or the limit varies by band and lives on the card. */
  selfDeclarationCap: number | null;
  needsGuestDetails: boolean;
  /** Why the company will not pay, printed beside the line. */
  refusalNote: string | null;
}

export interface TravelHotel extends TravelNamedMaster {
  cityId: string | null;
}

export interface TravelMasterManager {
  id: string;
  masterType: TravelMasterType;
  managerUserId: string;
}

export interface TravelMasterRequest {
  id: string;
  masterType: TravelRequestableMaster;
  proposedPayload: Record<string, unknown>;
  status: "pending" | "approved" | "rejected";
  requestedBy: string | null;
  reviewedBy: string | null;
  reviewNote: string | null;
  resolvedMasterId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ===========================================================================
// RATE CARDS (phase 2)
// ===========================================================================

export type RateCardStatus = "draft" | "confirmed" | "superseded";

/**
 * One dated version of the whole policy.
 *
 * `draft`      — prices everything, but caps only ADVISE.
 * `confirmed`  — caps ENFORCE.
 * `superseded` — a later card took over, but trips frozen against this one still
 *                resolve against it, and it still enforces for them.
 */
export interface TravelRateCard {
  id: string;
  label: string;
  effectiveFrom: string;
  status: RateCardStatus;
  confirmedBy: string | null;
  confirmedAt: string | null;
  notes: string | null;
  createdAt: string;
}

export type RateType =
  | "band_category"
  | "hotel_cap"
  | "da"
  | "conveyance_cap"
  | "conveyance_self_dec"
  | "mileage"
  | "meal_cap"
  | "rental_cap"
  | "air_entitlement"
  | "train_entitlement"
  | "road_entitlement";

/**
 * Every figure the policy prices travel with.
 *
 * A NULL `travelCategory` or `cityTier` means the figure does not vary on that
 * axis — one row rather than twelve.
 */
export interface TravelRate {
  id: string;
  rateCardId: string;
  rateType: RateType;
  travelCategory: TravelCategory | null;
  cityTier: CityTier | null;
  key: string | null;
  amount: number | null;
  textValue: string | null;
  /**
   * ⚠ THE SOURCE POLICY GIVES TWO DIFFERENT ANSWERS FOR THIS FIGURE.
   *   A card cannot be confirmed while any row carries this, so the
   *   contradiction has to be decided rather than inherited.
   */
  disputed: boolean;
  notes: string | null;
  sortOrder: number;
}

/** How each rate type is titled, explained and shaped on the Rate Cards screen. */
export const RATE_TYPE_META: Record<
  RateType,
  { label: string; blurb: string; unit: "money" | "number" | "text"; byTier: boolean; keyed: boolean }
> = {
  band_category: {
    label: "Band → travel category",
    blurb:
      "Which of the four travel categories each of the nine bands falls into. Every other figure on this card is looked up by the answer.",
    unit: "text", byTier: false, keyed: true,
  },
  hotel_cap: {
    label: "Hotel cap",
    blurb:
      "Per night including GST (§7.2). An over-cap night needs evidence the cap was unavailable plus HOD approval, and can never exceed 1.5× regardless.",
    unit: "money", byTier: true, keyed: false,
  },
  da: {
    label: "Daily allowance",
    blurb:
      "Per calendar day away from the base city (§8). Paid without receipts, and reduced when the customer provides meals or a room.",
    unit: "money", byTier: false, keyed: false,
  },
  conveyance_cap: {
    label: "Local conveyance cap",
    blurb:
      "Per day at the destination (§10), separate from the daily allowance. An empty cell means uncapped — actuals with a receipt.",
    unit: "money", byTier: true, keyed: false,
  },
  conveyance_self_dec: {
    label: "Conveyance without a receipt",
    blurb:
      "Per trip, self-declared (§10). Only TC-C and TC-D have one; the others are actuals with a receipt.",
    unit: "money", byTier: false, keyed: true,
  },
  mileage: {
    label: "Own vehicle, per km",
    blurb:
      "Paid against a mileage log with start and end odometer readings (§6.3). HOD approval is required before travel.",
    unit: "money", byTier: false, keyed: true,
  },
  meal_cap: {
    label: "Meal caps",
    blurb:
      "Business meals with guests, team meals per person, refreshments and the late-night meal (§9). Alcohol is never reimbursable at any band.",
    unit: "money", byTier: false, keyed: true,
  },
  rental_cap: {
    label: "Full-day vehicle hire",
    blurb:
      "Including driver (§10.1), for a day spent moving between customers. Pre-approved by the HOD.",
    unit: "money", byTier: false, keyed: false,
  },
  air_entitlement: {
    label: "Air travel",
    blurb:
      "Class, fare type and upgrade rule by category (§4.1), plus the distance and duration tests that decide whether flying is permitted at all.",
    unit: "text", byTier: false, keyed: true,
  },
  train_entitlement: {
    label: "Train travel",
    blurb: "Class, overnight berth and whether Tatkal is reimbursed (§5.1).",
    unit: "text", byTier: false, keyed: true,
  },
  road_entitlement: {
    label: "Road travel",
    blurb:
      "The class of cab each category may take (§6.2), and the distance beyond which a personal vehicle needs Director approval.",
    unit: "text", byTier: false, keyed: true,
  },
};

export const RATE_TYPE_ORDER: RateType[] = [
  "band_category", "hotel_cap", "da", "conveyance_cap", "conveyance_self_dec",
  "mileage", "meal_cap", "rental_cap",
  "air_entitlement", "train_entitlement", "road_entitlement",
];

/**
 * One name on the ticket.
 *
 * ⚠ A PASSENGER IS NOT A CLAIMANT. The trip has ONE traveller — whose band
 *   prices it and whose account is paid — and any number of passengers, who
 *   exist because an airline needs a name, a gender and a date of birth for
 *   everybody on the booking. A second employee who also needs to claim raises
 *   their own trip; §11 of the policy is entirely per-employee, so a shared
 *   claim has nobody to pay.
 *
 * `employeeId` is nullable on purpose: a customer or a spouse travelling
 * alongside is a passenger and will never be a portal user.
 */
/**
 * One booked leg — a flight, train, bus, cab or hotel.
 *
 * ⚠ `startOn` / `endOn` ARE NEUTRAL ON PURPOSE. They are departure and arrival
 *   on transport, and check-in and check-out on a hotel. Five kinds with their
 *   own column pairs would be five sets of nulls on every row, and five places
 *   for the money engine to look for "how many nights was this".
 */
export interface TripLeg {
  id: string;
  tripId: string;
  kind: LegKind;
  direction: LegDirection;
  fromCityId: string | null;
  toCityId: string | null;
  startOn: string | null;
  startTime: string | null;
  endOn: string | null;
  endTime: string | null;
  airlineId: string | null;
  hotelId: string | null;
  busOperatorId: string | null;
  carrierOther: string | null;
  bookingRef: string | null;
  travelClass: string | null;
  ticketCost: number;
  otherCharges: number;
  refundAmount: number;
  /**
   * ⚠ GENERATED IN THE DATABASE — ticket + other − refund. Never computed here,
   *   because a definition that lives in two places eventually disagrees with
   *   itself, and this one is what the trip's booking_total sums.
   */
  netCost: number;
  cancelledAt: string | null;
  /** §4.1 — business or personal decides whether the charge is reimbursable. */
  cancelReasonKind: "business" | "personal" | null;
  cancelReason: string | null;
  docPath: string | null;
  /**
   * What the extractor read, verbatim.
   *
   * ⚠ EVIDENCE, NOT DATA. Every typed field above was confirmed by a human;
   *   this is the machine's unedited reading, kept so a later dispute can see
   *   what the document actually said. Nothing reads it to make a decision.
   */
  aiExtracted: Record<string, unknown> | null;
  notes: string | null;
  sortOrder: number;
  createdAt: string;
}

export type LegDirection = "outbound" | "return" | "local";

/** What the booking form sends. Money arrives as text — see travelBookingWrites. */
export interface TripLegInput {
  kind: LegKind;
  direction: LegDirection;
  fromCityId: string | null;
  toCityId: string | null;
  startOn: string | null;
  startTime: string | null;
  endOn: string | null;
  endTime: string | null;
  airlineId: string | null;
  hotelId: string | null;
  busOperatorId: string | null;
  carrierOther: string | null;
  bookingRef: string | null;
  travelClass: string | null;
  ticketCost: number | null;
  otherCharges: number | null;
  refundAmount: number | null;
  docPath: string | null;
  notes: string | null;
  aiExtracted?: Record<string, unknown> | null;
}

export interface TripPassenger {
  id: string;
  tripId: string;
  employeeId: string | null;
  fullName: string;
  gender: "male" | "female" | "other" | null;
  dateOfBirth: string | null;
  mobile: string | null;
  email: string | null;
  isPrimary: boolean;
  sortOrder: number;
}

/**
 * One line on an expense claim.
 *
 * ⚠ IT CARRIES EVERY INPUT THE ENGINE READ, not just the amount. Nights,
 *   persons, kilometres, whether a receipt exists, whether §7.3 evidence and HOD
 *   approval were produced — all of it, so the line can be re-priced later and
 *   the answer explained. A row storing only "4,200" is a row nobody can audit.
 *
 * ⚠ `capApplied`, `allowedAmount`, `disallowReason` AND `engineNote` ARE THE
 *   SERVER'S ANSWER. `fms_travel_price_claim` writes them at submit and
 *   `save_claim_draft` ignores them on the way in, however hard a caller tries.
 *   Nothing in the browser may decide what the company reimburses.
 */
export interface ClaimLine {
  id: string;
  tripId: string;
  categoryId: string | null;
  /**
   * ⚠ THE HOTEL CAP IS PER NIGHT **PER CITY** (§7.2), so a multi-city trip
   *   prices each night on the tier of the city it was spent in — not on the
   *   trip's headline destination. Null falls back to wherever the traveller was
   *   that day, which the engine reads off the legs.
   */
  cityId: string | null;
  spentOn: string | null;
  description: string | null;
  amount: number;
  gstAmount: number;
  vendor: string | null;
  gstin: string | null;
  invoiceNo: string | null;

  hasReceipt: boolean;
  selfDeclared: boolean;
  nights: number | null;
  persons: number | null;
  days: number | null;
  km: number | null;
  /** ⚠ Named exactly as the engine's JSON key. One word, one meaning, both ends. */
  guests: string | null;
  mealKind: string | null;
  vehicleType: string | null;
  fullDayRental: boolean;
  /**
   * §7.3 — going above the hotel cap needs BOTH: evidence that nothing within
   * cap was available, and HOD approval. Two flags, because producing one
   * without the other is the common case and the engine has to say which is
   * missing.
   */
  overCapEvidence: boolean;
  hodApproved: boolean;
  /** §11.3 — a claim past the hard stop needs written Director approval. */
  directorApproved: boolean;

  docPath: string | null;
  /** The extractor's unedited reading, kept as EVIDENCE beside the typed fields. */
  aiExtracted: Record<string, unknown> | null;

  capApplied: number | null;
  allowedAmount: number | null;
  disallowReason: string | null;
  engineNote: string | null;
  pricedAt: string | null;

  /**
   * What FINANCE settled this line at, which may differ from the engine's
   * `allowedAmount` in either direction.
   *
   * ⚠ IT SITS BESIDE THE ENGINE'S ANSWER, NEVER ON TOP OF IT. Null means
   *   Finance did not touch the line. The GAP between the two is the Policy
   *   Exceptions report, so overwriting `allowedAmount` would destroy the only
   *   evidence that an exception was ever made.
   */
  financeAmount: number | null;
  financeReason: string | null;
  financeBy: string | null;
  financeAt: string | null;

  sortOrder: number;
  createdAt: string;
}

/**
 * A claim line as the form holds it.
 *
 * ⚠ `key` IS THE ON-SCREEN IDENTITY AND `id` IS THE STORED ONE. A line the
 *   traveller has just added has a key and no id; the live preview is keyed on
 *   whichever exists, so a cap can be shown against a row that has never been
 *   saved. See `travelClaimWrites` for why the two RPCs need different ones.
 */
export interface ClaimLineInput {
  key: string;
  id?: string | null;
  categoryId: string | null;
  cityId: string | null;
  spentOn: string | null;
  description: string | null;
  amount: number | null;
  gstAmount: number | null;
  vendor: string | null;
  gstin: string | null;
  invoiceNo: string | null;
  hasReceipt: boolean;
  selfDeclared: boolean;
  nights: number | null;
  persons: number | null;
  days: number | null;
  km: number | null;
  guests: string | null;
  mealKind: string | null;
  vehicleType: string | null;
  fullDayRental: boolean;
  overCapEvidence: boolean;
  hodApproved: boolean;
  directorApproved: boolean;
  docPath: string | null;
  aiExtracted?: Record<string, unknown> | null;
}

/**
 * One frozen day of daily allowance.
 *
 * ⚠ EVERY DAY CARRIES ITS OWN REASON. A day showing 250 instead of 1,000 says
 *   why on its own row, so nobody has to re-derive the engine to check one
 *   figure — and so a correction to H2 becomes a recompute with a visible diff
 *   rather than a migration.
 */
export interface DaDay {
  id: string;
  tripId: string;
  day: string;
  cityId: string | null;
  cityTier: number | null;
  daRate: number;
  factor: number;
  factorReason: string | null;
  amount: number;
  /**
   * Finance may overrule a day, and a CHECK makes it impossible to do so without
   * saying why. A recompute CARRIES THE OVERRIDE FORWARD — it is a human
   * judgement the engine cannot reproduce.
   */
  overrideAmount: number | null;
  overrideReason: string | null;
  overrideBy: string | null;
  overrideAt: string | null;
}

/** One row of what the money engine returned for a claim line. */
export interface ClaimPreviewLine {
  line_id: string;
  category_id: string | null;
  category_name: string | null;
  claimed: number;
  allowed: number;
  cap_applied: number | null;
  disallowed: number;
  disallow_reason: string | null;
  note: string | null;
}

/**
 * §16 — what a leg booked above the band entitlement costs the traveller.
 *
 * ⚠ `entitledFare` IS OFTEN NULL, AND THAT IS NOT A BUG. The rate card holds the
 *   entitled CLASS as words — "Economy — Saver fare" — not as a price, so there
 *   is nothing to cap against until somebody records what the compliant option
 *   would have cost. The engine says so plainly rather than inventing the size
 *   of a deduction from somebody's pay.
 */
export interface ClassExcessRow {
  leg_id: string;
  kind: string;
  booked_class: string | null;
  entitled_class: string | null;
  net_cost: number;
  entitled_fare: number | null;
  personal_excess: number;
  note: string | null;
}

/**
 * The whole server-computed answer, in one round trip.
 *
 * ⚠ THERE IS NO TYPESCRIPT COPY OF ANY OF THIS. The shape is the engine's and so
 *   are the figures. A deliberate divergence from the OCPI pattern, which keeps
 *   two copies of its branch rules in step by hand — acceptable for a branch,
 *   not for money.
 */
export interface ClaimPreview {
  lines: ClaimPreviewLine[];
  da: {
    day: string;
    city_id: string | null;
    city_tier: number | null;
    da_rate: number;
    factor: number;
    factor_reason: string | null;
    amount: number;
  }[];
  class_excess: ClassExcessRow[];
  totals: {
    claimed: number;
    allowed: number;
    disallowed: number;
    da: number;
    personal_excess: number;
    advance_paid: number;
    /**
     * ⚠ NEGATIVE MEANS THE TRAVELLER OWES MONEY BACK, and it stays negative.
     *   Flooring it at zero would hide exactly the figure §11.2 and the hr-exit
     *   `travel_advance` clearance row exist to read.
     */
    net_payable: number;
  };
  rate_card: string | null;
  travel_category: string | null;
}

/** What the traveller records about the journey that actually happened. */
export interface ActualTravelInput {
  actualDepartureDate: string | null;
  actualReturnDate: string | null;
  actualDepartureTime: string | null;
  actualReturnTime: string | null;
  customerProvided: "meals" | "room" | "both" | null;
  isCompanyConference: boolean;
  familyJoinedFrom: string | null;
  familyJoinedTo: string | null;
}

/** What settlement records — the evidence that money actually moved. */
export interface SettlementInput {
  /**
   * ⚠ ALWAYS POSITIVE. Whether this is a payment or a recovery is decided by the
   *   claim, not by a minus sign somebody types. The RPC refuses a negative
   *   figure and picks the branch from `netPayable`.
   */
  amount: number | null;
  paidOn: string | null;
  mode: string | null;
  /** The UTR, cheque number, voucher or payroll run it can be traced to. */
  reference: string | null;
  /** Required when the figure recorded differs from what the claim settles at. */
  note: string | null;
}

/**
 * One entry on a trip's timeline — a workflow event or a human comment.
 *
 * ⚠ THE CONVERSATION AND THE HISTORY ARE ONE LIST, deliberately. "The Director
 *   asked why economy was not available" and "the Director approved it" belong
 *   in order on the same timeline, or a reader has to interleave two lists by
 *   hand to work out what happened. A comment is simply `type = 'comment'`.
 */
export interface TravelActivity {
  id: string;
  entityType: string;
  entityId: string;
  type: string;
  actorId: string | null;
  note: string | null;
  meta: {
    mentions?: string[];
    attachments?: { path: string; name?: string }[];
    [k: string]: unknown;
  };
  createdAt: string;
}

/** What the comment box sends. */
export interface CommentInput {
  text: string;
  mentions: string[];
  attachments: { path: string; name?: string }[];
}
