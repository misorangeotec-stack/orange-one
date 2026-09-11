import { useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import EmptyState from "@/shared/components/ui/EmptyState";
import { SectionHeading } from "@/shared/components/ui/Readout";
import { useSession } from "@/core/platform/session";
import { useDispatchStore } from "../../store";
import SalesOrderFields from "../../components/SalesOrderFields";
import OrderLinesGrid from "../../components/OrderLinesGrid";
import { fetchCustomerIntakeOptions, intakeOptionsQueryKey } from "../../data/customerOrgs";
import { useSalesOrderForm } from "./useSalesOrderForm";
import type { DispatchOrder } from "../../types";

/**
 * WRITE UP A CUSTOMER ORDER — the same form we raise a sales order on (OD-14).
 *
 * A customer sends us an item, a quantity, a remark and which of our companies
 * they are buying from. Everything else on a sales order is still ours to decide,
 * and until now the only place to decide it was three comboboxes bolted to the top
 * of the credit-check modal. This is that work given a screen of its own, at the
 * point in the flow where our process actually starts.
 *
 * ⚠ IT IS NOT `EditOrder`, AND CANNOT BE. `canEditOrder` requires raiser / admin /
 *   coordinator, and on a customer order THE RAISER IS THE CUSTOMER — so the named
 *   recipient whose job this is never gets the Edit button, and
 *   `fms_dispatch_update_order` would refuse them anyway. The whole path is its
 *   own: its own permission (`canCompleteCustomerOrder`), its own RPC
 *   (`fms_dispatch_complete_customer_order`), and its own line writer.
 *
 * ⚠ THE COMPANY LIST COMES FROM THE SERVER, NOT FROM THE STORE. Only the companies
 *   of this customer's ticked ledgers are acceptable; the ledgers themselves never
 *   leave the server (Q11), and the RPC resolves which one to bill from whichever
 *   company is chosen.
 */
export default function CompleteCustomerOrder() {
  const { id = "" } = useParams();
  const s = useDispatchStore();
  const order = s.orderById(id);

  /*
    ⚠ THE FORM MOUNTS ONLY ONCE THE ORDER IS HERE, and that is why the guards sit
      in a wrapper rather than above a hook call in one component. Same trap as
      EditOrder: `useSalesOrderForm` seeds in a lazy `useState` that runs once, so
      calling it before the order has landed leaves the form empty for ever.
  */
  if (s.isLoading) return <p className="text-[13.5px] text-grey-2">Loading…</p>;
  if (!order) {
    if (s.isFetching) return <p className="text-[13.5px] text-grey-2">Loading…</p>;
    return <EmptyState title="Order not found" message="It may have been cancelled, or the link is stale." />;
  }
  if (order.intakeSource !== "customer") {
    return (
      <EmptyState
        title="This order was raised by our own team"
        message="Only an order a customer sent us is written up here. Use Edit order instead."
      />
    );
  }
  if (!s.canCompleteCustomerOrder(order)) {
    return (
      <EmptyState
        title="This order can no longer be written up"
        message="Its credit decision has been recorded, or it has already dispatched. Ask a coordinator if something needs correcting."
      />
    );
  }
  return <CompleteForm order={order} />;
}

function CompleteForm({ order }: { order: DispatchOrder }) {
  const s = useDispatchStore();
  const { user } = useSession();
  const nav = useNavigate();

  /** Reopened from credit check rather than picked up fresh out of the queue. */
  const reopening = order.status !== "awaiting_order_completion";

  const options = useQuery({
    queryKey: intakeOptionsQueryKey(order.id),
    queryFn: () => fetchCustomerIntakeOptions(order.id),
    staleTime: 5 * 60_000,
  });

  const f = useSalesOrderForm(order, {
    mode: "complete",
    companyChoices: options.data?.companies ?? [],
  });

  /*
    THE TWO PRE-FILLS THE CUSTOMER RECORD CARRIES, applied only into fields nobody
    has touched. All 24 sampled orders for both launch customers dispatched from
    the same site, so the common case should be a confirmation rather than a
    search. They are a shortcut, never a decision — decisions Q1 and Q2 stand, and
    both stay editable.

    ⚠ ONCE, ARMED BY A REF — not on every change of `options.data`. React-query
      hands back a new object identity on every refetch, and re-running this would
      stamp the customer's saved defaults back over whatever the clerk had just
      chosen. Same guard, for the same reason, as `CustomerIntakePanel`.
  */
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !options.data) return;
    seeded.current = true;
    const patch: Partial<typeof f.form> = {};
    if (!f.form.dispatchType && options.data.defaultDispatchType) {
      patch.dispatchType = options.data.defaultDispatchType;
    }
    // The site is seeded only once it is genuinely a site of the chosen company —
    // the same test the server applies. Seeding it against another company's site
    // would put a value in the box that the RPC then rejects.
    if (
      !f.form.locationId &&
      options.data.defaultLocationId &&
      f.form.companyId &&
      s.locationsForCompany(f.form.companyId).some((l) => l.id === options.data!.defaultLocationId)
    ) {
      patch.locationId = options.data.defaultLocationId;
    }
    if (Object.keys(patch).length) f.patch(patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.data]);

  const submit = async () => {
    const problem = f.validate();
    if (problem) { f.setError(problem); return; }
    f.setBusy(true);
    f.setError(null);
    try {
      await s.completeCustomerOrder(order.id, f.toInput(user.name));
      nav(`/order-to-dispatch/orders/${order.id}`);
    } catch (e) {
      f.setError(e instanceof Error ? e.message : "Could not save the order.");
      f.setBusy(false);
    }
  };

  return (
    <div className="space-y-5 max-w-6xl">
      <div>
        <h1 className="text-[22px] font-bold text-navy">
          {reopening ? `Reopen ${order.orderNo}` : `Complete ${order.orderNo}`}
        </h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          {reopening ? (
            <>
              Changing the details of a customer order already with credit check. Saving sends it
              back through, and the customer can no longer change it themselves.
            </>
          ) : (
            <>
              <span className="font-semibold text-ink">{order.requesterName}</span> sent this order
              themselves. Fill in what they do not see, then save it on to credit check.
            </>
          )}
        </p>
      </div>

      {options.isError && (
        <p className="text-[13px] font-medium text-ryg-red">
          Could not load which companies may bill this customer. Reload the page and try again.
        </p>
      )}

      <Card className="p-5">
        <SalesOrderFields f={f} />
      </Card>

      <Card className="p-5 space-y-3">
        <SectionHeading>Items</SectionHeading>
        {/*
          ⚠ EDITABLE, ON PURPOSE. What the customer sent is a request, not a
            finished sales order — quantities get agreed on the phone, and an item
            they could not find gets added here rather than sent back to them.
            `fms_dispatch_replace_customer_lines` still refuses anything outside
            what that customer may order, so this widens nothing.
        */}
        <OrderLinesGrid
          rows={f.lines}
          onRowsChange={f.setLines}
          customerId={f.form.customerId}
          itemType={f.itemType}
          onMapItem={(typed) => f.setMapping({ search: typed })}
          requested={f.requested?.from === "lines" ? f.requested.text : null}
        />
      </Card>

      {f.error && <p className="text-[13px] font-medium text-ryg-red">{f.error}</p>}

      <div className="flex gap-3">
        <Button onClick={submit} disabled={f.busy || options.isLoading}>
          {f.busy ? "Saving…" : reopening ? "Save the changes" : "Complete and send to credit check"}
        </Button>
        <Button variant="ghost" onClick={() => nav(-1)} disabled={f.busy}>Cancel</Button>
      </div>
    </div>
  );
}
