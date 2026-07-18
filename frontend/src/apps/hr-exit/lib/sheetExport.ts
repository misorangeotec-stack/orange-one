/**
 * ⭐ THE SHEET-PARITY EXPORT — the FMS tab of the Google Sheet, emitted from the app.
 *
 * HR is migrating off `1qckSuajNK1pRhsPjGMVauHODbcdKDmMkBOkboE6Njvs`, and during the
 * transition they have to be able to prove the app agrees with the sheet. So this emits
 * the sheet's own eleven stages, in the sheet's own column order, one row per case —
 * paste it beside the tab and the two reconcile line for line. It is a bridge, and it is
 * expected to be deleted once the sheet is.
 *
 * ── TWO DEFINITIONS THAT DECIDE EVERY COLUMN ─────────────────────────────────
 *
 * **"Planned Date" = THE SLA DUE DATE** (`exitDueIso`). That is precisely what the sheet's
 * Planned column always meant: the day the process says this step should land, not a day
 * anybody typed. Take it from the engine and the export inherits every rule the queue has
 * — the LWD-anchored steps that fall BEFORE the last working day, the payroll cut-off, the
 * clearance step dated on its earliest outstanding item — for free, and it cannot drift
 * from what the Control Center shows.
 *
 * **"Actual Date" = THE STEP'S AUTHORITATIVE TIMESTAMP** on the case header — never the
 * activity trail (`announce` swallows its own failures, so the trail can be missing a step
 * that definitely happened) and never a satellite's own date column.
 *
 * ── ⚠ WHY THIS IS COORDINATOR-ONLY, AND WHY THAT IS NOT A COMPROMISE ─────────
 *
 * Two of the eleven stages are RLS-gated satellites. The payroll/F&F figures live on
 * `fms_exit_settlements` and the interview content on `fms_exit_interviews`, and a viewer
 * who may not read them gets **ZERO ROWS** — not zeroes, not falses: **nothing**. An export
 * built for such a viewer would print "LWP Completed: No", "Notice Recovery: ₹0", "Exit
 * Feedback on Portal: No" for a case where all three were recorded — and it would print it
 * into a spreadsheet, which is the one artefact that outlives the screen, gets emailed to a
 * director and is believed.
 *
 * So the export lives on the **Control Center**, which is already gated on
 * `isProcessCoordinator` — and admin ∨ coordinator is a clause of the RLS policy on BOTH
 * satellites. The person who can run it is, by construction, a person who can read every
 * column in it. There is no partial, honest-looking version of this file for anybody else.
 *
 * The per-cell guards below (`canReadSettlement` / `canReadConfidential`) are therefore
 * belt-and-braces, and they fail to **"—"**, never to `0` / `No`. If the page's gate is
 * ever loosened, the export degrades to blanks rather than to fiction.
 */
import { exportRowsToXlsx, type ExportColumn } from "@/shared/lib/exportXlsx";
import { formatDateDMY } from "@/shared/lib/date";
import { formatDate } from "@/shared/lib/time";
import { CASE_STATUS_LABEL, CASE_TYPE_LABEL, RECOMMENDATION_LABEL, money, noticeLabel } from "./format";
import type { StepKey } from "./steps";
import { appName } from "@/apps/appInfo";
import type {
  ClearanceCheck,
  ExitAsset,
  ExitCase,
  ExitDocument,
  ExitHandover,
  ExitInterview,
  ExitSettlement,
  StepSkip,
} from "../types";

