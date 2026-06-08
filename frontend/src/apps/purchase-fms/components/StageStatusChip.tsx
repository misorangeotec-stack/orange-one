import type { StageStatus } from "../types";
import { cn } from "@/shared/lib/cn";

/** Pill mapping a stage's lifecycle status to on-theme colors. */
const STYLES: Record<StageStatus, { label: string; cls: string; dot: string }> = {
  pending: { label: "Pending", cls: "bg-[#F1F5FB] text-grey", dot: "#8A99B0" },
  active: { label: "In Progress", cls: "bg-[#EAF1FE] text-blue", dot: "#3B82F6" },
  done: { label: "Done", cls: "bg-[#E8F8EF] text-[#1f9d57]", dot: "#27AE60" },
};

export default function StageStatusChip({ status, className }: { status: StageStatus; className?: string }) {
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
