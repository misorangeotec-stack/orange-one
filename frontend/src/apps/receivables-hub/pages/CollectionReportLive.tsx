import { Navigate } from "react-router-dom";
import { useSession } from "@/core/platform/session";
import { ReceivablesSourceProvider } from "@hub/lib/sourceContext";
import SalespersonCollectionReport from "@hub/pages/SalespersonCollectionReport";

/**
 * Collection Report (Tally Live) — admin-only.
 *
 * Reuses the existing SalespersonCollectionReport UI verbatim, but points its data
 * at the ConnectWave (live Tally) snapshot via the source context. Admins only; any
 * other role is bounced back to the dashboard (defence-in-depth alongside the
 * adminOnly menu, which merely hides the link).
 */
export default function CollectionReportLive() {
  const { isAdmin } = useSession();
  if (!isAdmin) return <Navigate to="/outstanding-dashboard" replace />;
  return (
    <ReceivablesSourceProvider value="connectwave">
      <SalespersonCollectionReport />
    </ReceivablesSourceProvider>
  );
}
