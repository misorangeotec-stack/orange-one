import { useRef, useState } from "react";
import Button from "@/shared/components/ui/Button";
import { ldDocUrl } from "../data/ldWrites";

/**
 * Attach a file, see what is attached, open it, replace it, remove it.
 *
 * ⚠ NOT WRITE-ONCE. NR-5 sits on the work list because every HR attachment
 *   shipped that way and the RPCs structurally could not clear a value — so a
 *   wrong file could never be corrected. Replace and remove are here from the
 *   first version.
 *
 * ⚠ THE FILE IS UPLOADED FIRST AND THE DATABASE REFERENCE WRITTEN SECOND, and if
 *   the second step fails the object is left behind on purpose. A leftover
 *   object is invisible and costs pennies; a saved path pointing at nothing is a
 *   broken link the UI renders forever. The same order every module here uses.
 *
 * ⚠ NEVER RENDERS A RAW STORAGE PATH AS A LINK. The bucket is private, so a path
 *   only opens through a short signed URL fetched on click — which also means a
 *   link cannot be copied out of the page and shared.
 */
export default function DocField({
  path,
  label = "Attach a file",
  accept = "image/*,application/pdf",
  disabled,
  onUpload,
  onClear,
}: {
  path: string | null;
  label?: string;
  accept?: string;
  disabled?: boolean;
  /** Upload the file and record it. Resolves once the reference is saved. */
  onUpload: (file: File) => Promise<void>;
  /** Absent means this attachment cannot be removed once set. */
  onClear?: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /*
   * ⚠ A REF, NOT A <label> WRAPPING THE BUTTON. A label only forwards a click to
   *   its input when the click lands on the label itself — a real <button>
   *   inside swallows it, so the picker never opens and the control looks dead.
   */
  const fileRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);

  const pick = async (file: File | null) => {
    if (!file) return;
    setErr(null);
    setBusy(true);
    try {
      await onUpload(file);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      // Picking the SAME file again fires no change event unless the input is
      // reset — which is exactly what someone does after a failed upload.
      if (fileRef.current) fileRef.current.value = "";
      if (replaceRef.current) replaceRef.current.value = "";
    }
  };

  const open = async () => {
    const url = await ldDocUrl(path);
    if (url) window.open(url, "_blank", "noopener");
    else setErr("That file could not be opened — it may have been removed.");
  };

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        {path ? (
          <>
            <button
              type="button"
              onClick={() => void open()}
              className="text-[13px] font-medium text-orange hover:underline"
            >
              {path.split("/").pop()?.replace(/^\d+-/, "") ?? "Open the file"}
            </button>
            {!disabled && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => replaceRef.current?.click()}
                  className="text-[12.5px] font-medium text-grey-2 hover:text-orange"
                >
                  Replace
                </button>
                <input
                  ref={replaceRef}
                  type="file"
                  accept={accept}
                  className="hidden"
                  onChange={(e) => void pick(e.target.files?.[0] ?? null)}
                />
                {onClear && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setBusy(true);
                      void onClear().finally(() => setBusy(false));
                    }}
                    className="text-[12.5px] font-medium text-grey-2 hover:text-ryg-red"
                  >
                    Remove
                  </button>
                )}
              </>
            )}
          </>
        ) : disabled ? (
          <span className="text-[13px] text-grey-2">No file attached.</span>
        ) : (
          <>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => fileRef.current?.click()}>
              {busy ? "Uploading…" : label}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept={accept}
              className="hidden"
              onChange={(e) => void pick(e.target.files?.[0] ?? null)}
            />
          </>
        )}
      </div>
      {err && <p className="text-[12px] text-ryg-red">{err}</p>}
    </div>
  );
}
