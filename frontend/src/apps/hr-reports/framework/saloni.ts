/**
 * Saloni's sheet, transcribed (KPI-3, read-only).
 *
 * SOURCE: files/SALONI FINAL KPI -ORANGE HUB.docx — "ORANGE O TEC · HR EXECUTIVE-SALONI ·
 * FINAL KPI & PMS FRAMEWORK · Orange Hub Mapping Ready | Fixed KPI Score: 100%".
 *
 * Every `targetText` and `evidence` below is the document's own wording, copied, not
 * paraphrased — so the page can be held against the sheet line by line. `coverage` and
 * `gap` are NOT from the document: they are what the hub can actually honour, re-read
 * from the live schema on 23-09-2026 (see KRA-KPI-FRAMEWORK.md).
 *
 * ── What the hub can honour, by weight ────────────────────────────────────────
 *   system          7%   interview coordination, and Task Management's two rates
 *   partial         4%   offer / joining, with BGV now a real column
 *   target-missing 20%   the actuals are live; nobody has stated the target
 *   judgement       3%   never machine-measurable, by design
 *   unused         63%   live screens with nothing entered — L&D is 45% of it
 *   no-data         3%   what is genuinely still to be written
 *
 * The page recomputes that split from these lines rather than printing it, so the two
 * can never drift apart.
 */
import type { Framework, KpiLine } from "./types";

/** Task Management's module key in kpi_facts, and New Recruitment's. */
const TASKS = "task-management";
const HR = "hr";

