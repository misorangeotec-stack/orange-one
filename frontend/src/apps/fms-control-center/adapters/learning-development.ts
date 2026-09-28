import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { appName } from "@/apps/appInfo";
import { fetchLdData, ldQueryKey } from "@/apps/learning-development/data/ldFetch";
import { resolveStepSla } from "@/apps/learning-development/lib/sla";
import { STAGES, STEPS } from "@/apps/learning-development/lib/steps";
import { buildLdWork, openQueueEntries } from "@/apps/learning-development/lib/work";
import { snapshotFrom } from "../lib/buckets";
import type { FmsAdapter } from "./types";

/**
 * Learning & Development adapter — a row on the cross-FMS scoreboard.
 *
 * ⚠ IT COUNTS ALL TWENTY-TWO STEPS, NOT THE SEVEN THE SIDEBAR SHOWS. The module's
 *   own queues cover the REQUEST chain (steps 1–8), because a request sits at one
 *   step and that is what a queue screen can show. The other fourteen hang off a
 *   session or off one person's obligation, and a session holds several at once —
 *   nominations still open while the material is already up. `buildLdWork` is the
 *   one builder that returns all of them, so this row and the module can never
 *   disagree about what is outstanding.
 *
 * ⚠ THE SLA MAP IS RESOLVED HERE, from the same config row the app reads. Passing
 *   it is what makes a late step show as late; omitting it would bucket everything
 *   as "no date", which reads as "nothing is outstanding" to a director scanning
 *   twelve modules. `resolveStepSla` merges the stored map over the defaults, so a
 *   module nobody has configured still reports honest dates rather than none.
 *
 * ⚠ WHAT THIS ROW DOES NOT SHOW:
 *     a DRAFT request — it owes nobody and is private to its author;
 *     a CANCELLED or RESCHEDULED session — still on the calendar as history, but
 *       owing nobody an action today;
 *     an RSVP nobody has been invited to answer yet — the invitation has to have
 *       gone out before the nominee owes a reply;
 *     the 30-day effectiveness note before attendance is closed — the row that
 *       carries its deadline does not exist until then.
 *   All of them fall out of `buildLdWork` simply not emitting an open step.
 */
export const learningDevelopmentAdapter: FmsAdapter = {
  key: "learning-development",
  appId: "learning-development",
  name: appName("learning-development"),
  controlCenterPath: "/learning-development",
  status: "live",
  useSnapshot() {
    const session = useSession();
    const userId = session.user?.id ?? null;
    const { data, isLoading, error } = useQuery({
      queryKey: ldQueryKey(userId),
      queryFn: fetchLdData,
      enabled: !!userId,
    });
    const snapshot = useMemo(
      () =>
        data
          ? snapshotFrom(
              openQueueEntries(buildLdWork(data, resolveStepSla(data.config?.step_sla ?? null))),
              STEPS,
              STAGES,
            )
          : null,
      [data],
    );
    return { snapshot, isLoading, error };
  },
};
