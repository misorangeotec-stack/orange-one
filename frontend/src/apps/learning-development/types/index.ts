import type { StepKey } from "../lib/steps";

/** A training request's lifecycle. Mirrors the CHECK on fms_ld_requests.status. */
export type RequestStatus =
  | "draft"
  | "submitted"
  | "under_validation"
  | "returned"
  | "proposed"
  | "hr_approved"
  | "approved"
  | "rejected"
  | "trainer_finalised"
  | "scheduled"
  | "closed"
  | "cancelled";

export type Priority = "high" | "medium" | "low";
export type DeliveryMode = "classroom" | "online" | "hybrid" | "on_the_job";
export type TrainerType = "internal" | "external";

export type SessionStatus =
  | "scheduled"
  | "nomination_open"
  | "invited"
  | "ready"
  | "conducted"
  | "attendance_closed"
  | "in_review"
  | "closed"
  | "rescheduled"
  | "cancelled";

/** A row in any of the simple masters (name / active / sort_order). */
export interface MasterRow {
  id: string;
  name: string;
  active: boolean;
  sortOrder: number;
}

/**
 * A session type carries a STABLE CODE as well as a name.
 *
 * The weekly review report counts "external agency" and "technical" as separate
 * lines and reports a session that is both under both, and LD-9 has to find POSH
 * and Safety sessions to credit a year's mandatory compliance. Matching on the
 * display name breaks the first time somebody expands "POSH" to spell it out —
 * which is exactly the edit a Masters screen invites. Match on `code`.
 */
export interface SessionType extends MasterRow {
  code: string | null;
}

export interface Trainer {
  id: string;
  name: string;
  trainerType: TrainerType;
  /** Set ONLY for an internal trainer — an external one has no portal account at all. */
  employeeId: string | null;
  agency: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  speciality: string | null;
  rate: number | null;
  active: boolean;
  sortOrder: number;
}

export interface Venue extends MasterRow {
  address: string | null;
  capacity: number | null;
  isOnline: boolean;
}

export interface StepOwner {
  stepKey: string;
  departmentIds: string[];
  employeeIds: string[];
}

export interface StepAssignee {
  requestId: string | null;
  sessionId: string | null;
  stepKey: string;
  assignedTo: string;
  assignedBy: string | null;
  assignedAt: string;
  note: string | null;
}

export interface TrainingRequest {
  id: string;
  code: string | null;
  status: RequestStatus;

  title: string;
  needSourceId: string | null;
  departmentId: string | null;
  requestedBy: string | null;
  skillGap: string | null;
  objective: string | null;
  targetGroup: string | null;
  requiredBy: string | null;
  priority: Priority | null;
  attachmentPath: string | null;
  submittedAt: string | null;

  returnedAt: string | null;
  returnedBy: string | null;
  returnReason: string | null;

  competencyId: string | null;
  isMandatory: boolean;
  duplicateChecked: boolean;
  businessJustification: string | null;
  expectedOutcome: string | null;
  validatedBy: string | null;
  validatedAt: string | null;
  validationNote: string | null;

  sessionTypeIds: string[];
  deliveryMode: DeliveryMode | null;
  proposedTrainerType: TrainerType | null;
  proposedCost: number | null;
  proposedMonth: string | null;
  proposalPath: string | null;
  proposedBy: string | null;
  proposedAt: string | null;

  /**
   * Whether THIS request needs Management approval — frozen at proposal time.
   *
   * ⚠ NEVER RE-DERIVE THIS FROM THE LIVE RULE. The rule (Setup → Approval Rules)
   *   is never / always / above ₹X and an admin may change it at any moment. A
   *   request that cleared HR Head approval under one threshold must not sprout a
   *   second gate because somebody lowered it that afternoon, nor lose one
   *   because they raised it. `null` means the request has not been proposed yet.
   */
  mgmtRequired: boolean | null;
  hrApprovedBy: string | null;
  hrApprovedAt: string | null;
  hrApprovalNote: string | null;
  mgmtApprovedBy: string | null;
  mgmtApprovedAt: string | null;
  mgmtApprovalNote: string | null;
  approvedBudget: number | null;
  rejectedBy: string | null;
  rejectedAt: string | null;
  rejectReason: string | null;

  trainerId: string | null;
  trainerTerms: string | null;
  quotationPath: string | null;
  trainerConfirmedBy: string | null;
  trainerConfirmedAt: string | null;

