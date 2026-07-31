import { useMemo, useRef, useState } from "react";
import type { ComboOption } from "@/shared/components/ui/Combobox";
import { newUid, type LineGridRow } from "@/shared/components/ui/LineGrid";
import type { MasterValues } from "../../lib/masterFields";
import { SHIPMENT_TYPES, type Item, type MasterType, type RequestItem } from "../../types";
import { useImportStore } from "../../store";

/**
 * Everything the New Request and Edit Request screens have in common: the form
 * state, the options, and validation. Import is a PURE QUANTITY REQUISITION —
 * there is no rate, no exchange rate, and no line value — so a line carries only
 * category / item / quantity / remark. The two pages differ only in how they
 * seed this state and what they do on submit.
 *
 * The line options are VENDOR-SCOPED: the Vendor-Item Mapping master decides
 * which items — and therefore which categories — a requisition may name, so
 * picking a vendor narrows both dropdowns and an unmapped item is unorderable.
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
  remark: "",
});

/**
 * A fresh row that carries the previous row's Category forward, so a requisition
 * of many items in one category is not "re-pick the category every line". Only
 * the classifier is inherited — item, qty, unit and remark stay empty, and the
 * user can still change category on the new row. Because `isLineBlank` ignores
 * category (see below), this inherited row still tests blank, so LineGrid keeps
 * treating it as the single trailing blank row.
 */
export const makeInheritedLine = (prev?: RequestLine): RequestLine => ({
  ...makeEmptyLine(),
  categoryId: prev?.categoryId ?? "",
});

/**
 * Blankness is item-level: a row is blank until it names an item, a qty or a
 * remark. Category is deliberately NOT tested — an inherited trailing row
 * carries it, and counting it would make LineGrid append blank rows forever
 * (and would flag the trailing row as an incomplete line).
 * `dbId` is NOT tested either: a hydrated row is only blank if the user emptied it.
 */
export const isLineBlank = (l: RequestLine) => !l.itemId && !l.qty && !l.remark;

/** Turn a saved line into a grid row. Fresh `uid`, DB id kept in `dbId`. */
export const hydrateLine = (item: RequestItem): RequestLine => ({
  uid: newUid(),
  dbId: item.id,
  categoryId: item.categoryId ?? "",
  itemId: item.itemId,
  qty: String(item.finalQty ?? item.quantity ?? ""),
  unit: item.unit ?? "",
  remark: item.lineRemark ?? "",
});

export interface RequestFormInit {
  requestId: string;
  companyId: string;
  vendorId: string;
  /** "" for a requisition raised before the field existed — the form then asks for it. */
  shipmentType: string;
  currency: string;
  note: string;
  lines: RequestLine[];
}