/** Everything the export needs from the store. Narrow on purpose — this file is pure. */
export interface SheetParityContext {
  cases: ExitCase[];
  departmentName: (id: string) => string;
  personName: (id: string | null) => string;
  reasonName: (id: string | null) => string;
  /** The SLA due date — the "Planned Date" of every stage. */
  dueIsoFor: (c: ExitCase, stepKey: StepKey) => string | null;
  assetsFor: (caseId: string) => ExitAsset[];
  handoverFor: (caseId: string) => ExitHandover | undefined;
  /** ⚠ RLS-gated. `undefined` means "not visible" as often as "not recorded". */
  interviewFor: (caseId: string) => ExitInterview | undefined;
  /** ⚠ RLS-gated. `undefined` means "not visible" as often as "not recorded". */
  settlementFor: (caseId: string) => ExitSettlement | undefined;
  documentsFor: (caseId: string) => ExitDocument[];
  checksFor: (caseId: string) => ClearanceCheck[];
  skipsFor: (caseId: string) => StepSkip[];
  /** May read the interview CONTENT. When false, those columns emit "—". */
  canReadConfidential: boolean;
  /** May read THIS case's settlement. When false, those columns emit "—". */
  canReadSettlement: (c: ExitCase) => boolean;
}

/** "Not visible / not applicable / not recorded" — never a 0 and never a false. */
const DASH = "—";

/** A LOCAL yyyy-mm-dd due date. Pure string split — never re-parsed as UTC. */
const planned = (iso: string | null): string => (iso ? formatDate(iso) : DASH);
/** A timestamptz. Converted to local before formatting, or it slips a day at night. */
const actual = (ts: string | null): string => (ts ? formatDateDMY(ts) : DASH);

const yesNo = (v: boolean): string => (v ? "Yes" : "No");

const joinNonEmpty = (parts: (string | null | undefined)[], sep = " · "): string =>
  parts.filter((p): p is string => !!p && p.trim() !== "").join(sep) || DASH;

/**
 * One step's status word, read from the header + the skip list.
 *
 * ⚠ A SKIPPED STEP IS "WAIVED", NOT "PENDING". It is complete-with-a-reason: it satisfies
 * every downstream guard and owes nobody anything. Reporting it as pending would put an
 * absconder's handover on HR's chase list forever.
 */
function stepStatus(ctx: SheetParityContext, c: ExitCase, step: StepKey, doneAt: string | null): string {
  if (doneAt) return "Completed";
  const skip = ctx.skipsFor(c.id).find((s) => s.stepKey === step);
  if (skip) return `Waived — ${skip.reason}`;
  if (c.status === "on_hold") return "On hold";
  if (c.status === "withdrawn" || c.status === "rejected") return CASE_STATUS_LABEL[c.status];
  return "Pending";
}

/* -------------------------------------------------------------------------- */
/*  The eleven stages                                                          */
/* -------------------------------------------------------------------------- */