  actualCost: number | null;
  finalOutcome: string | null;
  closureNote: string | null;
  closedBy: string | null;
  closedAt: string | null;

  heldReasonId: string | null;
  heldNote: string | null;
  heldAt: string | null;

  createdAt: string;
  updatedAt: string;
}

export interface TrainingSession {
  id: string;
  code: string | null;
  requestId: string | null;
  /** Set only when this session fulfils a line of the published annual plan. */
  planLineId: string | null;
  title: string;
  sessionTypeIds: string[];
  deliveryMode: DeliveryMode | null;
  trainerId: string | null;
  sessionDate: string;
  startTime: string | null;
  endTime: string | null;
  hours: number | null;
  venueId: string | null;
  meetingLink: string | null;
  capacity: number | null;
  registrationCutoff: string | null;
  status: SessionStatus;
  outcome: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  changeReason: string | null;
  readinessConfirmedAt: string | null;
  invitationsSentAt: string | null;
  attendanceClosedAt: string | null;
  attendanceSheetPath: string | null;
  evidencePaths: string[];
  trainerAttended: boolean | null;
  reviewNote: string | null;
  reviewActionPoints: string | null;
  reviewedAt: string | null;
  actualCost: number | null;
  createdBy: string | null;
  createdAt: string;
}

export interface LdNotification {
  id: string;
  type: string;
  entityType: string;
  entityId: string;
  text: string;
  actorId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface LdActivity {
  id: string;
  entityType: string;
  entityId: string;
  type: string;
  actorId: string | null;
  note: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
}

/** Setup → Approval Rules. Frozen onto each request at proposal time. */
export interface ApprovalRule {
  mgmt: "never" | "always" | "above";
  aboveAmount: number;
}

/** One open work-item sitting at one step. */
export interface QueueEntry {
  stepKey: StepKey;
  entityId: string;
  ref: string;
  dueIso: string | null;
  title: string;
  departmentId: string | null;
  priority: Priority | null;
  requestedBy: string | null;
}

/* ------------------------------------------------- participants & delivery */

export type NominationStatus = "proposed" | "approved" | "rejected" | "withdrawn";
export type Rsvp = "pending" | "accepted" | "declined";

export interface Nomination {
  id: string;
  sessionId: string;
  employeeId: string;
  source: "hod" | "hr" | "self";
  status: NominationStatus;
  nominatedBy: string | null;
  nominatedAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectReason: string | null;
  invitedAt: string | null;
  rsvp: Rsvp;
  rsvpAt: string | null;
  declineReason: string | null;
}

export interface Material {
  id: string;
  sessionId: string;
  title: string;
  kind: "agenda" | "pre_read" | "slides" | "other";
  filePath: string | null;
  linkUrl: string | null;
  note: string | null;
  uploadedBy: string | null;
  uploadedAt: string;
}

export type AttendanceStatus =
  | "present" | "absent" | "partial" | "approved_exception" | "not_applicable";

export interface Attendance {
  id: string;
  sessionId: string;
  employeeId: string;
  status: AttendanceStatus;
  minutes: number | null;
  reason: string | null;
  markedBy: string | null;
  markedAt: string;
  followedUpAt: string | null;
}

export interface Assignment {
  id: string;
  sessionId: string;
  title: string;
  brief: string | null;
  filePath: string | null;
  issuedBy: string | null;
  issuedAt: string;
  dueAt: string | null;
}

export interface Submission {
  id: string;
  assignmentId: string;
  employeeId: string;
  filePath: string | null;
  note: string | null;
  /** null means NOT SUBMITTED — the row exists from the moment it was issued. */
  submittedAt: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  outcome: "accepted" | "needs_rework" | null;
  reviewerRemarks: string | null;
  escalatedAt: string | null;
}

export interface Feedback {
  id: string;
  sessionId: string;
  employeeId: string;
  contentRating: number | null;
  trainerRating: number | null;
  relevanceRating: number | null;
  overallRating: number;
  comment: string | null;
  submittedAt: string;
}

export type EffectivenessOutcome =
  | "effective" | "partially_effective" | "not_effective" | "insufficient_evidence";

export interface Effectiveness {
  id: string;
  sessionId: string;
  hodId: string;
  dueOn: string;
  rating: number | null;
  outcome: EffectivenessOutcome | null;
  applicationObserved: string | null;
  evidence: string | null;
  improvementArea: string | null;
  followupRequired: boolean;
  followupActionId: string | null;
  submittedAt: string | null;
}

/* ------------------------------------------------- the annual training plan */

export interface Plan {
  id: string;
  fyCode: string;
  title: string;
  /** Published is FROZEN — a change makes a new revision that supersedes it. */
  status: "draft" | "published" | "superseded";
  revision: number;
  supersedesId: string | null;
  publishedAt: string | null;
  publishedBy: string | null;
  note: string | null;
}

export interface PlanLine {
  id: string;
  planId: string;
  /** Always the first of the month. */
  plannedMonth: string;
  title: string;
  sessionTypeIds: string[];
  departmentIds: string[];
  plannedHeadcount: number | null;
  plannedHours: number | null;
  estimatedCost: number | null;
  note: string | null;
  sortOrder: number;
}

/* ------------------------------------------------------ masters (LD-13) */

/**
 * The seven vocabularies this module owns, in one list.
 *
 * ⚠ THIS IS A WIRE CONTRACT IN THREE PLACES AT ONCE. Every `value` below is
 *   checked by a CHECK constraint on BOTH `fms_ld_master_managers.master_type`
 *   and `fms_ld_master_requests.master_type`, and dispatched on by name inside
 *   `fms_ld_resolve_master_request`. Adding an entry here without adding it to
 *   all three means the owner picker offers a list nobody can be given, and a
 *   request against it is refused by the database with "violates check
 *   constraint" rather than anything a reader could act on.
 *
 * `fms_ld_mandatory_programs` is deliberately NOT here — see MANDATORY_CYCLES.
 */
export const LD_MASTER_TYPES = [
  { value: "session_type", label: "Session type", plural: "Session types" },
  { value: "competency", label: "Competency", plural: "Competencies" },
  { value: "need_source", label: "Need source", plural: "Need sources" },
  { value: "venue", label: "Venue", plural: "Venues" },
  { value: "trainer", label: "Trainer", plural: "Trainers & agencies" },
  { value: "delay_reason", label: "Delay reason", plural: "Delay reasons" },
  { value: "followup_action", label: "Follow-up action", plural: "Follow-up actions" },
] as const;

export type LdMasterType = (typeof LD_MASTER_TYPES)[number]["value"];

export const masterTypeLabel = (t: string): string =>
  LD_MASTER_TYPES.find((m) => m.value === t)?.label ?? t;
export const masterTypePlural = (t: string): string =>
  LD_MASTER_TYPES.find((m) => m.value === t)?.plural ?? t;

/**
 * A mandatory programme — POSH, Safety, and anything else everyone must do once
 * a year. It is a master, but NOT one of the seven above:
 *
 * ⚠ ITS GOVERNANCE IS DIFFERENT AND THE SCREEN MUST FOLLOW IT. The RLS policy on
 *   `fms_ld_mandatory_programs` reads `is_admin OR fms_ld_is_coordinator` — not
 *   `fms_ld_is_master_manager` — so owning "session types" does not let you edit
 *   it. It is also absent from both master CHECK lists, which is why it cannot be
 *   requested and has no Master Owners row.
 *
 * ⚠ `sessionTypeCode` MATCHES ON THE SESSION TYPE'S STABLE CODE, never its name.
 *   Renaming "POSH" to "Prevention of Sexual Harassment" on the Session Types tab
 *   must not break the compliance count, and matching on `code` is what stops it.
 */
export interface MandatoryProgram extends MasterRow {
  sessionTypeCode: string;
  cycle: "annual" | "on_joining" | "both";
}

export const MANDATORY_CYCLES: { value: MandatoryProgram["cycle"]; label: string }[] = [
  { value: "annual", label: "Every year" },
  { value: "on_joining", label: "Once, on joining" },
  { value: "both", label: "On joining and every year" },
];

export type MasterRequestStatus = "pending" | "approved" | "rejected";

/** Somebody asking for a value that is not on a list yet. */
export interface MasterRequest {
  id: string;
  masterType: LdMasterType;
  proposedPayload: Record<string, unknown>;
  status: MasterRequestStatus;
  requestedBy: string | null;
  reviewedBy: string | null;
  reviewNote: string | null;
  resolvedMasterId: string | null;
  createdAt: string;
  updatedAt: string;
}
