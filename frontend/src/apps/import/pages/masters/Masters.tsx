import { useMemo, useState } from "react";
import Tabs from "@/shared/components/ui/Tabs";
import type { ComboOption } from "@/shared/components/ui/Combobox";
import MasterCrud, { type MasterColumn } from "@/shared/components/ui/MasterCrud";
import { emptyValuesFor, masterFields } from "../../lib/masterFields";
import { useMasterFieldCtx } from "../../lib/useMasterFieldCtx";
import { useImportStore } from "../../store";
import type { Company, Category, Item, Vendor, VendorItemPrice } from "../../types";

/**
 * Masters admin — Companies, Categories, Items, Vendors, Vendor-Item Mappings.
 * Each tab is a MasterCrud surface driven by the shared `masterFields` descriptor
 * (the same one the request + approve modals use), with the relational tabs
 * (Items → Category, Mappings → Vendor + Item) sourcing their options from the
 * store. Who owns each master is configured in Setup → Master Owners.
 *
 * No Item Groups tab: an item hangs off a category directly (20260808120100).
 * The table and its rows still exist for legacy master requests — see the
 * comment on MASTER_TYPES in ../../types.
 */
export default function Masters() {
  const s = useImportStore();
  const [tab, setTab] = useState("company");

  const ctx = useMasterFieldCtx();

  const tabs = [
    { key: "company", label: "Companies", count: s.companies.length },
    { key: "category", label: "Categories", count: s.categories.length },
    { key: "item", label: "Items", count: s.items.length },
    { key: "vendor", label: "Vendors", count: s.vendors.length },
    { key: "vendor_item_price", label: "Vendor-Item Mappings", count: s.vendorItemPrices.length },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">Masters</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          Controlled lists that drive every purchase request. Managed by admins and each master's assigned manager.
        </p>
      </div>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === "company" && (
        <MasterCrud<Company>
          singular="Company"
          rows={s.companies}
          canManage={s.canManage("company")}
          searchText={(r) => `${r.name} ${r.location ?? ""}`}
          columns={[
            { header: "Name", render: (r) => <span className="font-medium text-navy">{r.name}</span> },
            { header: "Location", render: (r) => r.location || <span className="text-grey-2">—</span> },
          ] as MasterColumn<Company>[]}
          fields={masterFields("company", ctx)}
          emptyValues={emptyValuesFor("company")}
          toValues={(r) => ({ name: r.name, location: r.location ?? "" })}
          onSubmit={async (id, v, active) => {
            const input = { name: v.name.trim(), location: v.location.trim() || null, active, sortOrder: s.companyById(id)?.sortOrder ?? 0 };
            if (id) await s.editCompany(id, input);
            else await s.createCompany(input);
          }}
          onToggleActive={async (r, active) =>
            s.editCompany(r.id, { name: r.name, location: r.location, active, sortOrder: r.sortOrder })
          }
        />
      )}

      {tab === "category" && (
        <MasterCrud<Category>
          singular="Category"
          rows={s.categories}
          canManage={s.canManage("category")}
          searchText={(r) => r.name}
          columns={[
            { header: "Name", render: (r) => <span className="font-medium text-navy">{r.name}</span> },
            { header: "Items", render: (r) => s.itemsByCategory(r.id).length },
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
            },
          ] as MasterColumn<Category>[]}
          fields={masterFields("category", ctx)}
          emptyValues={emptyValuesFor("category")}
          toValues={(r) => ({ name: r.name, qc_required: r.qcRequired ? "yes" : "no" })}
          onSubmit={async (id, v, active) => {
            const input = {
              name: v.name.trim(),
              active,
              sortOrder: s.categoryById(id)?.sortOrder ?? 0,
              qcRequired: v.qc_required === "yes",
            };
            if (id) await s.editCategory(id, input);
            else await s.createCategory(input);
          }}
          onToggleActive={async (r, active) => s.editCategory(r.id, { name: r.name, active, sortOrder: r.sortOrder, qcRequired: r.qcRequired })}
        />
      )}

      {tab === "item" && (
        <MasterCrud<Item>
          singular="Item"
          rows={s.items}
          canManage={s.canManage("item")}
          searchText={(r) => `${r.name} ${s.categoryById(r.categoryId)?.name ?? ""}`}
          columns={[
            { header: "Name", render: (r) => <span className="font-medium text-navy">{r.name}</span> },
            { header: "Category", render: (r) => s.categoryById(r.categoryId)?.name ?? <span className="text-grey-2">—</span> },
            { header: "Unit", render: (r) => r.unit || <span className="text-grey-2">—</span> },
          ] as MasterColumn<Item>[]}
          fields={masterFields("item", ctx)}
          emptyValues={emptyValuesFor("item")}
          toValues={(r) => ({ category_id: r.categoryId, name: r.name, unit: r.unit })}
          onSubmit={async (id, v, active) => {
            const input = { categoryId: v.category_id, name: v.name.trim(), unit: v.unit.trim(), active, sortOrder: s.itemById(id)?.sortOrder ?? 0 };
            if (id) await s.editItem(id, input);
            else await s.createItem(input);
          }}
          onToggleActive={async (r, active) =>
            s.editItem(r.id, { categoryId: r.categoryId, name: r.name, unit: r.unit, active, sortOrder: r.sortOrder })
          }
        />
      )}

      {tab === "vendor" && (
        <MasterCrud<Vendor>
          singular="Vendor"
          rows={s.vendors}
          canManage={s.canManage("vendor")}
          searchText={(r) => `${r.name} ${r.contactName ?? ""} ${r.phone ?? ""} ${r.email ?? ""}`}
          columns={[
            { header: "Name", render: (r) => <span className="font-medium text-navy">{r.name}</span> },
            { header: "Currency", render: (r) => r.defaultCurrency || <span className="text-grey-2">—</span> },
            { header: "Contact", render: (r) => r.contactName || <span className="text-grey-2">—</span> },
            { header: "Phone", render: (r) => r.phone || <span className="text-grey-2">—</span> },
            { header: "Email", render: (r) => r.email || <span className="text-grey-2">—</span> },
          ] as MasterColumn<Vendor>[]}
          fields={masterFields("vendor", ctx)}
          emptyValues={emptyValuesFor("vendor")}
          toValues={(r) => ({
            name: r.name,
            contact_name: r.contactName ?? "",
            phone: r.phone ?? "",
            email: r.email ?? "",
            default_currency: r.defaultCurrency ?? "",
            address: r.address ?? "",
          })}
          onSubmit={async (id, v, active) => {
            const input = {
              name: v.name.trim(),
              contactName: v.contact_name.trim() || null,
              phone: v.phone.trim() || null,
              email: v.email.trim() || null,
              address: v.address.trim() || null,
              defaultCurrency: v.default_currency.trim().toUpperCase() || null,
              active,
            };
            if (id) await s.editVendor(id, input);
            else await s.createVendor(input);
          }}
          onToggleActive={async (r, active) =>
            s.editVendor(r.id, {
              name: r.name,
              contactName: r.contactName,
              phone: r.phone,
              email: r.email,
              address: r.address,
              defaultCurrency: r.defaultCurrency,
              active,
            })
          }
        />
      )}

      {tab === "vendor_item_price" && (
        // A row here is what makes an item selectable on a request for that
        // vendor — no rate, no currency. `currency` / `rate` still exist on the
        // table and are deliberately absent from the value bag: sending them
        // from a form that never asks for them is how `rate` used to get zeroed
        // on every edit.
        <MasterCrud<VendorItemPrice & { name: string }>
          singular="Vendor-Item Mapping"
          rows={s.vendorItemPrices.map((p) => ({
            ...p,
            name: `${s.vendorById(p.vendorId)?.name ?? "?"} — ${s.itemById(p.itemId)?.name ?? "?"}`,
          }))}
          canManage={s.canManage("vendor_item_price")}
          searchText={(r) => `${s.vendorById(r.vendorId)?.name ?? ""} ${s.itemById(r.itemId)?.name ?? ""}`}
          columns={[
            { header: "Vendor", render: (r) => <span className="font-medium text-navy">{s.vendorById(r.vendorId)?.name ?? "—"}</span> },
            { header: "Item", render: (r) => s.itemById(r.itemId)?.name ?? <span className="text-grey-2">—</span> },
          ] as MasterColumn<VendorItemPrice>[]}
          fields={masterFields("vendor_item_price", ctx)}
          emptyValues={emptyValuesFor("vendor_item_price")}
          toValues={(r) => ({
            vendor_id: r.vendorId,
            item_id: r.itemId,
          })}
          onSubmit={async (id, v, active) => {
            const input = {
              vendorId: v.vendor_id,
              itemId: v.item_id,
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
              active,
              sortOrder: r.sortOrder,
            })
          }
        />
      )}

    </div>
  );
}
