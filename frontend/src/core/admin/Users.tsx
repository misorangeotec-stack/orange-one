import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Avatar from "@/shared/components/ui/Avatar";
import Modal from "@/shared/components/ui/Modal";
import Combobox from "@/shared/components/ui/Combobox";
import { TextInput } from "@/shared/components/ui/Form";
import EmptyState from "@/shared/components/ui/EmptyState";
import { cn } from "@/shared/lib/cn";
import { useDirectory } from "@/core/platform/store";
import type { AppRole, Profile } from "@/core/platform/types";

const ROLE_BADGE: Record<AppRole, string> = {
  admin: "bg-orange-soft text-orange",
  hod: "bg-[#EAF1FE] text-blue",
  sub_hod: "bg-[#F0ECFE] text-[#7C5CFC]",
  employee: "bg-page text-grey",
};
const ROLE_LABEL: Record<AppRole, string> = { admin: "Admin", hod: "HOD", sub_hod: "Sub-HOD", employee: "Employee" };

export default function Users() {
  const { profiles, departments, departmentById, profileById, deleteUser } = useDirectory();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [role, setRole] = useState<AppRole | "all">("all");
  const [dept, setDept] = useState("all");
  const [confirmDel, setConfirmDel] = useState<Profile | null>(null);

  const filtered = useMemo(
    () =>
      profiles.filter((p) => {
        if (role !== "all" && p.role !== role) return false;
        if (dept !== "all" && p.departmentId !== dept) return false;
        if (q.trim() && !p.name.toLowerCase().includes(q.toLowerCase())) return false;
        return true;
      }),
    [profiles, role, dept, q]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-grey">{profiles.length} users</p>
        <Button size="sm" onClick={() => navigate("/admin/users/new")}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          Add User
        </Button>
      </div>

      <Card className="overflow-hidden">
        <div className="p-3 flex flex-wrap items-center gap-2.5 border-b border-line">
          <div className="relative flex-1 min-w-[180px]">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-grey-2" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search users…" className="pl-9 py-2 text-[13px]" />
          </div>
          <Combobox value={role} onChange={(v) => setRole(v as AppRole | "all")} className="w-auto min-w-[150px]" options={[{ value: "all", label: "All roles" }, ...(Object.keys(ROLE_LABEL) as AppRole[]).map((r) => ({ value: r, label: ROLE_LABEL[r] }))]} />
          <Combobox value={dept} onChange={setDept} className="w-auto min-w-[160px]" options={[{ value: "all", label: "All departments" }, ...departments.map((d) => ({ value: d.id, label: d.name }))]} />
        </div>

        {filtered.length === 0 ? (
          <EmptyState title="No users found" message="Try different filters, or add a user." actionLabel="Add User" actionTo="/admin/users/new" />
        ) : (
          <ul className="divide-y divide-line">
            {filtered.map((u) => (
              <li key={u.id} className="flex items-center gap-3 px-4 py-3.5">
                <Avatar name={u.name} color={u.avatarColor} size={38} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-medium text-navy truncate">{u.name}</span>
                    <span className={cn("text-[10px] font-semibold uppercase tracking-wide rounded-pill px-1.5 py-0.5", ROLE_BADGE[u.role])}>{ROLE_LABEL[u.role]}</span>
                  </div>
                  <div className="text-[11.5px] text-grey-2 truncate">
                    {u.designation || "—"} · {departmentById(u.departmentId)?.name ?? "No dept"}
                    {u.hodIds.length > 0 && ` · reports to ${u.hodIds.map((h) => profileById(h)?.name).filter(Boolean).join(", ")}`}
                  </div>
                </div>
                <Link to={`/admin/users/${u.id}/edit`} className="text-grey-2 hover:text-orange transition p-1 shrink-0" title="Edit">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
                </Link>
                <button onClick={() => setConfirmDel(u)} className="text-grey-2 hover:text-[#d4493f] transition p-1 shrink-0" title="Delete">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={!!confirmDel}
        onClose={() => setConfirmDel(null)}
        title="Remove user?"
        subtitle={confirmDel?.name}
        size="sm"
        footer={<>
          <Button variant="ghost" onClick={() => setConfirmDel(null)}>Cancel</Button>
          <Button className="!bg-[#d4493f] !shadow-none hover:!bg-[#bf3d34]" onClick={() => { if (confirmDel) deleteUser(confirmDel.id); setConfirmDel(null); }}>Remove</Button>
        </>}
      >
        <p className="text-[14px] text-grey leading-relaxed">They'll be removed from the workspace and any reporting links. Existing tasks remain for history.</p>
      </Modal>
    </div>
  );
}
