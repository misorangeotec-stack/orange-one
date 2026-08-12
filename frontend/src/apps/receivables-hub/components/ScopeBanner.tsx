import { Info } from "lucide-react";
import { useReceivablesScope } from "@hub/lib/scope";
import type { ReportEntry } from "@hub/lib/reportCatalog";

/**
 * "These numbers are the whole company's, not just yours."
 *
 * Shown above any report whose catalogue entry declares `scoping: "none"`, and only to a
 * viewer who actually HAS a salesperson scope — an admin sees the same full figures and needs
 * no explanation for it.
 *
 * ── Why this exists ──
 * The product rule is that a report which cannot be mapped salesperson-wise still shows the
 * full data rather than being hidden or blanked. That is the right call, but silently is the
 * wrong way to do it: a salesperson who has learned that every other screen is filtered to
 * their own accounts would otherwise read a company-wide receivables figure as their own and
 * act on it. The banner is what keeps "show everything" honest.
 *
 * ── Why it is rendered by the route guard ──
 * RequireReportAccess has already resolved the catalogue entry for the URL, and it wraps every
 * report route. Putting the banner there means a new report gets it from its `scoping` field
 * alone — nobody has to remember to add it, and it cannot be forgotten on the one report where
 * it matters most. When an RPC later gains a party filter and the entry flips to
 * "party-server", the banner disappears on its own.
 */
export default function ScopeBanner({ report }: { report: ReportEntry }) {
  const { restrictToSalespersons } = useReceivablesScope();

  // null = unrestricted viewer (admin). Nothing to warn about.
  if (restrictToSalespersons === null) return null;
  if (report.scoping !== "none") return null;

  return (
    <div className="mx-6 mt-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
      <Info className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="text-xs leading-relaxed">
        {report.scopeNote ??
          "Company-wide figures — this report cannot be filtered to your assigned salespeople."}
      </p>
    </div>
  );
}
