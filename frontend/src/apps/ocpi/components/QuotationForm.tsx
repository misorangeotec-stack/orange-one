import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Card from "@/shared/components/ui/Card";
import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput, TextArea } from "@/shared/components/ui/Form";
import ChoiceButtons from "@/shared/components/ui/ChoiceButtons";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useOcpiStore } from "../store";
import { OCPI_MASTERS_QK, fetchOcpiMasters } from "../data/ocpiMasters";
import CustomerPicker from "./CustomerPicker";
import GstinField from "./GstinField";
import RequestMasterModal from "./RequestMasterModal";
import { isVisible } from "../lib/branching";
import { useSalespeople } from "../lib/useSalespeople";
import { fmtDealValue } from "../lib/format";
import {
  COST_BEARERS, CURRENCIES, DELIVERY_DATE_REMARK, DOLLAR_CLAUSE, HEAD_SHIP_MODES,
  HEAD_SHIP_VIA, HIGH_SEAS_VIA, INSURANCE_CLAUSE, PAYMENT_TERMS_FORMATS,
  PLATTER_OPTIONS, SUBSIDIZED_RATE_NOTE, TRADE_TERMS, TRANSPORT_TERMS, dealFacts,
  type QuotationDraft,
} from "../lib/fieldSpec";
import { FIELD_ANCHOR, QUOTATION_FORM_ANCHOR, requiredKeys } from "../lib/completeness";
import type { OcpiMasterType } from "../types";

/** The heading a name that matches no portal user sits under. */
const OFF_ROSTER = "Not a portal user";

/**
 * Part A — everything the printed quotation needs.
 *
 * The grouping mirrors the printed sheet (Machine Details / Deal Inclusions /
 * Commercial Terms / Remarks), not the Microsoft form's question order, so
 * someone checking a generated PDF against the paper finds the fields where they
 * expect them.
 *
 * ⚠ CONDITIONAL FIELDS ARE HIDDEN, NEVER DISABLED. `isVisible` (lib/branching)
 *   answers what applies; a greyed-out box still reads as a question you failed
 *   to answer. The server clears whatever a branch hides on every write, so the
 *   row can never keep an answer the form stopped showing.
 */

/** A yes/no, as the source form asks them. Null until answered — not false. */
/**
 * The Yes/No pair on its own, with no label around it.
 *
 * ⚠ SPLIT OUT OF `YesNo`, NOT COPIED FROM IT (OCPI-11). The shipment table
 *   needs this control inside a `<td>` that already has a column header, so it
 *   cannot use the `FieldLabel` wrapper — but two hand-written copies would be
 *   two places for the selected-state colours to drift apart. `YesNo` below is
 *   now this plus a label.
 *
 * ⚠ THE PAIR NEEDS 152px (72 + 8 + 72) AND WILL WRAP BELOW IT. That is why the
 *   shipment table sets `table-fixed` and a 164px column: under auto layout the
 *   browser reads this control's minimum as ONE button and collapses the
 *   column, stacking the pair and doubling every row's height.
 */
function YesNoControl({
  value,
  onChange,
  disabled,
  ariaLabel,
}: {
  value: boolean | null;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <div className="flex gap-2" role="group" aria-label={ariaLabel}>
      {[
        { v: true, t: "Yes" },
        { v: false, t: "No" },
      ].map((o) => (
        <button
          key={o.t}
          type="button"
          disabled={disabled}
          onClick={() => onChange(o.v)}
          className={[
            "h-9 min-w-[72px] rounded-lg border px-3 text-[13px] font-medium transition",
            value === o.v
              ? "border-orange bg-orange text-white"
              : "border-line bg-white text-navy hover:border-orange/50",
            disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
          ].join(" ")}
        >
          {o.t}
        </button>
      ))}
    </div>
  );
}

function YesNo({
  label,
  hint,
  value,
  onChange,
  disabled,
  required,
  anchor,
}: {
  label: string;
  hint?: string;
  value: boolean | null;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  /** OCPI-15 · both go straight through to `FieldLabel`; see its note. */
  required?: boolean;
  anchor?: string;
}) {
  return (
    <FieldLabel label={label} hint={hint} required={required} anchor={anchor}>
      <YesNoControl value={value} onChange={onChange} disabled={disabled} ariaLabel={label} />
    </FieldLabel>
  );
}

const opts = (xs: readonly string[]) => xs.map((x) => ({ value: x, label: x }));

/**
 * A master list as combobox options, plus whatever this deal already holds.
 *
 * ⚠ THE CURRENT VALUE IS ALWAYS AN OPTION, even when it is not on the list. A
 *   deal quoted last year against a head type since switched off would
 *   otherwise open with the field looking empty, and saving would silently
 *   clear it. Deactivating a master must never rewrite a deal.
 */
const masterOpts = (rows: { name: string; active: boolean }[], current: string) => {
  const live = rows.filter((r) => r.active).map((r) => r.name);
  const all = current && !live.includes(current) ? [...live, current] : live;
  return all.map((x) => ({ value: x, label: x }));
};

/**
 * A FIXED vocabulary, plus whatever this deal already holds — the retired-option
 * counterpart to `masterOpts` above, for lists declared in code rather than in a
 * master.
 *
 * ⚠ IT EXISTS BECAUSE `ChoiceButtons` SHOWS AN UNKNOWN VALUE AS NOTHING AT ALL.
 *   The component is fully controlled and never clears what it cannot match, so
 *   the stored answer survives a save — but no button lights up, `aria-checked`
 *   is false on every one of them, and the field reads as unanswered. Worse, with
 *   nothing selected its arrow-key handler starts from index -1, so a single ↓ on
 *   a tabbed-to strip fires `onChange(options[0])` and replaces a recorded answer
 *   with no click and nothing to see.
 *
 *   Feeding the current value back in as an option fixes all three at once: the
 *   answer renders as a lit button, and the index is real, so the arrow keys move
 *   between options the way they do everywhere else.
 *
 * ⚠ THIS IS NOT A LICENCE TO SIZE A STRIP BY DATA. It adds at most ONE button,
 *   and only on a deal quoted against an option since withdrawn — it is a
 *   retired-value guard, not a way to drive a strip from a growing list.
 *   `ChoiceButtons`' own header states the boundary: a short vocabulary, whether
 *   declared in code or held in a master an admin edits, and never a list that
 *   can run to dozens, because a strip cannot be searched.
 *
 * Clearing is a one-way door: the retired button disappears once the value goes,
 * which is intended — a withdrawn option should not be re-selectable.
 */
const optsWithCurrent = (xs: readonly string[], current: string) =>
  opts(current && !xs.includes(current) ? [...xs, current] : xs);
const optsKV = (xs: readonly { value: string; label: string }[]) =>
  xs.map((x) => ({ value: x.value, label: x.label }));

/**
 * A warranty as it will print — SHOWN, NEVER TYPED (Ritesh Bhai, 01-Sep-2026).
 *
 * 🔴 THESE WERE EDITABLE BOXES FOR ONE AFTERNOON AND SHOULD NOT HAVE BEEN. The
 *    warranty is a property of the MODEL, mapped once on the Machines master
 *    from the client's own sheet. An editable box invites a salesperson to
 *    promise 24 months on a machine the company warrants for 12 — on a document
 *    the customer signs — and nothing downstream would question it.
 *
 * ⚠ THE VALUE STILL TRAVELS. It is set on the draft by `chooseMachine`, sent in
 *   the payload, written by `fms_ocpi_write_oc` and frozen onto the revision, so
 *   a deal remains a record of what was quoted rather than of what the master
 *   says today. Only the keyboard is taken away.
 *
 * ⚠ AND IT IS DELIBERATELY NOT A `disabled` TextInput. A greyed-out input reads
 *   as a field that is temporarily unavailable — somebody will ask why they
 *   cannot type in it. A read-out reads as an answer, which is what this is. The
 *   Print heads field above states the same thing the same way.
 *
 * The exception route is Special remarks, exactly as it was when the warranty
 * was a fixed setting.
 */
function WarrantyReadout({ value, hasMachine }: { value: string; hasMachine: boolean }) {
  return (
    <div className="flex min-h-9 items-center rounded-lg border border-line bg-page px-3 py-2 text-[13px] text-navy">
      {value.trim() ? (
        value
      ) : (
        <span className="text-grey-2">{hasMachine ? "Not applicable" : "Choose a machine first"}</span>
      )}
    </div>
  );
}


/**
 * Blank, or anything that is not a number, is "not answered yet" — NOT zero.
 *
 * ⚠ MODULE SCOPE, ONE COPY, TWO CALLERS. Both the shipment table and
 *   `RateOffer` show a live product of two typed factors, and both must agree
 *   with the SQL that derives the stored figure. A second private copy of this
 *   arithmetic is how one of them starts rounding differently.
 */
const asNumber = (v: string): number | null => {
  const n = Number(v);
  return v.trim() === "" || Number.isNaN(n) ? null : n;
};

/** Quantity × amount, or null while either factor is still blank. */
const lineSubtotal = (qty: string, amount: string): number | null => {
  const q = asNumber(qty);
  const a = asNumber(amount);
  return q === null || a === null ? null : Math.round(q * a * 100) / 100;
};

/**
 * A cell whose question does not apply to this row yet, and why.
 *
 * ⚠ A DASH AND A REASON, NOT AN EMPTY CELL. In the stacked boxes these controls
 *   simply vanished and the box closed up around them. In a grid a blank cell
 *   is indistinguishable from one somebody forgot to fill in — and this section
 *   exists to record what was agreed, so "not asked" and "not answered" must
 *   not look alike. The reason is on hover rather than always on, because seven
 *   columns of explanatory text would bury the answers themselves.
 */
function NotAsked({ reason }: { reason: string }) {
  return (
    <span className="cursor-help text-[13px] text-grey-2" title={reason} aria-label={reason}>
      —
    </span>
  );
}

/**
 * One item's shipping and invoicing answers — one row of the table.
 *
 * ⚠ ONE COMPONENT, FIVE CALLERS, so the head, the ink, the dryer, the spare
 *   parts and the centering device cannot drift apart. They ask the same five
 *   questions by instruction; five hand-written copies would be five places to
 *   forget the "excluding tax" wording, or to add a sixth question to only four
 *   of them.
 *
 * ⚠ EVERY BINDING IS PASSED IN EXPLICITLY rather than derived from a key prefix.
 *   A `draft[`${prefix}ShipMode`]` lookup would compile — and would silently
 *   read `undefined` the day somebody renames a field, because TypeScript cannot
 *   check a template-built key. Twenty typed props are worth that.
 *
 * ⚠ VISIBILITY IS DECIDED BY THE CALLER, not here. `branching.ts` owns every
 *   condition in this module and has the SQL's twin beside it; a second opinion
 *   living in a presentational component is how the two engines drift.
 *
 * ⚠ THE TWO PICKERS MUST STAY COMBOBOXES, not `ChoiceButtons` (OCPI-11). They
 *   already were, and in a table it stops being a matter of taste: button
 *   strips for a two-option and a three-option vocabulary measure about 520px
 *   between them and would push the table past 1100px, so the Amount column
 *   falls off a laptop screen and has to be scrolled to. A table you scroll
 *   sideways to fill in is worse than the stacked boxes it replaced. Both
 *   vocabularies are 6 options or fewer, so no search box appears and each
 *   reads as a plain dropdown. `Combobox` carries the same arrow-key
 *   `stopPropagation` guard `ChoiceButtons` does, so neither steals ↓ from the
 *   scroll container.
 */
function ShipmentRow({
  title,
  shown,
  disabled,
  mode,
  onMode,
  via,
  onVia,
  showVia,
  inv,
  onInv,
  showInvoiceLines,
  qty,
  onQty,
  amount,
  onAmount,
}: {
  title: string;
  shown: boolean;
  disabled?: boolean;
  mode: string;
  onMode: (v: string) => void;
  via: string;
  onVia: (v: string) => void;
  showVia: boolean;
  inv: boolean | null;
  onInv: (v: boolean) => void;
  showInvoiceLines: boolean;
  qty: string;
  onQty: (v: string) => void;
  amount: string;
  onAmount: (v: string) => void;
}) {
  if (!shown) return null;

  // A PREVIEW of what fms_ocpi_write_oc will store, recomputed as either factor
  // changes. Empty rather than "₹ 0" while either is blank: a zero is a claim,
  // a blank is not.
  const subtotal = lineSubtotal(qty, amount);

  return (
    <tr className="border-t border-line align-middle">
      {/*
        ⚠ THE "asked because …" LINE IS GONE (Ritesh Bhai, 01-Sep-2026), and the
          `why` prop with it. It explained each row's branch in words — useful
          while the rows appeared and vanished on five different conditions, and
          noise now that they follow one rule the salesperson chose themselves at
          the top of the form. Three lines of grey text under every item was
          burying the item names.

          Removed rather than hidden: a prop nobody renders is the orphan this
          repo keeps writing down as a fault. `categoryName`, which existed only
          to word two of these sentences, went with it.
      */}
      <th scope="row" className="py-2.5 pr-3 text-left font-normal">
        <span className="block text-[13px] font-semibold text-ink">{title}</span>
      </th>

      {/*
        No explicit aria-label on either picker: the column header and the row's
        own <th> already name the cell for a screen reader, and a third name
        would be read out on top of them.
      */}
      <td className="px-1.5 py-2.5">
        <Combobox
          value={mode}
          onChange={onMode}
          options={optsKV(HEAD_SHIP_MODES)}
          placeholder="Choose"
          clearable
          disabled={disabled}
          triggerClassName="w-full"
        />
      </td>

      {/* Nothing to route when it travels with the machine. */}
      <td className="px-1.5 py-2.5">
        {showVia ? (
          <Combobox
            value={via}
            onChange={onVia}
            options={optsKV(HEAD_SHIP_VIA)}
            placeholder="Choose"
            clearable
            disabled={disabled}
            triggerClassName="w-full"
          />
        ) : (
          <NotAsked reason="Asked only of a separate shipment — there is nothing to route when it travels with the machine." />
        )}
      </td>

      <td className="px-1.5 py-2.5">
        <YesNoControl
          value={inv}
          onChange={onInv}
          disabled={disabled}
          ariaLabel={`${title} — separate invoice`}
        />
      </td>

      {/*
        ⚠ QUANTITY AND AMOUNT ONLY ON A SEPARATE INVOICE. That is the only
          document they would appear on; asking otherwise invites the same
          figure being quoted twice, once inside the deal value and once
          beside it. fms_ocpi_write_oc nulls them on the same condition.
      */}
      <td className="px-1.5 py-2.5">
        {showInvoiceLines ? (
          <TextInput
            inputMode="numeric"
            value={qty}
            onChange={(e) => onQty(e.target.value.replace(/\D/g, ""))}
            disabled={disabled}
            aria-label={`${title} — invoice quantity`}
          />
        ) : (
          <NotAsked reason="Asked only when this item is billed on its own invoice." />
        )}
      </td>

      <td className="px-1.5 py-2.5">
        {showInvoiceLines ? (
          <TextInput
            inputMode="decimal"
            value={amount}
            onChange={(e) => onAmount(e.target.value.replace(/[^\d.]/g, ""))}
            disabled={disabled}
            aria-label={`${title} — invoice amount, excluding tax`}
          />
        ) : (
          <NotAsked reason="Asked only when this item is billed on its own invoice." />
        )}
      </td>

      {/*
        ⚠ READ-ONLY AND DERIVED, NEVER TYPED. A typed sub-total that disagrees
          with its own two factors is a contradiction printed on a contract.
          The figure that prints is the one fms_ocpi_write_oc stores; this is
          the same arithmetic shown early so the salesperson sees the number
          before they commit to it. It is NOT added to the deal value, the GST
          or the printed total — a separately-invoiced item is billed on its
          own document, and counting it here would charge it twice.
      */}
      <td className="px-1.5 py-2.5 text-right">
        {showInvoiceLines ? (
          <span className="text-[13px] font-semibold tabular-nums text-ink">
            {subtotal === null ? (
              <span className="font-normal text-grey-2">—</span>
            ) : (
              fmtDealValue(subtotal, "INR")
            )}
          </span>
        ) : (
          <NotAsked reason="Asked only when this item is billed on its own invoice." />
        )}
      </td>
    </tr>
  );
}

