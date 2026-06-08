import { useState } from "react";
import type { StageFieldDef } from "../types";
import { FieldLabel, TextInput, TextArea, Select } from "@/shared/components/ui/Form";
import Button from "@/shared/components/ui/Button";
import { cn } from "@/shared/lib/cn";

type Values = Record<string, string | number | null>;

/**
 * Renders a stage's field schema as a data-entry form. Number fields are coerced
 * on submit; required fields are validated. Used inline on the active stage card.
 */
export default function StageForm({
  fields,
  initial = {},
  submitLabel = "Complete stage",
  onSubmit,
  onCancel,
}: {
  fields: StageFieldDef[];
  initial?: Values;
  submitLabel?: string;
  onSubmit: (values: Values) => void;
  onCancel?: () => void;
}) {
  const [vals, setVals] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const f of fields) {
      const v = initial[f.key];
      seed[f.key] = v == null ? "" : String(v);
    }
    return seed;
  });
  const [error, setError] = useState<string | null>(null);

  const set = (key: string, value: string) => setVals((p) => ({ ...p, [key]: value }));

  const submit = () => {
    const missing = fields.find((f) => f.required && !vals[f.key]?.trim());
    if (missing) {
      setError(`${missing.label} is required.`);
      return;
    }
    const out: Values = {};
    for (const f of fields) {
      const raw = vals[f.key] ?? "";
      out[f.key] = f.type === "number" ? (raw === "" ? null : Number(raw)) : raw;
    }
    setError(null);
    onSubmit(out);
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
        <Button size="sm" onClick={submit}>{submitLabel}</Button>
        {onCancel && <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>}
      </div>
    </div>
  );
}
