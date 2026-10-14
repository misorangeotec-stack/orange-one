import { useEffect, useMemo, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import { useLdStore } from "../../store";
import { dmy } from "../../lib/format";
import { hm, sessionHours } from "../../lib/training";
import type { TrainingSession } from "../../types";

type Mark = "present" | "absent";

/**
 * "Complete" — requirement 5. The trainer (or a calendar manager) marks every
 * attendee Present or Absent in one pop-up; saving completes the training and
 * credits its hours to everyone marked Present.
 *
 * ⚠ NOTHING IS PRE-TICKED. Defaulting everyone to Present would turn "I clicked
 *   Save" into "they all attended" and inflate every hours figure downstream.
 *   "All present" is one click, but it is a click somebody chose to make.
 */
export default function CompleteModal({
  open,
  onClose,
  session: x,
}: {
  open: boolean;
  onClose: () => void;
  session: TrainingSession;
}) {
  const s = useLdStore();
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const attendees = useMemo(
    () =>
      (s.data?.nominations ?? [])
        .filter((n) => n.sessionId === x.id && n.status === "approved")
        .map((n) => ({ id: n.employeeId, name: s.personName(n.employeeId) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [s.data?.nominations, x.id, s.personName],
  );

  useEffect(() => {
    if (open) {
      setMarks({});
      setErr(null);
    }
  }, [open]);

  const marked = attendees.filter((a) => marks[a.id]).length;
  const present = attendees.filter((a) => marks[a.id] === "present").length;
  const all = (m: Mark) => setMarks(Object.fromEntries(attendees.map((a) => [a.id, m])));

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await s.writes.completeTraining(
        x.id,
        attendees.map((a) => ({ employeeId: a.id, status: marks[a.id] })),
      );
      await s.refresh();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Complete training"
      subtitle={`${x.title} · ${dmy(x.sessionDate)} ${hm(x.startTime)}–${hm(x.endTime)} · ${sessionHours(x)} h`}
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12.5px] text-grey-2">
            {marked} of {attendees.length} marked · {present} present
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>Close</Button>
            <Button onClick={() => void save()} disabled={busy || marked < attendees.length || attendees.length === 0}>
              {busy ? "Saving…" : "Complete training"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[13px] text-grey-2">
            Mark each attendee. Present earns the training's {sessionHours(x)} hours; Absent earns none.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => all("present")}>All present</Button>
            <Button size="sm" variant="ghost" onClick={() => all("absent")}>All absent</Button>
          </div>
        </div>
        <div className="max-h-[52vh] overflow-auto rounded-xl border border-line">
          {attendees.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-3 border-b border-line px-3 py-2 last:border-b-0">
              <span className="text-[13.5px] text-navy">{a.name}</span>
              <div className="inline-flex rounded-lg border border-line bg-white p-0.5">
                {(["present", "absent"] as Mark[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMarks((cur) => ({ ...cur, [a.id]: m }))}
                    className={
                      "rounded-md px-3 py-1 text-[12.5px] font-semibold transition " +
                      (marks[a.id] === m
                        ? m === "present"
                          ? "bg-[#E8F7EE] text-ryg-green"
                          : "bg-[#FDECEC] text-ryg-red"
                        : "text-grey-2 hover:text-navy")
                    }
                  >
                    {m === "present" ? "Present" : "Absent"}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {attendees.length === 0 && <p className="p-3 text-[13px] text-grey-2">No attendees on this training.</p>}
        </div>
        {err && <p className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-[13px] text-[#B42318]">{err}</p>}
      </div>
    </Modal>
  );
}
