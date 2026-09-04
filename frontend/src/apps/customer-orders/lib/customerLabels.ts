import { itemTypeLabel, type ItemType } from "@/core/platform/liveMasters";

/**
 * EVERY WORD THE CUSTOMER READS THAT IS NOT THEIR OWN DATA.
 *
 * One module, deliberately, because the Order Desk's whole job is to say less
 * than the staff app does. Decision Q6 is that the customer sees a plain state,
 * never our step name — and a mapping that lives in two components is a mapping
 * that will disagree with itself the first time somebody adds a step.
 *
 * ⚠ NOTHING IN THIS APP MAY SAY: "Order to Dispatch", "FMS", "Orange One",
 *   "credit check", "credit hold", "gate out", "material status", "sales bill",
 *   "LOT", "round", or any other internal step name. If a new sentence needs one
 *   of those words, the sentence is wrong, not the rule.
 */

/* -------------------------------------------------------------------------- */
/*  Where the customer is told to call                                        */
/* -------------------------------------------------------------------------- */

/**
 * The number printed when we tell the customer to call us. NULL on purpose.
 *
 * ⚠ THE ONLY NUMBER IN THIS CODEBASE IS A PLACEHOLDER. `core/landing/landingMarkup.ts`
 *   carries "+91 22 1234 5678", which is filler on a marketing page — printing it
 *   to a customer who has just been refused a cancellation would send them to a
 *   dead line at the exact moment they need us. So the sentence is written to read
 *   correctly WITHOUT a number, and gains one the moment a real line is typed here.
 *
 * The staff we notify about this customer's orders are in the org's
 * `notify_user_ids`, and their mobile numbers are on their profiles — but the
 * customer reads no table, and putting our people's personal numbers on a
 * customer-facing screen is a disclosure decision, not a default.
 */
export const SUPPORT_LINE: string | null = null;

/** "Please call us" / "Please call us on 022 …" — one sentence, one source. */
export const callUs = (lead = "Please call us"): string =>
  SUPPORT_LINE ? `${lead} on ${SUPPORT_LINE}` : `${lead}`;

/* -------------------------------------------------------------------------- */
/*  Order state, as the customer sees it                                       */
/* -------------------------------------------------------------------------- */

/**
 * The eight states, and they come from the SERVER.
 *
 * `fms_dispatch_my_orders` returns `status_key` already collapsed, which is what
 * keeps the browser from ever holding our step names. This map only turns that
 * key into English — it makes no decision.
 *
 * ⚠ THE SERVER TESTS ROUNDS BEFORE IT TESTS THE STEP, and that ordering is the
 *   whole reason `part_dispatched` exists. When a part-delivered order uses up
 *   its approved quantity it is sent back to the start and its decision is wiped,
 *   so by step alone it would read "Placed" to a customer already holding half
 *   their goods. Do not re-derive any of this here from a step name; there is no
 *   step name to re-derive it from.
 */
export type CustomerStatusKey =
  | "placed" | "preparing" | "part_dispatched" | "dispatched"
  | "delivered" | "paused" | "cancelling" | "cancelled";

export interface CustomerStatus {
  label: string;
  /** One line under the label on the order page. Plain, and never an internal reason. */
  blurb: string;
  /** Tailwind classes for the pill. */
  tone: string;
}

const PILL = {
  blue: "bg-[#EAF1FE] text-blue border-[#d6e4fd]",
  orange: "bg-orange-soft text-orange border-[#ffd9c2]",
  green: "bg-[#E9F7EF] text-[#1B7F45] border-[#c9ebd8]",
  grey: "bg-[#F1F4F9] text-grey border-line",
  red: "bg-[#FDECEC] text-[#B3282C] border-[#f6d2d3]",
  yellow: "bg-[#FEF6E3] text-[#8A6410] border-[#f6e2b6]",
} as const;

