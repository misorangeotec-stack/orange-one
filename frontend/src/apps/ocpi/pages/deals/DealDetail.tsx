import { useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import QuotationForm from "../../components/QuotationForm";
import OcpiStepper from "../../components/OcpiStepper";
import ApprovalPanel from "../../components/ApprovalPanel";
import CustomerSignPanel from "../../components/CustomerSignPanel";
import ManagementSignPanel from "../../components/ManagementSignPanel";
import FinanceHandoverPanel from "../../components/FinanceHandoverPanel";
import FinanceReceiptPanel from "../../components/FinanceReceiptPanel";
import SignedDocStrip from "../../components/SignedDocStrip";
import RevisionHistory from "../../components/RevisionHistory";
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
  const versions = useMemo(
    () => (deal ? s.versions.filter((v) => v.dealId === deal.id) : []),
    [s.versions, deal],
  );

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
    /*
      ⚠ THE LABEL IS CONDITIONAL, AND THAT IS THE POINT (OCPI-40 re-audit).
        Since OCPI-36 the serial is minted at Generate, so an unapproved draft
        carries `ocNo` — and this row used to announce it as the "Order
        confirmation no." of a contract nobody had approved. Until `oc_at` is
        stamped the number is only RESERVED, and the row says so; after it, it is
        the contract number and reads exactly as before.
    */
    deal.ocAt
      ? { label: "Order confirmation no.", value: deal.ocNo ?? "—" }
      : { label: "Reserved for the contract", value: deal.ocNo ?? "—" },
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

      {/*
        Renders itself only when this deal is actually waiting on an approver.
        This is the Directors' gate — approving it issues the contract.
      */}
      <ApprovalPanel deal={deal} />

      {/* Print, collect the signature, file it. Only while it is out. */}
      <CustomerSignPanel deal={deal} />

      {/* Countersign. Only while the signed copy is with management. */}
      <ManagementSignPanel deal={deal} />

      {/* The two halves of the handover to Finance. Both self-hiding. */}
      <FinanceHandoverPanel deal={deal} />
      <FinanceReceiptPanel deal={deal} />

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
              {/*
                ⚠ COMPLETED IS NOW WHEN FINANCE RECEIVED IT, not when it was
                  countersigned. The countersignature stopped being the end of
                  the process at the stage-F cutover, and dating the record from
                  it would understate how long the paper actually took to land.
              */}
              Completed{deal.frAt ? ` on ${dmy(deal.frAt)}` : deal.msAt ? ` on ${dmy(deal.msAt)}` : ""}.
              These scans are the record — they are the one thing here that cannot be produced again.
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

      {/*
        ⚠ A DEAL PARKED AT ONE OF THE RETIRED STEPS SAYS SO. Five deals were at
          `awaiting_order_confirmation` and two at `awaiting_oc_approval` when the
          chain changed. The screens that used to act on them are gone, so
          without this the page would show a status and offer nothing, which
          reads as a broken deal rather than a historical one.
      */}
      {(deal.status === "awaiting_order_confirmation" || deal.status === "awaiting_oc_approval") && (
        <Card className="border-ryg-yellow/40 bg-[#FFFCF3] p-4">
          <p className="text-[13px] font-medium text-navy">This deal is at a step that no longer runs</p>
          <p className="mt-1 text-[13px] text-grey">
            It was raised before the order confirmation was merged into the quotation. There is
            nothing to fill in any more — the questions it was waiting for are on the quotation form,
            and the approval it was waiting for is the Directors&rsquo;. A coordinator can cancel it,
            or leave it as a record.
          </p>
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

      {/*
        ⚠ THE NEGOTIATION BELONGS ON THIS PAGE, not only on the draft editor.
          The strip used to live in QuotationEditor alone, which meant it
          disappeared the moment a quotation was submitted — at exactly the point
          the Directors are deciding whether the price is right, and the one
          question they would ask is how it moved to get there. Each row carries
          the value, the rate it was converted at, and links to the pair of
          papers frozen at that revision.
      */}
      {versions.length > 0 && <RevisionHistory versions={versions} />}

      <QuotationForm draft={draft} patch={() => {}} disabled />
    </div>
  );
}
