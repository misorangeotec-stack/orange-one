import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import RequestMasterModal from "../../components/RequestMasterModal";
import { masterTypeLabel, type MasterValues } from "../../lib/masterFields";
import type { MasterType } from "../../types";
import { useImportStore } from "../../store";

interface Line {
  itemId: string;
  qty: string;
  unit: string;
  /** Rate in the vendor's foreign currency (prefilled from the price master, editable). */
  rate: string;
  remark: string;
}

/**
 * Stage 1 — raise an Import Purchase Request. Import has FIXED vendors and fixed
 * vendor-item pricing, so there is no sourcing: pick Company → Vendor → Category,
 * then add items whose rate auto-fills from the price master (editable). A live
 * foreign→INR exchange rate (from xe.com via the Edge Function, editable) turns
 * each line into an INR value so the approval tier can route it. A missing price
 * is requested inline.
 */
export default function NewRequest() {
  const s = useImportStore();
  const navigate = useNavigate();

  const [companyId, setCompanyId] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [note, setNote] = useState("");
  const [currency, setCurrency] = useState("");
  const [fxRate, setFxRate] = useState("");
  const [fxSource, setFxSource] = useState<string | null>(null);
  const [fxBusy, setFxBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [requested, setRequested] = useState<string | null>(null);
  const [raise, setRaise] = useState<{ mt: MasterType; prefill: MasterValues } | null>(null);

  const companyOptions: ComboOption[] = useMemo(
    () => s.activeCompanies.map((c) => ({ value: c.id, label: c.location ? `${c.name} — ${c.location}` : c.name })),
    [s.activeCompanies]
  );
  const vendorOptions: ComboOption[] = useMemo(
    () => s.activeVendors.map((v) => ({ value: v.id, label: v.defaultCurrency ? `${v.name} (${v.defaultCurrency})` : v.name })),
    [s.activeVendors]
  );
  const categoryOptions: ComboOption[] = useMemo(
    () => s.activeCategories.map((c) => ({ value: c.id, label: c.name })),
    [s.activeCategories]
  );

  // Items under the chosen category that have an active price for the chosen vendor.
  const itemOptions: ComboOption[] = useMemo(() => {
    if (!vendorId || !categoryId) return [];
    const added = new Set(lines.map((l) => l.itemId));
    const groupIds = new Set(s.itemGroupsByCategory(categoryId).filter((g) => g.active).map((g) => g.id));
    return s
      .pricedItemsForVendor(vendorId)
      .filter((it) => groupIds.has(it.itemGroupId) && !added.has(it.id))
      .map((it) => ({ value: it.id, label: it.name, sublabel: it.unit || undefined }));
  }, [vendorId, categoryId, lines, s]);

  // When the vendor changes, adopt its default currency and pull a live FX rate.
  const loadFx = async (ccy: string) => {
    if (!ccy) return;
    setFxBusy(true);
    setErr(null);
    try {
      const r = await s.fetchFxRate(ccy, "INR");
      setFxRate(String(r.rate));
      setFxSource(r.source);
    } catch (e) {
      setFxSource(null);
      setErr(`Couldn't fetch a live ${ccy}→INR rate — enter it manually. (${(e as Error).message})`);
    } finally {
      setFxBusy(false);
    }
  };

  const onPickVendor = (vid: string) => {
    setVendorId(vid);
    setLines([]); // prices are vendor-specific — clear lines on vendor change
    const v = s.vendorById(vid);
    const ccy = v?.defaultCurrency || "";
    setCurrency(ccy);
    setFxRate("");
    setFxSource(null);
    if (ccy) void loadFx(ccy);
  };

  const addItemLine = (itemId: string) => {
    if (!itemId) return;
    const it = s.itemById(itemId);
    if (!it) return;
    if (lines.some((l) => l.itemId === itemId)) return;
    const price = s.priceFor(vendorId, itemId);
    // Guard single-currency: a price in another currency shouldn't mix into the request.
    if (price && currency && price.currency && price.currency !== currency) {
      setErr(`${it.name} is priced in ${price.currency}, but this request is in ${currency}. Keep one currency per request.`);
      return;
    }
    setLines((prev) => [
      ...prev,
      {
        itemId,
        qty: "1",
        unit: it.unit,
        rate: price ? String(price.rate) : "",
        remark: "",
      },
    ]);
    setErr(null);
  };

  const raiseItem = (name: string) => {
    // No group step in Import — request the item under the category's first group if any.
    const grp = categoryId ? s.itemGroupsByCategory(categoryId).filter((g) => g.active)[0] : undefined;
    if (!grp) {
      setErr("Pick a category with at least one item group first.");
      return;
    }
    setRaise({ mt: "item", prefill: { name, item_group_id: grp.id } });
  };

  const raisePrice = () => {
    if (!vendorId) return;
    setRaise({ mt: "vendor_item_price", prefill: { vendor_id: vendorId, currency: currency || "USD" } });
  };

  // No GST on an import line — the value is simply qty × rate (× fx for INR).
  const lineInr = (l: Line): number => {
    const qty = Number(l.qty) || 0;
    const rate = Number(l.rate) || 0;
    const fx = Number(fxRate) || 0;
    return qty * rate * fx;
  };
  const totalInr = lines.reduce((a, l) => a + lineInr(l), 0);
  const totalFx = lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0);
  const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

  const submit = async () => {
    setErr(null);
    if (!companyId) return setErr("Select a company.");
    if (!vendorId) return setErr("Select a vendor.");
    if (!categoryId) return setErr("Select a category.");
    if (!currency.trim()) return setErr("Set the currency (from the vendor's default).");
    if (!(Number(fxRate) > 0)) return setErr("A valid exchange rate is required.");
    if (lines.length === 0) return setErr("Add at least one item line.");
    if (lines.some((l) => !(Number(l.qty) > 0))) return setErr("Every line needs a quantity > 0.");
    if (lines.some((l) => l.rate.trim() === "" || !(Number(l.rate) >= 0))) return setErr("Every line needs a rate.");

    setBusy(true);
    try {
      const id = await s.submitRequest({
        companyId,
        vendorId,
        categoryId,
        currency: currency.trim().toUpperCase(),
        fxRate: Number(fxRate),
        note: note.trim() || null,
        items: lines.map((l) => ({
          itemId: l.itemId,
          quantity: Number(l.qty),
          unit: l.unit,
          rate: Number(l.rate),
          lineRemark: l.remark.trim() || null,
        })),
      });
      navigate(`/import/requests/${id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-[22px] font-bold text-navy">New Import Request</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">Pick the company, the vendor and a category, then add items — the rate auto-fills from the price list.</p>
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
        </div>

        {vendorId && (
          <div className="grid sm:grid-cols-3 gap-4">
            <FieldLabel label="Currency" required>
              <TextInput value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} placeholder="e.g. USD" />
            </FieldLabel>
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
            Rate {fxSource === "manual" ? "entered manually" : `from ${fxSource}`}. You can edit it before submitting.
          </p>
        )}

        {vendorId && (
          <FieldLabel label="Category" required>
            <Combobox
              value={categoryId}
              onChange={(v) => setCategoryId(v)}
              options={categoryOptions}
              placeholder="Select category"
              onCreate={(name) => setRaise({ mt: "category", prefill: { name } })}
              createLabel={(q) => `Request new category “${q}”`}
              autoAdvance
            />
          </FieldLabel>
        )}

        {vendorId && categoryId && (
          <div className="rounded-xl border border-line p-4 space-y-3 bg-page/30">
            <FieldLabel label="Item">
              <Combobox
                value=""
                onChange={addItemLine}
                options={itemOptions}
                placeholder={itemOptions.length === 0 ? "No priced items for this vendor in this category" : "Search & select an item…"}
                onCreate={raiseItem}
                createLabel={(q) => `Request new item “${q}”`}
                searchable
              />
              <p className="text-[12px] text-grey-2 mt-1">
                Only items with a price for this vendor appear. Missing one?{" "}
                <button type="button" className="text-teal underline" onClick={raisePrice}>Request a vendor-item price</button>.
              </p>
            </FieldLabel>
            {requested && <p className="text-[12px] text-teal">Requested {requested} — selectable once the master's owner approves it.</p>}
          </div>
        )}

        {lines.length > 0 && (
          <div className="rounded-xl border border-line overflow-hidden">
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="text-left text-grey-2 border-b border-line bg-page/60">
                  <th className="font-medium px-3 py-2">Item</th>
                  <th className="font-medium px-3 py-2 w-20">Qty</th>
                  <th className="font-medium px-3 py-2 w-28">Rate ({currency || "—"})</th>
                  <th className="font-medium px-3 py-2">Line (₹)</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.itemId} className="border-b border-line/70 last:border-0">
                    <td className="px-3 py-2 font-medium text-navy">{s.itemLabel(l.itemId)}</td>
                    <td className="px-3 py-2">
                      <TextInput type="number" className="w-16" value={l.qty} onChange={(e) => setLines((p) => p.map((x, idx) => (idx === i ? { ...x, qty: e.target.value } : x)))} />
                    </td>
                    <td className="px-3 py-2">
                      <TextInput type="number" className="w-24" value={l.rate} onChange={(e) => setLines((p) => p.map((x, idx) => (idx === i ? { ...x, rate: e.target.value } : x)))} />
                    </td>
                    <td className="px-3 py-2 text-grey">{inr(lineInr(l))}</td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => setLines((p) => p.filter((_, idx) => idx !== i))} className="text-grey-2 hover:text-ryg-red" aria-label="Remove">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {lines.length > 0 && (
          <div className="flex items-center justify-end gap-6 text-[13px]">
            <span className="text-grey-2">Total: <span className="font-semibold text-navy">{currency} {totalFx.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span></span>
            <span className="text-grey-2">≈ <span className="font-semibold text-navy">{inr(totalInr)}</span></span>
          </div>
        )}

        <FieldLabel label="Note (optional)">
          <TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything the import team should know" />
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
