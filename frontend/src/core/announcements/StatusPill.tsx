import { cn } from "@/shared/lib/cn";
import { STATUS_LABEL, type AnnouncementStatus } from "./data";

const TONE: Record<AnnouncementStatus, string> = {
  running: "bg-[#E8F7EE] text-[#1E8A4C] border-[#BFE8CF]",
  ended: "bg-orange-soft text-orange border-orange/30",
  expired: "bg-page text-grey border-line",
};

/** Running / Ended early / Expired. */
export default function StatusPill({ status }: { status: AnnouncementStatus }) {
  return (
    <span className={cn("inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11.5px] font-semibold", TONE[status])}>
      {STATUS_LABEL[status]}
    </span>
  );
}
