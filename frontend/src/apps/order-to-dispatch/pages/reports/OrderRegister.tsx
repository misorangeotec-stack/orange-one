import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Combobox from "@/shared/components/ui/Combobox";
import DateRangeFilter, {
  EMPTY_RANGE, dateInRange, isRangeActive, rangeLabel, type DateRange,
} from "@/shared/components/ui/DateRangeFilter";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import { useDispatchStore } from "../../store";
import { exportOrderRegister } from "../../lib/exportOrderRegister";
import { STATUS_LABEL, DISPATCH_TYPE_LABEL } from "../../lib/format";
import OrdersTable from "../../components/OrdersTable";
import type { DispatchStatus, DispatchType } from "../../types";

/**
 * Derived, never re-listed. This was a hand-written array of the eight statuses,
 * which type-checks happily when a ninth is added — so a new status silently
 * dropped out of the filter and became unfindable in the register. `STATUS_LABEL`
 * is exhaustive over `DispatchStatus`, so taking its keys cannot drift.
 */
const STATUSES = Object.keys(STATUS_LABEL) as DispatchStatus[];

/**
 * The Order Register — the spreadsheet replacement.
 *
 * Filter, look at it, then export the .xlsx that carries the Planned / Actual /
 * Status / Remarks block for every step, in the source sheet's own layout.
 */
export default function OrderRegister() {
  const s = useDispatchStore();
  const [range, setRange] = useState<DateRange>(EMPTY_RANGE);
  const [customerId, setCustomerId] = useState("");
  const [poNo, setPoNo] = useState("");
  const [type, setType] = useState<DispatchType | "">("");
  const [status, setStatus] = useState<DispatchStatus | "">("");

  // The PO is matched as a CONTAINS, not an equals: people quote it partially
  // ("4471") off a mail thread far more often than they retype it in full.
  const poQuery = poNo.trim().toLowerCase();

  const rows = useMemo(
    () =>
      s.orders.filter(
        (o) =>
          (!isRangeActive(range) || dateInRange(o.orderDate, range)) &&
          (!customerId || o.customerId === customerId) &&
          (!poQuery || (o.customerPoNo ?? "").toLowerCase().includes(poQuery)) &&
          (!type || o.dispatchType === type) &&
          (!status || o.status === status),
      ),
    [s.orders, range, customerId, poQuery, type, status],
  );

  const filters = useMemo(() => {
    const out: string[] = [];
    if (isRangeActive(range)) out.push(`Order date: ${rangeLabel(range)}`);
    if (customerId) out.push(`Customer: ${s.customerName(customerId)}`);
    if (poQuery) out.push(`Customer PO: ${poNo.trim()}`);
    if (type) out.push(`Type: ${DISPATCH_TYPE_LABEL[type]}`);
    if (status) out.push(`Status: ${STATUS_LABEL[status]}`);
    return out;
  }, [range, customerId, poQuery, poNo, type, status, s]);

  const download = () => {
    exportOrderRegister(
      rows,
      {
        snap: s.snapshot,
        ownerNamesFor: s.ownerNamesFor,
        customerName: s.customerName,
        itemName: s.itemName,
        companyName: (id) => s.masterName("company", id),
        locationName: (id) => s.masterName("company_location", id),
      },
      filters,
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-navy">Order Register</h1>
          <p className="text-[13.5px] text-grey-2 mt-1">
            Every order with its planned-vs-actual dates for all five workflow steps — the spreadsheet, generated.
          </p>
        </div>
        <Button onClick={download} disabled={rows.length === 0}>Download register (.xlsx)</Button>
      </div>

      <Card className="p-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <FieldLabel label="Order date">
            <DateRangeFilter value={range} onChange={setRange} />
          </FieldLabel>
          <FieldLabel label="Customer">
            <Combobox
              value={customerId}
              onChange={setCustomerId}
              options={[{ value: "", label: "All customers" }, ...s.customers.map((c) => ({ value: c.id, label: c.name }))]}
              searchable
            />
          </FieldLabel>
          <FieldLabel label="Customer PO no.">
            <TextInput
              value={poNo}
              onChange={(e) => setPoNo(e.target.value)}
              placeholder="all POs"
            />
          </FieldLabel>
          <FieldLabel label="Type">
            <Combobox
              value={type}
              onChange={(v) => setType(v as DispatchType | "")}
              options={[
                { value: "", label: "All types" },
                { value: "local", label: DISPATCH_TYPE_LABEL.local },
                { value: "transport", label: DISPATCH_TYPE_LABEL.transport },
              ]}
            />
          </FieldLabel>
          <FieldLabel label="Status">
            <Combobox
              value={status}
              onChange={(v) => setStatus(v as DispatchStatus | "")}
              options={[
                { value: "", label: "All statuses" },
                ...STATUSES.map((st) => ({ value: st, label: STATUS_LABEL[st] })),
              ]}
            />
          </FieldLabel>
        </div>
        <p className="mt-3 text-[12.5px] text-grey-2">
          {rows.length} order{rows.length === 1 ? "" : "s"} in this view
          {filters.length ? ` · ${filters.join(" · ")}` : ""}.
        </p>
      </Card>

      <OrdersTable
        orders={rows}
        exportName="Order_To_Dispatch_Register_Summary"
        emptyTitle="Nothing matches"
        emptyMessage="Widen the filters to see more orders."
      />
    </div>
  );
}
