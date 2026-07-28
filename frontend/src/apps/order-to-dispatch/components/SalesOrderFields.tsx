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
 * The three dates are deliberately distinct and labelled as such:
 *   Order date    — when the order arrived. Drives the internal SLA clocks.
 *   TAT / Promised — what the CUSTOMER was told. Drives the TAT-breached tile.
 * Conflating them would let one late internal step rewrite the customer promise.
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
            Transport asks for the LR details at delivery; Local asks who signed for it.
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

        <FieldLabel
          label="Delivery address"
          hint={f.form.customerId ? undefined : "pick a customer first"}
        >
          <Combobox
            value={f.form.shipToId}
            onChange={(v) => f.patch({ shipToId: v })}
            options={opts(f.shipToOptions)}
            placeholder={f.shipToOptions.length ? "Select address…" : "none on file"}
            disabled={!f.form.customerId || f.shipToOptions.length === 0}
            searchable
          />
        </FieldLabel>

        <FieldLabel label="Company">
          <Combobox
            value={f.form.companyId}
            onChange={(v) => f.patch({ companyId: v })}
            options={opts(s.activeOf(s.companies))}
            placeholder="Select company…"
          />
        </FieldLabel>

        <FieldLabel label="Order source">
          <Combobox
            value={f.form.orderSourceId}
            onChange={(v) => f.patch({ orderSourceId: v })}
            options={opts(s.activeOf(s.orderSources))}
            placeholder="How did it arrive?"
          />
        </FieldLabel>

        <FieldLabel label="Customer's PO / reference">
          <TextInput
            value={f.form.customerRef}
            onChange={(e) => f.patch({ customerRef: e.target.value })}
            placeholder="their own order number"
          />
        </FieldLabel>

        <FieldLabel label="Order date" required hint="starts the internal clocks">
          <TextInput
            type="date"
            value={f.form.orderDate}
            onChange={(e) => f.patch({ orderDate: e.target.value })}
          />
        </FieldLabel>

        <FieldLabel label="TAT for dispatch (working days)">
          <TextInput
            value={f.form.tatDays}
            inputMode="decimal"
            onChange={(e) => f.setTatDays(e.target.value)}
            placeholder="e.g. 3"
          />
        </FieldLabel>

        <FieldLabel label="Promised dispatch date" hint="what the customer was told">
          <TextInput
            type="date"
            value={f.form.promisedDate}
            onChange={(e) => f.setPromisedDate(e.target.value)}
          />
        </FieldLabel>
      </div>

      {customer && (customer.creditLimit !== null || customer.creditDays !== null) && (
        <p className="text-[12.5px] text-grey-2">
          On file for {customer.name}:{" "}
          {customer.creditLimit !== null && <>credit limit ₹{customer.creditLimit.toLocaleString("en-IN")}</>}
          {customer.creditLimit !== null && customer.creditDays !== null && " · "}
          {customer.creditDays !== null && <>{customer.creditDays} days</>}
          {!customer.email && " · no email on file, so the planned-dispatch mail will be skipped"}
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
