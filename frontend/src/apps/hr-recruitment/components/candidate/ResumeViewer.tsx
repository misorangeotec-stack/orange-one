import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PDFDocumentProxy } from "pdfjs-dist";
import EmptyState from "@/shared/components/ui/EmptyState";
import { hrDocUrl } from "../../data/hrWrites";
import type { Candidate } from "../../types";

/**
 * pdf.js is ~400KB and is wanted on exactly one tab of one screen. Imported statically
 * it landed in the main bundle, so every page in the portal — Dashboard, Purchase,
 * Receivables — paid for it on first load. This fetches it the first time a CV is
 * actually opened, and caches the promise so the second candidate is instant.
 *
 * The worker URL stays a normal import: `?url` emits the file as its own asset and
 * hands back a string, so it costs nothing until the worker is spawned.
 */
let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((m) => {
      m.GlobalWorkerOptions.workerSrc = workerUrl;
      return m;
    });
  }
  return pdfjsPromise;
}

/**
 * The CV, rendered by us rather than by whatever PDF plugin the browser happens to have.
 *
 * WHY NOT AN <iframe>
 *   It worked, but the viewer inside it is the BROWSER'S, and we control none of it.
 *   Chrome's opens a thumbnail rail that ate half the column, its state is remembered
 *   per session so it comes back, and the `navpanes=0` URL flag that used to suppress
 *   it is an Acrobat parameter Chrome never implemented. The same page then looks
 *   different again in Firefox, Edge and Safari. Rendering it ourselves is the only way
 *   the screen looks the same for everyone.
 *
 * WHAT IT GIVES YOU
 *   One continuous scroll through every page, a live "n of m" counter, and zoom that
 *   starts fitted to the column width. No thumbnail rail.
 *
 * PAGES RENDER AS THEY COME INTO VIEW, not all at once — a canvas per page at device
 * resolution is real memory, and a long document would otherwise stall the tab before
 * showing anything. Each page reserves its exact height first, so the scrollbar is
 * honest from the start and nothing jumps as it fills in.
 */

const ZOOM_MIN = 0.4;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.2;

/** One page: reserves its height immediately, paints when it scrolls near. */
function PdfPage({
  doc,
  pageNumber,
  scale,
  scrollRoot,
  onRegister,
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  scrollRoot: HTMLDivElement | null;
  onRegister: (pageNumber: number, el: HTMLDivElement | null) => void;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [painted, setPainted] = useState(false);

  useEffect(() => {
    onRegister(pageNumber, holder.current);
    return () => onRegister(pageNumber, null);
  }, [pageNumber, onRegister]);

  // Measure first so the placeholder is the right size before anything is drawn.
  useEffect(() => {
    let alive = true;
    setPainted(false);
    void doc.getPage(pageNumber).then((p) => {
      const vp = p.getViewport({ scale });
      if (alive) setSize({ w: vp.width, h: vp.height });
    });
    return () => {
      alive = false;
    };
  }, [doc, pageNumber, scale]);

  useEffect(() => {
    const el = holder.current;
    if (!el || !size || painted) return;

    let cancelled = false;
    let task: ReturnType<Awaited<ReturnType<typeof doc.getPage>>["render"]> | null = null;

    const paint = async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled) return;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;

      // Draw at device resolution so text stays crisp on a HiDPI screen, but cap it —
      // at 3x a multi-page CV is a lot of pixels for no visible gain.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vp = page.getViewport({ scale });
      canvas.width = Math.floor(vp.width * dpr);
      canvas.height = Math.floor(vp.height * dpr);
      canvas.style.width = `${vp.width}px`;
      canvas.style.height = `${vp.height}px`;

      task = page.render({
        canvasContext: ctx,
        viewport: vp,
        transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
      });
      try {
        await task.promise;
        if (!cancelled) setPainted(true);
      } catch {
        /* cancelled by a zoom change or unmount — not an error worth showing */
      }
    };

    // rootMargin: start painting a screenful early so scrolling never lands on a blank.
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          void paint();
        }
      },
      { root: scrollRoot ?? null, rootMargin: "400px 0px" },
    );
    io.observe(el);

    return () => {
      cancelled = true;
      io.disconnect();
      task?.cancel();
    };
  }, [doc, pageNumber, scale, size, painted, scrollRoot]);

  return (
    <div
      ref={holder}
      data-page={pageNumber}
      className="mx-auto bg-white shadow-sm ring-1 ring-black/10"
      style={size ? { width: size.w, height: size.h } : { width: "100%", height: 400 }}
    >
      <canvas ref={canvasRef} className="block" />
    </div>
  );
}

