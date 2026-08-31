import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import MultiSelect from "@/shared/components/ui/MultiSelect";
import { TextArea } from "@/shared/components/ui/Form";
import FileCapture from "@/shared/components/ui/FileCapture";
import { formatDateTimeDMY } from "@/shared/lib/date";
import { useOrgPersonById, fetchOrgPeople } from "@/core/platform/orgPeople";
import { useTravelStore } from "../store";
import { fetchTripActivity, tripActivityKey } from "../data/travelFetch";
import { postComment } from "../data/travelCommentWrites";
import { uploadTravelDoc, travelDocUrl } from "../data/travelBookingWrites";
import type { Trip } from "../types";

/**
 * A trip's timeline — every workflow event and every comment, in one list.
 *
 * ⚠ ONE LIST, NOT TWO TABS. "The Director asked why economy was not available"
 *   and "the Director approved it" are the same story, and splitting them makes
 *   a reader interleave two lists by hand to follow it. Modelled on
 *   hr-recruitment's CandidateTimeline, which does the same.
 *
 * ⚠ ATTACHMENTS ARE NEW WORK — CandidateTimeline has none. A travel argument is
 *   almost always about a document: the hotel's "no rooms available" mail that
 *   justifies §7.3, the airline's cancellation notice, the corrected invoice. A
 *   thread that cannot carry one sends the conversation to WhatsApp, where the
 *   evidence is lost by the time Finance asks for it.
 *
 * ⚠ MENTIONING IS THE ONLY THING THAT NOTIFIES, and the box says so. Commenting
 *   should not page four people; naming somebody is the deliberate act.
 *
 * ⚠ THE TIMELINE IS ITS OWN QUERY. Activity is the one child table not in the
 *   snapshot — see `fetchTripActivity` for why — so posting invalidates that key
 *   and nothing else.
 */

/** How each workflow event reads on the timeline. */
const EVENT_LABEL: Record<string, string> = {
  trip_submitted: "Submitted for approval",
  trip_approved: "Approved",
  trip_returned: "Sent back for changes",
  trip_rejected: "Turned down",
  tc_downgraded: "Regularised late — repriced at TC-D (§3.5)",
  advance_approved: "Advance approved",
  advance_paid: "Advance paid",
  advance_recovered: "Advance handed back",
  trip_booked: "Booked",
  cancellation_requested: "Cancellation requested",
  cancellation_refused: "Cancellation refused",
  trip_cancelled: "Cancelled",
  claim_submitted: "Expense claim filed",
  claim_returned: "Claim sent back",
  claim_approved: "Claim approved",
  claim_verified: "Verified by Finance",
  trip_settled: "Settled",
  trip_closed_no_claim: "Closed with nothing to claim",
  trip_held: "Put on hold",
  trip_resumed: "Taken off hold",
};

