import { useMemo, useState } from "react";
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import { useDispatchStore } from "../../store";
import { isLineBlank, makeEmptyLine, type OrderLineRow } from "../../components/OrderLinesGrid";
import type { OrderInput } from "../../data/dispatchWrites";
import type { DispatchOrder, DispatchType } from "../../types";

/**
 * Shared form state for New Order and Edit Order.
 *
 * Four fields, after the 2026-08 reshape. Company is NOT among them: it is
 * resolved server-side from the customer's master mapping, so there is nothing
 * to hold here and nothing that can drift out of step with the master.
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
    unitId: l.unitId ?? "",
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
   * Picking a customer. The default-dispatch-type prefill went with the customer
   * master's trimming, so dispatch type is now always typed and simply defaults
   * to Local.
   */
  const setCustomer = (id: string) => patch({ customerId: id });

  /** The lines that will actually be submitted — the trailing blank is dropped. */
  const filledLines = useMemo(() => lines.filter((l) => !isLineBlank(l)), [lines]);

  const validate = (): string | null => {
    if (!form.customerId) return "Choose a customer.";
    // Caught here rather than by the RPC, so the person is told before they save
    // and is told WHERE to fix it.
    const cust = s.customers.find((c) => c.id === form.customerId);
    if (cust && !cust.companyId) {
      return `${cust.name} has no company mapped. Set it in Masters -> Customers first.`;
    }
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
      unitId: l.unitId || null,
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
