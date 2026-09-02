import type { OcpiMachine, OcpiMachineSection, OcpiNamedMaster } from "../types";

/**
 * The template comparison — twenty-one contract templates read side by side.
 *
 * Each machine carries a template transcribed from its own PowerPoint deck, by
 * different people over several years. Nobody has ever seen them together, so
 * nobody knows which clauses every machine says identically, which say the same
 * thing in different words, which a machine is simply missing, and which one
 * machine carries alone. Twenty-one templates one screen at a time cannot answer
 * that; a grid can.
 *
 * ⚠ PURE. No XLSX, no React, no store, no fetch — it takes the machines, their
 *   sections and the categories and returns a classification. That is what makes
 *   it checkable by eye on two machines before it is trusted on ten, which is the
 *   only defence against a diff tool that is confidently wrong. A confidently
 *   wrong diff is worse than no diff: it sends somebody to rewrite a contract
 *   clause that never disagreed.
 *
 * ⚠ `lib/tokens.ts` IS DELIBERATELY NOT IMPORTED. Templates are compared as
 *   WRITTEN — `{{head_count}}` against `{{head_count}}` — never as resolved. Two
 *   machines both saying `{{head_count}}` are identical even though every deal
 *   prints a different number there. Resolve first and every machine differs from
 *   every other machine on every tokenised line, and the whole sheet goes amber.
 */

/* -------------------------------------------------------------------------- */
/*  Normalisation — the equality test, and ONLY the equality test              */
/* -------------------------------------------------------------------------- */

/**
 * What two wordings have to agree on to count as "the same".
 *
 * 🔴 THE CELL ALWAYS PRINTS THE ORIGINAL. This is consulted to decide the fill
 *    and nothing else. If this ever leaked into the displayed value, the reader
 *    would be asked to standardise a wording that appears nowhere in any
 *    template.
 *
 * Without it, `Ex-works Ahmedabad` and `Ex-Works, Ahmedabad ` colour amber and
 * the sheet reports a difference that does not exist — which is the failure that
 * makes a diff untrustworthy, because the reader cannot tell the false amber
 * from the real one and stops believing both.
 *
 * ⚠ THE QUOTE AND DASH FOLDING IS NOT COSMETIC. These decks came out of
 *   PowerPoint, which silently rewrites `'` to `’` and `--` to `—` as you type.
 *   Two transcriptions of one clause routinely differ by nothing else.
 */
export function normalise(s: string | null | undefined): string {
  if (!s) return "";
  return (
    s
      // Curly punctuation → ASCII, before anything else looks at the characters.
      .replace(/[‘’‚‛′]/g, "'")
      .replace(/[“”„‟″]/g, '"')
      .replace(/[‐‑‒–—―]/g, "-")
      .replace(/ /g, " ")
      .split("\n")
      // Per LINE, not just at the very end: these bodies are bulleted lists, and
      // a stray full stop on the third bullet is the same clause.
      .map((line) => line.trim().replace(/[.,;:]+$/, "").trim())
      .filter((line) => line.length > 0)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
  );
}

/* -------------------------------------------------------------------------- */
/*  The shape of a comparison                                                 */
/* -------------------------------------------------------------------------- */

/** Where in the template a line lives. A missing spec row and a missing clause
 *  are not the same kind of gap, so they are never mixed in one list. */
export type BandKey = "header" | "header_fields" | "spec" | "composition" | "sections";

export const BAND_LABEL: Record<BandKey, string> = {
  header: "Header",
  header_fields: "Header fields",
  spec: "Specification",
  composition: "Composition",
  sections: "Sections",
};

/** The band order as it is read on the document itself, top to bottom. */
export const BAND_ORDER: BandKey[] = ["header", "header_fields", "spec", "composition", "sections"];

/**
 * What one cell is, once the row is understood.
 *
 * `same` carries no fill on purpose — settled boilerplate should be quiet so the
 * variable content can shout.
 */
export type CellMark = "same" | "differs" | "missing" | "unique";

export interface DiffCell {
  /** The ORIGINAL text, exactly as the template holds it. Never normalised. */
  text: string;
  /** False ⇒ this machine does not carry this line at all. */
  present: boolean;
  mark: CellMark;
}

/** How a whole line came out, across the machines of one tab. */
export type RowVerdict = "same" | "differs" | "missing" | "unique";

export interface DiffRow {
  band: BandKey;
  /** The line's name — a field name, a spec label, a bullet, a section title. */
  label: string;
  /** Sections only: the `key` the row was matched on, shown beside the title. */
  key?: string;
  verdict: RowVerdict;
  /** The verdict in words, so the sheet survives a black-and-white print. */
  status: string;
  /** One per machine, in the same order as `TabDiff.machines`. */
  cells: DiffCell[];
}