const lines: KpiLine[] = [
  // ══ KRA 1 · Talent Acquisition, Buddy Program & Probation — 45% ══════════════
  // ── A · Talent Acquisition — 30% ──
  {
    code: "1A.1",
    kra: "1",
    group: "A · Talent Acquisition",
    title: "Requisition acknowledgement",
    weight: 3,
    measure: "sla",
    targetText: "Within 1 working day of approved requisition",
    target: 1,
    unit: "working day",
    evidence: "Acknowledgement timestamp",
    coverage: "unused",
    source: { kind: "none" },
    gap: "`acknowledged_at` is live on the requisition. It has barely been used, so the SLA has almost nothing to measure.",
  },
  {
    code: "1A.2",
    kra: "1",
    group: "A · Talent Acquisition",
    title: "CV pipeline creation",
    weight: 5,
    measure: "count",
    targetText: "CVs target uploaded per requisition, HR HEAD will confirm it while approving",
    target: null,
    unit: "CVs per requisition",
    evidence: "CV/profile upload count",
    coverage: "target-missing",
    source: { kind: "hr", metric: "cv_per_requisition" },
    gap: "The count is live. The per-requisition target the HR Head is meant to set at approval is stored nowhere — type one to see the score.",
  },
  {
    code: "1A.3",
    kra: "1",
    group: "A · Talent Acquisition",
    title: "Quality shortlist submission",
    weight: 5,
    measure: "count",
    targetText: "Minimum 2-3 shortlisted profiles per requisition",
    target: null,
    unit: "shortlisted per requisition",
    evidence: "Shortlist status and submission date",
    coverage: "target-missing",
    source: { kind: "hr", metric: "shortlist_per_requisition" },
    gap: 'The count is live. "2-3" is two different targets — it has to be fixed at one number.',
  },
  {
    code: "1A.4",
    kra: "1",
    group: "A · Talent Acquisition",
    title: "Interview coordination and feedback closure",
    weight: 3,
    measure: "sla",
    targetText: "Interview scheduled and feedback closed within 48 hours",
    target: 100,
    unit: "%",
    evidence: "Interview task, feedback timestamp",
    coverage: "system",
    source: { kind: "kpiFacts", module: HR, rowKeys: ["interview_1", "interview_2"], basis: "onTimeOfDone" },
  },
  {
    code: "1A.5",
    kra: "1",
    group: "A · Talent Acquisition",
    title: "Position closure within approved TAT",
    weight: 10,
    measure: "ratio",
    targetText: "Role closed within approved role-specific TAT",
    // The TAT is a PARAMETER, not the target: the line scores the SHARE of roles closed
    // inside it, against 100%. Scoring "30 days ÷ 30 days" would give a perfect mark to
    // a requisition that took a year.
    target: 100,
    unit: "%",
    param: { label: "Approved TAT", unit: "days", suggest: 30 },
    evidence: "Requisition open and closure dates",
    coverage: "unused",
    source: { kind: "hr", metric: "closure_within_tat" },
    gap: "The largest line on the sheet, blocked twice: no requisition has ever reached \"closed\" (every closed_at is a cancellation, and those are not counted), and no role-specific TAT is stored anywhere.",
  },
  {
    code: "1A.6",
    kra: "1",
    group: "A · Talent Acquisition",
    title: "Offer release, BGV, references, joining documentation",
    weight: 4,
    measure: "sla",
    targetText: "Completed within approved SLA i.e 7 working days of approval",
    target: 100,
    unit: "%",
    evidence: "Approval, offer release and checklist timestamps",
    coverage: "partial",
    source: { kind: "kpiFacts", module: HR, rowKeys: ["final_decision", "onboarding"], basis: "onTimeOfDone" },
    gap: "Scored from the offer and onboarding steps, which carry the module's own SLA. BGV is a real column now (`bgv_status`); reference checks are still only a checklist tick.",
  },

  // ── B · Buddy Program — 5% ──
  .../*#__PURE__*/ ([
    ["1B.1", "Buddy allocation", 1, "Within 24 hours of offer acceptance", "Buddy assignment timestamp"],
    ["1B.2", "Buddy Passport handover", 1, "Completed on Day 1", "Handover acknowledgement"],
    ["1B.3", "Department interactions", 1, "Minimum 8 interactions completed", "Department-wise sign-offs"],
    ["1B.4", "Buddy Passport closure", 1, "100% tasks and final sign-off completed", "Completed passport/checklist"],
    ["1B.5", "New joiner feedback", 1, "Average score at least 4/5", "Submitted feedback form"],
  ] as const).map(([code, title, weight, targetText, evidence]): KpiLine => ({
    code,
    kra: "1",
    group: "B · Buddy Program",
    title,
    weight,
    measure: code === "1B.3" ? "count" : code === "1B.5" ? "rating" : code === "1B.4" ? "ratio" : "sla",
    targetText,
    target: code === "1B.3" ? 8 : code === "1B.5" ? 4 : 100,
    unit: code === "1B.3" ? "interactions" : code === "1B.5" ? "of 5" : "%",
    evidence,
    coverage: "unused",
    source: { kind: "none" },
    gap: "The Buddy Program went live on 22-09-2026 with allocation, interactions and the joiner's rating. No buddy has been allocated on it yet.",
  })),

  // ── C · Probation Management — 10% ──
  .../*#__PURE__*/ ([
    ["1C.1", "7-Day Review", 1, "Completed on due date"],
    ["1C.2", "15-Day Review", 1.5, "Completed on due date"],
    ["1C.3", "30-Day Review", 1.5, "Completed on due date"],
    ["1C.4", "60-Day Review", 1.5, "Completed on due date"],
    ["1C.5", "90-Day Confirmation Review", 2, "Completed on or before due date"],
  ] as const).map(([code, title, weight, targetText]): KpiLine => ({
    code,
    kra: "1",
    group: "C · Probation Management",
    title,
    weight,
    measure: "sla",
    targetText,
    target: 100,
    unit: "%",
    evidence: "Review submission timestamp",
    coverage: "unused",
    source: { kind: "none" },
    gap: "fms_hr_probation_checkins carries Day 7 / 15 / 30 / 60 / 90 as exact rows, each with a due date. No real probation has been opened on it.",
  })),
  {
    code: "1C.6",
    kra: "1",
    group: "C · Probation Management",
    title: "Employee concerns / grievances",
    weight: 1,
    measure: "sla",
    targetText: "Closed within 24 hours of reporting",
    target: 100,
    unit: "%",
    evidence: "Ticket/open-close timestamps",
    coverage: "unused",
    source: { kind: "none" },
    gap: "fms_hr_grievances opens and closes a concern with a timestamp on each end. Nobody has raised one.",
  },
  {
    code: "1C.7",
    kra: "1",
    group: "C · Probation Management",
    title: "Probation closure",
    weight: 1.5,
    measure: "sla",
    targetText: "Confirmation decision completed before due date",
    target: 100,
    unit: "%",
    evidence: "Decision and letter issuance record",
    coverage: "unused",
    source: { kind: "none" },
    gap: "fms_hr_probations carries the outcome, the final status and the confirmation letter. No real probation has reached it.",
  },

  // ══ KRA 2 · Learning & Development — 40% ═════════════════════════════════════
  // The whole KRA, and the single largest correction this file has had. On 21-09-2026
  // no training table existed anywhere. On 23-09 the module was built on a branch, and
  // within the same day it merged to master and deployed — fms_ld_sessions,
  // _nominations, _attendance, _feedback, _assignments, _plans and twenty more, all
  // live. Every line below is now a live screen nobody has used, not a build.
  .../*#__PURE__*/ ([
    ["2A.1", "A · Annual Training Calendar & Execution", "Annual training calendar publication", 2, "Uploaded by January with session dates and participant plan", "Approved calendar upload date", "ratio", 100, "%"],
    ["2A.2", "A · Annual Training Calendar & Execution", "Training calendar adherence", 5, "Planned sessions completed as scheduled", "Planned vs completed sessions and dates", "ratio", 100, "%"],
    ["2B.1", "B · Internal Training Management", "Annual internal training target", 5, "Minimum 15 internal trainings annually", "Completed session count", "count", 15, "sessions a year"],
    ["2B.2", "B · Internal Training Management", "Internal training plan adherence", 4, "Sessions completed as per approved calendar", "Planned vs actual completion", "ratio", 100, "%"],
    ["2C.1", "C · External Training Management", "Annual external training target", 7, "Minimum 48 external trainings annually", "Completed external session count", "count", 48, "sessions a year"],
    ["2C.2", "C · External Training Management", "External training plan adherence", 4, "Sessions completed as per approved calendar", "Planned vs actual completion", "ratio", 100, "%"],
    ["2D.1", "D · Training Administration & Learning Effectiveness", "Attendance capture", 1, "Attendance recorded for 100% sessions", "Attendance sheet / check-in record", "ratio", 100, "%"],
    ["2D.2", "D · Training Administration & Learning Effectiveness", "Feedback capture", 1, "Feedback collected for 100% sessions", "Feedback response record", "ratio", 100, "%"],
    ["2D.3", "D · Training Administration & Learning Effectiveness", "Training feedback quality", 1, "Average feedback score at least 4/5", "System-calculated average", "rating", 4, "of 5"],
    ["2D.4", "D · Training Administration & Learning Effectiveness", "Assignment circulation", 1, "Shared within 24 hours of session completion", "Assignment issue timestamp", "sla", 100, "%"],
    ["2D.5", "D · Training Administration & Learning Effectiveness", "Assignment submission rate", 1, "At least 80% submissions", "Assigned vs submitted count", "ratio", 80, "%"],
    ["2D.6", "D · Training Administration & Learning Effectiveness", "Evaluation closure", 1, "Completed within 7 days of submission", "Evaluation completion date", "sla", 100, "%"],
    ["2D.7", "D · Training Administration & Learning Effectiveness", "Assessment completion", 2, "At least 90% of nominated participants", "Nominated vs assessed count", "ratio", 90, "%"],
    ["2E.1", "E · Mandatory Compliance Training", "POSH training completion", 2, "100% applicable participant completion", "Participant completion records", "ratio", 100, "%"],
    ["2E.2", "E · Mandatory Compliance Training", "Safety training completion", 2, "100% applicable participant completion", "Participant completion records", "ratio", 100, "%"],
    ["2E.3", "E · Mandatory Compliance Training", "Compliance record update", 1, "Records updated within defined SLA", "Record update timestamp", "sla", 100, "%"],
  ] as const).map(([code, group, title, weight, targetText, evidence, measure, target, unit]): KpiLine => ({
    code,
    kra: "2",
    group,
    title,
    weight,
    measure,
    targetText,
    target,
    unit,
    evidence,
    coverage: "unused",
    source: { kind: "none" },
    gap: "L&D went live on 23-09-2026. This KRA is 40% of the score and every line of it now waits on somebody running a session, not on a build.",
  })),

  // ══ KRA 3 · FMS Task Management — 5% ═════════════════════════════════════════
  // The one KRA the hub already answers — it is what the live scorecard computes.
  {
    code: "3.1",
    kra: "3",
    group: "",
    title: "Task completion rate",
    weight: 2,
    measure: "ratio",
    targetText: "Completed HOD-assigned tasks ÷ total HOD-assigned tasks × 100",
    target: 100,
    unit: "%",
    evidence: "Track status and evidence",
    coverage: "system",
    source: { kind: "kpiFacts", module: TASKS, rowKeys: [], basis: "doneOfGiven" },
    gap: 'Scored over ALL her tasks. The sheet wants only tasks the HOD tagged "Special Category" with a KRA and bucket — the tasks table has no such fields, so nothing can be narrowed yet.',
  },
  {
    code: "3.2",
    kra: "3",
    group: "",
    title: "On-time completion rate",
    weight: 2,
    measure: "ratio",
    targetText: "Tasks closed on/before due date ÷ completed tasks × 100",
    target: 100,
    unit: "%",
    evidence: "Compare due date with closure date",
    coverage: "system",
    source: { kind: "kpiFacts", module: TASKS, rowKeys: [], basis: "onTimeOfDone" },
    gap: "Divided by tasks COMPLETED, not tasks given — the sheet's own base, and the live scorecard's.",
  },
  {
    code: "3.3",
    kra: "3",
    group: "",
    title: "Escalation before SLA breach",
    weight: 1,
    measure: "ratio",
    targetText: "Delayed-risk tasks escalated before due date ÷ total delayed-risk tasks × 100",
    target: 100,
    unit: "%",
    evidence: "Capture escalation timestamp",
    coverage: "no-data",
    source: { kind: "none" },
    gap: "Nothing in the hub escalates a task, and no escalation timestamp is stored anywhere.",
  },

  // ══ KRA 4 · Attendance, Behaviour & Process Discipline — 5% ══════════════════
  {
    code: "4.1",
    kra: "4",
    group: "",
    title: "Stakeholder / HOD feedback",
    weight: 1,
    measure: "judgement",
    targetText: "Documented review score as per approved rating scale",
    target: 100,
    unit: "%",
    evidence: "Quarterly review record",
    coverage: "judgement",
    source: { kind: "none" },
    gap: "A quarterly human review. There is no system evidence for this and there should not be.",
  },
  {
    code: "4.2",
    kra: "4",
    group: "",
    title: "Attendance and punctuality compliance",
    weight: 2,
    measure: "ratio",
    targetText: "75% Attendance and punctuality adherence as per approved attendance policy",
    target: 75,
    unit: "%",
    evidence: "Biometric / attendance record",
    coverage: "no-data",
    source: { kind: "none" },
    gap: "No attendance or biometric data reaches the hub at all. It would have to be fed in from wherever it is kept.",
  },
  {
    code: "4.3",
    kra: "4",
    group: "",
    title: "Cross-functional collaboration",
    weight: 1,
    measure: "judgement",
    targetText: "Assigned support tasks completed within agreed timeline with 0 grievance",
    target: 100,
    unit: "%",
    evidence: "Cross-functional FMS tasks",
    coverage: "judgement",
    source: { kind: "none" },
    gap: 'Tasks are measurable, but "cross-functional" and "0 grievance" are not marked on any of them.',
  },
  {
    code: "4.4",
    kra: "4",
    group: "",
    title: "Process discipline and confidentiality",
    weight: 1,
    measure: "judgement",
    targetText: "No substantiated breach; required records and escalations completed",
    target: 100,
    unit: "%",
    evidence: "Documented compliance / incident records",
    coverage: "judgement",
    source: { kind: "none" },
    gap: "An absence of incidents cannot be read off a database. A person confirms it.",
  },

  // ══ KRA 5 · Training Participation & Learning Compliance — 5% ════════════════
  // Saloni as a PARTICIPANT, where KRA 2 is Saloni as the organiser. Both read the same
  // live module, and both read zero until somebody runs a session.
  .../*#__PURE__*/ ([
    ["5.1", "Assigned training attendance", 2, "Attend 100% of trainings assigned/nominated", "Orange Hub attendance / session record", 100, "%"],
    ["5.2", "Training assignment completion", 2, "Complete and submit 100% mandatory assignments within due date", "Assignment submission timestamp", 100, "%"],
    ["5.3", "Assessment and learning closure", 1, "Complete mandatory assessment and training closure requirements within SLA", "Assessment result / training closure record", 100, "%"],
  ] as const).map(([code, title, weight, targetText, evidence, target, unit]): KpiLine => ({
    code,
    kra: "5",
    group: "",
    title,
    weight,
    measure: code === "5.3" ? "sla" : "ratio",
    targetText,
    target,
    unit,
    evidence,
    coverage: "unused",
    source: { kind: "none" },
    gap: "Depends entirely on the Learning & Development module in KRA 2, which is live and has nothing recorded in it.",
  })),
];

export const saloniFramework: Framework = {
  id: "saloni-hr-executive",
  role: "HR Executive",
  source: "SALONI FINAL KPI -ORANGE HUB.docx · Final KPI & PMS Framework · fixed 100%",
  kras: [
    { code: "1", title: "Talent Acquisition, Buddy Program & Probation", weight: 45 },
    { code: "2", title: "Learning & Development", weight: 40 },
    { code: "3", title: "FMS Task Management", weight: 5 },
    { code: "4", title: "Attendance, Behaviour & Process Discipline", weight: 5 },
    { code: "5", title: "Training Participation & Learning Compliance", weight: 5 },
  ],
  lines,
};
