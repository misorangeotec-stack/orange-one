import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Combobox from "@/shared/components/ui/Combobox";
import Avatar from "@/shared/components/ui/Avatar";
import Button from "@/shared/components/ui/Button";
import { cn } from "@/shared/lib/cn";
import { addWeeks, formatDate, isoWeekOf, weekEndOf, weekStartOf } from "@/shared/lib/time";
import { WEEK_START } from "../mock/data";
import { useSession } from "../mock/session";
import { useTaskStore } from "../mock/store";
import { actualRygFor, computeStats, downlineIds, reportFor } from "../mock/selectors";
import { rygCounts } from "../components/RygCells";
import RygBar from "../components/RygBar";
import { useReportsToSuffix } from "../components/ReportsToTag";
import { taskListLink, type RygColour } from "../lib/taskLink";
import type { Profile, WeeklyPlan } from "../types";

const GREEN = "text-[#1f8a4d]";
const YELLOW = "text-[#B7820E]";
const RED = "text-[#c0392b]";

// Selector grouping: cluster the team-member list by role so the admin can see at a
// glance who is a HOD / Sub-HOD / employee. Lower rank = shown first.
const ROLE_GROUP: Record<string, { label: string; rank: number }> = {
  admin: { label: "Admins", rank: 0 },
  hod: { label: "HODs", rank: 1 },
  sub_hod: { label: "Sub-HODs", rank: 2 },
  employee: { label: "Employees", rank: 3 },
};
const roleMeta = (role: string) => ROLE_GROUP[role] ?? { label: "Employees", rank: 3 };

/**
 * Weekly Scorecard — a focused per-employee view: this week's plan, the actual
 * achieved RYG, and next week's (editable) plan, with a Planned vs Actual vs Next
 * comparison. Admin picks any user; a HOD/sub-HOD picks anyone in their downline;
 * an employee sees only themselves. Plan editing follows the existing rules
 * (admin, or a manager somewhere up the doer's chain) and is RLS-enforced on save.
 */
