import { useEffect } from "react";
import { Navigate } from "react-router-dom";
import { useSandbox } from "@/shared/sandbox/SandboxContext";

/**
 * Route target for /hr-recruitment/sandbox (real-admin gated). Turns demo mode on
 * and bounces to the HR home, where the persona switcher + demo banner take over.
 * Exiting is done from the banner.
 */
export default function SandboxLauncher() {
  const { enter } = useSandbox();
  useEffect(() => {
    enter();
  }, [enter]);
  return <Navigate to="/hr-recruitment" replace />;
}
