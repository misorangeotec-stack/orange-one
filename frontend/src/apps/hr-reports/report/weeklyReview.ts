/**
 * Saloni's Weekly Review Report, transcribed (KPI-3, read-only).
 *
 * SOURCE: files/Weekly_Review_Report_TA_LD.docx — "ORANGE OTEC PVT. LTD. · HR — Talent
 * Acquisition & Learning and Development | Weekly Review Report". Prepared By Saloni
 * Rathod, HR Executive; Reviewed By Riya Chauhan, HR Head; Submitted To HR Head /
 * Management. The file is a BLANK FORM: 37 tables, every data row empty.
 *
 * Every `label` and `targetText` below is the form's own wording, copied, not
 * paraphrased — so the screen can be held against the document box by box. `coverage`,
 * `source` and `gap` are NOT from the document: they are what the hub can honour,
 * re-read from the live database on 23-09-2026.
 *
 * ⚠ NO ROW COUNTS IN THIS FILE. An earlier draft wrote "162 candidates" and "136
 *   interviews" into the gap sentences, and both were wrong inside the hour — HR works
 *   these tables through the day, and they had moved to 174 and 146 before the page was
 *   finished. A `gap` states the SHAPE of the gap ("null on every row", "has never held
 *   a row"), which stays true; any figure a reader needs is on the box beside it, read
 *   live.
 *
 * ── What the hub can fill, by field ───────────────────────────────────────────
 *   live          the figure is there today, from a table with rows in it
 *   live-partial  the figure is there, with a caveat the reader has to be told
 *   empty-table   the screen is live and holds no real row — somebody has to USE it,
 *                 nobody has to build it
 *   not-released  the module is built and has not shipped — a go-live, not a quote
 *                 (NOTHING is in this band today; L&D emptied it on 23-09)
 *   no-table      nothing records this; it needs a module
 *   narrative     free text or a signature, by design
 *
 * The page counts that split from these entries rather than printing it, so the two can
 * never drift apart.
 *
 * ⚠ RE-AUDITED 23-09-2026, AND A THIRD OF THE FILE MOVED. This form was transcribed on
 *   21-09 against the schema of that morning. Two days later the Buddy Program had
 *   reached master (NR-9, 22-09) and Learning & Development had been built on its own
 *   branch — 27 tables. Eighteen boxes said "no table" about things that now have a
 *   table, a screen and an RPC. That is the most expensive sentence this page can
 *   print, so the bands below are re-read from `information_schema` and not carried
 *   forward. Do the same before quoting from it again.
 *
 * ── The four findings that decide how this report reads ───────────────────────
 *  1 · NO REQUISITION HAS EVER CLOSED. `status` supports "closed" and nothing has ever
 *      reached it; every requisition carrying a `closed_at` was CANCELLED. So
 *      `closed_at` today means "cancelled", and the form's "Positions Closed —
 *      candidate joined" is not the same question. Anything that counts closures off
 *      `closed_at` alone counts cancellations.
 *  2 · THE ONLY JOINER IN THE HUB IS THE TEST SEED. `joined_at`, `induction_on` and
 *      `bgv_status` are each set on exactly one row, and it is the seeded ZZ TEST
 *      candidate. The columns work; no real joiner has been put through them. A band
 *      that reads those columns is therefore "built, unused", never "live".
 *  3 · LEARNING & DEVELOPMENT WENT LIVE ON 23-09-2026. Section C is the largest block
 *      of the form and every box in it now has a live screen behind it. It went from
 *      "no table of any kind" to merged-and-deployed in the two days after this form
 *      was transcribed — twice, because it was on a branch when this file was first
 *      corrected and on master an hour later. Nothing has been recorded in it yet.
 *  4 · BUILT IS NOT THE SAME AS IN USE, AND NEITHER IS THE SAME AS MISSING. Three
 *      different answers, three different bands, three different costs. Collapsing them
 *      is what made the first draft wrong.
 */
import type { FieldDef, ReportForm, SectionDef } from "./types";

