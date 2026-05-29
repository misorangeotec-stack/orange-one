import type { HTMLAttributes } from "react";
import { cn } from "@/shared/lib/cn";

/** White surface card matching the landing's .box / panel styling. */
export default function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("bg-white border border-line rounded-card shadow-soft", className)} {...props} />;
}
