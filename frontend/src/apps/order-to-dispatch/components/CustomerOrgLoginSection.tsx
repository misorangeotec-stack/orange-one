import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Button from "@/shared/components/ui/Button";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
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
            </div>
          ))}
        </div>
      ) : (
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
    </div>
  );
}
