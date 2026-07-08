import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import EmptyState from "@/shared/components/ui/EmptyState";
import Pagination from "@/shared/components/ui/Pagination";
import StatCard from "@/apps/task-management/components/StatCard";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { usePagination } from "@/shared/lib/usePagination";
import { cn } from "@/shared/lib/cn";
import { formatDate } from "@/shared/lib/time";
import { useSession } from "@/core/platform/session";
import { useFmsStore, activeStage, entryStatus, isEntryOverdue, daysOverdue } from "../mock/store";
import { stageByKey } from "../config/stages";
import { isOwner } from "../lib/owner";
import type { PurchaseEntry } from "../types";
import OverdueBadge from "../components/OverdueBadge";
import TaskModal from "../components/TaskModal";

const ic = {
  pending: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>,
  due: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
};

/**
 * The individual user's home: a simple inbox of the tasks awaiting THEM, with a
 * one-click pop-up to complete each. No pipeline, no stepper — only the user's own
 * action point. (Admins land on the full Dashboard instead; see FmsApp routing.)
 */
export default function MyTasks() {
  const { user } = useSession();
  const { entries, ownerForStep } = useFmsStore();

  const [view, setView] = useState<"all" | "due">("all");
  const [selected, setSelected] = useState<PurchaseEntry | null>(null);

  const mine = useMemo(
    () =>
      entries.filter((e) => {
        if (entryStatus(e) !== "in_progress") return false;
        const active = activeStage(e);
        if (!active) return false;
        return isOwner(ownerForStep(active.key), user.id);
      }),
    [entries, ownerForStep, user.id]
  );

  const dueCount = useMemo(() => mine.filter(isEntryOverdue).length, [mine]);
  const shown = useMemo(() => (view === "due" ? mine.filter(isEntryOverdue) : mine), [mine, view]);

  const pg = usePagination(shown, { resetKey: view });

  // Keep the open modal pointed at the freshest copy of the entry (after a refetch).
  const selectedLive = selected ? mine.find((e) => e.id === selected.id) ?? null : null;

  const filters: { key: "all" | "due"; label: string; count: number }[] = [
    { key: "all", label: "Pending", count: mine.length },
    { key: "due", label: "Due", count: dueCount },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[22px] font-bold text-navy">My Tasks</h2>
        <p className="text-grey text-[13px] mt-1">Your pending and due tasks. Click one to complete it.</p>
      </div>

      <div className="grid gap-4 grid-cols-2 lg:max-w-md">
        <StatCard label="Pending" value={mine.length} icon={ic.pending} tone="orange" />
        <StatCard label="Due / Overdue" value={dueCount} icon={ic.due} tone="rose" />
      </div>

      <div className="flex items-center justify-end">
        <div className="inline-flex items-center rounded-pill bg-page border border-line p-0.5 text-[12px] font-semibold">
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setView(f.key)}
              className={cn(
                "px-3 py-1.5 rounded-pill transition",
                view === f.key
                  ? f.key === "due" ? "bg-white text-[#D64545] shadow-sm" : "bg-white text-navy shadow-sm"
                  : "text-grey-2 hover:text-navy"
              )}
            >
              {f.label} <span className="opacity-70">({f.count})</span>
            </button>
          ))}
        </div>
      </div>

      <Card className="overflow-hidden">
        {shown.length === 0 ? (
          <EmptyState
            title={view === "due" ? "Nothing due" : "You're all caught up"}
            message={view === "due" ? "None of your tasks are overdue." : "When a task needs your action, it'll show up here."}
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>}
          />
        ) : (
          <>
            <ScrollableTable>
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-[11.5px] uppercase tracking-wide text-grey-2 border-b border-line">
                    <th className="px-4 py-2.5 font-semibold">Code</th>
                    <th className="px-4 py-2.5 font-semibold">Item</th>
                    <th className="px-4 py-2.5 font-semibold">Your Action</th>
                    <th className="px-4 py-2.5 font-semibold">Due</th>
                    <th className="px-4 py-2.5 font-semibold w-[120px]"></th>
                  </tr>
                </thead>
                <tbody>
                  {pg.pageItems.map((e) => {
                    const active = activeStage(e);
                    const def = active ? stageByKey(active.key) : undefined;
                    const overdue = isEntryOverdue(e);
                    return (
                      <tr
                        key={e.id}
                        onClick={() => setSelected(e)}
                        className={cn(
                          "border-b border-line last:border-0 cursor-pointer transition",
                          overdue ? "bg-[#FFF5F5] hover:bg-[#FFECEC]" : "hover:bg-page"
                        )}
                      >
                        <td className="px-4 py-3">
                          <div className="font-semibold text-navy">{e.code}</div>
                          <div className="text-[11px] text-grey-2">{e.category}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-navy font-medium">{e.itemName}</div>
                          <div className="text-[11px] text-grey-2">{e.quantity.toLocaleString("en-IN")} {e.unit}</div>
                        </td>
                        <td className="px-4 py-3"><span className="text-navy font-medium">{def?.title ?? "—"}</span></td>
                        <td className="px-4 py-3">
                          {active?.plannedDate ? (
                            <div className="flex items-center gap-2">
                              <span className={overdue ? "text-[#D64545] font-medium" : "text-grey"}>{formatDate(active.plannedDate)}</span>
                              {overdue && <OverdueBadge days={daysOverdue(e)} />}
                            </div>
                          ) : <span className="text-grey">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-orange">
                            Complete
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollableTable>
            <Pagination state={pg} rowsLabel="tasks" />
          </>
        )}
      </Card>

      {selectedLive && <TaskModal entry={selectedLive} onClose={() => setSelected(null)} />}
    </div>
  );
}
