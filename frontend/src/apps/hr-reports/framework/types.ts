/**
 * The KRA / KPI LAB's model of a weighted appraisal framework (KPI-3, read-only).
 *
 * ── Why this is not the live scorecard ────────────────────────────────────────
 * The live KRA / KPI Scorecard (apps/kra-kpi, KPI-1) weights by VOLUME: every task and
 * every FMS step counts once, so the busiest row dominates the score. The framework HR
 * writes for a role weights by DECLARED IMPORTANCE: a line worth 10% outweighs five
 * hundred tasks. They answer different questions —
 *
 *   KPI-1      "how much of your work did you do, and how much of it on time?"
 *   this model "against your job description, how did you perform?"
 *
 * The framework CONTAINS KPI-1: Saloni's sheet scores Task Management as KRA 3, worth
 * 5%. So the lab reads `kpi_report` for those lines rather than recomputing anything.
 *
 * ── Why the framework is data ─────────────────────────────────────────────────
 * One role's sheet is one literal (see saloni.ts). The next role's sheet is another
 * literal and nothing else — no new screen, no new arithmetic. When this graduates out
 * of the lab the literals become three tables (`kpi_framework` / `_kra` / `_kpi`) with
 * the same fields; NOTHING is written to the database while it lives here.
 */

/**
 * The five shapes of a KPI line. Saloni's 44 lines are not one kind of measurement, and
 * a module that handles only the first can score about a third of her sheet.
 *
 *  sla        "within 1 working day" · "within 48 hours" · "7 working days"
 *             The actual IS the compliance percentage — the KPI-1 arithmetic.
 *  count      "minimum 15 internal trainings annually" · "minimum 8 interactions"
 *             Achievement = actual ÷ target, capped at 100.
 *  ratio      "at least 80% submissions" · "100% applicable participants"
 *             Achievement = actual% ÷ target%, capped at 100.
 *  rating     "average score at least 4/5"
 *             Achievement = actual ÷ target, capped at 100.
 *  judgement  "no substantiated breach" · "documented review score"
 *             No system evidence can exist. A person enters the achievement.
 */
export type MeasureKind = "sla" | "count" | "ratio" | "rating" | "judgement";

/**
 * How far the hub can honour a line TODAY. This is the finding the lab exists to show,
 * so it is a first-class field on every line rather than a note someone has to read.
 *
 *  system         Scored from live data, end to end.
 *  partial        Scored from live data, but the line asks for something the data does
 *                 not fully cover (its KPI names reference checks, which are still only
 *                 a checklist tick).
 *  target-missing The ACTUAL is live; the TARGET the sheet refers to is stored nowhere,
 *                 so nothing can be scored until someone states it. The lab lets a
 *                 reader type one and watch the score move — which is how the open
 *                 questions get answered.
 *  unused         The table and the screen are LIVE and hold no real row. The line
 *                 scores zero because nobody has used it, not because it cannot be
 *                 measured — a training gap, and the cheapest kind of gap there is.
 *  not-released   The module that answers this line is BUILT — tables, RPCs, screens —
 *                 and has not reached the live hub yet. Neither a build nor something
 *                 anybody can start using: it is waiting on a go-live.
 *  no-data        Neither actual nor target exists. Needs a build, not a report.
 *  judgement      There will never be system evidence; a human enters it by design.
 *
 * `unused`, `not-released` and `no-data` all read as "the hub cannot score this today"
 * and cost three completely different things to fix. Collapsing them is what made the
 * first draft of this file quote a build for a module that already existed.
 *
 * ⚠ RE-READ THE SCHEMA BEFORE TRUSTING THESE. On 21-09-2026 KRA 2 — 40% of this sheet
 *   — was transcribed as "no Learning & Development table of any kind". Two days later
 *   the module existed, with 27 tables. A coverage band is a reading of the database on
 *   a date, and this lab's bands decide what a build is quoted at.
 */
export type Coverage = "system" | "partial" | "target-missing" | "unused" | "not-released" | "no-data" | "judgement";

