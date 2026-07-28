import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Combobox from "@/shared/components/ui/Combobox";
import DateRangeFilter, {
  EMPTY_RANGE, dateInRange, isRangeActive, rangeLabel, type DateRange,
} from "@/shared/components/ui/DateRangeFilter";
import { FieldLabel } from "@/shared/components/ui/Form";
import { useDispatchStore } from "../../store";
import { exportOrderRegister } from "../../lib/exportOrderRegister";
import { STATUS_LABEL, DISPATCH_TYPE_LABEL } from "../../lib/format";
import OrdersTable from "../../components/OrdersTable";
import type { DispatchStatus, DispatchType } from "../../types";

const STATUSES: DispatchStatus[] = [
  "awaiting_credit_check", "awaiting_material_status", "awaiting_lot_confirm",
  "awaiting_sales_bill", "awaiting_gate_out", "awaiting_dispatch_confirm",
  "closed", "on_hold", "cancelled",
];

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
  const [type, setType] = useState<DispatchType | "">("");
  const [status, setStatus] = useState<DispatchStatus | "">("");

  const rows = useMemo(
    () =>
      s.orders.filter(
        (o) =>
          (!isRangeActive(range) || dateInRange(o.orderDate, range)) &&
          (!customerId || o.customerId === customerId) &&
          (!type || o.dispatchType === type) &&
          (!status || o.status === status),
      ),
    [s.orders, range, customerId, type, status],
  );

  const filters = useMemo(() => {
    const out: string[] = [];
    if (isRangeActive(range)) out.push(`Order date: ${rangeLabel(range)}`);
    if (customerId) out.push(`Customer: ${s.customerName(customerId)}`);
    if (type) out.push(`Type: ${DISPATCH_TYPE_LABEL[type]}`);
    if (status) out.push(`Status: ${STATUS_LABEL[status]}`);
    return out;
  }, [range, customerId, type, status, s]);

  const download = () => {
    exportOrderRegister(
      rows,
      {
        snap: s.snapshot,
        ownerNamesFor: s.ownerNamesFor,
        customerName: s.customerName,
        itemName: s.itemName,
        unitName: s.unitName,
        vehicleName: (id) => s.masterName("vehicle", id),
        transporterName: (id) => s.masterName("transporter", id),
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
            Every order with its planned-vs-actual dates for all seven steps — the spreadsheet, generated.
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
