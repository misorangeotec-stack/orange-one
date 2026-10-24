import { useState } from "react";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { setFieldDefault } from "../data/mrWrites";
import { PageHeader } from "../components/Pills";
import { useMrStore } from "../store";
import type { FieldDef } from "../types";

/**
 * The website default for every machine field. Each machine can still override a
 * field on its own form. Locked fields (title, photos, seller, salesperson, ...)
 * are fixed for every machine; the portal refuses a change to them as well.
 */
export default function FieldVisibility() {
  const s = useMrStore();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const overridden = (f: FieldDef) =>
    s.machines.filter((m) => Object.prototype.hasOwnProperty.call(m.visibilityOverrides, f.key) && m.visibilityOverrides[f.key] !== f.defaultVisible).length;
  const defaultText = (f: FieldDef) => (f.defaultVisible ? "Shown" : "Hidden");
  const lockText = (f: FieldDef) => (f.locked ? "Fixed" : "Can change");

  const toggle = async (f: FieldDef) => {
    setErr(null);
    setBusyKey(f.key);
    try {
      await setFieldDefault(f.key, !f.defaultVisible);
      await s.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey(null);
    }
  };

  const columns: QueueColumn<FieldDef>[] = [
    {
      key: "label",
      header: "Field",
      cell: (f) => <span className="font-medium text-navy">{f.label}</span>,
      sortValue: (f) => f.sortOrder,
      exportValue: (f) => f.label,
      filter: { kind: "select", get: (f) => f.label },
    },
    {
      key: "default",
      header: "On the website by default",
      cell: (f) =>
        f.locked || !s.canEdit ? (
          <span className={f.defaultVisible ? "font-medium text-[#1E7B3C]" : "text-grey"}>
            {f.defaultVisible ? (f.locked ? "Always shown" : "Shown") : f.locked ? "Never shown" : "Hidden"}
          </span>
        ) : (
          <label className="inline-flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={f.defaultVisible}
              disabled={busyKey !== null}
              onChange={() => void toggle(f)}
              className="h-4 w-4 accent-orange"
              aria-label={`Show ${f.label} on the website by default`}
            />
            <span className={f.defaultVisible ? "font-medium text-[#1E7B3C]" : "text-grey"}>{f.defaultVisible ? "Shown" : "Hidden"}</span>
          </label>
        ),
      sortValue: defaultText,
      exportValue: defaultText,
      filter: { kind: "select", get: defaultText },
      resize: false,
    },
    {
      key: "locked",
      header: "Setting",
      cell: (f) =>
        f.locked ? (
          <span className="inline-flex items-center gap-1 text-grey">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
            Fixed for every machine
          </span>
        ) : (
          <span className="text-grey">Default, each machine can override</span>
        ),
      sortValue: lockText,
      exportValue: lockText,
      filter: { kind: "select", get: lockText },
    },
    {
      key: "overrides",
      header: "Machines overriding it",
      align: "right",
      cell: (f) => <span className="tabular-nums">{f.locked ? "" : overridden(f)}</span>,
      sortValue: (f) => (f.locked ? -1 : overridden(f)),
      exportValue: (f) => (f.locked ? "" : overridden(f)),
      filter: { kind: "number", get: (f) => (f.locked ? 0 : overridden(f)) },
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Field visibility"
        sub="Which details every machine shows on the website, unless its own form says otherwise. The seller, salesperson and internal notes are never shown."
      />
      {err && <p className="text-[13px] text-ryg-red">{err}</p>}
      <QueueTable<FieldDef>
        rows={s.fields}
        rowKey={(f) => f.key}
        columns={columns}
        rowsLabel="fields"
        initialSort={{ key: "label", dir: "asc" }}
        emptyTitle="No fields"
        emptyMessage="The field list comes with the portal database."
        exportName="Field_visibility"
      />
    </div>
  );
}
