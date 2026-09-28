import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { appName } from "@/apps/appInfo";
import { fetchHelpData, helpQueryKey } from "@/apps/help-desk/data/helpFetch";
import { openEntries } from "@/apps/help-desk/lib/queues";
import { STAGES, STEPS } from "@/apps/help-desk/lib/steps";
import { snapshotFrom } from "../lib/buckets";
import type { FmsAdapter } from "./types";

/**
 * Help Desk adapter — a row on the cross-FMS scoreboard.
 *
 * The counts come from `openEntries(...)` — literally the same call
 * help-desk/store.tsx makes, on the same react-query cache entry keyed on the
 * real session user, so the scoreboard can never drift from the app.
 *
 * ⚠⚠ THIS ROW IS SCOPED TO THE READER, AND NO OTHER ROW ON THIS BOARD IS.
 *   Every other adapter counts its module org-wide, because every other module's
 *   rows are readable by whoever can open the Control Center. Help Desk's are
 *   not: `fms_help_can_see` withholds ordinary tickets from people outside the
 *   desk and withholds the three CONFIDENTIAL categories — grievance, POSH,
 *   disciplinary — from everyone but their own owner.
 *
 *   So this row says "open tickets YOU can see", and a director who is not on
 *   the desk will read a smaller number than the HR Head does. That is the
 *   correct behaviour and it is the price of decision D4; the alternative —
 *   a definer function returning org-wide counts — would tell a reader how many
 *   grievances exist, which is the first thing the gate is meant to withhold.
 *
 *   The MIS (HD-10) is where org-wide figures belong, behind its own gate.
 *
 * ⚠ THE SLA MAP IS RESOLVED INSIDE `openEntries`, from the same config row the
 *   app reads — and five categories are deliberately UNTIMED, so they bucket as
 *   "no date" rather than as late. A reader scanning fifteen modules should not
 *   see a POSH complaint reported as overdue on a schedule nobody agreed to.
 *
 * ⚠ A CLOSED OR CANCELLED TICKET IS NOT COUNTED, and neither is a DRAFT (there
 *   are none — raising is one click). A ticket ON HOLD is still counted: it is
 *   open work somebody parked, and hiding it is how a ticket sits for five weeks
 *   with nobody asking why.
 */
export const helpDeskAdapter: FmsAdapter = {
  key: "help-desk",
  appId: "help-desk",
  name: appName("help-desk"),
  controlCenterPath: "/help-desk/monitoring",
  status: "live",
  useSnapshot() {
    const session = useSession();
    const userId = session.user?.id ?? null;
    const { data, isLoading, error } = useQuery({
      queryKey: helpQueryKey(userId),
      queryFn: fetchHelpData,
      enabled: !!userId,
    });
    const snapshot = useMemo(
      () =>
        data
          ? snapshotFrom(
              openEntries(
                data.tickets,
                new Map(data.categories.map((c) => [c.id, c])),
                data.config?.step_sla ?? null,
              ),
              STEPS,
              STAGES,
            )
          : null,
      [data],
    );
    return { snapshot, isLoading, error };
  },
};
