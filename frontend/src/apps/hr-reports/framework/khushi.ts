/**
 * Khushi's sheet, transcribed (KPI-3, read-only).
 *
 * SOURCE: files/HR KPI KRA SOP/Khushi_Soni_Final_Corrected_KRA_KPI_100_Percent.docx —
 * "ORANGE O TEC · FINAL REVISED KRA & KPI FRAMEWORK · HR Operations & Employee
 * Engagement | Orange Hub Mapping Ready".
 *
 * Every `targetText` and `evidence` below is the document's own wording, copied, not
 * paraphrased — so the page can be held against the sheet line by line. `coverage` and
 * `gap` are NOT from the document: they are what the hub can actually honour, read off
 * the live schema on 28-09-2026.
 *
 * ── WHY THIS SHEET EXISTS NOW ────────────────────────────────────────────────
 * KRA 5 is the Help Desk, word for word: "Helpdesk closure within SLA · at least 95%
 * tickets resolved within 2 working days · evidence: Helpdesk timestamps and escalation
 * log". Before the module there was nothing to point it at. It is the only line on this
 * sheet that is `system` today.
 *
 * ⚠ AND IT IS WORTH 5%, WHICH IS THE POINT. The live KRA/KPI Scorecard (KPI-1)
 *   weights by VOLUME, so 200 tickets a month would be most of her score there while
 *   her own sheet puts the desk at a twentieth of her job. That is exactly the gap this
 *   lab exists to show, and it is why `fms_rank_modules` installs Help Desk switched
 *   off.
 *
 * ⚠ MOST OF THIS SHEET IS `no-data`, HONESTLY. Payroll, attendance, PF/ESIC and PMS run
 *   in HROne, not here, and no amount of Help Desk work changes that. Saying so is more
 *   useful than mapping a line to something that merely sounds similar.
 */
import type { Framework, KpiLine } from "./types";

/** Help Desk's module key in kpi_facts, and Task Management's. */
const HELP = "help-desk";
const TASKS = "task-management";

