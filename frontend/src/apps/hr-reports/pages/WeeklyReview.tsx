/**
 * The Weekly Review Report, rendered from live data (KPI-3, read-only).
 *
 * ⚠ IT SAVES NOTHING. Every figure it can read is live; every box a reader fills in
 *   themselves lives in that one browser (localStorage) and reaches no table, no
 *   colleague and no report. The banner on the page says so in those words, because
 *   somebody WILL fill it in and expect it kept. Gated to admins and HODs
 *   (RequireReports in HrApp.tsx).
 *
 * SOURCE: files/Weekly_Review_Report_TA_LD.docx, a BLANK form. The screen follows it top
 * to bottom in its own order and its own words, so the two can be held side by side.
 *
 * ── What this page is for ─────────────────────────────────────────────────────
 * The form asks Saloni to hand-count every box on it each week and her HR Head to sign
 * them. Section A is already in the hub — New Recruitment carries the requisitions, the
 * candidates and the interviews. Section C is live and has never been used. Printing the form
 * with the live figures already in place — and every unfillable box wearing the reason —
 * answers two questions at once: what would the weekly report look like if the hub
 * produced it, and what has to happen first. Both answers are on the screen rather than
 * in a document, so they cannot go stale while the client thinks about it.
 *
 * ── The one thing this page must never do ─────────────────────────────────────
 * Make a typed figure look like a read one. Every box carries its band, always, and a
 * box a reader fills by hand keeps the band that says the hub could not fill it. A
 * weekly report that cannot be audited is worse than no weekly report.
 *
 * It is NOT the framework scorecard next door: that one scores the job description and
 * produces a mark out of 100. This produces no score at all, because the form asks for
 * none — it asks what happened.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import Avatar from "@/shared/components/ui/Avatar";
import Card from "@/shared/components/ui/Card";
import Combobox from "@/shared/components/ui/Combobox";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { useSession } from "@/core/platform/session";
import { useDirectory } from "@/core/platform/store";
import type { Profile } from "@/core/platform/types";
import { cn } from "@/shared/lib/cn";
import { formatDate } from "@/shared/lib/time";
import PeriodControls from "@/apps/kra-kpi/components/PeriodControls";
import { periodLabel, rangeLabel, today, weekOf, type Period } from "@/apps/kra-kpi/lib/period";
import { inr, REQ_STATUS_LABEL } from "@/apps/hr-recruitment/lib/format";
import type { RequisitionStatus } from "@/apps/hr-recruitment/types";
import { LD_GAP, weeklyReviewForm } from "../report/weeklyReview";
import { formFor, jobsWithAForm } from "../framework/registry";
import { peopleInReach, reachOf } from "../lib/scope";
import { useViewers } from "../lib/viewers";
import NoSheet from "../components/NoSheet";
import { checkForm, coverageSplit, isAutoFilled, type FieldCoverage } from "../report/types";
import { useReportData, type OfferRow, type PositionRow } from "../report/data";
import { flagsOf, suggestedStatus, type Flag } from "../report/flags";
import { clearNotes, emptyNotes, loadNotes, saveNotes, typedCount, type ReportNotes, type WeekStatus } from "../report/notes";
import FieldMeter from "../components/FieldMeter";
import { BandBadge, BlockBar, Box, NoteInput, SectionBar, VsBenchmark } from "../components/ReportBits";

const ROLE_GROUP: Record<string, { label: string; rank: number }> = {
  admin: { label: "Admins", rank: 0 },
  hod: { label: "HODs", rank: 1 },
  sub_hod: { label: "Sub-HODs", rank: 2 },
  employee: { label: "Employees", rank: 3 },
};
const roleMeta = (role: string) => ROLE_GROUP[role] ?? ROLE_GROUP.employee;

/** The form's own benchmark row: "15 sourced | 8 screened | 5 shortlisted | 3 interviewed". */
const BENCHMARK = { sourced: 15, screened: 8, shortlisted: 5, interviewed: 3 };

const STATUS_PICK: { key: WeekStatus; label: string; cls: string; on: string }[] = [
  { key: "green", label: "● Green", cls: "text-[#1f8a4d] border-[#1f8a4d]/40", on: "bg-[#1f8a4d] text-white border-[#1f8a4d]" },
  { key: "amber", label: "▲ Amber", cls: "text-orange border-orange/40", on: "bg-orange text-white border-orange" },
  { key: "red", label: "■ Red", cls: "text-[#c0392b] border-[#c0392b]/40", on: "bg-[#c0392b] text-white border-[#c0392b]" },
];

const dash = (v: ReactNode | null | undefined) => (v === null || v === undefined || v === "" ? <span className="text-grey-2">—</span> : v);

