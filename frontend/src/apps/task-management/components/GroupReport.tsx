import { useMemo } from "react";
import Card from "@/shared/components/ui/Card";
import Avatar from "@/shared/components/ui/Avatar";
import EmptyState from "@/shared/components/ui/EmptyState";
import { useTaskStore } from "../mock/store";
import { WEEK_START } from "../mock/data";
import { reportFor } from "../mock/selectors";
import type { Profile, WeeklyPlan } from "../types";
import RygBar from "./RygBar";
import DonutChart from "./DonutChart";

const STATUS_COLORS = { completed: "#27AE60", pending: "#3B82F6", revised: "#F8B62B", shifted: "#FF6A1F" };

function avgRyg(plans: { redPct: number; yellowPct: number; greenPct: number }[]) {
  if (!plans.length) return { red: 0, yellow: 0, green: 0 };
  const s = plans.reduce((a, p) => ({ red: a.red + p.redPct, yellow: a.yellow + p.yellowPct, green: a.green + p.greenPct }), { red: 0, yellow: 0, green: 0 });
  return { red: Math.round(s.red / plans.length), yellow: Math.round(s.yellow / plans.length), green: Math.round(s.green / plans.length) };
}

/** Planned-vs-actual report for a set of people for a given week (used by every Reports tab). */
export default function GroupReport({ people, weekStart = WEEK_START }: { people: Profile[]; weekStart?: string }) {
  const { tasks, departmentById, weeklyPlanFor } = useTaskStore();
  const weekTasks = useMemo(() => tasks.filter((t) => t.weekStart === weekStart), [tasks, weekStart]);

  const rows = useMemo(() => people.map((p) => ({ p, r: reportFor(weekTasks, p.id) })), [people, weekTasks]);
  const agg = useMemo(
    () =>
      rows.reduce(
        (a, { r }) => ({
          planned: a.planned + r.planned,
          completed: a.completed + r.completed,
          pending: a.pending + r.pending,
          revised: a.revised + r.revised,
          shifted: a.shifted + r.shifted,
        }),
        { planned: 0, completed: 0, pending: 0, revised: 0, shifted: 0 }
      ),
    [rows]
  );
  const plans = useMemo(() => people.map((p) => weeklyPlanFor(p.id, weekStart)).filter((p): p is WeeklyPlan => !!p), [people, weeklyPlanFor, weekStart]);
  const ryg = avgRyg(plans);
  const completion = agg.planned ? Math.round((agg.completed / agg.planned) * 100) : 0;

  const donut = [
    { label: "Completed", value: agg.completed, color: STATUS_COLORS.completed },
    { label: "Pending", value: agg.pending, color: STATUS_COLORS.pending },
    { label: "Revised", value: agg.revised, color: STATUS_COLORS.revised },
    { label: "Shifted", value: agg.shifted, color: STATUS_COLORS.shifted },
  ].filter((s) => s.value > 0);

  if (people.length === 0) return <EmptyState title="No one to report on" message="Pick a different selection." />;

  return (
    <div className="space-y-4">
      {/* summary tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Tile label="Planned" value={agg.planned} tone="text-navy" />
        <Tile label="Completed" value={agg.completed} tone="text-[#27AE60]" />
        <Tile label="Pending" value={agg.pending} tone="text-blue" />
        <Tile label="Revised" value={agg.revised} tone="text-[#B7820E]" />
        <Tile label="Shifted" value={agg.shifted} tone="text-orange" />
        <Tile label="Completion" value={`${completion}%`} tone="text-navy" />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* per-person table */}
        <Card className="lg:col-span-2 p-5">
          <h3 className="text-[14px] font-semibold text-navy mb-3">Per-person performance</h3>
          <div className="space-y-3.5">
            {rows.map(({ p, r }) => {
              const plan = weeklyPlanFor(p.id, weekStart);
              const rg = plan ? { red: plan.redPct, yellow: plan.yellowPct, green: plan.greenPct } : { red: 0, yellow: 0, green: 0 };
              return (
                <div key={p.id} className="flex items-center gap-3">
                  <Avatar name={p.name} color={p.avatarColor} size={34} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span className="block text-[13px] font-semibold text-navy truncate">{p.name}</span>
                        {(p.designation || p.departmentId) && (
                          <span className="block text-[11px] text-grey-2 truncate">
                            {[p.designation, departmentById(p.departmentId)?.name].filter(Boolean).join(" · ")}
                          </span>
                        )}
                      </div>
                      <span className="text-[11.5px] text-grey-2 whitespace-nowrap">
                        {r.completed}/{r.planned} done · {r.revisionTotal} rev
                      </span>
                    </div>
                    <div className="mt-1.5"><RygBar {...rg} showLegend={false} /></div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* status + RYG */}
        <div className="space-y-4">
          <Card className="p-5">
            <h3 className="text-[14px] font-semibold text-navy mb-3">Status mix</h3>
            {donut.length ? <DonutChart segments={donut} /> : <p className="text-[13px] text-grey-2 py-4 text-center">No tasks.</p>}
          </Card>
          <Card className="p-5">
            <h3 className="text-[14px] font-semibold text-navy mb-3">Avg. weekly RYG</h3>
            <RygBar {...ryg} />
          </Card>
        </div>
      </div>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: number | string; tone: string }) {
  return (
    <Card className="px-4 py-3">
      <div className={`text-[22px] font-bold leading-none ${tone}`}>{value}</div>
      <div className="text-[11.5px] text-grey mt-1.5">{label}</div>
    </Card>
  );
}