/**
 * One item that is NOT in the deal, and what it is offered at instead.
 *
 * Section B used to end at "No". It should not: "not included in the machine
 * price" is not "not being sold" — the customer still buys ink and still buys
 * heads, and the rate is agreed at the same table as the machine. Before this,
 * that agreement lived nowhere and was re-negotiated later from memory.
 *
 * ⚠ ONE COMPONENT, TWO CALLERS — ink and the head. They ask the same three
 *   questions by instruction, and two hand-written copies would be two places
 *   to forget the unit, or to change the wording of a question that prints on a
 *   customer's quotation in only one of them. `ShipmentRow` above is the
 *   precedent and the prop contract is copied from it.
 *
 * ⚠ EVERY BINDING IS PASSED IN EXPLICITLY, for the reason `ShipmentRow` gives:
 *   a `draft[`${prefix}OfferQty`]` lookup compiles and silently reads
 *   `undefined` the day somebody renames a field.
 *
 * ⚠ VISIBILITY IS DECIDED BY THE CALLER. `branching.ts` owns every condition in
 *   this module and has the SQL's twin beside it.
 *
 * ⚠ THE SUB-TOTAL IS A PREVIEW, NOT THE FIGURE THAT PRINTS. It is derived and
 *   stored by `fms_ocpi_write_quotation` (`round(qty * rate, 2)`), and the
 *   quotation prints that column — the same rule that had `withGst` deleted in
 *   stage E, so that one price can never have two different answers. What is
 *   shown here recomputes live as either factor changes, and shows EMPTY rather
 *   than a zero while either is blank: "₹ 0" is a claim, a blank is not.
 *
 * ⚠ ALWAYS RUPEES, NEVER THE DEAL'S CURRENCY (client, 31-Aug-2026). A machine
 *   may be sold in dollars; ink and heads are bought here and are rated in
 *   rupees regardless. So a High Seas deal shows a dollar machine price and a
 *   rupee ink rate on one page — deliberately, and each states its own symbol.
 *   There is no conversion anywhere in this block: `fxRate` is not consulted,
 *   so nothing here can drift when a rate moves.
 *
 * ⚠ THE MONEY IS NOT THE DEAL'S MONEY. This sub-total is never added to
 *   `dealValueAmount`, the GST derivation, the frozen FX conversion or the
 *   printed total. It is only ever asked when the item is NOT in the deal.
 */
function RateOffer({
  title,
  why,
  shown,
  disabled,
  agreed,
  onAgreed,
  showLines,
  qtyLabel,
  qtyHint,
  qtyMode,
  qty,
  onQty,
  qtyKey,
  rateLabel,
  rateHint,
  rate,
  onRate,
  rateKey,
  req,
}: {
  title: string;
  /** Why this block is being asked at all — the branch, in words. */
  why: string;
  shown: boolean;
  disabled?: boolean;
  agreed: boolean | null;
  onAgreed: (v: boolean) => void;
  showLines: boolean;
  qtyLabel: string;
  qtyHint: string;
  /** Litres take decimals; heads are counted. */
  qtyMode: "integer" | "decimal";
  qty: string;
  onQty: (v: string) => void;
  rateLabel: string;
  rateHint: string;
  rate: string;
  onRate: (v: string) => void;
  /*
    OCPI-15 · the two lines are mandatory once the offer is agreed, and the
    missing-answers panel has to be able to jump to them. The KEYS come in
    rather than a pair of booleans so the anchor and the asterisk are derived
    from the same thing the panel is derived from — `req` is `requiredKeys`,
    already computed once by the form.
  */
  qtyKey: "inkOfferQty" | "headOfferQty";
  rateKey: "inkOfferRate" | "headOfferRate";
  req: Set<keyof QuotationDraft>;
}) {
  if (!shown) return null;

  // Shares `lineSubtotal` with the shipment table above rather than keeping a
  // private copy — see the note on `asNumber`. Blank stays blank, never zero.
  const subtotal = lineSubtotal(qty, rate);

  return (
    <div className="space-y-3 rounded-lg border border-line p-3.5">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
        <span className="text-[11.5px] text-grey-2">asked because {why}</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <YesNo
          label="Offered at a subsidized rate?"
          value={agreed}
          onChange={onAgreed}
          disabled={disabled}
        />
        {showLines && (
          <>
            <FieldLabel
              label={qtyLabel}
              hint={qtyHint}
              required={req.has(qtyKey)}
              anchor={FIELD_ANCHOR(qtyKey)}
            >
              <TextInput
                inputMode={qtyMode === "integer" ? "numeric" : "decimal"}
                value={qty}
                onChange={(e) =>
                  onQty(e.target.value.replace(qtyMode === "integer" ? /\D/g : /[^\d.]/g, ""))
                }
                disabled={disabled}
              />
            </FieldLabel>
            <FieldLabel
              label={rateLabel}
              hint={rateHint}
              required={req.has(rateKey)}
              anchor={FIELD_ANCHOR(rateKey)}
            >
              <TextInput
                inputMode="decimal"
                value={rate}
                onChange={(e) => onRate(e.target.value.replace(/[^\d.]/g, ""))}
                disabled={disabled}
              />
            </FieldLabel>
            {/*
              Read-only and derived — never typed. A typed sub-total that
              disagrees with its own two factors is a contradiction printed on a
              contract. `disabled` rather than a bare `readOnly` so it is
              visibly a result and not a box somebody forgot to fill.
            */}
            <FieldLabel label="Sub-total" hint="quantity × rate">
              <TextInput
                value={fmtDealValue(subtotal, "INR")}
                readOnly
                disabled
                className="font-semibold"
                aria-label={`${title} sub-total`}
              />
            </FieldLabel>
          </>
        )}
      </div>

      {/*
        The note is shown WHERE THE RATE IS TYPED, not only on the paper, so the
        salesperson agreeing the figure can see what they are committing to
        before they write it down. Same words print on the quotation.
      */}
      {showLines && (
        <p className="text-[11.5px] leading-snug text-grey-2">{SUBSIDIZED_RATE_NOTE}</p>
      )}
    </div>
  );
}

