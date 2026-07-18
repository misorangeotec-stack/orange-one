import type { AppManifest } from "../types";
import { appName, appBasePath, appCategory, appSubGroup } from "../appInfo";
import ImportApp from "./ImportApp";

/**
 * Manifest for the Import Purchase FMS — a master-driven, multi-item import
 * workflow with FIXED vendors + fixed vendor-item pricing (no sourcing):
 * Request (company → vendor → items) → tiered Approval → vendor-wise PO →
 * Share PO → Collect PI → 100%-advance Payment (foreign currency + live FX) →
 * Follow-up → GRN → Tally. Built as a dedicated relational module (tables
 * prefixed `fms_import_`), separate from the domestic `procurement` app.
 */
export const importApp: AppManifest = {
  id: "import",
  name: appName("import"),
  description:
    "Import procurement: fixed vendors + vendor-item price list, foreign-currency POs with a live exchange rate, amount-tiered approval, and a 100%-advance payment step.",
  basePath: appBasePath("import"),
  status: "live",
  category: appCategory("import"),
  subGroup: appSubGroup("import"),
  order: 20,
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3h6a1 1 0 0 1 1 1v1h2a1 1 0 0 1 1 1v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a1 1 0 0 1 1-1h2V4a1 1 0 0 1 1-1z" />
      <path d="M9 5h6" />
      <path d="M8.5 13.5l2 2 4-4.5" stroke="#FF6A1F" />
    </svg>
  ),
  Component: ImportApp,
};
