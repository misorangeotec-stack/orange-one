import { useState } from "react";
import { FileText } from "lucide-react";
import PhotoLightbox from "@/shared/components/ui/PhotoLightbox";
import { useOcpiDocUrls } from "../lib/docUrls";
import { isImagePath, pageLabel } from "../lib/signatures";
import type { OcpiDoc } from "../types";

/**
 * A filed signed document, read-only.
 *
 * ⚠ THIS IS THE ONE ARTIFACT THE MODULE CANNOT RE-CREATE. Everything else here
 *   renders from data; a signature exists only as pixels. So the strip shows
 *   every page rather than "1 file attached", and a page that will not resolve
 *   says so instead of rendering as a gap — an unreadable contract has to look
 *   unreadable.
 *
 * ⚠ A PDF IS NOT SHOWN INLINE. It opens in a new tab under its signed url,
 *   because a scan of a five-page contract in a 96-pixel tile tells nobody
 *   anything, and an <iframe> per page would fetch every one of them on render.
 */
export default function SignedDocStrip({
  pages,
  title,
  meta,
}: {
  pages: OcpiDoc[];
  title: string;
  /** e.g. "Filed 14 Sep 2026 by Yash" — shown next to the heading. */
  meta?: string;
}) {
  const urls = useOcpiDocUrls(pages.map((p) => p.path));
  const [zoom, setZoom] = useState<number | null>(null);

  if (pages.length === 0) return null;

  const imageUrl = (p: OcpiDoc) => (isImagePath(p.path) ? (urls[p.path] ?? null) : null);

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-grey-2">
          {title} · {pages.length} {pages.length === 1 ? "page" : "pages"}
        </p>
        {meta && <p className="text-[12px] text-grey-2">{meta}</p>}
      </div>

      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {pages.map((p, i) => {
          const img = imageUrl(p);
          const href = urls[p.path];
          const inner = img ? (
            <img src={img} alt={pageLabel(i)} className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full flex-col items-center justify-center gap-1 px-1 text-grey-2">
              <FileText className="h-6 w-6" />
              <span className="w-full truncate text-center text-[10px]">{p.name}</span>
            </span>
          );
          const box =
            "block aspect-square w-full overflow-hidden rounded-xl border border-line bg-page";

          return (
            <li key={p.path} className="relative">
              {img ? (
                <button type="button" onClick={() => setZoom(i)} className={box} aria-label={`View ${pageLabel(i)}`}>
                  {inner}
                </button>
              ) : href ? (
                <a href={href} target="_blank" rel="noreferrer" className={box} aria-label={`Open ${p.name}`}>
                  {inner}
                </a>
              ) : (
                <span className={box} title="This page could not be opened">{inner}</span>
              )}
              <span className="pointer-events-none absolute bottom-1 left-1 rounded-md bg-navy/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                {pageLabel(i)}
              </span>
            </li>
          );
        })}
      </ul>

      <PhotoLightbox
        url={zoom !== null && pages[zoom] ? imageUrl(pages[zoom]) : null}
        alt={zoom !== null ? pageLabel(zoom) : undefined}
        caption={zoom !== null ? `${pageLabel(zoom)} of ${pages.length}` : undefined}
        onClose={() => setZoom(null)}
      />
    </section>
  );
}
