import type { ReactNode, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes } from "react";
import { cn } from "@/shared/lib/cn";

const fieldBase =
  "w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-[14px] text-ink placeholder:text-grey-2 " +
  "outline-none transition focus:border-orange focus:ring-4 focus:ring-orange/10 disabled:bg-page disabled:text-grey-2";

export function FieldLabel({ label, required, hint, children }: { label: string; required?: boolean; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="flex items-center justify-between mb-1.5">
        <span className="text-[13px] font-medium text-navy">
          {label}
          {required && <span className="text-orange"> *</span>}
        </span>
        {hint && <span className="text-[11px] text-grey-2">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldBase, className)} {...props} />;
}

export function TextArea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(fieldBase, "resize-none", className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(fieldBase, "cursor-pointer appearance-none bg-no-repeat", className)} {...props}>
      {children}
    </select>
  );
}
