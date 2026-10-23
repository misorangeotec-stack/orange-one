import { handoffNoun, handoffSheetLabel, type HandoffLine, type OrderHandoff } from "../lib/orderHandoff";

/**
 * Shown above a Purchase raise form opened from the Ink IMS "Place order" panel: every ink of the
 * order, its quantity, and whether it is on the form. An ink the purchase masters could not match
 * stays listed here — it is never dropped silently.
 */
export default function InkOrderBanner({
  handoff,
  onForm,
  missingHint,
}: {
  handoff: OrderHandoff;
  onForm: (l: HandoffLine) => boolean;
  /** What to do about an ink that is not on the form, e.g. "pick another vendor or map the item". */
  missingHint: string;
}) {
  const missing = handoff.lines.filter((l) => !onForm(l));
  return (
    <div className="rounded-lg border border-orange-200 bg-orange-50/60 p-3 text-[13px]">
      <div className="font-semibold text-navy">
        From {handoffSheetLabel(handoff)} — new order for {handoff.companyLabel} ({handoff.lines.length}{" "}
        {handoffNoun(handoff, handoff.lines.length)})
      </div>
      <ul className="mt-2 grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
        {handoff.lines.map((l) => {
          const ok = onForm(l);
          return (
            <li key={`${l.itemCode}|${l.description}`} className="flex items-baseline gap-2">
              <span className={ok ? "text-emerald-700" : "text-red-700"}>{ok ? "✓" : "✗"}</span>
              <span className="min-w-0 flex-1 truncate" title={l.names.join(" / ")}>
                {l.description}
                {l.supplier ? <span className="text-grey-2"> · {l.supplier}</span> : null}
              </span>
              <span className="tabular-nums font-medium">{l.qty.toLocaleString("en-IN")}</span>
            </li>
          );
        })}
      </ul>
      {missing.length > 0 && (
        <p className="mt-2 text-red-700">
          {missing.length} {handoffNoun(handoff, missing.length)} {missing.length === 1 ? "is" : "are"} not on the form yet — {missingHint}
        </p>
      )}
    </div>
  );
}
