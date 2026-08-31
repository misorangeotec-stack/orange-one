import Combobox, { type ComboOption } from "@/shared/components/ui/Combobox";
import ChoiceButtons from "@/shared/components/ui/ChoiceButtons";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { useDispatchStore } from "../store";
import { DISPATCH_TYPE_LABEL } from "../lib/format";
import { itemTypeLabel, type ItemType } from "@/core/platform/liveMasters";
import { masterTypeLabel } from "../lib/masterFields";
import RequestMasterModal from "./RequestMasterModal";
import MapCustomerItemModal from "./MapCustomerItemModal";
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
 *   Item type · Customer PO no.                         ← what kind of thing, and their ref
 *   Remarks (full width)
 *
 * ⚠ Keep Customer immediately before Customer location. Picking the first FILLS
 *   the second, so the answer has to land where the eye already is — and they
 *   only stay side by side at BOTH widths (3-up desktop, 2-up tablet) while
 *   Customer's position is odd AND not a multiple of three. It is 5th here; the
 *   PO was moved off the front of that row to keep it 5th when Dispatch location
 *   joined, and Item type was added BELOW it (7th) for the same reason. Move
 *   anything and re-count, because it breaks on tablet only.
 *
 * ⚠ NO HELP TEXT UNDER THESE FIELDS, by instruction (OD-10). Every field was
 *   once wrapped in a <div> carrying a grey one-liner; those are gone and the
 *   FieldLabels are direct grid children again. The RED line under Billing
 *   company is NOT help text — it is the only thing that explains an empty
 *   company list — and it stays. If you add a wrapper back, keep it to ONE
 *   element per field or the pairing above breaks.
 *
 * ⚠ DISPATCH LOCATION ALWAYS RENDERS, even for a company with no sites — it is
 *   disabled and says so. Hiding it would change the child count and silently
 *   break the pairing above at one breakpoint.
 *
 * ⚠ NOT EVERY PICKER CAN RAISE ITS OWN MASTER ANY MORE, and the split is the
 *   point (OD-2, OD-9). Ask yourself who OWNS the thing before adding a create
 *   row to a picker here:
 *
 *     · Billing company, Customer — TALLY'S. No create row at all. A ledger
 *       invented here has no Tally guid and no company book, which is the
 *       mechanism behind OD-4. The picker says where to go instead.
 *     · Dispatch location — OURS. Still requestable, still goes to that master's
 *       owner, exactly as before.
 *     · Customer location — free text, no master, no request.
 *     · The item grid — neither. It opens the MAPPING modal, which writes
 *       immediately with no owner in the loop, because the item is nearly always
 *       already in Tally and merely unmapped.
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

  /*
    ⚠ ONLY THE TYPES THIS CUSTOMER ACTUALLY HOLDS — the cascading rule every
      filter here follows. The vocabulary has 13 words; a customer typically has
      two or three. Offering all 13 would put eleven dead options above a list
      that goes empty when you pick one, and the reader cannot tell "wrong type"
      from "nothing mapped". The store derives this from the very list the grid
      filters, so the two cannot disagree.
  */
  const typeOptions: ComboOption[] = s
    .itemTypesForCustomer(f.form.customerId || null)
    .map((t) => ({ value: t, label: itemTypeLabel(t as ItemType) }))
    .sort((a, b) => a.label.localeCompare(b.label));

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

        <FieldLabel label="Dispatch type" required>
            {/* Form-grade buttons, not PillToggle: PillToggle is the FILTER control
                (small grey pills, always one selected) and this sits in a form grid
                beside h-9 inputs. See ChoiceButtons for why the two stay apart. */}
            <ChoiceButtons
              value={f.form.dispatchType}
              onChange={(v) => f.patch({ dispatchType: v as DispatchType })}
              options={[
                { value: "local", label: DISPATCH_TYPE_LABEL.local },
                { value: "transport", label: DISPATCH_TYPE_LABEL.transport },
              ]}
              ariaLabel="Dispatch type"
            />
        </FieldLabel>

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
            wrapLabel
            /*
              ⚠ NO CREATE ROW, and removing it fixed a live trap rather than
                merely tidying up. It raised a `company` master request — but
                `company` is excluded from REQUESTABLE_DISPATCH_MASTER_TYPES and
                the resolver refuses it outright with "Companies come from Tally
                now and cannot be added by hand". So the request could be raised,
                could be approved, and only THEN failed, in front of the owner
                who had just agreed to it. There are five companies and they come
                from Tally; there is nothing here to ask for.
            */
          />
          {noAssignment && (
            <p className="mt-1 text-[11.5px] text-ryg-red">
              You are not assigned to a dispatch location. Ask an admin to add you under
              Setup → Step Owners.
            </p>
          )}
        </FieldLabel>

        {/* ---- row 2: where it leaves from, and who is buying ---- */}

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
              wrapLabel
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

        <FieldLabel label="Customer" required>
            {/* ⚠ THE COMPANY COMES FIRST, and the picker says so rather than
                listing all 1,850 ledgers. A firm has a separate ledger in every
                book it trades with, so "ANUPAM" is four rows and picking between
                them blind is a coin toss — the company is what tells them apart.
                The order's OWN customer always survives the narrowing (71 of 303
                existing orders were billed by a company that is not the one on
                their customer's ledger). */}
            <Combobox
              value={f.form.customerId}
              onChange={f.setCustomer}
              /* Each name carries how many items are mapped to it, BEFORE it is
                 chosen. Two thirds of the master has no mapping at all, and
                 finding that out after picking costs the customer, the delivery
                 location and the item rows all at once. */
              options={s.customersForCompany(f.form.companyId, f.form.customerId).map((c) => {
                const n = s.mappedItemCount(c.id);
                return {
                  value: c.id,
                  label: c.name,
                  sublabel: n === 0 ? "no items mapped yet" : `${n} item${n === 1 ? "" : "s"}`,
                };
              })}
              placeholder={f.form.companyId ? "Select customer…" : "pick the billing company first"}
              disabled={!f.form.companyId}
              searchable
              wrapLabel
              /* ⚠ NO CREATE ROW — a customer ledger is Tally's (OD-2). Asking
                 for one here created it in Orange One with no Tally guid and no
                 company, which is the mechanism behind OD-4. The note below says
                 where to go instead. */
            />
        </FieldLabel>

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
              wrapLabel
            />
        </FieldLabel>

        {/* ---- row 3: what kind of thing is being ordered ---- */}

        {/*
          ⚠ 7TH, AND THAT POSITION IS LOAD-BEARING. Inserting it here leaves
            Customer 5th — odd, and not a multiple of three — so Customer and
            Customer location stay side by side at both widths, per the layout
            note at the top of this file. Putting it anywhere ABOVE Customer
            would push Customer to 6th and break the pairing on tablet only.
        */}
        <FieldLabel label="Item type">
          <Combobox
            value={f.itemType}
            /* ⚠ DOES NOT CLEAR THE LINES, unlike changing the customer. That
               reset exists because a different customer may not be able to
               order the items already chosen; a different TYPE is only a view
               over the same customer's list, and every line already picked
               stays valid. OrderLinesGrid keeps those rows visible through its
               `includeIds` escape hatch regardless of what is selected here. */
            onChange={f.setItemType}
            options={typeOptions}
            placeholder={
              !f.form.customerId ? "pick the customer first"
              : typeOptions.length === 0 ? "nothing mapped to this customer yet"
              : "All types"
            }
            disabled={!f.form.customerId || typeOptions.length === 0}
            /* Blank is a real state — it means every type — so the field needs a
               way back out once something is chosen. */
            clearable
            searchable={typeOptions.length > 6}
          />
        </FieldLabel>

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
        ONE request modal for the whole intake form. Two would mean two copies of
        the duplicate checks, and Purchase has already been down that road. It
        renders nothing while closed, so it costs the layout nothing to live here.

        Only the DISPATCH SITE picker still feeds it: company and customer come
        from Tally and no longer offer to create anything, and the item grid now
        opens the mapping modal below instead of raising a request at all.
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

      {/*
        THE MAPPING MODAL — no approval, so it is not a request and does not
        share the modal above. The order has already chosen a company and a
        customer, so both arrive fixed: mapping against a different book than the
        one billing is exactly the mismatch this feature exists to avoid.
      */}
      <MapCustomerItemModal
        open={f.mapping !== null}
        onClose={() => f.setMapping(null)}
        companyId={f.form.companyId}
        customerId={f.form.customerId}
        initialSearch={f.mapping?.search ?? null}
        onMapped={(result) => {
          const added = result.created + result.reactivated;
          f.setRequested({
            from: "lines",
            // Reactivated is called out separately: somebody had switched that
            // pair OFF, and turning it back on silently would hide a decision.
            text: result.reactivated > 0
              ? `Mapped ${added} item${added === 1 ? "" : "s"} — ${result.reactivated} of them switched back on.`
              : `Mapped ${added} item${added === 1 ? "" : "s"} — orderable now.`,
          });
        }}
      />
    </div>
  );
}