export default function WeeklyScorecard() {
  const { user, role, isAdmin, isHod } = useSession();
  const { tasks, profiles, profileById, weeklyPlanFor } = useTaskStore();
  // Optional deep-link from Master Analysis: ?user=<id>&week=<yyyy-mm-dd>.
  const [searchParams] = useSearchParams();
  const linkedUser = searchParams.get("user");
  const linkedWeek = searchParams.get("week");
  const [weekStart, setWeekStart] = useState(linkedWeek ? weekStartOf(linkedWeek) : WEEK_START);
  const [selectedId, setSelectedId] = useState(linkedUser ?? user.id);

  // Who this viewer may look at: admin → everyone; manager → self + transitive
  // downline; employee → only self.
  const pool = useMemo<Profile[]>(() => {
    // Cluster by role (Admins → HODs → Sub-HODs → Employees), then alphabetical.
    const byRoleThenName = (a: Profile, b: Profile) =>
      roleMeta(a.role).rank - roleMeta(b.role).rank || a.name.localeCompare(b.name);
    if (isAdmin) return [...profiles].sort(byRoleThenName);
    if (isHod) {
      const ids = new Set([user.id, ...downlineIds(profiles, user.id)]);
      return profiles.filter((p) => ids.has(p.id)).sort(byRoleThenName);
    }
    return [user];
  }, [isAdmin, isHod, profiles, user]);

  // Keep the selection valid if the pool changes (e.g. directory reload).
  useEffect(() => {
    if (!pool.some((p) => p.id === selectedId)) setSelectedId(user.id);
  }, [pool, selectedId, user.id]);

  const selected = profileById(selectedId) ?? user;
  const reportsToSuffix = useReportsToSuffix();

  // Can the current viewer edit the selected doer's plan? Mirrors the weekly_plans
  // RLS (admin, or a HOD anywhere above the doer). Self-editing is not allowed.
  const canEdit = isAdmin || (isHod && downlineIds(profiles, user.id).includes(selectedId));

  const nextWeek = addWeeks(weekStart, 1);
  const thisPlan = weeklyPlanFor(selectedId, weekStart);
  const nextPlan = weeklyPlanFor(selectedId, nextWeek);

  // This week's actuals for the selected person.
  const weekTasks = useMemo(
    () => tasks.filter((t) => t.weekStart === weekStart && t.assignedTo === selectedId),
    [tasks, weekStart, selectedId]
  );
  const report = useMemo(() => reportFor(weekTasks, selectedId), [weekTasks, selectedId]);
  const actual = useMemo(() => actualRygFor(weekTasks, selectedId, weekStart), [weekTasks, selectedId, weekStart]);
  const counts = rygCounts(report);
  const stats = useMemo(() => computeStats(weekTasks), [weekTasks]);
  const hasTasks = actual.total > 0;

  // Personal (self-tracking) tasks are excluded from every score, so they never
  // show up in the RYG/stat counts above. Surface their own counters here — all
  // of the selected person's personal tasks, since they aren't week-planned.
  const personalStats = useMemo(() => {
    const s = { total: 0, pending: 0, inProgress: 0, completed: 0 };
    for (const t of tasks) {
      if (t.assignedTo !== selectedId || !t.isPersonal) continue;
      s.total++;
      if (t.status === "pending") s.pending++;
      else if (t.status === "in_progress") s.inProgress++;
      else if (t.status === "completed") s.completed++;
    }
    return s;
  }, [tasks, selectedId]);

  const { isoYear, isoWeek } = isoWeekOf(weekStart);

  // Deep-link from a number on this card into the role-appropriate task list,
  // pre-filtered to this person + this week + the matching status/colour.
  const colourLink = (colour: RygColour) => taskListLink({ role, assignee: selectedId, weekStart, colour, metricOnly: true });
  const statusLink = (status: "pending" | "in_progress" | "shifted") =>
    taskListLink({ role, assignee: selectedId, weekStart, statuses: [status], metricOnly: true });

  return (
    <div className="space-y-5">
      {/* header: team member + week */}
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div>
          <label className="block text-[10.5px] font-semibold uppercase tracking-wide text-grey-2 mb-1.5">Team member</label>
          <Combobox
            value={selectedId}
            onChange={setSelectedId}
            disabled={pool.length <= 1}
            className="min-w-[240px]"
            options={pool.map((p) => ({
              value: p.id,
              label: p.name,
              sublabel: [p.designation, reportsToSuffix(p, user.id)].filter(Boolean).join(" · ") || undefined,
              icon: <Avatar name={p.name} color={p.avatarColor} size={22} />,
              group: pool.length > 1 ? roleMeta(p.role).label : undefined,
            }))}
          />
        </div>
        <div>
          <label className="block text-[10.5px] font-semibold uppercase tracking-wide text-grey-2 mb-1.5">Week</label>
          <WeekNav weekStart={weekStart} onChange={setWeekStart} isoYear={isoYear} isoWeek={isoWeek} />
        </div>
      </div>

      {/* three cards */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* 1. this week — planned */}
        <Card className="p-5">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">This week — planned</h3>
          <p className="mt-1 text-[12.5px] text-grey-2 tabular-nums">
            {formatDate(weekStart)} – {formatDate(weekEndOf(weekStart))}
          </p>
          <div className="mt-4">
            <PlanEditor
              key={`this-${selectedId}-${weekStart}`}
              doerId={selectedId}
              weekStart={weekStart}
              existing={thisPlan}
              canEdit={canEdit}
              startCollapsed
              hint="Plans are normally committed the prior week."
            />
          </div>
        </Card>

        {/* 2. actual score */}
        <Card className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">Actual score</h3>
              <p className="mt-1 text-[26px] font-bold text-navy leading-none tabular-nums">
                {actual.total} task{actual.total === 1 ? "" : "s"}
              </p>
            </div>
            <Avatar name={selected.name} color={selected.avatarColor} size={32} />
          </div>

          <div className="mt-4">
            <RygBar red={actual.red} yellow={actual.yellow} green={actual.green} showLegend={false} />
            <div className="mt-2 flex items-center justify-between text-[11.5px] font-medium">
              <Link to={colourLink("green")} className={cn(GREEN, "hover:underline")}>G {hasTasks ? actual.green : 0}%</Link>
              <Link to={colourLink("yellow")} className={cn(YELLOW, "hover:underline")}>Y {hasTasks ? actual.yellow : 0}%</Link>
              <Link to={colourLink("red")} className={cn(RED, "hover:underline")}>R {hasTasks ? actual.red : 0}%</Link>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-3 text-center">
            <BigNum tone={GREEN} value={counts.green} label="Green" to={colourLink("green")} />
            <BigNum tone={YELLOW} value={counts.yellow} label="Yellow" to={colourLink("yellow")} />
            <BigNum tone={RED} value={counts.red} label="Red" to={colourLink("red")} />
          </div>

          <div className="mt-4 flex flex-wrap gap-1.5">
            <Pill label="Pending" count={stats.pending} tone="red" to={statusLink("pending")} />
            <Pill label="In progress" count={stats.inProgress} tone="red" to={statusLink("in_progress")} />
            <Pill label="Shifted" count={stats.shifted} tone="red" to={statusLink("shifted")} />
          </div>
        </Card>

        {/* 3. next week — planned */}
        <Card className="p-5">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">Next week — planned</h3>
          <p className="mt-1 text-[12.5px] text-grey-2 tabular-nums">
            {formatDate(nextWeek)} – {formatDate(weekEndOf(nextWeek))}
          </p>
          <div className="mt-4">
            <PlanEditor
              key={`next-${selectedId}-${nextWeek}`}
              doerId={selectedId}
              weekStart={nextWeek}
              existing={nextPlan}
              canEdit={canEdit}
            />
          </div>
        </Card>
      </div>

      {/* personal tasks — self-tracking, deliberately excluded from the score above */}
      <Card className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">Personal tasks</h3>
            <p className="mt-1 text-[12px] text-grey-2">Self-tracking · not counted in the score</p>
          </div>
          <p className="text-[26px] font-bold text-navy leading-none tabular-nums">{personalStats.total}</p>
        </div>
        {personalStats.total === 0 ? (
          <p className="mt-3 text-[13px] text-grey-2 italic">No personal tasks.</p>
        ) : (
          <div className="mt-4 grid max-w-md grid-cols-3 text-center">
            <BigNum tone="text-navy" value={personalStats.pending} label="Pending" />
            <BigNum tone="text-blue" value={personalStats.inProgress} label="In progress" />
            <BigNum tone={GREEN} value={personalStats.completed} label="Completed" />
          </div>
        )}
      </Card>

      {/* comparison table */}
      <Card className="p-0 overflow-hidden">
        <div className="px-5 pt-4 pb-3">
          <h3 className="text-[15px] font-bold text-navy">Planned vs Actual vs Next</h3>
          <p className="text-[11.5px] text-grey-2">All values as % of weekly tasks.</p>
        </div>
        <ScrollableTable>
          <table className="w-full text-[12.5px] border-collapse">
            <thead>
              <tr className="text-grey-2 text-[10.5px] uppercase tracking-wide bg-page/50 border-t border-line">
                <th className="text-left font-semibold px-5 py-2.5">Bucket</th>
                <th className="text-right font-semibold px-4 py-2.5">This week planned</th>
                <th className="text-right font-semibold px-4 py-2.5">Actual</th>
                <th className="text-right font-semibold px-4 py-2.5">Delta</th>
                <th className="text-right font-semibold px-5 py-2.5">Next week planned</th>
              </tr>
            </thead>
            <tbody>
              <CompareRow
                label="Green (on time)" dot="bg-ryg-green"
                planned={thisPlan?.greenPct ?? null} actual={hasTasks ? actual.green : null} next={nextPlan?.greenPct ?? null}
              />
              <CompareRow
                label="Yellow (revised)" dot="bg-ryg-yellow"
                planned={thisPlan?.yellowPct ?? null} actual={hasTasks ? actual.yellow : null} next={nextPlan?.yellowPct ?? null}
              />
              <CompareRow
                label="Red (shifted/missed/open)" dot="bg-ryg-red"
                planned={thisPlan?.redPct ?? null} actual={hasTasks ? actual.red : null} next={nextPlan?.redPct ?? null}
              />
            </tbody>
          </table>
        </ScrollableTable>
      </Card>
    </div>
  );
}

