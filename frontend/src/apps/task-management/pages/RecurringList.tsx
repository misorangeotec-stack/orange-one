import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Avatar from "@/shared/components/ui/Avatar";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import EmptyState from "@/shared/components/ui/EmptyState";
import Pagination from "@/shared/components/ui/Pagination";
import Combobox from "@/shared/components/ui/Combobox";
import { TextInput } from "@/shared/components/ui/Form";
import ActiveFilters, { type ActiveFilter } from "@/shared/components/ui/ActiveFilters";
import { usePagination } from "@/shared/lib/usePagination";
import { cn } from "@/shared/lib/cn";
import { useSession } from "../mock/session";
import { useTaskStore } from "../mock/store";
import { MONTH_LAST_DAY, type RecurringTask } from "../types";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function frequencyText(r: RecurringTask) {
  if (r.recurrenceType === "daily") return "Every working day";
  if (r.recurrenceType === "monthly") {
    if (!r.monthlyDays.length) return "Monthly";
    const parts = r.monthlyDays.map((d) => (d === MONTH_LAST_DAY ? "last day" : ordinal(d)));
    return "Every month on the " + parts.join(", ");
  }
  if (!r.weeklyDays.length) return "Weekly";
  return "Every " + r.weeklyDays.map((d) => DOW[d]).join(", ");
}

