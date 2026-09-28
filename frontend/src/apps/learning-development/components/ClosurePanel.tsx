import { useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import Combobox from "@/shared/components/ui/Combobox";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { useSession } from "@/core/platform/session";
import { useLdStore } from "../store";
import { dmy, inr } from "../lib/format";
import { closureBlockers } from "../lib/closure";
import type { TrainingRequest } from "../types";

/**
 * Steps 21 and 22 — the follow-up decision and closure.
 *
 * ⚠ THE FLOW COULD NOT BE FINISHED WITHOUT THIS. Every RPC behind it worked and
 *   was tested in SQL, but nothing in the UI called them, so a training ran to
 *   its 30-day review and then stayed open forever. The walkthrough missed it
 *   because the walkthrough also stopped at the review: a test that follows the
 *   same path as the build shares its blind spots.
 *
 * ⚠ It shows what is outstanding BEFORE offering the button. The server refuses
 *   an early close and names what is missing, but nobody should have to press
 *   a button to find that out.
 */
export default function ClosurePanel({ request: r }: { request: TrainingRequest }) {
  const s = useLdStore();
  const { isAdmin } = useSession();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [outcome, setOutcome] = useState(r.finalOutcome ?? "");
  const [action, setAction] = useState("");
  const [note, setNote] = useState(r.closureNote ?? "");
  const [cost, setCost] = useState(r.actualCost != null ? String(r.actualCost) : "");
  const [reopenReason, setReopenReason] = useState("");

  const d = s.data;
  const blockers = closureBlockers(r, s.sessions, d?.effectiveness ?? []);
  const mayClose = s.canActOn("closure", r.id);
  const actions = (d?.followupActions ?? []).filter((a) => a.active);

  const run = async (fn: () => Promise<unknown>) => {
    setErr(null);
    setBusy(true);
    try {
      await fn();
      await s.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (r.status === "closed") {
    return (
      <Card className="p-5 space-y-3">
        <h2 className="text-[15px] font-semibold text-navy">Closed</h2>
        <p className="text-[13.5px] text-navy">
          {r.finalOutcome ?? "Closed"} · {dmy(r.closedAt)} by {s.personName(r.closedBy)}
          {r.actualCost != null && ` · ${inr(r.actualCost)}`}
        </p>
        {r.closureNote && <p className="text-[13px] text-grey">{r.closureNote}</p>}
        {isAdmin && (
          <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
            <div className="min-w-[16rem] flex-1">
              <TextInput value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} placeholder="Why reopen this?" />
            </div>
            <Button size="sm" variant="ghost" disabled={busy || !reopenReason.trim()}
              onClick={() => void run(() => s.writes.reopenRequest(r.id, reopenReason))}>
              Reopen
            </Button>
          </div>
        )}
        {err && <p className="text-[13px] text-[#B42318]">{err}</p>}
      </Card>
    );
  }

  return (
    <Card className="p-5 space-y-4">
      <h2 className="text-[15px] font-semibold text-navy">Follow-up and closure</h2>
      {blockers.length > 0 ? (
        <div className="rounded-lg bg-[#FFF7E6] px-3 py-2 text-[13px] text-navy">
          <strong>Not ready to close.</strong>
          <ul className="mt-1 list-disc pl-5">
            {blockers.map((b) => (
              <li key={b.what}>{b.count} {b.what}</li>
            ))}
          </ul>
        </div>
      ) : !mayClose ? (
        <p className="text-[13px] text-grey-2">Everything is done. HR closes the record.</p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldLabel label="What happens next?" hint="Step 21 — the follow-up decision.">
              <Combobox value={action} onChange={setAction} clearable
                options={actions.map((a) => ({ value: a.id, label: a.name }))}
                placeholder="Pick a follow-up" />
            </FieldLabel>
            <FieldLabel label="Final outcome" hint="How it ended, in a few words.">
              <TextInput value={outcome} onChange={(e) => setOutcome(e.target.value)} />
            </FieldLabel>
          </div>
          <FieldLabel label="What it actually cost">
            <TextInput type="number" value={cost} onChange={(e) => setCost(e.target.value)} />
          </FieldLabel>
          <FieldLabel label="Closing note">
            <TextArea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </FieldLabel>
          <Button disabled={busy} onClick={() => void run(() =>
            s.writes.closeRequest(r.id, {
              finalOutcome: outcome.trim() || null,
              closureNote: note.trim() || null,
              actualCost: cost === "" ? null : Number(cost),
            }))}>
            Close this training record
          </Button>
        </>
      )}
      {err && <p className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-[13px] text-[#B42318]">{err}</p>}
    </Card>
  );
}
