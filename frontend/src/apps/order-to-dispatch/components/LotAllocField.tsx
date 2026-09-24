import { useEffect, useRef } from "react";
import { TextInput } from "@/shared/components/ui/Form";
import MultiSelect from "@/shared/components/ui/MultiSelect";
import { advanceFocus } from "@/shared/lib/advanceFocus";
import type { LotOption } from "../data/lotFetch";

/**
 * ONE SHIPMENT, SEVERAL LOTS (OD-15).
 *
 * 100 KGS goes out as 60 from one lot and 40 from another. Until this existed
 * there was one box holding one lot, so people wrote the split by hand anyway —
 * `26081298/975kg/26081284/485kg/26071232/40kg` — and 92 dispatch lines on file
 * still carry it that way. They were not listing lots. They were ALLOCATING the
 * shipped quantity across them, and it sums.
 *
 * Used by BOTH writers — Check Material Status and the coordinator's correction
 * — which is why it is id-agnostic: it knows about lots and a quantity to hit,
 * and nothing about order lines or round items.
 *
 * ⚠ ONE LOT MEANS 100% OF IT, AND ASKS FOR NOTHING. 4,354 of 4,455 shipped lines
 *   are single-lot. That path must not get slower to type or taller on screen
 *   than the plain picker it replaces, so no quantity box is drawn at all and the
 *   server fills the figure in. The boxes appear only once a second lot is
 *   picked, which is the moment the question first has an answer.
 *
 * ⚠ TYPING MUST ALWAYS STAY POSSIBLE, and the balance is ADVISORY, NEVER A GATE.
 *   Both rules are ShipLinesGrid's, they predate this, and neither is ours to
 *   change. A lot in the store keeper's hands that Tally has not caught up with
 *   must be enterable, and ~3.6% of lots do not resolve to a clean balance — so
 *   drawing more than Tally shows says so and saves anyway. A reporting mirror
 *   does not stop a real dispatch.
 *
 * ⚠ A SELECTED LOT MUST NEVER RENDER AS NOTHING. MultiSelect derives its
 *   selection by filtering `options`, so a typed lot absent from Tally would show
 *   no chip, no count and no trigger text — the field would look empty while
 *   holding a value. Every picked value is folded into the list before it goes in.
 *
 * ⚠ MultiOption HAS NO `sublabel`, unlike Combobox. The balance therefore lives
 *   on the line beneath the box rather than inside the dropdown — which is also
 *   where it is most use, sitting beside the quantity it is advising.
 *
 * WHEN THE LOTS ALREADY ANSWER, THE BOXES FILL THEMSELVES (OD-16).
 *
 * Measured 16-09-2026: 557 dispatched lines carry lots, 7 of them several — and
 * all 7 split to exactly the Ship now figure. The question was being asked with
 * one possible answer. So when the picked lots hold NO MORE than Ship now, each
 * box is filled with what its lot holds; a person is asked only when the lots
 * hold more, the one case with a real choice. Opt-in through `autoFill`, which
 * Check Material Status turns on and the correction screen does not: that screen
 * edits a line that has already gone out, against balances that have moved on.
 *
 * ⚠ FILLED, NEVER HIDDEN OR LOCKED. Both rules above stand as they were: every
 *   box stays on screen and editable, a figure above the balance still saves, and
 *   the footer reads "10 of 10" by itself.
 *
 * ⚠ A LOT TALLY DOES NOT KNOW IS NOT A LOT HOLDING ZERO. `totalOf` gives 0 for
 *   it, and 0 ≤ Ship now reads as "fits" — filling nothing on a line that used to
 *   ask. So EVERY picked lot must resolve: in one book, the same book as the rest
 *   (one dispatch does not draw on two), in the line's own unit, with a balance
 *   that survives rounding. Anything less asks, as before.
 *
 * ⚠ A FIGURE A PERSON TYPED IS NEVER TOUCHED, nor is the rest of that split: once
 *   any box holds a typed number the field neither fills nor clears anything on
 *   that line. Clearing its own figures would be wrong there too — seeded 6 and 4
 *   for 10, a person corrects the 6 to 5, then drops Ship now to 9: the lots no
 *   longer "fit", and wiping the 4 would throw away a figure that was right. Only
 *   a box marked `seeded`, on a split nobody has typed into, is the field's own.
 *   A split reloaded from the database carries no mark, so it counts as typed.
 *
 * ⚠ IT FOLLOWS SHIP NOW, NOT ONLY THE PICK. Lots are usually ticked while Ship
 *   now is still blank, so a fill decided at the pick would never fire. And Ship
 *   now moves per keystroke — on the way to 10 it reads 1 — so the fill is
 *   re-decided on every change, from balances rather than from the figure:
 *   whatever Ship now ends on decides.
 *
 * ⚠ A SEED IS WRITTEN "1176", NEVER "1,176". The server keeps a lot quantity only
 *   if it matches `^\d+(\.\d+)?$` and stores NULL otherwise, without a word — so
 *   `fmtQty`'s en-IN grouping, right on a label, would blank every lot over 999.
 */

