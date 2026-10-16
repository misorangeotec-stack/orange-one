import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Card from "@/shared/components/ui/Card";
import Tabs from "@/shared/components/ui/Tabs";
import { TextInput } from "@/shared/components/ui/Form";
import { ScrollableTable } from "@/core/shared/components/ScrollableTable";
import { useComplaintStore } from "../store";
import { dmy } from "../lib/format";
import { newRequestHref, type CreditNoteTab } from "../lib/routes";
import CreditNoteModal from "../components/CreditNoteModal";
import {
  CREDIT_NOTE_STATUS_LABEL,
  CREDIT_NOTE_STATUS_TONE,
  formatCnAmount,
  type CreditNote,
} from "../types/creditNote";

/**
 * Customer Credit Notes — the ONE page for the whole chain.
 *
 *   Management Approval → Tally Entry → Closed   (or Rejected)
 *
 * Each tab is a bucket. Opening a row shows everything on it; whoever owns the
 * bucket it is in (Setup: "Credit Note — Management Approval" / "… Tally Entry")
 * gets the form to move it on. Raising is the fourth option on Raise a complaint.
 */
const TAB_STATUS: Record<CreditNoteTab, (c: CreditNote) => boolean> = {
  approval: (c) => c.status === "awaiting_cn_approval",
  tally: (c) => c.status === "awaiting_cn_tally",
  closed: (c) => c.status === "closed",
  rejected: (c) => c.status === "rejected",
  all: () => true,
};

const TABS: { key: CreditNoteTab; label: string }[] = [
  { key: "approval", label: "Management Approval" },
  { key: "tally", label: "Tally Entry" },
  { key: "closed", label: "Closed" },
  { key: "rejected", label: "Rejected" },
  { key: "all", label: "All" },
];

export default function CreditNotes() {
  const s = useComplaintStore();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");

  const tabParam = params.get("tab") as CreditNoteTab | null;
  const tab: CreditNoteTab = tabParam && tabParam in TAB_STATUS ? tabParam : "approval";
  const openId = params.get("open");
  const opened = openId ? s.creditNoteById(openId) : undefined;

  const setTab = (t: string) => {
    const next = new URLSearchParams(params);
    next.set("tab", t);
    next.delete("open");
    setParams(next, { replace: true });
  };
  const openCn = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("open", id);
    else next.delete("open");
    setParams(next, { replace: true });
  };

  // Newest first.
  const all = useMemo(
    () => [...s.creditNotes].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)),
    [s.creditNotes],
  );

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter(TAB_STATUS[tab]).filter(
      (c) =>
        !needle ||
        [c.cnNo, c.partyName, c.salespersonName, c.approvedByName, c.reason, c.requesterName, c.tallyNo ?? ""].some((x) =>
          x.toLowerCase().includes(needle),
        ),
    );
  }, [all, tab, q]);

  const tabs = TABS.map((t) => ({ ...t, count: all.filter(TAB_STATUS[t.key]).length }));

  /** What the row's button says, when this person can act on it. */
  const actionFor = (c: CreditNote): string | null => {
    if (!s.canEdit) return null;
    if (c.status === "awaiting_cn_approval" && s.canActOnCn("cn_approval")) return "Approve";
    if (c.status === "awaiting_cn_tally" && s.canActOnCn("cn_tally")) return "Enter Tally";
    return null;
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-navy">Customer Credit Notes</h1>
          <p className="text-[12.5px] text-grey-2 mt-0.5">
            Raised → management approval → Tally entry → closed.
          </p>
        </div>
        {s.canRaise && (
          <Link
            to={`${newRequestHref()}?type=credit_note`}
            className="rounded-lg bg-orange px-4 py-2 text-[13px] font-semibold text-white hover:opacity-90"
          >
            Raise a credit note
          </Link>
        )}
      </div>

      <Card className="overflow-hidden">
        <div className="px-4 pt-2">
          <Tabs tabs={tabs} active={tab} onChange={setTab} />
        </div>
        <div className="px-4 py-3">
          <TextInput
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search CN no., customer, reason, Tally no.…"
            className="max-w-sm"
          />
        </div>
        <ScrollableTable>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-grey-2 border-y border-line">
                <th className="px-4 py-2.5 font-medium">CN No.</th>
                <th className="px-4 py-2.5 font-medium">Date</th>
                <th className="px-4 py-2.5 font-medium">Customer</th>
                <th className="px-4 py-2.5 font-medium">Salesperson</th>
                <th className="px-4 py-2.5 font-medium">Approved by</th>
                <th className="px-4 py-2.5 font-medium">Reason</th>
                <th className="px-4 py-2.5 font-medium text-right">Amount</th>
                <th className="px-4 py-2.5 font-medium">Raised by</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Tally no.</th>
                <th className="px-4 py-2.5 font-medium w-28"></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-grey-2">
                    No credit notes here.
                  </td>
                </tr>
              ) : (
                rows.map((c) => {
                  const action = actionFor(c);
                  return (
                    <tr
                      key={c.id}
                      onClick={() => openCn(c.id)}
                      className="border-b border-line last:border-0 cursor-pointer hover:bg-page"
                    >
                      <td className="px-4 py-2.5 font-semibold text-navy whitespace-nowrap">{c.cnNo}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">{dmy(c.submittedAt)}</td>
                      <td className="px-4 py-2.5">{c.partyName}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">{c.salespersonName || "—"}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">{c.approvedByName || "—"}</td>
                      <td className="px-4 py-2.5 max-w-[260px] truncate" title={c.reason}>{c.reason}</td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap font-medium">{formatCnAmount(c.amount)}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">{c.requesterName}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${CREDIT_NOTE_STATUS_TONE[c.status]}`}>
                          {CREDIT_NOTE_STATUS_LABEL[c.status]}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">{c.tallyNo ?? "—"}</td>
                      <td className="px-4 py-2.5 text-right">
                        <span className={action ? "text-orange font-semibold" : "text-grey-2"}>{action ?? "View"}</span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </ScrollableTable>
      </Card>

      {opened && <CreditNoteModal cn={opened} onClose={() => openCn(null)} />}
    </div>
  );
}
