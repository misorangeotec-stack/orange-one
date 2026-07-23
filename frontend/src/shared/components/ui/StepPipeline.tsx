import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export interface StepPipelineNode<K extends string = string> {
  stepKey: K;
  /** Canonical workflow position (StepDef.index) — the little numbered pip. */
  index: number;
  /** Short step label, e.g. "Share PO". */
  label: string;
  /** Past due — the headline number. */
  delayed: number;
  /** Due today — the secondary number. */
  today: number;
  /**
   * EVERY work-item at this step, whatever its due date.
   *
   * The ✓ used to mean `delayed === 0 && today === 0` — which reads as "this step is
   * clear" but actually meant "nothing here is due in the next 24 hours". A step holding
   * ten items due tomorrow, or ten with no date at all, showed a green tick while the
   * panel right below it listed them. This number is what makes the tick honest: ✓ only
   * when a step is genuinely empty.
   */
  total: number;
}

/** A labelled run of steps — one stage of a longer process. */
export interface StepPipelineGroup<K extends string = string> {
  label: string;
  keys: K[];
}

/**
 * Severity bar width. `sqrt` rather than linear: the bar is an ordinal cue (the
 * exact count is printed right above it), and linear scaling would render a step
 * with 1 delayed beside one with 52 as an invisible 2% sliver. sqrt(1/52) ≈ 14%,
 * while the worst step still pins to 100%. The 12% floor guarantees a visible
 * stub at any ratio.
 *
 * The `d <= 0` guard means `d / worst` is never evaluated when `worst === 0`, so
 * there is no division by zero in the all-clear case.
 */
export const barPct = (d: number, worst: number): number =>
  d <= 0 ? 0 : Math.max(12, Math.round(Math.sqrt(d / worst) * 100));

const Check = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

/**
 * The workflow as a rail of step nodes. Each carries its **delayed** count (the
 * headline), its **due-today** count, and a severity bar scaled against the
 * worst step so the bottleneck reads without comparing digits.
 *
 * Multi-select: clicking a node toggles it. An **empty selection means no
 * filter** (the consumer shows every step) — the same contract as `MultiSelect`,
 * whose Select all / Clear all idiom this mirrors.
 *
 * **Grouping** is optional. Purchase's nine steps are one journey and pass none, so it
 * renders exactly as it always has. HR's are seventeen across four unrelated stages
 * (requisition → pipeline → onboarding → probation), which as one flat rail is twice the
 * screen and puts the worst step off-screen — the very thing you opened the page to find.
 * With groups it wraps into labelled stages instead.
 *
 * Crucially, `worst` and the BOTTLENECK tag are still computed across **all** nodes, not
 * per group. Scale each stage against itself and a stage with genuinely small numbers
 * gets flattered into looking urgent, and you end up with four competing "worst" steps —
 * i.e. none.
 *
 * Pure and props-driven apart from its own overflow flag, so it renders
 * identically in a preview harness and in the live page.
 */
