import { Fragment, useEffect, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@hub/components/ui/popover";
import { Button } from "@hub/components/ui/button";
import { Checkbox } from "@hub/components/ui/checkbox";
import { SlidersHorizontal, Check, Loader2 } from "lucide-react";

export interface ColumnOption {
  key: string;
  label: string;
  /** One line on what the column means — shown under the label in the picker. */
  help?: string;
  /**
   * Groups this option under a small heading, printed once above the first option that carries it.
   * For a table whose columns break a total down (Received = On Account + Against Invoices), a flat
   * list of twenty tick-boxes hides that relationship entirely.
   */
  section?: string;
  /** A breakup OF its section's total, rather than a peer of it. Indented, with a left rule. */
  sub?: boolean;
  /**
   * Not available in the current context — listed, but un-tickable, with `help` carrying the reason.
   *
   * Silently dropping such a column from the list reads as a bug ("where did Planned go?"), and the
   * report's own explanation of why it vanished usually lived on the table header that the picker
   * has just taken over. So the row stays, greyed, and answers the question where it gets asked.
   */
  disabled?: boolean;
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
    if (columns.find((c) => c.key === key)?.disabled) return;
    if (visible.includes(key)) {
      if (visible.length <= 1) return; // never hide the last column
      onChange(visible.filter((k) => k !== key));
    } else {
      onChange([...visible, key]);
    }
  };

  /** "Show all" means every column you could actually have — a disabled one is not on offer. */
  const showAll = () => onChange(columns.filter((c) => !c.disabled).map((c) => c.key));
  const offered = columns.filter((c) => !c.disabled).length;

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
          Columns ({visible.length}/{offered})
        </Button>
      </PopoverTrigger>
      {/* Two panes, not one scrolling box. The list scrolls; "Show all" and the save footer are
          PINNED. They used to sit at the bottom of the scroll, which was survivable when a row was
          one line — then each column gained a description, the list grew past the height cap, and
          the Save button silently ended up a few hundred pixels below the fold with nothing on
          screen suggesting it was there. A control you have to scroll a popover to discover is a
          control that does not exist. */}
      <PopoverContent className={`p-0 ${columns.some((c) => c.help) ? "w-72" : "w-52"}`} align="end">
        <div className="flex flex-col max-h-[70vh]">
        <div className="min-h-0 flex-1 overflow-y-auto p-2 space-y-1">
          {columns.map((col, i) => {
            const checked = visible.includes(col.key);
            const isLast = checked && visible.length <= 1;
            const off = col.disabled || isLast;
            // The heading prints once, on the first option of its run. Columns of one section are
            // expected to be adjacent in the array — that is also their order in the table.
            const heading = col.section && col.section !== columns[i - 1]?.section ? col.section : null;
            return (
              <Fragment key={col.key}>
                {heading && (
                  <div className="px-2 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
                    {heading}
                  </div>
                )}
                <label
                  className={`flex items-start gap-2 px-2 py-1.5 rounded-md text-sm select-none ${col.sub ? "ml-2 pl-2 border-l border-border" : ""} ${off ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:bg-muted/60"}`}
                  title={col.disabled ? col.help : undefined}
                >
                  <Checkbox
                    className="mt-0.5"
                    checked={checked && !col.disabled}
                    disabled={off}
                    onCheckedChange={() => toggle(col.key)}
                  />
                  <span className="min-w-0">
                    <span className="block truncate">{col.label}</span>
                    {col.help && (
                      <span className="block text-[10px] leading-snug text-muted-foreground">{col.help}</span>
                    )}
                  </span>
                </label>
              </Fragment>
            );
          })}
        </div>

        {/* Pinned footer */}
        <div className="shrink-0 border-t border-border bg-popover p-2 space-y-1.5 rounded-b-md">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">
              {visible.length} of {offered} shown
            </span>
            <button
              className="text-xs text-muted-foreground hover:text-foreground rounded-md px-1.5 py-0.5 hover:bg-muted/60"
              onClick={showAll}
            >
              Show all
            </button>
          </div>

          {onSave && (
            <>
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
              <p className="text-[10px] leading-snug text-muted-foreground">
                {hasSaved
                  ? "Saved. This report opens on your columns, on any device."
                  : "Your choice is not kept until you save it."}
              </p>
              {saveError && (
                <p className="text-[10px] leading-snug text-destructive">
                  Couldn’t save: {saveError}
                </p>
              )}
            </>
          )}
        </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
