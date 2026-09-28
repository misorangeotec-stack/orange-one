import type { TicketStatus } from "../types";

/**
 * A ticket's status, said in the reader's words rather than the database's.
 *
 * ⚠ THE LABELS ARE WRITTEN FOR THE EMPLOYEE, NOT FOR THE DESK. `awaiting_info`
 *   in SQL means "the desk is waiting"; to the person holding the ticket it
 *   means "they need something from you", and that is the only version that
 *   makes them act. Same reasoning as the two queue labels in nav.tsx.
 */
const LOOK: Record<TicketStatus, { label: string; cls: string }> = {
  open:          { label: "Open",            cls: "bg-[#EFF4FF] text-[#2E4B9B] border-[#C7D7FE]" },
  awaiting_info: { label: "Needs your reply", cls: "bg-[#FFF6ED] text-[#B54708] border-[#FEDF89]" },
  resolved:      { label: "Resolved",        cls: "bg-[#ECFDF3] text-[#027A48] border-[#A6F4C5]" },
  closed:        { label: "Closed",          cls: "bg-[#F2F4F7] text-[#475467] border-[#E4E7EC]" },
  cancelled:     { label: "Cancelled",       cls: "bg-[#F2F4F7] text-[#667085] border-[#E4E7EC]" },
  on_hold:       { label: "On hold",         cls: "bg-[#FFFAEB] text-[#B54708] border-[#FEDF89]" },
};

export default function StatusPill({ status }: { status: TicketStatus }) {
  const look = LOOK[status] ?? LOOK.open;
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11.5px] font-semibold ${look.cls}`}>
      {look.label}
    </span>
  );
}

/**
 * The marker on a confidential ticket.
 *
 * ⚠ IT IS NOT A LOCK ON THE SCREEN. A ticket a reader cannot see never reaches
 *   the browser at all — `fms_help_can_see` withholds the row. This badge is for
 *   the people who CAN see it, so they know the conversation is restricted
 *   before they forward it to somebody.
 */
export function ConfidentialPill() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-[#FECDCA] bg-[#FEF3F2] px-2 py-0.5 text-[11.5px] font-semibold text-[#B42318]"
      title="Only you, the named HR owner and anyone escalated to can read this ticket."
    >
      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.2">
        <rect x="4" y="10" width="16" height="10" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </svg>
      Confidential
    </span>
  );
}