/* ---------- plan editor (inline, this-week & next-week) ---------- */

function PlanEditor({
  doerId, weekStart, existing, canEdit, startCollapsed, hint,
}: {
  doerId: string;
  weekStart: string;
  existing: WeeklyPlan | undefined;
  canEdit: boolean;
  startCollapsed?: boolean;
  hint?: string;
}) {
  const { setWeeklyPlan } = useTaskStore();
  const [editing, setEditing] = useState(!startCollapsed && canEdit);
  const [green, setGreen] = useState(existing?.greenPct ?? 70);
  const [yellow, setYellow] = useState(existing?.yellowPct ?? 20);
  const [red, setRed] = useState(existing?.redPct ?? 10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const sum = green + yellow + red;
  const valid = sum === 100 && green >= 0 && yellow >= 0 && red >= 0;

  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    try {
      await setWeeklyPlan({ doerId, weekStart, redPct: red, yellowPct: yellow, greenPct: green });
      if (startCollapsed) setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Read-only / summary view (not editing).
  if (!editing) {
    return (
      <div className="space-y-3">
        {existing ? (
          <>
            <RygBar red={existing.redPct} yellow={existing.yellowPct} green={existing.greenPct} showLegend={false} />
            <div className="flex items-center justify-between text-[12px] font-medium">
              <span className={GREEN}>Green {existing.greenPct}%</span>
              <span className={YELLOW}>Yellow {existing.yellowPct}%</span>
              <span className={RED}>Red {existing.redPct}%</span>
            </div>
          </>
        ) : (
          <p className="text-[13px] text-grey-2 italic">No plan saved.</p>
        )}
        {hint && <p className="text-[11px] text-grey-2 pt-1 border-t border-line">{hint}</p>}
        {canEdit && (
          <Button variant="ghost" size="sm" className="w-full" onClick={() => setEditing(true)}>
            {existing ? "Edit saved plan" : "Set plan"}
          </Button>
        )}
      </div>
    );
  }

  // Editing view.
  return (
    <div className="space-y-3">
      <PctRow label="Green %" dot="bg-ryg-green" value={green} onChange={setGreen} />
      <PctRow label="Yellow %" dot="bg-ryg-yellow" value={yellow} onChange={setYellow} />
      <PctRow label="Red %" dot="bg-ryg-red" value={red} onChange={setRed} />
      <p className={cn("text-[12px] font-medium", sum === 100 ? "text-grey-2" : "text-[#d4493f]")}>
        Sum: {sum}%
      </p>
      {error && <p className="text-[12px] text-[#d4493f]">{error}</p>}
      <div className="flex gap-2">
        {startCollapsed && (
          <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={busy}>Cancel</Button>
        )}
        <Button size="sm" className="flex-1" onClick={save} disabled={!valid || busy}>
          {busy ? "Saving…" : "Save plan"}
        </Button>
      </div>
    </div>
  );
}

function PctRow({ label, dot, value, onChange }: { label: string; dot: string; value: number; onChange: (n: number) => void }) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="inline-flex items-center gap-2 text-[13px] text-ink">
        <span className={`w-2.5 h-2.5 rounded-full ${dot}`} />
        {label}
      </span>
      <input
        type="number"
        min={0}
        max={100}
        value={value}
        onChange={(e) => onChange(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
        className="w-20 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[13.5px] text-ink text-right tabular-nums outline-none transition focus:border-orange focus:ring-4 focus:ring-orange/10"
      />
    </label>
  );
}

/* ---------- small presentational helpers ---------- */

function BigNum({ tone, value, label, to }: { tone: string; value: number; label: string; to?: string }) {
  const inner = (
    <>
      <div className={cn("text-[24px] font-bold leading-none tabular-nums", tone)}>{value}</div>
      <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-grey-2">{label}</div>
    </>
  );
  if (!to) return <div>{inner}</div>;
  return (
    <Link to={to} title={`View ${label.toLowerCase()} tasks`} className="block rounded-lg py-1 transition hover:bg-page">
      {inner}
    </Link>
  );
}

function Pill({ label, count, tone, to }: { label: string; count: number; tone: "red" | "yellow"; to?: string }) {
  const on = count > 0;
  const onCls = tone === "red" ? "bg-[#fdeceb] text-[#c0392b]" : "bg-[#fcf3df] text-[#B7820E]";
  const cls = cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide transition",
    on ? onCls : "bg-page text-grey-2/70", to && "hover:ring-2 hover:ring-orange/30");
  const inner = (
    <>
      {label} <span className="tabular-nums">{count}</span>
    </>
  );
  if (!to) return <span className={cls}>{inner}</span>;
  return (
    <Link to={to} title={`View ${label.toLowerCase()} tasks`} className={cls}>
      {inner}
    </Link>
  );
}

function CompareRow({ label, dot, planned, actual, next }: {
  label: string; dot: string; planned: number | null; actual: number | null; next: number | null;
}) {
  const delta = planned !== null && actual !== null ? actual - planned : null;
  return (
    <tr className="border-t border-line bg-white">
      <td className="px-5 py-3 align-middle">
        <span className="inline-flex items-center gap-2 text-[13px] font-medium text-navy">
          <span className={`w-2.5 h-2.5 rounded-full ${dot}`} />
          {label}
        </span>
      </td>
      <td className="px-4 py-3 text-right align-middle tabular-nums text-grey">{planned !== null ? `${planned}%` : "—"}</td>
      <td className="px-4 py-3 text-right align-middle tabular-nums font-semibold text-navy">{actual !== null ? `${actual}%` : "—"}</td>
      <td className={cn("px-4 py-3 text-right align-middle tabular-nums font-medium",
        delta === null ? "text-grey-2" : delta > 0 ? "text-[#1f8a4d]" : delta < 0 ? "text-[#c0392b]" : "text-grey")}>
        {delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta}%`}
      </td>
      <td className="px-5 py-3 text-right align-middle tabular-nums text-grey">{next !== null ? `${next}%` : "—"}</td>
    </tr>
  );
}

/* ---------- week navigator (prev / next / jump, with ISO-week label) ---------- */

function WeekNav({ weekStart, onChange, isoYear, isoWeek }: {
  weekStart: string; onChange: (ws: string) => void; isoYear: number; isoWeek: number;
}) {
  const isCurrent = weekStart === WEEK_START;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => onChange(addWeeks(weekStart, -1))}
        aria-label="Previous week"
        className="w-8 h-8 grid place-items-center rounded-lg border border-line text-grey hover:text-orange hover:border-orange/40 transition"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
      </button>
      <span className="px-2 text-center">
        <span className="block text-[13px] font-semibold text-navy tabular-nums leading-tight">W{isoWeek} {isoYear}</span>
        <span className="block text-[11px] text-grey-2 tabular-nums leading-tight">{formatDate(weekStart)} – {formatDate(weekEndOf(weekStart))}</span>
      </span>
      <button
        type="button"
        onClick={() => onChange(addWeeks(weekStart, 1))}
        aria-label="Next week"
        className="w-8 h-8 grid place-items-center rounded-lg border border-line text-grey hover:text-orange hover:border-orange/40 transition"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
      </button>
      <input
        type="date"
        value={weekStart}
        onChange={(e) => e.target.value && onChange(weekStartOf(e.target.value))}
        title="Pick any day to jump to that week"
        className="ml-1 rounded-lg border border-line bg-white px-2 py-1.5 text-[12.5px] text-ink outline-none focus:border-orange cursor-pointer"
      />
      {!isCurrent && (
        <button type="button" onClick={() => onChange(WEEK_START)} className="ml-1 rounded-lg border border-line px-2.5 py-1.5 text-[12.5px] font-semibold text-orange hover:border-orange/40 transition">
          Jump to current week
        </button>
      )}
    </div>
  );
}
