import { Button } from "@hub/components/ui/button";
import { CLEAR_VIEWS, type ClearView } from "@hub/lib/clearStatus";

/**
 * All / Cleared / Uncleared, with counts — the view switch every clearable master carries (RC-12).
 *
 * Shared so the Red Mark master, the Red Mark report and (later) RC-13's disputed bills cannot
 * drift into three different defaults. Styled like the Muster Editor's own Toolbar buttons rather
 * than the portal's PillToggle: this lives inside `.hub-root`, which does not remap the portal's
 * navy/orange tokens, so a portal control would render in the wrong palette here.
 *
 * The counts are not decoration. A reader looking at an empty Uncleared list needs to see whether
 * that means "nothing outstanding" or "everything was cleared" without switching views to find out.
 */
export function ClearStatusToggle({ value, onChange, counts, className }: {
  value: ClearView;
  onChange: (v: ClearView) => void;
  counts: Record<ClearView, number>;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-1 ${className ?? ""}`}>
      {CLEAR_VIEWS.map((v) => (
        <Button
          key={v.value}
          size="sm"
          variant={value === v.value ? "default" : "outline"}
          className="h-8 rounded-button text-xs"
          aria-pressed={value === v.value}
          onClick={() => onChange(v.value)}
        >
          {v.label}
          <span className="ml-1.5 opacity-70">{counts[v.value]}</span>
        </Button>
      ))}
    </div>
  );
}
