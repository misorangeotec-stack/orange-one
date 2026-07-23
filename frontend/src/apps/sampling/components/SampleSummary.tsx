import { directionLabel, requirementTypeLabel } from "../lib/format";
import type { SamplingRequest } from "../types";

/**
 * A compact read-only recap of what the sample is — shown at the top of the
 * collect / received step modals so the actor sees the details in short.
 */
export default function SampleSummary({ request: r }: { request: SamplingRequest }) {
  const rows: [string, string | null][] = [
    ["Direction", directionLabel(r.direction)],
    r.direction === "inward" ? ["Requirement", requirementTypeLabel(r.requirementType)] : ["Send to", r.partyName],
    ["Product / description", r.productDesc],
    r.direction === "inward" ? ["Party", r.partyName] : null,
  ].filter(Boolean) as [string, string | null][];

  return (
    <div className="rounded-xl bg-page px-3.5 py-3 space-y-2">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {rows.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">{label}</dt>
            <dd className="text-[13px] text-navy truncate">{value || "—"}</dd>
          </div>
        ))}
      </dl>
      {r.sampleItems.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">Colour &amp; quantity</div>
          <ul className="mt-0.5 space-y-0.5">
            {r.sampleItems.map((it, i) => (
              <li key={i} className="text-[13px] text-navy">{[it.colour, it.quantity].filter(Boolean).join(" — ") || "—"}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
