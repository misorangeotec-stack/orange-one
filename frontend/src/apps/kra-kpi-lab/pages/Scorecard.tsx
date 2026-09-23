/**
 * The KRA / KPI LAB (KPI-3) — Saloni's weighted framework, scored against live data.
 *
 * ⚠ IT SAVES NOTHING. Every figure it can read is live; every box a reader fills in
 *   themselves lives in that one browser (localStorage) and reaches no table, no
 *   colleague and no report. The banner on the page says so in those words, because
 *   somebody WILL fill it in and expect it kept. Gated to admins and HODs
 *   (RequireReports in HrApp.tsx).
 *
 * What it is for: the live scorecard (KPI-1) weights by volume, and Saloni's sheet
 * weights by declared importance. Before rebuilding the hub around the second model it
 * is worth seeing, on her real figures, how much of her sheet the hub can answer at
 * all. The answer is on the page rather than in a document, so it cannot go stale.
 */
import { useEffect, useMemo, useState } from "react";
import Avatar from "@/shared/components/ui/Avatar";
import Card from "@/shared/components/ui/Card";
import Combobox from "@/shared/components/ui/Combobox";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { useSession } from "@/core/platform/session";
import { computeDownlineIds, useDirectory } from "@/core/platform/store";
import type { Profile } from "@/core/platform/types";
import { cn } from "@/shared/lib/cn";
import { formatDateTime } from "@/shared/lib/time";
import { saloniFramework } from "../framework/saloni";
import { checkWeights, type Coverage, type KpiLine } from "../framework/types";
import { useLabData } from "../data/actuals";
import { checkArithmetic, fmt, type ScoredLine } from "../lib/achievement";
import { asksFor, kraTotals, overallTotals, scoreLines } from "../lib/rows";
import { clearManual, loadManual, saveManual, typedCount, type ManualMap } from "../lib/manual";
import { defaultPeriod, periodLabel, type Period } from "../lib/period";
import CoverageMeter, { bandLabel } from "../components/Coverage";
import NumberCell from "../components/NumberCell";
import PeriodBar from "../components/PeriodBar";
import ScoreHead from "../components/ScoreHead";

const ROLE_GROUP: Record<string, { label: string; rank: number }> = {
  admin: { label: "Admins", rank: 0 },
  hod: { label: "HODs", rank: 1 },
  sub_hod: { label: "Sub-HODs", rank: 2 },
  employee: { label: "Employees", rank: 3 },
};
const roleMeta = (role: string) => ROLE_GROUP[role] ?? ROLE_GROUP.employee;

const BAND: Record<Coverage, { label: string; cls: string }> = {
  system: { label: "Hub", cls: "bg-[#1f8a4d]/10 text-[#1f8a4d] border-[#1f8a4d]/25" },
  partial: { label: "Hub · partial", cls: "bg-[#7cb342]/10 text-[#4e7a1f] border-[#7cb342]/30" },
  "target-missing": { label: "No target", cls: "bg-orange/10 text-orange border-orange/30" },
  unused: { label: "Built · unused", cls: "bg-[#e08a2e]/10 text-[#b4691c] border-[#e08a2e]/30" },
  "not-released": { label: "Built · not live", cls: "bg-[#2f6fb3]/10 text-[#2f6fb3] border-[#2f6fb3]/30" },
  judgement: { label: "Judgement", cls: "bg-[#8e7cc3]/10 text-[#6a55a8] border-[#8e7cc3]/30" },
  "no-data": { label: "Nothing in the hub", cls: "bg-[#c0392b]/8 text-[#c0392b] border-[#c0392b]/25" },
};

/**
 * What the badge says, which is not always the line's structural coverage.
 *
 * A "no target" line that a reader has since typed a target into now carries a real
 * score, and leaving the badge on "No target" makes the row contradict itself. The
 * band still records WHY the line needed help — it just says the help arrived.
 */
function bandOf(s: ScoredLine): { label: string; cls: string } {
  const base = BAND[s.line.coverage];
  if (s.line.coverage === "target-missing" && s.achievement !== null) {
    return { label: "Target typed", cls: "bg-orange/15 text-orange border-orange/45" };
  }
  if ((s.line.coverage === "no-data" || s.line.coverage === "judgement") && s.actualTyped) {
    return { label: `${base.label} · typed`, cls: base.cls };
  }
  return base;
}

