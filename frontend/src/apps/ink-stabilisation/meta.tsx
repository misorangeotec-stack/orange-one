import type { AppManifest } from "../types";
import { appName, appBasePath, appCategory } from "../appInfo";
import InkStabilisationApp from "./InkStabilisationApp";

/**
 * Manifest for INK STABILISATION — Enterprises Surat's manufactured ink lots and their
 * 3 / 6 / 9-month retests, read live from ConnectWave.
 *
 * Per-user granted like every other module; admins see it without a grant.
 */
export const inkStabilisationApp: AppManifest = {
  id: "ink-stabilisation",
  name: appName("ink-stabilisation"),
  description: "Every ink lot made at Enterprises Surat, with its retest dates at 3, 6 and 9 months from production.",
  basePath: appBasePath("ink-stabilisation"),
  status: "live",
  category: appCategory("ink-stabilisation"),
  order: 91,
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3h6M10 3v6L5 18a2 2 0 0 0 1.8 3h10.4A2 2 0 0 0 19 18l-5-9V3" />
      <path d="M7.5 14h9" stroke="#FF6A1F" />
    </svg>
  ),
  Component: InkStabilisationApp,
};
