import { useState } from "react";
import Card from "@/shared/components/ui/Card";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import StepQueue from "../../components/StepQueue";
import CreditNoteModal from "../../components/CreditNoteModal";
import { useComplaintStore } from "../../store";
import { MANAGEMENT_STEPS } from "../../lib/steps";
import { dmy } from "../../lib/format";
import { cnProductText, formatCnAmount } from "../../types/creditNote";

/**
 * MANAGEMENT APPROVAL — the ONE place management look. The user asked for it:
 * every type that needs management (Finished Good, Raw Material, Other
 * Supplier, Customer Compensation) lands here, and leaves once management act.
 *
 * It is the three complaint steps management own — `approval` (FG commercial
 * call), `rm_management` (RM import / other supplier) and `management_review`
 * (the final sign-off) — in one list with a Stage column, plus the customer
 * compensations (`cn_approval`). Setup staffs them all with ONE row.
 *
 * ⚠ THE COMPENSATIONS ARE A CARD ON TOP, NOT ROWS IN THE QUEUE. They are their
 *   own table (fms_complaint_credit_notes) and step (`cn_approval`), so they
 *   cannot ride StepQueue; but this is where management look for approvals,
 *   so this is where they must also find them. Same popup as the Customer
 *   Compensation page.
 */
export default function ApprovalQueue() {
  return <StepQueue steps={MANAGEMENT_STEPS} title="Management Approval" top={<CompensationApprovals />} />;
}

function CompensationApprovals() {
  const s = useComplaintStore();
  const [openId, setOpenId] = useState<string | null>(null);

  const mayAct = s.canEdit && s.canActOnCn("cn_approval");
  if (!mayAct && !s.isModuleViewer) return null;

  const pending = s.creditNotes
    .filter((c) => c.status === "awaiting_cn_approval")
    .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
  if (pending.length === 0) return null;

  const opened = openId ? s.creditNoteById(openId) : undefined;

  return (
    <Card className="overflow-hidden">
      <div className="px-4 pt-4 pb-2">
        <h2 className="text-[15px] font-bold text-navy">
          Customer Compensation{" "}
          <span className="ml-1 rounded-full bg-orange-soft px-2 py-0.5 text-[12px] font-semibold text-orange">
            {pending.length}
          </span>
        </h2>
      </div>
      <ScrollableTable>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-grey-2 border-y border-line">
              <th className="px-4 py-2.5 font-medium">No.</th>
              <th className="px-4 py-2.5 font-medium">Date</th>
              <th className="px-4 py-2.5 font-medium">Company</th>
              <th className="px-4 py-2.5 font-medium">Customer</th>
              <th className="px-4 py-2.5 font-medium">Product</th>
              <th className="px-4 py-2.5 font-medium text-right">Amount</th>
              <th className="px-4 py-2.5 font-medium">Raised by</th>
              <th className="px-4 py-2.5 font-medium w-24"></th>
            </tr>
          </thead>
          <tbody>
            {pending.map((c) => (
              <tr
                key={c.id}
                onClick={() => setOpenId(c.id)}
                className="border-b border-line last:border-0 cursor-pointer hover:bg-page"
              >
                <td className="px-4 py-2.5 font-semibold text-navy whitespace-nowrap">{c.cnNo}</td>
                <td className="px-4 py-2.5 whitespace-nowrap">{dmy(c.submittedAt)}</td>
                <td className="px-4 py-2.5 whitespace-nowrap">{c.companyId ? s.companyName(c.companyId) : "—"}</td>
                <td className="px-4 py-2.5">{c.partyName}</td>
                <td className="px-4 py-2.5 whitespace-nowrap">{cnProductText(c)}</td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap font-medium">{formatCnAmount(c.amount)}</td>
                <td className="px-4 py-2.5 whitespace-nowrap">{c.requesterName}</td>
                <td className="px-4 py-2.5 text-right">
                  <span className={mayAct ? "text-orange font-semibold" : "text-grey-2"}>{mayAct ? "Approve" : "View"}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollableTable>
      {opened && <CreditNoteModal cn={opened} onClose={() => setOpenId(null)} />}
    </Card>
  );
}
