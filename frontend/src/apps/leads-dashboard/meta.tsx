import type { AppManifest } from "../types";
import LeadsDashboardApp from "./LeadsDashboardApp";

/** Manifest for the Leads Dashboard app (analytics over captured exhibition leads). */
export const leadsDashboardApp: AppManifest = {
  id: "leads-dashboard",
  name: "Leads Dashboard",
  description: "Analyze exhibition leads captured on mobile — KPIs, trends, and salesperson performance.",
  basePath: "/leads-dashboard",
  status: "live",
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19V5" />
      <path d="M4 19h16" />
      <rect x="7" y="11" width="3" height="6" rx="0.6" fill="#FF6A1F" stroke="none" />
      <rect x="12" y="7" width="3" height="10" rx="0.6" />
      <rect x="17" y="13" width="3" height="4" rx="0.6" />
    </svg>
  ),
  Component: LeadsDashboardApp,
};