const sections: SectionDef[] = [
  {
    code: "H",
    title: "Report header and week status",
    note: "Who the report is by, for and about, and the one-line verdict on the week.",
  },
  {
    code: "A",
    title: "Section A — Talent Acquisition",
    note: "The part of the form the hub can genuinely answer — New Recruitment carries the requisitions, the candidates and the interviews behind every box in it.",
  },
  {
    code: "B",
    title: "Section B — Passport To Orange (Onboarding)",
    note: "The Buddy Program went live on 22-09-2026, so the buddy, the induction, the connects and the joiner's rating all have a home now. None has been used yet — only the seeded test joiner has been through any of it.",
  },
  {
    code: "C",
    title: "Section C — Learning & Development",
    // ⚠ NO COUNT IN THIS SENTENCE. It first read "Twenty-five boxes" beside a banner
    //   that computes the number and prints 24 — the two disagreed on screen. Any count
    //   here has to come from the fields themselves.
    note: "Every box here has a live screen behind it. Learning & Development reached the hub on 23-09-2026, so this section stopped being a build and became a question of somebody using it.",
  },
  {
    code: "SK",
    title: "Special KPI Tracker — Year to Date",
    note: "The four annual commitments. All four read columns that exist on live screens today; not one of them is being filled in.",
  },
  {
    code: "Z",
    title: "Flags, actions, priorities and sign-off",
    note: "The end of the form is deliberately human — but the flags it asks for are exactly what live data is good at proposing.",
  },
];

/** The recruitment tables, named once so a rename shows up in one place. */
const REQ = "fms_hr_requisitions";
const CAND = "fms_hr_candidates";
const IVW = "fms_hr_interviews";
const ONB = "fms_hr_onboardings";
const CHK = "fms_hr_onboarding_checks";

/**
 * The sentence every Learning & Development box carries. Written once, on purpose — and
 * EXPORTED, because the two pages need it differently. The field map and its export show
 * each gap whole, so a row stands on its own in a spreadsheet; the rendered report states
 * it once in the Section C banner and strips it from the 24 boxes underneath, where
 * repeating it buried the box-specific half of every sentence.
 */
export const LD_GAP =
  "Learning & Development is LIVE on the hub — sessions, nominations, attendance, feedback, assignments and an annual plan. Nothing has been recorded in it yet, so Section C waits on somebody using it.";

