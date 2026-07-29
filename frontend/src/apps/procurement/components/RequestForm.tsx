import type { ReactNode } from "react";
import Card from "@/shared/components/ui/Card";
import Combobox, { type ComboboxHandle } from "@/shared/components/ui/Combobox";
import DraftBar from "@/shared/components/ui/DraftBar";
import LineGrid, { type LineGridColumn } from "@/shared/components/ui/LineGrid";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import RequestMasterModal from "./RequestMasterModal";
import { masterTypeLabel } from "../lib/masterFields";
import { isLineBlank, makeInheritedLine, type RequestFormApi, type RequestLine } from "../pages/requests/useRequestForm";

/**
 * The body shared by New Request and Edit Request: the Company header and the
 * Category → Item grid. Each page supplies its own action bar as `children`. In
 * edit mode the Company is a read-only readout — changing it is a different
 * request, not a correction.
 *
 * Both draft affordances live here rather than on the pages, so New and Edit
 * behave identically and a third caller would get them for free.
 */
export default function RequestForm({ form, children }: { form: RequestFormApi; children?: ReactNode }) {
  const {
    mode, companyId, setCompanyId, note, setNote, err, requested, setRequested,
    raise, setRaise, companyOptions, categoryOptions, itemOptionsFor,
    raiseItem, itemById, lines, setLines, draft,
  } = form;

  const locked = mode === "edit";

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
            // A new category invalidates the item chosen under the old one.
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
      className: "min-w-[220px]",
      cell: (row, api) => (
        <Combobox
          ref={api.focusRef as (el: ComboboxHandle | null) => void}
          value={row.itemId}
          onChange={(v) => {
            const it = itemById(v);
            if (it) api.patch({ itemId: v, unit: it.unit, qty: row.qty || "1" });
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
      className: "w-32 min-w-[7rem]",
      cell: (row, api) => (
        <TextInput
          ref={api.focusRef as (el: HTMLInputElement | null) => void}
          type="number"
          className="w-full px-2.5 py-1.5 text-[13.5px] text-right tabular-nums"
          value={row.qty}
          onChange={(e) => api.patch({ qty: e.target.value })}
          onKeyDown={api.keyHandler}
        />
      ),
    },
    {
      key: "unit",
      header: "Unit",
      className: "w-20",
      skipFocus: true,
      cell: (row) => <span className="text-grey">{row.unit || "—"}</span>,
    },
    {
      key: "remark",
      header: "Remark",
      className: "min-w-[140px]",
      cell: (row, api) => (
        <TextInput
          ref={api.focusRef as (el: HTMLInputElement | null) => void}
          className="w-full px-2.5 py-1.5 text-[13.5px]"
          placeholder="optional"
          value={row.remark}
          onChange={(e) => api.patch({ remark: e.target.value })}
          onKeyDown={api.keyHandler}
        />
      ),
    },
  ];

  return (
    <>
      <Card className="p-5 space-y-4">
        {/* -mb-1 trims DraftBar's own bottom margin against this Card's space-y. */}
        <div className="-mb-1">
          <DraftBar draft={draft} />
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          {locked ? (
            <FieldLabel label="Company">
              <div className="w-full rounded-xl border border-line bg-page px-3.5 py-2.5 text-[14px] text-grey">
                {companyOptions.find((o) => o.value === companyId)?.label ?? "—"}
              </div>
            </FieldLabel>
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
        </div>

        <div className="space-y-2">
          <LineGrid
            rows={lines}
            onRowsChange={setLines}
            columns={columns}
            // New trailing row inherits the Category from the row above, so a
            // multi-item requisition in one category isn't "re-pick every line".
            makeEmptyRow={() => makeInheritedLine(lines[lines.length - 1])}
            isRowBlank={isLineBlank}
          />
          <p className="text-[12px] text-grey-2">
            Each row has its own category. Press Tab or Enter at the end of a row to start the next one. Missing an item
            or category? Type its name to request it.
          </p>
          {requested && <p className="text-[12px] text-teal">Requested {requested} — selectable once the master's owner approves it.</p>}
        </div>

        <FieldLabel label="Note (optional)">
          <TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything the purchase team should know" />
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
