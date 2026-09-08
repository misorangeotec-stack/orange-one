import { getConnectwave, hasConnectwave } from "@/core/platform/connectwave";

/**
 * Live LOT numbers from Tally, for the picker at Check Material Status (OD-12).
 *
 * The LOT was typed by hand into a free-text box — placeholder "as marked on the stock" — so it
 * could be mistyped or invented and nothing checked it against Tally. This reads the real lots
 * for the item being dispatched, and how much of each is left.
 *
 * ⚠ ADVISORY, NOT AUTHORITATIVE. `balance` is Tally's paper trail (opening + in − out, with
 *   delivery-note/invoice double-counting removed), not a physical stock count. It is shown so a
 *   store keeper can sanity-check it against what is in front of them. **Typing must always stay
 *   possible** — a lot that is physically present but absent here (Tally not yet posted, a manual
 *   adjustment we cannot see, one of the ~3.6% of lots whose arithmetic does not resolve) must
 *   never block a real dispatch.
 *
 * ⚠ NEVER let this break the screen. ConnectWave is a different project on a different key; if it
 *   is down, unconfigured, or slow, the caller gets an empty list and the plain text input keeps
 *   working exactly as it does today. Dispatch cannot wait on a reporting mirror.
 */
export interface LotOption {
  /** Tally company book this lot belongs to. */
  companyGuid: string;
  batchName: string;
  /** Opening + inwards − outwards. Can be large; the UI formats it. */
  balance: number;
  uom: string | null;
  /** 'YYYYMMDD', the house convention for Tally dates. */
  lastMovement: string | null;
  /** Manufacture date where Tally carries one, or decoded from a YYMMDD lot prefix. */
  batchDate: string | null;
  /** Null for the current financial year until the ConnectWave fetch change lands. */
  lastGodown: string | null;
}

/**
 * Lots with stock left for `itemName`, biggest first.
 *
 * `companyGuid` scopes to one Tally book — a lot in one company's book is not stock another can
 * ship, and the same lot number legitimately exists in more than one. Pass null only when the
 * company genuinely is not known; the picker then labels each row with its book.
 */
export async function fetchLotsForItem(
  itemName: string,
  companyGuid: string | null,
): Promise<LotOption[]> {
  if (!hasConnectwave() || !itemName.trim()) return [];
  try {
    const { data, error } = await getConnectwave().rpc("rpt_lots_for_item", {
      p_item: itemName,
      p_company: companyGuid,
    });
    if (error) {
      console.warn("[lotFetch] ConnectWave rejected the lot lookup:", error.message);
      return [];
    }
    return (data ?? []).map((r: any): LotOption => ({
      companyGuid: String(r.company_guid ?? ""),
      batchName: String(r.batch_name ?? ""),
      balance: Number(r.balance) || 0,
      uom: r.uom ?? null,
      lastMovement: r.last_movement ?? null,
      batchDate: r.batch_date ?? null,
      lastGodown: r.last_godown ?? null,
    })).filter((l: LotOption) => l.batchName !== "");
  } catch (e) {
    // Deliberately swallowed: a reporting mirror being unreachable must not stop a dispatch.
    console.warn("[lotFetch] lot lookup failed, falling back to free text:", e);
    return [];
  }
}
