import { Plus, X } from "lucide-react";
import { Button } from "@hub/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@hub/components/ui/select";

/** A group-by preset (quick "View" button). */
export interface GroupByPreset<D extends string> {
  label: string;
  dims: D[];
}

interface GroupByBuilderProps<D extends string> {
  /** Available dimensions, in the order they should be offered. */
  dimensions: { key: D; label: string }[];
  /** Quick presets shown as "View" buttons. */
  presets: GroupByPreset<D>[];
  /** Current ordered group-by dimensions. */
  value: D[];
  onChange: (dims: D[]) => void;
}

/**
 * The Aging Report's "Group by" builder, generalised so every report can offer the
 * same flexible multi-level roll-up: a row of quick "View" presets plus a row of
 * nestable dimension dropdowns (add / remove / reorder-by-replacement). No dimension
 * can appear at two levels at once.
 */
export function GroupByBuilder<D extends string>({
  dimensions, presets, value, onChange,
}: GroupByBuilderProps<D>) {
  const labelOf = (d: D) => dimensions.find((x) => x.key === d)?.label ?? d;
  const order = dimensions.map((d) => d.key);

  const setLevel = (i: number, dim: D) => {
    const next = [...value];
    next[i] = dim;
    onChange(next.filter((d, idx) => idx === i || d !== dim));
  };
  const addLevel = () => {
    const used = new Set(value);
    const avail = order.find((d) => !used.has(d));
    if (avail) onChange([...value, avail]);
  };
  const removeLevel = (i: number) => {
    if (value.length <= 1) return;
    onChange(value.filter((_, idx) => idx !== i));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">View</span>
        {presets.map((p) => {
          const active = JSON.stringify(p.dims) === JSON.stringify(value);
          return (
            <Button
              key={p.label}
              variant={active ? "default" : "outline"}
              size="sm"
              onClick={() => onChange(p.dims)}
              className={`h-7 text-xs rounded-button ${active ? "bg-primary text-primary-foreground" : "border-border"}`}
            >
              {p.label}
            </Button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Group by</span>
        {value.map((dim, i) => {
          const used = new Set(value.filter((_, idx) => idx !== i));
          const opts = order.filter((d) => d === dim || !used.has(d));
          return (
            <div key={i} className="flex items-center gap-1">
              {i > 0 && <span className="text-muted-foreground text-xs">→</span>}
              <Select value={dim} onValueChange={(v) => setLevel(i, v as D)}>
                <SelectTrigger className="h-8 w-40 rounded-input border-border text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {opts.map((d) => (
                    <SelectItem key={d} value={d}>{labelOf(d)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {value.length > 1 && (
                <button onClick={() => removeLevel(i)} className="text-muted-foreground hover:text-destructive" title="Remove level">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          );
        })}
        {value.length < order.length && (
          <Button variant="ghost" size="sm" onClick={addLevel} className="h-7 text-xs text-muted-foreground">
            <Plus className="h-3.5 w-3.5 mr-1" /> Add level
          </Button>
        )}
      </div>
    </div>
  );
}
