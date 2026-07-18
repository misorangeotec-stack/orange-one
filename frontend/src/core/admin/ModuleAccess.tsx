import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import Card from "@/shared/components/ui/Card";
import Avatar from "@/shared/components/ui/Avatar";
import Pagination from "@/shared/components/ui/Pagination";
import { usePagination } from "@/shared/lib/usePagination";
import { cn } from "@/shared/lib/cn";
import { useDirectory } from "@/core/platform/store";
import { grantableModules } from "@/apps/registry";
import { groupByCategory } from "@/apps/categories";
import { useState } from "react";

/** Category filter pill above the matrix. */
function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "text-[12px] font-medium rounded-pill px-3 py-1.5 border transition",
        active ? "bg-orange text-white border-orange" : "bg-white text-grey border-line hover:border-orange/40"
      )}
    >
      {label}
    </button>
  );
}

/**
 * Per-user module access matrix. Each cell grants/revokes one app for one user
 * (→ app_access insert/delete in Stage B). Admins implicitly have every app, so
 * their cells are shown as always-on and locked.
 */
export default function ModuleAccess() {
  const { profiles, departmentById, setUserModules, canManageModules } = useDirectory();

  const toggle = (userId: string, current: string[], appId: string) =>
    setUserModules(userId, current.includes(appId) ? current.filter((a) => a !== appId) : [...current, appId]);

  const pg = usePagination(profiles);

  // This table has ONE COLUMN PER MODULE, so it is the screen that degrades
  // fastest as the portal grows — at fifty modules it is a fifty-column sideways
  // scroll. Grouping the columns and letting an admin narrow to one category at a
  // time is what keeps it usable. Categories are the same ones the home menu uses
  // (apps/categories.ts), so the two screens always read alike.
  const groups = groupByCategory(grantableModules);
  const [activeGroup, setActiveGroup] = useState<string>("all");
  const shownGroups = activeGroup === "all" ? groups : groups.filter((g) => g.key === activeGroup);
  const shownModules = shownGroups.flatMap((g) => g.rows);

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-grey">Choose which apps each person can open. Admins always have access to every app.</p>

      <div className="flex flex-wrap items-center gap-1.5">
        <FilterChip label="All" active={activeGroup === "all"} onClick={() => setActiveGroup("all")} />
        {groups.map((g) => (
          <FilterChip
            key={g.key}
            label={`${g.label} (${g.rows.length})`}
            active={activeGroup === g.key}
            onClick={() => setActiveGroup(g.key)}
          />
        ))}
      </div>

      <Card>
      <ScrollableTable>
        <table className="w-full border-collapse">
          <thead>
            {/* Category band above the module names — without it, a wide scroll
                loses all sense of which family a column belongs to. */}
            <tr className="border-b border-line/60">
              <th className="sticky left-0 bg-white" />
              {shownGroups.map((g) => (
                <th
                  key={g.key}
                  colSpan={g.rows.length}
                  className="text-center text-[10.5px] font-semibold uppercase tracking-wider text-grey-2 px-4 pt-3 pb-1 border-l border-line/60"
                >
                  {g.label}
                </th>
              ))}
            </tr>
            <tr className="border-b border-line">
              <th className="text-left text-[12px] font-semibold text-grey-2 uppercase tracking-wide px-4 py-3 sticky left-0 bg-white">User</th>
              {shownModules.map((a) => (
                <th key={a.id} className="text-center text-[12px] font-semibold text-navy px-4 py-3 whitespace-nowrap">
                  {a.name}
                  {a.status !== "live" && <span className="block text-[10px] font-normal text-grey-2">coming soon</span>}
                  {a.universal && <span className="block text-[10px] font-normal text-grey-2">everyone</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pg.pageItems.map((u) => {
              const isAdmin = u.role === "admin";
              return (
                <tr key={u.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 sticky left-0 bg-white">
                    <div className="flex items-center gap-2.5 min-w-[180px]">
                      <Avatar name={u.name} color={u.avatarColor} size={32} />
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium text-navy truncate">{u.name}</div>
                        <div className="text-[11px] text-grey-2 truncate">{departmentById(u.departmentId)?.name ?? "No dept"}</div>
                      </div>
                    </div>
                  </td>
                  {shownModules.map((a) => {
                    // A universal app is granted implicitly (apps/universal.ts), so its cell is
                    // on and locked for everyone — an empty box the user could still open would
                    // be a lie about who has access.
                    const on = isAdmin || a.universal || u.moduleAccess.includes(a.id);
                    const locked = isAdmin || !!a.universal || !canManageModules;
                    return (
                      <td key={a.id} className="text-center px-4 py-3">
                        <button
                          type="button"
                          disabled={locked}
                          onClick={() => toggle(u.id, u.moduleAccess, a.id)}
                          aria-pressed={on}
                          title={
                            isAdmin
                              ? "Admins always have access"
                              : a.universal
                                ? "Everyone has access to this app"
                                : !canManageModules
                                  ? "Read-only preview"
                                  : on
                                    ? "Granted — click to revoke"
                                    : "Not granted — click to grant"
                          }
                          className={cn(
                            "w-5 h-5 rounded-[6px] border inline-flex items-center justify-center transition",
                            on ? "bg-orange border-orange text-white" : "border-grey-2 hover:border-orange",
                            locked ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
                          )}
                        >
                          {on && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollableTable>
      {profiles.length > 0 && <Pagination state={pg} rowsLabel="users" />}
      </Card>
    </div>
  );
}
