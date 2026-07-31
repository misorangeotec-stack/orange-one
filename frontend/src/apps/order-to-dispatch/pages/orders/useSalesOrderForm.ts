import { useMemo, useState } from "react";
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import { useDispatchStore } from "../../store";
import { isLineBlank, makeEmptyLine, type OrderLineRow } from "../../components/OrderLinesGrid";
import type { OrderInput } from "../../data/dispatchWrites";
import type { DispatchOrder, DispatchType } from "../../types";

/**
 * Shared form state for New Order and Edit Order.
 *
 * Four fields: dispatch type, customer, order date, remarks. There is no company
 * — the order records who is buying and what is going out, and nothing else.
 */
export interface SalesOrderFormState {
  dispatchType: DispatchType;
  customerId: string;
  orderDate: string;
  orderRemarks: string;
}

const emptyState = (): SalesOrderFormState => ({
  dispatchType: "local",
  customerId: "",
  orderDate: todayLocalIso(),
  orderRemarks: "",
});

const stateFromOrder = (o: DispatchOrder): SalesOrderFormState => ({
  dispatchType: o.dispatchType,
  customerId: o.customerId,
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
   */
  const setCustomer = (id: string) => {
    if (id === form.customerId) return;
    patch({ customerId: id });
    setLines([makeEmptyLine()]);
  };

  /** The lines that will actually be submitted — the trailing blank is dropped. */
  const filledLines = useMemo(() => lines.filter((l) => !isLineBlank(l)), [lines]);

  const validate = (): string | null => {
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
    customerId: form.customerId,
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
    setCustomer,
    error, setError,
    busy, setBusy,
    validate, toInput,
  };
}
