import { useEffect, useMemo, useRef, useState } from "react";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";

/**
 * One issue of a document set, shown as a pair rather than a pile.
 *
 * ⚠ TWO STACKED VIEWERS WAS THE BUG THIS REPLACES. A quotation is issued as a
 *   summary AND a detailed sheet, and the old panel rendered a full 70vh PDF
 *   frame for each, one under the other — so reading the second meant scrolling
 *   past the whole of the first, and the page grew a second copy of every
 *   control. They are two faces of ONE issue, so they get one frame and a
 *   switch, and the switch itself is the thing that says a second paper exists.
 *
 * ⚠ THE BROWSER'S OWN PDF CHROME IS SUPPRESSED (`#toolbar=0&navpanes=0`). The
 *   built-in viewer paints a dark grey bar with its own download, print and
 *   zoom buttons directly under ours — two sets of controls doing the same
 *   thing, one of which does not match the page. Ours stay, because they know
 *   the file's real name; the browser's would save it as a uuid.
 *
 * ⚠ A PAPER THAT DOES NOT EXIST IS STILL A TAB. 18 of 28 machines have no
 *   detailed template, and a missing tab reads as a page that failed to load.
 *   The tab is shown, marked, and says in words why there is nothing behind it.
 *
 * ⚠ EVERY OBJECT URL IS REVOKED WHEN ITS BLOB CHANGES OR THE PANEL UNMOUNTS.
 *   Regenerating five revisions without this pins five PDFs' worth of memory in
 *   the tab, which on a document this size is not trivial.
 */

export interface Paper {
  /** Stable key — also the tab's identity across re-renders. */
  key: string;
  /** What the tab says. Kept short: "Summary", "Detailed sheet". */
  label: string;
  blob: Blob | null;
  /** The name the file is saved under. Never a uuid. */
  fileName: string;
  /** Why this paper is absent, when `blob` is null and nothing is loading. */
  missingNote?: string;
}

export default function PaperSet({
  papers,
  title,
  note,
  busy,
  actions,
  viewerClass,
}: {
  papers: Paper[];
  title: string;
  note?: string;
  busy?: boolean;
  /**
   * Height of the PDF frame. Defaults to most of a full page; a dialog passes
   * something shorter, because a viewer taller than the dialog makes the
   * DIALOG scroll and the document is then read through a letterbox.
   */
  viewerClass?: string;
  /** Anything the owning screen wants beside the download controls. */
  actions?: React.ReactNode;
}) {
  const available = useMemo(() => papers.filter((p) => p.blob), [papers]);

  const [activeKey, setActiveKey] = useState<string>(papers[0]?.key ?? "");

  /*
    ⚠ THE READER'S CHOICE IS FINAL, AND THAT IS THE WHOLE POINT OF `chosen`.
      Auto-landing on the first paper that has content is right while the blobs
      are still arriving. Doing it AFTER a click is a bug with a very confusing
      shape: on the 18 machines with no detailed template, pressing "Detailed
      sheet" bounced straight back to Summary, so the one screen that explains
      WHY there is no detailed sheet could never be reached — the tab looked
      broken rather than empty.
  */
  const chosen = useRef(false);
  useEffect(() => {
    if (chosen.current) return;
    const current = papers.find((p) => p.key === activeKey);
    if (current?.blob) return;
    const firstReal = papers.find((p) => p.blob);
    if (firstReal) setActiveKey(firstReal.key);
    else if (!current && papers[0]) setActiveKey(papers[0].key);
  }, [papers, activeKey]);

  function choose(key: string) {
    chosen.current = true;
    setActiveKey(key);
  }

  const active = papers.find((p) => p.key === activeKey) ?? papers[0];

  /*
    One url per paper, so switching tabs does not re-create the blob url and
    reload the frame from scratch. Keyed by paper key; the previous generation
    is revoked once the new one is committed, never in the creating effect's
    own cleanup — that runs before the re-render that swaps `src`, leaving the
    frame pointed at a url that no longer resolves.
  */
  const [urls, setUrls] = useState<Record<string, string>>({});
  const prev = useRef<Record<string, string>>({});

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const p of papers) if (p.blob) next[p.key] = URL.createObjectURL(p.blob);
    setUrls(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [papers.map((p) => p.key + ":" + (p.blob ? p.blob.size : "0")).join("|")]);

  useEffect(() => {
    for (const [k, u] of Object.entries(prev.current)) {
      if (urls[k] !== u) URL.revokeObjectURL(u);
    }
    prev.current = urls;
  }, [urls]);

  useEffect(
    () => () => {
      for (const u of Object.values(prev.current)) URL.revokeObjectURL(u);
    },
    [],
  );

  const frame = useRef<HTMLIFrameElement | null>(null);
  const activeUrl = active ? urls[active.key] : undefined;

  function downloadOne(p: Paper) {
    const u = urls[p.key];
    if (!u) return;
    const a = document.createElement("a");
    a.href = u;
    a.download = p.fileName;
    a.click();
  }

  /*
    ⚠ THE SECOND FILE IS DELAYED. Chrome cancels a second programmatic download
      fired in the same tick as the first, so "Download both" would silently
      hand over one paper — exactly the failure this button exists to prevent.
  */
  function downloadAll() {
    available.forEach((p, i) => {
      if (i === 0) downloadOne(p);
      else setTimeout(() => downloadOne(p), 400 * i);
    });
  }

  function print() {
    // Print the PDF itself through its own frame, so what comes out of the
    // printer is byte-for-byte what the customer receives.
    const f = frame.current;
    if (!f?.contentWindow) return;
    f.contentWindow.focus();
    f.contentWindow.print();
  }

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-bold text-navy">{title}</h2>
          {note && <p className="mt-0.5 text-[12.5px] text-grey-2">{note}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {available.length > 1 && (
            <Button size="sm" variant="ghost" onClick={downloadAll}>
              Download both
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={print} disabled={!activeUrl}>
            Print
          </Button>
          <Button
            size="sm"
            onClick={() => active && downloadOne(active)}
            disabled={!activeUrl}
          >
            Download
          </Button>
        </div>
      </div>

      {/*
        The switch doubles as the statement that a second paper exists. A
        salesperson who never sees a "Detailed sheet" tab sends the summary
        alone and does not know they have.
      */}
      {papers.length > 1 && (
        <div className="flex flex-wrap gap-1 border-b border-line px-3 pt-2.5">
          {papers.map((p) => {
            const on = p.key === active?.key;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => choose(p.key)}
                className={
                  "-mb-px rounded-t-lg border border-b-0 px-3.5 py-2 text-[13px] font-semibold transition " +
                  (on
                    ? "border-line bg-white text-navy"
                    : "border-transparent text-grey-2 hover:text-navy")
                }
                aria-current={on ? "page" : undefined}
              >
                {p.label}
                {!p.blob && !busy && (
                  <span className="ml-1.5 text-[11px] font-medium text-grey-2">— none</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {activeUrl ? (
        <iframe
          ref={frame}
          /* Hide the built-in viewer's toolbar and sidebar; ours are above. */
          src={`${activeUrl}#toolbar=0&navpanes=0&view=FitH`}
          title={`${title} — ${active?.label ?? ""}`}
          className={(viewerClass ?? "h-[72vh]") + " w-full rounded-b-xl bg-page"}
        />
      ) : (
        <div className="px-4 py-12 text-center text-[13.5px] text-grey-2">
          {busy
            ? "Building the document…"
            : active?.missingNote ?? "No document yet."}
        </div>
      )}
    </Card>
  );
}
