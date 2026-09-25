import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import { FieldLabel, TextArea, TextInput } from "@/shared/components/ui/Form";
import { formatDateDMY } from "@/shared/lib/date";
import { todayIso } from "@/shared/lib/time";
import { supabase } from "@/core/platform/supabase";
import { useSession } from "@/core/platform/session";

/**
 * NR-9 · `/my-buddy` — the buddy's own screen.
 *
 * A buddy is an ordinary colleague from another department. They have no
 * hr-recruitment grant and should not get one: it would hand them every CV and
 * salary in the pipeline to record a coffee. So this is staff furniture, like
 * `/my-probation`, and it shows one thing — the person they are buddying and the
 * meetings they have logged.
 *
 * ⚠ They log; HR confirms. The count HR is scored on only moves when HR
 * confirms, and this screen says so plainly rather than letting somebody think
 * eight logged is eight done.
 */

type Row = {
  id: string;
  candidate_id: string;
  joining_date: string | null;
  due_on: string | null;
  interaction_target: number;
  status: string;
};

type Interaction = {
  id: string;
  happened_on: string;
  mode: string;
  notes: string | null;
  confirmed_at: string | null;
};

const MODES = [
  { value: "in_person", label: "In person" },
  { value: "call", label: "Call" },
  { value: "message", label: "Message" },
  { value: "other", label: "Other" },
] as const;

const MODE_LABEL: Record<string, string> = Object.fromEntries(MODES.map((m) => [m.value, m.label]));

export default function MyBuddy() {
  const { user } = useSession();
  const qc = useQueryClient();
  const [on, setOn] = useState(todayIso());
  const [mode, setMode] = useState<string>("in_person");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["myBuddy", user.id],
    queryFn: async () => {
      // Their own row comes back through RLS — the policy admits the buddy and
      // the joiner, and nobody else outside HR.
      const { data: rows, error } = await supabase
        .from("fms_hr_buddies")
        .select("id, candidate_id, joining_date, due_on, interaction_target, status")
        .eq("buddy_user_id", user.id);
      if (error) throw new Error(error.message);
      const mine = (rows ?? []) as Row[];
      if (mine.length === 0) return { buddy: null as Row | null, name: "", interactions: [] as Interaction[] };

      const b = mine[0];
      // The NAME cannot come off fms_hr_candidates: a buddy holds no grant on New
      // Recruitment, so RLS hands back nothing and the heading read "your new
      // joiner" for a month. fms_hr_my_buddy() is a SECURITY DEFINER reader that
      // returns the name and the job title and nothing else — never the phone
      // number, the expected salary or the CV that sit on the same row.
      const [{ data: mineRpc }, { data: logs }] = await Promise.all([
        supabase.rpc("fms_hr_my_buddy"),
        supabase
          .from("fms_hr_buddy_interactions")
          .select("id, happened_on, mode, notes, confirmed_at")
          .eq("buddy_id", b.id)
          .order("happened_on", { ascending: false }),
      ]);
      const mineRow = ((mineRpc ?? []) as { buddy_id: string; joiner_name: string | null }[])
        .find((x) => x.buddy_id === b.id);
      return {
        buddy: b,
        name: mineRow?.joiner_name ?? "your new joiner",
        interactions: (logs ?? []) as Interaction[],
      };
    },
  });

  if (isLoading) return <p className="text-[13.5px] text-grey-2">Loading…</p>;

  const buddy = data?.buddy ?? null;
  if (!buddy) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-[22px] font-bold text-navy">Being a buddy</h1>
          <p className="mt-1 text-[13.5px] text-grey-2">
            You are not buddying anybody at the moment. HR allocates a buddy when somebody new
            accepts an offer — you will get a notification if that is you.
          </p>
        </div>
      </div>
    );
  }

  const interactions = data?.interactions ?? [];
  const confirmed = interactions.filter((i) => i.confirmed_at).length;
  const closed = buddy.status === "closed" || buddy.status === "person_left";

  const log = async () => {
    setBusy(true);
    setErr(null);
    const { error } = await supabase.rpc("fms_hr_log_buddy_interaction", {
      p_buddy: buddy.id,
      p_on: on,
      p_mode: mode,
      p_notes: notes.trim(),
    });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setNotes("");
    void qc.invalidateQueries({ queryKey: ["myBuddy", user.id] });
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">You are {data?.name}'s buddy</h1>
        <p className="mt-1 text-[13.5px] text-grey-2">
          They joined {buddy.joining_date ? formatDateDMY(buddy.joining_date) : "recently"}. Over their
          first three months, {buddy.interaction_target} conversations — a coffee, a call, a walk
          round the floor. Log each one here so HR can confirm it.
        </p>
      </div>

      <Card className="p-5 space-y-3">
        <p className="text-[13px] text-grey-2">
          <strong className={confirmed >= buddy.interaction_target ? "text-ryg-green" : "text-navy"}>
            {confirmed} of {buddy.interaction_target}
          </strong>{" "}
          confirmed by HR
          {interactions.length > confirmed && ` · ${interactions.length - confirmed} waiting on them`}
          {buddy.due_on && ` · by ${formatDateDMY(buddy.due_on)}`}
        </p>

        {!closed && (
          <div className="space-y-3 border-t border-line pt-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <FieldLabel label="When" required>
                <TextInput type="date" value={on} max={todayIso()} onChange={(e) => setOn(e.target.value)} />
              </FieldLabel>
              <FieldLabel label="How" required>
                <div className="mt-1 flex flex-wrap gap-2">
                  {MODES.map((m) => (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => setMode(m.value)}
                      className={`rounded-pill border px-3 py-1.5 text-[12.5px] font-medium transition ${
                        mode === m.value ? "border-orange bg-orange/5 text-navy" : "border-line text-grey"
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </FieldLabel>
            </div>
            <TextArea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What you talked about — a line is plenty."
            />
            {err && <p className="text-[12.5px] text-ryg-red">{err}</p>}
            <Button size="sm" onClick={log} disabled={busy}>
              {busy ? "Saving…" : "Log it"}
            </Button>
          </div>
        )}

        {interactions.length > 0 && (
          <ul className="space-y-1.5 border-t border-line pt-3">
            {interactions.map((i) => (
              <li
                key={i.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2"
              >
                <div className="min-w-0">
                  <span className="text-[12.5px] font-medium text-navy">
                    {formatDateDMY(i.happened_on)} · {MODE_LABEL[i.mode] ?? i.mode}
                  </span>
                  {i.notes && <p className="text-[12px] text-grey leading-relaxed">{i.notes}</p>}
                </div>
                <span
                  className={`shrink-0 rounded-pill px-2 py-0.5 text-[11px] font-medium ${
                    i.confirmed_at ? "bg-[#E9F7EF] text-ryg-green" : "bg-page text-grey-2"
                  }`}
                >
                  {i.confirmed_at ? "Confirmed" : "With HR"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
