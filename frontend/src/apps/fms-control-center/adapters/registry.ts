import { hrAdapter } from "./hr";
import { hrExitAdapter } from "./hr-exit";
import { officeSuppliesAdapter } from "./office-supplies";
import { purchaseAdapter } from "./purchase";
import { importAdapter } from "./import";
import type { FmsAdapter } from "./types";

/**
 * Every FMS the master Control Center knows about, in display order.
 *
 * To add one: write `adapters/<key>.ts` exporting an `FmsAdapter`, then add it
 * here. Nothing else changes.
 *
 * An FMS that isn't built yet can be listed with `status: "coming-soon"` and a
 * no-op `useSnapshot` — it renders as a dashed, inert row so coordinators can
 * see what's on the way:
 *
 *   { key: "sales", name: "Sales FMS", controlCenterPath: "", status: "coming-soon",
 *     useSnapshot: () => ({ snapshot: null, isLoading: false, error: null }) }
 */
export const fmsAdapters: FmsAdapter[] = [purchaseAdapter, importAdapter, hrAdapter, hrExitAdapter, officeSuppliesAdapter];