export function sheetParityColumns(ctx: SheetParityContext): ExportColumn<ExitCase>[] {
  const S = (c: ExitCase): ExitSettlement | null => (ctx.canReadSettlement(c) ? (ctx.settlementFor(c.id) ?? null) : null);
  const I = (c: ExitCase): ExitInterview | null => (ctx.canReadConfidential ? (ctx.interviewFor(c.id) ?? null) : null);

  /** A settlement figure. "—" when unreadable OR unrecorded — never ₹0. */
  const cash = (c: ExitCase, pick: (s: ExitSettlement) => number | null): string => {
    if (!ctx.canReadSettlement(c)) return DASH;
    const s = ctx.settlementFor(c.id);
    if (!s) return DASH;
    const v = pick(s);
    return v === null ? DASH : money(v);
  };

  return [
    /* ---- the key. NOT on the sheet — the sheet has no stable id, which is half the
       reason it is being retired. Reconciling without one means eyeballing names. ---- */
    { header: "Exit No.", width: 14, value: (c) => c.exitNo },

    /* ---- Stage 1 · the resignation ---- */
    { header: "Date", width: 12, value: (c) => actual(c.submittedAt) },
    { header: "Department", width: 20, value: (c) => ctx.departmentName(c.departmentId) },
    { header: "Employee Code", width: 14, value: (c) => c.employeeCode },
    { header: "Employee Name", width: 24, value: (c) => c.employeeName },
    { header: "Designation", width: 22, value: (c) => c.designation ?? DASH },
    {
      header: "Reason for Resigning",
      width: 30,
      // The reason ON THE RESIGNATION (the wide-read header) — deliberately NOT the one
      // given in the exit interview, which is confidential and often a different answer.
      value: (c) => joinNonEmpty([ctx.reasonName(c.reasonId), c.reasonNote]),
    },
    {
      header: "Reporting Manager",
      width: 24,
      value: (c) =>
        joinNonEmpty([
          c.reportingManagerIds.map((id) => ctx.personName(id)).join(", ") || null,
          c.reportingManagerNote,
        ], " · "),
    },

    /* ---- Stage 2 · the reporting manager's review ---- */
    { header: "Planned Date of Review", width: 16, value: (c) => planned(ctx.dueIsoFor(c, "manager_review")) },
    { header: "Actual Date of Review", width: 16, value: (c) => actual(c.managerReviewedAt) },
    {
      header: "Status",
      width: 18,
      // A recommendation, never a veto — the case advanced whatever this says.
      value: (c) =>
        c.managerRecommendation
          ? RECOMMENDATION_LABEL[c.managerRecommendation]
          : stepStatus(ctx, c, "manager_review", c.managerReviewedAt),
    },
    { header: "Remarks", width: 30, value: (c) => c.managerRemarks ?? DASH },

    /* ---- Stage 3 · HR verification ---- */
    { header: "Planned Date of Review by HR", width: 18, value: (c) => planned(ctx.dueIsoFor(c, "hr_verification")) },
    { header: "Actual Date of Review by HR", width: 18, value: (c) => actual(c.hrVerifiedAt) },
    { header: "Confirm Notice Period", width: 18, value: (c) => noticeLabel(c.noticePeriodDays, c.noticeWaived) },
    { header: "Policy Applicability", width: 16, value: (c) => yesNo(c.policyApplicable) },
    {
      header: "Reason for Policy Not Applicable",
      width: 30,
      // Only meaningful when the policy does NOT apply. On an applicable case this is not
      // "no reason given", it is "the question was never asked".
      value: (c) => (c.policyApplicable ? DASH : (c.policyNaReason ?? DASH)),
    },

    /* ---- Stage 4 · the HR Head's approval ---- */
    { header: "Planned Date of Final Approval", width: 18, value: (c) => planned(ctx.dueIsoFor(c, "hr_head_approval")) },
    { header: "Actual Date of Final Approval", width: 18, value: (c) => actual(c.approvedAt) },
    {
      header: "Final Approval Remarks",
      width: 30,
      // The only terminal reject in the workflow lives here, so a rejected case must say so
      // rather than showing an empty approval cell.
      value: (c) => c.approvalRemarks ?? (c.rejectedAt ? `Rejected — ${c.rejectReason ?? "no reason given"}` : DASH),
    },

    /* ---- Stage 5 · the clearance task ---- */
    { header: "Planned Date of Clearance Task", width: 18, value: (c) => planned(ctx.dueIsoFor(c, "clearance")) },
    { header: "Actual Date of Clearance Task", width: 18, value: (c) => actual(c.clearanceCompletedAt) },
    {
      header: "Clearance Remarks",
      width: 30,
      value: (c) => {
        const checks = ctx.checksFor(c.id);
        const settled = checks.filter((k) => k.done || k.notApplicable).length;
        // The count is the useful remark: "3 of 8 cleared" is what HR reads off the sheet.
        const progress = checks.length ? `${settled} of ${checks.length} cleared` : "No checklist items";
        return joinNonEmpty([progress, c.clearanceRemarks]);
      },
    },

    /* ---- Stage 6 · the asset return (two signatures) ---- */
    { header: "Planned Date of Asset Return", width: 18, value: (c) => planned(ctx.dueIsoFor(c, "asset_return")) },
    { header: "Actual Date of Asset Return", width: 18, value: (c) => actual(c.assetsReturnedAt) },
    {
      header: "Asset Return Status",
      width: 20,
      value: (c) => {
        if (c.assetsReturnedAt) return "Completed";
        const assets = ctx.assetsFor(c.id);
        const pending = assets.filter((a) => a.status === "pending").length;
        if (!assets.length) return stepStatus(ctx, c, "asset_return", null);
        if (pending > 0) return `${pending} of ${assets.length} still pending`;
        return c.assetsHodSignedAt ? "Awaiting HR sign" : "Awaiting HOD sign";
      },
    },
    { header: "Asset Return Remarks", width: 30, value: (c) => joinNonEmpty([c.assetsHodRemarks, c.assetsHrRemarks]) },
    {
      header: "HOD Sign",
      width: 22,
      value: (c) =>
        c.assetsHodSignedAt ? `${ctx.personName(c.assetsHodSignedBy)} · ${actual(c.assetsHodSignedAt)}` : DASH,
    },
    {
      header: "HR Sign",
      width: 22,
      // HR's signature is what COMPLETES the step (it stamps assetsReturnedAt) — the HOD's
      // does not. The two columns are not interchangeable and the sheet knew it.
      value: (c) =>
        c.assetsHrSignedAt ? `${ctx.personName(c.assetsHrSignedBy)} · ${actual(c.assetsHrSignedAt)}` : DASH,
    },

    /* ---- Stage 7 · the handover & KT ---- */
    { header: "Planned Date of Handover", width: 18, value: (c) => planned(ctx.dueIsoFor(c, "handover")) },
    { header: "Actual Date of Handover", width: 18, value: (c) => actual(c.handoverCompletedAt) },
    {
      header: "Handover Status",
      width: 22,
      value: (c) => {
        if (c.handoverCompletedAt) return "Completed";
        const h = ctx.handoverFor(c.id);
        if (!h) return stepStatus(ctx, c, "handover", null);
        if (!h.managerConfirmedAt) return "Awaiting manager confirmation";
        return "Awaiting HR confirmation";
      },
    },
    {
      header: "Handover Remarks",
      width: 30,
      value: (c) => {
        const h = ctx.handoverFor(c.id);
        if (!h) return DASH;
        // KT survives the KT/handover merge as a flag on this row — it is a fact the sheet
        // tracked, so it has to come back out of the app.
        return joinNonEmpty([h.ktDone ? "KT done" : "KT not done", h.ktRemarks, h.notes, h.managerRemarks, h.hrRemarks]);
      },
    },
    {
      header: "HOD Confirm",
      width: 22,
      value: (c) => {
        const h = ctx.handoverFor(c.id);
        return h?.managerConfirmedAt
          ? `${ctx.personName(h.managerConfirmedBy)} · ${actual(h.managerConfirmedAt)}`
          : DASH;
      },
    },
    {
      header: "Work Handover To",
      width: 24,
      value: (c) => {
        const h = ctx.handoverFor(c.id);
        if (!h) return DASH;
        // A portal user OR a plain name — the work very often goes to someone with no login.
        return h.handoverToUserId ? ctx.personName(h.handoverToUserId) : (h.handoverToName ?? DASH);
      },
    },
    {
      header: "HR Confirmation",
      width: 22,
      value: (c) => {
        const h = ctx.handoverFor(c.id);
        return h?.hrConfirmedAt ? `${ctx.personName(h.hrConfirmedBy)} · ${actual(h.hrConfirmedAt)}` : DASH;
      },
    },

    /* ---- Stage 8 · payroll inputs.  ⚠ RLS-GATED SATELLITE (fms_exit_settlements) ---- */
    { header: "Planned Date of Payroll Inputs", width: 18, value: (c) => planned(ctx.dueIsoFor(c, "payroll_inputs")) },
    { header: "Actual Date of Payroll Inputs", width: 18, value: (c) => actual(c.payrollDoneAt) },
    // Status reads the HEADER (wide-read), so it is honest for every viewer.
    { header: "Payroll Inputs Status", width: 18, value: (c) => stepStatus(ctx, c, "payroll_inputs", c.payrollDoneAt) },
    {
      header: "LWP Completed",
      width: 14,
      // ⚠ "—", NEVER "No". A non-reader gets zero rows from the settlement, and "No" would
      // assert as fact the very thing RLS refused to tell them.
      value: (c) => {
        const s = S(c);
        return s ? yesNo(s.lwpCompleted) : DASH;
      },
    },
    {
      header: "Notice Recovery",
      width: 18,
      value: (c) => {
        if (!ctx.canReadSettlement(c)) return DASH;
        const s = ctx.settlementFor(c.id);
        if (!s) return DASH;
        const parts: string[] = [];
        if (s.noticeRecoveryDays !== null) parts.push(`${s.noticeRecoveryDays} days`);
        if (s.noticeRecoveryAmount !== null) parts.push(money(s.noticeRecoveryAmount));
        return parts.length ? parts.join(" · ") : DASH;
      },
    },
    { header: "Incentive", width: 14, value: (c) => cash(c, (s) => s.incentiveAmount) },
    { header: "Loan Recovery", width: 14, value: (c) => cash(c, (s) => s.loanRecoveryAmount) },
    { header: "Deduction", width: 14, value: (c) => cash(c, (s) => s.otherDeductions) },

    /* ---- Stage 9 · the exit interview.  ⚠ RLS-GATED SATELLITE (fms_exit_interviews) ---- */
    { header: "Planned Date of Exit Int.", width: 18, value: (c) => planned(ctx.dueIsoFor(c, "exit_interview")) },
    // The FACT lives on the wide-read header, so the date and the status are honest for
    // every viewer. Only the CONTENT is gated. That split is the whole design of M5.
    { header: "Actual Date of Exit Int.", width: 18, value: (c) => actual(c.interviewDoneAt) },
    { header: "Exit Interview Status", width: 18, value: (c) => stepStatus(ctx, c, "exit_interview", c.interviewDoneAt) },
    {
      header: "Exit Interview Remarks",
      width: 40,
      // ⚠ "—" for a non-reader. An exit interview exists to say things ABOUT the manager;
      // if this column can be read by the manager, it is a performance review with extra steps.
      value: (c) => I(c)?.remarks ?? DASH,
    },
    {
      header: "Exit Feedback on Portal",
      width: 18,
      value: (c) => {
        const i = I(c);
        return i ? yesNo(i.portalFeedbackDone) : DASH;
      },
    },

    /* ---- Stage 10 · the F&F.  Facts from the header; PEOPLE from the gated satellite ---- */
    { header: "Planned Date of FNF", width: 16, value: (c) => planned(ctx.dueIsoFor(c, "fnf_generate")) },
    {
      header: "Status of FNF Generation",
      width: 20,
      value: (c) => (c.fnfGeneratedAt ? actual(c.fnfGeneratedAt) : stepStatus(ctx, c, "fnf_generate", null)),
    },
    {
      header: "FNF Approved",
      width: 16,
      value: (c) => (c.fnfApprovedAt ? actual(c.fnfApprovedAt) : stepStatus(ctx, c, "fnf_approve", null)),
    },
    {
      header: "FNF Approved Person",
      width: 22,
      // WHO approved lives on the settlement, not the header → gated.
      value: (c) => {
        const s = S(c);
        return s?.fnfApprovedById ? ctx.personName(s.fnfApprovedById) : DASH;
      },
    },
    {
      header: "Status of FNF Payment Released",
      width: 22,
      value: (c) => (c.fnfPaidAt ? actual(c.fnfPaidAt) : stepStatus(ctx, c, "fnf_payment", null)),
    },
    {
      header: "Payment Released By",
      width: 22,
      value: (c) => {
        const s = S(c);
        return s?.fnfPaidById ? ctx.personName(s.fnfPaidById) : DASH;
      },
    },

    /* ---- Stage 11 · the letters, the acknowledgement, and the archive ---- */
    { header: "Planned Date of Letter gen.", width: 18, value: (c) => planned(ctx.dueIsoFor(c, "documents")) },
    { header: "Actual Date of Letter gen.", width: 18, value: (c) => actual(c.documentsIssuedAt) },
    {
      header: "Letter Status",
      width: 20,
      value: (c) => {
        const docs = ctx.documentsFor(c.id);
        if (!docs.length) return stepStatus(ctx, c, "documents", c.documentsIssuedAt);
        const issued = docs.filter((d) => !!d.issuedOn).length;
        return issued === docs.length ? "All issued" : `${issued} of ${docs.length} issued`;
      },
    },
    {
      header: "Document Handover Date",
      width: 18,
      // The letters reaching the person's hands — the LATEST of them, because the case is
      // not handed over until the last one is.
      value: (c) => {
        const dates = ctx.documentsFor(c.id).map((d) => d.handedOverOn).filter((d): d is string => !!d).sort();
        return dates.length ? planned(dates[dates.length - 1]) : DASH;
      },
    },
    {
      header: "Sign Copy received",
      width: 18,
      // ⭐ THE COMMONEST REAL FAILURE OF AN EXIT: letters issued, acknowledgement never
      // returned. `fms_exit_archive_case` refuses without it — so it gets its own column,
      // counted against the letters that were ACTUALLY ISSUED, not against the master list.
      value: (c) => {
        const issued = ctx.documentsFor(c.id).filter((d) => !!d.issuedOn);
        if (!issued.length) return DASH;
        const acked = issued.filter((d) => !!d.ackSignedPath).length;
        return acked === issued.length ? `Yes (${acked} of ${issued.length})` : `${acked} of ${issued.length}`;
      },
    },
    { header: "Status Change in System", width: 18, value: (c) => yesNo(c.systemStatusChanged) },
    { header: "Employee Archived", width: 16, value: (c) => (c.archivedAt ? actual(c.archivedAt) : "No") },

    /* ---- the case's own state, so a reconciler can see WHY a row stopped moving ---- */
    { header: "Case Type", width: 16, value: (c) => CASE_TYPE_LABEL[c.caseType] },
    { header: "Case Status", width: 18, value: (c) => CASE_STATUS_LABEL[c.status] },
    { header: "Last Working Day", width: 16, value: (c) => planned(c.lwd) },
  ];
}

