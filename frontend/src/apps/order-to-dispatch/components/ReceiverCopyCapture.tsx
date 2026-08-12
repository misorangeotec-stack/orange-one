import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, FileText, FolderOpen, Star, Trash2, X } from "lucide-react";
import { SectionHeading } from "@/shared/components/ui/Readout";
import PhotoLightbox from "@/shared/components/ui/PhotoLightbox";
import { useSignedDocUrls } from "../lib/receiverDocUrls";
import type { StepDoc } from "../types";

/**
 * Capturing the receiver's copy — the mobile half of Confirmation on Dispatch.
 *
 * ⚠ THIS SCREEN IS USED STANDING AT A CUSTOMER'S GATE, ON A PHONE. That is the
 *   whole design brief. The person is holding a paper LR whose FRONT carries
 *   the consignment and whose BACK carries the signature and the stamp — the
 *   half that actually proves delivery. Before this component there was one
 *   bare `<input type="file">`: it took a single file and opened a file
 *   browser, so the real workflow was leave the app, open the camera, shoot,
 *   come back, hunt through the gallery. Twice, if you wanted the back, except
 *   there was nowhere to put the second one.
 *
 * ⚠ CONTROLLED, AND IT OWNS NOTHING. The ordered list lives in the parent —
 *   StepModal when recording, AmendRoundModal when a coordinator replaces the
 *   paperwork afterwards. Two callers is exactly why it must not keep the list
 *   itself.
 *
 * POSITION 0 IS THE PRIMARY. It becomes `dc_attachment_path`; everything after
 * it becomes `dc_attachment_pages`. That is why "Make front" exists at all.
 */

/** A file chosen on this screen and not yet uploaded. */
export interface PendingPage {
  kind: "pending";
  /** Stable across re-renders so React keys and revocation both behave. */
  id: string;
  file: File;
  /** Object url for the tile. Images only — a PDF gets an icon instead. */
  previewUrl: string | null;
  /**
   * Set once the upload succeeds.
   *
   * ⚠ THIS IS WHAT MAKES A RETRY SAFE. There is no offline support in this app,
   *   and a dropped signal at a customer's gate fails the save with the form
   *   still on screen. Without a memo of what already landed, the retry
   *   re-uploads every page and orphans the first attempt's objects in the
   *   bucket.
   */
  uploadedPath?: string;
  uploadedName?: string;
}

/** A page already stored against this round. */
export interface StoredPage extends StepDoc {
  kind: "stored";
}

export type ReceiverPage = PendingPage | StoredPage;

/** Enough pages for a long LR and a couple of stamps; past this it is a mistake. */
export const MAX_PAGES = 10;
/** Images are compressed on the way up; anything else is taken as-is. */
const MAX_OTHER_BYTES = 10 * 1024 * 1024;

const isImageFile = (f: File) => f.type.startsWith("image/");
const isImagePath = (p: string) => /\.(jpe?g|png|gif|webp|heic|heif|avif)$/i.test(p);

/** Build a pending page, minting a preview url only for something previewable. */
function toPending(file: File, seq: number): PendingPage {
  return {
    kind: "pending",
    id: `p${seq}-${file.name}-${file.size}`,
    file,
    previewUrl: isImageFile(file) ? URL.createObjectURL(file) : null,
  };
}

export const pageLabel = (i: number): string =>
  i === 0 ? "Front" : i === 1 ? "Back" : `Page ${i + 1}`;

export default function ReceiverCopyCapture({
  label,
  required,
  value,
  onChange,
  onError,
  disabled = false,
}: {
  label: string;
  required?: boolean;
  value: ReceiverPage[];
  onChange: (next: ReceiverPage[]) => void;
  /** Surfaced through the host form's single error line, not a toast. */
  onError?: (message: string | null) => void;
  disabled?: boolean;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const [zoom, setZoom] = useState<number | null>(null);

  // Stored pages need signing; pending ones already have an object url.
  const storedPaths = useMemo(
    () => value.filter((p): p is StoredPage => p.kind === "stored").map((p) => p.path),
    [value],
  );
  const signed = useSignedDocUrls(storedPaths);

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

  const previewOf = (p: ReceiverPage): string | null =>
    p.kind === "pending" ? p.previewUrl : isImagePath(p.path) ? (signed[p.path] ?? null) : null;

  const nameOf = (p: ReceiverPage): string => (p.kind === "pending" ? p.file.name : p.name);

  const add = (picked: FileList | null) => {
    if (!picked || picked.length === 0) return;
    const incoming = Array.from(picked);

    const room = MAX_PAGES - value.length;
    if (room <= 0) {
      onError?.(`That is already ${MAX_PAGES} pages — remove one before adding another.`);
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
        ? `Only ${MAX_PAGES} pages can be attached — the rest were not added.`
        : null,
    );
    onChange([...value, ...taken.map((f) => toPending(f, seq.current++))]);
  };

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
    ⚠ TWO INPUTS, BECAUSE ONE CANNOT DO BOTH JOBS. `capture` tells the browser
      to go straight to the camera, and it OVERRIDES `multiple` — so a single
      input is either "one photo, camera" or "many files, browser", never both.
      The camera path is the one that matters here, and taking the pages one at
      a time is how someone photographs a sheet anyway: front, turn it over,
      back.
  */
  const pick = (ref: React.RefObject<HTMLInputElement>) => () => {
    if (disabled) return;
    ref.current?.click();
  };

  const btn =
    "inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl border border-line " +
    "px-4 text-[14px] font-semibold text-navy transition hover:border-orange hover:text-orange " +
    "disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <section className="space-y-2.5">
      <SectionHeading>
        {label}
        {required && !disabled && <span className="text-orange"> *</span>}
      </SectionHeading>

      <p className="text-[12px] text-grey-2">
        Photograph the front, then turn the sheet over and photograph the back. Add more
        pages if the LR runs to several sheets.
      </p>

      {value.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {value.map((p, i) => {
            const preview = previewOf(p);
            return (
              <li key={p.kind === "pending" ? p.id : p.path} className="relative">
                <button
                  type="button"
                  onClick={() => setZoom(i)}
                  className="block w-full aspect-square overflow-hidden rounded-xl border border-line bg-page"
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
          <button type="button" onClick={pick(cameraRef)} className={btn} disabled={value.length >= MAX_PAGES}>
            <Camera className="h-4 w-4" />
            Take photo
          </button>
          <button type="button" onClick={pick(filesRef)} className={btn} disabled={value.length >= MAX_PAGES}>
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
        onChange={(e) => { add(e.target.files); e.target.value = ""; }}
      />
      <input
        ref={filesRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        className="hidden"
        onChange={(e) => { add(e.target.files); e.target.value = ""; }}
      />

      <PhotoLightbox
        url={zoom !== null && value[zoom] ? previewOf(value[zoom]) : null}
        alt={zoom !== null ? pageLabel(zoom) : undefined}
        caption={zoom !== null ? `${pageLabel(zoom)} — ${zoom + 1} of ${value.length}` : undefined}
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
                  Make front
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
