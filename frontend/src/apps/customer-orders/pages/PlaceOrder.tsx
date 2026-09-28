import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import OrderDeskShell from "../components/OrderDeskShell";
import OrderForm from "../components/OrderForm";
import { useCustomer } from "../CustomerOrdersApp";
import { callUs } from "../lib/customerLabels";
import {
  COMPANIES_QK, fetchDeskCompanies, fetchDeskItems, itemsQueryKey, submitDeskOrder,
  ORDERS_QK, type DeskLineInput,
} from "../data/orderDesk";
import { deskPaths } from "../lib/paths";

/**
 * Place an order — the screen the whole module exists for.
 *
 * Their name and where they take delivery are printed as TEXT, not offered as
 * fields (Q2). The site the goods leave from and how they travel are ours to
 * decide and are filled in at our end; neither appears here.
 *
 * ⚠ WHICH OF OUR COMPANIES THEY ARE BUYING FROM IS THEIRS TO ANSWER (OD-14).
 *   Decision Q1 sent that question to credit check on the grounds that guessing it
 *   would be wrong half the time — both named customers split roughly 50/50 across
 *   two books. Asking the customer is not a guess: they know who invoices them, and
 *   the answer decides which items can be billed to them at all.
 *
 * ⚠ Q11 STILL STANDS. They see our COMPANY names, which are on every invoice we
 *   send them. The ticked LEDGER list behind those companies never leaves the
 *   server, and this app still reads no table.
 */
export default function PlaceOrder() {
  const customer = useCustomer();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [placed, setPlaced] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string>("");

  const companies = useQuery({
    queryKey: COMPANIES_QK,
    queryFn: fetchDeskCompanies,
    staleTime: 10 * 60_000,
  });

  /*
    The richest book leads (the server orders them that way) and is chosen for
    them, because for most customers it is the only one they ever use and a
    required field they never change is a required field that should not be asked.
    They can still change it; it is a default, not a decision made for them.
  */
  useEffect(() => {
    if (!companyId && companies.data?.length) setCompanyId(companies.data[0].companyId);
  }, [companies.data, companyId]);

  const { data: items, isLoading, error } = useQuery({
    queryKey: itemsQueryKey(companyId || null),
    queryFn: () => fetchDeskItems(companyId || null),
    enabled: !!companyId,
    staleTime: 10 * 60_000,
  });

  const place = async (lines: DeskLineInput[], remarks: string) => {
    await submitDeskOrder({ companyId, orderRemarks: remarks, lines });
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
              onClick={() => navigate(deskPaths.orders)}
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

  const loadingAnything = companies.isLoading || (!!companyId && isLoading);
  const failed = companies.error || error;
  const noCompanies = !companies.isLoading && !companies.error && (companies.data?.length ?? 0) === 0;

  return (
    <OrderDeskShell title="Place an order" subtitle={subtitle}>
      {failed ? (
        <div className="rounded-2xl border border-[#f6d2d3] bg-[#FDECEC] p-6 text-[14px] text-[#B3282C]">
          We could not load your items just now. Please refresh the page, and {callUs("call us")} if
          it keeps happening.
        </div>
      ) : noCompanies ? (
        /*
          Nothing to order from at all. Setup refuses to switch a customer on
          without a mapped item, so reaching here means something changed
          afterwards — it is not a state to shrug at with an empty dropdown.
        */
        <div className="rounded-2xl border border-line bg-white p-8 max-w-2xl">
          <p className="text-[15px] font-semibold">There is nothing on your list yet.</p>
          <p className="text-[14px] text-grey mt-2 leading-relaxed">
            {callUs("Please call us")} and we will add the items you buy. You will be able to
            order as soon as they are on.
          </p>
        </div>
      ) : loadingAnything ? (
        <div className="rounded-2xl border border-line bg-white p-8 text-[14px] text-grey">Loading your items…</div>
      ) : (
        <OrderForm
          items={items ?? []}
          companies={companies.data ?? []}
          companyId={companyId}
          onCompanyChange={setCompanyId}
          submitLabel="Place this order"
          busyLabel="Placing…"
          onSubmit={place}
        />
      )}
    </OrderDeskShell>
  );
}