const lines: KpiLine[] = [
  {
    code: "1.1",
    kra: "1",
    group: "",
    title: "Payroll accuracy and timely salary processing",
    weight: 15,
    measure: "sla",
    targetText: "99.5% payroll accuracy; salary released on or before the 5th calendar day",
    target: 99.5,
    unit: "%",
    evidence: "Payroll register, approval and salary release record",
    coverage: "no-data",
    source: { kind: "none" },
    gap: "Payroll runs in HROne. Nothing in this hub records a payroll run, its accuracy or its release date.",
  },
  {
    code: "2.1",
    kra: "2",
    group: "",
    title: "Attendance review, reconciliation and monthly freeze",
    weight: 10,
    measure: "sla",
    targetText: "Review every 15 days; freeze on last working day; zero pending corrections after freeze",
    target: 100,
    unit: "%",
    evidence: "HROne dashboard, correction log and freeze timestamp",
    coverage: "no-data",
    source: { kind: "none" },
    gap: "Attendance and the monthly freeze live in HROne. Help Desk carries attendance CORRECTION requests, which is a different thing — it would measure how fast she answers queries about attendance, not whether the freeze happened.",
  },
  {
    code: "3.1",
    kra: "3",
    group: "",
    title: "PF, ESIC, PT and compliance closure",
    weight: 10,
    measure: "sla",
    targetText: "Complete internally on or before the 10th; zero penalty or missed filing",
    target: 100,
    unit: "%",
    evidence: "Compliance calendar, challans, filing proof and audit report",
    coverage: "no-data",
    source: { kind: "none" },
    gap: "No compliance calendar exists in the hub. This is a build, not a report.",
  },
  {
    code: "4.1",
    kra: "4",
    group: "",
    title: "Quarterly PMS cycle completion",
    weight: 10,
    measure: "sla",
    targetText: "Close Q1 by 15 Apr, Q2 by 15 Jul, Q3 by 15 Oct and Q4 by 15 Jan",
    target: 100,
    unit: "%",
    evidence: "Orange Hub PMS dashboard and closure report",
    coverage: "no-data",
    source: { kind: "none" },
    gap: "The sheet names an “Orange Hub PMS dashboard”. There is no PMS module in the hub — the phrase describes something intended, not something built.",
  },
  {
    // ⚠ THE ONE LINE THIS MODULE WAS BUILT FOR.
    code: "5.1",
    kra: "5",
    group: "",
    title: "Helpdesk closure within SLA",
    weight: 5,
    measure: "sla",
    targetText: "At least 95% tickets resolved within 2 working days",
    target: 95,
    unit: "%",
    evidence: "Helpdesk timestamps and escalation log",
    coverage: "system",
    source: { kind: "kpiFacts", module: HELP, rowKeys: ["resolve"], basis: "onTimeOfDone" },
    gap:
      "Scored on the RESOLVE step. ⚠ The sheet says “within 2 working days”, but the " +
      "module times each ticket by its CATEGORY — an attendance correction is 1 day, a " +
      "payroll query 2, a PMS query 3 — so this measures each ticket against the promise " +
      "actually made to the employee rather than one flat number. Five categories are " +
      "deliberately untimed and are dropped rather than scored.",
  },
  {
    code: "6.1",
    kra: "6",
    group: "",
    title: "Reporting, policy, knowledge-base and document-control closure",
    weight: 10,
    measure: "sla",
    targetText: "Required reports by 5th working day; approved policy updates within 7 working days",
    target: 100,
    unit: "%",
    evidence: "MIS, version tracker, KB upload and acknowledgement",
    coverage: "no-data",
    source: { kind: "none" },
    gap: "There is no policy register or knowledge base in the hub. Announcements (PF-18) is the nearest thing and records no version, owner or effective date.",
  },
  {
    code: "7.1",
    kra: "7",
    group: "",
    title: "End-to-end engagement delivery and satisfaction",
    weight: 25,
    measure: "rating",
    targetText:
      "Execute approved calendar; minimum 80% feedback participation and 4.0/5 satisfaction; share approved pictures with the Marketing Agency and ensure 1-2 pictures are published on LinkedIn, Instagram, the Career Page or News Feed",
    target: 4,
    unit: "/ 5",
    evidence: "Calendar, approvals, attendance, photos, feedback and MIS",
    coverage: "no-data",
    source: { kind: "none" },
    gap:
      "Her single largest KRA, and nothing in the hub records an engagement event, its " +
      "attendance, its photographs or its feedback. ⚠ Note the Help Desk source sheet " +
      "assigns “Employee Engagement Activities” to Saloni; this document assigns the whole " +
      "area to Khushi at 25%, and the client confirmed Khushi on 28-09-2026.",
  },
  {
    code: "8.1",
    kra: "8",
    group: "",
    title: "On-time assigned task completion",
    weight: 5,
    measure: "ratio",
    targetText: "Minimum 95% tasks completed on or before due date with evidence",
    target: 95,
    unit: "%",
    evidence: "FMS dashboard and overdue report",
    coverage: "system",
    source: { kind: "kpiFacts", module: TASKS, rowKeys: [], basis: "onTimeOfDone" },
  },
  {
    code: "9.1",
    kra: "9",
    group: "",
    title: "Individual process compliance",
    weight: 5,
    measure: "ratio",
    targetText: "At least 75% attendance; all reports and mandatory training on time",
    target: 75,
    unit: "%",
    evidence: "Attendance, reports and training records",
    coverage: "no-data",
    source: { kind: "none" },
    gap: "Attendance is HROne's. The training half could come from Learning & Development once anything is recorded there.",
  },
  {
    code: "10.1",
    kra: "10",
    group: "",
    title: "Professional conduct and coordination",
    weight: 5,
    measure: "judgement",
    targetText: "Zero substantiated violation; requests acknowledged within 1 working day",
    target: 100,
    unit: "%",
    evidence: "Escalation, discipline and communication records",
    coverage: "judgement",
    source: { kind: "none" },
  },
];

export const khushiFramework: Framework = {
  id: "khushi-hr-operations",
  role: "HR Operations Executive - Employee Engagement",
  source:
    "Khushi_Soni_Final_Corrected_KRA_KPI_100_Percent.docx · Final Revised KRA & KPI Framework · fixed 100%",
  kras: [
    { code: "1", title: "Payroll Management", weight: 15 },
    { code: "2", title: "Attendance & Leave Management", weight: 10 },
    { code: "3", title: "Statutory Compliance", weight: 10 },
    { code: "4", title: "PMS Administration", weight: 10 },
    { code: "5", title: "Employee Queries, Loans & Advances", weight: 5 },
    { code: "6", title: "HR MIS, Policy & Knowledge Management", weight: 10 },
    { code: "7", title: "Employee Engagement, Culture, Celebration & Employer Branding", weight: 25 },
    { code: "8", title: "Orange Hub FMS Task Management", weight: 5 },
    { code: "9", title: "Attendance, Reporting & Training Compliance", weight: 5 },
    { code: "10", title: "Behaviour, Discipline & Cross-Departmental Coordination", weight: 5 },
  ],
  lines,
};
