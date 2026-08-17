/**
 * "Onboarding into Colorix — Surat", in one line.
 *
 * WHY THIS EXISTS AS A COMPONENT RATHER THAN A `{s.companyName(id)}` HERE AND
 * THERE
 *   The company is chosen once, at the gate, and then it has to still be on
 *   screen five hand-offs later — when Accounts propose a credit limit, when the
 *   Sales Head approves, when the Director approves, and above all when someone
 *   opens Tally to create the ledger. That is seven or eight render sites, and
 *   the moment two of them disagree on wording or on what a blank means, the
 *   fact stops reading as a fact.
 *
 * ⚠ RESOLVES THROUGH THE STORE, which renders the ALIAS. mst_companies.name
 *   carries the financial year ("… (01-04-25TO31-03-27)") and the masters sync
 *   re-mints it every April; the alias is portal-owned and never syncs.
 *
 * ⚠ NULL IS A REAL CASE, not an error. Every request raised before the company
 *   question existed has none, and those rows still open, still render and still
 *   move through the queues. Show a plain dash, never "unknown" and never a
 *   warning colour — there is nothing wrong with them.
 */
import { Building2 } from "lucide-react";
import { cn } from "@hub/lib/utils";
import { useCustomerStore } from "@hub/lib/customerOnboarding/store";

export default function CompanyChip({
  companyId, prefix = true, className,
}: {
  companyId: string | null | undefined;
  /** Drop the "Onboarding into" lead-in where the surrounding label already says it. */
  prefix?: boolean;
  className?: string;
}) {
  const s = useCustomerStore();
  const name = s.companyName(companyId);

  return (
    <span
      className={cn("inline-flex items-center gap-1 whitespace-nowrap", className)}
      title={companyId ? `Onboarding into ${name}` : "No company recorded on this request"}
    >
      <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      {prefix && <span className="text-muted-foreground">Onboarding into</span>}
      <span className={companyId ? "font-medium text-foreground" : "text-muted-foreground"}>
        {name}
      </span>
    </span>
  );
}
