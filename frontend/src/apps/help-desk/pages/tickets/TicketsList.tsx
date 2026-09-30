import TicketTable from "../../components/TicketTable";
import { useHelpStore } from "../../store";

/**
 * Every ticket the reader is allowed to see.
 *
 * ⚠ "ALL" IS NOT ALL, AND THE PAGE SAYS SO. `fms_help_can_see` withholds
 *   confidential tickets (grievance, POSH, disciplinary) from everyone but the
 *   raiser, that category's own owner and anyone escalated to — so this list is
 *   "what I can see", never "what exists". Printing a total here without that
 *   sentence is how somebody concludes there have been no grievances.
 */
export default function TicketsList() {
  const s = useHelpStore();

  return (
    <div>
      <h1 className="text-[20px] font-bold text-navy">All tickets</h1>
      <p className="mt-1 text-[13.5px] text-grey-2">
        Every ticket you are able to see. Grievance, POSH and disciplinary tickets are restricted to
        their own HR owner, so they are not listed here unless one of them is yours.
      </p>

      <div className="mt-4">
        <TicketTable
          tickets={s.tickets}
          loading={s.loading}
          showRaisedBy
          emptyTitle="No tickets yet"
          emptyMessage="Nothing has been raised through the help desk that you can see."
        />
      </div>
    </div>
  );
}
