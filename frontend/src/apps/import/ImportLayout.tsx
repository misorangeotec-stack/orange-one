import { useMemo } from "react";
import AppShell from "@/shared/components/layout/AppShell";
import type { NotificationItem } from "@/shared/components/layout/types";
import { useSession, roleLabel } from "@/core/platform/session";
import { useOrgPersonById } from "@/core/platform/orgPeople";
import { buildImportNav } from "./nav";
import { useImportStore } from "./store";
import { useEffectiveIdentity } from "@/shared/sandbox/useEffectiveIdentity";
import { useSandbox } from "@/shared/sandbox/SandboxContext";
import PersonaSwitcher from "@/shared/sandbox/PersonaSwitcher";
import DemoBanner from "@/shared/sandbox/DemoBanner";
import { usePersonas } from "./sandbox/personas";
import type { ImportNotification } from "./types";


const B = "/import";

/**
 * Wires the portal session + import store into the shared AppShell. The nav
 * is built from the store so master managers (and admins) see the Masters +
 * Master Requests items. The notifications bell is fed from the store's
 * per-user feed; clicking a row deep-links to the request or PO it points at.
 */
export default function ImportLayout() {
  const { user, role, isAdmin } = useEffectiveIdentity();
  const { isAdmin: realAdmin } = useSession();
  const { active: demoActive } = useSandbox();
  const personas = usePersonas();
  const store = useImportStore();
  const {
    isAnyManager,
    resolvableRequests,
    canSource,
    isApprover,
    canGeneratePo,
    canSharePo,
    canCollectPi,
    canAdvancePayment,
    canFollowup,
    canInward,
    canTally,
    isProcessCoordinator,
    myNotifications,
    profileById,
    markNotificationsRead,
  } = store;
  const orgPersonById = useOrgPersonById();

  const nav = useMemo(
    () =>
      buildImportNav({
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
        canMonitor: isAdmin || isProcessCoordinator,
        canDemo: realAdmin && !demoActive,
        // Badge only what THIS user can act on — a vendor owner shouldn't see a
        // count for item requests they can't resolve.
        pendingReviews: resolvableRequests.length,
      }),
    [isAnyManager, isAdmin, canSource, isApprover, canGeneratePo, canSharePo, canCollectPi, canAdvancePayment, canFollowup, canInward, canTally, isProcessCoordinator, realAdmin, demoActive, resolvableRequests.length]
  );

  // Resolve the deep-link for a notification's entity.
  const linkFor = (n: ImportNotification): string | undefined => {
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
      case "master_request":
        return `${B}/master-requests`;
      default:
        return undefined;
    }
  };

  const notifItems: NotificationItem[] = myNotifications.map((n) => {
    // Directory first, org-wide list as backup: profileById is RLS-scoped, so a
    // colleague in another department resolves to nothing and would show as an
    // anonymous tile.
    const actor = n.actorId ? profileById(n.actorId) ?? orgPersonById(n.actorId) : undefined;
    return {
      id: n.id,
      actorName: n.actorId ? actor?.name ?? "Someone" : "System",
      actorColor: actor?.avatarColor,
      // Rendered on its own line under the name, NOT after it: these strings are
      // whole sentences about an entity, so inlining a name gave the sentence
      // two subjects.
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
      onMarkRead={(ids) => { void markNotificationsRead(ids); }}
      roleSwitcher={demoActive ? <PersonaSwitcher personas={personas} /> : undefined}
      banner={demoActive ? <DemoBanner /> : undefined}
    />
  );
}
