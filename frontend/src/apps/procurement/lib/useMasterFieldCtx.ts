import { useEffect, useMemo } from "react";
import type { ComboOption } from "@/shared/components/ui/Combobox";
import type { MasterFieldCtx } from "./masterFields";
import { useProcurementStore } from "../store";

/**
 * The option lists every master form needs, in one place.
 *
 * Three screens (RequestMasterModal, MasterRequests, Masters) built this object
 * independently. They agree today, but that is exactly the shape that drifted in
 * Import and left the vendor-item-price form with empty Vendor/Item pickers.
 * Sharing one hook removes the chance of a fourth caller (or an edit to one of
 * the three) quietly dropping a list.
 *
 * `withItemBooks` — the vendor-item RATE form picks from every company's Tally
 * stock book, and those load on demand (store.ensureItemBook). Pass true only
 * where that form can actually open: O-tec — Surat alone is 8,000+ items, and
 * nothing else on these screens needs a book.
 */
export function useMasterFieldCtx(opts: { withItemBooks?: boolean } = {}): MasterFieldCtx {
  const s = useProcurementStore();
  const { withItemBooks = false } = opts;

  useEffect(() => {
    if (!withItemBooks) return;
    for (const c of s.activeCompanies) s.ensureItemBook(c.id);
  }, [withItemBooks, s]);

  const categoryOptions: ComboOption[] = useMemo(
    () => s.activeCategories.map((c) => ({ value: c.id, label: c.name })),
    [s.activeCategories]
  );
  const companyOptions: ComboOption[] = useMemo(
    () => s.activeCompanies.map((c) => ({ value: c.id, label: s.companyLabel(c.id) })),
    [s]
  );
  const unitOptions: ComboOption[] = useMemo(
    () => s.unitNames.map((u) => ({ value: u, label: u })),
    [s.unitNames]
  );
  // A firm has a ledger per company book, so the same name can appear twice —
  // the book is the sublabel that tells them apart.
  const vendorOptions: ComboOption[] = useMemo(
    () =>
      s.vendors
        .filter((v) => v.active)
        .map((v) => ({ value: v.id, label: v.name, sublabel: v.companyId ? s.companyLabel(v.companyId) : "Not in Tally yet" })),
    [s]
  );
  const itemOptions: ComboOption[] = useMemo(
    () =>
      s.items
        .filter((i) => i.active)
        .map((i) => ({ value: i.id, label: i.name, sublabel: i.companyId ? s.companyLabel(i.companyId) : undefined })),
    [s]
  );

  return useMemo(
    () => ({ categoryOptions, companyOptions, unitOptions, vendorOptions, itemOptions }),
    [categoryOptions, companyOptions, unitOptions, vendorOptions, itemOptions]
  );
}
