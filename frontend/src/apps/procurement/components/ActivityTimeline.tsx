import Card from "@/shared/components/ui/Card";
import { formatDate, timeAgo } from "@/shared/lib/time";
import { useProcurementStore } from "../store";
import type { Activity } from "../types";

/** Human label + dot colour for an activity type. */
const TYPE_META: Record<string, { label: string; dot: string }> = {
  submitted: { label: "Request submitted", dot: "bg-blue" },
  sourced: { label: "Sourcing saved", dot: "bg-blue" },
  approved: { label: "Approved", dot: "bg-ryg-green" },
  rejected: { label: "Rejected", dot: "bg-ryg-red" },
  on_hold: { label: "Put on hold", dot: "bg-yellow" },
  cancelled: { label: "Cancelled", dot: "bg-grey-2" },
  reassigned: { label: "Reassigned", dot: "bg-orange" },
  po_generated: { label: "PO generated", dot: "bg-teal" },
  po_shared: { label: "PO shared", dot: "bg-orange" },
  pi_added: { label: "PI added", dot: "bg-blue" },
  advance_paid: { label: "Advance paid", dot: "bg-ryg-green" },
  installment_paid: { label: "Installment paid", dot: "bg-ryg-green" },
  dispatched: { label: "Dispatched", dot: "bg-teal" },
  grn_recorded: { label: "Goods received", dot: "bg-teal" },
  tally_booked: { label: "Booked in Tally", dot: "bg-blue" },
  nudge: { label: "Nudged", dot: "bg-orange" },
  escalate: { label: "Escalated", dot: "bg-ryg-red" },
};

const metaFor = (type: string) => TYPE_META[type] ?? { label: type.replace(/_/g, " "), dot: "bg-grey-2" };

/**
 * Vertical activity timeline. Caller passes the already-collected, newest-first
 * activity rows (e.g. a request + its lines, or a PO + its PIs). Actor names are
 * resolved from the directory.
 */
export default function ActivityTimeline({ rows }: { rows: Activity[] }) {
  const s = useProcurementStore();
  if (rows.length === 0) {
    return (
      <Card className="px-4 py-6 text-center text-[13px] text-grey-2">No activity recorded yet.</Card>
    );
  }
  return (
    <Card className="px-4 py-4">
      <ol className="relative space-y-4">
        {rows.map((a) => {
          const m = metaFor(a.type);
          const actor = a.actorId ? s.profileById(a.actorId)?.name ?? "Someone" : "System";
          return (
            <li key={a.id} className="flex gap-3">
              <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${m.dot}`} />
              <div className="min-w-0">
                <p className="text-[13px] text-ink leading-snug">
                  <span className="font-semibold text-navy">{m.label}</span>
                  {a.note ? <span className="text-grey"> — {a.note}</span> : null}
                </p>
                <p className="text-[11px] text-grey-2 mt-0.5">
                  {actor} · {timeAgo(a.createdAt)} · {formatDate(a.createdAt)}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
