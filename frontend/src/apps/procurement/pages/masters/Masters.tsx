import { useState } from "react";
import { Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Tabs from "@/shared/components/ui/Tabs";
import MultiSelect from "@/shared/components/ui/MultiSelect";
import MasterCrud, { type MasterColumn, type MasterFieldDef } from "@/shared/components/ui/MasterCrud";
import { useSession } from "@/core/platform/session";
import { ITEM_TYPES, itemTypeLabel, type ItemType } from "@/core/platform/liveMasters";
import { emptyValuesFor, masterFields } from "../../lib/masterFields";
import { useMasterFieldCtx } from "../../lib/useMasterFieldCtx";
import { useProcurementStore } from "../../store";
import { inr } from "../../lib/format";
import type { Category, VendorItemPrice } from "../../types";

/**
 * Masters admin — the two masters that are Purchase's OWN: Categories and
 * Vendor-Item Rates. Each tab is a MasterCrud surface driven by the shared
 * `masterFields` descriptor (the same one the request + approve modals use).
 * Who owns each master is configured in Setup → Master Owners.
 *
 * ⚠ NO COMPANIES, ITEMS OR VENDORS TABS. Those are Central Masters now —
 *   Tally's books, stock items and ledgers, shared with every module and edited
 *   on /admin/masters. Editing them here would fork them again, which is the
 *   thing the move exists to end. Order to Dispatch dropped its Masters entry
 *   for the same reason. A missing vendor or item is REQUESTED (Master
 *   Requests), and approving it creates the central row.
 */

const csvToList = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean);

const TYPE_OPTIONS = ITEM_TYPES.map((t) => ({ value: t.value, label: t.label }));

/**
 * Which Tally item types a line in this category may pick.
 *
 * Kept OUT of `masterFields("category")` on purpose: that descriptor is also
 * the request/approve form and the resolve RPC's wire contract, and neither has
 * a multi-select nor a reason to set this. It is a Masters-screen setting.
 */
const itemTypesField: MasterFieldDef = {
  key: "item_types",
  label: "Items it offers (Tally item types)",
  type: "custom",
  hint: "A requisition line in this category shows only the company's Tally items of these types. Leave empty to show every item. This does not change QC.",
  render: (value, onChange) => (
    <MultiSelect
      values={csvToList(value)}
      onChange={(ids) => onChange(ids.join(","))}
      options={TYPE_OPTIONS}
      placeholder="Every item"
      searchable
      chips
    />
  ),
};

