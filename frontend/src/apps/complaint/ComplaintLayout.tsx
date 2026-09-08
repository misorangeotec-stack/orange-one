import { useMemo } from "react";
import AppShell from "@/shared/components/layout/AppShell";
import type { NotificationItem } from "@/shared/components/layout/types";
import { roleLabel, useSession } from "@/core/platform/session";
import { useOrgPersonById } from "@/core/platform/orgPeople";
import { buildComplaintNav } from "./nav";
import { useComplaintStore } from "./store";
import { B, requestHref } from "./lib/routes";
import type { ComplaintNotification } from "./types";

const linkFor = (n: ComplaintNotification): string =>
  n.entityType === "request" ? requestHref(n.entityId) : B;

/**
 * Wires the portal session + complaint store into the shared AppShell.
 *
 * Every per-step visibility rule lives in `store.canSeeQueue` — step owners,
 * coordinators, and the per-request assignees (investigator, CAPA owner,
 * resolver, confirmer) who own no step but do most of the work. It lives there so
 * the route guards in ComplaintApp enforce exactly what this sidebar offers,
 * rather than a second copy of six conditions drifting out of step.
 *
 * The bell renders `n.text` RAW, so every notification we write is a whole sentence.
 */
export default function ComplaintLayout() {
  const { user, role, isAdmin } = useSession();
  const s = useComplaintStore();
  const orgPersonById = useOrgPersonById();

  const canPlant = s.canSeeQueue("plant");
  const canService = s.canSeeQueue("service");
  const canApprove = s.canSeeQueue("approval");
  const canReview = s.canSeeQueue("management_review");
  const canMonitor = s.canMonitor;

  const hasRequests =
    s.isModuleViewer ||
    s.isProcessCoordinator ||
    s.requests.length > 0 ||
    canPlant ||
    canService ||
    canApprove ||
    canReview;

  const nav = useMemo(
    () =>
      buildComplaintNav({
        isAdmin,
        canSeeMasters: s.canSeeMasters,
        canPlant,
        canService,
        canApprove,
        canReview,
        canMonitor,
        canRaise: s.canRaise,
        canEdit: s.canEdit,
        hasRequests,
      }),
    [
      isAdmin,
      s.canSeeMasters,
      canPlant,
      canService,
      canApprove,
      canReview,
      canMonitor,
      s.canRaise,
      s.canEdit,
      hasRequests,
    ],
  );

  const notifItems: NotificationItem[] = s.notifications.map((n) => {
    const actor = n.actorId ? (s.profileById(n.actorId) ?? orgPersonById(n.actorId)) : undefined;
    return {
      id: n.id,
      actorName: n.actorId ? (actor?.name ?? "Someone") : "System",
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
      user={{
        name: user.name,
        designation: user.designation,
        color: user.avatarColor,
        roleLabel: roleLabel(role),
      }}
      notifications={notifItems}
      onMarkRead={(ids) => {
        void s.markNotificationsRead(ids);
      }}
    />
  );
}
