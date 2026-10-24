import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import { useSession } from "@/core/platform/session";
import CreditNoteModal from "../../components/CreditNoteModal";
import { useComplaintStore } from "../../store";
import { requestHref } from "../../lib/routes";
import { RM_ORIGIN_TONE, dmy, rmOriginLabelOf } from "../../lib/format";
import {
  cnRow,
  complaintRow,
  rowAgeDays,
  rowCompanyId,
  rowInvoice,
  rowItem,
  rowLot,
  rowNo,
  rowParty,
  rowRaisedAt,
  rowRaisedBy,
  rowStatusLabel,
  rowStatusTone,
  rowTypeLabel,
  rowTypeTone,
  type AnyRow,
} from "../../lib/anyRow";

/**
 * Every complaint RLS lets this user see — or, with `mine`, only the ones they
 * raised. CUSTOMER COMPENSATIONS ARE LISTED TOO, as one more type: the user
 * wants All Complaints to be the whole register. A compensation's number opens
 * its popup (`?open=<id>`) rather than the complaint detail page.
 *
 * ONE component, two routes: /requests and /my-requests. The difference is a
 * filter, not a second screen, so the columns and their sorting cannot drift
 * apart between the two.
 *
 * ⚠ FLAT, NEVER `groupBy`. RM/FG feels like a band and is not: banding makes the
 *   group name the PRIMARY sort, so a list ordered by age would only sort within
 *   each type and the oldest complaint would hide mid-page. It is an ordinary
 *   column with its own sort and filter.
 */
export default function RequestsList({ mine }: { mine?: boolean }) {
  const s = useComplaintStore();
  const { user } = useSession();
  const [params, setParams] = useSearchParams();

  const rows = useMemo<AnyRow[]>(() => {
    const all = [...s.requests.map((r) => complaintRow(r)), ...s.creditNotes.map(cnRow)];
    return mine ? all.filter((x) => rowRaisedBy(x) === user.id) : all;
  }, [s.requests, s.creditNotes, mine, user.id]);

  const openId = params.get("open");
  const opened = openId ? s.creditNoteById(openId) : undefined;
  const openCn = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set("open", id);
    else next.delete("open");
    setParams(next, { replace: true });
  };

  const columns: QueueColumn<AnyRow>[] = [
    {
      key: "complaintNo",
      header: "Complaint",
      cell: (x) =>
        x.kind === "cn" ? (
          <button type="button" onClick={() => openCn(x.c.id)} className="font-semibold text-orange hover:underline">
            {x.c.cnNo}
          </button>
        ) : (
          <Link to={requestHref(x.r.id)} className="font-semibold text-orange hover:underline">
            {x.r.complaintNo}
          </Link>
        ),
      sortValue: rowNo,
      // No filter: every complaint number is unique, so the dropdown would
      // simply restate the table.
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "type",
      header: "Type",
      cell: (x) => (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap ${rowTypeTone(x)}`}>
          {rowTypeLabel(x)}
        </span>
      ),
      sortValue: rowTypeLabel,
      filter: { kind: "select", get: rowTypeLabel },
    },
    {
      // Domestic / Import — raw material only; blank everywhere else.
      key: "rmOrigin",
      header: "Domestic / Import",
      cell: (x) =>
        x.kind === "complaint" && x.r.rmOrigin ? (
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap ${RM_ORIGIN_TONE[x.r.rmOrigin]}`}
          >
            {rmOriginLabelOf(x.r.rmOrigin)}
          </span>
        ) : (
          "—"
        ),
      sortValue: (x) => (x.kind === "complaint" ? rmOriginLabelOf(x.r.rmOrigin) : "—"),
      filter: { kind: "select", get: (x) => (x.kind === "complaint" ? rmOriginLabelOf(x.r.rmOrigin) : "—") },
    },
    {
      key: "party",
      header: "Customer / Vendor",
      cell: rowParty,
      sortValue: rowParty,
      filter: { kind: "select", get: rowParty },
    },
    {
      key: "company",
      header: "Company",
      cell: (x) => s.companyName(rowCompanyId(x)),
      sortValue: (x) => s.companyName(rowCompanyId(x)),
      filter: { kind: "select", get: (x) => s.companyName(rowCompanyId(x)) },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "lot",
      header: "LOT No.",
      cell: rowLot,
      sortValue: rowLot,
      filter: { kind: "select", get: rowLot },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "item",
      header: "Item / Product",
      cell: rowItem,
      sortValue: rowItem,
      filter: { kind: "select", get: rowItem },
    },
    {
      key: "invoice",
      header: "Invoice",
      cell: rowInvoice,
      sortValue: rowInvoice,
      filter: { kind: "select", get: rowInvoice },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "status",
      header: "Status",
      cell: (x) => (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap ${rowStatusTone(x)}`}>
          {rowStatusLabel(x)}
        </span>
      ),
      sortValue: rowStatusLabel,
      filter: { kind: "select", get: rowStatusLabel },
    },
    {
      key: "age",
      header: "Age",
      // A complaint ages from when the problem was NOTICED; a compensation from
      // when it was raised.
      cell: (x) => {
        const d = rowAgeDays(x);
        return d === null ? "—" : `${d}d`;
      },
      sortValue: (x) => rowAgeDays(x) ?? -1,
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "raised",
      header: "Raised",
      cell: (x) => dmy(rowRaisedAt(x)),
      sortValue: rowRaisedAt,
      tdClassName: "whitespace-nowrap",
    },
  ];

  return (
    <div className="space-y-5">
      <h1 className="text-[22px] font-bold text-navy">
        {mine ? "My Complaints" : "All Complaints"}
      </h1>

      <QueueTable<AnyRow>
        rows={rows}
        rowKey={(x) => x.key}
        columns={columns}
        rowsLabel="complaints"
        initialSort={{ key: "raised", dir: "desc" }}
        exportName={mine ? "my-complaints" : "complaints"}
        exportTitle={mine ? "My Complaints" : "All Complaints"}
        emptyTitle={mine ? "You have not raised a complaint yet" : "No complaints yet"}
        emptyMessage={
          mine
            ? "Complaints you raise will appear here."
            : "Complaints raised by anyone with this module will appear here."
        }
        loading={s.loading}
      />

      {opened && <CreditNoteModal cn={opened} onClose={() => openCn(null)} />}
    </div>
  );
}
