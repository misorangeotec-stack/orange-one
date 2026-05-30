import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Tabs from "@/shared/components/ui/Tabs";
import Combobox from "@/shared/components/ui/Combobox";
import Avatar from "@/shared/components/ui/Avatar";
import { WEEK_START, WEEK_END } from "../mock/data";
import { useSession } from "../mock/session";
import { useTaskStore } from "../mock/store";
import GroupReport from "../components/GroupReport";
import type { Profile } from "../types";

const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export default function Reports() {
  const { user, role, isAdmin, isHod } = useSession();
  const { departments, profiles, profileById, directReportIds } = useTaskStore();
  const [params, setParams] = useSearchParams();

  const team = useMemo(() => [user.id, ...directReportIds(user.id)].map((id) => profileById(id)!).filter(Boolean), [user.id]);
  const hods = useMemo(() => profiles.filter((p) => p.role === "hod" || p.role === "sub_hod"), []);

  const tabs = [
    { key: "weekly", label: "Weekly" },
    ...(isAdmin || isHod ? [{ key: "employee", label: "Employee" }, { key: "team", label: "Team" }] : []),
    ...(isAdmin ? [{ key: "department", label: "Department" }] : []),
  ];
  const tab = tabs.some((t) => t.key === params.get("tab")) ? params.get("tab")! : "weekly";

  // selectors
  const personPool = isAdmin ? profiles : team;
  const [selPerson, setSelPerson] = useState(personPool[0]?.id ?? user.id);
  const [selHod, setSelHod] = useState(hods[0]?.id ?? "");
  const [selDept, setSelDept] = useState(departments[0]?.id ?? "");

  let people: Profile[] = [];
  if (tab === "weekly") people = isAdmin ? profiles : isHod ? team : [user];
  else if (tab === "employee") people = [profileById(selPerson)].filter(Boolean) as Profile[];
  else if (tab === "team") {
    const root = isAdmin ? selHod : user.id;
    people = [root, ...directReportIds(root)].map((id) => profileById(id)!).filter(Boolean);
  } else if (tab === "department") people = profiles.filter((p) => p.departmentId === selDept);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[22px] font-bold text-navy">Reports</h2>
        <p className="text-grey text-[13px] mt-1">
          Planned vs actual execution · week of {fmt(WEEK_START)} – {fmt(WEEK_END)}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs tabs={tabs} active={tab} onChange={(k) => setParams(k === "weekly" ? {} : { tab: k }, { replace: true })} />

        {/* contextual selector */}
        {tab === "employee" && (
          <Combobox
            value={selPerson}
            onChange={setSelPerson}
            className="w-auto min-w-[200px]"
            options={personPool.map((p) => ({ value: p.id, label: p.name, sublabel: p.designation ?? undefined, icon: <Avatar name={p.name} color={p.avatarColor} size={22} /> }))}
          />
        )}
        {tab === "team" && isAdmin && (
          <Combobox
            value={selHod}
            onChange={setSelHod}
            className="w-auto min-w-[200px]"
            options={hods.map((p) => ({ value: p.id, label: p.name, sublabel: "HOD", icon: <Avatar name={p.name} color={p.avatarColor} size={22} /> }))}
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

      <GroupReport people={people} />
    </div>
  );
}
