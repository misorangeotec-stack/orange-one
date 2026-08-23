import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, FileText, FolderOpen, Star, Trash2, X } from "lucide-react";
import PhotoLightbox from "@/shared/components/ui/PhotoLightbox";
import { compressImage } from "@/shared/lib/imageCompress";
import { uploadSignedPage } from "../data/ocpiWrites";
import { useOcpiDocUrls } from "../lib/docUrls";
import { MAX_SIGNED_PAGES, isImagePath, pageLabel, type SignatureSlot } from "../lib/signatures";
import type { OcpiDoc } from "../types";

/**
 * Capture the pages of a signed order confirmation.
 *
 * ⚠ MULTI-PAGE IS THE POINT, NOT A FLOURISH. An order confirmation runs to four
 *   to seven pages and a customer who initials each one hands back a stack.
 *   A single-file picker would force whoever is standing at their desk to give
 *   up all but one page — which is how the paper process lost them in the first
 *   place. Same reasoning, and the same shape, as order-to-dispatch's
 *   ReceiverCopyCapture; it is not imported because a component reaching across
 *   into another app's folder is how two modules end up sharing a bug.
 *
 * ⚠ CONTROLLED, AND IT OWNS NOTHING. The ordered list lives in the panel above,
 *   which is what uploads and records it. Two callers — the customer signature
 *   and the countersignature — is exactly why it must not keep the list itself.
 *
 * ⚠ POSITION 0 IS PAGE ONE. It becomes `cs_doc_path` / `ms_doc_path`; the rest
 *   become the jsonb tail. That is why "Make page 1" exists at all — a phone
 *   that shot the pages out of order otherwise files the wrong sheet as the
 *   primary, and the primary is what every strip and every list shows first.
 *
 * Photographs are downscaled before they leave the phone (`compressImage`,
 * ~1600px): a 6 MB shot becomes ~400 KB and the signature is still legible.
 * That helper never throws and falls back to the original file, so a failed
 * compression cannot block a signature being filed.
 */

/** A page chosen here and not yet uploaded. */
export interface PendingPage {
  kind: "pending";
  /** Stable across re-renders so React keys and url revocation both behave. */
  id: string;
  file: File;
  /** Object url for the tile. Images only — a PDF gets an icon instead. */
  previewUrl: string | null;
  /**
   * Set once this page has landed in storage.
   *
   * ⚠ THIS IS WHAT MAKES A RETRY SAFE. A dropped connection halfway through a
   *   five-page upload fails the save with the form still on screen. Without a
   *   memo of what already landed, the retry re-uploads every page and orphans
   *   the first attempt's objects in a bucket nothing will ever clean.
   */
  uploaded?: OcpiDoc;
}

/** A page already filed against this deal. */
export interface StoredPage extends OcpiDoc {
  kind: "stored";
}

export type SignedPage = PendingPage | StoredPage;

const MAX_OTHER_BYTES = 10 * 1024 * 1024;
const isImageFile = (f: File) => f.type.startsWith("image/");

export function toPending(file: File, seq: number): PendingPage {
  return {
    kind: "pending",
    id: `p${seq}-${file.name}-${file.size}`,
    file,
    previewUrl: isImageFile(file) ? URL.createObjectURL(file) : null,
  };
}

export const asStored = (d: OcpiDoc): StoredPage => ({ kind: "stored", ...d });

/**
 * Put every page that is not already in storage into storage, in order, and
 * hand back the ordered list the record RPC wants.
 *
 * ⚠ IT REPORTS PROGRESS BACK INTO THE PANEL'S STATE AFTER EVERY PAGE, and that
 *   is the whole reason this is not three lines inline. There is no offline
 *   support in this app; a five-page upload from a customer's office can and
 *   does die on page four. Writing the memo back means the retry uploads page
 *   five only. Without it, every retry re-uploads everything and orphans the
 *   previous attempt's objects in a bucket nothing will ever sweep — and these
 *   are signed contracts, so nobody will dare delete them by hand either.
 */
