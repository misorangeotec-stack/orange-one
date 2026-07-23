import type { SamplingRequest } from "../types";

/**
 * A compact read-only recap of what the sample is — shown at the top of the
 * collect / received step modals so the actor sees the details in short:
 * party, product and the colour/quantity list.
 */
export default function SampleSummary({ request: r }: { request: SamplingRequest }) {
  return (
    <div className="rounded-xl bg-page px-4 py-3 space-y-2.5">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">Party</div>
        <div className="text-[13.5px] text-navy">{r.partyName || "—"}</div>
      </div>
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">Product / description</div>
        <div className="text-[13.5px] text-navy whitespace-pre-wrap">{r.productDesc || "—"}</div>
      </div>
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">Colour &amp; quantity</div>
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
