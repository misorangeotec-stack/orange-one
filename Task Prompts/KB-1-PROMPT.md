# KB-1 · Knowledge Base (HR Handbook) · action plan

*Written 28-09-2026 and re-audited the same day, against `HR_Handbook_Formatted_v4.doc` (last saved
05-08-2026) and the live identity project `icutjkrqkbzwvmnfbzpr`. Every file path, line number and table name
below was checked against the working tree and the live database, not recalled.*

*This supersedes the "vector database with a RAG system" framing in `WORKLIST.md` → `### KB-1` for **this
scope**. See §3, which is the one place this plan deliberately departs from what that entry assumed.*

---

## 0 · Decisions taken, 28-09-2026

Settled with the user. **Do not reopen these.**

| Question | Answer |
|---|---|
| Where people ask | **Inside the Orange One portal only.** ⚠ **ASKING is not a left-menu item and not a page:** a **floating chat bubble on every screen**. No WhatsApp, no mobile app. ⚠ Amended 30-09-2026: **READING** the manual now DOES have a menu row (§6), because being unable to browse it was the first thing raised once staff saw the module |
| Seeing the source | **The chat widens into a two-pane overlay**: conversation on the left, the live handbook on the right at that section, highlighted and scrollable |
| The draft travel chapter | **Answer straight from the handbook.** Its own text says *"proposed values… require Director confirmation"*, so answering from it carries the caveat without our adding one. No special refusal, no extra banner (see §2a for the one place this is not enough) |
| Model | **`claude-sonnet-5`**, about ₹1,500/month. Same model `analyze-receivables` already uses. Behind a secret, so it is a one-minute switch if ratings sour |
| When not covered | **Say so, and offer "Send this question to HR"**, saved to a list HR can open and answer |

Decided by me, say if you disagree: **reading needs no grant** (every staff member, never customers), the
`knowledge-base` grant means *"may manage"* only and **is granted to nobody** until you name people, and
**questions are logged without the asker's name** unless they press *Send to HR* (§7, and read that one).

---

## 1 · The one-paragraph version

On any screen in the hub there is a small **Ask HR** bubble in the corner. An employee clicks it, types
*"how many paid leaves do I get?"* in their own words, and gets a three-line answer with a reference reading
**Chapter 4 · Leave Policy → Types of Leave**. Clicking that reference **widens the bubble into a two-pane
overlay**. Their conversation stays on the left, the real handbook opens on the right at that exact section,
highlighted, and they can scroll the whole manual from there. They never leave the screen they were on, and
there is no new menu item anywhere. The answer never comes from the model's memory of the text: the model
returns **section numbers**, and the panel renders our own stored copy. If the handbook does not cover it, it
says so and offers to send the question to HR.

Behind it: **one table of 349 handbook sections, one Edge Function, one widget.** No vector database, no
embeddings, no chunk-size tuning, and no streaming.

---

## 2 · What I found in the handbook

| | |
|---|---|
| Size | **90 pages, 27,967 words, 349 sections** (35 chapter headings, 240 level-2, 74 level-3), **45 tables** |
| As tokens | **roughly 36,000 to 41,000** (143,058 characters of extracted text). ⚠ Estimated from character count. Confirm with `messages.count_tokens` in Phase 3; every cost figure in §9 moves with it |
| Structure | **Clean enough to chunk on.** Word heading styles are applied throughout. **9 paragraphs are mis-styled** as headings but are really prose (long, ending in a full stop), and the converter already demotes them |
| Chapters | 28 numbered chapters plus front matter: Code of Conduct, Recruitment, Attendance, **Leave**, Dress Code, Housekeeping, E-mail, Performance, Transfer, Compensation, Benefits, Training, Reward, **Loan & Advance**, **Travel**, Grievance, Discipline, Exit, Retirement, Conveyance, Visiting Card, Mobile, Insurance, Asset, BGV, InfoSec, **Separation & Notice**, **PIP/BIP**, **Uniform**, **Domestic Travel** |
| Images | **7 JPEGs, 5.4 MB of the 5.9 MB file.** ⚠ **SIX** carry real text extraction cannot see (first estimated at three): **Preface**, **Director's Desk**, **Organization Chart part 1**, **Organization Chart part 2**, **Designation Hierarchy**, and the back cover's **address and phone**. Only the front cover is decorative |
| Not in force | **18 `[⚠ CONFIRM]` markers** and a **41-row consolidated sign-off table**. Chapter 32 states in its own words that no rate is final until both Directors sign |

