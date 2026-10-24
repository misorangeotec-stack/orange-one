import type { AppManifest } from "../types";
import { appName, appBasePath, appCategory, appSubGroup } from "../appInfo";
import MachineResaleApp from "./MachineResaleApp";

/**
 * Manifest for Machine Resale (MR-1C): where staff list pre-owned printers for the
 * resale website, with photos and video, and follow up the inquiries it brings in.
 *
 * ⚠ ITS DATA IS NOT IN THE HUB. Machines, masters, inquiries, photos and settings
 *   live in the portal's own Supabase project; this module reaches it only through
 *   `data/client.ts`. The hub keeps the users and the grant.
 *
 * PER-USER-GRANTED, view or edit, and never universal: the portal's login bridge
 * (`mr-session`) issues a pass only to someone holding this app's grant (or an
 * admin), so a universal app with no grant rows would lock everyone out.
 */
export const machineResaleApp: AppManifest = {
  id: "machine-resale",
  name: appName("machine-resale"),
  description:
    "List pre-owned printers for the resale website with photos and video, choose what each listing shows, and follow up every inquiry.",
  basePath: appBasePath("machine-resale"),
  status: "live",
  category: appCategory("machine-resale"),
  subGroup: appSubGroup("machine-resale"),
  order: 40,
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9V3h12v6" />
      <rect x="3" y="9" width="18" height="8" rx="2" />
      <path d="M6 14h12v7H6z" />
      <path d="M15 5.5l2 2" stroke="#FF6A1F" />
    </svg>
  ),
  Component: MachineResaleApp,
};
