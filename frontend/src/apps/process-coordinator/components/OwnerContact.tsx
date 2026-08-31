import type { PcStepOwner } from "../types";

/**
 * The owners sitting on one step, rendered so the coordinator can act on them
 * there and then.
 *
 * This is the point of PC-1. The FMS Control Center already names the delayed
 * STEP; what it never answered is "who do I ring". So the phone and the email
 * are LINKS, not text to copy — `tel:` dials from a laptop or a phone,
 * `mailto:` opens a composer — because the whole intent is one click, no second
 * trip to the admin directory.
 *
 * ⚠ "No owner set" IS A RESULT, not an empty state. A step with nobody on it is
 *   exactly the delay this dashboard exists to surface, so it renders loudly
 *   rather than as a blank cell. Same reasoning as the unowned count in the
 *   header strip.
 *
 * Visual pattern (pill links, orange hover) follows the lead dialog in
 * leads-dashboard/components/LeadMediaDialog.tsx, the only other place in the
 * app that offers a person's contact details as links.
 */
export default function OwnerContact({ owners }: { owners: PcStepOwner[] | undefined }) {
  if (!owners || owners.length === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ryg-red">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v5M12 16.5v.01" />
        </svg>
        No owner set
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {owners.map((o) => (
        <div key={o.userId ?? o.stepKey} className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[13px] font-semibold text-navy">{o.name ?? "Unknown user"}</span>
          {o.phone ? (
            <a
              href={`tel:${o.phone}`}
              className="rounded-full border border-line bg-page px-2.5 py-0.5 text-[12px] tabular-nums text-navy transition hover:border-orange hover:text-orange"
            >
              {o.phone}
            </a>
          ) : (
            <span className="text-[12px] italic text-grey-2/70">no number</span>
          )}
          {o.email ? (
            <a
              href={`mailto:${o.email}`}
              className="rounded-full border border-line bg-page px-2.5 py-0.5 text-[12px] text-navy transition hover:border-orange hover:text-orange"
            >
              {o.email}
            </a>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** Flat text of the same owners — for a table's sort and filter values. */
export const ownerNamesText = (owners: PcStepOwner[] | undefined): string =>
  !owners || owners.length === 0
    ? "No owner set"
    : owners.map((o) => o.name ?? "Unknown user").join(", ");