### Six content facts that will bite if ignored

**a) Chapter 32 contradicts itself, and it is the most-asked chapter.** §2 has two consecutive tables that
disagree on Band → Travel Category:

| | Table 10 says | Table 11 says |
|---|---|---|
| **Band 8** | TC-A Executive | TC-B (Bands 6, 7 & 8) |
| **Band 3** | TC-D Executive Staff | TC-C (Bands 3, 4 & 5) |

This is the **same H1 blocker holding Travel Desk off go-live** (`WORKLIST.md` → `### TR-1`), measured there at
**23 of 59 employees**. It matters here for a specific reason: everywhere else in Chapter 32 the handbook
warns about itself, so §0's "answer straight from the handbook" is enough. **Here it does not.** Nothing in
the text says the two tables disagree, so the model will pick one and sound certain. This is the single place
where an `in_force_note` is warranted, and §4 confines it to exactly these two sections.

**b) The rest of Chapter 32 flags itself.** Its rate tables contain no figures at all, only
`[⚠ CONFIRM — propose ₹1,500 to ₹2,000/night]` placeholders, above a box reading *"All rate caps below are
proposed values and require Director confirmation before they take effect."* Answering from the handbook
reproduces that. **Do not add a second warning layer on top; the user was explicit.**

**c) SIX of the seven images carry text, not three.** Corrected on 28-09-2026 after reading all seven. The
Preface, which reads *"This manual must be followed in all situations unless an exception is granted by the
management. This manual supersedes all previous personnel policies and procedures,"* exists **only as a
picture**. So does the **Organization Chart**, which runs to two pages and is the only thing in the document
that answers *"who handles grievances?"* or *"who do I ask about PF?"*; the **Designation Hierarchy**, the only
place the grade ladder and the four Directors' names appear; and the back cover, the only place the office
address and phone number appear. All six are transcribed in `frontend/scripts/handbook-image-text.json`.

**d) The handbook points at a system we do not own.** Leave is applied for via *"formal E-Mail / HR One App"*,
and National Holidays and Birthday Leave are *"on HR One App"*. The answer must say so and must never imply
the portal takes the request.

**e) Section boundaries inherit Word's mistakes.** In Chapter 4, `OBJECTIVE` is an empty heading, the objective
text sits under `PAID LEAVE (PL)`, and the paid-leave rules ("18 days… pro-rata", "up till 08 carried forward")
sit under `TYPES OF LEAVE`. **This is harmless here and would not be under RAG.** The model reads the whole
document, so a misplaced boundary costs nothing; it only means a citation sometimes lands on the neighbouring
heading. Do not "fix" the handbook's structure in the converter.

**f) ⚠ THE HANDBOOK CARRIES TWO TRAVEL POLICIES, AND NEITHER SUPERSEDES THE OTHER.** Found on 28-09-2026
while checking (a). This is larger than the band tables and was not in the first draft of this plan.

| | Chapter 15 · Travel and Accommodation Policy | Chapter 32 · Domestic Travel Policy |
|---|---|---|
| Size | 6 sections | 56 sections |
| Keyed on | **Grade**: Directors / C-Level / HODs & Senior | **Band** 1 to 9, mapped to TC-A…TC-D |
| A Director's hotel | **₹6,000 per night**, stated plainly | `[⚠ CONFIRM — propose ₹3,000 to ₹5,000]` |
| Reads as | In force | Explicitly a draft awaiting sign-off |

