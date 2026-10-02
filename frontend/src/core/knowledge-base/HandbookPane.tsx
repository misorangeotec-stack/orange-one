/**
 * KB-1 · The handbook, readable, with one section lit up.
 *
 * This is the SHARED pane. It is what `/handbook/read` renders, and in Phase 3 it becomes
 * the right-hand side of the Ask HR bubble when someone clicks a citation. Both want the
 * same thing and must not drift apart, so there is one component and a `dense` flag.
 *
 * WHY THE WHOLE MANUAL, NOT JUST THE CITED SECTION: the user's decision (KB-1 §0) was that
 * clicking a reference shows the section "highlighted, with the rest of the manual above
 * and below it". Showing the section alone answers "what does it say" but not "is there
 * something next to it I should know", which is exactly the doubt that sends people to HR.
 * So every section is rendered and the cited one is lit; scrolling is the reader's.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/shared/lib/cn";
import Block from "./blocks";
import {
  searchHandbook,
  useHandbook,
  useHandbookImageUrls,
  type Handbook,
  type HandbookSection,
} from "./data";

/* ------------------------------- one section ------------------------------- */

const HEADING_CLASS: Record<number, string> = {
  1: "text-[17px] font-bold text-navy",
  2: "text-[15px] font-semibold text-navy",
  3: "text-[13.5px] font-semibold text-navy",
};

function Section({
  section,
  active,
  hb,
  urls,
  register,
}: {
  section: HandbookSection;
  active: boolean;
  hb: Handbook;
  urls: Map<string, string> | undefined;
  register: (anchor: string, el: HTMLElement | null) => void;
}) {
  return (
    <section
      ref={(el) => register(section.anchor, el)}
      id={`kb-${section.anchor}`}
      className={cn(
        "scroll-mt-4 rounded-card px-3 py-2 transition-colors duration-300",
        section.depth === 1 && "mt-7 border-t border-line pt-5 first:mt-0 first:border-0 first:pt-2",
        // The highlight. Deliberately a standing state, not a flash: the reader arrived
        // here from an answer and needs to see WHICH words it came from while they read.
        active && "bg-orange-soft/60 ring-1 ring-orange/35"
      )}
    >
      <h3 className={cn(HEADING_CLASS[section.depth] ?? HEADING_CLASS[3], "scroll-mt-4")}>
        {section.heading}
      </h3>

      {section.note && (
        <div className="my-2 rounded-card border border-[#F5C9A8] bg-[#FFF6EF] px-3 py-2 text-[12.5px] leading-relaxed text-[#8A4B16]">
          {section.note}
        </div>
      )}

      {section.body.map((b, i) => (
        <Block key={i} block={b} images={hb.images} urls={urls} />
      ))}
    </section>
  );
}

/* ---------------------------------- nav ------------------------------------ */

function Contents({
  hb,
  activeChapterAnchor,
  onPick,
}: {
  hb: Handbook;
  activeChapterAnchor: string | null;
  onPick: (anchor: string) => void;
}) {
  const activeRef = useRef<HTMLButtonElement | null>(null);

  // Keep the lit chapter visible in the list. There are 42 chapters, so arriving at one of
  // the later ones otherwise marks a row that is scrolled out of sight, and the reader
  // cannot tell where in the manual they have landed. `nearest` so it does not yank the
  // list about when the chapter is already on screen.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeChapterAnchor]);

  return (
    <nav className="space-y-0.5">
      {hb.chapters.map((c) => (
        <button
          key={c.anchor}
          type="button"
          ref={c.anchor === activeChapterAnchor ? activeRef : undefined}
          onClick={() => onPick(c.anchor)}
          className={cn(
            "block w-full rounded-lg px-2.5 py-1.5 text-left text-[12.5px] leading-snug transition-colors",
            c.anchor === activeChapterAnchor
              ? "bg-orange-soft font-semibold text-orange"
              : "text-grey hover:bg-[#F7F9FC] hover:text-navy"
          )}
        >
          {c.heading}
        </button>
      ))}
    </nav>
  );
}

/* --------------------------------- the pane -------------------------------- */

