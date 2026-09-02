import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Button from "@/shared/components/ui/Button";
import QueueTable, { type QueueColumn } from "@/shared/components/ui/QueueTable";
import CoaModal from "../components/CoaModal";
import CoaExports from "../components/CoaExports";
import { useProductionStore } from "../store";
import { dmy } from "../lib/format";
import type { Coa, ProductionRequest } from "../types";

/**
 * COA REGISTER — every certificate this factory has issued, in one place.
 *
 * Without it a COA is only reachable by remembering which job card it belongs to
 * and opening that. "Send the customer the certificate for lot 2608-0041" is the
 * question this screen answers.
 *
 * FLAT, and sortable + filterable on every column, which is this repo default
 * rather than a decision taken here. No `groupBy`: banding by product would make
 * the product the primary sort and hide the most recent certificate mid-page,
 * when the whole point of a register is that the newest is at the top.
 */

/** How a certificate's frozen verdict reads in the register. "Not recorded" is
 *  a real state, not an absence: the COA may be entered before the test is saved. */
const RESULT_LABEL = (v: "approved" | "rejected" | null): string =>
  v === "approved" ? "Approved" : v === "rejected" ? "Rejected" : "Not recorded";

interface Row {
  coa: Coa;
  request: ProductionRequest | undefined;
  observed: number;
  total: number;
}

