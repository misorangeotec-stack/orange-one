import { useRef, useState } from "react";
import { mediaUrl, uploadMedia } from "../data/client";
import type { MediaInput } from "../data/mrWrites";

/**
 * Photos (or documents) of one machine, in order.
 *
 * Files go straight to the portal's storage as they are picked, under the
 * machine's folder; only their PATHS live in the form and, on Save, in the
 * database. Reorder by dragging, or with the arrow buttons for keyboard users.
 * For photos the first one is the cover the website shows on every card.
 *
 * Nothing is deleted from storage here: the form removes the files it dropped
 * only once a Save has gone through, so Cancel leaves the machine as it was.
 */
export default function MediaList({
  kind,
  items,
  onChange,
  folder,
  max,
  disabled,
  onUploaded,
}: {
  kind: "photo" | "document";
  items: MediaInput[];
  onChange: (next: MediaInput[]) => void;
  folder: string;
  max: number;
  disabled?: boolean;
  /** Paths uploaded in this sitting, so an abandoned form can clean them up. */
  onUploaded: (paths: string[]) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropHover, setDropHover] = useState(false);
  const isPhoto = kind === "photo";

  const add = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    setErr(null);
    const room = max - items.length;
    if (room <= 0) {
      setErr(`A machine can have up to ${max} ${isPhoto ? "photos" : "documents"}.`);
      return;
    }
    const take = list.slice(0, room);
    const done: MediaInput[] = [];
    const failed: string[] = [];
    for (let i = 0; i < take.length; i++) {
      const f = take[i];
      setBusy(`Uploading ${i + 1} of ${take.length}: ${f.name}`);
      try {
        if (isPhoto ? !f.type.startsWith("image/") : f.type !== "application/pdf") {
          throw new Error(`"${f.name}" is not ${isPhoto ? "a photo" : "a PDF"}.`);
        }
        const path = await uploadMedia(f, folder);
        done.push({ storagePath: path, fileName: f.name });
      } catch (e) {
        failed.push(e instanceof Error ? e.message : String(e));
      }
    }
    setBusy(null);
    if (done.length) {
      onUploaded(done.map((d) => d.storagePath));
      onChange([...items, ...done]);
    }
    const msgs = [...failed];
    if (list.length > take.length) msgs.push(`Only ${max} are allowed, so ${list.length - take.length} were left out.`);
    if (msgs.length) setErr(msgs.join(" "));
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return;
    const next = [...items];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    onChange(next);
  };

  return (
    <div>
      {items.length > 0 && (
        <ul className={isPhoto ? "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" : "space-y-2"}>
          {items.map((it, i) => (
            <li
              key={it.storagePath}
              draggable={!disabled}
              onDragStart={(e) => {
                setDragFrom(i);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => setDragFrom(null)}
              onDragOver={(e) => {
                if (dragFrom !== null) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragFrom !== null) move(dragFrom, i);
                setDragFrom(null);
              }}
              className={`relative rounded-xl border bg-white ${dragFrom === i ? "opacity-50" : ""} ${
                isPhoto && i === 0 ? "border-orange" : "border-line"
              } ${disabled ? "" : "cursor-grab"}`}
            >
              {isPhoto ? (
                <>
                  <img src={mediaUrl(it.storagePath) ?? ""} alt={it.fileName ?? ""} className="h-28 w-full rounded-t-xl object-cover" />
                  {i === 0 && (
                    <span className="absolute left-2 top-2 rounded-full bg-orange px-2 py-0.5 text-[11px] font-bold text-white">Cover</span>
                  )}
                </>
              ) : (
                <a
                  href={mediaUrl(it.storagePath) ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate px-3 py-2 text-[13px] font-medium text-navy hover:underline"
                >
                  {it.fileName ?? "Document"}
                </a>
              )}
              {!disabled && (
                <div className={`flex items-center justify-between gap-1 px-2 py-1.5 ${isPhoto ? "" : "border-t border-line"}`}>
                  <span className="flex gap-1">
                    <button
                      type="button"
                      className="rounded-md border border-line px-1.5 text-[12px] text-grey hover:text-navy disabled:opacity-40"
                      disabled={i === 0}
                      onClick={() => move(i, i - 1)}
                      aria-label={`Move ${it.fileName ?? "file"} earlier`}
                    >
                      {isPhoto ? "←" : "↑"}
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-line px-1.5 text-[12px] text-grey hover:text-navy disabled:opacity-40"
                      disabled={i === items.length - 1}
                      onClick={() => move(i, i + 1)}
                      aria-label={`Move ${it.fileName ?? "file"} later`}
                    >
                      {isPhoto ? "→" : "↓"}
                    </button>
                  </span>
                  <button
                    type="button"
                    className="text-[12px] font-medium text-ryg-red hover:underline"
                    onClick={() => onChange(items.filter((_, j) => j !== i))}
                  >
                    Remove
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {!disabled && items.length < max && (
        <div
          onDragOver={(e) => {
            if (dragFrom === null) {
              e.preventDefault();
              setDropHover(true);
            }
          }}
          onDragLeave={() => setDropHover(false)}
          onDrop={(e) => {
            if (dragFrom !== null) return;
            e.preventDefault();
            setDropHover(false);
            void add(e.dataTransfer.files);
          }}
          className={`mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-dashed px-4 py-3 ${
            dropHover ? "border-orange bg-orange/5" : "border-line bg-page"
          }`}
        >
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => fileRef.current?.click()}
            className="rounded-lg border border-line bg-white px-3 py-1.5 text-[13px] font-semibold text-navy hover:border-orange disabled:opacity-50"
          >
            {isPhoto ? "Add photos" : "Add PDF"}
          </button>
          <span className="text-[12.5px] text-grey-2">
            {busy ??
              (isPhoto
                ? `or drop them here. JPG, PNG or WebP, up to ${max}. Drag to reorder; the first is the cover.`
                : `or drop it here. PDF only, up to 15 MB each, up to ${max}.`)}
          </span>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={isPhoto ? "image/jpeg,image/png,image/webp,image/avif" : "application/pdf"}
            className="hidden"
            onChange={(e) => {
              const fl = e.target.files;
              if (fl) void add(fl);
              e.target.value = "";
            }}
          />
        </div>
      )}
      {err && <p className="mt-2 text-[12.5px] text-ryg-red">{err}</p>}
    </div>
  );
}
