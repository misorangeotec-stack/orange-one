import { useEffect, useState } from "react";
import { TextInput } from "@/shared/components/ui/Form";
import Combobox from "@/shared/components/ui/Combobox";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useDispatchStore } from "../store";
import { fetchLotsForItem, type LotOption } from "../data/lotFetch";
import { creditHeadroomOf, pendingQtyOf } from "../lib/rounds";
import { qtyTotals, sharedUnit } from "../lib/format";
import type { DispatchOrder } from "../types";

/**
 * The heart of the reshaped flow: which lines are going out THIS round, how much
 * of each, and from which LOT.
 *
 * NOT a LineGrid. The lines already exist and their item and ordered quantity are
 * fixed intake, so nothing is appended or removed here — only the two dispatch
 * columns are editable. That is also why partial dispatch is expressed per line
 * rather than as an order-level state.
 *
 * Two deliberate choices:
 *   • "Ship now" seeds BLANK, never "all of it". This is a partial step by design;
 *     pre-filling the balance would make sending everything the accidental default.
 *   • A line with nothing left pending is locked and labelled Complete. It cannot
 *     be typed into, so nobody discovers by round-trip that the server refuses it.
 *
 * ⚠ THE CREDIT CEILING IS A SUM, NOT A PER-LINE CLAMP. Credit approves a quantity
 *   for the consignment and leaves the split to whoever can see the stock, so no
 *   individual input is capped — the TOTAL is, and it says so live in the footer.
 *   Clamping rows individually would invent a per-line allocation credit never
 *   made. A null headroom means uncapped: every order raised before partial
 *   approval existed has one, and they must keep behaving exactly as they did.
 *
 * THE LOT COMES LIVE FROM TALLY (OD-12), BUT CAN STILL BE TYPED.
 *   It used to be a bare text box reading "as marked on the stock", so a lot could be mistyped
 *   or invented and nothing checked it. It is now a picker of the lots Tally actually holds for
 *   that item, with how much of each is left.
 *
 *   ⚠ Typing is deliberately still allowed, via Combobox's `onCreate`. The balance is Tally's
 *     paper trail, not a physical count, and ~3.6% of lots do not resolve to a clean figure. A
 *     lot in the store keeper's hands that we cannot see — Tally not yet posted, a manual
 *     adjustment — must never block a dispatch. The list HELPS; it does not gate.
 *
 *   ⚠ If ConnectWave is unreachable the fetch returns [] and this degrades to exactly the old
 *     free-text box. Dispatch does not wait on a reporting mirror.
 */

export interface ShipLineValue {
  id: string;
  ship_qty: string;
  lot_no: string;
}

/** Seed from the order's live header — an edit shows what this round already has. */
export function shipLinesFrom(order: DispatchOrder): ShipLineValue[] {
  return order.lines.map((l) => ({
    id: l.id,
    ship_qty: l.shipQty !== null && l.shipQty !== undefined ? String(l.shipQty) : "",
    lot_no: l.lotNo ?? "",
  }));
}

/**
 * Lots for one line, as Combobox options: the number, then how much is left.
 *
 * `current` is folded in when it is not among them, because a lot typed on an earlier round (or
 * one that has since gone to zero) must still SHOW as the selected value — a picker that silently
 * blanks a stored value is worse than the text box it replaced. It is marked so the difference
 * between "Tally has this" and "somebody typed this" stays visible.
 */
function lotOptions(
  list: LotOption[] | undefined,
  current: string,
  bookOf: (companyGuid: string) => string | null,
) {
  const rows = list ?? [];

  /*
    A LOT NUMBER IS ONLY UNIQUE WITHIN ONE TALLY BOOK. When the order names a company we ask for
    that book alone and this never bites — but 8 of 1,259 orders carry no company at all, and those
    fetch every book, so the same number can legitimately come back twice with different balances.
    That is what the client saw: `#1453-2606994` listed at 90 KGS and again at 6 KGS.

    Naming the book on the repeats — and ONLY on the repeats, so the common case stays uncluttered —
    is the difference between two indistinguishable rows and a real choice.
  */
  const times = new Map<string, number>();
  rows.forEach((l) => times.set(l.batchName, (times.get(l.batchName) ?? 0) + 1));

  const opts = rows.map((l) => ({
    value: l.batchName,
    label: l.batchName,
    sublabel: [
      `${fmtQty(l.balance)}${l.uom ? ` ${l.uom}` : ""} left`,
      (times.get(l.batchName) ?? 0) > 1 ? bookOf(l.companyGuid) : null,
      l.lastGodown ?? null,
    ].filter(Boolean).join(" · "),
  }));
  const cur = current.trim();
  if (cur && !opts.some((o) => o.value === cur)) {
    opts.unshift({ value: cur, label: cur, sublabel: "not in Tally's stock for this item" });
  }
  return opts;
}

