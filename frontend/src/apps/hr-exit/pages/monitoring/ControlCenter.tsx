import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import SharedKpi from "@/shared/components/ui/Kpi";
import StepPipeline, { type StepPipelineNode } from "@/shared/components/ui/StepPipeline";
import { SectionHeading } from "@/shared/components/ui/Readout";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { EMPTY_COUNTS, bucketOf, todayLocalIso, type Bucket } from "@/shared/lib/dueBuckets";
import { formatDate } from "@/shared/lib/time";
import { localDateIso } from "@/shared/lib/workingDays";
import { useExitStore } from "../../store";
import { STAGES, STEPS, stepByKey, type StepKey } from "../../lib/steps";
import type { QueueEntry } from "../../lib/queues";
import { exportSheetParity } from "../../lib/sheetExport";

/**
 * The HR Exit Control Center — the process coordinator's view of what is late, across
 * every exit in the company.
 *
 * ── ONE WALK, ONE BUCKETING ──────────────────────────────────────────────────
 *
 * Everything on this page derives from `store.queueEntries` — the output of
 * `buildQueueEntries(exitSnapshotFrom(data))`, which is the SAME list the queue pages
 * narrow and the SAME call the cross-FMS scoreboard's `adapters/hr-exit.ts` makes, on the
 * same react-query cache entry. So the Delayed number here is identical to the HR Exit row
 * on the master Control Center — not because two calculations agree, but because there is
 * only one calculation.
 *
 * The KPI tiles and the step strip are computed in ONE `useMemo` pass over that list, so
 * every entry is counted into both or into neither. Two loops is how a tile and the strip
 * beneath it come to disagree about the same number on the same screen.
 *
 * ── A QUEUE ENTRY IS A (STEP, CASE) WORK-ITEM, NOT A CASE ────────────────────
 *
 * Between the last working day and the F&F, one exit owes clearance AND the asset return
 * AND the handover AND the interview AND leave AND payroll — six entries, six different
 * people, six calls to make. And EACH OUTSTANDING CLEARANCE CHECK IS ITS OWN ENTRY, owned
 * by whoever owes that row. So **the per-step counts can exceed the number of open exits,
 * and that is correct** — it is the number a coordinator actually wants: units of work due.
 * (The Dashboard's "open exits" tile counts DISTINCT CASES; it is a different question.)
 *
 * That is also why the row key is composite: `${stepKey}:${entityId}:${checkId ?? ""}`.
 * `entityId` alone is not unique here, and a duplicate React key silently drops rows.
 *
 * ── THE THINGS THIS PAGE DELIBERATELY DOES NOT DO ────────────────────────────
 *
 * • It never puts a STATUS in the work queue. `on_hold` / `withdrawn` / `rejected` /
 *   `archived` are CaseStatus, never StepKey, and `isOpenCase()` already excludes them
 *   inside `buildQueueEntries`. **Held cases get their own strip, with a days-parked
 *   count, and never a red number** — but they ARE shown, because an invisible held case
 *   is how one gets forgotten for a month.
 * • It never buckets with `todayIso()` from shared/lib/time — that is the UTC date, and in
 *   IST it says "yesterday" until 05:30, so before dawn every due-today item would be
 *   counted as delayed. `todayLocalIso()`, always.
 */

type Scope = "delayed" | "today" | "noDate" | "all";

const SCOPES: { value: Scope; label: string }[] = [
  { value: "delayed", label: "Delayed" },
  { value: "today", label: "Due today" },
  { value: "noDate", label: "No date" },
  { value: "all", label: "All" },
];

/** Steps that can hold work. `resignation` is `noQueue` — raising it IS the event. */
const QUEUE_STEPS = STEPS.filter((s) => !s.noQueue);

