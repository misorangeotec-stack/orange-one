import { useMrStore } from "../store";

/**
 * Whether one field of THIS machine shows on the website.
 *
 * Three states, cycled by one small button: follow the field's default (set on
 * Field visibility), always show, always hide. A locked field (title, photos,
 * seller, salesperson, internal notes, ...) shows its fixed state and has no button:
 * the portal ignores an override on it anyway.
 *
 * Sits BESIDE a field's label, never inside it: a <label> forwards clicks to its
 * first button, so a click on the field's name would flip the switch. `FormField`'s
 * `aside` slot puts it there.
 */
export default function VisibilityControl({
  fieldKey,
  overrides,
  onChange,
  disabled,
}: {
  fieldKey: string;
  overrides: Record<string, boolean>;
  onChange: (next: Record<string, boolean>) => void;
  disabled?: boolean;
}) {
  const s = useMrStore();
  const f = s.fieldByKey(fieldKey);
  if (!f) return null;

  if (f.locked) {
    return (
      <span
        className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-[#EEF1F6] px-2 py-0.5 text-[11px] font-medium text-grey"
        title="Fixed for every machine. It cannot be changed."
      >
        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
        {f.defaultVisible ? "Always on website" : "Never on website"}
      </span>
    );
  }

  const has = Object.prototype.hasOwnProperty.call(overrides, fieldKey);
  const shown = has ? overrides[fieldKey] : f.defaultVisible;
  const text = has
    ? shown
      ? "On website"
      : "Hidden on website"
    : `${f.defaultVisible ? "On website" : "Hidden on website"} (default)`;

  const cycle = () => {
    const next = { ...overrides };
    if (!has) next[fieldKey] = !f.defaultVisible; // default -> the opposite of the default
    else if (overrides[fieldKey] !== f.defaultVisible) next[fieldKey] = f.defaultVisible; // -> explicitly the default value
    else delete next[fieldKey]; // -> back to following the default
    onChange(next);
  };

  return (
    // A <span role="button">, not a <button>, and off the Tab path, so a keyboard run is one
    // stop per field: Alt+V on the focused field flips it instead (the form's key handler
    // clicks this). Not a <button> because the shared advanceFocus() skips disabled buttons
    // but not tabIndex -1 ones, so after every pick the caret landed HERE, on the switch,
    // instead of on the next field (found by the keyboard audit, 14-10-2026).
    <span
      role="button"
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : cycle}
      tabIndex={-1}
      data-vis-toggle=""
      title="Whether this field shows on the website for this machine. Click, or press Alt+V in the field."
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium transition ${
        shown ? "border-[#BFE3CB] bg-[#F0FAF3] text-[#1E7B3C]" : "border-line bg-[#F6F7FA] text-grey"
      } ${has ? "ring-1 ring-orange/40" : ""} ${disabled ? "cursor-default" : "cursor-pointer"} select-none`}
    >
      {shown ? (
        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
      ) : (
        <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M3 3l18 18" /><path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" /></svg>
      )}
      {text}
    </span>
  );
}
