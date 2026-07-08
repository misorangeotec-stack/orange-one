import { useState } from "react";
import type { StageFieldDef } from "../types";
import { FieldLabel, TextInput, TextArea, Select } from "@/shared/components/ui/Form";
import Button from "@/shared/components/ui/Button";
import AttachmentLink from "./AttachmentLink";
import { cn } from "@/shared/lib/cn";

type Values = Record<string, string | number | null>;

/**
 * Renders a stage's field schema as a data-entry form. Number fields are coerced
 * on submit; required fields are validated. File fields upload through
 * `onUploadFile` (which returns the storage path to persist) before the values
 * are handed to `onSubmit`. Used inline on the active stage card and in TaskModal.
 */
export default function StageForm({
  fields,
  initial = {},
  submitLabel = "Complete stage",
  onSubmit,
  onCancel,
  onUploadFile,
}: {
  fields: StageFieldDef[];
  initial?: Values;
  submitLabel?: string;
  onSubmit: (values: Values) => void | Promise<void>;
  onCancel?: () => void;
  /** Uploads a file for `type: "file"` fields and returns the stored reference. */
  onUploadFile?: (file: File) => Promise<string>;
}) {
  const [vals, setVals] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const f of fields) {
      if (f.type === "file") continue; // files aren't free-text; handled separately
      const v = initial[f.key];
      seed[f.key] = v == null ? "" : String(v);
    }
    return seed;
  });
  // Newly-picked files, keyed by field key (uploaded on submit).
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (key: string, value: string) => setVals((p) => ({ ...p, [key]: value }));

  const submit = async () => {
    // Required-field validation (file fields are satisfied by a new pick or an existing upload).
    for (const f of fields) {
      if (!f.required) continue;
      if (f.type === "file") {
        const hasExisting = initial[f.key] != null && initial[f.key] !== "";
        if (!files[f.key] && !hasExisting) {
          setError(`${f.label} is required.`);
          return;
        }
      } else if (!vals[f.key]?.trim()) {
        setError(`${f.label} is required.`);
        return;
      }
    }

    setError(null);
    setBusy(true);
    try {
      const out: Values = {};
      for (const f of fields) {
        if (f.type === "file") {
          const picked = files[f.key];
          if (picked) {
            if (!onUploadFile) throw new Error("File upload isn’t available here.");
            out[f.key] = await onUploadFile(picked);
          } else {
            const existing = initial[f.key];
            out[f.key] = existing == null ? null : existing;
          }
        } else {
          const raw = vals[f.key] ?? "";
          out[f.key] = f.type === "number" ? (raw === "" ? null : Number(raw)) : raw;
        }
      }
      await onSubmit(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {fields.map((f) => (
          <div key={f.key} className={cn(!f.half && "sm:col-span-2")}>
            <FieldLabel label={f.label} required={f.required}>
              {f.type === "textarea" ? (
                <TextArea rows={2} value={vals[f.key]} placeholder={f.placeholder} onChange={(e) => set(f.key, e.target.value)} />
              ) : f.type === "select" ? (
                <Select value={vals[f.key]} onChange={(e) => set(f.key, e.target.value)}>
                  <option value="">Select…</option>
                  {(f.options ?? []).map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </Select>
              ) : f.type === "file" ? (
                <FileField
                  accept={f.accept}
                  file={files[f.key] ?? null}
                  existing={initial[f.key] == null ? null : String(initial[f.key])}
                  onPick={(file) => setFiles((p) => ({ ...p, [f.key]: file }))}
                />
              ) : (
                <TextInput
                  type={f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}
                  value={vals[f.key]}
                  placeholder={f.placeholder}
                  onChange={(e) => set(f.key, e.target.value)}
                />
              )}
            </FieldLabel>
          </div>
        ))}
      </div>

      {error && <p className="text-[12.5px] text-ryg-red font-medium">{error}</p>}

      <div className="flex items-center gap-2.5">
        <Button size="sm" onClick={submit} disabled={busy}>{busy ? "Saving…" : submitLabel}</Button>
        {onCancel && <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>}
      </div>
    </div>
  );
}

/** File picker for `type: "file"` fields: shows the picked file, or an existing upload to keep/replace. */
function FileField({
  accept,
  file,
  existing,
  onPick,
}: {
  accept?: string;
  file: File | null;
  existing: string | null;
  onPick: (file: File | null) => void;
}) {
  return (
    <div className="space-y-1.5">
      <input
        type="file"
        accept={accept}
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
        className="block w-full text-[13px] text-ink file:mr-3 file:rounded-lg file:border-0 file:bg-orange/10 file:px-3 file:py-1.5 file:text-[13px] file:font-medium file:text-orange hover:file:bg-orange/20 file:cursor-pointer"
      />
      {!file && existing && (
        <div className="flex items-center gap-2 text-[11.5px] text-grey-2">
          <span>Current:</span>
          <AttachmentLink value={existing} />
          <span>— choose a file to replace.</span>
        </div>
      )}
    </div>
  );
}
