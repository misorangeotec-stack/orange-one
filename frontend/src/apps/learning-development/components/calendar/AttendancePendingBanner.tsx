import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import { useLdStore } from "../../store";
import { B } from "../../nav";
import { dmy } from "../../lib/format";
import { hm, isAttendancePending } from "../../lib/training";
import CompleteModal from "./CompleteModal";
import type { TrainingSession } from "../../types";

/**
 * "These trainings are over — mark who attended."
 *
 * Shown on the calendar and the dashboard to the people who may press Complete
 * (a calendar manager, or the internal trainer of that training). The meeting
 * ending in Teams does not close anything here, so this is where closure starts.
 */
export default function AttendancePendingBanner() {
  const s = useLdStore();
  const [open, setOpen] = useState<TrainingSession | null>(null);

  const pending = useMemo(
    () =>
      s.sessions
        .filter((x) => isAttendancePending(x) && s.canCompleteSession(x.id))
        .sort((a, b) => (a.sessionDate + (a.startTime ?? "")).localeCompare(b.sessionDate + (b.startTime ?? ""))),
    [s.sessions, s.canCompleteSession],
  );
  if (pending.length === 0) return null;

  return (
    <div className="rounded-2xl border border-[#F5C26B] bg-[#FFF8EB] p-4">
      <div className="text-[14px] font-semibold text-navy">
        {pending.length === 1 ? "1 training is over" : `${pending.length} trainings are over`} — mark who attended
      </div>
      <p className="mt-0.5 text-[12.5px] text-grey-2">
        Ending the Teams meeting does not close the training here. Mark each attendee Present or Absent to complete
        it and credit their training hours.
      </p>
      <div className="mt-3 space-y-2">
        {pending.map((x) => (
          <div key={x.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white px-3 py-2">
            <div className="min-w-0 text-[13.5px]">
              <Link to={`${B}/sessions/${x.id}`} className="font-semibold text-navy hover:text-orange">{x.title}</Link>
              <span className="text-grey-2"> · {dmy(x.sessionDate)} {hm(x.startTime)}–{hm(x.endTime)}</span>
            </div>
            <Button size="sm" onClick={() => setOpen(x)}>Mark attendance</Button>
          </div>
        ))}
      </div>
      {open && <CompleteModal open onClose={() => setOpen(null)} session={open} />}
    </div>
  );
}