const fields: FieldDef[] = [
  // ══ HEADER ═══════════════════════════════════════════════════════════════════
  {
    code: "H.1",
    section: "H",
    block: "Report header",
    label: "Period from – to",
    targetText: "Period: ____________ to ____________",
    kind: "date",
    coverage: "live",
    source: "The week chosen on this page. ISO Monday–Sunday, the same week the live KRA / KPI Scorecard uses.",
  },
  {
    code: "H.2",
    section: "H",
    block: "Report header",
    label: "Report date",
    targetText: "Report Date: ________________",
    kind: "date",
    coverage: "live",
    source: "Today, in India.",
  },
  {
    code: "H.3",
    section: "H",
    block: "Report header",
    label: "Prepared By",
    targetText: "Saloni Rathod, HR Executive",
    kind: "text",
    coverage: "live",
    source: "profiles + designations — the chosen person's own name and designation.",
  },
  {
    code: "H.4",
    section: "H",
    block: "Report header",
    label: "Reviewed By",
    targetText: "Riya Chauhan, HR Head",
    kind: "text",
    coverage: "live-partial",
    source: "user_hods — the reporting HOD of the chosen person.",
    gap: 'The hub\'s HR Head is recorded as "Riya Kumari"; the form names "Riya Chauhan". One of the two is wrong and only HR can say which. The report prints the hub\'s name and says so rather than quietly printing either.',
  },
  {
    code: "H.5",
    section: "H",
    block: "Report header",
    label: "Submitted To",
    targetText: "HR Head / Management",
    kind: "text",
    coverage: "narrative",
    source: "Fixed on the form.",
  },
  {
    code: "H.6",
    section: "H",
    block: "Report header",
    label: "Next Review",
    targetText: "Next Review: __________________",
    kind: "date",
    coverage: "no-table",
    source: "—",
    gap: "Nothing schedules the next review. The weekly report is not a record in the hub at all.",
  },
  {
    code: "H.7",
    section: "H",
    block: "Week status",
    label: "Week status — Green / Amber / Red",
    targetText: "WEEK STATUS: ● Green ▲ Amber ■ Red",
    kind: "text",
    coverage: "narrative",
    source: "A judgement. The page proposes one from the live flags and lets the reader overrule it.",
  },
  {
    code: "H.8",
    section: "H",
    block: "Week status",
    label: "One-line summary",
    targetText: "One-line summary: ______________",
    kind: "text",
    coverage: "narrative",
    source: "Free text, by design.",
  },

  // ══ A1 · KEY PERFORMANCE SNAPSHOT ════════════════════════════════════════════
  {
    code: "A1.1",
    section: "A",
    block: "A1 · Key Performance Snapshot",
    label: "Open Positions",
    targetText: "Live requisitions",
    kind: "count",
    coverage: "live-partial",
    source: `${REQ}.status in ('posting','sourcing') — the app's own isLivePosition().`,
    gap: 'A requisition is not a seat: some ask for several people. The form says "Live requisitions", so the count is requisitions — but the number HR argues about in a meeting is usually seats, and the box shows both so the question cannot be fudged.',
  },
  {
    code: "A1.2",
    section: "A",
    block: "A1 · Key Performance Snapshot",
    label: "Profiles Sourced",
    targetText: "Across all channels",
    kind: "count",
    coverage: "live",
    source: `${CAND}.uploaded_at inside the week. The channel is on source_platform_id, so the same count splits by platform whenever the form starts asking.`,
  },
  {
    code: "A1.3",
    section: "A",
    block: "A1 · Key Performance Snapshot",
    label: "Interviews Held",
    targetText: "All rounds",
    kind: "count",
    coverage: "live-partial",
    source: `${IVW}.held_at inside the week, all three rounds.`,
    gap: '`held_at` is written when a RESULT is recorded, not when the interview happens, and most interviews sit at "scheduled" with no result — so a week can show several scheduled and none held. The figure is not wrong; it answers "interviews closed out". The box prints both numbers so the difference is visible rather than alarming.',
  },
  {
    code: "A1.4",
    section: "A",
    block: "A1 · Key Performance Snapshot",
    label: "Positions Closed",
    targetText: "Candidate joined",
    kind: "count",
    coverage: "empty-table",
    source: `${REQ}.status = 'closed' with closed_at inside the week.`,
    gap: "No requisition has ever reached \"closed\" — every `closed_at` on record is a cancellation, so closures and cancellations read alike.",
  },
  {
    code: "A1.5",
    section: "A",
    block: "A1 · Key Performance Snapshot",
    label: "Offer-to-Join %",
    targetText: "Target: 85%+",
    kind: "percent",
    coverage: "empty-table",
    source: `${CAND}.joined_at over ${ONB}.offer_status = 'accepted'.`,
    gap: "Only the seeded test candidate has a joining ticked, so this reads near zero however many offers are accepted.",
  },

  // ══ A2 · RECRUITMENT FUNNEL, POSITION-WISE ═══════════════════════════════════
  {
    code: "A2.1",
    section: "A",
    block: "A2 · Recruitment Funnel — Position-wise",
    label: "Position",
    targetText: "",
    kind: "text",
    coverage: "live",
    source: `${REQ}.job_title (or job_title_id → fms_hr_job_titles), with mrf_no.`,
  },
  {
    code: "A2.2",
    section: "A",
    block: "A2 · Recruitment Funnel — Position-wise",
    label: "Dept.",
    targetText: "",
    kind: "text",
    coverage: "live",
    source: `${REQ}.department_id → departments.name.`,
  },
  {
    code: "A2.3",
    section: "A",
    block: "A2 · Recruitment Funnel — Position-wise",
    label: "Sourced",
    targetText: "Benchmark per open position: 15 sourced",
    kind: "count",
    coverage: "live",
    source: `${CAND} rows on the requisition, uploaded_at not null.`,
  },
  {
    code: "A2.4",
    section: "A",
    block: "A2 · Recruitment Funnel — Position-wise",
    label: "Screened",
    targetText: "Benchmark per open position: 8 screened",
    kind: "count",
    coverage: "live-partial",
    source: `${CAND}.hr_shortlisted_at — HR's screening pass, and the most reliably filled timestamp in the table.`,
    gap: "There is no separate screening event — HR's shortlist IS the pass, so a CV nobody has opened counts as sourced, not screened.",
  },
  {
    code: "A2.5",
    section: "A",
    block: "A2 · Recruitment Funnel — Position-wise",
    label: "Shortlisted",
    targetText: "Benchmark per open position: 5 shortlisted",
    kind: "count",
    coverage: "live-partial",
    source: `${CAND}.hod_decided_at — the HOD's decision on a screened profile.`,
    gap: "`hod_decided_at` is stamped for a rejection too, so the column means \"the HOD decided\", not \"shortlisted\".",
  },
  {
    code: "A2.6",
    section: "A",
    block: "A2 · Recruitment Funnel — Position-wise",
    label: "Interviewed",
    targetText: "Benchmark per open position: 3 interviewed",
    kind: "count",
    coverage: "live",
    source: `${IVW}: distinct candidates with at least one interview on the requisition.`,
  },
  {
    code: "A2.7",
    section: "A",
    block: "A2 · Recruitment Funnel — Position-wise",
    label: "Selected",
    targetText: "",
    kind: "count",
    coverage: "live",
    source: `${CAND}.finalized_at — the offer decision, which also carries the offered CTC.`,
  },

  // ══ A3 · POSITION STATUS & AGEING ════════════════════════════════════════════
  {
    code: "A3.1",
    section: "A",
    block: "A3 · Position Status & Ageing",
    label: "Requisition Date",
    targetText: "",
    kind: "date",
    coverage: "live",
    source: `${REQ}.request_date.`,
  },
  {
    code: "A3.2",
    section: "A",
    block: "A3 · Position Status & Ageing",
    label: "Days Open",
    targetText: "Flag any position open beyond 45 days.",
    kind: "days",
    coverage: "live",
    source: `Today − ${REQ}.request_date, for a position that has not closed.`,
  },
  {
    code: "A3.3",
    section: "A",
    block: "A3 · Position Status & Ageing",
    label: "Stage",
    targetText: "Sourcing | Screening | Interview | Offer | BGV | Joined",
    kind: "text",
    coverage: "live-partial",
    source: `${REQ}.current_step, and the furthest stage its candidates have reached.`,
    gap: "The form's six stages are not the hub's. This is derived from the candidates' own stages, and HR should confirm the mapping.",
  },
  {
    code: "A3.4",
    section: "A",
    block: "A3 · Position Status & Ageing",
    label: "Status",
    targetText: "",
    kind: "text",
    coverage: "live",
    source: `${REQ}.status, printed with the app's own wording (Collecting CVs, Ready to post, On hold, Closed, Cancelled).`,
  },
  {
    code: "A3.5",
    section: "A",
    block: "A3 · Position Status & Ageing",
    label: "Beyond 45 days — flagged",
    targetText: "Flag any position open beyond 45 days.",
    kind: "count",
    coverage: "live",
    source: "Derived from the request date on each live position. The block heading prints the count and the oldest, live.",
  },

  // ══ A4 · OFFERS, BGV & JOINING ═══════════════════════════════════════════════
  {
    code: "A4.1",
    section: "A",
    block: "A4 · Offers, BGV & Joining",
    label: "Candidate",
    targetText: "",
    kind: "text",
    coverage: "live",
    source: `${CAND}.name via ${ONB}.candidate_id.`,
  },
  {
    code: "A4.2",
    section: "A",
    block: "A4 · Offers, BGV & Joining",
    label: "Position",
    targetText: "",
    kind: "text",
    coverage: "live",
    source: `${ONB}.requisition_id → ${REQ}.job_title.`,
  },
  {
    code: "A4.3",
    section: "A",
    block: "A4 · Offers, BGV & Joining",
    label: "Offer Date",
    targetText: "",
    kind: "date",
    coverage: "empty-table",
    source: `${CHK} where item_key = 'offer_letter_sent' → done_at.`,
    gap: "Ticked on the test onboarding only. `offer_decided_at` sits close by and is a different date — when the candidate answered.",
  },
  {
    code: "A4.4",
    section: "A",
    block: "A4 · Offers, BGV & Joining",
    label: "CTC (Rs.)",
    targetText: "",
    kind: "money",
    coverage: "live",
    source: `${CAND}.offered_ctc — written when the offer is finalised.`,
  },
  {
    code: "A4.5",
    section: "A",
    block: "A4 · Offers, BGV & Joining",
    label: "BGV Status",
    targetText: "",
    kind: "text",
    coverage: "empty-table",
    source: `${ONB}.bgv_status — pending / clear / discrepancy.`,
    gap: "The column carries a real discrepancy state, so BGV is no longer a bare tick. Only the test onboarding has ever been set.",
  },
  {
    code: "A4.6",
    section: "A",
    block: "A4 · Offers, BGV & Joining",
    label: "Joining Date",
    targetText: "",
    kind: "date",
    coverage: "live",
    source: `${ONB}.joining_date — set when the offer is accepted.`,
  },
  {
    code: "A4.7",
    section: "A",
    block: "A4 · Offers, BGV & Joining",
    label: "Joined (Y/N)",
    targetText: "",
    kind: "text",
    coverage: "empty-table",
    source: `${CAND}.joined_at.`,
    gap: "Set on the test seed only, so a real joiner still reads N — and a no-show looks the same as an untouched record.",
  },

  // ══ B1 · PASSPORT SNAPSHOT ═══════════════════════════════════════════════════
  {
    code: "B1.1",
    section: "B",
    block: "B1 · Key Performance Snapshot",
    label: "New Joiners",
    targetText: "This period",
    kind: "count",
    coverage: "live-partial",
    source: `${ONB}.joining_date inside the week.`,
    gap: "This is joiners EXPECTED, not arrived: `joined_at` is set on the test seed alone, so the hub knows who was due, not who came.",
  },
  {
    code: "B1.2",
    section: "B",
    block: "B1 · Key Performance Snapshot",
    label: "Buddy Assigned",
    targetText: "Before Day 1",
    kind: "count",
    coverage: "empty-table",
    source: `fms_hr_buddies.allocated_at against ${ONB}.joining_date.`,
    gap: "Live since 22-09-2026 with its own screen. The figure waits on HR allocating buddies, not on a build.",
  },
  {
    code: "B1.3",
    section: "B",
    block: "B1 · Key Performance Snapshot",
    label: "Induction ≤ 15 Days",
    targetText: "% of joiners",
    kind: "percent",
    coverage: "empty-table",
    source: `${ONB}.induction_on, written by the fms_hr_set_induction RPC.`,
    gap: "The date exists and the 15-day test runs off it. It waits on inductions being recorded.",
  },
  {
    code: "B1.4",
    section: "B",
    block: "B1 · Key Performance Snapshot",
    label: "Connects Completed",
    targetText: "Signed off",
    kind: "count",
    coverage: "empty-table",
    source: "fms_hr_buddy_interactions, against fms_hr_buddies.interaction_target.",
    gap: "Interactions are logged and confirmed, but carry no department — the form's eight departmental connects need that one column.",
  },
  {
    code: "B1.5",
    section: "B",
    block: "B1 · Key Performance Snapshot",
    label: "Joiner Rating /5",
    targetText: "Target: 4+",
    kind: "rating",
    coverage: "empty-table",
    source: "fms_hr_buddies.feedback_rating, written by the fms_hr_rate_buddy RPC.",
    gap: "The joiner's rating has a home and a screen. It waits on joiners being asked.",
  },

  // ══ B2 · JOINER-WISE PASSPORT TRACKER ════════════════════════════════════════
  {
    code: "B2.1",
    section: "B",
    block: "B2 · Joiner-wise Passport Tracker",
    label: "Joiner",
    targetText: "",
    kind: "text",
    coverage: "live",
    source: `${CAND}.name via ${ONB}.`,
  },
  {
    code: "B2.2",
    section: "B",
    block: "B2 · Joiner-wise Passport Tracker",
    label: "Dept.",
    targetText: "",
    kind: "text",
    coverage: "live",
    source: `${REQ}.department_id → departments.name, through the onboarding's requisition.`,
  },
  {
    code: "B2.3",
    section: "B",
    block: "B2 · Joiner-wise Passport Tracker",
    label: "Date of Joining",
    targetText: "",
    kind: "date",
    coverage: "live",
    source: `${ONB}.joining_date.`,
  },
  {
    code: "B2.4",
    section: "B",
    block: "B2 · Joiner-wise Passport Tracker",
    label: "Buddy",
    targetText: "",
    kind: "text",
    coverage: "empty-table",
    source: "fms_hr_buddies.buddy_user_id.",
    gap: "Same as B1.2 — live since 22-09-2026, not yet used.",
  },
  {
    code: "B2.5",
    section: "B",
    block: "B2 · Joiner-wise Passport Tracker",
    label: "Induction ≤ 15 Days",
    targetText: "",
    kind: "text",
    coverage: "empty-table",
    source: `${ONB}.induction_on.`,
    gap: "Same as B1.3 — the date exists and is not being filled.",
  },
  {
    code: "B2.6",
    section: "B",
    block: "B2 · Joiner-wise Passport Tracker",
    label: "Connects (of 8)",
    targetText: "Each department connect counts only when signed off in the passport by the person met. Passport closes at Day 90.",
    kind: "count",
    coverage: "empty-table",
    source: "fms_hr_buddy_interactions, per buddy.",
    gap: "Same as B1.4 — the count is there, the department each connect belongs to is not.",
  },
  {
    code: "B2.7",
    section: "B",
    block: "B2 · Joiner-wise Passport Tracker",
    label: "30 / 90-Day Review",
    targetText: "Passport closes at Day 90.",
    kind: "text",
    coverage: "empty-table",
    source: "fms_hr_probation_checkins — day_no 7 / 15 / 30 / 60 / 90, each with an HOD side and a joiner side.",
    gap: "Day 30 and Day 90 are exact rows, not a month number. Only the test probation has any.",
  },

  // ══ C1 · L&D SNAPSHOT ════════════════════════════════════════════════════════
  {
    code: "C1.1",
    section: "C",
    block: "C1 · Key Performance Snapshot",
    label: "Sessions Held",
    targetText: "Training sessions",
    kind: "count",
    coverage: "empty-table",
    source: "fms_ld_sessions — status and outcome per session.",
    gap: LD_GAP,
  },
  {
    code: "C1.2",
    section: "C",
    block: "C1 · Key Performance Snapshot",
    label: "Total Hours",
    targetText: "Hrs delivered",
    kind: "count",
    coverage: "empty-table",
    source: "fms_ld_sessions.hours.",
    gap: LD_GAP,
  },
  {
    code: "C1.3",
    section: "C",
    block: "C1 · Key Performance Snapshot",
    label: "Participants",
    targetText: "Total enrolled",
    kind: "count",
    coverage: "empty-table",
    source: "fms_ld_attendance — one row per employee per session.",
    gap: LD_GAP,
  },
  {
    code: "C1.4",
    section: "C",
    block: "C1 · Key Performance Snapshot",
    label: "Attendance %",
    targetText: "Avg attendance",
    kind: "percent",
    coverage: "empty-table",
    source: "fms_ld_attendance.status over fms_ld_nominations.",
    gap: "Attendance has five states, so the partials need a rule before a percentage is safe.",
  },
  {
    code: "C1.5",
    section: "C",
    block: "C1 · Key Performance Snapshot",
    label: "Avg Feedback /5",
    targetText: "Effectiveness",
    kind: "rating",
    coverage: "empty-table",
    source: "fms_ld_feedback.overall_rating.",
    gap: LD_GAP,
  },

  // ══ C2 · TRAINING MIX ════════════════════════════════════════════════════════
  // The only block in Section C where the form states hard monthly targets. They are
  // worth transcribing even with no actuals: they are the specification for the module.
  {
    code: "C2.1",
    section: "C",
    block: "C2 · Training Mix — External Agency vs Technical",
    label: "External consultant / agency training",
    targetText: "Minimum 3 per month",
    kind: "count",
    coverage: "empty-table",
    source: "fms_ld_sessions.session_type_ids against fms_ld_session_types.",
    gap: LD_GAP,
  },
  {
    code: "C2.2",
    section: "C",
    block: "C2 · Training Mix — External Agency vs Technical",
    label: "Technical training",
    targetText: "Minimum 2 per month",
    kind: "count",
    coverage: "empty-table",
    source: "fms_ld_sessions.session_type_ids against fms_ld_session_types.",
    gap: LD_GAP,
  },
  {
    code: "C2.3",
    section: "C",
    block: "C2 · Training Mix — External Agency vs Technical",
    label: "Other internal sessions",
    // The form prints "—" in this cell, which MEANS no target. Stored as empty so the
    // field map can say "the form states none" and the box omits the line entirely,
    // rather than printing a dash that looks like a value.
    targetText: "",
    kind: "count",
    coverage: "empty-table",
    source: "fms_ld_sessions.session_type_ids against fms_ld_session_types.",
    gap: LD_GAP,
  },
  {
    code: "C2.4",
    section: "C",
    block: "C2 · Training Mix — External Agency vs Technical",
    label: "Total sessions",
    targetText: "Minimum 5 per month",
    kind: "count",
    coverage: "empty-table",
    source: "fms_ld_sessions, counted once.",
    gap: "The form's rule — an external technical session counts on both lines and once in the total — works because the type is a set.",
  },
  {
    code: "C2.5",
    section: "C",
    block: "C2 · Training Mix — External Agency vs Technical",
    label: "Month to date, and variance",
    targetText: "Month to Date | Variance",
    kind: "count",
    coverage: "empty-table",
    source: "fms_ld_plan_lines.planned_headcount / planned_hours against the sessions held.",
    gap: "The annual plan carries the target per month, so the variance is arithmetic.",
  },

  // ══ C3 · SESSION-WISE SUMMARY ════════════════════════════════════════════════
  {
    code: "C3.1",
    section: "C",
    block: "C3 · Session-wise Summary",
    label: "Session / Topic, Trainer / Agency, Date",
    targetText: "",
    kind: "text",
    coverage: "empty-table",
    source: "fms_ld_sessions + fms_ld_trainers — title, trainer or agency, date.",
    gap: LD_GAP,
  },
  {
    code: "C3.2",
    section: "C",
    block: "C3 · Session-wise Summary",
    label: "Type",
    targetText: "External Agency | Technical | Internal | Mandatory / Statutory | Induction",
    kind: "text",
    coverage: "empty-table",
    source: "fms_ld_sessions.session_type_ids.",
    gap: "A set, not a single value — so one session can be two types, as the form's counting rule requires.",
  },
  {
    code: "C3.3",
    section: "C",
    block: "C3 · Session-wise Summary",
    label: "Participants, Hours, Feedback /5",
    targetText: "",
    kind: "count",
    coverage: "empty-table",
    source: "fms_ld_attendance, fms_ld_sessions.hours, fms_ld_feedback.",
    gap: LD_GAP,
  },

  // ══ C4 · ATTENDANCE & ASSIGNMENTS ════════════════════════════════════════════
  {
    code: "C4.1",
    section: "C",
    block: "C4 · Attendance & Assignments",
    label: "Participants nominated",
    targetText: "",
    kind: "count",
    coverage: "empty-table",
    source: "fms_ld_nominations — proposed / approved / rejected / withdrawn.",
    gap: LD_GAP,
  },
  {
    code: "C4.2",
    section: "C",
    block: "C4 · Attendance & Assignments",
    label: "Participants attended",
    targetText: "",
    kind: "count",
    coverage: "empty-table",
    source: "fms_ld_attendance.status = 'present'.",
    gap: LD_GAP,
  },
  {
    code: "C4.3",
    section: "C",
    block: "C4 · Attendance & Assignments",
    label: "Attendance %",
    targetText: "Target: min. 85%",
    kind: "percent",
    coverage: "empty-table",
    source: "fms_ld_attendance over fms_ld_nominations.",
    gap: LD_GAP,
  },
  {
    code: "C4.4",
    section: "C",
    block: "C4 · Attendance & Assignments",
    label: "Absentees followed up within 24 hrs",
    targetText: "Within 24 hrs",
    kind: "count",
    coverage: "empty-table",
    source: "fms_ld_attendance.followed_up_at against the session date.",
    gap: "The follow-up is timestamped, so the 24-hour test is exact rather than a judgement.",
  },
  {
    code: "C4.5",
    section: "C",
    block: "C4 · Attendance & Assignments",
    label: "Assignments shared within 24 hrs of session",
    targetText: "Within 24 hrs of session",
    kind: "count",
    coverage: "empty-table",
    source: "fms_ld_assignments.issued_at against the session date.",
    gap: LD_GAP,
  },
  {
    code: "C4.6",
    section: "C",
    block: "C4 · Attendance & Assignments",
    label: "Assignments submitted on time",
    targetText: "Target: min. 80%",
    kind: "percent",
    coverage: "empty-table",
    source: "fms_ld_assignment_submissions.submitted_at against fms_ld_assignments.due_at.",
    gap: LD_GAP,
  },
  {
    code: "C4.7",
    section: "C",
    block: "C4 · Attendance & Assignments",
    label: "Pending submissions escalated to HOD",
    targetText: "",
    kind: "count",
    coverage: "empty-table",
    source: "fms_ld_assignment_submissions.escalated_at.",
    gap: LD_GAP,
  },

  // ══ C5 · LEARNING HOURS & MANDATORY TRAINING ═════════════════════════════════
  {
    code: "C5.1",
    section: "C",
    block: "C5 · Learning Hours & Mandatory Training",
    label: "Learning hours delivered",
    targetText: "",
    kind: "count",
    coverage: "empty-table",
    source: "fms_ld_sessions.hours across fms_ld_attendance.",
    gap: LD_GAP,
  },
  {
    code: "C5.2",
    section: "C",
    block: "C5 · Learning Hours & Mandatory Training",
    label: "Learning hours per employee",
    targetText: "10 hrs / year",
    kind: "count",
    coverage: "empty-table",
    source: "the same hours over headcount from profiles.",
    gap: LD_GAP,
  },
  {
    code: "C5.3",
    section: "C",
    block: "C5 · Learning Hours & Mandatory Training",
    label: "Mandatory & statutory training completion",
    targetText: "100%",
    kind: "percent",
    coverage: "empty-table",
    source: "fms_ld_mandatory_programs + fms_ld_attendance.",
    gap: "The programme list exists; who each one applies to still has to be set, or the denominator is a guess.",
  },
  {
    code: "C5.4",
    section: "C",
    block: "C5 · Learning Hours & Mandatory Training",
    label: "Certifications due for renewal",
    targetText: "Zero overdue",
    kind: "count",
    coverage: "no-table",
    source: "—",
    gap: "L&D records training, not certificates. Nothing holds a certificate with an expiry per person — the Asset register does exactly that shape for insurance.",
  },

  // ══ SPECIAL KPI TRACKER — YEAR TO DATE ═══════════════════════════════════════
  {
    code: "SK-1",
    section: "SK",
    block: "Special KPI Tracker — Year to Date",
    label: "25 positions closed in the year",
    targetText: "25 closed with candidates joined",
    kind: "count",
    coverage: "empty-table",
    source: `${REQ}.status = 'closed' within the year, cross-checked against ${CAND}.joined_at.`,
    gap: "A zero means \"nobody has ticked a closure\", not \"nobody was hired\" — offers have been accepted against these positions.",
  },
  {
    code: "SK-2",
    section: "SK",
    block: "Special KPI Tracker — Year to Date",
    label: "Induction complete within 15 days",
    targetText: "100% of joiners",
    kind: "percent",
    coverage: "empty-table",
    source: `${ONB}.induction_on within 15 days of joining_date.`,
    gap: "The test runs end to end now. It waits on inductions being recorded.",
  },
  {
    code: "SK-3",
    section: "SK",
    block: "Special KPI Tracker — Year to Date",
    label: "10 learning hours per employee",
    targetText: "10 hrs; avg rating 4 of 5",
    kind: "count",
    coverage: "empty-table",
    source: "fms_ld_sessions.hours over headcount, year to date.",
    gap: LD_GAP,
  },
  {
    code: "SK-4",
    section: "SK",
    block: "Special KPI Tracker — Year to Date",
    label: "Monthly probation analysis to Management",
    targetText: "12 of 12 months submitted",
    kind: "count",
    coverage: "empty-table",
    source: "fms_hr_probations + fms_hr_probation_checkins.",
    gap: "The probation record exists. Nothing marks a monthly pack as SENT to Management, which is what the form counts.",
  },

  // ══ FLAGS, ACTIONS, PRIORITIES, SIGN-OFF ═════════════════════════════════════
  // The form prints six example flags. Five of them are things live data could raise by
  // itself, which is the most useful thing in the whole document — so each is its own
  // field rather than one "Flags" box.
  {
    code: "Z.1",
    section: "Z",
    block: "Highlight / Flag",
    label: "Position ageing beyond 45 days",
    targetText: "e.g. Position ageing beyond 45 days",
    kind: "count",
    coverage: "live",
    source: `Derived from ${REQ}.request_date on live positions. Five are past 45 days today.`,
  },
  {
    code: "Z.2",
    section: "Z",
    block: "Highlight / Flag",
    label: "Offer drop or no-show",
    targetText: "e.g. Offer drop or no-show",
    kind: "count",
    coverage: "empty-table",
    source: `${ONB}.offer_status = 'declined', and a joining date passed with ${CAND}.joined_at still null.`,
    gap: "A drop is readable — `offer_status` carries declined and no_show. A no-show is not, because no joining is ever ticked.",
  },
  {
    code: "Z.3",
    section: "Z",
    block: "Highlight / Flag",
    label: "BGV discrepancy",
    targetText: "e.g. BGV discrepancy",
    kind: "count",
    coverage: "empty-table",
    source: `${ONB}.bgv_status = 'discrepancy'.`,
    gap: "The state exists and is unused, so a discrepancy can be neither raised nor ruled out.",
  },
  {
    code: "Z.4",
    section: "Z",
    block: "Highlight / Flag",
    label: "Buddy not assigned before Day 1",
    targetText: "e.g. Buddy not assigned before Day 1",
    kind: "count",
    coverage: "empty-table",
    source: "fms_hr_buddies.allocated_at against the joining date.",
    gap: "Both dates exist, so the flag is exact the moment buddies start being allocated.",
  },
  {
    code: "Z.5",
    section: "Z",
    block: "Highlight / Flag",
    label: "Low-score session under review",
    targetText: "e.g. Low-score session under review",
    kind: "count",
    coverage: "empty-table",
    source: "fms_ld_feedback.overall_rating + fms_ld_sessions.review_note.",
    gap: "The form states no threshold — 4 of 5, its other feedback target, is the obvious candidate.",
  },
  {
    code: "Z.6",
    section: "Z",
    block: "Highlight / Flag",
    label: "Mandatory training overdue",
    targetText: "e.g. Mandatory training overdue",
    kind: "count",
    coverage: "empty-table",
    source: "fms_ld_mandatory_programs.cycle against attendance.",
    gap: LD_GAP,
  },
  {
    code: "Z.7",
    section: "Z",
    block: "Pending Actions from Last Week",
    label: "Pending action, Owner, Due Date, Status",
    targetText: "",
    kind: "text",
    coverage: "no-table",
    source: "—",
    gap: "Task Management already holds the action, the owner and the due date. Nothing ties a task to a week's review, so rows cannot carry forward.",
  },
  {
    code: "Z.8",
    section: "Z",
    block: "Key Priorities for Next Week",
    label: "Five key priorities for next week",
    targetText: "",
    kind: "text",
    coverage: "narrative",
    source: "Free text, by design — this is the author's plan, not a measurement.",
  },
  {
    code: "Z.9",
    section: "Z",
    block: "Sign-off",
    label: "HR Executive / HR Head / Management signature and date",
    targetText: "Signature: ______________ Date: ______________",
    kind: "text",
    coverage: "narrative",
    source: "Three signatures on a printed page.",
    gap: undefined,
  },
];

export const weeklyReviewForm: ReportForm = {
  id: "saloni-weekly-review",
  role: "HR Executive — Talent Acquisition & Learning and Development",
  source: "Weekly_Review_Report_TA_LD.docx · blank form, 37 tables · Prepared By Saloni Rathod, Reviewed By Riya Chauhan",
  sections,
  fields,
};
