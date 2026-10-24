/** How one piece of work ended, in words — one vocabulary for the drill-down and the export. */
import type { Outcome, ReportItem } from "../data/report";

export const OUTCOME_LABEL: Record<Outcome, string> = {
  on_time: "On time",
  late: "Late",
  missed: "Not done",
  due: "Still due",
  projected: "Planned · not generated yet",
};

/** "Late (revised)" when a deadline was pushed back — done, but never on time. */
export const outcomeLabel = (i: Pick<ReportItem, "outcome" | "revised">): string =>
  i.outcome === "late" && i.revised ? "Late (revised)" : OUTCOME_LABEL[i.outcome];

export const OUTCOME_TONE: Record<Outcome, string> = {
  on_time: "bg-[#e7f5ec] text-[#1f8a4d]",
  late: "bg-[#fcf3df] text-[#B7820E]",
  missed: "bg-[#fdeceb] text-[#c0392b]",
  due: "bg-page text-grey",
  projected: "bg-page text-grey-2",
};
