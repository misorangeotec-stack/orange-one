import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { saveAs } from "file-saver";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import MultiSelect from "@/shared/components/ui/MultiSelect";
import Pagination from "@/shared/components/ui/Pagination";
import { usePagination } from "@/shared/lib/usePagination";
import { matchesSearch } from "@/shared/lib/search";
import { exportRowsToXlsx } from "@/shared/lib/exportXlsx";
import { parseXlsxRows } from "@/shared/lib/importXlsx";
import { filterOptionLabel, filterValueOf, sortFilterOptions } from "@/shared/lib/blankFilter";
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import { useSession } from "@/core/platform/session";
import {
  companyDisplayName, itemTypeLabel, ITEM_TYPES,
  fetchMasterCompanies, fetchMasterItems, fetchMasterLookup,
  type ItemType, type MasterItem,
} from "@/core/platform/liveMasters";
import { appName } from "../../appInfo";
import { fetchClosingStock, fmtClosingQty, stockKey } from "../lib/closingStock";
import { colourFromDescription } from "../lib/itemColour";
import {
  adoptLocalOverrides, APP_ID, buildBackup, centralValue, hasLocalOverrides, loadDrafts, markAllSeen,
  noteCentralIds, OVERRIDES_KEY, parseBackup, replaceAllOverrides, resetAllOverrides, resetOverride,
  saveDrafts, saveMany, useOverrides, useSeen,
  type DraftMap, type EditableKey, type MirrorEdit,
} from "../lib/store";

/**
 * BUSHRA CENTRAL MASTER — Central Masters' items, mirrored, edited in the grid.
 *
 * ⚠ A SPREADSHEET, NOT A FORM PER ROW. The shared MasterCrud opens a dialog per
 *   item and saves on close, which is right for a master someone corrects twice a
 *   month and wrong for this one: the whole point here is to fill Type, Category,
 *   Ink type, Group, Colour, Code and Description down a column across many items
 *   and commit them together. So every cell is an input, edits collect as a draft,
 *   and ONE Save button writes them. Drafts are kept in the browser too, so leaving
 *   the page — by the sidebar, the breadcrumb or a reload — does not lose them.
 *
 * ⚠ IT IS STILL A GRID, so it follows the house rules: every column sorts, every
 *   column but Item (search covers it) has a searchable filter underneath, the
 *   filter lists cascade, and a filter that matches nothing keeps the table
 *   standing with a Clear filters button. The table stays hand-built, not QueueTable,
 *   for one reason: its columns are resized by dragging, which QueueTable cannot do.
 *
 * ⚠ CENTRAL IS NEVER WRITTEN. Items are read live from `mst_items` on the same
 *   query keys the admin screen uses, so the PF-17 realtime signal brings new
 *   central items in here on its own. Only the fields that DIFFER from central are
 *   stored — so central's later corrections to untouched fields keep flowing through.
 *
 * ⚠ THE SAVED VALUES ARE THE TEAM'S, SHARED — asked for on 24-09-2026, replacing the
 *   browser-only store this app shipped with. They live in
 *   `bushra_central_master_overrides`; everyone granted the module reads them, and
 *   only an 'edit' grant may change them (RLS enforces it, `canEdit` mirrors it).
 *   A save therefore replaces what EVERYONE sees, and two people on one cell resolve
 *   last-save-wins — which is why every destructive control here says whose data it
 *   is before it acts. Unsaved drafts and the "New from central" flags stay on this
 *   browser, per person: they are about one reader, not about the item (lib/store.ts).
 *
 * ⚠ DESCRIPTION AND COLOUR ARE FILLED IN FROM TALLY, not left blank. Central Masters
 *   carries neither column (MS-1), and the pair sat empty on every row — 5,500 cells
 *   each, to be typed by hand, when Tally's own item name already held both answers.
 *   The description IS that name, and the colour is the shade named in it (788 of
 *   4,744 names carry one; lib/itemColour.ts). They are DEFAULTS in the same sense
 *   Central's Type or Code is: shown until typed over, stored only once they differ,
 *   and reset back by the row's Reset. Nothing is written to Tally.
 *
 * ⚠ ONLY ITEMS HOLDING CLOSING STOCK ARE LISTED — asked for on 23-09-2026, and the
 *   one place this mirror is NOT a copy of Central Masters. Central carries every item
 *   a book has ever filed (14,242 of them); this screen is for the ones Tally is
 *   actually holding today (5,511), so the other two thirds are not rows to scroll
 *   past. The balance comes from lib/closingStock.ts and is Tally's own figure.
 *   An item that sells out drops off this list by itself, and comes back when it is
 *   next received — nothing typed against it is lost either way, because the overrides
 *   are keyed on the item id and simply wait (lib/store.ts).
 */

const APP_NAME = appName("bushra-central-master");

type Filter = "all" | "changed" | "new";

interface MirrorRow extends MasterItem {
  centralType: ItemType | null;
  centralCategory: string | null;
  centralInkType: string | null;
  centralGroupName: string | null;
  centralCode: string | null;
  centralColor: string | null;
  centralDescription: string | null;
  groupName: string | null;
  color: string | null;
  description: string | null;
  /** Tally's closing balance. Null ONLY while closing stock could not be read at all. */
  closingQty: number | null;
  isNew: boolean;
  isChanged: boolean;
}

type ColKey = EditableKey | "item" | "company" | "unit" | "stock" | "status" | "actions";

