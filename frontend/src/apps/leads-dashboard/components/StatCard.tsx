import type { ReactNode } from "react";
import Card from "@/shared/components/ui/Card";
import { cn } from "@/shared/lib/cn";

type Tone = "orange" | "blue" | "green" | "violet" | "rose";

const TONES: Record<Tone, string> = {
  orange: "bg-orange-soft text-orange",
  blue: "bg-[#EAF1FE] text-blue",
  green: "bg-[#E8F8EF] text-[#27AE60]",
  violet: "bg-[#F0ECFE] text-[#7C5CFC]",
  rose: "bg-[#FDE9F1] text-[#F43F8E]",
};

/** Compact KPI tile (matches the portal dashboard stat cards). */
export default function StatCard({
  label,
  value,
  icon,
  tone = "orange",
  hint,
}: {
  label: string;
  value: number | string;
  icon: ReactNode;
  tone?: Tone;
  hint?: string;
}) {
  return (
    <Card className="p-4 h-full">
      <div className="flex items-start justify-between">
        <span className="text-[12px] text-grey font-medium">{label}</span>
        <span className={cn("w-8 h-8 rounded-[10px] flex items-center justify-center [&>svg]:w-[16px] [&>svg]:h-[16px]", TONES[tone])}>
          {icon}
        </span>
      </div>
      <div className="text-[28px] font-bold text-navy leading-none mt-3">{value}</div>
      {hint && <div className="text-[11px] text-grey-2 mt-2">{hint}</div>}
    </Card>
  );
}
