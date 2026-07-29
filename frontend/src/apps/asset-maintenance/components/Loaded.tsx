import type { ReactNode } from "react";
import Card from "@/shared/components/ui/Card";
import { useAssetStore } from "../store";

/**
 * Gate every page on the module's first load.
 *
 * ⚠ WHY THIS EXISTS. Without it a page renders its chrome while `data` is still
 *   undefined, so every list is empty and every count is 0 — and the empty states
 *   say "No asset category yet" / "No assets yet" / "Nothing overdue". That is not
 *   a slow page, it is a page telling you something FALSE: a register that has
 *   just been bulk-loaded reads as empty, and a module whose whole job is to say
 *   "this is overdue" reads as all-clear.
 *
 *   Caught by rendering the pages, not by the typechecker — the screenshots
 *   showed "Asset categories 0" against seven seeded categories.
 *
 * It also surfaces a FAILED load, which otherwise renders as the same silent
 * zeros: react-query holds the error, nothing logs to the console, and the page
 * looks merely empty.
 */
export default function Loaded({ children }: { children: ReactNode }) {
  const s = useAssetStore();

  if (s.isLoading) {
    return (
      <div className="space-y-3">
        <div className="h-6 w-56 animate-pulse rounded bg-[#E9EDF4]" />
        <div className="h-3 w-80 animate-pulse rounded bg-[#EEF1F6]" />
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-[#F2F5F9]" />
          ))}
        </div>
        <p className="pt-2 text-[13px] text-grey-2">Loading the asset register…</p>
      </div>
    );
  }

  if (s.error) {
    return (
      <Card className="max-w-2xl p-6">
        <h1 className="text-[18px] font-bold text-navy">The asset register could not be loaded</h1>
        <p className="mt-2 text-[13.5px] text-grey">
          Nothing on this screen is reliable until it loads, so no figures are shown rather than
          zeros that would read as “all clear”.
        </p>
        <p className="mt-2 break-words text-[12.5px] text-ryg-red">
          {s.error instanceof Error ? s.error.message : String(s.error)}
        </p>
      </Card>
    );
  }

  return <>{children}</>;
}
