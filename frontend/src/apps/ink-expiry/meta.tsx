import type { AppManifest } from "../types";
import { appName, appBasePath, appCategory } from "../appInfo";
import InkExpiryApp from "./InkExpiryApp";

/**
 * Manifest for INK EXPIRY — every ink lot in stock, and whether Tally has its expiry date.
 * Read live from ConnectWave; nothing is written.
 *
 * Per-user granted like every other module; admins see it without a grant.
 */
export const inkExpiryApp: AppManifest = {
  id: "ink-expiry",
  name: appName("ink-expiry"),
  description: "Every ink lot in stock, with its Tally expiry date — and the list of lots the accountant still has to update.",
  basePath: appBasePath("ink-expiry"),
  status: "live",
  category: appCategory("ink-expiry"),
  order: 92,
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 9h18M8 2v4M16 2v4" />
      <path d="M12 12v3l2 1.5" stroke="#FF6A1F" />
    </svg>
  ),
  Component: InkExpiryApp,
};