Neither chapter mentions the other. Chapter 32's own *"What This Policy Does NOT Cover"* box does not list
Chapter 15 either. Ask *"what hotel can I book?"* and the honest answer depends on which chapter you read.

**This also sharpens TR-1's H1.** Checking Annexure A settles which of §2's two tables is the odd one out:

| | §2 first table | §2 second table | Annexure A |
|---|---|---|---|
| Band 8 | TC-A | **TC-B** | TC-A |
| Band 3 | TC-D | **TC-C** | TC-D |

Two of the three agree; **§2's second table is the outlier**. That does not settle it (only the Directors
can), but it means the fix is likely a single table, not a redesign.

---

## 3 · Why there is no vector database here

`WORKLIST.md` → `### KB-1` calls for "a vector database with a RAG system", and notes correctly that **nothing
in the repo uses pgvector or embeddings, so that piece is genuinely new**. It was written against *"there are a
lot of HR documents"*. The scope now on the table is **one handbook**, and that changes the right answer.

The handbook is **about 40,000 tokens. The models we already call take 1,000,000.** The entire document fits in
a single prompt twenty-five times over. (pgvector 0.8.2 is available on the project but **not installed**, so
this would be a new extension, not a switch.)

| | Whole document in the prompt | RAG over pgvector |
|---|---|---|
| Can it miss a relevant passage? | **No.** The model sees every word | Yes, and a retrieval miss is silent. Nobody can tell a *"not in the handbook"* caused by a bad embedding from a real one |
| Cross-chapter questions, such as *"I'm resigning, what happens to my loan, my leave and my laptop?"*, spanning Chapters 4, 14, 25 and 28 | Answered | Depends on four separate chunks all ranking high enough |
| §2e's wonky section boundaries | Harmless | A real problem, because the chunk is the unit of retrieval |
| New parts to build | A converter and a prompt | pgvector, an embedding call, a chunking strategy, a re-embed trigger, an index, a relevance threshold |
| New ways to be wrong | The model | The model **and** the retriever |

**Retrieval is a compression technique for corpora that do not fit. This one fits.** Adding it here buys
nothing and adds a second, invisible failure mode to a system whose whole job is to be checkable.

**When RAG becomes the right answer:** once the corpus is roughly ten times this, meaning the SOPs, the KRA/KPI
packs and the department manuals, which is KB-1's original *"a lot of HR documents"*. The design below puts a
`document_id` on every section from day one and keeps the endpoint's contract identical, so that day is **one
step inserted inside the Edge Function** and **zero changes to the widget**. Do not pre-build it.

---

## 4 · Data model

Four tables. Additive only, per `CLAUDE.md`. Every migration gets its `_rollback.sql` twin, and the rollback is
**rehearsed, not just written**.

```
kb_documents          one row per handbook. id, slug, title, version, source_filename,
                      published_at, published_by, is_current
kb_sections           THE table. ~349 rows.
                      id, document_id, ordinal (document order), depth (1|2|3),
                      number ("4.3"), heading, path_text ("Chapter 4 · Leave Policy → Sick Leave"),
                      body (jsonb: ordered blocks of paragraph | bullets | table | image),
                      plain_text (body flattened, for search and for the prompt),
                      in_force_note (text, nullable), visibility (text, default 'all_staff')
kb_questions          id, asked_at, question, answer, cited_section_ids (uuid[]),
                      model, usage jsonb, covered bool, rating (+1/-1/null),
                      asked_by (uuid, NULLABLE - see §7), sent_to_hr bool, hr_answer text
kb_images             the 7 JPEGs. id, section_id, storage_path, alt_text, transcript
```

Three columns are doing quiet but important work:

