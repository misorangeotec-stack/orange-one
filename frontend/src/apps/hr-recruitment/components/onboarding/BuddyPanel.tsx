import { useState } from "react";
import Button from "@/shared/components/ui/Button";
import Combobox from "@/shared/components/ui/Combobox";
import DueCell from "@/shared/components/ui/DueCell";
import { SectionHeading } from "@/shared/components/ui/Readout";
import { TextArea } from "@/shared/components/ui/Form";
import { formatDateDMY, formatDateTimeDMY } from "@/shared/lib/date";
import { useHrStore } from "../../store";
import {
  BUDDY_MODE_LABEL,
  BUDDY_STATUS_LABEL,
  type Onboarding,
  type Requisition,
} from "../../types";

/**
 * NR-9 — HR's side of the Buddy Program.
 *
 * HR allocates, hands the passport over, confirms what the buddy logs, and
 * closes it. HR does NOT log interactions: the buddy writes their own, and the
 * RPC refuses anyone else. So this panel has a confirm button and no compose
 * box, which is the whole shape of the client's decision.
 *
 * The count that matters is CONFIRMED interactions. An unconfirmed one is work
 * owed on this screen, not a completed interaction, and showing it in the total
 * would flatter exactly the number HR is scored on.
 */
export default function BuddyPanel({
  onboarding,
  requisition,
  readOnly,
}: {
  onboarding: Onboarding;
  requisition: Requisition;
  readOnly: boolean;
}) {
  const s = useHrStore();
  const buddy = s.buddyForOnboarding(onboarding.id);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [closeNote, setCloseNote] = useState("");

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // The picker offers everybody OUTSIDE the joiner's department. The RPC enforces
  // it too — this list is a convenience, not the rule.
  const options = s.orgPeople
    .filter((p) => p.id !== onboarding.employeeUserId)
    .map((p) => ({ value: p.id, label: p.name }));

  const interactions = buddy ? s.buddyInteractionsFor(buddy.id) : [];
  const confirmed = interactions.filter((i) => i.confirmedAt).length;
  const waiting = interactions.filter((i) => !i.confirmedAt).length;

  return (
    <div className="rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <SectionHeading>Buddy programme</SectionHeading>
          <p className="mt-0.5 text-[12px] text-grey-2">
            A colleague from another department, allocated within 24 hours of the offer being
            accepted. They log each meeting; you confirm it.
          </p>
        </div>
        {buddy && (
          <span className="rounded-pill bg-page px-2.5 py-1 text-[11.5px] font-medium text-grey">
            {BUDDY_STATUS_LABEL[buddy.status]}
          </span>
        )}
      </div>

      {!buddy ? (
        <div className="mt-3">
          {onboarding.offerStatus !== "accepted" ? (
            <p className="text-[12.5px] text-grey-2">
              A buddy is allocated once the offer is accepted.
            </p>
          ) : (
            <div className="flex flex-wrap items-end gap-2.5">
              <div className="w-72">
                <Combobox
                  value={pick}
                  onChange={setPick}
                  options={options}
                  placeholder="Who will be their buddy?"
                  disabled={readOnly || busy}
                />
              </div>
              <Button
                size="sm"
                disabled={readOnly || busy || !pick}
                onClick={() => void run(() => s.allocateBuddy(onboarding.id, pick))}
              >
                {busy ? "Saving…" : "Allocate"}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="grid gap-2.5 sm:grid-cols-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">Buddy</p>
              <p className="mt-0.5 text-[13px] font-medium text-navy">
                {s.personName(buddy.buddyUserId)}
              </p>
              <p className="text-[11.5px] text-grey-2">
                Allocated {formatDateTimeDMY(buddy.allocatedAt)}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">Passport</p>
              {buddy.passportHandedAt ? (
                <p className="mt-0.5 text-[13px] text-navy">
                  Handed over {formatDateDMY(buddy.passportHandedAt)}
                </p>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-0.5"
                  disabled={readOnly || busy}
                  onClick={() => void run(() => s.handPassport(buddy.id))}
                >
                  Hand it over
                </Button>
              )}
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">
                Interactions
              </p>
              <p
                className={`mt-0.5 text-[13px] font-semibold tabular-nums ${
                  confirmed >= buddy.interactionTarget ? "text-ryg-green" : "text-navy"
                }`}
              >
                {confirmed} of {buddy.interactionTarget}
                {waiting > 0 && (
                  <span className="ml-1.5 text-[11.5px] font-normal text-orange">
                    {waiting} to confirm
                  </span>
                )}
              </p>
              {buddy.dueOn && (
                <p className="text-[11.5px] text-grey-2">
                  By <DueCell dueIso={buddy.extendedTo ?? buddy.dueOn} />
                </p>
              )}
            </div>
          </div>

          {interactions.length > 0 && (
            <ul className="space-y-1.5">
              {interactions.map((i) => (
                <li
                  key={i.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2"
                >
                  <div className="min-w-0">
                    <span className="text-[12.5px] font-medium text-navy">
                      {formatDateDMY(i.happenedOn)} · {BUDDY_MODE_LABEL[i.mode]}
                    </span>
                    {i.notes && <p className="text-[12px] text-grey leading-relaxed">{i.notes}</p>}
                  </div>
                  {i.confirmedAt ? (
                    <span className="shrink-0 rounded-pill bg-[#E9F7EF] px-2 py-0.5 text-[11px] font-medium text-ryg-green">
                      Confirmed
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={readOnly || busy}
                      onClick={() => void run(() => s.confirmBuddyInteraction(i.id))}
                    >
                      Confirm
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {buddy.feedbackRating != null && (
            <div className="rounded-lg bg-page px-3 py-2">
              <p className="text-[12px] text-grey-2">
                The joiner rated it{" "}
                <strong
                  className={buddy.feedbackRating >= 4 ? "text-ryg-green" : "text-ryg-red"}
                >
                  {buddy.feedbackRating} of 5
                </strong>
                {buddy.feedbackAt ? ` on ${formatDateDMY(buddy.feedbackAt)}` : ""}.
              </p>
              {buddy.feedbackRemarks && (
                <p className="mt-0.5 text-[12px] text-grey leading-relaxed">{buddy.feedbackRemarks}</p>
              )}
            </div>
          )}

          {buddy.status === "open" || buddy.status === "extended" ? (
            !closing ? (
              <Button size="sm" variant="ghost" disabled={readOnly} onClick={() => setClosing(true)}>
                Close the programme
              </Button>
            ) : (
              <div className="space-y-2 border-t border-line pt-2.5">
                <TextArea
                  rows={2}
                  value={closeNote}
                  onChange={(e) => setCloseNote(e.target.value)}
                  placeholder="Anything worth recording."
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => void run(() => s.closeBuddy(buddy.id, "closed", closeNote.trim()))}
                  >
                    Close as complete
                  </Button>
                  {/* Not held to the count, deliberately: the interactions that never
                      happened were not HR's doing. */}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void run(() => s.closeBuddy(buddy.id, "person_left", closeNote.trim()))
                    }
                  >
                    The person left
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setClosing(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )
          ) : (
            buddy.closedAt && (
              <p className="text-[11.5px] text-grey-2">
                {BUDDY_STATUS_LABEL[buddy.status]} on {formatDateDMY(buddy.closedAt)}
                {buddy.closeNote ? ` — ${buddy.closeNote}` : ""}
              </p>
            )
          )}
        </div>
      )}

      {err && <p className="mt-2 text-[12.5px] text-ryg-red">{err}</p>}
      {requisition.departmentId && !buddy && (
        <p className="mt-2 text-[11.5px] text-grey-2">
          Anyone from {s.departments.find((d) => d.id === requisition.departmentId)?.name ?? "this department"}{" "}
          will be refused — the buddy is deliberately from somewhere else.
        </p>
      )}
    </div>
  );
}