export default function WeeklyReview() {
  const { user, isAdmin, role } = useSession();
  const { profiles, departments } = useDirectory();
  // ⚠ The form is a CONSTANT here only so the ~80-field literal has one name. Whether
  //   THIS person files it is `formFor` below, and the page renders the empty state
  //   instead when they do not. Every hook underneath runs either way.
  const form = weeklyReviewForm;

  const [period, setPeriod] = useState<Period>(() => weekOf(today()));
  const asOf = today();

  // Whose reports this reader may open. One rule, in one file — see lib/scope.ts.
  const viewers = useViewers();
  const isViewer = (viewers.data ?? []).some((v) => v.user_id === user.id);
  const reach = reachOf({ isAdmin, isViewer, role });
  const pool = useMemo<Profile[]>(() => peopleInReach(profiles, user, reach), [profiles, user, reach]);

  // ⚠ OPENS ON THE READER. It used to open on Saloni wherever she was visible, which
  //   was right for one HR sheet on a test page and wrong once every employee could
  //   open it — a head would land on somebody else's weekly review.
  const [personId, setPersonId] = useState<string>("");
  const activeId = personId || user.id;
  const person = pool.find((p) => p.id === activeId) ?? user;
  const reviewers = profiles.filter((p) => person.hodIds.includes(p.id));

  const deptName = (id: string | null) => (id ? (departments.find((d) => d.id === id)?.name ?? "—") : "—");
  const personDept = person.departmentId ? (departments.find((d) => d.id === person.departmentId)?.name ?? null) : null;
  // The form belongs to the JOB — re-asked whenever the chosen person changes.
  const personForm = formFor({ department: personDept, designation: person.designation });
  const personName = (id: string | null) => (id ? (profiles.find((p) => p.id === id)?.name ?? "—") : "—");

  /* ---------------------------------------------------------------- the notes */
  const [notes, setNotes] = useState<ReportNotes>(emptyNotes);
  useEffect(() => {
    setNotes(loadNotes(form.id, activeId, period.from, period.to));
  }, [form.id, activeId, period.from, period.to]);

  const patch = (fn: (n: ReportNotes) => ReportNotes) => {
    setNotes((prev) => {
      const next = fn(prev);
      saveNotes(form.id, activeId, period.from, period.to, next);
      return next;
    });
  };
  const putField = (code: string, v: string) => patch((n) => ({ ...n, fields: { ...n.fields, [code]: v } }));

  /* ----------------------------------------------------------------- the data */
  const q = useReportData(period.from, period.to, asOf);
  const data = q.data;
  const flags: Flag[] = useMemo(() => (data ? flagsOf(data, asOf) : []), [data, asOf]);
  const suggested = useMemo(() => suggestedStatus(flags), [flags]);

  const counts = useMemo(() => coverageSplit(form), [form]);
  // No test runner in this repo: the transcription checks itself on every render.
  const problems = useMemo(() => checkForm(form), [form]);
  const [band, setBand] = useState<FieldCoverage | null>(null);
  const typed = typedCount(notes);

  /* ----------------------------------------------------- one box, from the map */
  const byCode = useMemo(() => new Map(form.fields.map((f) => [f.code, f])), [form]);

  /**
   * ⚠ A PLAIN FUNCTION, NOT A COMPONENT. Declared inside the render, a component gets a
   *   new identity every keystroke, React unmounts and remounts it, and the input loses
   *   focus after the first character. A function that returns elements reconciles
   *   normally, so the box below can close over `notes` and still be typed into.
   */
  const fieldBox = (code: string, value?: ReactNode, opts?: { big?: boolean; children?: ReactNode }) => {
    const f = byCode.get(code);
    if (!f) return null; // checkForm() has already said so, loudly, above.
    const editable = !isAutoFilled(f.coverage);
    // Every Section C gap opens with the same sentence, and the banner above the section
    // already says it. Printed on all 24 boxes it pushed the part that differs — the
    // counting rule, the missing denominator, the certificate register — out of sight.
    const gap = f.gap?.startsWith(LD_GAP) ? f.gap.slice(LD_GAP.length).trim() || undefined : f.gap;
    return (
      <Box
        key={f.code}
        code={f.code}
        label={f.label}
        target={f.targetText || undefined}
        band={f.coverage}
        value={value}
        caveat={f.coverage === "live-partial" ? gap : undefined}
        gap={editable ? gap : undefined}
        selected={band}
        big={opts?.big}
      >
        {opts?.children ??
          (editable ? (
            <NoteInput
              label={f.label}
              value={notes.fields[f.code] ?? ""}
              onChange={(v) => putField(f.code, v)}
              placeholder="Type it here — stays in this browser"
            />
          ) : null)}
      </Box>
    );
  };

  /**
   * The line under a block bar: where this block's boxes come from.
   *
   * ⚠ It used to say "None of these 4 boxes can be filled from the hub" whenever no box
   *   was `live`, and on the Special KPI tracker that was simply untrue — SK-1 and SK-4
   *   read a real table and print a real figure; the table is empty. A reader who saw
   *   "0 of 25" under "cannot be filled" would rightly stop trusting the page. So the
   *   line names each band instead of collapsing four into "can" and "cannot".
   */
  const blockNote = (block: string) => {
    const fs = form.fields.filter((f) => f.block === block);
    if (fs.length === 0) return undefined;
    const n = (c: FieldCoverage | "auto") =>
      c === "auto" ? fs.filter((f) => isAutoFilled(f.coverage)).length : fs.filter((f) => f.coverage === c).length;
    const parts: string[] = [];
    if (n("auto")) parts.push(`${n("auto")} from live data`);
    if (n("empty-table")) parts.push(`${n("empty-table")} built but not used yet`);
    if (n("not-released")) parts.push(`${n("not-released")} built but not released`);
    if (n("no-table")) parts.push(`${n("no-table")} with nothing recording it`);
    if (n("narrative")) parts.push(`${n("narrative")} by hand, by design`);
    return `${fs.length} box${fs.length === 1 ? "" : "es"} — ${parts.join(", ")}.`;
  };

  /* --------------------------------------------------------------- the grids */
  const positions = data?.positions ?? [];
  const livePositions = positions.filter((p) => p.live);
  const offers = data?.offers ?? [];
  // The form's passport tracker follows a joiner for 90 days ("Passport closes at Day
  // 90"), so the tracker is not the week's joiners — it is everybody still inside their
  // passport at the end of the week.
  const passportFrom = (() => {
    const d = new Date(`${period.to}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 90);
    return d.toISOString().slice(0, 10);
  })();
  const joiners = offers.filter((o) => !!o.joiningDate && o.joiningDate >= passportFrom && o.joiningDate <= period.to);

  const statusLabel = (s: string) => REQ_STATUS_LABEL[s as RequisitionStatus] ?? s;

  const funnelColumns: QueueColumn<PositionRow>[] = [
    {
      key: "mrf",
      header: "MRF",
      cell: (p) => <span className="whitespace-nowrap text-[11.5px] text-grey">{p.mrfNo ?? "—"}</span>,
      sortValue: (p) => p.mrfNo ?? "",
      filter: { kind: "select", get: (p) => p.mrfNo ?? "" },
    },
    {
      key: "position",
      header: "Position",
      alwaysVisible: true,
      cell: (p) => (
        <span className="block truncate font-medium text-navy" title={p.title}>
          {p.title}
        </span>
      ),
      resize: { width: 240, min: 140, max: 600 },
      sortValue: (p) => p.title,
      filter: { kind: "select", get: (p) => p.title },
    },
    {
      key: "dept",
      header: "Dept.",
      cell: (p) => <span className="block truncate text-grey">{deptName(p.departmentId)}</span>,
      resize: { width: 150, min: 90, max: 320 },
      sortValue: (p) => deptName(p.departmentId),
      filter: { kind: "select", get: (p) => deptName(p.departmentId) },
    },
    {
      key: "status",
      header: "Status",
      cell: (p) => <span className="whitespace-nowrap text-grey">{statusLabel(p.status)}</span>,
      sortValue: (p) => statusLabel(p.status),
      filter: { kind: "select", get: (p) => statusLabel(p.status) },
    },
    {
      key: "sourced",
      header: "Sourced",
      align: "right",
      cell: (p) => (
        <span className="tabular-nums">
          <span className="font-semibold text-navy">{p.sourced}</span>
          {p.sourcedWeek > 0 && <span className="ml-1 text-[10.5px] text-orange">+{p.sourcedWeek}</span>}
        </span>
      ),
      sortValue: (p) => p.sourced,
      filter: { kind: "number", get: (p) => p.sourced },
      exportValue: (p) => p.sourced,
    },
    {
      key: "screened",
      header: "Screened",
      align: "right",
      cell: (p) => <span className="font-semibold tabular-nums text-navy">{p.screened}</span>,
      sortValue: (p) => p.screened,
      filter: { kind: "number", get: (p) => p.screened },
      exportValue: (p) => p.screened,
    },
    {
      key: "shortlisted",
      header: "Shortlisted",
      align: "right",
      cell: (p) => <span className="font-semibold tabular-nums text-navy">{p.shortlisted}</span>,
      sortValue: (p) => p.shortlisted,
      filter: { kind: "number", get: (p) => p.shortlisted },
      exportValue: (p) => p.shortlisted,
    },
    {
      key: "interviewed",
      header: "Interviewed",
      align: "right",
      cell: (p) => <span className="font-semibold tabular-nums text-navy">{p.interviewed}</span>,
      sortValue: (p) => p.interviewed,
      filter: { kind: "number", get: (p) => p.interviewed },
      exportValue: (p) => p.interviewed,
    },
    {
      key: "selected",
      header: "Selected",
      align: "right",
      cell: (p) => <span className="font-semibold tabular-nums text-navy">{p.selected}</span>,
      sortValue: (p) => p.selected,
      filter: { kind: "number", get: (p) => p.selected },
      exportValue: (p) => p.selected,
    },
    {
      key: "vsBenchmark",
      header: "Against the benchmark",
      cell: (p) =>
        p.live ? (
          <span className="flex flex-wrap gap-x-2 gap-y-0.5">
            <VsBenchmark actual={p.sourced} target={BENCHMARK.sourced} unit="sourced" />
            <VsBenchmark actual={p.screened} target={BENCHMARK.screened} unit="screened" />
          </span>
        ) : (
          <span className="text-[11px] text-grey-2">not a live position</span>
        ),
      resize: { width: 240, min: 140, max: 420 },
      // The benchmark only means anything on a position still taking CVs, so the column
      // sorts on the shortfall and reads "met" / "short" rather than restating numbers.
      sortValue: (p) => (p.live ? p.sourced - BENCHMARK.sourced : 999),
      filter: {
        kind: "select",
        get: (p) => (!p.live ? "Not a live position" : p.sourced >= BENCHMARK.sourced ? "Met the sourcing benchmark" : "Short of 15 sourced"),
      },
      exportValue: (p) => (p.live ? `${p.sourced} of ${BENCHMARK.sourced} sourced, ${p.screened} of ${BENCHMARK.screened} screened` : ""),
    },
  ];

  const ageingColumns: QueueColumn<PositionRow>[] = [
    {
      key: "mrf",
      header: "MRF",
      cell: (p) => <span className="whitespace-nowrap text-[11.5px] text-grey">{p.mrfNo ?? "—"}</span>,
      sortValue: (p) => p.mrfNo ?? "",
      filter: { kind: "select", get: (p) => p.mrfNo ?? "" },
    },
    {
      key: "position",
      header: "Position",
      alwaysVisible: true,
      cell: (p) => (
        <span className="block truncate font-medium text-navy" title={p.title}>
          {p.title}
        </span>
      ),
      resize: { width: 240, min: 140, max: 600 },
      sortValue: (p) => p.title,
      filter: { kind: "select", get: (p) => p.title },
    },
    {
      key: "dept",
      header: "Dept.",
      cell: (p) => <span className="block truncate text-grey">{deptName(p.departmentId)}</span>,
      resize: { width: 150, min: 90, max: 320 },
      sortValue: (p) => deptName(p.departmentId),
      filter: { kind: "select", get: (p) => deptName(p.departmentId) },
    },
    {
      key: "requested",
      header: "Requisition Date",
      cell: (p) => <span className="whitespace-nowrap text-grey">{formatDate(p.requestDate)}</span>,
      // Sorted and filtered on the ISO date, never on "14 Sep 2026", or the order is
      // alphabetical and April leads the year.
      sortValue: (p) => p.requestDate ?? "",
      filter: { kind: "date", get: (p) => p.requestDate ?? "" },
      exportValue: (p) => p.requestDate ?? "",
    },
    {
      key: "daysOpen",
      header: "Days Open",
      align: "right",
      cell: (p) => (
        <span
          className={cn(
            "font-semibold tabular-nums",
            p.daysOpen === null ? "text-grey-2" : p.daysOpen > 45 ? "text-[#c0392b]" : "text-navy",
          )}
        >
          {p.daysOpen ?? "—"}
        </span>
      ),
      sortValue: (p) => p.daysOpen ?? -1,
      filter: { kind: "number", get: (p) => p.daysOpen ?? 0 },
      exportValue: (p) => p.daysOpen ?? "",
    },
    {
      key: "stage",
      header: "Stage",
      cell: (p) => <span className="whitespace-nowrap text-grey">{p.stage}</span>,
      sortValue: (p) => p.stage,
      filter: { kind: "select", get: (p) => p.stage },
    },
    {
      key: "step",
      header: "Whose desk (the hub's own step)",
      defaultHidden: true,
      cell: (p) => <span className="whitespace-nowrap text-[11.5px] text-grey-2">{p.currentStep ?? "—"}</span>,
      sortValue: (p) => p.currentStep ?? "",
      filter: { kind: "select", get: (p) => p.currentStep ?? "" },
    },
    {
      key: "status",
      header: "Status",
      cell: (p) => <span className="whitespace-nowrap text-grey">{statusLabel(p.status)}</span>,
      sortValue: (p) => statusLabel(p.status),
      filter: { kind: "select", get: (p) => statusLabel(p.status) },
    },
    {
      key: "seats",
      header: "People wanted",
      align: "right",
      cell: (p) => <span className="tabular-nums text-grey">{p.seats}</span>,
      sortValue: (p) => p.seats,
      filter: { kind: "select", get: (p) => String(p.seats) },
      exportValue: (p) => p.seats,
    },
    {
      key: "flag",
      header: "Beyond 45 days",
      cell: (p) =>
        (p.daysOpen ?? 0) > 45 ? (
          <span className="inline-block whitespace-nowrap rounded border border-[#c0392b]/30 bg-[#c0392b]/[0.08] px-1.5 py-[1px] text-[11px] font-medium text-[#c0392b]">
            Flag
          </span>
        ) : (
          <span className="text-[11px] text-grey-2">—</span>
        ),
      sortValue: (p) => ((p.daysOpen ?? 0) > 45 ? 1 : 0),
      filter: { kind: "select", get: (p) => ((p.daysOpen ?? 0) > 45 ? "Flagged" : "Inside 45 days") },
      exportValue: (p) => ((p.daysOpen ?? 0) > 45 ? "Flag" : ""),
    },
  ];

  const offerColumns: QueueColumn<OfferRow>[] = [
    {
      key: "candidate",
      header: "Candidate",
      alwaysVisible: true,
      cell: (o) => (
        <span className="block truncate font-medium text-navy" title={o.candidate}>
          {o.candidate}
        </span>
      ),
      resize: { width: 200, min: 120, max: 420 },
      sortValue: (o) => o.candidate,
      filter: { kind: "select", get: (o) => o.candidate },
    },
    {
      key: "position",
      header: "Position",
      cell: (o) => (
        <span className="block truncate text-grey" title={o.title}>
          {o.title}
        </span>
      ),
      resize: { width: 200, min: 120, max: 460 },
      sortValue: (o) => o.title,
      filter: { kind: "select", get: (o) => o.title },
    },
    {
      key: "dept",
      header: "Dept.",
      cell: (o) => <span className="block truncate text-grey">{deptName(o.departmentId)}</span>,
      resize: { width: 150, min: 90, max: 320 },
      sortValue: (o) => deptName(o.departmentId),
      filter: { kind: "select", get: (o) => deptName(o.departmentId) },
    },
    {
      key: "offerDate",
      header: "Offer Date",
      cell: (o) =>
        o.offerDate ? (
          <span className="whitespace-nowrap text-grey">{formatDate(o.offerDate)}</span>
        ) : (
          <span className="whitespace-nowrap text-[11px] text-orange" title="The onboarding checklist item 'Offer letter sent' is ticked on the seeded test onboarding only.">
            not ticked
          </span>
        ),
      sortValue: (o) => o.offerDate ?? "",
      filter: { kind: "select", get: (o) => (o.offerDate ? "Ticked" : "Not ticked") },
      exportValue: (o) => o.offerDate ?? "not ticked",
    },
    {
      key: "ctc",
      header: "CTC (Rs.)",
      align: "right",
      cell: (o) => <span className="whitespace-nowrap tabular-nums text-navy">{o.ctc === null ? "—" : inr(o.ctc)}</span>,
      sortValue: (o) => o.ctc ?? -1,
      filter: { kind: "number", get: (o) => o.ctc ?? 0 },
      exportValue: (o) => o.ctc ?? "",
    },
    {
      key: "offerStatus",
      header: "Offer",
      cell: (o) => <span className="whitespace-nowrap text-grey">{o.offerStatus ?? "—"}</span>,
      sortValue: (o) => o.offerStatus ?? "",
      filter: { kind: "select", get: (o) => o.offerStatus ?? "" },
    },
    {
      key: "bgv",
      header: "BGV Status",
      // Three states, and the third is the one the form's flag list is actually asking
      // about — so a discrepancy is coloured like a problem, not like a completed step.
      cell: (o) =>
        o.bgvStatus ? (
          <span
            className={cn(
              "whitespace-nowrap",
              o.bgvStatus === "discrepancy" ? "font-semibold text-[#c0392b]" : o.bgvStatus === "clear" ? "text-[#1f8a4d]" : "text-grey",
            )}
          >
            {o.bgvStatus} {o.bgvAt ? `· ${formatDate(o.bgvAt)}` : ""}
          </span>
        ) : (
          <span className="whitespace-nowrap text-[11px] text-orange" title="`bgv_status` is live and holds pending / clear / discrepancy. Nobody has set it on this onboarding.">
            not recorded
          </span>
        ),
      resize: { width: 200, min: 110, max: 380 },
      sortValue: (o) => o.bgvStatus ?? "",
      filter: { kind: "select", get: (o) => o.bgvStatus ?? "Not recorded" },
      exportValue: (o) => (o.bgvStatus ? `${o.bgvStatus} ${o.bgvAt ?? ""}`.trim() : "not recorded"),
    },
    {
      key: "joiningDate",
      header: "Joining Date",
      cell: (o) => <span className="whitespace-nowrap text-grey">{formatDate(o.joiningDate)}</span>,
      sortValue: (o) => o.joiningDate ?? "",
      filter: { kind: "date", get: (o) => o.joiningDate ?? "" },
      exportValue: (o) => o.joiningDate ?? "",
    },
    {
      key: "joined",
      header: "Joined (Y/N)",
      cell: (o) =>
        o.joined ? (
          <span className="font-semibold text-[#1f8a4d]">Y</span>
        ) : o.joiningUnconfirmed ? (
          <span
            className="whitespace-nowrap text-[11px] text-orange"
            title="The joining date has passed and nobody has ticked the joining. A no-show and an untouched record look identical."
          >
            not ticked — date passed
          </span>
        ) : (
          <span className="text-grey-2">N</span>
        ),
      resize: { width: 190, min: 100, max: 340 },
      sortValue: (o) => (o.joined ? 2 : o.joiningUnconfirmed ? 1 : 0),
      filter: { kind: "select", get: (o) => (o.joined ? "Joined" : o.joiningUnconfirmed ? "Date passed, not ticked" : "Not yet due") },
      exportValue: (o) => (o.joined ? "Y" : o.joiningUnconfirmed ? "not ticked (date passed)" : "N"),
    },
  ];

  /**
   * B2's columns that have a table but no row yet. NOT the same as "no table", and the
   * wording has to keep them apart: this one is answered by somebody using a screen.
   *
   * ⚠ A plain function, deliberately — declared as a component it would take a new
   *   identity on every render and the inputs beside it would lose focus mid-word.
   */
  const unusedCell = (title: string, word = "not recorded") => (
    <span className="whitespace-nowrap text-[11px] text-orange" title={title}>
      {word}
    </span>
  );

  const joinerColumns: QueueColumn<OfferRow>[] = [
    {
      key: "joiner",
      header: "Joiner",
      alwaysVisible: true,
      cell: (o) => (
        <span className="block truncate font-medium text-navy" title={o.candidate}>
          {o.candidate}
        </span>
      ),
      resize: { width: 200, min: 120, max: 420 },
      sortValue: (o) => o.candidate,
      filter: { kind: "select", get: (o) => o.candidate },
    },
    {
      key: "dept",
      header: "Dept.",
      cell: (o) => <span className="block truncate text-grey">{deptName(o.departmentId)}</span>,
      resize: { width: 150, min: 90, max: 320 },
      sortValue: (o) => deptName(o.departmentId),
      filter: { kind: "select", get: (o) => deptName(o.departmentId) },
    },
    {
      key: "doj",
      header: "Date of Joining",
      cell: (o) => <span className="whitespace-nowrap text-grey">{formatDate(o.joiningDate)}</span>,
      sortValue: (o) => o.joiningDate ?? "",
      filter: { kind: "date", get: (o) => o.joiningDate ?? "" },
      exportValue: (o) => o.joiningDate ?? "",
    },
    {
      key: "arrived",
      header: "Joining ticked",
      cell: (o) => (o.joined ? <span className="font-semibold text-[#1f8a4d]">Y</span> : <span className="text-orange">not ticked</span>),
      sortValue: (o) => (o.joined ? 1 : 0),
      filter: { kind: "select", get: (o) => (o.joined ? "Ticked" : "Not ticked") },
      exportValue: (o) => (o.joined ? "Y" : "not ticked"),
    },
    {
      key: "buddy",
      header: "Buddy",
      cell: (o) =>
        o.buddyUserId ? (
          <span className="block truncate text-navy" title={o.buddyAllocatedAt ? `Allocated ${formatDate(o.buddyAllocatedAt)}` : undefined}>
            {personName(o.buddyUserId)}
            {o.buddyBeforeDay1 === false && <span className="ml-1 text-[11px] font-medium text-[#c0392b]">after Day 1</span>}
          </span>
        ) : (
          unusedCell("The Buddy Program is live (fms_hr_buddies). No buddy has been allocated to this joiner.", "none allocated")
        ),
      resize: { width: 190, min: 110, max: 340 },
      sortValue: (o) => (o.buddyUserId ? personName(o.buddyUserId) : ""),
      filter: { kind: "select", get: (o) => (o.buddyUserId ? personName(o.buddyUserId) : "None allocated") },
      exportValue: (o) => (o.buddyUserId ? personName(o.buddyUserId) : "none allocated"),
    },
    {
      key: "induction",
      header: "Induction ≤ 15 Days",
      cell: (o) =>
        o.inductionOn ? (
          <span className={cn("whitespace-nowrap", o.inductionWithin15 ? "text-[#1f8a4d]" : "font-semibold text-[#c0392b]")}>
            {formatDate(o.inductionOn)} {o.inductionWithin15 === false && "· late"}
          </span>
        ) : (
          unusedCell("`induction_on` is live on the onboarding. No induction has been recorded for this joiner.")
        ),
      resize: { width: 170, min: 110, max: 320 },
      sortValue: (o) => o.inductionOn ?? "",
      filter: { kind: "select", get: (o) => (o.inductionOn ? (o.inductionWithin15 ? "Within 15 days" : "Late") : "Not recorded") },
      exportValue: (o) => o.inductionOn ?? "not recorded",
    },
    {
      key: "connects",
      header: "Connects (of 8)",
      // The form counts a connect only when the person met signs it off, so this is the
      // CONFIRMED count. The target comes off the buddy record rather than the form's
      // literal 8 — and the department each connect belongs to is the one thing the
      // table still does not carry.
      cell: (o) =>
        o.connectsTarget === null ? (
          unusedCell("fms_hr_buddy_interactions is live. No buddy record exists for this joiner, so there is nothing to count.", "no buddy yet")
        ) : (
          <span className="whitespace-nowrap tabular-nums text-navy" title="Confirmed by the person met. The table carries no department per connect.">
            {o.connectsDone ?? 0} <span className="text-grey-2">of {o.connectsTarget}</span>
          </span>
        ),
      resize: { width: 150, min: 100, max: 300 },
      sortValue: (o) => o.connectsDone ?? -1,
      filter: { kind: "select", get: (o) => (o.connectsTarget === null ? "No buddy yet" : `${o.connectsDone ?? 0} of ${o.connectsTarget}`) },
      exportValue: (o) => (o.connectsTarget === null ? "no buddy yet" : `${o.connectsDone ?? 0} of ${o.connectsTarget}`),
    },
    {
      key: "review",
      header: "30 / 90-Day Review",
      cell: () =>
        unusedCell(
          "fms_hr_probation_checkins carries Day 30 and Day 90 as exact rows, each with an HOD side and a joiner side. Only the seeded test probation has any.",
        ),
      exportValue: () => "not recorded",
    },
  ];

  /* ------------------------------------------------------------------ render */
  const w = data?.week;
  const pct = (x: number | null) => (x === null ? "—" : `${x.toFixed(0)}%`);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-orange/35 bg-orange/[0.05] px-4 py-2.5 text-[12px] leading-relaxed text-navy">
        <span className="font-semibold">Nothing you type here is saved.</span> The figures the hub can read are live; every box
        you fill in yourself stays in THIS browser, on THIS computer, and is lost when site data is cleared. Nobody else can
        see it and it reaches no report. Print or export the page if you need to keep it. Form:{" "}
        <span className="font-medium">{form.source}</span>
      </div>

      {problems.length > 0 && (
        <div className="rounded-lg border border-[#c0392b]/40 bg-[#c0392b]/[0.06] px-4 py-2.5 text-[12px] text-[#c0392b]">
          <span className="font-semibold">The transcription does not check out.</span> Every box below is suspect until this is
          fixed: {problems.join(" · ")}
        </div>
      )}

      {data?.truncated && (
        <div className="rounded-lg border border-[#c0392b]/40 bg-[#c0392b]/[0.06] px-4 py-2.5 text-[12px] text-[#c0392b]">
          <span className="font-semibold">A read came back exactly full.</span> Some count on this page is low. The page asks for
          5,000 rows per table and one of them hit the ceiling — it needs paging before anyone quotes a figure from it.
        </div>
      )}

      {/* ── Who, and which week ── */}
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div className="w-full sm:w-auto">
            <label className="mb-1.5 block text-[10.5px] font-semibold uppercase tracking-wide text-grey-2">Person</label>
            <Combobox
              value={activeId}
              onChange={setPersonId}
              disabled={pool.length <= 1}
              className="w-full sm:min-w-[260px]"
              options={pool.map((p) => ({
                value: p.id,
                label: p.name,
                sublabel: p.designation ?? undefined,
                icon: <Avatar name={p.name} color={p.avatarColor} size={22} />,
                group: pool.length > 1 ? roleMeta(p.role).label : undefined,
              }))}
            />
          </div>
          <PeriodControls period={period} onChange={setPeriod} />
          {typed > 0 && (
            <button
              type="button"
              onClick={() => {
                clearNotes(form.id, activeId, period.from, period.to);
                setNotes(emptyNotes());
              }}
              className="rounded border border-line px-2.5 py-1 text-[12px] text-grey hover:border-orange hover:text-orange"
            >
              Clear the {typed} typed box{typed === 1 ? "" : "es"}
            </button>
          )}
        </div>
        {q.isError && (
          <p className="mt-3 border-t border-line pt-3 text-[12px] text-[#c0392b]">
            The recruitment tables would not open for this login, so Section A reads blank rather than zero:{" "}
            {(q.error as Error).message}
          </p>
        )}
      </Card>

      {!personForm ? (
        <NoSheet
          kind="weekly review"
          personName={person.name}
          department={personDept}
          designation={person.designation}
          jobsThatHaveOne={jobsWithAForm()}
        />
      ) : (
        <>
      <FieldMeter
        counts={counts}
        total={form.fields.length}
        selected={band}
        onSelect={setBand}
        typed={typed}
        selectionNote={(n) => `Highlighting these ${n} boxes on the report below · click again to clear`}
      />

      {/* ══ HEADER ══════════════════════════════════════════════════════════ */}
      <Card className="overflow-hidden p-0">
        <BlockBar title="Report header and week status" note={blockNote("Report header")} />
        <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3">
          {fieldBox("H.1", rangeLabel(period.from, period.to))}
          {fieldBox("H.2", formatDate(asOf))}
          {fieldBox(
            "H.3",
            <span className="text-[14px]">
              {person.name}
              {person.designation && <span className="ml-1 text-[11.5px] font-normal text-grey">· {person.designation}</span>}
            </span>,
          )}
          {fieldBox(
            "H.4",
            <span className="text-[14px]">
              {reviewers.length > 0 ? reviewers.map((r) => r.name).join(", ") : <span className="text-grey-2">nobody recorded</span>}
            </span>,
          )}
          {fieldBox("H.5", <span className="text-[14px]">HR Head / Management</span>)}
          {fieldBox("H.6")}
          {fieldBox("H.7", undefined, {
            children: (
              <div className="space-y-1.5">
                <div className="flex gap-1.5">
                  {STATUS_PICK.map((s) => {
                    const on = notes.status === s.key;
                    return (
                      <button
                        key={s.key}
                        type="button"
                        aria-pressed={on}
                        onClick={() => patch((n) => ({ ...n, status: on ? undefined : s.key }))}
                        className={cn("rounded border px-2 py-[2px] text-[11.5px] font-semibold", on ? s.on : cn("bg-white", s.cls))}
                      >
                        {s.label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10.5px] leading-snug text-grey">
                  <span className="font-semibold text-navy">Live data argues for {suggested.status}.</span> {suggested.why}
                </p>
              </div>
            ),
          })}
          {fieldBox("H.8", undefined, {
            children: (
              <NoteInput
                label="One-line summary"
                rows={2}
                value={notes.fields["H.8"] ?? ""}
                onChange={(v) => putField("H.8", v)}
                placeholder="One line on the week — stays in this browser"
              />
            ),
          })}
        </div>
      </Card>

      {/* ══ SECTION A ═══════════════════════════════════════════════════════ */}
      <div>
        <SectionBar {...sectionOf(form, "A")} />
        <Card className="overflow-hidden rounded-t-none p-0">
          <BlockBar title="A1 · Key Performance Snapshot" note={blockNote("A1 · Key Performance Snapshot")} />
          <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {fieldBox(
              "A1.1",
              <span>
                {w?.openPositions ?? "—"}
                <span className="ml-1.5 text-[11.5px] font-normal text-grey">
                  {w ? `requisitions · ${w.openSeats} people wanted` : ""}
                </span>
              </span>,
              { big: true },
            )}
            {fieldBox("A1.2", w?.sourced ?? "—", { big: true })}
            {fieldBox(
              "A1.3",
              <span>
                {w?.interviewsHeld ?? "—"}
                <span className="ml-1.5 text-[11.5px] font-normal text-grey">{w ? `· ${w.interviewsScheduled} scheduled` : ""}</span>
              </span>,
              { big: true },
            )}
            {fieldBox(
              "A1.4",
              <span>
                {w?.positionsClosed ?? "—"}
                {!!w && w.positionsCancelled > 0 && (
                  <span className="ml-1.5 text-[11.5px] font-normal text-orange">· {w.positionsCancelled} cancelled</span>
                )}
              </span>,
              { big: true },
            )}
            {fieldBox(
              "A1.5",
              <span>
                {pct(w?.offerToJoin ?? null)}
                <span className="ml-1.5 text-[11.5px] font-normal text-grey">
                  {w ? `${w.joinedOfAccepted} of ${w.offersAccepted} accepted` : ""}
                </span>
              </span>,
              { big: true },
            )}
          </div>
        </Card>

        <Card className="mt-3 overflow-hidden p-0">
          <BlockBar
            title="A2 · Recruitment Funnel — Position-wise"
            note="Benchmark per open position: 15 sourced | 8 screened | 5 shortlisted | 3 interviewed — the form's own row."
            right={<span className="text-[11px] text-grey-2">Orange +n is what came in this week</span>}
          />
          <div className="px-2 pb-2 pt-1 sm:px-3">
            <QueueTable
              rows={positions}
              rowKey={(p) => p.id}
              columns={funnelColumns}
              loading={q.isLoading}
              rowsLabel="positions"
              emptyTitle="No requisition is recorded"
              emptyMessage="New Recruitment holds no requisition this login can see."
              initialSort={{ key: "sourced", dir: "desc" }}
              columnPicker={{ storageKey: "kpi-lab.wr.funnel" }}
              resizeKey="kpi-lab.wr.funnel"
              exportName="Weekly_Review_A2_Funnel"
              exportTitle={`A2 · Recruitment funnel — ${person.name} · ${periodLabel(period)}`}
              exportNotes={[
                "TEST OUTPUT. Figures are live; the report they sit in is a localhost-only test page.",
                "Screened = HR's shortlist pass (there is no separate screening event). Shortlisted = the HOD's decision, which is stamped on a rejection too.",
                `Benchmark per open position: ${BENCHMARK.sourced} sourced, ${BENCHMARK.screened} screened, ${BENCHMARK.shortlisted} shortlisted, ${BENCHMARK.interviewed} interviewed.`,
              ]}
            />
          </div>
        </Card>

        <Card className="mt-3 overflow-hidden p-0">
          <BlockBar
            title="A3 · Position Status & Ageing"
            note="Flag any position open beyond 45 days — the form's own rule."
            right={
              w && w.agedOver45 > 0 ? (
                <span className="rounded border border-[#c0392b]/30 bg-[#c0392b]/[0.08] px-2 py-[1px] text-[11.5px] font-semibold text-[#c0392b]">
                  {w.agedOver45} past 45 days · oldest {w.oldestDays}
                </span>
              ) : undefined
            }
          />
          <div className="px-2 pb-2 pt-1 sm:px-3">
            <QueueTable
              rows={livePositions}
              rowKey={(p) => p.id}
              columns={ageingColumns}
              loading={q.isLoading}
              rowsLabel="live positions"
              emptyTitle="No position is open"
              emptyMessage="Nothing is at posting or sourcing right now."
              initialSort={{ key: "daysOpen", dir: "desc" }}
              columnPicker={{ storageKey: "kpi-lab.wr.ageing" }}
              resizeKey="kpi-lab.wr.ageing"
              exportName="Weekly_Review_A3_Ageing"
              exportTitle={`A3 · Position status and ageing — ${periodLabel(period)}`}
              exportNotes={[
                "TEST OUTPUT from a localhost-only page.",
                "Stage is the FORM's six stages (Sourcing…Joined), derived from how far the position's candidates got — not the hub's own current_step, which says whose desk the MRF is on. The mapping is an assumption HR should confirm.",
                "BGV can never appear as a stage: it would need the police-verification check ticked, and no onboarding check has ever been ticked.",
              ]}
            />
          </div>
        </Card>

        <Card className="mt-3 overflow-hidden p-0">
          <BlockBar title="A4 · Offers, BGV & Joining" note={blockNote("A4 · Offers, BGV & Joining")} />
          <div className="px-2 pb-2 pt-1 sm:px-3">
            <QueueTable
              rows={offers}
              rowKey={(o) => o.id}
              columns={offerColumns}
              loading={q.isLoading}
              rowsLabel="offers"
              emptyTitle="No offer is recorded"
              emptyMessage="No onboarding has been opened in New Recruitment."
              initialSort={{ key: "joiningDate", dir: "desc" }}
              columnPicker={{ storageKey: "kpi-lab.wr.offers" }}
              resizeKey="kpi-lab.wr.offers"
              exportName="Weekly_Review_A4_Offers"
              exportTitle={`A4 · Offers, BGV and joining — ${periodLabel(period)}`}
              exportNotes={[
                "TEST OUTPUT from a localhost-only page.",
                "Offer Date is the 'Offer letter sent' onboarding check. BGV Status is the 'Police verification' check — narrower than a BGV, with nowhere to record a discrepancy.",
                "Joined reads off fms_hr_candidates.joined_at, which is null on every candidate row. 'not ticked — date passed' is not a no-show; the two are indistinguishable.",
              ]}
            />
          </div>
        </Card>
      </div>

      {/* ══ SECTION B ═══════════════════════════════════════════════════════ */}
      <div>
        <SectionBar {...sectionOf(form, "B")} />
        <Card className="overflow-hidden rounded-t-none p-0">
          <BlockBar title="B1 · Key Performance Snapshot" note={blockNote("B1 · Key Performance Snapshot")} />
          <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {fieldBox(
              "B1.1",
              <span>
                {w?.newJoinersDue ?? "—"}
                <span className="ml-1.5 text-[11.5px] font-normal text-grey">{w ? `due · ${w.newJoinersConfirmed} ticked` : ""}</span>
              </span>,
              { big: true },
            )}
            {fieldBox("B1.2")}
            {fieldBox("B1.3")}
            {fieldBox("B1.4")}
            {fieldBox("B1.5")}
          </div>
        </Card>

        <Card className="mt-3 overflow-hidden p-0">
          <BlockBar
            title="B2 · Joiner-wise Passport Tracker"
            note={`Everybody whose joining date falls in the 90 days to ${formatDate(period.to)} — the form closes the passport at Day 90.`}
            right={<span className="text-[11px] text-grey-2">3 of 7 columns exist</span>}
          />
          <div className="px-2 pb-2 pt-1 sm:px-3">
            <QueueTable
              rows={joiners}
              rowKey={(o) => o.id}
              columns={joinerColumns}
              loading={q.isLoading}
              rowsLabel="joiners"
              emptyTitle="No joiner inside the passport window"
              emptyMessage="Nobody has a joining date in the 90 days up to the end of this period."
              initialSort={{ key: "doj", dir: "desc" }}
              columnPicker={{ storageKey: "kpi-lab.wr.joiners" }}
              resizeKey="kpi-lab.wr.joiners"
              exportName="Weekly_Review_B2_Passport"
              exportTitle={`B2 · Joiner-wise passport tracker — ${periodLabel(period)}`}
              exportNotes={[
                "TEST OUTPUT from a localhost-only page.",
                "Buddy, Induction and Connects are LIVE on the hub (the Buddy Program, 22-09-2026). A blank column is a joiner nobody has put through the screen, not a missing table.",
                "Connects counts only interactions CONFIRMED by the person met. The table carries no department per connect, so the form's 'one per department' cannot be checked yet.",
                "30 / 90-Day Review: fms_hr_probation_checkins carries Day 30 and Day 90 as exact rows. Only the seeded test probation has any.",
              ]}
            />
          </div>
        </Card>
      </div>

      {/* ══ SECTION C ═══════════════════════════════════════════════════════ */}
      <div>
        <SectionBar {...sectionOf(form, "C")} />
        <Card className="overflow-hidden rounded-t-none p-0">
          <div className="border-b border-line bg-orange/[0.05] px-4 py-2.5 text-[12px] leading-relaxed text-navy">
            <span className="font-semibold text-orange">Live, and nobody has used it yet.</span> Learning &amp; Development
            reached the hub on 23-09-2026 with screens for sessions, nominations, attendance, feedback, assignments and the
            annual plan. So the {form.fields.filter((f) => f.section === "C").length} boxes below need no build at all — each
            names the column it reads, and fills itself the first week a session is run.
          </div>
          {["C1 · Key Performance Snapshot", "C2 · Training Mix — External Agency vs Technical", "C3 · Session-wise Summary", "C4 · Attendance & Assignments", "C5 · Learning Hours & Mandatory Training"].map(
            (blockTitle) => (
              <div key={blockTitle}>
                <BlockBar
                  title={blockTitle}
                  note={
                    blockTitle.startsWith("C2")
                      ? "The form's own counting rule: a technical session run by an external agency is reported under BOTH lines and once in the Total — so the total is not the sum of the lines above it."
                      : blockTitle.startsWith("C3")
                        ? "This block is the session record itself — the table everything else in Section C hangs off."
                        : undefined
                  }
                />
                <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3">
                  {form.fields.filter((f) => f.block === blockTitle).map((f) => fieldBox(f.code))}
                </div>
              </div>
            ),
          )}
        </Card>
      </div>

      {/* ══ SPECIAL KPI TRACKER ═════════════════════════════════════════════ */}
      <div>
        <SectionBar {...sectionOf(form, "SK")} />
        <Card className="overflow-hidden rounded-t-none p-0">
          <BlockBar
            title="Special KPI Tracker — Year to Date"
            note={blockNote("Special KPI Tracker — Year to Date")}
            right={
              data ? (
                <span className="text-[11px] text-grey-2">
                  {asOf.slice(0, 4)}: {data.ytd.positionsClosed} closed · {data.ytd.offersAccepted} offers accepted ·{" "}
                  {data.ytd.probations} probations
                </span>
              ) : undefined
            }
          />
          <div className="grid gap-2 p-3 sm:grid-cols-2">
            {fieldBox("SK-1", undefined, {
              children: (
                <div className="space-y-1.5">
                  <div className="text-[18px] font-semibold tabular-nums leading-none text-navy">
                    {data ? `${data.ytd.positionsClosed} of 25` : "—"}
                    <span className="ml-1.5 text-[11.5px] font-normal text-grey">
                      {data ? `· ${data.ytd.offersAccepted} offer${data.ytd.offersAccepted === 1 ? "" : "s"} accepted this year` : ""}
                    </span>
                  </div>
                  <p className="text-[10.5px] leading-snug text-grey">{byCode.get("SK-1")?.gap}</p>
                </div>
              ),
            })}
            {fieldBox("SK-2")}
            {fieldBox("SK-3")}
            {fieldBox("SK-4", undefined, {
              children: (
                <div className="space-y-1.5">
                  <div className="text-[13px] font-semibold text-navy">
                    {data ? `${data.ytd.probations} probations, ${data.ytd.probationReviews} reviews` : "—"}
                  </div>
                  <p className="text-[10.5px] leading-snug text-grey">{byCode.get("SK-4")?.gap}</p>
                  <NoteInput
                    label="Monthly probation analysis"
                    value={notes.fields["SK-4"] ?? ""}
                    onChange={(v) => putField("SK-4", v)}
                    placeholder="Months submitted, by hand — stays in this browser"
                  />
                </div>
              ),
            })}
          </div>
        </Card>
      </div>

      {/* ══ FLAGS, ACTIONS, SIGN-OFF ════════════════════════════════════════ */}
      <div>
        <SectionBar {...sectionOf(form, "Z")} />
        <Card className="overflow-hidden rounded-t-none p-0">
          <BlockBar
            title="Highlight / Flag"
            note="The form lists six example flags. Five of them are things a database notices better than a person does, so the page raises the ones it can — and says which it cannot, which is the more useful half."
          />
          <div className="space-y-1.5 p-3">
            {flags.map((f) => (
              <div
                key={f.code}
                className={cn(
                  "flex flex-wrap items-start gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-[12px]",
                  f.basis === "raised" && f.severity === "red" && "border-[#c0392b]/40 bg-[#c0392b]/[0.05]",
                  f.basis === "raised" && f.severity !== "red" && "border-orange/40 bg-orange/[0.05]",
                  f.basis === "clear" && "border-line bg-white",
                  f.basis === "unknowable" && "border-dashed border-line bg-page",
                )}
              >
                <span
                  className={cn(
                    "mt-[1px] shrink-0 rounded border px-1.5 py-[1px] text-[10.5px] font-semibold",
                    f.basis === "raised" && f.severity === "red" && "border-[#c0392b]/40 bg-[#c0392b] text-white",
                    f.basis === "raised" && f.severity !== "red" && "border-orange/50 bg-orange text-white",
                    f.basis === "clear" && "border-[#1f8a4d]/30 bg-[#1f8a4d]/10 text-[#1f8a4d]",
                    f.basis === "unknowable" && "border-line bg-white text-grey-2",
                  )}
                >
                  {f.basis === "raised" ? "Raised" : f.basis === "clear" ? "Clear" : "Cannot be checked"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="font-semibold text-navy">{f.label}</span>
                  <span className="ml-1.5 text-grey">{f.detail}</span>
                </span>
                <span className="shrink-0 text-[10.5px] text-grey-2">{f.code}</span>
              </div>
            ))}
            <div className="pt-1.5">
              <label className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-grey-2">
                Anything else to highlight — the form&apos;s free-text box
              </label>
              <NoteInput
                label="Highlights"
                rows={3}
                value={notes.highlights}
                onChange={(v) => patch((n) => ({ ...n, highlights: v }))}
                placeholder="Stays in this browser"
              />
            </div>
          </div>
        </Card>

        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <Card className="overflow-hidden p-0">
            <BlockBar title="Pending Actions from Last Week" />
            <div className="space-y-2 p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[11px] leading-snug text-grey">{byCode.get("Z.7")?.gap}</p>
                <BandBadge band="no-table" />
              </div>
              <NoteInput
                label="Pending actions from last week"
                rows={5}
                value={notes.pending}
                onChange={(v) => patch((n) => ({ ...n, pending: v }))}
                placeholder={"One per line — action · owner · due date · status\nStays in this browser"}
              />
            </div>
          </Card>

          <Card className="overflow-hidden p-0">
            <BlockBar title="Key Priorities for Next Week" />
            <div className="space-y-2 p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[11px] leading-snug text-grey">
                  Free text on the form, and rightly so — this is the author&apos;s plan, not a measurement.
                </p>
                <BandBadge band="narrative" />
              </div>
              <NoteInput
                label="Key priorities for next week"
                rows={5}
                value={notes.priorities}
                onChange={(v) => patch((n) => ({ ...n, priorities: v }))}
                placeholder={"Up to five — one per line\nStays in this browser"}
              />
            </div>
          </Card>
        </div>

        <Card className="mt-3 overflow-hidden p-0">
          <BlockBar title="Sign-off" note="Three signatures on a printed page. The hub records none of them." />
          <div className="grid gap-3 p-3 sm:grid-cols-3">
            {[
              { role: "HR Executive", name: person.name, note: person.designation ?? "" },
              {
                role: "HR Head",
                name: reviewers.length > 0 ? reviewers.map((r) => r.name).join(", ") : "nobody recorded",
                note: 'The form names "Riya Chauhan"',
              },
              { role: "Management", name: "—", note: "Not recorded in the hub" },
            ].map((s) => (
              <div key={s.role} className="rounded-lg border border-line bg-white p-3">
                <div className="text-[10.5px] font-semibold uppercase tracking-wide text-grey-2">{s.role}</div>
                <div className="mt-1 text-[13px] font-semibold text-navy">{dash(s.name)}</div>
                <div className="text-[10.5px] text-grey-2">{s.note}</div>
                <div className="mt-3 border-t border-dashed border-line pt-1 text-[10.5px] text-grey-2">Signature · Date</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="space-y-1.5 px-1 pb-4 text-[11.5px] leading-relaxed text-grey-2">
        <p>
          <span className="font-semibold text-grey">Recruitment figures are not scoped to one person.</span> The recruitment
          tables record the requisition, not who chased it. Today one HR executive works them all, so for her the figures are
          hers — the moment a second recruiter exists they are the team&apos;s, and it needs an owner on the requisition.
        </p>
        <p>
          <span className="font-semibold text-grey">Nothing on this page is stored.</span> Every box a reader fills stays in this
          browser, keyed to this person and this week. Most of the form cannot be filled from the hub yet, and writing those
          figures anywhere would make them look like records.
        </p>
      </div>
        </>
      )}
    </div>
  );
}

/** A section's bar props, straight from the form so the two cannot drift. */
function sectionOf(form: typeof weeklyReviewForm, code: string): { code: string; title: string; note: string } {
  const s = form.sections.find((x) => x.code === code);
  return s ?? { code, title: code, note: "" };
}
