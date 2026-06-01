import AppShell from "@/shared/components/layout/AppShell";
import { useSession, ALL_ROLES } from "@/core/platform/session";
import { useDirectory } from "@/core/platform/store";
import { adminNav } from "./adminNav";

const roleLabel = (role: string) => ALL_ROLES.find((r) => r.value === role)?.label ?? role;

/** Portal Admin shell — wires the session into the generic AppShell, then routes. */
export default function AdminLayout() {
  const { user, role } = useSession();
  const { canEditUser } = useDirectory();
  return (
    <AppShell
      nav={adminNav}
      role={role}
      user={{ name: user.name, designation: user.designation, color: user.avatarColor, roleLabel: roleLabel(role) }}
      notifications={[]}
      banner={
        canEditUser ? undefined : (
          <div className="mb-5 flex items-start gap-3 rounded-card border border-[#F8B62B]/50 bg-[#FEF9EE] px-4 py-3">
            <svg className="mt-0.5 shrink-0 text-[#B7820E]" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
            <p className="text-[12.5px] text-[#9a6e0c] leading-relaxed">
              <b className="font-semibold">Live writes rolling out.</b> Department add / edit / delete now saves
              to the live backend. Editing user details, roles, reporting and module access is being wired
              next — those changes won't save yet.
            </p>
          </div>
        )
      }
    />
  );
}
