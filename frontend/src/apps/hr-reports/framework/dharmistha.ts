/**
 * Dharmistha's sheet, transcribed (KPI-3, read-only).
 *
 * SOURCE: files/HR KPI KRA SOP/Dharmistha_Prajapati_Final_KRA_KPI_2026.docx —
 * "FINAL KRA & KPI FRAMEWORK · Executive - HR & Admin".
 *
 * Every `targetText` and `evidence` is the document's own wording. `coverage` and `gap`
 * are what the hub can honour, read off the live schema on 28-09-2026.
 *
 * ⚠ SHE IS THE "Receptionist cum HR Executive" OF THE HELP DESK SHEET. That sheet
 *   names her by job title rather than by name, and she owns six of its thirty
 *   categories: Admin Requests, Office Assets / Stationery, Visitor Management,
 *   Insurance, Employee ID Card, and the IT Support category the client added on
 *   28-09-2026.
 *
 * ── TWO LINES THE HELP DESK ANSWERS ─────────────────────────────────────────
 *   KRA 4  "100% requests logged in Orange Hub … at least 95% routine office-
 *          maintenance requests closed within 3 working days". The sheet's
 *          "Orange Hub admin/facility tracker" is this module. 10%.
 *   KRA 9  "100% IT complaints logged and escalated to the IT consultancy partner
 *          Premware within 24 hours". 5% — and the reason the IT Support category
 *          exists at all, with its own external-escalation stamp.
 */
import type { Framework, KpiLine } from "./types";

const HELP = "help-desk";
const TASKS = "task-management";

