import { useMemo, useRef, useState } from "react";
import Button from "@/shared/components/ui/Button";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { TextInput, TextArea } from "@/shared/components/ui/Form";
import type { DeskCompany, DeskItem, DeskLineInput } from "../data/orderDesk";
import { customerItemType } from "../lib/customerLabels";

/**
 * The order form — ONE component, used to place an order and to change one.
 *
 * Two copies of this would be two sets of rules about what a valid order is, and
 * the change screen is the one that would quietly fall behind. The only thing the
 * two callers differ on is the words on the button and what happens after.
 */

const blankLine = (): DeskLineInput => ({ itemId: "", quantity: "", lineRemark: "" });

/**
 * The item picker's options, grouped by type.
 *
 * ⚠ THE GROUP IS THE SUBSTITUTE FOR A TYPE FILTER, and it is a better one. A
 *   separate "item type" dropdown beside the item would be a control the customer
 *   has to operate BEFORE the one they actually came for, and getting it wrong
 *   empties the list they are searching. `Combobox` renders a heading whenever the
 *   group changes, so sorting by (type, name) gives the same grouping for free and
 *   the search still runs across everything at once.
 *
 * The unit rides along as the sublabel because it is the question they ask
 * immediately after picking — "twenty of what?" — and because `Combobox` searches
 * sublabels too, so "KG" narrows the list.
 */
function itemOptions(items: DeskItem[]): ComboOption[] {
  return [...items]
    .sort(
      (a, b) =>
        customerItemType(a.itemType).localeCompare(customerItemType(b.itemType)) ||
        a.name.localeCompare(b.name)
    )
    .map((i) => ({
      value: i.itemId,
      label: i.name,
      sublabel: i.unit ?? undefined,
      group: customerItemType(i.itemType),
    }));
}

/**
 * An item that is ON the order but no longer OFFERED.
 *
 * ⚠ WITHOUT THIS, CHANGING SUCH AN ORDER SILENTLY DROPS THE LINE. The picker is
 *   built from what the customer may order TODAY, and a line placed last week can
 *   have left that list since — the item deactivated in Tally, or the mapping
 *   removed. A `Combobox` handed a value with no matching option renders empty, so
 *   the customer would see a quantity against a blank item, assume the screen was
 *   still loading, and save an order one line shorter than the one they opened.
 *
 *   So the line keeps its name, in its own group, and says what is wrong. The
 *   server refuses the save in its own customer-facing words ("Sorry — X is not on
 *   your list. Please call us and we will add it."), which is the right answer;
 *   this only makes sure the customer can SEE which line it is talking about.
 */
export interface RetiredItem {
  itemId: string;
  name: string;
}

const RETIRED_GROUP = "No longer on your list";

