/**
 * KB-1 · The HR handbook, as the browser reads it.
 *
 * ONE query for the whole manual. The handbook is ~356 sections and ~160 KB of text, which
 * is one round trip and then nothing: it changes once or twice a year, so it is cached hard
 * and never refetched on focus. Anything that needs the handbook (the reader pane, and the
 * Ask HR bubble's right-hand side) reads it through here.
 *
 * READING NEEDS NO GRANT. The policies on kb_documents / kb_sections / kb_images say
 * "any authenticated staff member", and a customer login (profiles.is_external) sees
 * nothing at all. There is no module check in this file on purpose; adding one here would
 * be a second, weaker copy of a rule the database already enforces.
 *
 * ⚠ The ANSWERS do not come from here. The model is given the handbook server-side by the
 * `ask-handbook` Edge Function, which reads the same rows. The browser never chooses what
 * the model reads.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/core/platform/supabase";

export const HANDBOOK_QK = ["knowledge-base", "handbook"] as const;

/**
 * Where a section lives in the URL: /handbook/read#types-of-leave
 *
 * The path itself is declared in the layout types, beside ANNOUNCEMENTS_PATH, because the
 * home menu and the breadcrumb need it and must not import this module to get it (it pulls
 * in the Supabase client and react-query). Re-exported here so every existing call site
 * keeps working unchanged, exactly as core/announcements/data.ts does.
 */
export { HANDBOOK_PATH, HANDBOOK_LABEL } from "@/shared/components/layout/types";
import { HANDBOOK_PATH as PATH } from "@/shared/components/layout/types";

export const handbookHref = (anchor: string) => `${PATH}#${anchor}`;

const IMAGE_BUCKET = "kb-handbook-docs";

/* ------------------------------- the blocks -------------------------------- */

/**
 * What a section is made of. These are rendered as React, never as markdown and never as
 * HTML — see blocks.tsx. The shapes are written by frontend/scripts/ingest-handbook.mjs.
 */
export type HandbookBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "bullets"; items: string[] }
  | { kind: "table"; rows: string[][] }
  | { kind: "image"; ordinal: number };

export interface HandbookSection {
  id: string;
  ordinal: number;
  /** 1 = chapter, 2 = section, 3 = sub-section. */
  depth: number;
  number: string | null;
  heading: string;
  /** "CHAPTER 4: LEAVE POLICY › SICK LEAVE" — the breadcrumb, and what a citation shows. */
  pathText: string;
  /** Stable URL fragment. Derived from the heading, so it survives a re-publish. */
  anchor: string;
  body: HandbookBlock[];
  plainText: string;
  /**
   * Hand-written by HR where the handbook fails to flag its OWN problem. Today that is the
   * two travel policies (Chapter 15 against Chapter 32) and the band tables that disagree.
   * Shown as a callout, and quoted by the answer. Not a general "draft" marker: Chapter 32
   * already says in its own words that its rates await Director sign-off.
   */
  note: string | null;
}

export interface HandbookImage {
  ordinal: number;
  sectionId: string | null;
  storagePath: string;
  altText: string | null;
  /** What the picture SAYS. Six of the seven carry text no extraction can see. */
  transcript: string | null;
}

export interface Handbook {
  documentId: string;
  title: string;
  version: number;
  publishedAt: string;
  sections: HandbookSection[];
  /** Chapters only (depth 1), in document order — the left-hand nav. */
  chapters: HandbookSection[];
  byAnchor: Map<string, HandbookSection>;
  byId: Map<string, HandbookSection>;
  images: Map<number, HandbookImage>;
}

/* --------------------------------- fetch ----------------------------------- */

const asBlocks = (raw: unknown): HandbookBlock[] => (Array.isArray(raw) ? (raw as HandbookBlock[]) : []);

async function fetchHandbook(): Promise<Handbook | null> {
  const { data: doc, error: docErr } = await supabase
    .from("kb_documents")
    .select("id, title, version, published_at")
    .eq("is_current", true)
    .maybeSingle();
  if (docErr) throw new Error(docErr.message);
  if (!doc) return null;

  const [{ data: rows, error: secErr }, { data: imgs, error: imgErr }] = await Promise.all([
    supabase
      .from("kb_sections")
      .select("id, ordinal, depth, number, heading, path_text, anchor, body, plain_text, in_force_note")
      .eq("document_id", doc.id)
      .order("ordinal", { ascending: true }),
    supabase
      .from("kb_images")
      .select("ordinal, section_id, storage_path, alt_text, transcript")
      .eq("document_id", doc.id)
      .order("ordinal", { ascending: true }),
  ]);
  if (secErr) throw new Error(secErr.message);
  if (imgErr) throw new Error(imgErr.message);

  const sections: HandbookSection[] = (rows ?? []).map((r) => ({
    id: r.id,
    ordinal: r.ordinal,
    depth: r.depth,
    number: r.number,
    heading: r.heading,
    pathText: r.path_text,
    anchor: r.anchor,
    body: asBlocks(r.body),
    plainText: r.plain_text,
    note: r.in_force_note,
  }));

  return {
    documentId: doc.id,
    title: doc.title,
    version: doc.version,
    publishedAt: doc.published_at,
    sections,
    chapters: sections.filter((s) => s.depth === 1),
    byAnchor: new Map(sections.map((s) => [s.anchor, s])),
    byId: new Map(sections.map((s) => [s.id, s])),
    images: new Map(
      (imgs ?? []).map((i) => [
        i.ordinal,
        {
          ordinal: i.ordinal,
          sectionId: i.section_id,
          storagePath: i.storage_path,
          altText: i.alt_text,
          transcript: i.transcript,
        },
      ])
    ),
  };
}

/**
 * The whole handbook. Cached for the session: it is a document, not a queue, and a
 * re-publish is a developer running a script — nobody is waiting for it to appear.
 */
export function useHandbook() {
  return useQuery({
    queryKey: [...HANDBOOK_QK, "current"],
    queryFn: fetchHandbook,
    staleTime: 60 * 60_000,
    gcTime: 60 * 60_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Signed URLs for every picture, in one call. The bucket is private, so a raw path is not
 * viewable; these expire in an hour, which outlasts any reading session and is refetched
 * with the page.
 */
export function useHandbookImageUrls(paths: string[]) {
  const key = paths.slice().sort().join("|");
  return useQuery({
    queryKey: [...HANDBOOK_QK, "images", key],
    enabled: paths.length > 0,
    staleTime: 45 * 60_000,
    gcTime: 45 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(IMAGE_BUCKET).createSignedUrls(paths, 60 * 60);
      if (error) throw new Error(error.message);
      const out = new Map<string, string>();
      for (const d of data ?? []) if (d.path && d.signedUrl) out.set(d.path, d.signedUrl);
      return out;
    },
  });
}

/* --------------------------------- search ---------------------------------- */

/**
 * Plain substring search over the manual, for the reader who would rather scan than ask.
 * Deliberately dumb: the clever search is the Ask HR bubble, and a second, worse ranking
 * here would only disagree with it.
 */
export function searchHandbook(hb: Handbook | null | undefined, term: string): HandbookSection[] {
  const q = term.trim().toLowerCase();
  if (!hb || q.length < 2) return [];
  return hb.sections.filter((s) => s.plainText.toLowerCase().includes(q)).slice(0, 60);
}
