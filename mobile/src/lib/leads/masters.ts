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

export const MASTER_LABELS: Record<keyof Masters, string> = {
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
  };
}
