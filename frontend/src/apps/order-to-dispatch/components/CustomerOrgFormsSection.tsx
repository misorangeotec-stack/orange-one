import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDispatchStore } from "../store";
import { LEDGER_FORMS_QK, fetchLedgerForms, formNameByParty } from "../data/ledgerForms";

/**
 * THE FORMS THIS CUSTOMER WILL SEE — read-only, inside the customer dialog (OD-16).
 *
 * Tick the customer above and the name they read on their own order screen appears
 * here. Nothing is edited here: the mapping is keyed on the LEDGER and a ledger can
 * belong to more than one customer over its life, so a rename typed in one
 * customer's dialog would change what a different customer reads. Setup → Forms
 * owns the master.
 *
 * ⚠ IT RENDERS NOTHING UNLESS A FORM EXISTS, and that is the whole design of this
 *   component rather than a detail. It first listed every ticked ledger and spelled
 *   out the fallback for each — four lines of "No form yet — they will see
 *   'Enterprise — Noida'" on a customer in four books, plus a paragraph explaining
 *   that this was fine. All of it was true and none of it was worth the space: an
 *   unmapped ledger is the ORDINARY case, the fallback works, and a panel that
 *   shouts on the ordinary case trains people to ignore it.
 *
 *   So it is silent until there is something to say. An admin who wants to know
 *   what is mapped goes to Setup → Forms, which is the screen for that question.
 */
export default function CustomerOrgFormsSection({ partyIds }: { partyIds: string[] }) {
  const s = useDispatchStore();

  const forms = useQuery({
    queryKey: LEDGER_FORMS_QK,
    queryFn: fetchLedgerForms,
    enabled: partyIds.length > 0,
    staleTime: 60_000,
  });

  const byParty = useMemo(() => formNameByParty(forms.data ?? []), [forms.data]);

  /** Only the ticked ledgers that actually carry a form. */
  const rows = useMemo(() => {
    if (partyIds.length === 0) return [];
    return s.customers
      .filter((c) => partyIds.includes(c.id))
      .map((c) => ({
        partyId: c.id,
        book: c.companyId ? s.masterName("company", c.companyId) : null,
        formName: byParty.get(c.id) ?? null,
      }))
      .filter((r): r is typeof r & { formName: string } => !!r.formName)
      .sort((a, b) => (a.book ?? "").localeCompare(b.book ?? ""));
  }, [s, partyIds, byParty]);

  if (rows.length === 0) return null;

  return (
    <div className="space-y-2 border-t border-line pt-4">
      <div className="text-[13px] font-semibold text-navy">The form they order on</div>
      <div className="rounded-lg border border-line divide-y divide-line">
        {rows.map((r) => (
          <div key={r.partyId} className="flex items-center gap-3 px-3 py-1.5 text-[12.5px]">
            <span className="min-w-0 flex-1 truncate font-semibold text-ink">{r.formName}</span>
            <span className="shrink-0 text-grey-2">{r.book}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
