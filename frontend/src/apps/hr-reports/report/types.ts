/**
 * The lab's model of a REPORTING FORM (KPI-3, read-only) — not a scorecard.
 *
 * ── Why this is a second model and not the framework's ────────────────────────
 * `framework/types.ts` models a weighted appraisal sheet: every line carries a weight,
 * the weights add to 100, and the question is "what score does this person get?".
 * Saloni's Weekly Review Report asks nothing of the kind. It has no weights, no score
 * and no arithmetic — it is a FORM she fills in every week and her HR Head signs. Its
 * question is "what happened, and is any of it off track?".
 *
 * So the unit here is a FIELD, not a KPI line, and the measure of coverage is HOW MANY
 * FIELDS the hub can fill, not how much weight it can score. Forcing this document into
 * the framework's shape would have meant inventing weights the client never wrote.
 *
 * ── Why the bands are different too ───────────────────────────────────────────
 * The framework lab's bands answer "can this be scored?". A form's bands answer "can
 * this box be filled?". Both now keep three things apart that read alike and cost
 * nothing like each other:
 *
 *   an empty table   somebody is not using a screen that already works — a TRAINING
 *                    gap. The box fills itself the first week anyone uses it.
 *   built, not live  the module exists and has not shipped. A go-live.
 *   no table at all  a BUILD. Nothing will ever fill that box until one exists.
 *
 * Telling the client "most of this needs building" when almost none of it does
 * would be wrong in the expensive direction, so each gets its own band.
 */

/**
 * How far the hub can fill one box of the form TODAY. Established by reading the live
 * database on 23-09-2026, not from the document.
 *
 *  live          Filled from live data, end to end, from a table that has rows in it.
 *  live-partial  Filled from live data, but the reader must know a caveat: the column
 *                means something slightly narrower than the form's words, or the figure
 *                is the team's rather than this person's.
 *  empty-table   The table, the column and the screen are LIVE on the hub and no real
 *                row has been written. Nobody has to build anything — somebody has to
 *                use it. This is the band the framework lab does not have.
 *  not-released  The module is BUILT — tables, RPCs and screens — and has not reached
 *                the live hub yet. Nobody can use it even if they want to, and nobody
 *                has to build it either. Waiting on a release, not on a quote.
 *  no-table      Nothing in the hub records this. It needs a module, not a report.
 *  narrative     Free text, a judgement or a signature, by design. There is nothing to
 *                measure and nothing to build.
 *
 * ⚠ RE-READ THE DATABASE BEFORE TRUSTING A BAND. Every band below was re-established
 *   on 23-09-2026 and a third of them had already moved: the Buddy Program reached
 *   master on 22-09 and Learning & Development — the single largest block of this form
 *   — was built on its own branch in the two days after this page was first written.
 *   Both had been transcribed as "nothing in the hub", which is the most expensive
 *   thing this page can say. A band is a reading of the schema on a date, not a fact
 *   about the form.
 */
export type FieldCoverage = "live" | "live-partial" | "empty-table" | "not-released" | "no-table" | "narrative";

/** What the box holds — it decides how the value is printed, and nothing else. */
export type FieldKind = "count" | "percent" | "rating" | "days" | "money" | "date" | "text";

/** The form's own sections, in its own order. */
export interface SectionDef {
  /** "H", "A", "B", "C", "SK", "Z" — the prefix every field code in it carries. */
  code: string;
  title: string;
  /** The line under the heading on the rendered report. Ours, not the document's. */
  note: string;
}

export interface FieldDef {
  /** The form's own numbering where it has one, else ours: "A1.4", "B2.6", "SK-3". */
  code: string;
  /** SectionDef.code. Every field belongs to exactly one. */
  section: string;
  /** The block heading the box sits under, as the form prints it: "A1 · Key Performance Snapshot". */
  block: string;
  /** The box's own label, copied from the form. */
  label: string;
  /**
   * The target, benchmark or instruction the form prints beside the box, copied word for
   * word. Empty where the form states none — which is itself worth seeing in one column.
   */
  targetText: string;
  kind: FieldKind;
  coverage: FieldCoverage;
  /** The table and column the figure comes from, or would have to come from. */
  source: string;
  /** What is missing and what it would take. Printed on the row and on the report. */
  gap?: string;
}

export interface ReportForm {
  id: string;
  /** The role the form was written for. */
  role: string;
  /** Where the form came from, printed on the page so the source is never in doubt. */
  source: string;
  sections: SectionDef[];
  fields: FieldDef[];
}

/** How many FIELDS sit in each band — the finding the report view exists to show. */
export function coverageSplit(f: ReportForm): Record<FieldCoverage, number> {
  const out: Record<FieldCoverage, number> = {
    live: 0,
    "live-partial": 0,
    "empty-table": 0,
    "not-released": 0,
    "no-table": 0,
    narrative: 0,
  };
  for (const x of f.fields) out[x.coverage] += 1;
  return out;
}

/**
 * The transcription checks itself when the page loads, rather than being trusted.
 *
 * There is no test runner in this repo, so a typo in a seventy-field literal has
 * nothing to catch it: a duplicate code would silently drop a row out of the grid (the
 * table keys on it), and a field pointing at a section that does not exist would vanish
 * from the report while still counting in the coverage meter — the two would then
 * disagree and nobody would know which was wrong. Returns the problems, empty when the
 * form is sound.
 */
export function checkForm(f: ReportForm): string[] {
  const out: string[] = [];
  const codes = new Set<string>();
  const sections = new Set(f.sections.map((s) => s.code));
  for (const x of f.fields) {
    if (codes.has(x.code)) out.push(`Two fields share the code ${x.code}.`);
    codes.add(x.code);
    if (!sections.has(x.section)) out.push(`Field ${x.code} is in section "${x.section}", which is not declared.`);
    if (!x.label.trim()) out.push(`Field ${x.code} has no label.`);
    // A gap sentence is the whole value of the unfillable bands; a blank one is a
    // transcription that stopped half way.
    // `not-released` is exempt: the whole band has ONE reason — the module has not
    // shipped — and it is stated on the section banner. Repeating it on 20 boxes was
    // what buried the box-specific half of every sentence the first time round.
    if ((x.coverage === "empty-table" || x.coverage === "no-table") && !x.gap) {
      out.push(`Field ${x.code} cannot be filled but says nothing about what is missing.`);
    }
  }
  for (const s of f.sections) {
    if (!f.fields.some((x) => x.section === s.code)) out.push(`Section ${s.code} has no fields.`);
  }
  return out;
}

/** Is this box one the hub fills by itself? Decides whether the report offers an input. */
export const isAutoFilled = (c: FieldCoverage): boolean => c === "live" || c === "live-partial";
