import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import EmptyState from "@/shared/components/ui/EmptyState";
import Pagination from "@/shared/components/ui/Pagination";
import { usePagination } from "@/shared/lib/usePagination";
import { cn } from "@/shared/lib/cn";
import { formatDate } from "@/shared/lib/time";
import { useSession } from "@/core/platform/session";
import { useDirectory } from "@/core/platform/store";
import { useFmsStore, activeStage, entryStatus, doneCount, isEntryOverdue, daysOverdue } from "../mock/store";
import { STAGE_COUNT, stageByKey } from "../config/stages";
import { isOwner, ownerLabel } from "../lib/owner";
import EntryProgressBar from "../components/EntryProgressBar";
import OverdueBadge from "../components/OverdueBadge";

/**
 * "It's your turn" inbox — entries whose active stage the current user may action.
 * Admins oversee every in-progress entry; everyone else sees only stages assigned
 * to them. Rendered as a list (matching All Entries), with overdue rows highlighted.
 */
export default function MyQueue() {
  const navigate = useNavigate();
  const { user, isAdmin } = useSession();
  const { profileById } = useDirectory();
  const { entries, ownerForStep } = useFmsStore();

  const [view, setView] = useState<"all" | "overdue">("all");

  const mine = useMemo(
    () =>
      entries.filter((e) => {
        if (entryStatus(e) !== "in_progress") return false;
        const active = activeStage(e);
        if (!active) return false;
        return isAdmin || isOwner(ownerForStep(active.key), user.id);
      }),
    [entries, isAdmin, ownerForStep, user.id]
  );

  const overdueCount = useMemo(() => mine.filter(isEntryOverdue).length, [mine]);
  const shown = useMemo(() => (view === "overdue" ? mine.filter(isEntryOverdue) : mine), [mine, view]);

  const pg = usePagination(shown, { resetKey: view });

  const filters: { key: "all" | "overdue"; label: string; count: number }[] = [
    { key: "all", label: "All", count: mine.length },
    { key: "overdue", label: "Overdue", count: overdueCount },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[22px] font-bold text-navy">My Queue</h2>
          <p className="text-grey text-[13px] mt-1">
            {isAdmin ? "Every entry currently awaiting action." : "Entries waiting on you to complete your stage."}
          </p>
        </div>
        <div className="inline-flex items-center rounded-pill bg-page border border-line p-0.5 text-[12px] font-semibold">
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setView(f.key)}
              className={cn(
                "px-3 py-1.5 rounded-pill transition",
                view === f.key
                  ? f.key === "overdue" ? "bg-white text-[#D64545] shadow-sm" : "bg-white text-navy shadow-sm"
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
          view === "overdue" ? (
            <EmptyState
              title="Nothing overdue"
              message="Every entry in your queue is on schedule."
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>}
            />
          ) : (
            <EmptyState
              title="Nothing in your queue"
              message="When an entry reaches a stage you own, it'll show up here."
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>}
            />
          )
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-[11.5px] uppercase tracking-wide text-grey-2 border-b border-line">
                    <th className="px-4 py-2.5 font-semibold">Code</th>
                    <th className="px-4 py-2.5 font-semibold">Item</th>
                    <th className="px-4 py-2.5 font-semibold">Current Stage</th>
                    <th className="px-4 py-2.5 font-semibold w-[160px]">Progress</th>
                    <th className="px-4 py-2.5 font-semibold">Owner</th>
                    <th className="px-4 py-2.5 font-semibold">Planned</th>
                  </tr>
                </thead>
                <tbody>
                  {pg.pageItems.map((e) => {
                    const active = activeStage(e);
                    const def = active ? stageByKey(active.key) : undefined;
                    const owner = active ? ownerLabel(ownerForStep(active.key), profileById) : "—";
                    const overdue = isEntryOverdue(e);
                    return (
                      <tr
                        key={e.id}
                        onClick={() => navigate(`/purchase-fms/entries/${e.id}`)}
                        className={`border-b border-line last:border-0 cursor-pointer transition ${overdue ? "bg-[#FFF5F5] hover:bg-[#FFECEC]" : "hover:bg-page"}`}
                      >
                        <td className="px-4 py-3">
                          <Link to={`/purchase-fms/entries/${e.id}`} className="font-semibold text-navy hover:text-orange" onClick={(ev) => ev.stopPropagation()}>{e.code}</Link>
                          <div className="text-[11px] text-grey-2">{e.category}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-navy font-medium">{e.itemName}</div>
                          <div className="text-[11px] text-grey-2">{e.quantity.toLocaleString("en-IN")} {e.unit}</div>
                        </td>
                        <td className="px-4 py-3"><span className="text-navy">{def?.title ?? "—"}</span></td>
                        <td className="px-4 py-3"><EntryProgressBar done={doneCount(e)} total={STAGE_COUNT} /></td>
                        <td className="px-4 py-3 text-grey">{owner}</td>
                        <td className="px-4 py-3">
                          {active?.plannedDate ? (
                            <div className="flex items-center gap-2">
                              <span className={overdue ? "text-[#D64545] font-medium" : "text-grey"}>{formatDate(active.plannedDate)}</span>
                              {overdue && <OverdueBadge days={daysOverdue(e)} />}
                            </div>
                          ) : <span className="text-grey">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination state={pg} rowsLabel="entries" />
          </>
        )}
      </Card>
    </div>
  );
}
