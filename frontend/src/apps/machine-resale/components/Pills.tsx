import type { ReactNode } from "react";
import type { MachineStatus, VideoState } from "../types";
import { STATUS_LABEL, VIDEO_LABEL } from "../types";

const STATUS_TONE: Record<MachineStatus, string> = {
  active: "bg-[#E7F6EC] text-[#1E7B3C]",
  inactive: "bg-[#EEF1F6] text-grey",
  sold: "bg-[#E6F0FB] text-[#1D4F91]",
};

export function StatusPill({ status }: { status: MachineStatus }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${STATUS_TONE[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

const VIDEO_TONE: Record<VideoState, string> = {
  created: "text-grey-2",
  uploading: "text-[#9A6400]",
  processing: "text-[#9A6400]",
  ready: "text-[#1E7B3C]",
  failed: "text-ryg-red",
};

export function VideoPill({ state }: { state: VideoState | null }) {
  if (!state) return <span className="text-grey-2">None</span>;
  return <span className={`whitespace-nowrap text-[12.5px] font-medium ${VIDEO_TONE[state]}`}>{VIDEO_LABEL[state]}</span>;
}

/** Inquiry status, coloured by where it sits in the follow-up. */
export function InquiryStatusPill({ label }: { label: string }) {
  const tone =
    label === "New"
      ? "bg-[#FFF1E8] text-[#B4470F]"
      : label === "Closed won"
        ? "bg-[#E7F6EC] text-[#1E7B3C]"
        : label === "Closed lost"
          ? "bg-[#EEF1F6] text-grey"
          : "bg-[#E6F0FB] text-[#1D4F91]";
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${tone}`}>
      {label || "(Blank)"}
    </span>
  );
}

export function PageHeader({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-[22px] font-bold text-navy">{title}</h1>
        {sub && <p className="mt-1 text-[13.5px] text-grey-2">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
