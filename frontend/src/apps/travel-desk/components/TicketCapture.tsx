import { useState } from "react";
import Button from "@/shared/components/ui/Button";
import FileCapture from "@/shared/components/ui/FileCapture";
import { extractTravelDoc, type TicketReading } from "../data/travelBookingWrites";

/**
 * Upload a ticket and let the extractor fill the form.
 *
 * ⚠ IT FILLS A FORM. IT NEVER SAVES. What comes back lands in the inputs beside
 *   this control and a human presses Save — the `extract-card` contract, and the
 *   reason a fare misread as 45,000 instead of 4,500 is a typo somebody catches
 *   rather than a figure nobody ever looks at again.
 *
 * ⚠ FAILING TO READ THE DOCUMENT IS NOT FAILING TO BOOK. A file type Claude
 *   cannot read (415), one over 10 MB (413) and both models being down (422) all
 *   surface as a line of text beside a form that still works. The file is still
 *   uploaded and attached; only the convenience is lost. An extractor that
 *   blocked the booking when it was unavailable would be worse than none.
 *
 * ⚠ FOREIGN CURRENCY IS A WARNING, NOT A CONVERSION. §11.3 excludes foreign
 *   currency from this policy entirely, so a ticket priced in USD is not
 *   something to convert — it is something the booker has to be told about
 *   before they type a number into a rupee field.
 */
export default function TicketCapture({
  onRead,
  onFile,
  disabled,
}: {
  /** Called with what the extractor read, for the form to pre-fill. */
  onRead: (reading: TicketReading) => void;
  /** Called with the picked file, so the caller can upload and attach it. */
  onFile: (file: File | null) => void;
  disabled?: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);

  const pick = (f: File | null) => {
    setFile(f);
    setMsg(null);
    setWarn(null);
    onFile(f);
  };

  const read = async () => {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    setWarn(null);
    try {
      const r = await extractTravelDoc(file, "ticket");
      onRead(r);

      const notes: string[] = [];
      if (r.currency && r.currency !== "INR") {
        notes.push(
          `The document is priced in ${r.currency}. Policy §11.3 does not cover foreign currency — check what was actually charged in rupees before saving.`,
        );
      }
      if (r.confidence === "low") {
        notes.push("The scan was hard to read, so check every figure against the document.");
      }
      setWarn(notes.join(" ") || null);
      setMsg(
        r.kind || r.carrier || r.bookingRef
          ? "Read. Check every field against the document before saving."
          : "Nothing usable could be read. Type the details in — the file is still attached.",
      );
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-dashed border-line p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-grey">
        Ticket or confirmation
      </div>
      <p className="mt-0.5 text-[11.5px] text-grey-2">
        A PDF or a photo. Reading it is optional — it only fills the form in, and every field stays
        yours to correct.
      </p>

      <div className="mt-2">
        <FileCapture value={file} onChange={pick} disabled={disabled || busy} />
      </div>

      {file && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={read} disabled={busy || disabled}>
            {busy ? "Reading…" : "Read this document"}
          </Button>
          <span className="text-[12px] text-grey-2">{file.name}</span>
        </div>
      )}

      {msg && <p className="mt-2 text-[12px] text-grey">{msg}</p>}
      {warn && (
        <p className="mt-1 rounded-lg bg-[#FFF7E6] px-2.5 py-1.5 text-[12px] text-navy">{warn}</p>
      )}
    </div>
  );
}
