import { useMemo } from "react";
import AppShell from "@/shared/components/layout/AppShell";
import type { NotificationItem } from "@/shared/components/layout/types";
import { useSession, roleLabel } from "@/core/platform/session";
import { useOrgPersonById } from "@/core/platform/orgPeople";
import { useEffectiveIdentity } from "@/shared/sandbox/useEffectiveIdentity";
import { useSandbox } from "@/shared/sandbox/SandboxContext";
import PersonaSwitcher from "@/shared/sandbox/PersonaSwitcher";
import DemoBanner from "@/shared/sandbox/DemoBanner";
import { buildHrNav } from "./nav";
import { canSeeBoard } from "./lib/access";
import { usePersonas } from "./sandbox/personas";
import { useHrStore } from "./store";
import type { HrNotification } from "./types";


const B = "/hr-recruitment";

/**
 * Deep-link a bell notification to the thing it is about.
 *
 * "Priya moved to Round 2" now lands on PRIYA. The candidate page it wants has
 * existed only since the candidate route was added — before that these two cases
 * pointed at `/candidates/:id`, which had never been mounted and sent every pipeline
 * notification to Not Found, and then at the whole board, which left you to find the
 * card yourself. `candidateOf` resolves an interview notification the extra hop.
 */
const linkFor = (n: HrNotification, candidateOf: (entityId: string) => string | null): string => {
  // Keyed on TYPE, ahead of the entity switch. This one is a requisition-scoped
  // notification whose whole point is a pile of CVs, so it wants the board — the MRF
  // page every other requisition notification lands on would show the HOD a stepper
  // and make them navigate to the work they were just told about.
  if (n.type === "hod_shortlist_pending") return `${B}/positions/${n.entityId}`;

  switch (n.entityType) {
    case "requisition":
      return `${B}/requisitions/${n.entityId}`;
    case "candidate":
    case "interview": {
      const candidateId = candidateOf(n.entityId);
      return candidateId ? `${B}/candidates/${candidateId}` : `${B}/positions`;
    }
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
  const orgPersonById = useOrgPersonById();

  const nav = useMemo(
    () =>
      buildHrNav({
        isAdmin,
        canRaiseMrf: s.isStepOwner("mrf"),
        // The viewer arm reaches the REQUISITION queues only. The candidate-shaped
        // links below deliberately keep theirs off — see isModuleViewer in store.tsx.
        canApproveHr: s.isModuleViewer || s.isStepOwner("hr_head_approval"),
        canApproveMgmt: s.isModuleViewer || s.isStepOwner("mgmt_approval"),
        canPostJob: s.isModuleViewer || s.isStepOwner("job_posting"),
        // The same predicate the Positions pages enforce, so the sidebar never offers
        // a screen that then refuses you — or hides one you are allowed to work.
        canSeePositions: canSeeBoard(s),
        // Not just the interviewers: HR runs the schedule and coordinators chase it, so
        // both need the link to the page they are already allowed to open.
        canInterview:
          s.isStepOwner("interview_1") ||
          s.isStepOwner("interview_2") ||
          s.isStepOwner("interview_3") ||
          s.isStepOwner("hr_shortlist") ||
          s.isProcessCoordinator ||
          // A head booked onto a round owns none of those steps — the HOD steps have no
          // rows in the step-owner table at all — so without this the one screen they
          // were sent to had no link in the sidebar.
          s.isBookedInterviewer,
        canOnboard: s.isStepOwner("onboarding"),
        // Coordinators chase everything and the server already lets them act, so the
        // link must appear for them too — otherwise the page they can open has no
        // way in from the sidebar.
        canReview:
          s.isStepOwner("probation_m1") || s.isStepOwner("probation_final") || s.isProcessCoordinator,
        canMonitor: s.canMonitor,
        canManageMasters: s.canSeeMasters,
        // Badge only what THIS user can act on — a Locations owner shouldn't see a
        // count for platform requests they can't resolve.
        pendingReviews: s.resolvableRequests.length,
        // Entering demo mode is for the REAL admin — a persona must not be able to
        // re-enter and nest demos.
        canDemo: realAdmin && !demoActive,
      }),
    [isAdmin, realAdmin, demoActive, s],
  );

  /**
   * The candidate a notification is really about. An interview hops one extra step
   * (interview → candidate) because the notification carries the interview's own id.
   * Null when the candidate has aged out of the load window — the caller then falls
   * back to the positions list rather than linking to a page that cannot render.
   */
  const candidateOfCard = (entityId: string): string | null => {
    if (s.candidateById(entityId)) return entityId;
    const iv = s.interviews.find((x) => x.id === entityId);
    return iv && s.candidateById(iv.candidateId) ? iv.candidateId : null;
  };

  // Who did it used to be dropped entirely — the bell showed a bare sentence.
  // Directory first, org-wide list as backup: profileById is RLS-scoped, so a
  // colleague in another department resolves to nothing.
  const notifItems: NotificationItem[] = s.notifications.map((n) => {
    const actor = n.actorId ? s.profileById(n.actorId) ?? orgPersonById(n.actorId) : undefined;
    return {
      id: n.id,
      actorName: n.actorId ? actor?.name ?? "Someone" : "System",
      actorColor: actor?.avatarColor,
      // Its own line under the name — these are whole sentences whose subject is
      // a candidate or requisition, not the actor.
      message: n.text,
      createdAt: n.createdAt,
      unread: !n.readAt,
      to: linkFor(n, candidateOfCard),
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
      roleSwitcher={demoActive ? <PersonaSwitcher personas={personas} /> : undefined}
      banner={demoActive ? <DemoBanner /> : undefined}
    />
  );
}
