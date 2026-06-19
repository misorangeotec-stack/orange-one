import type { ReactNode } from "react";
import { Link } from "react-router-dom";
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

/** Compact KPI card matching the landing dashboard stat tiles. */
export default function StatCard({
  label,
  value,
  icon,
  tone = "orange",
  hint,
  to,
}: {
  label: string;
  value: number | string;
  icon: ReactNode;
  tone?: Tone;
  hint?: string;
  /** When set, the whole card links to a filtered task list. */
  to?: string;
}) {
  const card = (
    <Card className={cn("p-4 h-full", to && "transition hover:border-orange/50 hover:shadow-card")}>
      <div className="flex items-start justify-between">
        <span className="text-[12px] text-grey font-medium">{label}</span>
        <span className={`w-8 h-8 rounded-[10px] flex items-center justify-center ${TONES[tone]} [&>svg]:w-[16px] [&>svg]:h-[16px]`}>
          {icon}
        </span>
      </div>
      <div className="text-[28px] font-bold text-navy leading-none mt-3">{value}</div>
      {hint && <div className="text-[11px] text-grey-2 mt-2">{hint}</div>}
    </Card>
  );
  return to ? <Link to={to} className="block h-full" title={`View ${label.toLowerCase()}`}>{card}</Link> : card;
}
