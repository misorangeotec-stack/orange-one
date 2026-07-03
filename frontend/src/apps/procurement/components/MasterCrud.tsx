import { useMemo, useState } from "react";
import type { ReactNode } from "react";
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

export interface MasterFieldDef {
  key: string;
  label: string;
  type: "text" | "textarea" | "select";
  required?: boolean;
  options?: ComboOption[];
  placeholder?: string;
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

  const filtered = useMemo(() => {
    const list = q.trim() ? rows.filter((r) => matchesSearch(q, searchText(r))) : rows;
    return [...list].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  }, [rows, q, searchText]);

  const pg = usePagination(filtered, { resetKey: q });

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
        {canManage && (
          <Button size="sm" onClick={openCreate}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Add {singular}
          </Button>
        )}
      </div>

      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState
            title={`No ${singular.toLowerCase()} yet`}
            message={canManage ? `Add your first ${singular.toLowerCase()} to get started.` : "Nothing to show."}
            actionLabel={canManage ? `Add ${singular}` : undefined}
            onAction={canManage ? openCreate : undefined}
          />
        ) : (
          <>
            <ScrollableTable>
              <table className="w-full text-[13.5px]">
                <thead>
                  <tr className="text-left text-grey-2 border-b border-line">
                    {columns.map((c) => (
                      <th key={c.header} className={`font-medium px-4 py-3 whitespace-nowrap ${c.className ?? ""}`}>
                        {c.header}
                      </th>
                    ))}
                    <th className="font-medium px-4 py-3 whitespace-nowrap">Status</th>
                    {canManage && <th className="font-medium px-4 py-3 text-right whitespace-nowrap">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {pg.pageItems.map((row) => (
                    <tr key={row.id} className="border-b border-line/70 last:border-0 hover:bg-page/60">
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
                      {canManage && (
                        <td className="px-4 py-3 align-middle text-right whitespace-nowrap">
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
              {f.type === "select" ? (
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
    </div>
  );
}
