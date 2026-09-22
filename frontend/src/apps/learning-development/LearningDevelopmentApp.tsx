import type { ReactNode } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useSession } from "@/core/platform/session";
import { LdStoreProvider, useLdStore } from "./store";
import LearningDevelopmentLayout from "./LearningDevelopmentLayout";
import Dashboard from "./pages/Dashboard";
import TrainingCalendar from "./pages/calendar/TrainingCalendar";
import RequestsList from "./pages/requests/RequestsList";
import NewRequest from "./pages/requests/NewRequest";
import RequestDetail from "./pages/requests/RequestDetail";
import SessionDetail from "./pages/sessions/SessionDetail";
import SessionsList from "./pages/sessions/SessionsList";
import MyLearning from "./pages/MyLearning";
import AnnualPlan from "./pages/plan/AnnualPlan";
import Reports from "./pages/reports/Reports";
import StepQueue from "./pages/queues/StepQueue";
import Setup from "./pages/settings/Setup";
import AccessDenied from "./pages/system/AccessDenied";
import NotFound from "./pages/system/NotFound";
import { QUEUE_PATH } from "./nav";
import { REQUEST_STEPS, type StepKey } from "./lib/steps";

function RequireAdmin({ children }: { children: ReactNode }) {
  const { isAdmin } = useSession();
  if (!isAdmin) return <AccessDenied />;
  return <>{children}</>;
}

/**
 * One step's queue, for its owners only — the same predicate the sidebar uses, so
 * the nav can never offer a screen that then refuses you, and no screen is
 * reachable that the sidebar deliberately hid.
 *
 * ⚠ HIDING THE NAV LINK IS NOT THE GATE. These routes are reachable by typing the
 *   URL for as long as they exist. RLS and the RPCs' own authz are the real
 *   boundary; this is so the page says so instead of opening on work that is none
 *   of the reader's business.
 */
function RequireQueue({ step, children }: { step: StepKey; children: ReactNode }) {
  const s = useLdStore();
  if (!s.canSeeQueue(step)) return <AccessDenied />;
  return <>{children}</>;
}

/** Only people who own a step see the whole pipeline; everyone has "My Requests". */
function RequirePipeline({ children }: { children: ReactNode }) {
  const s = useLdStore();
  if (!s.isPipelineStaff) return <AccessDenied />;
  return <>{children}</>;
}

/**
 * Root of the Learning & Development FMS.
 *
 * ⚠ UNIVERSAL — every signed-in employee can open this module, because every
 *   employee is a potential participant. What they SEE is scoped by the nav and,
 *   authoritatively, by RLS: a plain employee gets the calendar, their own
 *   requests and nothing else. That is the opposite of every other FMS here, so
 *   do not "fix" the missing Module Access rows: there are none by design.
 */
export default function LearningDevelopmentApp() {
  return (
    <LdStoreProvider>
      <Routes>
        <Route element={<LearningDevelopmentLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="calendar" element={<TrainingCalendar />} />
          {/* Open to everyone: a nominee has to be able to RSVP, read the
              material, upload their assignment and give feedback. RLS decides
              what they actually see on it. */}
          <Route path="my-learning" element={<MyLearning />} />
          <Route path="sessions" element={<RequirePipeline><SessionsList /></RequirePipeline>} />
          <Route path="sessions/:id" element={<SessionDetail />} />
          {/* The plan is readable by anyone in the module — it is the year's
              intentions, not a budget. Editing it is gated in the page. */}
          <Route path="plan" element={<AnnualPlan />} />
          <Route path="reports" element={<RequirePipeline><Reports /></RequirePipeline>} />

          {/* "new" must come before ":id" or "new" would be read as an id. */}
          <Route path="requests/new" element={<NewRequest />} />
          <Route path="my-requests" element={<RequestsList mine />} />
          <Route path="requests" element={<RequirePipeline><RequestsList /></RequirePipeline>} />
          <Route path="requests/:id" element={<RequestDetail />} />

          {REQUEST_STEPS.map((step) => (
            <Route
              key={step}
              path={`queues/${QUEUE_PATH[step]}`}
              element={
                <RequireQueue step={step}>
                  <StepQueue step={step} />
                </RequireQueue>
              }
            />
          ))}

          <Route path="settings" element={<RequireAdmin><Setup /></RequireAdmin>} />
          <Route path="*" element={<NotFound />} />
        </Route>
        <Route path="*" element={<Navigate to="/learning-development" replace />} />
      </Routes>
    </LdStoreProvider>
  );
}
