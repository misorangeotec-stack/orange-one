import { useMemo, useState } from "react";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import MultiSelect from "@/shared/components/ui/MultiSelect";
import { FieldLabel, TextArea } from "@/shared/components/ui/Form";
import FileCapture from "@/shared/components/ui/FileCapture";
import { formatDateTimeDMY } from "@/shared/lib/date";
import { useHelpStore } from "../store";
import { helpDocUrl, postComment, uploadThreadFile } from "../data/helpWrites";
import type { Ticket, TicketActivity } from "../types";

/**
 * A ticket's whole story, and the box to add to it.
 *
 * ⚠ ONE LIST, NOT TWO TABS. Every workflow event and every remark interleaved,
 *   in order. "HR asked which month" and "HR answered it" are the same story,
 *   and splitting them makes the reader merge two lists by hand to follow it.
 *   Modelled on TripThread and CandidateTimeline.
 *
 * ⚠ MENTIONING IS THE ONLY THING THAT NOTIFIES, AND THE BOX SAYS SO. Commenting
 *   should not page four people; naming somebody is the deliberate act.
 *
 * ⚠ A MENTION OF SOMEBODY WHO CANNOT SEE THE TICKET IS DROPPED BY THE SERVER,
 *   silently — so the picker deliberately does NOT promise who will be reached.
 *   Promising and then dropping would be worse than the plain wording here.
 */
export default function TicketThread({ ticket }: { ticket: Ticket }) {
  const s = useHelpStore();
  const [text, setText] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const timeline = useMemo(
    () =>
      (s.data?.activity ?? [])
        .filter((a) => a.entityType === "ticket" && a.entityId === ticket.id)
        .slice()
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [s.data?.activity, ticket.id],
  );

  const peopleOptions = useMemo(
    () =>
      s.orgPeople
        .filter((p) => p.id !== s.userId)
        .map((p) => ({ value: p.id, label: p.name, sublabel: p.designation ?? undefined })),
    [s.orgPeople, s.userId],
  );

  // A closed ticket keeps its thread readable but not writable: a conversation
  // continuing after closure is one nobody is watching. Reopening is the way in.
  const closed = ticket.status === "closed" || ticket.status === "cancelled";
  const canPost = !closed && (text.trim().length > 0 || file !== null);

  const post = async () => {
    setBusy(true);
    setErr(null);
    try {
      const attachments = file ? [await uploadThreadFile(ticket.id, file)] : [];
      await postComment(ticket.id, text.trim(), mentions, attachments);
      setText("");
      setMentions([]);
      setFile(null);
      await s.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mt-4 p-5">
      <h2 className="text-[15px] font-bold text-navy">History</h2>

      {timeline.length === 0 ? (
        <p className="mt-2 text-[13px] text-grey-2">Nothing has happened yet.</p>
      ) : (
        <ol className="mt-3 space-y-4">
          {timeline.map((a) => (
            <TimelineRow key={a.id} a={a} personName={s.personName} />
          ))}
        </ol>
      )}

      {closed ? (
        <p className="mt-4 border-t border-line pt-3 text-[12.5px] text-grey-2">
          This ticket is {ticket.status}. Reopen it if there is more to say.
        </p>
      ) : (
        <div className="mt-5 border-t border-line pt-4">
          <FieldLabel label="Add to this ticket">
            <TextArea
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="A note, a correction, a chase."
            />
          </FieldLabel>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <FieldLabel
              label="Notify someone"
              hint="Nobody is notified unless you name them here."
            >
              <MultiSelect options={peopleOptions} values={mentions} onChange={setMentions} />
            </FieldLabel>
            <FieldLabel label="Attach something" hint="Optional.">
              <FileCapture value={file} onChange={setFile} />
            </FieldLabel>
          </div>

          {err && (
            <p className="mt-3 rounded-lg border border-[#FDA29B] bg-[#FEF3F2] px-3 py-2 text-[13px] text-[#B42318]">
              {err}
            </p>
          )}

          <div className="mt-3">
            <Button disabled={!canPost || busy} onClick={() => void post()}>
              {busy ? "Posting…" : "Post"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

/**
 * How each workflow event reads on the timeline.
 *
 * ⚠ AN EVENT MISSING FROM HERE FALLS BACK TO ITS RAW KEY — legible, but it reads
 *   like a bug. Add the label in the same commit as the RPC that writes it.
 */
const EVENT_LABEL: Record<string, string> = {
  help_ticket_raised: "Raised",
  help_ticket_attachment: "Attached a file",
  help_ticket_acknowledged: "Picked up by HR",
  help_ticket_info_requested: "HR asked for more",
  help_ticket_info_answered: "Answered",
  help_ticket_resolved: "Answered by HR",
  help_ticket_access_granted: "Given access to this confidential ticket",
  comment: "Note",
};

function TimelineRow({
  a,
  personName,
}: {
  a: TicketActivity;
  personName: (id: string | null) => string;
}) {
  const [err, setErr] = useState<string | null>(null);
  const attachments = a.meta.attachments ?? [];
  const mentions = (a.meta.mentions as string[] | undefined) ?? [];

  const open = async (path: string) => {
    setErr(null);
    try {
      window.open(await helpDocUrl(path), "_blank", "noopener");
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  // The access-grant entry is the one line on this timeline that exists to be
  // NOTICED — it records that somebody was let into a confidential ticket.
  const isAccessGrant = a.type === "help_ticket_access_granted";
  const grantee = isAccessGrant ? personName((a.meta.user_id as string) ?? null) : null;

  return (
    <li className={isAccessGrant ? "border-l-2 border-[#FECDCA] pl-3" : "border-l-2 border-line pl-3"}>
      <p className="text-[12.5px] text-grey-2">
        <span className="font-semibold text-navy">
          {a.actorId ? personName(a.actorId) : "System"}
        </span>{" "}
        · {EVENT_LABEL[a.type] ?? a.type} · {formatDateTimeDMY(a.createdAt)}
      </p>

      {isAccessGrant && (
        <p className="mt-1 text-[13px] font-semibold text-[#B42318]">
          {grantee} can now read this ticket.
        </p>
      )}

      {a.note && !isAccessGrant && (
        <p className="mt-1 whitespace-pre-wrap text-[13.5px] text-navy">{a.note}</p>
      )}

      {/* The question and the answer live in `meta`, not in `note`, because the
          notification text is written for the bell and reads differently. */}
      {typeof a.meta.question === "string" && (
        <p className="mt-1 whitespace-pre-wrap text-[13.5px] text-navy">{a.meta.question}</p>
      )}
      {typeof a.meta.answer === "string" && (
        <p className="mt-1 whitespace-pre-wrap text-[13.5px] text-navy">{a.meta.answer}</p>
      )}
      {typeof a.meta.resolution === "string" && (
        <p className="mt-1 whitespace-pre-wrap text-[13.5px] text-navy">{a.meta.resolution}</p>
      )}

      {mentions.length > 0 && (
        <p className="mt-1 text-[12px] text-grey-2">
          Notified: {mentions.map((m) => personName(m)).join(", ")}
        </p>
      )}

      {attachments.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-2">
          {attachments.map((f) => (
            <li key={f.path}>
              <button
                type="button"
                onClick={() => void open(f.path)}
                className="rounded-md border border-line px-2 py-1 text-[12px] font-semibold text-navy hover:bg-[#F7F8FA]"
              >
                {f.name ?? "Attachment"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {err && <p className="mt-1 text-[12px] text-[#B42318]">{err}</p>}
    </li>
  );
}
