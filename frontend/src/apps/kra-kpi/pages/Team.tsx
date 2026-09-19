import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { useSession } from "@/core/platform/session";
import { cn } from "@/shared/lib/cn";
import { formatDateTime } from "@/shared/lib/time";
import { appBasePath } from "@/apps/appInfo";
import { useKpiTeam } from "../data/team";
import { fmtPct, fmtScore } from "../facts/score";
import { periodLabel, periodWord } from "../lib/period";
import {
  BAND_LABEL,
  LOW_VOLUME,
  bandCounts,
  toTeamRows,
  type Band,
  type TeamRow,
} from "../lib/team";
import { reportQuery, useReportParams } from "../lib/useReportParams";
import PeriodControls, { ExcelButton } from "../components/PeriodControls";
import { exportTeam } from "../lib/exportTeam";

const BANDS: { band: Band; bar: string }[] = [
  { band: "top", bar: "bg-ryg-green" },
  { band: "middle", bar: "bg-ryg-yellow" },
  { band: "low", bar: "bg-ryg-red" },
  { band: "low_volume", bar: "bg-navy/25" },
];

type Focus = Band | null;

const fmtChange = (x: number | null) => (x === null ? "—" : x === 0 ? "0.0" : `${x > 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}`);

/**
 * The Team summary (KPI-2): everyone's KRA / KPI figures side by side, for admins (everyone)
 * and HODs / sub-HODs (their reporting chain) — kpi_team decides who, on the server.
 *
 * Built to the rules the user set on the individual scorecard (18-09-2026): the headline
 * first, the figures as a tree, whole weeks, never a period that has not started. Each person's
 * line is exactly their own scorecard's figures; their name opens that scorecard for the same
 * period, so a director reads the summary and only drills into a row that needs explaining.
 */
