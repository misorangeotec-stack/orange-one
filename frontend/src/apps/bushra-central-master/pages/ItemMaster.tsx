import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import MasterCrud, { type MasterColumn, type MasterFieldDef } from "@/shared/components/ui/MasterCrud";
import { TextInput } from "@/shared/components/ui/Form";
import {
  companyDisplayName, itemTypeLabel, ITEM_TYPES,
  fetchMasterCompanies, fetchMasterItems, fetchMasterLookup,
  type ItemType, type MasterItem,
} from "@/core/platform/liveMasters";
import {
  applyBackup, buildBackup, markAllSeen, noteCentralIds, resetAllOverrides, resetOverride,
  saveOverride, useMirrorStore, type EditableKey,
} from "../lib/store";

/**
 * BUSHRA CENTRAL MASTER — Central Masters' Items, mirrored, with my own
 * Type / Category / Ink type / Group / Colour on top.
 *
 * Reads the live central master through the SAME query keys as /admin/masters,
 * so a new central item turns up here on its own. Writes only to this browser —
 * see lib/store.ts for why, and for the "store only what differs" rule.
 */

type Filter = "all" | "changed" | "new";

interface MirrorRow extends MasterItem {
  centralType: ItemType | null;
  centralCategory: string | null;
  centralInkType: string | null;
  centralGroupName: string | null;
  groupName: string | null;
  color: string | null;
  note: string | null;
  changed: EditableKey[];
  isNew: boolean;
}

const FIELD_LABEL: Record<EditableKey, string> = {
  itemType: "Type", category: "Category", inkType: "Ink type", groupName: "Group", color: "Colour", note: "Note",
};

const opts = { staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false } as const;

/** A text box that suggests values already in use but accepts a new one — so a fresh category or colour needs no master. */
const suggestField = (key: string, label: string, suggestions: string[], hint: string): MasterFieldDef => ({
  key,
  label,
  type: "custom",
  hint,
  render: (value, onChange) => (
    <>
      <TextInput list={`bcm-${key}`} value={value} onChange={(e) => onChange(e.target.value)} placeholder="Not set" />
      <datalist id={`bcm-${key}`}>
        {suggestions.map((s) => <option key={s} value={s} />)}
      </datalist>
    </>
  ),
});

const isCssColor = (v: string) => typeof CSS !== "undefined" && CSS.supports("color", v.replace(/\s+/g, ""));

/** Mine, marked when it differs from central, with central's value on hover. */
const MineCell = ({ value, changed, central }: { value: string | null; changed: boolean; central: string | null }) => (
  <span
    className={`text-[12px] ${changed ? "font-semibold text-orange" : value ? "text-grey" : "text-grey-2/70"}`}
    title={changed ? `Central: ${central || "Not set"}` : undefined}
  >
    {value || "Not set"}
  </span>
);

const textCol = (
  header: string,
  key: EditableKey,
  mine: (r: MirrorRow) => string | null,
  central: (r: MirrorRow) => string | null,
  width: string,
): MasterColumn<MirrorRow> => ({
  header,
  className: width,
  render: (r) => <MineCell value={mine(r)} changed={r.changed.includes(key)} central={central(r)} />,
  sortValue: (r) => mine(r) ?? "",
  filter: { get: (r) => mine(r) || "Not set" },
});

