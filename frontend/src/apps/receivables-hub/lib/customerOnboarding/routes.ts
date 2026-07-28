/**
 * Customer Creation FMS — route helpers.
 *
 * Every URL in the module is built here so the base path appears once. BASE
 * itself comes from the shared app list (apps/appInfo.ts) rather than being
 * retyped — that literal used to appear in four places across the hub, which is
 * exactly the drift the shared list exists to prevent.
 */
import { BASE } from "@hub/lib/menus";
import type { StepKey } from "./steps";

export const CUST_BASE = `${BASE}/customer-onboarding`;

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