- **`in_force_note`** is nullable and, at launch, **set on exactly two rows**: the two Chapter 32 §2 sections
  carrying the contradictory band tables (§2a). It reads *"These two tables disagree on which Travel Category
  each Band falls in. Awaiting Director confirmation (Annexure C)."* The prompt is told to surface it verbatim
  when citing such a section. ⚠ **There is no `in_force` boolean and Chapter 32 is not otherwise flagged.**
  An earlier draft of this plan flagged the whole chapter; that contradicted §0 and has been removed. The
  handbook warns about itself everywhere except here.
- **`visibility`** is `'all_staff'` for every row today. It exists so that the day a restricted document joins,
  nothing has to be re-ingested. One nullable column now beats the re-index KB-1 warns about.
- **`plain_text`** is what goes in the prompt; `body` is what the screen renders. Keeping them apart means the
  model reads clean prose while the reader gets real tables and images.

**RLS, explicitly:**

| Table | Read | Write |
|---|---|---|
| `kb_sections`, `kb_documents`, `kb_images` | any authenticated user where **`profiles.is_external` is false**; admins always | managers only (`knowledge-base` grant or admin) |
| `kb_questions` | **managers only.** No "own rows" read path is needed, because rows carry no name by default | insert by the Edge Function under the caller's JWT; `rating` updatable by the asker within the session |

⚠ **`database.types.ts` is a shared file** carrying other sessions' work. Edit it with the Edit tool, never
rewrite it whole, and stage only your own hunks.

---

## 5 · Getting the handbook in

**A converter script, run by a developer, not an in-app upload.** The handbook is a legal document revised once
or twice a year, and someone should read what changed before the portal starts quoting it.

The `.doc` is a legacy OLE binary, and Word converts it to `.docx` cleanly (verified: 2,663 paragraphs, 45
tables, 7 images, all recovered). From there a script walks `word/document.xml` and emits the section rows.
**This is already written and proven**, because it produced every figure in §2. It belongs in
**`frontend/scripts/`** (⚠ there is no `scripts/` at the repo root; the existing ones are `backup-db.mjs`,
`build-asset-template.mjs`, `ocpi-field-map.mjs` and friends), plus three additions:

1. **A diff report.** On re-run against a new handbook it prints *added / changed / removed* per section and
   refuses to publish until a human confirms. New `version`, old rows kept.
2. **The 7 images.** Extract, upload, and **transcribe once**, so the Preface and the Org Chart become ordinary
   sections carrying real text with the image shown alongside. Without this, three of the most-asked "who do I
   go to" questions have no answer. **Storage is an established pattern here**: `supabase.storage.from(BUCKET)`
   with `createSignedUrl(path, 60 * 10)`, used by `hr-recruitment`, `hr-exit`, `import` and `asset-maintenance`.
   Copy it; a new bucket is the only new thing.
3. **The mis-styled headings.** Print the 9 demoted paragraphs at the end of the run so a human can eyeball
   the list. Do not silently swallow them.

⚠ **Two Windows traps already hit while preparing this**, both now in `memory`: Word's `SaveAs` text format is
ANSI, so **₹ becomes `?`**, and the `.docx` XML must be read instead. And never `open("w")` a shared file in
place.

---

## 6 · The widget

⚠ **There is no "Ask HR" page, and ASKING has no menu item.** The user was explicit: a **floating bubble on
every screen**. Do not add a route for the bubble to the sidebar, the home launcher, or `homeNav`.

⚠ **Amended 30-09-2026: READING the manual DOES now have one.** `/handbook/read` is reached from an
**HR Handbook** row under Home in `homeNav.tsx`, from **Open the handbook** in the bubble header, and from a
citation chip. The original rule was about ASKING; it was reversed for reading after the first real use,
because somebody who simply wanted to browse the handbook had no route to it at all.

### Where it mounts, and why not in `AppShell`

**Mount it once in `App.tsx`, as a sibling of `<Routes>`:**

