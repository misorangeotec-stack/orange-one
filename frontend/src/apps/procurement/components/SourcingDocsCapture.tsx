import { useRef, useState } from "react";
import { Camera, FileSpreadsheet, FileText, FileType2, FolderOpen, Image as ImageIcon, X } from "lucide-react";
import { SECTION_HEADING_CLASS } from "@/shared/components/ui/Readout";
import { compressImage } from "@/shared/lib/imageCompress";
import type { SourcingDocInput } from "../data/procWrites";
import type { SourcingDoc } from "../types";

/**
 * The files behind a sourcing decision — the vendor quotations, the rate
 * comparison, the sheet somebody photographed on a desk.
 *
 * ⚠ MULTIPLE IS THE POINT, NOT A FLOURISH. A shortlist of three vendors is
 *   three quotations, and the comparison worked out in Excel is usually a
 *   fourth file. A single-file picker would make the buyer choose which one
 *   the approver gets to see — which is exactly how the other two ended up in
 *   a chat thread nobody can find six weeks later.
 *
 * ⚠ CONTROLLED, AND IT OWNS NOTHING. The list lives in SourcingModal, which is
 *   what uploads it and saves it. Keeping it here would lose the whole list to
 *   the modal's draft/reset cycle every time the requisition changed.
 *
 * Same shape and the same reasoning as ocpi's `SignedDocCapture` and
 * order-to-dispatch's `ReceiverCopyCapture`. It is deliberately NOT imported
 * from either — a component reaching across into another app's folder is how
 * two modules end up sharing a bug, and this one differs anyway: no page
 * ordering, no lightbox, and spreadsheets are first-class here.
 *
 * Photographs are downscaled before they leave the phone (`compressImage`,
 * ~1600px): a 6 MB shot becomes ~400 KB and a printed rate is still legible.
 * That helper never throws and falls back to the original file, so a failed
 * compression cannot block an attachment.
 */

/** A file chosen here and not yet uploaded. */
export interface PendingDoc {
  kind: "pending";
  /** Stable across re-renders so React keys and url revocation both behave. */
  id: string;
  file: File;
  /** Object url for the tile. Images only — everything else gets an icon. */
  previewUrl: string | null;
  /**
   * Set once this file has landed in storage.
   *
   * ⚠ THIS IS WHAT MAKES A RETRY SAFE. A dropped connection halfway through a
   *   four-file upload fails the save with the form still on screen. Without a
   *   memo of what already landed, the retry re-uploads everything and orphans
   *   the first attempt's objects in a bucket nothing will ever sweep.
   */
  uploaded?: SourcingDocInput;
}

/** A file already filed against this requisition. */
export interface StoredDoc extends SourcingDoc {
  kind: "stored";
}

export type SourcingFile = PendingDoc | StoredDoc;

export const MAX_SOURCING_DOCS = 10;
/** Matches the 10 MB the other FMS capture components allow for non-images. */
const MAX_OTHER_BYTES = 10 * 1024 * 1024;

const isImageFile = (f: File) => f.type.startsWith("image/");
const isImagePath = (name: string) => /\.(png|jpe?g|gif|webp|heic|heif|bmp)$/i.test(name);
const isSheet = (name: string, mime?: string | null) =>
  /\.(xlsx?|csv)$/i.test(name) || (mime ?? "").includes("spreadsheet") || (mime ?? "").includes("excel");
const isDoc = (name: string, mime?: string | null) =>
  /\.docx?$/i.test(name) || (mime ?? "").includes("word") || (mime ?? "") === "application/msword";

export const toPendingDoc = (file: File, seq: number): PendingDoc => ({
  kind: "pending",
  id: `d${seq}-${file.name}-${file.size}`,
  file,
  previewUrl: isImageFile(file) ? URL.createObjectURL(file) : null,
});

export const asStoredDoc = (d: SourcingDoc): StoredDoc => ({ kind: "stored", ...d });

const nameOf = (f: SourcingFile) => (f.kind === "pending" ? f.file.name : f.name);

/**
 * Put every file that is not already in storage into storage, in order, and
 * hand back the ordered list the save RPC wants.
 *
 * ⚠ IT REPORTS PROGRESS BACK INTO THE MODAL'S STATE AFTER EVERY FILE, and that
 *   is the whole reason this is not three lines inline — see `uploaded` above.
 */
export async function uploadSourcingFiles(
  requestId: string,
  files: SourcingFile[],
  upload: (requestId: string, file: File) => Promise<SourcingDocInput>,
  onProgress: (next: SourcingFile[]) => void,
): Promise<SourcingDocInput[]> {
  const next = [...files];
  const out: SourcingDocInput[] = [];

  for (let i = 0; i < next.length; i++) {
    const f = next[i];
    if (f.kind === "stored") {
      out.push({ path: f.path, name: f.name, mimeType: f.mimeType, sizeBytes: f.sizeBytes });
      continue;
    }
    if (f.uploaded) {
      out.push(f.uploaded);
      continue;
    }
    const doc = await upload(requestId, f.file);
    next[i] = { ...f, uploaded: doc };
    onProgress([...next]);
    out.push(doc);
  }
  return out;
}

