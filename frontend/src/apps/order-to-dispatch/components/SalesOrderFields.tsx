import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import PillToggle from "@/shared/components/ui/PillToggle";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { useDispatchStore } from "../store";
import { DISPATCH_TYPE_LABEL } from "../lib/format";
import type { useSalesOrderForm } from "../pages/orders/useSalesOrderForm";
import type { DispatchType } from "../types";

/**
 * The sales-order intake header. Shared by New Order and Edit Order so the two
 * screens cannot drift — the only difference between them is what they do on save.
 *
 * Four fields, after the 2026-08 reshape. The order date is the only one that
 * matters mechanically: it starts the internal SLA clocks.
 *
 * Company is deliberately absent — it is read from the customer's master record
 * and shown back read-only, so the two can never disagree.
 */
export default function SalesOrderFields({ f }: { f: ReturnType<typeof useSalesOrderForm> }) {
  const s = useDispatchStore();

  const opts = (rows: { id: string; name: string }[]): ComboOption[] =>
    rows.map((r) => ({ value: r.id, label: r.name }));

  const customer = s.customers.find((c) => c.id === f.form.customerId);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <FieldLabel label="Dispatch type" required>
            <PillToggle<DispatchType>
              value={f.form.dispatchType}
              onChange={(v) => f.patch({ dispatchType: v })}
              options={[
                { value: "local", label: DISPATCH_TYPE_LABEL.local },
                { value: "transport", label: DISPATCH_TYPE_LABEL.transport },
              ]}
            />
          </FieldLabel>
          <p className="mt-1 text-[11.5px] text-grey-2">
            How the consignment travels. Recorded on the order for reference.
          </p>
        </div>

        <FieldLabel label="Customer" required>
          <Combobox
            value={f.form.customerId}
            onChange={f.setCustomer}
            options={opts(s.activeOf(s.customers))}
            placeholder="Select customer…"
            searchable
          />
        </FieldLabel>

        <FieldLabel label="Order date" required>
          <TextInput
            type="date"
            value={f.form.orderDate}
            onChange={(e) => f.patch({ orderDate: e.target.value })}
          />
        </FieldLabel>
      </div>

      {/*
        Company is no longer asked for — it is read from the customer's master
        record. Showing which one, read-only, means nobody has to open Masters to
        find out who is billing, and an unmapped customer is caught HERE rather
        than by a server error on save.
      */}
      {customer && (
        <p className="text-[12.5px] text-grey-2">
          {customer.companyId ? (
            <>Billed by <span className="font-semibold text-navy">{s.masterName("company", customer.companyId)}</span>, from the customer master.</>
          ) : (
            <span className="font-medium text-ryg-red">
              {customer.name} has no company mapped. Set it in Masters → Customers before raising this order.
            </span>
          )}
        </p>
      )}

      <FieldLabel label="Remarks">
        <TextArea
          value={f.form.orderRemarks}
          onChange={(e) => f.patch({ orderRemarks: e.target.value })}
          rows={2}
          placeholder="anything the next steps should know"
        />
      </FieldLabel>
    </div>
  );
}
