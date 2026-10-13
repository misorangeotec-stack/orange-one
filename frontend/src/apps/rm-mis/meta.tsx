import type { AppManifest } from "../types";
import { appName, appBasePath, appCategory } from "../appInfo";
import RmMisApp from "./RmMisApp";

/**
 * Manifest for RM IMS — ink inventory planning across the four ink books.
 *
 * Its own module, deliberately. The report merges Otec Surat, Otec Noida, Enterprises Surat and
 * Enterprises Noida onto one line per ink and sets reorder levels from Sales Register
 * consumption. It is NOT part of the Receivables Hub and must not be folded into it.
 *
 * Per-user granted like every other module. Nothing is universal here.
 */
export const rmMisApp: AppManifest = {
  id: "rm-mis",
  name: appName("rm-mis"),
  description:
    "Raw material in Enterprises Surat's Warehouse (Manufacturing Stock), with reorder cover from production consumption and the ETD / ETA pipeline.",
  basePath: appBasePath("rm-mis"),
  status: "live",
  category: appCategory("rm-mis"),
  order: 21,
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 8 12 3 3 8v8l9 5 9-5Z" stroke="#FF6A1F" />
      <path d="m3 8 9 5 9-5M12 13v8" />
    </svg>
  ),
  Component: RmMisApp,
};
