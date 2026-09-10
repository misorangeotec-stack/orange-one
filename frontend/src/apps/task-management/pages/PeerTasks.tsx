import { useEffect, useMemo } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import EmptyState from "@/shared/components/ui/EmptyState";
import PillToggle from "@/shared/components/ui/PillToggle";
import { useStickyScope, useStickyState } from "@/shared/lib/stickyState";
import { rememberReturnTo } from "@/shared/lib/returnTo";
import { useSession } from "../mock/session";
import { useTaskStore } from "../mock/store";
import { parseTaskFilters, taskLinkSignature } from "../lib/taskLink";
import { countsTowardPeerMetrics, isPeerTask, reportFor } from "../mock/selectors";
import { pooledPct } from "../lib/exportWeeklyScorecard";
import { rygCounts } from "../components/RygCells";
import RygBar from "../components/RygBar";
import TaskBrowser from "../components/TaskBrowser";
import type { Task } from "../types";

type View = "received" | "given" | "all";

/**
 * Peer Tasks (TM-1) — the one-off work HODs hand SIDEWAYS to each other.
 *
 * Why this screen exists at all: a peer task is nearly invisible to the person
 * who gave it. Team Tasks filters on assignedTo in [self, ...downline], and a
 * peer is in neither, so work you handed another HOD appears on no screen of
 * yours. My Tasks can reach it only by switching a dropdown to "Created by me".
 * This is the peer equivalent of My Tasks, and it is the gap the ask pointed at.
 *
 * ⚠ IT IS BUILT FROM THE VIEWER'S OWN GIVEN / RECEIVED WORK, never from "pick a
 *   HOD and see their peer score". The client declined that access (07-09-2026:
 *   the two HODs involved, plus admins), and `tasks_select` enforces it anyway —
 *   a third HOD's browser never receives those rows, so such a dropdown could not
 *   be populated for anyone but an admin.
 *
 * ⚠ ADMINS GET A THIRD VIEW instead of an empty screen. An admin never gives or
 *   receives peer work (their picker has no peer group, by design), so Given and
 *   Received are both empty for them forever. "All peer tasks" shows what
 *   `tasks_select` already returns an admin — it grants nothing new, it just puts
 *   it on one screen.
 *
 * Scoring here is ACTUAL-ONLY and deliberately does not touch `weekly_plans`: a
 * plan is set by an admin or by a HOD ABOVE the doer, so no plan can ever cover
 * work a lateral peer dropped in — and there are 8 plan rows in the entire
 * database anyway.
 */
