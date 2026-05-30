import { NavLink, Outlet } from "react-router-dom";
import { cn } from "@/shared/lib/cn";

const TABS = [
  { to: "/task-management/setup", label: "Checklist", end: true },
  { to: "/task-management/setup/departments", label: "Departments" },
  { to: "/task-management/setup/users", label: "Users" },
  { to: "/task-management/setup/hierarchy", label: "Hierarchy" },
];

/** Admin Setup shell: heading + sub-navigation + nested page. */
export default function SetupLayout() {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[22px] font-bold text-navy">Workspace Setup</h2>
        <p className="text-grey text-[13px] mt-1">Configure departments, users, and your reporting structure.</p>
      </div>

      <div className="flex items-center gap-1 border-b border-line overflow-x-auto">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              cn(
                "relative px-3.5 py-2.5 text-[13.5px] font-medium whitespace-nowrap transition-colors",
                isActive ? "text-orange" : "text-grey hover:text-navy"
              )
            }
          >
            {({ isActive }) => (
              <>
                {t.label}
                {isActive && <span className="absolute left-2 right-2 -bottom-px h-0.5 bg-orange rounded-full" />}
              </>
            )}
          </NavLink>
        ))}
      </div>

      <Outlet />
    </div>
  );
}