```tsx
export default function App() {
  return (
    <>
      <Routes>…</Routes>
      <AskHrBubble />   {/* position: fixed; renders null unless signed in and not external */}
    </>
  );
}
```

`SessionProvider` wraps `App` (see `main.tsx`), so `useSession()` is available there. `App.tsx`'s own
`StaffOnly` already reads `const { isExternal, isAdmin } = useSession()`, so the bubble reuses that test.

**`AppShell` was the obvious home and is the wrong one.** Three reasons, all checked:

1. **The thread would not survive navigation.** Each app renders its own layout, which renders its own
   `AppShell`; moving from Task Management to New Recruitment unmounts one and mounts another, losing the
   conversation. Mounted beside `<Routes>`, the widget never unmounts.
2. **`/account` does not use `AppShell`.** PF-18's announcement strip has that gap today. Mounting at `App`
   level closes it for free rather than inheriting it.
3. **`AppShell.tsx` is a shared file** that other sessions are editing. Not touching it avoids a merge
   entirely.

A fixed-position element does not need to sit inside the shell's DOM, so nothing is lost. **Do not edit
`AppShell.tsx` for this.**

### Collapsed → open → wide

Three states, one component:

1. **Bubble.** Small, bottom-right, on every screen. Does nothing until clicked.
2. **Open.** A chat panel. One input, placeholder *"Ask anything: leave, travel, notice period,
   reimbursements…"*, and **six suggested questions** so nobody faces an empty box (paid leave entitlement,
   notice period, sick leave, loan eligibility, mobile reimbursement, marriage leave). Answers are **three or
   four lines**, then the references as clickable chips reading `Chapter 4 · Leave Policy → Sick Leave`.
   Follow-ups stay in the thread, so *"and if it's an emergency?"* works. 👍 / 👎 on every answer: the
   cheapest thing here and the most valuable, because it is how HR learns which policies read badly.
3. **Wide.** Clicking a chip **expands the panel into a two-pane overlay**: the conversation keeps the left,
   the handbook takes the right, opened at that section and **highlighted**, with the rest of the manual
   scrollable above and below. A chapter list allows browsing from there, and a text search box serves anyone
   who would rather scan than ask. Closing returns to the chat with the thread intact.
   ⚠ **On a phone, stack instead of splitting**: the handbook replaces the chat with a back arrow. Two panes
   below roughly 900px is unusable, and field staff are the ones most likely to be on a phone.

**Keep one deep-link route, out of every menu:** `/handbook/read#4-3`, shaped as "staff furniture" like
`/announcements` and `/my-probation` (`App.tsx:118-147`): `RequireAuth` plus `StaffOnly` plus `HomeLayout`.
Nothing in the UI links to it. It exists so HR can paste a section link into an email, and it renders the same
pane as state 3.

⚠ **No markdown renderer in this bundle.** Render from the `body` jsonb as React components, and do not add a
markdown library.

⚠ **Correction, 28-09-2026: DOMPurify IS in the bundle**, contrary to an earlier draft of this plan. Version
3.4.7 arrives as an **optional dependency of `jspdf`**; it is not a direct dependency and nothing in `src`
imports it. That changes nothing about the instruction and makes it more pressing: a sanitiser being within
reach is exactly what makes `dangerouslySetInnerHTML` look like a shortcut. The handbook is stored as
structured blocks precisely so no HTML is ever built, sanitised or injected. **Do not import it.**

### "Send this question to HR"

When the model returns `covered: false`, the panel says so plainly, shows the nearest section if there is one,
and offers **Send this question to HR**. Pressing it sets `sent_to_hr = true` **and stamps `asked_by`** (§7).
No email in v1.

---

## 7 · Who sees what people asked ⚠ read this one