export default function Team() {
  const { isAdmin } = useSession();
  const { period, setPeriod } = useReportParams();
  const [showHidden, setShowHidden] = useState(false);
  const [focus, setFocus] = useState<Focus>(null);
  const q = useKpiTeam(period.from, period.to);
  const team = q.data ?? null;
  const W = periodWord(period.mode);
  const w = W.toLowerCase();

  const rows = useMemo(() => (team ? toTeamRows(team.people, showHidden) : []), [team, showHidden]);
  const hiddenCount = useMemo(() => (team ? team.people.filter((p) => p.is_admin || p.is_excluded).length : 0), [team]);
  const bands = useMemo(() => bandCounts(rows), [rows]);
  const withWork = rows.filter((r) => r.given > 0).length;

  // The grid: everyone with work this period or last; a band or department click narrows it.
  // It opens sorted by Score, highest first (see the column's sortValue).
  const gridRows = useMemo(
    () =>
      rows
        .filter((r) => r.given > 0 || r.lastScore !== null)
        .filter((r) =>
          !focus ? true : r.band === focus,
        ),
    [rows, focus],
  );

  // The Excel pack: what the page shows, plus each person's own MIS sheet.
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const runExport = async () => {
    if (!team) return;
    setExportError(null);
    setProgress({ done: 0, total: gridRows.filter((r) => r.given > 0).length });
    try {
      await exportTeam({
        period,
        team,
        rows: gridRows,
        scope: isAdmin ? "Everyone" : "Your reporting chain",
        viewing: [
          `Admins and shared logins: ${showHidden ? "shown" : "hidden"}`,
          ...(focus ? [`Showing only: ${BAND_LABEL[focus]}`] : []),
        ],
        onProgress: (done, total) => setProgress({ done, total }),
      });
    } catch (e) {
      setExportError((e as Error).message);
    } finally {
      setProgress(null);
    }
  };

  const num = (key: string, header: string, get: (r: TeamRow) => number): QueueColumn<TeamRow> => ({
    key,
    header,
    align: "right",
    cell: (r) => <span className={cn("tabular-nums", get(r) === 0 && "text-grey-2")}>{get(r)}</span>,
    sortValue: get,
    filter: { kind: "select", get: (r) => String(get(r)) },
    exportValue: get,
  });
  const pct = (key: string, header: string, get: (r: TeamRow) => number | null): QueueColumn<TeamRow> => ({
    key,
    header,
    align: "right",
    cell: (r) => {
      const v = get(r);
      return (
        <span className={cn("tabular-nums whitespace-nowrap", v === null ? "text-grey-2" : v < 0 ? "font-semibold text-[#c0392b]" : "font-semibold text-[#1f8a4d]")}>
          {fmtPct(v)}
        </span>
      );
    },
    sortValue: (r) => get(r) ?? -1e9,
    filter: { kind: "select", get: (r) => fmtPct(get(r)) },
    exportValue: (r) => fmtPct(get(r)),
  });

  // The score leads — the user, 19-09-2026: "show the score and properly highlight it", sorted
  // highest first. The number itself stays the same as on the person's own scorecard.
  const SCORE_TONE: Record<Band, string> = {
    top: "bg-[#e7f5ec] text-[#1f8a4d]",
    middle: "bg-[#fcf3df] text-[#B7820E]",
    low: "bg-[#fdeceb] text-[#c0392b]",
    low_volume: "bg-page text-grey",
    none: "bg-page text-grey-2",
  };

  const columns: QueueColumn<TeamRow>[] = [
    {
      key: "person",
      header: "Person",
      alwaysVisible: true,
      cell: (r) => (
        <Link
          to={`${appBasePath("kra-kpi")}?${reportQuery(period, r.id)}`}
          title={`Open ${r.name}'s scorecard for ${periodLabel(period)}`}
          className="whitespace-nowrap font-semibold text-navy underline decoration-line underline-offset-2 hover:text-orange"
        >
          {r.name}
        </Link>
      ),
      sortValue: (r) => r.name,
      filter: { kind: "select", get: (r) => r.name },
    },
    {
      key: "score",
      header: "Score",
      cell: (r) => (
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span className={cn("inline-block min-w-[58px] rounded-lg px-2.5 py-1 text-center text-[15px] font-bold tabular-nums", SCORE_TONE[r.band])}>
            {fmtScore(r.score)}
          </span>
          {r.lowVolume && (
            <span
              title={`Fewer than ${LOW_VOLUME} pieces of work this ${w} — not comparable with a full workload`}
              className="rounded-full bg-page px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-grey-2"
            >
              low volume
            </span>
          )}
        </span>
      ),
      // Highest first by default, and among people with a full workload first: a "100" earned on
      // two tasks follows them, and those with nothing due come last.
      sortValue: (r) => (r.score === null ? -2000 : r.lowVolume ? r.score - 1000 : r.score),
      filter: { kind: "select", get: (r) => fmtScore(r.score) },
      exportValue: (r) => fmtScore(r.score),
    },
    num("given", "Tasks given", (r) => r.given),
    num("done", "Done", (r) => r.done),
    num("ontime", "On time", (r) => r.onTime),
    num("late", "Late", (r) => r.late),
    num("missed", "Not done", (r) => r.missed),
    {
      key: "last",
      header: `Last ${w}`,
      align: "right",
      cell: (r) => <span className="tabular-nums text-grey">{fmtScore(r.lastScore)}</span>,
      sortValue: (r) => r.lastScore ?? -1,
      filter: { kind: "select", get: (r) => fmtScore(r.lastScore) },
      exportValue: (r) => fmtScore(r.lastScore),
    },
    {
      key: "change",
      header: "Change",
      align: "right",
      cell: (r) => (
        <span
          className={cn(
            "tabular-nums font-semibold",
            r.change === null || r.change === 0 ? "text-grey-2" : r.change > 0 ? "text-[#1f8a4d]" : "text-[#c0392b]",
          )}
        >
          {fmtChange(r.change)}
        </span>
      ),
      sortValue: (r) => r.change ?? -1e9,
      filter: { kind: "select", get: (r) => fmtChange(r.change) },
      exportValue: (r) => fmtChange(r.change),
    },
    pct("pct1", "% not done", (r) => r.pct1),
    pct("pct2", "% not on time", (r) => r.pct2),
    {
      key: "department",
      header: "Department",
      cell: (r) => <span className="whitespace-nowrap text-grey">{r.department || "—"}</span>,
      sortValue: (r) => r.department,
      filter: { kind: "select", get: (r) => r.department },
    },
    {
      key: "designation",
      header: "Designation",
      cell: (r) => <span className="block min-w-[150px] text-grey">{r.designation || "—"}</span>,
      sortValue: (r) => r.designation,
      filter: { kind: "select", get: (r) => r.designation },
    },
    {
      key: "reports",
      header: "Reports to",
      cell: (r) => <span className="block min-w-[150px] text-grey">{r.reportsTo || "—"}</span>,
      sortValue: (r) => r.reportsTo,
      filter: { kind: "select", get: (r) => r.reportsTo },
    },
    {
      key: "modules",
      header: "Worked in",
      cell: (r) => <span className="block min-w-[180px] text-[12.5px] text-grey">{r.modules.join(", ") || "—"}</span>,
      sortValue: (r) => r.modules.join(", "),
      filter: { kind: "select", get: (r) => r.modules.join(", ") },
    },
  ];

  const refused = q.isError && /no one in your reporting chain/i.test((q.error as Error).message);

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <PeriodControls period={period} onChange={setPeriod} />
          {hiddenCount > 0 && (
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 text-[12.5px] text-grey">
              <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} className="h-4 w-4 accent-orange" />
              Show admins and shared logins ({hiddenCount})
            </label>
          )}
          <div className="inline-flex items-center gap-2 sm:ml-auto">
            {progress && <span className="text-[12px] text-grey tabular-nums">Sheet {progress.done} of {progress.total}…</span>}
            <ExcelButton
              onClick={runExport}
              disabled={!team || gridRows.length === 0}
              busy={!!progress}
              title="The summary, plus every person's MIS sheet — the whole weekly review in one file"
            />
          </div>
        </div>
        {exportError && <p className="mt-2 text-[12px] text-[#c0392b]">Could not build the file: {exportError}</p>}
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-line pt-3 text-[12px] text-grey">
          <span>
            <span className="font-semibold text-navy">Work counts in the {w} it was due.</span> Each person's line is exactly their own
            scorecard; click a name to open it.
          </span>
          {team && <span className="text-grey-2">As of {formatDateTime(team.as_of)}</span>}
        </div>
      </Card>

      {refused ? (
        <Card className="p-5 text-[13px] text-grey">
          There is no one in your reporting chain yet, so there is no team to summarise. Your own figures are on the{" "}
          <Link to={appBasePath("kra-kpi")} className="font-semibold text-orange hover:underline">
            Scorecard
          </Link>
          .
        </Card>
      ) : q.isError ? (
        <Card className="p-5 text-[13px] text-[#c0392b]">Could not load the team: {(q.error as Error).message}</Card>
      ) : !q.isLoading && !team ? (
        <Card className="p-5 text-[13px] text-grey">No figures yet. They are worked out every night; the first set appears after the first nightly run.</Card>
      ) : (
        <>
          {/* ── One line per person ──
              The team-wide block (team score, departments, weekly trend) was removed on the user's
              review, 19-09-2026: a pooled team figure is carried by the busiest few people and does not
              describe the team. What stays is the four score bands, as a filter over the table. */}
          <Card className="p-0 overflow-hidden">
            {team && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-3.5">
                <span className="text-[12.5px] text-grey">
                  <span className="font-semibold text-navy">
                    {withWork} {withWork === 1 ? "person" : "people"}
                  </span>{" "}
                  with work due this {w}
                  {!showHidden && hiddenCount > 0 && " · admins and shared logins hidden"}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {BANDS.map(({ band, bar }) => {
                    const on = focus === band;
                    return (
                      <button
                        key={band}
                        type="button"
                        disabled={bands[band] === 0 && !on}
                        onClick={() => setFocus(on ? null : band)}
                        title={on ? "Show everyone" : `Show only: ${BAND_LABEL[band]}`}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition disabled:opacity-40",
                          on ? "border-orange bg-orange/[0.08] text-navy" : "border-line text-grey enabled:hover:border-orange/40",
                        )}
                      >
                        <span className={cn("h-2 w-2 rounded-full", bar)} />
                        {BAND_LABEL[band]}
                        <span className="font-bold tabular-nums text-navy">{bands[band]}</span>
                      </button>
                    );
                  })}
                  {focus && (
                    <button type="button" onClick={() => setFocus(null)} className="px-1.5 text-[12px] font-semibold text-orange hover:underline">
                      Show everyone
                    </button>
                  )}
                </div>
              </div>
            )}
            <div className="px-2 pb-2 sm:px-3">
              <QueueTable
                rows={gridRows}
                rowKey={(r) => r.id}
                columns={columns}
                loading={q.isLoading}
                rowsLabel="people"
                emptyTitle={`No work due this ${w}`}
                emptyMessage={`Nobody in view had work due in ${periodLabel(period)}.`}
                initialSort={{ key: "score", dir: "desc" }}
              />
            </div>
          </Card>

          {team && (
            <div className="space-y-1 px-1 text-[11.5px] leading-relaxed text-grey-2">
              <p>
                <span className="font-semibold text-grey">Low volume</span> marks fewer than {LOW_VOLUME} pieces of work in the {w}: the score is
                shown, but kept out of the score bands, since a handful of tasks is not comparable with a full workload.
              </p>
              <p>
                Admins and the shared QC / QA logins are hidden unless switched on: an admin who closes someone's step gets the credit, so their
                figures do not read like anyone else's.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
