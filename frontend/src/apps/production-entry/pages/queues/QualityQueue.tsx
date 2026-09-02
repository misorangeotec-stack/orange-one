import { useState } from "react";
import Button from "@/shared/components/ui/Button";
import StageQueue from "../../components/StageQueue";
import CoaModal from "../../components/CoaModal";
import CoaExports from "../../components/CoaExports";
import { useProductionStore } from "../../store";
import { currentCoaRound, hasReachedQuality } from "../../lib/coaRound";
import { dmy } from "../../lib/format";
import type { ProductionRequest } from "../../types";

/**
 * Quality Checking queue, plus the one thing that hangs off it: the Certificate
 * of Analysis — entering it, and printing it.
 *
 * ⚠ THE COA ACTIONS ARE OFFERED PER ROW, NOT PER STEP. Every other completed-row
 *   action on this component (Excel, Print) renders on all of them, which is
 *   right for a document that always exists. A COA does not — so they are
 *   rendered through `rowExtra`, which can decline a row.
 *
 * ⚠ WHAT THIS TAB ACTUALLY CONTAINS, because the code reads as though it were
 *   otherwise: `completedFor` keys on `qcAt`, and `qc_at` is stamped ONLY in the
 *   approved branch of `fms_production_record_quality`. So a lot whose test was
 *   REJECTED is not here at all — it sits in the Pending tab as a tracking row
 *   while its Additional Issue Slip loop runs, and its certificate is entered
 *   from inside the step form (or from the job card). This tab is the approved
 *   ones. The gates below are written as "has been tested" / "has a certificate"
 *   rather than "was approved" so they stay true if that ever changes.
 */
export default function QualityQueue() {
  const s = useProductionStore();
  const [coaFor, setCoaFor] = useState<ProductionRequest | null>(null);
  /** The lot whose certificates are being printed, or null. */
  const [printFor, setPrintFor] = useState<ProductionRequest | null>(null);
  const round = coaFor ? currentCoaRound(coaFor) : 1;
  const printing = printFor ? s.coasForRequest(printFor.id) : [];

  return (
    <>
      <StageQueue
        stepKey="quality_check"
        rowExtra={(r) => {
          if (!hasReachedQuality(r)) return null;
          const issued = s.coasForRequest(r.id);
          const has = !!s.coaForRound(r.id, currentCoaRound(r));
          return (
            <>
              <Button size="sm" variant="ghost" onClick={() => setCoaFor(r)}>
                {has ? "COA" : "Issue COA"}
              </Button>
              {issued.length > 0 && (
                <Button size="sm" variant="ghost" onClick={() => setPrintFor(r)}>
                  Print COA
                </Button>
              )}
            </>
          );
        }}
      />

      {/*
        THE DOWNLOAD PANEL, the same shape the COA Register uses.

        ⚠ IT LISTS EVERY ROUND THE LOT CARRIES, not the latest one. A lot rejected
          at Test 1 and approved at Test 2 has two certificates, both kept, and
          they say different things — silently offering only the newest is the
          exact bug this action exists to avoid.

        ⚠ Each round keeps CoaExports' two labelled rows — Customer copy and
          Internal copy. Which copy you are downloading is the single most
          consequential thing on this control, and a toggle can be got wrong by
          forgetting to look. (The ask says "company"; that is the customer copy.)
      */}
      {printFor && (
        <div className="rounded-xl border border-line bg-white p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13px] font-semibold text-navy">
              Print COA — {printFor.jobcardNo || printFor.reqNo}
              {printing.length > 1 && (
                <span className="ml-2 font-normal text-grey-2">
                  {printing.length} certificates on this lot
                </span>
              )}
            </span>
            <Button size="sm" variant="ghost" onClick={() => setPrintFor(null)}>Close</Button>
          </div>
          {printing.length === 0 ? (
            <p className="text-[12.5px] text-grey-2">No certificate has been issued for this lot.</p>
          ) : (
            printing.map((coa) => (
              <div key={coa.id} className="rounded-xl border border-line px-3.5 py-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-[12.5px] font-semibold text-navy">Test {coa.round}</span>
                  {/* The verdict frozen on THIS certificate, so a failed one is
                      never printed in the belief that it passed. */}
                  <span
                    className={`text-[12px] font-semibold ${
                      coa.qcResult === "approved"
                        ? "text-ryg-green"
                        : coa.qcResult === "rejected"
                          ? "text-ryg-red"
                          : "text-grey-2"
                    }`}
                  >
                    {coa.qcResult === "approved"
                      ? "Approved"
                      : coa.qcResult === "rejected"
                        ? "Rejected — prints with a REJECTED watermark"
                        : "Verdict not recorded — prints NOT VERIFIED"}
                  </span>
                  <span className="text-[12px] text-grey-2">Issued {dmy(coa.issueDate)}</span>
                </div>
                <CoaExports coa={coa} />
              </div>
            ))
          )}
        </div>
      )}

      <CoaModal
        open={coaFor !== null}
        onClose={() => setCoaFor(null)}
        request={coaFor}
        round={round}
        // A viewer reads the queue but writes nothing anywhere in the module; the
        // RPC refuses them too, but the form should not invite the attempt.
        readOnly={!s.canEdit || !coaFor || !s.canActOn("quality_check", coaFor)}
      />
    </>
  );
}
