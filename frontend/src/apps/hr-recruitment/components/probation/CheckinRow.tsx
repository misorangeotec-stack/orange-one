import { useState } from "react";
import Button from "@/shared/components/ui/Button";
import DueCell from "@/shared/components/ui/DueCell";
import { TextArea } from "@/shared/components/ui/Form";
import { formatDateTimeDMY } from "@/shared/lib/date";
import { todayIso } from "@/shared/lib/time";
import { useHrStore } from "../../store";
import { uploadProbationDoc } from "../../data/hrWrites";
import {
  CHECKIN_HOD_LABEL,
  CHECKIN_JOINER_LABEL,
  type CheckinDay,
  type CheckinHodStatus,
  type CheckinJoinerStatus,
  type Probation,
  type ProbationCheckin,
} from "../../types";

/**
 * NR-10 — one Day-N check-in, written by TWO people.
 *
 * The head of department gives a verdict; the new joiner says how it is going in
 * their own words. Neither side can write the other's, and HR writes neither —
 * HR chases both and is scored on whether they arrived by the due date. So this
 * row shows two half-rows, either of which can be empty, and only turns green
 * when both are in.
 *
 * ⚠ The joiner's side is READ-ONLY here on purpose. This panel is inside the HR
 * module, which the joiner cannot open; their half arrives from their own
 * screen. Rendering an editable box for it would invite HR to fill it in, and an
 * answer typed by somebody else is exactly what makes it worthless.
 */
export default function CheckinRow({
  probation,
  day,
  checkin,
  isPending,
  readOnly,
}: {
  probation: Probation;
  day: CheckinDay;
  checkin: ProbationCheckin | undefined;
  isPending: boolean;
  readOnly: boolean;
}) {
  const s = useHrStore();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<CheckinHodStatus>(checkin?.hodStatus ?? "satisfactory");
  const [remarks, setRemarks] = useState(checkin?.hodRemarks ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const hodIn = !!checkin?.hodAt;
  const joinerIn = !!checkin?.joinerAt;
  const bothIn = !!checkin?.completedAt;
  const editable = !readOnly && (isPending || hodIn);
  // Today is past the due date and it is still not finished.
  const overdue = !!checkin && !bothIn && checkin.dueOn < todayIso();

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      // Upload first, so a check-in can never point at a file that is not there.
      let filePath = checkin?.filePath ?? null;
      let fileName = checkin?.fileName ?? null;
      if (file) {
        const up = await uploadProbationDoc(probation.id, day, file);
        filePath = up.path;
        fileName = up.name;
      }
      await s.submitProbationCheckin(probation.id, day, "hod", status, remarks.trim(), filePath, fileName);
      setFile(null);
      setOpen(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li
      className={`rounded-xl border px-4 py-3 ${
        bothIn
          ? "border-ryg-green/30 bg-[#E9F7EF]/40"
          : isPending
            ? "border-orange/40"
            : "border-line bg-page/40"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`grid h-4 w-4 shrink-0 place-items-center rounded-[5px] border text-[10px] font-bold ${
                bothIn ? "border-ryg-green bg-ryg-green text-white" : "border-grey-2/50 text-transparent"
              }`}
              aria-hidden
            >
              ✓
            </span>
            <span className="text-[13.5px] font-semibold text-navy">
              Day-{day} check-in{day === 90 ? " — confirmation review" : ""}
            </span>
          </div>
          {/* ⚠ Keyed on the DUE DATE, not on whether this is the step the queue is
              chasing. Keyed on `isPending` it read "Not due yet" beside a red
              "3d overdue" badge on the very same row: only the earliest
              incomplete check-in is pending, and every later one that had also
              come and gone claimed it was still in the future. */}
          <p className="mt-1 text-[12px] text-grey-2">
            {bothIn
              ? "Both sides are in."
              : hodIn
                ? "Waiting on the new joiner's own answer."
                : joinerIn
                  ? "The new joiner has answered — the head of department has not."
                  : overdue
                    ? "Overdue — neither side has answered."
                    : isPending
                      ? "This is the check-in owed now."
                      : "Not due yet."}
          </p>
        </div>
        <span className="text-[12px] text-grey-2">
          Due <DueCell dueIso={checkin?.dueOn ?? null} />
        </span>
      </div>

      {/* ---- the two sides, side by side ---- */}
      <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
        <div className="rounded-lg border border-line bg-white px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">
            Head of department
          </p>
          {hodIn ? (
            <>
              <p className="mt-1 text-[12.5px] font-medium text-navy">
                {CHECKIN_HOD_LABEL[checkin!.hodStatus as CheckinHodStatus]}
              </p>
              {checkin!.hodRemarks && (
                <p className="mt-0.5 text-[12px] text-grey leading-relaxed">{checkin!.hodRemarks}</p>
              )}
              <p className="mt-1 text-[11px] text-grey-2">
                {s.personName(checkin!.hodBy ?? "")} · {formatDateTimeDMY(checkin!.hodAt)}
              </p>
            </>
          ) : (
            <p className="mt-1 text-[12px] text-grey-2">Not answered yet.</p>
          )}
        </div>

        <div className="rounded-lg border border-line bg-white px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">
            The new joiner
          </p>
          {joinerIn ? (
            <>
              <p className="mt-1 text-[12.5px] font-medium text-navy">
                {CHECKIN_JOINER_LABEL[checkin!.joinerStatus as CheckinJoinerStatus]}
              </p>
              {checkin!.joinerRemarks && (
                <p className="mt-0.5 text-[12px] text-grey leading-relaxed">{checkin!.joinerRemarks}</p>
              )}
              <p className="mt-1 text-[11px] text-grey-2">{formatDateTimeDMY(checkin!.joinerAt)}</p>
            </>
          ) : (
            <p className="mt-1 text-[12px] text-grey-2">Not answered yet.</p>
          )}
        </div>
      </div>

      {editable && !open && (
        <Button size="sm" variant="ghost" className="mt-2.5" onClick={() => setOpen(true)}>
          {hodIn ? "Change the department's answer" : "Record the department's answer"}
        </Button>
      )}

      {editable && open && (
        <div className="mt-3 space-y-2.5 border-t border-line pt-3">
          <div className="flex flex-wrap gap-2">
            {(["satisfactory", "needs_improvement", "unsatisfactory"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setStatus(k)}
                className={`rounded-pill border px-3 py-1.5 text-[12.5px] font-medium transition ${
                  status === k ? "border-orange bg-orange/5 text-navy" : "border-line text-grey"
                }`}
              >
                {CHECKIN_HOD_LABEL[k]}
              </button>
            ))}
          </div>
          <TextArea
            rows={3}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="How is this person doing?"
          />
          <input
            type="file"
            className="block w-full text-[12px] text-grey"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
