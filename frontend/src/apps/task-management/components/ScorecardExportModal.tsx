import { useEffect, useState } from "react";
import Modal from "@/shared/components/ui/Modal";
import Button from "@/shared/components/ui/Button";
import { cn } from "@/shared/lib/cn";
import { formatDate, weekEndOf } from "@/shared/lib/time";

export type ExportScope = "one" | "all";

/**
 * Asks who the Weekly Scorecard export should cover before building the workbook.
 *
 * "All" is the default: exporting the whole team is the reason this exists — a
 * manager comparing people, rather than opening the scorecard once per person.
 *
 * The caller skips this dialog entirely when the viewer can only ever see
 * themselves, since "one or all?" has no answer worth asking there.
 */
export default function ScorecardExportModal({
  open,
  onClose,
  selectedName,
  poolCount,
  weekStart,
  onExport,
}: {
  open: boolean;
  onClose: () => void;
  /** The person currently chosen in the team-member dropdown. */
  selectedName: string;
  /** How many people this viewer is allowed to export. */
  poolCount: number;
  weekStart: string;
  onExport: (scope: ExportScope) => void;
}) {
  const [scope, setScope] = useState<ExportScope>("all");

  // Reset on each open, so a previous choice never silently carries over.
  useEffect(() => {
    if (open) setScope("all");
  }, [open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Export weekly scorecard"
      subtitle={`Week of ${formatDate(weekStart)} – ${formatDate(weekEndOf(weekStart))}`}
      size="md"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => {
              onExport(scope);
              onClose();
            }}
          >
            Export
          </Button>
        </>
      }
    >
      <div className="space-y-2.5 pb-1">
        <ScopeOption
          checked={scope === "all"}
          onSelect={() => setScope("all")}
          label={`All ${poolCount} team member${poolCount === 1 ? "" : "s"}`}
          hint="One row per person, so you can compare the whole team at a glance."
        />
        <ScopeOption
          checked={scope === "one"}
          onSelect={() => setScope("one")}
          label={`Only ${selectedName}`}
          hint="The same columns, for this one person."
        />
      </div>
    </Modal>
  );
}

function ScopeOption({
  checked,
  onSelect,
  label,
  hint,
}: {
  checked: boolean;
  onSelect: () => void;
  label: string;
  hint: string;
}) {
  return (
    <label
      className={cn(
        "flex items-start gap-3 rounded-xl border p-3.5 cursor-pointer transition",
        checked ? "border-orange bg-orange/[0.04] ring-4 ring-orange/10" : "border-line hover:border-[#d9e2f0]"
      )}
    >
      <input
        type="radio"
        name="scorecard-export-scope"
        checked={checked}
        onChange={onSelect}
        className="mt-0.5 h-4 w-4 accent-orange cursor-pointer shrink-0"
      />
      <span className="min-w-0">
        <span className="block text-[13.5px] font-semibold text-navy">{label}</span>
        <span className="block mt-0.5 text-[12px] text-grey-2 leading-relaxed">{hint}</span>
      </span>
    </label>
  );
}