`kb_questions` is the module's most useful screen and its biggest risk. This handbook's chapters include
**sexual harassment, grievance, maternity, PIP/BIP, exit and notice period, loans**. A log that tells HR
*"Priya asked about maternity leave"* or *"Rahul asked what the notice period is"* is a resignation signal and
a pregnancy disclosure, recorded without consent. **It would suppress use of exactly the policies people most
need to look up privately, which is the reason for building this.**

**Default in this plan: questions are logged anonymously.** `asked_by` stays `NULL` unless the person presses
*Send this question to HR*, which is them choosing to be identified so HR can reply.

HR loses nothing that matters. The list they need is *"what are people asking that the handbook does not
answer"*, and that is intact. What they lose is the ability to see who asked what, which is the part that
should not exist.

**Tell me if you want it the other way.** It is one nullable column either way, but it must be decided before
Phase 3 collects real questions, because a log that started with names cannot be un-rung.

---

## 8 · The answer endpoint

A new Edge Function, `ask-handbook`, deployed to `icutjkrqkbzwvmnfbzpr` alongside the **seven** that already
call Claude (`analyze-receivables`, `parse-jd`, `parse-resume`, `score-candidate`, `extract-card`,
`extract-travel-doc`, `transcribe-voice`). `verify_jwt = true`. **`ANTHROPIC_API_KEY` is already set on that
project** and all seven read it, so there is nothing to provision.

It follows the contract those seven share, which `WORKLIST.md` → `### KB-1` already identified as the thing to
copy: **the browser sends the question and the thread, nothing else**, and the function reads `kb_sections`
server-side and builds the prompt itself. The browser never sees a key and never chooses what the model reads.

**Shape of the call**, using `npm:@anthropic-ai/sdk` as every other function here does:

- **System prompt.** The whole handbook as `plain_text`, section by section, each prefixed with its id and
  `path_text`. Marked `cache_control: {type: "ephemeral"}` at the default 5-minute TTL, which makes follow-ups
  within one conversation nearly free. **No keep-alive and no 1-hour TTL**: at this volume the doubled write
  price costs more than the misses it saves.
- **Structured output** (`output_config.format`) for `{answer, section_ids[], covered}`, so the screen never
  parses prose.
- **`effort: "low"`, and NO streaming.** This is extraction-with-citation over a document, not hard reasoning,
  and low effort is both faster and cheaper. ⚠ **Streaming was in the previous draft and has been dropped
  deliberately**: structured output streams as half-built JSON, so the UI would have to parse partial JSON to
  show anything, and a streaming proxy would also have to be proved against the Supabase Edge Function CPU
  ceiling (about 2 s cumulative, and yielding does not reset it). A spinner over a three-to-six second answer
  costs the user nothing and removes both problems. Revisit only if real answers feel slow.
- **Rules in the system prompt.** Answer only from the sections given. Three or four lines, plain English, no
  legalese. Always return the ids used. If it is not covered, say so and return no ids. If a cited section
  carries an `in_force_note`, **quote it**. Never imply the portal handles a leave or travel request, because
  the handbook names *HR One App* and e-mail. Decline politely and return no ids for anything that is not an
  HR question.
- **Answer in the language asked.** Staff here span Band 1 (drivers, pantry, housekeeping) to Band 9, and the
  holiday list is Gujarati. The handbook is in English, and the model can answer a Hindi or Gujarati question
  from English source text. One line in the prompt, and it widens who can actually use this.
- **A per-user daily cap** (50 questions) enforced in the function. Not a real abuse worry at 70 people; it is
  insurance against a loop in the client billing real money overnight.

**Validate the ids returned against `kb_sections` before rendering.** Unknown ids are dropped and the answer is
marked for review. This is what makes a fabricated citation structurally unable to reach a reader.

---

## 9 · What it costs to run

70 profiles, of whom the desk staff are the real audience (Band 1 roles largely have no login). Assume a busy
month at **200 questions**, and about 40,000 tokens of handbook per question.

