/**
 * General Purchase FMS — route helpers.
 *
 * Every URL in the module is built here so the base path appears once. `B`
 * itself comes from the shared app list (apps/appInfo.ts) rather than being
 * retyped — that literal used to appear in 24 places across this folder, which
 * is exactly the drift the shared list exists to prevent.
 *
 * ⚠ THE MODULE MOVED ON 29-07-2026, from /office-supplies to /general-purchase.
 *   Because every URL is built from here, repointing appInfo moved all of them
 *   at once. App.tsx redirects the old base — queued email_outbox rows carry a
 *   ctaPath authored under it, and that path is frozen at enqueue time.
 *
 * The folder, the app id "office-supplies", the fms_supplies_* schema and the
 * SUPPLY- document prefix all keep the old word on purpose: they are persisted
 * identifiers, and only the display name and the route moved. (Same split as
 * apps/receivables-hub/ ↔ the id "outstanding-dashboard".)
 */

import { appBasePath } from "@/apps/appInfo";

export const B = appBasePath("office-supplies");

export const requestsHref = () => `${B}/requests`;
export const newRequestHref = () => `${B}/requests/new`;
export const myRequestsHref = () => `${B}/my-requests`;
export const requestHref = (id: string) => `${B}/requests/${id}`;
export const editRequestHref = (id: string) => `${B}/requests/${id}/edit`;
export const masterRequestsHref = () => `${B}/master-requests`;
export const monitoringHref = () => `${B}/monitoring`;

export const queueHref = (step: "first-approval" | "second-approval" | "handover") =>
  `${B}/queues/${step}`;
