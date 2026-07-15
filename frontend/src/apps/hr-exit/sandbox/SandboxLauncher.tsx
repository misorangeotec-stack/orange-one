import { useEffect } from "react";
import { Navigate } from "react-router-dom";
import { useSandbox } from "@/shared/sandbox/SandboxContext";

/**
 * Route target for /hr-exit/sandbox (real-admin gated). Turns demo mode on and bounces
 * to the HR Exit home, where the persona switcher + demo banner take over. Exiting is
 * done from the banner.
 *
 * The `scope` is "exit" (ExitApp's SandboxProvider), so entering the exit demo cannot
 * flip Purchase or HR Recruitment into demo mode pointed at a persona id that means
 * nothing to them.
 */
export default function SandboxLauncher() {
  const { enter } = useSandbox();
  useEffect(() => {
    enter();
  }, [enter]);
  return <Navigate to="/hr-exit" replace />;
}
