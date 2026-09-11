import { appBasePath } from "@/apps/appInfo";

/**
 * EVERY LINK IN THE ORDER DESK, ABSOLUTE, FROM ONE PLACE.
 *
 * ⚠ RELATIVE LINKS WERE A REAL BUG HERE, NOT A STYLE PREFERENCE. React Router
 *   resolves a relative `to` against the CURRENT ROUTE, so the same tab meant
 *   three different things depending on where the customer already was:
 *
 *     on /order-desk            "orders" -> /order-desk/orders            ✓
 *     on /order-desk/orders     "orders" -> /order-desk/orders/orders     -> matches
 *                                 `orders/:id` with id "orders", so pressing
 *                                 My orders while already on My orders showed
 *                                 "We cannot find that order."
 *     on /order-desk/orders/:id "orders" -> /order-desk/orders/:id/orders -> matches
 *                                 nothing, falls to the `*` route, and redirects
 *                                 to Place an order.
 *
 *   Two different wrong destinations from one link, both of which look like the
 *   app losing the customer's place. `to=".."` had the mirror-image problem.
 *
 * ⚠ AND THE BASE COMES FROM THE MANIFEST, never a literal. `/order-desk` is
 *   deliberately not `/customer-orders` (see appInfo), and a hard-coded copy here
 *   would be a second place for that decision to live.
 */
const DESK = appBasePath("customer-orders");

export const deskPaths = {
  /** Place an order — the app's index. */
  place: DESK,
  orders: `${DESK}/orders`,
  order: (id: string) => `${DESK}/orders/${id}`,
  password: `${DESK}/password`,
};
