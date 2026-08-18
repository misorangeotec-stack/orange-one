import { useMemo } from "react";
import AppShell from "@/shared/components/layout/AppShell";
import type { NotificationItem } from "@/shared/components/layout/types";
import { roleLabel, useSession } from "@/core/platform/session";
import { useOrgPersonById } from "@/core/platform/orgPeople";
import { buildDispatchNav, QUEUE_PATH } from "./nav";
import { useDispatchStore } from "./store";
import { STEPS } from "./lib/steps";
import { STEP_HOLD } from "./lib/format";
import type { QueueStep } from "./lib/queues";
import type { DispatchNotification } from "./types";

const B = "/order-to-dispatch";

/**
 * Where a bell notification lands. Order alerts deep-link to the order itself
 * rather than to a queue: the reader wants the whole picture, and the order page
 * carries the rail that says which step is now owed.
 */
const linkFor = (n: DispatchNotification): string =>
  n.entityType === "order" ? `${B}/orders/${n.entityId}` : `${B}/master-requests`;

export default function OrderToDispatchLayout() {
  const { user, role, isAdmin } = useSession();
  const s = useDispatchStore();
  const orgPersonById = useOrgPersonById();

  const queueSteps = STEPS.filter((st) => !st.noQueue).map((st) => st.key as QueueStep);

  /**
   * A queue appears for its owners, and for the coordinators and admins who oversee
   * every step. Nobody else — a step you have no permission for is not a step you
   * should be reading about.
   *
   * ⚠ THERE WAS A THIRD CLAUSE HERE — `myQueue(step).length > 0`, meant to keep the
   *   link for a stand-in covering someone's work. It did the opposite: `myQueue`
   *   returned EVERY pending entry for the step, so it was true for everyone, and
   *   every queue showed for anyone who owned any one step. `myQueue` is now scoped
   *   to what the caller may act on, which makes the clause strictly narrower than
   *   `canSeeQueue` and therefore pointless — so it is gone rather than rewritten.
   */
  const queues = useMemo(() => {
    const out = {} as Record<QueueStep, boolean>;
    for (const step of queueSteps) {
      out[step] = s.canSeeQueue(step);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s]);

  /*
    Sales Return is asked for separately, because `queueSteps` above is derived
    from STEPS and this step is deliberately not in it — reading it out of that
    record would give `undefined` and silently hide the link for its own owners.
  */
  const canSeeSalesReturn = s.canSeeQueue("sales_return");
  const salesReturnPending = canSeeSalesReturn ? s.salesReturnPending.length : 0;

  const anyQueue = queueSteps.some((step) => queues[step]) || canSeeSalesReturn;
  const hasOrders = s.orders.length > 0 || s.isProcessCoordinator || anyQueue;

  /*
    Counted through `myQueue`, not over every order, so the badge promises exactly
    what the page will show. Ownership is per location — a Vapi credit checker
    opening the queue sees Vapi's holds, and a badge counting Ahmedabad's too
    would send them looking for rows that are not there.
  */
  const heldByStep = useMemo(() => {
    const out: Partial<Record<QueueStep, number>> = {};
    for (const step of queueSteps) {
      const hold = STEP_HOLD[step];
      if (!hold || !queues[step]) continue;
      const n = s.myQueue(step).filter((r) => hold.held(r.order)).length;
      if (n > 0) out[step] = n;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, queues]);

  const nav = useMemo(
    () =>
      buildDispatchNav({
        isAdmin,
        canManageMasters: s.isAnyMasterManager,
        canMonitor: s.isProcessCoordinator,
        hasOrders,
        canRaise: s.canRaise,
        pendingReviews: s.resolvableRequests.length,
        heldByStep,
        queues,
        canSeeSalesReturn,
        salesReturnPending,
      }),
    [isAdmin, s.isAnyMasterManager, s.isProcessCoordinator, hasOrders, s.canRaise, s.resolvableRequests.length, heldByStep, queues, canSeeSalesReturn, salesReturnPending],
  );

  const notifItems: NotificationItem[] = s.notifications.map((n) => {
    const actor = n.actorId ? s.profiles.find((p) => p.id === n.actorId) ?? orgPersonById(n.actorId) : undefined;
    return {
      id: n.id,
      actorName: n.actorId ? actor?.name ?? "Someone" : "System",
      actorColor: actor?.avatarColor,
      message: n.text,
      createdAt: n.createdAt,
      unread: !n.readAt,
      to: linkFor(n),
    };
  });

  return (
    <AppShell
      nav={nav}
      role={role}
      user={{ name: user.name, designation: user.designation, color: user.avatarColor, roleLabel: roleLabel(role) }}
      notifications={notifItems}
      onMarkRead={(ids) => {
        void s.markNotificationsRead(ids);
      }}
    />
  );
}

export { QUEUE_PATH };
