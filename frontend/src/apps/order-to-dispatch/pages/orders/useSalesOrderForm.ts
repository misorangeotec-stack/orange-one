import { useMemo, useState } from "react";
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import { useDispatchStore, type DispatchStoreValue } from "../../store";
import { isLineBlank, makeEmptyLine, type OrderLineRow } from "../../components/OrderLinesGrid";
import type { MasterValues } from "../../lib/masterFields";
import type { OrderInput } from "../../data/dispatchWrites";
import type { DispatchMasterType, DispatchOrder, DispatchType } from "../../types";

/**
 * Shared form state for New Order and Edit Order.
 *
 * The order states WHO is buying, WHERE it goes, WHO bills it, and what is going
 * out. The company sits here rather than at the stock check because the person
 * raising the order is the one who knows the answer — and because asking it per
 * round let a single order bill two different entities.
 */
export interface SalesOrderFormState {
  dispatchType: DispatchType;
  companyId: string;
  /** OUR site the goods leave from. Not `customerLocation` — see the types file. */
  locationId: string;
  customerId: string;
  customerLocation: string;
  customerPoNo: string;
  orderDate: string;
  orderRemarks: string;
}

/**
 * Which half of the intake form asked for a master, so the answer ("Requested
 * …") lands next to the picker that raised it rather than a card away.
 */
export type RaiseOrigin = "header" | "lines";

/**
 * What the Item type field starts on when the customer has it (OD-10).
 *
 * ⚠ ONE WORD, and it is exact rather than a family. MS-1's vocabulary holds
 *   three ink words — `ink`, `provision_ink`, `other_ink` — but not one mapped
 *   item uses the other two, so "Ink" has a single unambiguous meaning here.
 *   Should that change, this is the constant to widen, not the call sites.
 */
export const DEFAULT_ITEM_TYPE = "ink";

/** A master the intake form is missing — handed straight to RequestMasterModal. */
export interface MasterRaise {
  mt: DispatchMasterType;
  /** What the form already knows: the typed name, and the parent it was typed under. */
  prefill: MasterValues;
  from: RaiseOrigin;
}

const emptyState = (): SalesOrderFormState => ({
  dispatchType: "local",
  companyId: "",
  locationId: "",
  customerId: "",
  customerLocation: "",
  customerPoNo: "",
  orderDate: todayLocalIso(),
  orderRemarks: "",
});

/**
 * A new order, pre-filled with whatever the person's assignment leaves no choice
 * about.
 *
 * Someone who dispatches from one site should not be asked which site every time
 * — a question with one possible answer is not a question. Where the assignment
 * genuinely leaves a choice, nothing is guessed and both fields stay empty.
 *
 * ⚠ Runs ONCE, from a lazy `useState`. Both callers now mount this form only
 *   after `store.isLoading` clears (see NewOrder / EditOrder); mounting it any
 *   earlier reads empty master lists and seeds nothing, for ever.
 */
const seededState = (s: DispatchStoreValue): SalesOrderFormState => {
  const base = emptyState();
  const companies = s.assignedCompanies();
  if (companies.length !== 1) return base;
  const companyId = companies[0]!.id;
  const sites = s.assignedLocationsForCompany(companyId);
  return { ...base, companyId, locationId: sites.length === 1 ? sites[0]!.id : "" };
};

const stateFromOrder = (o: DispatchOrder): SalesOrderFormState => ({
  dispatchType: o.dispatchType,
  companyId: o.companyId ?? "",
  locationId: o.locationId ?? "",
  customerId: o.customerId,
  customerLocation: o.customerLocation ?? "",
  customerPoNo: o.customerPoNo ?? "",
  orderDate: o.orderDate?.slice(0, 10) ?? todayLocalIso(),
  orderRemarks: o.orderRemarks ?? "",
});

const linesFromOrder = (o: DispatchOrder): OrderLineRow[] =>
  o.lines.map((l) => ({
    uid: `l${l.id}`,
    itemId: l.itemId,
    quantity: String(l.quantity ?? ""),
    lineRemark: l.lineRemark ?? "",
  }));

