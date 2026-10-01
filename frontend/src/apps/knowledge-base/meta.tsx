import type { AppManifest } from "../types";
import { appName, appBasePath, appCategory } from "../appInfo";
import KnowledgeBaseApp from "./KnowledgeBaseApp";

/**
 * Manifest for the Knowledge Base (KB-1).
 *
 * ⚠ THE GRANT IS NOT WHAT LETS SOMEBODY ASK. Every member of staff can use the Ask HR
 * bubble and read the whole handbook with no grant whatsoever: it is issued to everyone at
 * joining, so gating it would defeat the point. This module is HR's side of it, and holding
 * it means "may see what people asked and annotate a section".
 *
 * View-only means something here, unlike `announcements`: view reads the question log, edit
 * also writes replies and section notes (migration 20260928090057). So it is deliberately
 * NOT in NO_VIEW_ONLY_APP_IDS.
 */
export const knowledgeBaseApp: AppManifest = {
  id: "knowledge-base",
  name: appName("knowledge-base"),
  description:
    "What staff asked the HR handbook, the questions it could not answer, and the notes that appear with every answer.",
  basePath: appBasePath("knowledge-base"),
  status: "live",
  category: appCategory("knowledge-base"),
  order: 26,
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5Z" />
      <path d="M19 18v3H6.5" />
      <circle cx="11.5" cy="9" r="2.1" fill="#FF6A1F" stroke="none" />
    </svg>
  ),
  Component: KnowledgeBaseApp,
};
