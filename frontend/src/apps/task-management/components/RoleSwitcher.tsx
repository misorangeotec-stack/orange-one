import { useSession, ALL_ROLES } from "../mock/session";
import type { AppRole } from "../types";

/**
 * DEV-ONLY control to preview each role's UI without real auth.
 * Removed in Stage B when real Supabase roles drive the session.
 */
export default function RoleSwitcher() {
  const { role, setRole } = useSession();
  return (
    <label className="hidden sm:flex items-center gap-2 rounded-xl border border-dashed border-orange/50 bg-orange-soft/50 pl-3 pr-1.5 py-1.5">
      <span className="text-[11px] font-semibold text-orange whitespace-nowrap">View as</span>
      <select
        value={role}
        onChange={(e) => setRole(e.target.value as AppRole)}
        className="text-[12px] font-medium text-navy bg-white border border-line rounded-lg px-2 py-1 outline-none cursor-pointer"
      >
        {ALL_ROLES.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
    </label>
  );
}
