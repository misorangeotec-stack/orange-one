import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Tabs from "@/shared/components/ui/Tabs";
import MultiSelect from "@/shared/components/ui/MultiSelect";
import MasterCrud, { type MasterColumn, type MasterFieldDef } from "@/shared/components/ui/MasterCrud";
import { useSession } from "@/core/platform/session";
import { APPS } from "@/apps/appInfo";
import {
  companyDisplayName, itemTypeLabel, ITEM_TYPES,
  fetchMasterCompanies, fetchMasterItems, fetchMasterLocations, fetchMasterLookup,
  fetchMasterParties, fetchMasterPartyItems, fetchMasterSyncRuns,
  type ItemType,
  type MasterCompany, type MasterItem, type MasterLocation, type MasterLookup,
  type MasterParty, type MasterPartyItem,
} from "@/core/platform/liveMasters";
import {
  fetchMyMasterManagerTypes, insertMaster, runMastersSync, setMasterActive, updateMaster,
  type CentralMasterType,
} from "@/core/platform/masterWrites";

/**
 * CENTRAL MASTERS — one screen for every master in the portal.
 *
 * GENERAL masters (companies, customers, vendors, items, groups, units) are fed
 * from Tally and shared by every module. MODULE-SPECIFIC masters — the ones Tally
 * has no concept of — live here too, so there is one place to look.
 *
 * ⚠ EVERY TAB LOADS ITS OWN DATA, LAZILY. Parties is ~7,800 rows and Items
 *   ~14,200 — every ledger and stock item in Tally. Loading all of it up front
 *   would be megabytes for a screen showing 25 rows, so each tab has its own
 *   query key and nothing is fetched until you open it.
 *
 * ⚠ THE `Modules` FIELD IS THE POINT OF THIS SCREEN. Tally's ~22,000 records are
 *   all present and searchable, but a row appears in a module's dropdowns ONLY
 *   where it is ticked here. That tick is portal-owned and a sync never
 *   overwrites it — which is what keeps Dispatch's customer picker at a few
 *   hundred names instead of eight thousand.
 *
 * Tally-owned fields render locked. Not to be obstructive: the write layer drops
 * them and the next sync would rewrite them anyway, so an editable box would
 * accept a change that quietly evaporates.
 */

type TabKey =
  | "company" | "customer" | "vendor" | "item" | "item_group" | "unit" | "location" | "party_item";

const TABS: { value: TabKey; label: string }[] = [
  { value: "company", label: "Companies" },
  { value: "customer", label: "Customers" },
  { value: "vendor", label: "Vendors" },
  { value: "item", label: "Items" },
  { value: "party_item", label: "Customer Items" },
  { value: "item_group", label: "Item Groups" },
  { value: "unit", label: "Units" },
  { value: "location", label: "Our Locations" },
];

/** Which mst_* table each tab writes to. Customers and vendors share one. */
const WRITE_TYPE: Record<TabKey, CentralMasterType> = {
  company: "company", customer: "party", vendor: "party", item: "item",
  item_group: "item_group", unit: "unit", location: "location", party_item: "party_item",
};

// APPS is keyed BY app id — the id is the record key, not a field on AppInfo.
const MODULE_OPTIONS = Object.entries(APPS)
  .map(([id, a]) => ({ value: id, label: a.name }))
  .sort((a, b) => a.label.localeCompare(b.label));

const csvToList = (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean);

/** The Modules picker, shared by every tab that has one. */
const modulesField = (): MasterFieldDef => ({
  key: "modules",
  label: "Shown in modules",
  type: "custom",
  hint: "Leave empty and the row stays searchable here but appears in no module's dropdowns. A Tally sync never changes this.",
  render: (value, onChange) => (
    <MultiSelect
      values={csvToList(value)}
      onChange={(ids) => onChange(ids.join(","))}
      options={MODULE_OPTIONS}
      placeholder="No module"
      searchable
      chips
    />
  ),
});

const sortField: MasterFieldDef = { key: "sortOrder", label: "Sort order", type: "text", placeholder: "0" };

const TallyBadge = ({ source }: { source: string }) =>
  source === "tally" ? (
    <span className="rounded bg-navy/10 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-navy">
      Tally
    </span>
  ) : (
    <span className="rounded bg-page px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-grey-2">
      Portal
    </span>
  );

/**
 * The five business buckets, colour-coded so a mis-sorted row is spotted while
 * scrolling rather than only when someone reads the label.
 *
 * "Not set" is shown, not a dash: 396 items carry no signal in either their name
 * or their Tally group, and guessing "Others" for them would claim knowledge we
 * do not have. It is a filterable value, so it doubles as the review queue.
 */
const ITEM_TYPE_STYLE: Record<string, string> = {
  ink: "bg-orange/10 text-orange",
  spare_parts: "bg-navy/10 text-navy",
  head: "bg-[#F3E8FF] text-[#7C3AED]",
  machine: "bg-[#E0F2FE] text-[#0369A1]",
  other: "bg-page text-grey-2",
};

