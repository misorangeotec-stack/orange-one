import { cn } from "@/shared/lib/cn";

/** Red pill flagging an entry whose active stage is past its planned date. */
export default function OverdueBadge({ days, className }: { days?: number; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill bg-[#FDECEC] px-2 py-0.5 text-[10.5px] font-semibold text-[#D64545] whitespace-nowrap",
        className
      )}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#D64545" }} />
      Overdue{days ? ` · ${days}d` : ""}
    </span>
  );
}
