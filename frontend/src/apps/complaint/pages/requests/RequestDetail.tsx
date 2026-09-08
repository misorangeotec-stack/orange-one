import { useParams, Link } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Button from "@/shared/components/ui/Button";
import StatusPill from "../../components/StatusPill";
import ComplaintStepper from "../../components/ComplaintStepper";
import ComplaintRecap from "../../components/ComplaintRecap";
import { useComplaintStore } from "../../store";
import { requestsHref } from "../../lib/routes";
import { COMPLAINT_TYPE_TONE, formatDateTime } from "../../lib/format";
import { COMPLAINT_TYPE_LABEL, type ComplaintRequest } from "../../types";

/**
 * One complaint, whole.
 *
 * ⚠ IT RENDERS THE SAME `ComplaintRecap` THE STEP MODALS DO, deliberately. This
 *   page used to hand-roll its own field list, which meant the record could read
 *   one way here and another inside a bucket — and when the workflow was
 *   reshaped, the hand-rolled copy silently kept describing the retired chain.
 *   One component, one description, and the attachments come along for free.
 *
 * Read-only: acting on a step happens in that step's queue, where the person who
 * owns it is already standing.
 */
export default function RequestDetail() {
  const { id = "" } = useParams();
  const s = useComplaintStore();
  const r: ComplaintRequest | undefined = s.requestById(id);

  if (s.loading) return <p className="text-[13.5px] text-grey-2">Loading…</p>;

  if (!r) {
    return (
      <Card className="max-w-lg mx-auto mt-10 p-8 text-center">
        <h1 className="text-[20px] font-bold text-navy">Complaint not found</h1>
        <p className="text-[13.5px] text-grey-2 mt-2">
          It may have been cancelled, or you may not have access to it.
        </p>
        <Link
          to={requestsHref()}
          className="mt-5 inline-block text-[13px] font-semibold text-orange hover:underline"
        >
          Back to all complaints
        </Link>
      </Card>
    );
  }

  const activity = s.activityFor("request", r.id);

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-[22px] font-bold text-navy">{r.complaintNo}</h1>
            <StatusPill status={r.status} />
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-[11.5px] font-medium ${COMPLAINT_TYPE_TONE[r.complaintType]}`}
            >
              {COMPLAINT_TYPE_LABEL[r.complaintType]}
            </span>
          </div>
          <p className="text-[13.5px] text-grey-2 mt-1">{r.partyName ?? "—"}</p>
        </div>
        <Link to={requestsHref()}>
          <Button size="sm" variant="ghost">
            All complaints
          </Button>
        </Link>
      </div>

      {/* The chain across the top — where this one has got to. */}
      <ComplaintStepper r={r} />

      {r.status === "on_hold" && (
        <Card className="p-4 bg-amber-50 border-amber-200">
          <p className="text-[13px] font-semibold text-amber-800">This complaint is on hold.</p>
          {r.holdReason && <p className="text-[12.5px] text-amber-800/90 mt-1">{r.holdReason}</p>}
        </Card>
      )}
      {r.status === "cancelled" && (
        <Card className="p-4 bg-grey-1 border-line">
          <p className="text-[13px] font-semibold text-navy">Cancelled.</p>
          {r.cancelReason && <p className="text-[12.5px] text-grey-2 mt-1">{r.cancelReason}</p>}
        </Card>
      )}

      {/* Every field, every step's remarks, and every attachment. */}
      <ComplaintRecap r={r} />

      <Card className="p-5">
        <h2 className="text-[15px] font-bold text-navy mb-2">History</h2>
        <ol className="space-y-2">
          {activity.map((a) => (
            <li key={a.id} className="flex items-baseline gap-3">
              <span className="text-[11.5px] text-grey-2 w-40 shrink-0">
                {formatDateTime(a.createdAt)}
              </span>
              <span className="text-[13px] text-ink whitespace-pre-wrap break-words">
                {a.note ?? a.type}
                {a.actorId && <span className="text-grey-2"> — {s.personName(a.actorId)}</span>}
              </span>
            </li>
          ))}
          {activity.length === 0 && (
            <li className="text-[13px] text-grey-2">Nothing recorded yet.</li>
          )}
        </ol>
      </Card>
    </div>
  );
}
