import type { Category } from "../types";

/**
 * Seed purchase categories ↔ unit, from the "Validation" tab of the source sheet.
 * Selecting a category auto-fills the unit on the New Order form. Admin can edit
 * this list in Settings → Categories (mock in Phase 1; a master table in Phase 2).
 */
export const SEED_CATEGORIES: Category[] = [
  { id: "cat-raw", name: "RAW MATERIAL", unit: "KGS" },
  { id: "cat-packing", name: "PACKING MATERIAL", unit: "PCS" },
  { id: "cat-cartridge", name: "CARTRIDGE/FILTER", unit: "PCS" },
];
