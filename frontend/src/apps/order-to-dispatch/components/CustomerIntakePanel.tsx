import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import Combobox from "@/shared/components/ui/Combobox";
import { FieldLabel } from "@/shared/components/ui/Form";
import { useDispatchStore } from "../store";
import { fetchCustomerIntakeOptions, intakeOptionsQueryKey } from "../data/customerOrgs";
import type { DispatchOrder, DispatchType } from "../types";

export interface CustomerIntakeDraft {
  companyId: string;
  locationId: string;
  dispatchType: DispatchType | "";
}

export const emptyIntakeDraft = (): CustomerIntakeDraft => ({
  companyId: "",
  locationId: "",
  dispatchType: "",
});

/**
 * Why this draft cannot be saved yet, or null. Mirrors
 * `fms_dispatch_complete_customer_intake`, including its "a site is required only
 * where the company has one" rule.
 */
export function intakeDraftError(
  draft: CustomerIntakeDraft,
  siteCount: number,
): string | null {
  if (!draft.companyId) return "Choose the company that bills this order.";
  if (!draft.locationId && siteCount > 0) return "Choose the location this order dispatches from.";
  if (!draft.dispatchType) return "Choose whether this goes Local or by Transport.";
  return null;
}

/**
 * The three questions a CUSTOMER-raised order arrives without.
 *
 * The customer never sees a billing company, one of our dispatch sites or a
 * dispatch type (decisions Q1/Q2) — so their order reaches us with all three
 * empty and credit check is where they get answered.
 *
 * ⚠ THIS IS THE ONLY WORKABLE PLACE FOR IT, not merely the tidier one. The
 *   obvious home would be the Edit order form — but `canEditOrder` requires
 *   `raisedBy === uid || isAdmin || isCoordinator`, and on a customer order the
 *   raiser IS the customer. An ordinary credit-check clerk therefore never gets
 *   the Edit button at all, so the fields have to be where the work already is.
 *
 * ⚠ THE PICKERS OFFER ONLY WHAT THE SERVER WILL ACCEPT. The company list comes
 *   from the ticked ledgers, so "which Bishen?" can only be answered a way the
 *   setup deliberately allowed. Offering all thirty companies and refusing
 *   twenty-five of them afterwards would be the same screen with worse manners.
 */
export default function CustomerIntakePanel({
  order,
  draft,
  onChange,
  disabled,
}: {
  order: DispatchOrder;
  draft: CustomerIntakeDraft;
  onChange: (next: CustomerIntakeDraft) => void;
  disabled?: boolean;
}) {
  const s = useDispatchStore();

  const { data: options } = useQuery({
    queryKey: intakeOptionsQueryKey(order.id),
    queryFn: () => fetchCustomerIntakeOptions(order.id),
    staleTime: 5 * 60_000,
  });

  const companyOptions = useMemo(
    () => (options?.companies ?? []).map((c) => ({ value: c.id, label: c.name })),
    [options],
  );

  const sites = s.locationsForCompany(draft.companyId || null);
  const siteOptions = useMemo(
    () => sites.map((l) => ({ value: l.id, label: l.name })),
    [sites],
  );

  /**
   * Seed from the customer's saved defaults, ONCE, and only into fields nobody has
   * touched. All 24 sampled orders for both launch customers dispatched from the
   * same site, so the common case should be three confirmations rather than three
   * searches — which is what stops credit check getting slower as customers are
   * added. It is a shortcut, never a decision: everything stays editable.
   *
   * The company is seeded only when there is exactly ONE to choose. Picking one of
   * several on the customer's behalf is the one thing this must not do — that is
   * the answer credit check exists to give.
   */
  useEffect(() => {
    if (!options) return;
    const next = { ...draft };
    let moved = false;
    if (!next.companyId && options.companies.length === 1) {
      next.companyId = options.companies[0]!.id;
      moved = true;
    }
    if (!next.dispatchType && options.defaultDispatchType) {
      next.dispatchType = options.defaultDispatchType;
      moved = true;
    }
    if (moved) onChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options]);

  /**
   * The saved site is offered only once it is genuinely a site of the chosen
   * company — the same test the server applies. Seeding it against another
   * company's site would put a value in the box that the RPC then rejects.
   */
  useEffect(() => {
    if (!options?.defaultLocationId || draft.locationId || !draft.companyId) return;
    if (sites.some((l) => l.id === options.defaultLocationId)) {
      onChange({ ...draft, locationId: options.defaultLocationId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, draft.companyId, sites.length]);

  return (
    <div className="rounded-xl border border-orange/40 bg-orange/5 p-4 space-y-4">
      <div>
        <div className="text-[13px] font-semibold text-navy">
          {order.requesterName} sent this order themselves
        </div>
        <p className="text-[12px] text-grey-2 mt-0.5">
          They do not see any of the three below, so fill them in before recording the credit
          decision. Their item lines move to the chosen company&rsquo;s book automatically.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <FieldLabel label="Billing company" required>
          <Combobox
            value={draft.companyId}
            onChange={(v) => onChange({ ...draft, companyId: v, locationId: "" })}
            options={companyOptions}
            placeholder="Which of ours bills this"
            disabled={disabled}
          />
        </FieldLabel>
        <FieldLabel label="Dispatch location" required={sites.length > 0}>
          <Combobox
            value={draft.locationId}
            onChange={(v) => onChange({ ...draft, locationId: v })}
            options={siteOptions}
            placeholder={
              !draft.companyId ? "Choose the company first"
                : sites.length === 0 ? "This company has no sites"
                : "Which site it leaves from"
            }
            disabled={disabled || !draft.companyId || sites.length === 0}
          />
        </FieldLabel>
        <FieldLabel label="Dispatch type" required>
          <Combobox
            value={draft.dispatchType}
            onChange={(v) => onChange({ ...draft, dispatchType: v as DispatchType })}
            options={[
              { value: "local", label: "Local" },
              { value: "transport", label: "Transport" },
            ]}
            placeholder="Local or Transport"
            disabled={disabled}
          />
        </FieldLabel>
      </div>
    </div>
  );
}