export interface HandbookPaneProps {
  /** The section to open at and keep lit. */
  anchor?: string | null;
  /** Fired when the reader moves within the pane, so the URL (or the widget) can follow. */
  onAnchorChange?: (anchor: string) => void;
  /** Tighter chrome, for the Ask HR bubble's right-hand side. */
  dense?: boolean;
  className?: string;
}

export default function HandbookPane({ anchor, onAnchorChange, dense, className }: HandbookPaneProps) {
  const { data: hb, isLoading, error } = useHandbook();
  const [term, setTerm] = useState("");
  const [showContents, setShowContents] = useState(false);

  const paths = useMemo(
    () => (hb ? [...hb.images.values()].map((i) => i.storagePath) : []),
    [hb]
  );
  const { data: urls } = useHandbookImageUrls(paths);

  const refs = useRef(new Map<string, HTMLElement>());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const register = (a: string, el: HTMLElement | null) => {
    if (el) refs.current.set(a, el);
    else refs.current.delete(a);
  };

  // Scroll the cited section into view INSIDE the pane. `block: "start"` rather than
  // scrollIntoView's default so the heading lands under the sticky search bar, not behind it.
  //
  // ⚠ `urls` is in the dependency list ON PURPOSE. The pictures are fetched separately and
  // arrive a beat later; even with their slot pre-sized (blocks.tsx) a re-check costs
  // nothing and covers any other late layout change. Without the pre-sizing this landed a
  // whole chapter short, which is worse than not scrolling at all: the reader believes they
  // are looking at the answer.
  useEffect(() => {
    if (!anchor || !hb) return;
    const el = refs.current.get(anchor);
    if (!el) return;
    const id = window.setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    return () => window.clearTimeout(id);
  }, [anchor, hb, urls]);

  const hits = useMemo(() => searchHandbook(hb, term), [hb, term]);

  /**
   * Which chapter the contents list marks.
   *
   * ⚠ DRIVEN BY SCROLL POSITION, NOT BY `anchor`. It used to be derived from the cited
   * section, which meant the list only moved when you CLICKED something: scrolling the
   * manual left the contents stranded on whatever chapter you last picked, so the reader
   * could not tell where they had got to. Clicking still works, because clicking scrolls
   * and the scroll is what this reads.
   *
   * `anchor` still owns the orange ring on the cited section, and must: that marks where
   * the ANSWER came from, and it would be wrong for it to wander as the reader scrolled.
   */
  const [scrolledChapter, setScrolledChapter] = useState<string | null>(null);

  // The chapter the anchor belongs to. Used until the reader scrolls, so arriving at a
  // citation marks the right chapter immediately rather than a frame later.
  const anchorChapter = useMemo(() => {
    if (!hb || !anchor) return null;
    const target = hb.byAnchor.get(anchor);
    if (!target) return null;
    let found: string | null = null;
    for (const s of hb.sections) {
      if (s.ordinal > target.ordinal) break;
      if (s.depth === 1) found = s.anchor;
    }
    return found;
  }, [hb, anchor]);

  const activeChapter = scrolledChapter ?? anchorChapter;

  /**
   * The last chapter heading at or above the top of the reading pane. Only the 36 depth-1
   * elements are measured, not all 356, so this stays cheap enough to run on every frame
   * of a scroll.
   */
  const syncChapterToScroll = useCallback(() => {
    const box = scrollRef.current;
    if (!box || !hb) return;
    const top = box.getBoundingClientRect().top + 24; // a little grace, so a heading sitting
    let found: string | null = null;                  // just under the edge counts as current
    for (const c of hb.chapters) {
      const el = refs.current.get(c.anchor);
      if (!el) continue;
      if (el.getBoundingClientRect().top <= top) found = c.anchor;
      else break;
    }
    setScrolledChapter(found ?? hb.chapters[0]?.anchor ?? null);
  }, [hb]);

  // rAF-coalesced: a scroll fires far more often than the browser paints, and measuring 36
  // elements per event rather than per frame is wasted work.
  const onScroll = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      syncChapterToScroll();
    });
  }, [syncChapterToScroll]);

  // Once when the manual lands, so the list is right before anybody touches it.
  useEffect(() => {
    if (hb) syncChapterToScroll();
  }, [hb, syncChapterToScroll]);

  useEffect(() => () => {
    if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
  }, []);

  const go = (a: string) => {
    setTerm("");
    setShowContents(false);
    onAnchorChange?.(a);
    // Also scroll directly: when the anchor has not changed, the effect above will not fire.
    refs.current.get(a)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (isLoading) {
    return <div className="px-4 py-10 text-center text-[13px] text-grey-2">Opening the handbook…</div>;
  }
  if (error) {
    return (
      <div className="px-4 py-10 text-center text-[13px] text-grey-2">
        The handbook could not be loaded. {(error as Error).message}
      </div>
    );
  }
  if (!hb) {
    return (
      <div className="px-4 py-10 text-center text-[13px] text-grey-2">
        No handbook has been published yet.
      </div>
    );
  }

  return (
    <div className={cn("flex h-full min-h-0 w-full", className)}>
      {/* Contents. A column on a wide screen; a drawer on a phone, where two panes are
          unusable and field staff are the likeliest readers. */}
      <aside
        className={cn(
          "hidden w-60 shrink-0 overflow-y-auto border-r border-line bg-white/60 p-3 lg:block",
          dense && "w-52"
        )}
      >
        <p className="mb-2 px-2.5 text-[11px] font-semibold uppercase tracking-wide text-grey-2">
          Contents
        </p>
        <Contents hb={hb} activeChapterAnchor={activeChapter} onPick={go} />
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Search. Sticky, because the reader who scrolls deep into Chapter 32 and gives up
            should not have to scroll back to the top to look something up. */}
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-white/95 px-3 py-2 backdrop-blur">
          <button
            type="button"
            onClick={() => setShowContents((v) => !v)}
            className="rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-semibold text-navy lg:hidden"
          >
            Contents
          </button>
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search the handbook"
            className="min-w-0 flex-1 rounded-lg border border-line px-3 py-1.5 text-[13px] text-navy outline-none placeholder:text-grey-2 focus:border-orange"
          />
          {term && (
            <button
              type="button"
              onClick={() => setTerm("")}
              className="shrink-0 text-[12px] font-semibold text-grey-2 hover:text-navy"
            >
              Clear
            </button>
          )}
          {!dense && (
            <span className="hidden shrink-0 text-[11px] text-grey-2 sm:inline">
              v{hb.version}
            </span>
          )}
        </div>

        {showContents && (
          <div className="max-h-64 overflow-y-auto border-b border-line bg-white p-3 lg:hidden">
            <Contents hb={hb} activeChapterAnchor={activeChapter} onPick={go} />
          </div>
        )}

        {term.trim().length >= 2 && (
          <div className="max-h-72 overflow-y-auto border-b border-line bg-[#FBFCFE] p-2">
            {hits.length === 0 ? (
              <p className="px-2 py-3 text-[12.5px] text-grey-2">
                Nothing in the handbook matches “{term.trim()}”. Try the Ask HR box instead, which
                understands a question rather than exact words.
              </p>
            ) : (
              hits.map((s) => (
                <button
                  key={s.anchor}
                  type="button"
                  onClick={() => go(s.anchor)}
                  className="block w-full rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-grey hover:bg-white hover:text-navy"
                >
                  {s.pathText}
                </button>
              ))
            )}
          </div>
        )}

        <div
          ref={scrollRef}
          onScroll={onScroll}
          className={cn("min-h-0 flex-1 overflow-y-auto px-2 py-3", dense ? "sm:px-3" : "sm:px-5")}
        >
          <div className="mx-auto max-w-3xl">
            {hb.sections.map((s) => (
              <Section
                key={s.id}
                section={s}
                active={s.anchor === anchor}
                hb={hb}
                urls={urls}
                register={register}
              />
            ))}
            <p className="px-3 py-6 text-center text-[11px] text-grey-2">
              {hb.title} · version {hb.version}. This is the text of the handbook as issued; where
              it contradicts itself the contradiction is shown rather than resolved.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
