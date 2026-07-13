import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import RequestMasterModal from "../../components/RequestMasterModal";
import { masterTypeLabel, type MasterValues } from "../../lib/masterFields";
import type { MasterType } from "../../types";
import { useProcurementStore } from "../../store";

interface Line {
  itemId: string;
  qty: string;
  unit: string;
  remark: string;
}

/**
 * Stage 1 — raise a Purchase Request. Pick the buyer Company + one Category, then
 * add item lines from the category's Item Groups. Picking a group exposes a
 * searchable **Item dropdown**; each pick adds one line (groups can hold many
 * items, so it's a dropdown, not a checklist). Missing masters requested inline.
 */
export default function NewRequest() {
  const s = useProcurementStore();
  const navigate = useNavigate();

  const [companyId, setCompanyId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
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
  const groupItems = useMemo(() => (groupId ? s.itemsByGroup(groupId).filter((i) => i.active) : []), [groupId, s]);

  // Item dropdown options = the group's items not already added as a line.
  const itemOptions: ComboOption[] = useMemo(() => {
    const added = new Set(lines.map((l) => l.itemId));
    return groupItems
      .filter((it) => !added.has(it.id))
      .map((it) => ({ value: it.id, label: it.name, sublabel: it.unit || undefined }));
  }, [groupItems, lines]);

  const pickGroup = (gid: string) => setGroupId(gid);

  /** A dropdown pick adds one line (qty defaults to 1; edited in the list below). */
  const addItemLine = (itemId: string) => {
    if (!itemId) return;
    const it = s.itemById(itemId);
    if (!it) return;
    if (lines.some((l) => l.itemId === itemId)) return;
    setLines((prev) => [...prev, { itemId, qty: "1", unit: it.unit, remark: "" }]);
    setErr(null);
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
  const raiseItem = (name: string) => {
    if (!groupId) return;
    setRaise({ mt: "item", prefill: { name, item_group_id: groupId } });
  };

  const submit = async () => {
    setErr(null);
    if (!companyId) return setErr("Select a company.");
    if (!categoryId) return setErr("Select a category.");
    if (lines.length === 0) return setErr("Add at least one item line.");
    if (lines.some((l) => !(Number(l.qty) > 0))) return setErr("Every line needs a quantity > 0.");

    setBusy(true);
    try {
      const id = await s.submitRequest({
        companyId,
        categoryId,
        note: note.trim() || null,
        items: lines.map((l) => ({ itemId: l.itemId, quantity: Number(l.qty), unit: l.unit, lineRemark: l.remark.trim() || null })),
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
                setCategoryId(v);
                setGroupId("");
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
          <div className="rounded-xl border border-line p-4 space-y-3 bg-page/30">
            <FieldLabel label="Add items from an Item Group">
              <Combobox
                value={groupId}
                onChange={pickGroup}
                options={groupOptions}
                placeholder="Select item group"
                onCreate={raiseGroup}
                createLabel={(q) => `Request new item group “${q}”`}
                autoAdvance
              />
            </FieldLabel>

            {groupId && (
              <FieldLabel label="Item">
                <Combobox
                  value=""
                  onChange={addItemLine}
                  options={itemOptions}
                  placeholder={groupItems.length === 0 ? "No items in this group yet" : itemOptions.length === 0 ? "All items in this group added" : "Search & select an item…"}
                  onCreate={raiseItem}
                  createLabel={(q) => `Request new item “${q}”`}
                  searchable
                />
                <p className="text-[12px] text-grey-2 mt-1">Pick items one at a time — set quantities in the list below. Missing one? Type its name to request it.</p>
              </FieldLabel>
            )}
            {requested && <p className="text-[12px] text-teal">Requested {requested} — selectable once the master's owner approves it.</p>}
          </div>
        )}

        {/* Lines */}
        {lines.length > 0 && (
          <div className="rounded-xl border border-line overflow-hidden">
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="text-left text-grey-2 border-b border-line bg-page/60">
                  <th className="font-medium px-3 py-2">Item</th>
                  <th className="font-medium px-3 py-2 w-28">Qty</th>
                  <th className="font-medium px-3 py-2">Unit</th>
                  <th className="font-medium px-3 py-2">Remark</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.itemId} className="border-b border-line/70 last:border-0">
                    <td className="px-3 py-2 font-medium text-navy">{s.itemLabel(l.itemId)}</td>
                    <td className="px-3 py-2">
                      <TextInput type="number" className="w-24" value={l.qty} onChange={(e) => setLines((p) => p.map((x, idx) => (idx === i ? { ...x, qty: e.target.value } : x)))} />
                    </td>
                    <td className="px-3 py-2 text-grey">{l.unit || "—"}</td>
                    <td className="px-3 py-2">
                      <TextInput value={l.remark} placeholder="optional" onChange={(e) => setLines((p) => p.map((x, idx) => (idx === i ? { ...x, remark: e.target.value } : x)))} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => setLines((p) => p.filter((_, idx) => idx !== i))} className="text-grey-2 hover:text-ryg-red" aria-label="Remove">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