/** Where a line's actual comes from. */
export type SourceSpec =
  | { kind: "none" }
  /**
   * The live `kpi_report` RPC — already permission-checked, already carrying each
   * module's own due dates. `rowKeys` empty means every row of that module.
   *
   *  doneOfGiven   done ÷ given × 100      (a completion-rate line)
   *  onTimeOfDone  on time ÷ done × 100    (an on-time line, the sheet's own base)
   */
  | { kind: "kpiFacts"; module: string; rowKeys: string[]; basis: "doneOfGiven" | "onTimeOfDone" }
  /** A read-only query against the New Recruitment tables. See data/actuals.ts. */
  | { kind: "hr"; metric: HrMetric };

/** The recruitment figures the lab derives itself, because no step carries them. */
export type HrMetric =
  /** CVs uploaded per requisition approved in the period. */
  | "cv_per_requisition"
  /** Profiles shortlisted by HR per requisition approved in the period. */
  | "shortlist_per_requisition"
  /** Share of requisitions closed in the period that closed within the typed TAT. */
  | "closure_within_tat";

/**
 * A number the measurement needs that is NOT the target.
 *
 * "Role closed within approved role-specific TAT" needs the TAT before it can say
 * anything, and the answer it then gives is a percentage against a target of 100 — so
 * the number a reader types there feeds the QUERY, it is not the thing being scored
 * against. Without this distinction that line would score "30 days ÷ 30 days = 100%"
 * for a requisition that took a year.
 *
 * A line with a `param` takes the typed number here; a line with a null `target` takes
 * it as the target; a line with both fixed needs nothing typed.
 */
export interface LineParam {
  label: string;
  unit: string;
  /** A starting value, so the row shows something the moment it is opened. */
  suggest: number;
}

export interface KpiLine {
  /** Stable, and the sheet's own numbering: "1A.5", "2D.3", "3.1". */
  code: string;
  /** KRA code, keyed to KraDef.code. */
  kra: string;
  /** The sub-group heading on the sheet, or "" where the KRA has no groups. */
  group: string;
  title: string;
  /** Percent of the whole 100. Every group's lines add to its group weight. */
  weight: number;
  measure: MeasureKind;
  /** The document's own target wording, printed as written. */
  targetText: string;
  /** The numeric target, where the document states one. Null = nobody has stated it. */
  target: number | null;
  /** What the target and the actual are counted in: "%", "days", "per requisition"… */
  unit: string;
  /** The document's "Orange Hub Evidence" column, printed as written. */
  evidence: string;
  coverage: Coverage;
  source: SourceSpec;
  /** A number the query needs that is not the target. See LineParam. */
  param?: LineParam;
  /** Why this line cannot be measured, or what it is missing. Shown on the row. */
  gap?: string;
}

export interface KraDef {
  code: string;
  title: string;
  weight: number;
}

export interface Framework {
  id: string;
  /** The role this sheet was written for. */
  role: string;
  /** Where the sheet came from, printed on the page so the source is never in doubt. */
  source: string;
  kras: KraDef[];
  lines: KpiLine[];
}

/**
 * Every weight in the sheet must add up, at every level. The lab checks this when it
 * loads a framework rather than trusting the transcription: a literal with 44 lines is
 * exactly the kind of thing a typo hides in, and a silently wrong denominator would
 * make every score on the page wrong by a little.
 *
 * Returns the problems, empty when the framework is sound.
 */
export function checkWeights(f: Framework): string[] {
  const out: string[] = [];
  const total = f.kras.reduce((s, k) => s + k.weight, 0);
  if (Math.abs(total - 100) > 0.001) out.push(`The KRAs add to ${total}%, not 100%.`);
  for (const kra of f.kras) {
    const lines = f.lines.filter((l) => l.kra === kra.code);
    const sum = lines.reduce((s, l) => s + l.weight, 0);
    if (Math.abs(sum - kra.weight) > 0.001) {
      out.push(`KRA ${kra.code} (${kra.title}) is ${kra.weight}%, but its ${lines.length} lines add to ${sum}%.`);
    }
  }
  const seen = new Set<string>();
  for (const l of f.lines) {
    if (seen.has(l.code)) out.push(`Two lines share the code ${l.code}.`);
    seen.add(l.code);
  }
  return out;
}

/** The weight carried by each coverage band — the lab's headline finding, computed. */
export function coverageSplit(f: Framework): Record<Coverage, number> {
  const out: Record<Coverage, number> = { system: 0, partial: 0, "target-missing": 0, unused: 0, "not-released": 0, "no-data": 0, judgement: 0 };
  for (const l of f.lines) out[l.coverage] += l.weight;
  return out;
}