const COLUMNS: { key: ColKey; header: string; width: number }[] = [
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
  { key: "stock", header: "Closing stock", width: 120 },
  { key: "status", header: "Status", width: 130 },
  { key: "actions", header: "", width: 70 },
];
/**
 * Item names are unique, so their dropdown would only restate the table; search covers it.
 * Closing stock is left out for the same reason and not a different one — it is a
 * quantity, near-unique across 5,500 rows, so its filter would be a list of 5,500
 * numbers. Its sort (numeric, see `sorted`) is what reads that column.
 *
 * DESCRIPTION JOINED THEM once it began defaulting to the item's own name: its list
 * would be the Item list a second time. Colour is exactly why the rule is per-column
 * and not a guess — two dozen shades across 5,500 rows is the most useful filter here.
 */
const FILTER_KEYS: ColKey[] = COLUMNS.map((c) => c.key)
  .filter((k) => k !== "item" && k !== "actions" && k !== "stock" && k !== "description");
const HEADER: Record<string, string> = Object.fromEntries(COLUMNS.map((c) => [c.key, c.header]));

const EDIT_KEYS: EditableKey[] = ["itemType", "category", "inkType", "groupName", "color", "code", "description"];
const FIELD_LABEL: Record<EditableKey, string> = {
  itemType: "Type", category: "Category", inkType: "Ink type", groupName: "Group",
  color: "Colour", code: "Code", description: "Description",
};
/**
 * Which row field holds the value a column starts at — Central's for the mirrored
 * columns, and Tally's for the two Central does not carry: Description is the item's
 * own name, Colour is read out of it (lib/itemColour.ts). Every column has one now,
 * so "Changed" and Reset mean the same thing in all seven.
 */
const CENTRAL_FIELD: Record<EditableKey, keyof MirrorRow> = {
  itemType: "centralType", category: "centralCategory", inkType: "centralInkType",
  groupName: "centralGroupName", code: "centralCode",
  color: "centralColor", description: "centralDescription",
};
/**
 * The Excel round trip. Each mirrored column travels with a "Central …" twin that
 * records what Central Masters said WHEN THE FILE WAS MADE. On import, a value left
 * equal to its twin means "I did not change this" — it follows Central as it stands
 * today — rather than pinning a value Central may have corrected since.
 */
const EXCEL: { key: EditableKey; header: string; centralHeader?: string }[] = [
  { key: "itemType", header: "Type", centralHeader: "Central Type" },
  { key: "category", header: "Category", centralHeader: "Central Category" },
  { key: "inkType", header: "Ink type", centralHeader: "Central Ink type" },
  { key: "groupName", header: "Group", centralHeader: "Central Group" },
  // Colour and Description travel with a twin like the rest: theirs records what TALLY
  // said when the file was made, so a value left equal to it keeps following Tally
  // rather than pinning today's name onto an item that may be renamed tomorrow.
  { key: "color", header: "Colour", centralHeader: "Tally Colour" },
  { key: "code", header: "Code", centralHeader: "Central Code" },
  { key: "description", header: "Description", centralHeader: "Tally Description" },
];

const WIDTH_KEY = "bushra-central-master:colwidths:v1";
const opts = { staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false } as const;
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

const typeValueOf = (v: string): ItemType | "" | null => {
  if (!v) return "";
  return ITEM_TYPES.find((t) => t.label.toLowerCase() === v.toLowerCase() || t.value === v)?.value ?? null;
};

const isCssColor = (v: unknown) =>
  typeof v === "string" && typeof CSS !== "undefined" && !!v.trim() && CSS.supports("color", v.replace(/\s+/g, ""));

const cellClass =
  "w-full rounded border bg-transparent px-1.5 py-1 text-[12.5px] text-ink outline-none " +
  "focus:border-orange focus:bg-white focus:ring-2 focus:ring-orange/10";
const filterClass =
  "h-8 w-full min-w-0 rounded-lg border border-line bg-white px-2 text-[12px] text-ink placeholder:text-grey-2/60 " +
  "focus:outline-none focus:ring-2 focus:ring-orange/25 focus:border-orange/50";

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