export default function ResumeViewer({ candidate: c }: { candidate: Candidate }) {
  const path = c.resumePath;

  const [url, setUrl] = useState<string | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [pages, setPages] = useState(0);
  const [current, setCurrent] = useState(1);
  const [scale, setScale] = useState<number | null>(null); // null until fitted to width
  const [err, setErr] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const pageEls = useRef(new Map<number, HTMLDivElement>());
  /** Natural width of page 1 at scale 1 — the basis for "fit the column". */
  const baseWidth = useRef(0);

  const registerPage = useCallback((n: number, el: HTMLDivElement | null) => {
    if (el) pageEls.current.set(n, el);
    else pageEls.current.delete(n);
  }, []);

  useLayoutEffect(() => setScrollRoot(scrollRef.current), []);

  // Sign the file, then open it. Both are undone on unmount so switching candidates
  // mid-load cannot leave a stale document rendering into a dead canvas.
  useEffect(() => {
    let alive = true;
    let opened: PDFDocumentProxy | null = null;
    setUrl(null);
    setDoc(null);
    setPages(0);
    setCurrent(1);
    setScale(null);
    setErr(null);
    if (!path) return;

    void (async () => {
      try {
        const signed = await hrDocUrl(path);
        if (!alive) return;
        if (!signed) {
          setErr("That file could not be opened.");
          return;
        }
        setUrl(signed);
        const pdfjs = await loadPdfjs();
        if (!alive) return;
        const task = pdfjs.getDocument({ url: signed });
        opened = await task.promise;
        if (!alive) {
          void opened.destroy();
          return;
        }
        const first = await opened.getPage(1);
        baseWidth.current = first.getViewport({ scale: 1 }).width;
        setDoc(opened);
        setPages(opened.numPages);
      } catch {
        if (alive) setErr("This file could not be read as a PDF.");
      }
    })();

    return () => {
      alive = false;
      void opened?.destroy();
    };
  }, [path]);

  /** Fit the page to the column the first time, and whenever the column resizes. */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !doc || !baseWidth.current) return;
    const fit = () => {
      const avail = el.clientWidth - 32; // the container's own padding
      if (avail > 0) setScale(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, avail / baseWidth.current)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
    // Only refit when a new document arrives — a manual zoom must not be overwritten
    // on every render, which is why `scale` is deliberately not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  /** "n of m" follows the scroll: the page whose top is nearest the container's top. */
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    let best = current;
    let bestGap = Infinity;
    for (const [n, node] of pageEls.current) {
      const gap = Math.abs(node.getBoundingClientRect().top - top);
      if (gap < bestGap) {
        bestGap = gap;
        best = n;
      }
    }
    if (best !== current) setCurrent(best);
  };

  const goto = (n: number) => {
    const target = Math.max(1, Math.min(pages, n));
    pageEls.current.get(target)?.scrollIntoView({ block: "start", behavior: "smooth" });
    setCurrent(target);
  };

  const zoom = (delta: number) =>
    setScale((s) => (s === null ? s : Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, +(s + delta).toFixed(2)))));

  const openInTab = async () => {
    const signed = url ?? (path ? await hrDocUrl(path) : null);
    if (signed) window.open(signed, "_blank", "noopener");
  };

  if (!path) {
    return (
      <EmptyState
        title="No CV on file"
        message="This candidate was added by hand, so there is no resume to show. Anything else we hold is under Documents."
      />
    );
  }

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-xl border border-line">
        {/* ---- toolbar ---- */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-navy px-3 py-2 text-white">
          <div className="flex items-center gap-1.5">
            <input
              value={current}
              onChange={(e) => {
                const n = Number(e.target.value.replace(/\D/g, ""));
                if (n) goto(n);
              }}
              inputMode="numeric"
              aria-label="Page number"
              className="h-6 w-9 rounded border border-white/20 bg-white/10 text-center text-[12px] tabular-nums text-white focus:border-white/50 focus:outline-none"
            />
            <span className="text-[12px] text-white/70">of {pages || "…"}</span>
          </div>

          <span className="h-4 w-px bg-white/20" />

          <div className="flex items-center gap-1">
            <button
              onClick={() => zoom(-ZOOM_STEP)}
              disabled={scale === null || scale <= ZOOM_MIN}
              aria-label="Zoom out"
              className="grid h-6 w-6 place-items-center rounded text-[15px] leading-none hover:bg-white/15 disabled:opacity-40"
            >
              −
            </button>
            <span className="w-11 text-center text-[12px] tabular-nums text-white/80">
              {scale === null ? "—" : `${Math.round(scale * 100)}%`}
            </span>
            <button
              onClick={() => zoom(ZOOM_STEP)}
              disabled={scale === null || scale >= ZOOM_MAX}
              aria-label="Zoom in"
              className="grid h-6 w-6 place-items-center rounded text-[15px] leading-none hover:bg-white/15 disabled:opacity-40"
            >
              +
            </button>
          </div>

          <button
            onClick={() => {
              const el = scrollRef.current;
              if (el && baseWidth.current) setScale((el.clientWidth - 32) / baseWidth.current);
            }}
            className="rounded px-1.5 py-0.5 text-[12px] text-white/80 hover:bg-white/15"
          >
            Fit width
          </button>

          <button
            onClick={openInTab}
            className="ml-auto rounded px-1.5 py-0.5 text-[12px] font-semibold text-white/90 hover:bg-white/15"
          >
            Open in a new tab ↗
          </button>
        </div>

        {/* ---- pages ---- */}
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="h-[76vh] overflow-auto bg-[#2C3242] p-4"
        >
          {err ? (
            <div className="grid h-full place-items-center px-6 text-center">
              <div>
                <p className="text-[13.5px] font-medium text-white">{err}</p>
                <button onClick={openInTab} className="mt-1.5 text-[12.5px] font-semibold text-orange hover:underline">
                  Open the file instead →
                </button>
              </div>
            </div>
          ) : !doc || scale === null ? (
            <div className="grid h-full place-items-center">
              <p className="text-[12.5px] text-white/60">Opening the CV…</p>
            </div>
          ) : (
            <div className="space-y-4">
              {Array.from({ length: pages }, (_, i) => (
                <PdfPage
                  key={i + 1}
                  doc={doc}
                  pageNumber={i + 1}
                  scale={scale}
                  scrollRoot={scrollRoot}
                  onRegister={registerPage}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-[12.5px] text-grey-2">{c.resumeName ?? "Resume"}</span>
        {c.parseStatus === "failed" && (
          <span className="shrink-0 text-[11.5px] text-grey">
            Couldn't be read automatically — the details beside it were typed in.
          </span>
        )}
      </div>
    </div>
  );
}