export default function SourcingDocsCapture({
  value,
  onChange,
  onError,
  onOpenStored,
  disabled = false,
}: {
  value: SourcingFile[];
  onChange: (next: SourcingFile[]) => void;
  onError?: (message: string | null) => void;
  /** Opens an already-stored file — mints a fresh signed URL, so it must be a button. */
  onOpenStored?: (doc: StoredDoc) => void;
  disabled?: boolean;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function add(list: FileList | null) {
    if (!list || list.length === 0) return;
    const incoming = Array.from(list);
    const room = MAX_SOURCING_DOCS - value.length;
    if (room <= 0) {
      onError?.(`At most ${MAX_SOURCING_DOCS} files can be attached.`);
      return;
    }
    const taken = incoming.slice(0, room);
    if (incoming.length > room) {
      onError?.(`Only the first ${room} file${room === 1 ? "" : "s"} were added — the limit is ${MAX_SOURCING_DOCS}.`);
    } else {
      onError?.(null);
    }

    setBusy(true);
    try {
      const next: SourcingFile[] = [];
      for (const f of taken) {
        if (!isImageFile(f) && f.size > MAX_OTHER_BYTES) {
          onError?.(`${f.name} is larger than 10 MB and was skipped.`);
          continue;
        }
        const file = isImageFile(f) ? await compressImage(f) : f;
        next.push(toPendingDoc(file, value.length + next.length));
      }
      if (next.length) onChange([...value, ...next]);
    } finally {
      setBusy(false);
    }
  }

  const removeAt = (i: number) => {
    const gone = value[i];
    if (gone?.kind === "pending" && gone.previewUrl) URL.revokeObjectURL(gone.previewUrl);
    onChange(value.filter((_, n) => n !== i));
    onError?.(null);
  };

  /*
    ⚠ TWO INPUTS, BECAUSE ONE CANNOT DO BOTH JOBS. `capture` sends the browser
      straight to the camera and OVERRIDES `multiple` — so a single input is
      either "one photo, camera" or "many files, browser", never both.
  */
  const pick = (ref: React.RefObject<HTMLInputElement>) => () => {
    if (disabled || busy) return;
    ref.current?.click();
  };

  const btn =
    "inline-flex min-h-[40px] flex-1 items-center justify-center gap-2 rounded-xl border border-line " +
    "px-4 text-[13px] font-semibold text-navy transition hover:border-orange hover:text-orange " +
    "disabled:opacity-50 disabled:cursor-not-allowed";

  const full = value.length >= MAX_SOURCING_DOCS;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className={SECTION_HEADING_CLASS}>Attachments</span>
        <span className="text-[11.5px] text-grey-2">
          {disabled
            ? `${value.length} file${value.length === 1 ? "" : "s"}`
            : "Quotations, rate comparison, a photo of the sheet — the approver sees these"}
        </span>
      </div>

      {value.length === 0 && disabled && <p className="text-[12.5px] text-grey-2">No files were attached.</p>}

      {value.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {value.map((f, i) => {
            const name = nameOf(f);
            const preview = f.kind === "pending" ? f.previewUrl : null;
            const image = preview !== null || (f.kind === "stored" && isImagePath(f.name));
            const sheet = isSheet(name, f.kind === "pending" ? f.file.type : f.mimeType);
            const doc = isDoc(name, f.kind === "pending" ? f.file.type : f.mimeType);
            const Icon = sheet ? FileSpreadsheet : doc ? FileType2 : image ? ImageIcon : FileText;
            return (
              <li key={f.kind === "pending" ? f.id : f.path} className="relative">
                <button
                  type="button"
                  onClick={() => f.kind === "stored" && onOpenStored?.(f)}
                  disabled={f.kind === "pending"}
                  title={name}
                  aria-label={f.kind === "stored" ? `Open ${name}` : name}
                  className="block aspect-square w-full overflow-hidden rounded-xl border border-line bg-page disabled:cursor-default"
                >
                  {preview ? (
                    <img src={preview} alt={name} className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full flex-col items-center justify-center gap-1 px-1 text-grey-2">
                      <Icon className="h-6 w-6" />
                      <span className="w-full truncate text-center text-[10px]">{name}</span>
                    </span>
                  )}
                </button>

                {f.kind === "pending" && (
                  <span className="pointer-events-none absolute bottom-1 left-1 rounded-md bg-navy/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                    New
                  </span>
                )}

                {/* 28px box with a 44px tap target via the negative inset — a
                    delete you can hit by accident is worse than a small one. */}
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => removeAt(i)}
                    aria-label={`Remove ${name}`}
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
          <button type="button" onClick={pick(cameraRef)} className={btn} disabled={busy || full}>
            <Camera className="h-4 w-4" />
            {busy ? "Preparing…" : "Take photo"}
          </button>
          <button type="button" onClick={pick(filesRef)} className={btn} disabled={busy || full}>
            <FolderOpen className="h-4 w-4" />
            Choose files
          </button>
        </div>
      )}

      {/*
        `value = ""` after every pick, or choosing the SAME file twice in a row
        fires no change event at all and the second file silently never arrives.
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
        accept="image/*,application/pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.xls,.xlsx,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        multiple
        className="hidden"
        onChange={(e) => { void add(e.target.files); e.target.value = ""; }}
      />
    </div>
  );
}