export async function uploadPages(
  dealId: string,
  slot: SignatureSlot,
  pages: SignedPage[],
  onProgress: (next: SignedPage[]) => void,
): Promise<OcpiDoc[]> {
  const next = [...pages];
  const out: OcpiDoc[] = [];

  for (let i = 0; i < next.length; i++) {
    const p = next[i];
    if (p.kind === "stored") {
      out.push({ path: p.path, name: p.name });
      continue;
    }
    if (p.uploaded) {
      out.push(p.uploaded);
      continue;
    }
    const doc = await uploadSignedPage(dealId, slot, p.file);
    next[i] = { ...p, uploaded: doc };
    onProgress([...next]);
    out.push(doc);
  }
  return out;
}

export default function SignedDocCapture({
  label,
  hint,
  value,
  onChange,
  onError,
  disabled = false,
}: {
  label: string;
  hint?: string;
  value: SignedPage[];
  onChange: (next: SignedPage[]) => void;
  /** Surfaced through the host panel's single error line, not a toast. */
  onError?: (message: string | null) => void;
  disabled?: boolean;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const [zoom, setZoom] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // Stored pages need signing; pending ones already carry an object url.
  const storedPaths = useMemo(
    () => value.filter((p): p is StoredPage => p.kind === "stored").map((p) => p.path),
    [value],
  );
  const signed = useOcpiDocUrls(storedPaths);

  /**
   * Revoke object urls on unmount.
   *
   * ⚠ Deliberately NOT keyed on `value` — that would revoke a live url on every
   *   reorder and leave the grid full of broken tiles. Removal revokes its own
   *   url in `removeAt`; this is only the last sweep.
   */
  const liveUrls = useRef<string[]>([]);
  liveUrls.current = value.flatMap((p) => (p.kind === "pending" && p.previewUrl ? [p.previewUrl] : []));
  useEffect(() => () => liveUrls.current.forEach(URL.revokeObjectURL), []);

  const previewOf = (p: SignedPage): string | null =>
    p.kind === "pending" ? p.previewUrl : isImagePath(p.path) ? (signed[p.path] ?? null) : null;

  const nameOf = (p: SignedPage): string => (p.kind === "pending" ? p.file.name : p.name);

  async function add(picked: FileList | null) {
    if (!picked || picked.length === 0) return;
    const incoming = Array.from(picked);

    const room = MAX_SIGNED_PAGES - value.length;
    if (room <= 0) {
      onError?.(`That is already ${MAX_SIGNED_PAGES} pages — remove one before adding another.`);
      return;
    }
    // Reject on size BEFORE trimming to the cap, so the message a person gets
    // names the actual problem with the file they just chose.
    const tooBig = incoming.find((f) => !isImageFile(f) && f.size > MAX_OTHER_BYTES);
    if (tooBig) {
      onError?.(`"${tooBig.name}" is larger than 10 MB. Photograph the page instead of attaching the file.`);
      return;
    }

    const taken = incoming.slice(0, room);
    onError?.(
      taken.length < incoming.length
        ? `Only ${MAX_SIGNED_PAGES} pages can be attached — the rest were not added.`
        : null,
    );

    setBusy(true);
    try {
      const prepared = await Promise.all(
        taken.map(async (f) => toPending(isImageFile(f) ? await compressImage(f) : f, seq.current++)),
      );
      onChange([...value, ...prepared]);
    } finally {
      setBusy(false);
    }
  }

  const removeAt = (i: number) => {
    const gone = value[i];
    if (gone?.kind === "pending" && gone.previewUrl) URL.revokeObjectURL(gone.previewUrl);
    onChange(value.filter((_, n) => n !== i));
    onError?.(null);
    setZoom(null);
  };

  const makeFirst = (i: number) => {
    if (i === 0) return;
    const next = [...value];
    const [moved] = next.splice(i, 1);
    next.unshift(moved);
    onChange(next);
    setZoom(0);
  };

  /*
    ⚠ TWO INPUTS, BECAUSE ONE CANNOT DO BOTH JOBS. `capture` sends the browser
      straight to the camera and OVERRIDES `multiple` — so a single input is
      either "one photo, camera" or "many files, browser", never both. Taking
      the pages one at a time is how a person photographs a stack anyway.
  */
  const pick = (ref: React.RefObject<HTMLInputElement>) => () => {
    if (disabled || busy) return;
    ref.current?.click();
  };

  const btn =
    "inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl border border-line " +
    "px-4 text-[14px] font-semibold text-navy transition hover:border-orange hover:text-orange " +
    "disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <section className="space-y-2.5">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">{label}</p>
        {hint && <p className="mt-0.5 text-[12.5px] text-grey-2">{hint}</p>}
      </div>

      {value.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {value.map((p, i) => {
            const preview = previewOf(p);
            return (
              <li key={p.kind === "pending" ? p.id : p.path} className="relative">
                <button
                  type="button"
                  onClick={() => setZoom(i)}
                  className="block aspect-square w-full overflow-hidden rounded-xl border border-line bg-page"
                  aria-label={`View ${pageLabel(i)}`}
                >
                  {preview ? (
                    <img src={preview} alt={pageLabel(i)} className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full flex-col items-center justify-center gap-1 px-1 text-grey-2">
                      <FileText className="h-6 w-6" />
                      <span className="w-full truncate text-center text-[10px]">{nameOf(p)}</span>
                    </span>
                  )}
                </button>

                <span className="pointer-events-none absolute bottom-1 left-1 rounded-md bg-navy/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  {pageLabel(i)}
                </span>

                {/* 28px box with a 44px tap target via the negative inset — a
                    delete you can hit by accident is worse than a small one. */}
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => removeAt(i)}
                    aria-label={`Remove ${pageLabel(i)}`}
                    className="absolute -right-1.5 -top-1.5 flex h-7 w-7 items-center justify-center rounded-full border border-line bg-white text-grey-2 shadow-card transition hover:text-ryg-red"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!disabled && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={pick(cameraRef)}
            className={btn}
            disabled={busy || value.length >= MAX_SIGNED_PAGES}
          >
            <Camera className="h-4 w-4" />
            {busy ? "Preparing…" : "Take photo"}
          </button>
          <button
            type="button"
            onClick={pick(filesRef)}
            className={btn}
            disabled={busy || value.length >= MAX_SIGNED_PAGES}
          >
            <FolderOpen className="h-4 w-4" />
            Choose files
          </button>
        </div>
      )}

      {/*
        `value = ""` after every pick, or choosing the SAME file twice in a row
        fires no change event at all and the second page silently never arrives.
      */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => { void add(e.target.files); e.target.value = ""; }}
      />
      <input
        ref={filesRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        className="hidden"
        onChange={(e) => { void add(e.target.files); e.target.value = ""; }}
      />

      <PhotoLightbox
        url={zoom !== null && value[zoom] ? previewOf(value[zoom]) : null}
        alt={zoom !== null ? pageLabel(zoom) : undefined}
        caption={zoom !== null ? `${pageLabel(zoom)} of ${value.length}` : undefined}
        onClose={() => setZoom(null)}
        actions={
          disabled || zoom === null ? null : (
            <>
              {zoom > 0 && (
                <button
                  type="button"
                  onClick={() => makeFirst(zoom)}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-white/90 px-3 text-[13px] font-semibold text-navy hover:bg-white"
                >
                  <Star className="h-3.5 w-3.5" />
                  Make page 1
                </button>
              )}
              <button
                type="button"
                onClick={() => removeAt(zoom)}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-ryg-red/90 px-3 text-[13px] font-semibold text-white hover:bg-ryg-red"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove
              </button>
            </>
          )
        }
      />
    </section>
  );
}
