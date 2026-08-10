import { useState } from "react";
import MasterCrud, { type MasterColumn, type MasterFieldDef } from "@/shared/components/ui/MasterCrud";
import MultiSelect from "@/shared/components/ui/MultiSelect";
import Button from "@/shared/components/ui/Button";
import Tabs from "@/shared/components/ui/Tabs";
import RequestMasterModal from "../../components/RequestMasterModal";
import { useDispatchStore } from "../../store";
import { useMasterFieldCtx } from "../../lib/useMasterFieldCtx";
import {
  emptyValuesFor, isNameless, masterFields, masterTypePlural, normalizeMasterValue, type MasterValues,
} from "../../lib/masterFields";
import { DISPATCH_MASTER_TYPES, type DispatchMasterType, type NamedMaster } from "../../types";


/**
 * The four masters: WHO buys, WHAT we sell, WHICH of it each of them may order,
 * and the companies we sell as.
 *
 * Company is a tab in its own right. It is no longer wired to the CUSTOMER — that
 * mapping was retired — but the order itself records a billing entity again: it
 * is picked on the intake form, straight off this list.
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
  const [raising, setRaising] = useState(false);
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

  /**
   * The items that customer does NOT already have. Deliberately blind to whether
   * the existing mapping is active: a deactivated pair still occupies the unique
   * index, so offering it again would only produce a duplicate-key error.
   */
  const unmappedItemOptions = (customerId: string) => {
    const taken = new Set(s.customerItems.filter((m) => m.customerId === customerId).map((m) => m.itemId));
    return s.activeOf(s.items)
      .filter((i) => !taken.has(i.id))
      .map((i) => ({ value: i.id, label: i.name }));
  };

  /**
   * ADDING a mapping asks a different question from editing one.
   *
   * A customer's catalogue is dozens of items, and the pair-at-a-time form made
   * that dozens of trips through the same dialog picking the same customer. Here
   * it is one customer and MANY items, written as a row per pair. Editing an
   * existing pair still edits THAT pair — `masterFields` stays the schema for the
   * edit form, the Excel round trip and the request modal.
   */
  const createFields: MasterFieldDef[] | undefined =
    active === "customer_item"
      ? [
          {
            key: "customer_id", label: "Customer", type: "select", required: true,
            options: ctx.customerOptions, placeholder: "Select customer",
          },
          {
            key: "item_id", label: "Items", type: "custom", required: true,
            hint: "Everything this customer may order. One mapping is written per item; anything already mapped is left out of the list.",
            render: (value, onChange, values) => {
              const customerId = values.customer_id ?? "";
              return (
                <MultiSelect
                  values={value ? value.split(",").filter(Boolean) : []}
                  onChange={(ids) => onChange(ids.join(","))}
                  options={unmappedItemOptions(customerId)}
                  placeholder={customerId ? "Select items" : "Pick a customer first"}
                  disabled={!customerId}
                  searchable
                  chips
                />
              );
            },
          },
        ]
      : undefined;

  /** The string bag → the snake_case columns the write layer sends. */
  const toExtra = (v: MasterValues): Record<string, unknown> => {
    const extra: Record<string, unknown> = {};
    for (const key of Object.keys(emptyValuesFor(active))) {
      if (key === "name" || key === "sortOrder") continue;
      // normalizeMasterValue is what keeps LOCATION in caps — here, and on the
      // Excel import, which comes through this same submit.
      const raw = normalizeMasterValue(key, String(v[key] ?? ""));
      extra[key] = raw === "" ? null : NUMERIC_KEYS.has(key) ? Number(raw) : raw;
    }
    return extra;
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-navy">Masters</h1>
          <p className="text-[13.5px] text-grey-2 mt-1">
            Everything the dispatch flow picks from. Editable by admins and each master's owner
            (Setup → Master Owners). Use Export / Import on any tab to bulk-load from Excel.
          </p>
        </div>
        {/* Not everyone here can edit the tab they are looking at — an owner of one
            master is a visitor on the rest. Requesting is what they can always do,
            on EVERY master, and it opens on the tab they are standing on. */}
        <Button size="sm" onClick={() => setRaising(true)}>Request new entry</Button>
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
        createFields={createFields}
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
          if (id) { await s.updateMaster(active, id, input); return; }
          /*
            A NEW mapping carries a list of items, not one — `item_id` holds the
            MultiSelect's comma-joined ids (see `createFields`). One row per pair,
            written in a single statement so the whole batch lands or none of it does.
          */
          if (active === "customer_item") {
            const itemIds = String(v.item_id ?? "").split(",").map((x) => x.trim()).filter(Boolean);
            await s.insertMasters(active, itemIds.map((itemId) => ({ ...input, extra: { ...input.extra, item_id: itemId } })));
            return;
          }
          await s.insertMaster(active, input);
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

      <RequestMasterModal open={raising} onClose={() => setRaising(false)} masterType={active} />
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
        text("Location", (r) => r.location),
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
      // The prefix is worth a column: it is what the gate pass series is named
      // after, so a company sitting blank here is quietly issuing GP-... passes.
      return [text("GSTIN", (r) => r.gstin), text("Gate pass prefix", (r) => r.gatePassPrefix)];
    case "company_location":
      // The parent is the point — "Unit 1" means nothing until you know whose.
      return [
        {
          header: "Company",
          render: (r) => (
            <span className="text-grey-2">
              {s.masterName("company", (r as unknown as { companyId: string }).companyId)}
            </span>
          ),
        },
      ];
    default:
      return [];
  }
}
