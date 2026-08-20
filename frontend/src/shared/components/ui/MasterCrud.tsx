import { isValidElement, useCallback, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import MultiSelect from "@/shared/components/ui/MultiSelect";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import Pagination from "@/shared/components/ui/Pagination";
import EmptyState from "@/shared/components/ui/EmptyState";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { usePagination } from "@/shared/lib/usePagination";
import { matchesSearch } from "@/shared/lib/search";
import { exportRowsToXlsx } from "@/shared/lib/exportXlsx";
import { parseXlsxRows } from "@/shared/lib/importXlsx";
import {
  buildExportColumns,
  buildImportPlan,
  runMasterImport,
  type ImportPlan,
  type ImportResult,
} from "@/shared/lib/masterCrudIo";

export interface MasterFieldDef {
  key: string;
  label: string;
  type: "text" | "textarea" | "select" | "custom";
  required?: boolean;
  options?: ComboOption[];
  placeholder?: string;
  hint?: string;
  /**
   * Shown, but not editable.
   *
   * For the CENTRAL MASTERS, where a row sourced from Tally has fields Tally
   * owns and rewrites on every sync (a party's name, GSTIN, group, credit
   * terms). Letting someone type into those would be worse than refusing: the
   * form would accept the edit, the write layer would drop it, and the next
   * pull would prove it gone. Showing the value and locking the input says what
   * is actually true — this is Tally's, change it there.
   *
   * Ignored by `type: "custom"`, whose own control decides what it allows.
   */
  readOnly?: boolean;
  /**
   * Escape hatch for a field the three built-in inputs cannot express — HR Exit's
   * clearance checklist needs a people MultiSelect for `owner_ids`.
   *
   * The form's value bag stays `Record<string, string>`, so a custom control must
   * serialise itself into one string (a MultiSelect: comma-joined ids). Keeping the
   * bag flat is what lets `toValues` / `emptyValues` / the required-check stay dumb.
   * Only read when `type: "custom"`.
   *
   * The whole bag is handed over as well, because a control can depend on a
   * SIBLING field: Dispatch's customer↔item mapping offers only the items that
   * customer does not already have, which it cannot know from its own value.
   *
   * And `setField` so it can CLEAR one. A control that narrows what its siblings
   * may offer has to be able to drop a choice its narrowing just invalidated —
   * pick a company on the customer↔item form after choosing the customer and
   * that customer may not be one of the company's. Leaving the id in the bag
   * would submit a pair the form is no longer showing, so the picker empties it.
   */
  render?: (
    value: string,
    onChange: (next: string) => void,
    values: Record<string, string>,
    setField: (key: string, next: string) => void,
  ) => ReactNode;
}

export interface MasterColumn<T> {
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
  /**
   * OVERRIDE for what this column sorts by. Rarely needed.
   *
   * ⚠ EVERY COLUMN IS SORTABLE BY DEFAULT — see the project rule on the component
   *   below. With no `sortValue`, the column sorts by the TEXT ITS CELL RENDERS,
   *   extracted from the returned node. That is right for the overwhelming
   *   majority of master columns, which render a name or a label.
   *
   *   Declare this when the rendered text sorts wrongly: a number formatted with
   *   separators ("1,200" sorts before "9"), a date shown as "14 Aug", or a
   *   status badge that should order by severity rather than alphabetically.
   */
  sortValue?: (row: T) => string | number | null | undefined;
  /**
   * OVERRIDE for this column's filter, or `false` to remove it.
   *
   * ⚠ EVERY COLUMN IS FILTERABLE BY DEFAULT. With nothing declared, the filter
   *   offers the distinct values of the cell's rendered text.
   *
   *   `get` may return several values for one row (a master offered in three
   *   modules); the row then matches if ANY selected value is among them.
   *
   *   Pass `false` only where a filter is genuinely meaningless — a free-text
   *   column where every row is unique, so the dropdown would just restate the
   *   table.
   *
   * ⚠ ALWAYS A SEARCHABLE MULTI-SELECT, NEVER A NATIVE <select>. A live master
   *   runs to hundreds of distinct values and a scroll-only dropdown is unusable
   *   at that size. Same control QueueTable uses, so a filter here behaves
   *   exactly like a filter on any queue in the app.
   */
  filter?: false | {
    get: (row: T) => string | string[] | null | undefined;
    /** Shown when nothing is picked. Defaults to "Any". */
    placeholder?: string;
  };
}

/**
 * The text a cell renders, pulled out of the returned node.
 *
 * This is what makes sorting and filtering work on EVERY column without each
 * screen having to describe its columns twice. Master cells are simple — a
 * string, or a <span> around one — so walking the node for its text is both
 * reliable and exactly what the user sees.
 *
 * A column whose cell renders something with no text (an icon, a bare colour
 * swatch) yields "", which sorts last and offers no filter values. That is the
 * honest outcome: there is nothing there to order or match on.
 */
function nodeText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join(" ");
  if (isValidElement(node)) return nodeText((node.props as { children?: ReactNode })?.children);
  return "";
}

