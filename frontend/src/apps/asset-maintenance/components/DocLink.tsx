import { useState } from "react";
import { FileText } from "lucide-react";
import { useAssetStore } from "../store";

/**
 * Opens a stored document (a purchase invoice on an asset, or a service bill on a
 * job) via a fresh short-lived signed URL. Used in the step modal, the asset
 * detail and the reports, so it lives in its own file.
 */
export default function DocLink({ path, name }: { path: string; name: string | null }) {
  const s = useAssetStore();
  const [busy, setBusy] = useState(false);
  const open = async () => {
    if (busy) return;
    setBusy(true);
    try {
      window.open(await s.documentUrl(path), "_blank", "noopener,noreferrer");
    } catch {
      /* surfaced elsewhere */
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      onClick={open}
      disabled={busy}
      className="inline-flex max-w-[240px] items-center gap-1.5 text-[12.5px] font-semibold text-orange hover:underline disabled:opacity-60"
    >
      <FileText className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{busy ? "Opening…" : name || "View attachment"}</span>
    </button>
  );
}
