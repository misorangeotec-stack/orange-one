import AppShell from "@/shared/components/layout/AppShell";
import { useSession, roleLabel } from "@/core/platform/session";
import { leadsNav } from "./nav";


/** Wires the portal session into the shared AppShell for the Leads Dashboard. */
export default function LeadsLayout() {
  const { user, role } = useSession();
  return (
    <AppShell
      nav={leadsNav}
      role={role}
      user={{ name: user.name, designation: user.designation, color: user.avatarColor, roleLabel: roleLabel(role) }}
      notifications={[]}
    />
  );
}