const ItemTypeCell = ({ type }: { type: ItemType | null }) =>
  type ? (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${ITEM_TYPE_STYLE[type] ?? "bg-page text-grey-2"}`}>
      {itemTypeLabel(type)}
    </span>
  ) : (
    <span className="text-[12px] text-grey-2/70">Not set</span>
  );

const ModulesCell = ({ modules }: { modules: string[] }) =>
  modules.length === 0 ? (
    <span className="text-[12px] text-grey-2">—</span>
  ) : (
    <span className="text-[12px] text-navy">{modules.map((m) => APPS[m]?.name ?? m).join(", ")}</span>
  );

/**
 * ⚠ A CELL THAT RENDERS A COMPONENT MUST DECLARE ITS OWN sortValue AND filter.
 *
 * MasterCrud derives both from the text a cell renders, which it reads by
 * walking the returned node — and a custom component (<TallyBadge />) is an
 * element whose children are undefined until React renders it, so the walk
 * yields "". The column then silently loses its sort arrow and its filter,
 * which is exactly what the project rule forbids.
 *
 * These three columns are shared across the tabs, so they are built once here
 * with their overrides attached rather than re-declared (and re-forgotten) at
 * each of the seven call sites.
 */
const sourceCol = <T extends { source: string }>(): MasterColumn<T> => ({
  header: "Source",
  render: (r) => <TallyBadge source={r.source} />,
  sortValue: (r) => (r.source === "tally" ? "Tally" : "Portal"),
  filter: { get: (r) => (r.source === "tally" ? "Tally" : "Portal") },
  className: "w-24",
});

const modulesCol = <T extends { modules: string[] }>(): MasterColumn<T> => ({
  header: "Modules",
  render: (r) => <ModulesCell modules={r.modules} />,
  // Sorted so "Dispatch, Purchase" and "Purchase, Dispatch" are one value.
  sortValue: (r) => r.modules.map((m) => APPS[m]?.name ?? m).sort().join(", "),
  // An array: the row matches if ANY picked module is among its own, which is
  // what "show me what Dispatch offers" has to mean for a multi-module row.
  filter: {
    get: (r) => (r.modules.length ? r.modules.map((m) => APPS[m]?.name ?? m) : "Not in any module"),
  },
});

/**
 * Shared by Items and Customer Items — the type is the item's, so a customer
 * line shows the same badge as the item it points at, never a second opinion.
 */
const itemTypeCol = <T extends { itemType: ItemType | null }>(): MasterColumn<T> => ({
  header: "Type",
  render: (r) => <ItemTypeCell type={r.itemType} />,
  sortValue: (r) => itemTypeLabel(r.itemType),
  filter: { get: (r) => itemTypeLabel(r.itemType) || "Not set" },
  className: "w-32",
});

export default function Masters() {
  const { isAdmin, user } = useSession();
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabKey>("company");
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);
  /** Show only rows typed in the portal — see the chip under the tabs. */
  const [addedHere, setAddedHere] = useState(false);

  // ---- data. One key per master; only the open tab is enabled. -------------
  const enabled = (k: TabKey | TabKey[]) => (Array.isArray(k) ? k.includes(tab) : tab === k);
  const opts = { staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false } as const;

  const companies = useQuery({ queryKey: ["masters", "companies"], queryFn: fetchMasterCompanies, ...opts,
    // Companies are the parent lookup for parties, items and locations, so they
    // load for those tabs too — 5 rows, not worth a second thought.
    enabled: enabled(["company", "customer", "vendor", "item", "item_group", "location", "party_item"]) });
  // Customer Items needs both lists too, to offer the two pickers on its Add form.
  const parties = useQuery({ queryKey: ["masters", "parties"], queryFn: fetchMasterParties, ...opts,
    enabled: enabled(["customer", "vendor", "party_item"]) });
  const items = useQuery({ queryKey: ["masters", "items"], queryFn: fetchMasterItems, ...opts,
    enabled: enabled(["item", "party_item"]) });
  const groups = useQuery({ queryKey: ["masters", "item_groups"], queryFn: () => fetchMasterLookup("mst_item_groups"), ...opts,
    // Customer Items shows the item's GROUP, so it needs this lookup too.
    enabled: enabled(["item", "item_group", "party_item"]) });
  const units = useQuery({ queryKey: ["masters", "units"], queryFn: () => fetchMasterLookup("mst_units"), ...opts,
    enabled: enabled(["item", "unit"]) });
  const locations = useQuery({ queryKey: ["masters", "locations"], queryFn: fetchMasterLocations, ...opts,
    enabled: enabled("location") });
  const partyItems = useQuery({ queryKey: ["masters", "party_items"], queryFn: fetchMasterPartyItems, ...opts,
    enabled: enabled("party_item") });
  const runs = useQuery({ queryKey: ["masters", "sync-runs"], queryFn: () => fetchMasterSyncRuns(1), staleTime: 60_000 });

  /**
   * Master managers manage their own master type here, not only admins.
   *
   * The RLS on every mst_* table has always read
   * `is_admin(uid) OR mst_is_master_manager('<type>', uid)` — this screen was
   * simply stricter than the database, so a manager could approve a request for
   * their master type but not touch the master itself.
   */
  const myManaged = useQuery({
    queryKey: ["masters", "my-manager-types", user?.id],
    queryFn: () => fetchMyMasterManagerTypes(user?.id ?? null),
    staleTime: 5 * 60 * 1000,
  });
  const mayManage = (type: CentralMasterType) =>
    isAdmin || (myManaged.data ?? []).includes(type);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["masters"] });

  /**
   * The open tab's rows, before the Added-here chip narrows them — the chip needs
   * a count, and the count has to come from the unfiltered set or it would read
   * as its own answer once switched on.
   */
  const tabRows = useMemo((): { source: string }[] => {
    switch (tab) {
      case "company": return companies.data ?? [];
      case "customer": return (parties.data ?? []).filter((p) => p.isCustomer);
      case "vendor": return (parties.data ?? []).filter((p) => p.isVendor);
      case "item": return items.data ?? [];
      case "item_group": return groups.data ?? [];
      case "unit": return units.data ?? [];
      case "location": return locations.data ?? [];
      case "party_item": return partyItems.data ?? [];
      default: return [];
    }
  }, [tab, companies.data, parties.data, items.data, groups.data, units.data, locations.data, partyItems.data]);

  const addedHereCount = useMemo(
    () => tabRows.filter((r) => r.source === "portal").length,
    [tabRows],
  );

  /** Applied to every tab's rows, so one chip governs all of them identically. */
  const onlyAddedHere = <T extends { source: string }>(list: T[]): T[] =>
    addedHere ? list.filter((r) => r.source === "portal") : list;

  // Everything outside the Companies tab shows the ALIAS, never Tally's book name.
  const companyOptions = useMemo(
    () => (companies.data ?? []).map((c) => ({ value: c.id, label: companyDisplayName(c) })),
    [companies.data],
  );
  const companyLabel = useMemo(
    () => new Map((companies.data ?? []).map((c) => [c.id, companyDisplayName(c)])),
    [companies.data],
  );
  /**
   * Group labels carry their company, because 103 group NAMES are shared across
   * companies — a bare "PAPER ROLL" in a picker would be five different things.
   */
  const groupOptions = useMemo(
    () => (groups.data ?? []).map((g) => ({
      value: g.id,
      label: g.name,
      sublabel: g.companyId ? companyLabel.get(g.companyId) : undefined,
    })),
    [groups.data, companyLabel],
  );
  const unitOptions = useMemo(() => (units.data ?? []).map((u) => ({ value: u.id, label: u.name })), [units.data]);

  /**
   * The two pickers on the Customer Items add form.
   *
   * Inactive rows are left out: mapping a customer to an item nobody may order
   * creates a pair that cannot be used and reads as a bug when it fails later.
   * Both lists carry the company as a sublabel, because the same firm and the
   * same stock item exist once per Tally company book — without it the picker
   * shows the same name three times with no way to tell them apart.
   */
  const customerPickOptions = useMemo(
    () => (parties.data ?? [])
      .filter((p) => p.isCustomer && p.active)
      .map((p) => ({
        value: p.id,
        label: p.name,
        sublabel: p.companyId ? companyLabel.get(p.companyId) : undefined,
      })),
    [parties.data, companyLabel],
  );
  const itemPickOptions = useMemo(
    () => (items.data ?? [])
      .filter((i) => i.active)
      .map((i) => ({
        value: i.id,
        label: i.name,
        sublabel: i.companyId ? companyLabel.get(i.companyId) : undefined,
      })),
    [items.data, companyLabel],
  );

  const doSync = async (force: boolean) => {
    setSyncing(true);
    setSyncNote(null);
    try {
      const res = await runMastersSync(force);
      setSyncNote(
        res.skipped
          ? "Tally has not synced since the last pull — nothing to bring in."
          : `Pulled ${res.counts?.parties ?? 0} parties and ${res.counts?.items ?? 0} items.`,
      );
      await invalidate();
    } catch (e) {
      setSyncNote(`Sync failed: ${(e as Error).message}`);
    } finally {
      setSyncing(false);
    }
  };

  /** Shared submit: a null id creates, otherwise patches only what changed. */
  const submitFor = (type: CentralMasterType, toPatch: (v: Record<string, string>) => Record<string, unknown>) =>
    async (id: string | null, values: Record<string, string>, active: boolean) => {
      const patch = { ...toPatch(values), active, sort_order: Number(values.sortOrder ?? 0) || 0 };
      if (id) {
        const row = [...(parties.data ?? []), ...(items.data ?? []), ...(companies.data ?? []),
          ...(groups.data ?? []), ...(units.data ?? []), ...(locations.data ?? [])].find((r) => r.id === id);
        await updateMaster(type, id, patch, row?.source ?? "portal");
      } else {
        await insertMaster(type, patch);
      }
      await invalidate();
    };

  const toggle = (type: CentralMasterType) => async (row: { id: string }, active: boolean) => {
    await setMasterActive(type, row.id, active);
    await invalidate();
  };

  /**
   * A row is STALE when the last successful sync did not touch it — its
   * tally_synced_at predates that run. That is what a leftover looks like: a
   * group or item Tally no longer reports, which the sync deliberately never
   * deletes. Surfacing it is what lets an admin decide.
   */
  const lastSyncAt = runs.data?.find((r) => r.status === "success")?.startedAt ?? null;
  const isStale = (row: { source: string; tallySyncedAt: string | null }) =>
    row.source === "tally" && !!lastSyncAt
      && (!row.tallySyncedAt || row.tallySyncedAt < lastSyncAt);

  const StaleCell = ({ row }: { row: { source: string; tallySyncedAt: string | null } }) =>
    isStale(row)
      ? <span className="rounded bg-orange/10 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-orange">
          Not in last sync
        </span>
      : <span className="text-[12px] text-grey-2">In Tally</span>;

  const lastRun = runs.data?.[0];
  const loading = [companies, parties, items, groups, units, locations].some((q) => q.isFetching);
  const error = [companies, parties, items, groups, units, locations].find((q) => q.error)?.error as Error | undefined;

  return (
    <div className="space-y-4">
      {/* ---------------------------------------------------------- header -- */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[17px] font-semibold text-navy">Central Masters</h1>
            <p className="mt-1 max-w-2xl text-[13px] text-grey">
              One master list per concept, shared by every module. Companies, customers, vendors and
              items come from Tally and refresh automatically; everything else is managed here.
              A row appears in a module only where <strong>Shown in modules</strong> says so.
            </p>
          </div>
          <div className="text-right">
            <div className="flex gap-2">
              <Link
                to="/admin/masters/reconcile"
                className="inline-flex items-center rounded-lg border border-line px-3 py-1.5 text-[12.5px] font-medium text-navy transition hover:border-orange hover:text-orange"
              >
                Reconcile with Tally
              </Link>
              <Button size="sm" variant="ghost" onClick={() => doSync(false)} disabled={syncing || !isAdmin}>
                {syncing ? "Syncing…" : "Sync now"}
              </Button>
              <Button size="sm" onClick={() => doSync(true)} disabled={syncing || !isAdmin}>
                Force full pull
              </Button>
            </div>
            <p className="mt-1.5 text-[11.5px] text-grey-2">
              {lastRun
                ? `Last sync ${new Date(lastRun.startedAt).toLocaleString()} — ${lastRun.status}`
                : "Never synced"}
            </p>
          </div>
        </div>
        {syncNote && <p className="mt-3 rounded bg-page px-3 py-2 text-[12.5px] text-navy">{syncNote}</p>}
        {error && <p className="mt-3 rounded bg-orange/10 px-3 py-2 text-[12.5px] text-orange">{error.message}</p>}
      </Card>

      <Tabs
        tabs={TABS.map((t) => ({ key: t.value, label: t.label }))}
        active={tab}
        /* Reset the chip on every tab change. Left on, it would carry into a tab
           with no portal rows at all — where the chip hides itself, leaving an
           empty table and no visible control to explain it. */
        onChange={(k) => { setTab(k as TabKey); setAddedHere(false); }}
      />

      {/*
        ADDED HERE — one click to everything this tab holds that Tally did not send.
        These are the rows that may one day need reconciling against a Tally record,
        and finding them was otherwise a matter of remembering that the Source column
        has a filter under it. The count is the answer even before you click.
        Hidden at zero: a chip reading "Added here 0" is noise on a tab fed entirely
        by the sync, which is most of them.
      */}
      {addedHereCount > 0 && (
        <div className="flex items-center gap-2 px-1">
          <button
            onClick={() => setAddedHere((v) => !v)}
            aria-pressed={addedHere}
            className={
              "rounded-full border px-3 py-1 text-[12.5px] font-medium transition " +
              (addedHere
                ? "border-orange bg-orange/10 text-orange"
                : "border-line text-grey hover:border-orange hover:text-orange")
            }
          >
            Added here {addedHereCount}
          </button>
          {addedHere && (
            <span className="text-[12px] text-grey-2">
              Typed in the portal, not sent by Tally
              {tab === "customer" || tab === "item"
                ? " — if Tally later gains the same record, Reconcile with Tally merges the two."
                : "."}
            </span>
          )}
        </div>
      )}

      {loading && <p className="px-1 text-[12.5px] text-grey-2">Loading…</p>}

      {/* ------------------------------------------------------- companies -- */}
      {tab === "company" && (
        <MasterCrud<MasterCompany>
          singular="Company"
          rows={onlyAddedHere(companies.data ?? [])}
          canManage={mayManage("company")}
          searchText={(r) => `${r.alias ?? ""} ${r.name} ${r.location ?? ""} ${r.gstin ?? ""}`}
          columns={[
            /* The Tally book name first — this tab is where an admin asks
               "which Tally company IS this row?". Every other screen shows the alias. */
            { header: "Company in Tally", render: (r) => <span className="text-[12.5px] text-navy">{r.name}</span> },
            { header: "Location", render: (r) => <span className="text-grey">{r.location ?? "—"}</span> },
            /* Rendered exactly as every FMS picker will show it — "Colorix — Surat" —
               so what an admin reads here is what a user will read there. The two
               halves stay separately editable in the form below. */
            { header: "Alias (shown in FMS)", render: (r) => (
              r.alias
                ? <span className="font-medium text-navy">{companyDisplayName(r)}</span>
                : <span className="text-[12px] text-orange">Set an alias</span>
            ) },
            modulesCol(),
          ]}
          fields={[
            { key: "name", label: "Company in Tally", type: "text", required: true, readOnly: true,
              hint: "Tally's own name, carrying the financial year. Re-read on every sync." },
            { key: "alias", label: "Alias", type: "text", required: true,
              hint: "The short name every FMS shows. Yours — no sync ever changes it, so an April year-end leaves every screen reading the same." },
            { key: "location", label: "Location", type: "text", placeholder: "Surat / Noida" },
            { key: "gatePassPrefix", label: "Gate pass prefix", type: "text" },
            modulesField(),
            sortField,
          ]}
          emptyValues={{ name: "", alias: "", location: "", gatePassPrefix: "", modules: "", sortOrder: "0" }}
          toValues={(r) => ({
            name: r.name, alias: r.alias ?? "", location: r.location ?? "",
            gatePassPrefix: r.gatePassPrefix ?? "", modules: r.modules.join(","), sortOrder: String(r.sortOrder),
          })}
          onSubmit={submitFor("company", (v) => ({
            name: v.name.trim(), alias: v.alias.trim() || null, location: v.location.trim() || null,
            gate_pass_prefix: v.gatePassPrefix.trim() || null, modules: csvToList(v.modules),
          }))}
          onToggleActive={toggle("company")}
        />
      )}

      {/* ---------------------------------------------- customers / vendors -- */}
      {(tab === "customer" || tab === "vendor") && (
        <MasterCrud<MasterParty>
          singular={tab === "customer" ? "Customer" : "Vendor"}
          rows={onlyAddedHere((parties.data ?? []).filter((p) => (tab === "customer" ? p.isCustomer : p.isVendor)))}
          canManage={mayManage("party")}
          searchText={(r) => `${r.name} ${r.code ?? ""} ${r.gstin ?? ""} ${r.subGroup ?? ""} ${r.location ?? ""}`}
          columns={[
            { header: "Name", render: (r) => <span className="font-medium text-navy">{r.name}</span> },
            { header: "Company", render: (r) => (
              <span className="text-[12px] text-grey">{r.companyId ? companyLabel.get(r.companyId) ?? "—" : "—"}</span>
            ) },
            /* Where the CUSTOMER takes delivery — 33 places, seeded from what the
               Dispatch team typed. Vendors have none, so the column is not shown
               on that tab rather than standing there as a row of dashes. */
            ...(tab === "customer"
              ? [{
                  header: "Delivery location",
                  render: (r: MasterParty) =>
                    r.location
                      ? <span className="text-grey">{r.location}</span>
                      /* Spelt out, not a dash: "Not set" is a value the filter can
                         select, which is how you find the ones still to fill in. */
                      : <span className="text-grey-2/70">Not set</span>,
                }]
              : []),
            { header: "GSTIN", render: (r) => <span className="text-[12px] text-grey">{r.gstin ?? "—"}</span> },
            sourceCol(),
            modulesCol(),
          ]}
          fields={[
            { key: "name", label: "Name", type: "text", required: true, readOnly: true,
              hint: "Comes from Tally. Rename it in Tally and the next sync brings it across." },
            { key: "gstin", label: "GSTIN", type: "text", readOnly: true },
            { key: "creditPeriod", label: "Credit period", type: "text", readOnly: true },
            /* Deliberately NOT readOnly, unlike the item form's company.
               updateMaster drops company_id on a source='tally' row and keeps it
               on a portal one, so an editable field here means "correctable
               exactly where it is ours" — and it is the only way to fill in the
               portal rows that were created before this field existed, every one
               of which is sitting on null. */
            { key: "companyId", label: "Company", type: "select", options: companyOptions,
              hint: "Which of our books this ledger lives in. Locked on a row that came from Tally." },
            { key: "code", label: "Code", type: "text", placeholder: "your own reference" },
            { key: "location", label: "Delivery location", type: "text",
              hint: "Where the CUSTOMER takes delivery — not one of our sites." },
            { key: "contactName", label: "Contact person", type: "text" },
            { key: "phone", label: "Phone", type: "text" },
            { key: "email", label: "Email", type: "text" },
            modulesField(),
            sortField,
          ]}
          /**
           * ⚠ A SEPARATE FORM FOR CREATING, and it is not a nicety.
           *
           *   The edit form locks Name and GSTIN because Tally owns them on a
           *   synced row and the next pull would overwrite anything typed here.
           *   That reasoning does not hold for a row being created: it has no
           *   Tally record behind it yet, so there is nothing to be overwritten
           *   BY. Without this the Add dialog opened with a greyed-out, required
           *   Name — a form that could not be filled in and could not be
           *   submitted, which is how "you can add a customer here" was true of
           *   the button and false of the screen.
           *
           *   A row created here is born source='portal'. If the same firm later
           *   turns up in Tally you get two rows, and Reconcile is what merges
           *   them — keeping this row's id, so orders are unaffected.
           */
          createFields={[
            { key: "name", label: "Name", type: "text", required: true,
              hint: "If this firm is already in Tally, prefer waiting for the sync — a name typed here becomes a second row until someone reconciles the two." },
            /**
             * ⚠ REQUIRED, AND IT IS A GATE — NOT A LABEL.
             *
             *   This form used to have no company at all, so every row typed
             *   here was born with company_id = null. That is not merely
             *   untidy: fms_dispatch_assert_customer_of_company returns EARLY
             *   when the customer's company is null, so a null-company customer
             *   passes the billing-company check unconditionally. All ten
             *   hand-added customers were in that state, carrying eight live
             *   orders between them — and it is how one row came to serve
             *   orders billed by two different books without complaint.
             *
             *   A firm we bill from two books is TWO rows, exactly as Tally
             *   holds it and as the "one row per Tally company" decision in
             *   CENTRAL-MASTERS.md records.
             */
            { key: "companyId", label: "Company", type: "select", required: true, options: companyOptions,
              hint: "Which of our books bills this customer. Bill the same firm from two books and it is two rows, one per book — that is how Tally holds it." },
            { key: "gstin", label: "GSTIN", type: "text" },
            { key: "code", label: "Code", type: "text", placeholder: "your own reference" },
            ...(tab === "customer"
              ? [{ key: "location", label: "Delivery location", type: "text" as const,
                   hint: "Where the CUSTOMER takes delivery — not one of our sites." }]
              : []),
            { key: "contactName", label: "Contact person", type: "text" },
            { key: "phone", label: "Phone", type: "text" },
            { key: "email", label: "Email", type: "text" },
            /* ⚠ See the note on the item form: an untick here is a row that
               saves and then appears nowhere. */
            { ...modulesField(), required: true,
              hint: `Tick where this should appear. Leave it empty and the ${tab} saves but shows up in NO module's dropdown — it will look like the save failed.` },
            sortField,
          ]}
          emptyValues={{
            name: "", companyId: "", gstin: "", creditPeriod: "", code: "", location: "",
            contactName: "", phone: "", email: "", modules: "", sortOrder: "0",
          }}
          toValues={(r) => ({
            name: r.name, companyId: r.companyId ?? "", gstin: r.gstin ?? "",
            creditPeriod: r.creditPeriod ?? "", code: r.code ?? "",
            location: r.location ?? "", contactName: r.contactName ?? "", phone: r.phone ?? "",
            email: r.email ?? "", modules: r.modules.join(","), sortOrder: String(r.sortOrder),
          })}
          onSubmit={submitFor("party", (v) => ({
            name: v.name.trim(), code: v.code.trim() || null,
            /* Sent on every save, kept only where it is ours: updateMaster drops
               Tally-owned columns when the row's source is 'tally', so this
               reaches the database on a portal row being created and is
               discarded on an edit to a synced one. */
            gstin: v.gstin.trim() || null,
            /* Same deal as gstin: updateMaster keeps it on a portal row and
               drops it on a synced one, so this both creates a portal row in
               the right book and fixes one that has no book yet. */
            company_id: v.companyId || null,
            // Uppercased, as the Dispatch master has always stored it.
            location: v.location.trim().toUpperCase() || null,
            contact_name: v.contactName.trim() || null, phone: v.phone.trim() || null,
            email: v.email.trim() || null, modules: csvToList(v.modules),
            is_customer: tab === "customer", is_vendor: tab === "vendor",
          }))}
          onToggleActive={toggle("party")}
        />
      )}

      {/* ------------------------------------------------------------ items -- */}
      {tab === "item" && (
        <MasterCrud<MasterItem>
          singular="Item"
          rows={onlyAddedHere(items.data ?? [])}
          canManage={mayManage("item")}
          searchText={(r) => `${r.name} ${r.code ?? ""} ${r.hsnCode ?? ""} ${itemTypeLabel(r.itemType)}`}
          columns={[
            { header: "Item", render: (r) => <span className="font-medium text-navy">{r.name}</span> },
            /* OURS, not Tally's — the same five buckets the Outstanding Dashboard
               splits revenue by. Seeded by a classifier, so it is shown early and
               filters, which is how a wrong guess gets found and corrected. */
            itemTypeCol<MasterItem>(),
            /* Items are managed per company, so this is the first thing anyone
               needs to see — and the filter under it is how you get from 14,000
               rows to one company's catalogue. */
            { header: "Company", render: (r) => (
              <span className="text-[12px] text-grey">
                {r.companyId ? companyLabel.get(r.companyId) ?? "—" : "—"}
              </span>
            ) },
            { header: "Group", render: (r) => (
              <span className="text-[12px] text-grey">
                {groupOptions.find((g) => g.value === r.groupId)?.label ?? "—"}
              </span>
            ) },
            { header: "Unit", render: (r) => (
              <span className="text-[12px] text-grey">
                {unitOptions.find((u) => u.value === r.unitId)?.label ?? "—"}
              </span>
            ) },
            sourceCol(),
            modulesCol(),
          ]}
          fields={[
            { key: "name", label: "Item name", type: "text", required: true, readOnly: true,
              hint: "Comes from Tally." },
            { key: "companyId", label: "Company", type: "select", options: companyOptions, readOnly: true,
              hint: "The Tally company this item belongs to. An item cannot move between companies." },
            { key: "groupId", label: "Item group", type: "select", options: groupOptions, readOnly: true },
            { key: "unitId", label: "Unit", type: "select", options: unitOptions, readOnly: true },
            { key: "itemType", label: "Item type", type: "select", options: ITEM_TYPES.map((t) => ({ value: t.value, label: t.label })),
              hint: "Ours, not Tally's. Filled in by a best-guess from the item name and its group — correct it here and the sync will never overwrite it." },
            { key: "code", label: "Code", type: "text" },
            { key: "hsnCode", label: "HSN code", type: "text" },
            modulesField(),
            sortField,
          ]}
          /**
           * Create-mode: everything Tally would own is EDITABLE here, because a
           * row being created has no Tally record behind it to be overwritten by.
           *
           * Company is required here because an item cannot move between Tally
           * companies: choose the wrong one at creation and it cannot be
           * corrected by editing, only deactivated and re-added.
           *
           * ⚠ This note used to add "company matters more on items than on
           *   parties", and that was the reasoning that left the customer form
           *   without a company field at all. It stopped being true at the
           *   Phase 1 cutover, which put a billing-company gate on parties —
           *   and because that gate waves through a null company, the omission
           *   turned into a hole rather than a gap. The customer form has the
           *   field now; do not reinstate the asymmetry.
           */
          createFields={[
            { key: "name", label: "Item name", type: "text", required: true,
              hint: "If Tally already stocks this item, prefer waiting for the sync — a name typed here becomes a second row until someone reconciles the two." },
            { key: "companyId", label: "Company", type: "select", required: true, options: companyOptions,
              hint: "An item cannot move between Tally companies later — this one is worth getting right now." },
            { key: "groupId", label: "Item group", type: "select", options: groupOptions },
            { key: "unitId", label: "Unit", type: "select", options: unitOptions,
              hint: "Read onto every order line. Leave it blank and the gate pass prints a quantity with no unit." },
            { key: "itemType", label: "Item type", type: "select",
              options: ITEM_TYPES.map((t) => ({ value: t.value, label: t.label })) },
            { key: "code", label: "Code", type: "text" },
            { key: "hsnCode", label: "HSN code", type: "text" },
            /* ⚠ TICK A MODULE OR THE ROW ARRIVES INVISIBLE. The default is an
               empty list, and every module's picker filters on it — so the save
               succeeds, the toast says saved, and the item never appears where
               it was wanted. That exact failure stranded a customer earlier
               today, so on the CREATE form it is said plainly. */
            { ...modulesField(), required: true,
              hint: "Tick where this should appear. Leave it empty and the item saves but shows up in NO module's dropdown — it will look like the save failed." },
            sortField,
          ]}
          emptyValues={{
            name: "", companyId: "", groupId: "", unitId: "", itemType: "", code: "", hsnCode: "", modules: "", sortOrder: "0",
          }}
          toValues={(r) => ({
            name: r.name, companyId: r.companyId ?? "", groupId: r.groupId ?? "", unitId: r.unitId ?? "",
            itemType: r.itemType ?? "", code: r.code ?? "", hsnCode: r.hsnCode ?? "", modules: r.modules.join(","),
            sortOrder: String(r.sortOrder),
          })}
          onSubmit={submitFor("item", (v) => ({
            name: v.name.trim(), code: v.code.trim() || null, hsn_code: v.hsnCode.trim() || null,
            company_id: v.companyId || null, group_id: v.groupId || null, unit_id: v.unitId || null,
            // "" from the picker means "not classified", which is a real state here.
            item_type: v.itemType || null,
            modules: csvToList(v.modules),
          }))}
          onToggleActive={toggle("item")}
        />
      )}

      {/* ------------------------------------------------- customer ↔ item -- */}
      {tab === "party_item" && (
        <MasterCrud<MasterPartyItem>
          singular="Customer item"
          rows={onlyAddedHere(partyItems.data ?? [])}
          canManage={mayManage("party_item")}
          /**
           * ADDING A PAIR BY HAND IS ALLOWED, and it used to be switched off here.
           *
           * The reasoning was that this master is evidence — built from the sales
           * register — so a hand-added row asserts a purchase that never happened.
           * True, and beside the point: this list is not a sales history, it is
           * the list of what a customer MAY be sold, and a first order for a new
           * item has to be possible before there is anything to record. Order to
           * Dispatch had 3,169 hand-typed pairs for exactly that reason, and
           * every one of them came across in the cutover.
           *
           * A hand-added row is source='portal' and carries no last-sold date or
           * sale count, so it stays distinguishable from one the register proved.
           */
          createFields={[
            { key: "partyId", label: "Customer", type: "select", required: true,
              options: customerPickOptions, placeholder: "Search customer…" },
            { key: "itemId", label: "Item", type: "select", required: true,
              options: itemPickOptions, placeholder: "Search item…",
              hint: "The customer may then be sold this item. Pick the row whose company matches the customer's." },
          ]}
          searchText={(r) => `${r.partyName} ${r.itemName} ${itemTypeLabel(r.itemType)}`}
          columns={[
            { header: "Customer", render: (r) => <span className="font-medium text-navy">{r.partyName}</span> },
            { header: "Item", render: (r) => <span className="text-navy">{r.itemName}</span> },
            /* The item's own type, read through the join — this is the field the
               modules will select on ("show me this customer's inks"), so it sits
               beside the item rather than at the end of the row. */
            itemTypeCol<MasterPartyItem>(),
            { header: "Item group", render: (r) => (
              <span className="text-[12px] text-grey">
                {r.itemGroupId ? groupOptions.find((g) => g.value === r.itemGroupId)?.label ?? "—" : "—"}
              </span>
            ) },
            { header: "Company", render: (r) => (
              <span className="text-[12px] text-grey">
                {r.companyId ? companyLabel.get(r.companyId) ?? "—" : "—"}
              </span>
            ) },
            /* Sorted as a real date, not as the rendered "14 Aug 2026" — the
               override the shared component exists for. */
            { header: "Last sold", className: "w-28",
              sortValue: (r) => r.lastSoldOn ?? "",
              render: (r) => (
                <span className="text-[12px] text-grey">
                  {r.lastSoldOn ? new Date(r.lastSoldOn).toLocaleDateString() : "—"}
                </span>
              ) },
            { header: "Sales", className: "w-20",
              sortValue: (r) => r.saleCount,
              // Every value is a distinct number; a dropdown of them would just
              // restate the column.
              filter: false,
              render: (r) => <span className="text-[12px] text-grey-2">{r.saleCount}</span> },
            /* Which pairs were typed here rather than proved by a sale. This tab
               had no Source column while adding was switched off — now that a
               pair can be added by hand, telling the two apart is the point. */
            sourceCol(),
          ]}
          fields={[
            { key: "partyName", label: "Customer", type: "text", readOnly: true },
            { key: "itemName", label: "Item", type: "text", readOnly: true },
            { key: "lastSoldOn", label: "Last sold", type: "text", readOnly: true },
            sortField,
          ]}
          emptyValues={{ partyName: "", itemName: "", lastSoldOn: "", sortOrder: "0" }}
          toValues={(r) => ({
            partyName: r.partyName, itemName: r.itemName,
            lastSoldOn: r.lastSoldOn ?? "", sortOrder: String(r.sortOrder),
          })}
          /**
           * Not `submitFor`, because create and edit send different things and a
           * shared patch-builder cannot tell them apart. On EDIT the two ids are
           * not in the value bag at all — sending them would write null over the
           * pair and destroy the row.
           */
          onSubmit={async (id, v, active) => {
            if (id) {
              await updateMaster("party_item", id, {
                active, sort_order: Number(v.sortOrder ?? 0) || 0,
              });
            } else {
              const partyId = (v.partyId ?? "").trim();
              const itemId = (v.itemId ?? "").trim();
              if (!partyId || !itemId) throw new Error("Pick both a customer and an item.");
              // UNIQUE(party_id, item_id) would catch this, but as a database
              // error nobody can act on. An inactive twin especially: the answer
              // there is to switch it back on, not to add a second one.
              const dup = (partyItems.data ?? []).find((r) => r.partyId === partyId && r.itemId === itemId);
              if (dup) {
                throw new Error(dup.active
                  ? `${dup.partyName} is already mapped to ${dup.itemName}.`
                  : `${dup.partyName} → ${dup.itemName} already exists but is switched off. Search for it and switch it back on rather than adding it again.`);
              }
              await insertMaster("party_item", {
                party_id: partyId, item_id: itemId,
                active, sort_order: Number(v.sortOrder ?? 0) || 0,
              });
            }
            await invalidate();
          }}
          onToggleActive={toggle("party_item")}
        />
      )}

      {/* ------------------------------------------------- groups and units -- */}
      {(tab === "item_group" || tab === "unit") && (
        <MasterCrud<MasterLookup>
          singular={tab === "item_group" ? "Item group" : "Unit"}
          rows={onlyAddedHere((tab === "item_group" ? groups.data : units.data) ?? [])}
          canManage={mayManage(tab === "item_group" ? "item_group" : "unit")}
          searchText={(r) => `${r.name} ${r.companyId ? companyLabel.get(r.companyId) ?? "" : ""}`}
          columns={[
            { header: "Name", render: (r) => <span className="font-medium text-navy">{r.name}</span> },
            /* Groups are per-company (units are not — a unit is the same measure
               everywhere), so only the groups tab carries this column. */
            ...(tab === "item_group"
              ? [{
                  header: "Company",
                  render: (r: MasterLookup) => (
                    <span className="text-[12px] text-grey">
                      {r.companyId ? companyLabel.get(r.companyId) ?? "—" : "—"}
                    </span>
                  ),
                }]
              : []),
            sourceCol(),
            /* THE LEFTOVERS. A group Tally has stopped reporting is never deleted
               by the sync — this is where you see it and decide. Filterable, so
               "Not in last sync" narrows to exactly those rows. */
            { header: "In Tally", render: (r) => <StaleCell row={r} /> },
          ]}
          fields={[
            { key: "name", label: "Name", type: "text", required: true },
            ...(tab === "item_group"
              ? [{
                  key: "companyId", label: "Company", type: "select" as const,
                  options: companyOptions, readOnly: true,
                  hint: "Which company's stock group this is. Comes from the items in it.",
                }]
              : []),
            sortField,
          ]}
          emptyValues={tab === "item_group"
            ? { name: "", companyId: "", sortOrder: "0" }
            : { name: "", sortOrder: "0" }}
          toValues={(r) => ({
            name: r.name,
            ...(tab === "item_group" ? { companyId: r.companyId ?? "" } : {}),
            sortOrder: String(r.sortOrder),
          })}
          onSubmit={submitFor(tab === "item_group" ? "item_group" : "unit", (v) => ({ name: v.name.trim() }))}
          onToggleActive={toggle(tab === "item_group" ? "item_group" : "unit")}
        />
      )}

      {/* -------------------------------------------------------- locations -- */}
      {tab === "location" && (
        <MasterCrud<MasterLocation>
          singular="Location"
          rows={onlyAddedHere(locations.data ?? [])}
          canManage={mayManage("location")}
          searchText={(r) => `${r.name} ${companyLabel.get(r.companyId) ?? ""}`}
          columns={[
            { header: "Location", render: (r) => <span className="font-medium text-navy">{r.name}</span> },
            { header: "Company", render: (r) => (
              <span className="text-[12px] text-grey">{companyLabel.get(r.companyId) ?? "—"}</span>
            ) },
            modulesCol(),
          ]}
          fields={[
            { key: "name", label: "Location name", type: "text", required: true, placeholder: "e.g. Unit 2" },
            { key: "companyId", label: "Company", type: "select", required: true, options: companyOptions },
            modulesField(),
            sortField,
          ]}
          emptyValues={{ name: "", companyId: "", modules: "", sortOrder: "0" }}
          toValues={(r) => ({
            name: r.name, companyId: r.companyId, modules: r.modules.join(","), sortOrder: String(r.sortOrder),
          })}
          onSubmit={submitFor("location", (v) => ({
            name: v.name.trim(), company_id: v.companyId, modules: csvToList(v.modules),
          }))}
          onToggleActive={toggle("location")}
        />
      )}
    </div>
  );
}
