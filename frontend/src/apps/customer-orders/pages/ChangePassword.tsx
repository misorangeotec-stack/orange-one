import { useState } from "react";
import Button from "@/shared/components/ui/Button";
import { FieldLabel, PasswordInput } from "@/shared/components/ui/Form";
import { supabase } from "@/core/platform/supabase";
import OrderDeskShell from "../components/OrderDeskShell";
import { useCustomer } from "../CustomerOrdersApp";

/**
 * Change your password (decision 2) — the whole screen, and it is one call.
 *
 * ⚠ SIGNED AS THE USER THEMSELF, which is why it is not the admin path. Every
 *   other password change in the portal goes through the `admin-users` Edge
 *   Function, and the admin path RE-PINS a staff password to the person's mobile
 *   number on any later save of their record. A customer has no mobile on file and
 *   must not be re-pinned to anything; `supabase.auth.updateUser` never touches
 *   that machinery.
 *
 * Same call as `core/account/Account.tsx`, deliberately not shared with it: that
 * page is the staff account screen, complete with department, designation and a
 * "Home" link into the launcher. Reaching it is what the Order Desk exists to
 * avoid, and importing half of it here would drag the rest along eventually.
 */
export default function ChangePassword() {
  const customer = useCustomer();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (pw.length < 6) return setMsg({ ok: false, text: "Please use at least 6 characters." });
    if (pw !== pw2) return setMsg({ ok: false, text: "The two passwords are not the same." });
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: error.message });
    setPw("");
    setPw2("");
    setMsg({ ok: true, text: "Your password has been changed." });
  };

  return (
    <OrderDeskShell title="Your password" subtitle={customer.displayName}>
      <form onSubmit={save} className="rounded-2xl border border-line bg-white p-6 max-w-lg space-y-4">
        <FieldLabel label="New password" hint="At least 6 characters">
          <PasswordInput
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoComplete="new-password"
          />
        </FieldLabel>
        <FieldLabel label="Type it again">
          <PasswordInput
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            autoComplete="new-password"
          />
        </FieldLabel>

        {msg ? (
          <p className={msg.ok ? "text-[13.5px] text-[#1B7F45]" : "text-[13.5px] text-[#B3282C]"}>
            {msg.text}
          </p>
        ) : null}

        <Button type="submit" disabled={busy || !pw || !pw2}>
          {busy ? "Saving…" : "Change my password"}
        </Button>
      </form>
    </OrderDeskShell>
  );
}
