import { useMemo } from "react";
import AppShell from "@/shared/components/layout/AppShell";
import { roleLabel, useSession } from "@/core/platform/session";
import { buildMrNav } from "./nav";

/** The hub's shared chrome around Machine Resale. No bell items of its own yet. */
export default function MachineResaleLayout() {
  const { user, role } = useSession();
  const nav = useMemo(() => buildMrNav(), []);
  return (
    <AppShell
      nav={nav}
      role={role}
      user={{ name: user.name, designation: user.designation, color: user.avatarColor, roleLabel: roleLabel(role) }}
      notifications={[]}
    />
  );
}
