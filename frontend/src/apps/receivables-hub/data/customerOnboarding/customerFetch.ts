/**
 * Customer Creation FMS — the single snapshot read.
 *
 * ONE query for the whole module, mirroring every other FMS store. No per-table
 * queries, no per-page fetches: the module's data is small (a few thousand
 * requests at the very most) and a single cache entry means one invalidation
 * after a write instead of a fan-out that can half-apply.
 *
 * ⚠ CLIENT: the IDENTITY project (@/core/platform/supabase), NOT the hub's
 *   receivables or ConnectWave clients. Those two are read-only mirrors of other
 *   Supabase projects; every fms_* table lives in the identity project, which is
 *   the only writable one. The hub's Edge-Function write pattern
 *   (muster-write / followups-write) exists ONLY because those target a
 *   different project — it does not apply here.
 *
 * ⚠ TYPES: fms_customer_* is not in core/platform/database.types.ts, so every
 *   call routes through `const db = supabase as any`. Same as
 *   apps/sampling/data/samplingFetch.ts. Without it, strict tsc rejects
 *   .from("fms_customer_requests") and the whole portal build fails.
 */
import { supabase } from "@/core/platform/supabase";
import {
  DEFAULT_APPROVAL_RULES,
  type ApprovalRules, type CustomerActivity, type CustomerNotification,
  type CustomerRequest, type GstState, type StepOwner,
} from "@hub/lib/customerOnboarding/types";
import { DEFAULT_STEP_SLA, resolveStepSla, type StepSlaMap } from "@hub/lib/customerOnboarding/sla";

const db = supabase as any;

/** PostgREST caps a response; page through rather than silently truncating. */
const PAGE = 1000;