export default function ControlCenter() {
  const s = useExitStore();
  /** Empty = no step filter — the portal's multi-select convention. */
  const [selectedSteps, setSelectedSteps] = useState<StepKey[]>([]);
  const [scope, setScope] = useState<Scope>("delayed");

  const today = todayLocalIso();

  // ---- ONE pass: the KPI totals AND the per-step delayed/today/total ----
  const { counts, nodes } = useMemo(() => {
    const totals: Record<Bucket, number> = { ...EMPTY_COUNTS };
    const perStep = new Map<StepKey, { delayed: number; today: number; total: number }>();
    for (const st of QUEUE_STEPS) perStep.set(st.key, { delayed: 0, today: 0, total: 0 });

    for (const e of s.queueEntries) {
      const b = bucketOf(e.dueIso, today);
      if (b) totals[b]++;
      const rec = perStep.get(e.stepKey);
      if (!rec) continue;
      /**
       * ⭐ `total` COUNTS EVERY ENTRY, WHATEVER ITS DATE — and it is incremented BEFORE the
       * delayed/today test, deliberately.
       *
       * StepPipeline shows a green ✓ when `total === 0`. If `total` only counted the two
       * urgent buckets, a step holding ten items due next month — the exit interview on a
       * 60-day notice, say — would wear a ✓ that means "clear" while ten pieces of work sat
       * in it. A step with only future work is a LIVE DOT. ✓ means genuinely empty.
       */
      rec.total++;
      if (b === "delayed") rec.delayed++;
      else if (b === "today") rec.today++;
    }

    const pipeline: StepPipelineNode<StepKey>[] = QUEUE_STEPS.map((st) => ({
      stepKey: st.key,
      index: st.index,
      label: st.short,
      ...perStep.get(st.key)!,
    }));
    return { counts: totals, nodes: pipeline };
  }, [s.queueEntries, today]);

  /**
   * Parked exits — counted SEPARATELY, and deliberately not as work-items.
   *
   * A held case is a STATUS, not a job someone owes. Feeding it into the work queue would
   * have inflated the "no date" tile, reported it on the dashboard as work owed by
   * "Nobody", and silently moved the numbers on the cross-FMS scoreboard that Purchase also
   * reads — all with no code change and no review. But leaving it out ENTIRELY is how a
   * disputed termination in March quietly becomes a case nobody reopened. So: visible,
   * dated, and never red.
   *
   * The days-parked count uses `localDateIso` on both sides — never `toISOString()`, which
   * would be the UTC day and would read a case held this morning as parked since yesterday.
   */
  const held = useMemo(
    () =>
      s.cases
        .filter((c) => c.status === "on_hold")
        .map((c) => ({
          c,
          days: c.holdAt
            ? Math.max(
                0,
                Math.round(
                  (new Date(`${today}T00:00:00`).getTime() -
                    new Date(`${localDateIso(new Date(c.holdAt))}T00:00:00`).getTime()) /
                    86_400_000,
                ),
              )
            : null,
        }))
        .sort((a, b) => (b.days ?? 0) - (a.days ?? 0)),
    [s.cases, today],
  );

  const rows = useMemo(() => {
    const sel = new Set(selectedSteps);
    return s.queueEntries
      .filter((e) => {
        if (sel.size && !sel.has(e.stepKey)) return false;
        const b = bucketOf(e.dueIso, today);
        if (scope === "delayed") return b === "delayed";
        if (scope === "today") return b === "today";
        if (scope === "noDate") return b === "noDate";
        return true;
      })
      .sort((a, b) => (a.dueIso ?? "9999").localeCompare(b.dueIso ?? "9999"));
  }, [s.queueEntries, selectedSteps, scope, today]);

  const deptName = (id: string) => s.departments.find((d) => d.id === id)?.name ?? "—";
  const caseOf = (e: QueueEntry) => s.caseById(e.caseId);

  /** Who is leaving — the thing every row is really about. */
  const employeeOf = (e: QueueEntry): string => {
    const c = caseOf(e);
    return c ? `${c.employeeName} (${c.employeeCode})` : "—";
  };

  /**
   * What this row asks for, in one line. A clearance entry names its own checklist item —
   * a queue that just said "EXIT-2627-0004" four times over would tell its owner nothing.
   */
  const detailOf = (e: QueueEntry): string => {
    if (e.entityType === "clearance_check") return e.ref.split(" — ").slice(1).join(" — ") || e.ref;
    if (e.stepKey === "clearance") return "No checklist items — this exit cannot clear itself";
    return stepByKey(e.stepKey)?.title ?? e.stepKey;
  };

  const ownerNames = (e: QueueEntry): string => {
    const names = s
      .queueOwnerIds(e)
      .map((id) => s.profileById(id)?.name)
      .filter(Boolean) as string[];
    return names.length ? names.join(", ") : "Unassigned";
  };

  const ownerCell = (e: QueueEntry) => {
    const owners = s
      .queueOwnerIds(e)
      .map((id) => s.profileById(id))
      .filter(Boolean);
    // An unowned step is not an edge case — it is work nobody has been told about, and the
    // coordinator is exactly the person who has to notice.
    if (!owners.length) return <span className="font-medium text-yellow">Unassigned</span>;
    return (
      <div className="space-y-0.5">
        {owners.map((p) => (
          <div key={p!.id} className="leading-tight">
            <div className="text-navy">{p!.name}</div>
            {p!.phone ? (
              <div className="text-[12px] tabular-nums text-grey-2">{p!.phone}</div>
            ) : (
              <div className="text-[12px] italic text-grey-2/60">no number</div>
            )}
          </div>
        ))}
      </div>
    );
  };

  const columns: QueueColumn<QueueEntry>[] = [
    {
      key: "exit",
      header: "Exit",
      cell: (e) => {
        const c = caseOf(e);
        if (!c) return <span className="text-grey-2">—</span>;
        return (
          <Link to={`/hr-exit/exits/${c.id}`} className="font-semibold text-orange hover:underline">
            {c.exitNo}
          </Link>
        );
      },
      sortValue: (e) => caseOf(e)?.exitNo ?? "",
      filter: { kind: "text", get: (e) => caseOf(e)?.exitNo ?? "" },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "employee",
      header: "Employee",
      cell: (e) => {
        const c = caseOf(e);
        if (!c) return <span className="text-grey-2">—</span>;
        return (
          <div>
            <div className="font-medium text-navy">{c.employeeName}</div>
            <div className="text-[12px] text-grey-2">{c.employeeCode}</div>
          </div>
        );
      },
      sortValue: (e) => caseOf(e)?.employeeName ?? "",
      filter: { kind: "text", get: employeeOf },
      exportValue: employeeOf,
    },
    {
      key: "step",
      header: "Step",
      cell: (e) => <span className="text-grey">{stepByKey(e.stepKey)?.short ?? e.stepKey}</span>,
      sortValue: (e) => stepByKey(e.stepKey)?.index ?? 0,
      filter: { kind: "select", get: (e) => stepByKey(e.stepKey)?.short ?? e.stepKey },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "detail",
      header: "What's owed",
      cell: (e) => (
        <span className={e.stepKey === "clearance" && !e.checkId ? "font-medium text-ryg-red" : "text-navy"}>
          {detailOf(e)}
        </span>
      ),
      sortValue: detailOf,
      filter: { kind: "text", get: detailOf },
    },
    {
      key: "owner",
      header: "Owner",
      cell: ownerCell,
      sortValue: ownerNames,
      filter: { kind: "select", get: ownerNames },
      exportValue: ownerNames,
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "lwd",
      header: "Last working day",
      cell: (e) => <span className="text-grey">{formatDate(caseOf(e)?.lwd ?? null)}</span>,
      sortValue: (e) => caseOf(e)?.lwd ?? "9999-99-99",
      filter: { kind: "date", get: (e) => caseOf(e)?.lwd ?? "" },
      exportValue: (e) => formatDate(caseOf(e)?.lwd ?? null),
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "due",
      header: "Due",
      cell: (e) => <DueChip dueIso={e.dueIso} todayIso={today} />,
      sortValue: (e) => e.dueIso ?? "9999-99-99",
      filter: { kind: "date", get: (e) => e.dueIso ?? "" },
      exportValue: (e) => (e.dueIso ? formatDate(e.dueIso) : "No date"),
      tdClassName: "whitespace-nowrap",
    },
  ];

  const pending = counts.delayed + counts.today;

  /**
   * ⭐ THE SHEET-PARITY EXPORT — and this page is exactly where it belongs.
   *
   * Two of its eleven stages read RLS-gated satellites (the F&F figures and the exit
   * interview). A viewer who may not read them gets ZERO ROWS — which would print as
   * "₹0" and "No" in a spreadsheet that then gets emailed to a director and believed.
   * This page is gated on `isProcessCoordinator` (RequireMonitor in ExitApp), and
   * admin ∨ coordinator is a clause of BOTH satellites' policies — so whoever can press
   * this button can read every column in the file. See lib/sheetExport.ts.
   */
  const runSheetParity = () =>
    exportSheetParity({
      cases: s.cases,
      departmentName: deptName,
      personName: (id) => (id ? (s.profileById(id)?.name ?? "Unknown") : "—"),
      reasonName: (id) => (id ? (s.reasons.find((r) => r.id === id)?.name ?? "Unknown reason") : "Not recorded"),
      dueIsoFor: s.dueIsoFor,
      assetsFor: s.assetsFor,
      handoverFor: s.handoverFor,
      interviewFor: s.interviewFor,
      settlementFor: s.settlementFor,
      documentsFor: s.documentsFor,
      checksFor: s.checksFor,
      skipsFor: s.skipsFor,
      canReadConfidential: s.canReadConfidential,
      canReadSettlement: s.canReadSettlement,
    });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-navy">HR Exit Control Center</h1>
          <p className="mt-1 text-[13.5px] text-grey-2">
            Pending exit work by the day it falls due. Each row is one <strong>step</strong> of work on one exit — the
            same exit is owed at several steps at once, and every outstanding clearance item is its own row, because
            they are different people's work. Find what's late, then call the owner.
          </p>
        </div>
        <button
          type="button"
          onClick={runSheetParity}
          disabled={s.cases.length === 0}
          title="Every case in the FMS tab's own eleven-stage column order — for reconciling the app against the Google Sheet"
          className="inline-flex shrink-0 items-center gap-1.5 h-9 rounded-lg border border-line bg-white px-3 text-[12.5px] font-semibold text-grey-2 hover:border-orange/50 hover:text-orange disabled:opacity-40 disabled:hover:border-line disabled:hover:text-grey-2"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
          Sheet parity (Excel)
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Today's pending" value={pending} hint="delayed + due today" hero tone={pending > 0 ? "red" : undefined} />
        <Kpi label="In queue (today)" value={counts.today} hint="due today" />
        <Kpi label="Delayed" value={counts.delayed} hint="past due" tone={counts.delayed > 0 ? "red" : undefined} />
        <Kpi label="Tomorrow" value={counts.tomorrow} hint="in queue" />
        <Kpi label="Day after" value={counts.dayAfter} hint="in queue" />
      </div>

      <Card className="p-4">
        <SectionHeading className="mb-3">Where it's stuck</SectionHeading>
        <StepPipeline<StepKey>
          nodes={nodes}
          selectedKeys={selectedSteps}
          groups={STAGES}
          onChange={(next) => {
            setSelectedSteps(next);
            // Picking a step means "show me what's late here" — leaving the scope on
            // "Delayed" is the only reading of that click which isn't a lie.
            if (next.length) setScope("delayed");
          }}
        />

        {held.length > 0 && (
          <div className="mt-4 border-t border-line pt-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-grey">Parked</span>
              <span className="text-[12px] text-grey">
                {held.length} {held.length === 1 ? "exit is" : "exits are"} on hold — paused on purpose, so never
                counted as late, and in no red number above. But not forgotten either.
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {held.map(({ c, days }) => (
                <Link
                  key={c.id}
                  to={`/hr-exit/exits/${c.id}`}
                  title={c.holdReason ?? undefined}
                  className="inline-flex items-center gap-2 rounded-lg border border-line bg-page/60 px-2.5 py-1.5 text-[12px] transition hover:border-orange/40"
                >
                  <span className="font-semibold text-navy">{c.exitNo}</span>
                  <span className="max-w-[180px] truncate text-grey">{c.employeeName}</span>
                  {days !== null && (
                    <span className="font-semibold text-grey-2" title={`Held since ${formatDate(c.holdAt)}`}>
                      {days}d held
                    </span>
                  )}
                </Link>
              ))}
            </div>
          </div>
        )}
      </Card>

      <Card className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-lg border border-line">
            {SCOPES.map((sc) => {
              const n = sc.value === "all" ? null : counts[sc.value as Bucket];
              return (
                <button
                  key={sc.value}
                  type="button"
                  onClick={() => setScope(sc.value)}
                  aria-pressed={scope === sc.value}
                  className={`h-9 border-r border-line px-3.5 text-[12.5px] font-semibold transition-colors last:border-r-0 ${
                    scope === sc.value ? "bg-orange/10 text-orange" : "text-grey-2 hover:bg-page/60 hover:text-navy"
                  }`}
                >
                  {sc.label}
                  {n !== null && n > 0 && <span className="ml-1.5 text-[11px] opacity-70">{n}</span>}
                </button>
              );
            })}
          </div>
          {selectedSteps.length > 0 && (
            <span className="text-[12px] text-grey">
              {selectedSteps.length} step{selectedSteps.length === 1 ? "" : "s"} selected
            </span>
          )}
        </div>

        <QueueTable<QueueEntry>
          rows={rows}
          // COMPOSITE, and it must be. One exit is owed at several steps at once, and each
          // outstanding clearance check is its own entry — `entityId` alone is NOT unique,
          // and a duplicate React key silently drops rows.
          rowKey={(e) => `${e.stepKey}:${e.entityId}:${e.checkId ?? ""}`}
          columns={columns}
          groupBy={{
            idOf: (e) => e.departmentId,
            nameOf: deptName,
            allLabel: "All departments",
            label: "Department",
          }}
          rowClassName={(e) => (bucketOf(e.dueIso, today) === "delayed" ? "bg-[#FDECEC]/40" : "")}
          rowsLabel="work items"
          emptyTitle="Nothing here"
          emptyMessage="No exit work matches this step selection and filter."
          exportName="HR_Exit_Control_Center"
          exportTitle="HR Exit work items"
          exportNotes={[
            "One row = one STEP of work on one exit. The same exit appears several times if it is owed at several steps — between the last working day and the F&F it owes clearance, the asset return, the handover, the exit interview, leave verification and payroll inputs simultaneously, to six different people.",
            "Every OUTSTANDING CLEARANCE ITEM is its own row, carrying its own owner and its own due date. An exit with three items still open contributes three rows: they are three different people's work.",
            "Due dates come from the step's configured rule (Setup → Due Dates), in working days (Mon–Sat; only Sunday is skipped). The asset return, the handover, the exit interview and the leave verification fall BEFORE the last working day — you cannot chase a laptop after they have gone. Payroll inputs are due on the payroll cut-off of the month the last working day falls in.",
            "'Delayed' = due before today. 'No date' = the last working day is not confirmed yet, so nothing downstream can be dated — those items cannot be late, and they are not counted as such.",
            "Owner: a clearance row belongs to whoever owes that row (IT, Admin, the Travel Desk — people who own no workflow step at all). The manager steps belong to the exiting employee's own reporting manager AND to the step's configured owners. Everything else reads Setup → Step Owners. 'Unassigned' means the step has no owner configured: that work is in nobody's queue.",
            "Exits ON HOLD are NOT in this list, by design. A held case is a status, not work someone owes — it is shown on its own strip on the Control Center with a days-parked count, and never as a red number.",
          ]}
          actions={(e) => (
            <Link to={`/hr-exit/exits/${e.caseId}`} className="text-[12.5px] font-semibold text-orange hover:underline">
              Open
            </Link>
          )}
        />
      </Card>
    </div>
  );
}