export default function StepPipeline<K extends string>({
  nodes,
  selectedKeys,
  onChange,
  groups,
  interactive = true,
}: {
  nodes: StepPipelineNode<K>[];
  selectedKeys: K[];
  onChange: (next: K[]) => void;
  groups?: StepPipelineGroup<K>[];
  /**
   * Filtering rail (default) vs read-only display. On a home dashboard the rail is
   * purely informational — `onChange` is a no-op there — so `interactive={false}`
   * drops the "Click a step to filter / Select all / Clear all" chrome and renders
   * each node as static, keeping only the bottleneck read-out.
   */
  interactive?: boolean;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);

  // Only show the scroll chevrons when the rail actually overflows. A grouped rail wraps,
  // so it never does — the chevrons simply stay hidden.
  useLayoutEffect(() => {
    const el = railRef.current;
    if (el) setOverflow(el.scrollWidth > el.clientWidth + 1);
  });
  useEffect(() => {
    const el = railRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const check = () => setOverflow(el.scrollWidth > el.clientWidth + 1);
    const ro = new ResizeObserver(check);
    ro.observe(el);
    window.addEventListener("resize", check);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", check);
    };
  }, []);
  const scrollBy = (dx: number) => railRef.current?.scrollBy({ left: dx, behavior: "smooth" });

  // Across ALL nodes — never per group. See the note above.
  const worst = Math.max(0, ...nodes.map((n) => n.delayed));
  const worstCount = nodes.filter((n) => n.delayed === worst).length;
  const selected = new Set<string>(selectedKeys);

  // Deliberately NOT redefined to "no work at all": this banner says "nothing delayed",
  // which is exactly what it checks. The ✓ on a node is the thing that was lying.
  const allClear = worst === 0 && nodes.every((n) => n.today === 0);
  const allSelected = selectedKeys.length === nodes.length;
  const noneSelected = selectedKeys.length === 0;

  const toggle = (key: K) =>
    onChange(selected.has(key) ? selectedKeys.filter((k) => k !== key) : [...selectedKeys, key]);

  const linkBtn = "text-[12px] font-semibold text-orange hover:underline disabled:text-grey-2/50 disabled:no-underline disabled:cursor-not-allowed";

  const byKey = new Map(nodes.map((n) => [n.stepKey as string, n]));

  const renderNode = (n: StepPipelineNode<K>, connector: boolean) => {
    const isSel = selected.has(n.stepKey);
    const isWorst = worst > 0 && n.delayed === worst;
    const uniqueBottleneck = isWorst && worstCount === 1;
    const clear = n.total === 0;

    const interactiveCls = interactive
      ? `cursor-pointer transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:shadow-card focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange/20 ${isSel ? "border-orange ring-4 ring-orange/15" : "border-line hover:border-orange/40"}`
      : "border-line";
    const nodeCls = `relative w-[116px] rounded-card border bg-white px-2.5 pt-2.5 pb-2 text-center shadow-soft ${interactiveCls}`;

    const inner = (
      <>
        {isSel && (
            <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-orange text-white flex items-center justify-center">
              <Check className="w-2.5 h-2.5" />
            </span>
          )}

          <div className="flex items-center justify-center gap-1.5">
            <span className={`w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center ${isSel ? "bg-orange text-white" : "bg-page text-grey-2"}`}>
              {n.index}
            </span>
            <span className={`text-[11px] font-semibold truncate ${isSel ? "text-orange" : "text-grey-2"}`}>{n.label}</span>
          </div>

          <div className="h-[30px] flex items-center justify-center">
            {clear ? (
              <Check className="w-4 h-4 text-ryg-green" />
            ) : (
              <span className={`text-[24px] font-bold leading-none ${n.delayed > 0 ? "text-ryg-red" : "text-grey-2/40"}`}>
                {n.delayed > 0 ? n.delayed : "–"}
              </span>
            )}
          </div>

          <div className={`text-[10.5px] leading-tight h-[14px] ${n.today > 0 ? "text-yellow font-semibold" : "text-grey-2/40"}`}>
            {n.today > 0 ? `+${n.today} today` : ""}
          </div>

          {/* Severity track — only meaningful once something is delayed. */}
          <div className="mt-1.5 h-1.5 rounded-full bg-line overflow-hidden">
            {n.delayed > 0 && (
              <span
                className={`block h-full rounded-full transition-all ${isWorst ? "bg-ryg-red" : "bg-ryg-red/45"}`}
                style={{ width: `${barPct(n.delayed, worst)}%` }}
              />
            )}
          </div>

        <div className="h-[15px] mt-1">
          {uniqueBottleneck && (
            <span className="inline-block text-[9px] font-bold uppercase tracking-wide rounded-pill px-1.5 py-px bg-[#FDECEC] text-ryg-red">
              Bottleneck
            </span>
          )}
        </div>
      </>
    );

    const label = `${n.label} — ${n.delayed} delayed, ${n.today} due today, ${n.total} open`;

    return (
      <div key={n.stepKey} className="flex items-center shrink-0">
        {interactive ? (
          <button
            type="button"
            onClick={() => toggle(n.stepKey)}
            aria-pressed={isSel}
            aria-label={`${label}${isSel ? " (selected)" : ""}`}
            title={label}
            className={nodeCls}
          >
            {inner}
          </button>
        ) : (
          <div aria-label={label} title={label} className={nodeCls}>
            {inner}
          </div>
        )}

        {connector && <div className="w-4 h-0.5 rounded-full bg-line shrink-0" aria-hidden />}
      </div>
    );
  };

  const totalDelayed = nodes.reduce((sum, n) => sum + n.delayed, 0);
  // The header carries filter chrome (Select all / Clear all / the "click to
  // filter" hint) only in interactive mode. Read-only dashboards keep just the
  // status read-out and the scroll chevrons, so it never renders a dead control.
  const showHeader = interactive || allClear || overflow || (!interactive && totalDelayed > 0);

  return (
    <div className="space-y-2.5">
      {showHeader && (
        <div className="flex items-center justify-between gap-3">
          {allClear ? (
            <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ryg-green">
              <span className="w-1.5 h-1.5 rounded-full bg-ryg-green" />
              All clear — nothing delayed
            </span>
          ) : interactive ? (
            <span className="text-[12px] text-grey">
              {noneSelected ? "Click a step to filter — pick several to combine them." : `${selectedKeys.length} of ${nodes.length} steps selected`}
            </span>
          ) : (
            <span className="text-[12px] font-medium text-grey">
              <span className="text-ryg-red font-semibold">{totalDelayed}</span> delayed across the process
            </span>
          )}

          <div className="flex items-center gap-3 shrink-0">
            {interactive && (
              <>
                <button type="button" onClick={() => onChange(nodes.map((n) => n.stepKey))} disabled={allSelected} className={linkBtn}>
                  Select all
                </button>
                <span className="text-line">·</span>
                <button type="button" onClick={() => onChange([])} disabled={noneSelected} className={linkBtn}>
                  Clear all
                </button>
              </>
            )}
            {overflow && (
              <span className="flex items-center gap-1 pl-1">
                <button type="button" onClick={() => scrollBy(-320)} aria-label="Scroll left" className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-line text-grey-2 hover:bg-page">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => scrollBy(320)} aria-label="Scroll right" className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-line text-grey-2 hover:bg-page">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </span>
            )}
          </div>
        </div>
      )}

      {groups ? (
        /* ---- Grouped: one labelled block per stage, wrapping down the page. ---- */
        <div className="space-y-3.5">
          {groups.map((g) => {
            const gNodes = g.keys.map((k) => byKey.get(k)).filter((n): n is StepPipelineNode<K> => !!n);
            if (!gNodes.length) return null;
            const gDelayed = gNodes.reduce((sum, n) => sum + n.delayed, 0);
            const gEmpty = gNodes.every((n) => n.total === 0);

            return (
              <div key={g.label}>
                <div className="mb-1.5 flex items-baseline gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-navy">{g.label}</span>
                  {gEmpty ? (
                    <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-ryg-green">
                      <Check className="h-3 w-3" /> all clear
                    </span>
                  ) : (
                    <span className={`text-[11.5px] ${gDelayed > 0 ? "font-semibold text-ryg-red" : "text-grey"}`}>
                      {gDelayed > 0 ? `${gDelayed} delayed` : "on track"}
                    </span>
                  )}
                </div>
                {/* A stage with nothing in it collapses to its heading — a row of empty
                    boxes is noise, and the heading already said "all clear". */}
                {!gEmpty && (
                  <div className="flex flex-wrap items-stretch gap-y-2">
                    {gNodes.map((n, i) => renderNode(n, i < gNodes.length - 1))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* ---- Ungrouped: the original single scrolling rail. Purchase's path. ---- */
        <div ref={railRef} role="group" aria-label="Filter by step" className="overflow-x-auto -mx-1 px-1 pt-1 pb-2">
          <div className="flex items-stretch min-w-max">
            {nodes.map((n, i) => renderNode(n, i < nodes.length - 1))}
          </div>
        </div>
      )}
    </div>
  );
}
