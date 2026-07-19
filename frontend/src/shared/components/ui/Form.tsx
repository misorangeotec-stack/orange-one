import { forwardRef, useState } from "react";
import type { ReactNode, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/shared/lib/cn";

const fieldBase =
  "w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-[14px] text-ink placeholder:text-grey-2 " +
  "outline-none transition focus:border-orange focus:ring-4 focus:ring-orange/10 disabled:bg-page disabled:text-grey-2";

export function FieldLabel({ label, required, hint, children }: { label: string; required?: boolean; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      {/* Baseline-aligned with the label pinned: a hint long enough to wrap used to
          vertically re-centre the label and collide with it. */}
      <span className="flex items-baseline justify-between gap-3 mb-1.5">
        <span className="text-[13px] font-medium text-navy shrink-0">
          {label}
          {required && <span className="text-orange"> *</span>}
        </span>
        {hint && <span className="text-[11px] text-grey-2 text-right leading-snug min-w-0">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

/** forwardRef so a parent can drive focus — LineGrid moves the caret cell to cell. */
export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function TextInput({ className, ...props }, ref) {
    return <input ref={ref} className={cn(fieldBase, className)} {...props} />;
  }
);

/** Password field with a show/hide toggle. Pass the same props as TextInput (minus `type`). */
export function PasswordInput({ className, type: _type, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input type={show ? "text" : "password"} className={cn(fieldBase, "pr-10", className)} {...props} />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide password" : "Show password"}
        title={show ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 flex items-center pr-3 text-grey-2 hover:text-orange transition"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function TextArea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(fieldBase, "resize-none", className)} {...props} />;
  }
);

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(fieldBase, "cursor-pointer appearance-none bg-no-repeat", className)} {...props}>
      {children}
    </select>
  );
}