export default function PeerTasks() {
  const { user, isAdmin } = useSession();
  const { tasks, mentionablePeople, departments } = useTaskStore();
  const [searchParams] = useSearchParams();
  const location = useLocation();

  const initialFilters = useMemo(() => parseTaskFilters(searchParams), [searchParams]);
  const sticky = useStickyScope("tm:peer-tasks", taskLinkSignature(searchParams));
  const [view, setView] = useStickyState<View>(sticky, "view", isAdmin ? "all" : "received");

  useEffect(() => {
    rememberReturnTo("/task-management/peer", location.pathname + location.search);
  }, [location.pathname, location.search]);

  const peerTasks = useMemo(() => tasks.filter(isPeerTask), [tasks]);

  // Given excludes anything assigned to me. That is not paranoia: a forward
  // reschedule re-creates the task with created_by = whoever shifted it (RLS
  // forces it — see shift_task_to_week), so a receiver who pushes a peer task to
  // next week becomes its creator. Without this guard their own continuation
  // would appear on their Given board as work they had handed out.
  const given = useMemo(
    () => peerTasks.filter((t) => t.createdBy === user.id && t.assignedTo !== user.id),
    [peerTasks, user.id],
  );
  const received = useMemo(() => peerTasks.filter((t) => t.assignedTo === user.id), [peerTasks, user.id]);

  const slice: Task[] = view === "given" ? given : view === "received" ? received : peerTasks;

  // The assignee filter offers exactly the people who appear in these rows,
  // resolved org-wide — a peer HOD is usually outside the viewer's RLS-scoped
  // directory, so the ordinary profiles list would render them blank.
  const people = useMemo(() => {
    const ids = new Set(slice.map((t) => t.assignedTo).filter(Boolean) as string[]);
    return mentionablePeople.filter((p) => ids.has(p.id));
  }, [slice, mentionablePeople]);

  // No new arithmetic: the same per-person selectors the scorecard uses, summed
  // across the counterparties exactly as the export's team row does, then pooled
  // by the export's own pooledPct. A peer board can span many weeks and many
  // people, which is why this does not go through aggregateRyg — that one wants
  // an explicit week list and walks people x weeks x tasks.
  const strip = useMemo(() => {
    const ids = [...new Set(slice.map((t) => t.assignedTo).filter(Boolean) as string[])];
    const sum = { green: 0, yellow: 0, red: 0, total: 0 };
    for (const id of ids) {
      const c = rygCounts(reportFor(slice, id, countsTowardPeerMetrics));
      sum.green += c.green;
      sum.yellow += c.yellow;
      sum.red += c.red;
      sum.total += c.total;
    }
    return { ...sum, pct: pooledPct(sum.green, sum.yellow, sum.total) };
  }, [slice]);

  const count = (n: number) => (n ? " (" + n + ")" : "");
  const VIEWS: { value: View; label: string }[] = [
    { value: "received", label: "Received" + count(received.length) },
    { value: "given", label: "Given" + count(given.length) },
    ...(isAdmin ? [{ value: "all" as View, label: "All peer tasks" + count(peerTasks.length) }] : []),
  ];

  const blurb =
    view === "given"
      ? "One-off tasks you have handed to another HOD."
      : view === "received"
        ? "One-off tasks another HOD has handed you. Scored here, not in your own weekly score."
        : "Every HOD-to-HOD task in the company.";

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[22px] font-bold text-navy">Peer Tasks</h2>
        <p className="text-grey text-[13px] mt-1">
          HOD-to-HOD work, scored on its own — it never counts in either person's team numbers.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <PillToggle<View> value={view} onChange={setView} options={VIEWS} />
        <span className="text-[12px] text-grey-2">{blurb}</span>
      </div>

      {/* Actual only — there is no planned side to compare against. */}
      {strip.total > 0 && (
        <Card className="p-5">
          <h3 className="text-[13px] font-bold text-navy">Actual score</h3>
          <p className="text-[11.5px] text-grey-2">
            {strip.total} task{strip.total !== 1 ? "s" : ""} · green = completed, yellow = revised, red = the rest
          </p>
          <div className="mt-3">
            <RygBar red={strip.pct.red} yellow={strip.pct.yellow} green={strip.pct.green} showLegend={false} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3 text-center">
            <Num label="Green" count={strip.green} pct={strip.pct.green} tone="text-ryg-green" />
            <Num label="Yellow" count={strip.yellow} pct={strip.pct.yellow} tone="text-ryg-yellow" />
            <Num label="Red" count={strip.red} pct={strip.pct.red} tone="text-ryg-red" />
          </div>
        </Card>
      )}

      {/* Keyed on the UNFILTERED slice. An empty RESULT is TaskBrowser's job, and it
          keeps the table, its sort toggles and its filter row standing. This answers
          the different question of "there is no peer work here at all". */}
      {slice.length === 0 ? (
        <EmptyState
          title={
            view === "given"
              ? "You haven't assigned any peer tasks"
              : view === "received"
                ? "No peer tasks assigned to you"
                : "No peer tasks yet"
          }
          message={
            view === "given"
              ? "Create a task and pick someone from the Other HODs group to assign work sideways."
              : "When another HOD assigns you a one-off task it appears here, and in My Tasks with a Peer badge."
          }
        />
      ) : (
        <TaskBrowser
          tasks={slice}
          people={people}
          departments={departments}
          emptyMessage="No peer tasks match these filters."
          hideWeekFilter
          initialFilters={initialFilters}
          enableExport
          exportSubtitle={"Peer tasks · " + (view === "given" ? "Given" : view === "received" ? "Received" : "All")}
          stickyScope={sticky}
        />
      )}
    </div>
  );
}

function Num({ label, count, pct, tone }: { label: string; count: number; pct: number; tone: string }) {
  return (
    <div>
      <div className={"text-[19px] font-bold tabular-nums leading-none " + tone}>{count}</div>
      <div className="mt-1 text-[10.5px] text-grey-2">
        {label} · {pct}%
      </div>
    </div>
  );
}