export interface BandCount {
  band: BandKey;
  same: number;
  differs: number;
  missing: number;
  unique: number;
  total: number;
}

export interface TabDiff {
  category: string;
  /** The machines that ARE compared — templated and active — in master order. */
  machines: OcpiMachine[];
  /** Every line any of them carries, banded, in document order. */
  rows: DiffRow[];
  counts: BandCount[];
  totals: BandCount;
  /** Named under the grid. An untemplated machine is not one that disagrees. */
  excludedNoTemplate: string[];
  /** Named separately: "switched off" is a different reason from "never written". */
  excludedInactive: string[];
  /**
   * True when there are fewer than two machines to compare.
   *
   * ⚠ THE TAB IS STILL EMITTED. A blank sheet reads as a bug and somebody
   *   re-runs the export thinking it failed; a sentence saying "a comparison
   *   needs two machines and this category has one" does not.
   */
  tooFewToCompare: boolean;
}

/* -------------------------------------------------------------------------- */
/*  Pointer extraction — one list of (label, value) per machine, per band      */
/* -------------------------------------------------------------------------- */

/** One line a machine carries, before any machine is compared with any other. */
interface Pointer {
  /** What the union is keyed on — normalised, so casing cannot split a row. */
  id: string;
  /** What the reader sees in column A. The first machine's spelling wins. */
  label: string;
  /** What goes in this machine's cell. */
  value: string;
  key?: string;
}

/**
 * A line whose cell answers "does this machine have it", not "what does it say".
 *
 * Header fields and composition bullets are presence, not wording: the bullet
 * IS the content, so the cell can only tick. Giving every present cell the same
 * constant lets the one classifier below handle both kinds — a tick everywhere
 * reads as `same`, a tick on two of ten reads as `unique` — instead of a second
 * code path that could disagree with the first.
 */
export const TICK = "✓";

/** The four header-line keys, with the wording the machine form itself uses. */
const HEADER_FIELD_LABEL: Record<string, string> = {
  attn: "Attn",
  date: "Date",
  ref: "Ref",
  address: "Address",
};

const SIGNOFF_LABEL: Record<string, string> = {
  approved_by: "Approved By",
  checked_by: "Checked By",
};

function headerPointers(m: OcpiMachine): Pointer[] {
  // The five header pointers, named as the Machines master and the template
  // editor name them on screen, so a reader who wants to change one can find
  // the field rather than guess which column it was.
  const out: [string, string][] = [
    ["Document heading", m.docTitle ?? ""],
    ["Opening line", m.introText ?? ""],
    ["Model no.", m.machineModelNo ?? ""],
    ["Priced supply line", m.supplyDescription ?? ""],
    ["Sign-off wording", SIGNOFF_LABEL[m.signoffStyle] ?? m.signoffStyle ?? ""],
  ];
  // A blank value is ABSENT, not an empty answer: `intro_text` is nullable and a
  // machine that has none is missing the line, which is the finding.
  return out
    .filter(([, v]) => v.trim().length > 0)
    .map(([label, value]) => ({ id: label, label, value }));
}

function headerFieldPointers(m: OcpiMachine): Pointer[] {
  return m.headerFields.map((k) => ({
    id: `hf:${k}`,
    label: HEADER_FIELD_LABEL[k] ?? k,
    value: TICK,
  }));
}

function specPointers(m: OcpiMachine): Pointer[] {
  return m.specRows
    .filter((r) => (r.label ?? "").trim().length > 0)
    .map((r) => ({ id: normalise(r.label), label: r.label.trim(), value: r.value ?? "" }));
}

function compositionPointers(m: OcpiMachine): Pointer[] {
  return m.composition
    .filter((b) => b.trim().length > 0)
    .map((b) => ({ id: normalise(b), label: b.trim(), value: TICK }));
}

/**
 * Sections, matched on `key` and NEVER on title.
 *
 * ⚠ TWO MACHINES MAY TITLE THE SAME CLAUSE DIFFERENTLY, and that difference is
 *   a finding to SHOW, not a reason to split one clause into two rows. Live
 *   proof: `installation` carries two distinct titles across the machines that
 *   have it and `warranty` carries three. Keyed on the title they would appear
 *   as five half-empty rows and every machine would look like it was missing
 *   most of them — a hundred false reds, and the real gaps invisible among them.
 */
function sectionPointers(m: OcpiMachine, sections: OcpiMachineSection[]): Pointer[] {
  return sections
    .filter((s) => s.machineId === m.id && s.active)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((s) => ({ id: `sec:${s.key}`, label: s.title ?? s.key, value: s.body ?? "", key: s.key }));
}

