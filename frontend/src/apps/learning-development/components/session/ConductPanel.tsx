import { useState } from "react";
import Button from "@/shared/components/ui/Button";
import Combobox from "@/shared/components/ui/Combobox";
import { FieldLabel, TextInput } from "@/shared/components/ui/Form";
import { useLdStore } from "../../store";
import { dmy } from "../../lib/format";
import { Panel, NotYours, useRun } from "./panelKit";
import type { TrainingSession } from "../../types";

const OUTCOMES = [
  { value: "conducted", label: "It ran as planned" },
  { value: "partially_conducted", label: "It ran, but only partly" },
  { value: "rescheduled", label: "Moved to another date" },
  { value: "cancelled", label: "Cancelled" },
];

/**
 * Step 13 — what actually happened.
 *
 * ⚠ A CANCELLATION OR A RESCHEDULE NEEDS A REASON (§6), and the session stays on
 *   the calendar struck through rather than disappearing. A calendar that
 *   silently drops a cancelled session is how two people turn up to an empty room.
 */
export default function ConductPanel({
  session: x,
  onError,
}: {
  session: TrainingSession;
  onError: (m: string | null) => void;
}) {
  const s = useLdStore();
  const { busy, run } = useRun(onError);
  const [outcome, setOutcome] = useState(x.outcome ?? "conducted");
  const [reason, setReason] = useState(x.changeReason ?? "");
  const [attended, setAttended] = useState(x.trainerAttended ?? true);

  const mayAct = s.canActOnSession("conducted", x.id);
  const needsReason = outcome === "cancelled" || outcome === "rescheduled";

  if (x.outcome) {
    return (
      <Panel title="The session" hint={`Recorded ${dmy(x.actualStart ?? x.sessionDate)}`}>
        <p className="text-[13.5px] text-navy">
          {OUTCOMES.find((o) => o.value === x.outcome)?.label ?? x.outcome}
          {x.trainerAttended === false && " · the trainer did not attend"}
        </p>
      </Panel>
    );
  }

  if (!mayAct) {
    return (
      <Panel title="The session">
        <NotYours stepKey="conducted" what="Recording the session" />
      </Panel>
    );
  }

  return (
    <Panel title="The session" hint="Record what happened once it has run.">
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldLabel label="How did it go?">
          <Combobox value={outcome} onChange={setOutcome} options={OUTCOMES} />
        </FieldLabel>
        {needsReason && (
          <FieldLabel label="Why?" required>
            <TextInput value={reason} onChange={(e) => setReason(e.target.value)} />
          </FieldLabel>
        )}
      </div>
      {!needsReason && (
        <label className="flex items-center gap-2 text-[13px] text-navy">
          <input type="checkbox" checked={attended} onChange={(e) => setAttended(e.target.checked)} />
          The trainer turned up
        </label>
      )}
      <Button
        disabled={busy || (needsReason && !reason.trim())}
        onClick={() =>
          void run(() =>
            s.writes.recordConduct(x.id, {
              outcome,
              changeReason: needsReason ? reason : null,
              trainerAttended: needsReason ? null : attended,
              actualStart: needsReason ? null : new Date().toISOString(),
            }),
          )
        }
      >
        Save
      </Button>
    </Panel>
  );
}
