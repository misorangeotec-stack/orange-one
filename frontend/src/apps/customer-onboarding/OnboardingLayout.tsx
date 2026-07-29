/**
 * Portal chrome for the standalone New Customer Onboarding app.
 *
 * The module used to live inside the Outstanding Dashboard and borrow that app's
 * sidebar, financial-year selector and live-mode banner — none of which it ever
 * used. Standing on its own it gets the ordinary portal AppShell, exactly like
 * every other FMS module, and the notifications that were behind a bespoke
 * CustomerBell now ride the shell's own bell.
 */
import { useMemo } from "react";
import AppShell from "@/shared/components/layout/AppShell";
import type { NotificationItem } from "@/shared/components/layout/types";
import { roleLabel, useSession } from "@/core/platform/session";
import { useOrgPersonById } from "@/core/platform/orgPeople";
import { useCustomerStore } from "@hub/lib/customerOnboarding/store";
import { markNotificationsRead } from "@hub/data/customerOnboarding/customerWrites";
import { OWNED_STEPS } from "@hub/lib/customerOnboarding/steps";
import { detailHref } from "@hub/lib/customerOnboarding/routes";
import { buildOnboardingNav } from "./nav";

export default function OnboardingLayout() {
  const { user, role, isAdmin } = useSession();
  const s = useCustomerStore();
  const orgPersonById = useOrgPersonById();

  /**
   * A queue is shown to its owners and to coordinators — and to anyone who
   * actually has work sitting in it, so a stand-in covering for someone on leave
   * never loses the link to their own pending work.
   */
  const queues = useMemo(() => {
    const out: Record<string, boolean> = {};
    for (const step of OWNED_STEPS) {
      out[step] = s.isCoordinator || s.isStepOwner(step) || s.queueFor(step).length > 0;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s]);

  const nav = useMemo(
    () => buildOnboardingNav({ isAdmin, canRaise: s.canRaise, queues }),
    [isAdmin, s.canRaise, queues],
  );

  // Every notification in this module is about a request, so all of them
  // deep-link to it — the detail page carries the stage rail that says which
  // step is now owed, which a queue listing does not.
  const notifItems: NotificationItem[] = s.notifications.map((n) => {
    const actor = n.actorId ? orgPersonById(n.actorId) : undefined;
    return {
      id: n.id,
      actorName: n.actorId ? actor?.name ?? "Someone" : "System",
      actorColor: actor?.avatarColor,
      message: n.text,
      createdAt: n.createdAt,
      unread: !n.readAt,
      to: detailHref(n.entityId),
    };
  });

  return (
    <AppShell
      nav={nav}
      role={role}
      user={{ name: user.name, designation: user.designation, color: user.avatarColor, roleLabel: roleLabel(role) }}
      notifications={notifItems}
      onMarkRead={(ids) => {
        void markNotificationsRead(ids).then(() => s.refresh());
      }}
    />
  );
}
