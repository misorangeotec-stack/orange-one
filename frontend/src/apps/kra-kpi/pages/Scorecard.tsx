import { useMemo, useState, type ReactNode } from "react";
import Avatar from "@/shared/components/ui/Avatar";
import Card from "@/shared/components/ui/Card";
import Combobox from "@/shared/components/ui/Combobox";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { useSession } from "@/core/platform/session";
import { computeDownlineIds, useDirectory } from "@/core/platform/store";
import type { Profile } from "@/core/platform/types";
import { cn } from "@/shared/lib/cn";
import { formatDateTime } from "@/shared/lib/time";
import { useKpiReport, type ReportItem } from "../data/report";
import { fmtPct, fmtScore } from "../facts/score";
import { exportKpiScorecard } from "../lib/exportKpi";
import { periodLabel, periodWord, rangeLabel } from "../lib/period";
import { moduleSplit, toGridRows, totalsOf, type GridRow } from "../lib/rows";
import { useReportParams } from "../lib/useReportParams";
import Consolidated from "../components/Consolidated";
import ItemsModal, { type Drill } from "../components/ItemsModal";
import PeriodControls, { ExcelButton } from "../components/PeriodControls";

// Picker grouping, as on Task Management's Weekly Scorecard: admins, HODs, sub-HODs, employees.
const ROLE_GROUP: Record<string, { label: string; rank: number }> = {
  admin: { label: "Admins", rank: 0 },
  hod: { label: "HODs", rank: 1 },
  sub_hod: { label: "Sub-HODs", rank: 2 },
  employee: { label: "Employees", rank: 3 },
};
const roleMeta = (role: string) => ROLE_GROUP[role] ?? ROLE_GROUP.employee;

type What = "given" | "done" | "on_time" | "late" | "missed" | "still" | "next" | "last";

const IS: Record<What, (i: ReportItem) => boolean> = {
  given: (i) => i.per === "cur" && (i.outcome === "on_time" || i.outcome === "late" || i.outcome === "missed"),
  done: (i) => i.per === "cur" && (i.outcome === "on_time" || i.outcome === "late"),
  on_time: (i) => i.per === "cur" && i.outcome === "on_time",
  late: (i) => i.per === "cur" && i.outcome === "late",
  missed: (i) => i.per === "cur" && i.outcome === "missed",
  still: (i) => i.per === "cur" && (i.outcome === "due" || i.outcome === "projected"),
  next: (i) => i.per === "next",
  last: (i) => i.per === "last" && (i.outcome === "on_time" || i.outcome === "late" || i.outcome === "missed"),
};

/** A count that opens the pieces of work behind it. Zero opens nothing. */
function CountButton({ value, onClick, title, children }: { value: number; onClick: () => void; title: string; children?: ReactNode }) {
  if (value <= 0) return <span className="tabular-nums text-grey-2">{children ?? 0}</span>;
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="rounded px-1 -mx-1 font-semibold text-navy tabular-nums underline decoration-line underline-offset-2 hover:text-orange hover:decoration-orange/50"
    >
      {children ?? value}
    </button>
  );
}

/**
 * The KRA / KPI Scorecard (KPI-1): the client's weekly MIS sheet, for anyone.
 *
 * One row per task / step, both KPIs side by side — the sheet's two-rows-per-task
 * layout cannot be sorted without tearing the pairs apart, and every grid here sorts
 * and filters on every column. The Excel export writes the sheet's own layout back out.
 *
 * Who may be picked is worked out here from the directory (self; self + everyone below
 * in the reporting chain; everyone for an admin), but only as a convenience: kpi_report
 * enforces the same rule on the server, whatever this list offers.
 */
