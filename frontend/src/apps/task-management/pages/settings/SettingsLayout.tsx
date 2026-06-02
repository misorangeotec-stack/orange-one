import { NavLink, Outlet } from "react-router-dom";
import { cn } from "@/shared/lib/cn";

/** Task Management settings (admin): workspace task rules + role permissions. */
export default function SettingsLayout() {
  const tabs = [
    { to: "/task-management/settings", label: "Organization", end: true },
    { to: "/task-management/settings/locations", label: "Locations" },
    { to: "/task-management/settings/permissions", label: "Permissions" },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[22px] font-bold text-navy">Settings</h2>
        <p className="text-grey text-[13px] mt-1">Manage workspace task rules and role permissions.</p>
      </div>

      <div className="flex items-center gap-1 border-b border-line overflow-x-auto">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              cn("relative px-3.5 py-2.5 text-[13.5px] font-medium whitespace-nowrap transition-colors", isActive ? "text-orange" : "text-grey hover:text-navy")
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
