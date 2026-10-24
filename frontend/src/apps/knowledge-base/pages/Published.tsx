/**
 * KB-1 · Which handbook is live.
 *
 * Read-only on purpose. Publishing is a developer running a script, not a button, because
 * the handbook is a legal document and every revision is a policy change somebody should
 * READ before the portal starts quoting it. The script prints a section-by-section diff and
 * refuses to write until a human confirms.
 *
 * Old versions are kept rather than overwritten, so "what did the handbook say in August"
 * has an answer.
 */
import Card from "@/shared/components/ui/Card";
import { formatDateDMY } from "@/shared/lib/date";
import { useHandbook } from "@/core/knowledge-base/data";
import { useHandbookVersions } from "../data";

export default function Published() {
  const { data: versions, isLoading } = useHandbookVersions();
  const { data: hb } = useHandbook();
  const list = versions ?? [];
  const current = list.find((v) => v.is_current);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[20px] font-bold text-navy">Published handbook</h1>
        <p className="mt-0.5 max-w-3xl text-[13px] text-grey-2">
          What the Ask HR bubble is answering from right now.
        </p>
      </div>

      <Card className="p-4">
        {isLoading ? (
          <p className="text-[13px] text-grey-2">Loading…</p>
        ) : current ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">Live now</p>
              <p className="mt-0.5 text-[15px] font-semibold text-navy">
                {current.title} · version {current.version}
              </p>
              <p className="text-[12px] text-grey-2">
                Published {formatDateDMY(current.published_at)}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">
                Sections
              </p>
              <p className="mt-0.5 text-[15px] font-semibold text-navy">
                {hb?.sections.length ?? "…"}
              </p>
              <p className="text-[12px] text-grey-2">
                across {hb?.chapters.length ?? "…"} chapters
              </p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">
                Source file
              </p>
              <p className="mt-0.5 break-all text-[13px] font-semibold text-navy">
                {current.source_filename ?? "unknown"}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-[13px] text-grey-2">
            No handbook has been published yet, so the Ask HR bubble has nothing to answer from.
          </p>
        )}
      </Card>

      <Card className="p-4">
        <p className="text-[13px] font-semibold text-navy">Publishing a new version</p>
        <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-grey-2">
          HR edits the Word file as they always have. A developer then runs the ingest, which prints
          exactly which sections were added, changed and removed, and writes nothing until that
          diff has been read. There is no upload button here on purpose: the handbook is a legal
          document, and a revision nobody reviewed would start being quoted to staff the moment it
          landed.
        </p>
        <pre className="mt-2 overflow-x-auto rounded-card border border-line bg-[#F7F9FC] px-3 py-2 text-[12px] text-navy">
{`cd frontend
npm run handbook              # show the diff, write nothing
npm run handbook -- --publish # write it and make it live`}
        </pre>
        <p className="mt-2 max-w-3xl text-[12.5px] text-grey-2">
          Notes written on the Notes screen are carried across to the new version automatically, so
          a re-publish does not quietly drop a warning.
        </p>
      </Card>

      {list.length > 1 && (
        <Card className="p-4">
          <p className="text-[13px] font-semibold text-navy">Earlier versions</p>
          <p className="mt-0.5 text-[12.5px] text-grey-2">
            Kept, not overwritten. Nothing reads them today; they exist so the handbook as it stood
            on a given date can still be produced.
          </p>
          <ul className="mt-2 space-y-1">
            {list
              .filter((v) => !v.is_current)
              .map((v) => (
                <li key={v.id} className="text-[12.5px] text-grey">
                  Version {v.version} · published {formatDateDMY(v.published_at)}
                </li>
              ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