export default function Scorecard() {
  const { user, isAdmin } = useSession();
  const { profiles } = useDirectory();
  const { params, period, set: setQuery, setPeriod } = useReportParams();
  const requested = params.get("user") ?? user.id;

  const pool = useMemo<Profile[]>(() => {
    const byRoleThenName = (a: Profile, b: Profile) =>
      roleMeta(a.role).rank - roleMeta(b.role).rank || a.name.localeCompare(b.name);
    if (isAdmin) return profiles.filter((p) => !p.isExternal || p.id === user.id).sort(byRoleThenName);
    const ids = new Set([user.id, ...computeDownlineIds(profiles, user.id)]);
    const list = profiles.filter((p) => ids.has(p.id));
    if (!list.some((p) => p.id === user.id)) list.push(user);
    return list.sort(byRoleThenName);
  }, [isAdmin, profiles, user]);

  const personId = pool.some((p) => p.id === requested) ? requested : user.id;
  const person = pool.find((p) => p.id === personId) ?? user;

  const q = useKpiReport(personId, period.from, period.to);
  const report = q.data ?? null;

  const rows = useMemo(() => (report ? toGridRows(report.rows) : []), [report]);
  const totals = useMemo(() => totalsOf(rows, report?.rows ?? []), [rows, report]);
  const modules = useMemo(() => moduleSplit(rows, report?.rows ?? []), [rows, report]);

  const [drill, setDrill] = useState<Drill | null>(null);
  const W = periodWord(period.mode);
  const w = W.toLowerCase();
  const whatTitle: Record<What, string> = {
    given: `Given this ${w}`,
    done: `Done`,
    on_time: `Done on time`,
    late: `Done late`,
    missed: `Not done`,
    still: `Due later this ${w} — not counted yet`,
    next: `Planned next ${w}`,
    last: `Given last ${w}`,
  };
  const openDrill = (what: What, scope?: { row?: GridRow; module?: string }) => {
    if (!report) return;
    const items = report.items.filter(
      (i) =>
        IS[what](i) &&
        (!scope?.row || (i.source === scope.row.source && i.module === scope.row.module && i.row_key === scope.row.rowKey)) &&
        (!scope?.module || i.module === scope.module),
    );
    const where = scope?.row
      ? `${scope.row.moduleName} · ${scope.row.label}`
      : scope?.module
        ? (modules.find((m) => m.module === scope.module)?.moduleName ?? scope.module)
        : "All work";
    const range =
      what === "last" ? rangeLabel(report.last.from, report.last.to) : what === "next" ? rangeLabel(report.next.from, report.next.to) : periodLabel(period);
    setDrill({ title: `${whatTitle[what]} — ${where}`, subtitle: `${person.name} · ${range}`, items, scoped: !!scope?.row });
  };

  const count = (key: string, header: string, get: (r: GridRow) => number, what: What, onTimeBlock = false): QueueColumn<GridRow> => ({
    key,
    header,
    align: "right",
    tdClassName: onTimeBlock ? "bg-orange/[0.035]" : undefined,
    cell: (r) => <CountButton value={get(r)} title={`Show the ${get(r)} behind this`} onClick={() => openDrill(what, { row: r })} />,
    sortValue: get,
    filter: { kind: "select", get: (r) => String(get(r)) },
    exportValue: get,
  });
  const percent = (key: string, header: string, get: (r: GridRow) => number | null, onTimeBlock = false, muted = false): QueueColumn<GridRow> => ({
    key,
    header,
    align: "right",
    tdClassName: onTimeBlock ? "bg-orange/[0.035]" : undefined,
    cell: (r) => {
      const v = get(r);
      return (
        <span className={cn("tabular-nums whitespace-nowrap", v === null ? "text-grey-2" : muted ? "text-grey" : v < 0 ? "font-semibold text-[#c0392b]" : "font-semibold text-[#1f8a4d]")}>
          {fmtPct(v)}
        </span>
      );
    },
    sortValue: (r) => get(r) ?? -1e9,
    filter: { kind: "select", get: (r) => fmtPct(get(r)) },
    exportValue: (r) => fmtPct(get(r)),
  });
  /** Last period's percentage; a click shows last period's work behind it. */
  const lastPercent = (key: string, get: (r: GridRow) => number | null, onTimeBlock = false): QueueColumn<GridRow> => ({
    ...percent(key, `Last ${w} %`, get, onTimeBlock, true),
    cell: (r) => (
      <CountButton value={get(r) === null ? 0 : 1} title={`Show last ${w}'s work`} onClick={() => openDrill("last", { row: r })}>
        <span className="font-normal text-grey">{fmtPct(get(r))}</span>
      </CountButton>
    ),
  });

  const columns: QueueColumn<GridRow>[] = [
    {
      key: "module",
      header: "Module",
      cell: (r) => <span className="text-grey whitespace-nowrap">{r.moduleName}</span>,
      sortValue: (r) => r.moduleName,
      filter: { kind: "select", get: (r) => r.moduleName },
    },
    {
      key: "task",
      header: "Task / System",
      alwaysVisible: true,
      // One line per row, like the dispatch register: a long name is cut, the whole of it on hover —
      // shown by the table only when it IS cut (PF-20). The reader can drag the header's edge to
      // widen it (the user, 19-09-2026); the width is kept.
      cell: (r) => <span className="block truncate font-medium text-navy">{r.label}</span>,
      resize: { width: 360, min: 160, max: 900 },
      tdClassName: "whitespace-nowrap",
      sortValue: (r) => r.label,
      filter: { kind: "select", get: (r) => r.label },
    },
    // ── Done block · "All work should be done" ──
    count("given", "Given", (r) => r.given, "given"),
    count("done", "Done", (r) => r.done, "done"),
    percent("pct1", "% not done", (r) => r.pct1),
    lastPercent("last1", (r) => r.last1),
    // ── On-time block · "All work should be done on time" ──
    count("done2", "Done", (r) => r.done, "done", true),
    count("ontime", "On time", (r) => r.onTime, "on_time", true),
    percent("pct2", "% not on time", (r) => r.pct2, true),
    lastPercent("last2", (r) => r.last2, true),
    {
      // Not part of the measure: work not yet due is held against nobody. Kept as a
      // column only so a row can show what is still to come this period.
      ...count("still", "Due later", (r) => r.stillDue, "still"),
      cell: (r) => (
        <CountButton
          value={r.stillDue}
          title={r.stillDueProjected ? `${r.stillDue - r.stillDueProjected} open, ${r.stillDueProjected} recurring not generated yet` : "Due later — not counted yet"}
          onClick={() => openDrill("still", { row: r })}
        >
          {r.upto && r.stillDue > 0 ? `≤ ${r.stillDue}` : undefined}
        </CountButton>
      ),
      filter: { kind: "select", get: (r) => String(r.stillDue) },
    },
    {
      ...count("next", `Next ${w} planned`, (r) => r.next, "next"),
      cell: (r) => (
        <CountButton
          value={r.next}
          title={r.nextProjected ? `${r.next - r.nextProjected} already due, ${r.nextProjected} recurring not generated yet` : "Already due next " + w}
          onClick={() => openDrill("next", { row: r })}
        >
          {r.upto && r.next > 0 ? `≤ ${r.next}` : undefined}
        </CountButton>
      ),
    },
    {
      key: "score",
      header: "Score",
      align: "right",
      cell: (r) => <span className="font-bold tabular-nums text-navy">{fmtScore(r.score)}</span>,
      sortValue: (r) => r.score ?? -1,
      filter: { kind: "select", get: (r) => fmtScore(r.score) },
      exportValue: (r) => fmtScore(r.score),
    },
  ];

  const runExport = () => {
    if (!report) return;
    void exportKpiScorecard({ personName: person.name, period, report, rows, totals, modules });
  };

  return (
    <div className="space-y-4">
      {/* ── Header: who, when, and the rule ── */}
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div className="w-full sm:w-auto">
            <label className="mb-1.5 block text-[10.5px] font-semibold uppercase tracking-wide text-grey-2">Person</label>
            <Combobox
              value={personId}
              onChange={(v) => setQuery({ user: v })}
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

          <ExcelButton onClick={runExport} disabled={!report} title="Download in the weekly MIS sheet's layout" />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line pt-3 text-[12px] text-grey">
          <span>
            <span className="font-semibold text-navy">Work counts in the {w} it was due.</span> It joins <em>Given</em> once it is done or its due
            date has passed.
          </span>
          {report && <span className="text-grey-2">As of {formatDateTime(report.as_of)}</span>}
        </div>
      </Card>

      {q.isError ? (
        <Card className="p-5 text-[13px] text-[#c0392b]">Could not load the report: {(q.error as Error).message}</Card>
      ) : !q.isLoading && !report ? (
        <Card className="p-5 text-[13px] text-grey">
          No figures yet. They are worked out every night; the first set appears after the first nightly run.
        </Card>
      ) : (
        <>
          {/* ── The headline first: the score, the totals, each module, the trend.
                The grid below is the detail behind it (the user, 18-09-2026). ── */}
          {report && (
            <Consolidated
              period={period}
              report={report}
              totals={totals}
              modules={modules}
              onDrill={(what, module) => openDrill(what, { module })}
            />
          )}

          {/* ── The grid: one row per task / step, both KPIs side by side ── */}
          <Card className="p-0 overflow-hidden">
            <div className="flex flex-wrap gap-x-6 gap-y-1 px-4 pt-3 pb-2 text-[11.5px] text-grey">
              <span>
                <span className="font-semibold text-navy">Given · Done · % not done</span> — all work should be done. % = (done − given) ÷ given.
              </span>
              <span>
                <span className="rounded bg-orange/[0.08] px-1 font-semibold text-navy">Done · On time · % not on time</span> — all work should be done on
                time. % = (on time − done) ÷ done.
              </span>
            </div>
            <div className="px-2 pb-2 sm:px-3">
              <QueueTable
                rows={rows}
                rowKey={(r) => r.key}
                columns={columns}
                loading={q.isLoading}
                rowsLabel="tasks"
                emptyTitle={`Nothing due this ${w}`}
                emptyMessage={`${person.name} had no FMS steps or tasks due in ${periodLabel(period)}.`}
                initialSort={{ key: "given", dir: "desc" }}
                resizeKey="kra-kpi.scorecard"
              />
            </div>
          </Card>

          {/* ── Small print: what the numbers do and do not count ── */}
          {report && (
            <div className="space-y-1 px-1 text-[11.5px] leading-relaxed text-grey-2">
              <p>
                <span className="font-semibold text-grey">On time</span> means done on or before the due date (Indian calendar day). A task finished
                after its deadline was revised is done, but late. The score counts on time as 1, late as ½ and not done as 0, over everything given.
              </p>
              <p>
                A team step with several owners counts for each of them until someone closes it; then only the person who closed it gets it. An admin
                who closes someone&apos;s step gets the credit.
              </p>
              {report.footer.bulk_closed > 0 && (
                <p>
                  {report.footer.bulk_closed} task{report.footer.bulk_closed === 1 ? " was" : "s were"} closed by an admin bulk close and{" "}
                  {report.footer.bulk_closed === 1 ? "is" : "are"} not scored.
                </p>
              )}
              <p>
                Next {w}&apos;s planned work includes recurring tasks not generated yet (they are created one day at a time); ≤ marks tasks that can still
                be marked Not Applicable. An FMS step has no due date until the step before it closes, so only steps already due are counted.
              </p>
              {report.footer.skipped.length > 0 && (
                <p>Not counted, not in use yet: {report.footer.skipped.map((s) => s.name).join(", ")}.</p>
              )}
            </div>
          )}
        </>
      )}

      <ItemsModal drill={drill} rows={rows} onClose={() => setDrill(null)} />
    </div>
  );
}
