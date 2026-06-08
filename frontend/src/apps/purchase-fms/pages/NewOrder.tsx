import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Combobox from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import { useFmsStore } from "../mock/store";

/**
 * Stage 1 — Generate Order. Pick a category (which auto-fills the unit), type the
 * item name (free text), set the quantity. Creating the order completes Stage 1
 * and hands the entry to the Approval owner's queue.
 */
export default function NewOrder() {
  const navigate = useNavigate();
  const { categories, createEntry } = useFmsStore();
  const [categoryId, setCategoryId] = useState("");
  const [itemName, setItemName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const category = categories.find((c) => c.id === categoryId);
  const unit = category?.unit ?? "";

  const submit = async () => {
    if (!category) return setError("Please select a category.");
    if (!itemName.trim()) return setError("Please enter the item name.");
    const qty = Number(quantity);
    if (!qty || qty <= 0) return setError("Please enter a valid quantity.");
    setError(null);
    setSaving(true);
    try {
      const id = await createEntry({ category: category.name, itemName: itemName.trim(), quantity: qty, unit, remarks: remarks.trim() });
      navigate(`/purchase-fms/entries/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the order. You may not be an owner of the Generate Order step.");
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h2 className="text-[22px] font-bold text-navy">New Order</h2>
        <p className="text-grey text-[13px] mt-1">Raise a new purchase requirement. This starts the 9-stage pipeline.</p>
      </div>

      <Card className="p-5 space-y-4">
        <FieldLabel label="Category" required hint="Drives the unit">
          <Combobox
            value={categoryId}
            onChange={setCategoryId}
            placeholder="Select category…"
            options={categories.map((c) => ({ value: c.id, label: c.name, sublabel: `Unit: ${c.unit}` }))}
          />
        </FieldLabel>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="sm:col-span-2">
            <FieldLabel label="Item Name" required>
              <TextInput value={itemName} placeholder="e.g. CL-6" onChange={(e) => setItemName(e.target.value)} />
            </FieldLabel>
          </div>
          <FieldLabel label="Quantity" required>
            <TextInput type="number" min={0} value={quantity} placeholder="0" onChange={(e) => setQuantity(e.target.value)} />
          </FieldLabel>
        </div>

        <FieldLabel label="Unit" hint="Auto from category">
          <TextInput value={unit} readOnly placeholder="—" className="bg-page text-grey-2 cursor-not-allowed" />
        </FieldLabel>

        <FieldLabel label="Remarks">
          <TextArea rows={2} value={remarks} placeholder="Any notes for this order…" onChange={(e) => setRemarks(e.target.value)} />
        </FieldLabel>

        {error && <p className="text-[12.5px] text-ryg-red font-medium">{error}</p>}

        <div className="flex items-center gap-2.5 pt-1">
          <Button onClick={submit} disabled={saving}>{saving ? "Creating…" : "Generate order"}</Button>
          <Button variant="ghost" onClick={() => navigate("/purchase-fms/entries")}>Cancel</Button>
        </div>
      </Card>
    </div>
  );
}