/** Trim trailing zeros — Tally reports 176.0000, and a store keeper wants 176. */
function fmtQty(n: number): string {
  return Number(n.toFixed(3)).toLocaleString("en-IN");
}

export default function ShipLinesGrid({
  order, values, onChange, readOnly = false,
}: {
  order: DispatchOrder;
  values: ShipLineValue[];
  onChange: (next: ShipLineValue[]) => void;
  readOnly?: boolean;
}) {
  const s = useDispatchStore();
  const byId = new Map(values.map((v) => [v.id, v]));

  /**
   * Lots per line, fetched once per DISTINCT item rather than per row — an order repeating the
   * same item on two lines must not fire the same lookup twice.
   */
  const [lots, setLots] = useState<Record<string, LotOption[]>>({});
  const companyGuid = s.companies.find((c) => c.id === order.companyId)?.tallyGuid ?? null;
  /*
    Only consulted when the same lot number comes back from more than one book — see lotOptions.
    The financial-year tail is trimmed off the company name ("…PVT LTD(F.Y.2026-27)",
    "…-NOIDA -FY 26-27") because every book carries one, so it is the half that never tells the
    two apart, and it is what pushes the label past a dropdown's width.
  */
  const bookOf = (guid: string) => {
    const c = s.companies.find((x) => x.tallyGuid === guid);
    if (!c) return null;
    return c.name
      .split("(")[0]
      .replace(/[-\s]*F\.?Y\.?[\s.]*\d.*$/i, "")
      .replace(/[-\s]+$/, "")
      .trim() || c.name;
  };
  const itemNames = Array.from(
    new Set(order.lines.map((l) => s.itemName(l.itemId)).filter(Boolean)),
    // Joined into a STRING because useEffect compares deps by identity and a fresh array
    // would refetch on every render. The separator is \u0000 and NOT a space or comma:
    // item names legitimately contain both ("REACTIVE INK ECO BLACK"), so either would
    // split one name into several and look up items that do not exist.
  ).join("\u0000");

  useEffect(() => {
    const names = itemNames ? itemNames.split("\u0000") : [];
    if (!names.length) return;
    let live = true;
    void Promise.all(names.map((n) => fetchLotsForItem(n, companyGuid))).then((res) => {
      if (!live) return;
      const next: Record<string, LotOption[]> = {};
      names.forEach((n, i) => { next[n] = res[i]; });
      setLots(next);
    });
    return () => { live = false; };
  }, [itemNames, companyGuid]);

  const patch = (id: string, part: Partial<ShipLineValue>) => {
    onChange(values.map((v) => (v.id === id ? { ...v, ...part } : v)));
  };

  // Ordered / dispatched / pending come off the order. "Ship now" must NOT — it is
  // being typed right now, so it is summed from `values` and moves as you type.
  const t = qtyTotals(order);
  const total = order.lines.reduce((a, l) => a + (Number(byId.get(l.id)?.ship_qty) || 0), 0);
  // Named for the totals row — the row map has its own per-line `unit`.
  const totalUnit = sharedUnit(order.lines);
  const headroom = creditHeadroomOf(order);
  const over = headroom !== null && total > headroom;

  return (
    <div className="space-y-2">
      <ScrollableTable>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-grey-2 border-b border-line">
              <th className="py-2 pr-3 font-semibold min-w-[180px]">Item</th>
              <th className="py-2 pr-3 font-semibold text-right">Ordered</th>
              <th className="py-2 pr-3 font-semibold text-right">Dispatched so far</th>
              <th className="py-2 pr-3 font-semibold text-right">Pending</th>
              <th className="py-2 pr-3 font-semibold min-w-[120px]">Ship now</th>
              <th className="py-2 pr-3 font-semibold min-w-[150px]">LOT no.</th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((l) => {
              const v = byId.get(l.id) ?? { id: l.id, ship_qty: "", lot_no: "" };
              const pending = pendingQtyOf(l);
              const done = pending <= 0;
              const unit = l.unit ?? "";
              return (
                <tr key={l.id} className="border-b border-line/70 last:border-0">
                  <td className="py-2 pr-3 text-navy">
                    {s.itemName(l.itemId)}
                    {l.lineRemark && <span className="block text-[12px] text-grey-2">{l.lineRemark}</span>}
                  </td>
                  <td className="py-2 pr-3 text-grey text-right tabular-nums whitespace-nowrap">
                    {l.quantity} {unit}
                  </td>
                  <td className="py-2 pr-3 text-grey text-right tabular-nums">{l.dispatchedQty || "—"}</td>
                  <td className="py-2 pr-3 text-right tabular-nums font-semibold text-navy">
                    {done ? <span className="text-ryg-green">Complete</span> : pending}
                  </td>
                  <td className="py-2 pr-3">
                    {done ? (
                      <span className="text-[12.5px] text-grey-2">—</span>
                    ) : (
                      <TextInput
                        value={v.ship_qty}
                        onChange={(e) => patch(l.id, { ship_qty: e.target.value })}
                        disabled={readOnly}
                        inputMode="decimal"
                        placeholder="0"
                        className="w-24 text-right tabular-nums"
                      />
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {done ? (
                      <span className="text-[12.5px] text-grey-2">—</span>
                    ) : (
                      <Combobox
                        value={v.lot_no}
                        onChange={(lot) => patch(l.id, { lot_no: lot })}
                        options={lotOptions(lots[s.itemName(l.itemId)], v.lot_no, bookOf)}
                        // Accept anything typed, verbatim. This is the escape hatch that keeps a
                        // lot we cannot see from blocking a real dispatch — see the header note.
                        onCreate={(typed) => typed.trim()}
                        createLabel={(q) => `Use “${q}” (not in Tally)`}
                        searchable
                        clearable
                        disabled={readOnly}
                        /* Says BOTH things on purpose. The old box read "as marked on the stock",
                           which is still the instruction — but now that a list exists, a store
                           keeper has to be told the list is not a closed one, or a lot Tally has
                           not caught up with looks impossible to enter. */
                        placeholder="pick or type the lot"
                        triggerClassName="py-1"
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          {/*
            Every figure column carries its own total, sitting directly under the
            column it sums. "Ship now" is the live one — it re-adds on each keystroke,
            so the store keeper can see the round's total without a calculator.
          */}
          <tfoot>
            <tr className="border-t border-line text-navy">
              <td className="py-2 pr-3 text-[11.5px] font-semibold uppercase tracking-wide text-grey-2">
                Total
              </td>
              <td className="py-2 pr-3 text-right tabular-nums font-bold whitespace-nowrap">
                {t.ordered} {totalUnit}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums font-bold">{t.dispatched || "—"}</td>
              <td className="py-2 pr-3 text-right tabular-nums font-bold">{t.pending || "—"}</td>
              {/* w-24 matches the input above it, so the figure lines up with the box. */}
              <td className="py-2 pr-3">
                <span
                  className={`block w-24 text-right tabular-nums font-bold ${
                    over ? "text-ryg-red" : "text-orange"
                  }`}
                >
                  {total || "—"}
                </span>
              </td>
              <td className="py-2 pr-3" />
            </tr>
          </tfoot>
        </table>
      </ScrollableTable>

      {/* The ceiling belongs beside the figure it caps, and it has to be legible
          BEFORE anyone types — a limit discovered by a refused save is not a
          limit, it is a surprise. */}
      {headroom !== null && (
        <p className={`text-[12.5px] ${over ? "text-ryg-red" : "text-grey-2"}`}>
          {over
            ? `Credit has authorised only ${headroom}${totalUnit ? ` ${totalUnit}` : ""} more on this order — reduce the quantities going out.`
            : `Credit approved: ${headroom}${totalUnit ? ` ${totalUnit}` : ""} still authorised.`}
        </p>
      )}

      <p className="text-[12.5px] text-grey-2">
        {total > 0
          ? "Anything left pending comes back here when it is ready."
          : "Enter a quantity against whatever is available. Use “Nothing available yet” if none of it is."}
      </p>
    </div>
  );
}