| Model | Cold (cache write) | Warm (follow-up within 5 min) | 200/month, realistic mix |
|---|---|---|---|
| Claude Opus 5 | ~$0.26 | ~$0.03 | ~$45 · **₹4,000** |
| **Claude Sonnet 5 ← chosen** | **~$0.10** | **~$0.012** | **~$15 · ₹1,300** |
| Claude Haiku 4.5 | ~$0.05 | ~$0.006 | ~$8 · ₹700 |

Honest range for Sonnet 5: **₹1,200 to ₹1,900/month** depending on how often people ask follow-ups. Call it
**about ₹1,500**. ⚠ Caching is only a win when a thread averages two or more questions, because a cache write
costs 1.25x an uncached read. It is on because follow-ups are the normal case, not because it is free.

**`claude-sonnet-5`, decided 28-09-2026.** Same model `analyze-receivables` already runs for judgement work in
this portal, so its quality is known here. Put the id behind a secret exactly as `ANALYSIS_MODEL` is
(`analyze-receivables/index.ts:107`), so moving to `claude-opus-5` is a one-minute change. **Watch the 👎
ratings in the first month and report back rather than letting it drift.**

---

## 10 · Phases

Each stops on **localhost** for you to look at, per the **PF-20** rule. Nothing is pushed without your word.

| | Phase | Done when |
|---|---|---|
| **1** ✅ | **DONE 28-09-2026. Ingest.** Tables, migrations, rehearsed rollbacks. Converter into `frontend/scripts/`. Handbook loaded. The 7 images uploaded and the 3 text-bearing ones transcribed into sections. The two `in_force_note` rows set | `kb_sections` holds about 349 rows, every chapter present, Org Chart and Preface readable as text, diff report runs |
| **2** ✅ | **DONE 28-09-2026. The handbook pane.** Chapter nav, real tables and images, section anchors, highlight-on-arrival, text search, the `in_force_note` callout. Reachable at `/handbook/read#4-3` while the widget is built around it | You can reach any section by URL and see it highlighted inside the full manual, on desktop and on a phone |
| **3** ✅ | **DONE 28-09-2026. The bubble.** `ask-handbook` deployed. The widget mounted in `App.tsx`, going bubble → chat → two panes. Six suggestions, short answers, reference chips, the not-covered state with *Send to HR*, 👍/👎 | Twenty real questions answered correctly, each chip widening onto the right section, **the thread surviving navigation between two apps**, on every screen including `/account` |
| **4** ✅ | **DONE 28-09-2026. HR's side.** `/knowledge-base`: the question log grid, Unanswered, the `in_force_note` editor, Publish with its diff. Module registered in `registry.tsx` and `appInfo.ts` under `category: "hr"` | HR can see what was asked and annotate a section without a deploy |

**What Phase 4 turned up:**

- **A view-only grant would have meant nothing.** `can_manage_knowledge_base` demands `edit`, so a
  view grant would have passed Module Access and handed the holder an empty screen. Migration
  `20260928090057` splits it properly: **view reads the question log, edit also writes replies and
  section notes.** Proved both halves in a rolled-back transaction, so no real person was granted
  anything. That is why `knowledge-base` is deliberately NOT in `NO_VIEW_ONLY_APP_IDS`, unlike
  `announcements`, where view-only genuinely would give nothing.
- **`line-clamp-2` silently does nothing next to `block`.** The clamp works by setting
  `display: -webkit-box`, so a `block` in the same class list wins and the notes column kept rows
  370px tall, two to a screen. Same shape as `cn` not merging Tailwind: two classes setting one
  property, and the loser is invisible. Removing `block` fixed it (rows now 86px).
- **An em dash reached the UI through a placeholder.** `&mdash;` for an empty cell is an em dash,
  which the house rule bars from anything staff read. Replaced with words ("None", "Not replied"),
  which is clearer anyway.

**What Phase 3 turned up:**

- **The answers write em dashes.** The model's own prose used them, in text staff read. Rule 10 of
  the system prompt now forbids them outright; verified clean afterwards. A model does not inherit a
  house style, it has to be told.