export default function OrderForm({
  items,
  retired,
  companies,
  companyId,
  onCompanyChange,
  companyLabel,
  initialLines,
  initialRemarks,
  submitLabel,
  busyLabel,
  onSubmit,
  onCancel,
  cancelLabel,
}: {
  items: DeskItem[];
  retired?: RetiredItem[];
  /**
   * Which of ours they may buy from. Passed only when placing — an order that
   * already exists is committed to a book and cannot move to another.
   */
  companies?: DeskCompany[];
  companyId?: string;
  onCompanyChange?: (id: string) => void;
  /** Shown instead of the picker when changing an existing order. */
  companyLabel?: string | null;
  initialLines?: DeskLineInput[];
  initialRemarks?: string;
  submitLabel: string;
  busyLabel: string;
  onSubmit: (lines: DeskLineInput[], remarks: string) => Promise<void>;
  onCancel?: () => void;
  cancelLabel?: string;
}) {
  const [lines, setLines] = useState<DeskLineInput[]>(
    initialLines?.length ? initialLines : [blankLine()]
  );
  const [remarks, setRemarks] = useState(initialRemarks ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [touched, setTouched] = useState(false);

  const options = useMemo(
    () => [
      ...itemOptions(items),
      // Last, so the ordinary list is not led by a group of things they cannot have.
      ...(retired ?? []).map((r) => ({ value: r.itemId, label: r.name, group: RETIRED_GROUP })),
    ],
    [items, retired]
  );
  const itemById = useMemo(() => new Map(items.map((i) => [i.itemId, i])), [items]);
  const retiredIds = useMemo(() => new Set((retired ?? []).map((r) => r.itemId)), [retired]);

  const setLine = (idx: number, patch: Partial<DeskLineInput>) =>
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  /*
    TAB-WALK — the order runs item → quantity → note → next line, and nothing in
    it is a dead end.

    ⚠ THE JUMP AFTER PICKING AN ITEM IS NOT A CONVENIENCE, IT IS A CORRECTION.
      `Combobox` returns focus to its own trigger when it closes, which is the
      right thing for a lone field and the wrong thing here: the customer picks
      their ink and the cursor sits back on the ink box, so the next thing they
      type goes into a search instead of the quantity. One line, one item, one
      quantity — the quantity is always where they are going next.

    ⚠ ENTER IS THE FAST PATH, TAB IS THE COMPLETE ONE. Enter from the quantity or
      the note jumps straight to the next line's item, adding a line if this was
      the last — that is the repeat-entry rhythm. Tab still walks every field in
      turn, INCLUDING the note and the remove button, because skipping them to
      make Enter's shortcut the only route would leave a keyboard user unable to
      reach a control that is plainly on the screen.

    Focus is taken on the next frame because the row being focused may not exist
    yet: `setLines` has to render before its input can be found.
  */
  const rowRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const qtyRefs = useRef<Record<number, HTMLInputElement | null>>({});

  const focusQty = (idx: number) =>
    requestAnimationFrame(() => qtyRefs.current[idx]?.focus());

  const focusItem = (idx: number) =>
    requestAnimationFrame(() =>
      rowRefs.current[idx]?.querySelector<HTMLElement>("[data-item] button")?.focus(),
    );

  /** Enter anywhere in a line moves to the next line, making one if needed. */
  const onLineEnter = (idx: number) => (e: React.KeyboardEvent) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (idx === lines.length - 1) setLines((ls) => [...ls, blankLine()]);
    focusItem(idx + 1);
  };

  /**
   * The same item on two lines.
   *
   * NOT prevented by hiding it from the other rows' dropdowns: a customer who
   * scrolls to their usual ink and cannot find it does not conclude "I already
   * added it", they conclude the list is broken. Better to let them pick it and
   * then say exactly where the other one is.
   */
  const duplicateOf = (idx: number): number | null => {
    const id = lines[idx].itemId;
    if (!id) return null;
    const first = lines.findIndex((l) => l.itemId === id);
    return first === idx ? null : first + 1;
  };

  const filled = lines.filter((l) => l.itemId);
  const anyDuplicate = lines.some((_, i) => duplicateOf(i) !== null);
  const badQuantity = filled.some((l) => !(Number(l.quantity) > 0));
  const anyRetired = filled.some((l) => retiredIds.has(l.itemId));
  const canSubmit = filled.length > 0 && !anyDuplicate && !badQuantity && !anyRetired && !busy;

  const submit = async () => {
    setTouched(true);
    setErr("");
    if (filled.length === 0) return setErr("Add at least one item to your order.");
    if (anyDuplicate) return setErr("The same item is on two lines. Combine them into one.");
    if (badQuantity) return setErr("Every item needs a quantity greater than zero.");
    if (anyRetired) return setErr("One of these items is no longer on your list. Remove that line, or call us and we will put it back.");
    setBusy(true);
    try {
      await onSubmit(filled, remarks);
    } catch (e) {
      // The server's refusals are already written for the customer to read — the
      // item-not-on-your-list message included. Passing them straight through is
      // deliberate; re-wording them here would be a second vocabulary to keep true.
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  /*
    WHO THEY ARE BUYING FROM, ABOVE THE ITEMS AND NOT BESIDE THEM.

    It is not one field among several — it decides what the list underneath can
    contain, so it has to be answered first and has to look like it was. Placed
    beside the lines it reads as an afterthought, and a customer who changes it
    after typing six lines loses them.

    ⚠ ONE PICKER, OR NONE AT ALL. Most customers buy from exactly one of our
      companies, and a required dropdown with a single option is a question with
      one answer — so it prints as a sentence instead. The picker appears only
      where there is a real choice to make.
  */
  const companyPicker = (() => {
    if (companyLabel) {
      return (
        <p className="text-[13.5px] text-grey">
          Ordering from <span className="font-semibold text-ink">{companyLabel}</span>
        </p>
      );
    }
    if (!companies || companies.length === 0) return null;
    if (companies.length === 1) {
      return (
        <p className="text-[13.5px] text-grey">
          Ordering from <span className="font-semibold text-ink">{companies[0].label}</span>
        </p>
      );
    }
    return (
      <div className="space-y-2">
        <label className="block text-[13px] font-semibold text-ink">Who are you buying from?</label>
        <div className="max-w-md">
          <Combobox
            value={companyId ?? ""}
            onChange={(v) => onCompanyChange?.(v)}
            options={companies.map((c) => ({
              value: c.companyId,
              label: c.label,
              sublabel: `${c.itemCount} ${c.itemCount === 1 ? "item" : "items"}`,
            }))}
            placeholder="Choose one of ours"
          />
        </div>
        {/* Says the quiet part out loud, so "where is my usual ink?" has an
            answer on the screen rather than on the phone. */}
        <p className="text-[12.5px] text-grey-2">
          One order goes to one of our companies, and each sells a different list.
          If something you buy is not below, it may be sold by another of ours.
        </p>
      </div>
    );
  })();

  return (
    <div className="space-y-5">
      {companyPicker && (
        <div className="rounded-2xl border border-line bg-white px-5 py-4">{companyPicker}</div>
      )}
      <div className="rounded-2xl border border-line bg-white overflow-hidden">
        <div className="hidden sm:grid grid-cols-[1fr_130px_90px_1fr_40px] gap-3 px-5 py-3 border-b border-line bg-[#FBFCFE] text-[12px] font-semibold text-grey uppercase tracking-wide">
          <span>Item</span>
          <span>Quantity</span>
          <span>Unit</span>
          <span>Anything to note</span>
          <span />
        </div>

        <div className="divide-y divide-line">
          {lines.map((line, idx) => {
            const item = line.itemId ? itemById.get(line.itemId) : undefined;
            const dupAt = duplicateOf(idx);
            const qtyBad = touched && !!line.itemId && !(Number(line.quantity) > 0);
            return (
              <div key={idx} className="px-5 py-4" ref={(el) => { rowRefs.current[idx] = el; }}>
                {/*
                  ⚠ MOBILE ONLY, AND ONLY ONCE THERE IS MORE THAN ONE LINE. On a phone
                    the row stops being a row: every field stacks, so two items read as
                    one long column of identical labels with a hairline somewhere in the
                    middle. Numbering them is what says where one ends.

                  ⚠ AND THE REMOVE CONTROL GETS WORDS HERE. The desktop × sits at the end
                    of its row, where the row is the thing it plainly belongs to. Stacked,
                    it lands under "Anything to note" and reads as if it clears the note.
                */}
                {lines.length > 1 && (
                  <div className="sm:hidden flex items-center justify-between mb-2">
                    <span className="text-[12px] font-semibold text-grey-2">Item {idx + 1}</span>
                    <button
                      type="button"
                      onClick={() => setLines((ls) => ls.filter((_, i) => i !== idx))}
                      className="text-[12.5px] font-semibold text-[#B3282C]"
                    >
                      Remove
                    </button>
                  </div>
                )}
                <div className="grid sm:grid-cols-[1fr_130px_90px_1fr_40px] gap-3 items-start">
                  <div data-item>
                    {lines.length === 1 && (
                      <span className="sm:hidden block text-[12px] font-semibold text-grey mb-1">Item</span>
                    )}
                    <Combobox
                      value={line.itemId}
                      onChange={(v) => { setLine(idx, { itemId: v }); focusQty(idx); }}
                      options={options}
                      placeholder="Search your items…"
                    />
                  </div>
                  <div>
                    <span className="sm:hidden block text-[12px] font-semibold text-grey mb-1">Quantity</span>
                    <TextInput
                      ref={(el) => { qtyRefs.current[idx] = el; }}
                      value={line.quantity}
                      inputMode="decimal"
                      onChange={(e) => setLine(idx, { quantity: e.target.value.replace(/[^\d.]/g, "") })}
                      onKeyDown={onLineEnter(idx)}
                      placeholder="0"
                      className={qtyBad ? "border-[#e5484d]" : undefined}
                    />
                  </div>
                  <div className="text-[14px] text-grey sm:pt-3">
                    <span className="sm:hidden text-[12px] font-semibold mr-2">Unit</span>
                    {item?.unit ?? "—"}
                  </div>
                  <div>
                    <span className="sm:hidden block text-[12px] font-semibold text-grey mb-1">Anything to note</span>
                    <TextInput
                      value={line.lineRemark}
                      onChange={(e) => setLine(idx, { lineRemark: e.target.value })}
                      onKeyDown={onLineEnter(idx)}
                      placeholder="Optional"
                    />
                  </div>
                  {/* Hidden on mobile: the labelled Remove in the line header does this. */}
                  <div className="hidden sm:flex sm:pt-2 sm:justify-end">
                    {lines.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => setLines((ls) => ls.filter((_, i) => i !== idx))}
                        aria-label={`Remove line ${idx + 1}`}
                        className="text-grey-2 hover:text-[#B3282C] transition p-1.5 rounded-lg hover:bg-[#FDECEC]"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                          <path d="M18 6 6 18M6 6l12 12" />
                        </svg>
                      </button>
                    ) : null}
                  </div>
                </div>

                {dupAt !== null ? (
                  <p className="text-[12.5px] text-[#B3282C] mt-2">
                    This item is already on line {dupAt}. Change the quantity there instead.
                  </p>
                ) : line.itemId && retiredIds.has(line.itemId) ? (
                  <p className="text-[12.5px] text-[#B3282C] mt-2">
                    This is no longer on your list. Remove this line, or call us and we will put it back.
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="px-5 py-3 border-t border-line bg-[#FBFCFE]">
          <button
            type="button"
            onClick={() => { setLines((ls) => [...ls, blankLine()]); focusItem(lines.length); }}
            className="text-[13.5px] font-semibold text-orange hover:text-orange-2 transition"
          >
            + Add another item
          </button>
        </div>
      </div>

      <div>
        <label className="block text-[13px] font-semibold mb-1.5">Anything we should know?</label>
        <TextArea
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          rows={3}
          placeholder="Optional — delivery timing, a reference of yours, anything else."
        />
      </div>

      {err ? (
        <div className="rounded-xl border border-[#f6d2d3] bg-[#FDECEC] px-4 py-3 text-[13.5px] text-[#B3282C]">
          {err}
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <Button onClick={submit} disabled={!canSubmit}>
          {busy ? busyLabel : submitLabel}
        </Button>
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel ?? "Cancel"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
