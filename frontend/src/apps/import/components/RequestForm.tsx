import type { ReactNode } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Combobox, { type ComboboxHandle } from "@/shared/components/ui/Combobox";
import LineGrid, { type LineGridColumn } from "@/shared/components/ui/LineGrid";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import { cn } from "@/shared/lib/cn";
import RequestMasterModal from "./RequestMasterModal";
import { masterTypeLabel } from "../lib/masterFields";
import { isLineBlank, makeEmptyLine, type RequestFormApi, type RequestLine } from "../pages/requests/useRequestForm";

/**
 * The body shared by New Request and Edit Request: the header fields, the line
 * grid with its two running totals, and the note. The page supplies its own
 * action bar as `children`, so each owns its verb and its post-save behaviour.
 *
 * In `edit` mode Company / Vendor / Currency render as read-only readouts —
 * prices are vendor-scoped, so changing the vendor would invalidate every rate
 * and item option on the request. That's a different request, not a correction.
 * The FX rate stays live because it is the sole INR basis and therefore drives
 * the approval band, which is exactly the sort of thing an edit exists to fix.
 */
export default function RequestForm({ form, children }: { form: RequestFormApi; children?: ReactNode }) {
  const {
    mode, companyId, setCompanyId, vendorId, note, setNote, currency, setCurrency,
    fxRate, setFxRate, setFxSource, fxSource, fxBusy, err, requested, setRequested,
    raise, setRaise, companyOptions, vendorOptions, categoryOptions,
    lines, setLines, canPrice, livePrice, itemOptionsFor, loadFx, onPickVendor, onPickItem,
    raiseItem, lineFx, lineInr, filled, totalFx, totalInr, inr, fx, canOfferSave,
  } = form;

  const locked = mode === "edit";
  const numCell = "w-full px-2.5 py-1.5 text-[13.5px] text-right tabular-nums";

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
            api.patch({ categoryId: v, itemId: "", unit: "", rate: "", savePrice: false });
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
      cell: (row, api) => (
        <Combobox
          ref={api.focusRef as (el: ComboboxHandle | null) => void}
          value={row.itemId}
          onChange={(v) => {
            onPickItem(row, v, api.patch);
            api.advance();
          }}
          options={itemOptionsFor(row)}
          placeholder={row.categoryId ? "Search & select an item…" : "Pick a category first"}
          disabled={!row.categoryId}
          searchable
          triggerClassName="px-2.5 py-1.5 text-[13.5px]"
          onTriggerKeyDown={api.keyHandler}
          onCreate={raiseItem(row)}
          createLabel={(q) => `Request new item “${q}”`}
        />
      ),
    },
    {
      key: "qty",
      header: <span className="block text-right">Qty</span>,
      className: "w-36",
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
    {
      key: "rate",
      header: <span className="block text-right">Rate ({currency || "—"})</span>,
      className: "w-44",
      cell: (row, api) => {
        const offer = canOfferSave(row);
        return (
          // The tick's row is ALWAYS laid out — hidden, not removed — so a row
          // that offers it stays exactly as tall as one that doesn't.
          <div className="w-full space-y-1">
            <TextInput
              ref={api.focusRef as (el: HTMLInputElement | null) => void}
              type="number"
              className={numCell}
              value={row.rate}
              placeholder={row.itemId && !livePrice(row.itemId) ? "no price" : ""}
              onChange={(e) => api.patch({ rate: e.target.value, savePrice: e.target.value ? row.savePrice : false })}
              onKeyDown={api.keyHandler}
            />
            <label
              className={cn(
                "flex items-center justify-end gap-1.5 text-[11px] text-grey-2 leading-4",
                offer ? "cursor-pointer" : "invisible pointer-events-none"
              )}
              aria-hidden={!offer}
            >
              <input
                type="checkbox"
                tabIndex={offer ? 0 : -1}
                checked={row.savePrice}
                onChange={(e) => api.patch({ savePrice: e.target.checked })}
                className="accent-orange"
              />
              {canPrice ? (livePrice(row.itemId) ? "Update price list" : "Save to price list") : "Request this price"}
            </label>
          </div>
        );
      },
    },
    {
      key: "lineFx",
      header: <span className="block text-right">Line ({currency || "—"})</span>,
      className: "w-36 text-right",
      skipFocus: true,
      cell: (row) => (
        <span className="text-grey tabular-nums whitespace-nowrap">{isLineBlank(row) ? "—" : fx(lineFx(row))}</span>
      ),
    },
    {
      key: "lineInr",
      header: <span className="block text-right">Line (₹)</span>,
      className: "w-36 text-right",
      skipFocus: true,
      cell: (row) => (
        <span className="text-grey tabular-nums whitespace-nowrap">{isLineBlank(row) ? "—" : inr(lineInr(row))}</span>
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

        {vendorId && (
          <div className="grid sm:grid-cols-3 gap-4">
            {locked ? (
              readOnlyField("Currency", currency)
            ) : (
              <FieldLabel label="Currency" required>
                <TextInput value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} placeholder="e.g. USD" />
              </FieldLabel>
            )}
            <FieldLabel label={`Exchange rate (1 ${currency || "—"} → ₹)`} required>
              <TextInput type="number" value={fxRate} onChange={(e) => { setFxRate(e.target.value); setFxSource("manual"); }} placeholder={fxBusy ? "fetching…" : "e.g. 83.20"} />
            </FieldLabel>
            <div className="flex items-end">
              <Button variant="outline" onClick={() => currency && loadFx(currency)} disabled={fxBusy || !currency}>
                {fxBusy ? "Fetching…" : "Refresh rate"}
              </Button>
            </div>
          </div>
        )}
        {vendorId && fxSource && (
          <p className="text-[12px] text-grey-2 -mt-2">
            Rate {fxSource === "manual" ? "entered manually" : `from ${fxSource}`}. You can edit it before {locked ? "saving" : "submitting"}.
          </p>
        )}

        {vendorId && (
          <div className="space-y-2">
            <LineGrid
              rows={lines}
              onRowsChange={setLines}
              columns={columns}
              makeEmptyRow={makeEmptyLine}
              isRowBlank={isLineBlank}
              footer={
                // colSpan spans Category+Item+Qty+Rate; the two totals sit under
                // their own columns and the last <td> is LineGrid's ✕ column.
                // Adding a column here means bumping this number.
                <tfoot className="border-t-2 border-line bg-page/60">
                  <tr>
                    <td colSpan={4} className="px-2.5 py-2.5 text-right text-[12.5px] text-grey-2">
                      {filled.length} line{filled.length === 1 ? "" : "s"} · Total
                    </td>
                    <td className="px-2.5 py-2.5 text-right font-semibold text-navy tabular-nums whitespace-nowrap">
                      {fx(totalFx)}
                    </td>
                    <td className="px-2.5 py-2.5 text-right font-semibold text-navy tabular-nums whitespace-nowrap">
                      {inr(totalInr)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              }
            />
            <p className="text-[12px] text-grey-2">
              Every item in the category is listed. An item with no price comes in blank — type the rate and tick the box
              to {canPrice ? "save it to the price list" : "request it for the price list"}.
            </p>
            {requested && <p className="text-[12px] text-teal">Requested {requested} — selectable once the master's owner approves it.</p>}
          </div>
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
