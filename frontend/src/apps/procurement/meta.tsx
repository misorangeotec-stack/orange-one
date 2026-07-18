import type { AppManifest } from "../types";
import ProcurementApp from "./ProcurementApp";

/**
 * Manifest for Purchase FMS (procurement) — a master-driven, multi-item /
 * multi-vendor procurement workflow: Request → Sourcing → tiered Approval →
 * vendor-wise PO → PI → Advance → Follow-up → GRN → Tally → installment Final
 * Payment. Built as a dedicated relational module (tables prefixed
 * `fms_purchase_`). The app id stays `procurement` for historical reasons — it
 * once ran alongside a since-deleted `purchase-fms` prototype.
 */
export const procurementApp: AppManifest = {
  id: "procurement",
  name: "Purchase FMS",
  description:
    "Master-driven procurement: multi-item requests, 3-quote sourcing, amount-tiered approval, vendor-wise POs, receipts and installment payments.",
  basePath: "/procurement",
  status: "live",
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3h6a1 1 0 0 1 1 1v1h2a1 1 0 0 1 1 1v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a1 1 0 0 1 1-1h2V4a1 1 0 0 1 1-1z" />
      <path d="M9 5h6" />
      <path d="M8.5 13.5l2 2 4-4.5" stroke="#FF6A1F" />
    </svg>
  ),
  Component: ProcurementApp,
};
