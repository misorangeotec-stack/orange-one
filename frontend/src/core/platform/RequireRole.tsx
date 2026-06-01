import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useSession } from "./session";
import type { AppRole } from "./types";

/**
 * Portal-wide route guard. Renders children only if the current role is allowed;
 * otherwise redirects home. This is the same guard Stage B's real auth uses.
 */
export default function RequireRole({ roles, children }: { roles: AppRole[]; children: ReactNode }) {
  const { role } = useSession();
  if (!roles.includes(role)) return <Navigate to="/home" replace />;
  return <>{children}</>;
}
