import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import MultiSelect, { type MultiOption } from "@/shared/components/ui/MultiSelect";
import { TextInput } from "@/shared/components/ui/Form";
import { useSession } from "@/core/platform/session";
import { useLdStore } from "../../store";
import { dmy } from "../../lib/format";
import { Panel, useRun } from "./panelKit";
import type { Nomination, TrainingSession } from "../../types";

const RSVP_TONE: Record<string, string> = {
  accepted: "bg-[#E8F7EE] text-ryg-green",
  declined: "bg-[#FDECEC] text-ryg-red",
  pending: "bg-[#F1F4F9] text-grey-2",
};

/**
 * Steps 9, 10 and 11 — who is coming, who approved them, and who has answered.
 *
 * ⚠ ONLY PEOPLE ALREADY IN ORANGE HUB CAN BE NOMINATED. The client's rule, and
 *   there is deliberately no free-text box: `fms_ld_nominations.employee_id` is a
 *   foreign key to `profiles`. Somebody who is not in the system has to be
 *   created first, and the note below says so with a link rather than leaving the
 *   nominator hunting for why a name will not appear.
 */
export default function NominationsPanel({
  session: x,
  nominations,
  onError,
}: {
  session: TrainingSession;
  nominations: Nomination[];
  onError: (m: string | null) => void;
}) {
  const s = useLdStore();
  const { user, isAdmin } = useSession();
  const { busy, run } = useRun(onError);
  const [picked, setPicked] = useState<string[]>([]);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [declineFor, setDeclineFor] = useState(false);
  const [declineReason, setDeclineReason] = useState("");

  const mayNominate = s.canActOnSession("nomination", x.id);
  const mayApprove = s.canActOnSession("nomination_approval", x.id);
  const mine = nominations.find((n) => n.employeeId === user?.id && n.status === "approved");

  const already = new Set(nominations.map((n) => n.employeeId));
  const options: MultiOption[] = useMemo(
    () =>
      s.orgPeople
        .filter((p) => !already.has(p.id))
        .map((p) => ({ value: p.id, label: p.designation ? `${p.name} · ${p.designation}` : p.name })),
    [s.orgPeople, nominations],
  );

  const approved = nominations.filter((n) => n.status === "approved");
  const proposed = nominations.filter((n) => n.status === "proposed");

  return (
    <Panel
      title="Who is coming"
      hint={`${approved.length} on the list${x.capacity ? ` of ${x.capacity}` : ""} · ${
        approved.filter((n) => n.rsvp === "accepted").length
      } accepted, ${approved.filter((n) => n.rsvp === "declined").length} declined, ${
        approved.filter((n) => n.rsvp === "pending").length
      } yet to answer`}
      right={
        mayApprove && approved.length > 0 && !x.invitationsSentAt ? (
          <Button size="sm" disabled={busy} onClick={() => void run(() => s.writes.sendInvitations(x.id))}>
            Send invitations
          </Button>
        ) : x.invitationsSentAt ? (
          <span className="text-[12px] text-grey-2">Invitations sent {dmy(x.invitationsSentAt)}</span>
        ) : undefined
      }
    >
      {nominations.length === 0 ? (
        <p className="text-[13px] text-grey-2">Nobody nominated yet.</p>
      ) : (
        <div className="space-y-1.5">
          {nominations.map((n) => (
            <div
              key={n.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2"
            >
              <div className="min-w-0">
                <span className="text-[13.5px] text-navy">{s.personName(n.employeeId)}</span>
                <span className="ml-2 text-[12px] text-grey-2">
                  {n.source === "hod" ? "by their HOD" : n.source === "self" ? "self" : "by HR"}
                </span>
                {n.declineReason && (
                  <span className="ml-2 text-[12px] text-ryg-red">— {n.declineReason}</span>
                )}
                {n.rejectReason && (
                  <span className="ml-2 text-[12px] text-ryg-red">not taken forward: {n.rejectReason}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {n.status === "approved" ? (
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${RSVP_TONE[n.rsvp]}`}>
                    {n.rsvp === "pending" ? "No answer yet" : n.rsvp === "accepted" ? "Accepted" : "Declined"}
                  </span>
                ) : (
                  <span className="rounded-full bg-[#FFF7E6] px-2 py-0.5 text-[11px] font-semibold text-yellow">
                    {n.status === "proposed" ? "Waiting for HR" : n.status}
                  </span>
                )}
                {mayApprove && n.status === "proposed" && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void run(() => s.writes.decideNomination(n.id, true, null))}
                    >
                      Approve
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => setRejecting(n.id)}>
                      Reject
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {rejecting && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg bg-[#F8FAFD] p-3">
          <div className="flex-1 min-w-[16rem]">
            <TextInput
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this person not going?"
            />
          </div>
          <Button
            size="sm"
            disabled={busy || !reason.trim()}
            onClick={() =>
              void run(
                () => s.writes.decideNomination(rejecting, false, reason),
                () => {
                  setRejecting(null);
                  setReason("");
                },
              )
            }
          >
            Reject
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setRejecting(null)}>Cancel</Button>
        </div>
      )}

      {/* ---- the nominee's own RSVP ---------------------------------------- */}
      {mine && mine.invitedAt && mine.rsvp === "pending" && (
        <div className="rounded-lg border border-orange/40 bg-[#FFF8F4] p-3 space-y-2">
          <p className="text-[13.5px] text-navy">
            You are invited to this session on {dmy(x.sessionDate)}. Can you make it?
          </p>
          {declineFor ? (
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-[16rem]">
                <TextInput
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                  placeholder="Why can't you attend?"
                />
              </div>
              <Button
                size="sm"
                disabled={busy || !declineReason.trim()}
                onClick={() => void run(() => s.writes.rsvp(x.id, false, declineReason))}
              >
                Decline
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDeclineFor(false)}>Back</Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button size="sm" disabled={busy} onClick={() => void run(() => s.writes.rsvp(x.id, true, null))}>
                Yes, I'll be there
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDeclineFor(true)}>
                I can't make it
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ---- nominating ----------------------------------------------------- */}
      {mayNominate && !x.attendanceClosedAt && (
        <div className="space-y-2 border-t border-line pt-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[18rem]">
              <MultiSelect
                values={picked}
                onChange={setPicked}
                options={options}
                placeholder="Search for people to nominate"
                chips
              />
            </div>
            <Button
              size="sm"
              disabled={busy || picked.length === 0}
              onClick={() =>
                void run(
                  () => s.writes.nominate(x.id, picked, s.isPipelineStaff ? "hr" : "hod"),
                  () => setPicked([]),
                )
              }
            >
              Nominate {picked.length > 0 ? picked.length : ""}
            </Button>
          </div>
          <p className="text-[12px] text-grey-2">
            Only people who already have an Orange Hub login can be nominated.{" "}
            {isAdmin ? (
              <Link to="/admin/users" className="font-medium text-orange hover:underline">
                Create the user first
              </Link>
            ) : (
              "Ask an admin to create them first."
            )}
            {" "}— attendance, the assignment and their learning hours all hang off that account.
          </p>
        </div>
      )}
    </Panel>
  );
}
