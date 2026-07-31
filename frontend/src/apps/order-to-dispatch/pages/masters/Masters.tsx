import { useState } from "react";
import MasterCrud, { type MasterColumn } from "@/shared/components/ui/MasterCrud";
import Tabs from "@/shared/components/ui/Tabs";
import { useDispatchStore } from "../../store";
import { useMasterFieldCtx } from "../../lib/useMasterFieldCtx";
import {
  emptyValuesFor, isNameless, masterFields, masterTypePlural, type MasterValues,
} from "../../lib/masterFields";
import { DISPATCH_MASTER_TYPES, type DispatchMasterType, type NamedMaster } from "../../types";


/**
 * The four masters: WHO buys, WHAT we sell, WHICH of it each of them may order,
 * and the companies we sell as.
 *
 * Company is a tab in its own right. It is no longer wired to the customer — an
 * order does not record a billing entity any more — but the list is still ours to
 * keep, so it stays editable here.
 *
 * Every tab renders through the shared MasterCrud, which is where search,
 * activate/deactivate and the Excel export/import round trip come from — none of
 * that is written here. The value bag (`emptyValuesFor`) IS the Excel schema, so
 * a key with no visible form field still survives the round trip.
 */
export default function Masters() {
  const s = useDispatchStore();
  const ctx = useMasterFieldCtx();
  const [tab, setTab] = useState<DispatchMasterType>("customer");
  const active = DISPATCH_MASTER_TYPES.some((t) => t.value === tab) ? tab : "customer";

  const rows = s.masterList(active);
  const fields = masterFields(active, ctx);

  /**
   * Column set: the name, plus whatever that master's own fields are worth showing.
   *
   * A NAMELESS master gets neither the name column (its synthetic label just
   * repeats the two columns beside it) nor Sort order (there is nothing to order
   * — the mapping is read as a set, and the Excel load writes thousands of rows
   * that would all sit at 0 anyway).
   */
  const columns: MasterColumn<NamedMaster>[] = isNameless(active)
    ? extraColumns(active, s)
    : [
        { header: masterTypePlural(active), render: (r) => <span className="font-medium text-navy">{r.name}</span> },
        ...extraColumns(active, s),
        { header: "Order", render: (r) => <span className="text-grey-2">{r.sortOrder}</span>, className: "w-20" },
      ];

  /** The stored row → the string bag MasterCrud edits. Keys match emptyValuesFor. */
  const toValues = (r: NamedMaster): MasterValues => {
    const any = r as unknown as Record<string, unknown>;
    const out = emptyValuesFor(active);
    for (const key of Object.keys(out)) {
      if (key === "sortOrder") { out[key] = String(r.sortOrder ?? 0); continue; }
      if (key === "name") { out[key] = r.name; continue; }
      out[key] = valueOf(any, key);
    }
    return out;
  };

  /** The string bag → the snake_case columns the write layer sends. */
  const toExtra = (v: MasterValues): Record<string, unknown> => {
    const extra: Record<string, unknown> = {};
    for (const key of Object.keys(emptyValuesFor(active))) {
      if (key === "name" || key === "sortOrder") continue;
      const raw = String(v[key] ?? "").trim();
      extra[key] = raw === "" ? null : NUMERIC_KEYS.has(key) ? Number(raw) : raw;
    }
    return extra;
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Masters</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          Everything the dispatch flow picks from. Editable by admins and each master's owner
          (Setup → Master Owners). Use Export / Import on any tab to bulk-load from Excel.
        </p>
      </div>

      <Tabs
        tabs={DISPATCH_MASTER_TYPES.map((t) => ({ key: t.value, label: t.plural, count: s.masterList(t.value).length }))}
        active={active}
        onChange={(k) => setTab(k as DispatchMasterType)}
      />

      <MasterCrud<NamedMaster>
        key={active}
        singular={DISPATCH_MASTER_TYPES.find((m) => m.value === active)!.label}
        rows={rows}
        columns={columns}
        fields={fields}
        searchText={(r) => r.name}
        canManage={s.canManage(active)}
        emptyValues={emptyValuesFor(active)}
        toValues={toValues}
        onSubmit={async (id, v, isActive) => {
          const input = {
            name: String(v.name ?? "").trim(),
            active: isActive,
            sortOrder: Math.max(0, Math.floor(Number(v.sortOrder) || 0)),
            extra: toExtra(v),
          };
          if (id) await s.updateMaster(active, id, input);
          else await s.insertMaster(active, input);
        }}
        onToggleActive={async (row, isActive) => {
          const v = toValues(row);
          await s.updateMaster(active, row.id, {
            name: row.name,
            active: isActive,
            sortOrder: row.sortOrder,
            extra: toExtra(v),
          });
        }}
      />
    </div>
  );
}

/**
 * Value-bag keys that must be written as numbers, not strings.
 *
 * Empty since the reshape — every numeric master field (credit limit, credit
 * days, payment-term days, LOT available qty) belonged to a column that no
 * longer exists. Kept as the hook for the next one, because a plain string
 * written into a numeric column fails at the database, not at the compiler.
 */
const NUMERIC_KEYS = new Set<string>([]);

/** camelCase the snake_case bag key so it can be read off the mapped row. */
const camel = (k: string) => k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

const valueOf = (row: Record<string, unknown>, key: string): string => {
  const v = row[camel(key)];
  if (v === null || v === undefined) return "";
  return String(v);
};

/** Per-master extra display columns — enough to identify a row at a glance. */
function extraColumns(
  mt: DispatchMasterType,
  s: ReturnType<typeof useDispatchStore>,
): MasterColumn<NamedMaster>[] {
  const text = (header: string, get: (r: Record<string, unknown>) => unknown): MasterColumn<NamedMaster> => ({
    header,
    render: (r) => {
      const v = get(r as unknown as Record<string, unknown>);
      return <span className="text-grey-2">{v === null || v === undefined || v === "" ? "—" : String(v)}</span>;
    },
  });

  switch (mt) {
    case "customer":
      return [
        text("Code", (r) => r.code),
        text("Phone", (r) => r.phone),
      ];
    case "item":
      return [
        text("Code", (r) => r.code),
        text("Unit", (r) => r.unit),
      ];

    case "customer_item":
      // The pair IS the row — the synthetic `name` the store builds is only
      // there for search and the Excel round trip, so it is never the column.
      return [
        {
          header: "Customer",
          render: (r) => (
            <span className="text-navy">{s.customerName((r as unknown as { customerId: string }).customerId)}</span>
          ),
        },
        {
          header: "Item",
          render: (r) => (
            <span className="text-grey-2">{s.itemName((r as unknown as { itemId: string }).itemId)}</span>
          ),
        },
      ];
    case "company":
      return [text("GSTIN", (r) => r.gstin)];
    default:
      return [];
  }
}
