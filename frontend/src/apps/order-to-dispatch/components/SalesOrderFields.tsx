import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import PillToggle from "@/shared/components/ui/PillToggle";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { useDispatchStore } from "../store";
import { DISPATCH_TYPE_LABEL } from "../lib/format";
import { masterTypeLabel } from "../lib/masterFields";
import RequestMasterModal from "./RequestMasterModal";
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
 *
 * EVERY PICKER HERE CAN RAISE ITS OWN MASTER. Type a name that is not in the
 * list and the dropdown offers to request it, the way every other FMS intake
 * form does. Nothing is added on the spot: the request goes to that master's
 * owner, and the order is raised with what exists today.
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
  /*
    WHAT THIS PERSON MAY DISPATCH FROM — not every company and site the group
    owns. The assignment already exists in Setup → Step Owners, and RLS hides an
    order from anyone owning no step at its location, so offering a site someone
    is not assigned to only ever ends in an order they cannot see afterwards.

    `existing` keeps the value an order was RAISED with, whoever is editing it.
    OUR sites, under the chosen company — empty until a company is picked.
  */
  const companyOptions: ComboOption[] = opts(s.assignedCompanies(f.existing?.companyId ?? null));
  const siteOptions: ComboOption[] = opts(
    s.assignedLocationsForCompany(f.form.companyId || null, f.existing?.locationId ?? null),
  );
  /*
    Companies EXIST but none is on offer — so this is an assignment gap, and the
    message can say so. Tested against the full list rather than the empty
    dropdown alone, because a system with no company master yet is missing data,
    not permission, and telling that admin to go assign themselves a site would
    send them to the wrong screen.
  */
  const noAssignment = companyOptions.length === 0 && s.activeOf(s.companies).length > 0;

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
            options={companyOptions}
            placeholder={
              noAssignment ? "no dispatch site assigned to you" : "which company bills this order"
            }
            searchable
            onCreate={(name) => f.setRaise({ mt: "company", prefill: { name }, from: "header" })}
            createLabel={(q) => `Request new company “${q}”`}
          />
          {noAssignment && (
            <p className="mt-1 text-[11.5px] text-ryg-red">
              You are not assigned to a dispatch location. Ask an admin to add you under
              Setup → Step Owners.
            </p>
          )}
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
                : siteOptions.length === 0 ? "no locations set up — type to request one"
                : "which of our sites it leaves from"
              }
              /* Disabled ONLY without a company. A company with no sites used to
                 disable this outright, which is precisely when the person needs to
                 ask for one — and the request needs the company to hang it off. */
              disabled={!f.form.companyId}
              searchable
              onCreate={(name) =>
                f.setRaise({
                  mt: "company_location",
                  prefill: { name, company_id: f.form.companyId },
                  from: "header",
                })
              }
              createLabel={(q) => `Request new location “${q}”`}
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
              onCreate={(name) => f.setRaise({ mt: "customer", prefill: { name }, from: "header" })}
              createLabel={(q) => `Request new customer “${q}”`}
            />
          </FieldLabel>
          <p className="mt-1 text-[11.5px] text-grey-2">
            Changing the customer resets the item lines and the location.
          </p>
        </div>

        <div>
          <FieldLabel label="Customer location">
            {/* CAPS on the way in, not just on save, so the field shows exactly
                what will be stored — and a typed location joins the shared list
                as the same place, not a second spelling of it. */}
            <Combobox
              value={f.form.customerLocation}
              onChange={(v) => f.patch({ customerLocation: v.toUpperCase() })}
              options={locationOptions}
              placeholder="Select or type a location…"
              onCreate={(label) => label.toUpperCase()}
              createLabel={(q) => `Use “${q.toUpperCase()}”`}
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

      {f.requested?.from === "header" && (
        <p className="text-[12.5px] text-teal">
          Requested {f.requested.text} — selectable here once the master's owner approves it.
        </p>
      )}

      {/*
        ONE modal for the whole intake form, header and item grid alike (the grid
        raises through the same `f.setRaise`). Two would mean two copies of the
        duplicate checks, and Purchase has already been down that road. It renders
        nothing while closed, so it costs the layout nothing to live here.
      */}
      <RequestMasterModal
        open={f.raise !== null}
        onClose={() => f.setRaise(null)}
        masterType={f.raise?.mt}
        prefill={f.raise?.prefill}
        onRequested={(mt, label) =>
          f.setRequested({
            from: f.raise?.from ?? "header",
            text: `${masterTypeLabel(mt).toLowerCase()} “${label}”`,
          })
        }
      />
    </div>
  );
}