export default function BushraCentralMaster() {
  const { overrides, seen } = useMirrorStore();
  const [filter, setFilter] = useState<Filter>("all");
  const [note, setNote] = useState<string | null>(null);
  const backupRef = useRef<HTMLInputElement>(null);

  // Same keys as Central Masters — the PF-17 realtime signal invalidates ["masters"].
  const items = useQuery({ queryKey: ["masters", "items"], queryFn: fetchMasterItems, ...opts });
  const companies = useQuery({ queryKey: ["masters", "companies"], queryFn: fetchMasterCompanies, ...opts });
  const groups = useQuery({ queryKey: ["masters", "item_groups"], queryFn: () => fetchMasterLookup("mst_item_groups"), ...opts });
  const units = useQuery({ queryKey: ["masters", "units"], queryFn: () => fetchMasterLookup("mst_units"), ...opts });

  const centralIds = useMemo(() => (items.data ?? []).map((i) => i.id), [items.data]);
  useEffect(() => {
    if (centralIds.length) noteCentralIds(centralIds);
  }, [centralIds]);

  const companyLabel = useMemo(
    () => new Map((companies.data ?? []).map((c) => [c.id, companyDisplayName(c)])),
    [companies.data],
  );
  const groupName = useMemo(() => new Map((groups.data ?? []).map((g) => [g.id, g.name])), [groups.data]);
  const unitName = useMemo(() => new Map((units.data ?? []).map((u) => [u.id, u.name])), [units.data]);

  const rows = useMemo((): MirrorRow[] => (items.data ?? []).map((item) => {
    const o = overrides[item.id] ?? {};
    const centralGroupName = item.groupId ? groupName.get(item.groupId) ?? null : null;
    const has = (k: EditableKey) => Object.prototype.hasOwnProperty.call(o, k);
    return {
      ...item,
      centralType: item.itemType,
      centralCategory: item.category,
      centralInkType: item.inkType,
      centralGroupName,
      itemType: has("itemType") ? (o.itemType ?? null) : item.itemType,
      category: has("category") ? (o.category ?? null) : item.category,
      inkType: has("inkType") ? (o.inkType ?? null) : item.inkType,
      groupName: has("groupName") ? (o.groupName ?? null) : centralGroupName,
      color: o.color ?? null,
      note: o.note ?? null,
      active: o.active ?? item.active,
      changed: (["itemType", "category", "inkType", "groupName"] as EditableKey[]).filter(has),
      isNew: !!seen && !seen.has(item.id),
    };
  }), [items.data, overrides, seen, groupName]);

  const changedCount = useMemo(() => rows.filter((r) => overrides[r.id]).length, [rows, overrides]);
  const newCount = useMemo(() => rows.filter((r) => r.isNew).length, [rows]);
  const shown = useMemo(
    () => filter === "changed" ? rows.filter((r) => overrides[r.id])
      : filter === "new" ? rows.filter((r) => r.isNew)
      : rows,
    [rows, filter, overrides],
  );

  const inUse = (pick: (r: MirrorRow) => string | null) =>
    [...new Set(rows.map(pick).filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b));
  const categories = useMemo(() => inUse((r) => r.category), [rows]);
  const inkTypes = useMemo(() => inUse((r) => r.inkType), [rows]);
  const groupNames = useMemo(
    () => [...new Set([...(groups.data ?? []).map((g) => g.name), ...inUse((r) => r.groupName)])].sort((a, b) => a.localeCompare(b)),
    [rows, groups.data],
  );
  const colors = useMemo(() => inUse((r) => r.color), [rows]);
  const companyOptions = useMemo(
    () => (companies.data ?? []).map((c) => ({ value: c.id, label: companyDisplayName(c) })),
    [companies.data],
  );

  const byId = useMemo(() => new Map((items.data ?? []).map((i) => [i.id, i])), [items.data]);
  const centralGroupOf = (item: MasterItem) => (item.groupId ? groupName.get(item.groupId) ?? null : null);

  const onSubmit = async (id: string | null, v: Record<string, string>, active: boolean) => {
    const item = id ? byId.get(id) : undefined;
    // New items belong in Central Masters; this mirror only re-labels what central holds.
    if (!item) throw new Error("Add new items in Central Masters — they appear here automatically.");
    saveOverride(item, centralGroupOf(item), {
      itemType: v.itemType, category: v.category, inkType: v.inkType,
      groupName: v.groupName, color: v.color, note: v.note,
    }, active);
  };

  const onToggleActive = async (row: MirrorRow, active: boolean) => {
    const item = byId.get(row.id);
    if (!item) return;
    saveOverride(item, centralGroupOf(item), {
      itemType: row.itemType ?? "", category: row.category ?? "", inkType: row.inkType ?? "",
      groupName: row.groupName ?? "", color: row.color ?? "", note: row.note ?? "",
    }, active);
  };

  const downloadBackup = () => {
    const blob = new Blob([buildBackup()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `bushra-central-master-backup ${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const restoreBackup = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const n = applyBackup(await file.text());
      setNote(`Restored your changes on ${n} item${n === 1 ? "" : "s"}.`);
    } catch (err) {
      setNote(`Restore failed: ${(err as Error).message}`);
    }
  };

  const loading = [items, companies, groups, units].some((q) => q.isFetching);
  const error = [items, companies, groups, units].find((q) => q.error)?.error as Error | undefined;

  const chip = (value: Filter, label: string) => (
    <button
      onClick={() => setFilter((f) => (f === value ? "all" : value))}
      aria-pressed={filter === value}
      className={
        "rounded-full border px-3 py-1 text-[12.5px] font-medium transition " +
        (filter === value ? "border-orange bg-orange/10 text-orange" : "border-line text-grey hover:border-orange hover:text-orange")
      }
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[17px] font-semibold text-navy">Bushra Central Master</h1>
            <p className="mt-1 max-w-2xl text-[13px] text-grey">
              A live mirror of the items in <Link to="/admin/masters" className="text-orange hover:underline">Central Masters</Link>.
              Every new central item appears here by itself. Change Type, Category, Ink type, Group or Colour
              as you like — your changes stay in this master only and never touch Central. Values you changed
              show in <span className="font-semibold text-orange">orange</span>; hover to see central's value.
            </p>
            <p className="mt-1 text-[11.5px] text-grey-2">
              Saved in this browser. Use Export / Import (Excel) or the backup file to move it to another browser.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={downloadBackup}>Download backup</Button>
            <input ref={backupRef} type="file" accept=".json,application/json" className="hidden" onChange={restoreBackup} />
            <Button size="sm" variant="ghost" onClick={() => backupRef.current?.click()}>Restore backup</Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={changedCount === 0}
              onClick={() => {
                if (window.confirm(`Undo your changes on all ${changedCount} items and go back to Central's values?`)) {
                  resetAllOverrides();
                  setNote("All items are back to Central's values.");
                }
              }}
            >
              Reset all to central
            </Button>
          </div>
        </div>
        {note && <p className="mt-3 rounded bg-page px-3 py-2 text-[12.5px] text-navy">{note}</p>}
        {error && <p className="mt-3 rounded bg-orange/10 px-3 py-2 text-[12.5px] text-orange">{error.message}</p>}
      </Card>

      <div className="flex flex-wrap items-center gap-2 px-1">
        {chip("changed", `Changed by me ${changedCount}`)}
        {chip("new", `New from central ${newCount}`)}
        {newCount > 0 && (
          <button onClick={() => markAllSeen(centralIds)} className="text-[12px] text-grey-2 hover:text-orange hover:underline">
            Mark all as seen
          </button>
        )}
        {loading && <span className="text-[12.5px] text-grey-2">Loading…</span>}
      </div>

      <MasterCrud<MirrorRow>
        singular="Item"
        rows={shown}
        canManage
        canCreate={false}
        createHint="New items come from Central Masters automatically."
        statusNote="Deactivating here hides the item in your master only. Central is unaffected."
        searchText={(r) => `${r.name} ${r.code ?? ""} ${itemTypeLabel(r.itemType)} ${r.category ?? ""} ${r.inkType ?? ""} ${r.groupName ?? ""} ${r.color ?? ""} ${r.note ?? ""}`}
        columns={[
          {
            header: "Item",
            render: (r) => (
              <span className="font-medium text-navy">
                {r.name}
                {r.isNew && <span className="ml-2 rounded bg-[#DCFCE7] px-1.5 py-0.5 text-[10.5px] font-semibold uppercase text-[#166534]">New</span>}
              </span>
            ),
            sortValue: (r) => r.name,
            filter: false,
          },
          textCol("Type", "itemType", (r) => itemTypeLabel(r.itemType) || null, (r) => itemTypeLabel(r.centralType) || null, "w-32"),
          textCol("Category", "category", (r) => r.category, (r) => r.centralCategory, "w-44"),
          textCol("Ink type", "inkType", (r) => r.inkType, (r) => r.centralInkType, "w-40"),
          textCol("Group", "groupName", (r) => r.groupName, (r) => r.centralGroupName, "w-44"),
          {
            header: "Colour",
            className: "w-32",
            render: (r) => r.color ? (
              <span className="inline-flex items-center gap-1.5 text-[12px] text-grey">
                {isCssColor(r.color) && <span className="h-3 w-3 rounded-full border border-line" style={{ background: r.color.replace(/\s+/g, "") }} />}
                {r.color}
              </span>
            ) : <span className="text-[12px] text-grey-2/70">Not set</span>,
            sortValue: (r) => r.color ?? "",
            filter: { get: (r) => r.color || "Not set" },
          },
          { header: "Company", render: (r) => <span className="text-[12px] text-grey">{r.companyId ? companyLabel.get(r.companyId) ?? "—" : "—"}</span> },
          { header: "Unit", render: (r) => <span className="text-[12px] text-grey">{r.unitId ? unitName.get(r.unitId) ?? "—" : "—"}</span> },
          { header: "Code", render: (r) => <span className="text-[12px] text-grey">{r.code ?? "—"}</span> },
          {
            header: "Mine vs central",
            className: "w-40",
            render: (r) => overrides[r.id]
              ? <span className="text-[12px] text-orange">Changed: {[...r.changed, ...(r.color ? ["color" as const] : []), ...(r.note ? ["note" as const] : [])].map((k) => FIELD_LABEL[k]).join(", ") || "Status"}</span>
              : <span className="text-[12px] text-grey-2">Same as central</span>,
            sortValue: (r) => (overrides[r.id] ? 0 : 1),
            filter: { get: (r) => (overrides[r.id] ? "Changed by me" : "Same as central") },
          },
          {
            header: "Reset",
            className: "w-20",
            render: (r) => overrides[r.id]
              ? <button onClick={() => resetOverride(r.id)} className="text-[12px] font-semibold text-grey hover:text-orange">Reset</button>
              : <span className="text-[12px] text-grey-2/50">—</span>,
            filter: false,
          },
        ]}
        fields={[
          { key: "name", label: "Item name", type: "text", readOnly: true, hint: "From Central Masters." },
          { key: "companyId", label: "Company", type: "select", options: companyOptions, readOnly: true },
          { key: "itemType", label: "Type", type: "select", options: ITEM_TYPES.map((t) => ({ value: t.value, label: t.label })),
            hint: "Your type for this item. Pick the same as central to follow central again." },
          suggestField("category", "Category", categories, "Pick one in use or type a new one."),
          suggestField("inkType", "Ink type", inkTypes, "Inks only — leave blank on anything else."),
          suggestField("groupName", "Group", groupNames, "Tally's group by default. Type your own grouping if you prefer."),
          suggestField("color", "Colour", colors, "Any name — BLACK, CYAN, MAGENTA… A recognised colour shows a swatch."),
          { key: "note", label: "Note", type: "textarea" },
        ]}
        emptyValues={{ name: "", companyId: "", itemType: "", category: "", inkType: "", groupName: "", color: "", note: "" }}
        toValues={(r) => ({
          name: r.name, companyId: r.companyId ?? "",
          itemType: r.itemType ?? "", category: r.category ?? "", inkType: r.inkType ?? "",
          groupName: r.groupName ?? "", color: r.color ?? "", note: r.note ?? "",
        })}
        onSubmit={onSubmit}
        onToggleActive={onToggleActive}
      />
    </div>
  );
}
