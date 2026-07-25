import { useMemo, useRef, useState } from "react";
import type { ComboOption } from "@/shared/components/ui/Combobox";
import { newUid, type LineGridRow } from "@/shared/components/ui/LineGrid";
import type { MasterValues } from "../../lib/masterFields";
import type { MasterType, RequestItem } from "../../types";
import { useImportStore } from "../../store";

/**
 * Everything the New Request and Edit Request screens have in common: the form
 * state, the options, and validation. Import is a PURE QUANTITY REQUISITION —
 * there is no rate, no exchange rate, and no line value — so a line carries only
 * category / item / quantity / remark. The two pages differ only in how they
 * seed this state and what they do on submit.
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

/** Note `dbId` is NOT tested: a hydrated row is only blank if the user emptied it. */
export const isLineBlank = (l: RequestLine) =>
  !l.categoryId && !l.itemId && !l.qty && !l.remark;

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
  currency: string;
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
  const categoryOptions: ComboOption[] = useMemo(
    () => s.activeCategories.map((c) => ({ value: c.id, label: c.name })),
    [s.activeCategories]
  );

  /** Items under a row's category; already-added ones drop out. */
  const itemOptionsFor = (line: RequestLine): ComboOption[] => {
    if (!line.categoryId) return [];
    const taken = new Set(lines.filter((l) => l.uid !== line.uid && l.itemId).map((l) => l.itemId));
    return s.itemsForCategory(line.categoryId)
      .filter((it) => !taken.has(it.id))
      .map((it) => ({ value: it.id, label: it.name, sublabel: it.unit || "—" }));
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
    // No group step in Import — request the item under the category's first group.
    const grp = line.categoryId ? s.itemGroupsByCategory(line.categoryId).filter((g) => g.active)[0] : undefined;
    if (!grp) {
      setErr("Pick a category with at least one item group first.");
      return;
    }
    setRaise({ mt: "item", prefill: { name, item_group_id: grp.id } });
  };

  const filled = lines.filter((l) => !isLineBlank(l));

  /** One rule set for both pages. Returns the message, or null when valid. */
  const validate = (): string | null => {
    if (!companyId) return "Select a company.";
    if (!vendorId) return "Select a vendor.";
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
    lines, setLines,
    note, setNote,
    currency, setCurrency,
    err, setErr,
    requested, setRequested,
    raise, setRaise,
    // options
    companyOptions, vendorOptions, categoryOptions,
    // behaviour
    itemOptionsFor, onPickVendor, onPickItem, raiseItem,
    filled, validate,
  };
}

export type RequestFormApi = ReturnType<typeof useRequestForm>;
