import type { ReactNode } from "react";
import { useSession } from "@/core/platform/session";
import type { AppRole } from "@/core/platform/types";
import AccessDenied from "../pages/system/AccessDenied";

/** Renders children only if the current role is allowed; otherwise Access Denied. */
export default function RequireRole({ roles, children }: { roles: AppRole[]; children: ReactNode }) {
  const { role } = useSession();
  if (!roles.includes(role)) return <AccessDenied />;
  return <>{children}</>;
}