export const CUSTOMER_STATUS: Record<CustomerStatusKey, CustomerStatus> = {
  placed: {
    label: "Placed",
    blurb: "We have your order and are checking it now.",
    tone: PILL.blue,
  },
  preparing: {
    label: "Being prepared",
    blurb: "Your order is approved and we are getting the goods ready.",
    tone: PILL.orange,
  },
  part_dispatched: {
    label: "Partly dispatched",
    blurb: "Part of this order has been sent. The rest is still with us.",
    tone: PILL.orange,
  },
  dispatched: {
    label: "Dispatched",
    blurb: "Your order has left our premises.",
    tone: PILL.green,
  },
  delivered: {
    label: "Delivered",
    blurb: "This order is complete.",
    tone: PILL.green,
  },
  paused: {
    label: "Paused — we will call you",
    blurb: "This order is on hold at the moment.",
    tone: PILL.yellow,
  },
  cancelling: {
    label: "Cancellation in progress",
    blurb: "We are working through the cancellation.",
    tone: PILL.grey,
  },
  cancelled: {
    label: "Cancelled",
    blurb: "This order was cancelled.",
    tone: PILL.red,
  },
};

/**
 * Anything the server sends that this map has not heard of.
 *
 * A `status_key` cannot be null today, but a bare "" or a value added server-side
 * ahead of a deploy must not render an empty pill with no explanation. "With us"
 * is true of every state this could stand in for.
 */
export const UNKNOWN_STATUS: CustomerStatus = {
  label: "With us",
  blurb: "We have your order.",
  tone: PILL.grey,
};

export const customerStatus = (key: string): CustomerStatus =>
  CUSTOMER_STATUS[key as CustomerStatusKey] ?? UNKNOWN_STATUS;

/* -------------------------------------------------------------------------- */
/*  The change / cancel window                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Why the buttons are gone.
 *
 * ⚠ DRIVEN OFF `canChange` FROM THE SERVER, NEVER OFF THE LABEL. Two different
 *   states both read "Placed" to the customer, and only one of them is still
 *   changeable — so a screen that decided from the words on it would offer Change
 *   on an order that the server will refuse, which is a worse experience than not
 *   offering it. `can_change` is `fms_dispatch_customer_window_open`, the same
 *   function the write RPCs enforce, so the button and the server agree by
 *   construction.
 *
 * The wording matches the server's own refusal almost exactly, on purpose: if the
 * two ever disagree (a race, a stale tab), the customer reads the same sentence
 * twice rather than two different explanations. Change one and change the other —
 * `fms_dispatch_update_customer_order` and `_cancel_customer_order`.
 *
 * ⚠ IT SAYS NOTHING ABOUT WHAT WE ARE DOING, AND THAT IS THE POINT. It used to
 *   read "This order is now being prepared", which was caught on screen sitting
 *   eight lines under a pill reading "We have your order and are checking it now"
 *   — two answers to one question, disagreeing. The window shuts on ANY recorded
 *   credit decision, and a HOLD is one: the decision is stamped, the buttons go,
 *   and the status deliberately stays "Placed" because Q6 forbids telling them a
 *   hold happened. So the old sentence was guaranteed to contradict the pill on
 *   every held order — and to assert something false, since a held order is
 *   sitting still, not being prepared.
 *
 *   The customer asked whether they can change their order. The answer they need
 *   is about the order, not about which of our steps it is sitting in.
 */
export const WINDOW_SHUT =
  `This order has gone past the point where it can be changed. ${callUs()} if something needs to move.`;

/* -------------------------------------------------------------------------- */
/*  Item types                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * "Spare Parts", not `spare_parts`.
 *
 * Reuses the platform's own vocabulary rather than copying it: `ITEM_TYPES` is a
 * closed thirteen-word list whose LABELS ARE LOAD-BEARING (the Masters Excel round
 * trip matches a dropdown by label), so a second spelling here would be a second
 * answer to one question. Every one of the thirteen is an ordinary English word a
 * customer can read; none of them is internal jargon.
 *
 * The fallback is the part that is ours: `itemTypeLabel` returns "" for an
 * unclassified item, and an empty group heading on a picker reads as a bug.
 */
export const customerItemType = (t: string | null | undefined): string =>
  itemTypeLabel(t as ItemType | null) || "Other items";
