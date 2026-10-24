import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import Tabs from "@/shared/components/ui/Tabs";
import Button from "@/shared/components/ui/Button";
import { useComplaintStore } from "../store";
import { dmy, formatDateTime } from "../lib/format";
import CreditNoteModal from "../components/CreditNoteModal";
import { cnProductText, formatCnAmount, type CreditNote } from "../types/creditNote";

/**
 * TALLY ENTRY — the Tally desk's page for customer compensations.
 *
 * The user cut it down to this: management approve compensations on the
 * Management Approval page; this page is only "post it in Tally". Pending is
 * what management approved and Tally has not yet got; entering the Tally no.
 * closes it and it moves to Completed. Every compensation, at any stage, is
 * also in All Complaints.
 *
 * `?open=<id>` opens any compensation's popup (the bell and My Control Center
 * link here), whichever tab it would sit on.
 */
export default function CreditNotes() {
  const s = useComplaintStore();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState(params.get("tab") === "done" ? "done" : "pending");

  const openId = params.get("open");
  const opened = openId ? s.creditNoteById(openId) : undefined;
  const openCn = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("open", id);
    else next.delete("open");
    setParams(next, { replace: true });
  };

  // A Tally desk owner limited to some companies sees only theirs.
  const pending = useMemo(
    () => s.creditNotes.filter((c) => c.status === "awaiting_cn_tally" && s.seesCompanyAt("cn_tally", c.companyId)),
    [s],
  );
  const completed = useMemo(
    () =>
      s.creditNotes
        .filter((c) => c.status === "closed" && s.seesCompanyAt("cn_tally", c.companyId))
        .sort((a, b) => (b.tallyAt ?? "").localeCompare(a.tallyAt ?? "")),
    [s],
  );

  const mayEnter = s.canEdit && s.canActOnCn("cn_tally");
  const company = (c: CreditNote) => s.companyName(c.companyId);

  const base: QueueColumn<CreditNote>[] = [
    {
      key: "no",
      header: "No.",
      cell: (c) => (
        <button type="button" onClick={() => openCn(c.id)} className="font-semibold text-orange hover:underline">
          {c.cnNo}
        </button>
      ),
      sortValue: (c) => c.cnNo,
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "raised",
      header: "Raised",
      cell: (c) => dmy(c.submittedAt),
      sortValue: (c) => c.submittedAt,
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "company",
      header: "Company",
      cell: company,
      sortValue: company,
      filter: { kind: "select", get: company },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "customer",
      header: "Customer",
      cell: (c) => c.partyName,
      sortValue: (c) => c.partyName,
      filter: { kind: "select", get: (c) => c.partyName },
    },
    {
      key: "product",
      header: "Product",
      cell: cnProductText,
      sortValue: cnProductText,
      filter: { kind: "select", get: cnProductText },
    },
    {
      key: "salesperson",
      header: "Salesperson",
      cell: (c) => c.salespersonName || "—",
      sortValue: (c) => c.salespersonName,
      filter: { kind: "select", get: (c) => c.salespersonName || "—" },
    },
    {
      key: "approvedBy",
      header: "Approved by",
      cell: (c) => c.approvedByName || "—",
      sortValue: (c) => c.approvedByName,
      filter: { kind: "select", get: (c) => c.approvedByName || "—" },
    },
    {
      key: "amount",
      header: "Amount",
      cell: (c) => formatCnAmount(c.amount),
      sortValue: (c) => c.amount ?? 0,
      tdClassName: "whitespace-nowrap text-right",
    },
    {
      key: "approvedOn",
      header: "Mgmt approved",
      cell: (c) => dmy(c.aprAt),
      sortValue: (c) => c.aprAt ?? "",
      tdClassName: "whitespace-nowrap",
    },
  ];

  const completedColumns: QueueColumn<CreditNote>[] = [
    ...base,
    {
      key: "tallyNo",
      header: "Tally no.",
      cell: (c) => c.tallyNo ?? "—",
      sortValue: (c) => c.tallyNo ?? "",
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "tallyOn",
      header: "Entered",
      cell: (c) => dmy(c.tallyAt),
      sortValue: (c) => c.tallyAt ?? "",
      tdClassName: "whitespace-nowrap",
    },
  ];

  return (
    <div className="space-y-5">
      <h1 className="text-[22px] font-bold text-navy">Tally Entry</h1>

      <Tabs
        tabs={[
          { key: "pending", label: `Pending (${pending.length})` },
          { key: "done", label: `Completed (${completed.length})` },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "pending" ? (
        <QueueTable<CreditNote>
          rows={pending}
          rowKey={(c) => c.id}
          columns={base}
          rowsLabel="compensations"
          initialSort={{ key: "approvedOn", dir: "asc" }}
          exportName="tally-entry"
          exportTitle="Tally Entry"
          emptyTitle="Nothing to enter in Tally"
          emptyMessage="Compensations approved by management will appear here."
          loading={s.loading}
          readOnly={!s.canEdit}
          actions={(c) => (
            <Button size="sm" onClick={() => openCn(c.id)}>
              {mayEnter ? "Enter Tally" : "View"}
            </Button>
          )}
        />
      ) : (
        <QueueTable<CreditNote>
          rows={completed}
          rowKey={(c) => c.id}
          columns={completedColumns}
          rowsLabel="compensations"
          initialSort={{ key: "tallyOn", dir: "desc" }}
          exportName="tally-entry-done"
          exportTitle="Tally Entry — completed"
          emptyTitle="Nothing entered yet"
          emptyMessage="Compensations posted in Tally will appear here."
          loading={s.loading}
          readOnly={!s.canEdit}
          actions={(c) => (
            <Button size="sm" variant="ghost" onClick={() => openCn(c.id)}>
              View
            </Button>
          )}
        />
      )}

      {tab === "done" && completed[0]?.tallyAt && (
        <p className="text-[11.5px] text-grey-2">
          Last entered {formatDateTime(completed[0].tallyAt)}
        </p>
      )}

      {opened && <CreditNoteModal cn={opened} onClose={() => openCn(null)} />}
    </div>
  );
}
