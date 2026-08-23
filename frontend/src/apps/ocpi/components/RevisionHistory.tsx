import { useMemo } from "react";
import Card from "@/shared/components/ui/Card";
import { useOrgPersonById } from "@/core/platform/orgPeople";
import { revisionsOf } from "../lib/revisionDiff";
import { dmy } from "../lib/format";
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
 */
export default function RevisionHistory({ versions }: { versions: QuotationVersion[] }) {
  const personById = useOrgPersonById();
  const revisions = useMemo(() => revisionsOf(versions).reverse(), [versions]);

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
