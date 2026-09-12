import { useRef } from "react";
import { TextInput } from "@/shared/components/ui/Form";
import MultiSelect from "@/shared/components/ui/MultiSelect";
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
 */

/** As typed: both strings, so a half-entered quantity survives a re-render. */
export interface LotRow {
  lot_no: string;
  qty: string;
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

export default function LotAllocField({
  rows, onChange, quantity, unit = "", options, bookOf, disabled = false,
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
}) {
  const qtyRefs = useRef<Record<number, HTMLInputElement | null>>({});

  const picked = filledLots(rows);
  const values = picked.map((r) => r.lot_no);
  const multi = picked.length > 1;

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
  const opts = Array.from(byLot.keys()).map((lot) => ({ value: lot, label: lot }));
  const known = new Set(opts.map((o) => o.value));
  for (const v of values) {
    if (!known.has(v)) {
      known.add(v);
      opts.unshift({ value: v, label: v });
    }
  }

  /**
   * Reconcile the picker's flat list back onto the rows.
   *
   * A lot that survives keeps the quantity already typed against it; a new one
   * arrives blank; the order follows the picker, which is also the stored `seq`.
   *
   * ⚠ DROPPING TO ONE LOT CLEARS ITS QUANTITY. That row now carries the whole
   *   line by definition, so a 60 left over from a split would be recorded as
   *   "60 of the 100 came from here" and say nothing about the other 40.
   */
  const setValues = (next: string[]) => {
    const byLot = new Map(rows.map((r) => [r.lot_no, r.qty]));
    const out: LotRow[] = next.map((lot) => ({ lot_no: lot, qty: byLot.get(lot) ?? "" }));
    if (out.length <= 1) {
      const one = out[0] ?? emptyLotRow();
      onChange([{ lot_no: one.lot_no, qty: "" }]);
      return;
    }
    onChange(out);
    // The question a second lot raises is "how much from each", so the caret
    // goes to the first box that has no answer. Next frame, because the row
    // being focused does not exist until this render lands.
    const blank = out.findIndex((r) => r.qty.trim() === "");
    if (blank >= 0) requestAnimationFrame(() => qtyRefs.current[blank]?.focus());
  };

  const setQty = (i: number, qty: string) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, qty } : r)));

  const removeAt = (i: number) => setValues(values.filter((_, j) => j !== i));

  const target = Number(quantity) || 0;
  const sum = picked.reduce((a, r) => a + (Number(r.qty) || 0), 0);
  const anyQty = picked.some((r) => r.qty.trim() !== "");
  const off = anyQty && target > 0 && Math.abs(sum - target) > 0.0005;

  return (
    <div className="space-y-1.5">
      <MultiSelect
        values={values}
        onChange={setValues}
        options={opts}
        /* The default summary joins two picks with a comma — "26081298, 26081284"
           — which reads as one long lot number in a narrow cell and is exactly
           what the rows below are for. Past one, the trigger says how many and
           the breakdown does the talking. */
        triggerLabel={multi ? `${values.length} lots` : undefined}
        // Accept anything typed, verbatim. This is the escape hatch that keeps a
        // lot we cannot see from blocking a real dispatch — see the header note.
        onCreate={(typed) => {
          const t = typed.trim();
          if (t && !values.includes(t)) setValues([...values, t]);
        }}
        createLabel={(q) => `Use “${q}” (not in Tally)`}
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
            const overDrawn = byLot.has(r.lot_no) && drawn > totalOf(r.lot_no) + 0.0005;
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
