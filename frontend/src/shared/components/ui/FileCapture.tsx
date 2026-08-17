import { useEffect, useRef, useState } from "react";
import { Camera, FileText, FolderOpen, X } from "lucide-react";
import { cn } from "@/shared/lib/cn";
import { compressImage } from "@/shared/lib/imageCompress";

/**
 * Pick ONE attachment — by photographing it, or by choosing a file.
 *
 * WHY IT IS NOT JUST `<input type="file">`. The forms that use this are filled in
 * from the shop floor with the paper record in hand: the log book page, a test
 * report. A bare file input on a phone opens the OS document picker, so the real
 * workflow was leave the app, open the camera, shoot, come back, browse to
 * Recents, find the shot. "Take photo" goes straight to the camera.
 *
 * ⚠ TWO INPUTS, BECAUSE ONE CANNOT DO BOTH JOBS. `capture` sends the browser
 *   straight to the camera and constrains the picker to what the camera makes,
 *   so an input that can shoot cannot also offer a PDF. Same reasoning as
 *   order-to-dispatch's ReceiverCopyCapture, which does this for many pages.
 *
 * Photos are downscaled before they leave the phone (`compressImage`, ~1600px):
 * a 6 MB camera shot becomes ~400 KB and the handwriting is still legible. That
 * helper never throws and falls back to the original file, so a failed
 * compression cannot block a save.
 *
 * `capture` is ignored on desktop, where both buttons open the file browser —
 * which is why "Take photo" is still shown there rather than hidden behind a
 * media query that would lie on a touchscreen laptop.
 */
export default function FileCapture({
  value,
  onChange,
  disabled = false,
  accept = "image/*,application/pdf",
  className,
}: {
  value: File | null;
  onChange: (file: File | null) => void;
  disabled?: boolean;
  /** What the "Choose file" button accepts. The camera button is always images. */
  accept?: string;
  className?: string;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  // One object URL per picked image, revoked when it is replaced or cleared —
  // a phone that shoots five times before saving would otherwise pin five
  // full-size bitmaps in memory.
  useEffect(() => {
    if (!value || !value.type.startsWith("image/")) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(value);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  const take = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      onChange(await compressImage(file));
    } finally {
      setBusy(false);
    }
  };

  const pick = (ref: React.RefObject<HTMLInputElement>) => () => {
    if (disabled || busy) return;
    ref.current?.click();
  };

  const btn =
    "inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl border border-line " +
    "px-4 text-[13.5px] font-semibold text-navy transition hover:border-orange hover:text-orange " +
    "disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <div className={cn("space-y-2", className)}>
      {!disabled && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <button type="button" onClick={pick(cameraRef)} className={btn} disabled={busy}>
            <Camera className="h-4 w-4" />
            {busy ? "Preparing…" : "Take photo"}
          </button>
          <button type="button" onClick={pick(filesRef)} className={btn} disabled={busy}>
            <FolderOpen className="h-4 w-4" />
            Choose file
          </button>
        </div>
      )}

      {value && (
        <div className="flex items-center gap-2.5 rounded-xl border border-line bg-page/60 p-2">
          {preview ? (
            <img src={preview} alt="" className="h-12 w-12 shrink-0 rounded-lg border border-line object-cover" />
          ) : (
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-line bg-white text-grey-2">
              <FileText className="h-5 w-5" />
            </span>
          )}
          <div className="min-w-0 grow">
            <div className="truncate text-[13px] font-medium text-navy">{value.name}</div>
            <div className="text-[11.5px] text-grey-2">{Math.max(1, Math.round(value.size / 1024))} KB</div>
          </div>
          {!disabled && (
            <button
              type="button"
              onClick={() => onChange(null)}
              aria-label="Remove attachment"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-grey-2 transition hover:bg-white hover:text-ryg-red"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {/*
        `value = ""` after every pick, or choosing the SAME file twice in a row
        fires no change event at all and the second attempt silently does nothing.
      */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => { void take(e.target.files?.[0]); e.target.value = ""; }}
      />
      <input
        ref={filesRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => { void take(e.target.files?.[0]); e.target.value = ""; }}
      />
    </div>
  );
}
