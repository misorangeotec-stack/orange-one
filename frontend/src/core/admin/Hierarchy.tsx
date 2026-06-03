import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Avatar from "@/shared/components/ui/Avatar";
import { useDirectory } from "@/core/platform/store";
import { formatDateTime } from "@/shared/lib/time";
import type { Profile } from "@/core/platform/types";

/** Read-only view of the reporting structure (edit a person to change their HODs). */
export default function Hierarchy() {
  const { profiles, profileById, directReportIds, departmentById } = useDirectory();

  const admins = profiles.filter((p) => p.role === "admin");
  const managers = profiles.filter((p) => p.role === "hod" || p.role === "sub_hod");
  const unmapped = profiles.filter((p) => p.role === "employee" && p.hodIds.length === 0);

  return (
    <div className="space-y-5">
      {/* leadership */}
      <Card className="p-5">
        <h3 className="text-[13px] font-semibold text-navy mb-3">Leadership (Admins)</h3>
        <div className="flex flex-wrap gap-2">
          {admins.map((a) => (
            <Chip key={a.id} p={a} sub={departmentById(a.departmentId)?.name} active={formatDateTime(a.lastActiveAt)} />
          ))}
        </div>
      </Card>

      {/* teams */}
      <div>
        <h3 className="text-[13px] font-semibold text-navy mb-3">Teams</h3>
        <div className="grid md:grid-cols-2 gap-4">
          {managers.map((m) => {
            const reports = directReportIds(m.id).map((id) => profileById(id)!).filter(Boolean) as Profile[];
            const reportsTo = m.hodIds.map((h) => profileById(h)?.name).filter(Boolean);
            return (
              <Card key={m.id} className="p-5">
                <div className="flex items-center gap-3 pb-3 border-b border-line">
                  <Avatar name={m.name} color={m.avatarColor} size={40} />
                  <div className="min-w-0">
                    <div className="text-[14px] font-semibold text-navy truncate">{m.name}</div>
                    <div className="text-[11.5px] text-grey-2 truncate">
                      {m.role === "sub_hod" ? "Sub-HOD" : "HOD"} · {departmentById(m.departmentId)?.name ?? "—"}
                      {reportsTo.length > 0 && ` · reports to ${reportsTo.join(", ")}`}
                    </div>
                    <div className="text-[11px] text-grey-2 truncate">Last active: {formatDateTime(m.lastActiveAt)}</div>
                  </div>
                  <span className="ml-auto text-[11.5px] text-grey-2 shrink-0">{reports.length} report{reports.length !== 1 ? "s" : ""}</span>
                </div>
                {reports.length === 0 ? (
                  <p className="text-[12.5px] text-grey-2 pt-3">No direct reports yet.</p>
                ) : (
                  <ul className="pt-3 space-y-2.5">
                    {reports.map((r) => (
                      <li key={r.id} className="flex items-center gap-2.5">
                        <span className="text-grey-2">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4v8a4 4 0 0 0 4 4h12" /><polyline points="16 12 20 16 16 20" /></svg>
                        </span>
                        <Avatar name={r.name} color={r.avatarColor} size={26} />
                        <span className="text-[13px] text-navy">{r.name}</span>
                        <span className="text-[11.5px] text-grey-2 truncate">· {r.designation}</span>
                        <span className="ml-auto text-[11px] text-grey-2 shrink-0" title="Last active">{formatDateTime(r.lastActiveAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      </div>

      {/* unmapped */}
      {unmapped.length > 0 && (
        <Card className="p-5 border-[#F8B62B]/50 bg-[#FEF9EE]">
          <h3 className="text-[13px] font-semibold text-[#B7820E] mb-1">Unmapped employees</h3>
          <p className="text-[12px] text-[#9a6e0c] mb-3">These employees don't report to anyone yet. Edit them to assign a HOD.</p>
          <div className="flex flex-wrap gap-2">
            {unmapped.map((u) => (
              <Link key={u.id} to={`/admin/users/${u.id}/edit`}>
                <Chip p={u} sub={departmentById(u.departmentId)?.name} />
              </Link>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function Chip({ p, sub, active }: { p: Profile; sub?: string; active?: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-pill border border-line bg-white px-3 py-1.5">
      <Avatar name={p.name} color={p.avatarColor} size={22} />
      <span className="text-[12.5px] font-medium text-navy">{p.name}</span>
      {sub && <span className="text-[11px] text-grey-2">· {sub}</span>}
      {active && <span className="text-[11px] text-grey-2" title="Last active">· {active}</span>}
    </span>
  );
}
