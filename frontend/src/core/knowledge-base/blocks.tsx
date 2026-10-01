/**
 * KB-1 · Drawing one section of the handbook.
 *
 * 🔴 NOTHING HERE BUILDS HTML. Every block is a React element made from stored, structured
 * data (see kb_sections.body). There is no markdown renderer in this bundle, and although
 * DOMPurify IS present — it arrives as an optional dependency of jspdf — it must not be
 * imported: sanitising is only needed if you are injecting HTML, and injecting HTML is the
 * thing being avoided. A handbook is rendered, not interpreted.
 */
import type { HandbookBlock, HandbookImage } from "./data";

/** A cell may hold several paragraphs; the ingest joins them with a newline, never blindly. */
function Lines({ text }: { text: string }) {
  const parts = text.split("\n").filter((l) => l.trim());
  if (parts.length <= 1) return <>{text}</>;
  return (
    <>
      {parts.map((l, i) => (
        <span key={i} className="block">
          {l}
        </span>
      ))}
    </>
  );
}

/**
 * The handbook's tables are content, not data grids, so they do NOT get sort toggles or a
 * filter row. `CLAUDE.md`'s "every grid sorts and filters" rule is about queues, masters and
 * registers — rows a reader picks through. These are typeset tables inside a document, and
 * sorting one would destroy the ordering the policy is written in (Band 9 down to Band 1).
 * The question log in the module screen IS a grid and does obey that rule.
 */
function Table({ rows }: { rows: string[][] }) {
  if (!rows.length) return null;

  // A one-cell table is one of the handbook's callout boxes, not a table.
  if (rows.length === 1 && rows[0].length === 1) {
    return (
      <div className="my-3 rounded-card border border-line bg-[#F7F9FC] px-4 py-3 text-[13px] leading-relaxed text-navy">
        <Lines text={rows[0][0]} />
      </div>
    );
  }

  const [head, ...body] = rows;
  return (
    <div className="my-3 overflow-x-auto rounded-card border border-line">
      {/*
        The min-width makes a wide table SCROLL sideways on a phone instead of crushing its
        columns. Chapter 32's band matrix is six columns; squeezed into 390px it wrapped to
        "Busine / Econo Flexi" and read as gibberish. Scrolling a table is normal; guessing
        at a broken word is not. The wrapper above is the only thing that scrolls, so the
        page itself still does not move sideways.
      */}
      <table className="w-full min-w-[34rem] border-collapse text-[13px]">
        <thead>
          <tr className="bg-[#F7F9FC]">
            {head.map((c, i) => (
              <th
                key={i}
                className="border-b border-line px-3 py-2 text-left align-top font-semibold text-navy"
              >
                <Lines text={c} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, ri) => (
            <tr key={ri} className="even:bg-[#FCFDFE]">
              {r.map((c, ci) => (
                <td key={ci} className="border-b border-line px-3 py-2 align-top text-grey last:border-0">
                  <Lines text={c} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Picture({
  image,
  url,
}: {
  image: HandbookImage | undefined;
  url: string | undefined;
}) {
  if (!image) return null;
  return (
    <figure className="my-4">
      {/*
        ⚠ THE BOX IS THE SAME SIZE WHETHER OR NOT THE PICTURE HAS ARRIVED.
        The handbook pages are A4, so the slot is fixed at that ratio and the placeholder
        fills it. Without this the six front-matter pictures pop in after the first paint,
        everything below them shifts down, and a deep link that had already scrolled to
        Chapter 4 ends up showing Chapter 3. Measured: it landed a whole chapter short.
      */}
      <div className="relative w-full max-w-2xl overflow-hidden rounded-card border border-line aspect-[1/1.414] bg-[#FBFCFE]">
        {url ? (
          <img
            src={url}
            alt={image.altText ?? "A page of the handbook"}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-contain"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-[12px] text-grey-2">
            Loading picture…
          </div>
        )}
      </div>
      {image.altText && (
        <figcaption className="mt-1.5 text-[12px] text-grey-2">{image.altText}</figcaption>
      )}
    </figure>
  );
}

export default function Block({
  block,
  images,
  urls,
}: {
  block: HandbookBlock;
  images: Map<number, HandbookImage>;
  urls: Map<string, string> | undefined;
}) {
  switch (block.kind) {
    case "paragraph":
      return (
        <p className="my-2 whitespace-pre-line text-[13.5px] leading-relaxed text-grey">
          {block.text}
        </p>
      );

    case "bullets":
      return (
        <ul className="my-2 list-disc space-y-1 pl-5 text-[13.5px] leading-relaxed text-grey marker:text-orange">
          {block.items.map((it, i) => (
            <li key={i} className="whitespace-pre-line">
              {it}
            </li>
          ))}
        </ul>
      );

    case "table":
      return <Table rows={block.rows} />;

    case "image": {
      const img = images.get(block.ordinal);
      return <Picture image={img} url={img ? urls?.get(img.storagePath) : undefined} />;
    }

    default:
      return null;
  }
}
