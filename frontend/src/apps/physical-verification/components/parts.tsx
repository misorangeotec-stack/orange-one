import type { ReactNode } from "react";
import Card from "@/shared/components/ui/Card";
import { cn } from "@/shared/lib/cn";
import { fmtQty } from "../lib/stock";
import { PvNotInstalled, STATUS_LABEL, STATUS_TONE, type CountStatus } from "../lib/pv";

export function StatusPill({ status }: { status: CountStatus | null }) {
  if (!status) return <span className="text-[11.5px] text-grey-2">Not scheduled</span>;
  return (
    <span className={cn("inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold", STATUS_TONE[status])}>
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Physical − Closing: red when short, amber when extra, green when it matches. */
export function Diff({ value, unit }: { value: number | null; unit?: string | null }) {
  if (value === null) return <span className="text-grey-2">—</span>;
  const v = Math.round(value * 1000) / 1000;
  return (
    <span className={cn("font-semibold tabular-nums",
      v < 0 ? "text-ryg-red" : v > 0 ? "text-[#B7791F]" : "text-ryg-green")}>
      {v > 0 ? "+" : ""}{fmtQty(v)}{unit ? ` ${unit}` : ""}
      <span className="ml-1 text-[10.5px] font-medium">{v < 0 ? "short" : v > 0 ? "extra" : "matches"}</span>
    </span>
  );
}

/** Shown in place of the screens until the migration is applied. */
export function PvUnavailable({ error }: { error: unknown }) {
  return (
    <Card className="border-yellow/60 bg-yellow/10 p-4 text-[13px] text-ink">
      {error instanceof PvNotInstalled ? (
        <>
          <b>Physical Verification is not switched on yet.</b> Its database tables (migration
          <code className="mx-1">20270126120000_physical_verification.sql</code>) have not been applied.
          The item list and closing stock still show; dates and counts cannot be saved until then.
        </>
      ) : (
        <>Could not load the verification records: {(error as Error)?.message}</>
      )}
    </Card>
  );
}

export function PageHead({ kicker, title, sub, right }: { kicker: string; title: string; sub: ReactNode; right?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-orange">{kicker}</div>
        <h1 className="text-[22px] font-bold leading-tight text-navy">{title}</h1>
        <p className="mt-0.5 text-[12.5px] text-grey">{sub}</p>
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </header>
  );
}

export function Tile({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className="rounded-card border border-line bg-white px-4 py-2.5">
      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-grey">{label}</div>
      <div className={cn("text-[18px] font-bold tabular-nums text-navy", tone)}>{value}</div>
    </div>
  );
}

export const inputCls = "h-8 rounded-lg border border-line bg-white px-2.5 text-[12.5px] outline-none focus:border-orange";
export const thCls = "sticky top-0 z-10 whitespace-nowrap border-b border-line bg-page px-2.5 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-grey";
export const tdCls = "whitespace-nowrap border-b border-line/70 px-2.5 py-1.5 text-[12.5px] text-ink";
