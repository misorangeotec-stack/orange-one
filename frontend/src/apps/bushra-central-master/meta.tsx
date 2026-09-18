import type { AppManifest } from "../types";
import { appName, appBasePath, appCategory } from "../appInfo";
import BushraCentralMasterApp from "./BushraCentralMasterApp";

/**
 * Manifest for BUSHRA CENTRAL MASTER — a private, browser-only mirror of Central
 * Masters' items with my own Type / Category / Ink type / Group / Colour.
 *
 * Per-user granted like every other module; admins see it without a grant.
 */
export const bushraCentralMasterApp: AppManifest = {
  id: "bushra-central-master",
  name: appName("bushra-central-master"),
  description:
    "Central Masters' items mirrored live, with your own type, category, group and colour saved in this browser.",
  basePath: appBasePath("bushra-central-master"),
  status: "live",
  category: appCategory("bushra-central-master"),
  order: 90,
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7h18M3 12h18M3 17h10" />
      <circle cx="18" cy="17" r="3" stroke="#FF6A1F" />
    </svg>
  ),
  Component: BushraCentralMasterApp,
};