export default function ItemMaster() {
  const { user, canEditModule } = useSession();
  /**
   * May this person change anything? The client-side twin of the RLS rule on
   * `bushra_central_master_overrides` — a view-only reader sees the team's values in
   * full and is simply not offered the controls that would fail at the database.
   */
  const canEdit = canEditModule(APP_ID);
  const qc = useQueryClient();
  /** The TEAM's saved values, shared by everyone. A refetch is what picks up their edits. */
  const overridesQ = useOverrides();
  const overrides = useMemo(() => overridesQ.data ?? {}, [overridesQ.data]);
  const seen = useSeen(user.id);
  const refreshOverrides = useCallback(() => qc.invalidateQueries({ queryKey: OVERRIDES_KEY }), [qc]);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [colFilters, setColFilters] = useState<Record<string, string[]>>({});
  const [sort, setSort] = useState<{ key: ColKey; dir: 1 | -1 } | null>(null);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  /** Unsaved cell edits, by item id. The grid reads these over the stored values. */
  const [drafts, setDrafts] = useState<DraftMap>(() => loadDrafts());
  /** False when the browser refused to keep the drafts — only then does a reload lose them. */
  const [draftsKept, setDraftsKept] = useState(true);
  /** A save is in flight. The server round trip is no longer instant, so the button says so. */
  const [saving, setSaving] = useState(false);
  const backupRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setDraftsKept(saveDrafts(drafts)); }, [drafts]);

  /*
    ONE-TIME ADOPTION of the edits this browser kept before the store was shared.
    Runs once the team's values have loaded, because it must know which items already
    carry someone else's answer and leave those alone. Skipped for a view-only reader:
    they cannot write, and their old private values are not theirs to publish for
    everyone. A failure is left to the next open — the local copy is removed only
    after the write lands, so nothing is lost by trying again.
  */
  const adopted = useRef(false);
  useEffect(() => {
    if (adopted.current || !canEdit || !overridesQ.isSuccess) return;
    if (!hasLocalOverrides(user.id)) return;
    adopted.current = true;
    (async () => {
      try {
        const n = await adoptLocalOverrides(user.id, user.id);
        if (n > 0) {
          await refreshOverrides();
          setNote({ text: `Moved your ${plural(n, "saved item")} from this browser to the shared list — everyone can see them now.` });
        }
      } catch (err) {
        adopted.current = false; // let the next open try again
        setNote({ text: `Your earlier edits are still only in this browser — ${(err as Error).message}`, bad: true });
      }
    })();
  }, [canEdit, overridesQ.isSuccess, user.id, refreshOverrides]);

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
    e.stopPropagation();
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

  /**
   * Which Tally book each of our companies is. Closing stock is filed per book, so
   * without this there is no way to ask for it — and no way to tell Surat's stock of
   * an item from Noida's.
   */
  const guidOfCompany = useMemo(
    () => new Map((companies.data ?? []).map((c) => [c.id, c.tallyGuid])),
    [companies.data],
  );
  const companyGuids = useMemo(
    () => [...new Set((companies.data ?? []).map((c) => c.tallyGuid).filter((g): g is string => !!g))].sort(),
    [companies.data],
  );
  const stock = useQuery({
    queryKey: ["bushra-central-master", "closing-stock", companyGuids],
    queryFn: () => fetchClosingStock(companyGuids),
    enabled: companyGuids.length > 0,
    ...opts,
  });

  /**
   * ⚠ NOTHING IS EDITED, SAVED OR MOVED UNTIL ITEMS AND GROUPS HAVE BOTH LOADED.
   *   Central's Group comes from the groups list; before it arrives every item's
   *   central group reads as blank, so a save, an import or an export in that window
   *   would compare against — or write — a Group that is simply not there yet.
   *
   * Closing stock joins that gate, because it decides WHICH ITEMS EXIST here: letting
   * the grid paint all 14,242 and then collapse to the 5,511 in stock would make a
   * correct load look like a crash, and an export taken in that window would carry two
   * thirds of the master.
   */
  const stockRunning = companies.isPending || (companyGuids.length > 0 && stock.isPending);
  /*
    ⚠ THE TEAM'S OVERRIDES MUST BE LOADED BEFORE ANYTHING MAY BE SAVED. `saveMany`
      folds each edit into what is already stored for that item; against a map that
      has not arrived yet, every OTHER field on an edited row would read as unset and
      be dropped. So the shared read joins the gate rather than being awaited later.
  */
  const ready = items.isSuccess && groups.isSuccess && overridesQ.isSuccess && !stockRunning;
  const loadError = (items.error ?? groups.error) as Error | null;
  const sideError = (companies.error ?? units.error) as Error | null;

  /** The closing balances, or undefined when they could not be read — see `stockWarning`. */
  const stockMap = stock.data;

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

  const rows = useMemo((): MirrorRow[] => {
    const out: MirrorRow[] = [];
    for (const item of items.data ?? []) {
      const guid = item.companyId ? guidOfCompany.get(item.companyId) ?? null : null;
      const held = stockMap && guid ? stockMap.get(stockKey(guid, item.name)) : undefined;
      /*
        ⚠ THIS `continue` IS THE SCREEN. Only items Tally is holding are listed.
        An item with no company cannot be matched to a book at all, so it has no
        knowable balance and drops out with the rest — 14 such rows centrally.
        When the balances could NOT be read, stockMap is undefined and nothing is
        filtered: a mirror of the whole master, with a warning saying so, beats an
        empty screen that looks like the item list itself has gone.
      */
      if (stockMap && !held) continue;

      const o = overrides[item.id] ?? {};
      const centralGroupName = centralGroupOf(item);
      const has = (k: EditableKey) => Object.prototype.hasOwnProperty.call(o, k);
      /*
        Description and Colour come from Tally, because Central Masters has neither
        (MS-1): the description IS the item's name, and the colour is the shade named
        in it. Both fall back the same way every other column does — an override only
        when one exists — so a Tally rename still reaches a cell nobody has typed over.
      */
      const centralDescription = item.name;
      const centralColor = colourFromDescription(item.name);
      out.push({
        ...item,
        centralType: item.itemType,
        centralCategory: item.category,
        centralInkType: item.inkType,
        centralGroupName,
        centralCode: item.code,
        centralColor,
        centralDescription,
        itemType: has("itemType") ? (o.itemType ?? null) : item.itemType,
        category: has("category") ? (o.category ?? null) : item.category,
        inkType: has("inkType") ? (o.inkType ?? null) : item.inkType,
        groupName: has("groupName") ? (o.groupName ?? null) : centralGroupName,
        code: has("code") ? (o.code ?? null) : item.code,
        color: has("color") ? (o.color ?? null) : centralColor,
        description: has("description") ? (o.description ?? null) : centralDescription,
        active: o.active ?? item.active,
        closingQty: held ? held.qty : null,
        isNew: !!seen && !seen.has(item.id),
        isChanged: !!overrides[item.id],
      });
    }
    return out;
  }, [items.data, overrides, seen, centralGroupOf, stockMap, guidOfCompany]);

  const byId = useMemo(() => new Map((items.data ?? []).map((i) => [i.id, i])), [items.data]);

  /**
   * "New" means new to THIS list, which is the in-stock list — so an item that has
   * just been received is flagged exactly like one that is new to Central Masters.
   * Both are the same event to a reader here: a row that was not there yesterday.
   *
   * ⚠ Noted only when the balances actually loaded. Recording all 14,242 ids during
   *   an outage would mark items seen that this screen never shows, and the flags
   *   would be wrong for good — the ids are written once and kept.
   */
  const centralIds = useMemo(() => rows.map((r) => r.id), [rows]);
  useEffect(() => { if (stockMap && centralIds.length) noteCentralIds(centralIds); }, [stockMap, centralIds]);

  /** What is stored for a cell, and what central holds for it. */
  const storedOf = (row: MirrorRow, key: EditableKey): string => row[key] ?? "";
  const centralOf = (row: MirrorRow, key: EditableKey): string =>
    (row[CENTRAL_FIELD[key]] as string | null) ?? "";
  /** What a cell shows: the unsaved draft if there is one, else what is stored. */
  const valueOf = (row: MirrorRow, key: EditableKey): string => drafts[row.id]?.[key] ?? storedOf(row, key);
  const isDirty = (row: MirrorRow, key: EditableKey) => {
    const d = drafts[row.id]?.[key];
    return d !== undefined && d !== storedOf(row, key);
  };

  const setCell = (row: MirrorRow, key: EditableKey, value: string) =>
    setDrafts((cur) => {
      const next = { ...(cur[row.id] ?? {}), [key]: value };
      // A cell typed back to what is stored is not an edit; drop it, and drop the
      // row once nothing is left, so the Save count never counts a no-op.
      if (value === storedOf(row, key)) delete next[key];
      if (Object.keys(next).length === 0) {
        const { [row.id]: _gone, ...rest } = cur;
        return rest;
      }
      return { ...cur, [row.id]: next };
    });

  // ---- filtering and sorting --------------------------------------------------
  /** The text a column shows — what its filter lists and its sort orders by. Stored values, not drafts. */
  const colText = useCallback((row: MirrorRow, key: ColKey): string => {
    switch (key) {
      case "item": return row.name;
      case "itemType": return itemTypeLabel(row.itemType);
      case "company": return row.companyId ? companyLabel.get(row.companyId) ?? "" : "";
      case "unit": return row.unitId ? unitName.get(row.unitId) ?? "" : "";
      case "stock": return fmtClosingQty(row.closingQty);
      case "status": return row.isChanged ? "Changed" : "Same as central";
      case "actions": return "";
      default: return row[key] ?? "";
    }
  }, [companyLabel, unitName]);

  const matchesQ = useCallback(
    (r: MirrorRow) => !q.trim() ||
      matchesSearch(q, `${r.name} ${r.code ?? ""} ${itemTypeLabel(r.itemType)} ${r.category ?? ""} ${r.inkType ?? ""} ${r.groupName ?? ""} ${r.color ?? ""} ${r.description ?? ""}`),
    [q],
  );
  const passCols = useCallback(
    (r: MirrorRow, except?: ColKey) => FILTER_KEYS.every((k) =>
      k === except || !colFilters[k]?.length || colFilters[k].includes(filterValueOf(colText(r, k)))),
    [colFilters, colText],
  );
  const passChip = useCallback(
    (r: MirrorRow) => (filter === "changed" ? r.isChanged : filter === "new" ? r.isNew : true),
    [filter],
  );

  const filtered = useMemo(
    () => rows.filter((r) => passChip(r) && matchesQ(r) && passCols(r)),
    [rows, passChip, matchesQ, passCols],
  );
  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const { key, dir } = sort;
    // Closing stock is a QUANTITY and is ordered as one. Its rendered text is grouped
    // ("1,234.5"), and comparing that as text puts 1,234.5 below 9 on any collator.
    if (key === "stock") return [...filtered].sort((a, b) => dir * ((a.closingQty ?? 0) - (b.closingQty ?? 0)));
    return [...filtered].sort((a, b) => dir * collator.compare(colText(a, key), colText(b, key)));
  }, [filtered, sort, colText]);

  /** Each filter lists only what the OTHER filters still allow (the house cascade), never its own pick. */
  const options = useMemo(() => {
    const pre = rows.filter((r) => passChip(r) && matchesQ(r));
    const out: Record<string, string[]> = {};
    for (const k of FILTER_KEYS) {
      const set = new Set<string>();
      for (const r of pre) if (passCols(r, k)) set.add(filterValueOf(colText(r, k)));
      out[k] = sortFilterOptions([...set], collator.compare);
    }
    return out;
  }, [rows, passChip, matchesQ, passCols, colText]);

  const pg = usePagination(sorted, {
    resetKey: `${q}|${filter}|${JSON.stringify(colFilters)}|${sort?.key}|${sort?.dir}`,
  });

  /** The chips count what the OTHER filters leave, so they agree with the table beneath them. */
  const chipBase = useMemo(() => rows.filter((r) => matchesQ(r) && passCols(r)), [rows, matchesQ, passCols]);
  const changedCount = useMemo(() => chipBase.filter((r) => r.isChanged).length, [chipBase]);
  const newCount = useMemo(() => chipBase.filter((r) => r.isNew).length, [chipBase]);
  const changedTotal = useMemo(() => rows.filter((r) => r.isChanged).length, [rows]);
  const newTotal = useMemo(() => rows.filter((r) => r.isNew).length, [rows]);
  const dirtyCount = Object.keys(drafts).length;

  /**
   * Said out loud whenever the list is NOT the in-stock list, because the difference is
   * 14,242 rows against 5,511 and nothing else on the screen would show which one is up.
   * Never a blocking error: the mirror and every edit in it still work without Tally.
   */
  const stockWarning = stockMap ? null
    : companies.isError
      ? "Closing stock is not being shown: the company list could not be loaded, so there is no way to tell which Tally book each item belongs to. Every central item is listed below."
      : stock.error
        ? `Closing stock could not be read from Tally (${(stock.error as Error).message}). Every central item is listed below, not only the ones in stock.`
        : companyGuids.length === 0
          ? "Closing stock is not being shown: no company in Central Masters is linked to a Tally book. Every central item is listed below."
          : null;

  const activeColFilters = FILTER_KEYS.filter((k) => colFilters[k]?.length);
  const anyFilter = !!q.trim() || filter !== "all" || activeColFilters.length > 0;
  const clearFilters = () => { setQ(""); setFilter("all"); setColFilters({}); };
  const toggleSort = (key: ColKey) =>
    setSort((s) => (s?.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));

  // ---- suggestions for the free-text cells ----------------------------------
  const suggestions: Record<string, string[]> = useMemo(() => {
    const inUse = (pick: (r: MirrorRow) => string | null) =>
      [...new Set(rows.map(pick).filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b));
    return {
      category: inUse((r) => r.category),
      inkType: inUse((r) => r.inkType),
      groupName: [...new Set([...(groups.data ?? []).map((g) => g.name), ...inUse((r) => r.groupName)])].sort((a, b) => a.localeCompare(b)),
      color: inUse((r) => r.color),
      /*
        NO LIST FOR DESCRIPTION, deliberately. It defaults to the item's own name, so
        every row now holds a distinct one — the list would be ~4,700 options, one per
        item, rendered into the DOM for a suggestion that only ever offers some other
        item's name back. Colour is the opposite case: two dozen repeated shades.
      */
    };
  }, [rows, groups.data]);
  // Built once per change of the lists, not on every keystroke in a cell.
  const datalists = useMemo(() => Object.entries(suggestions).map(([key, values]) => (
    <datalist key={key} id={`bcm-${key}`}>
      {values.map((s) => <option key={s} value={s} />)}
    </datalist>
  )), [suggestions]);

  // ---- save / discard -------------------------------------------------------
  const save = async () => {
    if (!ready || dirtyCount === 0 || !canEdit || saving) return;
    const edits: MirrorEdit[] = [];
    for (const [id, values] of Object.entries(drafts)) {
      const item = byId.get(id);
      if (item) edits.push({ item, centralGroupName: centralGroupOf(item), values });
    }
    setSaving(true);
    try {
      const n = await saveMany(edits, overrides, user.id);
      setDrafts({});
      await refreshOverrides();
      setNote({ text: `Saved changes on ${plural(n, "item")} — everyone can see them.` });
    } catch (err) {
      // The drafts stay on screen, so nothing typed is lost and the save can be retried.
      setNote({ text: `Not saved — ${(err as Error).message}`, bad: true });
    } finally {
      setSaving(false);
    }
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  /** Drafts survive a reload in the browser; only when the browser refused to keep them is one lost. */
  useEffect(() => {
    if (dirtyCount === 0 || draftsKept) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirtyCount, draftsKept]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void saveRef.current(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const resetRow = async (row: MirrorRow) => {
    // The saved value belongs to the team now, so the warning says whose it is. Unsaved
    // edits are only this person's and are discarded without asking.
    if (row.isChanged && !window.confirm(
      `Undo the saved changes on "${row.name}" and go back to Central and Tally's values?\n\n` +
      "This affects everyone, not only you, and cannot be undone.",
    )) return;
    setDrafts((cur) => { const { [row.id]: _gone, ...rest } = cur; return rest; });
    if (!row.isChanged || !canEdit) return;
    try {
      await resetOverride(row.id);
      await refreshOverrides();
      setNote({ text: `"${row.name}" is back to Central and Tally's values.` });
    } catch (err) {
      setNote({ text: (err as Error).message, bad: true });
    }
  };

  // ---- Excel + backup -------------------------------------------------------
  /** Import, Restore and Export all work on SAVED values, so unsaved edits must be settled first. */
  const blockedByDrafts = dirtyCount > 0 ? `Save or discard your ${plural(dirtyCount, "unsaved item")} first.` : undefined;

  const doExport = () => {
    exportRowsToXlsx({
      fileName: "Bushra_Central_Master",
      sheetName: "Items",
      title: `${APP_NAME} — items`,
      columns: [
        { header: "ID", width: 24, value: (r: MirrorRow) => r.id },
        { header: "Item", width: 40, value: (r: MirrorRow) => r.name },
        { header: "Company", value: (r: MirrorRow) => colText(r, "company") },
        // Read-only, and placed with Company rather than among the editable columns so
        // the file reads the way the grid does. Import ignores it: it is Tally's figure,
        // and only the EXCEL headers below are ever read back in.
        { header: "Closing stock", value: (r: MirrorRow) => colText(r, "stock") },
        ...EXCEL.map((c) => ({
          header: c.header,
          width: c.key === "description" ? 40 : undefined,
          value: (r: MirrorRow) => (c.key === "itemType" ? itemTypeLabel(r.itemType) : storedOf(r, c.key)),
        })),
        ...EXCEL.filter((c) => c.centralHeader).map((c) => ({
          header: c.centralHeader!,
          value: (r: MirrorRow) => (c.key === "itemType" ? itemTypeLabel(r.centralType) : centralOf(r, c.key)),
        })),
      ],
      rows: sorted,
      filters: [
        ...(q.trim() ? [`Search: "${q.trim()}"`] : []),
        ...(filter === "changed" ? ["Only changed items"] : filter === "new" ? ["Only new from central"] : []),
        ...activeColFilters.map((k) => `${HEADER[k]}: ${colFilters[k].map(filterOptionLabel).join(", ")}`),
      ],
      notes: [
        "Keep the ID column untouched — it is what matches a row back to the item.",
        "Fill in Type, Category, Ink type, Group, Colour, Code or Description and import this file back.",
        "Type must be one of the names the Type dropdown offers. Everything else is free text.",
        "Description starts as Tally's own item name, and Colour as the shade named in it — correct either.",
        "The \"Central …\" and \"Tally …\" columns record what those sources said when this file was made.",
        "Leave them alone: a value you leave equal to its twin keeps following the source, even if it changes later.",
        "Rows with no ID, or an ID this master does not hold, are skipped. Central Masters is never changed.",
        "Closing stock is Tally's own balance at the last sync, for reference only — editing it changes nothing.",
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

        const values: Partial<Record<EditableKey, string>> = {};
        const has = (h: string) => Object.prototype.hasOwnProperty.call(rec, h);
        const cell = (h: string) => String(rec[h] ?? "").trim();
        for (const c of EXCEL) {
          if (!has(c.header)) continue; // column absent — never clears
          let v = cell(c.header);
          let was = c.centralHeader && has(c.centralHeader) ? cell(c.centralHeader) : null;
          if (c.key === "itemType") {
            const t = typeValueOf(v);
            if (t === null) { bad.push(`${row.name}: "${v}" is not a Type`); continue; }
            v = t;
            if (was !== null) was = typeValueOf(was) ?? was;
          }
          // Left as Central showed it when the file was made: it follows Central as it
          // stands TODAY, so a correction made centrally since the export is not undone.
          if (was !== null && v === was) v = centralValue(item, c.key, centralGroupOf(item)) ?? "";
          if (v !== storedOf(row, c.key)) values[c.key] = v;
        }
        if (Object.keys(values).length) edits.push({ item, centralGroupName: centralGroupOf(item), values });
      }

      const n = await saveMany(edits, overrides, user.id);
      await refreshOverrides();
      setNote({
        text: `Imported ${plural(n, "item")} — everyone can see them.`
          + (skipped ? ` ${plural(skipped, "row")} skipped (no matching ID).` : "")
          + (bad.length ? ` ${bad.length} rejected — ${bad.slice(0, 3).join("; ")}${bad.length > 3 ? "…" : ""}` : ""),
        bad: bad.length > 0,
      });
    } catch (err) {
      setNote({ text: `Import failed: ${(err as Error).message}`, bad: true });
    }
  };

  const downloadBackup = () => {
    saveAs(new Blob([buildBackup(overrides)], { type: "application/json" }), `bushra-central-master-backup ${todayLocalIso()}.json`);
  };

  const restoreBackup = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const backup = parseBackup(await file.text());
      const incoming = Object.keys(backup.overrides).length;
      const when = backup.savedAt ? ` (saved ${new Date(backup.savedAt).toLocaleString("en-IN")})` : "";
      // It replaces the TEAM's values, not one person's, so the warning says so plainly.
      if (!window.confirm(
        `Replace the saved changes on ${plural(changedTotal, "item")} with this backup's ${plural(incoming, "item")}${when}?\n\n` +
        "This replaces what EVERYONE sees, not only your own view, and cannot be undone. " +
        "Take a Backup first if today's changes might still be wanted.",
      )) return;
      await replaceAllOverrides(backup.overrides, user.id);
      await refreshOverrides();
      setNote({ text: `Restored changes on ${plural(incoming, "item")} for everyone.` });
    } catch (err) {
      setNote({ text: `Restore failed: ${(err as Error).message}`, bad: true });
    }
  };

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
    const mine = row.isChanged && storedOf(row, key) !== centralOf(row, key);
    const border = dirty ? "border-orange bg-orange/5" : mine ? "border-transparent text-orange font-semibold" : "border-transparent hover:border-line";

    /*
      A view-only reader gets the VALUE, not a disabled input. A greyed-out box reads
      as "broken" and still invites the click that does nothing; plain text reads as
      what it is. The orange still marks a value the team has changed from its source.
    */
    if (!canEdit) {
      const v = storedOf(row, key);
      const label = key === "itemType" ? itemTypeLabel(row.itemType) : v;
      return (
        <span className={`block px-1.5 py-1 text-[12.5px] ${mine ? "font-semibold text-orange" : "text-ink"}`}>
          {label || <span className="text-grey-2">—</span>}
        </span>
      );
    }

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
      {datalists}

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[17px] font-semibold text-navy">{APP_NAME}</h1>
            <p className="mt-1 max-w-3xl text-[13px] text-grey">
              The items in Central Masters that are <strong>holding closing stock</strong> — not the whole
              catalogue. {canEdit ? <>Type straight into the grid — Type, Category, Ink type, Group, Colour,
              Code and Description are all yours to fill in — then press <strong>Save</strong> once for
              everything you changed.</> : <>You have this module at <strong>view only</strong>, so the values
              are shown as saved and cannot be changed here.</>} Central Masters is never changed by anything
              done here.
            </p>
            <p className="mt-1 max-w-3xl text-[12px] text-grey">
              <strong>Description</strong> starts as Tally's own name for the item, and <strong>Colour</strong> as
              the shade named in it — so both arrive filled in rather than blank. Type over either one to correct
              it; until you do, they follow Tally, and a row's <strong>Reset</strong> puts them back.
            </p>
            <p className="mt-1 max-w-3xl text-[12px] text-grey-2">
              Closing stock is Tally's own balance for the item in its own company's book, as at the last
              sync — nothing here is calculated. An item that sells out leaves this list and comes back when
              it is next received; whatever you typed against it is kept in the meantime.
            </p>
            <p className="mt-1 text-[11.5px] text-grey-2">
              <strong>Saved values are shared.</strong> Everyone with this module sees what is saved here, and
              a save replaces what they see — so if two people change the same cell, the later save is the one
              that stands. Changed values show in orange. Unsaved edits stay on this browser, yours alone,
              until you Save or Discard. Drag a column edge to resize it.
            </p>
          </div>
          {canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              {dirtyCount > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setDrafts({})} disabled={saving}>Discard {dirtyCount}</Button>
              )}
              <Button size="sm" onClick={save} disabled={!ready || dirtyCount === 0 || saving}>
                {saving ? "Saving…" : dirtyCount > 0 ? `Save ${plural(dirtyCount, "change")}` : "Save"}
              </Button>
            </div>
          )}
        </div>
        {note && (
          <p className={`mt-3 rounded px-3 py-2 text-[12.5px] ${note.bad ? "bg-orange/10 text-orange" : "bg-page text-navy"}`}>{note.text}</p>
        )}
        {/*
          The shared values could not be read. Said loudly and NOT silently swallowed:
          an empty map means "nobody has changed anything", a failed read means "we do
          not know what anyone changed" — and showing the second as the first would
          display Central's values as though the team's work had been wiped. `ready`
          stays false meanwhile, so nothing can be saved over what was not loaded.
        */}
        {overridesQ.isError && (
          <p className="mt-3 flex flex-wrap items-center gap-3 rounded bg-orange/10 px-3 py-2 text-[12.5px] text-orange">
            The saved values could not be read ({(overridesQ.error as Error).message}). The grid below shows
            Central and Tally's own values only — nothing has been lost, and saving is off until this loads.
            <Button size="sm" variant="ghost" onClick={() => void overridesQ.refetch()}>Try again</Button>
          </p>
        )}
        {stockWarning && (
          <p className="mt-3 flex flex-wrap items-center gap-3 rounded bg-orange/10 px-3 py-2 text-[12.5px] text-orange">
            {stockWarning}
            <Button size="sm" variant="ghost" onClick={() => { void companies.refetch(); void stock.refetch(); }}>Try again</Button>
          </p>
        )}
        {sideError && <p className="mt-3 rounded bg-orange/10 px-3 py-2 text-[12.5px] text-orange">{sideError.message}</p>}
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
        {chip("changed", `Changed ${changedCount}`)}
        {chip("new", `New from central ${newCount}`)}
        {anyFilter && (
          <button onClick={clearFilters} className="rounded-lg px-2 py-1 text-[12.5px] font-semibold text-grey-2 hover:bg-page hover:text-orange">
            Clear filters
          </button>
        )}
        {/* Export and Backup only READ, so a view-only reader keeps both. Import and
            Restore write for everyone, and are not offered to someone the database
            would refuse anyway. */}
        <Button variant="ghost" size="sm" onClick={doExport} disabled={!ready || !!blockedByDrafts} title={blockedByDrafts}>Export</Button>
        <Button variant="ghost" size="sm" onClick={downloadBackup}>Backup</Button>
        {canEdit && (
          <>
            <input ref={importRef} type="file" accept=".xlsx" className="hidden" onChange={doImport} />
            <Button variant="ghost" size="sm" onClick={() => importRef.current?.click()} disabled={!ready || !!blockedByDrafts} title={blockedByDrafts}>Import</Button>
            <input ref={backupRef} type="file" accept=".json,application/json" className="hidden" onChange={restoreBackup} />
            <Button variant="ghost" size="sm" onClick={() => backupRef.current?.click()} disabled={!!blockedByDrafts} title={blockedByDrafts}>Restore</Button>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 px-1 text-[12px] text-grey-2">
        {newTotal > 0 && (
          <button onClick={() => markAllSeen(centralIds)} className="hover:text-orange hover:underline">Mark all as seen</button>
        )}
        <button onClick={resetWidths} className="hover:text-orange hover:underline">Reset column widths</button>
        {canEdit && changedTotal > 0 && (
          <button
            onClick={async () => {
              // The single most destructive button here: it throws away the whole team's
              // work, not this person's. The warning has to say that before it is pressed.
              if (!window.confirm(
                `Undo the changes on all ${changedTotal} items and go back to Central and Tally's values?\n\n` +
                "This deletes what EVERYONE has typed, for every item, and cannot be undone. " +
                "Take a Backup first if any of it might still be wanted.",
              )) return;
              try {
                await resetAllOverrides();
                setDrafts({});
                await refreshOverrides();
                setNote({ text: "All items are back to Central and Tally's values." });
              } catch (err) {
                setNote({ text: (err as Error).message, bad: true });
              }
            }}
            className="hover:text-orange hover:underline"
          >
            Reset all to central
          </button>
        )}
        {[items, companies, groups, units, stock].some((query) => query.isFetching) && <span>Loading…</span>}
      </div>

      {!ready ? (
        <Card>
          {loadError ? (
            <div className="flex flex-wrap items-center gap-3 text-[13px] text-orange">
              Could not load Central Masters: {loadError.message}
              <Button size="sm" variant="ghost" onClick={() => { void items.refetch(); void groups.refetch(); }}>Try again</Button>
            </div>
          ) : (
            <p className="text-[13px] text-grey-2">
              {items.isSuccess && groups.isSuccess ? "Reading closing stock from Tally…" : "Loading the central master…"}
            </p>
          )}
        </Card>
      ) : (
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
                      {c.key === "actions" ? null : (
                        <button
                          onClick={() => toggleSort(c.key)}
                          title={`Sort by ${c.header}`}
                          className={`inline-flex items-center gap-1 hover:text-orange ${sort?.key === c.key ? "text-navy" : ""}`}
                        >
                          {c.header}
                          <span className={sort?.key === c.key ? "" : "opacity-30"}>
                            {sort?.key !== c.key ? "↕" : sort.dir === 1 ? "↑" : "↓"}
                          </span>
                        </button>
                      )}
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
                {/* A searchable filter under every column; each lists only what the others still allow. */}
                <tr className="border-b border-line bg-page/40">
                  {COLUMNS.map((c) => (
                    <th key={c.key} className="px-1.5 py-1.5 font-normal">
                      {FILTER_KEYS.includes(c.key) && (
                        <MultiSelect
                          values={colFilters[c.key] ?? []}
                          onChange={(next) => setColFilters((f) => ({ ...f, [c.key]: next }))}
                          options={(options[c.key] ?? []).map((o) => ({ value: o, label: filterOptionLabel(o) }))}
                          placeholder="All"
                          searchable
                          triggerClassName={filterClass}
                        />
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pg.pageItems.length === 0 && (
                  <tr>
                    <td colSpan={COLUMNS.length} className="px-4 py-10 text-center text-[13px] text-grey-2">
                      {rows.length === 0 ? (
                        stockMap
                          ? "No item in Central Masters is holding closing stock right now."
                          : "Central Masters holds no items yet."
                      ) : (
                        <span className="inline-flex items-center gap-3">
                          No item matches these filters.
                          <Button size="sm" variant="ghost" onClick={clearFilters}>Clear filters</Button>
                        </span>
                      )}
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
                    <td className="truncate px-3 py-1.5 text-[12px] text-grey">{colText(row, "company") || "—"}</td>
                    <td className="truncate px-3 py-1.5 text-[12px] text-grey">{colText(row, "unit") || "—"}</td>
                    {/* Tabular figures and right-aligned, so the column reads as a column of numbers. */}
                    <td className="px-3 py-1.5 text-right text-[12px] tabular-nums text-navy">{colText(row, "stock")}</td>
                    <td className="px-3 py-1.5 text-[12px]">
                      {drafts[row.id]
                        ? <span className="text-orange">Unsaved</span>
                        : row.isChanged
                          ? <span className="text-orange" title={Object.keys(overrides[row.id] ?? {}).filter((k): k is EditableKey => k in FIELD_LABEL).map((k) => FIELD_LABEL[k]).join(", ")}>Changed</span>
                          : <span className="text-grey-2">Same as central</span>}
                    </td>
                    <td className="px-3 py-1.5 text-[12px]">
                      {canEdit && (row.isChanged || drafts[row.id]) ? (
                        <button onClick={() => void resetRow(row)} className="font-semibold text-grey hover:text-orange">Reset</button>
                      ) : <span className="text-grey-2/50">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination state={pg} rowsLabel="items" />
        </Card>
      )}

      {dirtyCount > 0 && (
        /* The grid is 25 rows tall and the Save button is at the top, so an edit
           made at the bottom would otherwise have no visible way to commit it. */
        <div className="sticky bottom-4 flex justify-center">
          <div className="flex items-center gap-3 rounded-full border border-orange/30 bg-white px-4 py-2 shadow-lg">
            <span className="text-[12.5px] text-navy">
              {dirtyCount} item{dirtyCount === 1 ? "" : "s"} edited, not saved
              <span className="text-grey-2"> · Save or Discard before Import, Export or Restore</span>
            </span>
            <Button size="sm" onClick={save} disabled={!ready}>Save</Button>
            <button onClick={() => setDrafts({})} className="text-[12.5px] text-grey hover:text-orange">Discard</button>
          </div>
        </div>
      )}
    </div>
  );
}
