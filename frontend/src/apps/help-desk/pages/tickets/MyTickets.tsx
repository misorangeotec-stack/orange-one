import { Link } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import TicketTable from "../../components/TicketTable";
import { useHelpStore } from "../../store";
import { B } from "../../nav";

/**
 * Everything this person has asked HR, newest first.
 *
 * This is the screen most of the company will ever use, and the reason the
 * module is universal: an employee who cannot see where their question got to
 * asks it again, to somebody else.
 */
export default function MyTickets() {
  const s = useHelpStore();

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-bold text-navy">My tickets</h1>
          <p className="mt-1 text-[13.5px] text-grey-2">
            Everything you have asked HR, and where each one has got to.
          </p>
        </div>
        {s.canRaise && (
          <Link to={`${B}/new`}>
            <Button>Raise a ticket</Button>
          </Link>
        )}
      </div>

      <div className="mt-4">
        <TicketTable
          tickets={s.myTickets}
          loading={s.loading}
          emptyTitle="You have not raised anything yet"
          emptyMessage="When you ask HR something through the help desk, it will appear here with who is answering it and by when."
        />
      </div>
    </div>
  );
}
