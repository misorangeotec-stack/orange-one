/**
 * PHYSICAL VERIFICATION — the app shell.
 *
 *   Dashboard (step 1 + 3) done vs pending, short / extra items, by sub group
 *   Master    (step 1)  Otec Surat items with Tally closing; set date + verifier
 *   Count     (step 2)  the verifier's items whose date has come; enter physical stock
 *   Review    (step 3)  accept or send back for recount; history
 *   Tally     (step 4)  accepted differences → Tally Stock Journal (import file + voucher no.)
 *   Settings  (admins)  who does each step
 *
 * A verifier lands on Count and sees nothing else of the master.
 */
import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "@/shared/components/layout/AppShell";
import type { NavItem } from "@/shared/components/layout/types";
import { roleLabel, useSession } from "@/core/platform/session";
import { appBasePath } from "../appInfo";
import { canPost, canReview, canSchedule, usePv } from "./lib/pv";
import Dashboard from "./pages/Dashboard";
import Master from "./pages/Master";
import Count from "./pages/Count";
import Review from "./pages/Review";
import Tally from "./pages/Tally";
import Settings from "./pages/Settings";

const B = appBasePath("physical-verification");

const svg = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);
const ic = {
  dashboard: svg("M3 3v18h18M7 15l4-4 3 3 5-6"),
  master: svg("M3 5h18M3 12h18M3 19h18M8 5v14"),
  count: svg("M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"),
  tally: svg("M4 4h16v16H4zM4 9h16M9 9v11M14 13h3M14 16h3"),
  review: svg("M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"),
  settings: svg("M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15l1.6 1-2 3.4-1.8-.7a8 8 0 0 1-2.2 1.3L14.7 22h-4l-.3-2a8 8 0 0 1-2.2-1.3l-1.8.7-2-3.4 1.6-1a8 8 0 0 1 0-2.6l-1.6-1 2-3.4 1.8.7A8 8 0 0 1 10.4 4l.3-2h4l.3 2a8 8 0 0 1 2.2 1.3l1.8-.7 2 3.4-1.6 1a8 8 0 0 1 0 2.6z"),
};

interface Steps { step1: boolean; step3: boolean; step4: boolean }

/** Menus follow the Settings lists, not roles. A pure verifier sees only "Physical count". */
function navFor({ step1, step3, step4 }: Steps): NavItem[] {
  const S = "Physical verification";
  const items: NavItem[] = [];
  if (step1 || step3 || step4) items.push({ label: "Dashboard", to: `${B}/dashboard`, icon: ic.dashboard, section: S });
  if (step1) items.push({ label: "1 · Master (set dates)", to: `${B}/master`, icon: ic.master });
  items.push({ label: "2 · Physical count", to: `${B}/count`, icon: ic.count });
  if (step3) items.push({ label: "3 · Review", to: `${B}/review`, icon: ic.review });
  if (step4) items.push({ label: "4 · Post to Tally", to: `${B}/tally`, icon: ic.tally });
  items.push({ label: "Settings", to: `${B}/settings`, icon: ic.settings, section: "Administration", roles: ["admin"] });
  if (!items[0].section) items[0] = { ...items[0], section: S };
  return items;
}

/** Null while the Settings lists load, so nobody is redirected on a guess. */
function useSteps(): Steps | null {
  const { user, isAdmin, canEditModule } = useSession();
  const pvQ = usePv();
  if (isAdmin) return { step1: true, step3: true, step4: true };
  if (pvQ.isLoading) return null;
  const canEdit = canEditModule("physical-verification");
  return {
    step1: canSchedule(user.id, isAdmin, canEdit, pvQ.data),
    step3: canReview(user.id, isAdmin, canEdit, pvQ.data),
    step4: canPost(user.id, isAdmin, canEdit, pvQ.data),
  };
}

function Layout() {
  const { user, role } = useSession();
  const steps = useSteps();
  return (
    <AppShell
      nav={navFor(steps ?? { step1: false, step3: false, step4: false })}
      role={role}
      user={{ name: user.name, designation: user.designation, color: user.avatarColor, roleLabel: roleLabel(role) }}
      notifications={[]}
    />
  );
}

export default function PhysicalVerificationApp() {
  const steps = useSteps();
  // Wait for the Settings lists before deciding where a non-admin lands.
  if (steps === null) return <div className="p-10 text-center text-[13px] text-grey">Loading…</div>;
  const { step1, step3, step4 } = steps;
  const home = step1 || step3 || step4 ? "dashboard" : "count";
  const back = <Navigate to="../count" replace />;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to={home} replace />} />
        <Route path="dashboard" element={step1 || step3 || step4 ? <Dashboard /> : back} />
        <Route path="master" element={step1 ? <Master /> : back} />
        <Route path="count" element={<Count />} />
        <Route path="review" element={step3 ? <Review /> : back} />
        <Route path="tally" element={step4 ? <Tally /> : back} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to={home} replace />} />
      </Route>
    </Routes>
  );
}
