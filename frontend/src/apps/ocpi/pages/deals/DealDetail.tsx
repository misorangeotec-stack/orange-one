import { useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import QuotationForm from "../../components/QuotationForm";
import OcpiStepper from "../../components/OcpiStepper";
import ApprovalPanel from "../../components/ApprovalPanel";
import OcApprovalPanel from "../../components/OcApprovalPanel";
import CustomerSignPanel from "../../components/CustomerSignPanel";
import ManagementSignPanel from "../../components/ManagementSignPanel";
import SignedDocStrip from "../../components/SignedDocStrip";
import LifecyclePanel from "../../components/LifecyclePanel";
import { useOcpiStore } from "../../store";
import { draftFromDeal } from "../../lib/fieldSpec";
import { signedPages } from "../../lib/signatures";
import { STATUS_LABEL, dmy, fmtDealValue } from "../../lib/format";

/**
 * One deal, read-only.
 *
 * ⚠ IT RENDERS THE SAME FORM, DISABLED — it does not re-describe the fields in a
 *   second, read-only layout. Two layouts for one set of answers is how the
 *   detail view ends up showing a field the form has since renamed, or quietly
 *   omitting one that was added. The branch rules apply here too, so a deal that
 *   included no ink does not show an empty "quantity of ink" row.
 *
 * ⚠ THE ACTION PANELS HIDE THEMSELVES. Each renders only while the deal is
 *   actually sitting at its own step, so this page offers exactly one thing to
 *   do — or none. They are mounted unconditionally rather than chosen by a
 *   switch here, which would be a second place keeping the state machine and a
 *   second place to get it wrong.
 */
export default function DealDetail() {
  const { id } = useParams<{ id: string }>();
  const s = useOcpiStore();
  const deal = s.deals.find((d) => d.id === id);

  const draft = useMemo(() => (deal ? draftFromDeal(deal) : null), [deal]);

  if (!deal || !draft) {
    return (
      <Card className="p-6">
        <h1 className="text-[18px] font-bold text-navy">That quotation is not available</h1>
        <p className="mt-1 text-[13.5px] text-grey-2">
          It may have been deleted, or it belongs to someone else — a draft is private to whoever
          wrote it.{" "}
          <Link to="/ocpi/deals" className="font-semibold text-orange hover:underline">
            Back to all deals
          </Link>
        </p>
      </Card>
    );
  }

  const signed = [
    { slot: "customer-signed" as const, title: "Signed by the customer", at: deal.csAt },
    { slot: "management-signed" as const, title: "Countersigned", at: deal.msAt },
  ]
    .map((set) => ({ ...set, pages: signedPages(deal, set.slot) }))
    .filter((set) => set.pages.length > 0);

  const facts: { label: string; value: string }[] = [
    { label: "Status", value: STATUS_LABEL[deal.status] },
    { label: "Quotation no.", value: deal.quotationNo ?? "not issued yet" },
    { label: "Order confirmation no.", value: deal.ocNo ?? "—" },
    { label: "Deal value", value: fmtDealValue(deal.dealValueAmount, deal.dealValueCurrency) || "—" },
    { label: "Raised", value: dmy(deal.createdAt) },
    { label: "Revisions", value: String(deal.quotationVersionNo) },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[20px] font-bold text-navy">
          {deal.quotationNo ?? deal.customerName ?? "Quotation"}
        </h1>
        <p className="mt-0.5 text-[13.5px] text-grey-2">{deal.customerName}</p>
      </div>

      {/*
        WHERE IT IS, before what it says. The facts below answer "what is this
        deal"; the rail answers "how far has it got and who has it" — which is
        the question somebody opening a deal they did not raise is actually
        asking, and the question the paper process could never answer at all.
      */}
      <Card className="p-4">
        <OcpiStepper deal={deal} fit />
      </Card>

      <Card className="p-4">
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
          {facts.map((f) => (
            <div key={f.label}>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">
                {f.label}
              </dt>
              <dd className="mt-0.5 text-[13.5px] font-medium text-navy">{f.value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {/*
        Hold / resume / cancel. Sits ABOVE the step panels on purpose: a deal
        that is on hold shows why first, and the panel for the step it was held
        at does not render at all, so the page cannot invite somebody to approve
        something that is parked.
      */}
      <LifecyclePanel deal={deal} />

      {/* Renders itself only when this deal is actually waiting on an approver. */}
      <ApprovalPanel deal={deal} />

      {/* Also self-hiding: only renders while the OC is with management. */}
      <OcApprovalPanel deal={deal} />

      {/* Print, collect the signature, file it. Only while it is out. */}
      <CustomerSignPanel deal={deal} />

      {/* Countersign and close. Only while the signed copy is with management. */}
      <ManagementSignPanel deal={deal} />

      {/*
        ⚠ ONCE CLOSED, THE SIGNED FILES ARE THE RECORD, so the completed deal
          leads with them rather than with the answers that produced them. Both
          are shown: a countersigned copy with no customer-signed copy beside it
          is half a contract.
      */}
      {deal.status === "closed" && signed.length > 0 && (
        <Card className="space-y-5 p-5">
          <div>
            <h2 className="text-[15px] font-bold text-navy">The signed contract</h2>
            <p className="mt-0.5 text-[13.5px] text-grey-2">
              Completed{deal.msAt ? ` on ${dmy(deal.msAt)}` : ""}. These scans are the record —
              they are the one thing here that cannot be produced again.
            </p>
          </div>
          {signed.map((set) => (
            <SignedDocStrip
              key={set.slot}
              pages={set.pages}
              title={set.title}
              meta={set.at ? `Filed ${dmy(set.at)}` : undefined}
            />
          ))}
        </Card>
      )}

      {deal.status === "awaiting_order_confirmation" && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-[13.5px] text-grey">
            The quotation is approved. The order confirmation is what the customer signs.
          </p>
          <Link
            to={`/ocpi/deals/${deal.id}/order-confirmation`}
            className="rounded-xl bg-orange px-4 py-2 text-[13.5px] font-semibold text-white shadow-cta hover:brightness-105"
          >
            Fill in the order confirmation
          </Link>
        </Card>
      )}

      {deal.qaNote && (
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">
            Approver&rsquo;s note
          </p>
          <p className="mt-1 text-[13.5px] text-navy">{deal.qaNote}</p>
        </Card>
      )}

      <QuotationForm draft={draft} patch={() => {}} disabled />
    </div>
  );
}
