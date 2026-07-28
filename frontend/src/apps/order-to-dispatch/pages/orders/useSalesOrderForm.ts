import { useMemo, useState } from "react";
import { addWorkingDays, localDateIso } from "@/shared/lib/workingDays";
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import { useDispatchStore } from "../../store";
import { isLineBlank, makeEmptyLine, type OrderLineRow } from "../../components/OrderLinesGrid";
import type { OrderInput } from "../../data/dispatchWrites";
import type { DispatchOrder, DispatchType } from "../../types";

/**
 * Shared form state for New Order and Edit Order.
 *
 * The two TAT fields are kept in sync in one direction at a time: typing a TAT
 * derives the promised date (working days from the order date), typing a promised
 * date derives the TAT. Whichever the user last touched wins, so neither silently
 * overwrites the other while they type.
 */
export interface SalesOrderFormState {
  dispatchType: DispatchType;
  companyId: string;
  customerId: string;
  shipToId: string;
  orderSourceId: string;
  orderDate: string;
  promisedDate: string;
  tatDays: string;
  customerRef: string;
  orderRemarks: string;
}

const emptyState = (): SalesOrderFormState => ({
  dispatchType: "local",
  companyId: "",
  customerId: "",
  shipToId: "",
  orderSourceId: "",
  orderDate: todayLocalIso(),
  promisedDate: "",
  tatDays: "",
  customerRef: "",
  orderRemarks: "",
});

const stateFromOrder = (o: DispatchOrder): SalesOrderFormState => ({
  dispatchType: o.dispatchType,
  companyId: o.companyId ?? "",
  customerId: o.customerId,
  shipToId: o.shipToId ?? "",
  orderSourceId: o.orderSourceId ?? "",
  orderDate: o.orderDate?.slice(0, 10) ?? todayLocalIso(),
  promisedDate: o.promisedDate?.slice(0, 10) ?? "",
  tatDays: o.tatDays !== null && o.tatDays !== undefined ? String(o.tatDays) : "",
  customerRef: o.customerRef ?? "",
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

const dayDiff = (aIso: string, bIso: string): number =>
  Math.round((new Date(`${aIso}T00:00:00`).getTime() - new Date(`${bIso}T00:00:00`).getTime()) / 86_400_000);

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

  /** Typing a TAT derives the promised date. */
  const setTatDays = (v: string) => {
    const n = Number(v);
    const promised =
      v.trim() && Number.isFinite(n) && n >= 0 && form.orderDate
        ? localDateIso(addWorkingDays(new Date(`${form.orderDate}T00:00:00`), Math.round(n)))
        : form.promisedDate;
    patch({ tatDays: v, promisedDate: promised });
  };

  /** Typing a promised date derives the TAT. */
  const setPromisedDate = (v: string) => {
    const tat = v && form.orderDate ? String(Math.max(0, dayDiff(v, form.orderDate))) : form.tatDays;
    patch({ promisedDate: v, tatDays: tat });
  };

  /** Picking a customer pre-fills their default dispatch type and clears the ship-to. */
  const setCustomer = (id: string) => {
    const c = s.customers.find((x) => x.id === id);
    patch({
      customerId: id,
      shipToId: "",
      dispatchType: c?.defaultType ?? form.dispatchType,
    });
  };

  /** Ship-to addresses belong to the chosen customer only. */
  const shipToOptions = useMemo(
    () => s.activeOf(s.shipTos).filter((a) => a.customerId === form.customerId),
    [s, form.customerId],
  );

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
    companyId: form.companyId || null,
    customerId: form.customerId,
    shipToId: form.shipToId || null,
    orderSourceId: form.orderSourceId || null,
    orderDate: form.orderDate,
    promisedDate: form.promisedDate || null,
    tatDays: form.tatDays || null,
    customerRef: form.customerRef.trim() || null,
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
    setTatDays, setPromisedDate, setCustomer,
    shipToOptions,
    error, setError,
    busy, setBusy,
    validate, toInput,
  };
}
