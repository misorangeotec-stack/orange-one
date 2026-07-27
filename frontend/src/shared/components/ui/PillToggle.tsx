import { cn } from "@/shared/lib/cn";

/**
 * Segmented pill toggle — the portal's standard "pick one of a few" control for
 * short, mutually exclusive option sets, where a dropdown would hide the choices
 * behind a click.
 *
 * Generalised out of ScopeToggle (This week / All time), which now renders this.
 * Any number of options; keep the labels short, since they all sit on one line.
 */
export default function PillToggle<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  className?: string;
}) {
  return (
    <div className={cn("inline-flex items-center rounded-pill bg-page border border-line p-0.5 text-[12px] font-semibold", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "px-3 py-1.5 rounded-pill transition whitespace-nowrap",
            value === o.value ? "bg-white text-navy shadow-sm" : "text-grey-2 hover:text-navy",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
