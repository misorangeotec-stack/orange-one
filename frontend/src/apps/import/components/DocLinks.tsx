import { useState } from "react";
import { FileText, Image } from "lucide-react";
import { useImportStore } from "../store";
import type { Grn, Pi, PurchaseOrder, TallyBooking } from "../types";

/**
 * The stored-file links, one per document a PO can carry.
 *
 * Lifted out of PoDetail so the stage modals can show the attachment too: a
 * read-only view of a PI or a Tally booking that can't open its own document is
 * missing most of what someone opened it for. Behaviour is unchanged — each
 * mints a fresh short-lived signed URL on click, which is why these have to be
 * buttons rather than plain links (and so must sit OUTSIDE Modal's read-only
 * fieldset, via its `readOnlyHeader` slot).
 */

/** Shared shell: same look, same busy handling, different source of the URL. */
function DocButton({
  name,
  fallback,
  icon,
  getUrl,
}: {
  name: string | null;
  fallback: string;
  icon: "file" | "image";
  getUrl: () => Promise<string>;
}) {
  const [busy, setBusy] = useState(false);
  const open = async () => {
    if (busy) return;
    setBusy(true);
    try {
      window.open(await getUrl(), "_blank", "noopener,noreferrer");
    } catch {
      /* surfaced by the store; keep the host quiet */
    } finally {
      setBusy(false);
    }
  };
  const Icon = icon === "image" ? Image : FileText;
  return (
    <button
      onClick={open}
      disabled={busy}
      className="inline-flex max-w-[220px] items-center gap-1.5 text-[12.5px] font-semibold text-orange hover:underline disabled:opacity-60"
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{busy ? "Opening…" : name || fallback}</span>
    </button>
  );
}

/** Opens the stored Vendor PI document via a fresh short-lived signed URL. */
export function PiDocLink({ pi }: { pi: Pi }) {
  const s = useImportStore();
  if (!pi.documentPath) return <span className="text-grey-2">—</span>;
  return <DocButton name={pi.documentName} fallback="View document" icon="file" getUrl={() => s.piDocumentUrl(pi.documentPath!)} />;
}

/** Opens the stored GRN photo (e.g. damaged goods) via a short-lived signed URL. */
export function GrnPhotoLink({ grn }: { grn: Grn }) {
  const s = useImportStore();
  if (!grn.photoPath) return <span className="text-grey-2">—</span>;
  return <DocButton name={grn.photoName} fallback="View photo" icon="image" getUrl={() => s.grnPhotoUrl(grn.photoPath!)} />;
}

/** Opens the stored Tally invoice document via a fresh short-lived signed URL. */
export function TallyDocLink({ booking }: { booking: TallyBooking }) {
  const s = useImportStore();
  if (!booking.documentPath) return null;
  return (
    <DocButton name={booking.documentName} fallback="View invoice" icon="file" getUrl={() => s.tallyDocumentUrl(booking.documentPath!)} />
  );
}

/** Opens the stored PO PDF via a fresh short-lived signed URL. */
export function PoDocLink({ po }: { po: PurchaseOrder }) {
  const s = useImportStore();
  if (!po.documentPath) return null;
  // Always "PO PDF", never the stored filename: a PO is shared as one known
  // document, and vendors' filenames are noise next to that.
  return <DocButton name={null} fallback="PO PDF" icon="file" getUrl={() => s.poDocumentUrl(po.documentPath!)} />;
}