type Values = Record<string, string>;

/**
 * Generic master-data CRUD surface: search + add + a paginated table with an
 * Active badge and Edit / Activate-Deactivate actions, plus an add/edit modal
 * driven by a field descriptor. Masters are deactivated (active=false), not hard
 * deleted, to protect referential integrity. Used for every procurement master.
 */
export default function MasterCrud<T extends { id: string; name: string; active: boolean }>({
  singular,
  rows,
  columns,
  fields,
  createFields,
  searchText,
  defaultOrder,
  canManage,
  canCreate,
  createHint,
  emptyValues,
  toValues,
  onSubmit,
  onToggleActive,
}: {
  singular: string;
  rows: T[];
  columns: MasterColumn<T>[];
  /** The master's schema: the edit form, the Excel round trip and the import all read it. */
  fields: MasterFieldDef[];
  /**
   * A DIFFERENT form for ADDING, when adding one row at a time is the wrong shape
   * of question. Dispatch's customer↔item mapping asks for a customer and MANY
   * items here and writes a row per pair, while `fields` — one customer, one item
   * — stays the truth for editing an existing pair and for the Excel columns.
   *
   * Defaults to `fields`, so every other master is untouched.
   */
  createFields?: MasterFieldDef[];
  searchText: (row: T) => string;
  /**
   * The master's OWN order, used only when no column sort is picked. For a
   * ladder — bands 1..9, designations junior to senior — alphabetical by name is
   * meaningless. Omit and rows fall back to name, which is right for a plain
   * list. Never overrides an explicit column sort.
   */
  defaultOrder?: (row: T) => number;
  canManage: boolean;
  /**
   * Whether NEW rows may be added. Defaults to `canManage` — pass false for a master
   * whose rows mirror another system (General Purchase departments mirror the portal
   * department list), where a hand-added row could never be matched to anything.
   */
  canCreate?: boolean;
  /** Shown in place of the Add button when `canCreate` is false. */
  createHint?: string;
  emptyValues: Values;
  toValues: (row: T) => Values;
  onSubmit: (id: string | null, values: Values, active: boolean) => Promise<void>;
  onToggleActive: (row: T, active: boolean) => Promise<void>;
}) {
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<T | null>(null);
  const [creating, setCreating] = useState(false);
  const [values, setValues] = useState<Values>(emptyValues);
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [importPlan, setImportPlan] = useState<ImportPlan | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importErr, setImportErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const mayCreate = canManage && canCreate !== false;

  /**
   * Per-column filters and sort.
   *
   * `colFilters` is keyed by header — the same key the columns are rendered by,
   * and stable because two columns of one table cannot share a header.
   */
  const [colFilters, setColFilters] = useState<Record<string, string[]>>({});
  const [sort, setSort] = useState<{ header: string; dir: "asc" | "desc" } | null>(null);

  /**
   * What each column sorts and filters by, with the rendered text as the
   * default. Resolved ONCE here so the sort comparator, the filter and the
   * dropdown options can never disagree about a column.
   */
  const colValue = useMemo(() => {
    const out: Record<string, { get: (row: T) => string[]; filterable: boolean }> = {};
    for (const c of columns) {
      const explicit = c.filter === false ? null : c.filter?.get;
      out[c.header] = {
        filterable: c.filter !== false,
        get: (row: T) => {
          const v = explicit ? explicit(row) : nodeText(c.render(row));
          return (Array.isArray(v) ? v : [v])
            .map((x) => (x ?? "").toString().trim())
            .filter(Boolean);
        },
      };
    }
    return out;
  }, [columns]);

  /**
   * Each column's values for each row, computed ONCE per data change.
   *
   * Without this the cascading filters below would re-render every cell of
   * every column on every keystroke — `nodeText` builds React elements to read
   * their text, and Items is 14,000 rows. One pass, then everything downstream
   * is a Map lookup.
   */
  const colCache = useMemo(() => {
    const out: Record<string, Map<string, string[]>> = {};
    for (const c of columns) {
      const m = new Map<string, string[]>();
      for (const row of rows) m.set(row.id, colValue[c.header].get(row));
      out[c.header] = m;
    }
    return out;
  }, [rows, columns, colValue]);

  const searched = useMemo(
    () => (q.trim() ? rows.filter((r) => matchesSearch(q, searchText(r))) : rows),
    [rows, q, searchText],
  );

  /**
   * Applies every active filter EXCEPT one column's own.
   *
   * ⚠ THE `except` ARGUMENT IS THE WHOLE POINT — IT IS WHAT MAKES THE FILTERS
   *   CASCADE. A column's dropdown is built from the rows that survive the OTHER
   *   columns, so filtering Type to Ink leaves the Item group list showing only
   *   groups that actually contain an ink; picking one can never yield an empty
   *   table. Building the options from all `rows` instead — which is what this
   *   used to do — offers values that are already excluded, and the user has to
   *   discover by clicking that a combination is empty.
   *
   *   A column must be excluded from its OWN options, or narrowing to one value
   *   would leave that single value in the list and there would be no way to
   *   widen the selection again without clearing it.
   */
  const narrow = useCallback(
    (list: T[], except?: string) => {
      let out = list;
      for (const c of columns) {
        if (c.header === except) continue;
        const picked = colFilters[c.header];
        if (!picked?.length || !colValue[c.header]?.filterable) continue;
        const want = new Set(picked);
        // A row with no value for the column is filtered OUT once that column is
        // being filtered on — "show me the Dispatch ones" should not also return
        // the ones belonging to nothing.
        out = out.filter((row) => (colCache[c.header]?.get(row.id) ?? []).some((x) => want.has(x)));
      }
      // Status is not one of `columns` — MasterCrud renders it itself — so it
      // gets its own arm rather than being faked into the column list.
      if (except !== "__status") {
        const picked = colFilters.__status;
        if (picked?.length) {
          const want = new Set(picked);
          out = out.filter((row) => want.has(row.active ? "Active" : "Inactive"));
        }
      }
      return out;
    },
    [columns, colFilters, colValue, colCache],
  );

  /** Every value a column still offers, given what the other columns allow. */
  const filterOptions = useMemo(() => {
    const out: Record<string, { value: string; label: string }[]> = {};
    for (const c of columns) {
      if (!colValue[c.header]?.filterable) continue;
      const seen = new Set<string>();
      for (const row of narrow(searched, c.header))
        for (const s of colCache[c.header]?.get(row.id) ?? []) seen.add(s);
      out[c.header] = [...seen].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .map((s) => ({ value: s, label: s }));
    }
    return out;
  }, [columns, colValue, colCache, narrow, searched]);

  /** Status cascades too: no inactive rows left, no Inactive to pick. */
  const statusOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const row of narrow(searched, "__status")) seen.add(row.active ? "Active" : "Inactive");
    return ["Active", "Inactive"].filter((s) => seen.has(s)).map((s) => ({ value: s, label: s }));
  }, [narrow, searched]);

  const filtered = useMemo(() => {
    const list = narrow(searched);

    const active = sort ? columns.find((c) => c.header === sort.header) : null;
    if (sort?.header === "__status") {
      const dir = sort.dir === "asc" ? 1 : -1;
      return [...list].sort(
        (a, b) => (Number(a.active) - Number(b.active)) * dir || a.name.localeCompare(b.name),
      );
    }
    if (active) {
      const dir = sort!.dir === "asc" ? 1 : -1;
      const valueOf = (row: T) =>
        active.sortValue ? active.sortValue(row) : (colCache[active.header]?.get(row.id) ?? []).join(" ");
      return [...list].sort((a, b) => {
        const av = valueOf(a);
        const bv = valueOf(b);
        // Blanks last in BOTH directions - a column sorted descending should
        // still not open with a screen of empty cells.
        const aEmpty = av === null || av === undefined || av === "";
        const bEmpty = bv === null || bv === undefined || bv === "";
        if (aEmpty || bEmpty) return aEmpty && bEmpty ? 0 : aEmpty ? 1 : -1;
        if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
        return String(av).localeCompare(String(bv), undefined, { numeric: true }) * dir;
      });
    }

    // The default when nobody has picked a sort: live rows first, then by name —
    // unless the master has an inherent order of its own (`defaultOrder`), which
    // is what a LADDER needs. Bands read 1..9 and designations run junior to
    // senior; sorting those alphabetically opens the screen on Band 2, Band 3,
    // Band 8, Band 6, which reads as noise. Live rows still come first either way.
    return [...list].sort(
      (a, b) =>
        Number(b.active) - Number(a.active) ||
        (defaultOrder ? defaultOrder(a) - defaultOrder(b) : 0) ||
        a.name.localeCompare(b.name),
    );
  }, [narrow, searched, columns, sort, colCache, defaultOrder]);

  const pg = usePagination(filtered, { resetKey: `${q}|${JSON.stringify(colFilters)}|${sort?.header}${sort?.dir}` });

  /**
   * The way back when a filter combination matches nothing.
   *
   * Clears the search box too: the row that offers this appears whenever nothing
   * matched, and a stale search term is just as likely to be the cause as a
   * column filter. Sort is left alone — it never hides a row.
   */
  const clearFilters = () => {
    setQ("");
    setColFilters({});
  };

  /** off -> asc -> desc -> off, so a sort can be cleared without a reset button. */
  const cycleSort = (header: string) =>
    setSort((cur) =>
      cur?.header !== header ? { header, dir: "asc" }
        : cur.dir === "asc" ? { header, dir: "desc" }
        : null,
    );

  const doExport = () => {
    exportRowsToXlsx({
      fileName: singular.replace(/\s+/g, "_"),
      sheetName: singular.slice(0, 31),
      title: `${singular} master`,
      columns: buildExportColumns(emptyValues, fields, toValues),
      rows: filtered,
      filters: q.trim() ? [`Search: "${q.trim()}"`] : [],
      notes: [
        "Keep the ID column untouched — it matches each row back to the master. Clear it to add a NEW row.",
        "Only changed rows and new (blank-ID) rows are written on import; everything else is left as-is.",
      ],
    });
  };

  const onPickFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // let the same file be re-picked after a fix
    if (!file) return;
    setImportErr(null);
    setImportResult(null);
    try {
      const records = await parseXlsxRows(file);
      setImportPlan(
        buildImportPlan({ records, existingRows: rows, emptyValues, fields, toValues, onSubmit, canCreate: mayCreate }),
      );
    } catch (err) {
      setImportPlan(null);
      setImportErr((err as Error).message);
    }
  };

  const confirmImport = async () => {
    if (!importPlan) return;
    setImportBusy(true);
    try {
      setImportResult(await runMasterImport([...importPlan.toAdd, ...importPlan.toUpdate]));
    } finally {
      setImportBusy(false);
    }
  };

  const closeImport = () => {
    setImportPlan(null);
    setImportResult(null);
    setImportErr(null);
  };

  const openCreate = () => {
    setValues(emptyValues);
    setActive(true);
    setErr(null);
    setCreating(true);
    setEditing(null);
  };
  const openEdit = (row: T) => {
    setValues(toValues(row));
    setActive(row.active);
    setErr(null);
    setEditing(row);
    setCreating(false);
  };
  const close = () => {
    setCreating(false);
    setEditing(null);
    setErr(null);
  };

  const setField = (key: string, v: string) => setValues((prev) => ({ ...prev, [key]: v }));

  /** What the OPEN dialog is asking for — see the `createFields` note above. */
  const formFields = creating ? (createFields ?? fields) : fields;

  const submit = async () => {
    setErr(null);
    for (const f of formFields) {
      if (f.required && !values[f.key]?.trim()) {
        setErr(`${f.label} is required.`);
        return;
      }
    }
    setBusy(true);
    try {
      await onSubmit(editing?.id ?? null, values, active);
      close();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (row: T) => {
    setTogglingId(row.id);
    try {
      await onToggleActive(row, !row.active);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setTogglingId(null);
    }
  };

  const open = creating || editing !== null;

  /**
   * Field-heavy masters get a landscape dialog instead of one tall column.
   *
   * The Customer master carries eight fields (name, company, code, contact,
   * phone, email, GSTIN, sort order); stacked single-file in a `md` dialog they
   * read as a narrow ribbon that scrolls. Above four fields the dialog widens to
   * `xl` and pairs them up. Four or fewer — unit, category, location — stay
   * exactly as they were: a two-column grid holding one field would only leave
   * half the dialog empty.
   */
  const wide = formFields.length > 4;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-grey-2" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${singular.toLowerCase()}…`}
            className="w-full rounded-xl border border-line bg-white pl-9 pr-3 py-2.5 text-[14px] text-ink placeholder:text-grey-2 outline-none focus:border-orange focus:ring-4 focus:ring-orange/10"
          />
        </div>
        {/* Always available — on an empty master it exports a headers-only sheet that
            doubles as the import template (the "About" tab explains keep-ID-to-update /
            clear-ID-to-add). */}
        <Button variant="ghost" size="sm" onClick={doExport}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
          {rows.length > 0 ? "Export" : "Template"}
        </Button>
        {canManage && (
          <>
            <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={onPickFile} />
            <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
              Import
            </Button>
          </>
        )}
        {mayCreate ? (
          <Button size="sm" onClick={openCreate}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Add {singular}
          </Button>
        ) : (
          createHint && <p className="text-[12px] text-grey-2 whitespace-nowrap">{createHint}</p>
        )}
      </div>

      {importErr && <p className="text-[12.5px] text-ryg-red">Import failed: {importErr}</p>}

      <Card className="overflow-hidden">
        {/* ⚠ THE EMPTY STATE ANSWERS "THIS MASTER IS EMPTY", NOT "NOTHING MATCHED".
            It replaces the whole table — headers, filter row and all — so showing
            it for a filter that matched nothing takes away the very control that
            needs changing, and the only way back is a page reload. So it is keyed
            on `rows`, the master itself; a search or filter that finds nothing
            keeps the table standing and says so in a row. */}
        {rows.length === 0 ? (
          <EmptyState
            title={`No ${singular.toLowerCase()} yet`}
            message={mayCreate ? `Add your first ${singular.toLowerCase()} to get started.` : (createHint ?? "Nothing to show.")}
            actionLabel={mayCreate ? `Add ${singular}` : undefined}
            onAction={mayCreate ? openCreate : undefined}
          />
        ) : (
          <>
            <ScrollableTable>
              <table className="w-full text-[13.5px]">
                <thead>
                  <tr className="text-left text-grey-2 border-b border-line">
                    {canManage && <th className="font-medium px-4 py-3 w-px whitespace-nowrap">Actions</th>}
                    {columns.map((c) => {
                      const on = sort?.header === c.header;
                      return (
                        <th key={c.header} className={`font-medium px-4 py-3 whitespace-nowrap ${c.className ?? ""}`}>
                          <button
                            onClick={() => cycleSort(c.header)}
                            className={`inline-flex items-center gap-1 transition hover:text-navy ${on ? "text-navy" : ""}`}
                            title={`Sort by ${c.header}`}
                          >
                            {c.header}
                            {/* The inactive arrow stays visible but faint: a sort
                                affordance nobody can see is one nobody uses. */}
                            <span className={on ? "text-orange" : "text-grey-2/40"}>
                              {on ? (sort!.dir === "asc" ? "▲" : "▼") : "↕"}
                            </span>
                          </button>
                        </th>
                      );
                    })}
                    <th className="font-medium px-4 py-3 whitespace-nowrap">
                      <button
                        onClick={() => cycleSort("__status")}
                        className={`inline-flex items-center gap-1 transition hover:text-navy ${sort?.header === "__status" ? "text-navy" : ""}`}
                        title="Sort by status"
                      >
                        Status
                        <span className={sort?.header === "__status" ? "text-orange" : "text-grey-2/40"}>
                          {sort?.header === "__status" ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}
                        </span>
                      </button>
                    </th>
                  </tr>

                  {/* THE FILTER ROW. One searchable multi-select under each column,
                      exactly as every queue in the app has. */}
                  <tr className="border-b border-line bg-page/40">
                    {canManage && <th className="px-4 py-2" />}
                    {columns.map((c) => (
                      <th key={c.header} className="px-2 py-2 font-normal align-top">
                        {colValue[c.header]?.filterable && (filterOptions[c.header]?.length ?? 0) > 0 ? (
                          <MultiSelect
                            values={colFilters[c.header] ?? []}
                            onChange={(v) => setColFilters((cur) => ({ ...cur, [c.header]: v }))}
                            options={filterOptions[c.header] ?? []}
                            placeholder={(c.filter ? c.filter.placeholder : undefined) ?? "Any"}
                            triggerClassName="w-full min-w-[8rem] text-[12px]"
                            searchable
                          />
                        ) : null}
                      </th>
                    ))}
                    <th className="px-2 py-2 font-normal align-top">
                      <MultiSelect
                        values={colFilters.__status ?? []}
                        onChange={(v) => setColFilters((cur) => ({ ...cur, __status: v }))}
                        options={statusOptions}
                        placeholder="Any"
                        triggerClassName="w-full min-w-[7rem] text-[12px]"
                      />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={columns.length + (canManage ? 2 : 1)} className="px-4 py-10 text-center">
                        <p className="text-[13.5px] text-navy font-medium">
                          No {singular.toLowerCase()} matches the current filters.
                        </p>
                        <p className="mt-1 text-[12.5px] text-grey-2">
                          {rows.length} {rows.length === 1 ? "row is" : "rows are"} in this master — widen or clear a
                          filter to see them.
                        </p>
                        <button
                          onClick={clearFilters}
                          className="mt-3 text-[12.5px] font-semibold text-orange hover:underline"
                        >
                          Clear all filters
                        </button>
                      </td>
                    </tr>
                  )}
                  {pg.pageItems.map((row) => (
                    <tr key={row.id} className="border-b border-line/70 last:border-0 hover:bg-page/60">
                      {canManage && (
                        <td className="px-4 py-3 align-middle whitespace-nowrap">
                          <button
                            onClick={() => openEdit(row)}
                            className="text-[12.5px] font-semibold text-orange hover:underline mr-3"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => toggle(row)}
                            disabled={togglingId === row.id}
                            className="text-[12.5px] font-semibold text-grey hover:text-navy disabled:opacity-50"
                          >
                            {row.active ? "Deactivate" : "Activate"}
                          </button>
                        </td>
                      )}
                      {columns.map((c) => (
                        <td key={c.header} className={`px-4 py-3 align-middle ${c.className ?? ""}`}>
                          {c.render(row)}
                        </td>
                      ))}
                      <td className="px-4 py-3 align-middle">
                        <span
                          className={`inline-flex items-center text-[11px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ${
                            row.active ? "text-ryg-green bg-[#E9F8EF]" : "text-grey-2 bg-page"
                          }`}
                        >
                          {row.active ? "Active" : "Inactive"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollableTable>
            {filtered.length > 0 && <Pagination state={pg} rowsLabel={singular.toLowerCase()} />}
          </>
        )}
      </Card>

      <Modal
        open={open}
        onClose={close}
        size={wide ? "xl" : "md"}
        title={editing ? `Edit ${singular}` : `Add ${singular}`}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={submit} disabled={busy}>
              {busy ? "Saving…" : editing ? "Save changes" : `Add ${singular}`}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {/* Two columns only once `wide`; the single-column path is byte-for-byte
              the old layout, so the small masters cannot shift. */}
          <div className={wide ? "grid gap-x-5 gap-y-3.5 sm:grid-cols-2" : "space-y-3.5"}>
            {formFields.map((f) => (
              /* A textarea and a custom control (HR Exit's owner MultiSelect, Asset
                 Maintenance's track picker) are as wide as they are tall — halving
                 them wastes the extra room the landscape dialog just bought. */
              <div
                key={f.key}
                className={wide && (f.type === "textarea" || f.type === "custom") ? "sm:col-span-2" : undefined}
              >
                <FieldLabel label={f.label} required={f.required}>
                  {f.type === "custom" ? (
                    f.render?.(values[f.key] ?? "", (next) => setField(f.key, next), values, setField)
                  ) : f.type === "select" ? (
                    <Combobox
                      value={values[f.key] ?? ""}
                      onChange={(v) => setField(f.key, v)}
                      options={f.options ?? []}
                      placeholder={f.placeholder ?? "Select…"}
                      disabled={f.readOnly}
                      autoAdvance
                    />
                  ) : f.type === "textarea" ? (
                    <TextArea
                      rows={3}
                      value={values[f.key] ?? ""}
                      onChange={(e) => setField(f.key, e.target.value)}
                      placeholder={f.placeholder}
                      readOnly={f.readOnly}
                      className={f.readOnly ? "bg-page text-grey cursor-not-allowed" : undefined}
                    />
                  ) : (
                    <TextInput
                      value={values[f.key] ?? ""}
                      onChange={(e) => setField(f.key, e.target.value)}
                      placeholder={f.placeholder}
                      readOnly={f.readOnly}
                      className={f.readOnly ? "bg-page text-grey cursor-not-allowed" : undefined}
                    />
                  )}
                  {f.hint && <span className="mt-1 block text-[11px] leading-snug text-grey">{f.hint}</span>}
                </FieldLabel>
              </div>
            ))}
          </div>

          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="w-4 h-4 accent-orange"
            />
            <span className="text-[13px] text-navy">Active (selectable in workflows)</span>
          </label>

          {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
        </div>
      </Modal>

      <Modal
        open={importPlan !== null}
        onClose={closeImport}
        title={`Import ${singular}`}
        subtitle={importResult ? undefined : "Review before applying — only new (blank-ID) and changed rows are written."}
        footer={
          importResult ? (
            <Button size="sm" onClick={closeImport}>
              Done
            </Button>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={closeImport} disabled={importBusy}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={confirmImport}
                disabled={importBusy || !importPlan || importPlan.toAdd.length + importPlan.toUpdate.length === 0}
              >
                {importBusy
                  ? "Applying…"
                  : `Apply ${(importPlan?.toAdd.length ?? 0) + (importPlan?.toUpdate.length ?? 0)} change${
                      (importPlan?.toAdd.length ?? 0) + (importPlan?.toUpdate.length ?? 0) === 1 ? "" : "s"
                    }`}
              </Button>
            </>
          )
        }
      >
        {importResult ? (
          <div className="space-y-2 text-[13.5px]">
            <p className="text-navy font-medium">
              Applied {importResult.ok} change{importResult.ok === 1 ? "" : "s"}.
            </p>
            {importResult.failed.length > 0 ? (
              <div className="space-y-1">
                <p className="text-ryg-red font-medium">{importResult.failed.length} failed:</p>
                <ul className="list-disc pl-5 text-[12.5px] text-grey">
                  {importResult.failed.map((f, i) => (
                    <li key={i}>
                      <span className="text-navy">{f.label}</span> — {f.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-grey">All rows written successfully.</p>
            )}
          </div>
        ) : importPlan ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { label: "To add", n: importPlan.toAdd.length, cls: "text-ryg-green" },
                { label: "To update", n: importPlan.toUpdate.length, cls: "text-orange" },
                { label: "Unchanged", n: importPlan.unchanged, cls: "text-grey-2" },
                { label: "Unmatched", n: importPlan.unmatched.length, cls: "text-grey-2" },
                { label: "Invalid", n: importPlan.invalid.length, cls: importPlan.invalid.length ? "text-ryg-red" : "text-grey-2" },
              ].map((s) => (
                <div key={s.label} className="rounded-xl border border-line bg-page/50 py-2.5">
                  <div className={`text-[20px] font-bold ${s.cls}`}>{s.n}</div>
                  <div className="text-[11px] uppercase tracking-wide text-grey-2">{s.label}</div>
                </div>
              ))}
            </div>

            {importPlan.toAdd.length + importPlan.toUpdate.length === 0 && importPlan.invalid.length === 0 && (
              <p className="text-[13px] text-grey-2">Nothing to write — every row already matches the master.</p>
            )}

            {[...importPlan.toAdd.map((c) => ({ ...c, kind: "Add" })), ...importPlan.toUpdate.map((c) => ({ ...c, kind: "Update" }))]
              .slice(0, 20)
              .map((c, i) => (
                <div key={i} className="flex items-start justify-between gap-3 text-[12.5px] border-b border-line/60 pb-1.5">
                  <span className="text-navy font-medium">{c.label}</span>
                  <span className="text-grey-2 text-right">
                    {c.kind === "Add" ? "New row" : c.changed || "Updated"}
                  </span>
                </div>
              ))}
            {importPlan.toAdd.length + importPlan.toUpdate.length > 20 && (
              <p className="text-[12px] text-grey-2">…and {importPlan.toAdd.length + importPlan.toUpdate.length - 20} more.</p>
            )}

            {importPlan.invalid.length > 0 && (
              <div className="space-y-1">
                <p className="text-[12.5px] font-medium text-ryg-red">Invalid rows (skipped):</p>
                <ul className="list-disc pl-5 text-[12px] text-grey">
                  {importPlan.invalid.slice(0, 10).map((f, i) => (
                    <li key={i}>
                      <span className="text-navy">{f.label}</span> — {f.reason}
                    </li>
                  ))}
                  {importPlan.invalid.length > 10 && <li>…and {importPlan.invalid.length - 10} more.</li>}
                </ul>
              </div>
            )}

            {importPlan.unmatched.length > 0 && (
              <p className="text-[12px] text-grey-2">
                {importPlan.unmatched.length} row{importPlan.unmatched.length === 1 ? "" : "s"} skipped (ID not found in this master).
              </p>
            )}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
