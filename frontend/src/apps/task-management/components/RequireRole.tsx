import type { ReactNode } from "react";
import { useSession } from "../mock/session";
import AccessDenied from "../pages/system/AccessDenied";
import type { AppRole } from "../types";

/** Renders children only if the current role is allowed; otherwise shows Access Denied. */
export default function RequireRole({ roles, children }: { roles: AppRole[]; children: ReactNode }) {
  const { role } = useSession();
  if (!roles.includes(role)) return <AccessDenied />;
  return <>{children}</>;
}
