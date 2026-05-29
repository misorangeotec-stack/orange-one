import type { AppManifest } from "./types";
import { taskManagementApp } from "./task-management/meta";

/**
 * Central registry of all Orange One apps.
 * - The workspace launcher renders one card per entry.
 * - App.tsx mounts every `live` app at `${basePath}/*`.
 * Add a new app: build src/apps/<name>/, export its manifest, import it here.
 */
const comingSoon = (
  id: string,
  name: string,
  description: string,
  icon: AppManifest["icon"]
): AppManifest => ({ id, name, description, basePath: `/${id}`, status: "coming-soon", icon });

export const apps: AppManifest[] = [
  taskManagementApp,
  comingSoon(
    "purchase-requests",
    "Purchase Requests",
    "Raise and manage procurement requests seamlessly.",
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="20" r="1.3" /><circle cx="18" cy="20" r="1.3" /><path d="M2 3h3l2.4 12.5a2 2 0 0 0 2 1.5h8.6a2 2 0 0 0 2-1.6L23 7H6" /></svg>
  ),
  comingSoon(
    "purchase-approvals",
    "Purchase Approvals",
    "Review, approve, and track purchasing decisions.",
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h7l5 5v13H6z" /><path d="M13 3v5h5" /><circle cx="12" cy="14" r="3.1" stroke="#FF6A1F" /><path d="M10.7 14l1 1 1.7-1.9" stroke="#FF6A1F" /></svg>
  ),
  comingSoon(
    "vendor-management",
    "Vendor Management",
    "Maintain supplier information and performance records.",
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="10" cy="8" r="3.1" /><path d="M4 19c0-3.3 2.7-5.4 6-5.4" /><circle cx="17.6" cy="15.6" r="2" stroke="#FF6A1F" /><path d="M17.6 12.9v-1.1M17.6 19.4v-1.1M20.2 15.6h1.1M13.9 15.6h1.1" stroke="#FF6A1F" /></svg>
  ),
  comingSoon(
    "inventory-workflow",
    "Inventory Workflow",
    "Monitor stock movement and inventory operations.",
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M4 7.5l8 4.5 8-4.5M12 12v9" /></svg>
  ),
  comingSoon(
    "service-management",
    "Service Management",
    "Manage service requests and field operations.",
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6.2a3.8 3.8 0 0 0-5 5L4.5 16.7 7.3 19.5 12.8 14a3.8 3.8 0 0 0 5-5l-2.3 2.3-2-.6-.6-2z" stroke="#FF6A1F" /><path d="M5 19l-1.2 1.2" /></svg>
  ),
  comingSoon(
    "hr-requests",
    "HR Requests",
    "Handle employee requests and internal approvals.",
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3" /><path d="M3 19c0-3.3 2.7-5 6-5s6 1.7 6 5" /><circle cx="17.6" cy="9" r="2.3" stroke="#FF6A1F" /><path d="M16 14c3.1 0 5 2 5 5" stroke="#FF6A1F" /></svg>
  ),
  comingSoon(
    "document-approvals",
    "Document Approvals",
    "Digitize review cycles and approval workflows.",
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h7l5 5v13H6z" /><path d="M13 3v5h5" /><path d="M9 12.5h6M9 15.5h6M9 9.5h3" /></svg>
  ),
];

export const liveApps = apps.filter((a) => a.status === "live" && a.Component);
