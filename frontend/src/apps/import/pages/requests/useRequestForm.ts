import { useMemo, useRef, useState } from "react";
import type { ComboOption } from "@/shared/components/ui/Combobox";
import { newUid, type LineGridRow } from "@/shared/components/ui/LineGrid";
import type { MasterValues } from "../../lib/masterFields";
import type { MasterType, RequestItem } from "../../types";
import { useImportStore } from "../../store";

/**
 * Everything the New Request and Edit Request screens have in common: the form
 * state, the price/FX derivation, the money maths, validation, and the
 * save-to-price-list side effect. The two pages differ only in how they seed
 * this state and what they do on submit.
 */

export interface RequestLine extends LineGridRow {
  /**
   * The existing `fms_import_request_items.id`, or null for a row the user just
   * added. Deliberately separate from LineGrid's `uid`: `uid` is React identity
   * and must stay stable across edits, while `dbId` answers "does this row
   * already exist on the server?".
   */
  dbId: string | null;
  /** Category of THIS line — rows are free to differ. */
  categoryId: string;
  itemId: string;
  qty: string;
  unit: string;
  /** Rate in the vendor's foreign currency (prefilled from the price master, editable). */
  rate: string;
  /** Push this rate back into the vendor-item price master on save. */
  savePrice: boolean;
  remark: string;
}

export const makeEmptyLine = (): RequestLine => ({
  uid: newUid(),
  dbId: null,
  categoryId: "",
  itemId: "",
  // Genuinely empty — LineGrid appends a fresh blank row whenever the last one
  // stops being blank, so a pre-filled default here would loop forever.
  qty: "",
  unit: "",
  rate: "",
  savePrice: false,
  remark: "",
});

/** Note `dbId` is NOT tested: a hydrated row is only blank if the user emptied it. */
export const isLineBlank = (l: RequestLine) =>
  !l.categoryId && !l.itemId && !l.qty && !l.rate && !l.remark;

/** Turn a saved line into a grid row. Fresh `uid`, DB id kept in `dbId`. */
export const hydrateLine = (item: RequestItem): RequestLine => ({
  uid: newUid(),
  dbId: item.id,
  categoryId: item.categoryId ?? "",
  itemId: item.itemId,
  qty: String(item.finalQty ?? item.quantity ?? ""),
  unit: item.unit ?? "",
  rate: item.finalRate !== null ? String(item.finalRate) : "",
  savePrice: false,
  remark: item.lineRemark ?? "",
});

export interface RequestFormInit {
  requestId: string;
  companyId: string;
  vendorId: string;
  currency: string;
  fxRate: string;
  note: string;
  lines: RequestLine[];
}

