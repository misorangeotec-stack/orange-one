import { useSavedDrafts } from "@/shared/lib/useSavedDrafts";
import type { DeskLineInput } from "../data/orderDesk";

/**
 * The customer's saved-but-not-placed orders.
 *
 * ⚠ THE ONE TABLE THIS APP READS DIRECTLY, and it is safe to. Everything else on
 *   the Order Desk goes through a SECURITY DEFINER RPC so the customer never
 *   touches our tables. `fms_drafts` is the hub's shared drafts table, and its
 *   row policies already give each login its own rows and nothing else (admins
 *   aside). A draft holds only what this customer typed — never a ledger list,
 *   a company or a price.
 *
 * A draft is just the form: which of their companies, the lines, the note. It
 * is checked like any order only when it is placed.
 */
export const DESK_DRAFTS_KEY = "customer-orders:order";

export interface DeskDraftPayload {
  ledgerId: string;
  lines: DeskLineInput[];
  remarks: string;
}

export const useDeskDrafts = () => useSavedDrafts<DeskDraftPayload>(DESK_DRAFTS_KEY);

/** "Saved 8 Oct, 4:32 pm" */
export function savedLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `Saved ${d.toLocaleDateString([], { day: "numeric", month: "short" })}, ${d
    .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    .toLowerCase()}`;
}