export default function CoaRegister() {
  const s = useProductionStore();
  /** ⚠ The card AND the round: a lot can carry a certificate per test, so
   *  "edit this row" has to say which one. */
  const [editing, setEditing] = useState<{ request: ProductionRequest; round: number } | null>(null);
  const [exporting, setExporting] = useState<Coa | null>(null);

  const rows = useMemo((): Row[] => {
    const byId = new Map(s.requests.map((r) => [r.id, r]));
    return s.coas.map((coa) => ({
      coa,
      request: byId.get(coa.requestId),
      // How complete the certificate is, which is the one thing a register can
      // say that the certificate itself cannot: a COA saved half-filled looks
      // identical to a finished one from the outside.
      observed: coa.lines.filter((l) => (l.observed ?? "").trim() !== "").length,
      total: coa.lines.length,
    }));
  }, [s.coas, s.requests]);

  const name = (id: string | null) => s.profileById(id ?? "")?.name ?? "—";

  const columns: QueueColumn<Row>[] = [
    {
      key: "lot",
      header: "Lot No",
      cell: (r) =>
        r.request ? (
          <Link to={`/production-entry/requests/${r.request.id}`} className="font-semibold text-navy hover:text-orange">
            {r.coa.lotNo || "—"}
          </Link>
        ) : (
          <span className="font-semibold text-navy">{r.coa.lotNo || "—"}</span>
        ),
      sortValue: (r) => r.coa.lotNo ?? "",
      filter: { kind: "text", get: (r) => r.coa.lotNo ?? "" },
    },
    {
      key: "product",
      header: "Product",
      cell: (r) => <span className="text-navy">{r.coa.productName || "—"}</span>,
      sortValue: (r) => r.coa.productName ?? "",
      filter: { kind: "select", get: (r) => r.coa.productName ?? "" },
    },
    {
      key: "round",
      header: "Test",
      cell: (r) => <span className="text-navy tabular-nums">Test {r.coa.round}</span>,
      // Numeric, or "Test 10" would sort between "Test 1" and "Test 2".
      sortValue: (r) => r.coa.round,
      filter: { kind: "select", get: (r) => `Test ${r.coa.round}` },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "result",
      header: "Result",
      /**
       * ⚠ WITHOUT THIS COLUMN A FAILED CERTIFICATE LOOKS EXACTLY LIKE A PASSED
       *   ONE in the list it is most likely to be found from — and this register
       *   is where "send the customer the certificate for lot 2608-0041" gets
       *   answered. Read off the COA's own frozen verdict, never off the job
       *   card, whose qcStatus mirrors the LATEST test.
       */
      cell: (r) => (
        <span
          className={`font-semibold ${
            r.coa.qcResult === "approved"
              ? "text-ryg-green"
              : r.coa.qcResult === "rejected"
                ? "text-ryg-red"
                : "text-grey-2"
          }`}
        >
          {RESULT_LABEL(r.coa.qcResult)}
        </span>
      ),
      sortValue: (r) => RESULT_LABEL(r.coa.qcResult),
      filter: { kind: "select", get: (r) => RESULT_LABEL(r.coa.qcResult) },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "issued",
      header: "Issue Date",
      cell: (r) => <span className="text-grey">{dmy(r.coa.issueDate)}</span>,
      // The cell reads dd-mm-yyyy, which sorts as text in the wrong order.
      sortValue: (r) => r.coa.issueDate,
      filter: { kind: "date", get: (r) => r.coa.issueDate },
      tdClassName: "whitespace-nowrap",
    },
    {
      key: "conclusion",
      header: "Conclusion",
      cell: (r) => <span className="text-grey">{r.coa.conclusion || "—"}</span>,
      sortValue: (r) => r.coa.conclusion ?? "",
      filter: { kind: "select", get: (r) => r.coa.conclusion || "—" },
    },
    {
      key: "remarks",
      header: "Remarks",
      // Free text, so a text filter rather than a dropdown of near-unique values.
      // ⚠ This is the CERTIFICATE's remark (internal copy only), not the test's.
      cell: (r) => (
        <span className="text-grey" title={r.coa.remarks ?? ""}>
          {r.coa.remarks || "—"}
        </span>
      ),
      sortValue: (r) => r.coa.remarks ?? "",
      filter: { kind: "text", get: (r) => r.coa.remarks ?? "" },
      tdClassName: "max-w-[260px] truncate",
    },
    {
      key: "filled",
      header: "Observed",
      cell: (r) => (
        <span className={`tabular-nums ${r.observed < r.total ? "text-ryg-red font-medium" : "text-grey"}`}>
          {r.observed} / {r.total}
        </span>
      ),
      sortValue: (r) => r.observed - r.total,
      filter: { kind: "select", get: (r) => (r.observed < r.total ? "Incomplete" : "Complete") },
      align: "right",
    },
    {
      key: "by",
      header: "Issued by",
      cell: (r) => <span className="text-grey">{name(r.coa.issuedBy)}</span>,
      sortValue: (r) => name(r.coa.issuedBy),
      filter: { kind: "select", get: (r) => name(r.coa.issuedBy) },
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[22px] font-bold text-navy">COA Register</h1>
        <p className="text-[13.5px] text-grey-2 mt-1">
          Every Certificate of Analysis issued, newest first — one per test, so a re-tested lot
          appears twice and both certificates are kept. Open one to download the customer or
          internal copy, or to correct it.
        </p>
      </div>

      <QueueTable<Row>
        rows={rows}
        rowKey={(r) => r.coa.id}
        columns={columns}
        initialSort={{ key: "issued", dir: "desc" }}
        rowsLabel="certificates"
        emptyTitle="No COAs yet"
        emptyMessage="A certificate appears here once QC issues one against a tested lot."
        exportName="COA-Register"
        exportTitle="COA Register"
        readOnly={!s.canEdit}
        actions={(r) => (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setExporting(r.coa)}>Download</Button>
            {r.request && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => r.request && setEditing({ request: r.request, round: r.coa.round })}
              >
                Edit
              </Button>
            )}
          </div>
        )}
      />

      {exporting && (
        <div className="rounded-xl border border-line bg-white p-4 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13px] font-semibold text-navy">
              Download COA — {exporting.lotNo || "—"} · Test {exporting.round}
            </span>
            <Button size="sm" variant="ghost" onClick={() => setExporting(null)}>Close</Button>
          </div>
          <CoaExports coa={exporting} />
        </div>
      )}

      <CoaModal
        open={editing !== null}
        onClose={() => setEditing(null)}
        request={editing?.request ?? null}
        round={editing?.round ?? 1}
        readOnly={!s.canEdit || !editing || !s.canActOn("quality_check", editing.request)}
      />
    </div>
  );
}
