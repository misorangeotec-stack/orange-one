import AppShell from "@/shared/components/layout/AppShell";
import { useSession, roleLabel } from "@/core/platform/session";
import { fmsControlCenterNav } from "./nav";


/** Wires the portal session into the shared AppShell for the FMS Control Center. */
export default function FmsControlCenterLayout() {
  const { user, role } = useSession();
  return (
    <AppShell
      nav={fmsControlCenterNav}
      role={role}
      user={{ name: user.name, designation: user.designation, color: user.avatarColor, roleLabel: roleLabel(role) }}
      notifications={[]}
    />
  );
}
