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

  // Keep a person's queue link visible even after they finish the step, so it
  // never disappears mid-flow: show it if they are/were the collector (or the
  // hand-over recipient) on any request, not only while work is pending.
  const uid = user?.id ?? "";
  const iAmLabCollector = !!uid && s.requests.some((r) => r.labTestingRequired !== false && r.collectorId === uid);
  const iAmCollector = !!uid && s.requests.some((r) => r.labTestingRequired === false && r.collectorId === uid);
  const iAmRecipient = !!uid && s.requests.some((r) => r.handoverRecipientId === uid);

  const canReceive = s.isProcessCoordinator || s.isStepOwner("receive_sample") || s.myQueue("receive_sample").length > 0 || iAmLabCollector;
  const canCollect = s.isProcessCoordinator || s.isStepOwner("sample_collect") || s.myQueue("sample_collect").length > 0 || iAmCollector;
  const canSampleReceived = s.isProcessCoordinator || s.isStepOwner("sample_received") || s.myQueue("sample_received").length > 0 || iAmRecipient;
  const canSend = s.isProcessCoordinator || s.isStepOwner("send_sample") || s.myQueue("send_sample").length > 0;
  const canConfirm = s.isProcessCoordinator || s.isStepOwner("confirm_receipt") || s.myQueue("confirm_receipt").length > 0;
  const canTest = s.isProcessCoordinator || s.isStepOwner("testing") || s.myQueue("testing").length > 0;
  const canResult = s.isProcessCoordinator || s.isStepOwner("result") || s.myQueue("result").length > 0;
  const canHandover = s.isProcessCoordinator || s.isStepOwner("result_handover") || s.myQueue("result_handover").length > 0;
  const canMonitor = s.isProcessCoordinator;
  const hasRequests = s.requests.length > 0 || s.isProcessCoordinator || canReceive || canCollect || canSampleReceived || canSend || canConfirm || canTest || canResult || canHandover;

  const nav = useMemo(
    () =>
      buildSamplingNav({
        isAdmin,
        canManageMasters: s.isAnyMasterManager,
        canReceive,
        canCollect,
        canSampleReceived,
        canSend,
        canConfirm,
        canTest,
        canResult,
        canHandover,
        canMonitor,
        hasRequests,
      }),
    [isAdmin, s.isAnyMasterManager, canReceive, canCollect, canSampleReceived, canSend, canConfirm, canTest, canResult, canHandover, canMonitor, hasRequests],
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
