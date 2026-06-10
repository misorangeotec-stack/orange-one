import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import { TextInput, Select } from "@/shared/components/ui/Form";
import Pagination from "@/shared/components/ui/Pagination";
import EmptyState from "@/shared/components/ui/EmptyState";
import { usePagination } from "@/shared/lib/usePagination";
import { formatDate } from "@/shared/lib/time";
import { useDirectory } from "@/core/platform/store";
import { useFmsStore, activeStage, entryStatus, doneCount, isEntryOverdue, daysOverdue } from "../mock/store";
import { STAGE_COUNT, stageByKey } from "../config/stages";
import { ownerLabel } from "../lib/owner";
import EntryProgressBar from "../components/EntryProgressBar";
import StageStatusChip from "../components/StageStatusChip";
import OverdueBadge from "../components/OverdueBadge";

/** All purchase entries — searchable, filterable, paginated 25/page. */
export default function EntriesList() {
  const navigate = useNavigate();
  const { profileById } = useDirectory();
  const { entries, categories, ownerForStep } = useFmsStore();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (q && !(`${e.code} ${e.itemName}`.toLowerCase().includes(q))) return false;
      if (category && e.category !== category) return false;
      if (status && entryStatus(e) !== status) return false;
      return true;
    });
  }, [entries, search, category, status]);

  const pg = usePagination(filtered, { resetKey: `${search}|${category}|${status}` });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[22px] font-bold text-navy">All Entries</h2>
          <p className="text-grey text-[13px] mt-1">Every purchase entry and where it stands in the pipeline.</p>
        </div>
        <Button onClick={() => navigate("/purchase-fms/entries/new")}>+ New Order</Button>
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2.5 p-4 border-b border-line">
          <div className="relative flex-1 min-w-[180px]">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-grey-2" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <TextInput value={search} placeholder="Search code or item…" className="pl-9" onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-auto min-w-[150px]">
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto min-w-[140px]">
            <option value="">All statuses</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
          </Select>
        </div>

        {pg.total === 0 ? (
          <EmptyState
            title="No entries found"
            message="Try clearing the filters, or raise a new order."
            actionLabel="+ New Order"
            actionTo="/purchase-fms/entries/new"
          />
        ) : (
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
                  const st = entryStatus(e);
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
                      <td className="px-4 py-3">
                        {st === "completed" ? <StageStatusChip status="done" /> : <span className="text-navy">{def?.title ?? "—"}</span>}
                      </td>
                      <td className="px-4 py-3"><EntryProgressBar done={doneCount(e)} total={STAGE_COUNT} /></td>
                      <td className="px-4 py-3 text-grey">{st === "completed" ? "—" : owner}</td>
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
        )}

        <Pagination state={pg} rowsLabel="entries" />
      </Card>
    </div>
  );
}
