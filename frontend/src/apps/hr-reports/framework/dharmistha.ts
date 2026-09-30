/**
 * Dharmistha's sheet, transcribed (HRREP-1, read-only).
 *
 * SOURCE: files/HR KPI KRA SOP/Dharmistha_Prajapati_Final_Updated_KRA_KPI_Insurance_ID_2026.docx —
 * "ORANGE O TEC · FINAL UPDATED KRA & KPI FRAMEWORK · Executive - HR & Admin | Insurance,
 * HROne ID and Exit Controls Added".
 *
 * Every `targetText` and `evidence` below is the document's own wording, copied, not
 * paraphrased. `coverage` and `gap` are NOT from the document: they are what the hub can
 * actually honour, read off `information_schema` and `kpi_facts` on 28-09-2026 and
 * corroborated by a full role-by-role walk of General Purchase the same day.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠ ONE LINE PER KRA, AND THAT IS A DELIBERATE LIMIT OF THIS TRANSCRIPTION.
 *
 * Saloni's and Tanisha's documents state a weight for every KPI, so their files carry
 * 44 and 38 lines. This document states weights for its twelve KRAs and for nothing
 * else — with one exception, §2's insurance breakup, which gives 5 / 2 / 3 and is split
 * here accordingly. Everywhere else a KRA bundles two to four separate SLAs under one
 * percentage: KRA 1 alone carries an HROne clock, a documents clock and a handover.
 *
 * Splitting those would mean INVENTING the weights, and an invented weight inside a
 * signed appraisal is worse than a coarse one. So each KRA is one line, its `targetText`
 * holds every sub-target verbatim, and its `gap` says which half the hub can see. Where
 * HR wants finer scoring they need only state a weight per sub-KPI — no code changes,
 * one more literal.
 *
 * ⚠ THE COVERAGE BAND IS THE HONEST READING OF THE WHOLE KRA, not its best part. KRA 1
 *   is `partial` because onboarding is measurable and HROne is not; it is not `system`.
 *
 * ⚠ HROne IS A DIFFERENT SYSTEM AND THE HUB TOUCHES NONE OF IT. Five of the twelve KRAs
 *   name it. The hub holds no HROne id, no activation or deactivation timestamp, and no
 *   link of any kind to it. Every "HROne" clause below is therefore unmeasurable here
 *   whatever else the line can see, and that is a statement about scope, not a gap to
 *   be built: it would need HROne to expose an API, or HR to key the dates in twice.
 *
 * ⚠ THE DOCUMENT NAMES "Assistant Manager - HR & Admin / HR-Admin Head" AS HER
 *   REPORTING MANAGER. The directory records her department as Human Resources and has
 *   no "Assistant Manager - HR & Admin" designation at all; the HR Head is Riya Kumari.
 *   Flagged rather than corrected — it is a title on a signed appraisal.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ── What this sheet is worth to the hub, and the hub to it ───────────────────
 * KRA 4 is General Purchase, line for line: "log 100% requests in Orange Hub; close at
 * least 95% routine maintenance requests within 3 working days". She owns the Handover
 * step of that module and the step's configured SLA IS 3 working days, so the clock the
 * sheet asks for and the clock the module keeps are the same clock. KRA 10 is Task
 * Management, and is the sheet's joint-largest at 15%.
 *
 * Those two — 25 of the 100 — are the lines that carry a live figure. Both are banded
 * `partial` rather than `system`, and for one shared reason worth stating once here:
 *
 * ⚠ THE ENGINE MEASURES ON TIME ÷ COMPLETED, AND THIS SHEET MEANS ÷ RECEIVED. A request
 *   or a task left open is invisible to the figure. So the number cannot fall while
 *   work piles up — it simply stops being produced when nothing is closed in the
 *   period, which is what KRA 4 does today: seven handovers against her name, three of
 *   them already past their due date, none closed, and therefore no percentage at all.
 *   A blank on that line is not an absence of evidence. It is the evidence.
 *
 * The other 75 is the finding, and it splits three ways that cost completely different
 * things: a module nobody has started using (Employee Exit, 10%), one that had not
 * shipped when this was written (Help Desk, 5% — it LANDED on 28-09-2026 and KRA 9 now
 * carries a live figure, so the finding is 70 not 75), and 28% with no table behind it
 * on any branch.
 */
