import { useEffect, useMemo, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { FieldLabel } from "@/shared/components/ui/Form";
import { useImportStore } from "../store";
import type { MapVendorItemsResult } from "../data/importWrites";

const norm = (s: string) => s.trim().toUpperCase();

/**
 * MAP A VENDOR TO ITEMS — directly, with no approval.
 *
 * The Import twin of Order to Dispatch's MapCustomerItemModal. An item that is
 * missing from a requisition's Item list is almost never missing from the Import
 * item master; it is only not MAPPED to the vendor yet, and the person raising
 * the requisition is the one who knows the vendor supplies it. So they map it
 * here and carry on. Before this it was a "Vendor-Item Mapping" master request
 * that the master's owner had to approve.
 *
 * An item that is not in the master at all is still a request — that is a new
 * master entry, not a mapping — and the empty state offers exactly that.
 *
 * ⚠ IT LISTS THE WHOLE ITEM MASTER, not `itemsForVendor`. That selector is the
 *   vendor's mapped items, i.e. precisely the ones this modal must leave out.
 */
export default function MapVendorItemModal({
  open,
  onClose,
  /** Fixed by the requisition that opened this. Blank lets the user choose. */
  vendorId,
  /** Starting category filter — the row's category, when opened from a line. */
  categoryId,
  /** Raised from a picker — the text the user had typed into it. */
  initialSearch,
  stacked,
  onMapped,
  /** Offered when the typed item is not in the master at all. */
  onRequestNewItem,
}: {
  open: boolean;
  onClose: () => void;
  vendorId?: string | null;
  categoryId?: string | null;
  initialSearch?: string | null;
  stacked?: boolean;
  onMapped?: (result: MapVendorItemsResult, itemIds: string[], vendorId: string) => void;
  onRequestNewItem?: (name: string, categoryId: string) => void;
}) {
  const s = useImportStore();

  /* A requisition's vendor is FIXED here, not a default: mapping to another
     vendor would not make the item orderable on the requisition being raised. */
  const lockedVendor = !!vendorId;

  const [vendor, setVendor] = useState(vendorId ?? "");
  const [category, setCategory] = useState(categoryId ?? "");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setVendor(vendorId ?? "");
    setCategory(categoryId ?? "");
    setError(null);
    setBusy(false);
    // Typed a name that matches exactly one unmapped item? Tick it already —
    // that is what the person came here to do.
    const q = norm(initialSearch ?? "");
    const hits = q
      ? s.items.filter((i) => i.active && norm(i.name) === q && !mappedIds(vendorId ?? "").has(i.id))
      : [];
    setPicked(hits.length === 1 ? [hits[0].id] : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, vendorId, categoryId]);

  /** Items this vendor can already be ordered for — left out of the list. */
  function mappedIds(vid: string): Set<string> {
    return new Set(s.vendorItemPrices.filter((p) => p.vendorId === vid && p.active).map((p) => p.itemId));
  }
  const alreadyMapped = useMemo(() => mappedIds(vendor), [vendor, s.vendorItemPrices]); // eslint-disable-line react-hooks/exhaustive-deps

  const categoryOptions: ComboOption[] = useMemo(
    () => s.categories.filter((c) => c.active).map((c) => ({ value: c.id, label: c.name })).sort((a, b) => a.label.localeCompare(b.label)),
    [s.categories]
  );

  const options: MultiOption[] = useMemo(() => {
    const catName = (id: string) => s.categoryById(id)?.name ?? "";
    return s.items
      .filter((i) => i.active && !alreadyMapped.has(i.id) && (!category || i.categoryId === category))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((i) => ({
        value: i.id,
        label: i.unit ? `${i.name} · ${i.unit}` : i.name,
        // Grouped by category only when every category is shown.
        group: category ? undefined : catName(i.categoryId) || "No category",
      }));
  }, [s.items, alreadyMapped, category, s]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Where the typed name stands: not in the master, already mapped, or fine. */
  const typed = (initialSearch ?? "").trim();
  const typedState = useMemo(() => {
    if (!typed) return null;
    const same = s.items.filter((i) => norm(i.name) === norm(typed));
    if (same.length === 0) return "missing" as const;
    if (same.every((i) => alreadyMapped.has(i.id))) return "mapped" as const;
    if (same.every((i) => !i.active)) return "inactive" as const;
    return null;
  }, [typed, s.items, alreadyMapped]);

  const submit = async () => {
    if (!vendor) { setError("Pick the vendor first."); return; }
    if (picked.length === 0) { setError("Pick at least one item."); return; }
    setBusy(true);
    setError(null);
    try {
      const result = await s.mapVendorItems(vendor, picked);
      onMapped?.(result, picked, vendor);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the mapping.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Map items to a vendor"
      /* No "goes to X for approval" — there is no approval. */
      subtitle="Saved straight away — the items can be ordered from this vendor immediately."
      stacked={stacked}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || picked.length === 0 || !vendor}>
            {busy ? "Saving…" : picked.length > 1 ? `Map ${picked.length} items` : "Map item"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldLabel label="Vendor" required hint={lockedVendor ? "From the request you are raising." : undefined}>
            {lockedVendor ? (
              <div className="rounded-lg border border-line bg-page px-3 py-2 text-[13.5px] text-navy">
                {s.vendorLabel(vendor)}
              </div>
            ) : (
              <Combobox
                value={vendor}
                /* A different vendor has a different set already mapped, so the
                   selection below cannot survive the change. */
                onChange={(v) => { setVendor(v); setPicked([]); }}
                options={s.activeVendors.map((v) => ({ value: v.id, label: v.name }))}
                placeholder="Select vendor…"
                searchable
                wrapLabel
              />
            )}
          </FieldLabel>

          <FieldLabel label="Category">
            <Combobox
              value={category}
              /* Clears the selection: an item ticked under one category would
                 stay selected while invisible under another. */
              onChange={(v) => { setCategory(v); setPicked([]); }}
              options={categoryOptions}
              placeholder="All categories"
              clearable
              searchable={categoryOptions.length > 6}
            />
          </FieldLabel>
        </div>

        <FieldLabel
          label="Items"
          required
          hint="Pick as many as you like — each becomes one mapping. Items this vendor already supplies are left out."
        >
          <MultiSelect
            values={picked}
            onChange={setPicked}
            options={options}
            placeholder={!vendor ? "Pick a vendor first" : options.length === 0 ? "Nothing left to map here" : "Search items…"}
            disabled={!vendor}
            searchable
            chips
            maxRender={300}
          />
        </FieldLabel>

        {typedState === "missing" && (
          <div className="rounded-lg border border-line bg-page px-3 py-2.5 text-[13px] text-grey">
            “{typed}” is not in the Import item master, so there is nothing to map yet.
            {onRequestNewItem && (
              <>
                {" "}
                <button
                  type="button"
                  className="font-semibold text-orange hover:underline"
                  onClick={() => { onClose(); onRequestNewItem(typed, category); }}
                >
                  Request it as a new item
                </button>
                {" "}— once approved, map it here.
              </>
            )}
          </div>
        )}
        {typedState === "mapped" && (
          <p className="text-[13px] text-grey-2">
            “{typed}” is already mapped to this vendor — it is under another category on the request line.
          </p>
        )}
        {typedState === "inactive" && (
          <p className="text-[13px] text-yellow">
            “{typed}” is switched off in the item master. Ask a master manager to switch it back on.
          </p>
        )}

        {error && <p className="text-[13px] font-medium text-ryg-red">{error}</p>}
      </div>
    </Modal>
  );
}
