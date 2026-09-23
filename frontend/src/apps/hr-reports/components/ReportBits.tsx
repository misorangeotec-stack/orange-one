/**
 * The pieces the rendered Weekly Review Report is built from (KPI-3, read-only).
 *
 * The form is a printed page of labelled boxes, so the screen is too: a section bar, a
 * block bar, and a box that carries its own label, the form's own target wording, the
 * value, and — where the hub cannot produce one — the reason and an input.
 *
 * ── Every box wears its band, and that is the whole design ────────────────────
 * A weekly report where a live figure and a typed guess look identical is worse than no
 * report: it is a document that cannot be audited. So the band badge is not decoration
 * on this page, it is the load-bearing element. A reader must be able to point at any
 * number and be told, without asking, whether the hub knows it or somebody typed it.
 *
 * ⚠ `cn` here does NOT merge Tailwind classes — a `w-*` handed to a box that already
 *   carries `w-full` loses. Widths go on the wrapper, never through `className`.
 */
import type { ReactNode } from "react";
import { cn } from "@/shared/lib/cn";
import type { FieldCoverage } from "../report/types";
import { BAND_BADGE } from "./FieldMeter";

/** The dark bar the form uses for "Section A — Talent Acquisition". */
export function SectionBar({ code, title, note }: { code: string; title: string; note: string }) {
  return (
    <div className="mt-6 rounded-t-lg bg-navy px-4 py-2.5">
      <h2 className="text-[14px] font-bold tracking-wide text-white">{title}</h2>
      <p className="mt-0.5 text-[11.5px] leading-snug text-white/70">{note}</p>
      <span className="sr-only">Section {code}</span>
    </div>
  );
}

/** The lighter bar the form uses for "A1 · Key Performance Snapshot". */
export function BlockBar({ title, note, right }: { title: string; note?: string; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line bg-page px-4 py-2">
      <div className="min-w-0">
        <h3 className="text-[12.5px] font-semibold text-navy">{title}</h3>
        {note && <p className="mt-0.5 text-[11px] leading-snug text-grey-2">{note}</p>}
      </div>
      {right}
    </div>
  );
}

export function BandBadge({ band }: { band: FieldCoverage }) {
  const b = BAND_BADGE[band];
  return (
    <span className={cn("inline-block whitespace-nowrap rounded border px-1.5 py-[1px] text-[10.5px] font-medium", b.cls)}>
      {b.label}
    </span>
  );
}

/**
 * A ring on a box whose band is the one the reader clicked on the meter, and a step
 * back for the rest. Chosen over hiding them: the form is the point of this page, and a
 * form with boxes missing is not the form.
 */
export const bandFocus = (band: FieldCoverage, selected: FieldCoverage | null): string =>
  selected === null ? "" : selected === band ? "ring-2 ring-orange ring-offset-1" : "opacity-45";

/**
 * One box of the form.
 *
 * `value` is what the hub read. `children` is anything extra the box needs — an input
 * for a band that cannot be filled, or a second figure beside the first.
 */
export function Box({
  code,
  label,
  target,
  band,
  value,
  caveat,
  gap,
  selected,
  children,
  big,
}: {
  code: string;
  label: string;
  target?: string;
  band: FieldCoverage;
  /** The figure, already formatted. Undefined for a box the hub cannot fill. */
  value?: ReactNode;
  /** The one thing a reader has to know about a `live-partial` figure. */
  caveat?: string;
  /** Why the box is empty, for `empty-table` and `no-table`. */
  gap?: string;
  selected: FieldCoverage | null;
  children?: ReactNode;
  /** A snapshot tile, rather than a line in a block. */
  big?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-line bg-white p-3 transition-opacity",
        band === "no-table" && "border-dashed",
        bandFocus(band, selected),
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11.5px] font-semibold leading-snug text-navy">{label}</div>
          {target && <div className="mt-0.5 text-[10.5px] leading-snug text-grey-2">{target}</div>}
        </div>
        <BandBadge band={band} />
      </div>

      {value !== undefined && (
        <div className={cn("mt-2 tabular-nums leading-none text-navy", big ? "text-[26px] font-bold" : "text-[18px] font-semibold")}>
          {value}
        </div>
      )}

      {caveat && <p className="mt-1.5 text-[10.5px] leading-snug text-[#4e7a1f]">{caveat}</p>}
      {gap && <p className="mt-1.5 text-[10.5px] leading-snug text-grey">{gap}</p>}
      {children && <div className="mt-2">{children}</div>}
      <span className="sr-only">Box {code}</span>
    </div>
  );
}

/**
 * The one editable control on this page.
 *
 * Nothing typed here is ever written to the database (report/notes.ts). It exists so
 * the form can be walked through end to end in a meeting — and so that a box somebody
 * fills by hand still, visibly, wears the band that says the hub could not fill it.
 */
export function NoteInput({
  value,
  onChange,
  placeholder,
  rows = 1,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  label: string;
}) {
  const shared =
    "w-full rounded border border-orange/50 bg-orange/[0.04] px-2 py-1 text-[12px] text-navy outline-none placeholder:text-grey-2 focus:border-orange focus:ring-1 focus:ring-orange/30";
  if (rows > 1) {
    return (
      <textarea
        aria-label={label}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={cn(shared, "resize-y leading-relaxed")}
      />
    );
  }
  return (
    <input
      type="text"
      aria-label={label}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={shared}
    />
  );
}

/**
 * A figure against one of the form's own benchmarks, with the shortfall said out loud.
 *
 * "12 sourced" against a benchmark of 15 is a number a reader has to do arithmetic on;
 * "3 short of 15 sourced" is the finding itself. The met case says so and stops, rather
 * than printing an overshoot nobody asked about.
 */
export function VsBenchmark({ actual, target, unit }: { actual: number; target: number; unit?: string }) {
  const ok = actual >= target;
  const short = target - actual;
  return (
    <span className={cn("whitespace-nowrap text-[11px] font-medium", ok ? "text-[#1f8a4d]" : "text-[#c0392b]")}>
      {ok ? `met ${target}` : `${short % 1 === 0 ? short : short.toFixed(1)} short of ${target}`}
      {unit ? ` ${unit}` : ""}
    </span>
  );
}
