import { supabase } from "@/core/platform/supabase";
// fms_travel_* tables are not in the generated Database types; route table and
// rpc calls through an untyped alias (the row mappers below already treat rows
// as any). This is the standing FMS convention — see ocpi/data/ocpiFetch.ts and
// order-to-dispatch/data/dispatchFetch.ts. Regenerating database.types.ts is a
// separate, overdue chore; it is already stale for several modules and nothing
// here should wait on it.
const db = supabase as any;

import type {
  Trip, TravelConfig, TravelPolicyConfig, TravelStepAssignee, TravelStepOwner,
  TravelEmployeeSettings, TravelNotification,
  TravelCity, TravelPurpose, TravelExpenseCategory, TravelHotel, TravelNamedMaster,
  TravelMasterManager, TravelMasterRequest, TravelRateCard, TravelRate,
  TravelMasterType, TravelRequestableMaster, CityTier, ExpenseCategoryKind,
  RateType, RateCardStatus, TravelCategory, ApprovalMatrix,
  TripPassenger, TripStatus, JourneyType, TimeSlot, TripLeg, LegKind, LegDirection,
  ClaimLine,
  DaDay,
  TravelActivity,
} from "../types";
import type { StepKey } from "../lib/steps";
import type { StepSla } from "../lib/sla";

/**
 * A stored step_sla map as it comes OUT of the config table: every key optional,
 * every field optional, no promise that the step names still exist. Typed this
 * loosely on purpose — the strictness belongs in `resolveStepSla`, which merges
 * it over the defaults and drops what it cannot use.
 */
export type StoredStepSla = Partial<Record<string, Partial<StepSla>>>;

/**
 * Travel Desk read layer. One paginated pass over the module's tables, mapped
 * snake_case → camelCase, so the pure queue rules (lib/queues.ts) get plain data
 * and the Control Center adapter can reuse this exact react-query cache entry.
 *
 * ⚠ Every `.range()` is paired with an `.order()`. Postgres makes no ordering
 *   promise without one, so paging an unordered relation can return the same row
 *   on two pages and drop another entirely.
 *
 * ⚠ TRIPS ARE ORDERED BY `created_at`, NOT BY `trip_no`. A draft has no number
 *   at all — numbers are minted on submit — so ordering by it would page the
 *   drafts unpredictably and, since `.range()` needs a total order, could drop
 *   one. Every screen sorts for itself anyway; this ordering exists only to make
 *   paging safe.
 */

const PAGE = 1000;

type Tbl =
  | "fms_travel_trips"
  | "fms_travel_passengers"
  | "fms_travel_legs"
  | "fms_travel_step_owners"
  | "fms_travel_step_assignees"
  | "fms_travel_config"
  | "fms_travel_employee_settings"
  | "fms_travel_notifications"
  | "fms_travel_cities"
  | "fms_travel_purposes"
  | "fms_travel_expense_categories"
  | "fms_travel_airlines"
  | "fms_travel_hotels"
  | "fms_travel_bus_operators"
  | "fms_travel_rate_cards"
  | "fms_travel_rates"
  | "fms_travel_master_managers"
  | "fms_travel_master_requests"
  | "fms_travel_claim_lines"
  | "fms_travel_da_days";