export function useSalesOrderForm(existing?: DispatchOrder) {
  const s = useDispatchStore();
  const [form, setForm] = useState<SalesOrderFormState>(() =>
    existing ? stateFromOrder(existing) : seededState(s),
  );
  const [lines, setLines] = useState<OrderLineRow[]>(() =>
    existing ? [...linesFromOrder(existing), makeEmptyLine()] : [makeEmptyLine()],
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /*
    THE MASTER A PICKER COULD NOT OFFER. Every dropdown on this form can raise the
    master behind it — the customer, the billing company, our dispatch site, the
    item — instead of leaving the person mid-order with nothing to choose. The
    request goes to that master's owner; nothing is added here.
  */
  const [raise, setRaise] = useState<MasterRaise | null>(null);
  const [requested, setRequested] = useState<{ from: RaiseOrigin; text: string } | null>(null);

  /*
    THE ITEM PICKER NO LONGER RAISES A REQUEST — it opens the mapping modal
    (OD-9). An item a customer cannot order is almost never missing from Tally;
    it is merely unmapped, and the person looking at the screen is the one who
    knows it belongs there. So this is a different kind of state from `raise`:
    nothing is being ASKED for, and there is no owner to wait on.

    It carries the text that was typed, because the modal's empty state needs it:
    "not in this company's book" and "not in Tally at all" are different answers
    and only the typed term can tell the reader which one they are looking at.
  */
  const [mapping, setMapping] = useState<{ search: string } | null>(null);

  /**
   * THE ITEM TYPE THE LINES ARE BEING PICKED FROM (OD-10).
   *
   * ⚠ NOT PART OF `form`, and not saved with the order. It narrows the item
   *   picker and nothing else — no column, no payload, nothing to backfill. The
   *   thing OD-7 wants stored is the receivables SALE type, which is a different
   *   vocabulary and a different decision; keeping this out of `form` is what
   *   stops the two quietly becoming one.
   *
   * "" means every type. It is set to `ink` when the chosen customer has any,
   * and left blank when they do not — 112 of the 789 mapped customers buy no ink
   * at all, and defaulting them to an empty item box would be worse than asking.
   */
  const [itemType, setItemType] = useState("");

  const patch = (next: Partial<SalesOrderFormState>) => setForm((f) => ({ ...f, ...next }));

  /**
   * Picking a customer.
   *
   * ⚠ CHANGING IT CLEARS THE LINES. The item picker is scoped to the customer's
   *   mapped items, so items chosen for the previous customer are not necessarily
   *   orderable by this one — and `fms_dispatch_replace_lines` refuses an unmapped
   *   item, so leaving them would fail at save with a message about a row the
   *   person can no longer see in the picker. Clearing is the honest reset.
   *   Re-picking the SAME customer is a no-op, so an accidental re-select of the
   *   current value cannot wipe a half-typed grid.
   *
   * It also SEEDS THE LOCATION from the customer's master. A customer has one
   * usual delivery point, so typing it every time is work the form can do — and
   * because the switch is already a hard reset, carrying the previous customer's
   * location across would be the one field left quietly pointing at the wrong
   * place. Overriding it afterwards is the whole point of the field.
   */
  const setCustomer = (id: string) => {
    if (id === form.customerId) return;
    patch({
      customerId: id,
      customerLocation: s.customers.find((c) => c.id === id)?.location ?? "",
    });
    setLines([makeEmptyLine()]);
    /*
      INK IF THEY HAVE IT, BLANK IF THEY DO NOT — and the choice belongs here,
      on the customer, because the answer is a property of the customer.

      677 of the 789 mapped customers hold ink and the order is nearly always
      for it, so pre-selecting saves the common case a click. The other 112 hold
      none at all; leaving Ink selected for them would open the item box empty,
      which reads as a broken form rather than as a filter. Blank shows
      everything they do have and lets them narrow it themselves.
    */
    const types = s.itemTypesForCustomer(id);
    setItemType(types.includes(DEFAULT_ITEM_TYPE) ? DEFAULT_ITEM_TYPE : "");
  };

  /**
   * Picking the billing company.
   *
   * ⚠ IT CLEARS THE LOCATION. Sites belong to one company, so a location chosen
   *   under the previous one is not merely stale — the RPC refuses it outright.
   *   Auto-selecting when there is exactly one site is not a shortcut but the
   *   honest answer: a single-site company has no choice to offer.
   *
   * ⚠ AND IT CLEARS THE CUSTOMER — BUT ONLY WHEN THE NEW COMPANY CANNOT BILL
   *   THEM. The customer picker is now the company's own ledgers, so a customer
   *   chosen under the previous company may not be in the new list; leaving the
   *   id behind would submit a name the form has stopped showing.
   *
   *   Only when. A blanket reset would wipe a half-typed grid every time
   *   somebody corrected the company on an order they had nearly finished, and
   *   the customer is very often billable by both. The check is the same one the
   *   picker makes, so what survives on screen is exactly what survives here.
   */
  const setCompany = (id: string) => {
    if (id === form.companyId) return;
    // The person's OWN sites under that company — the auto-pick has to agree with
    // the list they are about to be shown, or it fills in a site they cannot see.
    const sites = s.assignedLocationsForCompany(id, existing?.locationId ?? null);
    const keepsCustomer =
      !form.customerId ||
      s.customersForCompany(id, existing?.customerId ?? null).some((c) => c.id === form.customerId);
    patch({
      companyId: id,
      locationId: sites.length === 1 ? sites[0]!.id : "",
      ...(keepsCustomer ? {} : { customerId: "", customerLocation: "" }),
    });
    if (!keepsCustomer) setLines([makeEmptyLine()]);
  };

  /** The lines that will actually be submitted — the trailing blank is dropped. */
  const filledLines = useMemo(() => lines.filter((l) => !isLineBlank(l)), [lines]);

  const validate = (): string | null => {
    if (!form.companyId) return "Choose the company that bills this order.";
    // Compulsory only where the company HAS sites — mirrors fms_dispatch_submit_order.
    // A company nobody has added locations to must not block order entry.
    if (
      !form.locationId &&
      s.assignedLocationsForCompany(form.companyId, existing?.locationId ?? null).length > 0
    ) {
      return "Choose the location this order dispatches from.";
    }
    if (!form.customerId) return "Choose a customer.";
    if (!form.orderDate) return "The order date is required.";
    if (filledLines.length === 0) return "Add at least one item line.";
    for (const l of filledLines) {
      if (!l.itemId) return "Every line needs an item.";
      const q = Number(l.quantity);
      if (!Number.isFinite(q) || q <= 0) return "Every line needs a quantity greater than zero.";
    }
    return null;
  };

  const toInput = (requesterName: string): OrderInput => ({
    dispatchType: form.dispatchType,
    companyId: form.companyId,
    locationId: form.locationId || null,
    customerId: form.customerId,
    // CAPS, like the customer master it is seeded from — the intake picker lists
    // every location anyone has used, and two casings read as two places.
    // See lib/masterFields.ts UPPERCASE_MASTER_KEYS.
    customerLocation: form.customerLocation.trim().toUpperCase() || null,
    customerPoNo: form.customerPoNo.trim() || null,
    orderDate: form.orderDate,
    orderRemarks: form.orderRemarks.trim() || null,
    requesterName,
    lines: filledLines.map((l) => ({
      itemId: l.itemId,
      quantity: l.quantity,
      lineRemark: l.lineRemark.trim() || null,
    })),
  });

  return {
    // The order being edited, if any. `SalesOrderFields` needs it to keep a
    // company / site the editor is not assigned to in its own dropdowns.
    existing: existing ?? null,
    form, patch, setForm,
    lines, setLines, filledLines,
    setCustomer, setCompany,
    raise, setRaise, requested, setRequested,
    mapping, setMapping,
    /*
      ⚠ Starts BLANK when editing an existing order, and that is deliberate. A
        saved order's lines are whatever they are — quite possibly two types —
        and opening it under a filter would hide the ones that do not match. The
        Ink default belongs to the moment a customer is CHOSEN, which on an edit
        already happened. `includeIds` keeps every existing line in its own
        picker either way; this only decides what the box shows on arrival.
    */
    itemType, setItemType,
    error, setError,
    busy, setBusy,
    validate, toInput,
  };
}
