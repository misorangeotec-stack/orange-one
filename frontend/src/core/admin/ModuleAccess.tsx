import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import Card from "@/shared/components/ui/Card";
import Avatar from "@/shared/components/ui/Avatar";
import Pagination from "@/shared/components/ui/Pagination";
import { usePagination } from "@/shared/lib/usePagination";
import { cn } from "@/shared/lib/cn";
import { useDirectory } from "@/core/platform/store";
import { grantableModules } from "@/apps/registry";

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

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-grey">Choose which apps each person can open. Admins always have access to every app.</p>

      <Card>
      <ScrollableTable>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-line">
              <th className="text-left text-[12px] font-semibold text-grey-2 uppercase tracking-wide px-4 py-3 sticky left-0 bg-white">User</th>
              {grantableModules.map((a) => (
                <th key={a.id} className="text-center text-[12px] font-semibold text-navy px-4 py-3 whitespace-nowrap">
                  {a.name}
                  {a.status !== "live" && <span className="block text-[10px] font-normal text-grey-2">coming soon</span>}
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
                  {grantableModules.map((a) => {
                    const on = isAdmin || u.moduleAccess.includes(a.id);
                    const locked = isAdmin || !canManageModules;
                    return (
                      <td key={a.id} className="text-center px-4 py-3">
                        <button
                          type="button"
                          disabled={locked}
                          onClick={() => toggle(u.id, u.moduleAccess, a.id)}
                          aria-pressed={on}
                          title={isAdmin ? "Admins always have access" : !canManageModules ? "Read-only preview" : on ? "Granted — click to revoke" : "Not granted — click to grant"}
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
