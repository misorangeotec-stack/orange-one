import { useState } from "react";
import { FileText, Image } from "lucide-react";
import { useProcurementStore } from "../store";
import type { Grn, Pi, PurchaseOrder, QcInspection, SourcingDoc, TallyBooking } from "../types";

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
  const s = useProcurementStore();
  if (!pi.documentPath) return <span className="text-grey-2">—</span>;
  return <DocButton name={pi.documentName} fallback="View document" icon="file" getUrl={() => s.piDocumentUrl(pi.documentPath!)} />;
}

/** Opens the stored GRN photo (e.g. damaged goods) via a short-lived signed URL. */
export function GrnPhotoLink({ grn }: { grn: Grn }) {
  const s = useProcurementStore();
  if (!grn.photoPath) return <span className="text-grey-2">—</span>;
  return <DocButton name={grn.photoName} fallback="View photo" icon="image" getUrl={() => s.grnPhotoUrl(grn.photoPath!)} />;
}

/** Opens the stored Tally invoice document via a fresh short-lived signed URL. */
export function TallyDocLink({ booking }: { booking: TallyBooking }) {
  const s = useProcurementStore();
  if (!booking.documentPath) return null;
  return (
    <DocButton name={booking.documentName} fallback="View invoice" icon="file" getUrl={() => s.tallyDocumentUrl(booking.documentPath!)} />
  );
}

/**
 * The QC branch's three attachments. All three hang off the same inspection row
 * but are separate documents belonging to separate steps, so each gets its own
 * link rather than one generic component.
 */
export function QcDocLink({ qc }: { qc: QcInspection }) {
  const s = useProcurementStore();
  if (!qc.documentPath) return null;
  return <DocButton name={qc.documentName} fallback="View QC report" icon="file" getUrl={() => s.qcDocumentUrl(qc.documentPath!)} />;
}

export function ReturnDocLink({ qc }: { qc: QcInspection }) {
  const s = useProcurementStore();
  if (!qc.returnDocPath) return null;
  return <DocButton name={qc.returnDocName} fallback="View return document" icon="file" getUrl={() => s.qcDocumentUrl(qc.returnDocPath!)} />;
}

export function GateDocLink({ qc }: { qc: QcInspection }) {
  const s = useProcurementStore();
  if (!qc.gateDocPath) return null;
  return <DocButton name={qc.gateDocName} fallback="View gate pass" icon="file" getUrl={() => s.qcDocumentUrl(qc.gateDocPath!)} />;
}

/** Opens the stored PO PDF via a fresh short-lived signed URL. */
export function PoDocLink({ po }: { po: PurchaseOrder }) {
  const s = useProcurementStore();
  if (!po.documentPath) return null;
  // Always "PO PDF", never the stored filename: a PO is shared as one known
  // document, and vendors' filenames are noise next to that.
  return <DocButton name={null} fallback="PO PDF" icon="file" getUrl={() => s.poDocumentUrl(po.documentPath!)} />;
}

/**
 * Every file attached at sourcing, as one row of links.
 *
 * ⚠ THIS IS THE READ-ONLY HALF OF THE FEATURE, AND IT MUST SIT IN `Modal`'s
 *   `readOnlyHeader`. Each link mints a short-lived signed URL on click, so it
 *   has to be a button, and `Modal` puts its body inside a disabled `<fieldset>`
 *   in read-only mode — a button in the body comes up inert. Same rule, and the
 *   same reason, as `PoRefDocs`.
 *
 * Renders nothing when there is nothing attached, so a caller can pass it
 * unconditionally.
 */
export function SourcingDocsList({ docs }: { docs: SourcingDoc[] }) {
  const s = useProcurementStore();
  if (docs.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">Sourcing attachments</span>
      {docs.map((d) => (
        <DocButton
          key={d.path}
          name={d.name}
          fallback="View file"
          icon={/\.(png|jpe?g|gif|webp|heic|heif|bmp)$/i.test(d.name) ? "image" : "file"}
          getUrl={() => s.sourcingDocUrl(d.path)}
        />
      ))}
    </div>
  );
}
