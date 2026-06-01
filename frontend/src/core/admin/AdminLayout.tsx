import AppShell from "@/shared/components/layout/AppShell";
import { useSession, ALL_ROLES } from "@/core/platform/session";
import { adminNav } from "./adminNav";

const roleLabel = (role: string) => ALL_ROLES.find((r) => r.value === role)?.label ?? role;

/** Portal Admin shell — wires the session into the generic AppShell, then routes. */
export default function AdminLayout() {
  const { user, role } = useSession();
  return (
    <AppShell
      nav={adminNav}
      role={role}
      user={{ name: user.name, designation: user.designation, color: user.avatarColor, roleLabel: roleLabel(role) }}
      notifications={[]}
    />
  );
}