import type { Framework, KpiLine } from "./types";

/** The module keys as `kpi_facts` spells them. `office-supplies` is General Purchase. */
const GP = "office-supplies";
/** Help Desk, live since 28-09-2026 — KRA 9. */
const HELP = "help-desk";
const TASKS = "task-management";
const HR = "hr";

const lines: KpiLine[] = [
  // ══ KRA 1 · New Joiner Onboarding and Employee Master Management — 15% ══════
  {
    code: "1",
    kra: "1",
    group: "",
    title: "Complete new joiner administration and user-ID activation",
    weight: 15,
    measure: "sla",
    targetText:
      "Create/activate HROne ID and complete department/reporting-manager mapping within 48 hours of DOJ. Complete official email, digital signature, mandatory documents, employee file, asset request and induction kit within 7 working days. Hand over Passport process to Saloni.",
    target: 100,
    unit: "%",
    evidence: "HROne timestamp, onboarding checklist, IT requests, file checklist and handover record",
    coverage: "partial",
    source: { kind: "kpiFacts", module: HR, rowKeys: ["onboarding"], basis: "onTimeOfDone" },
    gap:
      "Scored from the New Recruitment Onboarding step, which carries its own SLA and is the only part of this KRA with a clock in the hub. Behind it sit 4 onboardings and 40 ticked checks, including \"Seating arrangement, system, SIM handover, records\" and \"Complete filing of records internally\". NOT scored, because nothing records them: the HROne id and its 48-hour activation, the department / reporting-manager mapping event, the official email, the digital signature, and the passport handover to Saloni. The asset request has a home — General Purchase — but no onboarding row links to one.",
  },

  // ══ KRA 2 · Compliance, Employee Registration and Insurance — 10% ═══════════
  // The ONLY sub-weights the document states: §2 gives 5 / 2 / 3.
  {
    code: "2.1",
    kra: "2",
    group: "Insurance / Compliance",
    title: "PF and ESIC registration / consultant coordination",
    weight: 5,
    measure: "sla",
    targetText: "Within 3 working days of joining; zero pending beyond SLA without escalation",
    target: 100,
    unit: "%",
    evidence: "Registration tracker and consultant acknowledgement",
    coverage: "no-data",
    source: { kind: "none" },
    gap:
      "There is no PF or ESIC table anywhere in the hub, and no field on a profile or an onboarding row that could hold one. The nearest thing is a recurring Task Management task called \"Compliance · PF and ESIC Payment\" — that is Finance paying the monthly challan, not HR registering a joiner, and it is somebody else's task.",
  },
  {
    code: "2.2",
    kra: "2",
    group: "Insurance / Compliance",
    title: "Insurance addition and deletion management",
    weight: 2,
    measure: "sla",
    targetText: "Addition within 3 working days of DOJ; deletion within 2 working days of LWD",
    target: 100,
    unit: "%",
    evidence: "Endorsement request and insurer/TPA confirmation",
    coverage: "no-data",
    source: { kind: "none" },
    gap:
      "⚠ The hub DOES track insurance, and it is the wrong insurance. Asset Maintenance holds policies for vehicles and buildings with renewal reminders; there is nothing for employee mediclaim, no dependants, no endorsement and no insurer or TPA. Reading the asset policies as this line would score her on somebody else's renewals.",
  },
  {
    code: "2.3",
    kra: "2",
    group: "Insurance / Compliance",
    title: "Insurance claims intimation and follow-up",
    weight: 3,
    measure: "sla",
    targetText: "Same-working-day intimation; weekly follow-up until claim is processed/settled",
    target: 100,
    unit: "%",
    evidence: "Claim register, intimation, follow-up and closure evidence",
    coverage: "no-data",
    source: { kind: "none" },
    gap:
      "No claim register of any kind. And the same-working-day clock could not be expressed even if there were one: every SLA in the hub is in WORKING DAYS, through a step engine shared by ten modules.",
  },

  // ══ KRA 3 · Employee Data, HROne and User-ID Administration — 10% ═══════════
  {
    code: "3",
    kra: "3",
    group: "",
    title: "Employee master changes and exit deactivation",
    weight: 10,
    measure: "sla",
    targetText:
      "Update approved promotion, designation, department, reporting manager, transfer, confirmation and master changes within 2 working days. For separation, deactivate HROne ID and initiate closure/deactivation of official email and applicable IDs/access within 2 working days of LWD. Maintain 100% audit trail.",
    target: 100,
    unit: "%",
    evidence: "Approved request, HROne audit trail, IT/access closure request and timestamp",
    coverage: "unused",
    source: { kind: "none" },
    gap:
      "The exit half is BUILT AND UNUSED, which is the cheapest kind of gap there is. Employee Exit carries a clearance item worded almost as this line is — \"Laptop, email disable, system access, software licences\" — plus \"ID card, access card, keys, furniture, uniform\", each with an owner and a due date. `fms_exit_cases` holds ZERO rows: not one separation has been run through it. Start using it and this half scores itself. The master-change half is a genuine build: a profile is edited in Admin → Users and only `updated_at` moves, so there is no approved-request date to measure two working days from, and no audit of what changed.",
  },

  // ══ KRA 4 · Office Administration and Facility Management — 10% ═════════════
  // The one line on this sheet the hub answers end to end.
  {
    code: "4",
    kra: "4",
    group: "",
    title: "Admin and facility request closure",
    weight: 10,
    measure: "sla",
    targetText:
      "Log 100% requests in Orange Hub; zero avoidable stationery stock-out; close at least 95% routine maintenance requests within 3 working days; escalate unresolved cases with reason and revised date.",
    target: 95,
    unit: "%",
    evidence: "Orange Hub tracker, stock register, vendor assignment and closure proof",
    coverage: "partial",
    source: { kind: "kpiFacts", module: GP, rowKeys: ["handover"], basis: "onTimeOfDone" },
    gap:
      "Scored from the General Purchase Handover step, which she owns and whose configured SLA is exactly the 3 working days this line asks for. Three caveats, and the first is the one that matters. ⚠ THE DENOMINATOR IS REQUESTS CLOSED, NOT REQUESTS RECEIVED: the engine offers on-time ÷ completed, so a request left open never counts against this figure, and if none is closed in the period the line produces no number at all rather than a low one. The sheet plainly means 95% of what came in. Read it beside the open and overdue counts, never alone. Then: \"zero avoidable stationery stock-out\" has nothing behind it — the module tracks requests, not stock, and has no re-order level, no on-hand quantity and no stock-out event. And \"log 100% of requests in Orange Hub\" is unmeasurable FROM INSIDE the hub by construction: a request somebody handled over WhatsApp leaves no row to count.",
  },

  // ══ KRA 5 · CRM and Business Support — 5% ══════════════════════════════════
  {
    code: "5",
    kra: "5",
    group: "",
    title: "Same-day CRM enquiry routing",
    weight: 5,
    measure: "ratio",
    targetText:
      "Record and route 100% inward CRM enquiries to the concerned Sales Coordinator on the same working day with complete information and urgency classification.",
    target: 100,
    unit: "%",
    evidence: "CRM log, routing timestamp and acknowledgement",
    coverage: "no-data",
    source: { kind: "none" },
    gap:
      "⚠ The hub has a Leads screen with 205 rows, and it is not this. `app_leads` is a PERSONAL capture log — who I met, which company, how interested — keyed to the person who typed it. It has no inward-enquiry concept, nobody to route to, no routing timestamp, no urgency field and no acknowledgement. Scoring this line off it would measure the sales team's own note-taking.",
  },

  // ══ KRA 6 · Finance, Petty Cash and Office Bills — 8% ══════════════════════
  {
    code: "6",
    kra: "6",
    group: "",
    title: "Bill verification and submission control",
    weight: 8,
    measure: "judgement",
    targetText:
      "Verify bills and supporting documents before submission; maintain petty-cash entries and reconciliation; track utility/office bills and vendor/Finance follow-up without avoidable delay.",
    target: null,
    unit: "%",
    evidence: "Bill register, petty-cash register, approvals and submission evidence",
    coverage: "no-data",
    source: { kind: "none" },
    gap:
      "Bills, petty cash and vendor payment live in Tally, which the hub reads for receivables and for nothing else. There is no bill register, no petty-cash ledger and no utility-bill tracker in any module. The line also states no numeric target — \"without avoidable delay\" — so even with a register somebody would have to say what good looks like before it could be scored.",
  },

  // ══ KRA 7 · Asset Management and HROne Asset Tracking — 7% ═════════════════
  {
    code: "7",
    kra: "7",
    group: "",
    title: "Asset movement accuracy",
    weight: 7,
    measure: "ratio",
    targetText:
      "Update 100% asset allocation, transfer and return movements in HROne/Orange Hub with employee acknowledgement and traceable reconciliation.",
    target: 100,
    unit: "%",
    evidence: "Asset register and employee acknowledgement",
    coverage: "partial",
    source: { kind: "none" },
    gap:
      "The register is real — 40 assets, live since 14-09-2026, each with a custodian. But this line asks for MOVEMENTS and the register holds a STATE: `custodian_user_id` is one column, and reassigning an asset overwrites it. There is no allocation / transfer / return event, no from-and-to, and no employee acknowledgement anywhere. ⚠ And the custodians themselves are provisional: 11 of the 17 tracked assets have nobody named and six carry placeholder names lifted from the insurance policies, so a completeness score today would be measuring a half-filled register.",
  },

  // ══ KRA 8 · Courier and Dispatch Management — 5% ═══════════════════════════
  {
    code: "8",
    kra: "8",
    group: "",
    title: "Dispatch tracking and closure",
    weight: 5,
    measure: "ratio",
    targetText: "Maintain 100% dispatch records, tracking numbers and delivery follow-up until closure.",
    target: 100,
    unit: "%",
    evidence: "Courier register, POD and status",
    coverage: "no-data",
    source: { kind: "none" },
    gap:
      "⚠ Order to Dispatch is a different dispatch. It runs a customer SALES order from credit check to gate-out and delivery confirmation; this line is the office courier book — documents, cheques, samples going out by Blue Dart. Same word, different register, and nothing in the hub holds the second one.",
  },

  // ══ KRA 9 · IT Coordination — 5% ═══════════════════════════════════════════
  {
    code: "9",
    kra: "9",
    group: "",
    title: "IT complaint escalation and follow-up",
    weight: 5,
    measure: "sla",
    targetText: "Log and escalate IT complaints on receipt and follow up daily until resolution or overdue escalation.",
    target: 100,
    unit: "%",
    evidence: "Ticket, escalation and closure record",
    coverage: "partial",
    source: { kind: "kpiFacts", module: HELP, rowKeys: ["resolve"], basis: "onTimeOfDone" },
    gap:
      "The Help Desk LANDED on 28-09-2026 and this line is live. It is scored on the resolve step of her Help Desk tickets, and the IT Support category exists BECAUSE of this KRA \u2014 it was not in the source sheet's 27 and the client added it for exactly this line, with an external-escalation stamp for the Premware hand-off. \u26a0 TWO LIMITS REMAIN. (1) `rowKeys` is the resolve step across ALL her categories, not only IT: kpi_facts keys rows by STEP, not by category, so it cannot be narrowed without a change there. (2) The ESCALATION half \u2014 \u201cwithin 24 hours\u201d to Premware \u2014 is stored on the ticket but is not yet a kpi_facts row, so the RESOLUTION half is scored and the escalation half is not. Still `partial`, for a different reason than before.",
  },

  // ══ KRA 10 · Orange Hub FMS Task Management — 15% ══════════════════════════
  {
    code: "10",
    kra: "10",
    group: "",
    title: "On-time task completion",
    weight: 15,
    measure: "ratio",
    targetText:
      "Complete at least 95% assigned Orange Hub FMS tasks within due date; upload evidence for 100% completed tasks; record reason, revised date and escalation for overdue tasks.",
    target: 95,
    unit: "%",
    evidence: "FMS dashboard and evidence",
    coverage: "partial",
    source: { kind: "kpiFacts", module: TASKS, rowKeys: [], basis: "onTimeOfDone" },
    gap:
      "Scored over every task assigned to her, on the task's own due date. ⚠ SAME DENOMINATOR CAVEAT AS KRA 4: on time ÷ COMPLETED, so a task left open is invisible to this figure. The other two clauses are not scored either: evidence upload is not counted anywhere, and a revised date and an escalation reason are not fields a task carries — the three things the sheet makes mandatory for an overdue task. ⚠ And read the headline with the module's two known traps in mind: a bulk-closed task carries the sweep's timestamp rather than the day the work was done, and a recurring task exists a day before it is due.",
  },

  // ══ KRA 11 · Attendance, Reporting and Training Compliance — 5% ════════════
  {
    code: "11",
    kra: "11",
    group: "",
    title: "Individual process compliance",
    weight: 5,
    measure: "ratio",
    targetText:
      "Maintain at least 75% attendance; submit 100% assigned reports on time; complete 100% mandatory training within assigned timeline.",
    target: 100,
    unit: "%",
    evidence: "Attendance, reporting and training records",
    coverage: "partial",
    source: { kind: "none" },
    gap:
      "One of the three is measurable and the other two are not. Learning & Development is live and holds mandatory programs, nominations, attendance per session and assignment submissions with an escalation date — so \"100% mandatory training within the assigned timeline\" could be scored the moment somebody states which programs are hers. Attendance is biometric and lives outside the hub entirely. And \"reports submitted on time\" is circular here: the weekly review report this sheet pairs with SAVES NOTHING — every box typed into it stays in that one browser — so the report cannot record its own submission.",
  },

  // ══ KRA 12 · Behaviour, Discipline and Cross-Departmental Coordination — 5% ═
  {
    code: "12",
    kra: "12",
    group: "",
    title: "Professional conduct and coordination",
    weight: 5,
    measure: "judgement",
    targetText:
      "Zero substantiated disciplinary/policy violation; acknowledge and progress cross-functional requests within applicable SLA; zero justified escalation due to avoidable delay or non-coordination.",
    target: null,
    unit: "%",
    evidence: "Escalation, policy and communication records",
    coverage: "judgement",
    source: { kind: "none" },
    gap:
      "By design a human judgement — there will never be system evidence of professional conduct. ⚠ And a zero here must never be read as a pass: \"no substantiated violation\" and \"nobody records violations\" produce the same zero, and only the first of those is good news. The hub does hold grievances (`fms_hr_grievances`), which is the nearest real record, and it is not the same question.",
  },
];

