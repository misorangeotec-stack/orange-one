import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Combobox, { type ComboOption, type ComboboxHandle } from "@/shared/components/ui/Combobox";
import LineGrid, { newUid, type LineGridColumn, type LineGridRow } from "@/shared/components/ui/LineGrid";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import RequestMasterModal from "../../components/RequestMasterModal";
import { masterTypeLabel, type MasterValues } from "../../lib/masterFields";
import type { MasterType } from "../../types";
import { useProcurementStore } from "../../store";

interface Line extends LineGridRow {
  /** Item Group of THIS line — rows can draw from different groups. */
  groupId: string;
  itemId: string;
  qty: string;
  unit: string;
  remark: string;
}

const makeEmptyLine = (): Line => ({
  uid: newUid(),
  groupId: "",
  itemId: "",
  // Genuinely empty: LineGrid appends a blank row whenever the last stops being
  // blank, so a default here would append forever.
  qty: "",
  unit: "",
  remark: "",
});

const isLineBlank = (l: Line) => !l.groupId && !l.itemId && !l.qty && !l.remark;

/**
 * Stage 1 — raise a Purchase Request. Pick the buyer Company + one Category, then
 * fill the grid: each row picks its Item Group and Item, and Tab/Enter off the
 * end of a row starts the next one. Missing masters requested inline.
 */
export default function NewRequest() {
  const s = useProcurementStore();
  const navigate = useNavigate();

  const [companyId, setCompanyId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [lines, setLines] = useState<Line[]>([makeEmptyLine()]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [requested, setRequested] = useState<string | null>(null);
  const [raise, setRaise] = useState<{ mt: MasterType; prefill: MasterValues } | null>(null);

  const companyOptions: ComboOption[] = useMemo(
    () => s.activeCompanies.map((c) => ({ value: c.id, label: c.location ? `${c.name} — ${c.location}` : c.name })),
    [s.activeCompanies]
  );
  const categoryOptions: ComboOption[] = useMemo(
    () => s.activeCategories.map((c) => ({ value: c.id, label: c.name })),
    [s.activeCategories]
  );
  const groupOptions: ComboOption[] = useMemo(
    () => (categoryId ? s.itemGroupsByCategory(categoryId).filter((g) => g.active).map((g) => ({ value: g.id, label: g.name })) : []),
    [categoryId, s]
  );
  /** Item options for a row = its group's items, minus ones another row already took. */
  const itemOptionsFor = (line: Line): ComboOption[] => {
    if (!line.groupId) return [];
    const taken = new Set(lines.filter((l) => l.uid !== line.uid && l.itemId).map((l) => l.itemId));
    return s
      .itemsByGroup(line.groupId)
      .filter((it) => it.active && !taken.has(it.id))
      .map((it) => ({ value: it.id, label: it.name, sublabel: it.unit || undefined }));
  };

  /** Missing from a dropdown? Raise it as a master request, prefilled with what
   *  was typed plus the parent the form already knows. */
  const raiseGroup = (name: string) => {
    if (!categoryId) {
      setErr("Pick a category first.");
      return;
    }
    setRaise({ mt: "item_group", prefill: { name, category_id: categoryId } });
  };
  const raiseItem = (line: Line) => (name: string) => {
    if (!line.groupId) return;
    setRaise({ mt: "item", prefill: { name, item_group_id: line.groupId } });
  };

  const filled = lines.filter((l) => !isLineBlank(l));

  const columns: LineGridColumn<Line>[] = [
    {
      key: "group",
      header: "Item Group",
      className: "w-48",
      cell: (row, api) => (
        <Combobox
          ref={api.focusRef as (el: ComboboxHandle | null) => void}
          value={row.groupId}
          onChange={(v) => {
            // A new group invalidates the item chosen under the old one.
            api.patch({ groupId: v, itemId: "", unit: "" });
            api.advance();
          }}
          options={groupOptions}
          placeholder={categoryId ? "Item group…" : "Pick a category first"}
          disabled={!categoryId}
          searchable
          triggerClassName="px-2.5 py-1.5 text-[13.5px]"
          onTriggerKeyDown={api.keyHandler}
          onCreate={raiseGroup}
          createLabel={(q) => `Request new item group “${q}”`}
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
            const it = s.itemById(v);
            if (it) api.patch({ itemId: v, unit: it.unit, qty: row.qty || "1" });
            api.advance();
          }}
          options={itemOptionsFor(row)}
          placeholder={row.groupId ? "Search & select an item…" : "Pick a group first"}
          disabled={!row.groupId}
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
      className: "w-32",
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
      className: "min-w-[160px]",
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

  const submit = async () => {
    setErr(null);
    if (!companyId) return setErr("Select a company.");
    if (!categoryId) return setErr("Select a category.");
    if (filled.length === 0) return setErr("Add at least one item line.");
    if (filled.some((l) => !l.itemId)) return setErr("Every line needs an item.");
    if (filled.some((l) => !(Number(l.qty) > 0))) return setErr("Every line needs a quantity > 0.");

    setBusy(true);
    try {
      const id = await s.submitRequest({
        companyId,
        categoryId,
        note: note.trim() || null,
        items: filled.map((l) => ({ itemId: l.itemId, quantity: Number(l.qty), unit: l.unit, lineRemark: l.remark.trim() || null })),
      });
      navigate(`/procurement/requests/${id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-[22px] font-bold text-navy">New Purchase Request</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">Pick the company and category, then add the items you need.</p>
      </div>

      <Card className="p-5 space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
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
          <FieldLabel label="Category" required>
            <Combobox
              value={categoryId}
              onChange={(v) => {
                // Groups are category-scoped, so the whole grid resets with it.
                setCategoryId(v);
                setLines([makeEmptyLine()]);
              }}
              options={categoryOptions}
              placeholder="Select category"
              onCreate={(name) => setRaise({ mt: "category", prefill: { name } })}
              createLabel={(q) => `Request new category “${q}”`}
              autoAdvance
            />
          </FieldLabel>
        </div>

        {categoryId && (
          <div className="space-y-2">
            <LineGrid
              rows={lines}
              onRowsChange={setLines}
              columns={columns}
              makeEmptyRow={makeEmptyLine}
              isRowBlank={isLineBlank}
            />
            <p className="text-[12px] text-grey-2">
              Press Tab or Enter at the end of a row to start the next one. Missing an item or group? Type its name to request it.
            </p>
            {requested && <p className="text-[12px] text-teal">Requested {requested} — selectable once the master's owner approves it.</p>}
          </div>
        )}

        <FieldLabel label="Note (optional)">
          <TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything the purchase team should know" />
        </FieldLabel>

        {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}

        <div className="flex items-center gap-3">
          <Button onClick={submit} disabled={busy}>{busy ? "Submitting…" : "Submit request"}</Button>
          <span className="text-[12.5px] text-grey-2">{lines.length} item{lines.length === 1 ? "" : "s"}</span>
        </div>
      </Card>

      <RequestMasterModal
        open={raise !== null}
        onClose={() => setRaise(null)}
        masterType={raise?.mt ?? null}
        lockType
        prefill={raise?.prefill}
        onRequested={(_id, mt, name) => setRequested(`${masterTypeLabel(mt).toLowerCase()} “${name}”`)}
      />
    </div>
  );
}
