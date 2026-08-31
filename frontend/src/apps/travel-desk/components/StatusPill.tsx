import { STATUS_LABEL, STATUS_TONE } from "../lib/format";
import type { TripStatus } from "../types";

/**
 * One trip's state, worded and coloured the same everywhere.
 *
 * ⚠ `booked` IS NEUTRAL, NOT GREEN. The trip is arranged, but the claim is still
 *   to come and any advance is still outstanding — colouring it as success would
 *   tell a coordinator the row is finished when it is halfway. The tones live in
 *   lib/format.ts so the dashboard, the lists and the detail screen cannot drift
 *   apart on what a state looks like.
 */
const TONE: Record<string, string> = {
  neutral: "bg-page text-navy",
  amber: "bg-[#FFF7E6] text-yellow",
  green: "bg-[#E9F7EF] text-ryg-green",
  red: "bg-[#FDECEC] text-ryg-red",
  muted: "bg-page text-grey-2",
};

export default function StatusPill({ status }: { status: TripStatus }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-pill px-2 py-0.5 text-[11.5px] font-semibold ${TONE[STATUS_TONE[status]]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
