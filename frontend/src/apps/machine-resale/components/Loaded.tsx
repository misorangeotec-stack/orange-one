import type { ReactNode } from "react";
import Card from "@/shared/components/ui/Card";
import { PortalError } from "../data/client";
import { useMrStore } from "../store";

/**
 * Gate every page on the module's first load, so a page never shows empty lists
 * and zero counts that read as fact while the portal is still answering.
 *
 * Also the place a failed load is explained: no grant, the portal not set up on
 * this server (the two VITE_MR_* variables missing), or the portal unreachable.
 */
export default function Loaded({ children }: { children: ReactNode }) {
  const s = useMrStore();

  if (s.isLoading) {
    return (
      <div className="space-y-3">
        <div className="h-6 w-56 animate-pulse rounded bg-[#E9EDF4]" />
        <div className="h-3 w-80 animate-pulse rounded bg-[#EEF1F6]" />
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-[#F2F5F9]" />
          ))}
        </div>
        <p className="pt-2 text-[13px] text-grey-2">Loading Machine Resale...</p>
      </div>
    );
  }

  if (s.error) {
    const e = s.error;
    const kind = e instanceof PortalError ? e.kind : "unavailable";
    const title =
      kind === "no-access"
        ? "You do not have access to Machine Resale"
        : kind === "not-configured" || kind === "not-set-up"
          ? "Machine Resale is not set up yet"
          : kind === "signed-out"
            ? "Please sign in again"
            : "Machine Resale could not be loaded";
    return (
      <Card className="max-w-2xl p-6">
        <h1 className="text-[18px] font-bold text-navy">{title}</h1>
        <p className="mt-2 text-[13.5px] text-grey">
          {kind === "no-access"
            ? "Ask an admin to give you Machine Resale access in Admin, then open it again."
            : kind === "not-configured" || kind === "not-set-up"
              ? "This server has not been connected to the machine resale database. An admin needs to finish the setup."
              : "Nothing on this screen is reliable until it loads, so no figures are shown."}
        </p>
        <p className="mt-2 break-words text-[12.5px] text-ryg-red">{e instanceof Error ? e.message : String(e)}</p>
      </Card>
    );
  }

  return <>{children}</>;
}
