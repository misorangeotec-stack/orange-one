import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import Combobox from "@/shared/components/ui/Combobox";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { FieldLabel, TextInput, PasswordInput } from "@/shared/components/ui/Form";
import { useDispatchStore } from "../../store";
import {
  CUSTOMER_ORGS_QK, MISSING_LABEL, addCustomer, fetchCustomerOrgs, saveCustomerOrg,
  type CustomerOrg,
} from "../../data/customerOrgs";

/**
 * Setup → Customer Logins. Who may place their own orders through the Orange
 * Order Desk, which of their Tally ledgers we recognise as them, and who we tell.
 *
 * ⚠ THE TEST FOR THIS SCREEN IS NOT "CAN I EDIT BISHEN". It is: can an admin add
 *   the TENTH customer, end to end, with no SQL, no migration and no developer.
 *   Bishen and Ganga are the first two, not the design. Everything on this screen
 *   is per-row configuration for exactly that reason, and "Add a customer" does all
 *   four onboarding steps in one action because done by hand it is four steps in
 *   three different screens — and the one that gets forgotten is the app grant, so
 *   the customer signs in successfully and lands on a page offering them nothing.
 *
 * ⚠ READINESS IS THE SERVER'S ANSWER, NOT THIS SCREEN'S. `missing` comes back from
 *   the same function `fms_dispatch_save_customer_org` runs while saving. If this
 *   file computed it too, the two would eventually disagree and the screen would be
 *   the one that lied.
 */
