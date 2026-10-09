import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Button from "@/shared/components/ui/Button";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { TextInput, PasswordInput } from "@/shared/components/ui/Form";
import { setUserEmailViaFunction, setUserPasswordViaFunction } from "@/core/platform/adminUserApi";
import { updateUserProfile } from "@/core/platform/directoryWrites";
import { useDispatchStore } from "../store";
import { fetchCustomerLogins, linkCustomerLogin } from "../data/customerOrgs";

const LOGINS_QK = ["dispatch", "customer-logins"] as const;

/**
 * WHICH LOGIN SIGNS IN AS THIS CUSTOMER — inside the Edit dialog (OD-16).
 *
 * ⚠ THIS EXISTS TO UNSTICK A HALF-MADE CUSTOMER, and that state is reachable in
 *   one ordinary way. "Add a customer" does four things in sequence — map items,
 *   save the org, create the auth account, link it — and the LINK is last. If it
 *   fails (or the admin closes the dialog on the error), the auth account already
 *   exists and the org exists, but nothing joins them.
 *
 *   The symptom is precise and misleading: the customer CAN sign in — the account
 *   is real — and lands on "Your account is not finished being set up", because
 *   `fms_dispatch_customer_org_of` finds no active login row. It reads like a
 *   broken password or a broken app, and it is neither.
 *
 *   Before this section there was no way out of it from the UI. Re-running "Add a
 *   customer" with the same email fails at the auth step ("already registered"),
 *   and `linkCustomerLogin` had exactly one caller: `addCustomer`. The only fix
 *   was SQL.
 *
 * ⚠ ONLY EXTERNAL ACCOUNTS ARE OFFERED, and only ones not already spoken for.
 *   Linking a STAFF profile here would handstamp `is_external = false` onto a
 *   customer login and hand that person the Order Desk in place of their own
 *   portal; linking an account already tied to another customer would let one
 *   firm read another's orders, since the whole Desk keys on
 *   `fms_dispatch_customer_org_of(auth.uid())`. `fms_dispatch_customer_logins`
 *   has profile_id as its PRIMARY KEY, so the server refuses the second one
 *   anyway — this keeps it off the list rather than letting somebody find out by
 *   pressing the button.
 */