/** The title each machine gives one section key — the `↳ its heading` row. */
function sectionTitlePointers(m: OcpiMachine, sections: OcpiMachineSection[]): Pointer[] {
  return sectionPointers(m, sections).map((p) => ({
    id: `${p.id}:title`,
    label: p.label,
    value: p.label,
    key: p.key,
  }));
}

/* -------------------------------------------------------------------------- */
/*  Classification                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The most common normalised value — what the amber cells are amber AGAINST.
 *
 * ⚠ TIES BREAK BY MASTER SORT ORDER, not arbitrarily. `values` arrives in the
 *   machine order the tab uses, so a five-five split makes the earlier machine's
 *   wording the reference and the sheet says the same thing every time it is
 *   run. A Map preserves insertion order, so first-seen wins a tie by
 *   construction.
 */
function modalValue(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = "";
  let bestN = -1;
  for (const [v, n] of counts) {
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

function classifyRow(
  band: BandKey,
  label: string,
  key: string | undefined,
  raw: (Pointer | undefined)[],
): DiffRow {
  const n = raw.length;
  const held = raw.filter((p): p is Pointer => !!p);
  const have = held.length;
  const norms = held.map((p) => normalise(p.value));
  const distinct = new Set(norms).size;

  let verdict: RowVerdict;
  let status: string;

  if (have === n && distinct <= 1) {
    verdict = "same";
    status = "Same";
  } else if (have === n) {
    verdict = "differs";
    // Count the ODD ONES OUT, not the distinct wordings: "3 of 10 differ" is
    // the number of templates somebody has to go and edit.
    const modal = modalValue(norms);
    const odd = norms.filter((v) => v !== modal).length;
    status = `Differs (${odd} of ${n})`;
  } else if (have <= 2) {
    verdict = "unique";
    status = `Only ${have} of ${n}`;
  } else {
    verdict = "missing";
    status = `Missing on ${n - have} of ${n}`;
    // ⚠ A ROW CAN CARRY TWO FINDINGS. The brief's four cases do not cover "some
    //   machines are missing it AND the ones that have it disagree", which is
    //   real — `warranty` sits on 11 of 21 machines with 6 distinct bodies. Red
    //   marks the gaps; the amber below marks the disagreement among the rest.
    //   Reporting only the gaps would send somebody to add a clause without
    //   telling them the clause has no agreed wording yet.
    if (distinct > 1) status += "; wordings differ";
  }

  // The reference the amber cells are measured against. Meaningless for `unique`
  // (two samples have no majority) and unused for `same`.
  const modal = verdict === "differs" || verdict === "missing" ? modalValue(norms) : "";

  const cells: DiffCell[] = raw.map((p) => {
    if (!p) {
      return { text: "", present: false, mark: verdict === "unique" ? "same" : "missing" };
    }
    if (verdict === "unique") return { text: p.value, present: true, mark: "unique" };
    if (verdict === "same") return { text: p.value, present: true, mark: "same" };
    const differs = normalise(p.value) !== modal;
    return { text: p.value, present: true, mark: differs ? "differs" : "same" };
  });

  return { band, label, key, verdict, status, cells };
}

/* -------------------------------------------------------------------------- */
/*  Building one tab                                                          */
/* -------------------------------------------------------------------------- */

type Extractor = (m: OcpiMachine) => Pointer[];

/**
 * The union of every line any machine in the tab carries, merged in MASTER SORT
 * ORDER so the band reads like a real document.
 *
 * ⚠ NOT ALPHABETICAL, and not "most common first". Both would shuffle a
 *   specification table into an order no document uses, and the reader is
 *   checking this against a template on screen.
 *
 * 🔴 A LINE ONLY ONE MACHINE HAS IS SLOTTED WHERE THAT MACHINE PUTS IT — never
 *    appended to the end of the band. This is not tidiness. Composition bullets
 *    carry the model name inside the sentence ("…Printing unit model Homer K24 to
 *    print from 4 to 8 colors…"), so ten machines produce ten one-off bullets
 *    that are the SAME clause differing in a word. Appended, K32's variant lands
 *    eleven rows below K24's and nothing tells the reader they are one line —
 *    the finding "make this one sentence with a token in it" goes invisible.
 *    Slotted, the two sit together and the finding reads itself. Direct's
 *    composition union is 62 bullets across 10 machines, so this is most of that
 *    band.
 *
 *    The rule: place an unseen line immediately BEFORE the next line of this
 *    machine that is already placed; if it has none left, append. That keeps the
 *    machine's own order intact and lands the variant beside its twin.
 */
function buildBand(band: BandKey, machines: OcpiMachine[], extract: Extractor): DiffRow[] {
  const per = machines.map((m) => {
    const byId = new Map<string, Pointer>();
    for (const p of extract(m)) if (!byId.has(p.id)) byId.set(p.id, p);
    return byId;
  });

  const order: { id: string; label: string; key?: string }[] = [];
  const placed = new Set<string>();
  for (const map of per) {
    const own = [...map.values()];
    own.forEach((p, i) => {
      if (placed.has(p.id)) return;
      placed.add(p.id);
      const entry = { id: p.id, label: p.label, key: p.key };
      // The next line THIS machine carries that is already in the union — the
      // anchor the new one belongs in front of.
      const nextPlaced = own.slice(i + 1).find((q) => order.some((o) => o.id === q.id));
      const at = nextPlaced ? order.findIndex((o) => o.id === nextPlaced.id) : -1;
      if (at >= 0) order.splice(at, 0, entry);
      else order.push(entry);
    });
  }

  return order.map((o) =>
    classifyRow(band, o.label, o.key, per.map((map) => map.get(o.id))),
  );
}

/** Does this section key carry more than one wording for its TITLE? */
function titlesDisagree(machines: OcpiMachine[], sections: OcpiMachineSection[], key: string): boolean {
  const titles = new Set<string>();
  for (const m of machines) {
    const s = sections.find((x) => x.machineId === m.id && x.key === key && x.active);
    if (s) titles.add(normalise(s.title));
  }
  return titles.size > 1;
}

function countBand(band: BandKey, rows: DiffRow[]): BandCount {
  const of = rows.filter((r) => r.band === band);
  return {
    band,
    same: of.filter((r) => r.verdict === "same").length,
    differs: of.filter((r) => r.verdict === "differs").length,
    missing: of.filter((r) => r.verdict === "missing").length,
    unique: of.filter((r) => r.verdict === "unique").length,
    total: of.length,
  };
}

/**
 * One tab: every line every machine of one category carries, classified.
 *
 * 🔴 THE COLUMNS COME FROM THE MACHINE LIST, NEVER FROM THE POINTERS. A machine
 *    with no sections at all — or no spec rows, or nothing but a header — keeps
 *    its column and simply reads red down that band. Derived from the pointers
 *    instead, it would vanish from its own category's tab without a word, and
 *    the emptiest template in the company would be the one the sheet hid.
 */
export function buildTabDiff(
  category: OcpiNamedMaster,
  allMachines: OcpiMachine[],
  sections: OcpiMachineSection[],
): TabDiff {
  const inCategory = allMachines
    .filter((m) => m.categoryId === category.id)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  // ⚠ EXCLUDED FOR TWO DIFFERENT REASONS, AND THEY ARE NAMED SEPARATELY. A
  //   machine with no template is not a machine that disagrees — carried as an
  //   all-blank column it would drown every real finding in false red. An
  //   inactive one is a machine nobody can quote, which is a different sentence
  //   for the reader even though the effect on the grid is the same.
  const machines = inCategory.filter((m) => m.hasTemplate && m.active);
  const excludedNoTemplate = inCategory.filter((m) => !m.hasTemplate).map((m) => m.name);
  const excludedInactive = inCategory.filter((m) => m.hasTemplate && !m.active).map((m) => m.name);

  const rows: DiffRow[] = [];
  if (machines.length > 0) {
    rows.push(...buildBand("header", machines, headerPointers));
    rows.push(...buildBand("header_fields", machines, headerFieldPointers));
    rows.push(...buildBand("spec", machines, specPointers));
    rows.push(...buildBand("composition", machines, compositionPointers));

    // Sections, plus the heading row where — and only where — the titles disagree.
    const bodyRows = buildBand("sections", machines, (m) => sectionPointers(m, sections));
    const titleRows = buildBand("sections", machines, (m) => sectionTitlePointers(m, sections));
    for (const body of bodyRows) {
      rows.push(body);
      if (!body.key || !titlesDisagree(machines, sections, body.key)) continue;
      const t = titleRows.find((r) => r.key === body.key);
      if (t) rows.push({ ...t, label: `↳ its heading` });
    }
  }

  const counts = BAND_ORDER.map((b) => countBand(b, rows));
  const totals: BandCount = {
    band: "header",
    same: counts.reduce((s, c) => s + c.same, 0),
    differs: counts.reduce((s, c) => s + c.differs, 0),
    missing: counts.reduce((s, c) => s + c.missing, 0),
    unique: counts.reduce((s, c) => s + c.unique, 0),
    total: rows.length,
  };

  return {
    category: category.name,
    machines,
    rows,
    counts,
    totals,
    excludedNoTemplate,
    excludedInactive,
    tooFewToCompare: machines.length < 2,
  };
}

/** Every category, in master order — one tab each, comparable or not. */
export function buildAllTabDiffs(
  categories: OcpiNamedMaster[],
  machines: OcpiMachine[],
  sections: OcpiMachineSection[],
): TabDiff[] {
  return categories
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((c) => buildTabDiff(c, machines, sections));
}