export default function TripThread({ trip }: { trip: Trip }) {
  const s = useTravelStore();
  const qc = useQueryClient();
  const personById = useOrgPersonById();

  const { data: activity, isLoading } = useQuery({
    queryKey: tripActivityKey(trip.id),
    queryFn: () => fetchTripActivity(trip.id),
  });

  const { data: people } = useQuery({
    queryKey: ["orgPeople"],
    queryFn: fetchOrgPeople,
    staleTime: 5 * 60 * 1000,
  });

  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const peopleOptions = useMemo(
    () =>
      (people ?? [])
        .filter((p) => p.id !== s.userId)
        .map((p) => ({
          value: p.id,
          label: p.name,
          sublabel: p.designation ?? undefined,
        })),
    [people, s.userId],
  );

  const post = async () => {
    setBusy(true);
    setErr(null);
    try {
      const attachments: { path: string; name?: string }[] = [];
      if (file) {
        /* Filed under `receipt`, which is the slot the traveller may write and
           every reader of the trip may see. The four storage policies from
           20261005121600 govern it unchanged — a comment cannot smuggle a file
           into a trip, because the policy reads the owning trip out of the path. */
        attachments.push({ path: await uploadTravelDoc(trip.id, "receipt", file), name: file.name });
      }
      await postComment(trip.id, { text: text.trim(), mentions, attachments });
      setText("");
      setMentions([]);
      setFile(null);
      await qc.invalidateQueries({ queryKey: tripActivityKey(trip.id) });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openDoc = async (path: string) => {
    try {
      window.open(await travelDocUrl(path), "_blank", "noopener");
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const rows = activity ?? [];

  return (
    <Card className="p-4">
      <h2 className="text-[15px] font-bold text-navy">History &amp; discussion</h2>
      <p className="mt-1 text-[13px] text-grey-2">
        Everything that has happened to this trip, and everything anybody has said about it, in one
        list.
      </p>

      {isLoading && <p className="mt-3 text-[12.5px] text-grey-2">Loading…</p>}

      {!isLoading && rows.length === 0 && (
        <p className="mt-3 text-[12.5px] text-grey-2">Nothing has happened yet.</p>
      )}

      <ul className="mt-3 space-y-3">
        {rows.map((a) => {
          const who = personById(a.actorId)?.name ?? "Someone";
          const isComment = a.type === "comment";
          const label = EVENT_LABEL[a.type] ?? a.type.replace(/_/g, " ");
          const attachments = a.meta.attachments ?? [];
          const mentioned = (a.meta.mentions ?? [])
            .map((id) => personById(id)?.name)
            .filter(Boolean) as string[];

          return (
            <li
              key={a.id}
              className={
                "rounded-xl border p-3 " +
                (isComment ? "border-line bg-page/50" : "border-line/60")
              }
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-[12.5px] font-semibold text-navy">
                  {isComment ? who : label}
                  {!isComment && <span className="font-normal text-grey-2"> · {who}</span>}
                </div>
                <div className="text-[11px] text-grey-2">{formatDateTimeDMY(a.createdAt)}</div>
              </div>

              {a.note && (
                <p className="mt-1 whitespace-pre-wrap text-[12.5px] text-navy">{a.note}</p>
              )}

              {mentioned.length > 0 && (
                <p className="mt-1 text-[11.5px] text-grey-2">Notified {mentioned.join(", ")}</p>
              )}

              {attachments.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-3">
                  {attachments.map((att) => (
                    <button
                      key={att.path}
                      type="button"
                      className="text-[12px] font-semibold text-orange underline"
                      onClick={() => void openDoc(att.path)}
                    >
                      {att.name ?? "Attachment"}
                    </button>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* ⚠ Offered to anybody who can SEE the trip, not only to whoever's desk it
          is on. A Director querying a claim and HR chasing a booking are the two
          most common reasons to write here, and neither is the current actor. */}
      <div className="mt-4 border-t border-line pt-3">
        <TextArea
          rows={2}
          value={text}
          placeholder="Ask a question, or record what was agreed"
          onChange={(e) => setText(e.target.value)}
        />

        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-grey">
              Notify
            </div>
            <MultiSelect
              values={mentions}
              options={peopleOptions}
              onChange={setMentions}
              placeholder="Nobody — this is just on the record"
            />
            <p className="mt-1 text-[11px] text-grey-2">
              Only the people named here are told. A comment with nobody named still stays on the
              trip for ever.
            </p>
          </div>
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-grey">
              Attach
            </div>
            <FileCapture value={file} onChange={setFile} disabled={busy} />
            <p className="mt-1 text-[11px] text-grey-2">
              The hotel&rsquo;s &ldquo;no rooms&rdquo; mail, a cancellation notice, a corrected
              invoice — whatever the argument is actually about.
            </p>
          </div>
        </div>

        {err && <p className="mt-2 text-[12.5px] font-semibold text-[#B3261E]">{err}</p>}

        <div className="mt-3">
          <Button onClick={post} disabled={busy || (!text.trim() && !file)}>
            {busy ? "Posting…" : "Post"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
