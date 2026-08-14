import { FieldRow } from "@/shared/components/ui/Readout";
import {
  directionLabel,
  labTestingLabel,
  receiveViaLabel,
  requirementTypeLabel,
  totalSampleQty,
} from "../lib/format";
import { useSamplingStore } from "../store";
import type { SamplingRequest } from "../types";

/**
 * The briefing at the top of every step modal: what this sample is, who it is
 * for, and what was asked for — so the actor never has to leave the modal to
 * find out what they are handling.
 *
 * THREE THINGS KEEP A DOZEN FACTS FROM READING AS CLUTTER:
 *
 *  1. AN IDENTITY STRIP, not fields. Whose sample this is and which way it is
 *     going is one sentence. Pulling company, direction, source and (inward) the
 *     lab decision up here is what stops the list below repeating them.
 *
 *  2. SPEC-SHEET ROWS (`FieldRow`), not stacked label-over-value. Stacking cost
 *     two lines per fact and put a dozen shouting uppercase labels on screen at
 *     once; worse, every fact with a short value left most of its row empty.
 *     One line each, labels aligned in a fixed gutter, and the list reads calm.
 *
 *  3. TWO STABLE COLUMNS with a fixed meaning — LEFT is people and party, RIGHT
 *     is the sample itself. Each column is its own stack, NOT a row-major grid,
 *     so an absent optional field (transport, desired result) shortens its own
 *     column instead of shunting every later field into the wrong one.
 *
 * ⚠ THE PARTY BLOCK IS GATED ON `r.direction`, NEVER ON THE CALLER. `result` and
 * `result_handover` also carry LEGACY INWARD rows, which have no outward party
 * block at all — so this shows "everything this request actually has", and the
 * calling modal never has to know which. Same rule RequestDetail uses.
 */
export default function StepRecap({ request: r }: { request: SamplingRequest }) {
  const s = useSamplingStore();
  const isOutward = r.direction === "outward";
  const total = totalSampleQty(r);
  const company = s.companyById(r.companyId)?.name ?? null;

  // Inward carries a fourth segment: the lab-testing decision is what chooses
  // between the two inward paths, so whoever is acting has to know which path
  // they are handing onto. Outward has no branch to name.
  //
  // Joined into ONE string rather than separate spans, so a separator can never
  // orphan onto its own line when the strip wraps.
  const identity = [
    directionLabel(r.direction),
    receiveViaLabel(r.receiveVia),
    ...(isOutward ? [] : [`Lab testing ${labTestingLabel(r.labTestingRequired).toLowerCase()}`]),
  ].join(" · ");

  const colourQty =
    r.sampleItems.length > 0 ? (
      <span>
        {r.sampleItems.map((it, i) => (
          <span key={i} className="block">
            {[it.colour, it.quantity].filter(Boolean).join(" — ") || "—"}
          </span>
        ))}
      </span>
    ) : (
      r.colourQty
    );

  // Only when something could actually be added — a total of "—" says nothing
  // the list above hasn't already said.
  const totalNode = total.text ? (
    <>
      {total.text}
      {total.skipped.length > 0 && (
        <span className="ml-1.5 text-[11.5px] text-grey-2" title={total.skipped.join(", ")}>
          · {total.skipped.length} line{total.skipped.length > 1 ? "s" : ""} not counted
        </span>
      )}
    </>
  ) : null;

  return (
    <div className="rounded-xl bg-page px-4 py-3.5">
      {/* IDENTITY — one line: whose sample, which way, which path. */}
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 border-b border-line pb-2.5">
        <span className="text-[15px] font-bold text-navy">{company ?? "—"}</span>
        <span className="text-[12.5px] text-grey">{identity}</span>
      </div>

      {/* space-y-3.5 (14px) between rows, not the 8px this started at: with a
          dozen single-line rows the list closed up into a wall of text. The gap
          has to stay clearly LARGER than the 20px line-height's own leading, or a
          value that wraps reads as two separate rows. */}
      <div className="mt-3.5 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3.5">
        {/* LEFT — who and where. */}
        <div className="space-y-3.5">
          {isOutward ? (
            <>
              <FieldRow label="Send to" value={r.partyName} />
              <FieldRow label="Contact person" value={r.partyContactName} />
              <FieldRow label="Contact mobile" value={r.partyContactMobile} />
              <FieldRow label="Address" value={r.partyAddress} />
              <FieldRow label="Sender" value={r.senderId ? s.personName(r.senderId) : r.senderName} />
            </>
          ) : (
            <>
              <FieldRow label="Party" value={r.partyName} />
              <FieldRow label="Requirement" value={requirementTypeLabel(r.requirementType)} />
              {/* "Not required" — the collect step was skipped at raise, which is
                  a different fact from a collector simply not being recorded. */}
              <FieldRow
                label="Collector"
                value={r.collectSkipped ? "Not required" : r.collectorId ? s.personName(r.collectorId) : r.collectorName}
              />
              <FieldRow
                label="Hand to"
                value={
                  r.handoverRecipientId
                    ? s.personName(r.handoverRecipientId)
                    : r.handoverRecipientName ?? r.handoverName
                }
              />
            </>
          )}
          <FieldRow label="Requested by" value={r.requesterName} />
          {r.transportBorne && <FieldRow label="Transport borne" value={r.transportBorne} />}
        </div>

        {/* RIGHT — the sample itself. */}
        <div className="space-y-3.5">
          <FieldRow label="Product" value={r.productDesc} />
          <FieldRow label={isOutward ? "Colour & qty to send" : "Colour & qty"} value={colourQty} />
          {totalNode && <FieldRow label="Total quantity" value={totalNode} />}
          {r.desiredResult && <FieldRow label="Desired result" value={r.desiredResult} />}
          {r.additionalInfo && <FieldRow label="Additional info" value={r.additionalInfo} />}
        </div>
      </div>
    </div>
  );
}