const lines: KpiLine[] = [
  {
    code: "1.1",
    kra: "1",
    group: "",
    title: "Complete new joiner administration",
    weight: 15,
    measure: "sla",
    targetText:
      "100% HROne employee ID creation, department and reporting-manager mapping, official email ID and digital-signature requests, mandatory document collection, employee file creation, asset-allocation initiation and induction-kit issuance completed within 7 working days of date of joining",
    target: 100,
    unit: "%",
    evidence: "HROne employee creation timestamp, onboarding checklist, document tracker",
    coverage: "partial",
    source: { kind: "none" },
    gap: "New Recruitment carries the onboarding checklist, but this line is measured on HROne steps (employee ID, email, digital signature) that the hub does not hold.",
  },
  {
    code: "2.1",
    kra: "2",
    group: "",
    title: "PF and ESIC registration intimation",
    weight: 10,
    measure: "sla",
    targetText: "100% new-joiner PF and ESIC details/intimation shared with the statutory consultant within 3 working days of joining",
    target: 100,
    unit: "%",
    evidence: "PF/ESIC registration tracker, consultant intimation, acknowledgement",
    coverage: "no-data",
    source: { kind: "none" },
    gap: "No statutory tracker exists in the hub.",
  },
  {
    code: "3.1",
    kra: "3",
    group: "",
    title: "Employee master change accuracy and TAT",
    weight: 10,
    measure: "sla",
    targetText: "100% approved employee-master changes updated in HROne within 2 working days of receiving approved information",
    target: 100,
    unit: "%",
    evidence: "Approved change request, HROne audit trail, closure timestamp",
    coverage: "no-data",
    source: { kind: "none" },
    gap: "HROne's audit trail is not readable from here.",
  },
  {
    // ⚠ ONE OF THE TWO HELP DESK LINES.
    code: "4.1",
    kra: "4",
    group: "",
    title: "Admin and facility request closure",
    weight: 10,
    measure: "sla",
    targetText:
      "100% requests logged in Orange Hub. Zero avoidable stationery stock-out. At least 95% routine office-maintenance requests closed within 3 working days; unresolved cases escalated with reason and revised date",
    target: 95,
    unit: "%",
    evidence: "Orange Hub admin/facility tracker, stock register, vendor assignment and closure proof",
    coverage: "partial",
    source: { kind: "kpiFacts", module: HELP, rowKeys: ["resolve"], basis: "onTimeOfDone" },
    gap:
      "Scored on her Help Desk tickets. ⚠ TWO CAVEATS. (1) `rowKeys` is the resolve step " +
      "across ALL her categories, not only the admin ones — kpi_facts keys rows by STEP, not " +
      "by category, so this cannot be narrowed further without a change there. (2) The " +
      "“zero avoidable stock-out” half is not a ticket at all; nothing measures it.",
  },
  {
    code: "5.1",
    kra: "5",
    group: "",
    title: "Same-day CRM enquiry routing",
    weight: 5,
    measure: "sla",
    targetText: "100% inward CRM enquiries recorded and routed to the concerned Sales Coordinator within the same working day",
    target: 100,
    unit: "%",
    evidence: "CRM enquiry log, routing timestamp and recipient acknowledgement",
    coverage: "no-data",
    source: { kind: "none" },
    gap: "Leads Dashboard holds leads but records no routing event or timestamp.",
  },
  {
    code: "6.1",
    kra: "6",
    group: "",
    title: "Bill verification and submission TAT",
    weight: 8,
    measure: "sla",
    targetText: "100% assigned petty-cash, vendor and general office bills verified and submitted within 2 working days of receipt",
    target: 100,
    unit: "%",
    evidence: "Bill receipt log, verification checklist, submission timestamp",
    coverage: "no-data",
    source: { kind: "none" },
    gap: "No petty-cash or bill register in the hub.",
  },
  {
    code: "7.1",
    kra: "7",
    group: "",
    title: "Asset allocation and movement accuracy",
    weight: 7,
    measure: "sla",
    targetText: "100% asset allocation, transfer, return and other asset movement updated in Orange Hub within 1 working day",
    target: 100,
    unit: "%",
    evidence: "Asset audit trail, allocation/return acknowledgement and reconciliation report",
    coverage: "unused",
    source: { kind: "none" },
    gap: "Asset Maintenance is live and holds 40 real assets, but it records maintenance JOBS rather than allocation and movement. The movement half is not built.",
  },
  {
    code: "8.1",
    kra: "8",
    group: "",
    title: "Courier logging and dispatch TAT",
    weight: 5,
    measure: "sla",
    targetText: "100% inward and outward couriers logged on the same day. Approved outward dispatch completed within 2 hours of request during working hours",
    target: 100,
    unit: "%",
    evidence: "Courier register, consignment details, dispatch timestamp",
    coverage: "no-data",
    source: { kind: "none" },
    gap: "No courier register. ⚠ And note the two-hour target: the hub's due dates are day-granular throughout, so an hours SLA could not be rendered honestly even if the register existed.",
  },
  {
    // ⚠ THE SECOND HELP DESK LINE, and the reason the IT Support category exists.
    code: "9.1",
    kra: "9",
    group: "",
    title: "IT complaint logging, escalation and closure",
    weight: 5,
    measure: "sla",
    targetText:
      "100% IT complaints logged and escalated to the IT consultancy partner Premware within 24 hours. At least 90% routine cases resolved within 3 working days",
    target: 90,
    unit: "%",
    evidence: "IT ticket/register, consultancy escalation timestamp, follow-up and closure confirmation",
    coverage: "partial",
    source: { kind: "kpiFacts", module: HELP, rowKeys: ["resolve"], basis: "onTimeOfDone" },
    gap:
      "The IT Support category was added for this line on 28-09-2026 and carries an " +
      "external-escalation stamp for the Premware hand-off. ⚠ The RESOLUTION half is " +
      "scored here; the ESCALATION half (within 24 hours) is stored on the ticket but is " +
      "not yet a kpi_facts row, so it is not scored. And as on KRA 4, rowKeys cannot be " +
      "narrowed to one category.",
  },
  {
    code: "11.1",
    kra: "11",
    group: "",
    title: "On-time task completion",
    weight: 15,
    measure: "ratio",
    targetText: "Minimum 95% assigned Orange Hub FMS tasks completed within due date; upload evidence for 100% completed tasks",
    target: 95,
    unit: "%",
    evidence: "FMS dashboard and evidence",
    coverage: "system",
    source: { kind: "kpiFacts", module: TASKS, rowKeys: [], basis: "onTimeOfDone" },
  },
  {
    code: "12.1",
    kra: "12",
    group: "",
    title: "Individual process compliance",
    weight: 5,
    measure: "ratio",
    targetText: "Attendance compliance at least 75%; 100% assigned reports submitted within applicable timelines; 100% mandatory trainings completed",
    target: 75,
    unit: "%",
    evidence: "Attendance report, reporting log and training completion record",
    coverage: "no-data",
    source: { kind: "none" },
    gap: "Attendance is HROne's.",
  },
  {
    code: "13.1",
    kra: "13",
    group: "",
    title: "Professional conduct and coordination compliance",
    weight: 5,
    measure: "judgement",
    targetText: "Zero substantiated disciplinary action or policy violation. Cross-functional requests acknowledged within 1 working day",
    target: 100,
    unit: "%",
    evidence: "Disciplinary register, policy-violation record, escalation tracker",
    coverage: "judgement",
    source: { kind: "none" },
  },
];

export const dharmisthaFramework: Framework = {
  id: "dharmistha-hr-admin",
  role: "Executive - HR & Admin",
  source: "Dharmistha_Prajapati_Final_KRA_KPI_2026.docx · Final KRA & KPI Framework · fixed 100%",
  kras: [
    { code: "1", title: "New Joiner Onboarding and Employee Master Management", weight: 15 },
    { code: "2", title: "Compliance and Employee Registration", weight: 10 },
    { code: "3", title: "Employee Data and HROne Administration", weight: 10 },
    { code: "4", title: "Office Administration and Facility Management", weight: 10 },
    { code: "5", title: "CRM and Business Support", weight: 5 },
    { code: "6", title: "Finance, Petty Cash and Office Bills Coordination", weight: 8 },
    { code: "7", title: "Asset Management and Asset Tracking", weight: 7 },
    { code: "8", title: "Courier and Dispatch Management", weight: 5 },
    { code: "9", title: "IT Coordination", weight: 5 },
    { code: "11", title: "Orange Hub FMS Task Management", weight: 15 },
    { code: "12", title: "Attendance, Reporting and Training Compliance", weight: 5 },
    { code: "13", title: "Behaviour, Discipline and Cross-Departmental Coordination", weight: 5 },
  ],
  lines,
};
