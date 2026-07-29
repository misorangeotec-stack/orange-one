import type { AppManifest } from "../types";
import { appName, appBasePath, appCategory, appSubGroup } from "../appInfo";
import AssetMaintenanceApp from "./AssetMaintenanceApp";

/**
 * Manifest for the Asset Maintenance FMS — the tenth FMS module, built on the
 * same engine as the others (step owners, per-owner queues, planned-vs-actual due
 * dates, notifications, master governance) with its own `fms_asset_*` schema.
 *
 * ⚠ IT IS SHAPED DIFFERENTLY FROM EVERY OTHER FMS, and that is the point. The
 *   others run one entity through a chain once and close it. An asset never
 *   closes — it lives for years and throws off work repeatedly. So the register
 *   (assets and their dated tracks) is permanent, and the thing that runs the
 *   chain is a SERVICE JOB, opened automatically when a track enters its reminder
 *   window and closed when the work is verified, which rolls the track forward.
 *
 * What it is for: services get missed. A car, an AC, a machine, a laptop — each
 * has a service interval, and several carry certificates that lapse (insurance,
 * PUC, RC, warranty, AMC, calibration). Nothing in the portal tracked any of it.
 *
 * PER-USER-GRANTED (not universal) — an admin switches it on for admin, HR, plant
 * and the custodians. The nav and RLS scope what each person sees.
 */
export const assetMaintenanceApp: AppManifest = {
  id: "asset-maintenance",
  name: appName("asset-maintenance"),
  description:
    "Every asset the company owns, when each is next due for service or renewal, and automatic reminders before it lapses — with the service itself scheduled, recorded and verified.",
  basePath: appBasePath("asset-maintenance"),
  status: "live",
  category: appCategory("asset-maintenance"),
  subGroup: appSubGroup("asset-maintenance"),
  order: 60,
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a4 4 0 0 0 5 5l-8 8a2.8 2.8 0 0 1-4-4z" />
      <circle cx="17.5" cy="6.5" r="3.2" stroke="#FF6A1F" />
      <path d="M4 20h4" />
    </svg>
  ),
  Component: AssetMaintenanceApp,
};
