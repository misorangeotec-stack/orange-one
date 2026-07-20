/**
 * "Where am I?" — turns a URL into the breadcrumb trail shown in every top strip.
 *
 *     /import/requests/new  →  FMS → Purchase → RM Import → New Request
 *
 * This exists because five of the nine modules are near-identical FMS screens and
 * the top strip only ever showed the PAGE name — "New Request", "Masters",
 * "Settings" — words that appear in several modules at once. A user deep in a
 * workflow could not tell which module they were in.
 *
 * IMPORTS ONLY LEAF MODULES, deliberately. Reading the trail from
 * `apps/registry.tsx` would have been the obvious move, but every manifest also
 * imports its app's root component — so the shared topbar would pull all five FMS
 * apps into the bundle just to print a label, and any FMS page would cycle back
 * into itself. `appInfo`, `categories` and the layout `types` constants are all
 * import-free leaves; that is what keeps this safe to call from anywhere.
 */

import { APPS } from "./appInfo";
import { CATEGORIES, UNCATEGORISED_LABEL } from "./categories";
import { HOME_LABEL, HOME_PATH } from "@/shared/components/layout/types";

export interface Crumb {
  label: string;
  /** Set only on steps that are real destinations. Groups and the current page aren't. */
  to?: string;
  /**
   * The family/group steps ("FMS", "Purchase"). They are the first to go when the
   * strip runs out of room — dropping them still leaves the module and the page,
   * which is what the reader actually needs. See Breadcrumbs.tsx.
   */
  collapsible?: boolean;
}

/**
 * Screens that live in the shell but aren't registered modules, so they have no
 * manifest to read a family/name from. Their page step still comes from the nav
 * (e.g. Admin → Users), so these are the leading steps only.
 */
const STATIC_TRAILS: { prefix: string; crumbs: Crumb[] }[] = [
  {
    prefix: "/admin",
    crumbs: [{ label: "Control", collapsible: true }, { label: "Administration", to: "/admin" }],
  },
  { prefix: HOME_PATH, crumbs: [{ label: "Orange One", collapsible: true }, { label: HOME_LABEL }] },
];

/** Display label for a category key, e.g. "fms" → "FMS". */
const categoryLabel = (key?: string): string | undefined =>
  key ? (CATEGORIES.find((c) => c.key === key)?.label ?? UNCATEGORISED_LABEL) : undefined;

/**
 * Drop the group word when the module's own name already starts with it:
 * "Purchase" + "Purchase RM Import" reads "Purchase → Purchase RM Import".
 *
 * Only the trail is shortened. The module keeps its full registered name on the
 * home screen, in the left menu and on the permission screens — this is a display
 * tidy-up in one spot, NOT a rename.
 */
function trimPrefix(label: string, prefix?: string): string {
  if (!prefix) return label;
  const lead = `${prefix} `;
  return label.startsWith(lead) ? label.slice(lead.length) : label;
}

/** The module whose basePath owns this URL, or null. Longest path wins. */
function matchApp(pathname: string) {
  return Object.entries(APPS)
    .filter(([, a]) => pathname === a.basePath || pathname.startsWith(`${a.basePath}/`))
    .sort(([, a], [, b]) => b.basePath.length - a.basePath.length)[0];
}

/**
 * Build the trail for a URL.
 *
 * `pageLabel` is the name of the current page, which only the shell knows (it
 * comes from whichever left-menu item is highlighted). Pass `null` when NOTHING
 * in the menu matched — an individual purchase order, a customer, Saved Views.
 * The trail then simply stops at the module rather than inventing a name. That is
 * deliberate: the shell used to fall back to the literal word "Dashboard", which
 * is how someone opening an exit case could end up reading "Dashboard" at the top
 * of the screen. Stopping short is honest; guessing is worse than saying nothing.
 *
 * Pass a `Crumb[]` instead of a string when the page needs MORE than one step — the
 * Receivables reports read "Reports → Tally Reports → Balance Sheet", which a single
 * label cannot express. Steps carry `to`/`collapsible` like any other crumb, so the
 * intermediate ones can be real links and can drop first on a narrow screen.
 */
export function buildTrail(pathname: string, pageLabel?: string | Crumb[] | null): Crumb[] {
  const stat = STATIC_TRAILS.find((s) => pathname === s.prefix || pathname.startsWith(`${s.prefix}/`));
  if (stat) return appendPage(stat.crumbs, pageLabel);

  const found = matchApp(pathname);
  if (!found) return [];
  const [, app] = found;

  const crumbs: Crumb[] = [];
  const family = categoryLabel(app.category);
  if (family) crumbs.push({ label: family, collapsible: true });
  if (app.subGroup) crumbs.push({ label: app.subGroup, collapsible: true });
  crumbs.push({ label: trimPrefix(app.name, app.subGroup), to: app.basePath });

  // Same tidy-up one step further along: several modules name their monitoring
  // page "<module> Control Center", which the trail would render as
  // "RM Import → Purchase RM Import Control Center". The module is already two
  // steps to the left, so drop it and read "RM Import → Control Center".
  return appendPage(crumbs, trimPageLabel(pageLabel, app.name));
}

/** Apply `trimPrefix` to a page step, whether it arrived as one label or several. */
function trimPageLabel(
  pageLabel: string | Crumb[] | null | undefined,
  appName: string
): string | Crumb[] | null | undefined {
  if (!pageLabel) return pageLabel;
  return typeof pageLabel === "string"
    ? trimPrefix(pageLabel, appName)
    : pageLabel.map((c) => ({ ...c, label: trimPrefix(c.label, appName) }));
}

/**
 * Name the current page by finding the left-menu item that owns it — the last
 * step of the trail. Shared by both top strips so they can never disagree.
 *
 * Two rules, and the second one is the whole point:
 *
 *  1. An exact URL match always wins.
 *  2. Otherwise the DEEPEST menu item the URL sits under wins — but the module's
 *     own root item is excluded from that. Every app has a "Dashboard" pinned at
 *     its base, and a plain prefix test makes it match literally every page in
 *     the module, so an individual exit case would be labelled "Dashboard". A
 *     root item names the root page, nothing else.
 *
 * Returns null when nothing owns the page (a purchase order, a customer, Saved
 * Views), and the trail then stops at the module instead of inventing a name.
 */
export function pageLabelFor(
  pathname: string,
  items: { label: string; to: string }[]
): string | null {
  const exact = items.find((i) => i.to === pathname);
  if (exact) return exact.label;

  const base = matchApp(pathname)?.[1].basePath;
  return (
    items
      .filter((i) => (base ? i.to.length > base.length : true))
      .filter((i) => pathname.startsWith(`${i.to}/`))
      .sort((a, b) => b.to.length - a.to.length)[0]?.label ?? null
  );
}

/**
 * Add the page step(s), skipping any that just repeat the step before them.
 *
 * The repeat rule is applied per step, not once: a multi-step trail can collide with the
 * module at its head ("Receivables Hub → Reports") and with itself further along.
 */
function appendPage(crumbs: Crumb[], pageLabel?: string | Crumb[] | null): Crumb[] {
  if (!pageLabel) return crumbs;
  const steps: Crumb[] = typeof pageLabel === "string" ? [{ label: pageLabel }] : pageLabel;
  return steps.reduce<Crumb[]>((acc, step) => {
    const last = acc[acc.length - 1];
    return step.label === last?.label ? acc : [...acc, step];
  }, crumbs);
}
