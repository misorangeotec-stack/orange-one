import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Pagination from "@/shared/components/ui/Pagination";
import { usePagination } from "@/shared/lib/usePagination";
import { matchesSearch } from "@/shared/lib/search";
import { exportRowsToXlsx } from "@/shared/lib/exportXlsx";
import { parseXlsxRows } from "@/shared/lib/importXlsx";
import {
  companyDisplayName, itemTypeLabel, ITEM_TYPES,
  fetchMasterCompanies, fetchMasterItems, fetchMasterLookup,
  type ItemType, type MasterItem,
} from "@/core/platform/liveMasters";
import {
  applyBackup, buildBackup, markAllSeen, noteCentralIds, resetAllOverrides, resetOverride,
  saveMany, useMirrorStore, type EditableKey, type MirrorEdit,
} from "../lib/store";

/**
 * BUSHRA CENTRAL MASTER — Central Masters' items, mirrored, edited in the grid.
 *
 * ⚠ A SPREADSHEET, NOT A FORM PER ROW. The shared MasterCrud opens a dialog per
 *   item and saves on close, which is right for a master someone corrects twice a
 *   month and wrong for this one: the whole point here is to fill Type, Category,
 *   Ink type, Group, Colour, Code and Description down a column across many items
 *   and commit them together. So every cell is an input, edits collect as a draft,
 *   and ONE Save button writes them.
 *
 * ⚠ CENTRAL IS NEVER WRITTEN. Items are read live from `mst_items` on the same
 *   query keys the admin screen uses, so the PF-17 realtime signal brings new
 *   central items in here on its own. Everything typed here stays in this browser
 *   (lib/store.ts), and only the fields that DIFFER from central are stored — so
 *   central's later corrections to untouched fields keep flowing through.
 */

type Filter = "all" | "changed" | "new";

interface MirrorRow extends MasterItem {
  centralType: ItemType | null;
  centralCategory: string | null;
  centralInkType: string | null;
  centralGroupName: string | null;
  centralCode: string | null;
  groupName: string | null;
  color: string | null;
  description: string | null;
  isNew: boolean;
  isChanged: boolean;
}

/** The value bag one row edits through — the grid's columns and the Excel columns are both built off it. */
type Draft = Partial<Record<EditableKey, string>>;

const COLUMNS: { key: EditableKey | "item" | "company" | "unit" | "status" | "actions"; header: string; width: number }[] = [
  { key: "item", header: "Item", width: 300 },
  { key: "itemType", header: "Type", width: 150 },
  { key: "category", header: "Category", width: 180 },
  { key: "inkType", header: "Ink type", width: 160 },
  { key: "groupName", header: "Group", width: 180 },
  { key: "color", header: "Colour", width: 140 },
  { key: "code", header: "Code", width: 130 },
  { key: "description", header: "Description", width: 260 },
  { key: "company", header: "Company", width: 150 },
  { key: "unit", header: "Unit", width: 80 },
  { key: "status", header: "Status", width: 110 },
  { key: "actions", header: "", width: 70 },
];

const EDIT_KEYS: EditableKey[] = ["itemType", "category", "inkType", "groupName", "color", "code", "description"];
const FIELD_LABEL: Record<EditableKey, string> = {
  itemType: "Type", category: "Category", inkType: "Ink type", groupName: "Group",
  color: "Colour", code: "Code", description: "Description",
};

const WIDTH_KEY = "bushra-central-master:colwidths:v1";
const opts = { staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false } as const;

const isCssColor = (v: string) =>
  typeof CSS !== "undefined" && !!v.trim() && CSS.supports("color", v.replace(/\s+/g, ""));

const cellClass =
  "w-full rounded border bg-transparent px-1.5 py-1 text-[12.5px] text-ink outline-none " +
  "focus:border-orange focus:bg-white focus:ring-2 focus:ring-orange/10";

