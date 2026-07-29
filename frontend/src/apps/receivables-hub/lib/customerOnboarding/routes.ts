/**
 * Customer Creation FMS — route helpers.
 *
 * Every URL in the module is built here so the base path appears once. BASE
 * itself comes from the shared app list (apps/appInfo.ts) rather than being
 * retyped — that literal used to appear in four places across the hub, which is
 * exactly the drift the shared list exists to prevent.
 */
import { appBasePath } from "@/apps/appInfo";
import type { StepKey } from "./steps";

/**
 * ⚠ THIS ONE CONSTANT IS THE WHOLE MOVE.
 *   Until 29-07-2026 this was `${BASE}/customer-onboarding`, i.e. a subtree of
 *   the Outstanding Dashboard. The module is now its own top-level app, and
 *   because every URL in it is built from here, repointing this line moved all
 *   of them at once. The hub redirects the old paths to the new ones, so links
 *   and bookmarks already in circulation still land.
 */
export const CUST_BASE = appBasePath("customer-onboarding");

export const homeHref  = () => CUST_BASE;
export const newHref   = () => `${CUST_BASE}/new`;
export const mineHref  = () => `${CUST_BASE}/mine`;
export const allHref   = () => `${CUST_BASE}/all`;

export const detailHref = (id: string) => `${CUST_BASE}/requests/${id}`;
export const editHref   = (id: string) => `${CUST_BASE}/requests/${id}/edit`;

/**
 * Correcting a finished step opens the SAME panel on the SAME detail page, in
 * edit mode — not a modal copy of it. One component, one set of rules, and the
 * corrector sees the request they are correcting rather than four fields
 * floating over nothing.
 */
export const correctHref = (id: string, step: StepKey) =>
  `${CUST_BASE}/requests/${id}?correct=${step}`;

/**
 * The four back-office queues are ONE page keyed by a query string, not four
 * routes. The hub's CollapsibleMenu already computes active state for
 * query-string children — that is how the Reports sub-nav works.
 */
export const queueHref = (step: StepKey) => `${CUST_BASE}/queue?step=${step}`;

export const settingsHref = () => `${CUST_BASE}/settings`;
