import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Tabs from "@/shared/components/ui/Tabs";
import Combobox from "@/shared/components/ui/Combobox";
import Avatar from "@/shared/components/ui/Avatar";
import { WEEK_START, WEEK_END } from "../mock/data";
import { useSession } from "../mock/session";
import { useTaskStore } from "../mock/store";
import GroupReport from "../components/GroupReport";
import PlanVsActual from "../components/PlanVsActual";
import WeeklyPlanModal from "../components/WeeklyPlanModal";
import { formatDate, addWeeks, monthKey, monthLabel } from "@/shared/lib/time";
import type { Department, Profile } from "../types";

const fmt = (iso: string) => formatDate(iso);

/** Build "Designation · Department" sublabel for a person. */
function personMeta(p: Profile, deptById: (id: string | null) => Department | undefined): string | undefined {
  const parts = [p.designation, deptById(p.departmentId)?.name].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

export default function Reports() {
  const { user, role, isAdmin, isHod } = useSession();
  const { departments, profiles, profileById, departmentById, directReportIds } = useTaskStore();
  const [params, setParams] = useSearchParams();
  const [planOpen, setPlanOpen] = useState(false);

  const team = useMemo(() => [user.id, ...directReportIds(user.id)].map((id) => profileById(id)!).filter(Boolean), [user.id]);
  const hods = useMemo(() => profiles.filter((p) => p.role === "hod" || p.role === "sub_hod"), []);

  const tabs = [
    { key: "weekly", label: "Weekly" },
    { key: "planvsactual", label: "Plan vs Actual" },
    ...(isAdmin || isHod ? [{ key: "employee", label: "Employee" }, { key: "team", label: "Team" }] : []),
    ...(isAdmin ? [{ key: "department", label: "Department" }] : []),
  ];
  const tab = tabs.some((t) => t.key === params.get("tab")) ? params.get("tab")! : "weekly";

  // selectors
  const personPool = isAdmin ? profiles : team;
  const [selPerson, setSelPerson] = useState(personPool[0]?.id ?? user.id);
  const [selHod, setSelHod] = useState(hods[0]?.id ?? "");
  const [selDept, setSelDept] = useState(departments[0]?.id ?? "");

  // month options for Plan vs Actual (recent months that may hold data)
  const monthOpts = useMemo(() => {
    const keys = new Set<string>();
    for (let n = -6; n <= 2; n++) keys.add(monthKey(addWeeks(WEEK_START, n)));
    return [...keys].sort().reverse().map((k) => ({ value: k, label: monthLabel(`${k}-01`) }));
  }, []);
  const [selMonth, setSelMonth] = useState(monthKey(WEEK_START));

  let people: Profile[] = [];
  if (tab === "weekly" || tab === "planvsactual") people = isAdmin ? profiles : isHod ? team : [user];
  else if (tab === "employee") people = [profileById(selPerson)].filter(Boolean) as Profile[];
  else if (tab === "team") {
    const root = isAdmin ? selHod : user.id;
    people = [root, ...directReportIds(root)].map((id) => profileById(id)!).filter(Boolean);
  } else if (tab === "department") people = profiles.filter((p) => p.departmentId === selDept);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[22px] font-bold text-navy">Reports</h2>
          <p className="text-grey text-[13px] mt-1">
            Planned vs actual execution · week of {fmt(WEEK_START)} – {fmt(WEEK_END)}
          </p>
        </div>
        {(isAdmin || isHod) && (
          <button
            onClick={() => setPlanOpen(true)}
            className="inline-flex items-center gap-2 bg-orange-grad text-white font-semibold text-sm px-4 py-2.5 rounded-xl shadow-cta hover:-translate-y-0.5 transition"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            Set weekly plan
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs tabs={tabs} active={tab} onChange={(k) => setParams(k === "weekly" ? {} : { tab: k }, { replace: true })} />

        {/* contextual selector */}
        {tab === "planvsactual" && (
          <Combobox
            value={selMonth}
            onChange={setSelMonth}
            className="w-auto min-w-[170px]"
            options={monthOpts}
          />
        )}
        {tab === "employee" && (
          <Combobox
            value={selPerson}
            onChange={setSelPerson}
            className="w-auto min-w-[200px]"
            options={personPool.map((p) => ({ value: p.id, label: p.name, sublabel: personMeta(p, departmentById), icon: <Avatar name={p.name} color={p.avatarColor} size={22} /> }))}
          />
        )}
        {tab === "team" && isAdmin && (
          <Combobox
            value={selHod}
            onChange={setSelHod}
            className="w-auto min-w-[200px]"
            options={hods.map((p) => ({ value: p.id, label: p.name, sublabel: personMeta(p, departmentById) ?? "HOD", icon: <Avatar name={p.name} color={p.avatarColor} size={22} /> }))}
          />
        )}
        {tab === "department" && (
          <Combobox
            value={selDept}
            onChange={setSelDept}
            className="w-auto min-w-[200px]"
            options={departments.map((d) => ({ value: d.id, label: d.name }))}
          />
        )}
      </div>

      {tab === "planvsactual" ? <PlanVsActual people={people} month={selMonth} /> : <GroupReport people={people} />}

      <WeeklyPlanModal open={planOpen} onClose={() => setPlanOpen(false)} />
    </div>
  );
}
