import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import Modal from "@/shared/components/ui/Modal";
import PillToggle from "@/shared/components/ui/PillToggle";
import { FieldHeading, FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import Combobox from "@/shared/components/ui/Combobox";
import { useDispatchStore } from "../store";
import { dmy, DELIVERY_STATUS_LABEL } from "../lib/format";
import { billedQtyOf, type RoundView } from "../lib/rounds";
import { returnCandidates, type InvoiceReturnState } from "../lib/salesReturn";
import type { DispatchOrder, RoundReturnScope } from "../types";

interface Candidate {
  key: string;
  view: RoundView;
  order: DispatchOrder;
  state: InvoiceReturnState;
}

/** Past this many invoices for one customer, a box to narrow them appears. */
const SEARCH_FROM = 6;

/**
 * Send an invoice raised through Order to Dispatch to the Sales Return step.
 *
 * Opened from three places, and it adapts:
 *   · an order's Dispatch rounds table — `order` and `roundNo` given, nothing to pick;
 *   · an order's header — `order` given; picks among that order's invoices;
 *   · the Sales Return page — nothing given; CUSTOMER FIRST, then every invoice
 *     of that customer. Asked for by the user (02-10-2026): an earlier search over
 *     all ~2,300 invoices showed only the latest 8 and read as "the rest are
 *     missing". The person raising a return always knows the customer, so the
 *     customer narrows it to a list short enough to show in full.
 *
 * ⚠ ANY INVOICE THAT HAS LEFT THE GATE, NOT ONLY A CONFIRMED DELIVERY. The round
 *   in progress — out of the gate, still waiting on Confirmation on Dispatch —
 *   qualifies as much as one on a closed order; that was the first thing a user
 *   tried. An invoice still IN THE PLANT is listed too, so nobody searches for it
 *   and concludes it is missing, but it cannot be picked: Cancel order is its route.
 *
 * ⚠ PAPERWORK ONLY, AND IT SAYS SO. Raising this does not touch the order's
 *   status or delivered quantities.
 */
export default function RequestReturnModal({
  open,
  onClose,
  order = null,
  roundNo = null,
}: {
  open: boolean;
  onClose: () => void;
  order?: DispatchOrder | null;
  roundNo?: number | null;
}) {
  const s = useDispatchStore();

  const [picked, setPicked] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<RoundReturnScope>("full");
  const [reason, setReason] = useState("");
  // PARTIAL: what is coming back, typed per invoice line, keyed by the order line.
  const [qty, setQty] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Every invoice this person could raise a return against — across the whole
  // module when opened from the Sales Return page, one order's otherwise.
  // Pickable ones first, newest invoice first within each.
  const candidates: Candidate[] = useMemo(() => {
    if (!open) return [];
    const orders = order ? [order] : s.orders.filter((o) => s.canRequestRoundReturn(o));
    return orders
      .flatMap((o) =>
        returnCandidates(o, s.roundReturns).map(({ view, state }) => ({
          key: `${o.id}:${view.roundNo}`, view, order: o, state,
        })),
      )
      .sort(
        (a, b) =>
          (a.state === "ok" ? 0 : 1) - (b.state === "ok" ? 0 : 1) ||
          (b.view.sbActualDate ?? "").localeCompare(a.view.sbActualDate ?? ""),
      );
  }, [open, order, s]);

  const pickable = candidates.filter((c) => c.state === "ok");

  useEffect(() => {
    if (!open) return;
    // A single invoice needs no choosing; neither does one the caller named.
    const named = order && roundNo != null ? `${order.id}:${roundNo}` : null;
    const only = order && pickable.length === 1 ? pickable[0].key : null;
    setPicked(named ?? only);
    setCustomerId(order?.customerId ?? "");
    setSearch("");
    setScope("full");
    setReason("");
    setError(null);
    setBusy(false);
    // `candidates` is derived from `open`/`order`, so re-seeding on those is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, order, roundNo]);

  const chosen = pickable.find((c) => c.key === picked) ?? null;

  // A different invoice has different lines — never carry quantities across.
  useEffect(() => {
    setQty({});
  }, [picked]);

  // The invoice's billed lines. A live round's lines carry no frozen name, so the
  // item master supplies it; an archived round's name is the one it shipped under.
  const billedLines = (chosen?.view.items ?? [])
    .filter((i) => billedQtyOf(i) > 0 && !!i.orderItemId)
    .map((i) => ({
      key: i.orderItemId as string,
      name: i.itemName || s.itemName(i.itemId),
      unit: i.unitName,
      lotNo: i.lotNo,
      billed: billedQtyOf(i),
    }));
  const qtyOf = (key: string) => Number(qty[key]) || 0;

  // The customer bucket: everyone with at least one invoice here, A to Z, with
  // how many of their invoices can be returned.
  const customerOptions = useMemo(() => {
    const counts = new Map<string, { ok: number; all: number }>();
    for (const c of candidates) {
      const n = counts.get(c.order.customerId) ?? { ok: 0, all: 0 };
      n.all += 1;
      if (c.state === "ok") n.ok += 1;
      counts.set(c.order.customerId, n);
    }
    return [...counts.entries()]
      .map(([id, n]) => ({
        value: id,
        label: s.customerName(id),
        sublabel:
          `${n.ok} invoice${n.ok === 1 ? "" : "s"}` +
          (n.all > n.ok ? ` · ${n.all - n.ok} still in the plant` : ""),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [candidates, s]);

  // ALL of the chosen customer's invoices — no cap.
  const forCustomer = customerId ? candidates.filter((c) => c.order.customerId === customerId) : [];
  const needle = search.trim().toLowerCase();
  const matches = !needle
    ? forCustomer
    : forCustomer.filter(
        (c) =>
          (c.view.sbInvoiceNo ?? "").toLowerCase().includes(needle) ||
          c.order.orderNo.toLowerCase().includes(needle),
      );

  const save = async () => {
    if (!chosen) {
      setError("Pick the invoice the return is against.");
      return;
    }
    // The server re-checks all of this; checking here keeps the message beside the box.
    const lines =
      scope === "partial"
        ? billedLines.filter((l) => qtyOf(l.key) > 0).map((l) => ({ orderItemId: l.key, returnQty: qtyOf(l.key) }))
        : [];
    if (scope === "partial") {
      if (billedLines.some((l) => qtyOf(l.key) < 0)) {
        setError("A return quantity cannot be negative.");
        return;
      }
      const over = billedLines.find((l) => qtyOf(l.key) > l.billed);
      if (over) {
        setError(`Only ${over.billed} ${over.unit ?? ""} of ${over.name} was billed on this invoice.`);
        return;
      }
      if (lines.length === 0) {
        setError("Enter how much is coming back on at least one item.");
        return;
      }
    }
    if (!reason.trim()) {
      setError("Say why — what is coming back, or what was wrong with the invoice.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await s.requestRoundReturn(chosen.order.id, chosen.view.roundNo, { reason: reason.trim(), scope, lines });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not raise that.");
    } finally {
      setBusy(false);
    }
  };

  /** Where the consignment is, in the words of the queues it moved through. */
  const whereText = (c: Candidate) =>
    c.state === "in_plant"
      ? "still in the plant"
      : c.view.dcStatus
        ? `${DELIVERY_STATUS_LABEL[c.view.dcStatus].toLowerCase()}${c.view.dcActualDate ? ` ${dmy(c.view.dcActualDate)}` : ""}`
        : "out of the gate, awaiting delivery confirmation";

  const invoiceLine = (c: Candidate) => (
    <>
      <span className="font-semibold text-navy">{c.view.sbInvoiceNo}</span>
      <span className="text-grey-2">
        {" "}· {dmy(c.view.sbActualDate)} · {c.order.orderNo}
        {c.view.roundNo > 1 ? ` R${c.view.roundNo}` : ""} · {whereText(c)}
      </span>
    </>
  );

  // Picking is offered only while there is a choice to make.
  const showPicker = roundNo == null && !(order && candidates.length === 1 && pickable.length === 1);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Raise a sales return"
      subtitle={
        chosen
          ? `${chosen.order.orderNo} · invoice ${chosen.view.sbInvoiceNo}`
          : "Any invoice raised through Order to Dispatch, once it has left the gate"
      }
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy || !chosen}>
            {busy ? "Sending…" : "Send to Sales Return"}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {candidates.length === 0 ? (
          <p className="rounded-lg bg-page px-3 py-2.5 text-[13px] text-grey">
            {order
              ? "Every invoice on this order already has a sales return, or none has been raised yet."
              : "There is no invoice you can raise a sales return against."}
          </p>
        ) : (
          showPicker && (
            <>
              {!order && (
                <FieldLabel label="Customer" required>
                  <Combobox
                    value={customerId}
                    onChange={(v) => {
                      setCustomerId(v);
                      setPicked(null);
                      setSearch("");
                      setError(null);
                    }}
                    options={customerOptions}
                    placeholder={`Choose the customer — ${customerOptions.length} with invoices`}
                    searchable
                    wrapLabel
                  />
                </FieldLabel>
              )}

              {customerId && (
                <div>
                  {/* A heading DIV, not FieldLabel: a <label> forwards a click on its text to its first
                      control, so clicking "Invoice" or the caption picked the newest invoice. */}
                  <FieldHeading label="Invoice" required />
                  {forCustomer.length > SEARCH_FROM && (
                    <TextInput
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Narrow by invoice no. or order no."
                      className="mb-2"
                    />
                  )}
                  <ul className="max-h-[300px] overflow-y-auto rounded-lg border border-line divide-y divide-line/70">
                    {matches.map((c) =>
                      c.state === "in_plant" ? (
                        // Shown, so nobody concludes the bill is missing — but not pickable.
                        <li key={c.key} className="px-3 py-2 text-[13px] opacity-70">
                          {invoiceLine(c)}
                          <p className="text-[12px] text-grey-2">
                            Not out of the gate yet — use{" "}
                            <Link
                              to={`/order-to-dispatch/orders/${c.order.id}`}
                              onClick={onClose}
                              className="font-semibold text-orange hover:underline"
                            >
                              Cancel order
                            </Link>{" "}
                            on the order instead; that sends this bill to Sales Return.
                          </p>
                        </li>
                      ) : (
                        <li key={c.key}>
                          <button
                            type="button"
                            onClick={() => {
                              setPicked(c.key);
                              setError(null);
                            }}
                            className={`block w-full px-3 py-2 text-left text-[13px] ${
                              picked === c.key ? "bg-orange-soft/50" : "hover:bg-page"
                            }`}
                          >
                            {invoiceLine(c)}
                          </button>
                        </li>
                      ),
                    )}
                    {matches.length === 0 && (
                      <li className="px-3 py-2 text-[13px] text-grey-2">
                        No invoice of this customer matches that.
                      </li>
                    )}
                  </ul>
                  <p className="mt-1 text-[12px] text-grey-2">
                    {forCustomer.length} invoice{forCustomer.length === 1 ? "" : "s"}, newest first. An
                    invoice that already has a sales return is not listed again — find it on the Sales
                    Return page.
                  </p>
                </div>
              )}
            </>
          )
        )}

        {chosen && (
          <div className="rounded-card border border-line bg-page/60 p-3.5 space-y-1.5 text-[12.5px]">
            <p>{invoiceLine(chosen)}</p>
            {chosen.view.gpNo && <p className="text-grey-2">Gate pass {chosen.view.gpNo}</p>}
            {scope === "full" && billedLines.length > 0 && (
              <ul className="text-grey">
                {billedLines.map((l) => (
                  <li key={l.key}>
                    {l.name} · {l.billed} {l.unit ?? ""}
                    {l.lotNo ? ` · LOT ${l.lotNo}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div>
          <FieldHeading label="What is coming back" required />
          <PillToggle<RoundReturnScope>
            value={scope}
            onChange={setScope}
            options={[
              { value: "full", label: "The whole invoice" },
              { value: "partial", label: "Part of it" },
            ]}
          />
        </div>

        {/*
          PARTIAL: which items, and how much of each. Every billed line is listed
          with what the invoice billed; a blank or 0 means that item is not coming
          back. Capped at the billed figure — the server refuses more.
        */}
        {scope === "partial" && chosen && (
          <div>
            <FieldHeading label="Items coming back" required />
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-line bg-page text-left text-grey-2">
                    <th className="px-3 py-2 font-semibold">Item</th>
                    <th className="px-3 py-2 font-semibold">LOT</th>
                    <th className="px-3 py-2 font-semibold text-right whitespace-nowrap">Billed</th>
                    <th className="px-3 py-2 font-semibold text-right whitespace-nowrap">Return qty</th>
                  </tr>
                </thead>
                <tbody>
                  {billedLines.map((l) => {
                    const over = qtyOf(l.key) > l.billed;
                    return (
                      <tr key={l.key} className="border-b border-line/70 last:border-0">
                        <td className="px-3 py-1.5 text-navy">{l.name}</td>
                        <td className="px-3 py-1.5 text-grey whitespace-nowrap">{l.lotNo ?? "—"}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-grey whitespace-nowrap">
                          {l.billed} {l.unit ?? ""}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <TextInput
                              type="number"
                              min={0}
                              max={l.billed}
                              step="any"
                              inputMode="decimal"
                              value={qty[l.key] ?? ""}
                              onChange={(e) => {
                                setQty((q) => ({ ...q, [l.key]: e.target.value }));
                                setError(null);
                              }}
                              placeholder="0"
                              className={`w-[96px] text-right ${over ? "border-ryg-red" : ""}`}
                            />
                            <button
                              type="button"
                              onClick={() => setQty((q) => ({ ...q, [l.key]: String(l.billed) }))}
                              className="text-[12px] font-semibold text-orange hover:underline whitespace-nowrap"
                              title="Fill in the whole billed quantity"
                            >
                              All
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {billedLines.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-2 text-grey-2">
                        This invoice has no billed lines to choose from.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-[12px] text-grey-2">
              Leave an item blank if none of it is coming back.
            </p>
          </div>
        )}

        <FieldLabel label="Reason" required>
          <TextArea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder={
              scope === "partial"
                ? "e.g. damaged in transit, wrong shade"
                : "e.g. customer rejected the material, wrong rate billed"
            }
          />
        </FieldLabel>

        <p className="text-[12.5px] text-grey-2">
          The Sales Return owners
          {chosen ? ` (${s.ownerNamesFor("sales_return", chosen.order.locationId).join(", ") || "none set — coordinators"})` : ""}{" "}
          are told to cancel the bill in Tally or punch a sales return against it. The order itself is not
          changed — a consignment still awaiting confirmation still needs its delivery recorded, and if the
          goods have to go out again, record or correct the round as Returned.
        </p>

        {error && <p className="text-[13px] font-medium text-ryg-red">{error}</p>}
      </div>
    </Modal>
  );
}
