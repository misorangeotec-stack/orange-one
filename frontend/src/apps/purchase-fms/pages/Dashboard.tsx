import { useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import StatCard from "@/apps/task-management/components/StatCard";
import { formatDate, isOverdue } from "@/shared/lib/time";
import { useSession } from "@/core/platform/session";
import { useDirectory } from "@/core/platform/store";
import { useFmsStore, activeStage, entryStatus, doneCount } from "../mock/store";
import { STAGE_COUNT, stageByKey } from "../config/stages";
import { isOwner, ownerLabel } from "../lib/owner";
import EntryProgressBar from "../components/EntryProgressBar";
import StageStatusChip from "../components/StageStatusChip";

const ic = {
  total: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>,
  progress: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  queue: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h16M4 12h16M4 18h10" /></svg>,
  done: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>,
};

/** Purchase FMS overview — KPI tiles + the most recent entries with live progress. */
export default function Dashboard() {
  const navigate = useNavigate();
  const { user, isAdmin } = useSession();
  const { profileById } = useDirectory();
  const { entries, ownerForStep } = useFmsStore();

  const stats = useMemo(() => {
    let inProgress = 0, completed = 0, mine = 0, overdue = 0;
    for (const e of entries) {
      const active = activeStage(e);
      if (entryStatus(e) === "completed") completed++;
      else {
        inProgress++;
        if (active && (isAdmin || isOwner(ownerForStep(active.key), user.id))) mine++;
        if (active?.plannedDate && isOverdue(active.plannedDate)) overdue++;
      }
    }
    return { total: entries.length, inProgress, completed, mine, overdue };
  }, [entries, isAdmin, ownerForStep, user.id]);

  const recent = useMemo(
    () => [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6),
    [entries]
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[22px] font-bold text-navy">Purchase FMS</h2>
          <p className="text-grey text-[13px] mt-1">Track every purchase order across the 9-stage procurement pipeline.</p>
        </div>
        <Button onClick={() => navigate("/purchase-fms/entries/new")}>+ New Order</Button>
      </div>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Entries" value={stats.total} icon={ic.total} tone="blue" />
        <StatCard label="In Progress" value={stats.inProgress} icon={ic.progress} tone="orange" hint={`${stats.overdue} overdue`} />
        <StatCard label="Awaiting Me" value={stats.mine} icon={ic.queue} tone="violet" />
        <StatCard label="Completed" value={stats.completed} icon={ic.done} tone="green" />
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <h3 className="text-[14px] font-semibold text-navy">Recent Entries</h3>
          <Link to="/purchase-fms/entries" className="text-[12.5px] font-semibold text-orange hover:underline">View all</Link>
        </div>
        <div className="divide-y divide-line">
          {recent.map((e) => {
            const st = entryStatus(e);
            const active = activeStage(e);
            const def = active ? stageByKey(active.key) : undefined;
            const owner = active ? ownerLabel(ownerForStep(active.key), profileById) : "—";
            return (
              <button
                key={e.id}
                onClick={() => navigate(`/purchase-fms/entries/${e.id}`)}
                className="w-full text-left px-4 py-3 hover:bg-page transition flex flex-wrap items-center gap-3"
              >
                <div className="min-w-[150px] flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-navy">{e.code}</span>
                    {st === "completed" ? <StageStatusChip status="done" /> : <span className="text-[11.5px] text-grey">{def?.title}</span>}
                  </div>
                  <div className="text-[12px] text-grey-2">{e.itemName} · {e.category}</div>
                </div>
                <div className="w-[160px]"><EntryProgressBar done={doneCount(e)} total={STAGE_COUNT} /></div>
                <div className="text-[11.5px] text-grey-2 min-w-[120px] text-right">
                  {st === "completed" ? "Done" : <>Owner: <span className="text-navy font-medium">{owner}</span></>}
                  {active?.plannedDate && st !== "completed" && <div>Planned {formatDate(active.plannedDate)}</div>}
                </div>
              </button>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
