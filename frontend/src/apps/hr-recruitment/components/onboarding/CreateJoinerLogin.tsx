import { useState } from "react";
import Button from "@/shared/components/ui/Button";
import Combobox from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import Modal from "@/shared/components/ui/Modal";
import { createUserViaFunction } from "@/core/platform/adminUserApi";
import { useHrStore } from "../../store";
import type { Onboarding, Requisition } from "../../types";

/**
 * NR-13 — HR creates the new joiner's Orange One login, without an admin.
 *
 * WHY THIS EXISTS AT ALL. Half of every probation check-in is written by the new
 * joiner from their own account, and nobody can write it for them. Until now only
 * an admin could create that account, and **nobody in HR is an admin** — so the
 * one step HR could not finish was the one the whole cadence depends on.
 *
 * WHY IT LIVES HERE rather than in Admin → Users. The power is scoped to the
 * moment it is needed: this button only exists on an onboarding the caller can
 * already work, and the server re-checks exactly that with
 * `fms_hr_can_act('onboarding', …)` — the same predicate behind `readOnly` here.
 * HR never gets the Admin area, and nobody gets a general "create people" power.
 *
 * ⚠ WHAT IT CANNOT DO, enforced server-side and not merely hidden here:
 *   • no Admin role — Employee, Sub-HOD or HOD only;
 *   • no module access of any kind;
 *   • no Outstanding Dashboard scoping;
 *   • create only — never edit, delete, or reset anybody's password.
 * The person creating the login also knows its password (the mobile number), so
 * anything grantable here would be a way to mint an account and sign in as it.
 * An admin grants access afterwards, deliberately.
 */

const ROLES = [
  { value: "employee", label: "Employee" },
  { value: "sub_hod", label: "Sub-HOD" },
  { value: "hod", label: "HOD / Manager" },
] as const;

export default function CreateJoinerLogin({
  onboarding,
  requisition,
  candidateName,
  onCreated,
}: {
  onboarding: Onboarding;
  requisition: Requisition | undefined;
  candidateName: string;
  /** The new user's id — the caller links it, running as themselves. */
  onCreated: (userId: string) => Promise<void> | void;
}) {
  const s = useHrStore();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(candidateName);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<string>("employee");
  const [departmentId, setDepartmentId] = useState<string>(requisition?.departmentId ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // The mobile number IS the first password, which is why the minimum is the auth
  // minimum and not a formatting rule. Saying so beats a "too short" error later.
  const phoneOk = phone.trim().length >= 6;
  const ready = name.trim().length > 0 && email.trim().length > 0 && phoneOk;

  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      const id = await createUserViaFunction({
        onboardingId: onboarding.id,
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        role: role as "employee" | "sub_hod" | "hod",
        departmentId: departmentId || null,
      });
      // Linking runs as the HR user through the ordinary RPC, so it meets the same
      // guard every other link does. Creating and linking are deliberately two
      // calls under two identities rather than one privileged one.
      await onCreated(id);
      setOpen(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Create their login
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Create a login — ${candidateName}`}
        size="md"
      >
        <div className="space-y-3.5">
          <p className="text-[12.5px] text-grey-2">
            This creates their Orange One account and links it to this onboarding, so they can
            answer their own check-ins. It grants no access to any module — an admin does that
            separately, if they need any.
          </p>

          <FieldLabel label="Full name" required>
            <TextInput value={name} onChange={(e) => setName(e.target.value)} />
          </FieldLabel>

          <FieldLabel label="Email / username" required>
            <TextInput
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@orangeotec.com"
            />
          </FieldLabel>

          <FieldLabel label="Mobile number" required>
            <TextInput
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. 9876543210"
            />
            <span className="mt-1 block text-[11.5px] text-grey-2">
              This is their first password. They can change it after signing in.
            </span>
          </FieldLabel>

          <FieldLabel label="Role" required>
            <div className="mt-1 flex flex-wrap gap-2">
              {ROLES.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setRole(r.value)}
                  className={`rounded-pill border px-3 py-1.5 text-[12.5px] font-medium transition ${
                    role === r.value ? "border-orange bg-orange/5 text-navy" : "border-line text-grey"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <span className="mt-1 block text-[11.5px] text-grey-2">
              Only an admin can create an Admin account.
            </span>
          </FieldLabel>

          <FieldLabel label="Department">
            <Combobox
              value={departmentId}
              onChange={setDepartmentId}
              options={s.departments.map((d) => ({ value: d.id, label: d.name }))}
              placeholder="Select a department"
            />
          </FieldLabel>

          {err && (
            <p role="alert" className="text-[12.5px] text-ryg-red">
              {err}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <Button size="sm" onClick={() => void create()} disabled={busy || !ready}>
              {busy ? "Creating…" : "Create and link"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
