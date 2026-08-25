import { useMemo } from "react";
import Card from "@/shared/components/ui/Card";
import { useOrgPersonById } from "@/core/platform/orgPeople";
import { revisionsOf } from "../lib/revisionDiff";
import { useOcpiDocUrls } from "../lib/docUrls";
import { dmy, fmtDealValue } from "../lib/format";
import type { QuotationVersion } from "../types";

/**
 * Every revision of a quotation, and what changed at each one.
 *
 * ⚠ THE OLDEST IS AT THE BOTTOM. A negotiation is read backwards — "what did
 *   they push back on last time?" — so the most recent revision leads.
 *
 * ⚠ VERSION 1 SHOWS NO CHANGES, and says so rather than rendering an empty
 *   list. Nothing precedes it, so "no changes" would be a false statement about
 *   a first quotation; "this is where it started" is a true one.
 *
 * ⚠ EACH ROW CARRIES ITS OWN PRICE AND ITS OWN PAIR OF PAPERS (revision stage
 *   D). The value, the currency and the exchange rate come off the version row,
 *   not the deal — the deal holds only what it is worth today, so reading it
 *   would print the final figure against every revision and make a negotiation
 *   look like it never moved.
 */
export default function RevisionHistory({ versions }: { versions: QuotationVersion[] }) {
  const personById = useOrgPersonById();
  const revisions = useMemo(() => revisionsOf(versions).reverse(), [versions]);

  // One round trip signs every paper in the strip; the bucket is private, so an
  // unsigned path is not a link.
  const docPaths = useMemo(
    () => revisions.flatMap((r) => [r.pdfPath, r.ocPdfPath].filter((p): p is string => !!p)),
    [revisions],
  );
  const urls = useOcpiDocUrls(docPaths);

  if (revisions.length === 0) {
    return (
      <Card className="p-5">
        <h2 className="text-[15px] font-bold text-navy">Revision history</h2>
        <p className="mt-1 text-[13.5px] text-grey-2">
          Nothing generated yet. Every time this quotation is generated, a copy is kept and the
          differences from the one before appear here.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <h2 className="text-[15px] font-bold text-navy">Revision history</h2>
      <p className="mt-0.5 text-[13.5px] text-grey-2">
        {revisions.length === 1
          ? "One version so far."
          : `${revisions.length} versions. Each entry lists what changed from the one before it.`}
      </p>

      <ol className="mt-4 space-y-4">
        {revisions.map((r) => {
          const who = r.generatedBy ? personById(r.generatedBy)?.name ?? "Someone" : "System";
          return (
            <li key={r.versionNo} className="border-l-2 border-line pl-3">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-[13.5px] font-bold text-navy">
                  {r.versionNo === 1 ? "Original" : `Rev ${r.versionNo - 1}`}
                </span>
                <span className="text-[12.5px] text-grey-2">
                  {dmy(r.generatedAt)} · {who}
                </span>
              </div>

              {(r.dealValueAmount !== null || r.pdfPath || r.ocPdfPath) && (
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
                  {r.dealValueAmount !== null && (
                    <span className="font-semibold text-navy">
                      {fmtDealValue(r.dealValueAmount, r.dealValueCurrency)}
                      {r.dealValueCurrency === "USD" && r.fxRate !== null
                        ? ` · at ${r.fxRate.toFixed(4)} per USD`
                        : ""}
                    </span>
                  )}
                  {r.pdfPath && urls[r.pdfPath] && (
                    <a
                      className="font-semibold text-orange hover:underline"
                      href={urls[r.pdfPath]}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Summary
                    </a>
                  )}
                  {r.ocPdfPath && urls[r.ocPdfPath] && (
                    <a
                      className="font-semibold text-orange hover:underline"
                      href={urls[r.ocPdfPath]}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Detailed sheet
                    </a>
                  )}
                </div>
              )}

              {r.versionNo === 1 ? (
                <p className="mt-1 text-[13px] text-grey-2">This is where the quotation started.</p>
              ) : r.changes.length === 0 ? (
                <p className="mt-1 text-[13px] text-grey-2">
                  Regenerated with no changes to the answers.
                </p>
              ) : (
                <ul className="mt-1.5 space-y-1">
                  {r.changes.map((c) => (
                    <li key={c.key} className="text-[13px]">
                      <span className="font-medium text-navy">{c.label}</span>{" "}
                      {c.kind === "added" ? (
                        <>
                          set to <span className="font-medium text-navy">{c.after}</span>
                        </>
                      ) : c.kind === "removed" ? (
                        <>
                          cleared <span className="text-grey-2">(was {c.before})</span>
                        </>
                      ) : (
                        <>
                          <span className="text-grey-2 line-through">{c.before}</span>{" "}
                          <span aria-hidden>→</span>{" "}
                          <span className="font-medium text-navy">{c.after}</span>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
