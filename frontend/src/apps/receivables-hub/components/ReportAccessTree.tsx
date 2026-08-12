import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, Minus } from "lucide-react";
import { REPORT_CATEGORIES, type ReportCategory, type ReportEntry } from "@hub/lib/reportCatalog";
import { GRANTABLE_REPORTS } from "@hub/lib/reportAccess";
import { cn } from "@/shared/lib/cn";

/**
 * The per-report grant editor — one tick per report, grouped by catalogue category.
 *
 * Used by BOTH admin screens (Settings → Permissions and Admin → Users), the way
 * menuAccessLevel/setMenuAccessLevel are shared, so the two cannot drift into disagreeing
 * about what a grant means.
 *
 * ── Categories are UI, not data ──
 * A category tick selects or clears the report ids underneath it and is never itself stored.
 * That is the whole point: if a category were the grant, adding a report to it later would
 * silently hand that report to everyone who held the category — exactly what per-report
 * permissions exist to prevent. `value` is always a list of report ids.
 *
 * ── Styling ──
 * Deliberately built from Orange One's hex tokens (navy / grey / line / orange) rather than
 * the Hub's shadcn CSS variables, because it renders in both worlds: inside `.hub-root` on the
 * Settings page, and outside it on the core admin user form, where those variables are not in
 * scope. Same reason it hand-rolls the tick instead of using @hub/components/ui/checkbox.
 */

/** The scope badge. Tells the admin what a granted report will actually show this user. */
function ScopeTag({ report }: { report: ReportEntry }) {
  const scoped = report.scoping !== "none";
  return (
    <span
      className={cn(
        "shrink-0 rounded-pill border px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
        scoped ? "border-teal/40 bg-teal/10 text-teal" : "border-yellow/50 bg-yellow/10 text-[#8a6400]",
      )}
      title={
        scoped
          ? "Filtered to this user's assigned salespeople."
          : (report.scopeNote ?? "Shows company-wide figures — cannot be filtered by salesperson.")
      }
    >
      {scoped ? "Scoped" : "Company-wide"}
    </span>
  );
}

/** A tick box that can also say "some of these". */
function TriTick({ state }: { state: "all" | "some" | "none" }) {
  return (
    <span
      className={cn(
        "flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition",
        state === "none" ? "border-grey-2 bg-white" : "border-orange bg-orange text-white",
      )}
    >
      {state === "all" && <Check className="h-3 w-3" strokeWidth={3} />}
      {state === "some" && <Minus className="h-3 w-3" strokeWidth={3} />}
    </span>
  );
}

export interface ReportAccessTreeProps {
  /** Granted report ids. */
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}

export default function ReportAccessTree({ value, onChange, disabled = false }: ReportAccessTreeProps) {
  const granted = useMemo(() => new Set(value), [value]);

  /** Categories that actually hold a grantable report, in catalogue order. */
  const groups = useMemo(() => {
    const out: { category: ReportCategory; reports: ReportEntry[] }[] = [];
    for (const category of REPORT_CATEGORIES) {
      const reports = GRANTABLE_REPORTS.filter((r) => r.category === category.id);
      if (reports.length) out.push({ category, reports });
    }
    return out;
  }, []);

  // Open the categories this user already holds something in; leave the rest shut so the list
  // opens on "here is what they have" rather than forty rows.
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(groups.filter((g) => g.reports.some((r) => granted.has(r.id))).map((g) => g.category.id)),
  );

  const totalGranted = groups.reduce((n, g) => n + g.reports.filter((r) => granted.has(r.id)).length, 0);
  const totalReports = groups.reduce((n, g) => n + g.reports.length, 0);

  const setIds = (next: Set<string>) => onChange([...next]);

  const toggleReport = (id: string) => {
    if (disabled) return;
    const next = new Set(granted);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setIds(next);
  };

  /** Whole category on or off. "Some" counts as off, so one click always means "give them all". */
  const toggleCategory = (reports: ReportEntry[]) => {
    if (disabled) return;
    const all = reports.every((r) => granted.has(r.id));
    const next = new Set(granted);
    for (const r of reports) {
      if (all) next.delete(r.id);
      else next.add(r.id);
    }
    setIds(next);
  };

  const setAll = (on: boolean) => {
    if (disabled) return;
    setIds(on ? new Set(GRANTABLE_REPORTS.map((r) => r.id)) : new Set());
  };

  return (
    <div className={cn("rounded-lg border border-line bg-white", disabled && "opacity-60")}>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="text-[12.5px] font-semibold text-navy">
          {totalGranted} of {totalReports} reports
        </span>
        {totalGranted === 0 && (
          <span className="text-[11.5px] text-grey-2">— this user cannot open any report</span>
        )}
        <div className="ml-auto flex gap-1.5">
          <button
            type="button"
            onClick={() => setAll(true)}
            disabled={disabled}
            className="rounded-pill border border-line px-2.5 py-1 text-[11.5px] text-grey hover:border-orange/40 disabled:cursor-not-allowed"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={() => setAll(false)}
            disabled={disabled}
            className="rounded-pill border border-line px-2.5 py-1 text-[11.5px] text-grey hover:border-orange/40 disabled:cursor-not-allowed"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="max-h-[420px] overflow-auto">
        {groups.map(({ category, reports }) => {
          const held = reports.filter((r) => granted.has(r.id)).length;
          const state = held === 0 ? "none" : held === reports.length ? "all" : "some";
          const isOpen = open.has(category.id);
          return (
            <div key={category.id} className="border-b border-line last:border-b-0">
              <div className="flex items-center gap-2 px-3 py-2">
                {/* Two separate controls on one row: the tick grants the whole category, the
                    title expands it. Merging them would make "show me what is in here" also
                    silently grant nine reports. */}
                <button
                  type="button"
                  onClick={() => toggleCategory(reports)}
                  disabled={disabled}
                  aria-label={`${state === "all" ? "Clear" : "Grant"} all ${category.title} reports`}
                  className="disabled:cursor-not-allowed"
                >
                  <TriTick state={state} />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setOpen((prev) => {
                      const next = new Set(prev);
                      if (next.has(category.id)) next.delete(category.id);
                      else next.add(category.id);
                      return next;
                    })
                  }
                  className="flex flex-1 items-center gap-1.5 text-left"
                  aria-expanded={isOpen}
                >
                  {isOpen ? (
                    <ChevronDown className="h-3.5 w-3.5 text-grey-2" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-grey-2" />
                  )}
                  <category.icon className="h-3.5 w-3.5 shrink-0 text-grey" />
                  <span className="text-[13px] font-medium text-navy">{category.title}</span>
                  <span className="ml-auto text-[11.5px] text-grey-2">
                    {held} / {reports.length}
                  </span>
                </button>
              </div>

              {isOpen && (
                <div className="pb-1">
                  {reports.map((r) => {
                    const on = granted.has(r.id);
                    return (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => toggleReport(r.id)}
                        disabled={disabled}
                        className="flex w-full items-center gap-2 py-1.5 pl-10 pr-3 text-left hover:bg-page disabled:cursor-not-allowed"
                      >
                        <TriTick state={on ? "all" : "none"} />
                        <span className="flex-1 truncate text-[12.5px] text-navy">{r.title}</span>
                        <ScopeTag report={r} />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