export function useRequestForm(opts: { mode: "new" | "edit"; init?: RequestFormInit | null }) {
  const { mode, init } = opts;
  const s = useImportStore();

  const [companyId, setCompanyId] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [lines, setLines] = useState<RequestLine[]>([makeEmptyLine()]);
  const [note, setNote] = useState("");
  const [currency, setCurrency] = useState("");
  const [fxRate, setFxRate] = useState("");
  const [fxSource, setFxSource] = useState<string | null>(null);
  const [fxBusy, setFxBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [requested, setRequested] = useState<string | null>(null);
  const [raise, setRaise] = useState<{ mt: MasterType; prefill: MasterValues } | null>(null);

  /**
   * Seed the form from a saved request exactly ONCE. The store rebuilds
   * `s.requests` on every invalidate(), so a plain effect keyed on the request
   * object would wipe whatever the user is halfway through typing after any
   * background refetch.
   */
  const hydrated = useRef<string | null>(null);
  if (init && hydrated.current !== init.requestId) {
    hydrated.current = init.requestId;
    setCompanyId(init.companyId);
    setVendorId(init.vendorId);
    setCurrency(init.currency);
    setFxRate(init.fxRate);
    setNote(init.note);
    setLines(init.lines.length > 0 ? init.lines : [makeEmptyLine()]);
  }

  const canPrice = s.canManage("vendor_item_price");

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

  /**
   * The live price master currently holds a zero rate for every item, so a
   * rate of 0 means "not priced yet", not "free". Treating it as a real price
   * would silently stamp ₹0 on every line.
   */
  const livePrice = (itemId: string) => {
    const p = s.priceFor(vendorId, itemId);
    return p && p.rate > 0 ? p : undefined;
  };

  /** Items under a row's category, priced or not; already-added ones drop out. */
  const itemOptionsFor = (line: RequestLine): ComboOption[] => {
    if (!line.categoryId) return [];
    const taken = new Set(lines.filter((l) => l.uid !== line.uid && l.itemId).map((l) => l.itemId));
    return s.itemsForCategory(line.categoryId)
      .filter((it) => !taken.has(it.id))
      .map((it) => {
        const p = livePrice(it.id);
        return {
          value: it.id,
          label: it.name,
          sublabel: p ? `${p.currency} ${p.rate} · ${it.unit || "—"}` : `No price — enter a rate${it.unit ? ` · ${it.unit}` : ""}`,
        };
      });
  };

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

  /**
   * Only meaningful when raising a request: it CLEARS every line, because prices
   * are vendor-specific. Edit mode renders Vendor read-only and never calls
   * this — that is why the vendor is locked there rather than defended with a
   * "first hydration" flag that someone would eventually get wrong.
   */
  const onPickVendor = (vid: string) => {
    setVendorId(vid);
    setLines([makeEmptyLine()]);
    const v = s.vendorById(vid);
    const ccy = v?.defaultCurrency || "";
    setCurrency(ccy);
    setFxRate("");
    setFxSource(null);
    if (ccy) void loadFx(ccy);
  };

  /** Picking an item seeds unit + rate; qty defaults to 1 here, never in the blank row. */
  const onPickItem = (line: RequestLine, itemId: string, patch: (n: Partial<RequestLine>) => void) => {
    const it = s.itemById(itemId);
    if (!it) return;
    const p = livePrice(itemId);
    // Guard single-currency: a price in another currency shouldn't mix into the request.
    if (p && currency && p.currency && p.currency !== currency) {
      setErr(`${it.name} is priced in ${p.currency}, but this request is in ${currency}. Keep one currency per request.`);
      return;
    }
    setErr(null);
    patch({
      itemId,
      unit: it.unit,
      qty: line.qty || "1",
      rate: p ? String(p.rate) : "",
      savePrice: false,
    });
  };

  const raiseItem = (line: RequestLine) => (name: string) => {
    // No group step in Import — request the item under the category's first group.
    const grp = line.categoryId ? s.itemGroupsByCategory(line.categoryId).filter((g) => g.active)[0] : undefined;
    if (!grp) {
      setErr("Pick a category with at least one item group first.");
      return;
    }
    setRaise({ mt: "item", prefill: { name, item_group_id: grp.id } });
  };

  // No GST on an import line — the value is simply qty × rate (× fx for INR).
  const lineFx = (l: RequestLine) => (Number(l.qty) || 0) * (Number(l.rate) || 0);
  const lineInr = (l: RequestLine) => lineFx(l) * (Number(fxRate) || 0);

  const filled = lines.filter((l) => !isLineBlank(l));
  const totalFx = filled.reduce((a, l) => a + lineFx(l), 0);
  const totalInr = filled.reduce((a, l) => a + lineInr(l), 0);
  const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  /**
   * Foreign amounts carry their own symbol ($10,000.00) so a line never reads as
   * a bare number next to a ₹ one. The vendor's currency is free text, so fall
   * back to the plain code if it isn't a currency Intl recognises.
   */
  const fx = (n: number) => {
    const code = currency.trim().toUpperCase();
    try {
      return n.toLocaleString("en-IN", { style: "currency", currency: code, currencyDisplay: "narrowSymbol" });
    } catch {
      const amt = n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return code ? `${code} ${amt}` : amt;
    }
  };

  /** Does this row's rate differ from what the price master holds? */
  const rateIsNew = (l: RequestLine) => {
    if (!l.itemId || l.rate.trim() === "") return false;
    const p = livePrice(l.itemId);
    return !p || Number(l.rate) !== p.rate;
  };
  /** A non-manager can only REQUEST a brand-new price, not a change to one. */
  const canOfferSave = (l: RequestLine) => rateIsNew(l) && (canPrice || !livePrice(l.itemId));

  /** One rule set for both pages. Returns the message, or null when valid. */
  const validate = (): string | null => {
    if (!companyId) return "Select a company.";
    if (!vendorId) return "Select a vendor.";
    if (!currency.trim()) return "Set the currency (from the vendor's default).";
    if (!(Number(fxRate) > 0)) return "A valid exchange rate is required.";
    if (filled.length === 0) return "Add at least one item line.";
    if (filled.some((l) => !l.categoryId)) return "Every line needs a category.";
    if (filled.some((l) => !l.itemId)) return "Every line needs an item.";
    if (filled.some((l) => !(Number(l.qty) > 0))) return "Every line needs a quantity > 0.";
    if (filled.some((l) => l.rate.trim() === "" || !(Number(l.rate) >= 0))) return "Every line needs a rate.";
    return null;
  };

  /**
   * Push the ticked rates back to the vendor-item price master. Call this AFTER
   * the request itself is saved — a price-list write is a side effect and must
   * never gate the request. Returns one message per failure; an empty array
   * means everything landed.
   */
  const savePriceList = async (): Promise<string[]> => {
    const ccy = currency.trim().toUpperCase();
    const failures: string[] = [];
    for (const l of filled.filter((x) => x.savePrice && canOfferSave(x))) {
      try {
        if (canPrice) {
          await s.saveVendorItemPrice({ vendorId, itemId: l.itemId, currency: ccy, rate: Number(l.rate) });
        } else {
          await s.requestNewMaster("vendor_item_price", {
            vendor_id: vendorId,
            item_id: l.itemId,
            currency: ccy,
            rate: String(l.rate),
          });
        }
      } catch (e) {
        const msg = (e as Error).message ?? "";
        failures.push(
          `${s.itemLabel(l.itemId)}: ${/duplicate key|23505/i.test(msg) ? "already requested — awaiting review" : msg}`
        );
      }
    }
    return failures;
  };

  return {
    mode,
    // state
    companyId, setCompanyId,
    vendorId, setVendorId,
    lines, setLines,
    note, setNote,
    currency, setCurrency,
    fxRate, setFxRate,
    fxSource, setFxSource,
    fxBusy,
    err, setErr,
    requested, setRequested,
    raise, setRaise,
    // options
    companyOptions, vendorOptions, categoryOptions,
    // behaviour
    canPrice, livePrice, itemOptionsFor, loadFx, onPickVendor, onPickItem, raiseItem,
    lineFx, lineInr, filled, totalFx, totalInr, inr, fx, canOfferSave,
    validate, savePriceList,
  };
}

export type RequestFormApi = ReturnType<typeof useRequestForm>;
