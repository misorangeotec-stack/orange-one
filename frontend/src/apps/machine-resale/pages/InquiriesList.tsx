import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import AddInquiryModal from "../components/AddInquiryModal";
import { InquiryStatusPill, PageHeader } from "../components/Pills";
import { dmyTime } from "../lib/format";
import { B } from "../nav";
import { useMrStore } from "../store";
import { SOURCE_LABEL, type Inquiry } from "../types";

export default function InquiriesList() {
  const s = useMrStore();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);

  const statusOf = (i: Inquiry) => s.masterById(i.statusId)?.value ?? "";
  const statusSort = (i: Inquiry) => s.masterById(i.statusId)?.sortOrder ?? 99;
  const machineOf = (i: Inquiry) =>
    i.machineId || i.listingNoSnapshot ? `${i.listingNoSnapshot ?? ""} ${i.machineTitleSnapshot ?? ""}`.trim() : "General inquiry";

  const text = (key: string, header: string, get: (i: Inquiry) => string, cls = "text-grey"): QueueColumn<Inquiry> => ({
    key,
    header,
    cell: (i) => <span className={cls}>{get(i)}</span>,
    sortValue: get,
    exportValue: get,
    filter: { kind: "select", get },
  });

  const columns: QueueColumn<Inquiry>[] = [
    {
      key: "no",
      header: "Inquiry",
      cell: (i) => <span className="font-mono text-[12.5px] font-semibold text-navy">{i.inquiryNo}</span>,
      sortValue: (i) => i.inquiryNo,
      exportValue: (i) => i.inquiryNo,
      filter: { kind: "select", get: (i) => i.inquiryNo },
      resize: { width: 90 },
    },
    {
      key: "date",
      header: "Received",
      cell: (i) => <span className="whitespace-nowrap text-grey">{dmyTime(i.createdAt)}</span>,
      sortValue: (i) => i.createdAt,
      exportValue: (i) => dmyTime(i.createdAt),
      filter: { kind: "date", get: (i) => i.createdAt },
    },
    text("buyer", "Buyer", (i) => i.buyerName, "font-medium text-navy"),
    text("company", "Company", (i) => i.company ?? ""),
    text("phone", "Phone", (i) => i.phone),
    text("machine", "Machine", machineOf),
    text("source", "Came in by", (i) => SOURCE_LABEL[i.source]),
    {
      key: "status",
      header: "Status",
      cell: (i) => <InquiryStatusPill label={statusOf(i)} />,
      sortValue: statusSort,
      exportValue: statusOf,
      filter: { kind: "select", get: statusOf },
      resize: false,
    },
    text("salesperson", "Salesperson", (i) => i.salespersonName ?? ""),
    {
      key: "notes",
      header: "Notes",
      align: "right",
      cell: (i) => <span className="tabular-nums">{i.notes.length}</span>,
      sortValue: (i) => i.notes.length,
      exportValue: (i) => i.notes.length,
      filter: { kind: "number", get: (i) => i.notes.length },
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Inquiries" sub="Every inquiry from the website, plus the ones added by hand. Open a row to follow it up.">
        {s.canEdit && (
          <Button size="sm" onClick={() => setAdding(true)}>
            Add inquiry
          </Button>
        )}
      </PageHeader>
      <QueueTable<Inquiry>
        rows={s.inquiries}
        rowKey={(i) => i.id}
        columns={columns}
        rowsLabel="inquiries"
        onRowClick={(i) => navigate(`${B}/inquiries/${i.inquiryNo}`)}
        initialSort={{ key: "date", dir: "desc" }}
        emptyTitle="No inquiries yet"
        emptyMessage="Inquiries sent from the website appear here, and you can add a phone or WhatsApp lead by hand."
        exportName="Inquiries"
      />
      {s.canEdit && (
        <AddInquiryModal
          open={adding}
          onClose={() => setAdding(false)}
          onAdded={(id) => {
            setAdding(false);
            navigate(`${B}/inquiries/${id}`);
          }}
        />
      )}
    </div>
  );
}
