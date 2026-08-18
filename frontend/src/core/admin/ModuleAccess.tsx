import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import Card from "@/shared/components/ui/Card";
import Avatar from "@/shared/components/ui/Avatar";
import Pagination from "@/shared/components/ui/Pagination";
import { usePagination } from "@/shared/lib/usePagination";
import { cn } from "@/shared/lib/cn";
import { useDirectory } from "@/core/platform/store";
import { grantableModules, NO_VIEW_ONLY_APP_IDS } from "@/apps/registry";
import { groupByCategory } from "@/apps/categories";
import type { ModuleLevel } from "@/core/platform/types";
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

/** The view-only mark. Small enough to sit in the same 20px cell as the tick. */
function EyeGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="2.5" />
    </svg>
  );
}

/**
 * Per-user module access matrix. Each cell grants/revokes one app for one user
 * (→ app_access insert/delete in Stage B). Admins implicitly have every app, so
 * their cells are shown as always-on and locked.
 */
export default function ModuleAccess() {
  const { profiles, departmentById, setUserModules, canManageModules } = useDirectory();

  /**
   * Click cycles the cell: not granted → view only → full access → not granted.
   *
   * A cycling cell rather than the User form's three pills because this table has
   * ONE COLUMN PER MODULE — three pills in every cell would be unreadable long
   * before the portal's fifteenth app. The glyph carries the state instead, and
   * the legend above says what each one means.
   */
  const cycle = (userId: string, current: Record<string, ModuleLevel>, appId: string) => {
    const next = { ...current };
    if (!next[appId]) next[appId] = NO_VIEW_ONLY_APP_IDS.has(appId) ? "edit" : "view";
    else if (next[appId] === "view") next[appId] = "edit";
    else delete next[appId];
    return setUserModules(userId, next);
  };

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
      <p className="text-[13px] text-grey">
        Choose which apps each person can open, and how much of each. Clicking a cell cycles it:
        no access → view only → full access. Admins always have full access to every app.
      </p>

      {/* The glyphs carry the state in a table this wide, so they have to be
          spelled out — an outlined eye and a filled tick are not self-evident. */}
      <div className="flex flex-wrap items-center gap-4 text-[12px] text-grey-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-5 h-5 rounded-[6px] border border-grey-2 inline-flex items-center justify-center" />
          No access
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-5 h-5 rounded-[6px] border border-orange text-orange inline-flex items-center justify-center"><EyeGlyph /></span>
          View only — can open and read it, but change nothing
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-5 h-5 rounded-[6px] border border-orange bg-orange text-white inline-flex items-center justify-center">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
          </span>
          Full access
        </span>
      </div>

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
                    // be a lie about who has access. Admins and universal apps are always FULL:
                    // neither holds an app_access row, so neither can carry a level.
                    const level: ModuleLevel | undefined =
                      isAdmin || a.universal ? "edit" : u.moduleLevels[a.id];
                    const locked = isAdmin || !!a.universal || !canManageModules;
                    return (
                      <td key={a.id} className="text-center px-4 py-3">
                        <button
                          type="button"
                          disabled={locked}
                          onClick={() => cycle(u.id, u.moduleLevels, a.id)}
                          aria-pressed={!!level}
                          title={
                            isAdmin
                              ? "Admins always have full access"
                              : a.universal
                                ? "Everyone has access to this app"
                                : !canManageModules
                                  ? "Read-only preview"
                                  : level === "edit"
                                    ? "Full access — click to revoke"
                                    : level === "view"
                                      ? "View only — click for full access"
                                      : NO_VIEW_ONLY_APP_IDS.has(a.id)
                                        ? "Not granted — click to grant full access (this app has no view-only tier)"
                                        : "Not granted — click for view only"
                          }
                          className={cn(
                            "w-5 h-5 rounded-[6px] border inline-flex items-center justify-center transition",
                            level === "edit"
                              ? "bg-orange border-orange text-white"
                              : level === "view"
                                ? "border-orange text-orange"
                                : "border-grey-2 hover:border-orange",
                            locked ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
                          )}
                        >
                          {level === "edit" && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>}
                          {level === "view" && <EyeGlyph />}
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
