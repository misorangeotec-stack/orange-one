import { useEffect } from "react";
import { Navigate } from "react-router-dom";
import { useSandbox } from "./SandboxContext";

/**
 * Route target for /procurement/sandbox (real-admin gated). Turns demo mode on
 * and bounces to the procurement home, where the persona switcher + demo banner
 * take over. Exiting is done from the banner.
 */
export default function SandboxLauncher() {
  const { enter } = useSandbox();
  useEffect(() => {
    enter();
  }, [enter]);
  return <Navigate to="/procurement" replace />;
}
