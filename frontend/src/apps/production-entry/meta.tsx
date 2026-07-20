import type { AppManifest } from "../types";
import { appName, appBasePath, appCategory, appSubGroup } from "../appInfo";
import ProductionEntryApp from "./ProductionEntryApp";

/**
 * Manifest for the Production Entry FMS — the seventh FMS module (ink production
 * floor), built on the same engine pattern as the other FMS apps (step owners,
 * planned-vs-actual due dates, per-owner queues, notifications, master governance)
 * with its own `fms_production_*` schema.
 *
 * A job-card tracker: raise an issue slip → material handover → transfer slip &
 * batch card → production entry → quality checking → M/C testing → packing-material
 * handover → transfer → packing entry → finished-good transfer to Hojiwala (closes).
 * NO approval, NO PO, NO quotations.
 *
 * PER-USER-GRANTED (not universal) — like Import, an admin switches it on for the
 * production team. The nav and RLS scope what each person sees.
 */
export const productionEntryApp: AppManifest = {
  id: "production-entry",
  name: appName("production-entry"),
  description:
    "Ink production floor end to end: raise a job card, then move it through material handover, production, quality, packing and finished-good transfer.",
  basePath: appBasePath("production-entry"),
  status: "live",
  category: appCategory("production-entry"),
  subGroup: appSubGroup("production-entry"),
  order: 45,
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21h18" />
      <path d="M4 21V9l6-4v4l5-3v6l5-2v11" stroke="#FF6A1F" />
      <path d="M8 13h.01M8 17h.01M13 13h.01M13 17h.01M18 13h.01M18 17h.01" />
    </svg>
  ),
  Component: ProductionEntryApp,
};
