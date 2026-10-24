import type { AppManifest } from "../types";
import { appName, appBasePath, appCategory } from "../appInfo";
import AllDraftsApp from "./AllDraftsApp";

/**
 * Manifest for ALL DRAFTS — every FMS raise-form draft (public.fms_drafts) on one
 * page. Admins see it without a grant; an admin grants it to others in Module
 * Access. The grant is view-only: Discard stays with the owner and admins.
 */
export const allDraftsApp: AppManifest = {
  id: "all-drafts",
  name: appName("all-drafts"),
  description: "Every saved draft across the FMS raise forms — who saved it, what it holds, its attachments.",
  basePath: appBasePath("all-drafts"),
  status: "live",
  category: appCategory("all-drafts"),
  order: 91,
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" stroke="#FF6A1F" />
    </svg>
  ),
  Component: AllDraftsApp,
};
