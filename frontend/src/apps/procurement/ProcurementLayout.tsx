import { useMemo } from "react";
import AppShell from "@/shared/components/layout/AppShell";
import type { NotificationItem } from "@/shared/components/layout/types";
import { useSession, roleLabel } from "@/core/platform/session";
import { useOrgPersonById } from "@/core/platform/orgPeople";
import { buildProcurementNav } from "./nav";
import { useProcurementStore } from "./store";
import { useEffectiveIdentity } from "@/shared/sandbox/useEffectiveIdentity";
import { useSandbox } from "@/shared/sandbox/SandboxContext";
import PersonaSwitcher from "@/shared/sandbox/PersonaSwitcher";
import DemoBanner from "@/shared/sandbox/DemoBanner";
import { usePersonas } from "./sandbox/personas";
import type { ProcNotification } from "./types";


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
  const personas = usePersonas();
  const store = useProcurementStore();
  const {
    resolvableRequests,
    canSeeStep,
    canSeeApprovals,
    canSeeMasters,
    canMonitor,
    myNotifications,
    profileById,
    markNotificationsRead,
  } = store;
  const orgPersonById = useOrgPersonById();

  /*
    NAV READS THE VISIBILITY FLAGS, NOT THE CAPABILITIES. `canSharePo` and its
    eleven siblings now fold `canEdit`, so they answer "may I act on this step" —
    which is the wrong question for a sidebar link. `canSeeStep` is the right one,
    and it is what the matching RequireCap guards ask, so the sidebar can never
    offer a screen that then refuses you.
  */
  const nav = useMemo(
    () =>
      buildProcurementNav({
        canManageMasters: canSeeMasters,
        isAdmin,
        canEdit: store.canEdit,
        canSource: canSeeStep("sourcing"),
        isApprover: canSeeApprovals,
        canGeneratePo: canSeeStep("po"),
        canSharePo: canSeeStep("share_po"),
        canCollectPi: canSeeStep("collect_pi"),
        canAdvancePayment: canSeeStep("advance_payment"),
        canFollowup: canSeeStep("follow_up"),
        canInward: canSeeStep("inward"),
        canTally: canSeeStep("tally"),
        canQc: canSeeStep("qc_inspection"),
        canPurchaseReturn: canSeeStep("purchase_return"),
        canGateOutward: canSeeStep("gate_outward"),
        canMonitor,
        canDemo: realAdmin && !demoActive,
        // Badge only what THIS user can act on — a vendor owner shouldn't see a
        // count for item requests they can't resolve.
        pendingReviews: resolvableRequests.length,
      }),
    [canSeeMasters, isAdmin, store.canEdit, canSeeStep, canSeeApprovals, canMonitor, realAdmin, demoActive, resolvableRequests.length]
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
      // whole sentences about an entity ("Goods received (GRN) — book the entry
      // in Tally"), so inlining a name gave the sentence two subjects.
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
