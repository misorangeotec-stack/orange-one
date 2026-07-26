import { useMemo, useRef, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
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
   * Escape hatch for a field the three built-in inputs cannot express — HR Exit's
   * clearance checklist needs a people MultiSelect for `owner_ids`.
   *
   * The form's value bag stays `Record<string, string>`, so a custom control must
   * serialise itself into one string (a MultiSelect: comma-joined ids). Keeping the
   * bag flat is what lets `toValues` / `emptyValues` / the required-check stay dumb.
   * Only read when `type: "custom"`.
   */
  render?: (value: string, onChange: (next: string) => void) => ReactNode;
}

export interface MasterColumn<T> {
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
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
  searchText,
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
  fields: MasterFieldDef[];
  searchText: (row: T) => string;
  canManage: boolean;
  /**
   * Whether NEW rows may be added. Defaults to `canManage` — pass false for a master
   * whose rows mirror another system (Office Supplies departments mirror the portal
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

  const filtered = useMemo(() => {
    const list = q.trim() ? rows.filter((r) => matchesSearch(q, searchText(r))) : rows;
    return [...list].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  }, [rows, q, searchText]);

  const pg = usePagination(filtered, { resetKey: q });

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

  const submit = async () => {
    setErr(null);
    for (const f of fields) {
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
        {filtered.length === 0 ? (
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
                    {columns.map((c) => (
                      <th key={c.header} className={`font-medium px-4 py-3 whitespace-nowrap ${c.className ?? ""}`}>
                        {c.header}
                      </th>
                    ))}
                    <th className="font-medium px-4 py-3 whitespace-nowrap">Status</th>
                  </tr>
                </thead>
                <tbody>
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
            <Pagination state={pg} rowsLabel={singular.toLowerCase()} />
          </>
        )}
      </Card>

      <Modal
        open={open}
        onClose={close}
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
        <div className="space-y-3.5">
          {fields.map((f) => (
            <FieldLabel key={f.key} label={f.label} required={f.required}>
              {f.type === "custom" ? (
                f.render?.(values[f.key] ?? "", (next) => setField(f.key, next))
              ) : f.type === "select" ? (
                <Combobox
                  value={values[f.key] ?? ""}
                  onChange={(v) => setField(f.key, v)}
                  options={f.options ?? []}
                  placeholder={f.placeholder ?? "Select…"}
                  autoAdvance
                />
              ) : f.type === "textarea" ? (
                <TextArea
                  rows={3}
                  value={values[f.key] ?? ""}
                  onChange={(e) => setField(f.key, e.target.value)}
                  placeholder={f.placeholder}
                />
              ) : (
                <TextInput
                  value={values[f.key] ?? ""}
                  onChange={(e) => setField(f.key, e.target.value)}
                  placeholder={f.placeholder}
                />
              )}
              {f.hint && <span className="mt-1 block text-[11px] leading-snug text-grey">{f.hint}</span>}
            </FieldLabel>
          ))}

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