async function fetchAll<T>(table: string, orderBy: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from(table)
      .select("*")
      // ⚠ .range() without .order() on a UNIQUE column duplicates and drops
      //   rows across pages — Postgres makes no ordering promise otherwise.
      .order(orderBy, { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/** numeric → number|null. PostgREST serialises numeric as a STRING. */
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s === "" ? null : s;
};

function mapRequest(r: any): CustomerRequest {
  return {
    id: r.id,
    reqNo: str(r.req_no),

    legalName: str(r.legal_name),
    tradeName: str(r.trade_name),
    customerType: r.customer_type ?? null,
    website: str(r.website),

    gstNumber: str(r.gst_number),
    panNumber: str(r.pan_number),
    msmeUdyamNo: str(r.msme_udyam_no),
    registeredAddress: str(r.registered_address),
    city: str(r.city),
    stateCode: str(r.state_code),
    stateName: str(r.state_name),
    // jsonb arrives already parsed. Null for every request raised before the
    // GSTIN gate shipped, and whenever no provider answered.
    gstinSnapshot: r.gstin_snapshot ?? null,
    factoryAddress: str(r.factory_address),
    billingSameAsRegistered: r.billing_same_as_registered !== false,
    billingAddress: str(r.billing_address),
    gstDocPath: str(r.gst_doc_path),       gstDocName: str(r.gst_doc_name),
    panDocPath: str(r.pan_doc_path),       panDocName: str(r.pan_doc_name),
    chequeDocPath: str(r.cheque_doc_path), chequeDocName: str(r.cheque_doc_name),
    msmeDocPath: str(r.msme_doc_path),     msmeDocName: str(r.msme_doc_name),

    contactName: str(r.contact_name),
    contactDesignation: str(r.contact_designation),
    contactMobile: str(r.contact_mobile),
    contactEmail: str(r.contact_email),

    printingApplications: Array.isArray(r.printing_applications) ? r.printing_applications : [],
    printingApplicationOther: str(r.printing_application_other),
    currentInkBrand: str(r.current_ink_brand),
    currentSupplier: str(r.current_supplier),
    monthlyInkConsumption: r.monthly_ink_consumption ?? null,

    estMonthlyPurchase: num(r.est_monthly_purchase),
    expectedFirstOrder: num(r.expected_first_order),

    ref1Company: str(r.ref1_company), ref1Contact: str(r.ref1_contact), ref1Mobile: str(r.ref1_mobile),
    ref2Company: str(r.ref2_company), ref2Contact: str(r.ref2_contact), ref2Mobile: str(r.ref2_mobile),

    paymentTerms: r.payment_terms ?? null,
    requestedCreditLimit: num(r.requested_credit_limit),
    requestedCreditDays: num(r.requested_credit_days),
    securityOffered: r.security_offered ?? null,
    creditReason: str(r.credit_reason),

    assignedSalesExecId: str(r.assigned_sales_exec_id),
    assignedSalesExecName: str(r.assigned_sales_exec_name),

    status: r.status,
    currentStep: r.current_step,
    raisedBy: str(r.raised_by),
    raisedByName: str(r.raised_by_name),
    submittedAt: str(r.submitted_at),

    accGstVerified: r.acc_gst_verified ?? null,
    accRefsVerified: r.acc_refs_verified ?? null,
    accRecommendedLimit: num(r.acc_recommended_limit),
    accRecommendedDays: num(r.acc_recommended_days),
    accRemarks: str(r.acc_remarks),
    accVerifiedDate: str(r.acc_verified_date),
    accVerifiedAt: str(r.acc_verified_at),
    accVerifiedBy: str(r.acc_verified_by),

    shCustomerCategory: r.sh_customer_category ?? null,
    shBusinessPotential: str(r.sh_business_potential),
    shDecision: r.sh_decision ?? null,
    shForceDirector: r.sh_force_director === true,
    shRemarks: str(r.sh_remarks),
    shDecidedDate: str(r.sh_decided_date),
    shDecidedAt: str(r.sh_decided_at),
    shDecidedBy: str(r.sh_decided_by),

    dirRequired: r.dir_required === true,
    dirRequiredReason: r.dir_required_reason ?? null,
    dirThresholdAtDecision: num(r.dir_threshold_at_decision),
    dirDecision: r.dir_decision ?? null,
    dirRemarks: str(r.dir_remarks),
    dirDecidedDate: str(r.dir_decided_date),
    dirDecidedAt: str(r.dir_decided_at),
    dirDecidedBy: str(r.dir_decided_by),

    customerCode: str(r.customer_code),
    tallyLedgerCreated: r.tally_ledger_created ?? null,
    tallyLedgerName: str(r.tally_ledger_name),
    customerStatus: r.customer_status ?? null,
    tallyDate: str(r.tally_date),
    tallyAt: str(r.tally_at),
    tallyBy: str(r.tally_by),

    rejectedAt: str(r.rejected_at), rejectStage: str(r.reject_stage), rejectReason: str(r.reject_reason),
    reworkAt: str(r.rework_at),     reworkStage: str(r.rework_stage), reworkReason: str(r.rework_reason),
    reworkCount: Number(r.rework_count ?? 0),
    holdAt: str(r.hold_at),         holdReason: str(r.hold_reason),
    cancelledAt: str(r.cancelled_at), cancelReason: str(r.cancel_reason),
    editedAt: str(r.edited_at),     editedBy: str(r.edited_by),

    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const mapStepOwner = (r: any): StepOwner => ({
  id: r.id,
  stepKey: r.step_key,
  departmentIds: Array.isArray(r.department_ids) ? r.department_ids : [],
  designationId: str(r.designation_id),
  employeeIds: Array.isArray(r.employee_ids) ? r.employee_ids : [],
});

const mapGstState = (r: any): GstState => ({
  code: r.code,
  name: r.name,
  active: r.active !== false,
  sortOrder: Number(r.sort_order ?? 0),
});

const mapActivity = (r: any): CustomerActivity => ({
  id: r.id,
  entityType: r.entity_type,
  entityId: r.entity_id,
  type: r.type,
  actorId: str(r.actor_id),
  note: str(r.note),
  meta: r.meta ?? {},
  createdAt: r.created_at,
});

const mapNotification = (r: any): CustomerNotification => ({
  id: r.id,
  userId: r.user_id,
  type: r.type,
  entityType: r.entity_type,
  entityId: r.entity_id,
  text: r.text,
  actorId: str(r.actor_id),
  readAt: str(r.read_at),
  createdAt: r.created_at,
});

export interface CustomerSnapshot {
  requests: CustomerRequest[];
  stepOwners: StepOwner[];
  gstStates: GstState[];
  activity: CustomerActivity[];
  notifications: CustomerNotification[];
  stepSla: StepSlaMap;
  approvalRules: ApprovalRules;
  coordinatorIds: string[];
}

/**
 * ⚠ Keyed on the REAL session user id. RLS scopes the rows, so two users must
 *   never share a cache entry — a suffixless key would let an approver's
 *   snapshot be served to a rep who can see far less.
 */
export const CUSTOMER_QK = ["customerOnboarding"] as const;
export const customerQueryKey = (userId: string | null) => [...CUSTOMER_QK, userId] as const;

export async function fetchCustomerData(): Promise<CustomerSnapshot> {
  const [requests, stepOwners, gstStates, activity, notifications, config] = await Promise.all([
    fetchAll<any>("fms_customer_requests", "created_at"),
    fetchAll<any>("fms_customer_step_owners", "step_key"),
    fetchAll<any>("fms_customer_gst_states", "sort_order"),
    fetchAll<any>("fms_customer_activity", "created_at"),
    fetchAll<any>("fms_customer_notifications", "created_at"),
    fetchAll<any>("fms_customer_config", "key"),
  ]);

  const byKey = new Map<string, any>(config.map((c: any) => [c.key, c.value ?? {}]));
  const approvalRaw = byKey.get("approval") ?? {};
  const approvalRules: ApprovalRules = {
    directorThreshold: num(approvalRaw.director_threshold) ?? DEFAULT_APPROVAL_RULES.directorThreshold,
    exemptAdvanceTerms: approvalRaw.exempt_advance_terms !== false,
    exemptWhenNoLimitRequested: approvalRaw.exempt_when_no_limit_requested !== false,
  };

  const coordRaw = byKey.get("process_coordinators") ?? {};
  const coordinatorIds: string[] = Array.isArray(coordRaw.user_ids) ? coordRaw.user_ids : [];

  return {
    requests: requests.map(mapRequest),
    stepOwners: stepOwners.map(mapStepOwner),
    gstStates: gstStates.map(mapGstState),
    activity: activity.map(mapActivity),
    notifications: notifications.map(mapNotification),
    stepSla: resolveStepSla(byKey.get("step_sla")) ?? DEFAULT_STEP_SLA,
    approvalRules,
    coordinatorIds,
  };
}