export default function QuotationForm({
  draft,
  patch,
  disabled,
}: {
  draft: QuotationDraft;
  patch: (p: Partial<QuotationDraft>) => void;
  disabled?: boolean;
}) {
  const s = useOcpiStore();
  const { people: salespeople, isLoading: rosterLoading } = useSalespeople();

  /**
   * The chosen machine. It supplies the head options, the model number and the
   * warranty defaults — it no longer decides what is ASKED.
   *
   * ⚠ THE MACHINE STOPPED DRIVING THE BRANCHES (OCPI-14). Between stage E and
   *   now, `machineFacts(chosenMachine)` was the second argument to every
   *   `isVisible` call and the dryer section, the centering questions and the
   *   four extras all read it. The CATEGORY decides now, so that record was
   *   deleted rather than left as an argument that changed nothing.
   */
  const chosenMachine = s.machineById(draft.machineId || null);

  /**
   * Everything a branch needs that is not on the draft.
   *
   * Four facts: the three category flags — does this deal carry a dryer, a
   * centering device, the three optional extras — and whether the DRYER category
   * the salesperson picked is one that means there is no dryer. Resolved once,
   * here, so no branch rule has to reach for a store.
   *
   * ⚠ IT READS `draft.machineCategoryId`, NOT THE MACHINE'S. That is what makes
   *   the questions appear the moment a category is picked, before any machine
   *   has been chosen — which is the whole of what OCPI-14 was asked for.
   */
  const dealAnswers = useMemo(
    () => dealFacts(s.dryerTypes, draft.dryerType, s.machineCategories, draft.machineCategoryId),
    [s.dryerTypes, s.machineCategories, draft.dryerType, draft.machineCategoryId],
  );

  /*
    ⚠ THE CATEGORY IS THE DEAL'S OWN ANSWER NOW (OCPI-14), not local state.

      It used to be `useState<string>("")` — a filter that narrowed the machine
      dropdown and was deliberately never stored, on the reasoning that the
      machine already knows its category and a second copy could disagree. That
      reasoning was right for a filter and wrong for a branch input: both write
      RPCs null every column their branches hide, on every save, and they can
      only see the row. A question shown on something the server cannot read is a
      question the server erases the answer to.

      So it lives on the draft, `fms_ocpi_write_quotation` stores it, and the two
      can never disagree because `chooseMachine` snaps it to the machine's own
      category on every pick and the RPC coalesces onto the same value.

    ⚠ THERE IS NO SEEDING EFFECT ANY MORE, and its removal is not an oversight.
      An opened deal arrives with `machine_category_id` already on the row — the
      migration back-filled all 20 — so `draftFromDeal` carries it and there is
      nothing to infer. The old effect existed only because the filter started
      empty on every render of an existing deal.
  */
  /**
   * Carry a subsidized rate across into the Shipment & invoice row (OCPI-14).
   *
   * 🔴 IT EXISTS BECAUSE THE ROWS DETACHED FROM THE INCLUSIONS. OCPI-11 relied
   *    on ink's two quantity/amount pairs never being on screen together: the
   *    subsidized pair fires on `inclInk === false`, the shipment pair used to
   *    fire on `=== true`, and the module's own note called that "structurally
   *    closed". Detaching the shipment rows opened it — a deal can now hold both
   *    — and Ritesh Bhai's answer was not to close it again but to make the one
   *    fill the other: what was agreed as a subsidized rate IS what will be
   *    invoiced.
   *
   * ⚠ IT FILLS ONLY AN EMPTY CELL, and that is the whole safety of it. A
   *   salesperson who has typed an invoice figure has said something the offer
   *   block does not know; overwriting it would be this form deciding it knew
   *   better. Because the test is "is the cell empty", it also survives a reload
   *   with no extra state to remember what was auto-filled and what was typed.
   *
   * ⚠ INK AND HEAD ONLY. Spare parts has no rate block — OCPI-7 was narrowed to
   *   two items mid-build — so there is nothing to carry over for it.
   */
  const carry = (
    value: string,
    offerKey: "inkOfferQty" | "inkOfferRate" | "headOfferQty" | "headOfferRate",
    shipmentKey: "inkInvoiceQty" | "inkInvoiceAmount" | "headInvoiceQty" | "headInvoiceAmount",
  ) =>
    patch({
      [offerKey]: value,
      ...(draft[shipmentKey].trim() === "" ? { [shipmentKey]: value } : {}),
    } as Partial<QuotationDraft>);

  const categoryOptions = useMemo(
    () =>
      s.machineCategories
        .filter((c) => c.active)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
        .map((c) => ({ value: c.id, label: c.name })),
    [s.machineCategories],
  );

  // Only machines an admin has switched on, narrowed to the chosen category. A
  // machine with no template is still quotable and still goes all the way
  // through — it issues the summary sheet alone, and the editor names it before
  // anything is sent.
  //
  // ⚠ THE CURRENT MACHINE IS ALWAYS AN OPTION. Same reasoning as `masterOpts`:
  //   a deal quoted against a model since switched off, or since moved to
  //   another category, must not open with the picker looking empty — saving
  //   would then silently clear it.
  const machineOptions = useMemo(
    () =>
      s.machines
        .filter((m) => m.active || m.id === draft.machineId)
        .filter(
          (m) =>
            !draft.machineCategoryId ||
            m.categoryId === draft.machineCategoryId ||
            m.id === draft.machineId,
        )
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
        .map((m) => ({
          value: m.id,
          label: m.name,
          sublabel:
            [
              m.billingName,
              m.hasTemplate ? null : "summary sheet only — no detailed template yet",
            ]
              .filter(Boolean)
              .join(" · ") || undefined,
        })),
    [s.machines, draft.machineCategoryId, draft.machineId],
  );

  /** Every print head the chosen machine carries — a model may have several. */
  const mappedHeads = useMemo(
    () => s.headsFor(draft.machineId || null),
    [s, draft.machineId],
  );

  /**
   * Where the machine maps exactly ONE head: does the deal actually hold it?
   *
   * A single mapped head is shown, not chosen, so there is no strip to light and
   * no keystroke to guard — but the same unmatched-value problem still exists, and
   * quieter, because the read-only box simply printed the machine's head over the
   * deal's. An unanswered deal counts as agreeing: there is nothing to contradict.
   */
  const soleHeadAgrees =
    mappedHeads.length !== 1 || !draft.headType || draft.headType === mappedHeads[0].name;

  /**
   * Which questions this deal is obliged to answer (OCPI-15).
   *
   * 🔴 IT IS THE SAME TABLE THE BLOCKERS READ. `requiredKeys`, `missingForGenerate`
   *    and `missingForSubmit` all come out of one `REQUIREMENTS` list in
   *    completeness.ts, so an asterisk on this form and a refusal at the top of
   *    the page cannot disagree — which they would within a month if the
   *    asterisks were typed in by hand, as six of them were until now.
   *
   * ⚠ THE ASTERISK MEANS MANDATORY, NOT "BLOCKS GENERATE". Most of these are
   *   only demanded at Send for approval; the cards above the form say which is
   *   which. Marking only the Generate tier would leave twenty mandatory
   *   questions unmarked, which is the hunt this was raised to end.
   */
  const req = useMemo(
    () => requiredKeys(draft, dealAnswers, mappedHeads.length),
    [draft, dealAnswers, mappedHeads.length],
  );

  /**
   * Choose a machine, and carry across everything that is the MACHINE's answer.
   *
   * ⚠ ONLY ON AN EXPLICIT CHANGE. Doing this in an effect would rewrite the head
   *   text of a deal quoted before the mapping existed the moment somebody
   *   merely opened it — silently restating what a customer was quoted. See the
   *   Print heads field for the rest of the reasoning.
   *
   * ⚠ THE MODEL NUMBER IS NOT TOUCHED. It is pre-filled from the template
   *   elsewhere and a salesperson may have corrected it by hand.
   */
  const chooseMachine = (id: string) => {
    const m = s.machineById(id || null);
    const heads = s.headsFor(id || null);
    /*
      ⚠ THE CATEGORY SNAPS TO THE MACHINE (OCPI-14), and this is what makes the
        form and the server incapable of disagreeing: `fms_ocpi_write_quotation`
        coalesces onto the machine's own category, so if this line did not exist
        the browser would branch on the old category while the row branched on
        the new one — and the server would clear whatever the two disagreed
        about. Clearing the category still lists every machine, which is how a
        salesperson browses across types before committing to one.
    */
    const cat = m?.categoryId ?? "";
    const catFlags = s.machineCategories.find((c) => c.id === cat);
    patch({
      machineId: id,
      machineCategoryId: cat,
      /*
        ⚠ ONE HEAD, NOT A JOIN, WHERE THE MODEL OFFERS A CHOICE (OCPI-14). This
          read `.join(" + ")` for every machine, which wrote "EX600 + RC" onto a
          deal whose sheet says "EX600 **or** RC" — an "or" recorded as an "and",
          on seven of the 28 models. A machine with one mapped head still fills
          itself in; a machine with two leaves this blank for the buttons below
          to answer, because the system cannot know which the customer chose.
      */
      headType: heads.length === 1 ? heads[0].name : "",
      /*
        The three warranty defaults, per model. NULL on the master means NOT
        APPLICABLE, so an empty string here is right: the question will not be
        shown and no line will print.
      */
      printerWarranty: m?.machineWarranty ?? "",
      headWarranty: m?.headWarranty ?? "",
      dryerWarranty: m?.dryerWarranty ?? "",
      // A category that carries no dryer cannot keep a dryer category, and one
      // that does starts from a clean sheet rather than the previous model's.
      ...(catFlags?.showsDryer === true ? {} : { dryerType: "", dryerName: "" }),
    });
  };

  /**
   * Which of our own companies is selling.
   *
   * ⚠ THIS WAS SET SILENTLY AND SHOWN NOWHERE. `CustomerPicker` copies the Tally
   *   party's company onto the draft, and that value alone decides which bank
   *   account, CIN, registered address and letterhead the contract prints. Two
   *   cases it cannot answer: a NEW LEAD has no Tally party at all, so the field
   *   stayed empty and the default entity printed with no warning (`isFallback`
   *   is false for a null company — correctly, since it cannot know it is
   *   wrong); and a customer who genuinely buys from a different arm than the
   *   one Tally files them under could not be corrected without editing Tally.
   *   So the value is now a visible, editable field that merely DEFAULTS to the
   *   customer's company.
   */
  const { data: masters } = useQuery({
    queryKey: OCPI_MASTERS_QK,
    queryFn: fetchOcpiMasters,
    staleTime: 30 * 60 * 1000,
  });

  /**
   * ⚠ ONLY COMPANIES THAT HAVE A SELLING-ENTITY PROFILE ARE OFFERED.
   *
   *   Tally carries five companies; four of them have no profile, and picking
   *   one used to be allowed with a warning — the document then printed the
   *   DEFAULT entity's bank account, CIN and registered address on a contract
   *   the customer pays against. A warning is the wrong instrument for that:
   *   it is read once and clicked past, and the consequence is money sent to
   *   the wrong company. So the choice is removed rather than annotated, and
   *   Settings → Selling entities is the single place that decides what may
   *   be quoted under. Add the profile there and the company appears here.
   *
   *   The one exception is a company ALREADY on this deal, kept so an existing
   *   draft does not silently lose its entity — it is offered, and labelled as
   *   not set up, so the reader can see what has to change.
   */
  const companyOptions = useMemo<ComboOption[]>(() => {
    const opts: ComboOption[] = [];
    for (const c of masters?.companies ?? []) {
      const own = s.companyProfiles.find((p) => p.companyId === c.id && p.active);
      if (!own) continue;
      opts.push({
        value: c.id,
        label: c.name,
        // Say what this choice will actually print, since that is the whole
        // consequence of the field and it is otherwise invisible until the PDF.
        sublabel:
          [own.legalName, own.bankName, own.exWorksCity && `Ex-Works ${own.exWorksCity}`]
            .filter(Boolean)
            .join(" · ") || undefined,
      });
    }
    if (draft.companyId && !opts.some((o) => o.value === draft.companyId)) {
      const c = masters?.companies.find((x) => x.id === draft.companyId);
      opts.unshift({
        value: draft.companyId,
        label: c?.name ?? "Company no longer listed",
        sublabel: "not set up as a selling entity — choose another, or add its details in Settings",
      });
    }
    return opts;
  }, [masters?.companies, s.companyProfiles, draft.companyId]);

  const defaultEntityName = useMemo(() => {
    const d = s.companyProfiles.find((p) => p.isDefault && p.active);
    return d?.legalName ?? null;
  }, [s.companyProfiles]);

  /**
   * Who may own this deal: the Sales roster, then anything already typed.
   *
   * ⚠ THE OPTION VALUE IS THE NAME, NOT THE USER ID, and that is not an
   *   oversight. Combobox renders its trigger as
   *   `options.find(o => o.value === value)?.label ?? placeholder`, so a value
   *   with no matching option makes a filled field look EMPTY. Keying on the id
   *   would do exactly that on every deal saved before this change (name set,
   *   id null) and again on every render before the roster query resolves.
   *   Keying on the name cannot: the "Not a portal user" group below carries
   *   every name the roster does not. Same hazard `masterOpts` exists for.
   *
   * ⚠ THE SECOND GROUP IS KEPT DELIBERATELY. It is the old distinct-over-deals
   *   list, and it is what lets an existing deal's value be re-selected rather
   *   than silently dropped — plus where a typed name lands for the next
   *   person. It empties itself as the free-typed names fall out of use.
   *
   * Both halves are deduplicated case-insensitively: Combobox keys its rows on
   * `o.value`, so two options sharing one would collide in React, and a name
   * appearing under both headings would read as two different people.
   */
  const salespersonOptions = useMemo(() => {
    const onRoster = new Set<string>();
    const roster: ComboOption[] = [];
    for (const p of salespeople) {
      const key = p.name.trim().toLowerCase();
      if (!key || onRoster.has(key)) continue;
      onRoster.add(key);
      roster.push({
        value: p.name,
        label: p.name,
        sublabel: p.designation ?? undefined,
        group: p.group,
      });
    }

    const typed = new Set<string>();
    for (const d of s.deals) if (d.salespersonName) typed.add(d.salespersonName);
    if (draft.salespersonName) typed.add(draft.salespersonName);
    const offRoster: ComboOption[] = [...typed]
      .filter((n) => !onRoster.has(n.trim().toLowerCase()))
      .sort((a, b) => a.localeCompare(b))
      .map((n) => ({ value: n, label: n, group: OFF_ROSTER }));

    return [...roster, ...offRoster];
  }, [salespeople, s.deals, draft.salespersonName]);

  /**
   * Record the pick, and the user behind it.
   *
   * ⚠ EXACTLY ONE MATCH, OR NO ID. `profiles.name` carries no uniqueness
   *   constraint, so two people can share a display name; guessing between them
   *   would attribute a deal to the wrong person on the strength of a string.
   *   Falling back to the name alone is the same state a typed value is in, and
   *   it is a state the whole feature already handles.
   *
   * ⚠ THE ONLY PLACE THAT WRITES THIS FIELD. `Combobox.create()` calls
   *   `onChange` with whatever `onCreate` returns, so a typed name arrives
   *   here too — which is why `onCreate` below returns the label and does
   *   nothing else. Patching in both would be two paths to keep in step.
   */
  const pickSalesperson = (v: string) => {
    const hit = salespeople.filter((p) => p.name === v);
    patch({ salespersonName: v, salespersonUserId: hit.length === 1 ? hit[0].id : "" });
  };

  /**
   * A pending "please add this to the list" prompt.
   *
   * ⚠ TYPING A NEW VALUE NEVER BLOCKS THE QUOTATION. The typed text is written
   *   straight onto the draft — these three columns hold TEXT, not a foreign
   *   key — and the modal only offers to add it to the master so the next
   *   person can pick it. Making a salesperson wait for somebody to approve a
   *   vocabulary entry mid-negotiation would be a worse product than the free
   *   text box this replaces.
   *
   *   Machines can be asked for too, but they CANNOT be typed onto the deal —
   *   see the machine picker below. Same modal, different landing.
   */
  const [ask, setAsk] = useState<{ type: OcpiMasterType; name: string } | null>(null);

  /** The machine just asked for, so the still-empty picker does not read as a no-op. */
  const [machineAsked, setMachineAsked] = useState<string | null>(null);

  /**
   * "Use this format" has been clicked over terms that are ALREADY TYPED, and is
   * asking before it overwrites them (OCPI-20).
   *
   * ⚠ THE BUTTON MUST NEVER SILENTLY REPLACE TYPED TEXT. A salesperson three
   *   quarters through a negotiated term, clicking only to see what the house
   *   wording was, must not lose it.
   *
   * ⚠ CONFIRM RATHER THAN DISABLE. Disabling the button while the box has content
   *   would lock it out of exactly the deal that needs it most — the live one whose
   *   payment terms are the word "na". Appending was the other candidate and is
   *   worse still: two payment sentences in one clause, on a signed contract.
   */
  /**
   * Which house format is waiting on a "yes, replace what I typed" (OCPI-30).
   *
   * ⚠ IT HOLDS THE FORMAT, NOT A FLAG. Under OCPI-20 there was one format, so a
   *   boolean was enough to remember which one the Replace button would insert.
   *   With seven, the answer to "replace with what?" is the pending format
   *   itself; a boolean would have made Replace insert whichever one the code
   *   happened to name.
   */
  const [pendingFormat, setPendingFormat] = useState<string | null>(null);

  /**
   * A high seas sale is a dollar deal with no GST, both fixed by the deal type.
   * The currency picker is disabled rather than hidden — a reader still needs to
   * see WHICH currency, and hiding it would make the rule look like a bug.
   */
  const isHighSeas = draft.transportTerms === "high_seas";

  /** The rupee equivalent, shown beside the rate so the figure is never a surprise. */
  const inrEquivalent = useMemo(() => {
    const amt = Number(draft.dealValueAmount);
    const rate = Number(draft.fxRate);
    if (!Number.isFinite(amt) || !Number.isFinite(rate) || !draft.dealValueAmount || !draft.fxRate) {
      return null;
    }
    return `₹${Math.round(amt * rate).toLocaleString("en-IN")}`;
  }, [draft.dealValueAmount, draft.fxRate]);

  /**
   * The dryer models inside the chosen category.
   *
   * `dryerType` is the category's NAME on the deal (a text column, frozen with
   * the quotation); the master is keyed by id, so the name is looked up here.
   * A category the deal holds but the master no longer lists simply yields an
   * empty list — and the value already on the deal is still offered below.
   */
  const dryerOptions = useMemo(() => {
    const typeId = s.dryerTypes.find((t) => t.name === draft.dryerType)?.id ?? null;
    const live = s.dryersFor(typeId).map((d) => d.name);
    const all =
      draft.dryerName && !live.includes(draft.dryerName) ? [...live, draft.dryerName] : live;
    return all.map((x) => ({ value: x, label: x }));
  }, [s, draft.dryerType, draft.dryerName]);

  const show = (k: keyof QuotationDraft) => isVisible(k, draft, dealAnswers);


  /**
   * ⚠ `anyShipment` IS GONE, AND ITS REMOVAL IS THE POINT (OCPI-14).
   *
   * It read
   *   `show("headShipMode") || show("inkShipMode") || show("dryerShipMode") ||
   *    show("sparesShipMode") || show("centeringShipMode")`
   * and guarded the whole card, so that an empty "Shipment & invoice" heading
   * over nothing never appeared.
   *
   * Head, ink and spare parts are asked on EVERY deal now, so the first three
   * terms are always true and the OR could never be false. A gate that cannot
   * close is worse than no gate: it still looks like a condition, so the next
   * reader has to work out that it is not one. The card renders unconditionally
   * and always carries at least three rows.
   */

  return (
    // ⚠ THE ID IS `focusField`'s FALLBACK. A missing-answers entry whose field
    //   somehow carries no anchor scrolls the form into view rather than
    //   silently ignoring the click, which reads as a broken page.
    <div id={QUOTATION_FORM_ANCHOR} className="space-y-4">
      <Card className="space-y-4 p-5">
        <h2 className="text-[15px] font-bold text-navy">Customer</h2>
        <CustomerPicker draft={draft} patch={patch} disabled={disabled} />

        <div className="grid gap-3 sm:grid-cols-2">
          <FieldLabel label="Contact person (Attn)">
            <TextInput
              value={draft.customerAttn}
              onChange={(e) => patch({ customerAttn: e.target.value })}
              placeholder="Who the quotation is addressed to"
              disabled={disabled}
            />
          </FieldLabel>
          <FieldLabel label="Mobile">
            <TextInput
              value={draft.customerMobile}
              onChange={(e) => patch({ customerMobile: e.target.value })}
              placeholder="10 digits"
              disabled={disabled}
            />
          </FieldLabel>
        </div>

        <FieldLabel label="Address">
          <TextArea
            rows={2}
            value={draft.customerAddress}
            onChange={(e) => patch({ customerAddress: e.target.value })}
            placeholder="Printed on the quotation under To,"
            disabled={disabled}
          />
        </FieldLabel>

        <div className="grid gap-3 sm:grid-cols-2">
          <FieldLabel label="Email">
            <TextInput
              type="email"
              value={draft.customerEmail}
              onChange={(e) => patch({ customerEmail: e.target.value })}
              disabled={disabled}
            />
          </FieldLabel>
          <YesNo
            label="GST registered"
            value={draft.gstAvailable}
            onChange={(v) => patch({ gstAvailable: v })}
            disabled={disabled}
          />
        </div>

        {show("gstNo") && <GstinField draft={draft} patch={patch} disabled={disabled} />}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <FieldLabel label="Selling entity" hint="whose bank account this prints">
              <Combobox
                value={draft.companyId}
                onChange={(v) => patch({ companyId: v })}
                options={companyOptions}
                placeholder="Which of our companies is selling"
                searchable
                clearable
                disabled={disabled}
              />
            </FieldLabel>
            {/* ⚠ BLANK IS A LEGITIMATE ANSWER and is NOT marked required, because
                Tally leaves ~10 of 1,888 customers with no company at all and the
                default row exists precisely to cover them (see store.tsx
                `profileStatusFor`). What blank must not be is SILENT — it decides
                a bank account. So it names the entity it will fall back to. */}
            {!draft.companyId && defaultEntityName && (
              <p className="mt-1.5 text-[12px] text-grey-2">
                Left blank, this prints <b className="text-navy">{defaultEntityName}</b>.
              </p>
            )}
          </div>
          <div>
            <FieldLabel
              label="Salesperson"
              required={req.has("salespersonName")}
              anchor={FIELD_ANCHOR("salespersonName")}
            >
              <Combobox
                value={draft.salespersonName}
                onChange={pickSalesperson}
                options={salespersonOptions}
                placeholder="Who owns this deal"
                searchable
                clearable
                disabled={disabled}
                onCreate={(label) => label}
                createLabel={(q) => `Use “${q}”`}
              />
            </FieldLabel>
            {/* The heading in the list says a name is off-roster; once it is
                CHOSEN the trigger shows a bare name like any other, so the same
                fact has to be said again here. It prints on the customer's
                quotation either way — this is a note, not a warning. */}
            {draft.salespersonName && !draft.salespersonUserId && !rosterLoading && (
              <p className="mt-1.5 text-[12px] text-grey-2">
                Not a portal user — this name prints as typed.
              </p>
            )}
            {/* An empty roster is a settings problem, not a typo. Say which
                screen fixes it rather than leaving a picker that offers nobody. */}
            {salespeople.length === 0 && !rosterLoading && (
              <p className="mt-1.5 text-[12px] text-grey-2">
                No departments are set as Sales yet — an admin names them in
                Setup › Salespeople.
              </p>
            )}
          </div>
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="text-[15px] font-bold text-navy">
          Machine details <span className="text-[12px] font-normal text-grey-2">· section A</span>
        </h2>

        <div className="grid gap-3 sm:grid-cols-3">
          {/*
            🔴 THE CATEGORY IS THE ANSWER, NOT A FILTER (OCPI-14). It narrows the
               machine list exactly as it always did, but it is now stored on the
               deal and it is what decides whether this quotation asks about a
               dryer, a centering device and the three optional extras.

               The note that stood here said the opposite — "deliberately NOT on
               the draft and not on the deal", on the reasoning that the machine
               already carries its own category and a second copy could disagree.
               That is true of a filter and fatal for a branch input: both write
               RPCs null every column their branches hide and can only see the
               row, so a question shown on local state is a question whose answer
               the server deletes on the next save.

               The two cannot disagree because `chooseMachine` snaps this to the
               machine's own category and the RPC coalesces onto the same value.

            ⚠ CLEARING IT STILL SHOWS EVERY MACHINE, and picking one sets it
              again. That is how a salesperson compares models across types.
              Every machine now HAS a category — Label Printer and Book Printer
              were given POD by the 01-09 sheet — so clearing is a browsing
              gesture, never the only way to reach a model.
          */}
          <FieldLabel
            label="Machine category"
            hint="decides what this quotation asks"
            required={req.has("machineCategoryId")}
            anchor={FIELD_ANCHOR("machineCategoryId")}
          >
            <Combobox
              value={draft.machineCategoryId}
              onChange={(v) => {
                // A machine outside the new category would leave the picker
                // showing a value that is not in its own list. Clear it rather
                // than leave that contradiction on screen.
                if (v && draft.machineId && s.machineById(draft.machineId)?.categoryId !== v) {
                  chooseMachine("");
                }
                patch({ machineCategoryId: v });
              }}
              options={categoryOptions}
              placeholder="All categories"
              searchable
              clearable
              disabled={disabled}
            />
          </FieldLabel>
          <div>
            <FieldLabel
              label="Machine"
              required={req.has("machineId")}
              anchor={FIELD_ANCHOR("machineId")}
            >
              <Combobox
                value={draft.machineId}
                onChange={chooseMachine}
                options={machineOptions}
                placeholder={machineOptions.length ? "Choose the model" : "Nothing set up yet — ask for one"}
                searchable
                clearable
                disabled={disabled}
                onCreate={(label) => {
                  // ⚠ UNLIKE ink / dryer, THIS DOES NOT PUT THE TYPED NAME ON
                  //   THE DEAL. Those are text columns, so the typed value IS
                  //   the answer. A deal points at a machine BY ID, and no id exists
                  //   until somebody approves the request — so the field stays empty
                  //   on purpose. Returning nothing is the Combobox's own "asked for,
                  //   not chosen"; the note below says so, because an empty picker
                  //   otherwise reads as nothing having happened.
                  setAsk({ type: "machine", name: label });
                }}
                createLabel={(q) => `Ask for “${q}”`}
              />
            </FieldLabel>
            {machineAsked && !draft.machineId && (
              <p className="mt-1.5 text-[12px] text-grey-2">
                Asked for <b className="text-navy">“{machineAsked}”</b> — pick it here once it
                is approved. Save this as a draft meanwhile.
              </p>
            )}
            {chosenMachine?.billingName && (
              <p className="mt-1.5 text-[12px] text-grey-2">
                Bills as <b className="text-navy">{chosenMachine.billingName}</b>
              </p>
            )}
          </div>

          {/*
            🔴 SHOWN WHERE THERE IS ONE, CHOSEN WHERE THERE ARE TWO (OCPI-14).

               OCPI-3 stage E made the print head a property of the model, read
               off the master and displayed rather than picked — and
               `chooseMachine` copied every mapped head onto `headType` JOINED
               WITH " + ". The client's 01-09 sheet shows why that was wrong:
               column G reads "EX600 **or** RC" on seven of the 28 models. An
               "or" was being recorded as an "and", so a K64 quotation said the
               customer was getting both heads when they choose one.

               So: one mapped head is still shown and not chosen; TWO OR MORE are
               a choice, as buttons.

            ⚠ A DELIBERATE SECOND EXCEPTION TO `ChoiceButtons`' OWN RULE, which
              says "ONLY FOR A FIXED VOCABULARY DECLARED IN CODE — never a master
              list". This is a master list. The exception is safe for the same
              reason the dryer category's was (OCPI-8): the strip is sized by
              what ONE MACHINE carries, which is one or two options, not by how
              many head types the master holds. Recorded in OCPI.md.

            ⚠ AN OLD DEAL'S HEAD MATCHES NO BUTTON, and must not be blanked.
              `head_type` is frozen TEXT and 22 of the 28 machines changed their
              mapping in the 01-09 refresh, so a deal quoted as
              "Homer + KATANA 600 DPI - HANGLORY" now matches nothing. Ten live
              deals were in that state on 02-09.

            🔴 THE READ-OUT ALONE WAS NOT THE FIX, and OCPI-21 is what proved it.
              `ChoiceButtons` leaves an unmatched value selected and never clears
              it, so the answer did survive a save — but with nothing lit, its
              `index` is -1, the roving tabindex parks focus on button 0, and
              `onKeyDown` computes `from = -1`. A single ↓ on a tabbed-to strip
              therefore fired `onChange(options[0])` — replacing a recorded answer
              while the screen appeared not to move at all.

              So the value is FED BACK IN AS AN OPTION, exactly as OCPI-17 did for
              Platter: it lights a button, `aria-checked` is true on it, Tab lands
              on IT rather than on button 0, and the index is real, so the arrow
              keys move between options the way they do everywhere else. The
              read-out below stays — it now explains why there is a button the
              machine does not list, which is the job it can actually do.

            ⚠ IT MAKES THE LOSS VISIBLE, NOT IMPOSSIBLE. ↓ still moves off the lit
              button, and the retired option then disappears, because it exists
              only while it is the stored value. That one-way door is deliberate
              and is documented on `optsWithCurrent`: a withdrawn option should not
              be re-selectable once it has been given up.

            ⚠ `optsWithCurrent`, NOT `masterOpts`, even though this is a master
              list. `masterOpts` filters on `active`, and `headsFor` deliberately
              does not — a machine mapped to a head somebody has since retired
              should still say so. Routing through `masterOpts` would re-apply a
              filter the store had just decided against.

            ⚠ THE COPY STILL HAPPENS IN `chooseMachine`, NEVER IN AN EFFECT. An
              effect would overwrite the head text on a deal quoted before the
              mapping existed, the moment somebody merely opened it.
          */}
          <FieldLabel
            label={mappedHeads.length > 1 ? "Print head" : "Print heads"}
            hint={
              mappedHeads.length > 1
                ? "this model offers a choice — pick the one being supplied"
                : "from the machine master"
            }
            required={req.has("headType")}
            anchor={FIELD_ANCHOR("headType")}
          >
            {mappedHeads.length > 1 ? (
              <div className="space-y-1.5">
                <ChoiceButtons
                  options={optsWithCurrent(mappedHeads.map((h) => h.name), draft.headType)}
                  value={draft.headType}
                  onChange={(v) => patch({ headType: v })}
                  disabled={disabled}
                  ariaLabel="Print head"
                />
                {draft.headType && !mappedHeads.some((h) => h.name === draft.headType) && (
                  <p className="text-[12px] text-grey-2">
                    Quoted as <b className="text-navy">{draft.headType}</b> — not one of this
                    model’s current options. Leave it, or pick again to change it.
                  </p>
                )}
              </div>
            ) : (
              <div className="min-h-9 rounded-lg border border-line bg-page px-3 py-2 text-[13px] text-navy">
                {/*
                  🔴 THE DEAL'S OWN ANSWER OUTRANKS THE MACHINE'S, and the check on
                    `soleHeadAgrees` is what makes that true. This branch used to
                    print `mappedHeads[0].name` UNCONDITIONALLY, so a deal holding
                    a different head was shown the machine's — while
                    `quotationPdf.ts` printed the deal's. Six live deals were in
                    that state on 02-09 (QT-M0026, 27, 28, 32, 34, 38): the screen
                    said I3200 and the paper said KYOCERA KJ4B.

                    It is the same defect as the buttons above, minus the keyboard:
                    a stored value that matches no option, silently not shown. A
                    single mapped head is not a choice, so there is nothing to pick
                    here — the honest thing is to show what will be printed, and
                    name what the machine maps beside it.
                */}
                {mappedHeads.length === 1 && soleHeadAgrees ? (
                  <span className="rounded-md border border-line bg-white px-1.5 py-0.5 text-[12px]">
                    {mappedHeads[0].name}
                  </span>
                ) : draft.headType ? (
                  // A deal quoted before the mapping existed, or against a head the
                  // machine has since changed. Show what it holds rather than an
                  // empty box that reads as "no head", or a head it does not have.
                  <span title="recorded on this deal; not what this machine maps today">
                    {draft.headType}
                  </span>
                ) : (
                  <span className="text-grey-2">
                    {draft.machineId
                      ? "No print head mapped to this machine"
                      : "Choose a machine first"}
                  </span>
                )}
              </div>
            )}
            {mappedHeads.length === 1 && !soleHeadAgrees && draft.headType && (
              <p className="mt-1.5 text-[12px] text-grey-2">
                The machine master now lists <b className="text-navy">{mappedHeads[0].name}</b> for
                this model. This deal was quoted on the head above, and that is what prints.
              </p>
            )}
          </FieldLabel>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <FieldLabel
            label="No. of machines"
            required={req.has("machineCount")}
            anchor={FIELD_ANCHOR("machineCount")}
          >
            <TextInput
              inputMode="numeric"
              value={draft.machineCount}
              onChange={(e) => patch({ machineCount: e.target.value.replace(/\D/g, "") })}
              disabled={disabled}
            />
          </FieldLabel>
          {/* ⚠ 0 IS AN ANSWER (OCPI-27). Five machines carry no head type at
              all, and the rule is mandatory on every deal — so a machine with
              none is answered with a zero rather than left blank. */}
          <FieldLabel
            label="No. of print heads required"
            required={req.has("headCount")}
            anchor={FIELD_ANCHOR("headCount")}
          >
            <TextInput
              inputMode="numeric"
              value={draft.headCount}
              onChange={(e) => patch({ headCount: e.target.value.replace(/\D/g, "") })}
              disabled={disabled}
            />
          </FieldLabel>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {/*
            ⚠ BUTTONS, NOT A DROPDOWN (OCPI-26, asked for by Ritesh Bhai). Three
              options, so a strip is fewer clicks and shows every answer at once.

            ⚠ WHAT THE COMBOBOX CARRIED, one at a time (the CLAUDE.md container
              rule — account for every control before replacing the container):
              · `searchable` — genuinely goes. A search box over three values is
                noise.
              · `clearable` — KEPT. The field is optional and stays optional
                (settled under OCPI-27, alongside Platter), so without a way back
                the first click would be irreversible.
              · `masterOpts(s.inkTypes, draft.inkType)` — KEPT, and it is
                load-bearing rather than tidy: 5 deals on record carry
                "Pigment Ink" while the master says "Pigment". `ChoiceButtons`
                renders an unmatched value as NOTHING SELECTED and a single ↓
                then overwrites it (the OCPI-21 failure). Feeding the deal's own
                value back in as a fourth button is the guard.
              · `onCreate` + `createLabel` + `setAsk({ type: "ink_type" })` —
                🔴 DELETED ON PURPOSE, NOT BY OVERSIGHT. Settled 02-09-2026:
                Ritesh Bhai — the ink list is fixed by the master, and if a new
                ink is needed it is added on the Masters screen and appears here
                by itself. A salesperson does not invent one mid-deal. This note
                is the record that the feature was accounted for and chosen
                against; do not "restore" it as a lost affordance.

                ⚠ THE CAPABILITY IS NOT GONE, only this shortcut to it. The OCPI
                  **Master Requests** page still raises an `ink_type` request,
                  `fms_ocpi_resolve_master_request` still handles it, and
                  `setAsk` is still called by the Machine picker above — so
                  neither the state, the modal nor the master type is an orphan.

            ⚠ RENDERED FROM THE LIVE MASTER, never a hardcoded three. With no way
              to type an ink, a master addition that did not reach this strip
              would leave a salesperson with no route to it at all.
          */}
          <FieldLabel label="Type of ink">
            <ChoiceButtons
              value={draft.inkType}
              onChange={(v) => patch({ inkType: v })}
              options={masterOpts(s.inkTypes, draft.inkType)}
              clearable
              disabled={disabled}
              ariaLabel="Type of ink"
            />
          </FieldLabel>
          {/*
            ⚠ PLATTER MOVED HERE FROM THE DRYER BLOCK (OCPI-3, stage E), and it
              is the one field in this stage NOBODY ASKED ABOUT — it appears in
              no pointer and nowhere in the work list, so its home is still an
              open question with the client.

              It was moved rather than left because the two engines disagreed
              about it: the form only showed it when the deal had a dryer, while
              `fms_ocpi_write_oc` stores `platter_details` UNCONDITIONALLY. The
              form was the stricter of the two, so a machine with no dryer could
              never record a platter the database was perfectly willing to keep.
              Machine details is where the SQL already assumes it lives. If the
              client says it belongs to the dryer, gate it in BOTH places.

            ⚠ THAT JUSTIFICATION USED TO HAVE A SECOND HALF — that "Not Applicable"
              was one of Platter's own options, so the field could answer itself on
              a machine it did not apply to. OCPI-17 removed that option (the ✕
              already meant the same thing), so only the SQL argument above is
              left. Do not cite the option list as a reason this field lives here.

            ⚠ `optsWithCurrent`, NOT `opts` — a deal quoted as "Not Applicable"
              still holds it, and `ChoiceButtons` renders an unmatched value as
              nothing at all. See the helper for why that is worse than it sounds.
          */}
          <FieldLabel label="Platter">
            <div className="space-y-1.5">
              <ChoiceButtons
                value={draft.platterDetails}
                onChange={(v) => patch({ platterDetails: v })}
                options={optsWithCurrent(PLATTER_OPTIONS, draft.platterDetails)}
                clearable
                disabled={disabled}
                ariaLabel="Platter"
              />
              {draft.platterDetails &&
                !PLATTER_OPTIONS.some((o) => o === draft.platterDetails) && (
                  <p className="text-[12px] text-grey-2">
                    <b className="text-navy">{draft.platterDetails}</b> is no longer offered —
                    kept because this deal was quoted with it. Pick again, or clear it, to drop it.
                  </p>
                )}
            </div>
          </FieldLabel>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <FieldLabel label="Ink selling price" hint="free text — “N/A” is a real answer">
            <TextInput
              value={draft.inkPrice}
              onChange={(e) => patch({ inkPrice: e.target.value })}
              disabled={disabled}
            />
          </FieldLabel>
          <FieldLabel label="Ink credit terms (future)">
            <TextInput
              value={draft.inkCreditTerms}
              onChange={(e) => patch({ inkCreditTerms: e.target.value })}
              placeholder="e.g. 30"
              disabled={disabled}
            />
          </FieldLabel>
        </div>
      </Card>

      {/*
        ── Dryer details ────────────────────────────────────────────────────────

        ⚠ THE WHOLE CARD IS THE MACHINE'S DECISION, not the salesperson's. It
          appears only when the chosen model's `needs_dryer` flag is true — 11 of
          the 28 machines. `fms_ocpi_write_oc` reads the same flag off the same
          column and nulls every one of these fields when it is not set, so the
          two must never drift apart.

        ⚠ THE EXTRAS ARE NOT IN HERE, and that is not an oversight. P8S needs no
          dryer and can still take a chilling system, so anything nested inside
          this card would be unreachable for it. They have their own card below,
          gated per machine capability.
      */}
      {show("dryerType") && (
        <Card className="space-y-4 p-5">
          <div>
            <h2 className="text-[15px] font-bold text-navy">Dryer details</h2>
            <p className="mt-1 text-[12.5px] text-grey">
              Asked because <b className="text-navy">{chosenMachine?.name}</b> takes a dryer. No
              warranty is offered on a dryer.
              {/*
                ⚠ THE COLLAPSE IS ANNOUNCED, NOT JUST PERFORMED (OCPI-8). Five
                  fields vanish the moment this category is picked, and a card
                  that shrinks to one control with no explanation reads as a
                  panel that failed to load. Same reason `NotAsked` puts a dash
                  and a reason in the shipment table instead of an empty cell:
                  "not asked" and "not answered" must not look alike.
              */}
              {dealAnswers.noDryerCategory && (
                <>
                  {" "}
                  <b className="text-navy">
                    This deal carries no dryer, so nothing further is asked here.
                  </b>
                </>
              )}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {/*
              ⚠ BUTTONS, NOT A DROPDOWN (OCPI-8, asked for by Ritesh Bhai). Three
                options, and this is the field that now decides whether half the
                card exists — so it should be readable at a glance rather than
                folded into a closed dropdown.

              ⚠ A DELIBERATE EXCEPTION TO `ChoiceButtons`' OWN RULE, which says
                "ONLY FOR A FIXED VOCABULARY DECLARED IN CODE — never a master
                list" and cites this very master by name. OCPI-8 requires the
                opposite — hardcode the three and a category added on the Masters
                screen would never appear here, with the two screens disagreeing
                and no clue why. Every other strip in this form feeds it an
                `as const` array; this is the first master-driven one. The
                mitigation is that the strip is `flex-wrap`, so a fourth or fifth
                category wraps onto a second line rather than overflowing.

              ⚠ WHAT THE COMBOBOX CARRIED, one at a time:
                · `searchable` — gone. A search box over three values is noise.
                · `clearable` — KEPT. Neither `missingForSubmit` nor the table's
                  own `fms_ocpi_complete_when_submitted` requires a category, so
                  this is an optional field, and without a way back the first
                  click would be irreversible.
                · `onCreate` + the master request — DELIBERATELY DROPPED. It
                  first came back as a "+ Other" button, and Ritesh Bhai removed
                  it on sight (01-Sep-2026): the three categories are the whole
                  vocabulary, and a fourth is an admin decision rather than
                  something a salesperson invents mid-quotation. Unlike the head,
                  ink and machine pickers — which keep their `onCreate`, because
                  those lists genuinely grow.

                  ⚠ THE CAPABILITY IS NOT GONE, only this shortcut to it. The
                    OCPI **Master Requests** page raises a `dryer_type` request
                    with the type chosen there, and `fms_ocpi_resolve_master_request`
                    still handles it. Do not delete that branch as an orphan on
                    the strength of this field no longer using it.
            */}
            <FieldLabel label="Dryer category">
              <ChoiceButtons
                value={draft.dryerType}
                // Changing the category orphans the model inside the old one.
                onChange={(v) => patch({ dryerType: v, dryerName: "" })}
                options={masterOpts(s.dryerTypes, draft.dryerType)}
                clearable
                disabled={disabled}
                ariaLabel="Dryer category"
              />
            </FieldLabel>
            {/*
              ⚠ ONE GUARD FOR THE WHOLE GROUP, AND IT IS NOT OPTIONAL (OCPI-8).
                These five fields used to render unconditionally inside the card
                — only `dryerPrice` had a `show()` of its own. `clearHidden`
                iterates EVERY rule in `PART_A_VISIBILITY`, not the ones the form
                happens to ask about, so adding the rules without this guard
                would blank the answers on every save while leaving the boxes on
                screen. Silent data loss, not a fix.

                They share one condition, so they take one check. Read the rules
                themselves in `branching.ts` — `hasDryerDetails` — which is also
                what `clearHidden` and `fms_ocpi_write_oc` obey.

              ⚠ THREE AFFORDANCES CAME OUT WITH IT, deliberately rather than by
                oversight (the FIX-4 rule): the Dryer picker's
                `hint="choose a category first"`, its `disabled` on an empty
                category, and its "Choose a category first" placeholder. All
                three were unreachable the moment the group hides until a
                category is picked, and a disabled-but-visible box breaks this
                file's own header rule — "CONDITIONAL FIELDS ARE HIDDEN, NEVER
                DISABLED". Leaving them would have been dead code that lies.
            */}
            {show("dryerName") && (
              <FieldLabel label="Dryer">
                <Combobox
                  value={draft.dryerName}
                  onChange={(v) => patch({ dryerName: v })}
                  options={dryerOptions}
                  placeholder={
                    dryerOptions.length ? "Choose the model" : "None set up in this category"
                  }
                  searchable
                  clearable
                  disabled={disabled}
                />
              </FieldLabel>
            )}
          </div>

          {show("dryerChambers") && (
            <div className="grid gap-3 sm:grid-cols-2">
              <FieldLabel label="How many chambers with the dryer">
                <TextInput
                  value={draft.dryerChambers}
                  onChange={(e) => patch({ dryerChambers: e.target.value })}
                  disabled={disabled}
                />
              </FieldLabel>
              <FieldLabel label="Heating medium">
                <TextInput
                  value={draft.heatingMode}
                  onChange={(e) => patch({ heatingMode: e.target.value })}
                  placeholder="e.g. electric, gas, thermic fluid"
                  disabled={disabled}
                />
              </FieldLabel>
            </div>
          )}

          {/*
            🔴 THE DRYER PRICE BOX IS GONE (OCPI-14, asked for by Ritesh Bhai).
               It appeared beside this question whenever the answer was No — a
               dryer outside the deal is a separate charge — and it was the
               precedent OCPI-7's whole show-on-false group was written from.

               It went because ALL PRICING IS ASKED ONCE, in Shipment & invoice,
               where the Dryer row already collects a quantity and an amount.
               Two places to type the same figure is how two figures end up on
               one contract.

               The column and its derivation survive untouched in
               fms_ocpi_write_oc; the form simply stops sending the key, so
               `dryer_value_inr` and `dryer_gst_inr` resolve to null and
               `grand_total_inr` collapses to `total_inr`. Nothing was lost: no
               deal on record carried a price, and no machine template references
               the `{{dryer_price}}` token, so no clause anywhere prints a blank.

            ⚠ `dryerIncluded` STAYS. It is still a real question — is the dryer
              part of this deal or sold beside it — and the papers say so. Only
              the price it used to reveal is gone.
          */}
          {show("dryerIncluded") && (
            <div className="grid gap-3 sm:grid-cols-2">
              <YesNo
                label="Dryer included in the deal"
                value={draft.dryerIncluded}
                onChange={(v) => patch({ dryerIncluded: v })}
                disabled={disabled}
              />
            </div>
          )}
        </Card>
      )}

      <Card className="space-y-4 p-5">
        <h2 className="text-[15px] font-bold text-navy">
          Deal inclusions <span className="text-[12px] font-normal text-grey-2">· section B</span>
        </h2>

        <div className="grid gap-3 sm:grid-cols-2">
          <YesNo
            label="Deal includes ink"
            value={draft.inclInk}
            onChange={(v) => patch({ inclInk: v })}
            disabled={disabled}
            required={req.has("inclInk")}
            anchor={FIELD_ANCHOR("inclInk")}
          />
          {show("inkQtyIncluded") && (
            /*
              ⚠ THE HINT ASKS FOR THE UNIT, IT DOES NOT STATE ONE. A numeric
                "subsidized quantity (litres)" sits one block below this
                free-text box, measuring the same substance on the opposite
                branch, so this one has to say what kind of value it holds. But
                it cannot claim litres: of the 17 deals on record 15 say litres
                and two say "25 Kgs" and "3000kg". Printing "litres" beside
                those would put a unit on a customer's paper that the deal never
                agreed to. Free text stays free; it is only asked to be explicit.
            */
            <FieldLabel
              label="Quantity of ink included"
              hint="state the unit"
              required={req.has("inkQtyIncluded")}
              anchor={FIELD_ANCHOR("inkQtyIncluded")}
            >
              <TextInput
                value={draft.inkQtyIncluded}
                onChange={(e) => patch({ inkQtyIncluded: e.target.value })}
                disabled={disabled}
              />
            </FieldLabel>
          )}
        </div>

        <RateOffer
          title="Ink"
          why="the deal does not include ink"
          shown={show("inkOfferAgreed")}
          disabled={disabled}
          agreed={draft.inkOfferAgreed}
          onAgreed={(v) => patch({ inkOfferAgreed: v })}
          showLines={show("inkOfferQty")}
          qtyLabel="Quantity"
          qtyHint="litres"
          qtyMode="decimal"
          qty={draft.inkOfferQty}
          onQty={(v) => carry(v, "inkOfferQty", "inkInvoiceQty")}
          qtyKey="inkOfferQty"
          rateLabel="Rate"
          rateHint="per litre"
          rate={draft.inkOfferRate}
          onRate={(v) => carry(v, "inkOfferRate", "inkInvoiceAmount")}
          rateKey="inkOfferRate"
          req={req}
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <YesNo
            label="Deal includes spare parts"
            value={draft.inclSpares}
            onChange={(v) => patch({ inclSpares: v })}
            disabled={disabled}
            required={req.has("inclSpares")}
            anchor={FIELD_ANCHOR("inclSpares")}
          />
          {show("spareDetails") && (
            <FieldLabel
              label="Spare part details and quantity"
              hint="item name & quantity"
              required={req.has("spareDetails")}
              anchor={FIELD_ANCHOR("spareDetails")}
            >
              <TextInput
                value={draft.spareDetails}
                onChange={(e) => patch({ spareDetails: e.target.value })}
                disabled={disabled}
              />
            </FieldLabel>
          )}
        </div>

        {/*
          OCPI-14 · THE CENTERING DEVICE, AS A DEAL INCLUSION IN ITS OWN RIGHT.

          ⚠ IT REPLACES THE "External centering system" TICK that used to sit in
            "Also included" below — one of four bare yes/no ticks with nowhere to
            say WHICH device or HOW MANY. The client asked for it to be treated
            like spare parts instead, so it is: a Yes/No, and on Yes one box for
            the details and the quantity. A No ends it, exactly as spares does —
            there is deliberately no subsidized-rate branch here, because the
            client asked for the spare-parts shape and not the ink one.

          ⚠ AND IT IS ASKED ON THE CATEGORY, NOT THE MACHINE. The tick was gated
            on the model's own `opt_external_centering`, which meant it appeared
            on 5 machines of 28. It now appears on every Direct deal — 11
            machines — including the three Fab Pro models the sheet marks as
            unable to carry one. That widening is the client's instruction, not
            an oversight.
        */}
        {show("inclCentering") && (
          <div className="grid gap-3 sm:grid-cols-2">
            <YesNo
              label="Deal includes centering device"
              value={draft.inclCentering}
              onChange={(v) => patch({ inclCentering: v })}
              disabled={disabled}
              required={req.has("inclCentering")}
              anchor={FIELD_ANCHOR("inclCentering")}
            />
            {show("centeringDetails") && (
              <FieldLabel
                label="Centering device details and quantity"
                hint="item name & quantity"
                required={req.has("centeringDetails")}
                anchor={FIELD_ANCHOR("centeringDetails")}
              >
                <TextInput
                  value={draft.centeringDetails}
                  onChange={(e) => patch({ centeringDetails: e.target.value })}
                  disabled={disabled}
                />
              </FieldLabel>
            )}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <YesNo
            label="Deal includes head"
            value={draft.inclHead}
            onChange={(v) => patch({ inclHead: v })}
            disabled={disabled}
            required={req.has("inclHead")}
            anchor={FIELD_ANCHOR("inclHead")}
          />
          {show("headsIncluded") && (
            <FieldLabel
              label="No. of heads included"
              required={req.has("headsIncluded")}
              anchor={FIELD_ANCHOR("headsIncluded")}
            >
              <TextInput
                inputMode="numeric"
                value={draft.headsIncluded}
                onChange={(e) => patch({ headsIncluded: e.target.value.replace(/\D/g, "") })}
                disabled={disabled}
              />
            </FieldLabel>
          )}
        </div>

        {/*
          ⚠ NOT the "separate invoice" quantity and amount in Shipment & invoice
            below. Those mean a head that IS included but is billed on its own
            document; this is a head the deal does not include at all. The two
            are mutually exclusive by construction — the writer keeps the
            invoice pair only when the inclusion is Yes and this pair only when
            it is No.
        */}
        <RateOffer
          title="Print head"
          why="the deal does not include a head"
          shown={show("headOfferAgreed")}
          disabled={disabled}
          agreed={draft.headOfferAgreed}
          onAgreed={(v) => patch({ headOfferAgreed: v })}
          showLines={show("headOfferQty")}
          qtyLabel="Quantity"
          qtyHint="nos."
          qtyMode="integer"
          qty={draft.headOfferQty}
          onQty={(v) => carry(v, "headOfferQty", "headInvoiceQty")}
          qtyKey="headOfferQty"
          rateLabel="Rate"
          rateHint="per head"
          rate={draft.headOfferRate}
          onRate={(v) => carry(v, "headOfferRate", "headInvoiceAmount")}
          rateKey="headOfferRate"
          req={req}
        />

        {/*
          ── Also included ──────────────────────────────────────────────────────

          ⚠ THESE FOUR MOVED HERE FROM *Document details* (OCPI-10), where they
            sat under a heading "Options included" that a salesperson filling in
            a deal never thought to open. Section B is where the deal's contents
            are decided, so this is where they are asked.

          ⚠ THE CARD NOW HOLDS TWO KINDS OF QUESTION, and the divider and the
            note below are what make the difference read as deliberate. The
            three above open a rate follow-up on No, because ink and heads are
            still SOLD when they are not included. These four do not: a chilling
            system is not sold by the litre, so a No simply ends it.

          🔴 THREE, NOT FOUR, AND ALL THREE FOLLOW THE CATEGORY (OCPI-14).

             OCPI-10 ungated these on 31-Aug because the per-machine mapping was
             nulling answers people had given — 25 of 28 machines said "no" to an
             air blade, so the question could be answered and silently lost. The
             01-09 sheet settles it properly instead: the extras are mapped
             against DIRECT machines only and read "no" for every Sublimation,
             Other and POD model. So they are asked on a Direct deal and are not
             asked, and are recorded as No, anywhere else.

          🔴 A HIDDEN ANSWER HERE IS `false`, NOT `null` — the one exception in
             the whole module. Ritesh Bhai asked for a definite No rather than an
             unanswered question, so `clearHidden` has a `CLEARS_TO_FALSE` set and
             `fms_ocpi_write_oc` has the matching `else false`. Change one and
             change both, or the value flips on alternate saves and the revision
             diff reports a change on every one of them.

          ⚠ THE CENTERING TICK HAS LEFT THIS GROUP ENTIRELY. It is a full deal
            inclusion now, above, with a details-and-quantity box — a bare tick
            could not say WHICH device or HOW MANY. Do not add it back here.

          ⚠ `standardHint` IS GONE WITH THE MACHINE'S FACTS. It read the model's
            own mapping to say "standard on this machine", and nothing in this
            form reads that mapping any more. The hint would have had to come
            from a column that no longer decides anything, which is exactly the
            kind of control this repo keeps writing down as a fault.
        */}
        {show("airBlade") && (
        <div className="space-y-3 border-t border-line pt-4">
          <h3 className="text-[13px] font-semibold text-ink">Also included</h3>
          <p className="text-[12px] text-grey-2">
            Yes or No only — unlike the three above, these do not open a rate question.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <YesNo
              label="Air blade"
              value={draft.airBlade}
              onChange={(v) => patch({ airBlade: v })}
              disabled={disabled}
            />
            <YesNo
              label="Ink dust exhauster"
              value={draft.inkDustExhauster}
              onChange={(v) => patch({ inkDustExhauster: v })}
              disabled={disabled}
            />
            <YesNo
              label="Chilling system"
              value={draft.chillingSystem}
              onChange={(v) => patch({ chillingSystem: v })}
              disabled={disabled}
            />
          </div>
        </div>
        )}
        <div className="space-y-3">
          {/*
            ⚠ NOT `otherCommitments`, which is retired and has no input — see
              the notice further down. And deliberately narrower than *Special
              remarks* in section D: this asks what else is IN the deal, that
              one takes anything else ABOUT it. Both hints say so, or the two
              boxes drift into meaning the same thing and the same sentence
              gets typed into whichever the eye lands on first.
          */}
          <FieldLabel
            label="Other inclusions"
            hint="anything else included in the deal — for anything else about the deal, use Special remarks"
          >
            <TextArea
              rows={2}
              value={draft.otherInclusions}
              onChange={(e) => patch({ otherInclusions: e.target.value })}
              disabled={disabled}
            />
          </FieldLabel>
        </div>
      </Card>

      {/*
        ── Shipment & invoice ─────────────────────────────────────────────────

        ⚠ ONE SECTION, NOT FIVE SCATTERED ONES (OCPI-3, stage F). "The head" used
          to sit near the bottom of Document details with three questions; the
          centering device had none anywhere, and ink had none at all until
          OCPI-11. The client asked for every part to be asked the SAME five
          things in ONE place — so a reader can see, in one glance, what leaves
          the factory separately and what is billed separately.

        ⚠ A TABLE, NOT STACKED BOXES (OCPI-11). Items down the left, the
          questions across the top, in the order the client gave: head, ink,
          dryer, spare parts, centering device.

        🔴 THIS SECTION HAS NO CONNECTION TO THE DEAL INCLUSIONS (OCPI-14).
           Head, ink and spare parts used to appear only when the deal INCLUDED
           them. They are asked on every deal now: how a thing ships, and whether
           it is billed on its own document, is a different question from whether
           it sits inside the machine price — a customer can be invoiced
           separately for a head the deal does not include.

           Only two rows are still conditional, and the MACHINE CATEGORY decides
           both: the dryer and the centering device. So the table is FIVE ROWS ON
           A DIRECT DEAL AND THREE ON EVERY OTHER, and the count no longer moves
           with what the salesperson ticked upstairs. Every rule has its twin in
           fms_ocpi_write_oc, which nulls what it hides on every save.

        ⚠ AMOUNTS ARE EXCLUSIVE OF TAX, by instruction, and the heading says so.
          They are stored and printed as given; NOTHING HERE — the sub-totals
          included — is added to `total_inr`, which is derived server-side from
          the deal value alone. A separately-invoiced item is billed on its own
          document, so rolling it into this contract would charge it twice.
      */}
        <Card className="space-y-4 p-5">
          <div>
            <h2 className="text-[15px] font-bold text-navy">Shipment &amp; invoice</h2>
            <p className="mt-0.5 text-[12.5px] text-grey">
              How each part of the deal travels, and whether it is billed on its own. Only the parts
              this deal actually carries are listed. Amounts exclude tax, and no figure here is added
              to the deal value or its total.
            </p>
          </div>

          {/*
            ⚠ `ScrollableTable` RATHER THAN A BARE OVERFLOW DIV, per CLAUDE.md.
              Seven columns of controls is the one real risk in this layout, so
              the two pickers stay Comboboxes rather than button strips to keep
              the table inside a laptop screen — see the note on `ShipmentRow`.
              The wrapper is still here for the narrow windows where it does
              overflow, and it already ignores arrow keys while focus is in a
              text box, so typing a quantity never scrolls the table.

            ⚠ THE WIDTHS SUM TO THE min-w (132+140+148+164+74+104+104 = 866).
              Change one and change that, or the columns stop matching their
              headers once the table is narrower than its content.

            ⚠ `table-fixed` IS LOAD-BEARING, not tidiness. Under the default
              auto layout these widths are only hints: the browser re-derives
              each column from its content's minimum, and the Yes/No control's
              minimum is ONE button (72px). So the Separate-invoice column
              quietly collapsed on any screen below ~1400px and the pair
              stacked, taking every row from 73px to 138px. A `min-w` on that
              cell does not fix it — auto layout ignores it in favour of the
              content minimum. Fixed layout honours the declared widths, so the
              pair stays on one line at every width and `ScrollableTable`
              handles the rest.
          */}
          <ScrollableTable>
            <table className="w-full min-w-[866px] table-fixed border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[11.5px] uppercase tracking-wide text-grey-2">
                  <th scope="col" className="w-[132px] pb-2 pr-3 font-semibold">Item</th>
                  <th scope="col" className="w-[140px] px-1.5 pb-2 font-semibold">How it ships</th>
                  <th scope="col" className="w-[148px] px-1.5 pb-2 font-semibold">Ship via</th>
                  <th scope="col" className="w-[164px] px-1.5 pb-2 font-semibold">Separate invoice</th>
                  <th scope="col" className="w-[74px] px-1.5 pb-2 font-semibold">Qty</th>
                  <th scope="col" className="w-[104px] px-1.5 pb-2 font-semibold">Amount</th>
                  <th scope="col" className="w-[104px] px-1.5 pb-2 text-right font-semibold">Sub-total</th>
                </tr>
              </thead>
              <tbody>
          <ShipmentRow
            title="Print head"
            shown={show("headShipMode")}
            disabled={disabled}
            mode={draft.headShipMode}
            onMode={(v) => patch({ headShipMode: v })}
            via={draft.headShipVia}
            onVia={(v) => patch({ headShipVia: v })}
            showVia={show("headShipVia")}
            inv={draft.headSeparateInvoice}
            onInv={(v) => patch({ headSeparateInvoice: v })}
            showInvoiceLines={show("headInvoiceQty")}
            qty={draft.headInvoiceQty}
            onQty={(v) => patch({ headInvoiceQty: v })}
            amount={draft.headInvoiceAmount}
            onAmount={(v) => patch({ headInvoiceAmount: v })}
          />

          {/*
            ⚠ NOT the subsidized quantity and rate in Deal inclusions above.
              Those are ink the deal does NOT include, offered at a rate; this
              is ink that IS included and billed on its own document. The two
              are mutually exclusive by construction — that block needs
              `inclInk` false, this row needs it true — so they can never be on
              screen together.
          */}
          <ShipmentRow
            title="Ink"
            shown={show("inkShipMode")}
            disabled={disabled}
            mode={draft.inkShipMode}
            onMode={(v) => patch({ inkShipMode: v })}
            via={draft.inkShipVia}
            onVia={(v) => patch({ inkShipVia: v })}
            showVia={show("inkShipVia")}
            inv={draft.inkSeparateInvoice}
            onInv={(v) => patch({ inkSeparateInvoice: v })}
            showInvoiceLines={show("inkInvoiceQty")}
            qty={draft.inkInvoiceQty}
            onQty={(v) => patch({ inkInvoiceQty: v })}
            amount={draft.inkInvoiceAmount}
            onAmount={(v) => patch({ inkInvoiceAmount: v })}
          />

          <ShipmentRow
            title="Dryer"
            shown={show("dryerShipMode")}
            disabled={disabled}
            mode={draft.dryerShipMode}
            onMode={(v) => patch({ dryerShipMode: v })}
            via={draft.dryerShipVia}
            onVia={(v) => patch({ dryerShipVia: v })}
            showVia={show("dryerShipVia")}
            inv={draft.dryerSeparateInvoice}
            onInv={(v) => patch({ dryerSeparateInvoice: v })}
            showInvoiceLines={show("dryerInvoiceQty")}
            qty={draft.dryerInvoiceQty}
            onQty={(v) => patch({ dryerInvoiceQty: v })}
            amount={draft.dryerInvoiceAmount}
            onAmount={(v) => patch({ dryerInvoiceAmount: v })}
          />

          <ShipmentRow
            title="Spare parts"
            shown={show("sparesShipMode")}
            disabled={disabled}
            mode={draft.sparesShipMode}
            onMode={(v) => patch({ sparesShipMode: v })}
            via={draft.sparesShipVia}
            onVia={(v) => patch({ sparesShipVia: v })}
            showVia={show("sparesShipVia")}
            inv={draft.sparesSeparateInvoice}
            onInv={(v) => patch({ sparesSeparateInvoice: v })}
            showInvoiceLines={show("sparesInvoiceQty")}
            qty={draft.sparesInvoiceQty}
            onQty={(v) => patch({ sparesInvoiceQty: v })}
            amount={draft.sparesInvoiceAmount}
            onAmount={(v) => patch({ sparesInvoiceAmount: v })}
          />

          {/*
            ⚠ THIS IS NOT THE "External centering system" TICK in Options
              included. The client asked for the two to stay separate: that tick
              records whether the deal INCLUDES one, this row records how it
              SHIPS and how it is BILLED. Both read the machine's
              `opt_external_centering` capability, so a machine mapped "no" shows
              neither — 5 of the 28 machines can take one.
          */}
          <ShipmentRow
            title="Centering device"
            shown={show("centeringShipMode")}
            disabled={disabled}
            mode={draft.centeringShipMode}
            onMode={(v) => patch({ centeringShipMode: v })}
            via={draft.centeringShipVia}
            onVia={(v) => patch({ centeringShipVia: v })}
            showVia={show("centeringShipVia")}
            inv={draft.centeringSeparateInvoice}
            onInv={(v) => patch({ centeringSeparateInvoice: v })}
            showInvoiceLines={show("centeringInvoiceQty")}
            qty={draft.centeringInvoiceQty}
            onQty={(v) => patch({ centeringInvoiceQty: v })}
            amount={draft.centeringInvoiceAmount}
            onAmount={(v) => patch({ centeringInvoiceAmount: v })}
          />
              </tbody>
            </table>
          </ScrollableTable>
        </Card>

      <Card className="space-y-4 p-5">
        <h2 className="text-[15px] font-bold text-navy">
          Commercial terms <span className="text-[12px] font-normal text-grey-2">· section C</span>
        </h2>

        {/*
          ⚠ THE DEAL TYPE LEADS THE SECTION, because everything commercial follows
            from it: High Seas is always a dollar deal and carries NO GST; Others
            is taxed. It is the SAME `transport_terms` column the module has
            always had — relabelled, not replaced, so every existing row and every
            frozen version still reads correctly.
        */}
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldLabel
            label="Deal type"
            required={req.has("transportTerms")}
            anchor={FIELD_ANCHOR("transportTerms")}
          >
            <ChoiceButtons
              value={draft.transportTerms}
              onChange={(v) =>
                // ⚠ PICKING HIGH SEAS SETS THE CURRENCY HERE, NOT ONLY ON SAVE.
                //   fms_ocpi_write_quotation already forces USD server-side, but
                //   it only runs on save — so the draft kept saying "INR", the
                //   currency box sat greyed out reading rupees under a note
                //   promising dollars, and the FX block never appeared. That left
                //   no way to enter a rate on the one deal type that is ALWAYS in
                //   dollars, and a rate-less USD deal prints a blank total on both
                //   papers. Setting it here makes the screen tell the truth
                //   immediately; the server still has the last word.
                patch(
                  v === "high_seas"
                    ? { transportTerms: v, dealValueCurrency: "USD" }
                    : { transportTerms: v },
                )
              }
              options={optsKV(TRANSPORT_TERMS)}
              disabled={disabled}
              ariaLabel="Deal type"
            />
          </FieldLabel>
          {show("highSeasVia") && (
            <FieldLabel
              label="High seas delivery via"
              required={req.has("highSeasVia")}
              anchor={FIELD_ANCHOR("highSeasVia")}
            >
              <ChoiceButtons
                value={draft.highSeasVia}
                onChange={(v) => patch({ highSeasVia: v })}
                options={opts(HIGH_SEAS_VIA)}
                clearable
                disabled={disabled}
                ariaLabel="High seas delivery via"
              />
            </FieldLabel>
          )}
          {show("highSeasCostBy") && (
            <FieldLabel
              label="High seas cost borne by"
              required={req.has("highSeasCostBy")}
              anchor={FIELD_ANCHOR("highSeasCostBy")}
            >
              <ChoiceButtons
                value={draft.highSeasCostBy}
                onChange={(v) => patch({ highSeasCostBy: v })}
                options={optsKV(COST_BEARERS)}
                clearable
                disabled={disabled}
                ariaLabel="High seas cost borne by"
              />
            </FieldLabel>
          )}
          {show("localCostBy") && (
            <FieldLabel
              label="Local delivery cost borne by"
              hint="transport, clearance, loading / unloading"
              required={req.has("localCostBy")}
              anchor={FIELD_ANCHOR("localCostBy")}
            >
              <ChoiceButtons
                value={draft.localCostBy}
                onChange={(v) => patch({ localCostBy: v })}
                options={optsKV(COST_BEARERS)}
                clearable
                disabled={disabled}
                ariaLabel="Local delivery cost borne by"
              />
            </FieldLabel>
          )}
        </div>

        {isHighSeas && (
          <p className="rounded-lg border border-line bg-[#FBFCFE] px-3 py-2 text-[12.5px] text-grey">
            A high seas sale is in <span className="font-medium text-navy">US dollars</span> and carries{" "}
            <span className="font-medium text-navy">no GST</span>. Both are set for you, and the papers
            print no tax line at all.
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <FieldLabel
            label="Currency"
            required={req.has("dealValueCurrency")}
            anchor={FIELD_ANCHOR("dealValueCurrency")}
            hint={isHighSeas ? "fixed by the deal type" : undefined}
          >
            <ChoiceButtons
              value={draft.dealValueCurrency}
              onChange={(v) => patch({ dealValueCurrency: v })}
              options={opts(CURRENCIES)}
              disabled={disabled || isHighSeas}
              ariaLabel="Currency"
            />
          </FieldLabel>
          {/*
            ⚠ ALWAYS TWO COLUMNS NOW (OCPI-29). This used to widen only when the
              GST box was hidden — `show("gstRate") ? undefined : "sm:col-span-2"`
              — because the box was the third cell of a three-column grid. The box
              is gone on every deal, so the condition is dead and the class is
              unconditional. The grid still reads currency (1) + value (2) = 3.
          */}
          <div className="sm:col-span-2">
            <FieldLabel
              label="Total deal value (excluding GST)"
              required={req.has("dealValueAmount")}
              anchor={FIELD_ANCHOR("dealValueAmount")}
              // ⚠ THE RATE IS NOT A COPY — it is read from the config row that
              //   governs it. The caption says "excluding GST" and the rate is no
              //   longer on screen anywhere, so without this the salesperson is
              //   told what the figure excludes and never what will be added.
              hint={show("gstRate") ? `GST at ${s.config.defaultGstRate}% is added on the papers` : undefined}
            >
              <TextInput
                inputMode="decimal"
                value={draft.dealValueAmount}
                onChange={(e) => patch({ dealValueAmount: e.target.value.replace(/[^\d.]/g, "") })}
                placeholder="Figures only"
                disabled={disabled}
              />
            </FieldLabel>
          </div>
          {/*
            🔴 THE GST % BOX IS GONE (OCPI-29, 02-09-2026) — THE QUESTION, NOT THE
               VALUE. It was 18 on all 25 deals that carry a rate and has never
               been anything else, so asking it on every quotation only invited a
               typo into a tax figure. `fms_ocpi_config.default_gst_rate` is now
               the single source, settled as developer-only; there is no admin
               screen for it and none is wanted.

            🔴 THE DRAFT STILL CARRIES `gstRate` AND THE PAYLOAD STILL SENDS
               `gst_rate`, AND THAT IS NOT LEFTOVER. `fms_ocpi_write_oc` derives
               the tax from the PAYLOAD — `nullif(p->>'gst_rate','')::numeric` —
               so a form that stopped sending it would derive a null amount, drop
               the tax row from both papers and understate every Others total by
               18%, with nothing on screen to notice. See `withGstRate` in
               useQuotationDraft, which guarantees the rate is there.

            ⚠ THE HIGH SEAS BRANCH SURVIVES INTACT, and it is the reason this is
              not simply "default everything to 18". `branching.ts` still hides
              `gstRate` on a high seas sale, `clearHidden` still blanks it, the
              server still stores NULL and BOTH renderers still omit the tax row —
              `quotationPdf.ts` and `ocPdf.ts` alike. A high seas sale attracts no
              GST at all, and a row reading "0% GST — ₹ 0" is a different legal
              claim from no row. `show("gstRate")` above is what keeps the hint
              off such a deal.

            ⚠ NOTHING IS LEFT AS A RULED BLANK. `{{gst_rate}}` stays registered in
              tokens.ts but is used by ZERO machine templates — checked against
              fms_ocpi_machine_sections — so unlike delivery_days (OCPI-18) there
              is no clause waiting for it.
          */}
        </div>

        {/*
          ⚠ THE RATE IS A STARTING POINT, NEVER A LOCK. Deals are negotiated at an
            agreed rate; showing the live one instead would misstate the contract.

          ⚠ THE RATE IS TYPED, NEVER FETCHED (client's instruction, 29-Aug-2026).
            A "Get live rate" button used to sit here and fill the box from an FX
            service. It went because a market rate offered as the default invites
            somebody to accept it and misstate the contract. `fetchFxRate`
            survives in shared/lib/fx for the Import app, which quotes against the
            market and genuinely wants it.

          ⚠ THE THREE fxRate* COMPANION FIELDS ARE STILL WRITTEN — source
            "manual", the moment it was typed, overridden = true. They are stored
            columns frozen onto every revision and read by the part-B key sniff in
            `fms_ocpi_save_draft`; dropping them from the payload would silently
            stop the write.

            Whichever rate is used is frozen onto the revision when the quotation
            is generated, so a paper keeps the arithmetic it was issued under.
        */}
        {show("fxRate") && (
          <div className="space-y-2 rounded-lg border border-line bg-[#FBFCFE] p-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[9rem]">
                <FieldLabel
                  label="USD → INR rate"
                  required={req.has("fxRate")}
                  anchor={FIELD_ANCHOR("fxRate")}
                >
                  <TextInput
                    inputMode="decimal"
                    value={draft.fxRate}
                    onChange={(e) =>
                      patch({
                        fxRate: e.target.value.replace(/[^\d.]/g, ""),
                        fxRateOverridden: true,
                        fxRateSource: "manual",
                        fxRateAt: new Date().toISOString(),
                      })
                    }
                    placeholder="e.g. 87.4250"
                    disabled={disabled}
                  />
                </FieldLabel>
              </div>
              {inrEquivalent && (
                <p className="pb-2 text-[13px] text-grey">
                  ≈ <span className="font-semibold text-navy">{inrEquivalent}</span>
                </p>
              )}
            </div>
            <p className="text-[12px] text-grey-2">
              {draft.fxRate
                ? "This is the rate the papers will use."
                : "Type the rate you agreed with the customer."}
            </p>
          </div>
        )}

        {/*
          ── Delivery, moved up from "Delivery & tax" (OCPI-3, stage G) ─────────

          ⚠ WHAT USED TO BE FOUR FIELDS HERE IS NOW TWO (OCPI-18, 01-Sep-2026),
            and each of the two that went was accounted for before it went — the
            FIX-4 rule in CLAUDE.md, applied to a pair of controls rather than a
            container:

              · Type of payment (Any Advance / On Credit) → REMOVED outright. Its
                "Term of Payment" row left the summary sheet with it, which the
                client asked for knowingly: "Terms of payment" below is the
                free-text box that carries the real answer and prints on both
                papers. Its `missingForSubmit` entry AND the matching
                `payment_type is not null` conjunct of the SQL check went at the
                same time — removing only one of the two would have left the
                database demanding an answer the form had stopped asking for.

              · Delivery days → REMOVED, but NOT by deletion. `{{delivery_days}}`
                was live in the SALE CONDITIONS OF THE SUPPLY clause of 21 of the
                28 machine decks, so deleting the field alone would have printed
                "Delivery Days: ________" in the delivery clause of a signed
                contract. Migration 20261102120000 rewrote all 21 sections to
                carry the delivery DATE and its condition instead — which is the
                same edit the client's fourth request asked for. Its token, its
                TOKEN_HELP entry, its Deal Register column and its
                `missingForDetailSheet` warning went with it.

            Both COLUMNS stay, and both values still round-trip: see the notes on
            `paymentType` and `deliveryDays` in fieldSpec.ts.

          ⚠ THE DELIVERY TERM STAYS — SETTLED WITH THE CLIENT, 29-Aug-2026, and
            recorded here because the instruction that came first said the
            opposite. It was originally to be removed, on the reasoning that the
            route is "already covered in commercial terms". Checking that turned
            up why it is not:

              · `{{trade_term}}` is written into the SALE CONDITIONS OF THE
                SUPPLY clause of ALL TEN machine templates, as "Delivery Terms:
                {{trade_term}}". An unresolved token prints a ruled blank by
                design, so removing the field would have printed "Delivery Terms:
                ________" on every detailed sheet.

              · It is the ONLY delivery route an ordinary deal records anywhere.
                Commercial terms asks "delivered via" on a HIGH SEAS deal alone,
                so an "Others" deal answers nothing else about the route — and 11
                of the 12 ordinary deals on record had filled this in.

              · The two papers were never saying the same thing anyway. The
                SUMMARY sheet's "Term of Delivery" is built from the deal type
                and who bears the cost ("Local Delivery · cost by Customer"); the
                CONTRACT's "Delivery Terms" is this field ("Ex-Work Surat"). Two
                different facts under two similar headings, on two papers.

            Do not remove this without re-reading the above. Stage J.2 is closed
            as "no change", not as "not done yet".
        */}
        <div className="grid gap-3 sm:grid-cols-2">
          {/*
            ⚠ THE REMARK IS OUTSIDE `FieldLabel`, which renders a <label>. Text
              inside it is part of the label, so a click anywhere on the sentence
              would open the date picker — and the sentence is a statement about
              the contract, not a prompt to fill anything in. Same reason the
              payment-format hint below sits outside its own label.

            ⚠ AND IT IS THE SAME SENTENCE THE CONTRACT CARRIES, from one const.
              It is written into all 21 SALE CONDITIONS sections and printed on
              the summary sheet; if the screen and the paper worded the delivery
              condition differently, a customer would have two answers to which
              one governs. See DELIVERY_DATE_REMARK in fieldSpec.ts.
          */}
          <div>
            <FieldLabel
              label="Tentative machine delivery date"
              required={req.has("deliveryDate")}
              anchor={FIELD_ANCHOR("deliveryDate")}
            >
              <TextInput
                type="date"
                value={draft.deliveryDate}
                onChange={(e) => patch({ deliveryDate: e.target.value })}
                disabled={disabled}
              />
            </FieldLabel>
            <p className="mt-1 text-[12px] text-grey-2">{DELIVERY_DATE_REMARK}</p>
          </div>
          {/*
            ⚠ BUTTONS, NOT A DROPDOWN (OCPI-26, asked for by Ritesh Bhai). Four
              options from a FIXED list in code, so the strip shows every answer
              without opening anything. `searchable` was never on it and the
              placeholder goes with the dropdown; `clearable` is kept, because
              the field is optional — it sits in `DETAIL_SHEET_FIELDS`, which
              WARNS about a blank and never blocks one.

            🔴 `optsWithCurrent`, NOT `opts`, AND THAT IS NOT DEFENSIVE CODING —
               one deal on record carries "CIF Jebel Ali", which is not one of
               the four. `ChoiceButtons` renders a value it cannot match as
               nothing selected, and a single ↓ on the tabbed-to strip would
               then overwrite a term that prints on a signed contract. See the
               helper for the whole failure.

            🔴 THIS CHANGES THE CONTROL AND NOTHING ELSE. `{{trade_term}}` is
               live in the SALE CONDITIONS clause — "Transport Terms: …" — of 21
               machine templates, and `fms_ocpi_write_oc` stores it verbatim.
               The stored value, the payload key and the token are untouched.
          */}
          <FieldLabel label="Delivery term" hint="prints on the contract">
            <ChoiceButtons
              value={draft.tradeTerm}
              onChange={(v) => patch({ tradeTerm: v })}
              options={optsWithCurrent(TRADE_TERMS, draft.tradeTerm)}
              clearable
              disabled={disabled}
              ariaLabel="Delivery term"
            />
          </FieldLabel>
        </div>
        {/*
          ⚠ THE FORMATS ARE A LIST UNDER THE BOX, NOT A PLACEHOLDER (OCPI-20,
            extended to seven by OCPI-30). A placeholder was already here and did
            not work: it vanishes the moment anybody types, so a salesperson
            editing a saved draft never saw it at all. Twelve different wordings
            across 24 deals came out of that box — including one whose payment
            terms are the word "na".

          ⚠ SEVEN SENTENCES IN FULL, NOT A MENU. One click to insert is what made
            OCPI-20 work, and a menu costs a second click to open. Printing them
            in full is also the fix for the actual defect: people were retyping
            from memory, which is why two pairs of deals differ only by a typo.

          ⚠ THE FIELD STAYS FREE TEXT. No dropdown, no advance-% field, no new
            column — `payment_terms` is one column feeding `{{payment_terms}}` on
            21 templates, and a negotiated deal must still be able to say
            something else. These are starting points, not a vocabulary.

          ⚠ THE HINT AND BUTTONS SIT OUTSIDE `FieldLabel`, which renders a <label>.
            A <button> inside it would focus the textarea on every click, so the
            confirm step would fight the caret.
        */}
        <FieldLabel
          label="Terms of payment"
          required={req.has("paymentTerms")}
          anchor={FIELD_ANCHOR("paymentTerms")}
        >
          <TextArea
            rows={2}
            value={draft.paymentTerms}
            onChange={(e) => {
              patch({ paymentTerms: e.target.value });
              // Typing answers the question the confirm was asking.
              setPendingFormat(null);
            }}
            placeholder={PAYMENT_TERMS_FORMATS[0]}
            disabled={disabled}
          />
        </FieldLabel>
        {/* `-mt-2`: the Card is `space-y-4`, so the list has to be pulled back to
            hug the field it describes — same as Special remarks below. */}
        <div className="-mt-2 space-y-1">
          {/*
            ⚠ THE HINT NAMES NO FORMAT (OCPI-30). It used to read "House format:
              …" and quote the single one. With seven, naming one would contradict
              the six beneath it, so it points at the list instead.
          */}
          <p className="text-[12px] text-grey-2">
            {disabled
              ? "Common formats"
              : "Common formats — click one to insert, then fill the blanks."}
          </p>
          {!disabled && (
            <ul className="space-y-0.5">
              {PAYMENT_TERMS_FORMATS.map((format) => (
                <li key={format}>
                  {pendingFormat === format ? (
                    /*
                      ⚠ THE OVERWRITE GUARD, KEPT FROM OCPI-20 AND NOW PER-ROW. It
                        must never silently replace text a salesperson has typed —
                        that text is a negotiated commercial term. The confirm
                        replaces the row it belongs to, so the sentence being
                        offered stays in front of the person deciding.
                    */
                    <span className="flex flex-wrap items-baseline gap-2 text-[12px]">
                      <span className="text-grey-2">Replace what is typed?</span>
                      <button
                        type="button"
                        onClick={() => {
                          patch({ paymentTerms: format });
                          setPendingFormat(null);
                        }}
                        className="font-semibold text-orange underline underline-offset-2"
                      >
                        Replace
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingFormat(null)}
                        className="text-grey-2 underline underline-offset-2 hover:text-ink"
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        // An empty box has nothing to lose, so it fills on the
                        // first click. Anything typed asks first.
                        if (!draft.paymentTerms.trim()) patch({ paymentTerms: format });
                        else setPendingFormat(format);
                      }}
                      className="text-left text-[12px] text-grey-2 underline decoration-transparent underline-offset-2 transition hover:text-orange hover:decoration-current"
                    >
                      {format}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <h2 className="text-[15px] font-bold text-navy">
          Special remarks <span className="text-[12px] font-normal text-grey-2">· section D</span>
        </h2>

        {/*
          ⚠ ONE BOX (OCPI-3, stage H). It was three: the master form scattered its
            free text across Q23 (balance heads), Q43 (other commitments) and Q46
            (remarks) under three unrelated headings, and the revision gathered
            them into one section. The client has now removed the other two
            outright — there is ONE place a note goes, and it is this one.

            Their COLUMNS remain, additive-only, and any deal that already holds
            text still shows it below and still prints it. Nothing new can be
            entered into either.

          ⚠ AND IT PRINTS ON THE SUMMARY SHEET ONLY. The hint here used to say
            "prints on both sheets" and that was simply false: there is no
            remarks path in ocPdf.ts and no `{{remarks}}` token, so no machine
            template can reference it either. A salesperson writing a delivery
            caveat here, believing it reached the contract, would have been
            wrong.
        */}
        <FieldLabel
          label="Special remarks"
          hint="prints on the summary sheet — anything else ABOUT the deal; for what is included IN it, use Other inclusions in section B"
        >
          <TextArea
            rows={5}
            value={draft.remarks}
            onChange={(e) => patch({ remarks: e.target.value })}
            placeholder={"One point per line, e.g.\n1. Installation within 15 days of dispatch\n2. Warranty on the dryer: 6 months, by exception"}
            disabled={disabled}
          />
        </FieldLabel>
        <p className="-mt-2 text-[12px] text-grey-2">
          Enter remarks <b className="text-navy">point by point, one to a line</b> — line breaks come
          through onto the paper exactly as typed. Anything that differs from the standard terms goes
          here, including a warranty exception.
        </p>

        {/*
          ⚠ RETIRED BOXES, SHOWN READ-ONLY WHEN THEY HOLD SOMETHING. 13 of the 18
            deals on record carry balance-head remarks and 14 carry other
            commitments. Deleting the inputs outright would leave that text
            printing on a regenerated paper with no trace of it anywhere on the
            screen — a salesperson would find a line on the contract they could
            not locate in the form. So the value stays visible, is labelled as
            retired, and says where to put it instead.

            A deal with nothing in them shows nothing at all, which is every new
            quotation from here on.
        */}
        {(draft.headBalanceRemarks.trim() || draft.otherCommitments.trim()) && (
          <div className="space-y-2 rounded-lg border border-line bg-[#FBFCFE] px-3 py-2.5">
            <p className="text-[12px] text-grey-2">
              These two boxes have been <b className="text-navy">retired</b>. What this deal already
              recorded is kept and still prints; to change any of it, write the new wording into
              Special remarks above.
            </p>
            {draft.headBalanceRemarks.trim() && (
              <div>
                <div className="text-[11.5px] font-medium text-ink">
                  Balance heads to be sold later
                </div>
                <p className="whitespace-pre-wrap text-[12.5px] text-grey">
                  {draft.headBalanceRemarks}
                </p>
              </div>
            )}
            {draft.otherCommitments.trim() && (
              <div>
                <div className="text-[11.5px] font-medium text-ink">Any other commitments</div>
                <p className="whitespace-pre-wrap text-[12.5px] text-grey">
                  {draft.otherCommitments}
                </p>
              </div>
            )}
          </div>
        )}

        {/*
          ⚠ A DOLLAR TERM, ASKED ONLY OF DOLLAR DEALS. It used to be asked on
            every quotation, including rupee ones it cannot apply to — and the
            answer printed. `fms_ocpi_write_quotation` clears it on a non-USD
            deal, so switching currency cannot leave a stale "Yes" behind.
        */}
        {show("dollarClauseAgreed") && (
          <div className="rounded-lg border border-line bg-[#FBFCFE] p-3">
            <p className="text-[12.5px] leading-relaxed text-grey">{DOLLAR_CLAUSE}</p>
            <div className="mt-2">
              <YesNo
                label="Agreed with the customer"
                value={draft.dollarClauseAgreed}
                onChange={(v) => patch({ dollarClauseAgreed: v })}
                disabled={disabled}
              />
            </div>
          </div>
        )}
      </Card>

      {/*
        ═══ THE DETAILED SHEET'S OWN QUESTIONS ═══════════════════════════════
        Everything below was a SECOND FORM until the revision: the order
        confirmation was filled in later, at its own step, from its own screen.
        The client asked for one form, so it lives here.

        ⚠ EVERY FIELD BELOW IS OPTIONAL, DELIBERATELY. A quotation goes out
          during a negotiation, often before the warranty and delivery terms are
          settled. Anything left blank prints as a ruled blank on the detailed
          sheet, and the editor names those lines before the salesperson sends
          anything — see `missingForDetailSheet`. None of it blocks.
      */}
      <Card className="space-y-4 p-5">
        <div>
          <h2 className="text-[15px] font-bold text-navy">Document details</h2>
          <p className="mt-0.5 text-[12.5px] text-grey">
            Only the detailed sheet needs these. Leave any of them blank for now — the sheet prints a
            ruled blank, and you will be told which lines are empty before you send it.
          </p>
        </div>

        <div className="space-y-3">
          <h3 className="text-[13px] font-semibold text-ink">Warranty &amp; service</h3>
          {/*
            🔴 WARRANTY IS PER MACHINE AGAIN, AND THERE ARE THREE OF THEM
               (OCPI-14). It had become fixed company policy — one setting, one
               machine figure and one head figure, applied to all 28 models. The
               client's 01-09 sheet gives all three per model and shows why the
               single figure was wrong: 15 of the 28 carry NO head warranty at
               all, so Settings was quoting 18 months on fifteen models that
               offer none.

            🔴 BLANK MEANS NOT APPLICABLE, NOT "UNANSWERED". A machine whose
               master value is NULL does not show the question here and prints no
               line on either paper. That is why these are read-outs and not
               required fields: the answer belongs to the model.

            ⚠ SPARE PARTS HAS NO WARRANTY AND NO BOX, and its absence is a
              finding rather than an omission — column S of the client's sheet
              reads "NA" on all 28 rows.

            ⚠ THE FIGURES ARE PREFILLED BY `chooseMachine`, NEVER BY AN EFFECT —
              the same rule the head and the model number follow. A deal quoted
              before this existed keeps what it recorded until somebody
              deliberately changes its machine.

            ⚠ THE SETTING SURVIVES as the fallback for a model with no value of
              its own, so Settings → Warranty periods is not orphaned.
          */}
          <div className="grid gap-3 sm:grid-cols-3">
            <FieldLabel label="Machine warranty" hint="from the machine master">
              <WarrantyReadout value={draft.printerWarranty} hasMachine={!!chosenMachine} />
            </FieldLabel>
            <FieldLabel label="Print-head warranty" hint="from the machine master">
              <WarrantyReadout value={draft.headWarranty} hasMachine={!!chosenMachine} />
            </FieldLabel>
            {show("dryerWarranty") && (
              <FieldLabel label="Dryer warranty" hint="from the machine master">
                <WarrantyReadout value={draft.dryerWarranty} hasMachine={!!chosenMachine} />
              </FieldLabel>
            )}
          </div>
          {/*
            ⚠ THE LINE THE CLIENT ASKED FOR, IN ONE PLACE. It is stored in
              `fms_ocpi_config.warranty_note` rather than compiled in, because it
              is a clause on a customer's contract and rewording one should not
              need a deploy. The same sentence is printed by both PDFs from the
              same key, so the screen and the paper cannot drift apart.
          */}
          <div className="rounded-lg border border-line bg-[#FBFCFE] px-3 py-2.5">
            <p className="text-[12.5px] leading-relaxed text-grey">{s.config.warrantyNote}</p>
            <p className="mt-1 text-[12px] text-grey-2">
              This prints below the warranty on both papers. If this deal needs something different,
              write it into Special remarks above.
            </p>
          </div>

          {/*
            ⚠ "Head price after the warranty" IS GONE (OCPI-3, stage J.1), and it
              went in the right ORDER, which was the whole difficulty.

              `{{post_warranty_head_price}}` was written into the PRINT HEAD
              POLICY PROGRAM clause of four machines — Homer K24, Homer K32, P8D
              and P8S — as "a New Print Head will be priced at INR {{…}} plus
              GST". An unresolved token renders as a ruled blank by design, so
              deleting this field first would have printed "priced at INR
              ________ plus GST" on every contract for those machines.

              The clause was reworded first (migration
              20261021150000, client-approved 29-Aug-2026) to "replacement print
              heads will be supplied at the prices prevailing at the time of
              purchase" — a sentence that needs no figure. Zero templates use the
              token now; verified before this field was removed.

              The COLUMN stays, additive-only, so deals raised before this keep
              what they recorded. Nothing reads it.
          */}
          {/*
            ⚠ THE COMMENT ABOVE IS ABOUT THE HEAD-PRICE FIELD, NOT THIS ONE. Its
              closing line — "Zero templates use the token now" — has been read as
              applying here at least once. It does not.

            🔴 `{{consumables_supplier}}` IS LIVE ON 12 MACHINE TEMPLATES, inside
               the WARRANTY section: "Consumable items: To be purchased directly
               from M/s {{consumables_supplier}}." Fab Pro 1I/2I/3I, Kolorado Alpha
               15/16, KoloRado Alpha 3 — 12 heads, Alpha 3.2 — 8/24 heads, Alpha II
               ×3, and MP5000. The COLUMN, the TOKEN and those 12 templates all
               stay exactly as they are.

            ⚠ SHOWN, NEVER TYPED (OCPI-19). Every deal gave the same answer, spelled
              two ways, so the question became a statement. It is a read-out and not
              a `disabled` TextInput for the reason `WarrantyReadout` gives above: a
              greyed-out box reads as temporarily unavailable and invites "why can't
              I type here", where a read-out reads as an answer.

            ⚠ IT RENDERS THE DRAFT, NOT THE CONSTANT. A deal raised before this
              recorded its own wording and must keep showing it — the value on the
              deal is what its contract prints. `draftFromDeal` supplies the
              constant when a deal stored nothing, so this can never be blank.
          */}
          <FieldLabel label="Consumables to be bought from">
            <div className="flex min-h-9 items-center rounded-lg border border-line bg-page px-3 py-2 text-[13px] text-navy">
              {draft.consumablesSupplier}
            </div>
          </FieldLabel>
          <div className="rounded-lg border border-line bg-[#FBFCFE] p-3">
            <p className="text-[12.5px] leading-relaxed text-grey">{INSURANCE_CLAUSE}</p>
            <div className="mt-2">
              <YesNo
                label="Agreed with the customer"
                value={draft.insuranceClauseAgreed}
                onChange={(v) => patch({ insuranceClauseAgreed: v })}
                disabled={disabled}
              />
            </div>
          </div>
        </div>

        {/*
          ⚠ THE "Delivery & tax" BLOCK IS GONE (OCPI-3, stage G). It held THREE
            controls and every one of them was accounted for before it went —
            the client's instruction named only the first:

              · Delivery term  → MOVED to Commercial terms. Asked to be removed;
                                 cannot go until stage J corrects the clause on
                                 all ten templates. Kept, labelled, reachable.
              · Delivery days  → MOVED to Commercial terms, beside the delivery
                                 date. Explicitly asked for by the client.
              · GST %          → MOVED to Commercial terms, beside the deal value
                                 it completes. NOT mentioned in any instruction;
                                 it merely shared the box. Deleting it with the
                                 block would have taxed every deal at the 18%
                                 default for ever with no way to change it — and
                                 nothing would have looked broken.

            That last one is why this comment exists. "Most of this is redundant"
            is not a finding about the rest of it; see the FIX-4 rule in
            CLAUDE.md, which this block is now an example of going right.

            ⚠ AND THE GST % BOX HAS SINCE GONE ANYWAY (OCPI-29, 02-09-2026) — but
              asked for by name, and on the opposite reasoning to the accident
              above. What made deleting it in stage G a mistake was that the rate
              would have become unchangeable by anybody; what makes removing it
              now correct is that `fms_ocpi_config.default_gst_rate` is a real,
              deliberate single source, the draft still carries the value, and the
              payload still sends it. The stage-G lesson is unchanged: an
              accidental deletion and a chosen one are not the same act.
        */}

        {/*
          ⚠ "The head" BLOCK IS GONE FROM HERE (OCPI-3, stage F), moved rather
            than deleted. Its three questions — how to ship, the route, separate
            invoice — now sit in the **Shipment & invoice** card above, beside
            the dryer, the spare parts and the centering device, which ask the
            same things. Two questions were ADDED to each while moving:
            quantity and amount excluding tax, asked only of a separate invoice.

            Nothing was stranded: `headBalanceRemarks` was never in this block
            (it lives with Special remarks, and stage H decides its fate), and
            `HEAD_SHIP_MODES` / `HEAD_SHIP_VIA` are now read by all four rows.
        */}

        <div className="space-y-3 border-t border-line pt-4">
          <h3 className="text-[13px] font-semibold text-ink">Sign-off</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <FieldLabel label="Reference no." hint="the customer's own reference, if they have one">
              <TextInput
                value={draft.refNo}
                onChange={(e) => patch({ refNo: e.target.value })}
                disabled={disabled}
              />
            </FieldLabel>
            <FieldLabel label="Manufacturer's model no." hint="pre-filled from the machine's template">
              <TextInput
                value={draft.machineModelNo}
                onChange={(e) => patch({ machineModelNo: e.target.value })}
                disabled={disabled}
              />
            </FieldLabel>
            <FieldLabel label="Prepared by">
              <TextInput
                value={draft.preparedBy}
                onChange={(e) => patch({ preparedBy: e.target.value })}
                disabled={disabled}
              />
            </FieldLabel>
            <FieldLabel label="Approved by">
              <TextInput
                value={draft.approvedBy}
                onChange={(e) => patch({ approvedBy: e.target.value })}
                disabled={disabled}
              />
            </FieldLabel>
          </div>
        </div>
      </Card>
      <RequestMasterModal
        open={!!ask}
        onClose={() => setAsk(null)}
        masterType={ask?.type ?? null}
        lockType
        prefillName={ask?.name}
        stacked
        /*
          ⚠ NO `dryer_type` BRANCH HERE, and its absence is deliberate rather
            than an omission. It existed for one turn, to put a requested
            category straight onto the deal — then the "+ Other" button that
            raised it was removed at the client's request (01-Sep-2026), leaving
            nothing in this form that can open the modal for a dryer category.
            A handler for a trigger that no longer exists is exactly the orphan
            FIX-4 is about, so it went with the button.
        */
        onRequested={(type, name) => {
          if (type === "machine") setMachineAsked(name);
        }}
      />

    </div>
  );
}
