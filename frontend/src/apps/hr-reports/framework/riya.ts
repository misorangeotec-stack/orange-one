/**
 * The HR Head's sheet, transcribed (KPI-3, read-only).
 *
 * SOURCE: files/HR KPI KRA SOP/Riya_Kumari_HR_Head_Final_Corrected_KRA_KPI_100_Percent.docx —
 * "FINAL KRA & KPI FRAMEWORK · HR Head", fourteen KRAs, corrected total 100%.
 *
 * ⚠ THIS SHEET MEASURES GOVERNANCE, NOT EXECUTION, and its own purpose statement
 *   says so: "Transactional execution remains with the respective process owners; the
 *   HR Head is measured on approval, oversight, review, escalation and closure
 *   governance." So most lines are about whether something was REVIEWED and CLOSED on
 *   time, not about who did it — and that is why so few of them can be scored from a
 *   step-based system. A step has an owner; a review has an opinion.
 *
 * ── WHAT THE HELP DESK ANSWERS ──────────────────────────────────────────────
 *   KRA 12  "Log 100% Level-3 grievances, disciplinary, POSH or legally sensitive
 *           matters on the authorised confidential register. Acknowledge/escalate
 *           critical cases within 1 working day." That register is
 *           `fms_help_confidential_register` (HD-10), which is gated to her and the
 *           ICC and carries the one-working-day measure per case. 5%.
 *   KRA 1   "Achieve at least 90% weighted average KPI achievement across HR-Admin,
 *           HR Operations, Talent Acquisition and Learning, and Employee
 *           Engagement/Travel." It rolls up the other four sheets, so it can only be
 *           scored once they are all live. 10%.
 *   KRA 11  The monthly HR review report. The MIS is the artefact; SUBMITTING it is
 *           still a human act nothing here records.
 */
import type { Framework, KpiLine } from "./types";

const HELP = "help-desk";
const HR = "hr";
const TASKS = "task-management";

