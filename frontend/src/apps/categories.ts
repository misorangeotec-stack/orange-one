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
 */

export type AppCategory = "productivity" | "fms" | "sales" | "control" | "mobile";

export const CATEGORIES: { key: AppCategory; label: string }[] = [
  { key: "productivity", label: "Productivity" },
  { key: "fms", label: "FMS" },
  { key: "sales", label: "Sales & Receivables" },
  { key: "control", label: "Control" },
  // Not a web app — the mobile grant gates login to the Orange One mobile Leads
  // app. It appears in the permission screens only, never in the left menu.
  { key: "mobile", label: "Mobile" },
];

/** Anything untagged falls here, so a new app is never silently invisible. */
export const UNCATEGORISED_LABEL = "Other";

/**
 * Group a list of taggable things into category order, dropping empty groups.
 * Used by all three consumers so their grouping logic is also shared, not just
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
