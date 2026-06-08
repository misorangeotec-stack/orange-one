import type { AppManifest } from "../types";
import PurchaseFmsApp from "./FmsApp";

/**
 * Manifest for Purchase FMS — the first of the FMS (Flow Management System)
 * workflow modules. A purchase requirement moves through a 9-stage pipeline; each
 * department fills its stage and the next owner is notified in turn.
 */
export const purchaseFmsApp: AppManifest = {
  id: "purchase-fms",
  name: "Purchase FMS",
  description: "Run enterprise purchases through a 9-stage pipeline with a live progress bar and stage hand-offs.",
  basePath: "/purchase-fms",
  status: "live",
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 7h13l-1 9H5L4 7z" />
      <path d="M4 7l-.7-3H2" />
      <circle cx="8" cy="20" r="1.4" />
      <circle cx="15" cy="20" r="1.4" />
      <path d="M9.5 11.5l1.5 1.5 3-3" stroke="#FF6A1F" />
    </svg>
  ),
  Component: PurchaseFmsApp,
};
