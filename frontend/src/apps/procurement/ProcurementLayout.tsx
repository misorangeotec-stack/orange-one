import { useMemo } from "react";
import AppShell from "@/shared/components/layout/AppShell";
import type { NotificationItem } from "@/shared/components/layout/types";
import { useSession, ALL_ROLES } from "@/core/platform/session";
import { timeAgo } from "@/shared/lib/time";
import { buildProcurementNav } from "./nav";
import { useProcurementStore } from "./store";
import { useEffectiveIdentity } from "./sandbox/useEffectiveIdentity";
import { useSandbox } from "./sandbox/SandboxContext";
import PersonaSwitcher from "./sandbox/PersonaSwitcher";
import DemoBanner from "./sandbox/DemoBanner";
import type { ProcNotification } from "./types";

const roleLabel = (role: string) => ALL_ROLES.find((r) => r.value === role)?.label ?? role;

const B = "/procurement";

/**
 * Wires the portal session + procurement store into the shared AppShell. The nav
 * is built from the store so master managers (and admins) see the Masters +
 * Master Requests items. The notifications bell is fed from the store's
 * per-user feed; clicking a row deep-links to the request or PO it points at.
 */
export default function ProcurementLayout() {
  const { user, role, isAdmin } = useEffectiveIdentity();
  const { isAdmin: realAdmin } = useSession();
  const { active: demoActive } = useSandbox();
  const store = useProcurementStore();
  const {
    isAnyManager,
    pendingRequests,
    canSource,
    isApprover,
    canGeneratePo,
    canSharePo,
    canCollectPi,
    canAdvancePayment,
    canFollowup,
    canInward,
    canTally,
    canFinalPayment,
    isProcessCoordinator,
    myNotifications,
    profileById,
    markNotificationsRead,
  } = store;

  const nav = useMemo(
    () =>
      buildProcurementNav({
        canManageMasters: isAnyManager,
        isAdmin,
        canSource,
        isApprover,
        canGeneratePo,
        canSharePo,
        canCollectPi,
        canAdvancePayment,
        canFollowup,
        canInward,
        canTally,
        canFinalPayment,
        canMonitor: isAdmin || isProcessCoordinator,
        canDemo: realAdmin && !demoActive,
        pendingRequests: pendingRequests.length,
      }),
    [isAnyManager, isAdmin, canSource, isApprover, canGeneratePo, canSharePo, canCollectPi, canAdvancePayment, canFollowup, canInward, canTally, canFinalPayment, isProcessCoordinator, realAdmin, demoActive, pendingRequests.length]
  );

  // Resolve the deep-link for a notification's entity.
  const linkFor = (n: ProcNotification): string | undefined => {
    switch (n.entityType) {
      case "request":
        return `${B}/requests/${n.entityId}`;
      case "line": {
        const line = store.lineById(n.entityId);
        return line ? `${B}/requests/${line.requestId}` : undefined;
      }
      case "po":
        return `${B}/pos/${n.entityId}`;
      case "pi": {
        const pi = store.pis.find((p) => p.id === n.entityId);
        return pi ? `${B}/pos/${pi.poId}` : undefined;
      }
      default:
        return undefined;
    }
  };

  const notifItems: NotificationItem[] = myNotifications.map((n) => {
    const actor = n.actorId ? profileById(n.actorId)?.name ?? "Someone" : "System";
    return {
      id: n.id,
      text: (
        <span>
          <b className="font-semibold text-navy">{actor}</b> {n.text}
        </span>
      ),
      time: timeAgo(n.createdAt),
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
      onMarkRead={(ids) => { void markNotificationsRead(ids); }}
      roleSwitcher={demoActive ? <PersonaSwitcher /> : undefined}
      banner={demoActive ? <DemoBanner /> : undefined}
    />
  );
}