const MEASURE_WORD: Record<KpiLine["measure"], string> = {
  sla: "Within a deadline",
  count: "A number reached",
  ratio: "A percentage reached",
  rating: "A rating reached",
  judgement: "Someone's judgement",
};

/** The actual, printed in the line's own unit. */
function actualText(s: ScoredLine): string {
  if (s.actual === null) return "—";
  const u = s.line.unit;
  if (u === "%") return `${s.actual.toFixed(1)}%`;
  if (u === "of 5") return s.actual.toFixed(2);
  return s.actual.toFixed(u.includes("per ") ? 2 : 1);
}

export default function Scorecard() {
  const { user, isAdmin } = useSession();
  const { profiles } = useDirectory();
  const framework = saloniFramework;

  const [period, setPeriod] = useState<Period>(defaultPeriod);

  const pool = useMemo<Profile[]>(() => {
    const byRoleThenName = (a: Profile, b: Profile) =>
      roleMeta(a.role).rank - roleMeta(b.role).rank || a.name.localeCompare(b.name);
    if (isAdmin) return profiles.filter((p) => !p.isExternal || p.id === user.id).sort(byRoleThenName);
    const ids = new Set([user.id, ...computeDownlineIds(profiles, user.id)]);
    const list = profiles.filter((p) => ids.has(p.id));
    if (!list.some((p) => p.id === user.id)) list.push(user);
    return list.sort(byRoleThenName);
  }, [isAdmin, profiles, user]);

  // The sheet was written for Saloni, so open on her where the reader may see her.
  const saloni = pool.find((p) => /saloni/i.test(p.name));
  const [personId, setPersonId] = useState<string>("");
  const activeId = personId || saloni?.id || user.id;
  const person = pool.find((p) => p.id === activeId) ?? user;

  // What the reader has typed, per person and per period.
  const [manual, setManual] = useState<ManualMap>({});
  useEffect(() => {
    setManual(loadManual(framework.id, activeId, period.from, period.to));
  }, [framework.id, activeId, period.from, period.to]);
  const put = (code: string, patch: Partial<{ param: number | null; achievement: number | null }>) => {
    setManual((prev) => {
      const entry = { ...(prev[code] ?? {}) };
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) delete entry[k as "param" | "achievement"];
        else entry[k as "param" | "achievement"] = v;
      }
      const next = { ...prev, [code]: entry };
      saveManual(framework.id, activeId, period.from, period.to, next);
      return next;
    });
  };

  const params = useMemo(() => {
    const out: Record<string, number | null> = {};
    for (const [code, e] of Object.entries(manual)) out[code] = e.param ?? null;
    return out;
  }, [manual]);

  const q = useLabData(activeId, period.from, period.to, params);
  const data = q.data ?? { report: null, hr: {}, hrError: null };

  const scored = useMemo(() => scoreLines(framework, data, manual), [framework, data, manual]);
  // ⚠ Totals are ALWAYS the whole sheet's, never the visible rows'. Clicking a band on
  // the coverage meter narrows the grid so a reader can see which lines it means; a
  // score that moved with it would be answering a question nobody asked.
  const totals = useMemo(() => overallTotals(scored), [scored]);
  const kras = useMemo(() => kraTotals(framework, scored), [framework, scored]);

  const [band, setBand] = useState<Coverage | null>(null);
  const visible = useMemo(() => (band ? scored.filter((s) => s.line.coverage === band) : scored), [scored, band]);

  // No test runner in this repo: the transcription and the arithmetic check themselves
  // on every render, and say so loudly rather than scoring quietly wrong.
  const problems = useMemo(() => [...checkWeights(framework), ...checkArithmetic()], [framework]);

  const columns: QueueColumn<ScoredLine>[] = [
    {
      key: "kra",
      header: "KRA",
      cell: (s) => <span className="whitespace-nowrap text-grey">KRA {s.line.kra}</span>,
      sortValue: (s) => s.line.code,
      filter: { kind: "select", get: (s) => `KRA ${s.line.kra} · ${kras.find((k) => k.code === s.line.kra)?.title ?? ""}` },
      exportValue: (s) => `KRA ${s.line.kra}`,
    },
    {
      key: "group",
      header: "Group",
      cell: (s) => <span className="block truncate text-grey">{s.line.group || "—"}</span>,
      resize: { width: 180, min: 100, max: 420 },
      sortValue: (s) => s.line.group,
      filter: { kind: "select", get: (s) => s.line.group || "—" },
    },
    {
      key: "kpi",
      header: "KPI",
      alwaysVisible: true,
      cell: (s) => (
        <span className="block truncate font-medium text-navy" title={s.line.title}>
          <span className="mr-1.5 text-[10.5px] font-normal text-grey-2">{s.line.code}</span>
          {s.line.title}
        </span>
      ),
      resize: { width: 300, min: 160, max: 700 },
      sortValue: (s) => s.line.code,
      filter: { kind: "select", get: (s) => s.line.title },
    },
    {
      key: "weight",
      header: "Weight (of 100)",
      align: "right",
      cell: (s) => <span className="font-semibold tabular-nums text-navy">{s.line.weight}%</span>,
      sortValue: (s) => s.line.weight,
      filter: { kind: "select", get: (s) => `${s.line.weight}%` },
      exportValue: (s) => s.line.weight,
    },
    {
      key: "measure",
      header: "Measured as",
      cell: (s) => <span className="whitespace-nowrap text-grey">{MEASURE_WORD[s.line.measure]}</span>,
      sortValue: (s) => MEASURE_WORD[s.line.measure],
      filter: { kind: "select", get: (s) => MEASURE_WORD[s.line.measure] },
    },
    {
      key: "target",
      header: "Target to clear",
      // Inputs must not be ellipsized, and the column must not be draggable into a
      // width the box cannot sit in.
      resize: false,
      cell: (s) => {
        const asks = asksFor(s.line);
        if (asks === "param") {
          const p = s.line.param;
          return (
            <span className="flex items-center gap-1.5">
              <NumberCell
                value={manual[s.line.code]?.param ?? null}
                onChange={(v) => put(s.line.code, { param: v })}
                suffix={p ? p.unit : s.line.unit}
                placeholder={p ? String(p.suggest) : "?"}
                title={p ? `${p.label} — feeds the measurement` : "The target the sheet does not state"}
              />
            </span>
          );
        }
        return (
          <span className="whitespace-nowrap text-grey" title={s.line.targetText}>
            {s.line.target === null ? "—" : `${s.line.target}${s.line.unit === "%" ? "%" : ` ${s.line.unit}`}`}
          </span>
        );
      },
      sortValue: (s) => s.target ?? -1,
      filter: { kind: "select", get: (s) => (s.target === null ? "Not stated" : "Stated") },
      exportValue: (s) => (s.target === null ? "not stated" : `${s.target} ${s.line.unit}`),
    },
    {
      key: "actual",
      header: "Actual",
      align: "right",
      resize: false,
      cell: (s) => {
        if (asksFor(s.line) === "achievement") {
          return (
            <NumberCell
              value={manual[s.line.code]?.achievement ?? null}
              onChange={(v) => put(s.line.code, { achievement: v })}
              suffix="/100"
              placeholder="—"
              max={100}
              title="No data can reach this line. Type the mark to see it in the score."
            />
          );
        }
        return (
          <span className={cn("tabular-nums", s.actual === null ? "text-grey-2" : "font-semibold text-navy")} title={s.detail ?? undefined}>
            {actualText(s)}
          </span>
        );
      },
      sortValue: (s) => s.actual ?? -1,
      filter: { kind: "select", get: (s) => (s.actual === null ? "Nothing read" : "Read") },
      exportValue: (s) => (s.actual === null ? "" : Number(s.actual.toFixed(2))),
    },
    {
      key: "achievement",
      header: "Achievement",
      align: "right",
      cell: (s) => (
        <span
          className={cn(
            "tabular-nums",
            s.achievement === null
              ? "text-grey-2"
              : s.achievement >= 90
                ? "font-semibold text-[#1f8a4d]"
                : s.achievement >= 70
                  ? "font-semibold text-navy"
                  : "font-semibold text-[#c0392b]",
          )}
        >
          {s.achievement === null ? "—" : `${fmt(s.achievement)}%`}
        </span>
      ),
      sortValue: (s) => s.achievement ?? -1,
      filter: { kind: "select", get: (s) => (s.achievement === null ? "Not scored" : "Scored") },
      exportValue: (s) => (s.achievement === null ? "" : s.achievement),
    },
    {
      key: "weighted",
      header: "Score",
      align: "right",
      cell: (s) => (
        <span className={cn("tabular-nums", s.weighted === null ? "text-grey-2" : "font-bold text-navy")} title={`out of ${s.line.weight}%`}>
          {s.weighted === null ? "—" : s.weighted.toFixed(2)}
        </span>
      ),
      sortValue: (s) => s.weighted ?? -1,
      filter: { kind: "select", get: (s) => (s.weighted === null ? "—" : "scored") },
      exportValue: (s) => (s.weighted === null ? "" : s.weighted),
    },
    {
      key: "coverage",
      header: "Where it comes from",
      cell: (s) => {
        const b = bandOf(s);
        return (
          <span className={cn("inline-block whitespace-nowrap rounded border px-1.5 py-[1px] text-[11px] font-medium", b.cls)}>
            {b.label}
          </span>
        );
      },
      sortValue: (s) => bandOf(s).label,
      filter: { kind: "select", get: (s) => bandOf(s).label },
      exportValue: (s) => bandOf(s).label,
    },
    {
      key: "note",
      header: "Evidence · what is missing",
      cell: (s) => {
        const text = s.detail ?? s.line.gap ?? s.line.evidence;
        return (
          <span className="block truncate text-[11.5px] text-grey" title={text}>
            {text}
          </span>
        );
      },
      resize: { width: 320, min: 160, max: 900 },
      sortValue: (s) => s.detail ?? s.line.gap ?? "",
      filter: { kind: "select", get: (s) => s.line.evidence },
      exportValue: (s) => s.detail ?? s.line.gap ?? s.line.evidence,
    },
    {
      key: "sheetTarget",
      header: "Target, as the sheet words it",
      defaultHidden: true,
      cell: (s) => (
        <span className="block truncate text-[11.5px] text-grey" title={s.line.targetText}>
          {s.line.targetText}
        </span>
      ),
      resize: { width: 320, min: 160, max: 900 },
      sortValue: (s) => s.line.targetText,
      filter: { kind: "select", get: (s) => s.line.targetText },
    },
  ];

  const typed = typedCount(manual);

  return (
    <div className="space-y-4">
      {/* ── A test page, and it says so before anything else ── */}
      <div className="rounded-lg border border-orange/35 bg-orange/[0.05] px-4 py-2.5 text-[12px] leading-relaxed text-navy">
        <span className="font-semibold">Nothing you type here is saved.</span> The figures the hub can read are live; a target
        or a mark you type yourself stays in THIS browser and reaches no appraisal. This is a reading of the sheet against
        live data, not a record of anybody’s performance. Framework:{" "}
        <span className="font-medium">{framework.role}</span> · {framework.source}
      </div>

      {problems.length > 0 && (
        <div className="rounded-lg border border-[#c0392b]/40 bg-[#c0392b]/[0.06] px-4 py-2.5 text-[12px] text-[#c0392b]">
          <span className="font-semibold">The framework or the arithmetic does not check out.</span> Every figure below
          is suspect until this is fixed: {problems.join(" · ")}
        </div>
      )}

      {/* ── Who, and when ── */}
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
          <PeriodBar period={period} onChange={setPeriod} />
          {typed > 0 && (
            <button
              type="button"
              onClick={() => {
                clearManual(framework.id, activeId, period.from, period.to);
                setManual({});
              }}
              className="rounded border border-line px-2.5 py-1 text-[12px] text-grey hover:border-orange hover:text-orange"
            >
              Clear the {typed} typed figure{typed === 1 ? "" : "s"}
            </button>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-3 text-[11.5px] text-grey">
          <span>
            <span className="font-semibold text-navy">{person.name}</span> · {periodLabel(period)}
          </span>
          {data.report && <span className="text-grey-2">Live figures as of {formatDateTime(data.report.as_of)}</span>}
          {data.hrError && <span className="text-[#c0392b]">Recruitment tables refused this login, so their lines read blank.</span>}
        </div>
      </Card>

      {q.isError ? (
        <Card className="p-5 text-[13px] text-[#c0392b]">Could not load: {(q.error as Error).message}</Card>
      ) : (
        <>
          <CoverageMeter totals={totals} selected={band} onSelect={setBand} />
          <ScoreHead totals={totals} kras={kras} typed={typed} />

          <Card className="p-0 overflow-hidden">
            <div className="px-4 pt-3 pb-2 text-[11.5px] leading-relaxed text-grey">
              One row per KPI line on the sheet. <span className="font-semibold text-navy">Weight</span> is what the sheet
              says the line is worth; <span className="font-semibold text-navy">Target</span> is the bar to clear — two
              different things, and the sheet states the first for every line but leaves the second blank on three of
              them. <span className="font-semibold text-navy">Achievement</span> is the actual against the target, capped
              at 100, and <span className="font-semibold text-navy">Score</span> is that share of the weight. An orange
              box is a number the sheet never gave — type one and the score moves.
            </div>
            {band && (
              // The band came from OUTSIDE the table, so the table's own "Clear filters" cannot
              // undo it. It gets its own way out, right where the narrowing is visible.
              <div className="mx-4 mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-orange/40 bg-orange/[0.06] px-3 py-1.5 text-[12px] text-navy">
                <span>
                  Showing the <span className="font-semibold">{visible.length}</span> line
                  {visible.length === 1 ? "" : "s"} in{" "}
                  <span className="font-semibold">{bandLabel(band)}</span> — {totals.coverage[band]}% of the sheet. The
                  score above is still the whole sheet&apos;s.
                </span>
                <button
                  type="button"
                  onClick={() => setBand(null)}
                  className="rounded border border-orange/50 px-2 py-[1px] text-[11.5px] font-medium text-orange hover:bg-orange hover:text-white"
                >
                  Show all {scored.length}
                </button>
              </div>
            )}
            <div className="px-2 pb-2 sm:px-3">
              <QueueTable
                rows={visible}
                rowKey={(s) => s.line.code}
                columns={columns}
                loading={q.isLoading}
                rowsLabel="KPI lines"
                emptyTitle="This framework has no lines"
                emptyMessage="Nothing was transcribed for this role."
                initialSort={{ key: "kpi", dir: "asc" }}
                columnPicker={{ storageKey: "kpi-lab.scorecard" }}
                resizeKey="kpi-lab.scorecard"
                exportName="KRA_KPI_Lab"
                exportTitle={`${framework.role} — KRA / KPI framework · ${person.name} · ${periodLabel(period)}`}
                exportNotes={[
                  `Source: ${framework.source}`,
                  // The export carries the rows on screen, so a band selection must be
                  // stated in the file or the reader sees 29 lines and a score from 44.
                  ...(band ? [`Narrowed to "${bandLabel(band)}" — ${visible.length} of ${scored.length} lines, ${totals.coverage[band]}% of the sheet. The scores below are still the whole sheet's.`] : []),
                  "TEST OUTPUT. Figures marked 'No data' or 'Judgement' were typed into the lab and are not evidence.",
                  "Achievement = actual ÷ target, capped at 100. Score = achievement × the line's weight.",
                  `Score on what could be measured: ${fmt(totals.onWhatWeHave)} over ${totals.scoredWeight}% of the sheet.`,
                  `Score on the sheet as written (unmeasured lines count zero): ${fmt(totals.onSheet)}.`,
                ]}
              />
            </div>
          </Card>

          <div className="space-y-1 px-1 text-[11.5px] leading-relaxed text-grey-2">
            <p>
              <span className="font-semibold text-grey">Recruitment lines are not scoped to one person.</span> The
              recruitment tables record the requisition, not who chased it. Today one HR executive works them all, so for
              her the figure is hers — the moment a second recruiter exists it is wrong, and it needs an owner on the
              requisition.
            </p>
            <p>
              <span className="font-semibold text-grey">Task Management counts every task.</span> The sheet asks for only
              the ones a HOD tagged with a KRA and bucket; the tasks table has no such fields yet.
            </p>
            <p>
              Interview, offer and Task Management lines come from <span className="font-medium">kpi_report</span> — the
              live scorecard&apos;s own RPC — so they carry each module&apos;s real due dates and nothing here re-derives one.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
