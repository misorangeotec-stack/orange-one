/**
 * Module augmentation for the customer "category" (tier) attribute.
 *
 * The category fields conceptually belong on the interfaces in ./types, but are
 * declared here as a separate augmentation so they survive independently of that
 * file (it is frequently held open / reverted by the editor). TypeScript merges
 * these into the same interfaces; declaring an identical member in both places is
 * allowed, so this is safe whether or not ./types also lists them.
 */
import "./types";

declare module "./types" {
  interface Customer {
    /** Sales/finance tier: 'A' | 'B' | 'C' | 'D' | 'E' | 'AA'; '' when Uncategorized. */
    category: string;
  }
  interface ConsolidatedCustomer {
    /** All unique categories (tiers) for this consolidated customer. */
    categories: string[];
  }
}
