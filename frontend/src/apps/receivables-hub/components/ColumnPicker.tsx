import { useEffect, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@hub/components/ui/popover";
import { Button } from "@hub/components/ui/button";
import { Checkbox } from "@hub/components/ui/checkbox";
import { SlidersHorizontal, Check, Loader2 } from "lucide-react";

export interface ColumnOption {
  key: string;
  label: string;
  /** One line on what the column means — shown under the label in the picker. */
  help?: string;
}

interface Props {
  columns: ColumnOption[];
  /** Keys currently shown. Empty/last-one is guarded so at least one stays visible. */
  visible: string[];
  onChange: (visible: string[]) => void;
  triggerClassName?: string;
  /**
   * Persist the current selection as this user's layout for this report. Supplying this turns
   * on the save footer; leave it out and the picker behaves exactly as it always has.
   */
  onSave?: (visible: string[]) => Promise<void>;
  /** Forget the saved layout and go back to the report's shipped default. */
  onResetSaved?: () => Promise<void>;
  /** True when a layout is already saved — enables "Reset to default". */
  hasSaved?: boolean;
  /** A write is in flight. */
  saving?: boolean;
  /** Last write failure, shown in the footer so a silent failure can't look like a save. */
  saveError?: string | null;
}

/** Column chooser — toggle which table columns are shown (and exported). */
export function ColumnPicker({
  columns, visible, onChange, triggerClassName,
  onSave, onResetSaved, hasSaved, saving, saveError,
}: Props) {
  // "Saved" is a moment, not a state — it confirms the click and then gets out of the way.
  const [justSaved, setJustSaved] = useState(false);
  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(false), 2000);
    return () => clearTimeout(t);
  }, [justSaved]);
  // A new selection is unsaved again, so the tick must not linger over it.
  useEffect(() => { setJustSaved(false); }, [visible]);

  const toggle = (key: string) => {
    if (visible.includes(key)) {
      if (visible.length <= 1) return; // never hide the last column
      onChange(visible.filter((k) => k !== key));
    } else {
      onChange([...visible, key]);
    }
  };

  const run = (fn?: (() => Promise<void>)) => {
    if (!fn) return;
    fn().then(() => setJustSaved(true), () => { /* surfaced via saveError */ });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={`rounded-button border-border font-normal ${triggerClassName ?? "h-8 text-xs"}`}
        >
          <SlidersHorizontal className="h-3.5 w-3.5 mr-1.5" />
          Columns ({visible.length}/{columns.length})
        </Button>
      </PopoverTrigger>
      <PopoverContent className={`p-2 max-h-96 overflow-y-auto ${columns.some((c) => c.help) ? "w-72" : "w-52"}`} align="end">
        <div className="space-y-1">
          {columns.map((col) => {
            const checked = visible.includes(col.key);
            const isLast = checked && visible.length <= 1;
            return (
              <label
                key={col.key}
                className={`flex items-start gap-2 px-2 py-1.5 rounded-md text-sm select-none ${isLast ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-muted/60"}`}
              >
                <Checkbox className="mt-0.5" checked={checked} disabled={isLast} onCheckedChange={() => toggle(col.key)} />
                <span className="min-w-0">
                  <span className="block truncate">{col.label}</span>
                  {col.help && (
                    <span className="block text-[10px] leading-snug text-muted-foreground">{col.help}</span>
                  )}
                </span>
              </label>
            );
          })}
          <div className="border-t border-border my-1" />
          <button
            className="w-full text-left px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground rounded-md hover:bg-muted/60"
            onClick={() => onChange(columns.map((c) => c.key))}
          >
            Show all
          </button>

          {onSave && (
            <>
              <div className="border-t border-border my-1" />
              <div className="px-2 pt-0.5 pb-1 space-y-1.5">
                <p className="text-[10px] leading-snug text-muted-foreground">
                  Save this layout and the report will open on it for you, on any device.
                </p>
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    disabled={saving}
                    onClick={() => run(() => onSave(visible))}
                    className="h-7 flex-1 text-xs rounded-button bg-primary hover:bg-primary-hover text-primary-foreground"
                  >
                    {saving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      : justSaved ? <Check className="h-3 w-3 mr-1" /> : null}
                    {justSaved && !saving ? "Saved" : "Save my view"}
                  </Button>
                  {hasSaved && onResetSaved && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={saving}
                      onClick={() => run(onResetSaved)}
                      className="h-7 text-xs rounded-button border-border"
                      title="Forget my saved layout and go back to the report's default columns"
                    >
                      Reset
                    </Button>
                  )}
                </div>
                {saveError && (
                  <p className="text-[10px] leading-snug text-destructive">
                    Couldn’t save: {saveError}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
