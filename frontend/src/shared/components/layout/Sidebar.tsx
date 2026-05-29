import { NavLink } from "react-router-dom";
import Logo from "@/shared/components/ui/Logo";
import { cn } from "@/shared/lib/cn";
import type { NavItem } from "./types";

/** Dark application sidebar (matches the landing dashboard mock's .side rail). */
export default function Sidebar({
  nav,
  role,
  logoTo = "/home",
  onNavigate,
}: {
  nav: NavItem[];
  role: string;
  logoTo?: string;
  onNavigate?: () => void;
}) {
  const items = nav.filter((i) => !i.roles || i.roles.includes(role));

  return (
    <div className="flex h-full w-[248px] flex-col bg-sidebar text-white">
      <div className="px-5 h-[68px] flex items-center border-b border-white/10">
        <Logo variant="dark" height={30} to={logoTo} />
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
        {items.map((item, idx) => (
          <div key={item.to}>
            {item.section && (
              <p className={cn("px-3 pb-1.5 pt-4 text-[10px] font-semibold uppercase tracking-wider text-white/35", idx === 0 && "pt-1")}>
                {item.section}
              </p>
            )}
            <NavLink
              to={item.to}
              end={item.to.split("/").length <= 2}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-medium transition-colors",
                  isActive ? "bg-orange text-white shadow-cta" : "text-[#aebbd4] hover:bg-white/[0.06] hover:text-white"
                )
              }
            >
              <span className="[&>svg]:w-[18px] [&>svg]:h-[18px] shrink-0">{item.icon}</span>
              <span className="flex-1 truncate">{item.label}</span>
              {item.badge ? (
                <span className="text-[10px] font-bold bg-white/15 rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
                  {item.badge}
                </span>
              ) : null}
            </NavLink>
          </div>
        ))}
      </nav>

      <div className="px-5 py-4 border-t border-white/10 text-[11px] text-white/40">
        © 2026 Orange O Tec
      </div>
    </div>
  );
}
