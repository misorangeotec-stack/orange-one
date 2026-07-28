import type { SamplingRequest } from "../types";

/**
 * A compact read-only recap of what the sample is — shown at the top of every
 * step modal that acts ON the sample (collect / received / to-lab / dispatch) so
 * the actor sees what they are handling without leaving the modal: party, product
 * and the colour/quantity list.
 *
 * Labels follow `direction`, mirroring RequestDetail: an outward actor is sending
 * TO a party, an inward one is collecting FROM one.
 */
export default function SampleSummary({ request: r }: { request: SamplingRequest }) {
  const isOutward = r.direction === "outward";
  return (
    <div className="rounded-xl bg-page px-4 py-3 space-y-2.5">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">
          {isOutward ? "Send to" : "Party"}
        </div>
        <div className="text-[13.5px] text-navy">{r.partyName || "—"}</div>
      </div>
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">Product / description</div>
        <div className="text-[13.5px] text-navy whitespace-pre-wrap">{r.productDesc || "—"}</div>
      </div>
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">
          {isOutward ? "Colour & quantity to send" : "Colour & quantity to collect"}
        </div>
        {r.sampleItems.length > 0 ? (
          <ul className="mt-0.5 space-y-0.5">
            {r.sampleItems.map((it, i) => (
              <li key={i} className="text-[13.5px] text-navy">{[it.colour, it.quantity].filter(Boolean).join(" — ") || "—"}</li>
            ))}
          </ul>
        ) : (
          <div className="text-[13.5px] text-navy">{r.colourQty || "—"}</div>
        )}
      </div>
    </div>
  );
}
