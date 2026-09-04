import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import OrderDeskShell from "../components/OrderDeskShell";
import OrderForm from "../components/OrderForm";
import { useCustomer } from "../CustomerOrdersApp";
import { callUs } from "../lib/customerLabels";
import {
  fetchDeskItems, submitDeskOrder, ITEMS_QK, ORDERS_QK, type DeskLineInput,
} from "../data/orderDesk";

/**
 * Place an order — the screen the whole module exists for.
 *
 * Their name and where they take delivery are printed as TEXT, not offered as
 * fields (Q2). The billing company, the site the goods leave from and how they
 * travel are ours to decide and are filled in at our end; none of the three
 * appears here, and the customer is not told they exist.
 */
export default function PlaceOrder() {
  const customer = useCustomer();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [placed, setPlaced] = useState<string | null>(null);

  const { data: items, isLoading, error } = useQuery({
    queryKey: ITEMS_QK,
    queryFn: fetchDeskItems,
    staleTime: 10 * 60_000,
  });

  const place = async (lines: DeskLineInput[], remarks: string) => {
    await submitDeskOrder({ orderRemarks: remarks, lines });
    // Await both: the next screen this customer opens is "My orders", and it must
    // not open on a list that predates the order they just placed.
    await qc.invalidateQueries({ queryKey: ORDERS_QK });
    setPlaced("done");
  };

  const subtitle = (
    <>
      {customer.displayName}
      {customer.customerLocation ? <span className="text-grey-2"> · {customer.customerLocation}</span> : null}
    </>
  );

  if (placed) {
    return (
      <OrderDeskShell title="Thank you" subtitle={subtitle}>
        <div className="rounded-2xl border border-line bg-white p-8 max-w-2xl">
          <div className="w-11 h-11 rounded-full bg-[#E9F7EF] text-[#1B7F45] grid place-items-center mb-4">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 13 4 4L19 7" />
            </svg>
          </div>
          <p className="text-[16px] font-semibold">We have your order.</p>
          <p className="text-[14px] text-grey mt-2 leading-relaxed">
            Our team has been told and will get on with it. You can follow it, change it
            or cancel it under <span className="font-semibold text-ink">My orders</span> until
            we start preparing it.
          </p>
          <div className="flex gap-3 mt-6">
            <button
              onClick={() => navigate("orders")}
              className="text-[14px] font-semibold text-white bg-orange-grad shadow-cta rounded-xl px-5 py-2.5"
            >
              See my orders
            </button>
            <button
              onClick={() => setPlaced(null)}
              className="text-[14px] font-semibold text-navy bg-white border border-line shadow-soft rounded-xl px-5 py-2.5"
            >
              Place another order
            </button>
          </div>
        </div>
      </OrderDeskShell>
    );
  }

  return (
    <OrderDeskShell title="Place an order" subtitle={subtitle}>
      {isLoading ? (
        <div className="rounded-2xl border border-line bg-white p-8 text-[14px] text-grey">Loading your items…</div>
      ) : error ? (
        <div className="rounded-2xl border border-[#f6d2d3] bg-[#FDECEC] p-6 text-[14px] text-[#B3282C]">
          We could not load your items just now. Please refresh the page, and {callUs("call us")} if
          it keeps happening.
        </div>
      ) : !items || items.length === 0 ? (
        /*
          An empty picker is not an empty state to shrug at — it means this customer
          cannot place an order at all, and no amount of trying will help. Setup
          refuses to activate a customer with no mapped items for exactly this
          reason, so reaching here means something changed afterwards.
        */
        <div className="rounded-2xl border border-line bg-white p-8 max-w-2xl">
          <p className="text-[15px] font-semibold">There is nothing on your list yet.</p>
          <p className="text-[14px] text-grey mt-2 leading-relaxed">
            {callUs("Please call us")} and we will add the items you buy. You will be able to
            order as soon as they are on.
          </p>
        </div>
      ) : (
        <OrderForm
          items={items}
          submitLabel="Place this order"
          busyLabel="Placing…"
          onSubmit={place}
        />
      )}
    </OrderDeskShell>
  );
}
