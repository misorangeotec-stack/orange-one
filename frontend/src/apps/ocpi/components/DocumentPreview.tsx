import { useEffect, useRef, useState } from "react";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";

/**
 * Show a generated PDF, and let people take it away.
 *
 * ⚠ PREVIEW, DOWNLOAD AND PRINT ARE ALL THE SAME BLOB. Printing does not render
 *   a parallel HTML version — that is what `printGatePass.ts` does for the gate
 *   pass, and correctly, because the slip is only ever wanted on paper. A
 *   quotation is emailed AND printed, so two renderers would drift and the
 *   customer's copy would stop matching the file on record.
 *
 * ⚠ THE OBJECT URL IS REVOKED WHEN THE BLOB CHANGES OR THE PANEL UNMOUNTS.
 *   Regenerating five revisions without this leaks five PDFs' worth of memory
 *   into the tab, which on a document this size is not trivial.
 */
export default function DocumentPreview({
  blob,
  fileName,
  title,
  note,
  busy,
  onRegenerate,
  regenerateLabel,
}: {
  blob: Blob | null;
  fileName: string;
  title: string;
  note?: string;
  busy?: boolean;
  onRegenerate?: () => void;
  regenerateLabel?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    setUrl(blob ? URL.createObjectURL(blob) : null);
  }, [blob]);

  /**
   * Revoke the PREVIOUS url, one render AFTER the new one is on the iframe.
   *
   * ⚠ NOT IN THE CREATING EFFECT'S CLEANUP, which is the obvious place and is
   *   wrong. That cleanup runs before the re-render that swaps the `src`, so the
   *   iframe is left pointing at a url that no longer resolves — the frame
   *   flashes empty and the console fills with ERR_FILE_NOT_FOUND every time a
   *   document is regenerated. Keyed on `url`, the old one is only let go once
   *   the new one has actually been committed.
   */
  const prev = useRef<string | null>(null);
  useEffect(() => {
    if (prev.current && prev.current !== url) URL.revokeObjectURL(prev.current);
    prev.current = url;
  }, [url]);

  // The last one still has to go when the panel does, or regenerating five
  // revisions and navigating away pins five PDFs in the tab.
  useEffect(() => () => { if (prev.current) URL.revokeObjectURL(prev.current); }, []);

  function download() {
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
  }

  function print() {
    // Print the PDF itself through a hidden frame, so what comes out of the
    // printer is byte-for-byte what the customer receives.
    const f = frame.current;
    if (!f?.contentWindow) return;
    f.contentWindow.focus();
    f.contentWindow.print();
  }

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-[15px] font-bold text-navy">{title}</h2>
          {note && <p className="mt-0.5 text-[12.5px] text-grey-2">{note}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onRegenerate && (
            <Button size="sm" variant="ghost" onClick={onRegenerate} disabled={busy}>
              {busy ? "Working…" : regenerateLabel ?? "Regenerate"}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={print} disabled={!url}>
            Print
          </Button>
          <Button size="sm" onClick={download} disabled={!url}>
            Download
          </Button>
        </div>
      </div>

      {url ? (
        <iframe
          ref={frame}
          src={url}
          title={title}
          className="h-[70vh] w-full rounded-b-xl"
        />
      ) : (
        <div className="px-4 py-10 text-center text-[13.5px] text-grey-2">
          {busy ? "Building the document…" : "No document yet."}
        </div>
      )}
    </Card>
  );
}