export default function ItemMaster() {
  const { overrides, seen } = useMirrorStore();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [companyFilter, setCompanyFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [note, setNote] = useState<string | null>(null);
  /** Unsaved cell edits, by item id. The grid reads these over the stored values. */
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState(false);
  const backupRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);

  // ---- column widths, dragged on the header and remembered ------------------
  const [widths, setWidths] = useState<Record<string, number>>(() => {
    try {
      return { ...Object.fromEntries(COLUMNS.map((c) => [c.key, c.width])), ...JSON.parse(localStorage.getItem(WIDTH_KEY) ?? "{}") };
    } catch {
      return Object.fromEntries(COLUMNS.map((c) => [c.key, c.width]));
    }
  });
  const drag = useRef<{ key: string; startX: number; startW: number } | null>(null);

  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = drag.current;
      if (!d) return;
      // 60px floor: narrower than this and the header text has nowhere to go.
      const next = Math.max(60, d.startW + e.clientX - d.startX);
      setWidths((w) => (w[d.key] === next ? w : { ...w, [d.key]: next }));
    };
    const up = () => {
      if (!drag.current) return;
      drag.current = null;
      document.body.style.cursor = "";
      setWidths((w) => {
        try { localStorage.setItem(WIDTH_KEY, JSON.stringify(w)); } catch { /* storage blocked */ }
        return w;
      });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, []);

  const startResize = (key: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    drag.current = { key, startX: e.clientX, startW: widths[key] ?? 140 };
    document.body.style.cursor = "col-resize";
  };

  const resetWidths = () => {
    const base = Object.fromEntries(COLUMNS.map((c) => [c.key, c.width]));
    setWidths(base);
    try { localStorage.setItem(WIDTH_KEY, JSON.stringify(base)); } catch { /* storage blocked */ }
  };

  // ---- data -----------------------------------------------------------------
  const items = useQuery({ queryKey: ["masters", "items"], queryFn: fetchMasterItems, ...opts });
  const companies = useQuery({ queryKey: ["masters", "companies"], queryFn: fetchMasterCompanies, ...opts });
  const groups = useQuery({ queryKey: ["masters", "item_groups"], queryFn: () => fetchMasterLookup("mst_item_groups"), ...opts });
  const units = useQuery({ queryKey: ["masters", "units"], queryFn: () => fetchMasterLookup("mst_units"), ...opts });

  const centralIds = useMemo(() => (items.data ?? []).map((i) => i.id), [items.data]);
  useEffect(() => { if (centralIds.length) noteCentralIds(centralIds); }, [centralIds]);

  const companyLabel = useMemo(
    () => new Map((companies.data ?? []).map((c) => [c.id, companyDisplayName(c)])),
    [companies.data],
  );
  const groupName = useMemo(() => new Map((groups.data ?? []).map((g) => [g.id, g.name])), [groups.data]);
  const unitName = useMemo(() => new Map((units.data ?? []).map((u) => [u.id, u.name])), [units.data]);
  const centralGroupOf = useCallback(
    (item: MasterItem) => (item.groupId ? groupName.get(item.groupId) ?? null : null),
    [groupName],
  );

  const rows = useMemo((): MirrorRow[] => (items.data ?? []).map((item) => {
    const o = overrides[item.id] ?? {};
    const centralGroupName = centralGroupOf(item);
    const has = (k: EditableKey) => Object.prototype.hasOwnProperty.call(o, k);
    return {
      ...item,
      centralType: item.itemType,
      centralCategory: item.category,
      centralInkType: item.inkType,
      centralGroupName,
      centralCode: item.code,
      itemType: has("itemType") ? (o.itemType ?? null) : item.itemType,
      category: has("category") ? (o.category ?? null) : item.category,
      inkType: has("inkType") ? (o.inkType ?? null) : item.inkType,
      groupName: has("groupName") ? (o.groupName ?? null) : centralGroupName,
      code: has("code") ? (o.code ?? null) : item.code,
      color: o.color ?? null,
      description: o.description ?? null,
      active: o.active ?? item.active,
      isNew: !!seen && !seen.has(item.id),
      isChanged: !!overrides[item.id],
    };
  }), [items.data, overrides, seen, centralGroupOf]);

  /** What a cell shows: the unsaved draft if there is one, else what is stored. */
  const stored = (row: MirrorRow, key: EditableKey): string => {
    switch (key) {
      case "itemType": return row.itemType ?? "";
      case "category": return row.category ?? "";
      case "inkType": return row.inkType ?? "";
      case "groupName": return row.groupName ?? "";
      case "color": return row.color ?? "";
      case "code": return row.code ?? "";
      case "description": return row.description ?? "";
    }
  };
  const valueOf = (row: MirrorRow, key: EditableKey): string => drafts[row.id]?.[key] ?? stored(row, key);
  const isDirty = (row: MirrorRow, key: EditableKey) => {
    const d = drafts[row.id]?.[key];
    return d !== undefined && d !== stored(row, key);
  };

  const setCell = (row: MirrorRow, key: EditableKey, value: string) =>
    setDrafts((cur) => {
      const next = { ...(cur[row.id] ?? {}), [key]: value };
      // A cell typed back to what is stored is not an edit; drop it, and drop the
      // row once nothing is left, so the Save count never counts a no-op.
      if (value === stored(row, key)) delete next[key];
      if (Object.keys(next).length === 0) {
        const { [row.id]: _gone, ...rest } = cur;
        return rest;
      }
      return { ...cur, [row.id]: next };
    });

  // ---- filtering ------------------------------------------------------------
  const filtered = useMemo(() => {
    let out = rows;
    if (filter === "changed") out = out.filter((r) => r.isChanged);
    if (filter === "new") out = out.filter((r) => r.isNew);
    if (companyFilter) out = out.filter((r) => r.companyId === companyFilter);
    if (typeFilter) out = out.filter((r) => (r.itemType ?? "") === (typeFilter === "__none" ? "" : typeFilter));
    if (q.trim()) {
      out = out.filter((r) => matchesSearch(q, `${r.name} ${r.code ?? ""} ${itemTypeLabel(r.itemType)} ${r.category ?? ""} ${r.inkType ?? ""} ${r.groupName ?? ""} ${r.color ?? ""} ${r.description ?? ""}`));
    }
    return out;
  }, [rows, filter, companyFilter, typeFilter, q]);

  const pg = usePagination(filtered, { resetKey: `${q}|${filter}|${companyFilter}|${typeFilter}` });

  const changedCount = useMemo(() => rows.filter((r) => r.isChanged).length, [rows]);
  const newCount = useMemo(() => rows.filter((r) => r.isNew).length, [rows]);
  const dirtyCount = Object.keys(drafts).length;

  // ---- suggestions for the free-text cells ----------------------------------
  const inUse = (pick: (r: MirrorRow) => string | null) =>
    [...new Set(rows.map(pick).filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b));
  const suggestions: Record<string, string[]> = useMemo(() => ({
    category: inUse((r) => r.category),
    inkType: inUse((r) => r.inkType),
    groupName: [...new Set([...(groups.data ?? []).map((g) => g.name), ...inUse((r) => r.groupName)])].sort((a, b) => a.localeCompare(b)),
    color: inUse((r) => r.color),
    description: inUse((r) => r.description),
  }), [rows, groups.data]);

  // ---- save / discard -------------------------------------------------------
  const byId = useMemo(() => new Map((items.data ?? []).map((i) => [i.id, i])), [items.data]);

  const save = () => {
    if (dirtyCount === 0) return;
    setSaving(true);
    const edits: MirrorEdit[] = [];
    for (const [id, values] of Object.entries(drafts)) {
      const item = byId.get(id);
      if (item) edits.push({ item, centralGroupName: centralGroupOf(item), values });
    }
    const n = saveMany(edits);
    setDrafts({});
    setSaving(false);
    setNote(`Saved your changes on ${n} item${n === 1 ? "" : "s"}.`);
  };

  /** ⚠ Unsaved edits live in React state only — a reload would lose them silently. */
  useEffect(() => {
    if (dirtyCount === 0) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirtyCount]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const resetRow = (row: MirrorRow) => {
    setDrafts((cur) => { const { [row.id]: _gone, ...rest } = cur; return rest; });
    resetOverride(row.id);
  };

  // ---- Excel + backup -------------------------------------------------------
  const doExport = () => {
    exportRowsToXlsx({
      fileName: "Bushra_Central_Master",
      sheetName: "Items",
      title: "Bushra Central Master — items",
      columns: [
        { header: "ID", width: 24, value: (r: MirrorRow) => r.id },
        { header: "Item", width: 40, value: (r: MirrorRow) => r.name },
        { header: "Company", value: (r: MirrorRow) => (r.companyId ? companyLabel.get(r.companyId) ?? "" : "") },
        { header: "Type", value: (r: MirrorRow) => itemTypeLabel(r.itemType) },
        { header: "Category", value: (r: MirrorRow) => r.category ?? "" },
        { header: "Ink type", value: (r: MirrorRow) => r.inkType ?? "" },
        { header: "Group", value: (r: MirrorRow) => r.groupName ?? "" },
        { header: "Colour", value: (r: MirrorRow) => r.color ?? "" },
        { header: "Code", value: (r: MirrorRow) => r.code ?? "" },
        { header: "Description", width: 40, value: (r: MirrorRow) => r.description ?? "" },
      ],
      rows: filtered,
      filters: [
        ...(q.trim() ? [`Search: "${q.trim()}"`] : []),
        ...(filter === "changed" ? ["Only items I changed"] : filter === "new" ? ["Only new from central"] : []),
        ...(companyFilter ? [`Company: ${companyLabel.get(companyFilter) ?? ""}`] : []),
        ...(typeFilter ? [`Type: ${typeFilter === "__none" ? "Not set" : itemTypeLabel(typeFilter as ItemType)}`] : []),
      ],
      notes: [
        "Keep the ID column untouched — it is what matches a row back to the item.",
        "Fill in Type, Category, Ink type, Group, Colour, Code or Description and import this file back.",
        "Type must be one of the names the Type dropdown offers. Everything else is free text.",
        "Rows with no ID, or an ID this master does not hold, are skipped. Central Masters is never changed.",
      ],
    });
  };

  const doImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const records = await parseXlsxRows(file);
      const rowById = new Map(rows.map((r) => [r.id, r]));
      const edits: MirrorEdit[] = [];
      let skipped = 0;
      const bad: string[] = [];

      for (const rec of records) {
        const id = String(rec["ID"] ?? "").trim();
        const row = id ? rowById.get(id) : undefined;
        const item = row ? byId.get(id) : undefined;
        if (!row || !item) { skipped++; continue; }

        const values: Draft = {};
        const cell = (header: string) => String(rec[header] ?? "").trim();
        const take = (key: EditableKey, header: string) => {
          if (!Object.prototype.hasOwnProperty.call(rec, header)) return; // column absent — never clears
          const v = cell(header);
          if (v !== stored(row, key)) values[key] = v;
        };
        if (Object.prototype.hasOwnProperty.call(rec, "Type")) {
          const v = cell("Type");
          const match = ITEM_TYPES.find((t) => t.label.toLowerCase() === v.toLowerCase() || t.value === v);
          if (v && !match) bad.push(`${row.name}: "${v}" is not a Type`);
          else if ((match?.value ?? "") !== stored(row, "itemType")) values.itemType = match?.value ?? "";
        }
        take("category", "Category");
        take("inkType", "Ink type");
        take("groupName", "Group");
        take("color", "Colour");
        take("code", "Code");
        take("description", "Description");

        if (Object.keys(values).length) edits.push({ item, centralGroupName: centralGroupOf(item), values });
      }

      const n = saveMany(edits);
      setNote(
        `Imported ${n} item${n === 1 ? "" : "s"}.`
        + (skipped ? ` ${skipped} row${skipped === 1 ? "" : "s"} skipped (no matching ID).` : "")
        + (bad.length ? ` ${bad.length} rejected — ${bad.slice(0, 3).join("; ")}${bad.length > 3 ? "…" : ""}` : ""),
      );
    } catch (err) {
      setNote(`Import failed: ${(err as Error).message}`);
    }
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

  const loading = [items, companies, groups, units].some((query) => query.isFetching);
  const error = [items, companies, groups, units].find((query) => query.error)?.error as Error | undefined;

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

  /** One editable cell. Free-text everywhere except Type, which is a fixed vocabulary. */
  const editor = (row: MirrorRow, key: EditableKey) => {
    const dirty = isDirty(row, key);
    const mine = row.isChanged && stored(row, key) !== (
      key === "itemType" ? (row.centralType ?? "")
      : key === "category" ? (row.centralCategory ?? "")
      : key === "inkType" ? (row.centralInkType ?? "")
      : key === "groupName" ? (row.centralGroupName ?? "")
      : key === "code" ? (row.centralCode ?? "")
      : ""
    );
    const border = dirty ? "border-orange bg-orange/5" : mine ? "border-transparent text-orange font-semibold" : "border-transparent hover:border-line";

    if (key === "itemType") {
      return (
        <select
          value={valueOf(row, key)}
          onChange={(e) => setCell(row, key, e.target.value)}
          className={`${cellClass} ${border} cursor-pointer`}
        >
          <option value="">Not set</option>
          {ITEM_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      );
    }

    const v = valueOf(row, key);
    return (
      <div className="flex items-center gap-1.5">
        {key === "color" && isCssColor(v) && (
          <span className="h-3 w-3 shrink-0 rounded-full border border-line" style={{ background: v.replace(/\s+/g, "") }} />
        )}
        <input
          value={v}
          list={suggestions[key] ? `bcm-${key}` : undefined}
          onChange={(e) => setCell(row, key, e.target.value)}
          placeholder="—"
          className={`${cellClass} ${border}`}
        />
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Suggestion lists, once for the whole grid rather than per cell. */}
      {Object.entries(suggestions).map(([key, values]) => (
        <datalist key={key} id={`bcm-${key}`}>
          {values.map((s) => <option key={s} value={s} />)}
        </datalist>
      ))}

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[17px] font-semibold text-navy">Bushra Central Master</h1>
            <p className="mt-1 max-w-3xl text-[13px] text-grey">
              Your own copy of the items in Central Masters. Type straight into the grid — Type, Category,
              Ink type, Group, Colour, Code and Description are all yours to fill in — then press
              <strong> Save</strong> once for everything you changed. Central Masters is never changed by
              anything you do here, and any new item added there turns up in this list on its own.
            </p>
            <p className="mt-1 text-[11.5px] text-grey-2">
              Saved in this browser only. Values you have changed show in orange. Drag a column edge to resize it.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {dirtyCount > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setDrafts({})}>Discard {dirtyCount}</Button>
            )}
            <Button size="sm" onClick={save} disabled={dirtyCount === 0 || saving}>
              {saving ? "Saving…" : dirtyCount > 0 ? `Save ${dirtyCount} change${dirtyCount === 1 ? "" : "s"}` : "Save"}
            </Button>
          </div>
        </div>
        {note && <p className="mt-3 rounded bg-page px-3 py-2 text-[12.5px] text-navy">{note}</p>}
        {error && <p className="mt-3 rounded bg-orange/10 px-3 py-2 text-[12.5px] text-orange">{error.message}</p>}
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search item, code, category…"
            className="w-full rounded-xl border border-line bg-white px-3 py-2.5 text-[14px] text-ink placeholder:text-grey-2 outline-none focus:border-orange focus:ring-4 focus:ring-orange/10"
          />
        </div>
        <select
          value={companyFilter}
          onChange={(e) => setCompanyFilter(e.target.value)}
          className="rounded-xl border border-line bg-white px-3 py-2.5 text-[13px] text-navy outline-none focus:border-orange"
        >
          <option value="">All companies</option>
          {(companies.data ?? []).map((c) => <option key={c.id} value={c.id}>{companyDisplayName(c)}</option>)}
        </select>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-xl border border-line bg-white px-3 py-2.5 text-[13px] text-navy outline-none focus:border-orange"
        >
          <option value="">All types</option>
          <option value="__none">Not set</option>
          {ITEM_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        {chip("changed", `Changed by me ${changedCount}`)}
        {chip("new", `New from central ${newCount}`)}
        <Button variant="ghost" size="sm" onClick={doExport}>Export</Button>
        <input ref={importRef} type="file" accept=".xlsx" className="hidden" onChange={doImport} />
        <Button variant="ghost" size="sm" onClick={() => importRef.current?.click()}>Import</Button>
        <input ref={backupRef} type="file" accept=".json,application/json" className="hidden" onChange={restoreBackup} />
        <Button variant="ghost" size="sm" onClick={downloadBackup}>Backup</Button>
        <Button variant="ghost" size="sm" onClick={() => backupRef.current?.click()}>Restore</Button>
      </div>

      <div className="flex flex-wrap items-center gap-3 px-1 text-[12px] text-grey-2">
        {newCount > 0 && (
          <button onClick={() => markAllSeen(centralIds)} className="hover:text-orange hover:underline">Mark all as seen</button>
        )}
        <button onClick={resetWidths} className="hover:text-orange hover:underline">Reset column widths</button>
        {changedCount > 0 && (
          <button
            onClick={() => {
              if (window.confirm(`Undo your changes on all ${changedCount} items and go back to Central's values?`)) {
                resetAllOverrides();
                setDrafts({});
                setNote("All items are back to Central's values.");
              }
            }}
            className="hover:text-orange hover:underline"
          >
            Reset all to central
          </button>
        )}
        {loading && <span>Loading…</span>}
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="text-[13px]" style={{ tableLayout: "fixed", width: COLUMNS.reduce((n, c) => n + (widths[c.key] ?? c.width), 0) }}>
            <colgroup>
              {COLUMNS.map((c) => <col key={c.key} style={{ width: widths[c.key] ?? c.width }} />)}
            </colgroup>
            <thead>
              <tr className="border-b border-line text-left text-grey-2">
                {COLUMNS.map((c) => (
                  <th key={c.key} className="relative px-3 py-2.5 font-medium whitespace-nowrap">
                    {c.header}
                    {/* The drag handle. Sits on the column's right edge and never
                        moves the header text, so a mis-grab does nothing. */}
                    <span
                      onMouseDown={startResize(c.key)}
                      className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-orange/40"
                      title="Drag to resize"
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pg.pageItems.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-4 py-10 text-center text-[13px] text-grey-2">
                    {rows.length === 0 ? "Loading the central master…" : "No item matches these filters."}
                  </td>
                </tr>
              )}
              {pg.pageItems.map((row) => (
                <tr key={row.id} className={`border-b border-line/70 last:border-0 ${row.active ? "" : "bg-page/60"}`}>
                  <td className="px-3 py-1.5 align-middle">
                    <div className="truncate font-medium text-navy" title={row.name}>{row.name}</div>
                    {row.isNew && (
                      <span className="rounded bg-[#DCFCE7] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[#166534]">New</span>
                    )}
                  </td>
                  {EDIT_KEYS.map((key) => (
                    <td key={key} className="px-1.5 py-1 align-middle">{editor(row, key)}</td>
                  ))}
                  <td className="truncate px-3 py-1.5 text-[12px] text-grey">
                    {row.companyId ? companyLabel.get(row.companyId) ?? "—" : "—"}
                  </td>
                  <td className="truncate px-3 py-1.5 text-[12px] text-grey">
                    {row.unitId ? unitName.get(row.unitId) ?? "—" : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-[12px]">
                    {drafts[row.id]
                      ? <span className="text-orange">Unsaved</span>
                      : row.isChanged
                        ? <span className="text-orange" title={Object.keys(overrides[row.id] ?? {}).filter((k): k is EditableKey => k in FIELD_LABEL).map((k) => FIELD_LABEL[k]).join(", ")}>Changed</span>
                        : <span className="text-grey-2">Same as central</span>}
                  </td>
                  <td className="px-3 py-1.5 text-[12px]">
                    {(row.isChanged || drafts[row.id]) ? (
                      <button onClick={() => resetRow(row)} className="font-semibold text-grey hover:text-orange">Reset</button>
                    ) : <span className="text-grey-2/50">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination state={pg} rowsLabel="items" />
      </Card>

      {dirtyCount > 0 && (
        /* The grid is 25 rows tall and the Save button is at the top, so an edit
           made at the bottom would otherwise have no visible way to commit it. */
        <div className="sticky bottom-4 flex justify-center">
          <div className="flex items-center gap-3 rounded-full border border-orange/30 bg-white px-4 py-2 shadow-lg">
            <span className="text-[12.5px] text-navy">
              {dirtyCount} item{dirtyCount === 1 ? "" : "s"} edited, not saved
            </span>
            <Button size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
            <button onClick={() => setDrafts({})} className="text-[12.5px] text-grey hover:text-orange">Discard</button>
          </div>
        </div>
      )}
    </div>
  );
}