/** Manage recurring task templates (daily / weekly / monthly). HOD + admin. */
export default function RecurringList() {
  const { user, role } = useSession();
  const { recurringTasks, toggleRecurring, generateRecurringNow, deleteRecurring, directReportIds, profileById, canRecurring } = useTaskStore();
  const navigate = useNavigate();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [genId, setGenId] = useState<string | null>(null);

  // filters + sort
  const [q, setQ] = useState("");
  const [type, setType] = useState<"all" | "daily" | "weekly">("all");
  const [activeFilter, setActiveFilter] = useState<"all" | "active" | "paused">("all");
  const [person, setPerson] = useState("all");
  const [sort, setSort] = useState<"title-asc" | "title-desc" | "status">("title-asc");

  const visible = useMemo(() => {
    if (role === "admin") return recurringTasks;
    const team = new Set([user.id, ...directReportIds(user.id)]);
    return recurringTasks.filter((r) => r.createdBy === user.id || (r.assignedTo && team.has(r.assignedTo)));
  }, [recurringTasks, role, user.id]);

  // Assignee options scoped to the people actually used by visible templates.
  const assigneeOptions = useMemo(() => {
    const seen = new Map<string, { value: string; label: string; avatarColor?: string }>();
    for (const r of visible) {
      if (!r.assignedTo || seen.has(r.assignedTo)) continue;
      const p = profileById(r.assignedTo);
      if (p) seen.set(p.id, { value: p.id, label: p.name, avatarColor: p.avatarColor });
    }
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [visible, profileById]);

  const filtered = useMemo(() => {
    const out = visible.filter((r) => {
      if (type !== "all" && r.recurrenceType !== type) return false;
      if (activeFilter === "active" && !r.active) return false;
      if (activeFilter === "paused" && r.active) return false;
      if (person !== "all" && r.assignedTo !== person) return false;
      if (q.trim()) {
        const hay = `${r.title} ${r.description ?? ""}`.toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    });
    out.sort((a, b) => {
      if (sort === "title-desc") return b.title.localeCompare(a.title);
      if (sort === "status") return Number(b.active) - Number(a.active) || a.title.localeCompare(b.title);
      return a.title.localeCompare(b.title);
    });
    return out;
  }, [visible, type, activeFilter, person, q, sort]);

  const target = recurringTasks.find((r) => r.id === confirmId);
  const pg = usePagination(filtered, { resetKey: `${q}|${type}|${activeFilter}|${person}|${sort}` });

  // active-filter chips
  const chips: ActiveFilter[] = [];
  if (q.trim()) chips.push({ key: "q", label: `Search: “${q.trim()}”`, onClear: () => setQ("") });
  if (type !== "all") chips.push({ key: "type", label: `Type: ${type === "daily" ? "Daily" : "Weekly"}`, onClear: () => setType("all") });
  if (activeFilter !== "all") chips.push({ key: "status", label: activeFilter === "active" ? "Active" : "Paused", onClear: () => setActiveFilter("all") });
  if (person !== "all") chips.push({ key: "person", label: `Person: ${profileById(person)?.name ?? person}`, onClear: () => setPerson("all") });
  const clearAll = () => {
    setQ("");
    setType("all");
    setActiveFilter("all");
    setPerson("all");
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[22px] font-bold text-navy">Recurring Tasks</h2>
          <p className="text-grey text-[13px] mt-1">Automate repetitive work with daily and weekly templates.</p>
        </div>
        {canRecurring && (
          <Link
            to="/task-management/recurring/new"
            className="inline-flex items-center gap-2 bg-orange-grad text-white font-semibold text-sm px-4 py-2.5 rounded-xl shadow-cta hover:-translate-y-0.5 transition"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            New Recurring Task
          </Link>
        )}
      </div>

      <Card className="overflow-hidden">
        {visible.length === 0 ? (
          <EmptyState
            title="No recurring tasks yet"
            message="Set up a daily or weekly template and it will generate tasks automatically."
            actionLabel={canRecurring ? "New Recurring Task" : undefined}
            actionTo={canRecurring ? "/task-management/recurring/new" : undefined}
          />
        ) : (
          <>
            {/* filter + sort bar */}
            <div className="p-3 flex flex-wrap items-center gap-2.5 border-b border-line">
              <div className="relative flex-1 min-w-[180px]">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-grey-2" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search recurring tasks…" className="pl-9 py-2 text-[13px]" />
              </div>
              <Combobox
                value={type}
                onChange={(v) => setType(v as "all" | "daily" | "weekly")}
                className="w-full sm:w-auto sm:min-w-[140px]"
                options={[
                  { value: "all", label: "All types" },
                  { value: "daily", label: "Daily" },
                  { value: "weekly", label: "Weekly" },
                ]}
              />
              <Combobox
                value={activeFilter}
                onChange={(v) => setActiveFilter(v as "all" | "active" | "paused")}
                className="w-full sm:w-auto sm:min-w-[140px]"
                options={[
                  { value: "all", label: "All statuses" },
                  { value: "active", label: "Active" },
                  { value: "paused", label: "Paused" },
                ]}
              />
              {assigneeOptions.length > 0 && (
                <Combobox
                  value={person}
                  onChange={setPerson}
                  className="w-full sm:w-auto sm:min-w-[160px]"
                  options={[
                    { value: "all", label: "All people" },
                    ...assigneeOptions.map((p) => ({
                      value: p.value,
                      label: p.label,
                      icon: <Avatar name={p.label} color={p.avatarColor} size={22} />,
                    })),
                  ]}
                />
              )}
              <Combobox
                value={sort}
                onChange={(v) => setSort(v as "title-asc" | "title-desc" | "status")}
                className="w-full sm:w-auto sm:min-w-[150px]"
                align="right"
                options={[
                  { value: "title-asc", label: "Title A–Z" },
                  { value: "title-desc", label: "Title Z–A" },
                  { value: "status", label: "Active first" },
                ]}
              />
            </div>

            {chips.length > 0 && (
              <ActiveFilters filters={chips} onClearAll={clearAll} className="px-3 py-2.5 border-b border-line bg-page/60" />
            )}

            {filtered.length === 0 ? (
              <EmptyState title="Nothing matches" message="No recurring tasks match these filters." />
            ) : (
              <>
          <ul className="divide-y divide-line">
            {pg.pageItems.map((r) => {
              const assignee = profileById(r.assignedTo);
              return (
                <li key={r.id} className="flex items-center gap-4 px-4 py-4">
                  <span className={cn("w-9 h-9 rounded-card flex items-center justify-center shrink-0", r.active ? "bg-orange-soft text-orange" : "bg-page text-grey-2")}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 2l4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-medium text-navy truncate">{r.title}</span>
                      <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide rounded-pill px-1.5 py-0.5 bg-[#EAF1FE] text-blue">
                        {r.recurrenceType}
                      </span>
                    </div>
                    {r.description?.trim() && (
                      <div className="text-[12px] text-grey mt-0.5 truncate">{r.description}</div>
                    )}
                    <div className="text-[11.5px] text-grey-2 mt-0.5 truncate">{frequencyText(r)}</div>
                  </div>

                  {assignee && (
                    <span className="hidden sm:inline-flex items-center gap-2 shrink-0">
                      <Avatar name={assignee.name} color={assignee.avatarColor} size={26} />
                      <span className="text-[12.5px] text-navy">{assignee.name}</span>
                    </span>
                  )}

                  <button
                    onClick={async () => {
                      setBusyId(r.id);
                      try {
                        await toggleRecurring(r.id);
                      } finally {
                        setBusyId(null);
                      }
                    }}
                    disabled={!canRecurring || busyId === r.id}
                    title={!canRecurring ? "Read-only preview" : r.active ? "Active — click to pause" : "Paused — click to resume"}
                    className={cn("relative w-10 h-[22px] rounded-full transition shrink-0 disabled:opacity-50", r.active ? "bg-[#27AE60]" : "bg-line")}
                  >
                    <span className={cn("absolute top-0.5 w-[18px] h-[18px] rounded-full bg-white shadow transition-all", r.active ? "left-[20px]" : "left-0.5")} />
                  </button>

                  {r.active && (
                    <button
                      onClick={async () => {
                        setGenId(r.id);
                        try {
                          const taskId = await generateRecurringNow(r.id);
                          if (taskId) navigate(`/task-management/tasks/${taskId}`);
                        } finally {
                          setGenId(null);
                        }
                      }}
                      disabled={!canRecurring || genId === r.id}
                      title={canRecurring ? "Generate today's task now" : "Read-only preview"}
                      className="text-grey-2 hover:text-[#27AE60] transition p-1 shrink-0 disabled:opacity-40 disabled:hover:text-grey-2"
                    >
                      {genId === r.id ? (
                        <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
                      )}
                    </button>
                  )}

                  <button onClick={() => navigate(`/task-management/recurring/${r.id}/edit`)} disabled={!canRecurring} className="text-grey-2 hover:text-orange transition p-1 shrink-0 disabled:opacity-40 disabled:hover:text-grey-2" title={canRecurring ? "Edit" : "Read-only preview"}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
                  </button>
                  <button onClick={() => setConfirmId(r.id)} disabled={!canRecurring} className="text-grey-2 hover:text-[#d4493f] transition p-1 shrink-0 disabled:opacity-40 disabled:hover:text-grey-2" title={canRecurring ? "Delete" : "Read-only preview"}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
                  </button>
                </li>
              );
            })}
          </ul>
                <Pagination state={pg} rowsLabel="recurring tasks" />
              </>
            )}
          </>
        )}
      </Card>

      <Modal
        open={!!confirmId}
        onClose={() => setConfirmId(null)}
        title="Delete recurring task?"
        subtitle={target?.title}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmId(null)}>Cancel</Button>
            <Button
              className="!bg-[#d4493f] !shadow-none hover:!bg-[#bf3d34]"
              disabled={busyId === confirmId}
              onClick={async () => {
                if (!confirmId) return;
                setBusyId(confirmId);
                try {
                  await deleteRecurring(confirmId);
                  setConfirmId(null);
                } finally {
                  setBusyId(null);
                }
              }}
            >
              {busyId === confirmId ? "Deleting…" : "Delete"}
            </Button>
          </>
        }
      >
        <p className="text-[14px] text-grey leading-relaxed">
          This stops future tasks from being generated. Tasks already created from it are not affected.
        </p>
      </Modal>
    </div>
  );
}
