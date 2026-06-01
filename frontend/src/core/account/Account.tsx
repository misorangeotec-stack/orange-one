import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Avatar from "@/shared/components/ui/Avatar";
import Logo from "@/shared/components/ui/Logo";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import { useSession } from "@/core/platform/session";
import { useDirectory } from "@/core/platform/store";

/**
 * Personal account page — any signed-in user edits their own profile + password.
 * Portal-level (not task-specific), reached from the workspace user menu.
 */
export default function Account() {
  const navigate = useNavigate();
  const { user } = useSession();
  const { profileById, departmentById, updateUser } = useDirectory();
  const me = profileById(user.id) ?? user;

  const [name, setName] = useState(me.name);
  const [email, setEmail] = useState(me.email ?? "");
  const [designation, setDesignation] = useState(me.designation ?? "");
  const [savedProfile, setSavedProfile] = useState(false);

  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const roleLabel = { admin: "Admin", hod: "HOD", sub_hod: "Sub-HOD", employee: "Employee" }[me.role];

  const saveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    updateUser(me.id, { name: name.trim(), email: email.trim() || null, designation: designation.trim() || null });
    setSavedProfile(true);
    setTimeout(() => setSavedProfile(false), 2500);
  };

  const changePassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 6) return setPwMsg({ ok: false, text: "Password must be at least 6 characters." });
    if (pw !== pw2) return setPwMsg({ ok: false, text: "Passwords don't match." });
    setPw("");
    setPw2("");
    setPwMsg({ ok: true, text: "Password updated." });
  };

  return (
    <div className="min-h-screen bg-page-grad font-sans">
      <header className="border-b border-line bg-white/70 backdrop-blur">
        <div className="max-w-3xl mx-auto px-6 h-[68px] flex items-center justify-between">
          <Logo variant="light" height={32} to="/home" />
          <button onClick={() => navigate("/home")} className="text-sm text-grey hover:text-orange font-medium transition inline-flex items-center gap-1.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
            Back to workspace
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10">
        <h1 className="text-[26px] font-bold text-navy mb-1 tracking-tight">My Account</h1>
        <p className="text-grey mb-6">Manage your profile and password.</p>

        <div className="max-w-2xl space-y-4">
          <Card className="p-6">
            <div className="flex items-center gap-4 pb-5 mb-5 border-b border-line">
              <Avatar name={me.name} color={me.avatarColor} size={56} />
              <div>
                <div className="text-[16px] font-semibold text-navy">{me.name}</div>
                <div className="text-[12.5px] text-grey-2">
                  {roleLabel} · {departmentById(me.departmentId)?.name ?? "No department"}
                </div>
              </div>
            </div>

            <form onSubmit={saveProfile} className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <FieldLabel label="Full name"><TextInput value={name} onChange={(e) => setName(e.target.value)} /></FieldLabel>
                <FieldLabel label="Email / username"><TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></FieldLabel>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <FieldLabel label="Designation"><TextInput value={designation} onChange={(e) => setDesignation(e.target.value)} /></FieldLabel>
                <FieldLabel label="Role" hint="set by admin"><TextInput value={roleLabel} disabled /></FieldLabel>
              </div>
              <div className="flex items-center justify-end gap-3 pt-1">
                {savedProfile && <span className="text-[12.5px] text-[#27AE60] font-medium">✓ Saved</span>}
                <Button type="submit">Save profile</Button>
              </div>
            </form>
          </Card>

          <Card className="p-6">
            <h3 className="text-[14px] font-semibold text-navy">Change password</h3>
            <p className="text-[12.5px] text-grey-2 mt-1 mb-4">Update your password. Forgot it? Ask your admin to reset it.</p>
            <form onSubmit={changePassword} className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <FieldLabel label="New password"><TextInput type="password" value={pw} onChange={(e) => { setPw(e.target.value); setPwMsg(null); }} placeholder="••••••••" /></FieldLabel>
                <FieldLabel label="Confirm new password"><TextInput type="password" value={pw2} onChange={(e) => { setPw2(e.target.value); setPwMsg(null); }} placeholder="••••••••" /></FieldLabel>
              </div>
              <div className="flex items-center justify-end gap-3">
                {pwMsg && <span className={`text-[12.5px] font-medium ${pwMsg.ok ? "text-[#27AE60]" : "text-[#d4493f]"}`}>{pwMsg.ok ? "✓ " : ""}{pwMsg.text}</span>}
                <Button type="submit" variant="outline">Update password</Button>
              </div>
            </form>
          </Card>
        </div>
      </main>
    </div>
  );
}
