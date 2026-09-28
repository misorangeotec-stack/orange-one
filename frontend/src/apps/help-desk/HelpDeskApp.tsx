import type { ReactNode } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useSession } from "@/core/platform/session";
import { HelpStoreProvider, useHelpStore } from "./store";
import HelpDeskLayout from "./HelpDeskLayout";
import Dashboard from "./pages/Dashboard";
import NewTicket from "./pages/tickets/NewTicket";
import MyTickets from "./pages/tickets/MyTickets";
import TicketsList from "./pages/tickets/TicketsList";
import TicketDetail from "./pages/tickets/TicketDetail";
import AccessDenied from "./pages/system/AccessDenied";
import ComingSoon from "./pages/system/ComingSoon";
import NotFound from "./pages/system/NotFound";
import { QUEUE_PATH } from "./nav";
import { QUEUE_STEPS } from "./lib/steps";

function RequireAdmin({ children }: { children: ReactNode }) {
  const { isAdmin } = useSession();
  return isAdmin ? <>{children}</> : <AccessDenied />;
}

/**
 * Screens that belong to the people who ANSWER tickets, not to the people who
 * raise them.
 *
 * ⚠ HIDING THE NAV LINK IS NOT THE GATE. These routes are reachable by typing
 *   the URL for as long as they exist. RLS and `fms_help_can_act` are the real
 *   boundary — and on this module they are the only one that matters, because a
 *   confidential ticket is withheld by the database, not by the router. This is
 *   so the page says so instead of opening on an empty list the reader
 *   misreads as "there is nothing".
 */
function RequireDesk({ children }: { children: ReactNode }) {
  const s = useHelpStore();
  return s.isDeskStaff ? <>{children}</> : <AccessDenied />;
}

/**
 * Root of the HR Help Desk.
 *
 * ⚠ UNIVERSAL — every signed-in employee can open this module, because anyone
 *   may need to ask HR something. What they SEE is scoped by the nav and,
 *   authoritatively, by RLS: a plain employee gets the dashboard, their own
 *   tickets, the raise form and the two queues that land on THEM (answer a
 *   question, confirm a resolution). Do not "fix" the missing Module Access
 *   rows: there are none by design.
 */
export default function HelpDeskApp() {
  return (
    <HelpStoreProvider>
      <Routes>
        <Route element={<HelpDeskLayout />}>
          <Route index element={<Dashboard />} />

          {/* "new" must come before ":id" or "new" would be read as a ticket id. */}
          <Route path="new" element={<NewTicket />} />
          <Route path="mine" element={<MyTickets />} />
          <Route path="tickets" element={<RequireDesk><TicketsList /></RequireDesk>} />
          <Route path="tickets/:id" element={<TicketDetail />} />

          {/* HD-3 to HD-5 fill these. The nav offers them already, against the
              real shape of the module, so the sidebar is built once rather than
              growing a link per phase — and each stub names the phase that
              fills it, so nobody reports it as broken. */}
          {QUEUE_STEPS.map((step) => (
            <Route
              key={step}
              path={`queues/${QUEUE_PATH[step]}`}
              element={
                <ComingSoon
                  title="This queue is being built"
                  detail="HD-3 adds acknowledging and resolving, HD-4 the question-and-answer thread, HD-5 confirmation and reopening. Until then, open a ticket from My Tickets to read it."
                />
              }
            />
          ))}

          <Route
            path="monitoring"
            element={
              <RequireDesk>
                <ComingSoon
                  title="Control Center — HD-9"
                  detail="The pipeline across every open ticket, beside the other fourteen modules. It lands with My Work Today and the daily snapshot mail."
                />
              </RequireDesk>
            }
          />
          <Route
            path="reports"
            element={
              <RequireDesk>
                <ComingSoon
                  title="Reports — HD-10"
                  detail="SLA compliance, ageing, category trend, first response, reopened tickets and the confidential register. These are the monthly HR Helpdesk MIS."
                />
              </RequireDesk>
            }
          />
          <Route
            path="masters"
            element={
              <ComingSoon
                title="Ticket Categories — the screen is HD-1's last piece"
                detail="All 30 categories are live in the database and already routing tickets. The screen that edits them is next; until then a change needs an admin."
              />
            }
          />
          <Route
            path="master-requests"
            element={
              <ComingSoon
                title="Category Requests — HD-1's last piece"
                detail="Asking for a new ticket category, and approving one. The table is live; the screen is next."
              />
            }
          />
          <Route
            path="settings"
            element={
              <RequireAdmin>
                <ComingSoon
                  title="Settings — HD-3 onwards"
                  detail="Step owners, due dates, the process coordinators, who may be handed a ticket, and the escalation fallback. The escalation fallback matters most: until it is set, a reopen on a category whose escalation is only a label notifies nobody."
                />
              </RequireAdmin>
            }
          />

          <Route path="*" element={<NotFound />} />
        </Route>
        <Route path="*" element={<Navigate to="/help-desk" replace />} />
      </Routes>
    </HelpStoreProvider>
  );
}