/** As typed: both strings, so a half-entered quantity survives a re-render. */
export interface LotRow {
  lot_no: string;
  qty: string;
  /**
   * OD-16 · the field wrote this figure from Tally's balance; no person did.
   * Never reaches the server — both save paths map rows to `{ lot_no, qty, seq }`
   * by hand.
   */
  seeded?: true;
}

/** One blank row. The field is never empty — see `rowsFrom`. */
export const emptyLotRow = (): LotRow => ({ lot_no: "", qty: "" });

/**
 * Seed the editor from what is stored.
 *
 * ⚠ THE FLAT STRING IS NEVER PARSED. A line with no children — every one of the
 *   4,454 dispatched before OD-15, and the 8 in flight right now carrying a
 *   hand-typed split — puts its WHOLE stored value into one row, verbatim. The
 *   separators cannot be read safely: `/` divides both lot-from-quantity and
 *   pair-from-pair in one string, `-` is a separator AND occurs inside lot
 *   numbers, one row uses a full stop, and 26 are print-head serial numbers
 *   rather than lots at all. One row means it round-trips byte for byte.
 */
export function rowsFrom(
  lots: { lotNo: string; qty: number | null; seq: number }[] | undefined,
  flat: string | null,
): LotRow[] {
  if (lots && lots.length > 0) {
    const ordered = [...lots].sort((a, b) => a.seq - b.seq);
    return ordered.map((l) => ({
      lot_no: l.lotNo,
      // A single lot carries the whole line, so its figure is implied and the
      // box is not drawn — holding the number here would only surface it again
      // the moment a second lot arrived.
      qty: ordered.length > 1 && l.qty !== null ? String(l.qty) : "",
    }));
  }
  return [{ lot_no: flat ?? "", qty: "" }];
}

/** The rows worth sending: a quantity without a lot is not an allocation. */
export const filledLots = (rows: LotRow[]): LotRow[] =>
  rows.filter((r) => r.lot_no.trim() !== "");

/** Trim trailing zeros — Tally reports 176.0000, and a store keeper wants 176. */
function fmtQty(n: number): string {
  return Number(n.toFixed(3)).toLocaleString("en-IN");
}

/** Two quantities this close are the same quantity. */
const QTY_EPS = 0.0005;

/**
 * A balance as a quantity box holds it: 176.0000 → "176", but with no grouping,
 * because this is sent. See the OD-16 note on why it is not `fmtQty`.
 */
const boxQty = (n: number): string => String(Number(n.toFixed(3)));

