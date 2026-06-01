import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Avatar from "@/shared/components/ui/Avatar";
import Combobox from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import { cn } from "@/shared/lib/cn";
import { useDirectory } from "@/core/platform/store";
import { apps } from "@/apps/registry";
import type { AppRole } from "@/core/platform/types";

const ROLES: { value: AppRole; label: string; hint: string }[] = [
  { value: "employee", label: "Employee", hint: "Own tasks only" },
  { value: "sub_hod", label: "Sub-HOD", hint: "Team visibility, limited" },
  { value: "hod", label: "HOD / Manager", hint: "Team-level access" },
  { value: "admin", label: "Admin", hint: "Full access" },
];

export default function UserForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profiles, departments, profileById, addUser, updateUser, addDepartment, canEditUser, canAddUser } = useDirectory();
  const editing = id ? profileById(id) : undefined;
  const canSave = editing ? canEditUser : canAddUser;
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState(editing?.name ?? "");
  const [email, setEmail] = useState(editing?.email ?? "");
  const [mobile, setMobile] = useState(editing?.phone ?? "");
  const [designation, setDesignation] = useState(editing?.designation ?? "");
  const [role, setRole] = useState<AppRole>(editing?.role ?? "employee");
  const [departmentId, setDepartmentId] = useState(editing?.departmentId ?? "");
  const [hodIds, setHodIds] = useState<string[]>(editing?.hodIds ?? []);
  const [moduleAccess, setModuleAccess] = useState<string[]>(editing?.moduleAccess ?? ["task-management"]);
  const [error, setError] = useState("");

  const candidateHods = profiles.filter((p) => (p.role === "hod" || p.role === "sub_hod") && p.id !== id);
  const toggleHod = (hid: string) => setHodIds((prev) => (prev.includes(hid) ? prev.filter((h) => h !== hid) : [...prev, hid]));
  const toggleModule = (mid: string) => setModuleAccess((prev) => (prev.includes(mid) ? prev.filter((m) => m !== mid) : [...prev, mid]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError("Please enter a name.");
    // Normalise the mobile: strip all whitespace so the value used as the password
    // is predictable (a number entered as "90333 01207" must log in as "9033301207",
    // not with the literal space).
    const mobileNorm = mobile.replace(/\s+/g, "");
    if (!mobileNorm) return setError("Please enter a mobile number — it's the user's initial password.");
    if (mobileNorm.length < 6) return setError("Mobile number must be at least 6 digits (it's used as the password).");
    if (busy) return;
    const base = {
      name: name.trim(),
      email: email.trim() || undefined,
      designation: designation.trim() || undefined,
      role,
      departmentId: departmentId || null,
      hodIds,
      moduleAccess,
    };
    setBusy(true);
    setError("");
    try {
      // Saving always re-pins the password to the mobile number (workspace policy).
      if (editing) await updateUser(editing.id, { ...base, phone: mobileNorm });
      else await addUser({ ...base, mobile: mobileNorm });
      navigate("/admin/users");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-5">
      <button onClick={() => navigate("/admin/users")} className="text-[13px] text-grey hover:text-orange font-medium inline-flex items-center gap-1">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        Back to users
      </button>
      <h3 className="text-[18px] font-bold text-navy">{editing ? "Edit User" : "Add User"}</h3>

      <Card className="p-6">
        <form onSubmit={submit} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <FieldLabel label="Full name" required><TextInput value={name} onChange={(e) => { setName(e.target.value); setError(""); }} placeholder="e.g. Priya Sharma" autoFocus /></FieldLabel>
            <FieldLabel label="Email / username"><TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@orangeotec.com" /></FieldLabel>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <FieldLabel label="Mobile number" required hint={editing ? "saving resets the login password to this" : "the user's initial password"}>
              <TextInput value={mobile} onChange={(e) => { setMobile(e.target.value); setError(""); }} placeholder="e.g. 9876543210" inputMode="tel" />
            </FieldLabel>
            <FieldLabel label="Designation"><TextInput value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="e.g. Senior Manager" /></FieldLabel>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <FieldLabel label="Department">
              <Combobox
                value={departmentId}
                onChange={setDepartmentId}
                placeholder="— None —"
                searchable
                options={[{ value: "", label: "— None —" }, ...departments.map((d) => ({ value: d.id, label: d.name }))]}
                onCreate={(name) => { void addDepartment({ name }); }}
                createLabel={(q) => `Add department “${q}”`}
              />
            </FieldLabel>
          </div>

          <FieldLabel label="Role">
            <div className="grid sm:grid-cols-2 gap-2">
              {ROLES.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setRole(r.value)}
                  className={cn(
                    "text-left rounded-xl border px-3.5 py-2.5 transition",
                    role === r.value ? "border-orange bg-orange-soft/50 ring-2 ring-orange/15" : "border-line hover:border-orange/40"
                  )}
                >
                  <div className="text-[13px] font-semibold text-navy">{r.label}</div>
                  <div className="text-[11px] text-grey-2">{r.hint}</div>
                </button>
              ))}
            </div>
          </FieldLabel>

          {(role === "employee" || role === "sub_hod") && (
            <FieldLabel label="Reporting HOD(s)" hint="an employee can report to more than one">
              {candidateHods.length === 0 ? (
                <p className="text-[12.5px] text-grey-2">No HODs yet — add a HOD first.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {candidateHods.map((h) => {
                    const on = hodIds.includes(h.id);
                    return (
                      <button
                        key={h.id}
                        type="button"
                        onClick={() => toggleHod(h.id)}
                        className={cn(
                          "inline-flex items-center gap-2 rounded-pill border px-3 py-1.5 text-[12.5px] transition",
                          on ? "border-orange bg-orange-soft text-orange font-semibold" : "border-line text-navy hover:border-orange/40"
                        )}
                      >
                        <Avatar name={h.name} color={h.avatarColor} size={20} />
                        {h.name}
                        {on && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>}
                      </button>
                    );
                  })}
                </div>
              )}
            </FieldLabel>
          )}

          <FieldLabel label="Module access" hint={role === "admin" ? "admins can open every app" : "which apps this user can open"}>
            {role === "admin" ? (
              <p className="text-[12.5px] text-grey-2">Admins have full access to all current and future apps.</p>
            ) : (
              <div className="grid sm:grid-cols-2 gap-2">
                {apps.map((a) => {
                  const on = moduleAccess.includes(a.id);
                  const soon = a.status !== "live";
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => toggleModule(a.id)}
                      className={cn(
                        "flex items-center gap-2.5 text-left rounded-xl border px-3 py-2.5 transition",
                        on ? "border-orange bg-orange-soft/50 ring-2 ring-orange/15" : "border-line hover:border-orange/40"
                      )}
                    >
                      <span className={cn("w-4 h-4 rounded-[5px] border flex items-center justify-center shrink-0", on ? "bg-orange border-orange text-white" : "border-grey-2")}>
                        {on && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium text-navy truncate">{a.name}</span>
                        {soon && <span className="block text-[10.5px] text-grey-2">Coming soon</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </FieldLabel>

          {error && <p className="text-[13px] text-[#d4493f]">{error}</p>}

          <div className="flex items-center justify-end gap-2.5 pt-2">
            {!canSave && (
              <span className="mr-auto text-[12.5px] text-grey-2">
                {editing ? "Read-only preview — saving is being wired next." : "Adding users needs an admin invite — coming soon."}
              </span>
            )}
            <Button variant="ghost" onClick={() => navigate("/admin/users")} disabled={busy}>{canSave ? "Cancel" : "Back"}</Button>
            <Button type="submit" disabled={!canSave || busy}>{busy ? "Saving…" : editing ? "Save changes" : "Create user"}</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
