import type { NavItem } from "@/shared/components/layout/types";
import { appBasePath } from "@/apps/appInfo";
import { HANDBOOK_PATH } from "@/core/knowledge-base/data";

export const B = appBasePath("knowledge-base");

const ic = {
  questions: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.9 9.9 0 0 1-3.6-.7L3 21l1.9-4.8A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4Z" />
      <path d="M9.6 9.4a2.4 2.4 0 0 1 4.7.6c0 1.6-2.4 2.4-2.4 2.4M12 15.6h.01" />
    </svg>
  ),
  notes: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 9v4M12 17h.01" />
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    </svg>
  ),
  published: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5Z" />
      <path d="M19 18v3H6.5" />
    </svg>
  ),
  read: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 5.5h7a3 3 0 0 1 3 3V20a2.5 2.5 0 0 0-2.5-2.5H2Z" />
      <path d="M22 5.5h-7a3 3 0 0 0-3 3V20a2.5 2.5 0 0 1 2.5-2.5H22Z" />
    </svg>
  ),
  account: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.5-6 8-6s8 2 8 6" />
    </svg>
  ),
};

export const knowledgeBaseNav: NavItem[] = [
  { label: "What people asked", to: B, icon: ic.questions, section: "Knowledge Base" },
  { label: "Notes on sections", to: `${B}/notes`, icon: ic.notes },
  { label: "Published handbook", to: `${B}/published`, icon: ic.published },
  // The handbook itself, which needs no grant. Here so a manager can reach it from their own
  // module rather than remembering a URL nothing links to.
  { label: "Read the handbook", to: HANDBOOK_PATH, icon: ic.read },
  { label: "My Account", to: "/account", icon: ic.account, section: "Account" },
];
