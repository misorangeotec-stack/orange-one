import { useRef, useState } from "react";
import Button from "@/shared/components/ui/Button";
import { useComplaintStore } from "../store";
import { DOC_SLOT_LABEL, type DocSlot } from "../types";

/**
 * Attach and list files for one step of one complaint.
 *
 * ⚠ THE UPLOAD HAPPENS IMMEDIATELY, not on modal save. A step's RPC and its
 *   evidence are separate writes: holding files until save would mean a failed
 *   step losing the photographs with it, and a successful step whose upload then
 *   failed would look complete while the evidence was gone. Uploading first
 *   means the worst case is an orphan file, which `deleteDoc` can clear.
 *
 * ⚠ SIGNED URLS ARE MINTED ON CLICK, never on render. They last ten minutes; a
 *   link created when a modal opened is often dead by the time somebody uses it.
 */
export default function EvidenceCapture({
  complaintId,
  stepKey,
  slot,
  label,
}: {
  complaintId: string;
  stepKey: string;
  slot: DocSlot;
  label?: string;
}) {
  const s = useComplaintStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const docs = s.docsFor(complaintId).filter((d) => d.slot === slot);

  const pick = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setErr("");
    try {
      // Sequential, not Promise.all: the storage path is time-stamped to the
      // millisecond, and two files uploaded in the same tick would collide on
      // the table's unique(path).
      for (const f of Array.from(files)) await s.uploadDoc(complaintId, slot, stepKey, f);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const open = async (path: string) => {
    try {
      window.open(await s.docUrl(path), "_blank", "noopener");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <span className="text-[13px] font-bold text-navy">{label ?? DOC_SLOT_LABEL[slot]}</span>
        {s.canEdit && (
          <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? "Uploading…" : "Attach"}
          </Button>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => void pick(e.target.files)}
      />

      {docs.length === 0 ? (
        <p className="text-[12px] text-grey-2">Nothing attached.</p>
      ) : (
        <ul className="space-y-1">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => void open(d.path)}
                className="text-[12.5px] text-orange hover:underline text-left truncate"
              >
                {d.name}
              </button>
              {s.canEdit && (
                <button
                  type="button"
                  onClick={() => void s.deleteDoc(d.id)}
                  className="text-[11.5px] text-grey-2 hover:text-red-600 shrink-0"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {err && <p className="mt-1 text-[12px] text-red-600">{err}</p>}
    </div>
  );
}
