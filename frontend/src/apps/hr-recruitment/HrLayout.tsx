import { useMemo } from "react";
import AppShell from "@/shared/components/layout/AppShell";
import type { NotificationItem } from "@/shared/components/layout/types";
import { useSession, roleLabel } from "@/core/platform/session";
import { timeAgo } from "@/shared/lib/time";
import { useEffectiveIdentity } from "@/shared/sandbox/useEffectiveIdentity";
import { useSandbox } from "@/shared/sandbox/SandboxContext";
import PersonaSwitcher from "@/shared/sandbox/PersonaSwitcher";
import DemoBanner from "@/shared/sandbox/DemoBanner";
import { buildHrNav } from "./nav";
import { usePersonas } from "./sandbox/personas";
import { useHrStore } from "./store";
import type { HrNotification } from "./types";


const B = "/hr-recruitment";

/** Deep-link a bell notification to the thing it is about. */
const linkFor = (n: HrNotification): string => {
  switch (n.entityType) {
    case "requisition":
      return `${B}/requisitions/${n.entityId}`;
    case "candidate":
    case "interview":
      return `${B}/candidates/${n.entityId}`;
    case "onboarding":
      return `${B}/onboarding/${n.entityId}`;
    case "probation":
      return `${B}/probation/${n.entityId}`;
    case "master_request":
      return `${B}/master-requests`;
    default:
      return B;
  }
};

/**
 * Wires the portal session + HR store into the shared AppShell. The nav is
 * capability-driven, so each person sees only the queues they own.
 */
export default function HrLayout() {
  const { user, role, isAdmin } = useEffectiveIdentity();
  const { isAdmin: realAdmin } = useSession();
  const { active: demoActive } = useSandbox();
  const personas = usePersonas();
  const s = useHrStore();

  const nav = useMemo(
    () =>
      buildHrNav({
        isAdmin,
        canRaiseMrf: s.isStepOwner("mrf"),
        canApproveHr: s.isStepOwner("hr_head_approval"),
        canApproveMgmt: s.isStepOwner("mgmt_approval"),
        canPostJob: s.isStepOwner("job_posting"),
        canUploadResumes: s.isStepOwner("resume_upload"),
        canShortlist: s.isStepOwner("hr_shortlist") || s.isStepOwner("hod_shortlist"),
        // Not just the interviewers: HR runs the schedule and coordinators chase it, so
        // both need the link to the page they are already allowed to open.
        canInterview:
          s.isStepOwner("interview_1") ||
          s.isStepOwner("interview_2") ||
          s.isStepOwner("interview_3") ||
          s.isStepOwner("hr_shortlist") ||
          s.isProcessCoordinator,
        canOnboard: s.isStepOwner("onboarding"),
        // Coordinators chase everything and the server already lets them act, so the
        // link must appear for them too — otherwise the page they can open has no
        // way in from the sidebar.
        canReview:
          s.isStepOwner("probation_m1") || s.isStepOwner("probation_final") || s.isProcessCoordinator,
        canMonitor: s.isProcessCoordinator,
        canManageMasters: s.isAnyMasterManager,
        // Badge only what THIS user can act on — a Locations owner shouldn't see a
        // count for platform requests they can't resolve.
        pendingReviews: s.resolvableRequests.length,
        // Entering demo mode is for the REAL admin — a persona must not be able to
        // re-enter and nest demos.
        canDemo: realAdmin && !demoActive,
      }),
    [isAdmin, realAdmin, demoActive, s],
  );

  const notifItems: NotificationItem[] = s.notifications.map((n) => ({
    id: n.id,
    text: n.text,
    time: timeAgo(n.createdAt),
    unread: !n.readAt,
    to: linkFor(n),
  }));

  return (
    <AppShell
      nav={nav}
      role={role}
      user={{ name: user.name, designation: user.designation, color: user.avatarColor, roleLabel: roleLabel(role) }}
      notifications={notifItems}
      onMarkRead={(ids) => {
        void s.markNotificationsRead(ids);
      }}
      roleSwitcher={demoActive ? <PersonaSwitcher personas={personas} /> : undefined}
      banner={demoActive ? <DemoBanner /> : undefined}
    />
  );
}
