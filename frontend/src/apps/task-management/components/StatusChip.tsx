import type { TaskStatus } from "../types";
import { cn } from "@/shared/lib/cn";

/** Status pill mapping task_status → label + on-theme colors. */
const STYLES: Record<TaskStatus, { label: string; cls: string; dot: string }> = {
  pending: { label: "Pending", cls: "bg-[#F1F5FB] text-grey", dot: "#8A99B0" },
  in_progress: { label: "In Progress", cls: "bg-[#EAF1FE] text-blue", dot: "#3B82F6" },
  completed: { label: "Completed", cls: "bg-[#E8F8EF] text-[#1f9d57]", dot: "#27AE60" },
  revised: { label: "Revised", cls: "bg-[#FEF6E6] text-[#B7820E]", dot: "#F8B62B" },
  shifted: { label: "Shifted", cls: "bg-orange-soft text-orange", dot: "#FF6A1F" },
};

export default function StatusChip({ status, className }: { status: TaskStatus; className?: string }) {
  const s = STYLES[status];
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
