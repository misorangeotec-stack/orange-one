import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/shared/lib/cn";

type Variant = "primary" | "ghost" | "outline";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const base =
  "relative inline-flex items-center justify-center gap-2 font-semibold rounded-xl font-sans " +
  "transition-[transform,box-shadow,background,color,border-color] duration-200 cursor-pointer " +
  "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 select-none";

const variants: Record<Variant, string> = {
  primary:
    "bg-orange-grad text-white shadow-cta hover:-translate-y-0.5 hover:shadow-[0_22px_38px_-14px_rgba(255,106,31,.65)]",
  ghost:
    "bg-white text-navy border border-line shadow-soft hover:-translate-y-0.5 hover:border-[#d9e2f0]",
  outline:
    "bg-white text-orange border-[1.6px] border-orange hover:bg-orange hover:text-white hover:shadow-cta",
};

const sizes: Record<Size, string> = {
  sm: "text-sm px-4 py-2.5",
  md: "text-[15px] px-5 py-3",
  lg: "text-[15px] px-7 py-[15px]",
};

/** App-wide button, styled to the Orange One landing buttons (.btn / .btn-outline). */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", className, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(base, variants[variant], sizes[size], className)}
      {...props}
    />
  )
);
Button.displayName = "Button";

export default Button;