- **My test expectations were wrong twice, and the model was right both times.** Asked for the notice
  period it cited Chapter 18's PROCEDURE, not Chapter 28 §2.1, because Chapter 18 holds the only
  actual NUMBER (60 days) while §2.1 says merely "as per their appointment letter". Asked about loan
  eligibility it cited Chapter 14's APPLICABILITY, not ELIGIBILITY AMOUNT, because "two years of
  service" lives there while ELIGIBILITY AMOUNT is about the amount. Check the expectation before
  the system.
- **A full test run spends 22 of the 50 daily questions**, against whoever the test credentials
  belong to. Two runs exhaust the cap and the rest return 429. That is the cap working. Documented
  in handbook-questions.json; it resets at midnight IST.
- **Notice period is a third topic the handbook splits across chapters** (18 and 28), after travel
  (15 and 32) and loans (14 and 29). None of them cross-reference the others.

**Two bugs the browser found in Phase 2, both kept fixed and both worth knowing about:**

- **A deep link landed a whole chapter short.** The six front-matter pictures load after the first
  paint, so everything below them shifted down *after* the scroll had run: asking for Sick Leave in
  Chapter 4 showed Attendance in Chapter 3. That is worse than not scrolling, because the reader
  believes they are looking at the answer. Fixed by pre-sizing every picture's slot to A4 in
  `blocks.tsx` so the layout never moves, with a re-scroll once the pictures resolve as a second net.
- **Wide tables crushed their columns on a phone** rather than scrolling. Chapter 32's six-column
  band matrix wrapped to "Busine / Econo Flexi" at 390px, which reads as gibberish. The table now has
  a min-width and scrolls inside its own wrapper; the page still never scrolls sideways.

**Phase 3 needs a written test set before it is called done**: twenty questions with their correct sections,
kept in the repo. It is the only way to know a prompt change did not quietly break citations, and this repo has
no test runner to catch it otherwise.

**The Phase 4 grid obeys `CLAUDE.md` without being asked**: sorts on every column, a searchable multi-select
filter under every column, cascading options, and a filtered-to-nothing table that keeps its header and offers
*Clear filters* rather than swapping in an `EmptyState`.

---

## 11 · Still open

All five build decisions are settled in §0. Three things remain, and **none blocks Phases 1 and 2**:

1. **Anonymous question log, or named?** §7. Default is anonymous. **Decide before Phase 3 collects real
   questions.**
2. **Who gets the `knowledge-base` grant.** Reading needs no grant, so this is only *"who may see the question
   list"*. Granted to **nobody** until you name people. Needed before Phase 4 ships, not before it is built.
3. **Chapter 32's band contradiction.** Band 8 is both TC-A and TC-B, Band 3 both TC-D and TC-C, so two people
   in the same grade can be told different things, and no wording fixes that. **It is the same H1 blocker
   holding Travel Desk off go-live**, so one Director decision closes both. Raise it alongside TR-1's, not
   twice. Until then the two `in_force_note` rows make the answer show both readings rather than pick one.

---

## 12 · What I would not build

Named so they are visible decisions, not oversights:

- **An in-app handbook editor.** HR edits Word, we ingest. An editor means owning a legal document's revision
  history, and the `.doc` remains the original either way.
- **Per-employee answers**, such as *"how much leave do **I** have left?"*. That is HR One App's data, not the
  handbook's, and the portal does not hold it. Say where to look rather than guess.
- **Streaming.** §8.
- **Email delivery of answers.** Nothing here needs mail. If it is wanted later, `send-email` silently drops
  module prefixes it does not know, so its `row.kind.startsWith` allowlist needs a new arm first. ⚠ It is at
  **line 1342** today, not 1187 as an older note said; find it with `grep -n 'row.kind.startsWith'`, because
  the line moves.
- **pgvector.** §3.