export default function Masters() {
  const s = useProcurementStore();
  const { isAdmin } = useSession();
  const [tab, setTab] = useState("category");

  // The rate form's item list is every company's stock book — only load it on
  // the tab that needs it.
  const ctx = useMasterFieldCtx({ withItemBooks: tab === "vendor_item_price" });

  const tabs = [
    { key: "category", label: "Categories", count: s.categories.length },
    { key: "vendor_item_price", label: "Vendor-Item Rates", count: s.vendorItemPrices.length },
  ];

  const typesText = (r: Category) =>
    r.itemTypes.length ? r.itemTypes.map((t) => itemTypeLabel(t as ItemType) || t).join(", ") : "Every item";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Masters</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          Controlled lists that drive every purchase request. Managed by admins and each master's assigned manager.
        </p>
      </div>

      <Card className="p-4">
        <p className="text-[13px] text-navy">
          <span className="font-semibold">Companies, vendors and items come from Tally</span>, through Central Masters —
          the same lists Order to Dispatch uses. They refresh on their own every 15 minutes.
        </p>
        <p className="text-[12.5px] text-grey mt-1">
          Missing a vendor or an item? Type its name where you pick it and choose “Request new…” — once approved it can be
          picked straight away.
          {isAdmin && (
            <>
              {" "}
              To edit them, open{" "}
              <Link to="/admin/masters" className="font-semibold text-orange hover:underline">
                Central Masters
              </Link>
              .
            </>
          )}
        </p>
      </Card>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === "category" && (
        <MasterCrud<Category>
          singular="Category"
          rows={s.categories}
          canManage={s.canManage("category")}
          searchText={(r) => `${r.name} ${typesText(r)}`}
          columns={[
            { header: "Name", render: (r) => <span className="font-medium text-navy">{r.name}</span> },
            {
              // What the item picker on a requisition line narrows to.
              header: "Items it offers",
              render: (r) =>
                r.itemTypes.length ? typesText(r) : <span className="text-grey-2">Every item</span>,
              sortValue: typesText,
              filter: { get: typesText },
            },
            {
              // Drives the QC Inspection step: a goods receipt carrying any
              // QC-required category must be inspected before the PO can close.
              // Everything else still ends at Tally.
              header: "QC Required",
              render: (r) =>
                r.qcRequired ? (
                  <span className="inline-flex items-center rounded-full bg-[#EAF1FE] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-blue">Yes</span>
                ) : (
                  <span className="text-grey-2">No</span>
                ),
              sortValue: (r) => (r.qcRequired ? "Yes" : "No"),
              filter: { get: (r) => (r.qcRequired ? "Yes" : "No") },
            },
          ] as MasterColumn<Category>[]}
          fields={[...masterFields("category", ctx), itemTypesField]}
          emptyValues={{ ...emptyValuesFor("category"), item_types: "" }}
          toValues={(r) => ({ name: r.name, qc_required: r.qcRequired ? "yes" : "no", item_types: r.itemTypes.join(",") })}
          onSubmit={async (id, v, active) => {
            const input = {
              name: v.name.trim(),
              active,
              sortOrder: s.categoryById(id)?.sortOrder ?? 0,
              qcRequired: v.qc_required === "yes",
              itemTypes: csvToList(v.item_types ?? ""),
            };
            if (id) await s.editCategory(id, input);
            else await s.createCategory(input);
          }}
          onToggleActive={async (r, active) =>
            s.editCategory(r.id, { name: r.name, active, sortOrder: r.sortOrder, qcRequired: r.qcRequired, itemTypes: r.itemTypes })
          }
        />
      )}

      {tab === "vendor_item_price" && (
        // The standing rate card the sourcing grid pre-fills from. It is a
        // DEFAULT, never a lock — every cell stays editable when sourcing.
        <MasterCrud<VendorItemPrice & { name: string }>
          singular="Vendor-Item Rate"
          rows={s.vendorItemPrices.map((p) => ({
            ...p,
            name: `${s.vendorById(p.vendorId)?.name ?? "?"} — ${s.itemById(p.itemId)?.name ?? "?"}`,
          }))}
          canManage={s.canManage("vendor_item_price")}
          searchText={(r) => `${s.vendorById(r.vendorId)?.name ?? ""} ${s.itemById(r.itemId)?.name ?? ""}`}
          columns={[
            { header: "Vendor", render: (r) => <span className="font-medium text-navy">{s.vendorById(r.vendorId)?.name ?? "—"}</span> },
            { header: "Company", render: (r) => s.companyLabel(s.vendorById(r.vendorId)?.companyId ?? null) },
            { header: "Item", render: (r) => s.itemById(r.itemId)?.name ?? <span className="text-grey-2">—</span> },
            { header: "Rate", render: (r) => inr(r.rate), sortValue: (r) => r.rate },
            { header: "GST %", render: (r) => (r.gstPct != null ? `${r.gstPct}%` : <span className="text-grey-2">—</span>), sortValue: (r) => r.gstPct ?? -1 },
            { header: "Lead days", render: (r) => (r.leadTimeDays != null ? `${r.leadTimeDays}d` : <span className="text-grey-2">—</span>), sortValue: (r) => r.leadTimeDays ?? -1 },
          ] as MasterColumn<VendorItemPrice>[]}
          fields={masterFields("vendor_item_price", ctx)}
          emptyValues={emptyValuesFor("vendor_item_price")}
          toValues={(r) => ({
            vendor_id: r.vendorId,
            item_id: r.itemId,
            rate: String(r.rate),
            gst_pct: r.gstPct != null ? String(r.gstPct) : "",
            lead_time_days: r.leadTimeDays != null ? String(r.leadTimeDays) : "",
          })}
          onSubmit={async (id, v, active) => {
            const input = {
              vendorId: v.vendor_id,
              itemId: v.item_id,
              rate: Number(v.rate) || 0,
              gstPct: v.gst_pct.trim() ? Number(v.gst_pct) : null,
              leadTimeDays: v.lead_time_days.trim() ? Number(v.lead_time_days) : null,
              active,
              sortOrder: 0,
            };
            if (id) await s.editVendorItemPrice(id, input);
            else await s.createVendorItemPrice(input);
          }}
          onToggleActive={async (r, active) =>
            s.editVendorItemPrice(r.id, {
              vendorId: r.vendorId,
              itemId: r.itemId,
              rate: r.rate,
              gstPct: r.gstPct,
              leadTimeDays: r.leadTimeDays,
              active,
              sortOrder: r.sortOrder,
            })
          }
        />
      )}
    </div>
  );
}
