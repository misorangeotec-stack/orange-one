import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import EmptyState from "@/shared/components/ui/EmptyState";
import { TextArea } from "@/shared/components/ui/Form";
import { formatDateDMY, formatDateTimeDMY } from "@/shared/lib/date";
import { todayIso } from "@/shared/lib/time";
import { supabase } from "@/core/platform/supabase";

/**
 * NR-10 · `/my-probation` — the new joiner's own half of their check-ins.
 *
 * Staff furniture, like `/account` and `/announcements`: **no module grant**, and
 * deliberately NOT inside the New Recruitment app. A new joiner has no
 * hr-recruitment access at all, so a page built on that app's store would render
 * them an empty screen; and giving them the grant to fix it would hand them the
 * whole recruitment pipeline — every CV, every salary, every other candidate.
 *
 * The database decides what this page contains. `fms_hr_my_probation()` returns
 * only the caller's own check-ins, and writing is `fms_hr_submit_probation_checkin`,
 * which refuses the joiner side for everyone except the account HR linked to that
 * hire — an admin included.
 *
 * ⚠ It shows THAT the head of department has answered, never WHAT they said. That
 * conversation belongs between the two of them, not in a status box read alone.
 */

type Row = {
  probation_id: string;
  joining_date: string;
  job_title: string;
  day_no: number;
  due_on: string;
  hod_answered: boolean;
  joiner_status: string | null;
  joiner_remarks: string | null;
  joiner_at: string | null;
  completed_at: string | null;
  final_status: string | null;
};

const ANSWERS = [
  { value: "going_well", label: "Going well", hint: "Settled, clear on what I'm doing" },
  { value: "mixed", label: "Mixed", hint: "Some of it is working, some isn't" },
  { value: "not_going_well", label: "Not going well", hint: "I need help" },
] as const;

const ANSWER_LABEL: Record<string, string> = Object.fromEntries(ANSWERS.map((a) => [a.value, a.label]));

function CheckIn({ row, onSaved }: { row: Row; onSaved: () => void }) {
  const answered = !!row.joiner_at;
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string>(row.joiner_status ?? "going_well");
  const [remarks, setRemarks] = useState(row.joiner_remarks ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const overdue = !answered && row.due_on < todayIso();
  const notYet = !answered && row.due_on > todayIso();

  const save = async () => {
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc("fms_hr_submit_probation_checkin", {
      p_probation: row.probation_id,
      p_day: row.day_no,
      p_side: "joiner",
      p_status: status,
      p_remarks: remarks.trim(),
      p_file_path: null,
      p_file_name: null,
    });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setOpen(false);
    onSaved();
  };

  return (
    <li
      className={`rounded-xl border px-4 py-3.5 ${
        answered ? "border-ryg-green/30 bg-[#E9F7EF]/40" : overdue ? "border-orange/50" : "border-line"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[14px] font-semibold text-navy">Day {row.day_no}</p>
          <p className="mt-0.5 text-[12.5px] text-grey-2">
            {answered
              ? `You answered on ${formatDateTimeDMY(row.joiner_at)}`
              : notYet
                ? `Opens ${formatDateDMY(row.due_on)}`
                : `Due ${formatDateDMY(row.due_on)}`}
            {row.hod_answered && !answered && " · your manager has already answered theirs"}
          </p>
        </div>
        {answered ? (
          <span className="rounded-pill bg-[#E9F7EF] px-2.5 py-1 text-[11.5px] font-medium text-ryg-green">
            {ANSWER_LABEL[row.joiner_status ?? ""] ?? "Answered"}
          </span>
        ) : overdue ? (
          <span className="rounded-pill bg-orange/10 px-2.5 py-1 text-[11.5px] font-medium text-orange">
            Waiting on you
          </span>
        ) : null}
      </div>

      {answered && row.joiner_remarks && (
        <p className="mt-2 text-[12.5px] text-grey leading-relaxed">{row.joiner_remarks}</p>
      )}

      {!open && !notYet && (
        <Button size="sm" variant="ghost" className="mt-2.5" onClick={() => setOpen(true)}>
          {answered ? "Change my answer" : "Answer"}
        </Button>
      )}

      {open && (
        <div className="mt-3 space-y-3 border-t border-line pt-3">
          <div className="grid gap-2 sm:grid-cols-3">
            {ANSWERS.map((a) => (
              <button
                key={a.value}
                type="button"
                onClick={() => setStatus(a.value)}
                className={`rounded-xl border px-3 py-2 text-left transition ${
                  status === a.value ? "border-orange bg-orange/5" : "border-line hover:border-grey-2/40"
                }`}
              >
                <span className="block text-[13px] font-semibold text-navy">{a.label}</span>
                <span className="block text-[11.5px] text-grey-2">{a.hint}</span>
              </button>
            ))}
          </div>
          <TextArea
            rows={3}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Anything you want to say — what's working, what isn't, what would help."
          />
          {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Send"}
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

export default function MyProbation() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["myProbation"],
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase.rpc("fms_hr_my_probation");
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  if (isLoading) return <p className="text-[13.5px] text-grey-2">Loading…</p>;

  const rows = data ?? [];
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Nothing here for you"
        message="This page is for new joiners in their first three months. If you have just joined and expected to see your check-ins, ask HR to link your Orange One account to your joining record."
        actionLabel="Back to my work"
        actionTo="/home"
      />
    );
  }

  const first = rows[0];
  const answered = rows.filter((r) => r.joiner_at).length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">My first three months</h1>
        <p className="mt-1 text-[13.5px] text-grey-2">
          {first.job_title} · joined {formatDateDMY(first.joining_date)}. Five short check-ins — Day 7,
          15, 30, 60 and 90. Your manager answers theirs, you answer yours, and both are needed before
          a check-in counts as done.
        </p>
      </div>

      <Card className="p-5 space-y-3">
        <p className="text-[13px] text-grey-2">
          {answered} of {rows.length} answered by you.
          {first.final_status && " Your probation has been decided — these are kept as a record."}
        </p>
        <ul className="space-y-2.5">
          {rows.map((r) => (
            <CheckIn
              key={r.day_no}
              row={r}
              onSaved={() => void qc.invalidateQueries({ queryKey: ["myProbation"] })}
            />
          ))}
        </ul>
      </Card>

      <p className="text-[12px] text-grey-2">
        What you write here goes to HR and to your head of department. Their own answers are discussed
        with you directly rather than shown here.
      </p>
    </div>
  );
}
