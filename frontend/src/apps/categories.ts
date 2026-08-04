/**
 * How apps are grouped, everywhere they are listed.
 *
 * ONE definition, THREE consumers: the home screen's left menu
 * (`core/workspace/homeNav.tsx`), the per-user module tick-boxes
 * (`core/admin/UserForm.tsx`), and the Module Access matrix
 * (`core/admin/ModuleAccess.tsx`). A new app therefore lands in the right group
 * in all three at once — the grouping cannot drift apart between screens.
 *
 * Imports nothing on purpose, exactly like `apps/universal.ts`: the session
 * layer and the registry both reach for it, and a cycle here would break both.
 *
 * Adding a category: add it to CATEGORIES in the position it should render, then
 * tag the apps. Order here IS display order — there is no separate sort.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THERE IS NO "FMS" CATEGORY, and its absence is the point.
 *
 * Ten of the fourteen apps used to sit under one "FMS" heading, split across six
 * sub-groups (Purchase, Sampling, Production, Dispatch, Assets, HR). "FMS" is an
 * engineering word — nobody in the business says it — so the heading cost every
 * reader a click and buried the department they were actually looking for one
 * level down. The sub-groups WERE the useful names, so they were promoted to top
 * level and the container was deleted.
 *
 * Order below is set by the business. It opens with the screen almost everyone
 * uses daily (the task list), then walks the plant floor — sample it, make it,
 * and the machines that do the making — then the commercial chain that wraps
 * around it (buy it, then sell it and collect for it), and finally the functions
 * that support all of the above.
 *
 * Note this is NOT strict process order: Asset sits with the plant rather than
 * with the other support functions, and Purchase follows production rather than
 * leading it. That is deliberate and was asked for — order these by how often
 * people open them, not by where they fall in the workflow.
 *
 * `subGroup` (a second level inside a category) survives in the types and in the
 * sidebar but nothing uses it today: promoting the FMS sub-groups emptied it. It
 * is kept because Purchase or Sales may want it again, and because tearing it out
 * would touch the sidebar, the breadcrumb and both permission screens for nothing.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type AppCategory =
  | "productivity"
  | "sampling"
  | "production"
  | "asset"
  | "purchase"
  | "sales"
  | "hr"
  | "control"
  | "mobile";

export const CATEGORIES: { key: AppCategory; label: string }[] = [
  { key: "productivity", label: "Productivity" },
  // ── the plant floor: sample it, make it, and the machines that do the making ─
  { key: "sampling", label: "Sampling" },
  { key: "production", label: "Production" },
  { key: "asset", label: "Asset" },
  // ── the commercial chain wrapped around it ─────────────────────────────────
  { key: "purchase", label: "Purchase" },
  // Everything customer-facing, from the lead through onboarding and dispatch to
  // collecting the money. Order to Dispatch and New Customer Onboarding live here
  // rather than in a process group of their own: both are steps in the sales book,
  // and a reader looking for "where did that order go?" starts from sales.
  { key: "sales", label: "Sales & Receivables" },
  // ── the functions that support all of it ───────────────────────────────────
  { key: "hr", label: "HR" },
  { key: "control", label: "Control" },
  // Not a web app — the mobile grant gates login to the Orange One mobile Leads
  // app. It appears in the permission screens only, never in the left menu.
  { key: "mobile", label: "Mobile" },
];

/** Anything untagged falls here, so a new app is never silently invisible. */
export const UNCATEGORISED_LABEL = "Other";

/**
 * Group a list of taggable things into category order, dropping empty groups.
 * Used by all four consumers so their grouping logic is also shared, not just
 * their category names.
 */
export function groupByCategory<T extends { category?: AppCategory }>(
  rows: T[]
): { key: AppCategory | "other"; label: string; rows: T[] }[] {
  const out: { key: AppCategory | "other"; label: string; rows: T[] }[] = [];
  for (const c of CATEGORIES) {
    const inGroup = rows.filter((r) => r.category === c.key);
    if (inGroup.length) out.push({ key: c.key, label: c.label, rows: inGroup });
  }
  const untagged = rows.filter((r) => !r.category || !CATEGORIES.some((c) => c.key === r.category));
  if (untagged.length) out.push({ key: "other", label: UNCATEGORISED_LABEL, rows: untagged });
  return out;
}