const lines: KpiLine[] = [
  {
    code: "1.1",
    kra: "1",
    group: "",
    title: "Weighted HR team KPI achievement",
    weight: 10,
    measure: "ratio",
    targetText:
      "Achieve at least 90% weighted average KPI achievement across HR-Admin, HR Operations, Talent Acquisition and Learning, and Employee Engagement/Travel/Employer Branding. Conduct monthly team KPI review and issue corrective actions for gaps within 3 working days of review",
    target: 90,
    unit: "%",
    evidence: "HR dashboard, team KPI scorecards, review minutes and corrective-action tracker",
    coverage: "target-missing",
    source: { kind: "none" },
    gap:
      "A roll-up of the other four HR sheets. Saloni's, Tanisha's, Khushi's and " +
      "Dharmistha's are all written down now, so the arithmetic is possible — but the lab " +
      "scores one person at a time and has no cross-sheet aggregate yet. The corrective- " +
      "action half is a review artefact nothing records.",
  },
  {
    code: "2.1",
    kra: "2",
    group: "",
    title: "Payroll accuracy, approval and release control",
    weight: 8,
    measure: "sla",
    targetText: "Ensure 99.5% payroll accuracy and 100% payroll approval and salary release on or before the 5th calendar day of every month",
    target: 99.5,
    unit: "%",
    evidence: "Payroll register, HR Head approval, payroll checklist, exception log",
    coverage: "no-data",
    source: { kind: "none" },
    gap: "Payroll runs in HROne.",
  },
  {
    code: "3.1",
    kra: "3",
    group: "",
    title: "Compliance calendar and zero-penalty achievement",
    weight: 10,
    measure: "sla",
    targetText: "100% PF, ESIC, PT and applicable statutory activities completed on or before the 10th. Zero penalty, interest, notice or missed compliance",
    target: 100,
    unit: "%",
    evidence: "Compliance calendar, challans, filing proofs, audit report, risk register",
    coverage: "no-data",
    source: { kind: "none" },
    gap: "No compliance calendar in the hub.",
  },
  {
    code: "4.1",
    kra: "4",
    group: "",
    title: "Hiring plan and recruitment SLA governance",
    weight: 10,
    measure: "sla",
    targetText:
      "100% approved manpower requisitions tracked through Orange Hub. Recruitment closures to meet role-wise approved SLA and maintain at least 80% offer acceptance",
    target: 80,
    unit: "%",
    evidence: "Approved manpower plan, requisition dashboard, candidate pipeline, time-to-fill",
    coverage: "partial",
    source: { kind: "kpiFacts", module: HR, rowKeys: [], basis: "onTimeOfDone" },
    gap: "Scored across her New Recruitment steps. The offer-acceptance half is a ratio of candidates, not steps, and is not a kpi_facts row.",
  },
  {
    code: "5.1",
    kra: "5",
    group: "",
    title: "Training calendar completion and effectiveness",
    weight: 6,
    measure: "ratio",
    targetText: "At least 95% planned training completion and at least 80% effectiveness score. Mandatory compliance trainings 100% within the assigned cycle",
    target: 95,
    unit: "%",
    evidence: "Training calendar, attendance, assessment/feedback scores, action plan",
    coverage: "unused",
    source: { kind: "none" },
    gap: "Learning & Development is live and has nothing recorded in it. A training gap, not a build.",
  },
  {
    code: "6.1",
    kra: "6",
    group: "",
    title: "Quarterly PMS completion and calibration",
    weight: 10,
    measure: "sla",
    targetText: "100% organisation-wide PMS closure by fixed dates: Q1 15 April; Q2 15 July; Q3 15 October; Q4 15 January",
    target: 100,
    unit: "%",
    evidence: "PMS dashboard, calibration record, pending tracker and final recommendations",
    coverage: "no-data",
    source: { kind: "none" },
    gap: "There is no PMS module. The sheet's “Orange Hub PMS dashboard” describes something intended.",
  },
  {
    code: "7.1",
    kra: "7",
    group: "",
    title: "Policy and SOP finalisation, rollout and adoption",
    weight: 8,
    measure: "sla",
    targetText: "For every policy finalised, Knowledge Base update, HR Manual update, employee notification and acknowledgement workflow within 7 working days",
    target: 100,
    unit: "%",
    evidence: "Approval trail, policy version register, HR Manual, communication and acknowledgement report",
    coverage: "no-data",
    source: { kind: "none" },
    gap: "No policy register or knowledge base. Announcements records no version, owner or acknowledgement.",
  },
  {
    code: "8.1",
    kra: "8",
    group: "",
    title: "HR process digitisation and adoption",
    weight: 8,
    measure: "ratio",
    targetText: "Maintain at least 95% on-time completion of approved HR automation milestones and close identified data/process gaps within agreed action dates",
    target: 95,
    unit: "%",
    evidence: "Implementation tracker, module sign-offs, UAT records, issue log and adoption dashboard",
    coverage: "partial",
    source: { kind: "none" },
    gap: "The Master Report measures module ADOPTION and could answer half of this. The milestone plan itself lives in WORKLIST.md, not in the database.",
  },
  {
    code: "9.1",
    kra: "9",
    group: "",
    title: "Engagement calendar and employer brand delivery",
    weight: 5,
    measure: "ratio",
    targetText: "100% approved engagement activities executed as per calendar and budget, average participation at least 70%, employee feedback score at least 80%",
    target: 70,
    unit: "%",
    evidence: "Engagement calendar, participation, feedback survey, budget tracker",
    coverage: "no-data",
    source: { kind: "none" },
    gap: "Nothing records an engagement event. Same gap as Khushi's KRA 7, which owns the execution.",
  },
  {
    code: "10.1",
    kra: "10",
    group: "",
    title: "Budget adherence and vendor SLA control",
    weight: 5,
    measure: "ratio",
    targetText: "Keep annual HR and Administration expenditure within approved budget with variance not exceeding 5%",
    target: 5,
    unit: "% variance",
    evidence: "Approved budget, monthly actual-versus-budget MIS, variance note",
    coverage: "no-data",
    source: { kind: "none" },
    gap: "No HR budget is held in the hub.",
  },
  {
    code: "11.1",
    kra: "11",
    group: "",
    title: "Decision-ready HR review submission",
    weight: 5,
    measure: "sla",
    targetText:
      "Submit the consolidated Monthly HR Review Report to Directors by the 6th working day of every month, covering headcount, hiring, payroll, compliance, PMS, training, engagement, budget, risks and pending actions",
    target: 100,
    unit: "%",
    evidence: "Director report, dashboard extracts, submission timestamp and action tracker",
    coverage: "partial",
    source: { kind: "none" },
    gap:
      "The Help Desk MIS (HD-10) and the Master Report supply two of the ten sections she " +
      "has to consolidate. SUBMITTING the report is still a human act with no timestamp " +
      "anywhere, so the line cannot be scored even though the material exists.",
  },
  {
    // ⚠ THE HELP DESK LINE.
    code: "12.1",
    kra: "12",
    group: "",
    title: "Fair and timely escalation closure",
    weight: 5,
    measure: "sla",
    targetText:
      "Log 100% Level-3 grievances, disciplinary, POSH or legally sensitive matters on the authorised confidential register. Acknowledge/escalate critical cases within 1 working day and close within the formally approved case timeline",
    target: 100,
    unit: "%",
    evidence: "Confidential grievance register, investigation record, approval trail, closure note",
    coverage: "partial",
    source: { kind: "kpiFacts", module: HELP, rowKeys: ["acknowledge"], basis: "onTimeOfDone" },
    gap:
      "The register is fms_help_confidential_register (HD-10), gated to her and the ICC, " +
      "and it carries the one-working-day measure per case. ⚠ TWO LIMITS. (1) `rowKeys` is " +
      "the ACKNOWLEDGE step across all her categories — kpi_facts keys by step, not by " +
      "category, so this cannot be narrowed to the three confidential ones. (2) “Close " +
      "within the formally approved case timeline” has no timeline recorded anywhere: " +
      "POSH and disciplinary are deliberately UNTIMED categories, so their resolve steps " +
      "are dropped rather than scored.",
  },
  {
    code: "13.1",
    kra: "13",
    group: "",
    title: "Individual leadership compliance",
    weight: 5,
    measure: "ratio",
    targetText: "Maintain attendance compliance of at least 75%; complete at least 95% assigned Orange Hub FMS tasks within due date",
    target: 95,
    unit: "%",
    evidence: "Attendance record, FMS dashboard, reporting log and training record",
    coverage: "partial",
    source: { kind: "kpiFacts", module: TASKS, rowKeys: [], basis: "onTimeOfDone" },
    gap: "The FMS-task half is live. Attendance is HROne's.",
  },
  {
    code: "14.1",
    kra: "14",
    group: "",
    title: "Professional conduct and leadership coordination",
    weight: 5,
    measure: "judgement",
    targetText: "Zero substantiated disciplinary action or policy violation. Acknowledge cross-functional leadership requests within 1 working day",
    target: 100,
    unit: "%",
    evidence: "Escalation tracker, policy/disciplinary register, meeting action log",
    coverage: "judgement",
    source: { kind: "none" },
  },
];

