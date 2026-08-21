import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Tabs from "@/shared/components/ui/Tabs";
import MultiSelect from "@/shared/components/ui/MultiSelect";
import MasterCrud, { type MasterColumn, type MasterFieldDef } from "@/shared/components/ui/MasterCrud";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { useSession } from "@/core/platform/session";
import { useDirectory } from "@/core/platform/store";
import { APPS } from "@/apps/appInfo";
import {
  companyDisplayName, itemTypeLabel, ITEM_TYPES,
  fetchMasterCompanies, fetchMasterItems, fetchMasterLocations, fetchMasterLookup,
  fetchMasterParties, fetchMasterPartyItems, fetchMasterSyncRuns,
  type ItemType,
  type MasterCompany, type MasterItem, type MasterLocation,
  type MasterLookup, type MasterParty, type MasterPartyItem,
} from "@/core/platform/liveMasters";
import {
  deleteCompanyLink, fetchMyMasterManagerTypes, insertMaster, insertMasters, runMastersSync,
  setMasterActive, updateMaster,
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
  // Immediately after Companies, because a dispatch location is read as their
  // child: the two are set up together, and a site with no company attached is
  // offered on no order at all.
  { value: "location", label: "Dispatch Locations" },
  { value: "customer", label: "Customers" },
  { value: "vendor", label: "Vendors" },
  { value: "item", label: "Items" },
  { value: "party_item", label: "Customer Items" },
  // ⚠ NO "Customer Companies" / "Item Companies" TABS, and that was a real
  //   correction rather than a tidy-up. They were built as lists to maintain by
  //   hand, which defeated the point of the whole operation: Tally ALREADY
  //   holds this. A firm has a separate ledger in every book it trades with,
  //   and a stock item exists in every book that stocks it — that IS the
  //   company mapping. mst_refresh_party_companies() and its item twin derive
  //   it, so it belongs as a COLUMN on the master it describes, not as a
  //   second list somebody has to keep in step.
  { value: "item_group", label: "Item Groups" },
  { value: "unit", label: "Units" },
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

/**
 * Which of our companies dispatch from a site. Plural, and required in spirit
 * though not enforced: a site nobody dispatches from is not an error — it is a
 * shed we have not started using — but it can be offered on no order, so the
 * hint says so rather than letting it look like a save that failed.
 */
const companiesField = (options: ComboOption[]): MasterFieldDef => ({
  key: "companyIds",
  label: "Dispatched by",
  type: "custom",
  hint: "Leave empty and the site exists but appears on no order form. A site is a place — tick every company that dispatches from it.",
  render: (value, onChange) => (
    <MultiSelect
      values={csvToList(value)}
      onChange={(ids) => onChange(ids.join(","))}
      options={options}
      placeholder="No company"
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
 * The thirteen types, colour-coded so a mis-sorted row is spotted while
 * scrolling rather than only when someone reads the label. Families share a
 * hue — the three inks are orange, the two consumable-stock types green — so
 * the eye sorts them before it reads them.
 *
 * ⚠ EVERY KEY IN ITEM_TYPES NEEDS A LINE HERE. There is no switch on ItemType
 *   anywhere in the codebase, so `tsc` will not tell you one is missing; the
 *   badge just renders grey and nobody notices for a month.
 *
 * "Not set" is shown, not a dash: 55 items are named by neither the sheet nor
 * the old classifier, and guessing "Others" for them would claim knowledge we
 * do not have. It is a filterable value, so it doubles as the review queue.
 */
const ITEM_TYPE_STYLE: Record<string, string> = {
  ink: "bg-orange/10 text-orange",
  provision_ink: "bg-orange/10 text-orange/80",
  other_ink: "bg-orange/10 text-orange/80",
  spare_parts: "bg-navy/10 text-navy",
  head: "bg-[#F3E8FF] text-[#7C3AED]",
  machine: "bg-[#E0F2FE] text-[#0369A1]",
  paper: "bg-[#FEF3C7] text-[#92400E]",
  raw_material: "bg-[#DCFCE7] text-[#166534]",
  packing_material: "bg-[#DCFCE7] text-[#15803D]",
  cartage: "bg-[#FFE4E6] text-[#9F1239]",
  software: "bg-[#E0E7FF] text-[#3730A3]",
  service_expense: "bg-[#FFE4E6] text-[#9F1239]",
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

/**
 * Category and Ink type render plain text, so MasterCrud reads the sort key and
 * the filter values straight off the cell — no overrides needed, unlike the
 * badge above.
 *
 * "Not set" rather than a dash, for the same reason it is on Type: 1,047 items
 * have no category and 12,594 no ink type, and both of those are lists someone
 * may want to pull up. A dash cannot be filtered on.
 */
const textCol = <T,>(header: string, get: (row: T) => string | null, width: string): MasterColumn<T> => ({
  header,
  render: (r) => {
    const v = get(r);
    return v
      ? <span className="text-[12px] text-grey">{v}</span>
      : <span className="text-[12px] text-grey-2/70">Not set</span>;
  },
  className: width,
});

export default function Masters() {
  const { isAdmin, user } = useSession();
  const qc = useQueryClient();
  /**
   * Names for the "Mapped by" column. Blank rather than "Unknown" for an id the
   * directory cannot resolve — the column's whole reading is "blank means no
   * person did this", and inventing a placeholder would make a machine-derived
   * row and a departed employee's row look the same.
   */
  const { profiles } = useDirectory();
  const personName = useMemo(() => {
    const byId = new Map(profiles.map((p) => [p.id, p.name]));
    return (id: string | null) => (id ? byId.get(id) ?? "" : "");
  }, [profiles]);
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
  }, [tab, companies.data, parties.data, items.data, groups.data, units.data, locations.data,
      partyItems.data]);

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
  const companyNames = (ids: string[]) =>
    ids.map((id) => companyLabel.get(id) ?? "—").sort().join(", ");

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
   * Category and Ink type have no master table — they are text the Inventory
   * Mapping sheet brought in. So the pickers are built from the values the items
   * ACTUALLY carry, the way the three lists above are built from their masters.
   *
   * ⚠ THIS IS WHAT KEEPS THE EXCEL ROUND TRIP WORKING, not a nicety. The
   *   importer rejects a dropdown cell that is not in `options`
   *   (shared/lib/masterCrudIo.ts) — so the option list has to be a superset of
   *   what is stored, and deriving it from the rows guarantees that by
   *   construction. It also means a category new to the business arrives by
   *   loading a revised sheet, not by someone typing into a spreadsheet cell.
   */
  const valuesInUse = (pick: (r: MasterItem) => string | null) =>
    [...new Set((items.data ?? []).map(pick).filter((v): v is string => !!v))]
      .sort((a, b) => a.localeCompare(b))
      .map((v) => ({ value: v, label: v }));

  const categoryOptions = useMemo(() => valuesInUse((r) => r.category), [items.data]);
  const inkTypeOptions = useMemo(() => valuesInUse((r) => r.inkType), [items.data]);

  /**
   * The Customer Items ADD form: company, then customer, then every item at once.
   *
   * ⚠ THE COMPANY IS A FILTER, NOT A COLUMN. No company is stored on the pair —
   *   `mst_party_items` joins a party to an item and nothing else. It is here
   *   because both lists are per-company in Tally: the same firm has a separate
   *   ledger in every book it trades with, and the same stock item exists in
   *   every book that stocks it. So "ANUPAM" is four rows and "100ml Beaker
   *   Glass" is several, and picking between identical names is a coin toss.
   *   Choose the company first and each list collapses to that book's own rows,
   *   which is the only reading under which the two halves belong together.
   *
   *   It stays OPTIONAL. Nine customers sit in no company book at all (the open
   *   reconcile decisions, plus two internal Noida entities) and a required
   *   company would make them unmappable by hand — the one case where a hand
   *   mapping is most needed.
   *
   * Inactive rows are left out throughout: mapping a customer to an item nobody
   * may order makes a pair that cannot be used and reads as a bug when it fails
   * later. Items the customer ALREADY has are left out too — offering them would
   * only earn a unique-violation on save.
   */
  const partyItemCreateFields = useMemo((): MasterFieldDef[] => {
    const customers = (parties.data ?? []).filter((p) => p.isCustomer && p.active);
    const sellables = (items.data ?? []).filter((i) => i.active);
    /** Blank company means "no filter" — see the note above. */
    const inCompany = <T extends { companyId: string | null }>(rows: T[], companyId: string): T[] =>
      companyId ? rows.filter((r) => r.companyId === companyId) : rows;

    return [
      {
        key: "companyId",
        label: "Company",
        type: "custom",
        hint: "Narrows both lists below to that company's own customers and items. Leave blank to search all of them.",
        render: (value, onChange, _values, setField) => (
          <Combobox
            value={value}
            /* Changing the company invalidates what the other two hold, so it
               empties them. Keeping a customer the list no longer shows would
               submit a pair the form has stopped displaying. */
            onChange={(id) => { onChange(id); setField("partyId", ""); setField("itemIds", ""); }}
            options={companyOptions}
            placeholder="All companies"
            searchable
            clearable
          />
        ),
      },
      {
        key: "partyId",
        label: "Customer",
        type: "custom",
        required: true,
        render: (value, onChange, values, setField) => (
          <Combobox
            value={value}
            /* A different customer has a different set of items already mapped,
               so the selection below cannot survive the change. */
            onChange={(id) => { onChange(id); setField("itemIds", ""); }}
            options={inCompany(customers, values.companyId ?? "").map((p) => ({
              value: p.id,
              label: p.name,
              sublabel: p.companyId ? companyLabel.get(p.companyId) : undefined,
            }))}
            placeholder="Search customer…"
            searchable
          />
        ),
      },
      {
        key: "itemIds",
        label: "Items",
        type: "custom",
        required: true,
        hint: "Pick as many as you like — each becomes one mapping. Items this customer already has are not listed.",
        render: (value, onChange, values) => {
          const partyId = values.partyId ?? "";
          const companyId = values.companyId ?? "";
          const taken = new Set(
            (partyItems.data ?? []).filter((r) => r.partyId === partyId).map((r) => r.itemId),
          );
          const options = inCompany(sellables, companyId)
            .filter((i) => !taken.has(i.id))
            .map((i) => ({
              value: i.id,
              label: i.name,
              /* Only when the list spans books — inside one company the heading
                 would be the same word above every row. */
              group: companyId ? undefined : (i.companyId ? companyLabel.get(i.companyId) : "No company"),
            }))
            // Grouped lists render in option order, so the books must not interleave.
            .sort((a, b) => (a.group ?? "").localeCompare(b.group ?? "") || a.label.localeCompare(b.label));
          return (
            <MultiSelect
              values={csvToList(value)}
              onChange={(ids) => onChange(ids.join(","))}
              options={options}
              placeholder={partyId ? "Select items…" : "Pick a customer first"}
              disabled={!partyId}
              searchable
              chips
            />
          );
        },
      },
    ];
  }, [parties.data, items.data, partyItems.data, companyOptions, companyLabel]);

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
  // Every query, so the spinner and the error banner cover every tab. A query
  // left out of these two lists shows an empty table instead of "loading" and
  // swallows its own failure.
  const allQueries = [companies, parties, items, groups, units, locations,
                      partyItems];
  const loading = allQueries.some((q) => q.isFetching);
  const error = allQueries.find((q) => q.error)?.error as Error | undefined;

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
        <div className="flex flex-wrap items-center gap-2 px-1">
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
            /* Tally's filing, one value, rewritten every sync — renamed so it is
               not read as "who bills them", which is the column beside it. */
            { header: "In Tally's books", render: (r) => (
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
          searchText={(r) => `${r.name} ${r.code ?? ""} ${r.hsnCode ?? ""} ${itemTypeLabel(r.itemType)} ${r.category ?? ""} ${r.inkType ?? ""}`}
          columns={[
            { header: "Item", render: (r) => <span className="font-medium text-navy">{r.name}</span> },
            /* OURS, not Tally's. Typed by hand in the Inventory Mapping sheet —
               these three columns come in together and are read together, so
               they sit together, before Tally's own filing. */
            itemTypeCol<MasterItem>(),
            textCol<MasterItem>("Category", (r) => r.category, "w-44"),
            textCol<MasterItem>("Ink type", (r) => r.inkType, "w-44"),
            /* Items are managed per company, so this is the first thing anyone
               needs to see — and the filter under it is how you get from 14,000
               rows to one company's catalogue.

               ⚠ ONE BOOK, and it is Tally's filing rather than who sells it. The
                 Phase 1 reconcile put 209 of Dispatch's 234 items under O-tec
                 while Enterprise sells them too. "Sold by", beside it, is the
                 one an order form may narrow on. */
            { header: "In Tally's books", render: (r) => (
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
              hint: "Ours, not Tally's. Loaded from the Inventory Mapping sheet — correct it here and neither the sync nor a re-load of the same sheet will overwrite it." },
            { key: "category", label: "Category", type: "select", options: categoryOptions,
              hint: "Between the type and Tally's group — MACHINERY PARTS, PAPER ROLL, K24. The list is the values already in use; a new one arrives with the next sheet." },
            { key: "inkType", label: "Ink type", type: "select", options: inkTypeOptions,
              hint: "The ink product family. Only inks carry one — leave it blank on anything else." },
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
            { key: "category", label: "Category", type: "select", options: categoryOptions },
            { key: "inkType", label: "Ink type", type: "select", options: inkTypeOptions,
              hint: "Inks only." },
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
            name: "", companyId: "", groupId: "", unitId: "", itemType: "", category: "", inkType: "",
            code: "", hsnCode: "", modules: "", sortOrder: "0",
          }}
          toValues={(r) => ({
            name: r.name, companyId: r.companyId ?? "", groupId: r.groupId ?? "", unitId: r.unitId ?? "",
            itemType: r.itemType ?? "", category: r.category ?? "", inkType: r.inkType ?? "",
            code: r.code ?? "", hsnCode: r.hsnCode ?? "", modules: r.modules.join(","),
            sortOrder: String(r.sortOrder),
          })}
          onSubmit={submitFor("item", (v) => ({
            name: v.name.trim(), code: v.code.trim() || null, hsn_code: v.hsnCode.trim() || null,
            company_id: v.companyId || null, group_id: v.groupId || null, unit_id: v.unitId || null,
            // "" from the picker means "not classified", which is a real state
            // here — for all three of these, and for the same reason.
            item_type: v.itemType || null,
            category: v.category || null,
            ink_type: v.inkType || null,
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
           * Dispatch carried 3,169 hand-typed pairs for exactly that reason, and
           * every one of them came across in the cutover.
           *
           * A hand-added row is source='portal' with no last-sold date and a sale
           * count of zero, so it stays distinguishable from one the register
           * proved — which is what the Source column and the Added-here chip read.
           */
          createFields={partyItemCreateFields}
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
            /*
              WHO MAPPED IT, AND WHEN — the answer to "show me the mappings people
              made themselves" (OD-9).

              ⚠ NOT the Source column beside it, and the difference matters.
                masters-sync rewrites `source` to 'sales_register' on any pair the
                customer actually buys, so a mapping made by hand quietly stops
                looking hand-made the moment it starts working. `created_by`
                survives that upsert, and the sync runs on the service key where
                auth.uid() is null — so a blank here means a machine derived it
                and a name means a person chose it. Filter this column to a person
                and you have exactly the manual mappings.
            */
            { header: "Mapped by", className: "w-36",
              sortValue: (r) => personName(r.mappedById),
              filter: { get: (r) => personName(r.mappedById) || "From Tally" },
              render: (r) => (
                <span className="text-[12px] text-grey">{personName(r.mappedById) || "—"}</span>
              ) },
            { header: "Mapped on", className: "w-28",
              // Sorted as a real date, not as the rendered "14 Aug 2026".
              sortValue: (r) => r.mappedOn ?? "",
              render: (r) => (
                <span className="text-[12px] text-grey-2">
                  {r.mappedOn ? new Date(r.mappedOn).toLocaleDateString() : "—"}
                </span>
              ) },
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
              const itemIds = csvToList(v.itemIds ?? "");
              if (!partyId || itemIds.length === 0) throw new Error("Pick a customer and at least one item.");
              /**
               * UNIQUE(party_id, item_id) would catch a repeat, but as a database
               * error nobody can act on. An INACTIVE twin especially: the answer
               * there is to switch it back on, not to add a second one — and the
               * picker cannot warn about it, because it lists what is missing and
               * a switched-off pair is not missing.
               */
              const clashes = (partyItems.data ?? []).filter(
                (r) => r.partyId === partyId && itemIds.includes(r.itemId),
              );
              if (clashes.length > 0) {
                const names = clashes.map((r) => r.itemName).join(", ");
                throw new Error(clashes.every((r) => !r.active)
                  ? `${clashes[0].partyName} already has ${names}, switched off. Search for the row and switch it back on rather than adding it again.`
                  : `${clashes[0].partyName} already has ${names}.`);
              }
              await insertMasters("party_item", itemIds.map((itemId) => ({
                party_id: partyId, item_id: itemId,
                active, sort_order: Number(v.sortOrder ?? 0) || 0,
              })));
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

      {/* ------------------------------------------------ dispatch locations -- */}
      {/*
        A SITE IS A PLACE, AND SEVERAL COMPANIES DISPATCH FROM IT.

        This tab used to be one row per (company, site) with a single Company
        column, mirroring how Order to Dispatch stored it: NOIDA twice,
        SURAT-HOJIWALA twice, SURAT-SACHIN twice. The duplication carried no
        information — every step's owners were identical across both copies —
        and it meant a new company added three more rows to retype, which is the
        opposite of what a shared master is for. So the site is the row, and
        "Dispatched by" is a list.
      */}
      {tab === "location" && (
        <MasterCrud<MasterLocation>
          singular="Dispatch location"
          rows={onlyAddedHere(locations.data ?? [])}
          canManage={mayManage("location")}
          searchText={(r) => `${r.name} ${companyNames(r.companyIds)} ${r.gatePassSuffix ?? ""}`}
          columns={[
            { header: "Location", render: (r) => <span className="font-medium text-navy">{r.name}</span> },
            {
              header: "Gate pass suffix",
              render: (r) =>
                r.gatePassSuffix
                  ? <span className="font-medium text-navy">{r.gatePassSuffix}</span>
                  : <span className="text-grey">main series</span>,
              // The cell renders a component in the empty case, which nodeText
              // cannot walk — so both are declared rather than derived.
              sortValue: (r) => r.gatePassSuffix ?? "",
              filter: { get: (r) => r.gatePassSuffix ?? "main series" },
            },
            {
              header: "Dispatched by",
              render: (r) => (
                <span className="text-[12px] text-grey">
                  {r.companyIds.length === 0
                    ? <span className="text-orange">no company yet</span>
                    : companyNames(r.companyIds)}
                </span>
              ),
              // The cell renders a component when the list is empty, and nodeText
              // cannot walk that — so both are declared rather than derived.
              sortValue: (r) => companyNames(r.companyIds),
              filter: { get: (r) => (r.companyIds.length ? r.companyIds.map((id) => companyLabel.get(id) ?? "") : ["no company yet"]) },
            },
            modulesCol(),
          ]}
          fields={[
            { key: "name", label: "Location name", type: "text", required: true, placeholder: "e.g. Unit 2" },
            companiesField(companyOptions),
            /*
              Splits this site's gate pass series off from the main one — 'N' on
              Noida gives OTEC-N-2608-001 beside Surat's OTEC-2608-001. Blank
              means the main series, which is why Surat is blank rather than
              carrying an 'S'. Letters and digits only: the database rejects a
              hyphen, because 'OTEC-N' as a company prefix and 'OTEC' + 'N' would
              otherwise compose to the same counter.
            */
            { key: "gatePassSuffix", label: "Gate pass suffix", type: "text", placeholder: "e.g. N — blank for the main series" },
            modulesField(),
            sortField,
          ]}
          emptyValues={{ name: "", companyIds: "", gatePassSuffix: "", modules: "", sortOrder: "0" }}
          toValues={(r) => ({
            name: r.name, companyIds: r.companyIds.join(","),
            gatePassSuffix: r.gatePassSuffix ?? "",
            modules: r.modules.join(","), sortOrder: String(r.sortOrder),
          })}
          /**
           * Two tables, one form. The site is a row in mst_locations; who
           * dispatches from it is rows in mst_company_locations, reconciled as a
           * diff so an untouched pair keeps its id — and with it any history
           * hanging off that pair.
           */
          onSubmit={async (id, v, active) => {
            const want = csvToList(v.companyIds);
            const patch = {
              name: v.name.trim(), modules: csvToList(v.modules),
              // Upper-cased on the way in because the uniqueness index and the
              // allocator both normalise: 'n' and 'N' must not become two series.
              gate_pass_suffix: v.gatePassSuffix.trim().toUpperCase() || null,
              active, sort_order: Number(v.sortOrder ?? 0) || 0,
            };
            const locId = id
              ? (await updateMaster("location", id, patch), id)
              : await insertMaster("location", patch);

            const had = id ? (locations.data ?? []).find((l) => l.id === id)?.companyIds ?? [] : [];
            await Promise.all([
              ...want.filter((c) => !had.includes(c)).map((c) =>
                insertMaster("company_location", { location_id: locId, company_id: c })),
              ...had.filter((c) => !want.includes(c)).map((c) =>
                deleteCompanyLink("mst_company_locations", { location_id: locId, company_id: c })),
            ]);
            await invalidate();
          }}
          onToggleActive={toggle("location")}
        />
      )}

    </div>
  );
}