/** The entry's due date with a Delayed / Today / Tomorrow chip — the same four-way bucket the KPIs use. */
function DueChip({ dueIso, todayIso }: { dueIso: string | null; todayIso: string }) {
  if (!dueIso) return <span className="text-grey-2">No date</span>;
  const b = bucketOf(dueIso, todayIso);
  const chip =
    b === "delayed"
      ? { cls: "bg-[#FDECEC] text-ryg-red", text: "Delayed" }
      : b === "today"
        ? { cls: "bg-[#FFF7E6] text-yellow", text: "Today" }
        : b === "tomorrow"
          ? { cls: "bg-page text-grey-2", text: "Tomorrow" }
          : null;
  return (
    <span className={b === "delayed" ? "font-semibold text-ryg-red" : b === "today" ? "font-medium text-yellow" : "text-grey"}>
      {formatDate(dueIso)}
      {chip && (
        <span className={`ml-1.5 inline-block rounded-full px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide ${chip.cls}`}>
          {chip.text}
        </span>
      )}
    </span>
  );
}

/** The shared tile, one size down — the Control Center is not a dashboard. */
function Kpi({ label, value, hint, tone, hero }: { label: string; value: number; hint?: string; tone?: "red"; hero?: boolean }) {
  return <SharedKpi label={label} value={value} hint={hint} tone={tone} size={hero ? "hero" : "md"} />;
}