/** Build and download the sheet-parity workbook. */
export function exportSheetParity(ctx: SheetParityContext): void {
  exportRowsToXlsx<ExitCase>({
    fileName: "HR_Exit_Sheet_Parity",
    sheetName: "FMS",
    title: `${appName("hr-exit")} — sheet parity (FMS tab layout)`,
    columns: sheetParityColumns(ctx),
    // Every case this user may read, oldest first — the order the sheet grows in.
    rows: [...ctx.cases].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt)),
    notes: [
      "One row per exit case, in the FMS tab's own eleven-stage column order, so the app can be reconciled line-for-line against the Google Sheet during the migration.",
      "'Planned Date' is the SLA DUE DATE the process gives that step (Setup → Due Dates) — not a date anyone typed. That is what the sheet's Planned column always meant. The asset return, the handover, the exit interview and the leave verification are due BEFORE the last working day; payroll inputs are due on the payroll cut-off of the month the last working day falls in.",
      "'Actual Date' is the step's authoritative timestamp on the case — the moment the action was recorded, never the activity trail.",
      "A step marked 'Waived' was skipped WITH A REASON. It is complete, not pending: it owes nobody anything and it satisfies every downstream check (an absconder has no handover; a terminated employee gets no relieving letter).",
      "A dash (—) means not recorded, not applicable, or not visible to the person who ran this export. It NEVER means zero. The payroll figures and the exit-interview remarks live in RLS-protected tables; this export is restricted to admins and process coordinators, who can read both — so on this file a dash means the value was genuinely never recorded.",
      "'Sign Copy received' counts acknowledgements against the letters that were ACTUALLY ISSUED. Letters issued with the signed copy never returned is the commonest way an exit is quietly left unfinished, and the archive refuses without it.",
      "Exit No. is not a column on the Google Sheet. It is added as the first column because the sheet has no stable key, and reconciling two hundred rows on employee name alone is how a duplicate hides.",
    ],
  });
}
