import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import OrderDeskShell from "../components/OrderDeskShell";
import OrderForm from "../components/OrderForm";
import { useCustomer } from "../CustomerOrdersApp";
import { callUs } from "../lib/customerLabels";
import {
  LEDGERS_QK, fetchDeskLedgers, fetchDeskItems, itemsQueryKey, submitDeskOrder,
  ORDERS_QK, type DeskLineInput,
} from "../data/orderDesk";
import { deskPaths } from "../lib/paths";
import { useDeskDrafts } from "../lib/deskDrafts";

/**
 * Place an order — the screen the whole module exists for.
 *
 * Their name and where they take delivery are printed as TEXT, not offered as
 * fields (Q2). The site the goods leave from and how they travel are ours to
 * decide and are filled in at our end; neither appears here.
 *
 * ⚠ WHICH OF THEIR FIRMS IS ORDERING IS THEIRS TO ANSWER; WHICH OF OUR BOOKS
 *   BILLS IT IS NOT (OD-17). OD-14 asked them to pick one of our companies, and
 *   OD-16 only renamed it. Now the picker lists their own ledgers as ticked in
 *   Setup → Customer Logins, the item list follows that firm, and the company
 *   is chosen by our team on Complete Customer Order.
 */
export default function PlaceOrder() {
  const customer = useCustomer();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [placed, setPlaced] = useState<string | null>(null);
  const [ledgerId, setLedgerId] = useState<string>("");

  /*
    DRAFTS. "Continue" on My orders → Drafts lands here as ?draft=<id>; the draft
    is opened once the list has loaded, its company chosen, and the form remounted
    on its lines (the `key`). Placing the order deletes the draft.
  */
  const drafts = useDeskDrafts();
  const [searchParams, setSearchParams] = useSearchParams();
  const wantDraft = searchParams.get("draft");
  const [loaded, setLoaded] = useState<{ key: string; lines: DeskLineInput[]; remarks: string } | null>(null);
  const [draftErr, setDraftErr] = useState("");

  useEffect(() => {
    if (!wantDraft || drafts.loading || !ledgers.data) return;
    const d = drafts.mine.find((x) => x.id === wantDraft);
    setSearchParams({}, { replace: true });
    if (!d) { setDraftErr("That draft is no longer saved — it may have been placed or discarded."); return; }
    void drafts.open(d).then(({ payload }) => {
      if (ledgers.data!.some((l) => l.ledgerId === payload.ledgerId)) setLedgerId(payload.ledgerId);
      setLoaded({ key: d.id, lines: payload.lines ?? [], remarks: payload.remarks ?? "" });
    }).catch((e) => setDraftErr((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantDraft, drafts.loading, ledgers.data]);

  const ledgers = useQuery({
    queryKey: LEDGERS_QK,
    queryFn: fetchDeskLedgers,
    staleTime: 10 * 60_000,
  });

  /*
    The first firm is chosen for them, because most customers are one firm and
    a required field they never change is a required field that should not be
    asked. They can still change it; it is a default, not a decision made for them.
  */
  useEffect(() => {
    if (!ledgerId && ledgers.data?.length) setLedgerId(ledgers.data[0].ledgerId);
  }, [ledgers.data, ledgerId]);

  const { data: items, isLoading, error } = useQuery({
    queryKey: itemsQueryKey(null, ledgerId || null),
    queryFn: () => fetchDeskItems(null, ledgerId || null),
    enabled: !!ledgerId,
    staleTime: 10 * 60_000,
  });

  const itemName = useMemo(() => new Map((items ?? []).map((i) => [i.itemId, i.name])), [items]);

  const saveDraft = async (lines: DeskLineInput[], remarks: string) => {
    const names = lines.map((l) => itemName.get(l.itemId)).filter(Boolean) as string[];
    await drafts.save({
      title: names.length
        ? names.slice(0, 2).join(", ") + (names.length > 2 ? ` +${names.length - 2} more` : "")
        : "Note only",
      summary: lines.map((l) => `${itemName.get(l.itemId) ?? "Item"} — ${l.quantity || "?"}`),
      payload: { ledgerId, lines, remarks },
    });
  };

  const place = async (lines: DeskLineInput[], remarks: string) => {
    await submitDeskOrder({ ledgerId, orderRemarks: remarks, lines });
    // The draft it came from has done its job.
    await drafts.finish();
    setLoaded(null);
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
          {/*
            ⚠ "UNTIL WE ACCEPT IT" IS THE DEADLINE, and it has to be the same words
              the order page uses. It used to read "until we start preparing it",
              which named one of our steps and, worse, named the wrong moment — the
              window shuts when we ACCEPT the order, which is before anybody starts
              preparing anything.
          */}
          <p className="text-[14px] text-grey mt-2 leading-relaxed">
            Our team has been told and will get on with it. You can follow it, change it
            or cancel it under <span className="font-semibold text-ink">My orders</span> until
            we accept it.
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

  const loadingAnything = ledgers.isLoading || (!!ledgerId && isLoading);
  const failed = ledgers.error || error;
  // No firm, or no item chosen for them in Setup — either way nothing to order.
  const noLedgers =
    (!ledgers.isLoading && !ledgers.error && (ledgers.data?.length ?? 0) === 0) ||
    (!!ledgerId && !isLoading && !error && (items?.length ?? 0) === 0);

  return (
    <OrderDeskShell title="Place an order" subtitle={subtitle}>
      {failed ? (
        <div className="rounded-2xl border border-[#f6d2d3] bg-[#FDECEC] p-6 text-[14px] text-[#B3282C]">
          We could not load your items just now. Please refresh the page, and {callUs("call us")} if
          it keeps happening.
        </div>
      ) : noLedgers ? (
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
        <div className="space-y-4">
          {draftErr ? (
            <div className="rounded-xl border border-[#f6d2d3] bg-[#FDECEC] px-4 py-3 text-[13.5px] text-[#B3282C]">{draftErr}</div>
          ) : null}
          {loaded ? (
            <div className="rounded-xl border border-line bg-[#FBFCFE] px-4 py-3 text-[13.5px] text-grey flex flex-wrap items-center gap-3">
              <span>You are continuing a saved draft.</span>
              <button
                type="button"
                onClick={() => { drafts.detach(); setLoaded(null); }}
                className="font-semibold text-orange hover:text-orange-2"
              >
                Start a new order instead
              </button>
            </div>
          ) : drafts.mine.length > 0 ? (
            <div className="rounded-xl border border-line bg-[#FBFCFE] px-4 py-3 text-[13.5px] text-grey">
              You have {drafts.mine.length} saved draft{drafts.mine.length === 1 ? "" : "s"}.{" "}
              <Link to={`${deskPaths.orders}?folder=drafts`} className="font-semibold text-orange hover:text-orange-2">
                Open my drafts
              </Link>
            </div>
          ) : null}
          <OrderForm
            key={loaded?.key ?? "new"}
            items={items ?? []}
            ledgers={ledgers.data ?? []}
            ledgerId={ledgerId}
            onLedgerChange={setLedgerId}
            // A draft line whose item is no longer on their list is dropped, not shown blank.
            initialLines={loaded?.lines.filter((l) => itemName.has(l.itemId))}
            initialRemarks={loaded?.remarks}
            submitLabel="Place this order"
            busyLabel="Placing…"
            onSubmit={place}
            onSaveDraft={saveDraft}
          />
        </div>
      )}
    </OrderDeskShell>
  );
}