export default function CustomerLoginsSection() {
  const s = useDispatchStore();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<CustomerOrg | null>(null);
  const [adding, setAdding] = useState(false);

  const { data: orgs = [], isLoading } = useQuery({
    queryKey: CUSTOMER_ORGS_QK,
    queryFn: fetchCustomerOrgs,
    staleTime: 30_000,
  });

  const reload = () => qc.invalidateQueries({ queryKey: CUSTOMER_ORGS_QK });

  const columns: QueueColumn<CustomerOrg>[] = useMemo(
    () => [
      {
        key: "name",
        header: "Customer",
        cell: (r) => (
          <div>
            <div className="font-semibold text-ink">{r.displayName}</div>
            {r.customerLocation && <div className="text-[12px] text-grey-2">{r.customerLocation}</div>}
          </div>
        ),
        sortValue: (r) => r.displayName,
        filter: { kind: "select", get: (r) => r.displayName },
      },
      {
        key: "status",
        header: "Status",
        cell: (r) =>
          r.active ? (
            <span className="text-[12.5px] font-semibold text-ryg-green">On</span>
          ) : (
            <span className="text-[12.5px] font-semibold text-grey-2">Off</span>
          ),
        sortValue: (r) => (r.active ? "On" : "Off"),
        filter: { kind: "select", get: (r) => (r.active ? "On" : "Off") },
      },
      {
        key: "ready",
        header: "Ready to switch on",
        cell: (r) =>
          r.missing.length === 0 ? (
            <span className="text-[12.5px] text-ryg-green">Yes</span>
          ) : (
            // Named, not counted. "2 things missing" makes the admin open the row
            // to find out what; the whole point of the check is to say so here.
            <div className="space-y-0.5">
              {r.missing.map((m) => (
                <div key={m} className="text-[12px] text-ryg-red">{MISSING_LABEL[m]}</div>
              ))}
            </div>
          ),
        sortValue: (r) => (r.missing.length === 0 ? "Yes" : "No"),
        filter: { kind: "select", get: (r) => (r.missing.length === 0 ? "Yes" : "No") },
      },
      {
        key: "ledgers",
        header: "Ledgers ticked",
        align: "right",
        cell: (r) => r.partyIds.length,
        sortValue: (r) => r.partyIds.length,
        filter: { kind: "number", get: (r) => r.partyIds.length },
      },
      {
        key: "items",
        header: "Items they can order",
        align: "right",
        cell: (r) => (r.itemCount === 0 ? <span className="text-ryg-red">0</span> : r.itemCount),
        sortValue: (r) => r.itemCount,
        filter: { kind: "number", get: (r) => r.itemCount },
      },
      {
        key: "notify",
        header: "Told about their orders",
        cell: (r) =>
          r.notifyNames.length ? r.notifyNames.join(", ") : <span className="text-ryg-red">Nobody</span>,
        sortValue: (r) => r.notifyNames.join(", "),
        filter: { kind: "select", get: (r) => (r.notifyNames.length ? r.notifyNames.join(", ") : "Nobody") },
      },
      {
        key: "logins",
        header: "Logins",
        align: "right",
        cell: (r) => r.loginCount,
        sortValue: (r) => r.loginCount,
        filter: { kind: "number", get: (r) => r.loginCount },
      },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <Card className="p-5 space-y-2">
        <p className="text-[12.5px] text-grey">
          Customers on this list place their own orders on a screen of their own — item, quantity and a
          remark, nothing else. They never see a billing company, a dispatch site, a dispatch type or any
          of our internal step names. We fill those in at credit check, exactly as we do today.
        </p>
        <div className="pt-1">
          <Button size="sm" onClick={() => setAdding(true)}>Add a customer</Button>
        </div>
      </Card>

      <QueueTable
        rows={orgs}
        rowKey={(r) => r.id}
        columns={columns}
        loading={isLoading}
        rowsLabel="customers"
        emptyTitle="No customers order for themselves yet"
        emptyMessage="Add one and they get a login to a screen that shows nothing but ordering."
        initialSort={{ key: "name", dir: "asc" }}
        actions={(r) => (
          <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>Edit</Button>
        )}
      />

      {editing && (
        <OrgModal
          org={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
      {adding && (
        <AddCustomerModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} />
      )}
    </div>
  );

  /* ---------------------------------------------------------------------- */

  function useOrgFormOptions() {
    /**
     * ⚠ The ledger picker offers ONE ROW PER TALLY BOOK, and the label has to say
     *   which book — "BISHEN DYEING PRINTING & WEAVING MILLS" is five identical
     *   strings otherwise, and the person ticking them has no way to tell which
     *   five they picked or whether they missed one.
     */
    const partyOptions: MultiOption[] = useMemo(() => {
      const companyName = new Map(s.companies.map((c) => [c.id, c.name]));
      return [...s.customers]
        .filter((c) => c.active)
        .sort((a, b) => a.name.localeCompare(b.name) || (companyName.get(a.companyId ?? "") ?? "").localeCompare(companyName.get(b.companyId ?? "") ?? ""))
        .map((c) => ({
          value: c.id,
          label: `${c.name} · ${companyName.get(c.companyId ?? "") ?? "no company"}`,
        }));
    }, []);

    /**
     * Only people who can actually ACT on the order. Naming somebody without edit
     * access to Order to Dispatch sends them a notification about an order they
     * cannot open — the server refuses it too, but refusing after the fact is a
     * worse experience than not offering the name.
     */
    const notifyOptions: MultiOption[] = useMemo(
      () =>
        [...s.profiles]
          .filter((p) => !p.isExternal)
          .filter((p) => p.role === "admin" || p.moduleLevels?.["order-to-dispatch"] === "edit")
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((p) => ({ value: p.id, label: p.designation ? `${p.name} · ${p.designation}` : p.name })),
      [],
    );

    return { partyOptions, notifyOptions };
  }

  function OrgFields({
    displayName, setDisplayName,
    partyIds, setPartyIds,
    primaryPartyId, setPrimaryPartyId,
    customerLocation, setCustomerLocation,
    notifyUserIds, setNotifyUserIds,
    defaultLocationId, setDefaultLocationId,
    defaultDispatchType, setDefaultDispatchType,
    active, setActive,
  }: OrgFieldProps) {
    const { partyOptions, notifyOptions } = useOrgFormOptions();

    // The main ledger must be one of the ticked ones — so it is chosen FROM them,
    // rather than from all 1,850 and validated afterwards.
    const primaryOptions = useMemo(
      () => partyOptions.filter((o) => partyIds.includes(o.value)),
      [partyOptions, partyIds],
    );

    /**
     * The optional dispatch-site pre-fill, offered across every ticked ledger's
     * company. It only ever PRE-FILLS credit check and is always editable there —
     * decisions Q1 and Q2 stand. It exists because all 24 sampled orders for both
     * customers dispatched from the same site, and it is what stops credit check
     * getting slower as customers are added.
     */
    const locationOptions = useMemo(() => {
      const companyIds = new Set(
        s.customers.filter((c) => partyIds.includes(c.id)).map((c) => c.companyId).filter(Boolean) as string[],
      );
      const seen = new Set<string>();
      const out: { value: string; label: string }[] = [];
      companyIds.forEach((cid) => {
        s.locationsForCompany(cid).forEach((l) => {
          if (seen.has(l.id)) return;
          seen.add(l.id);
          out.push({ value: l.id, label: l.name });
        });
      });
      return out.sort((a, b) => a.label.localeCompare(b.label));
    }, [partyIds]);

    return (
      <div className="space-y-4">
        <FieldLabel label="What they are called" required hint="Shown at the head of their own screen — their name, not a Tally ledger name.">
          <TextInput value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Bishen Dyeing" />
        </FieldLabel>

        <FieldLabel
          label="Their ledgers"
          required
          hint="Every Tally ledger that IS this customer. One per company book — leave out machine and old-machine ledgers."
        >
          <MultiSelect
            values={partyIds}
            onChange={(v) => {
              setPartyIds(v);
              if (primaryPartyId && !v.includes(primaryPartyId)) setPrimaryPartyId(null);
            }}
            options={partyOptions}
            placeholder="Tick their ledgers"
            searchable
          />
        </FieldLabel>

        <FieldLabel label="Main ledger" required hint="The one an order is raised against until credit check picks the billing book.">
          <Combobox
            value={primaryPartyId ?? ""}
            onChange={(v) => setPrimaryPartyId(v || null)}
            options={primaryOptions}
            placeholder={partyIds.length ? "Choose one of the ticked ledgers" : "Tick their ledgers first"}
          />
        </FieldLabel>

        <FieldLabel label="Where they take delivery" hint="Shown to them as text. They do not pick it.">
          <TextInput value={customerLocation} onChange={(e) => setCustomerLocation(e.target.value)} placeholder="MUMBAI" />
        </FieldLabel>

        <FieldLabel
          label="Who we tell when they order"
          required
          hint="They get the alert and can open the order. At least one person — an order nobody is told about sits unseen."
        >
          <MultiSelect values={notifyUserIds} onChange={setNotifyUserIds} options={notifyOptions} placeholder="Choose who is told" searchable />
        </FieldLabel>

        <div className="grid grid-cols-2 gap-4">
          <FieldLabel label="Usually dispatched from" hint="Optional. Only pre-fills credit check; always changeable there.">
            <Combobox
              value={defaultLocationId ?? ""}
              onChange={(v) => setDefaultLocationId(v || null)}
              options={locationOptions}
              placeholder="No default"
            />
          </FieldLabel>
          <FieldLabel label="Usually sent by" hint="Optional. Only pre-fills credit check.">
            <Combobox
              value={defaultDispatchType ?? ""}
              onChange={(v) => setDefaultDispatchType((v || null) as "local" | "transport" | null)}
              options={[{ value: "local", label: "Local" }, { value: "transport", label: "Transport" }]}
              placeholder="No default"
            />
          </FieldLabel>
        </div>

        <label className="flex items-center gap-2 text-[13px] text-ink">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          They may place orders now
        </label>
      </div>
    );
  }

  function OrgModal({ org, onClose, onSaved }: { org: CustomerOrg; onClose: () => void; onSaved: () => void }) {
    const [displayName, setDisplayName] = useState(org.displayName);
    const [partyIds, setPartyIds] = useState<string[]>(org.partyIds);
    const [primaryPartyId, setPrimaryPartyId] = useState<string | null>(org.primaryPartyId);
    const [customerLocation, setCustomerLocation] = useState(org.customerLocation ?? "");
    const [notifyUserIds, setNotifyUserIds] = useState<string[]>(org.notifyUserIds);
    const [defaultLocationId, setDefaultLocationId] = useState<string | null>(org.defaultLocationId);
    const [defaultDispatchType, setDefaultDispatchType] = useState<"local" | "transport" | null>(org.defaultDispatchType);
    const [active, setActive] = useState(org.active);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const save = async () => {
      setBusy(true); setErr(null);
      try {
        await saveCustomerOrg({
          id: org.id, displayName, partyIds, primaryPartyId,
          customerLocation: customerLocation.trim() || null,
          notifyUserIds, defaultLocationId, defaultDispatchType, active,
        });
        onSaved();
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setBusy(false);
      }
    };

    return (
      <Modal
        open
        onClose={onClose}
        title={org.displayName}
        subtitle="What we recognise as this customer, and who hears from them."
        size="lg"
        footer={
          <div className="flex items-center gap-3">
            <Button size="sm" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
            <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
            {err && <span className="text-[12.5px] text-ryg-red">{err}</span>}
          </div>
        }
      >
        <OrgFields
          {...{ displayName, setDisplayName, partyIds, setPartyIds, primaryPartyId, setPrimaryPartyId,
                customerLocation, setCustomerLocation, notifyUserIds, setNotifyUserIds,
                defaultLocationId, setDefaultLocationId, defaultDispatchType, setDefaultDispatchType,
                active, setActive }}
        />
      </Modal>
    );
  }

  function AddCustomerModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
    const [displayName, setDisplayName] = useState("");
    const [partyIds, setPartyIds] = useState<string[]>([]);
    const [primaryPartyId, setPrimaryPartyId] = useState<string | null>(null);
    const [customerLocation, setCustomerLocation] = useState("");
    const [notifyUserIds, setNotifyUserIds] = useState<string[]>([]);
    const [defaultLocationId, setDefaultLocationId] = useState<string | null>(null);
    const [defaultDispatchType, setDefaultDispatchType] = useState<"local" | "transport" | null>(null);
    const [active, setActive] = useState(true);
    const [loginName, setLoginName] = useState("");
    const [loginEmail, setLoginEmail] = useState("");
    const [loginPassword, setLoginPassword] = useState("");
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const save = async () => {
      setBusy(true); setErr(null);
      try {
        await addCustomer({
          displayName, partyIds, primaryPartyId,
          customerLocation: customerLocation.trim() || null,
          notifyUserIds, defaultLocationId, defaultDispatchType, active,
          loginName: loginName.trim() || displayName.trim(),
          loginEmail: loginEmail.trim(),
          loginPassword,
        });
        onSaved();
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setBusy(false);
      }
    };

    return (
      <Modal
        open
        onClose={onClose}
        title="Add a customer"
        subtitle="Creates their login, their ordering access and this record — all of it, in one go."
        size="lg"
        footer={
          <div className="flex items-center gap-3">
            <Button size="sm" onClick={save} disabled={busy}>{busy ? "Creating…" : "Create"}</Button>
            <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
            {err && <span className="text-[12.5px] text-ryg-red">{err}</span>}
          </div>
        }
      >
        <div className="space-y-5">
          <OrgFields
            {...{ displayName, setDisplayName, partyIds, setPartyIds, primaryPartyId, setPrimaryPartyId,
                  customerLocation, setCustomerLocation, notifyUserIds, setNotifyUserIds,
                  defaultLocationId, setDefaultLocationId, defaultDispatchType, setDefaultDispatchType,
                  active, setActive }}
          />
          <div className="border-t border-line pt-4 space-y-4">
            <div className="text-[13px] font-semibold text-navy">Their login</div>
            <p className="text-[12px] text-grey-2">
              One login for the customer, not for a person — anyone at their office who orders uses it. The
              password is a real one you choose and tell them; it is never their phone number, and no later
              admin save will change it back.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <FieldLabel label="Sign-in email" required>
                <TextInput value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} placeholder="orders@bishen.example" />
              </FieldLabel>
              <FieldLabel label="Password" required hint="At least 6 characters.">
                <PasswordInput value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} />
              </FieldLabel>
            </div>
            <FieldLabel label="Name on the account" hint="Defaults to the customer's name.">
              <TextInput value={loginName} onChange={(e) => setLoginName(e.target.value)} placeholder={displayName || "Bishen Dyeing"} />
            </FieldLabel>
          </div>
        </div>
      </Modal>
    );
  }
}

interface OrgFieldProps {
  displayName: string; setDisplayName: (v: string) => void;
  partyIds: string[]; setPartyIds: (v: string[]) => void;
  primaryPartyId: string | null; setPrimaryPartyId: (v: string | null) => void;
  customerLocation: string; setCustomerLocation: (v: string) => void;
  notifyUserIds: string[]; setNotifyUserIds: (v: string[]) => void;
  defaultLocationId: string | null; setDefaultLocationId: (v: string | null) => void;
  defaultDispatchType: "local" | "transport" | null; setDefaultDispatchType: (v: "local" | "transport" | null) => void;
  active: boolean; setActive: (v: boolean) => void;
}