export default function CustomerOrgLoginSection({ orgId }: { orgId: string }) {
  const s = useDispatchStore();
  const qc = useQueryClient();
  const [pick, setPick] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const logins = useQuery({ queryKey: LOGINS_QK, queryFn: fetchCustomerLogins, staleTime: 30_000 });
  const rows = useMemo(() => logins.data ?? [], [logins.data]);

  const attach = useMutation({
    mutationFn: (profileId: string) => linkCustomerLogin(profileId, orgId, true),
    onSuccess: async () => {
      setErr(null);
      setPick("");
      await qc.invalidateQueries({ queryKey: LOGINS_QK });
      // The grid's "Logins" count comes from the org RPC, not from this table.
      await qc.invalidateQueries({ queryKey: ["dispatch", "customer-orgs"] });
    },
    onError: (e) => setErr(e instanceof Error ? e.message : String(e)),
  });

  const profileById = useMemo(() => new Map(s.profiles.map((p) => [p.id, p])), [s.profiles]);

  /** The login being re-emailed or re-passworded, if any. */
  const [editing, setEditing] = useState<{ profileId: string; kind: "email" | "password"; value: string } | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const openEdit = (profileId: string, kind: "email" | "password", value: string) => {
    setErr(null);
    setDone(null);
    setEditing({ profileId, kind, value });
  };

  const saveEdit = useMutation({
    mutationFn: async (e: { profileId: string; kind: "email" | "password"; value: string }) => {
      const v = e.value.trim();
      if (e.kind === "email") {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new Error("Enter a valid email address.");
        await setUserEmailViaFunction(e.profileId, v);
      } else {
        if (v.length < 6) throw new Error("The password must be at least 6 characters.");
        // ⚠ An admin-users deploy older than this change copies the new password
        //   into profiles.phone (the staff "password = mobile" rule). Put the
        //   customer's phone back, so their password never shows on a staff screen
        //   whichever version of the function is live.
        const phoneBefore = profileById.get(e.profileId)?.phone ?? null;
        await setUserPasswordViaFunction(e.profileId, v);
        await updateUserProfile(e.profileId, { phone: phoneBefore });
      }
      return e.kind;
    },
    onSuccess: async (kind) => {
      setErr(null);
      setEditing(null);
      setDone(kind === "email" ? "Sign-in email changed." : "Password reset.");
      // The email shown here comes from the directory's profiles.
      if (kind === "email") await qc.invalidateQueries({ queryKey: ["directory"] });
    },
    onError: (e) => setErr(e instanceof Error ? e.message : String(e)),
  });

  /** The logins already on THIS customer. */
  const mine = useMemo(
    () => rows.filter((r) => r.orgId === orgId).map((r) => ({ ...r, profile: profileById.get(r.profileId) })),
    [rows, orgId, profileById],
  );

  /** Every external account not already tied to some customer. */
  const options: ComboOption[] = useMemo(() => {
    const taken = new Set(rows.map((r) => r.profileId));
    return s.profiles
      .filter((p) => p.isExternal && !taken.has(p.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => ({ value: p.id, label: p.name, sublabel: p.email ?? undefined }));
  }, [s.profiles, rows]);

  return (
    <div className="space-y-2 border-t border-line pt-4">
      <div className="text-[13px] font-semibold text-navy">Their login</div>

      {logins.isLoading ? (
        <p className="text-[12.5px] text-grey-2">Loading…</p>
      ) : mine.length > 0 ? (
        <div className="rounded-lg border border-line divide-y divide-line">
          {mine.map((r) => (
            <div key={r.profileId} className="flex items-center gap-3 px-3 py-1.5 text-[12.5px]">
              <span className="min-w-0 flex-1 truncate font-semibold text-ink">
                {r.profile?.name ?? "An account no longer in the directory"}
              </span>
              <span className="min-w-0 flex-1 truncate text-grey-2">{r.profile?.email ?? ""}</span>
              {!r.active && <span className="shrink-0 text-[11.5px] text-ryg-red">switched off</span>}
              {r.profile && (
                <div className="flex shrink-0 gap-1.5">
                  <Button size="sm" variant="ghost" className="px-2.5 py-1 text-[12px]" onClick={() => openEdit(r.profileId, "email", r.profile?.email ?? "")}>
                    Change email
                  </Button>
                  <Button size="sm" variant="ghost" className="px-2.5 py-1 text-[12px]" onClick={() => openEdit(r.profileId, "password", "")}>
                    Reset password
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : null}

      {/*
        CHANGE EMAIL / RESET PASSWORD (admin only — Setup is admin-only, and the
        admin-users function refuses anyone else). Inline rather than a second
        modal: this already sits inside the Edit dialog.

        ⚠ autoComplete="new-password" for the same reason as "Add a customer":
          Chrome otherwise fills the ADMIN'S own email and password in here.
      */}
      {editing && (
        <div className="space-y-2 rounded-lg border border-line bg-surface px-3 py-3">
          <div className="text-[12.5px] font-semibold text-ink">
            {editing.kind === "email" ? "New sign-in email" : "New password"}
          </div>
          <div className="flex flex-wrap items-start gap-2">
            <div className="min-w-[260px] flex-1">
              {editing.kind === "email" ? (
                <TextInput
                  value={editing.value}
                  onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                  placeholder="orders@customer.example"
                  autoComplete="new-password"
                  name="od-customer-new-email"
                />
              ) : (
                <PasswordInput
                  value={editing.value}
                  onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                  autoComplete="new-password"
                  name="od-customer-new-password"
                />
              )}
            </div>
            <Button size="sm" onClick={() => saveEdit.mutate(editing)} disabled={saveEdit.isPending}>
              {saveEdit.isPending ? "Saving…" : "Save"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)} disabled={saveEdit.isPending}>
              Cancel
            </Button>
          </div>
          <p className="text-[11.5px] text-grey-2">
            {editing.kind === "email"
              ? "Takes effect at once — the customer signs in with the new address from now on; the old one stops working."
              : "At least 6 characters. Takes effect at once — tell the customer the new password."}
          </p>
        </div>
      )}

      {logins.isLoading || mine.length > 0 ? null : (
        <>
          {/*
            The one state worth spelling out, because the customer's symptom does
            not point here. Red rather than grey: an org with no login is a customer
            who is being told, right now, that their account is unfinished.
          */}
          <p className="text-[12.5px] text-ryg-red">
            No login is attached, so nobody can sign in as this customer — they will see
            “Your account is not finished being set up”.
          </p>
          <div className="flex flex-wrap items-start gap-2">
            <div className="min-w-[280px] flex-1">
              <Combobox
                value={pick}
                onChange={setPick}
                options={options}
                placeholder={
                  options.length ? "Search the account by name or email…" : "No unattached customer accounts"
                }
              />
            </div>
            <Button size="sm" onClick={() => pick && attach.mutate(pick)} disabled={!pick || attach.isPending}>
              {attach.isPending ? "Attaching…" : "Attach"}
            </Button>
          </div>
          <p className="text-[11.5px] text-grey-2">
            Only accounts created for customers appear here. If the account was never made,
            add the customer again with a different email.
          </p>
        </>
      )}

      {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
      {done && !err && <p className="text-[12.5px] text-ryg-green">{done}</p>}
    </div>
  );
}
