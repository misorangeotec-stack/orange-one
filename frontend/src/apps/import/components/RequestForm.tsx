import type { ReactNode } from "react";
import Card from "@/shared/components/ui/Card";
import Combobox, { type ComboboxHandle } from "@/shared/components/ui/Combobox";
import LineGrid, { type LineGridColumn } from "@/shared/components/ui/LineGrid";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import { cn } from "@/shared/lib/cn";
import RequestMasterModal from "./RequestMasterModal";
import QtyTotal from "./QtyTotal";
import { masterTypeLabel } from "../lib/masterFields";
import { isLineBlank, makeInheritedLine, type RequestFormApi, type RequestLine } from "../pages/requests/useRequestForm";

/**
 * The body shared by New Request and Edit Request: the header fields, the line
 * grid with its quantity total, and the note. The page supplies its own action
 * bar as `children`, so each owns its verb and its post-save behaviour.
 *
 * Import is a PURE QUANTITY REQUISITION: a line is just Category · Item · Qty.
 * There is no rate, no exchange rate, and no line value anywhere. In `edit` mode
 * Company / Vendor render as read-only readouts — items ARE vendor-scoped (the
 * Vendor-Item Mapping master decides what this vendor supplies), so changing the
 * vendor would be a different request, not a correction.
 *
 * Shipment Type is the exception to that lock: it stays editable, because it is a
 * logistics decision about the same order rather than a different order, and a
 * requisition raised before the field existed has none to show.
 */