export const dharmisthaFramework: Framework = {
  id: "dharmistha-hr-admin-2026",
  role: "Executive - HR & Admin",
  source:
    "ORANGE O TEC · FINAL UPDATED KRA & KPI FRAMEWORK · Executive - HR & Admin | Insurance, HROne ID and Exit Controls Added (Dharmistha_Prajapati_Final_Updated_KRA_KPI_Insurance_ID_2026.docx)",
  kras: [
    { code: "1", title: "New Joiner Onboarding and Employee Master Management", weight: 15 },
    { code: "2", title: "Compliance, Employee Registration and Insurance Management", weight: 10 },
    { code: "3", title: "Employee Data, HROne and User-ID Administration", weight: 10 },
    { code: "4", title: "Office Administration and Facility Management", weight: 10 },
    { code: "5", title: "CRM and Business Support", weight: 5 },
    { code: "6", title: "Finance, Petty Cash and Office Bills Coordination", weight: 8 },
    { code: "7", title: "Asset Management and HROne Asset Tracking", weight: 7 },
    { code: "8", title: "Courier and Dispatch Management", weight: 5 },
    { code: "9", title: "IT Coordination", weight: 5 },
    { code: "10", title: "Orange Hub FMS Task Management", weight: 15 },
    { code: "11", title: "Attendance, Reporting and Training Compliance", weight: 5 },
    { code: "12", title: "Behaviour, Discipline and Cross-Departmental Coordination", weight: 5 },
  ],
  lines,
};
