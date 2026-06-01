import Combobox from "@/shared/components/ui/Combobox";
import { useSession, ALL_ROLES } from "./session";
import type { AppRole } from "./types";

/**
 * DEV-ONLY control to preview each role's UI (and its module access) without real
 * auth. Portal-wide, so the launcher / admin / every app share it. Removed in
 * Stage B when real Supabase roles drive the session.
 */
export default function RoleSwitcher() {
  const { role, setRole } = useSession();
  return (
    <div className="hidden sm:flex items-center gap-2 rounded-xl border border-dashed border-orange/50 bg-orange-soft/40 pl-3 pr-1.5 py-1">
      <span className="text-[11px] font-semibold text-orange whitespace-nowrap">View as</span>
      <Combobox
        value={role}
        onChange={(v) => setRole(v as AppRole)}
        align="right"
        searchable={false}
        className="w-[120px]"
        options={ALL_ROLES.map((r) => ({ value: r.value, label: r.label }))}
      />
    </div>
  );
}
