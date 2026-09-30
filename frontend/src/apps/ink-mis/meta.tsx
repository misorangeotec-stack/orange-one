import type { AppManifest } from "../types";
import { appName, appBasePath, appCategory } from "../appInfo";
import InkMisApp from "./InkMisApp";

/**
 * Manifest for INK IMS — ink inventory planning across the four ink books.
 *
 * Its own module, deliberately. The report merges Otec Surat, Otec Noida, Enterprises Surat and
 * Enterprises Noida onto one line per ink and sets reorder levels from Sales Register
 * consumption. It is NOT part of the Receivables Hub and must not be folded into it.
 *
 * Per-user granted like every other module. Nothing is universal here.
 */
export const inkMisApp: AppManifest = {
  id: "ink-mis",
  name: appName("ink-mis"),
  description:
    "Ink stock across all four books on one line, with reorder cover and the incoming ETD / ETA pipeline.",
  basePath: appBasePath("ink-mis"),
  status: "live",
  category: appCategory("ink-mis"),
  order: 20,
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3s5.5 5.4 5.5 9a5.5 5.5 0 0 1-11 0C6.5 8.4 12 3 12 3Z" stroke="#FF6A1F" />
      <path d="M9.5 13.5a2.5 2.5 0 0 0 2.5 2.5" />
    </svg>
  ),
  Component: InkMisApp,
};