export default function LotAllocField({
  rows, onChange, quantity, unit = "", options, bookOf, disabled = false, autoFill = false,
}: {
  rows: LotRow[];
  onChange: (next: LotRow[]) => void;
  /** What the split should add up to, exactly as typed — it moves as you type. */
  quantity: string;
  unit?: string;
  /** Tally's lots for this item. Empty when ConnectWave is unreachable. */
  options: LotOption[];
  /** Names a Tally book, consulted only when one lot number spans two of them. */
  bookOf: (companyGuid: string) => string | null;
  disabled?: boolean;
  /**
   * OD-16 · fill the boxes from Tally's balances when the picked lots hold no
   * more than `quantity`. Off unless asked for — see the header.
   */
  autoFill?: boolean;
}) {
  const qtyRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const wrapRef = useRef<HTMLDivElement>(null);

  const picked = filledLots(rows);
  const values = picked.map((r) => r.lot_no);
  const multi = picked.length > 1;
  const target = Number(quantity) || 0;

  /*
    A LOT NUMBER IS ONLY UNIQUE WITHIN ONE TALLY BOOK. When the order names a
    company we ask for that book alone and this never bites — but 8 of 1,259
    orders carry no company at all, and those fetch every book, so the same
    number can legitimately come back twice with different balances. That is
    what the client saw: `#1453-2606994` at 90 KGS and again at 6 KGS.

    ⚠ OD-12 ANSWERED THAT BY NAMING THE BOOK ON THE REPEATS, and that decision
      stands — but it cannot stand in the same SHAPE here. A multi-select keys
      its options by value, so two rows sharing a lot number would tick and untick
      together: the number IS the identity in this control. Offering the same
      string twice is not something it can express.

      So the book moves from the option row to the balance line, where it says
      MORE than the old label did: not "there are two of these" but "90 in
      Noida, 6 in Delhi". Nothing is hidden, and the choice a store keeper
      actually makes — which lot — is still one row per lot.
  */
  const byLot = new Map<string, LotOption[]>();
  for (const l of options) {
    const bucket = byLot.get(l.batchName);
    if (bucket) bucket.push(l);
    else byLot.set(l.batchName, [l]);
  }

  const totalOf = (lot: string) =>
    (byLot.get(lot) ?? []).reduce((a, l) => a + l.balance, 0);

  /**
   * What Tally shows against one lot — per book once there is more than one.
   *
   * A lot Tally does not know is SAID SO rather than left blank, in OD-12's own
   * words. It goes here and not on the option label because the trigger renders
   * the label: a suffix there would rewrite what the cell says the lot is.
   */
  const balanceText = (lot: string): string | null => {
    const rows = byLot.get(lot);
    if (!rows || rows.length === 0) {
      return options.length > 0 ? "not in Tally's stock for this item" : null;
    }
    const uom = rows[0]!.uom ? ` ${rows[0]!.uom}` : "";
    if (rows.length === 1) {
      const one = rows[0]!;
      return `${fmtQty(one.balance)}${uom} left${one.lastGodown ? ` · ${one.lastGodown}` : ""}`;
    }
    const split = rows
      .map((l) => `${fmtQty(l.balance)} in ${bookOf(l.companyGuid) ?? "another book"}`)
      .join(", ");
    return `${fmtQty(totalOf(lot))}${uom} left · ${split}`;
  };

  /*
    ONE ROW PER LOT NUMBER, built from the deduped map rather than from `options`
    — which holds one entry per lot PER BOOK. Mapping it straight would emit the
    same `value` twice: duplicate React keys, and two rows that tick and untick
    as one because the selection is a set of strings.

    ⚠ THEN EVERY PICKED VALUE IS FOLDED IN, marked so the difference between
      "Tally has this" and "somebody typed this" stays visible. MultiSelect reads
      its selection by filtering this list, so a lot absent from it renders as
      NOTHING — no chip, no count, no trigger text — and the field would look
      empty while holding a value. That is worse than the text box it replaced.
  */
  /**
   * The quantity Tally shows, INSIDE the dropdown row, so a store keeper can see
   * how much each lot holds before picking it. Asked for by the client after
   * OD-15 shipped: the list read as bare numbers.
   *
   * ⚠ IT LIVES IN THE LABEL BECAUSE MultiOption HAS NO `sublabel`, and the shared
   *   MultiSelect is not this change's to widen. Two consequences, both handled:
   *   the trigger would otherwise print this whole label for a single pick, so
   *   `triggerLabel` below pins it to the bare lot number; and MultiSelect offers
   *   "create" whenever the typed text matches no LABEL exactly, so typing a lot
   *   number Tally does hold would say "(not in Tally)" — `createLabel` checks the
   *   lot itself, not the label.
   *
   * One book: `#1634-26071185 · 90 KGS`. Several books (only on an order with no
   * company): `#1453-2606994 · 90 KGS Noida, 6 KGS Delhi`.
   */
  const optionLabel = (lot: string): string => {
    const rows = byLot.get(lot);
    if (!rows || rows.length === 0) return lot;
    const uom = rows[0]!.uom ? ` ${rows[0]!.uom}` : "";
    if (rows.length === 1) return `${lot} · ${fmtQty(rows[0]!.balance)}${uom}`;
    return `${lot} · ${rows
      .map((l) => `${fmtQty(l.balance)}${uom} ${bookOf(l.companyGuid) ?? "another book"}`)
      .join(", ")}`;
  };

  const opts = Array.from(byLot.keys()).map((lot) => ({ value: lot, label: optionLabel(lot) }));
  const known = new Set(opts.map((o) => o.value));
  for (const v of values) {
    if (!known.has(v)) {
      known.add(v);
      opts.unshift({ value: v, label: v });
    }
  }

  /**
   * OD-16 · decide the figures the field itself puts in the boxes. Null when
   * nothing would change, so a keystroke that alters nothing writes nothing.
   *
   * Every picked lot must resolve before anything is filled — see the header for
   * why an unknown lot, a second book or another unit each fall back to asking.
   * The capacity is summed from the ROUNDED figures the boxes will hold, so the
   * decision and the footer's own sum can never disagree.
   */
  const reseed = (current: LotRow[], shipNow: number): LotRow[] | null => {
    const lots = filledLots(current);
    if (!autoFill || disabled || lots.length < 2) return null;
    if (lots.some((r) => !r.seeded && r.qty.trim() !== "")) return null;

    const seedOf = new Map<string, string>();
    let book: string | null = null;
    let capacity = 0;
    for (const r of lots) {
      const found = byLot.get(r.lot_no);
      // Absent is unknown, and two entries means two books — neither is a balance.
      const one = found && found.length === 1 ? found[0]! : null;
      if (!one) break;
      const qty = boxQty(one.balance);
      const sameUnit = !one.uom || !unit || one.uom.trim().toLowerCase() === unit.trim().toLowerCase();
      if (!(Number(qty) > 0) || !sameUnit || (book !== null && one.companyGuid !== book)) break;
      book = one.companyGuid;
      capacity += Number(qty);
      seedOf.set(r.lot_no, qty);
    }

    /*
      ⚠ "FITS" INCLUDES BEING SHORT. Lots holding 8 against a Ship now of 10 fill
        8, and the footer says "2 short, saved as it is". If the client would
        rather be asked in that case, this becomes
        `Math.abs(capacity - shipNow) <= QTY_EPS`.
    */
    const fits = seedOf.size === lots.length && shipNow > 0 && capacity <= shipNow + QTY_EPS;

    let changed = false;
    const next = current.map((r): LotRow => {
      if (r.lot_no.trim() === "") return r;
      if (fits) {
        const qty = seedOf.get(r.lot_no)!;
        if (r.seeded && r.qty === qty) return r;
        changed = true;
        return { lot_no: r.lot_no, qty, seeded: true };
      }
      if (!r.seeded) return r;
      changed = true;
      return { lot_no: r.lot_no, qty: "" };
    });
    return changed ? next : null;
  };

  /**
   * Reconcile the picker's flat list back onto the rows.
   *
   * A lot that survives keeps the row already against it — its quantity, and
   * whether the field or a person put that there; a new one arrives blank; the
   * order follows the picker, which is also the stored `seq`.
   *
   * ⚠ DROPPING TO ONE LOT CLEARS ITS QUANTITY. That row now carries the whole
   *   line by definition, so a 60 left over from a split would be recorded as
   *   "60 of the 100 came from here" and say nothing about the other 40.
   */
  const setValues = (next: string[]) => {
    const prev = new Map(rows.map((r) => [r.lot_no, r]));
    const out: LotRow[] = next.map((lot) => prev.get(lot) ?? { lot_no: lot, qty: "" });
    if (out.length <= 1) {
      const one = out[0] ?? emptyLotRow();
      onChange([{ lot_no: one.lot_no, qty: "" }]);
      return;
    }
    // Decided in the SAME change as the pick, not in an effect after it, so the
    // parent never holds the unfilled split for a render.
    const filled = reseed(out, target) ?? out;
    onChange(filled);
    // The question a second lot raises is "how much from each", so the caret
    // goes to the first box that has no answer. Next frame, because the row
    // being focused does not exist until this render lands.
    const blank = filled.findIndex((r) => r.qty.trim() === "");
    if (blank >= 0) {
      requestAnimationFrame(() => qtyRefs.current[blank]?.focus());
    } else if (filled.every((r) => r.seeded)) {
      // Every box answered by the lots themselves: nothing here is waiting on
      // the store keeper, so the caret moves on to the next field instead.
      requestAnimationFrame(() => advanceFocus(wrapRef.current));
    }
  };

  // A figure a person types is theirs, so it drops the `seeded` mark (OD-16).
  const setQty = (i: number, qty: string) =>
    onChange(rows.map((r, j) => (j === i ? { lot_no: r.lot_no, qty } : r)));

  const removeAt = (i: number) => setValues(values.filter((_, j) => j !== i));

  /*
    OD-16 · SHIP NOW MOVED UNDER A SPLIT ALREADY PICKED — decide the fill again.

    Keyed on the last quantity SEEN rather than run on mount, so opening a round
    rewrites nothing, and StrictMode's second mount is a no-op too. No focus moves:
    the store keeper is typing in Ship now.

    ⚠ `onChange` here is the parent's patch over THIS render's values, so if two
      lines' Ship now changed in one commit the later patch would carry the
      earlier line's old rows. Only the step modal's re-seed changes several at
      once, and it replaces the rows as well — so the worst case is one line that
      asks for its split, as it did before OD-16.
  */
  const lastQuantity = useRef(quantity);
  useEffect(() => {
    if (lastQuantity.current === quantity) return;
    lastQuantity.current = quantity;
    const next = reseed(rows, target);
    if (next) onChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quantity]);

  const sum = picked.reduce((a, r) => a + (Number(r.qty) || 0), 0);
  const anyQty = picked.some((r) => r.qty.trim() !== "");
  const off = anyQty && target > 0 && Math.abs(sum - target) > QTY_EPS;

  return (
    <div ref={wrapRef} className="space-y-1.5">
      <MultiSelect
        values={values}
        onChange={setValues}
        options={opts}
        /* The default summary joins two picks with a comma — "26081298, 26081284"
           — which reads as one long lot number in a narrow cell and is exactly
           what the rows below are for. Past one, the trigger says how many and
           the breakdown does the talking. */
        triggerLabel={multi ? `${values.length} lots` : values[0] || undefined}
        // Accept anything typed, verbatim. This is the escape hatch that keeps a
        // lot we cannot see from blocking a real dispatch — see the header note.
        onCreate={(typed) => {
          const t = typed.trim();
          if (t && !values.includes(t)) setValues([...values, t]);
        }}
        createLabel={(q) => (byLot.has(q.trim()) ? `Use “${q}”` : `Use “${q}” (not in Tally)`)}
        searchable
        disabled={disabled}
        /* Says BOTH things on purpose. The old box read "as marked on the stock",
           which is still the instruction — but now that a list exists, a store
           keeper has to be told the list is not a closed one, or a lot Tally has
           not caught up with looks impossible to enter. */
        placeholder="pick or type the lot"
        triggerClassName="py-1"
      />

      {/* ONE LOT: no box to fill, just what Tally shows against it. Keeping this
          line is what stops OD-12's balance disappearing on the common path. */}
      {!multi && values[0] && balanceText(values[0]) && (
        <p className="text-[11.5px] text-grey-2">{balanceText(values[0])}</p>
      )}

      {multi && (
        <div className="space-y-1">
          {picked.map((r, i) => {
            const bal = balanceText(r.lot_no);
            const drawn = Number(r.qty) || 0;
            const overDrawn = byLot.has(r.lot_no) && drawn > totalOf(r.lot_no) + QTY_EPS;
            return (
              <div key={`${r.lot_no}-${i}`} className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <span className="block text-[12.5px] text-navy break-words">{r.lot_no}</span>
                  {bal && (
                    <span className={`block text-[11px] ${overDrawn ? "text-orange" : "text-grey-2"}`}>
                      {overDrawn ? `${bal} — more than that, saved anyway` : bal}
                    </span>
                  )}
                </div>
                {/*
                  ⚠ THE WIDTH IS ON THE WRAPPER, NOT ON THE INPUT, and it has to
                    be. `cn` is a plain join with no tailwind-merge, so a `w-20`
                    passed to TextInput does not replace the `w-full` baked into
                    `fieldBase` — both land in the class list and `w-full` wins.
                    The box then eats the whole cell and the lot number beside it
                    wraps to one character per line. Seen on screen, not in tsc.
                */}
                <div className="w-20 shrink-0">
                  <TextInput
                    ref={(el) => { qtyRefs.current[i] = el; }}
                    value={r.qty}
                    onChange={(e) => setQty(i, e.target.value)}
                    disabled={disabled}
                    // inputMode, never type="number" — the o2d convention.
                    inputMode="decimal"
                    placeholder="0"
                    aria-label={`Quantity from lot ${r.lot_no}`}
                    className="px-2 py-1 text-[12.5px] text-right tabular-nums"
                  />
                </div>
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => removeAt(i)}
                    aria-label={`Remove lot ${r.lot_no}`}
                    className="shrink-0 mt-1 text-grey-2 hover:text-ryg-red transition"
                  >
                    ✕
                  </button>
                )}
              </div>
            );
          })}

          {/* The same shape as the grid's credit footer: the figure is always
              there, and only its colour changes. A gap is shown, never blocked —
              see the header. */}
          <p className={`text-[11.5px] ${off ? "text-orange" : "text-grey-2"}`}>
            {!anyQty
              ? `Say how much came from each — ${target || "the quantity"}${unit ? ` ${unit}` : ""} in total.`
              : off
                ? `${fmtQty(sum)} of ${fmtQty(target)}${unit ? ` ${unit}` : ""} — ${fmtQty(Math.abs(target - sum))} ${sum < target ? "short" : "over"}, saved as it is.`
                : `${fmtQty(sum)} of ${fmtQty(target)}${unit ? ` ${unit}` : ""}`}
          </p>
        </div>
      )}
    </div>
  );
}