export function useRequestForm(opts: { mode: "new" | "edit"; init?: RequestFormInit | null }) {
  const { mode, init } = opts;
  const s = useImportStore();

  const [companyId, setCompanyId] = useState("");
  const [vendorId, setVendorId] = useState("");
  /** air | sea | lcl — how the consignment travels. Required to submit. */
  const [shipmentType, setShipmentType] = useState("");
  const [lines, setLines] = useState<RequestLine[]>([makeEmptyLine()]);
  const [note, setNote] = useState("");
  // Currency stays as a quiet vendor attribute recorded on the request — the
  // flow no longer converts or values anything, so it is never shown as money.
  const [currency, setCurrency] = useState("");
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
    setShipmentType(init.shipmentType);
    setCurrency(init.currency);
    setNote(init.note);
    setLines(init.lines.length > 0 ? init.lines : [makeEmptyLine()]);
  }

  const companyOptions: ComboOption[] = useMemo(
    () => s.activeCompanies.map((c) => ({ value: c.id, label: c.location ? `${c.name} — ${c.location}` : c.name })),
    [s.activeCompanies]
  );
  const vendorOptions: ComboOption[] = useMemo(
    () => s.activeVendors.map((v) => ({ value: v.id, label: v.defaultCurrency ? `${v.name} (${v.defaultCurrency})` : v.name })),
    [s.activeVendors]
  );
  /**
   * Categories the PICKED VENDOR supplies, plus any category a saved line still
   * points at.
   *
   * ⚠ That union is not cosmetic. Combobox renders its PLACEHOLDER when a value
   * matches no option (see Combobox.tsx), so on Edit a line whose category has
   * since been unmapped from the vendor would look blank — and saving would then
   * drop it silently. Same reasoning in `itemOptionsFor` below.
   */
  const categoryOptions: ComboOption[] = useMemo(() => {
    const scoped = s.categoriesForVendor(vendorId);
    const seen = new Set(scoped.map((c) => c.id));
    const out: ComboOption[] = scoped.map((c) => ({ value: c.id, label: c.name }));
    for (const l of lines) {
      if (!l.categoryId || seen.has(l.categoryId)) continue;
      seen.add(l.categoryId);
      const c = s.categoryById(l.categoryId);
      if (c) out.push({ value: c.id, label: c.name });
    }
    return out;
  }, [vendorId, lines, s]);
  /** Fixed, code-defined — a shipment mode is not master data anyone maintains. */
  const shipmentOptions: ComboOption[] = SHIPMENT_TYPES;

  /**
   * Does the picked vendor supply anything at all? Drives the grid's empty state
   * — with no mapping there is nothing to order, and an empty grid would look
   * broken rather than unconfigured.
   */
  const hasVendorItems = useMemo(() => s.itemsForVendor(vendorId).length > 0, [vendorId, s]);

  /**
   * Items the vendor supplies in this row's category; already-added ones drop
   * out, and the row's own item is kept visible even if its mapping is gone.
   */
  const itemOptionsFor = (line: RequestLine): ComboOption[] => {
    if (!line.categoryId) return [];
    const taken = new Set(lines.filter((l) => l.uid !== line.uid && l.itemId).map((l) => l.itemId));
    const opt = (it: Item): ComboOption => ({ value: it.id, label: it.name, sublabel: it.unit || "—" });
    const out = s
      .itemsForVendor(vendorId)
      .filter((it) => it.categoryId === line.categoryId && !taken.has(it.id))
      .map(opt);
    if (line.itemId && !out.some((o) => o.value === line.itemId)) {
      const own = s.itemById(line.itemId);
      if (own) out.push(opt(own));
    }
    return out;
  };

  /**
   * Only meaningful when raising a request: it CLEARS every line. Edit mode
   * renders Vendor read-only and never calls this — that is why the vendor is
   * locked there rather than defended with a "first hydration" flag.
   */
  const onPickVendor = (vid: string) => {
    setVendorId(vid);
    setLines([makeEmptyLine()]);
    const v = s.vendorById(vid);
    setCurrency(v?.defaultCurrency || "");
  };

  /** Picking an item seeds unit; qty defaults to 1 here, never in the blank row. */
  const onPickItem = (line: RequestLine, itemId: string, patch: (n: Partial<RequestLine>) => void) => {
    const it = s.itemById(itemId);
    if (!it) return;
    setErr(null);
    patch({ itemId, unit: it.unit, qty: line.qty || "1" });
  };

  const raiseItem = (line: RequestLine) => (name: string) => {
    if (!line.categoryId) {
      setErr("Pick a category first.");
      return;
    }
    setRaise({ mt: "item", prefill: { name, category_id: line.categoryId } });
  };

  const filled = lines.filter((l) => !isLineBlank(l));

  /** One rule set for both pages. Returns the message, or null when valid. */
  const validate = (): string | null => {
    if (!companyId) return "Select a company.";
    if (!vendorId) return "Select a vendor.";
    if (!shipmentType) return "Select how the shipment travels.";
    if (filled.length === 0) return "Add at least one item line.";
    if (filled.some((l) => !l.categoryId)) return "Every line needs a category.";
    if (filled.some((l) => !l.itemId)) return "Every line needs an item.";
    if (filled.some((l) => !(Number(l.qty) > 0))) return "Every line needs a quantity > 0.";
    return null;
  };

  return {
    mode,
    // state
    companyId, setCompanyId,
    vendorId, setVendorId,
    shipmentType, setShipmentType,
    lines, setLines,
    note, setNote,
    currency, setCurrency,
    err, setErr,
    requested, setRequested,
    raise, setRaise,
    // options
    companyOptions, vendorOptions, categoryOptions, shipmentOptions, hasVendorItems,
    // behaviour
    itemOptionsFor, onPickVendor, onPickItem, raiseItem,
    filled, validate,
  };
}

export type RequestFormApi = ReturnType<typeof useRequestForm>;
