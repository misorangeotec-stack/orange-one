import { useState } from "react";
import Button from "@/shared/components/ui/Button";
import Combobox from "@/shared/components/ui/Combobox";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";
import { useSession } from "@/core/platform/session";
import { useLdStore } from "../../store";
import { dmy } from "../../lib/format";
import { Panel, Stars, useRun } from "./panelKit";
import type { TrainingSession } from "../../types";

const OUTCOMES = [
  { value: "effective", label: "Effective — it changed how they work" },
  { value: "partially_effective", label: "Partly effective" },
  { value: "not_effective", label: "Not effective" },
  { value: "insufficient_evidence", label: "Too early to say" },
];

const OUTCOME_LABEL: Record<string, string> = Object.fromEntries(
  OUTCOMES.map((o) => [o.value, o.label.split(" — ")[0]]),
);

/**
 * Step 20 — the HOD's 30-day note.
 *
 * ⚠ ONE FORM PER HOD, ONE OVERALL RATING for their department — the client's
 *   decision. Their own attendees are LISTED so they know who they are rating
 *   about, but there is deliberately no per-person rating and nowhere to store one.
 *
 * ⚠ THE FORM IS SHOWN BEFORE IT IS DUE, not hidden until day 30. A HOD who
 *   already knows the answer should not be told to come back later; the due date
 *   is a deadline, not a lock.
 */
export default function EffectivenessPanel({
  session: x,
  onError,
}: {
  session: TrainingSession;
  onError: (m: string | null) => void;
}) {
  const s = useLdStore();
  const { user } = useSession();
  const { busy, run } = useRun(onError);
  const [rating, setRating] = useState<number | null>(null);
  const [outcome, setOutcome] = useState("");
  const [observed, setObserved] = useState("");
  const [improve, setImprove] = useState("");

  const rows = (s.data?.effectiveness ?? []).filter((e) => e.sessionId === x.id);
  const mine = rows.find((e) => e.hodId === user?.id && !e.submittedAt);
  const attendance = (s.data?.attendance ?? []).filter(
    (a) => a.sessionId === x.id && ["present", "partial"].includes(a.status),
  );

  /*
   * ⚠ ONLY THIS HOD'S OWN PEOPLE, not every attendee.
   *
   *   The review is "one form per HOD, one overall rating for THEIR department"
   *   (the client's decision). Listing all attendees showed Vivek Boid two names
   *   on 22-09-2026, and one of them reported to Ritesh Tulsyan — so he was being
   *   asked to rate the effect on somebody else's team. Caught by driving the
   *   page as a real HOD; it reads perfectly plausibly as an admin, who is
   *   everybody's HOD as far as the directory is concerned.
   *
   *   `hodIds` comes from the RLS-scoped directory, and a HOD can always see
   *   their own reports there. If it resolves to nobody the names are dropped
   *   rather than falling back to the full list — naming the wrong people is
   *   worse than naming none.
   */
  const myPeople = attendance
    .map((a) => s.profileById(a.employeeId))
    .filter((p): p is NonNullable<typeof p> => !!p && p.hodIds.includes(user?.id ?? ""))
    .map((p) => p.name);

  if (rows.length === 0) {
    return (
      <Panel title="Did it work?" hint="Asked of each attendee's HOD 30 days after the session.">
        <p className="text-[13px] text-grey-2">
          No reviews were created — none of the people who attended has a reporting HOD recorded, so there is
          nobody the system can ask. Their reporting line needs setting up in the admin area.
        </p>
      </Panel>
    );
  }

  const done = rows.filter((e) => e.submittedAt).length;

  return (
    <Panel
      title="Did it work?"
      hint={`${done} of ${rows.length} HOD review${rows.length === 1 ? "" : "s"} answered · due ${dmy(rows[0].dueOn)}`}
    >
      {mine && (
        <div className="rounded-lg border border-orange/40 bg-[#FFF8F4] p-3 space-y-3">
          <p className="text-[13.5px] text-navy">
            Your team attended this. Has it changed anything?
            {myPeople.length > 0 && (
              <span className="text-grey-2"> Your people on it: {myPeople.join(", ")}.</span>
            )}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldLabel label="How would you rate the effect?">
              <Stars value={rating} onChange={setRating} disabled={busy} />
            </FieldLabel>
            <FieldLabel label="Your verdict" required>
              <Combobox value={outcome} onChange={setOutcome} options={OUTCOMES} placeholder="Pick one" />
            </FieldLabel>
          </div>
          <FieldLabel label="What have you seen change?">
            <TextArea rows={2} value={observed} onChange={(e) => setObserved(e.target.value)} />
          </FieldLabel>
          <FieldLabel label="What still needs work?">
            <TextArea rows={2} value={improve} onChange={(e) => setImprove(e.target.value)} />
          </FieldLabel>
          <Button
            size="sm"
            disabled={busy || !outcome}
            onClick={() =>
              void run(() =>
                s.writes.submitEffectiveness(mine.id, {
                  outcome,
                  rating,
                  applicationObserved: observed.trim() || null,
                  improvementArea: improve.trim() || null,
                  followupRequired: outcome === "not_effective" || outcome === "partially_effective",
                }),
              )
            }
          >
            Submit
          </Button>
        </div>
      )}

      <div className="space-y-1.5">
        {rows.map((e) => (
          <div key={e.id} className="rounded-lg border border-line px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[13.5px] text-navy">{s.personName(e.hodId)}</span>
              {e.submittedAt ? (
                <span className="rounded-full bg-[#E8F7EE] px-2 py-0.5 text-[11px] font-semibold text-ryg-green">
                  {OUTCOME_LABEL[e.outcome ?? ""] ?? "Answered"}
                  {e.rating ? ` · ${e.rating}/5` : ""}
                </span>
              ) : (
                <span className="rounded-full bg-[#F1F4F9] px-2 py-0.5 text-[11px] font-semibold text-grey-2">
                  Due {dmy(e.dueOn)}
                </span>
              )}
            </div>
            {e.applicationObserved && <p className="mt-1 text-[13px] text-grey">{e.applicationObserved}</p>}
            {e.improvementArea && (
              <p className="mt-0.5 text-[12.5px] text-grey-2">Still to work on: {e.improvementArea}</p>
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
}
