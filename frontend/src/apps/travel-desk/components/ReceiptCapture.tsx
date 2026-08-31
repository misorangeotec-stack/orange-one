import { useState } from "react";
import Button from "@/shared/components/ui/Button";
import FileCapture from "@/shared/components/ui/FileCapture";
import { extractTravelDoc } from "../data/travelBookingWrites";
import type { BillReading } from "../data/travelClaimWrites";

/**
 * Photograph a receipt, and let the extractor fill the line in.
 *
 * ⚠ MOBILE FIRST, BECAUSE THE PEOPLE FILING THESE ARE NOT AT A DESK. Service
 *   engineers and sales staff are the bulk of Band 3 and they claim from a
 *   phone, at an airport, with a paper receipt in the other hand. `FileCapture`
 *   opens the camera directly and compresses what it takes, so a 6 MB photo does
 *   not become a failed upload on a hotel's wifi.
 *
 * ⚠ IT FILLS A FORM. IT NEVER SAVES. Same contract as the ticket extractor: what
 *   comes back lands in the inputs beside this control and a human presses Save.
 *   A bill misread as 45,000 instead of 4,500 is a typo somebody catches; the
 *   same number written straight into a claim line is money paid out.
 *
 * ⚠ THE CATEGORY IS A HINT, NOT A DECISION — and it is deliberately NOT applied
 *   automatically. The category decides whether a line is reimbursable at all
 *   (§15 refuses alcohol BY THE CATEGORY), which cap applies, and whether a
 *   receipt is mandatory. A model guessing "Meal" over a bar bill would move
 *   money. It is shown as a suggestion for the traveller to pick.
 *
 * ⚠ FAILING TO READ IS NOT FAILING TO CLAIM. 415, 413 and 422 all surface as a
 *   line of text beside a form that still works, and the file is still attached.
 */
export default function ReceiptCapture({
  onRead,
  onFile,
  disabled,
}: {
  onRead: (reading: BillReading) => void;
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
      const r = (await extractTravelDoc(file, "bill")) as unknown as BillReading;
      onRead(r);

      const notes: string[] = [];
      if (r.currency && r.currency !== "INR") {
        notes.push(
          `The bill is in ${r.currency}. Policy §11.3 does not cover foreign currency — claim what was actually charged in rupees.`,
        );
      }
      if (r.confidence === "low") {
        notes.push("The photo was hard to read, so check every figure against the receipt.");
      }
      if (r.category) {
        notes.push(
          `It looks like a "${r.category}" bill — pick the expense category yourself, because the category decides the cap and whether it can be claimed at all.`,
        );
      }
      setWarn(notes.join(" ") || null);
      setMsg(
        r.vendor || r.amount !== null
          ? "Read. Check the amount and the tax against the receipt before saving."
          : "Nothing usable could be read. Type it in — the photo is still attached.",
      );
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-dashed border-line p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-grey">Receipt</div>
      <p className="mt-0.5 text-[11.5px] text-grey-2">
        Photograph it or attach a PDF. Reading it is optional — it only fills the boxes in, and
        every figure stays yours to correct.
      </p>

      <div className="mt-2">
        <FileCapture value={file} onChange={pick} disabled={disabled || busy} />
      </div>

      {file && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={read} disabled={busy || disabled}>
            {busy ? "Reading…" : "Read this receipt"}
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
