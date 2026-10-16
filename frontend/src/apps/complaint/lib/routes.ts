/**
 * Complaint (RM/FG) FMS — route helpers.
 *
 * Every URL in the module is built here so the base path appears once. `B` comes
 * from the shared app list (apps/appInfo.ts) rather than being retyped — the
 * literal `"/sampling"` sits hardcoded in three places in that module, which is
 * exactly the drift the shared list exists to prevent.
 *
 * ⚠ `ctaPath` IN A QUEUED EMAIL IS FROZEN AT ENQUEUE TIME. If this module's base
 *   path ever moves, App.tsx must redirect the old one — an email_outbox row
 *   already carrying `/complaint/requests/<id>` cannot be rewritten.
 */

import { appBasePath } from "@/apps/appInfo";

export const B = appBasePath("complaint");

export const requestsHref = () => `${B}/requests`;
export const newRequestHref = () => `${B}/requests/new`;
export const myRequestsHref = () => `${B}/my-requests`;
export const requestHref = (id: string) => `${B}/requests/${id}`;
export const masterRequestsHref = () => `${B}/master-requests`;
export const mastersHref = () => `${B}/masters`;
export const monitoringHref = () => `${B}/monitoring`;
export const settingsHref = () => `${B}/settings`;

/** The Customer Credit Notes page. `tab` picks the bucket; `open` opens one credit note. */
export type CreditNoteTab = "approval" | "tally" | "closed" | "rejected" | "all";
export const creditNotesHref = (opts: { tab?: CreditNoteTab; open?: string } = {}) => {
  const q = new URLSearchParams();
  if (opts.tab) q.set("tab", opts.tab);
  if (opts.open) q.set("open", opts.open);
  const qs = q.toString();
  return `${B}/credit-notes${qs ? `?${qs}` : ""}`;
};

/**
 * A step's queue. The slugs are deliberately the STEP KEYS with underscores
 * turned to hyphens, so a reader landing on `/complaint/queues/capa` can find
 * the step in lib/steps.ts without a lookup table.
 */
export type QueueSlug =
  | "plant"
  | "service"
  | "approval"
  | "purchase"
  | "rm-management"
  | "assignee"
  | "management-review";

export const queueHref = (step: QueueSlug) => `${B}/queues/${step}`;
