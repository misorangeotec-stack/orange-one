import { useState } from "react";
import { supabase } from "@/core/platform/supabase";
import { FMS_DOCS_BUCKET } from "../data/fmsWrites";

/**
 * Opens a stored FMS document. The persisted value is a storage PATH in the
 * private `fms-documents` bucket, so we mint a short-lived signed URL on click
 * and open it in a new tab. Values that are already a full URL (http/blob — e.g.
 * a Test Mode object URL) are opened directly. The visible label is the original
 * filename, recovered from the `<code>/<timestamp>-<name>` path convention.
 */
export function fileNameFromRef(ref: string): string {
  if (/^(https?:|blob:)/i.test(ref)) return "Document";
  const base = ref.split("/").pop() ?? ref;
  return base.replace(/^\d+-/, "") || base;
}

export default function AttachmentLink({ value }: { value: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = async () => {
    setError(null);
    if (/^(https?:|blob:)/i.test(value)) {
      window.open(value, "_blank", "noopener");
      return;
    }
    setBusy(true);
    try {
      const { data, error: err } = await supabase.storage
        .from(FMS_DOCS_BUCKET)
        .createSignedUrl(value, 120);
      if (err || !data) throw new Error(err?.message ?? "Could not open the document.");
      window.open(data.signedUrl, "_blank", "noopener");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open the document.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={open}
        disabled={busy}
        className="inline-flex items-center gap-1.5 text-orange font-medium hover:underline disabled:opacity-60"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" />
        </svg>
        {busy ? "Opening…" : fileNameFromRef(value)}
      </button>
      {error && <span className="text-[11px] text-ryg-red">{error}</span>}
    </span>
  );
}
