/**
 * A labelled checkbox with a hint underneath — the shape every settings screen
 * in Admin uses for an on/off switch.
 *
 * Lives here rather than inside one settings page because two pages now render
 * it (Master Report and the personal snapshot, which share a route), and having
 * one import the other created a module cycle. Not named `Toggle`: `PillToggle`
 * already exists in this folder and is a different control — a segmented pill,
 * not a switch.
 */
export default function SettingToggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-start gap-3 ${disabled ? "opacity-60" : "cursor-pointer"}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 accent-orange"
      />
      <span>
        <span className="block text-[14px] font-semibold text-navy">{label}</span>
        {hint && <span className="mt-0.5 block text-[12.5px] leading-snug text-grey-2">{hint}</span>}
      </span>
    </label>
  );
}
