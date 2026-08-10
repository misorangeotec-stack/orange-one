import { useMemo } from "react";
import AppShell from "@/shared/components/layout/AppShell";
import type { NotificationItem } from "@/shared/components/layout/types";
import { roleLabel, useSession } from "@/core/platform/session";
import { useOrgPersonById } from "@/core/platform/orgPeople";
import { buildSamplingNav } from "./nav";
import { useSamplingStore } from "./store";
import type { SamplingNotification } from "./types";

const B = "/sampling";

const linkFor = (n: SamplingNotification): string =>
  n.entityType === "request" ? `${B}/requests/${n.entityId}` : B;

/**
 * Wires the portal session + sampling store into the shared AppShell. The nav is
 * capability-driven, except for the two items every granted user gets (see nav.tsx).
 * The bell renders `n.text` RAW, so every notification we write is a whole sentence.
 */
export default function SamplingLayout() {
  const { user, role, isAdmin } = useSession();
  const s = useSamplingStore();
  const orgPersonById = useOrgPersonById();

  // Every per-step rule now lives in `store.canSeeQueue` — step owners, coordinators,
  // and the per-request assignees (collector, hand-over recipient, result recipient)
  // who own no step yet do most of the work. It moved there so the route guards in
  // SamplingApp enforce exactly what the sidebar offers, rather than a second copy
  // of ten conditions drifting out of step with these.
  const canTest = s.canSeeQueue("testing");
  const canCollect = s.canSeeQueue("sample_collect");
  const canSampleReceived = s.canSeeQueue("sample_received");
  const canSampleToLab = s.canSeeQueue("sample_to_lab");
  const canLabProcess = s.canSeeQueue("lab_process");
  const canResultReceived = s.canSeeQueue("result_received");
  const canSend = s.canSeeQueue("send_sample");
  const canConfirm = s.canSeeQueue("confirm_receipt");
  const canResult = s.canSeeQueue("result");
  const canHandover = s.canSeeQueue("result_handover");
  const canMonitor = s.isProcessCoordinator;
  const hasRequests =
    s.requests.length > 0 || s.isProcessCoordinator || canCollect || canSampleReceived ||
    canSampleToLab || canLabProcess || canResultReceived || canSend || canConfirm || canTest || canResult || canHandover;

  const nav = useMemo(
    () =>
      buildSamplingNav({
        isAdmin,
        canManageMasters: s.isAnyMasterManager,
        canCollect,
        canSampleReceived,
        canSampleToLab,
        canLabProcess,
        canResultReceived,
        canSend,
        canConfirm,
        canTest,
        canResult,
        canHandover,
        canMonitor,
        hasRequests,
      }),
    [isAdmin, s.isAnyMasterManager, canCollect, canSampleReceived, canSampleToLab, canLabProcess,
     canResultReceived, canSend, canConfirm, canTest, canResult, canHandover, canMonitor, hasRequests],
  );

  const notifItems: NotificationItem[] = s.notifications.map((n) => {
    const actor = n.actorId ? s.profileById(n.actorId) ?? orgPersonById(n.actorId) : undefined;
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
