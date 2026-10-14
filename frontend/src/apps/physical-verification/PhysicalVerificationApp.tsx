/**
 * PHYSICAL VERIFICATION — the app shell.
 *
 *   Master   (step 1)  Otec Surat items with Tally closing; set date + verifier
 *   Count    (step 2)  the verifier's items whose date has come; enter physical stock
 *   Review   (step 1)  accept or send back for recount; history
 *   Settings (admins)  who does step 1 and who does step 2
 *
 * A verifier lands on Count and sees nothing else of the master.
 */
import { Navigate, Route, Routes } from "react-router-dom";
import AppShell from "@/shared/components/layout/AppShell";
import type { NavItem } from "@/shared/components/layout/types";
import { roleLabel, useSession } from "@/core/platform/session";
import { appBasePath } from "../appInfo";
import { canSchedule, usePv } from "./lib/pv";
import Master from "./pages/Master";
import Count from "./pages/Count";
import Review from "./pages/Review";
import Settings from "./pages/Settings";

const B = appBasePath("physical-verification");

const svg = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);
const ic = {
  master: svg("M3 5h18M3 12h18M3 19h18M8 5v14"),
  count: svg("M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"),
  review: svg("M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"),
  settings: svg("M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15l1.6 1-2 3.4-1.8-.7a8 8 0 0 1-2.2 1.3L14.7 22h-4l-.3-2a8 8 0 0 1-2.2-1.3l-1.8.7-2-3.4 1.6-1a8 8 0 0 1 0-2.6l-1.6-1 2-3.4 1.8.7A8 8 0 0 1 10.4 4l.3-2h4l.3 2a8 8 0 0 1 2.2 1.3l1.8-.7 2 3.4-1.6 1a8 8 0 0 1 0 2.6z"),
};

/** Master and Review belong to step 1, so they are shown by the Settings list, not by role. */
function navFor(step1: boolean): NavItem[] {
  return [
    ...(step1 ? [{ label: "1 · Master (set dates)", to: `${B}/master`, icon: ic.master, section: "Physical verification" }] : []),
    { label: "2 · Physical count", to: `${B}/count`, icon: ic.count, ...(step1 ? {} : { section: "Physical verification" }) },
    ...(step1 ? [{ label: "3 · Review", to: `${B}/review`, icon: ic.review }] : []),
    { label: "Settings", to: `${B}/settings`, icon: ic.settings, section: "Administration", roles: ["admin"] },
  ];
}

function useStep1(): boolean | null {
  const { user, isAdmin, canEditModule } = useSession();
  const pvQ = usePv();
  if (isAdmin) return true;
  if (pvQ.isLoading) return null;
  return canSchedule(user.id, isAdmin, canEditModule("physical-verification"), pvQ.data);
}

function Layout() {
  const { user, role } = useSession();
  const step1 = useStep1();
  return (
    <AppShell
      nav={navFor(!!step1)}
      role={role}
      user={{ name: user.name, designation: user.designation, color: user.avatarColor, roleLabel: roleLabel(role) }}
      notifications={[]}
    />
  );
}

export default function PhysicalVerificationApp() {
  const step1 = useStep1();
  // Wait for the Settings lists before deciding where a non-admin lands.
  if (step1 === null) return <div className="p-10 text-center text-[13px] text-grey">Loading…</div>;
  const home = step1 ? "master" : "count";
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to={home} replace />} />
        <Route path="master" element={step1 ? <Master /> : <Navigate to="../count" replace />} />
        <Route path="count" element={<Count />} />
        <Route path="review" element={step1 ? <Review /> : <Navigate to="../count" replace />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to={home} replace />} />
      </Route>
    </Routes>
  );
}