export const riyaFramework: Framework = {
  id: "riya-hr-head",
  role: "HR Head",
  source:
    "Riya_Kumari_HR_Head_Final_Corrected_KRA_KPI_100_Percent.docx · Final KRA & KPI Framework · corrected total 100%",
  kras: [
    { code: "1", title: "Overall HR Function Governance", weight: 10 },
    { code: "2", title: "Payroll and HR Operations Governance", weight: 8 },
    { code: "3", title: "Statutory Compliance and Audit Governance", weight: 10 },
    { code: "4", title: "Talent Acquisition and Manpower Planning", weight: 10 },
    { code: "5", title: "Learning and Capability Development", weight: 6 },
    { code: "6", title: "Performance Management System Governance", weight: 10 },
    { code: "7", title: "HR Policy, SOP and Knowledge Governance", weight: 8 },
    { code: "8", title: "HR Transformation and Orange Hub Automation", weight: 8 },
    { code: "9", title: "Employee Engagement, Culture and Employer Branding Governance", weight: 5 },
    { code: "10", title: "HR Budget, Cost and Vendor Governance", weight: 5 },
    { code: "11", title: "HR MIS and Director Reporting", weight: 5 },
    { code: "12", title: "Employee Relations, Grievance and Risk Management", weight: 5 },
    { code: "13", title: "FMS, Attendance, Reporting and Training Compliance", weight: 5 },
    { code: "14", title: "Behaviour, Ownership and Cross-Functional Leadership", weight: 5 },
  ],
  lines,
};
