import type { AppManifest } from "../types";
import { appName, appBasePath, appCategory } from "../appInfo";
import PhysicalVerificationApp from "./PhysicalVerificationApp";

/**
 * Manifest for PHYSICAL VERIFICATION — Otec Surat Printing Ink stock counts against Tally's
 * closing. Per-user granted like every other module; admins see it without a grant.
 */
export const physicalVerificationApp: AppManifest = {
  id: "physical-verification",
  name: appName("physical-verification"),
  description: "Set a verification date on Otec Surat Printing Ink items; the verifier counts them and the difference to Tally's closing works itself out.",
  basePath: appBasePath("physical-verification"),
  status: "live",
  category: appCategory("physical-verification"),
  order: 93,
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 4H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3" />
      <rect x="9" y="2.5" width="6" height="3.5" rx="1" />
      <path d="M8.5 13l2.5 2.5 4.5-5" stroke="#FF6A1F" />
    </svg>
  ),
  Component: PhysicalVerificationApp,
};
