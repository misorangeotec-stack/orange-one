import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { Fragment, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Avatar from "@/shared/components/ui/Avatar";
import EmptyState from "@/shared/components/ui/EmptyState";
import { cn } from "@/shared/lib/cn";
import { matchesSearch } from "@/shared/lib/search";
import { useSession } from "../mock/session";
import { useTaskStore } from "../mock/store";
import { taskListLink, type RygColour } from "../lib/taskLink";
import { WEEK_START } from "../mock/data";
import { reportFor, aggregateRyg, actualRygFor } from "../mock/selectors";
import type { PersonReport, RygPct } from "../mock/selectors";
import type { AppRole, Profile } from "../types";
import { rygCounts, redCounts, RygNumCell, PerfCell } from "./RygCells";
import type { RedCounts } from "./RygCells";
import ReportsToTag from "./ReportsToTag";

const ROLE_LABEL: Record<AppRole, string> = { admin: "Admin", hod: "HOD", sub_hod: "Sub-HOD", employee: "Employee" };
// HODs/managers surface first inside a department, then everyone else.
const ROLE_ORDER: Record<AppRole, number> = { hod: 0, sub_hod: 1, admin: 2, employee: 3 };

type SortKey = "name" | "planned" | "green" | "yellow" | "red";
type SortDir = "asc" | "desc";

function emptyReport(): PersonReport {
  return { planned: 0, completed: 0, pending: 0, revised: 0, shifted: 0, revisionTotal: 0 };
}

type Group = {
  id: string;
  name: string;
  members: Profile[];
  rows: { p: Profile; r: PersonReport; actual: RygPct; red: RedCounts; planned: RygPct }[];
  agg: PersonReport;
  planned: RygPct;
  actual: RygPct;
  red: RedCounts;
};

/** When set, the report is scoped to a single department with an explicit member list
 *  (used by HOD / sub-HOD: their own department + their reports + themselves). */
type Scope = { deptId: string | null; memberIds: string[]; selfId?: string };

/**
 * Department performance for the week in one expandable table, with a plan-vs-actual
 * table beneath. Admin (no `scope`) sees every department; a HOD/sub-HOD passes `scope`
 * to see just their own department populated with their team.
 */
export default function DepartmentReport({ weekStart = WEEK_START, scope }: { weekStart?: string; scope?: Scope }) {
  const { tasks, departments, profiles, profileById, departmentById, weeklyPlanFor } = useTaskStore();
  const { role } = useSession();
  const navigate = useNavigate();
  // Clicking a member opens their Weekly Scorecard for the same week.
  const openScorecard = (id: string) => navigate(`/task-management/scorecard?user=${id}&week=${weekStart}`);
  // A RYG count drills into the filtered task list for that person/department + week + colour.
  const memberLink = (personId: string, colour: RygColour) => taskListLink({ role, assignee: personId, weekStart, colour, metricOnly: true });
  const deptLink = (deptId: string, colour: RygColour) =>
    deptId === "__none__" ? undefined : taskListLink({ role, dept: deptId, weekStart, colour, metricOnly: true });
  const scoped = !!scope;
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({});
  const toggle = (id: string) => setOpenIds((p) => ({ ...p, [id]: !p[id] }));
  const [query, setQuery] = useState("");
  const q = query.trim();
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "planned", dir: "desc" });
  // Name sorts A→Z by default; numeric columns sort highest-first.
  const onSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" ? "asc" : "desc" }));

  const weekTasks = useMemo(() => tasks.filter((t) => t.weekStart === weekStart), [tasks, weekStart]);

  const groups = useMemo<Group[]>(() => {
    // Scoped (HOD/sub-HOD): a single bucket for their own department; members are the
    // explicitly-passed ids (their team + themselves), regardless of those people's own dept.
    const buckets: { id: string; name: string }[] = scope
      ? [{ id: scope.deptId ?? "__none__", name: departmentById(scope.deptId)?.name ?? "Unassigned" }]
      : departments.map((d) => ({ id: d.id, name: d.name }));
    if (!scope && profiles.some((p) => !p.departmentId)) buckets.push({ id: "__none__", name: "Unassigned" });

    return buckets
      .map(({ id, name }) => {
        const members = (scope
          ? scope.memberIds.map((mid) => profileById(mid)).filter(Boolean) as Profile[]
          : profiles.filter((p) => (id === "__none__" ? !p.departmentId : p.departmentId === id))
        ).slice().sort((a, b) => (ROLE_ORDER[a.role] - ROLE_ORDER[b.role]) || a.name.localeCompare(b.name));
        const rows = members.map((p) => ({
          p,
          r: reportFor(weekTasks, p.id),
          actual: actualRygFor(weekTasks, p.id, weekStart),
          red: redCounts(weekTasks, new Set([p.id])),
          planned: aggregateRyg([p.id], [weekStart], weekTasks, weeklyPlanFor).planned,
        }));
        const agg = rows.reduce<PersonReport>((a, { r }) => ({
          planned: a.planned + r.planned,
          completed: a.completed + r.completed,
          pending: a.pending + r.pending,
          revised: a.revised + r.revised,
          shifted: a.shifted + r.shifted,
          revisionTotal: a.revisionTotal + r.revisionTotal,
        }), emptyReport());
        const { planned, actual } = aggregateRyg(members.map((p) => p.id), [weekStart], weekTasks, weeklyPlanFor);
        const red = redCounts(weekTasks, new Set(members.map((p) => p.id)));
        return { id, name, members, rows, agg, planned, actual, red };
      })
      .sort((a, b) => b.agg.planned - a.agg.planned || a.name.localeCompare(b.name));
  }, [departments, profiles, weekTasks, weeklyPlanFor, weekStart, scope, profileById, departmentById]);

  // Search filters by department name, or by member name / designation / role within a department.
  // A department-name match keeps all its members; a member match narrows to the matching people.
  const visibleGroups = useMemo<Group[]>(() => {
    if (!q) return groups;
    return groups.flatMap((g) => {
      if (matchesSearch(q, g.name)) return [g];
      const rows = g.rows.filter(({ p }) =>
        matchesSearch(q, p.name, p.designation, ROLE_LABEL[p.role])
      );
      return rows.length ? [{ ...g, rows, members: rows.map((r) => r.p) }] : [];
    });
  }, [groups, q]);

  const sortedGroups = useMemo<Group[]>(() => {
    const cmpBy = (a: number | string, b: number | string) =>
      (typeof a === "string" ? a.localeCompare(b as string) : a - (b as number)) * (sort.dir === "asc" ? 1 : -1);
    const groupVal = (g: Group): number | string => {
      const c = rygCounts(g.agg);
      switch (sort.key) {
        case "name": return g.name.toLowerCase();
        case "planned": return g.agg.planned;
        case "green": return c.green;
        case "yellow": return c.yellow;
        case "red": return c.red;
      }
    };
    // Scoped views show a single department, so the column sort orders the member rows;
    // the all-departments (admin) view sorts the department rows instead.
    if (scoped) {
      const rowVal = (row: Group["rows"][number]): number | string => {
        const c = rygCounts(row.r);
        switch (sort.key) {
          case "name": return row.p.name.toLowerCase();
          case "planned": return row.r.planned;
          case "green": return c.green;
          case "yellow": return c.yellow;
          case "red": return c.red;
        }
      };
      return visibleGroups.map((g) => ({ ...g, rows: [...g.rows].sort((a, b) => cmpBy(rowVal(a), rowVal(b))) }));
    }
    return [...visibleGroups].sort((a, b) => cmpBy(groupVal(a), groupVal(b)));
  }, [visibleGroups, sort, scoped]);

  if (!departments.length) return <EmptyState title="No departments yet" message="Add departments in Setup to see department-wise performance." />;

  return (
    <div className="space-y-4">
      {/* search across departments and their members */}
      <div className="relative max-w-[340px]">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-grey-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
        </span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={scoped ? "Search member…" : "Search department or member…"}
          className="w-full rounded-xl border border-line bg-white pl-9 pr-9 py-2.5 text-[13px] text-ink outline-none focus:border-orange transition"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 grid place-items-center w-5 h-5 rounded-full text-grey-2 hover:text-navy hover:bg-line transition"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        )}
      </div>

      {/* all departments in one table */}
      <Card className="p-0 overflow-hidden">
        <ScrollableTable>
          <table className="w-full text-[12.5px] border-collapse">
            <thead>
              <tr className="text-grey-2 text-[11px] uppercase tracking-wide bg-page/50">
                <SortTh label="Department / Member" sortKey="name" sort={sort} onSort={onSort} align="left" className="px-4 min-w-[220px]" />
                <th className="text-left font-semibold px-3 py-2.5 w-[200px]">Performance</th>
                <SortTh label="Planned" sortKey="planned" sort={sort} onSort={onSort} />
                <SortTh label="Green" sortKey="green" sort={sort} onSort={onSort} className="text-[#1f8a4d]" />
                <SortTh label="Yellow" sortKey="yellow" sort={sort} onSort={onSort} className="text-[#B7820E]" />
                <SortTh label="Red" sortKey="red" sort={sort} onSort={onSort} className="text-[#c0392b]" />
              </tr>
            </thead>
            <tbody>
              {visibleGroups.length === 0 && (
                <tr className="border-t border-line">
                  <td colSpan={6} className="px-4 py-8 text-center text-[12.5px] text-grey-2">
                    No departments or members match “{query}”.
                  </td>
                </tr>
              )}
              {sortedGroups.map((g) => {
                // Scoped (HOD) views are a single department, so keep it expanded; the
                // admin view auto-expands only while searching so matches stay visible.
                const open = scoped || q ? true : !!openIds[g.id];
                const c = rygCounts(g.agg);
                return (
                  <Fragment key={g.id}>
                    {/* department row — shaded + bold to stand apart from members */}
                    <tr
                      onClick={() => toggle(g.id)}
                      aria-expanded={open}
                      className="cursor-pointer border-t border-line bg-page/40 hover:bg-page transition"
                    >
                      <td className="px-4 py-3 align-middle">
                        <div className="flex items-center gap-2">
                          <span className={cn("shrink-0 text-grey-2 transition-transform", open && "rotate-90")}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
                          </span>
                          <span className="text-[14px] font-bold text-navy">{g.name}</span>
                          {scoped && <span className="shrink-0 rounded-pill bg-orange-soft px-2 py-0.5 text-[9.5px] font-semibold text-orange">Your department</span>}
                          <span className="text-[11px] text-grey-2 font-normal">{g.members.length} {g.members.length === 1 ? "member" : "members"}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 align-middle">
                        {g.agg.planned ? <PerfCell ryg={g.actual} red={g.red} /> : <span className="text-[11.5px] text-grey-2">No tasks logged</span>}
                      </td>
                      <td className="px-3 py-3 text-center align-middle tabular-nums font-bold text-[15px] text-navy">{g.agg.planned}</td>
                      <RygNumCell count={c.green} pct={g.actual.green} tone="text-[#1f8a4d]" has={!!g.agg.planned} strong to={g.agg.planned ? deptLink(g.id, "green") : undefined} />
                      <RygNumCell count={c.yellow} pct={g.actual.yellow} tone="text-[#B7820E]" has={!!g.agg.planned} strong to={g.agg.planned ? deptLink(g.id, "yellow") : undefined} />
                      <RygNumCell count={c.red} pct={g.actual.red} tone="text-[#c0392b]" has={!!g.agg.planned} strong to={g.agg.planned ? deptLink(g.id, "red") : undefined} />
                    </tr>

                    {/* member rows — indented, lighter, clearly subordinate */}
                    {open && g.rows.map(({ p, r, actual, red }) => {
                      const isLead = p.role === "hod" || p.role === "sub_hod";
                      const rc = rygCounts(r);
                      return (
                        <tr
                          key={p.id}
                          onClick={() => openScorecard(p.id)}
                          title={`Open ${p.name}'s Weekly Scorecard`}
                          className="cursor-pointer border-t border-line/60 bg-white hover:bg-page/60 transition"
                        >
                          <td className="px-4 py-2.5 pl-10 align-middle">
                            <div className="flex items-center gap-2.5">
                              <Avatar name={p.name} color={p.avatarColor} size={26} />
                              <div className="min-w-0">
                                <span className="flex items-center gap-1.5">
                                  <span className="text-[12.5px] font-medium text-navy truncate">{p.name}</span>
                                  <span className={cn("shrink-0 rounded-pill px-1.5 py-0.5 text-[9.5px] font-semibold", isLead ? "bg-orange-soft text-orange" : "bg-line text-grey")}>{ROLE_LABEL[p.role]}</span>
                                  {scope?.selfId === p.id && <span className="shrink-0 rounded-pill bg-navy/10 px-1.5 py-0.5 text-[9.5px] font-semibold text-navy">you</span>}
                                  <ReportsToTag person={p} viewerId={scope?.selfId} />
                                </span>
                                {p.designation && <span className="block text-[10.5px] text-grey-2 truncate">{p.designation}</span>}
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 align-middle">
                            {r.planned ? <PerfCell ryg={actual} red={red} /> : <span className="text-[11px] text-grey-2">No tasks this week</span>}
                          </td>
                          <td className="px-3 py-2.5 text-center align-middle tabular-nums font-semibold text-navy">{r.planned}</td>
                          <RygNumCell count={rc.green} pct={actual.green} tone="text-[#1f8a4d]" has={!!r.planned} to={r.planned ? memberLink(p.id, "green") : undefined} />
                          <RygNumCell count={rc.yellow} pct={actual.yellow} tone="text-[#B7820E]" has={!!r.planned} to={r.planned ? memberLink(p.id, "yellow") : undefined} />
                          <RygNumCell count={rc.red} pct={actual.red} tone="text-[#c0392b]" has={!!r.planned} to={r.planned ? memberLink(p.id, "red") : undefined} />
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </ScrollableTable>
      </Card>

      <PlanVsActualTable groups={visibleGroups} scoped={scoped} selfId={scope?.selfId} weekStart={weekStart} />
    </div>
  );
}

/** Clickable column header that drives the table sort and shows the active direction. */
function SortTh({ label, sortKey, sort, onSort, align = "center", className }: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; dir: SortDir };
  onSort: (k: SortKey) => void;
  align?: "left" | "center";
  className?: string;
}) {
  const active = sort.key === sortKey;
  return (
    <th className={cn("font-semibold px-3 py-2.5 select-none", align === "left" ? "text-left" : "text-center", className)}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn("inline-flex items-center gap-1 uppercase tracking-wide hover:text-navy transition", align === "center" && "justify-center", active && "text-navy")}
      >
        <span>{label}</span>
        <svg
          width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
          className={cn("transition-transform", active ? "opacity-100" : "opacity-30", active && sort.dir === "asc" && "rotate-180")}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
    </th>
  );
}

/** Coloured "Green vs plan" delta, or an em-dash when one side is missing. */
function GreenDelta({ planned, actual }: { planned: RygPct; actual: RygPct }) {
  if (!planned.total || !actual.total) return <span className="text-grey-2">—</span>;
  const delta = actual.green - planned.green;
  return (
    <span className={cn("font-semibold", delta >= 0 ? "text-[#1f8a4d]" : "text-[#c0392b]")}>
      {delta >= 0 ? "+" : ""}{delta}%
    </span>
  );
}

/** Numbers table comparing planned target vs actual result — per department, each expandable
 *  to its members. */
function PlanVsActualTable({ groups, scoped, selfId, weekStart }: { groups: Group[]; scoped?: boolean; selfId?: string; weekStart: string }) {
  const navigate = useNavigate();
  const openScorecard = (id: string) => navigate(`/task-management/scorecard?user=${id}&week=${weekStart}`);
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({});
  const toggle = (id: string) => setOpenIds((p) => ({ ...p, [id]: !p[id] }));
  const rows = groups.filter((g) => g.planned.total || g.actual.total);
  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-5 py-3.5 border-b border-line">
        <h3 className="text-[14px] font-semibold text-navy">Plan vs Actual — department &amp; members</h3>
        <p className="text-[11.5px] text-grey-2 mt-0.5">Planned RYG target against the actual result for this week (Green / Yellow / Red %). Expand a department to see each member.</p>
      </div>
      {rows.length === 0 ? (
        <p className="px-5 py-6 text-center text-[12.5px] text-grey-2">No plans set or tasks logged for this week yet.</p>
      ) : (
        <ScrollableTable>
          <table className="w-full text-[12.5px] border-collapse">
            <thead>
              <tr className="text-grey-2 text-[11px] uppercase tracking-wide">
                <th className="text-left font-semibold px-5 py-2.5">Department / Member</th>
                <th className="text-center font-semibold px-3 py-2.5">Plan&nbsp;(G/Y/R)</th>
                <th className="text-center font-semibold px-3 py-2.5">Actual&nbsp;(G/Y/R)</th>
                <th className="text-right font-semibold px-5 py-2.5">Green&nbsp;vs&nbsp;plan</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => {
                const open = scoped || !!openIds[g.id];
                const memberRows = g.rows.filter(({ planned, actual }) => planned.total || actual.total);
                return (
                  <Fragment key={g.id}>
                    <tr
                      onClick={() => toggle(g.id)}
                      aria-expanded={open}
                      className="cursor-pointer border-t border-line bg-page/40 hover:bg-page transition"
                    >
                      <td className="px-5 py-2.5 align-middle">
                        <div className="flex items-center gap-2">
                          <span className={cn("shrink-0 text-grey-2 transition-transform", open && "rotate-90")}>
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
                          </span>
                          <span className="font-bold text-navy whitespace-nowrap">{g.name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-center"><RygTriple ryg={g.planned} /></td>
                      <td className="px-3 py-2.5 text-center"><RygTriple ryg={g.actual} /></td>
                      <td className="px-5 py-2.5 text-right whitespace-nowrap"><GreenDelta planned={g.planned} actual={g.actual} /></td>
                    </tr>

                    {open && (memberRows.length === 0 ? (
                      <tr className="border-t border-line/60 bg-white">
                        <td colSpan={4} className="px-5 py-2.5 pl-12 text-[11.5px] text-grey-2">No plans or tasks for members this week.</td>
                      </tr>
                    ) : memberRows.map(({ p, planned, actual }) => {
                      const isLead = p.role === "hod" || p.role === "sub_hod";
                      return (
                        <tr
                          key={p.id}
                          onClick={() => openScorecard(p.id)}
                          title={`Open ${p.name}'s Weekly Scorecard`}
                          className="cursor-pointer border-t border-line/60 bg-white hover:bg-page/60 transition"
                        >
                          <td className="px-5 py-2 pl-12 align-middle">
                            <div className="flex items-center gap-2.5">
                              <Avatar name={p.name} color={p.avatarColor} size={24} />
                              <span className="flex items-center gap-1.5 min-w-0">
                                <span className="text-[12px] font-medium text-navy truncate">{p.name}</span>
                                <span className={cn("shrink-0 rounded-pill px-1.5 py-0.5 text-[9.5px] font-semibold", isLead ? "bg-orange-soft text-orange" : "bg-line text-grey")}>{ROLE_LABEL[p.role]}</span>
                                {selfId === p.id && <span className="shrink-0 rounded-pill bg-navy/10 px-1.5 py-0.5 text-[9.5px] font-semibold text-navy">you</span>}
                                <ReportsToTag person={p} viewerId={selfId} />
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-center"><RygTriple ryg={planned} /></td>
                          <td className="px-3 py-2 text-center"><RygTriple ryg={actual} /></td>
                          <td className="px-5 py-2 text-right whitespace-nowrap"><GreenDelta planned={planned} actual={actual} /></td>
                        </tr>
                      );
                    }))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </ScrollableTable>
      )}
    </Card>
  );
}

/** "G / Y / R" percentages, colour-coded; em-dash when there's nothing to show. */
function RygTriple({ ryg }: { ryg: RygPct }) {
  if (!ryg.total) return <span className="text-grey-2">—</span>;
  return (
    <span className="tabular-nums">
      <b className="text-[#1f8a4d] font-semibold">{ryg.green}</b>
      <span className="text-grey-2"> / </span>
      <b className="text-[#B7820E] font-semibold">{ryg.yellow}</b>
      <span className="text-grey-2"> / </span>
      <b className="text-[#c0392b] font-semibold">{ryg.red}</b>
    </span>
  );
}
