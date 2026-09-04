import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { TextInput } from "@/shared/components/ui/Form";
import { cn } from "@/shared/lib/cn";
import OrderDeskShell from "../components/OrderDeskShell";
import { useCustomer } from "../CustomerOrdersApp";
import { customerStatus, callUs, type CustomerStatusKey } from "../lib/customerLabels";
import { fetchDeskOrders, ORDERS_QK, type DeskOrder } from "../data/orderDesk";

/**
 * My orders.
 *
 * ⚠ CARDS, NOT `QueueTable`, AND THAT IS A DECISION RATHER THAN A SHORTCUT. The
 *   house rule is that every GRID sorts and filters on every column — it exists so
 *   a clerk can find one row in a live queue of hundreds. What the rule is really
 *   asking for is that a reader can always narrow a list, and that need is answered
 *   directly below: a status filter and a search across the order number and the
 *   items on it.
 *
 *   The staff grid itself is the wrong body for this screen. It brings a column
 *   picker, an Excel export and a pagination strip to a customer who has four
 *   orders, and it is a horizontally-scrolling table on the phone that most of
 *   these customers will read it on. An order here is four facts and a list of
 *   items; a card shows all of them at once and a row does not.
 */

const FILTERS: { key: "all" | CustomerStatusKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "placed", label: "Placed" },
  { key: "preparing", label: "Being prepared" },
  { key: "part_dispatched", label: "Partly dispatched" },
  { key: "dispatched", label: "Dispatched" },
  { key: "delivered", label: "Delivered" },
  { key: "cancelled", label: "Cancelled" },
];

/** "12 Aug 2026" from an ISO date, with no timezone shifting it a day. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function orderDate(iso: string | null): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${parseInt(m[3], 10)} ${MONTHS[parseInt(m[2], 10) - 1]} ${m[1]}` : "—";
}

export function StatusPill({ statusKey }: { statusKey: string }) {
  const s = customerStatus(statusKey);
  return (
    <span className={cn("inline-block rounded-full border px-2.5 py-1 text-[12px] font-semibold", s.tone)}>
      {s.label}
    </span>
  );
}

/** What the order is FOR, in one line — the first three items, then a count. */
export function itemSummary(o: DeskOrder): string {
  if (o.lines.length === 0) return "No items";
  const names = o.lines.slice(0, 3).map((l) => l.name);
  const rest = o.lines.length - names.length;
  return names.join(", ") + (rest > 0 ? ` +${rest} more` : "");
}

export default function MyOrders() {
  const customer = useCustomer();
  const [tab, setTab] = useState<"all" | CustomerStatusKey>("all");
  const [q, setQ] = useState("");

  const { data: orders, isLoading, error } = useQuery({
    queryKey: ORDERS_QK,
    queryFn: fetchDeskOrders,
    staleTime: 30_000,
  });

  /**
   * The filter chips offer only what is actually there — plus "All", always.
   *
   * A chip that can only ever produce an empty list is a dead control, and this
   * list is short enough that a customer will try every one of them.
   */
  const tabs = useMemo(() => {
    const present = new Set((orders ?? []).map((o) => o.statusKey));
    return FILTERS.filter((f) => f.key === "all" || present.has(f.key));
  }, [orders]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (orders ?? []).filter((o) => {
      if (tab !== "all" && o.statusKey !== tab) return false;
      if (!needle) return true;
      return (
        o.orderNo.toLowerCase().includes(needle) ||
        o.lines.some((l) => l.name.toLowerCase().includes(needle))
      );
    });
  }, [orders, tab, q]);

  return (
    <OrderDeskShell title="My orders" subtitle={customer.displayName}>
      {isLoading ? (
        <div className="rounded-2xl border border-line bg-white p-8 text-[14px] text-grey">Loading…</div>
      ) : error ? (
        <div className="rounded-2xl border border-[#f6d2d3] bg-[#FDECEC] p-6 text-[14px] text-[#B3282C]">
          We could not load your orders just now. Please refresh the page, and {callUs("call us")} if
          it keeps happening.
        </div>
      ) : (orders ?? []).length === 0 ? (
        <div className="rounded-2xl border border-line bg-white p-8 max-w-2xl">
          <p className="text-[15px] font-semibold">You have not placed an order yet.</p>
          <p className="text-[14px] text-grey mt-2">
            Everything you order will be listed here, with where it has got to.
          </p>
          <Link
            to=".."
            relative="path"
            className="inline-block mt-5 text-[14px] font-semibold text-white bg-orange-grad shadow-cta rounded-xl px-5 py-2.5"
          >
            Place an order
          </Link>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-5">
            {tabs.map((f) => (
              <button
                key={f.key}
                onClick={() => setTab(f.key)}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-[13px] font-semibold border transition",
                  tab === f.key
                    ? "bg-navy text-white border-navy"
                    : "bg-white text-grey border-line hover:text-ink"
                )}
              >
                {f.label}
              </button>
            ))}
            <div className="ml-auto w-full sm:w-64">
              <TextInput
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search order number or item"
              />
            </div>
          </div>

          {shown.length === 0 ? (
            /*
              An empty RESULT, never an empty screen: the chips and the search box
              stay exactly where they are, because they are the only way back. See
              the house rule about swapping a filtered-empty table for a full-page
              empty state — it takes away the control that caused it.
            */
            <div className="rounded-2xl border border-line bg-white p-8 text-center">
              <p className="text-[14px] text-grey">Nothing matches what you are looking for.</p>
              <button
                onClick={() => { setTab("all"); setQ(""); }}
                className="mt-3 text-[13.5px] font-semibold text-orange hover:text-orange-2"
              >
                Show all my orders
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {shown.map((o) => (
                <Link
                  key={o.id}
                  to={o.id}
                  className="block rounded-2xl border border-line bg-white p-5 hover:border-[#d9e2f0] hover:shadow-soft transition"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-[15px] font-bold tracking-tight">{o.orderNo}</span>
                        <StatusPill statusKey={o.statusKey} />
                        {o.canChange ? (
                          <span className="text-[12px] font-semibold text-orange">Still changeable</span>
                        ) : null}
                      </div>
                      <p className="text-[13.5px] text-grey mt-1.5 truncate">{itemSummary(o)}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[13px] text-grey-2">{orderDate(o.orderDate)}</div>
                      <div className="text-[12.5px] text-grey-2 mt-0.5">
                        {o.lines.length} item{o.lines.length === 1 ? "" : "s"}
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </OrderDeskShell>
  );
}
