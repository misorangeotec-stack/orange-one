import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { TextInput } from "@/shared/components/ui/Form";
import { cn } from "@/shared/lib/cn";
import OrderDeskShell from "../components/OrderDeskShell";
import { useCustomer } from "../CustomerOrdersApp";
import { customerStatus, callUs, CUSTOMER_STATUS, type CustomerStatusKey } from "../lib/customerLabels";
import { fetchDeskOrders, ORDERS_QK, type DeskOrder } from "../data/orderDesk";
import { deskPaths } from "../lib/paths";
import { savedLabel, useDeskDrafts } from "../lib/deskDrafts";

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

/**
 * ⚠ ONE TAB PER STATE, IN THE ORDER AN ORDER PASSES THROUGH THEM — not alphabetical
 *   and not by how often each is used. The row doubles as the customer's picture of
 *   the journey, so Cancelled goes last: it is where an order leaves the line, not
 *   a stage on it.
 *
 *   Labels are NOT repeated from `CUSTOMER_STATUS` by hand. Drifting copy between
 *   a filter tab and the pill it filters for is the exact bug this file caused when
 *   the eight states became four — the tabs still read "Being prepared" for a key
 *   the server had stopped sending, so the tab was permanently empty and nothing
 *   said why.
 */
const FILTERS: { key: "all" | CustomerStatusKey; label: string }[] = [
  { key: "all", label: "All" },
  ...(["request_raised", "accepted", "out_for_delivery", "delivered", "cancelled"] as const).map(
    (key) => ({ key, label: CUSTOMER_STATUS[key].label }),
  ),
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

type Folder = "all" | CustomerStatusKey | "drafts";

/**
 * THE INBOX (OD-18). A panel of folders down the side — every state with its
 * count, and Drafts — so a customer sees at a glance how many orders they have
 * placed, how many are on their way, how many they cancelled, and what they
 * saved without placing. On a phone the panel becomes a row above the list.
 *
 * ⚠ EVERY FOLDER SHOWS, ZEROES INCLUDED. The old chips hid empty states because a
 *   chip that only ever filters to nothing is a dead control. Here the count IS
 *   the information — "Cancelled 0" answers a question the customer asked — so a
 *   zero is greyed, not hidden.
 */
export default function MyOrders() {
  const customer = useCustomer();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const folder = (searchParams.get("folder") as Folder | null) ?? "all";
  const setFolder = (f: Folder) => setSearchParams(f === "all" ? {} : { folder: f }, { replace: true });
  const [q, setQ] = useState("");

  const { data: orders, isLoading, error } = useQuery({
    queryKey: ORDERS_QK,
    queryFn: fetchDeskOrders,
    staleTime: 30_000,
  });
  const drafts = useDeskDrafts();

  const counts = useMemo(() => {
    const by = new Map<string, number>();
    (orders ?? []).forEach((o) => by.set(o.statusKey, (by.get(o.statusKey) ?? 0) + 1));
    return by;
  }, [orders]);

  /** The three numbers a customer asks about first. */
  const stats = useMemo(() => {
    const all = orders ?? [];
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    return {
      placed: all.length,
      thisMonth: all.filter((o) => (o.orderDate ?? "").startsWith(ym)).length,
      last: all.reduce<string | null>((m, o) => (o.orderDate && (!m || o.orderDate > m) ? o.orderDate : m), null),
    };
  }, [orders]);

  const folders: { key: Folder; label: string; count: number }[] = [
    { key: "all", label: "All orders", count: orders?.length ?? 0 },
    ...FILTERS.filter((f) => f.key !== "all").map((f) => ({
      key: f.key as Folder,
      label: f.label,
      count: counts.get(f.key) ?? 0,
    })),
    { key: "drafts", label: "Drafts", count: drafts.mine.length },
  ];

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (orders ?? []).filter((o) => {
      if (folder !== "all" && folder !== "drafts" && o.statusKey !== folder) return false;
      if (!needle) return true;
      return (
        o.orderNo.toLowerCase().includes(needle) ||
        o.lines.some((l) => l.name.toLowerCase().includes(needle))
      );
    });
  }, [orders, folder, q]);

  const shownDrafts = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return drafts.mine.filter(
      (d) =>
        !needle ||
        d.title.toLowerCase().includes(needle) ||
        d.summary.some((s) => s.toLowerCase().includes(needle)),
    );
  }, [drafts.mine, q]);

  const [draftErr, setDraftErr] = useState("");
  const discardDraft = async (d: (typeof drafts.mine)[number]) => {
    if (!window.confirm(`Discard the draft "${d.title || "Untitled"}"? This cannot be undone.`)) return;
    setDraftErr("");
    try {
      await drafts.discard(d);
    } catch (e) {
      setDraftErr((e as Error).message);
    }
  };

  const nothingAtAll = !isLoading && !drafts.loading && (orders ?? []).length === 0 && drafts.mine.length === 0;

  return (
    <OrderDeskShell title="My orders" subtitle={customer.displayName}>
      {isLoading ? (
        <div className="rounded-2xl border border-line bg-white p-8 text-[14px] text-grey">Loading…</div>
      ) : error ? (
        <div className="rounded-2xl border border-[#f6d2d3] bg-[#FDECEC] p-6 text-[14px] text-[#B3282C]">
          We could not load your orders just now. Please refresh the page, and {callUs("call us")} if
          it keeps happening.
        </div>
      ) : nothingAtAll ? (
        <div className="rounded-2xl border border-line bg-white p-8 max-w-2xl">
          <p className="text-[15px] font-semibold">You have not placed an order yet.</p>
          <p className="text-[14px] text-grey mt-2">
            Everything you order will be listed here, with where it has got to.
          </p>
          <Link
            to={deskPaths.place}
            className="inline-block mt-5 text-[14px] font-semibold text-white bg-orange-grad shadow-cta rounded-xl px-5 py-2.5"
          >
            Place an order
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-[230px_minmax(0,1fr)]">
          {/* ---- the panel ---- */}
          <aside className="min-w-0 space-y-3">
            <div className="rounded-2xl border border-line bg-white p-4 grid grid-cols-3 md:grid-cols-1 gap-3 shadow-soft">
              <Stat label="Orders placed" value={String(stats.placed)} accent="#00AEEF" />
              <Stat label="This month" value={String(stats.thisMonth)} accent="#EC008C" />
              <Stat label="Last order" value={stats.last ? orderDate(stats.last) : "—"} accent="#F6891F" />
            </div>
            <nav className="rounded-2xl border border-line bg-white p-2 flex md:flex-col gap-1 overflow-x-auto shadow-soft">
              {folders.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFolder(f.key)}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-[13.5px] font-semibold whitespace-nowrap transition",
                    f.key === "drafts" && "md:mt-1 md:border-t md:border-line md:rounded-t-none md:pt-3",
                    folder === f.key ? "bg-navy text-white" : "text-ink hover:bg-[#F3F6FB]",
                  )}
                >
                  <span>{f.label}</span>
                  <span
                    className={cn(
                      "min-w-[1.75rem] rounded-full px-2 py-0.5 text-center text-[12px]",
                      folder === f.key ? "bg-white/20 text-white" : f.count ? "bg-[#EEF2F8] text-navy" : "text-grey-2",
                    )}
                  >
                    {f.count}
                  </span>
                </button>
              ))}
            </nav>
          </aside>

          {/* ---- the list ---- */}
          <section className="min-w-0 space-y-3">
            <TextInput
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={folder === "drafts" ? "Search your drafts" : "Search order number or item"}
            />

            {folder === "drafts" ? (
              <>
                {draftErr ? <p className="text-[13.5px] text-[#B3282C]">{draftErr}</p> : null}
                {drafts.loading ? (
                  <div className="rounded-2xl border border-line bg-white p-8 text-[14px] text-grey">Loading…</div>
                ) : shownDrafts.length === 0 ? (
                  <div className="rounded-2xl border border-line bg-white p-8 text-center text-[14px] text-grey">
                    {drafts.mine.length === 0
                      ? "No drafts. Use “Save as draft” on Place an order to keep an order for later."
                      : "Nothing matches what you are looking for."}
                  </div>
                ) : (
                  shownDrafts.map((d) => (
                    <div key={d.id} className="rounded-2xl border border-line bg-white p-5">
                      <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div className="min-w-0">
                          <div className="flex items-center gap-3 flex-wrap">
                            <span className="text-[15px] font-bold tracking-tight truncate">{d.title || "Untitled"}</span>
                            <span className="inline-block rounded-full border border-line bg-[#F3F6FB] px-2.5 py-1 text-[12px] font-semibold text-grey">
                              Draft — not placed
                            </span>
                          </div>
                          <p className="text-[13px] text-grey-2 mt-1.5">
                            {savedLabel(d.updatedAt)} · {d.payload?.lines?.length ?? 0} item
                            {(d.payload?.lines?.length ?? 0) === 1 ? "" : "s"}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => navigate(`${deskPaths.place}?draft=${d.id}`)}
                            className="rounded-lg bg-orange-grad px-3.5 py-1.5 text-[13px] font-semibold text-white shadow-cta"
                          >
                            Continue
                          </button>
                          <button
                            type="button"
                            onClick={() => void discardDraft(d)}
                            className="rounded-lg border border-line px-3.5 py-1.5 text-[13px] font-semibold text-grey hover:text-[#B3282C] hover:border-[#f6d2d3]"
                          >
                            Discard
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </>
            ) : shown.length === 0 ? (
              <div className="rounded-2xl border border-line bg-white p-8 text-center">
                <p className="text-[14px] text-grey">
                  {q.trim() ? "Nothing matches what you are looking for." : "No orders here."}
                </p>
                {folder !== "all" || q.trim() ? (
                  <button
                    onClick={() => { setFolder("all"); setQ(""); }}
                    className="mt-3 text-[13.5px] font-semibold text-orange hover:text-orange-2"
                  >
                    Show all my orders
                  </button>
                ) : null}
              </div>
            ) : (
              shown.map((o) => (
                <Link
                  key={o.id}
                  to={deskPaths.order(o.id)}
                  className="block rounded-2xl border border-line bg-white p-5 hover:border-[#d9e2f0] hover:shadow-soft transition"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-[15px] font-bold tracking-tight">{o.orderNo}</span>
                        <StatusPill statusKey={o.statusKey} />
                        {o.canChange ? (
                          /* A button, not a word: "Still changeable" read as a link and
                             only opened the order. This opens it straight into editing.
                             Inside the card's link, so it stops the card's own click. */
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              navigate(`${deskPaths.order(o.id)}?edit=1`);
                            }}
                            className="rounded-lg border border-orange px-2.5 py-1 text-[12px] font-semibold text-orange hover:bg-orange hover:text-white transition"
                          >
                            Edit order
                          </button>
                        ) : null}
                      </div>
                      <p className="text-[13.5px] text-grey mt-1.5 truncate">{itemSummary(o)}</p>
                      {o.ledgerName ? <p className="text-[12.5px] text-grey-2 mt-0.5 truncate">For {o.ledgerName}</p> : null}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[13px] text-grey-2">{orderDate(o.orderDate)}</div>
                      <div className="text-[12.5px] text-grey-2 mt-0.5">
                        {o.lines.length} item{o.lines.length === 1 ? "" : "s"}
                      </div>
                    </div>
                  </div>
                </Link>
              ))
            )}
          </section>
        </div>
      )}
    </OrderDeskShell>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="border-l-[3px] pl-3" style={{ borderColor: accent }}>
      <div className="text-[11.5px] font-semibold uppercase tracking-wide text-grey-2">{label}</div>
      <div className="text-[18px] font-bold text-navy mt-0.5 truncate">{value}</div>
    </div>
  );
}
