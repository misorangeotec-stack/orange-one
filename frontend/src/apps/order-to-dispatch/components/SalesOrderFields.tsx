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
 * The order date is the one field that matters mechanically: it starts the
 * internal SLA clocks.
 *
 * THE COMPANY IS ASKED HERE, and only here. It used to be chosen at the stock
 * check, which put the question to the store keeper two steps after the person
 * who knew the answer had left the flow — and, being per-round, let a single
 * order that shipped in two goes bill two different entities.
 *
 * FIELD ORDER IS THE POINT OF THE LAYOUT, not decoration:
 *
 *   Dispatch type · Order date · Billing company        ← how it moves, when, who bills
 *   Dispatch location · Customer · Customer location    ← where from, and the buyer
 *   Customer PO no.
 *   Remarks (full width)
 *
 * ⚠ Keep Customer immediately before Customer location. Picking the first FILLS
 *   the second, so the answer has to land where the eye already is — and they
 *   only stay side by side at BOTH widths (3-up desktop, 2-up tablet) while
 *   Customer's position is odd AND not a multiple of three. It is 5th here; the
 *   PO was moved off the front of that row to keep it 5th when Dispatch location
 *   joined. Move anything and re-count, because it breaks on tablet only.
 *
 * ⚠ DISPATCH LOCATION ALWAYS RENDERS, even for a company with no sites — it is
 *   disabled and says so. Hiding it would change the child count and silently
 *   break the pairing above at one breakpoint.
 */
export default function SalesOrderFields({ f }: { f: ReturnType<typeof useSalesOrderForm> }) {
  const s = useDispatchStore();

  const opts = (rows: { id: string; name: string }[]): ComboOption[] =>
    rows.map((r) => ({ value: r.id, label: r.name }));

  /**
   * ⚠ THE CURRENT VALUE MUST BE IN THE LIST. Combobox renders
   *   `options.find(o => o.value === value)?.label ?? placeholder`, so a location
   *   just typed through the "Add …" row — which by definition is not in
   *   `knownLocations` yet — would leave the field looking empty while the state
   *   held it. Unioning it in is what makes free-typing actually visible.
   */
  /** OUR sites under the chosen company. Empty until a company is picked. */
  const siteOptions: ComboOption[] = opts(s.locationsForCompany(f.form.companyId || null));

  const locationOptions: ComboOption[] = (() => {
    const known = s.knownLocations;
    const cur = f.form.customerLocation.trim();
    const all = cur && !known.some((l) => l.toLowerCase() === cur.toLowerCase()) ? [...known, cur] : known;
    return all.map((l) => ({ value: l, label: l }));
  })();

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* ---- row 1: how it moves, when, and who bills it ---- */}

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

        <FieldLabel label="Order date" required>
          <TextInput
            type="date"
            value={f.form.orderDate}
            onChange={(e) => f.patch({ orderDate: e.target.value })}
          />
        </FieldLabel>

        <FieldLabel label="Billing company" required>
          <Combobox
            value={f.form.companyId}
            onChange={f.setCompany}
            options={opts(s.activeOf(s.companies))}
            placeholder="which company bills this order"
            searchable
          />
        </FieldLabel>

        {/* ---- row 2: where it leaves from, and who is buying ---- */}

        <div>
          <FieldLabel label="Dispatch location" required={siteOptions.length > 0}>
            <Combobox
              value={f.form.locationId}
              onChange={(v) => f.patch({ locationId: v })}
              options={siteOptions}
              placeholder={
                !f.form.companyId ? "pick the billing company first"
                : siteOptions.length === 0 ? "no locations set up for this company"
                : "which of our sites it leaves from"
              }
              disabled={siteOptions.length === 0}
              searchable
            />
          </FieldLabel>
          <p className="mt-1 text-[11.5px] text-grey-2">
            Our site the goods leave from — not where the customer takes delivery.
          </p>
        </div>

        <div>
          <FieldLabel label="Customer" required>
            <Combobox
              value={f.form.customerId}
              onChange={f.setCustomer}
              options={opts(s.activeOf(s.customers))}
              placeholder="Select customer…"
              searchable
            />
          </FieldLabel>
          <p className="mt-1 text-[11.5px] text-grey-2">
            Changing the customer resets the item lines and the location.
          </p>
        </div>

        <div>
          <FieldLabel label="Customer location">
            <Combobox
              value={f.form.customerLocation}
              onChange={(v) => f.patch({ customerLocation: v })}
              options={locationOptions}
              placeholder="Select or type a location…"
              onCreate={(label) => label}
              createLabel={(q) => `Use “${q}”`}
              searchable
            />
          </FieldLabel>
          <p className="mt-1 text-[11.5px] text-grey-2">
            Filled in from the customer master. Change it, or type a new one.
          </p>
        </div>

        <FieldLabel label="Customer PO no.">
          <TextInput
            value={f.form.customerPoNo}
            onChange={(e) => f.patch({ customerPoNo: e.target.value })}
            placeholder="the customer's own reference (optional)"
          />
        </FieldLabel>
      </div>

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
