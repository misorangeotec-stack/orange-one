import type { Task, TaskStatus } from "../types";
import { cn } from "@/shared/lib/cn";
import { awaitingPeerReview, peerReopened } from "../lib/peerReview";

/** Status pill mapping task_status → label + on-theme colors. */
const STYLES: Record<TaskStatus, { label: string; cls: string; dot: string }> = {
  pending: { label: "Pending", cls: "bg-[#F1F5FB] text-grey", dot: "#8A99B0" },
  in_progress: { label: "In Progress", cls: "bg-[#EAF1FE] text-blue", dot: "#3B82F6" },
  completed: { label: "Completed", cls: "bg-[#E8F8EF] text-[#1f9d57]", dot: "#27AE60" },
  revised: { label: "Revised", cls: "bg-[#FEF6E6] text-[#B7820E]", dot: "#F8B62B" },
  shifted: { label: "Shifted", cls: "bg-orange-soft text-orange", dot: "#FF6A1F" },
};

/**
 * Peer task review (lib/peerReview.ts): a completed peer task is not done until the giver
 * marks it completed, and one they sent back says so until it is completed again.
 */
const IN_REVIEW = { label: "In review", cls: "bg-[#FFF6E5] text-[#9a6200]", dot: "#F8B62B" };
const REOPENED = { label: "Re-opened", cls: "bg-[#FDECEC] text-[#c0392b]", dot: "#E5484D" };

export default function StatusChip({
  status,
  notApplicable,
  peer,
  className,
}: {
  status: TaskStatus;
  /** Pass the task to show the peer review states (In review / Re-opened). */
  peer?: Pick<Task, "isPeerAssignment" | "status" | "peerClosedAt" | "peerReopenCount">;
  /** When true, render a greyed "Not Applicable" pill instead of the status (for "when" instances). */
  notApplicable?: boolean;
  className?: string;
}) {
  if (notApplicable) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap bg-[#EEF1F5] text-grey-2",
          className
        )}
      >
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#A6B0BF" }} />
        Not Applicable
      </span>
    );
  }
  const s = peer && awaitingPeerReview(peer) ? IN_REVIEW : peer && peerReopened(peer) ? REOPENED : STYLES[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap",
        s.cls,
        className
      )}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.dot }} />
      {s.label}
    </span>
  );
}
