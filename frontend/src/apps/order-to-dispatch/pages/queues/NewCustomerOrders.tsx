import { Link, useNavigate } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import StageTabs from "@/shared/components/ui/StageTabs";
import { useStageMode } from "@/shared/lib/useStageMode";
import { formatDateTime } from "@/shared/lib/time";
import { useDispatchStore } from "../../store";
import { dmy } from "../../lib/format";
import type { DispatchOrder } from "../../types";

/** What `useStageMode` needs to offer its "mine / everyone" filter. */
interface DoneRow {
  id: string;
  order: DispatchOrder;
  actorId: string | null;
  atIso: string;
}

/**
 * NEW CUSTOMER ORDERS — what a customer sent us, waiting to be written up (OD-14).
 *
 * Our process starts at a sales order. When the customer places one themselves it
 * should start in the same place, and be finished on the same form, rather than
 * arriving mid-flow as a credit-check row with a blank company and "Not yet
 * decided" for its dispatch type.
 *
 * ⚠ NOT a `StageQueue`. That component renders the five chain steps off
 *   `STEP_CONFIG[stepKey]` and `store.myQueue(step)`, and this is not one of them —
 *   it is completed by a page and its own RPC, not by `StepModal`, so it has no
 *   `RECORD_RPC`, no `LOCK` arm and no `STEP_CONFIG` to give. Hand-built out of the
 *   same shared parts (StageTabs, useStageMode, QueueTable) so it reads and behaves
 *   like every other queue, exactly as Sales Return is.
 *
 * ⚠ WHO SEES IT IS NOT THE STEP-OWNER RULE. A customer order has `location_id` null
 *   until this screen fills one in, and `fms_dispatch_can_see_order`'s owner arm
 *   matches only the fallback owner-set on a null location — which holds ZERO
 *   people. RLS hands a step owner no rows at all here. What matches is the
 *   customer-recipient arm: the people named per customer in Setup under "who we
 *   tell when they order" (decision Q8), plus admins and coordinators.
 *   `store.customerOrdersPending` applies exactly that, and the server's
 *   `fms_dispatch_complete_customer_order` enforces the same rule again.
 *
 * ⚠ NO DUE COLUMN. Every other queue has an SLA an admin can tune under Setup →
 *   Due Dates; this one has no row there, because it is not in `STEPS`. Painting a
 *   row overdue would be the app inventing a deadline it has no way to know.
 *
 * FLAT — no `groupBy`, per the standing rule for FMS list views. Customer is an
 * ordinary sortable, filterable column instead.
 */
export default function NewCustomerOrders() {
  const s = useDispatchStore();
  const nav = useNavigate();
  const B = "/order-to-dispatch";

  const pending = s.customerOrdersPending;
  const completed: DoneRow[] = s.customerOrdersCompleted.map((o) => ({
    id: o.id,
    order: o,
    // Who wrote it up. `fms_dispatch_complete_customer_order` stamps both.
    actorId: o.editedBy,
    atIso: o.editedAt ?? "",
  }));
  const stage = useStageMode<DoneRow>(completed, s.userId);

  const orderCell = (o: DispatchOrder) => (
    <Link to={`${B}/orders/${o.id}`} className="font-semibold text-navy hover:text-orange">
      {o.orderNo}
    </Link>
  );

  const itemsCell = (o: DispatchOrder) => {
    const n = o.lines?.length ?? 0;
    return `${n} ${n === 1 ? "item" : "items"}`;
  };

  /*
    The company is on the row because the CUSTOMER chose it, and it is the first
    thing the person writing the order up needs to know — it decides the site they
    are about to pick and the book it will be billed from.
  */
  const shared: QueueColumn<DispatchOrder>[] = [
    {
      key: "order",
      header: "Order",
      cell: orderCell,
      sortValue: (o) => o.orderNo,
      filter: { kind: "select", get: (o) => o.orderNo },
    },
    {
      key: "customer",
      header: "Customer",
      cell: (o) => (
        <div>
          <div className="text-ink">{o.requesterName}</div>
          {o.customerLocation && <div className="text-[12px] text-grey-2">{o.customerLocation}</div>}
        </div>
      ),
      sortValue: (o) => o.requesterName,
      filter: { kind: "select", get: (o) => o.requesterName },
    },
    {
      key: "company",
      header: "Buying from",
      cell: (o) => s.masterName("company", o.companyId),
      sortValue: (o) => s.masterName("company", o.companyId),
      filter: { kind: "select", get: (o) => s.masterName("company", o.companyId) },
    },
    {
      key: "items",
      header: "Items",
      align: "right",
      cell: itemsCell,
      sortValue: (o) => o.lines?.length ?? 0,
      filter: { kind: "number", get: (o) => o.lines?.length ?? 0 },
    },
    {
      key: "placed",
      header: "Placed",
      cell: (o) => dmy(o.submittedAt),
      sortValue: (o) => o.submittedAt ?? "",
      filter: { kind: "date", get: (o) => o.submittedAt ?? "" },
    },
  ];

  const pendingColumns: QueueColumn<DispatchOrder>[] = shared;

  const completedColumns: QueueColumn<DoneRow>[] = [
    ...shared.map((c) => ({
      ...c,
      cell: (r: DoneRow) => (c.cell as (o: DispatchOrder) => unknown)(r.order),
      sortValue: c.sortValue ? (r: DoneRow) => c.sortValue!(r.order) : undefined,
      filter: c.filter
        ? { ...c.filter, get: (r: DoneRow) => (c.filter as any).get(r.order) }
        : undefined,
    })) as QueueColumn<DoneRow>[],
    {
      key: "completedAt",
      header: "Written up",
      cell: (r) => (r.atIso ? formatDateTime(r.atIso) : "—"),
      sortValue: (r) => r.atIso,
      filter: { kind: "date", get: (r) => r.atIso },
    },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] font-bold text-navy">New Customer Orders</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          Orders customers placed themselves. Open one to fill in the site, how it travels and
          anything else, then send it on to credit check.
        </p>
      </div>

      <StageTabs
        mode={stage.mode}
        onMode={stage.setMode}
        pendingCount={pending.length}
        completedCount={stage.rows.length}
      />

      {stage.mode === "pending" ? (
        <QueueTable
          rows={pending}
          rowKey={(o) => o.id}
          columns={pendingColumns}
          loading={s.isLoading}
          rowsLabel="orders"
          emptyTitle="No customer orders waiting"
          emptyMessage="When a customer places an order it lands here to be written up."
          initialSort={{ key: "placed", dir: "asc" }}
          actions={(o) => (
            <Button size="sm" onClick={() => nav(`${B}/orders/${o.id}/complete`)}>
              Complete this order
            </Button>
          )}
        />
      ) : (
        <QueueTable
          rows={stage.rows}
          rowKey={(r) => r.id}
          columns={completedColumns}
          loading={s.isLoading}
          rowsLabel="orders"
          emptyTitle="Nothing written up yet"
          emptyMessage="Completed customer orders stay here until credit check decides them."
          initialSort={{ key: "completedAt", dir: "desc" }}
          actions={(r) =>
            s.canCompleteCustomerOrder(r.order) ? (
              /*
                REOPEN, not "edit". The order has moved on to credit check, and the
                clerk there may still need it billed under another book for a
                credit reason — the choice they lost when the customer began making
                it. The server allows it only while the verdict is undecided and
                nothing has dispatched.
              */
              <Button size="sm" variant="ghost" onClick={() => nav(`${B}/orders/${r.order.id}/complete`)}>
                Reopen details
              </Button>
            ) : null
          }
        />
      )}
    </div>
  );
}
