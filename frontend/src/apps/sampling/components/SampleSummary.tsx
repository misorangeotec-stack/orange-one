import { Field } from "@/shared/components/ui/Readout";
import { labTestingLabel, receiveViaLabel, totalSampleQty } from "../lib/format";
import { useSamplingStore } from "../store";
import type { SamplingRequest } from "../types";

/**
 * A read-only recap of what the sample is, shown at the top of every step modal
 * that acts ON the sample, so the actor sees what they are handling without
 * leaving the modal.
 *
 * TWO DENSITIES, one component — a second component would have duplicated the
 * party/product/total block, and `totalSampleQty` exists precisely so one figure
 * can never be spelled two ways:
 *   compact — a single column. The inward modals, which are narrow.
 *   full    — a two-column grid with the whole party block and the request's own
 *             wishes. The outward modals, which are wide: a dispatcher, a
 *             confirmer and a result recorder are all dealing with an outside
 *             company, and the contact person / number / address are the point.
 *
 * Both open with OUR COMPANY, because a request always belongs to one of the group
 * companies and the person actioning it has to know which.
 *
 * ⚠ THE PARTY BLOCK IS GATED ON `direction`, NOT ON `variant`. `result` and
 * `result_handover` also carry LEGACY INWARD rows, which have no party block at
 * all — so `full` means "everything this request actually has", not "the outward
 * block". Same rule as RequestDetail.
 */
export default function SampleSummary({
  request: r,
  variant = "compact",
}: {
  request: SamplingRequest;
  variant?: "compact" | "full";
}) {
  const s = useSamplingStore();
  const isOutward = r.direction === "outward";
  const total = totalSampleQty(r);
  const company = s.companyById(r.companyId)?.name ?? null;

  const colourLabel = isOutward ? "Colour & quantity to send" : "Colour & quantity to collect";
  const colourQty =
    r.sampleItems.length > 0 ? (
      <ul className="space-y-0.5">
        {r.sampleItems.map((it, i) => (
          <li key={i}>{[it.colour, it.quantity].filter(Boolean).join(" — ") || "—"}</li>
        ))}
      </ul>
    ) : (
      r.colourQty
    );

  // Only when something could actually be added — a total of "—" says nothing the
  // list above hasn't already said.
  const totalNode = total.text ? (
    <>
      {total.text}
      {total.skipped.length > 0 && (
        <span className="ml-1.5 text-[11.5px] font-normal text-grey-2" title={total.skipped.join(", ")}>
          · {total.skipped.length} line{total.skipped.length > 1 ? "s" : ""} without a number not counted
        </span>
      )}
    </>
  ) : null;

  if (variant === "compact") {
    return (
      <div className="rounded-xl bg-page px-4 py-3 space-y-2.5">
        <Field label="Company" value={company} />
        <Field label={isOutward ? "Send to" : "Party"} value={r.partyName} />
        <Field label="Sample source" value={receiveViaLabel(r.receiveVia)} />
        <Field label="Product / description" value={r.productDesc} className="whitespace-pre-wrap" />
        <Field label={colourLabel} value={colourQty} />
        {totalNode && <Field label="Total quantity" value={totalNode} />}
      </div>
    );
  }

  const full = "sm:col-span-2";
  return (
    <div className="rounded-xl bg-page px-4 py-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-3">
        <Field label="Company" value={company} />
        <Field label="Sample source" value={receiveViaLabel(r.receiveVia)} />

        {isOutward ? (
          // Address comes AFTER Sender, not between the contact fields: it is the
          // only full-width item in this block, so putting it mid-block leaves a
          // hole beside whatever precedes it.
          <>
            <Field label="Send to" value={r.partyName} />
            <Field label="Contact person" value={r.partyContactName} />
            <Field label="Contact mobile" value={r.partyContactMobile} />
            <Field label="Sender" value={r.senderId ? s.personName(r.senderId) : r.senderName} />
            <Field label="Address" value={r.partyAddress} className={`${full} whitespace-pre-wrap`} />
          </>
        ) : (
          <>
            <Field label="Party" value={r.partyName} />
            <Field label="Lab testing" value={labTestingLabel(r.labTestingRequired)} />
            <Field label="Collector" value={r.collectorId ? s.personName(r.collectorId) : r.collectorName} />
            <Field
              label="Hand to"
              value={
                r.handoverRecipientId
                  ? s.personName(r.handoverRecipientId)
                  : r.handoverRecipientName ?? r.handoverName
              }
            />
          </>
        )}

        {r.transportBorne && <Field label="Transport borne" value={r.transportBorne} />}
        <Field label="Requested by" value={r.requesterName} />

        <Field label="Product / description" value={r.productDesc} className={`${full} whitespace-pre-wrap`} />
        <Field label={colourLabel} value={colourQty} className={full} />
        {totalNode && <Field label="Total quantity" value={totalNode} className={full} />}
        {r.desiredResult && (
          <Field label="Desired result" value={r.desiredResult} className={`${full} whitespace-pre-wrap`} />
        )}
        {r.additionalInfo && (
          <Field label="Additional information" value={r.additionalInfo} className={`${full} whitespace-pre-wrap`} />
        )}
      </div>
    </div>
  );
}