async function fetchAll(table: Tbl, orderBy = "created_at"): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from(table)
      .select("*")
      .order(orderBy, { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** The react-query key. Keyed on the REAL session user id, shared with the adapter. */
export const TRAVEL_QK = ["travelDeskData"] as const;
export const travelQueryKey = (userId: string | null) => [...TRAVEL_QK, userId] as const;

export interface TravelData {
  trips: Trip[];
  /**
   * Every passenger on every visible trip, in one read.
   *
   * ⚠ NOT FETCHED PER TRIP. The detail screen would otherwise fire a second
   *   query on open, which is a spinner on a screen that has already loaded and
   *   a second cache entry that can disagree with the first. The whole table is
   *   at most five rows per trip and rides in the snapshot.
   */
  passengers: TripPassenger[];
  /** Every booked leg on every visible trip, in the same snapshot. */
  legs: TripLeg[];
  stepOwners: TravelStepOwner[];
  stepAssignees: TravelStepAssignee[];
  config: TravelConfig;
  /**
   * The RAW `step_sla` config value, unmerged.
   *
   * ⚠ DELIBERATELY NOT RESOLVED HERE. The defaults live in lib/sla.ts, which
   *   knows the step list; merging in the data layer would put a second copy of
   *   them behind the fetch, and a stored map naming a since-renamed step would
   *   have nowhere sane to be dropped.
   */
  stepSla: StoredStepSla | null;
  employeeSettings: TravelEmployeeSettings[];
  notifications: TravelNotification[];

  // ---- masters (phase 2) --------------------------------------------------
  //
  // ⚠ FETCHED IN THE SAME SNAPSHOT AS EVERYTHING ELSE, unlike OCPI's customer
  //   master. OCPI splits mst_parties onto its own query key because it holds
  //   ~1,900 slow-changing rows that must not be re-fetched every time a deal is
  //   saved. These lists are two orders of magnitude smaller — 36 cities, 25
  //   expense categories, ~90 rate rows — and the trip form needs all of them at
  //   once, so a second cache entry would buy nothing and add a way for the two
  //   to disagree.
  cities: TravelCity[];
  purposes: TravelPurpose[];
  expenseCategories: TravelExpenseCategory[];
  airlines: TravelNamedMaster[];
  hotels: TravelHotel[];
  busOperators: TravelNamedMaster[];

  // ---- the policy, as data ------------------------------------------------
  rateCards: TravelRateCard[];
  rates: TravelRate[];

  masterManagers: TravelMasterManager[];
  masterRequests: TravelMasterRequest[];

  // ---- the claim (phase 8) ------------------------------------------------
  //
  // Same snapshot, same reasoning as passengers and legs: a handful of rows per
  // trip, and the detail screen needs them the moment it opens.
  claimLines: ClaimLine[];
  /**
   * The FROZEN daily allowance, written at claim submit.
   *
   * ⚠ NOT THE COMPUTED ONE. `fms_travel_compute_da` is pure and can be asked at
   *   any time — the live preview does exactly that — but these rows are what
   *   was actually agreed, and a later change to the rate card or to H2 must not
   *   silently rewrite a settled trip.
   */
  daDays: DaDay[];
}

/**
 * Policy defaults, used only when the config row is missing or a key was added
 * after it was written.
 *
 * ⚠ THESE ARE A FLOOR, NOT THE SOURCE OF TRUTH. The database row installed by
 *   20261005120000 is what the module runs on and what Settings edits; these
 *   exist so a fresh environment, or a key added in a later phase, does not
 *   render `NaN` in a form. Keep them in step with that migration.
 */
const POLICY_DEFAULTS: TravelPolicyConfig = {
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
};

const num = (v: unknown, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");

function mapPolicy(raw: any): TravelPolicyConfig {
  const p = raw ?? {};
  return {
    maxPassengers: num(p.max_passengers, POLICY_DEFAULTS.maxPassengers),
    bookingWindowDays: num(p.booking_window_days, POLICY_DEFAULTS.bookingWindowDays),
    advanceBookingWarnDays: num(p.advance_booking_warn_days, POLICY_DEFAULTS.advanceBookingWarnDays),
    claimDeadlineDays: num(p.claim_deadline_days, POLICY_DEFAULTS.claimDeadlineDays),
    claimHardStopDays: num(p.claim_hard_stop_days, POLICY_DEFAULTS.claimHardStopDays),
    advanceMaxPct: num(p.advance_max_pct, POLICY_DEFAULTS.advanceMaxPct),
    advanceRecoveryDays: num(p.advance_recovery_days, POLICY_DEFAULTS.advanceRecoveryDays),
    hodReviewDays: num(p.hod_review_days, POLICY_DEFAULTS.hodReviewDays),
    financeProcessDays: num(p.finance_process_days, POLICY_DEFAULTS.financeProcessDays),
    creditDays: num(p.credit_days, POLICY_DEFAULTS.creditDays),
    disputeThreshold: num(p.dispute_threshold, POLICY_DEFAULTS.disputeThreshold),
    hotelCapHardMultiple: num(p.hotel_cap_hard_multiple, POLICY_DEFAULTS.hotelCapHardMultiple),
    emergencyWindowHours: num(p.emergency_window_hours, POLICY_DEFAULTS.emergencyWindowHours),
  };
}

/**
 * The approval matrix, with §3.2's own answer as the floor.
 *
 * ⚠ THE FALLBACK IS "BOTH", NOT "EITHER". A missing or malformed config row must
 *   not quietly drop an approval: the safe direction on a spending control is
 *   always the extra signature, never the missing one. Mirrored in SQL by
 *   fms_travel_approval_matrix(), whose COALESCE says the same thing.
 */
function mapMatrix(raw: any): ApprovalMatrix {
  const m = raw ?? {};
  return {
    directorFromBand: num(m.director_from_band, 6),
    managerAlsoForDirectorBands: m.manager_also_for_director_bands !== false,
  };
}

const mapStepAssignee = (r: any): TravelStepAssignee => ({
  tripId: r.trip_id,
  stepKey: r.step_key,
  assignedTo: r.assigned_to,
  assignedBy: r.assigned_by ?? null,
  assignedAt: r.assigned_at,
  note: r.note ?? null,
});

function mapStepOwner(r: any): TravelStepOwner {
  return {
    stepKey: r.step_key as StepKey,
    departmentIds: r.department_ids ?? [],
    designationId: r.designation_id ?? null,
    employeeIds: r.employee_ids ?? [],
  };
}

function mapEmployeeSettings(r: any): TravelEmployeeSettings {
  return {
    userId: r.user_id,
    baseCityId: r.base_city_id ?? null,
    seatPreference: r.seat_preference ?? null,
    mealPreference: r.meal_preference ?? null,
    frequentFlyerNo: r.frequent_flyer_no ?? null,
  };
}

function mapNotification(r: any): TravelNotification {
  return {
    id: r.id,
    type: r.type,
    entityType: r.entity_type,
    entityId: r.entity_id,
    text: r.text,
    actorId: r.actor_id ?? null,
    readAt: r.read_at ?? null,
    createdAt: r.created_at,
  };
}

const named = (r: any): TravelNamedMaster => ({
  id: r.id,
  name: r.name ?? "",
  active: r.active ?? true,
  sortOrder: r.sort_order ?? 0,
});

const mapCity = (r: any): TravelCity => ({
  ...named(r),
  state: r.state ?? null,
  tier: (r.tier ?? 3) as CityTier,
});

const mapPurpose = (r: any): TravelPurpose => ({
  ...named(r),
  requiresRemarks: r.requires_remarks ?? false,
});

const nnum = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

const mapExpenseCategory = (r: any): TravelExpenseCategory => ({
  ...named(r),
  kind: (r.kind ?? "misc") as ExpenseCategoryKind,
  reimbursable: r.reimbursable ?? true,
  receiptRequiredAbove: nnum(r.receipt_required_above),
  selfDeclarationCap: nnum(r.self_declaration_cap),
  needsGuestDetails: r.needs_guest_details ?? false,
  refusalNote: r.refusal_note ?? null,
});

const mapHotel = (r: any): TravelHotel => ({ ...named(r), cityId: r.city_id ?? null });

const mapRateCard = (r: any): TravelRateCard => ({
  id: r.id,
  label: r.label,
  effectiveFrom: r.effective_from,
  status: (r.status ?? "draft") as RateCardStatus,
  confirmedBy: r.confirmed_by ?? null,
  confirmedAt: r.confirmed_at ?? null,
  notes: r.notes ?? null,
  createdAt: r.created_at,
});

const mapRate = (r: any): TravelRate => ({
  id: r.id,
  rateCardId: r.rate_card_id,
  rateType: r.rate_type as RateType,
  travelCategory: (r.travel_category ?? null) as TravelCategory | null,
  cityTier: (r.city_tier ?? null) as CityTier | null,
  key: r.key ?? null,
  amount: nnum(r.amount),
  textValue: r.text_value ?? null,
  disputed: r.disputed ?? false,
  notes: r.notes ?? null,
  sortOrder: r.sort_order ?? 0,
});

const mapMasterManager = (r: any): TravelMasterManager => ({
  id: r.id,
  masterType: r.master_type as TravelMasterType,
  managerUserId: r.manager_user_id,
});

const mapMasterRequest = (r: any): TravelMasterRequest => ({
  id: r.id,
  masterType: r.master_type as TravelRequestableMaster,
  proposedPayload: (r.proposed_payload ?? {}) as Record<string, unknown>,
  status: r.status,
  requestedBy: r.requested_by ?? null,
  reviewedBy: r.reviewed_by ?? null,
  reviewNote: r.review_note ?? null,
  resolvedMasterId: r.resolved_master_id ?? null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/**
 * One trip row.
 *
 * ⚠ `traveller_name` FALLS BACK TO A DASH, NEVER TO AN EMPTY STRING. It is the
 *   label a draft is listed under (a draft has no trip number), so an empty
 *   string would render a blank, clickable nothing in the Drafts list.
 *
 * ⚠ MONEY IS COERCED WITH `nnum`, NOT `Number(x) || 0`. Postgres hands numerics
 *   back as strings, and `|| 0` would turn a genuinely unknown settlement into
 *   ₹0 — which reads as "worked out, and the answer was nothing" instead of
 *   "nobody has worked this out yet". lib/format.ts's `money()` renders null as
 *   an em dash precisely so that distinction survives to the screen.
 */
function mapTrip(r: any): Trip {
  return {
    id: r.id,
    tripNo: r.trip_no ?? null,
    status: r.status as TripStatus,
    currentStep: (r.current_step ?? null) as StepKey | null,

    raisedBy: r.raised_by ?? null,
    travellerId: r.traveller_id ?? null,
    travellerName: r.traveller_name ?? "—",
    travellerEmployeeCode: r.traveller_employee_code ?? null,

    snapBandNo: nnum(r.snap_band_no),
    snapTravelCategory: (r.snap_travel_category ?? null) as TravelCategory | null,
    snapDepartmentId: r.snap_department_id ?? null,
    snapDesignationId: r.snap_designation_id ?? null,
    snapBaseCityId: r.snap_base_city_id ?? null,
    snapRateCardId: r.snap_rate_card_id ?? null,
    tcDowngradedFrom: (r.tc_downgraded_from ?? null) as TravelCategory | null,
    tcDowngradedAt: r.tc_downgraded_at ?? null,
    approverManagerIds: r.approver_manager_ids ?? [],
    approverManagerNote: r.approver_manager_note ?? null,

    purposeId: r.purpose_id ?? null,
    purposeOtherRemarks: r.purpose_other_remarks ?? null,
    destinationCityId: r.destination_city_id ?? null,
    journeyType: (r.journey_type ?? null) as JourneyType | null,
    preferredSlot: (r.preferred_slot ?? null) as TimeSlot | null,
    plannedDepartureDate: r.planned_departure_date ?? null,
    plannedReturnDate: r.planned_return_date ?? null,
    actualDepartureDate: r.actual_departure_date ?? null,
    actualReturnDate: r.actual_return_date ?? null,
    actualDepartureTime: r.actual_departure_time ?? null,
    actualReturnTime: r.actual_return_time ?? null,
    customerProvided: (r.customer_provided ?? null) as Trip["customerProvided"],
    isCompanyConference: r.is_company_conference ?? false,
    familyJoinedFrom: r.family_joined_from ?? null,
    familyJoinedTo: r.family_joined_to ?? null,
    accommodationRequired: r.accommodation_required ?? false,
    estimatedCost: nnum(r.estimated_cost),
    isEmergency: r.is_emergency ?? false,
    emergencyReason: r.emergency_reason ?? null,

    directorApprovalSkipped: r.director_approval_skipped ?? false,
    advanceSkipped: r.advance_skipped ?? false,
    managerApprovalSkipped: r.manager_approval_skipped ?? false,

    advanceRequested: r.advance_requested ?? false,
    advanceRequestedAmount: nnum(r.advance_requested_amount),
    advanceApprovedAmount: nnum(r.advance_approved_amount),
    advancePaidAmount: nnum(r.advance_paid_amount),
    advancePaidAt: r.advance_paid_at ?? null,
    advancePaidRef: r.advance_paid_ref ?? null,
    advancePaidMode: r.advance_paid_mode ?? null,
    advNote: r.adv_note ?? null,
    advanceRecoveredAmount: nnum(r.advance_recovered_amount),
    advanceRecoveredAt: r.advance_recovered_at ?? null,
    advanceRecoveredRef: r.advance_recovered_ref ?? null,

    bookingTotal: nnum(r.booking_total),
    claimTotal: nnum(r.claim_total),
    daTotal: nnum(r.da_total),
    disallowedTotal: nnum(r.disallowed_total),
    netPayable: nnum(r.net_payable),
    settledAmount: nnum(r.settled_amount),
    settledAt: r.settled_at ?? null,
    settledRef: r.settled_ref ?? null,
    settledMode: r.settled_mode ?? null,
    settledNote: r.settled_note ?? null,
    frNote: r.fr_note ?? null,

    submittedAt: r.submitted_at ?? null,
    maAt: r.ma_at ?? null, maBy: r.ma_by ?? null, maDecision: r.ma_decision ?? null, maNote: r.ma_note ?? null,
    daAt: r.da_at ?? null, daBy: r.da_by ?? null, daDecision: r.da_decision ?? null, daNote: r.da_note ?? null,
    advAt: r.adv_at ?? null, advBy: r.adv_by ?? null,
    bkAt: r.bk_at ?? null, bkBy: r.bk_by ?? null,
    clAt: r.cl_at ?? null, clBy: r.cl_by ?? null,
    crAt: r.cr_at ?? null, crBy: r.cr_by ?? null, crDecision: r.cr_decision ?? null, crNote: r.cr_note ?? null,
    frAt: r.fr_at ?? null, frBy: r.fr_by ?? null,
    stAt: r.st_at ?? null, stBy: r.st_by ?? null,

    returnedAt: r.returned_at ?? null,
    returnedStage: r.returned_stage ?? null,
    returnedReason: r.returned_reason ?? null,
    rejectedAt: r.rejected_at ?? null,
    rejectedStage: r.rejected_stage ?? null,
    rejectReason: r.reject_reason ?? null,
    holdAt: r.hold_at ?? null,
    holdReason: r.hold_reason ?? null,
    holdFromStatus: (r.hold_from_status ?? null) as TripStatus | null,
    cancelledAt: r.cancelled_at ?? null,
    cancelReason: r.cancel_reason ?? null,

    editedAt: r.edited_at ?? null,
    editedBy: r.edited_by ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const mapLeg = (r: any): TripLeg => ({
  id: r.id,
  tripId: r.trip_id,
  kind: r.kind as LegKind,
  direction: (r.direction ?? "local") as LegDirection,
  fromCityId: r.from_city_id ?? null,
  toCityId: r.to_city_id ?? null,
  startOn: r.start_on ?? null,
  startTime: r.start_time ?? null,
  endOn: r.end_on ?? null,
  endTime: r.end_time ?? null,
  airlineId: r.airline_id ?? null,
  hotelId: r.hotel_id ?? null,
  busOperatorId: r.bus_operator_id ?? null,
  carrierOther: r.carrier_other ?? null,
  bookingRef: r.booking_ref ?? null,
  travelClass: r.travel_class ?? null,
  ticketCost: Number(r.ticket_cost ?? 0),
  otherCharges: Number(r.other_charges ?? 0),
  refundAmount: Number(r.refund_amount ?? 0),
  // Read, never recomputed — the database generates it.
  netCost: Number(r.net_cost ?? 0),
  cancelledAt: r.cancelled_at ?? null,
  cancelReasonKind: (r.cancel_reason_kind ?? null) as TripLeg["cancelReasonKind"],
  cancelReason: r.cancel_reason ?? null,
  docPath: r.doc_path ?? null,
  aiExtracted: (r.ai_extracted ?? null) as Record<string, unknown> | null,
  notes: r.notes ?? null,
  sortOrder: r.sort_order ?? 0,
  createdAt: r.created_at,
});

const mapClaimLine = (r: any): ClaimLine => ({
  id: r.id,
  tripId: r.trip_id,
  categoryId: r.category_id ?? null,
  cityId: r.city_id ?? null,
  spentOn: r.spent_on ?? null,
  description: r.description ?? null,
  amount: Number(r.amount ?? 0),
  gstAmount: Number(r.gst_amount ?? 0),
  vendor: r.vendor ?? null,
  gstin: r.gstin ?? null,
  invoiceNo: r.invoice_no ?? null,
  hasReceipt: r.has_receipt ?? false,
  selfDeclared: r.self_declared ?? false,
  nights: nnum(r.nights),
  persons: nnum(r.persons),
  days: nnum(r.days),
  km: nnum(r.km),
  guests: r.guests ?? null,
  mealKind: r.meal_kind ?? null,
  vehicleType: r.vehicle_type ?? null,
  fullDayRental: r.full_day_rental ?? false,
  overCapEvidence: r.over_cap_evidence ?? false,
  hodApproved: r.hod_approved ?? false,
  directorApproved: r.director_approved ?? false,
  docPath: r.doc_path ?? null,
  aiExtracted: (r.ai_extracted ?? null) as Record<string, unknown> | null,
  // Read, never recomputed — fms_travel_price_claim wrote these, and the browser
  // is not allowed to.
  capApplied: nnum(r.cap_applied),
  allowedAmount: nnum(r.allowed_amount),
  disallowReason: r.disallow_reason ?? null,
  engineNote: r.engine_note ?? null,
  pricedAt: r.priced_at ?? null,
  // Finance's answer, beside the engine's — never on top of it.
  financeAmount: nnum(r.finance_amount),
  financeReason: r.finance_reason ?? null,
  financeBy: r.finance_by ?? null,
  financeAt: r.finance_at ?? null,
  sortOrder: r.sort_order ?? 0,
  createdAt: r.created_at,
});

const mapDaDay = (r: any): DaDay => ({
  id: r.id,
  tripId: r.trip_id,
  day: r.day,
  cityId: r.city_id ?? null,
  cityTier: nnum(r.city_tier),
  daRate: Number(r.da_rate ?? 0),
  factor: Number(r.factor ?? 1),
  factorReason: r.factor_reason ?? null,
  amount: Number(r.amount ?? 0),
  overrideAmount: nnum(r.override_amount),
  overrideReason: r.override_reason ?? null,
  overrideBy: r.override_by ?? null,
  overrideAt: r.override_at ?? null,
});

const mapPassenger = (r: any): TripPassenger => ({
  id: r.id,
  tripId: r.trip_id,
  employeeId: r.employee_id ?? null,
  fullName: r.full_name ?? "",
  gender: (r.gender ?? null) as TripPassenger["gender"],
  dateOfBirth: r.date_of_birth ?? null,
  mobile: r.mobile ?? null,
  email: r.email ?? null,
  isPrimary: r.is_primary ?? false,
  sortOrder: r.sort_order ?? 0,
});

export async function fetchTravelData(): Promise<TravelData> {
  const [
    tripRows, passengerRows, legRows,
    ownerRows, assigneeRows, configRows, settingRows, notificationRows,
    cityRows, purposeRows, categoryRows, airlineRows, hotelRows, busRows,
    cardRows, rateRows, managerRows, requestRows,
    claimLineRows, daDayRows,
  ] = await Promise.all([
    fetchAll("fms_travel_trips"),
    // ⚠ Ordered by `id`, not by `sort_order`. sort_order restarts at 10 on every
    //   trip, so it is nowhere near a total order and paging on it could return
    //   one row twice and drop another. The display order is applied per trip by
    //   `passengersOf` in the store.
    fetchAll("fms_travel_passengers", "id"),
    // ⚠ Ordered by `id`, for the same reason as passengers: sort_order restarts
    //   at 10 on every trip, so it is nowhere near a total order and paging on
    //   it could return a row twice and drop another.
    fetchAll("fms_travel_legs", "id"),
    fetchAll("fms_travel_step_owners"),
    fetchAll("fms_travel_step_assignees", "trip_id"),
    fetchAll("fms_travel_config", "key"),
    fetchAll("fms_travel_employee_settings"),
    fetchAll("fms_travel_notifications"),
    fetchAll("fms_travel_cities", "sort_order"),
    fetchAll("fms_travel_purposes", "sort_order"),
    fetchAll("fms_travel_expense_categories", "sort_order"),
    fetchAll("fms_travel_airlines", "sort_order"),
    fetchAll("fms_travel_hotels", "sort_order"),
    fetchAll("fms_travel_bus_operators", "sort_order"),
    fetchAll("fms_travel_rate_cards", "effective_from"),
    fetchAll("fms_travel_rates", "sort_order"),
    fetchAll("fms_travel_master_managers"),
    fetchAll("fms_travel_master_requests"),
    // ⚠ Ordered by `id`, for the same reason as passengers and legs: sort_order
    //   restarts at 10 on every trip, so it is nowhere near a total order and
    //   paging on it could return one row twice and drop another.
    fetchAll("fms_travel_claim_lines", "id"),
    fetchAll("fms_travel_da_days", "id"),
  ]);

  const cfg = new Map<string, any>(configRows.map((r: any) => [r.key, r.value]));
  const identity = cfg.get("company_identity") ?? {};

  const config: TravelConfig = {
    stepSla: (cfg.get("step_sla") as Record<string, unknown> | undefined) ?? null,
    processCoordinators: (cfg.get("process_coordinators")?.user_ids as string[] | undefined) ?? [],
    approvalMatrix: mapMatrix(cfg.get("approval_matrix")),
    policy: mapPolicy(cfg.get("policy")),
    reassignPoolDepartmentIds: (cfg.get("reassign_pool")?.department_ids as string[] | undefined) ?? [],
    reassignPoolUserIds: (cfg.get("reassign_pool")?.user_ids as string[] | undefined) ?? [],
    companyIdentity: {
      legalName: str(identity.legal_name),
      // ⚠ Blank until Finance confirms it. Policy §7.1 and §11.3 both carry the
      //   GSTIN as "[⚠ CONFIRM with Finance]", and a placeholder number printed
      //   on guidance an employee hands a hotel is worse than a visible gap.
      gstin: str(identity.gstin),
      address: str(identity.address),
    },
  };

  return {
    trips: tripRows.map(mapTrip),
    passengers: passengerRows.map(mapPassenger),
    legs: legRows.map(mapLeg),
    stepOwners: ownerRows.map(mapStepOwner),
    stepAssignees: assigneeRows.map(mapStepAssignee),
    config,
    stepSla: (cfg.get("step_sla") as StoredStepSla | undefined) ?? null,
    employeeSettings: settingRows.map(mapEmployeeSettings),
    notifications: notificationRows.map(mapNotification),

    cities: cityRows.map(mapCity),
    purposes: purposeRows.map(mapPurpose),
    expenseCategories: categoryRows.map(mapExpenseCategory),
    airlines: airlineRows.map(named),
    hotels: hotelRows.map(mapHotel),
    busOperators: busRows.map(named),

    rateCards: cardRows.map(mapRateCard),
    rates: rateRows.map(mapRate),

    masterManagers: managerRows.map(mapMasterManager),
    masterRequests: requestRows.map(mapMasterRequest),

    claimLines: claimLineRows.map(mapClaimLine),
    daDays: daDayRows.map(mapDaDay),
  };
}


/** One trip's query key, so a timeline read never invalidates the snapshot. */
export const tripActivityKey = (tripId: string) => [...TRAVEL_QK, "activity", tripId];

/**
 * A trip's timeline — workflow events and comments, oldest first.
 *
 * ⚠ FETCHED PER TRIP, ON DEMAND, and that is the one child table here that is
 *   NOT in the snapshot. Passengers, legs, claim lines and DA days are a handful
 *   of rows per trip and every list screen wants them. Activity is different: it
 *   grows for ever, one row per event per trip, and only the detail page ever
 *   reads it. Putting it in the snapshot would make every screen in the module
 *   pay for a table only one of them uses — and capping it there would silently
 *   empty the timeline of the oldest trips, which is worse than a second query.
 *
 * ⚠ OLDEST FIRST. A timeline read newest-first is a list somebody has to read
 *   bottom-up to follow a story, and the story is the point.
 */
export async function fetchTripActivity(tripId: string): Promise<TravelActivity[]> {
  const { data, error } = await db
    .from("fms_travel_activity")
    .select("*")
    .eq("entity_type", "trip")
    .eq("entity_id", tripId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(
    (r: any): TravelActivity => ({
      id: r.id,
      entityType: r.entity_type,
      entityId: r.entity_id,
      type: r.type,
      actorId: r.actor_id ?? null,
      note: r.note ?? null,
      meta: (r.meta ?? {}) as TravelActivity["meta"],
      createdAt: r.created_at,
    }),
  );
}
