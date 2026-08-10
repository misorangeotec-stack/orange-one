import { useMemo, useState } from "react";
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import { useDispatchStore } from "../../store";
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
    existing ? stateFromOrder(existing) : emptyState(),
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
  };

  /**
   * Picking the billing company.
   *
   * ⚠ IT CLEARS THE LOCATION. Sites belong to one company, so a location chosen
   *   under the previous one is not merely stale — the RPC refuses it outright.
   *   Auto-selecting when there is exactly one site is not a shortcut but the
   *   honest answer: a single-site company has no choice to offer.
   */
  const setCompany = (id: string) => {
    if (id === form.companyId) return;
    const sites = s.locationsForCompany(id);
    patch({ companyId: id, locationId: sites.length === 1 ? sites[0]!.id : "" });
  };

  /** The lines that will actually be submitted — the trailing blank is dropped. */
  const filledLines = useMemo(() => lines.filter((l) => !isLineBlank(l)), [lines]);

  const validate = (): string | null => {
    if (!form.companyId) return "Choose the company that bills this order.";
    // Compulsory only where the company HAS sites — mirrors fms_dispatch_submit_order.
    // A company nobody has added locations to must not block order entry.
    if (!form.locationId && s.locationsForCompany(form.companyId).length > 0) {
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
    form, patch, setForm,
    lines, setLines, filledLines,
    setCustomer, setCompany,
    raise, setRaise, requested, setRequested,
    error, setError,
    busy, setBusy,
    validate, toInput,
  };
}