export default function RequestForm({ form, children }: { form: RequestFormApi; children?: ReactNode }) {
  const {
    mode, companyId, setCompanyId, vendorId, note, setNote, err, requested, setRequested,
    raise, setRaise, companyOptions, vendorOptions, categoryOptions,
    shipmentType, setShipmentType, shipmentOptions, hasVendorItems,
    lines, setLines, itemOptionsFor, onPickVendor, onPickItem, raiseItem, filled,
  } = form;

  const locked = mode === "edit";
  const numCell = "w-full px-2.5 py-1.5 text-[13.5px] text-right tabular-nums";
  /** Does the form already carry a real line? Keeps a hydrated request visible. */
  const hasLines = lines.some((l) => !isLineBlank(l));

  const readOnlyField = (label: string, value: string) => (
    <FieldLabel label={label}>
      <div className="w-full rounded-xl border border-line bg-page px-3.5 py-2.5 text-[14px] text-grey">
        {value || "—"}
      </div>
    </FieldLabel>
  );

  const columns: LineGridColumn<RequestLine>[] = [
    {
      key: "category",
      header: "Category",
      className: "w-44",
      cell: (row, api) => (
        <Combobox
          ref={api.focusRef as (el: ComboboxHandle | null) => void}
          value={row.categoryId}
          onChange={(v) => {
            // Changing the category invalidates the item chosen under the old one.
            api.patch({ categoryId: v, itemId: "", unit: "" });
            api.advance();
          }}
          options={categoryOptions}
          placeholder="Category…"
          searchable
          triggerClassName="px-2.5 py-1.5 text-[13.5px]"
          onTriggerKeyDown={api.keyHandler}
          onCreate={(name) => setRaise({ mt: "category", prefill: { name } })}
          createLabel={(q) => `Request new category “${q}”`}
        />
      ),
    },
    {
      key: "item",
      header: "Item",
      className: "min-w-[240px]",
      cell: (row, api) => {
        // Computed once so the placeholder can tell "pick a category" apart from
        // "this vendor supplies nothing in the category you picked".
        const opts = itemOptionsFor(row);
        return (
          <Combobox
            ref={api.focusRef as (el: ComboboxHandle | null) => void}
            value={row.itemId}
            onChange={(v) => {
              onPickItem(row, v, api.patch);
              api.advance();
            }}
            options={opts}
            placeholder={
              !row.categoryId
                ? "Pick a category first"
                : opts.length === 0
                  ? "No items mapped for this category"
                  : "Search & select an item…"
            }
            disabled={!row.categoryId}
            searchable
            triggerClassName="px-2.5 py-1.5 text-[13.5px]"
            onTriggerKeyDown={api.keyHandler}
            onCreate={raiseItem(row)}
            createLabel={(q) => `Request new item “${q}”`}
          />
        );
      },
    },
    {
      key: "qty",
      header: <span className="block text-right">Qty</span>,
      className: "w-36 min-w-[8.5rem]",
      cell: (row, api) => (
        // The unit is the item master's, not something you pick — so it sits
        // inside the box as a read-only suffix rather than costing a column.
        <div className="relative w-full">
          <TextInput
            ref={api.focusRef as (el: HTMLInputElement | null) => void}
            type="number"
            className={cn(numCell, row.unit && "pr-12")}
            value={row.qty}
            onChange={(e) => api.patch({ qty: e.target.value })}
            onKeyDown={api.keyHandler}
          />
          {row.unit && (
            <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[11px] text-grey-2 max-w-[38px] truncate">
              {row.unit}
            </span>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <Card className="p-5 space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          {locked ? (
            readOnlyField("Company", form.companyOptions.find((o) => o.value === companyId)?.label ?? "")
          ) : (
            <FieldLabel label="Company" required>
              <Combobox
                value={companyId}
                onChange={setCompanyId}
                options={companyOptions}
                placeholder="Select company"
                onCreate={(name) => setRaise({ mt: "company", prefill: { name } })}
                createLabel={(q) => `Request new company “${q}”`}
                autoAdvance
              />
            </FieldLabel>
          )}
          {locked ? (
            readOnlyField("Vendor", vendorOptions.find((o) => o.value === vendorId)?.label ?? "")
          ) : (
            <FieldLabel label="Vendor" required>
              <Combobox
                value={vendorId}
                onChange={onPickVendor}
                options={vendorOptions}
                placeholder="Select vendor"
                onCreate={(name) => setRaise({ mt: "vendor", prefill: { name } })}
                createLabel={(q) => `Request new vendor “${q}”`}
                autoAdvance
              />
            </FieldLabel>
          )}
        </div>

        {/* How the goods travel. Its own row rather than a third cell in the grid
            above: the pair of two is the "who" of the order, and this is the
            "how" — and it is a short field that would leave a ragged half-row. */}
        <div className="grid sm:grid-cols-2 gap-4">
          <FieldLabel label="Shipment Type" required>
            <Combobox
              value={shipmentType}
              onChange={setShipmentType}
              options={shipmentOptions}
              placeholder="How is it shipping?"
              autoAdvance
            />
          </FieldLabel>
        </div>

        {/* A vendor with no mapping can supply nothing, so there is no grid to
            show — say why rather than render an unusable table.

            `hasLines` is what keeps this honest in `edit` mode: if every mapping
            for the vendor was deactivated AFTER the request was raised, hiding the
            grid would hide lines that `filled` still submits. Show them instead. */}
        {vendorId && !hasVendorItems && !hasLines && (
          <div className="rounded-xl border border-line bg-page px-4 py-3.5">
            <p className="text-[13.5px] font-medium text-navy">No items are mapped to this vendor yet.</p>
            <p className="text-[12.5px] text-grey-2 mt-1">
              A requisition can only name items this vendor supplies. Add them in Masters → Vendor-Item Mappings,
              or ask that master's owner to.
            </p>
          </div>
        )}

        {vendorId && (hasVendorItems || hasLines) && (
          <div className="space-y-2">
            <LineGrid
              rows={lines}
              onRowsChange={setLines}
              columns={columns}
              // New trailing row inherits the Category from the row above, so a
              // multi-item requisition in one category isn't "re-pick every line".
              makeEmptyRow={() => makeInheritedLine(lines[lines.length - 1])}
              isRowBlank={isLineBlank}
              footer={
                // Label spans Category+Item; the Qty total sits under Qty, and the
                // last <td> is LineGrid's ✕ column.
                <tfoot className="border-t-2 border-line bg-page/60">
                  <tr>
                    <td colSpan={2} className="px-2.5 py-2.5 text-right text-[12.5px] text-grey-2">
                      {filled.length} line{filled.length === 1 ? "" : "s"} · Total
                    </td>
                    <td className="px-2.5 py-2.5 text-right font-semibold text-navy tabular-nums whitespace-nowrap">
                      <QtyTotal entries={filled.map((l) => ({ qty: Number(l.qty) || 0, unit: l.unit }))} />
                    </td>
                    <td />
                  </tr>
                </tfoot>
              }
            />
            <p className="text-[12px] text-grey-2">
              Only items mapped to this vendor can be ordered, so both lists are already narrowed to what it
              supplies. Each row has its own category. Press Tab or Enter at the end of a row to start the next
              one. Missing an item or category? Type its name to request it.
            </p>
          </div>
        )}

        {/* Outside the grid: the Company and Vendor pickers can raise a master too,
            and this must not disappear with an unmapped vendor. */}
        {requested && (
          <p className="text-[12px] text-teal">
            Requested {requested} — selectable once the master's owner approves it. A new item also needs mapping to
            this vendor before it can be ordered.
          </p>
        )}

        <FieldLabel label="Note (optional)">
          <TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything the import team should know" />
        </FieldLabel>

        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}

        {children}
      </Card>

      <RequestMasterModal
        open={raise !== null}
        onClose={() => setRaise(null)}
        masterType={raise?.mt ?? null}
        lockType
        prefill={raise?.prefill}
        onRequested={(_id, mt, name) => setRequested(`${masterTypeLabel(mt).toLowerCase()} “${name}”`)}
      />
    </>
  );
}
