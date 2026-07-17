/**
 * Default (seed) master lists. Users can add/rename/delete/reorder these in
 * Settings → Masters; the live copy lives in the store (AsyncStorage). These are
 * only the initial defaults on first launch.
 */

import type { Masters, MasterItem } from './types';

let n = 0;
const item = (label: string, color?: string): MasterItem => ({
  id: `m${++n}`,
  label,
  color,
  order: n,
});

/**
 * The options a user may CHOOSE from: active only, in the admin's order.
 *
 * Use this everywhere the user picks a value — never where a stored value is
 * resolved for display. A lead captured before an item was deactivated must still
 * render its label on the detail screen, in the dashboard charts and in the Sheets
 * export, so `masters[type]` stays the full list for lookups.
 */
export const pickable = (items: MasterItem[]): MasterItem[] =>
  items.filter((i) => i.active !== false).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

export const MASTER_LABELS: Record<keyof Masters, string> = {
  source: 'Source',
  categories: 'Categories',
  interestLevels: 'Interest levels',
  askedAbout: 'What they asked about',
  followUpActions: 'Follow-up actions',
};

export function defaultMasters(): Masters {
  n = 0;
  return {
    categories: [
      item('Manufacturer'),
      item('Distributor'),
      item('Retailer'),
      item('Wholesaler'),
      item('Others'),
    ],
    interestLevels: [
      item('Not interested', '#E5484D'),
      item('Slightly interested', '#F8B62B'),
      item('Very interested', '#3B82F6'),
      item('Ready to buy', '#27AE60'),
    ],
    askedAbout: [
      item('Product demo'),
      item('Pricing'),
      item('Catalogue'),
      item('Samples'),
      item('Partnership'),
    ],
    followUpActions: [
      item('Call back today'),
      item('Send quote'),
      item('Book a demo'),
      item('Share catalogue'),
      item('No action'),
    ],
    // Kept LAST so the ids above stay m1..m19 (referenced by seed.ts); source → m20+.
    // These are only offline first-launch defaults — the live list is admin-managed
    // in the web portal (exhibition names). Placeholder examples the admin replaces.
    source: [
      item('Exhibition 2026'),
      item('Trade Show'),
      item('Walk-in'),
    ],
  };
}
