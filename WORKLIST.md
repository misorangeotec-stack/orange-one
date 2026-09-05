# Orange One — Work List

Day-to-day work: the new tasks and edits we want done, filed **module-wise**. Ask
*"what's on the list?"* and this file is the answer.

Each task carries the module it belongs to. New tasks go under their module's heading;
a task touching several modules is filed under its primary one and cross-referenced
from the others.

**Status:** `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked
**Priority:** 🔴 high — hurting live work, jumps the queue · 🟡 medium · 🟢 marks a low-priority
task that is worth doing and depends on nothing, so it can be picked up in parallel with whatever
else is running.

Finished work does not stay under its module — it moves to **[Done](#done)** at the foot of this
file, so the module headings hold only what is still open and the record of what shipped is in one
place.

A **bug** is not a task and does not belong in either place. Something that was already built and
turned out to be broken goes to **[Fixes](#fixes)**, just above Done — it was never on the list, so
there is no open entry to move.

A task that needs someone else’s call carries a **“To discuss with …”** checklist at the end —
the open questions to put to them, so the conversation happens once and the answers land back here.

**Last updated:** 2026-09-05

Separate, and not repeated here — the two live operation logs keep their own detail:
[CENTRAL-MASTERS.md](CENTRAL-MASTERS.md) (Tally masters consolidation) ·
[RECEIVABLES-SCHEDULED-EMAIL.md](RECEIVABLES-SCHEDULED-EMAIL.md) (scheduled collection emails)

---

## Waiting for

Work held up because someone owes us something. If a task is late, this is the first place to look.

| What we need | From | Blocks | Waiting since |
|---|---|---|---|
| WhatsApp access, so the integration can start | WhatsApp team | **PF-10** | 2026-08-22 |
| Who owns the approvals in OCPI, Customer Onboarding, Asset Maintenance and Travel Desk — no step owners are configured at all | Ritesh Bhai / Bushra | **PF-14** | 2026-08-27 |
| The calibration sheets (the Excel report QC keeps today) | Factory / QC team | **PE-1** | 2026-08-20 |
| The final list of production steps to add | Factory, then Bushra | Widens **PE-2** (no longer blocks it) | 2026-08-20 |
| The filled asset register sheet — vehicles, IT equipment, air conditioners. ⚠ **The whole Asset Maintenance module now waits on this one file.** The template, the importer and the walkthrough plan are all done and idle; the register holds 10 rows of which **9 are seeded `[TEST DATA]`**, so until it comes back the module reminds nobody about anything. Sent 29-Aug. The walkthrough with Bushra happens *after* the real assets are punched in, not before | Ritesh Bhai / Finance | **AM-4** — the module's only open item | 2026-08-29 |
| 🔴 **Can the ConnectWave mirror expose batch-wise stock?** — company × item × godown × **batch** × quantity, ideally with the batch's dates. **Nothing on OD-12 is buildable until this is answered.** Every Tally view we consume today (`v_master_stock_item`, `v_clevel_stock_item` and the rest) is **item-level; not one carries a batch**, so the lot picker has no source. ⚠ That is read off our own code — it lists what we consume, not necessarily what ConnectWave holds | ConnectWave team, via Ritesh Bhai | **OD-12** — the live LOT number, high priority | 2026-09-04 |
| Department, sub-department + employee code for 10 people who joined after her 27-05-2026 sheet | Bushra | **OM-1** | 2026-08-20 |
| The REAL dryer names, Indian and Chinese — six placeholders are standing in so the 11 machines that take a dryer can name one. ⚠ **They no longer say `[SAMPLE]`** (OCPI-8, 01-Sep, client's instruction), so nothing on screen marks them as invented and one can reach a signed contract looking real. More urgent than it was, not less | Ritesh Bhai / Bushra | **OCPI-28** — the exact five questions to ask | 2026-08-29 |
| The nine COA parameter **standard values**, to type into Masters → COA Parameters. ⚠ **They are NOT in the QC sheet and never were** — its *Standard Specs.* tab holds one cell reading *"We will enter manually afterwards for our internal reference (No relsation with software)"*, and the COA tab leaves the Standard column blank. Nothing is owed as a file; QC has to state the values | Factory / QC team, via Bushra | **PE-5 · B** | 2026-09-02 |
| Who owns Production vs Repackaging on the four tail steps (PM Transfer, Packing Entry, Ready to Dispatch, FG Transfer) — the split ships inert until the names are set, so nothing is testable end to end without them | Bushra / factory | **PE-6 go-live** | 2026-09-02 |
| The PI's **page-2 sales page** for the seven machines that have never had one: **MP5000 · JPK · Mini Lario · Kolorado Alpha 16 · Foil Machine · Label Printer · Book Printer** — plus two confirmations: does **Fab Pro 1I / 3I** share the Fab Pro 2i page, and does **P8D** share Sub Pro II+? 🟢 **The twelve existing pages are BUILT and seeded** (OCPI-36, 02-09) — 18 of 28 machines now print one. Each missing page needs a heading, a tagline, one paragraph and the bullets; likely already in the machine brochure. A machine without one issues its PI one page shorter, which is a correct form | Bushra | **OCPI-36** page 2 — delays those 10 machines only | 2026-09-02 |
| Were the duplicate CV re-uploads deliberate? Re-counted 05-Sep: **7 extra rows, not 5**. **Purvi Upadhyay + Manali Desai** re-added to the EA vacancy on 02-Sep after both were rejected on 31-Aug; **Harsha Jain** twice on Marketing Executive; **Kajal Bhalerao THREE times**, **Sunil Sharma** twice, and 🔴 **CA Vandit Mehta twice with BOTH rows at Interview R3** on Finance manager. If deliberate the new rows are right and the old ones are noise; if accidental it is the reverse. **No data has been touched** | Saloni Rathod, via Bushra | **FIX-5** cleanup only — the guard itself shipped 05-Sep | 2026-09-03 |
| **Two wording confirmations on the Alpha 15 sales page**, now that it is seeded. 🟢 The old question — *which of the two pages is current* — is **ANSWERED and no longer blocking:** `Advantages of KOLORADO ALPHA 15` and `Advantages of FEDAR 15` were both rendered and compared and are **identical word for word**; only the heading differs, so it was seeded under the Kolorado one. What is still open is cosmetic: (a) Kolorado or FEDAR as the printed heading, and (b) both 2026-27 papers print **`ALPHA15` with no space** — is that intended? Either is a one-word edit on the master | Bushra | Nothing — the page is live either way | 2026-09-02 |
| 🔴 **`machine_model_no` is still blank on 13 of 28 machines — and every templated one of them is a KoloRado Alpha.** Re-checked 03-09-2026 after OCPI-39's fills. **7 templated, all Alphas:** `Kolorado Alpha 15` · `Kolorado Alpha 16` · `KoloRado Alpha 3 — 12 heads` · `KoloRado Alpha 3.2 — 8 heads` · `KoloRado Alpha 3.2 — 24 heads` · `KoloRado Alpha II — 1.8 m` · `KoloRado Alpha II — 2.2 m`. **6 untemplated:** `Book Printer` · `Foil Machine` · `KoloRado Alpha 3.2 — 16 heads` · `Label Printer` · `Mini Lario` · `Pengda PD-1800XD-800`. ⚠ **This may be a fact about the Alphas rather than a hole in the master** — the only Alpha with a code is the II 1.9 m (`OT-1908A`), taken off its own contract's spec row, and real contract 125 prints the label *"Model No:"* **with nothing after it**. So either the Alphas genuinely have no manufacturer code and the answer is "leave them blank", or the codes exist and nobody has written them down. 🟢 **Two candidates already on file** if the answer is the latter: `Mini Lario` → **`MS-MINI LARIO-1.8 MTR`** and `Pengda PD-1800XD-800` → **`PD-1800XD-800`**, both stated on the decks supplied 02-09. 🟢 **Three were filled from real contracts on 03-09 (OCPI-39):** K32 `HM1800B-TK32-B1`, P8S `HM1800R-P8S-A1`, Pengda 800 `PD-1700XD-800` — 15 of 28 now filled. **Nothing is broken meanwhile:** both the PI and the OC omit the phrase entirely rather than printing a gap | Ritesh Bhai, with Bushra | **OCPI-36 / OCPI-39** — cosmetic, blocks nothing | 2026-09-03 |
| 🔴 **Five machines have NO billing name, and it is the line that prints on the contract.** `Fab Pro 2I` · `Fab Pro 3I` · `JPK` · `Mini Lario` · `MP5000` all carry a null `billing_name`, so a contract for any of them names the machine and then says nothing about what is being sold. `KoloRado Alpha 3 — 12 heads` was the sixth and **is now filled** — its siblings all read `LARGE FORMAT INKJET PRINTER WITH <n> HEADS WITH STD. ACCESSORIES`, so 12 went in the slot, copied not composed. The other five have **no sibling pattern and no real paper stating one**, and a billing description on a signed contract is not something to infer. **Needed: one line each, in Bushra's own wording.** ⚠ The OCPI-40 audit reported this as ONE machine because the sweep was keyed `name ilike '%alpha%'` — the unfiltered count is six | Bushra / Ritesh Bhai | **OCPI-41 C-2** | 2026-09-03 |
| **Eighteen deals are filed under a salesperson the roster does not know.** `Afrin Saiyed` (**13 deals**) · `Nakul Sir` (3) · `KARAN SIR` (1) · `UMESH BHAI` (1). Each has exactly one obvious owner — AFRIN AMIN SAIYED, Nakuleshwar Sharma, Karan Toshniwal, UMESHKUMAR SOLANKI — but attributing 18 commercial documents to a person on the strength of a nickname is a word to be given, not an inference to make, so **none was changed**. Until then that person's deals split across two identities in every report. 🟢 The unambiguous half is done: 9 deals (`Yash Agarwal` 7, `Khurshid Alam` 2) named a roster person with no `salesperson_user_id` and have been linked. ⚠ Frozen revisions keep whatever name they printed either way | Ritesh Bhai | **OCPI-41 C-3** | 2026-09-03 |
| 🔴 **Does the same HSN code cover the other 17 machines?** **Held for Ritesh Bhai 03-09-2026** — the client does not know offhand and it is an accounts / CHA question, not a development one. What the papers prove: **one code, `84433910`**, swept across all 90 PDFs in both years — 14 occurrences, no disagreement — but **all 14 sit on just four machines** (K32 scanning, K64, Rocket single-pass, Position Printer), which are now filled and print on both papers. **The KoloRado, Fab Pro and P8S contracts state no HSN at all**, so there is no document to read it off for the other 17 and **none was invented** — an HSN on a signed contract is a tax classification, not a label. ⚠ The inference is that they match (8443.39.10 is the customs heading for ink-jet printing machinery and all 17 are ink-jet printers) but that is a guess, not a paper. **Needed: does Orange bill its whole printer range under 84433910?** Yes → one statement fills all 17. Otherwise name the ones that differ; the column is per-machine so each can hold its own | Ritesh Bhai (with accounts / CHA) | **OCPI-39** — the four proven machines are done and printing; this is the other 17 | 2026-09-03 |
| **K64 has two different model numbers on file, and it is the best seller.** Laxmipati's PI (109) says **`HM3200B-TK64-A1`**; Modi's (120) says **`HM1800B-TK64-A1`**. That reads as two build widths sold under one master row. The master holds the 1800 and now prints it on the contract's priced line, so a 3.2 m machine would go out under the 1.8 m code. Deliberately not guessed at | Bushra | **OCPI-39** — one row either way; every other machine is settled | 2026-09-03 |
| **The PI puts the technical model code where Bushra's papers put the friendly name.** Found 03-09 by typing folders 127 and 120 into the form and diffing the generated PI against the client's own PDF. Her convention is **friendly name in the subject line, technical code down in the description beside the HSN** — 127 reads `Subject: Model No: ALPHA II (WITH PRINTHEADS)`, 120 reads `Subject: Model No: HOMER K64(With 64 Heads)`. The module prints `machine_model_no` in **both** places, so those two subjects come out as `OT-1908A` and `HM1800B-TK64-A1`. The **billing name** differs the same way: hers say `LARGE FORMAT INKJET PRINTER (1.9 Meter) WITH STANDARD ACCESSORIES (WITH PRINTHEADS)` and `…WITH DRYER AND CENTERING SYSTEM`, the master says neither. ⚠ **Deliberately not overwritten** — the OC and the summary sheet already print the master's wording, so changing it moves three documents, not one. Needs either a confirmation that the master text is fine on the PI too, or a second field for the sales name. Distinct from the blank-model-no row above: this is about *which text goes where*, not about missing values. 🔴 **Now proved on ELEVEN papers, not two** (OCPI-46, 04-09): the eleven re-entered contracts were read back as invoices and the subject line matches on **0 of 11** — hers name the machine the customer recognises with its head count (`SUBJECT: HOMER K24`, `Sub Pro II+ (With 8 Heads)`, `Homer K32 (with 32 Print heads)`), ours print the factory code. ⚠ And where a machine has NO model number the renderer falls back to the machine's **internal name**, em dash and all — folder 124 went out as `Subject: KoloRado Alpha 3 — 12 heads` | Bushra | **OCPI-36** — cosmetic, blocks nothing | 2026-09-03 |
| **Is "Productivity" meant to be a bullet or a heading on the K24 / K32 / Rocket sales pages?** The real papers set it two ways — a bullet inside the Applications list on those three, a sub-heading with its figure beneath on Sub Pro II+. Both were transcribed exactly as printed rather than tidied. One answer fixes all three | Bushra | Nothing — cosmetic | 2026-09-02 |
| Does every machine need a **"consumables not covered under warranty" list**, or is Homer K32 the only one? 🔴 The K32 list — 11 parts plus 2 notes — is on **4 real contracts and in none of our 21 templates** (OCPI-37 found it). It is being added to K32. **If the other machines need one too, then every K24, K64, P8S and Alpha contract currently promises to replace consumables free.** Needed: the equivalent list per machine, or confirmation that K32 is genuinely the only one | Bushra | **OCPI-37 · Q1** — K32 itself is unblocked and being fixed; this is the rest of the estate | 2026-09-02 |
| 🔴 **What should a contract say when the machine is sold WITHOUT print heads?** Folder 108 (MK Fashion) is a real signed deal for a machine supplied without heads — its own composition line reads `WITH STANDARD ACCESSORIES (Without printheads)`. Entered exactly that way on 04-09, the row stored `incl_head = false` and **the contract printed the opposite**: `WITH STANDARD ACCESSORIES (With 8 printheads)`. **Ten of the 21 templates assert the heads unconditionally** — Fab Pro 1I/2I/3I · Homer K32 · K64 · all three Alpha IIs · P8S · Rocket — while the dryer and the centring device beside them ARE guarded. There is no `[[if head]]` to write: `conditions.ts` exposes only `dryer`, `centering` and `usd`. 🟢 **The switch is ours and is safe to build** (a `head` condition plus its SQL twin, additive). ⚠ **The replacement sentence is contract text on ten machines and is NOT ours to invent** — folder 108's own *(Without printheads)* is the obvious candidate. Ritesh Bhai, 04-09: keep it in the artifact and settle it with him. 🔴 **The same fault is on the INVOICE too, and there it needs no new condition** (OCPI-46, 04-09): folder 108's generated PI reads `LARGE FORMAT INKJET PRINTER WITH 8 HEADS WITH STD. ACCESSORIES` against the real paper's `(WITHOUT PRINTHEADS)`. The invoice takes its description from `billing_name` — one fixed string per machine — so it cannot vary by deal. 🟢 OCPI-45 already routes billing names through the same conditional engine as the contract's supply line, so the `head` switch built for the contract fixes the invoice in the same stroke | Ritesh Bhai / Bushra | **OCPI-42 · N-10** | 2026-09-04 |
| 🔴 **One signed K64 order confirmation.** K64 is the best-selling machine and **there is no OC for it anywhere** — every PDF, Word and PowerPoint file in both years was swept, and the only two K64 folders (109 Laxmipati, 120 Modi) hold Performa Invoices with no contract body. So the one machine that sells most has never been checked against a paper a customer signed. It is covered three weaker ways — 7 of its 9 clauses are byte-identical to Homer K24's, which *was* checked; its own deck covers the other 2; the two PIs cover the money and terms — but none of them can answer the question that matters: **does a real K64 contract carry a clause its deck omits?** That is exactly how the K32 consumables list went missing | Bushra | **OCPI-37** — the audit is done; this closes its one real blind spot | 2026-09-03 |
| **The wording Orange actually intends to offer on `Mini Lario`.** Its deck (supplied 02-09) carries **`MARKEM-IMAJE`** — another manufacturer — inside its limited-warranty, limitation-of-liability, indemnity, data-privacy and governing-law clauses, so those terms appear to have been lifted from a third party's contract rather than written for Orange O Tec. Transcribed as they stand, an Orange contract would offer another firm's warranty disclaimer and bind the customer to their dispute resolution. Nobody should transcribe this deck until a person has said which of those clauses Orange means to stand behind | Ritesh Bhai | Blocks building the Mini Lario template; nothing else | 2026-09-03 |

---

## To discuss with Ritesh Bhai

A running list. Ask for it by name — *"what needs discussing with Ritesh Bhai?"* — and this is what
comes back. Two kinds of item live here and they are marked differently:

- **`[decided]`** — already agreed and already applied. Listed so it can be confirmed, and so the
  exact wording is on record if it is ever queried.
- **`[open]`** — nothing built either way; the answer changes what gets built.

### OCPI

**0. `[open]` 🔴 Does the Performa Invoice ever CHARGE for the extras, or only list them?** *(02-09-2026)*

The one decision OCPI-36 could not make from the data. Swept all **42 real PIs**:

| | Count |
|---|---|
| One priced line — the machine alone | **41** |
| Two priced lines | **1** — Clothera (124) |

So the PI now prints **Machine Value · GST · Total** and nothing else, which matches 41 of the 42 and
adds up. Where ink or heads are mentioned on a real paper they sit in the `Note:` in words —
*"Ink Price- CMY-Rs 475+GST (30 Days Credit)"* — never as invoice rows.

Clothera is the exception: **2 machines + 30 print heads, and the heads ARE in the total**
(46,50,000 + 21,00,000 + GST 12,15,000 = 79,65,000). **That shape is not reproduced today.** The
system stores the print-head / ink / dryer figures as things billed on a *separate* invoice, so its
stored total deliberately excludes them — pricing them on the PI printed ₹62.35L of line items above a
₹61.36L total that left every one of them out. Rather than have the browser add the figures up itself,
which this module has always refused to do on a customer document, it prices the machine only.

> **The question:** is Clothera a one-off, or do you expect to bill heads and ink on the same PI
> regularly? If regularly, the total has to be worked out and saved in the database first — a change
> to how the money is calculated, and the other two papers get re-checked afterwards.

**0a. `[open]` 🔴 The Performa Invoice's delivery line: DAYS or a DATE?** *(03-09-2026)*

🔴 **NOT ONE PERFORMA INVOICE IN THE YEAR PROMISES A DATE. Twenty-eight promise a number of days. We
print a date.**

That is the whole of it. Found by typing two real deals into the form and diffing the output against the
client's own PDFs (folders 127 and 120), then counted across every PI in the folder. Both the label and
the content differ:

| | |
|---|---|
| 127 | `Delivery Terms : 30 Days from the date of confirmation` |
| 120 | `Delivery Terms : 30 Days After Order confirmation` |
| 118, 124 | `Shipment Terms : 30 Days after Order Confirmation.` |
| 106 | `Shipment Terms : 30 to 45 Days from Order confirmation.` |
| **ours** | `Delivery : Tentative delivery 15-Oct-2026, applicable from the date of signing of this contract.` |

Counted across **all 36** PIs in the 2026-27 folder (identified by content, not by file name — 11 of them
are not named `… PI.pdf`): **28 state days, 0 state a date, 8 state nothing.**

🔴 **There are TWO labels in use, and neither is ours:** `Shipment Terms :` on **16** papers and
`Delivery Terms :` on **12**. So the label is a three-way choice, not a two-way one.

This was **not** fixed, because it is not a slip. OCPI-18 retired `delivery_days` on purpose so that a
deal's two papers could not carry two different delivery promises — the column is still there, unused.
Restoring it on the PI alone re-opens exactly that: the contract would promise a date and the invoice a
duration, on the same deal.

> **The question:** should the PI go back to *"30 Days from the date of confirmation"* — and if so, does
> the **contract** say the same thing, or does it keep its tentative date? One answer, both papers.

Same shape, smaller, and it can be settled in the same breath: **`Insurance :`** prints our standing
~30-word clause where the real papers print `Insurance : Insurance will be borne by customer`. Ours says
more and says it correctly; theirs is what the customer has seen before.

**0c. `[open]` The trade term cannot say what the real papers say.** *(03-09-2026)*

The trade term is **composed** from the delivery-term answers, never typed, and neither real paper is
reachable:

🟢 **BOTH HALVES ARE NOW BUILT AND THE ITEM HAS NARROWED TO ONE THING (OCPI-43, 04-09-2026).**

1. The *who bears transport* answer reaches the paper — the composer appends the papers' own
   `(Transportation bear by <party>)`, counted across every parsed real contract rather than chosen,
   and names the selling entity when the company bears it.
2. 🔴 **The term reads `Ex-Work Surat`, reversing the 02-09-2026 decision.** Ritesh Bhai, 04-09:
   *"instead of X factory surat, you can do X work surat."* Folders 101, 122 and 127 all write it that
   way, and so do the 17 deals already on file — so a new deal now composes byte-identically to what
   the old ones hold. ⚠ The BUTTON still reads `EX Factory`: that exact string is what
   `high_seas_via`'s CHECK allows. The answer and the printed term are deliberately different strings,
   which is why the form shows the composed value under the strip.

| Paper prints | The form produces | What is still missing |
|---|---|---|
| `Ex-Work Surat Factory (Transportation bear by Customer)` | `Ex-Work Surat (Transportation bear by Customer)` | ✅ nothing — matches |
| `CIF NHAVA SHEVA PORT (Under EPCG License)` | `CIF NHAVA SHEVA PORT` | `(Under EPCG License)` — no field holds it |

> **The question:** should the composer be widened (add the bearer to the printed term, and a free-text
> tail for things like *Under EPCG License*), or should the trade term simply become a typed field with
> the composed value as its default? The second is less work and matches how Bushra actually writes it;
> the first keeps the answers structured.

**The recommendation is the typed field, and the evidence is that every structured field added so far has
been overtaken by the next paper.** Folder 106 is the clearest case — `CIF, NHAVA SHEVA (UNDER HIGH SEAS
SALES AGREEMENT) (UNDER EPCG License)`: a comma after CIF and **two** parentheticals, where 120 has one
and 127 has a different one again. No fixed vocabulary reaches that, and the next contract will carry
something none of them anticipated. A typed field defaulted to the composed value keeps the structure
where it helps and stops the paper being limited by it.

🔴 **ONE ANSWER FIXES BOTH PAPERS.** This was found on the Performa Invoice and, independently the same
day, on the **order confirmation** — the OC audit has the contract printing `Ex Factory Surat` where the
real one reads `Ex-Work Surat (Transportation cost bear by customer)`. Same `composeTradeTerm`, same root
cause, both documents. So this is one decision, not two, and it closes a finding on each.

🟢 **WHAT IS LEFT IS THE FREE TAIL ALONE** — parentheticals no vocabulary reaches, e.g. folder 106's
`CIF, NHAVA SHEVA (UNDER HIGH SEAS SALES AGREEMENT) (UNDER EPCG License)`. The recommendation above —
a typed field defaulted to the composed value — stands, and is now the whole of this item.

**0b. `[open]` What number should the order-confirmation series be set to?** *(02-09-2026)*

The counter stands at **14** *(was 9; UI testing on 03-09 took 10–14 — see OCPI-40 and the parallel PI
session)*; Bushra's paper book for 26-27 runs to **127**. The next quotation generated will take
`OTPL/OC/15/26-27` unless it is moved in **Settings → Order confirmation numbering**. It was
deliberately left until after testing, so the serials testing consumed are discarded by the jump
rather than left as gaps inside the live series — which is working as intended: 10–14 are below the
jump and vanish with it.

⚠ **This is why the jump should happen BEFORE the next UI test run, not after.** Every run consumes
more serials, and none of them come back on delete. Five went in one afternoon.

⚠ **It is now taken at Generate, not at approval** (your decision, 02-09) — so a quotation that is
never approved still consumes one, as a paper folder that never closes already does. Confirm **128**,
or whatever the real last number is.

*For Ritesh Bhai: one number, set once, before the next real quotation is generated.*

**0d. `[open]` 🔴 When print heads are sold at their own price, should that money be part of the
contract total?** *(03-09-2026)*

**In one line:** on Clothera's real contract the print heads are priced separately AND counted in the
total — our system can price them, or count them, but not both.

**What the real paper does** *(order confirmation 124, Clothera — a signed contract, not a draft)*:

| | |
|---|---|
| Machine | ₹46,50,000 |
| 30 Epson print heads | ₹21,00,000 |
| GST 18% | ₹12,15,000 |
| **Total** | **₹79,65,000** |

**What our system would print for the same deal: ₹54,87,000.** The ₹21,00,000 of heads is simply not
in it — **understated by ₹24,78,000**.

**Why.** The form has one box for the deal value, and it means the MACHINE. The Shipment & invoice
table below it can take a quantity and a price for print heads, ink, dryer, spares and the centering
device — but it only offers those boxes when the item is ticked as billed on a **separate invoice**,
and money on a separate invoice is deliberately kept out of this contract's total, so the customer is
not charged twice. Both halves are sensible on their own. Together they leave nowhere to put an item
that has its own price and belongs on THIS contract.

**What we would change — nothing new appears on the screen.** The Shipment & invoice table already
asks *"separate invoice: yes or no"* on every row. Two changes to it:

1. Offer the quantity and price boxes on **both** answers, not only on Yes.
2. Let that answer decide where the money goes — **No → the line prints on the contract and is added
   to the total; Yes → exactly as today, printed and excluded.**

Clothera would then be typed as: machine ₹46,50,000 · print head, qty 30, ₹70,000 each, separate
invoice **No** — and the contract prints both lines and totals ₹79,65,000, matching the signed paper.

> **The question, in plain terms:** is Clothera a one-off, or will heads (or ink, or a dryer) be
> priced on the same contract regularly? If regularly, we make the change above. If it is genuinely a
> one-off, the workaround costs nothing today — put the combined ₹67,50,000 in the deal-value box and
> the GST and total come out right; the contract then prints one lump sum instead of naming the heads.

⚠ **This is the same commercial question as item 0 above, asked about the CONTRACT instead of the
Performa Invoice.** One answer settles both papers. The sweep behind item 0 is the evidence for how
often it happens: of 42 real Performa Invoices, **41 price the machine alone and 1 — Clothera —
prices the heads as well.**

*For Ritesh Bhai: a commercial decision, not a preference. Nothing is built until he answers.*

**1. `[decided]` The print-head price sentence — reworded on 4 machines.** *(29-Aug-2026)*

The client asked for the *"head price after the warranty"* box to be removed from the quotation form.
It could not go while the clause that used it still asked for a figure — an unfilled placeholder prints
as a ruled blank, so every contract on those machines would have read *"priced at INR ________ plus
GST"*.

Machines affected: **Homer K24 · Homer K32 · P8D · P8S** — clause *PRINT HEAD POLICY PROGRAM*.

> **Was:** "After that period a New Print Head will be priced at INR `{{post_warranty_head_price}}` plus
> GST, on the new machine, first time installed head."
>
> **Now:** "After that period, **replacement print heads will be supplied at the prices prevailing at
> the time of purchase**, on the new machine, first time installed head."

Approved by the client and applied (migration `20261021150000`). The form field and its placeholder were
removed afterwards, in that order. **Contracts already issued are unchanged** — every revision freezes
its own document, so only the next generation picks this up.

*For Ritesh Bhai: confirm the new sentence is acceptable commercially. If not, it is one string to swap
back.*

**2. `[decided]` The delivery term stays on the quotation form.** *(29-Aug-2026)*

The original instruction was to remove the **Delivery term** dropdown (Ex-Work Surat / CIF / FOB / EX
Factory), because delivery is "already covered in commercial terms". Checking it showed that it is not,
and the field stays. Three findings:

- It is the **only place an ordinary sale records a delivery route.** Commercial terms asks *"how is the
  printer delivered?"* on a **High Seas deal only**. **11 of the 12 ordinary deals on record had filled
  this dropdown in**, all with *"Ex-Work Surat"*.
- The words in it print on the contract as **"Delivery Terms: Ex-Work Surat"**, on all ten machine
  templates. Removing the dropdown first would have printed **"Delivery Terms: ________"** there.
- ⚠ **The two papers were never saying the same thing.** The **quotation** prints *"Term of Delivery:
  Local Delivery · cost by Customer"* — built from the deal type and who pays. The **contract** prints
  *"Delivery Terms: Ex-Work Surat"* — this dropdown. Two different facts, two similar headings, on two
  papers. That is what made "already covered" look true when it was not.

*For Ritesh Bhai: nothing needs doing. But it may be worth deciding whether those two lines SHOULD say
the same thing — e.g. the contract reading "Ex-Work Surat, cost borne by Customer". That is a wording
question about the papers, not a question about the form, and nothing is broken either way.*

**3. `[open]` Should "Platter" be asked on every quotation, or set once per machine?**

*Asked in these words on 29-Aug-2026; still waiting for an answer, so nothing has been built.*

There is a dropdown on the quotation called **Platter** — *With Platter / Without Platter / Not
Applicable*. Nobody has ever mentioned it in any instruction, and it is in no pointer and nowhere else
in this work list.

But the client's own machine sheet has a **PLATTE column sitting among the machine's features**, between
*Heating Media* and *Air Blade* — next to the air blade and the chilling system, which are all set once
per machine. So the sheet treats it as part of the machine, not as something agreed deal by deal.

**The three choices, in plain words:**

- **A.** It is a **machine feature**, like the air blade — tick it once per machine and stop asking on
  every quotation.
- **B.** It is a **per-deal choice** — leave it as a dropdown on the quotation, exactly as it is now.
- **C.** **Drop it** — nobody uses it.

**My recommendation: A.** A platter is part of the machine, not something negotiated on each deal, and
the client's own sheet already files it with the machine's features.

⚠ **One thing to know before choosing A:** that PLATTE column is **empty for all 28 machines**, so there
is nothing to load. Someone would have to go through the list and say which machines have one. Until
that is done the question would simply stop appearing anywhere.

*For Ritesh Bhai: A, B or C. If A, we also need somebody to fill in which machines have a platter.*

**4. `[open]` One head-name check left. Two are settled.**

- **`[decided]` The Fab Pro's Ricoh IS a "Gen 6".** *(29-Aug-2026)* The sheet says only *"RICHO HEAD"*,
  with no generation. **Fab Pro 1I, 2I and 3I** were mapped to the existing *RICOH GEN 6 HEAD* and the
  client has confirmed that is right for now, and will tell us if it ever changes. The name prints on
  the quotation, so it was worth asking. Nothing to change.
- **`[open]` Is "Homer" a print head, or the machine brand typed into the head column?** *(put to the
  client 29-Aug-2026 — they do not know; it needs Ritesh Bhai.)*

  Three machines — **Homer K24, Homer K32 and K64** — have *"EX600 RC KATAN & HOMER"* in the head column
  of the sheet. *Katan* is certainly a head. But **Homer is also a machine brand** — two of those three
  machines are called Homer. So is Homer a **second print head**, or did somebody type the machine's
  brand into the head column by mistake?

  **We have assumed it is a head**, and added *Homer* as a new head name linked to those three machines.
  Two reasons: the other machines are written the same way — *"EX600 RC KATAN & KYOCERA"*, *"MS &
  KYOCERA BOTH"* — and there both names are heads; and it also appears on **K64**, which is not a Homer
  machine at all.

  *For Ritesh Bhai: is Homer a print head, yes or no? If no, we delete the head name and those three
  machines keep Katana only — a few minutes of work, no rebuild. The name prints on the customer's
  quotation, which is why it is worth confirming.*
- **`[decided]` Rocket's Kyocera is 300 DPI.** *Resolved from the sheet's own pattern:* P8D reads head
  *"300 DPI KYOCERA"* with DPI *300*; P8S reads *"EX600 RC KATAN & KYOCERA"* with DPI *600*. The DPI
  column tracks the **Kyocera** head. Rocket reads *"EX600 RC & KYOCERA"* with DPI **300**, so RC 600 +
  Kyocera 300 is consistent. Mapped that way; mention only if it looks wrong.

**5. `[open]` What is "JAY"?**

The machine sheet's TYPE OF MACHINE column reads DIRECT (10), SUBLIMATION (12), OTHER (4) — and **JAY
(2)**. The two are **Label Printer** and **Book Printer**. "JAY" sits where a machine type goes and is
not one, so it reads like a name typed into the wrong cell. Both machines are left **uncategorised**;
they are still fully quotable, since the machine list shows all 28 when no category is chosen.

**6. `[decided]` A separately-charged dryer DOES attract GST.** *(29-Aug-2026)*

When the dryer is not part of the deal it carries its own price. The question was whether tax applies to
it. **Answer: yes, at the same rate as the machine.** On a ₹10,00,000 machine with a ₹1,25,000 dryer at
18%, the papers now print:

> Machine Total: **₹11,80,000**  ·  Dryer Value: **₹1,25,000**  ·  Dryer GST @18%: **₹22,500**  ·  **Final Total: ₹13,27,500**

Built and verified against those exact figures. Two things came out of doing it properly:

- **The arithmetic moved into the database**, where the rest of the money already lives. The papers had
  been adding two numbers in the browser as a holding position. Only the database knows that a High Seas
  deal attracts **no GST at all** — so there the dryer gets none either, and no zero-tax line is printed.
- **A dollar deal converts the dryer at the same frozen rate as the machine.** A $1,500 dryer at ₹83.50
  prints as ₹1,25,250, not ₹1,500. Reading it as rupees would have been an ~85× error on a contract.

*For Ritesh Bhai: confirm the dryer is taxed at the same rate as the machine, rather than at a rate of
its own.*

**7. `[open]` On a machine that takes no centering device, should BOTH centering questions disappear?**
*(put to the client 29-Aug-2026 — they do not know; it needs Ritesh Bhai.)*

There are **two** centering questions on the quotation, and the client asked for them to be kept
separate. They are separate:

1. **"External centering system"** — a yes/no tick under *Deal inclusions*. Asks: *is it part of this
   deal?*
2. **"Centering device"** — a row under *Shipment & invoice*. Asks: *how does it ship, and is it billed
   on its own invoice?*

**But both of them only appear when the machine is marked as able to take a centering device.** So on a
machine marked **"No"**, **neither** question shows.

*For Ritesh Bhai: is that correct?*

- **Yes** → nothing to do. This is how it is built today.
- **No** → i.e. there is a case where a customer is billed for a centering device on a machine that does
  not normally take one (or the reverse). Then the machine list needs a **second tick**, so the two can
  be set independently — a small build change in the machine master and in both rule engines.

---

**8. `[open]` 🔴 Does EVERY machine need a "consumables not covered under warranty" list, or is Homer K32
the only one?** *(raised 02-Sep-2026 by OCPI-37 · **for Bushra, with Ritesh Bhai present***)

Bushra's real **Homer K32** contracts carry a clause our templates do not have at all:

> **HOMER K32 CONSUMABLES PARTS LIST WHICH NOT COVER UNDER WARRANTY**
> Sponge roll cover · Washing brush · Squeezee rubber · Head wiper · Washing brush bearing · Ink filter ·
> Degassing · Sponge roll bearing · Ink male connector · Ink female connector · Ink pipe
> *1) Physically damaged parts are not covered under warranty period.*
> *2) Any air-pressure-related part damaged due to water entering the air pipe will not be covered.*

It is on **4 real contracts** and in **none of our 21 templates** — verified against every
`fms_ocpi_machine_sections` row.

🔴 **Why it matters commercially.** The clause limits what Orange O Tec must replace free. Without it, a
contract issued from the module promises to replace eleven wearing parts under warranty that the paper
contract specifically excludes.

**Already decided (02-Sep-2026):** ✅ **add it to Homer K32.** That half is not in question.

*The question for the meeting:*

- **Is K32 the only machine with such a list?** → then nothing further; K32 is fixed and we are done.
- **Or do the others need one too?** → then **every K24, K64, P8S, Alpha and Fab Pro contract currently
  gives away consumables**, and we need the equivalent list per machine. ⚠ This is the more likely
  answer: the parts named are generic to any belt printer, and K32 looks like the one deck where
  somebody happened to write it down.

⚠ **Ask for the LIST, not a yes/no.** "Yes the others need one" without the parts per machine leaves us
exactly where we are. If one list covers several machines, say which.
⚠ Frozen revisions never change — anything already issued keeps the contract it printed. This affects
new deals only.

---

### New Recruitment

**1. `[decided]` The management pipeline dashboard — how it is gated, how wide it reads, how it opens.**
*(02-Sep-2026 · full audit, traps and phase plan: **NR-2**)*

Management asked for one screen carrying every position's pipeline, with the candidate's own detail
readable from it. Nineteen positions and 119 candidates today, so "look at the pipeline" is nineteen
page-opens. Three calls were made the same day:

- **Nobody is named "management" in code.** The permission becomes a **list in Setup** — an admin
  adds whichever users should have it — seeded with the Directors. Copies `process_coordinators`
  and `salary_viewers`, both already edited from Setup.
- **Five phase columns**, not ten stages: Screening · Interviewing · Offer · Hired · Dropped. Fits
  one screen with no sideways scroll; a cell click still drills to the exact stage.
- **Actionable, gated exactly as elsewhere.** Record an R3 result, make an offer, disqualify — the
  buttons appear only where the rules already allow. Nothing new is permitted.
- **Two modes on one route**, not a side-by-side split. The detail is already three columns and folds
  the sidebar to fit them, so there is no width to put a list beside it. The matrix stays put and the
  list area swaps to the detail at full width, with a breadcrumb back to the list you had.

⚠ **The Setup list alone will produce an empty screen, and it will look like a broken build.** Row
access is gated in SQL, not by a config key: `fms_hr_can_read_requisition()` admits admins,
coordinators, owners of any step except `mrf`, and a requisition's own hiring manager. Someone added
to the list who owns no recruitment step sees nineteen positions and zero candidates. It needs one
additive migration — `fms_hr_is_pipeline_viewer()`, OR'd into that function — **applied before the
frontend ships**. Same shape as PC-1's "view, not edit" trap. It also means **the Setup list is a
PII grant**: names, phones, CVs, expected salary. It should be worded as one.

**2. `[open]` Two things left on it.**

- **Does it replace Positions for management, or sit beside it?** Positions is also where a vacancy
  is held or cancelled.
- **Should closed and cancelled positions appear?** Five are cancelled today — and since **NR-6** each
  one now states why, by whom and when, on the page and on hover. That is most of what made a cancelled
  row worth showing, so this is easier to answer than it was.

⚠ Separately, and not a question — **Nakuleshwar Sharma takes Director rounds and has no access to
the module at all.** One edit in the admin User form.

**3. `[decided]` HR states the department → HOD mapping in Setup, rather than sending us a list.** *(02-Sep-2026 — raised by NR-3)*

HR raises most requisitions on a department's behalf, and the form's "who will manage this hire"
picker is scoped by RLS to the raiser's own department — **Saloni Rathod can see 5 of 64 people**,
so no HOD outside HR is even in the list. It therefore falls back to the raiser every time:
**17 of 19 live positions have the raiser as hiring manager, and on 14 of them that is Saloni.**

On the module's own rules that makes HR the HOD for those vacancies — HOD shortlist, Interview
Round 2 and all four probation reviews — across **96 in-play candidates**. And it cannot be
corrected today: no function in the database writes `hiring_manager_ids` after the MRF is created,
so the mapping is frozen on every live position, for everyone including an admin.

**NR-3 Part A** fixes the picker and adds the missing edit path. **Part B** answers the rest without
asking anyone for a spreadsheet: a **Setup → Department HODs** master, one row per department, which
both pre-fills every new requisition and drives the backfill of the 19 open ones.

⚠ Nothing in the portal already holds this. `departments` has **no `hod_id`**, and `user_hods` is a
reporting line that cannot be aggregated into one — it names **five** different heads for Accounting
& Finance, four for Supply Chain, three for Sales, and **nobody at all for 13 of 23 departments**.
It has to be stated, which is exactly what the Setup screen is for.

**Also decided:** the Setup mapping fills **both** people boxes on the position — *who will manage
this hire* and *who will they report to* — both editable before saving. The second is empty on 15 of
23 requisitions today, and the Round 2 interviewer picker reads it alongside the hiring manager, so
leaving it blank is half of why that picker offers almost nobody (**NR-1**).

Nothing on NR-3 is open. It is specified and parked with the rest of the HR list.

---


### Outstanding Dashboard

**1. `[open]` The three collectors are already restricted by SALESPERSON. What happens to those tags
when Collection Team scoping arrives?** *(03-Sep-2026 · for **Jayshree** and Ritesh Bhai · full audit
and plan: **RC-11**)*

Collection Team and Salesperson are two separate things — but they are not separate *settings*. Both
are limits on the same account, and three of the four collectors already carry salesperson tags
today. Add a team tag without clearing them and each person ends up with **two limits at once**.

**What is actually set right now** (measured 03-Sep-2026):

| User | Salesperson tags today | Dashboard access |
|---|---|---|
| **Jayshree Patil** | 13 tags — AAYUSH SIR · DHANANJAY · KARAN SIR · KHURSHID JI · MANMOHAN JI · PURAV SHAH · **OTHERS** · **Others** · NAKUL JI · MAYANK · SUHEL · UMESH JI · ABHISHEK | edit |
| **Nitesh Prajapati** | 8 tags — ABHISHEK · DHANANJAY · SUHEL · PURAV SHAH · OTHERS · NAKUL JI · UMESH JI · KARAN SIR | edit |
| **VIJAY** | **1 tag — NAKUL JI** | edit |
| **BENI MADHAV MOHTA** | none | 🔴 **no access at all** |

**The questions:**

- **Should the salesperson tags be cleared on these three**, so each is limited by Collection Team
  only? ⚠ If Vijay keeps `NAKUL JI` *and* gains team `Vijay`, he sees only the customers that are in
  **both** — likely a handful, not the **114** the sheet assigns him.
- **Jayshree already sees everything.** The sheet holds 11 salespeople and her 13 tags cover all 11
  (plus `MAYANK`, who has no customers in it). So "Jayshree views all" is already true — just spelled
  out name by name rather than granted as a rule. Should it become a proper "all teams" grant?
- 🔴 **Mohta ji cannot open the Outstanding Dashboard at all.** He has a login and no module access.
  One edit in Admin → Module Access — but worth confirming he is meant to have it.
- ⚠ **Her tags contain both `OTHERS` and `Others`.** Tags are matched **exactly and case-sensitively**,
  so somebody has already hit this and worked around it by tagging both spellings. The same trap sits
  in the new data: the sheet stores **`Vijay` (102 rows) and `vijay` (12 rows)** as two different
  teams. Both want cleaning at source, not in code.

---


## Platform — all modules

### PF-1 · Save Draft on every entry form  🟡  `[ ]`
*Raised 2026-08-20 · **Order: Production Entry first, then Order to Dispatch**, then the rest*

A standard **Save Draft** on all entry forms. On save the entry is **not published**; the same user
reopens the draft, finishes it, and publishes.

**The problem it solves:** in Production a user enters 10 raw materials, finds the 11th is not in
the system, and raises a master request for it — at which point the whole page has to be abandoned
and all 10 lines re-entered. That is a real cost on a long form, and it is why people avoid raising
the request at all.

**Notes:** this already exists, fully built, in **Customer Onboarding** — copy it rather than
invent it. Its wizard autosaves through `fms_customer_save_draft` / `fms_customer_delete_draft`
([customerWrites.ts](frontend/src/apps/receivables-hub/data/customerOnboarding/customerWrites.ts),
[WizardShell.tsx](frontend/src/apps/receivables-hub/components/customerOnboarding/WizardShell.tsx)),
with `status = 'draft'` as the first value of the status column. Two hard-won rules come with it,
both spelled out in
[its migration](supabase/migrations/20260802120100_add_fms_customer_requests.sql):

- **A draft is incomplete by definition, so the mandatory fields cannot be `NOT NULL` columns.**
  They are enforced by one CHECK that applies only to rows whose status is not `draft`, with the
  submit function raising friendly field-named errors long before the constraint fires.
- **A draft never burns a number.** The sequence is stamped by submit, not by save, so an abandoned
  draft leaves no gap in the numbering.

Nothing else in the codebase has this — every other `draft` in the frontend is just local component
state that dies with the page.

**Worth settling before building:**
- [ ] Is a draft private to its author, or can a colleague pick it up?
- [ ] Where does a user find their drafts — a tab on the queue, or the module dashboard?
- [ ] Do drafts expire or get cleaned up, and does an abandoned one ever need chasing?
- [ ] Should raising a master request from inside a form **auto-save the draft**, since that is the
      exact moment the work is lost today? (Related: **OD-2** / **OD-3**, which change how master
      requests are raised in Dispatch.)
- [ ] Which forms count as "entry forms" in the modules after these two — every step modal, or only
      the long ones that create an entry?

---

### PF-2 · 🟢 Queues tell approvers "Nothing here" while they are still loading  `[~]`
*Raised 2026-08-20 · **Downgraded 🔴 → 🟢 on 03-09-2026 (client’s call).** ⚠ Re-raise it the moment
the team complains again — the original symptom is NOT fixed; see the status check below.*

#### Where this actually stands — checked in the code, 03-09-2026

The entry below says step 1 was *"shipped, not yet deployed"*. **That note is stale: step 1 IS
deployed** — `QueueTable`’s `loading` prop is on `master`, and master’s head deploys green. But the
task is nowhere near done:

| Step | State |
|---|---|
| **1 · Loading state instead of "Nothing here"** | **Partly done and live.** 33 of 77 `QueueTable` files pass `loading`. **Eight modules have ZERO coverage** and still lie on first paint: procurement (8 files), hr-recruitment (9), hr-exit (8), import (8), asset-maintenance (3), office-supplies (3), sampling (3), master-report (1). Much of the coverage that does exist came free with travel-desk and OCPI, which were built later — not from this task. |
| **2 · `refetchOnWindowFocus`** | **Not started.** Still `false` in `main.tsx`. |
| **3 · `refetchInterval` on FMS queues** | **Not started.** No polling anywhere in the default config. |
| **4 · Realtime on the FMS tables** | **Not started.** `postgres_changes` still exists in exactly ONE file, task-management’s notifications. No FMS has it. |

⚠ **So the thing the team actually complained about is untouched.** An approver’s open tab is still
never told that someone else changed the data — no timer, no realtime, and not even a refetch when
they alt-tab back. Their screen shows yesterday’s picture until they reload. Steps 2–4 are the fix;
step 1 only stopped the screen *lying* about it while it loads.

Two symptoms, one cause:

- A master request sits unseen — the approver takes a long time to notice it.
- In Order to Dispatch, once step 1 is done the item takes a long time to reach the second person's
  bucket.

**Root cause (found 2026-08-20): nothing tells a browser that someone *else* changed the data.**

- The FMS stores refresh by calling `invalidateQueries` **inside the tab that performed the
  write** ([store.tsx:302](frontend/src/apps/order-to-dispatch/store.tsx#L302)). The person who
  completes step 1 sees their own screen update instantly. The next person's tab is never told
  anything happened.
- The global query config is `staleTime: 60_000` with **`refetchOnWindowFocus: false`** and no
  `refetchInterval` ([main.tsx:22](frontend/src/main.tsx#L22)). So a page left open never refetches
  — not on a timer, and not even when the user alt-tabs back to it. The data only moves on a
  reload, or when a component remounts after the 60s stale window.
- **Realtime exists in exactly one module** — Task Management subscribes to `postgres_changes` for
  its notifications ([useMyNotifications.ts:77](frontend/src/apps/task-management/lib/useMyNotifications.ts#L77)).
  No FMS has it.
- **Polling exists in exactly one place** — Customer Onboarding's bell, at 60s
  ([CustomerBell.tsx:68](frontend/src/apps/receivables-hub/components/customerOnboarding/CustomerBell.tsx#L68)).


**PROVEN 2026-08-20 by an end-to-end test** (signed in as an approver, raised an item request from
the New Sales Order screen, exactly the flow the team uses):

| Step | Measured |
|---|---|
| Request submitted → row in the database | **instant** (`created_at` stamped on submit, `status = pending`) |
| "Send request" click → dialog closes | **6.0 seconds** |
| Master Requests page: **shows "To review 0 · All 0" and the "Nothing here" empty state** | **for the first 5.8 seconds of every load** |
| Then flips to the true counts | at 5.8 s → "To review 1 · All 110" |

**This is the bug.** While the data loads, the page does not show a spinner or "Loading…" — it shows
a confident, fully-rendered **"Nothing here — Requests for new master entries will appear here."**
An approver opens the screen, is told there is nothing to approve, and leaves. They reload, are told
the same thing, and leave again. The request was in the database the whole time.

That is the 10 minutes: not the system being slow, but the screen **actively saying the queue is
empty** while it is still loading.

**The fix:** never render the empty state until the query has resolved — show the loading state
while `isLoading`, and reserve "Nothing here" for a genuinely empty result. Then check every other
queue for the same pattern; the counts on this page start at 0 for the same reason.


**Step 1 shipped 2026-08-20 (not yet deployed).** `QueueTable` takes a `loading` prop; when it is
true and there are no rows it renders a spinner and "Loading…" instead of the `EmptyState`. Wired
into Order to Dispatch: Master Requests, StageQueue (both tables), OrdersTable, SalesReturnQueue.
The Master Requests tab counts now omit the badge while loading, so nobody reads a placeholder
"To review 0" as an answer.

Verified in the browser, same measurement as before the fix:

| | Before | After |
|---|---|---|
| First paint | "Nothing here", To review **0** | **"Loading…"**, no counts shown |
| Real data | 5.8 s | 3.4 s |

`loading` is optional, so the other 60-odd call sites across the eight other modules are unchanged
and still show the old empty state — **they need the same one-line wiring.**

**Still to do — the actual weight (steps 2-4):** every page still downloads the whole module,
15,425 rows over 25 round trips (notifications 4,993 · customer-items 3,179 · four months of
activity 2,760). Measured 2026-08-20. That is the reason the wait exists at all; the loading state
only stops the screen lying about it.

**⚠ Before doing steps 2-4, watch a real user's load from the factory.** Every number here was
measured on a fast local connection, and 6 seconds is not 10 minutes. The payload finding is solid;
that it fully explains the team's experience is not proven.

Related but separate: the 6-second submit and 5.8-second load are themselves slow for a table of
109 rows, and worth a look once the empty-state bug is fixed.

So the delay is not the approver being slow. Their screen is genuinely showing yesterday's picture
until something forces a reload — and this applies to **every FMS queue and every master request
list in the portal**, not just Dispatch.

**The fix, cheapest first:**

1. **`refetchOnWindowFocus: true`** — one line, and it covers the commonest case: the approver
   switches back to the tab and sees the truth. ⚠ It is global, so weigh it against the heavy
   receivables payload, which would also refetch on every focus. May be better set per query root
   than on the default.
2. **`refetchInterval` on the FMS queue queries** (~60s) — the Customer Onboarding bell already
   does exactly this and is the proven pattern here.
3. **Realtime on the FMS tables** — the correct end state, and the largest change. Task Management
   already shows the shape.

**Decide before building:**
- [ ] Scope: fix Production + Dispatch first (matching **PF-1**'s order), or all modules at once?
- [ ] Is a ~60s lag acceptable, or must a handover be instant (which means realtime)?
- [ ] Should the notification the next owner receives be the thing that wakes their queue up?

---

### PF-3 · 🟢 The `mst-refresh-company-links` job rebuilds ~2,100 rows from scratch every 15 minutes  `[ ]`
*Raised 2026-08-20 · Found while investigating **PF-2***

A cron job added on **17-Aug** (`cron.job` id 30, schedule `5,20,35,50 * * * *`) runs
`mst_refresh_party_companies()` + `mst_refresh_item_companies()` **unconditionally, four times an
hour**. Measured: **11–16 seconds every run, 252 runs, average 11.6s**, steady since the 17th.

**What it does each time:**
- takes the **333** Dispatch parties, strips punctuation from each name on the fly, and compares
  them against **all 7,842** parties (plus a GSTIN match) to find the same firm in another book;
- same for **536** Dispatch items against **all 14,261**;
- writes the result into `mst_party_companies` / `mst_item_companies` — **764 + 1,368 rows** that
  almost never change.

Roughly **10 million string comparisons every 15 minutes to reproduce the same ~2,100 rows.**

**Why it is slow:** the normalised name is computed *inside the join*
(`upper(regexp_replace(name,'[^A-Za-z0-9]+','','g'))`) on **both** sides, so no index can be used —
it is a full scan of every party against every party. It also has **no `statement_timeout`**, unlike
every other heavy job in `cron.job`.

**The fix, in order:**
1. **Guard it** — only rebuild when the masters actually changed. `mst_sync_runs` already keeps a
   watermark, and `masters-sync-watch` (job 8) proves the pattern works: 575 runs, **0.0s average**,
   because it does nothing when nothing changed.
2. **Store the normalised name as a real, indexed column** instead of computing it per comparison.
   That turns the scan into a lookup and should take the run well under a second.
3. **Ease the schedule** to every 3 hours as a safety net (the user's call, 2026-08-20). A manual
   sync covers anything urgent.

**⚠ Not the cause of PF-2.** Checked hour by hour: this job has been flat at 11–13s yesterday *and*
today, so it did not change when the complaints started. It is a standing waste worth removing on
its own merits, not the answer to the delay.

---

### PF-4 · 🟢 Document every Supabase table, view, function and cron job — and list the dead ones  `[ ]`
*Raised 2026-08-20 · **Low priority, high value** · touches no other task, so it can run in parallel
with anything on this list*

Months of building have left the database larger than anyone's memory of it. Nobody can say today
what half the tables hold, and there is no one place that answers it. Along the way we have almost
certainly created tables, views and cron jobs for features that changed shape or were dropped, and
they are still there — costing backup size, autovacuum, and the time of the next person who has to
work out whether a name matters.

**The deliverable:** one file — `docs/SUPABASE-INVENTORY.md` — carrying a **one-line purpose against
every object**, and a second list of **what looks dead**, with the evidence for each.

**What is actually there** — identity project `icutjkrqkbzwvmnfbzpr`, `public` schema, counted
2026-08-20:

| | Count |
|---|---|
| Tables | **240**, of which **44 are completely empty today** |
| Views / materialised views | 0 |
| Functions | 546 |
| Cron jobs | 9, all active |
| Edge Functions | 17 (`supabase/functions/`) |
| Migrations applied | 313 |

The nine jobs are `email-outbox-sweep`, `generate-recurring-daily`, `fms-asset-generate-jobs`,
`fms-asset-send-reminders`, `master-report-daily`, `masters-sync-watch`, `masters-sync-daily-force`,
`user-snapshot-daily` and `mst-refresh-company-links` — the last of which **PF-3** is already
about, and which is the kind of thing this inventory exists to surface.

**What each row should carry:** the object name · the module it belongs to · one line saying what it
is for · what writes to it · what reads it · rows today · last write · a verdict of **live /
historical / dead**.

**Telling dead from merely quiet** — the two are easy to confuse, so check both directions:

- **Written?** row count plus `max(created_at)` / `max(updated_at)`. An empty table can still be a
  live feature nobody has used this month.
- **Read?** grep the frontend, the Edge Functions and the SQL for the object's name. A table no code
  anywhere names is dead however full it is — and that is the stronger signal of the two.

Cron jobs get a third check: `cron.job_run_details` already records every run, so a job's real cost
and its failure rate can be stated rather than guessed.

**⚠ The output is a list, not a drop script.** [CLAUDE.md](CLAUDE.md) holds Supabase changes to
**additive-only**, and that rule stands. Nothing is dropped off the back of this task — the list
goes to Bushra, and each object is removed later, one at a time, with sign-off and a backup taken
first. Several "dead" tables will also turn out to be deliberate history (the `fms_import_*` and
`fms_purchase_*` sets in `backups/fms-purge-2026-07-29/`, for instance) and must be marked
**historical**, not dead.

**Also in scope, kept separate:** the ConnectWave mirror (`ieeefdnyhzgrroifiqbb`). It is the
external Python pipeline's database, read-only to us, so its section only needs the tables we
actually read — not its whole schema.

**Worth settling before starting:**
- [ ] Do the 546 functions go in the first pass, or only tables + cron jobs, with functions as a
  second sweep? (546 one-liners is the bulk of the work, and most are RPCs named after the screen
  that calls them.)
- [ ] Where does the file live — `docs/`, or beside `CLAUDE.md` at the root where the other live
  documents sit?

---

### PF-6 · A view-only user gets the module dashboard and nothing else  `[x]`
*Raised 2026-08-21 · **VERIFIED LIVE 03-09-2026** — it is NOT waiting to be pushed; it already
shipped. Checked three ways: all three migrations are applied on `icutjkrqkbzwvmnfbzpr`
(`enforce_view_only_in_the_database`, `view_only_reads_the_whole_module`,
`view_only_reads_supplies_exit_and_requisitions`, 20–21 Aug); `isModuleViewer` is on **master** in
`session.tsx` and wired through **12 modules**; and **11 live `view` grants** exist in `app_access`,
so it is in real use, not merely deployed. · Follows on from **PF-5**, which shipped the view/edit
level itself*

⚠ **One piece was deliberately left out and is still out — the My Work feed.** It filters on
`hasModule` and consults no write ceiling, so a view-only user who is *also* a step owner still gets
an actionable worklist. That was a conscious exclusion (see the foot of this entry), not an
oversight — and it is the only thing anyone could argue keeps this open.

We can now grant a module at **View only** instead of full access. The intent is written into
[session.tsx](frontend/src/core/platform/session.tsx) in as many words — *"a view-only user opens the
app normally and reads every screen in it, they simply have no buttons"*. **That is not what
happens.** They land on the module dashboard and can reach nothing else.

**Why.** Inside every FMS, *which screens exist* is decided by **ownership config**, never by the
module grant: `fms_<mod>_step_owners` → the queue links and their route guards,
`process_coordinators` → the Control Center, `fms_<mod>_master_managers` → Masters. A view-only user
owns none of these. Nothing anywhere in the read path consults `app_access` at all.

It is not only a nav problem. In four modules the **data itself** is ownership-scoped by RLS, so
even with the routes open the tables would come back empty.

**What the audit found** (2026-08-21, all nine FMS modules) — three things that decide the shape of
the work:

1. **Only four modules need SQL.** Procurement, Import, Sampling, Production Entry and Asset
   Maintenance already read `for select using (true)` — nothing to widen. Dispatch, New Recruitment,
   Employee Exit and General Purchase each funnel every gated table through **one** function, so it
   is about six SQL edits rather than forty.
2. **There is no single lever in the frontend.** `canSeeQueue` exists in only five of the nine.
   Procurement and Import use twelve flat per-step capability flags; the two HR modules have **no
   route guards on their queue routes at all** and self-guard inside each page.
3. **About 25 action buttons are gated by ownership with no write-ceiling test** — see **PF-7**,
   which is that half.

**The decisions, taken 2026-08-21:**

1. **View-only unlocks the whole module.** An `edit` grant keeps today's ownership-driven
   visibility, so **nothing changes for anyone working in the modules now.** This does mean a viewer
   sees more screens than an editor who owns no step — accepted, and to be written into the code so
   the next reader does not "fix" it.
2. **Operational screens only.** Dashboards, lists, registers, queues, Masters lists, Master
   Requests and the Control Center. Setup and configuration stay admin-only — that is where
   permissions themselves are set.
3. **HR and Exit: the operational tier only.** A viewer reads requisitions, candidates, exit cases,
   clearance and handover. The three confidential satellites keep their existing narrow gates —
   **candidate PII**, **exit-interview transcripts**, **F&F settlement amounts**. Note
   `20260712180000_fms_hr_restrict_candidate_pii.sql` exists precisely to stop a wide HR read
   leaking PII; whether its function *is* the PII protection or merely sits beside it has to be
   settled before that module is touched.
4. **Pilot Order to Dispatch, verify on a real view-only login, then roll out.**

**Two that come free with it:** the FMS Control Center lists a viewer's modules but every row
click-throughs to `/<app>/monitoring`, which is behind the coordinator guard — so today
non-coordinators hit Access Denied from a link the page offered them. And **New Customer
Onboarding** carries the same `canSeeQueue` gate and is in scope with the FMS modules.

**Not in scope, deliberately:** the My Work feed. It filters on `hasModule` and no provider consults
the write ceiling, so a view-only user who is *also* a step owner gets an actionable worklist. That
is not a regression — they were made an owner — and the fix is constrained, because
`mywork/items/README.md` forbids filtering in `providers/` and the same builders are bundled and run
server-side for the 9am snapshot email. Filing it rather than bolting it on.

**Deploy ordering:** the migration goes in **before** the frontend, or the newly-visible queues
render empty.

---

### PF-8 · Every save in the other 7 FMS modules re-downloads the whole module — 260 write paths to fix  🟢  `[ ]`
*Raised 2026-08-21 · **not blocked** · **low priority on purpose** — nobody is waiting on it and no
module is hurting today. Pick it up when there is room, or when one of them starts to feel slow.*

**OD-6** and **OD-8** fixed Order to Dispatch: a save went from a 6-second wait and ~5 MB of traffic
to instant and 126 kB. Neither problem was unique to that module — **the shape is the house pattern,
and every FMS module has it.**

Counted on 2026-08-21, every write path that ends by re-downloading its whole module:

| Module | Write paths that refetch everything |
|---|---|
| Procurement | **58** |
| Import | **56** |
| Sampling | **43** |
| HR Recruitment | **39** |
| Office Supplies | **29** |
| Asset Maintenance | **23** |
| Production Entry | **12** |

**Why this is 🟢 and not 🔴.** Only Dispatch carried 5 MB, because it is the only module that loads
the full customer/item catalogue — its pickers need it. Every other module's largest table is **701
rows**, and their reads run 120–220 ms. They re-download a few hundred KB per save, which nobody
notices and Supabase barely feels. That is the whole reason this waited.

**What to reuse when the time comes** — Dispatch is the worked example, and each piece stands alone:

1. **Check the RLS shape first, before anything in the app.** Dispatch's real problem was a policy
   calling a non-inlinable `SECURITY DEFINER` function per row. Supabase's own advisor flags this
   across the project (`auth_rls_initplan`, 257 warnings; `multiple_permissive_policies`, 233). See
   [20260924120000](supabase/migrations/20260924120000_dispatch_visibility_hoisted.sql) for the
   rewrite and, more importantly, for how it was proved not to change who sees what.
2. **Stop the modal waiting on the refetch** — the one-line change that users actually feel.
3. **Split the query key** so a save stops re-pulling masters that cannot have changed.
4. **Trim `select("*")`** to the columns the mappers read.
5. **Fetch per-row detail on demand** rather than carrying every row's history in the snapshot.
6. **Ask only for what changed** — but only where the payload justifies it, and only on top of a
   trigger that makes the parent's timestamp trustworthy
   ([20260926120000](supabase/migrations/20260926120000_dispatch_children_touch_parent_order.sql)).

**Do not do all six everywhere by rote.** On these modules, 2 and 3 are cheap and probably sufficient;
5 and 6 buy little against a 701-row table and carry real risk. Measure the module first — bytes and
requests for a cold load and a save — and stop when the number stops being embarrassing.

**One thing already fixed for everyone, not just Dispatch:** sign-out now clears the persisted
IndexedDB cache. It never did, so a signed-out browser kept the last user's receivables payload and
staff directory on disk for 24 hours, readable through devtools without logging in. That shipped with
**OD-8**.

---

**Shipped 2026-08-21 (frontend + both migrations applied to `icutjkrqkbzwvmnfbzpr`):**

**⏳ AWAITING KRITIKA'S FEEDBACK — do not close this until she has actually used it.**
*Remark added 2026-08-21.* Built, migrations applied, `npm run build` green, and the read gates
verified against her real account in SQL — but **nobody has signed in as her and clicked through
yet**, which is the only test that counts. She holds view-only on eleven modules and is the person
who reported this, so she is the reviewer.

What to ask her to check, module by module: the sidebar shows the queues, the register and the
Control Center; every one of those pages **opens with rows in it**, not empty; there are no action
buttons, no row checkboxes and no Add; the **View only** badge shows in the topbar; and Setup is
still refused. If a screen opens empty, that is a read gate, not a nav gate — say which screen and
which module.

**The HR candidate question below is PARKED, not open.** New Recruitment ships as it is — vacancies
and MRF queues readable, candidate boards hidden. Revisit only if Kritika says she needs them.

**Mark this task `[x]` and move it to [Done](#done) once she confirms**, adding the commit and the
IST timestamp — same rule as every other entry there.

`session.isModuleViewer(appId)` is the one place that knows. Each store derives the
VISIBILITY halves from it — `canMonitor`, `canSeeMasters`, `canSeeStep`, and the viewer arm on
`canSeeQueue` — and the AUTHORITY flags (`isProcessCoordinator`, `canActOn`) are untouched,
because widening those would have handed a viewer act-authority rather than a read.

| Module | Screens opened | SQL needed |
|---|---|---|
| Order to Dispatch | queues, register, Control Center | yes — `20260925130000` |
| Production Entry · Sampling · Asset Maintenance | queues, Masters, Control Center | none (already `using (true)`) |
| Purchase RM Domestic · Purchase RM Import | 11 queue routes, Masters, Control Center | none |
| General Purchase | queues, Masters, Control Center | yes — `20260925130100` |
| Employee Exit | approvals, clearance, Masters, Control Center, documents | yes — `20260925130100` |
| New Recruitment | MRF + job-posting queues, Masters, Control Center | yes, **vacancy tier only** — see below |
| New Customer Onboarding | the four back-office queues | none |

**Verified on live data:** General Purchase 8/8 requests visible to a viewer, New Recruitment
13/13 requisitions, candidate tier still 0, F&F still 0. The dispatch equivalence check reports
0 mismatches across 1,500 (user, order) pairs.

**⚠ NEW RECRUITMENT IS HALF-OPEN, AND THAT NEEDS A DECISION.** `fms_hr_can_read_requisition`
turned out to *be* the candidate-PII gate, not merely a visibility rule that covers candidates —
closing a PII hole is the whole reason it exists (`20260712180000`). So `20260925130100` widens a
sibling, `fms_hr_can_view_requisition`, used only by the requisition tables, and leaves the PII
gate alone. A viewer reads the vacancies and the MRF queues; the candidate boards stay hidden
rather than opening empty, and the frontend matches.

- [ ] **PARKED 2026-08-21** — revisit only if Kritika asks for it. Should a view-only holder
      read candidates at all? If yes, the answer is a **masked
      projection** — stage, dates and counts without name, phone, email, CV or expected salary —
      which is its own piece of work with its own call on which columns count as PII. Widening
      the existing function is not an option; an assertion in the migration now refuses it.

**Not in scope, deliberately:** the My Work feed. It filters on `hasModule` and no provider
consults the write ceiling, so a view-only user who is *also* a step owner gets an actionable
worklist. Not a regression — they were made an owner — and the fix is constrained, because
`mywork/items/README.md` forbids filtering in `providers/` and the same builders run server-side
for the 9am snapshot email.

### PF-7 · About 25 action buttons are gated by ownership alone, with no write-ceiling test  `[x]`
*Raised 2026-08-21 · Found while auditing **PF-6**, and it ships with it · **Moves to
[Fixes](#fixes) when it lands** — several of these are live faults, not new work*

A write affordance is supposed to ask `canEdit` (the module write ceiling) as well as "is this step
mine". Roughly 25 do not, and **several leak today**, before any of PF-6:

- **Two store-level root causes.** `canManage` in **Employee Exit** and **New Recruitment** omits
  `canEdit` entirely — the other seven stores fold it. That is every `MasterCrud` Add/Actions column
  plus Approve/Reject on two `master-requests` routes that are already ungated.
- **Twelve capability flags** in Procurement and Import are bare `isStepOwner(...)` and feed the
  buttons as well as the routes, so the nav and the write gate are the same flag.
- **Individually:** the sales-return buttons in Dispatch, `JobDetail` in Asset Maintenance,
  `RequestDetail` in Production Entry, the Ready-to-Dispatch **bulk-action bar** (a viewer gets row
  checkboxes), `requestEditable` in General Purchase, the Decide/Post modals and stage-change menu in
  New Recruitment, and the four decision modals behind the Exit approvals queue.
- **Two with no gate at all:** candidate tag add/remove, and the **AI CV read** — which writes *and
  spends money*.


**Fixed 2026-08-21, alongside PF-6.** Two store-level root causes and the call sites:

- **`canManage` in Employee Exit and New Recruitment** now folds `canEdit`. It did not, so every
  `MasterCrud` Add/Actions column and Approve/Reject on both modules' **ungated** `master-requests`
  routes was live on a view-only grant. Both stores also needed `canEdit` **moved up** — `canManage`
  is called synchronously by `resolvableRequests` above where `canEdit` was declared, so folding it
  in without moving it is a temporal dead zone and the store throws on first render.
- **The twelve `isStepOwner` capability flags** in Purchase RM Domestic and Import now fold
  `canEdit`, which makes them authority; the new `canSeeStep(k)` is what the nav and `RequireCap`
  read. One flag was doing both jobs.
- **New Recruitment's completed entries** — `canEdit` on every `StageEntry` came from ownership
  alone and drove `CompletedTable`, i.e. every Completed tab in the app. The ceiling now applies
  once, at the `completedFor` boundary, so the next branch added is honest by default.
- **Call sites:** the sales-return buttons in Dispatch, `JobDetail` in Asset Maintenance,
  `RequestDetail` and the Ready-to-Dispatch **bulk-action bar** in Production Entry, `RequestQueue`
  and `requestEditable` in General Purchase, the Exit approvals queue, and in New Recruitment the
  Decide/Post modals, the interview actions and the stage-change menu.
- **Two that asked nothing at all** — not even ownership: candidate **tag** add/remove, and the
  **AI CV read**, which writes a score *and spends money* on every press. Both now gate at the
  write itself, and the AI button no longer renders for a viewer.

**One more found while sweeping, and it was a genuine drift.** Customer Onboarding's client
`canActOn` carries a comment saying it mirrors `public.fms_customer_can_act` — but
`20260923120000` wrapped the SQL side in `module_can_edit` and this copy was never updated. Every
correction and step button rendered live on a view-only grant and then failed at the RPC. The
mirror is restored.

**The fix is uniform:** `canEdit && <existing predicate>`, matching the reference implementations in
`production-entry/components/StageQueue.tsx` and `sampling/components/RequestQueue.tsx`. Where a
`QueueTable` wraps the buttons, `readOnly={!canEdit}` does it in one line — it drops the actions
column *and* the whole row-select apparatus. Of 70 `QueueTable` sites across these apps, **three**
pass it today.

⚠ One deliberate counter-example not to "fix": the Completed table in
`sampling/components/RequestQueue.tsx` omits `readOnly` on purpose, so the row action degrades to a
lock that still opens the entry read-only. The comment above it says so.

---

### PF-9 · Browser notifications, on top of the bell and the emails  🟢  `[ ]`
*Raised 2026-08-21 · Touches every module that has a bell*

We already notify at two points: the **in-app notification bank** (the bell in the topbar) and
**email**, wired at each step. Both need the person to come looking — the bell only speaks once
they open the portal, the email only once they open their inbox. Add a third: while the portal is
open in a browser tab, a **native OS notification** fires the moment something lands for them, so
they see it without watching the tab.

Scope for this item is **foreground only** — the tab is open. Notifying a user whose browser is
closed is a different, much larger job (see *Later* below); do not let it hold this one up.

**What already exists, and what has to be built**

- The bell's payload shape is already shared and already the right one to notify from:
  `NotificationItem` in
  [types.ts:52-64](frontend/src/shared/components/layout/types.ts#L52-L64) — actor, message,
  `createdAt`, `unread`, and `to` for the click-through. A browser notification is that same
  object rendered by the OS instead of the panel, so nothing new has to be composed.
- **Only ONE of the feeds is live.** The task feed subscribes to `postgres_changes` on
  `notifications` in
  [useMyNotifications.ts:70-85](frontend/src/apps/task-management/lib/useMyNotifications.ts#L70-L85)
  — the **only** `.channel()` call in the entire frontend. The ten FMS
  feeds (`fms_exit_notifications`, `fms_hr_notifications`, `fms_import_notifications`,
  `fms_purchase_notifications`, `fms_supplies_notifications` and the per-module reads in each
  app's `*Fetch.ts`) arrive only with the module payload, on load or after a write. **A browser
  notification needs a live signal, so the realtime subscription is the real work here, not the
  notification API.** Doing it feed-by-feed means ten subscriptions and ten near-identical
  hooks — decide first whether the FMS feeds should be read through one place (a union view, or
  one table) rather than replicating the task app's hook ten times.
- There is no service worker and no web app manifest ([frontend/public/](frontend/public/) holds
  only `assets`), and none is needed for the foreground case.

**How to build it** (the mechanics, so this isn't re-derived later)

1. **One hook, `useBrowserNotifications`,** sitting beside the bell rather than inside any module.
   It takes the same `NotificationItem[]` the bell already renders and fires the ones that are new
   *since mount*. Fire on arrival, not on read.
2. **Ask for permission from a real click, never on page load.** `Notification.requestPermission()`
   returns `granted` / `denied` / `default`, and **`denied` is permanent** — the page cannot ask
   again, the user has to undo it in the browser's site settings. So it goes behind an explicit
   "Enable desktop notifications" toggle on [Account.tsx](frontend/src/core/account/Account.tsx),
   with the current permission state shown and a line telling a denied user where to re-enable it.
   An auto-prompt on load is how people click Block by reflex and lose the feature for good.
3. **Fire it:** `new Notification(actorName, { body, icon, tag: n.id, data: { to } })`, and on
   `onclick` call `window.focus()` then route to `n.to`. Requires HTTPS — Vercel is, and
   `localhost` counts as a secure context, so dev works too.
4. **Only when the tab isn't already being watched.** Gate on
   `document.visibilityState === "hidden"` (or the window not focused) — if the user is looking
   at the queue, the bell and the row updating in place already told them, and an OS toast on top
   is noise.
5. **Never notify someone about their own action.** The feeds carry `actorId`; skip rows where it
   is the signed-in user, or a person who approves ten items gets ten toasts about themselves.
6. **Dedup across tabs.** Two open tabs = two subscriptions = the same event twice. `tag: n.id`
   makes the OS collapse them into one visible toast, which is enough to ship; a `BroadcastChannel`
   leader election is the clean fix if it turns out to matter.
7. **Don't fire the backlog.** On mount, seed the "seen" set from whatever the first fetch returns
   and only notify on rows after that — otherwise opening the portal with 30 unread items detonates
   30 toasts at once.

**Later, and deliberately not now:** notifying a user whose browser is *closed* is Web Push — a
service worker, `PushManager.subscribe` with a VAPID key pair, a `push_subscriptions` table, and an
edge function that fans out on every notification insert. It is a real project of its own, it needs
the same per-user opt-in, and it duplicates what the email already does today. Revisit only if
people say the emails aren't landing. One caveat worth knowing early: **Chrome on Android refuses
the plain `new Notification()` constructor** and throws — mobile needs the service-worker path even
in the foreground. Desktop Chrome, Edge, Firefox and Safari are all fine, so if the coordinator and
the HODs are on laptops, step 1–7 above covers them.


### PF-10 · WhatsApp integration  `[!]`
*Raised 2026-08-22 · **Blocked:** waiting on the WhatsApp team*

Notify people over **WhatsApp**, alongside the in-app bell and email (cross-ref **PF-9**, which adds
the browser as a third channel).

**Where it stands:** in discussion with the WhatsApp team for a while now, and **still no
clearance** — so nothing is designed and nothing is built. It is logged here because it is being
chased weekly and appears on the client report; the moment access is granted this stops being a
waiting item and becomes a build.

**Worth settling before it lands:** which events are worth a WhatsApp (an approval waiting, a step
overdue, the collection report going out) as against the ones that would make it noise; whose
number it goes to, given `profiles.phone` already exists; and whether a message is one-way or
expects a reply.

### PF-11 · Training videos, and a place in the hub to watch them  🔴  `[!]`
*🔴 **HIGH priority, and BLOCKED on the business, not on us** (03-09-2026): the videos have to be
recorded by **Bushra and Ritesh Bhai**. Nothing can be built until the content exists — the hub page
is the small half. · Raised 2026-08-22 · **Joint work with Bushra** · touches every module*

Two halves, and neither is much use without the other:

1. **The videos.** One per module, walking a person through the screens they actually use. Recorded
   jointly — Bushra knows the process, we know the screens.
2. **Somewhere to watch them.** A screen inside the portal where a person finds the video for the
   module they are in, rather than a folder someone has to be sent a link to.

**Notes:** nothing like this exists in the portal today — no help screen, no video anywhere. The
nearest thing is each module's own dashboard. Worth settling before recording: whether a video is
per module or per step (a nine-module portal is a lot of one-hour videos, and nobody watches those);
where the files are hosted, since a video in the repo is a mistake and Supabase storage has a cost;
whether a new joiner is *pointed* at them by the portal or has to go looking; and whether they need
re-recording every time a screen changes, which is the reason most such libraries die.

### PF-15 · 🟢 No spreadsheet this portal has ever produced has a frozen header row  `[~]`
*Raised 2026-09-02 · Found while building OCPI-5 · **partly fixed** — the new export is correct, every
other one still is not*

`shared/lib/exportXlsx.ts` set `ws["!freeze"] = { xSplit: 0, ySplit: 1 }` on every sheet it wrote, and
three comments around it described the header row as frozen. **It writes nothing.** The community
`xlsx-js-style` writer emits every sheet as

    <sheetViews><sheetView workbookViewId="0"/></sheetViews>

— a self-closing `sheetView` with no `<pane>` child — and there is no key it reads that produces one.
Panes are a Pro feature of the upstream library. So the line has been dead since the helper was
written, and **every export in the portal scrolls its header off the top**: the Deal Register, the
Weekly Scorecard, Master Analysis, the asset reports, `MasterCrud`'s Excel button, the receivables
reports, the user list. Nobody reported it because nobody reads far enough down a 25-row export to
notice, which is exactly why it survived.

🟢 **The mechanism to fix it now exists and is proven.** OCPI-5 added `freezeCols` to `ExportSheet`:
after `XLSX.write`, the workbook is re-opened with JSZip (already a dependency, already used in the
browser by receivables-hub) and the `<pane>` element injected into the sheets that asked, mapping
sheet name → XML part through `xl/workbook.xml` and its rels rather than guessing `sheet1.xml`.
Verified by opening the file in Excel: `FreezePanes=True`, `SplitColumn=4`, `SplitRow=4`.

🔴 **Deliberately NOT switched on for the other exports**, and that is the open half. The OCPI-5 brief
required the helper change to be strictly additive, so a sheet that does not ask still gets no pane.
Turning it on globally would change the output of four modules' spreadsheets at once — almost
certainly for the better, but not as a side effect of an unrelated build.

**What to do:** default `freezeCols` to 0 with the header row frozen for every sheet, i.e. always run
the pane pass with `ySplit = headerRow + 1`. It is a one-line default and one deleted condition. Then
re-open one export per module and confirm, because — as this entry is the proof — reading the code
does not settle it.

⚠ **The dead `!freeze` line is gone, but check for the belief, not the line.** Any new export written
by copying an old one may carry the same comment. Grep for `!freeze` before trusting a claim that
something freezes.

### PF-14 · OCPI, Customer Onboarding, Asset Maintenance and Travel Desk have no step owners at all — every approval in them is admin-only  `[!]`
*🔴 **BLOCKED ON: Ritesh Bhai and Bushra** — they must NAME the people. Four lists to fill:
OCPI quotation approval · Customer Onboarding’s three approvals · Asset Maintenance `verify_close` ·
Travel Desk director / advance / finance. Six travel trips are already sitting with no approver. ·
Raised 2026-08-27, found while auditing for **PF-13** · this needs the business to name people, not
code*

`fms_ocpi_step_owners`, `fms_customer_step_owners`, `fms_asset_step_owners` and
`fms_travel_step_owners` hold **0 rows each**, and none of those four modules has a
`process_coordinators` row either. So **OCPI** quotation approval, **Customer Onboarding**'s three
approvals, **Asset Maintenance**'s `verify_close`, and **Travel Desk**'s director / advance / finance
steps have nobody configured at all: only an admin can move them, because only the admin arm of
`can_act` ever matches. Six travel trips are sitting with no approver.

**Reassign cannot help this** — there is nobody to reassign *from*. It is a configuration gap, and it
is the reason **PF-13** stops where it does.

**To discuss with Ritesh Bhai / Bushra:**
- [ ] OCPI — who approves a quotation, and is it banded by value the way Purchase is?
- [ ] Customer Onboarding — who signs off each of the three approvals?
- [ ] Asset Maintenance — who owns `verify_close`?
- [ ] Travel Desk — who is the director approver, who clears an advance, and who is finance? Those
      are the six trips sitting with nobody.
- [ ] For each of them: **two names, not one.** A one-person step is exactly the thing PF-13 exists
      to work around, so naming a single person here just recreates the problem.

### Dropped — PF-12 and PF-13  *(03-09-2026, client’s call)*

Both removed from the list on Ritesh Bhai’s instruction. Recorded here because **seven entries
still cross-reference PF-13**, and a reference to nothing is worse than a reference to a decision.

- **PF-12 · The reports management actually wants** — *dropped.* It was never a build, it was a
  brainstorm: *sit with Ritesh Bhai, find out what he needs on the report side, then build it.*
  Nothing was specified, so nothing was lost. ⚠ If reporting gaps come up later they will arrive as
  their own concrete tasks, which is the better shape anyway.
- **PF-13 · Reassign an approval — the remaining four modules** — *dropped: already done for most
  modules.* The reassign pattern shipped for Purchase, Import, Dispatch and HR Recruitment. What
  PF-13 covered was porting it to **Office Supplies, HR Exit, Travel Desk and Customer Onboarding**.
  Client will say if it is wanted again.
  ⚠ **This does NOT close PF-14**, which is a different problem and still open: those four modules
  have **no step owners at all**, so there is nobody to reassign *from*. Naming people is still
  needed regardless of whether reassign is ever ported.


---

## Process Coordinator Dashboard  *(new)*

### PC-1 · Consolidated dashboard for the process coordinator  `[x]`
*Raised 2026-08-20 · Built 2026-08-23 · **CLOSED 03-09-2026 — live and verified on the server.**
`processCoordinatorApp` is registered on `master` and master’s head deploys green. Reachable at
**`/process-coordinator`** (opens on Approvals; the other screen is `/process-coordinator/processes`),
shown on the launcher as **Process Coordinator** under the **Control** category.*

⚠ **Closed as BUILT, not as in use.** Checked 03-09-2026: `app_access` holds **zero**
`process-coordinator` grants, so today only admins see it at all. Whenever a coordinator is named,
give them TWO grants — `process-coordinator`, **and `view` (NOT `edit`) on every FMS module**.
Several modules test for `view` *exactly*, so an `edit` grant makes them read **zero** for precisely
the modules that matter most. That trap is the reason this note stays here after closing.
the access grants below before it shows anything to a non-admin.*

**What shipped.** A new module at `/process-coordinator` (Control category, between the
Control Center and the Master Report), two screens and nothing else:

1. **Approvals** — every module's master requests in one queue, waiting-first, with the
   decided history one click away. Backed by `pc_master_requests()`, a UNION over the ten
   `fms_*_master_requests` tables. Approving goes back through **that module's own**
   `fms_<mod>_resolve_master_request`, so it creates the real master row, fires the
   module's notification and its email exactly as before.
2. **Processes** — one row per FMS, worst first, reusing the FMS Control Center's own
   adapters so the counts cannot disagree with it. Expanding a row shows **only the steps
   that are delayed or due today**, each with its owners' name, phone and email as
   one-click `tel:` / `mailto:` links — the half the adapter contract cannot express, since
   it stops at counts. Steps with nobody on them render "No owner set" and are counted in
   the footer.

**⚠ TWO GRANTS ARE NEEDED PER COORDINATOR, and the second is counter-intuitive.**
In Admin → Module Access give them `process-coordinator`, **and `view` — not `edit` — on
every FMS module.** Several FMS read policies (dispatch, OCPI, HR Exit) admit
`module_is_viewer()`, which is `module_level() = 'view'` *exactly*, so an `edit` grant makes
it false and the coordinator would silently see **zeros** for precisely the modules that
matter most. Verified 2026-08-23: view grants add no email traffic — no email, recipient,
announce or notify function reads `module_is_viewer`.

**Not covered, deliberately:** Sampling and Customer Onboarding have master managers but no
`master_requests` table, so they cannot appear in the approval queue. Asset Maintenance,
Customer Onboarding, OCPI and Travel Desk have **no step-owner rows at all**, so they show
"No owner set" throughout Processes until configured. Steps routing to a *per-entity* person
(HR Exit's manager steps, travel approvers) are not step-level config and so are not
resolved. `MastersReconcile` is excluded — an admin-only live merge against foreign keys,
a different data shape and authority model.

We have a new process coordinator. Build them one consolidated dashboard — **a different
thing from the existing FMS Control Center** — that does two things:

1. **Approve every master.** All master approvals across every module land with the
   coordinator, in one queue of their own.
2. **See every FMS at a glance.** Which process is running successfully, which is getting
   delayed, and *at what point* the delay is happening — with the person to call, so the
   coordinator rings them and pushes the work on.
3. **Carry that person's contact details, not just their name.** For every FMS and every
   step, resolve the owner sitting on it to a name **plus a working phone number and email
   id**, rendered so the coordinator can act on them there and then — `tel:` / `mailto:`
   links, one click, no copying a number off the screen and no second trip to the admin
   directory to look it up. Both fields already exist on the profile
   ([types.ts:106-111](frontend/src/core/platform/types.ts#L106-L111): `phone` is the
   mobile, `email` the login id), so this is a join the dashboard must carry through from
   the step's owner id — not new data to collect. Where a step has several owners, show
   them all; where it resolves to nobody, say so plainly rather than leaving a blank — an
   unowned step is exactly the kind of delay this dashboard exists to surface.

The bar is that it reads at a glance. No hunting.

**Where the existing pieces stand** (checked 2026-08-20):

- The [fms-control-center](frontend/src/apps/fms-control-center/) module is already
  org-wide, not per-user: its counts come from `buildQueueEntries`, which walks every open
  entry and emits one item per open step. What *is* per-user is only which FMS **rows**
  show — `MasterControlCenter` filters the list by `hasModule`.
- It gives counts by due-day (today / tomorrow / day after / no date) and expands to a
  per-step or per-stage breakdown, so it names the delayed **step** — but never the
  **person** sitting on it. That is the gap between spotting a delay and ringing someone.
- It does no master approvals at all. Approvals are gated on `isAdmin`
  ([MastersReconcile.tsx](frontend/src/core/admin/MastersReconcile.tsx)), so a coordinator
  who isn't an admin cannot approve anything.
- A "process coordinator" already exists in code, but **per FMS**: **twelve** modules —
  Purchase, Import, HR Recruitment, HR Exit, General Purchase, Sampling, Production,
  Order to Dispatch, Customer Onboarding, Asset Maintenance, OCPI and Travel Desk — each
  hold a `process_coordinators` config row of user ids, set in that module's own Settings.
  (This line said "four" until 2026-08-23; it was written before the last eight shipped.)
  There is no single coordinator identity spanning all modules. **Measured 2026-08-23: the
  union of those twelve lists holds THREE assignments** — Riya Kumari on HR/Exit and a
  `master@taskflow.app` system account on Purchase — so building identity on them would
  have started empty.

**Answered when we built it (2026-08-23):** a new module of its own, `/process-coordinator`
in the Control category; the FMS Control Center stays exactly as it is; and the coordinator
is **neither a role nor the union of the per-FMS lists** — holding the `app_access` row for
`process-coordinator` IS the permission, the Master Report precedent.

⚠ **The per-FMS `fms_<mod>_is_coordinator()` was deliberately NOT widened**, and must not
be: `isProcessCoordinator` is `return true` as the *first arm* of ~15 predicates across
twelve stores — `canActOn`, `canRaise`, `canCancelOrder`, `canTickCheck` and HR Exit's
`canReadConfidential`, which guards the exit-interview PII tier. Only the ten
`*_resolve_master_request` RPCs were widened, one authorisation line each.

### PC-2 · 🟢 A user's phone doubles as their login password  `[ ]`
*🟢 **Low priority — client’s call, 03-09-2026.** ⚠ Recorded as a security exposure, not a
feature gap: 56 of 60 users have signed in and signing in does not change the password, so most
logins are probably still the person’s mobile number. Anyone who knows a colleague’s mobile can
likely sign in as them. Deprioritised knowingly. · Platform / Admin · Raised 2026-08-23, out of PC-1*

Per platform convention a user's mobile number IS their initial password, set on create and
re-pinned every time the admin user form is saved. Nothing ever forces a change. Measured
2026-08-23: **60 users, 59 with a phone on file, 56 have signed in at least once** — but
signing in does not change the password, so most passwords are probably still the mobile.

That coupling is why `list_org_people()` strips phone and email, and why PC-1 needed a
SECURITY DEFINER RPC to show a step owner's number at all. A work mobile is not really a
secret inside the company; a password is. **The defect is the coupling, not the exposure.**

**To settle:** force a change on next sign-in for anyone whose password still equals their
phone; or stop re-pinning the password on every user-form save; or both. Note the admin
"Share login" modal (`core/admin/Users.tsx:227`) passes `defaultPassword={shareFor?.phone}`,
so it depends on the convention and would need to change with it.

### PC-3 · 🟢 Collapse the ten duplicated master-request systems  `[ ]`
*Also touches: every FMS · Raised 2026-08-23, out of PC-1 · **This is Central Masters Phase 3***

[CENTRAL-MASTERS.md](CENTRAL-MASTERS.md) already tracks this as Phase 3, not started. PC-1
put one queue **on top of** the ten systems rather than collapsing them, deliberately: the
thin layer carried no regression risk to any module's approval path, and it shipped in a day.

The duplication is still there underneath — ten `fms_*_master_requests` tables with
identical columns, ten `*_resolve_master_request` RPCs (nine sharing a signature, Travel
Desk's differing), ten `*_master_managers` tables, and a `mst_master_managers` that holds
**zero rows** and is the table they are all supposed to fold into.

**Worth knowing before starting:** the resolve RPCs read `proposed_payload` keys VERBATIM
from each module's `lib/masterFields.ts` — a wire contract with no compile-time link, so a
collapse has to reconcile ten field schemas. And `fms_dispatch_resolve_master_request`'s live
body is **not** the one in its migration; the Phase 1 cutover replaced it with a version that
writes into `mst_*`. Read every definition from `pg_get_functiondef()`, never from a
migration file.

---

## OCPI  *(new module)*

### OCPI-1 · Build the OCPI module, standalone  `[x]`
*Raised 2026-08-20 · Built 2026-08-22 · **CLOSED 03-09-2026 — live, deployed and in real use.**
Verified: `ocpiApp` is registered on `master`, the manifest reads `status: "live"`, and every phase
in [OCPI.md](OCPI.md) is `[x]` through 9d (Stage H · Teardown + go-live done 25-Aug-2026). The
database holds **33 deals, 15 of them real (non-test)**, latest 02-Sep — so it is not merely
deployed, it is being used.*

⚠ **Closing the BUILD, not the module.** Ongoing OCPI work continues as its own numbered entries
(OCPI-25, -28, -34, -40 and whatever follows), and a second session is actively working it. This
entry was the original "build the module" task and it is finished; leaving it open made the list
read as though the module had never shipped.
[OCPI.md](OCPI.md). Not yet cut over — see "Before it goes live" below.*

A **complete, standalone module** for OCPI, covering the whole thing end to end. What is built:

1. **Quotations** — raised in the module against a machine master, drafted privately, generated
   as a PDF on the letterhead, revised as often as a negotiation needs, every revision frozen
   and diffed field by field.
2. **Two approval gates** — quotation and order confirmation, owned per step in Settings.
3. **Order confirmations** — part B pre-filled from the quotation, rendered from each machine's
   own transcribed template, frozen at submit.
4. **The signature loop** — print, file the customer-signed copy, countersign, closed. Both
   scans held in a private bucket behind the deal's own visibility rule.
5. **Reports** — the Deal Register with filters and an .xlsx export; due dates, hold / resume /
   cancel, the cross-FMS scoreboard row and the Master Report adoption row.
6. **The lifecycle rail** on the deal page — the same shared `PoStageRail` the other eight FMS
   modules use, dated and named per step, and showing where a parked or returned deal stopped.

**Notes:** greenfield — nothing named OCPI existed before this. The Import module's
[SourcingModal.tsx](frontend/src/apps/import/components/SourcingModal.tsx) captures *vendor*
quotations for a purchase line; it was read for patterns and is a different shape.

**Before it goes live** (all recorded in [OCPI.md](OCPI.md)):
- ~~The `send-email` edge function needs one deploy~~ — **deployed 2026-08-23** (version 29;
  the live copy was diffed against `git HEAD` first, so it added the OCPI branch and nothing
  else, and `verify_jwt` stayed off). OCPI's own email switch is still off.
- **Bushra to confirm the true maximum `QT-M####`.** No longer a blocker: Settings →
  Quotation numbering takes the figure and moves the series forward (admin-only, forward-only),
  and until somebody confirms it every screen that can mint a number carries a warning. The
  counter is still seeded at 23 off the one paper form we have.
- **Bushra to proof-read the ten transcribed templates**, and to say which selling entities
  actually raise OCPIs. The four entities with no profile of their own now warn **by name** on
  every screen that produces a document, saying whose bank block will print instead — so a
  Colorix or Noida contract can no longer go out with Orange O Tec's account on it unnoticed.
- Ten other open questions are listed at the foot of OCPI.md.

**Still to come:** phase 10 — Zoho CRM as a third source behind the customer picker.

### OCPI-2 · The OCPI revision — one form, one document set, tracked to Finance  `[x]`
*Raised 2026-08-24 · Plan of record:
`C:\Users\Admin\.claude\plans\now-there-is-a-memoized-mccarthy.md` · Client-facing flow:
https://claude.ai/code/artifact/bd77ceb1-a5f5-46fa-a37e-5f51977b6b0c*

⚠ **OCPI-1's phases 0–9d describe what was BUILT. This entry changes the chain itself** — read the
plan before touching the module, or you will build against the old shape.

OCPI today splits one commercial act across two stages: a **Quotation**, then — through a second
form, a second number series and a second approval gate — an **Order Confirmation**. The price is
typed twice (`deal_value_amount` and `machine_value_inr`) with nothing reconciling the two. The
client wants one act.

**What changes**

1. **One form.** The order confirmation's questions move into the quotation form as *optional* fields.
2. **Sections B and C become mandatory** — visible fields only; the branch rules still hide questions.
3. **Section C opens with High Seas / Others**, which drives currency and tax:
   High Seas ⇒ USD always and **no GST line at all**; Others ⇒ GST charged.
4. **Dollar deals print USD and INR** on a live overridable rate, frozen onto each revision. The
   dollar-fluctuation line prints in Section C, and its tick is asked only on dollar deals.
5. **Special remarks** — the master form's three remark boxes gathered into one group.
6. **Both papers generated together**, headed ORDER QUOTATION, **re-headed ORDER CONFIRMATION** when
   the Directors approve — which is also when `OTPL/OC/<fy>/nnnn` is minted, so a returned or
   abandoned quotation burns no number. Printing the signature copy is gated on that approval.
7. **Every revision keeps its own value, currency, FX rate and pair of PDFs.**
8. **Two new steps after the countersignature** — Finance handover, then Finance receipt.

**All pricing is phase 2**, by explicit instruction: no price master, no per-machine price, no
deviation limit, no price-approval gate. The salesperson types the value, as today.

**Stages** (live checklist in [OCPI.md](OCPI.md)): 0 track · A SQL foundations · B merged form ·
C commercial terms/currency/GST/FX · D both papers · E conversion + print gating · F the chain
(cutover) · G round-out · H teardown + go-live. Gate for each: `cd frontend && npm run build` green.
**All nine stages done: 0, A, B, C, D, E, F, G, H** (25-Aug-2026) — a quotation issues both papers at once, each
revision keeping its own price, rate and pair of PDFs; the Directors' approval mints
`OTPL/OC/<fy>/nnnn` and re-heads the pair as the contract, and a quotation sent back mints nothing.
The chain is cut over: approval hands straight to the customer signature, the countersignature no
longer closes the deal, and the signed contract is tracked to Finance in two halves — who handed it
over, and who accepted it. The round-out is done: Directors named on the approval gate with an empty-owners warning, every
email event given a branch that points somewhere that exists, and the register carrying the FX rate,
the rupee equivalent and both halves of the Finance handover. **Teardown is done too** — every
`ZZ TEST` deal, version, activity row, notification, master request and stored file removed, the OC
counter cleared and the quotation series put back to 23. A full chain was walked against the deployed
RPCs inside a rolled-back transaction to prove the first numbers: **QT-M0024** and
**OTPL/OC/2627/0001**.

**Before it goes live** (none of these is code): confirm the quotation series in Settings → Quotation
numbering; name the Directors on `quotation_approval` and owners for the two Finance steps, since
nobody is named and it all falls to admins today; and settle the four open items at the foot of
[OCPI.md](OCPI.md).

**Two audit findings that would have stopped the build**
- `fms_ocpi_can_add_doc` maps the `oc` storage slot to `order_confirmation`, so **a Director cannot
  upload the Order Confirmation PDF** — refused by the storage policy, silently, and *invisible to an
  admin account* because coordinators pass unconditionally. Remap to `quotation_approval`.
- The OC number and the printed paper cannot both be right unless minting and rendering happen in
  **one action at approval**.

**Relationship to OCPI-1:** OCPI-1 stays `[~]`. Its "Before it goes live" items are **not** superseded
and must not be lost — the true maximum `QT-M####`, the ten transcribed templates awaiting a
proof-read, and which selling entities actually raise OCPIs.

**Still open** (none blocks the build): P8D is headed *OFFER QUOTE*, neither of the two headings this
flow uses; who supplies the 18 missing detailed-sheet templates; whether an *Others* deal quoted in
USD really attracts GST; and the client's own remaining feedback.


### OCPI-3 · Machine categorisation, derived head + warranty defaults, and a dryer section of its own  `[x]`  — built, green and browser-verified 29-Aug-2026
*Raised 2026-08-27 · **Batch 1 of a larger set** — the client is still giving pointers, so this entry
is open and will grow. The audit of what it reaches:
`C:\Users\Admin\.claude\plans\now-there-are-a-precious-bear.md`*

**Build progress (29-Aug-2026): ALL STAGES DONE — 0 and A–J, built, green, and verified in the
browser.** Both remaining checks were run on 29-Aug: the High Seas rate now appears and is demanded,
and a dryer draft survives a save/reload while a switch to a no-dryer machine clears exactly what the
form hid and keeps the chilling system. The tickable master list — what each stage actually changed and how it was
verified — is in [OCPI.md](OCPI.md) under *"OCPI-3 · the build"*. Read that for state; this entry
stays the SPEC.

The machine master grows a billing name and a category; **type of head stops being a free choice** and
becomes a property of the machine; the dryer questions leave the bottom of the form and become a
**Dryer details section** of their own; and — for the first time since OCPI-2 declared *"all pricing is
phase 2"* — a deal can carry **a second price**, for a dryer sold outside it.

Section **E**, added on the second pointer, is a different kind of item: it asks for a rule that is
already built everywhere except the form — where the gap prints a **High Seas contract with no rupee
total on it**. Read it before the rest; it is the only part of this entry that can hurt a live deal.

🔴 **READ SECTION M FIRST.** Six later conversations amended A–J — warranties became fixed rather than
mapped, the shipping questions collapsed into one section, and the dryer flag moved from the category
to the machine. **M lists what supersedes what.** The build order and live checklist are in
[OCPI.md](OCPI.md) under *"OCPI-3 · the build"*.

**A · Machine master** ([Machines.tsx](frontend/src/apps/ocpi/pages/machines/Machines.tsx) · `fms_ocpi_machines`)

1. Add a **machine name / billing name** column beside the existing one. What is in the master today
   **is the machine code and stays exactly as it is** — nothing re-keyed, no back-fill; the new field
   is added next to it. **Both** names print on the papers and show in the register.
2. New **machine category** master; every machine maps to one category.
3. Map **type of head** against each machine.
4. Map **dryer required (yes / no)** on the **machine category** — every machine in it inherits.

**B · Dryer masters**

5. `fms_ocpi_dryer_types` is relabelled **Dryer category** (Indian / Chinese) everywhere it shows.
6. New **dryer name** master, each name mapped to a dryer category.

**C · Quotation form — Machine details, section A**
([QuotationForm.tsx:361-495](frontend/src/apps/ocpi/components/QuotationForm.tsx#L361-L495))

7. The first row becomes **Machine category · Machine · Type of head**.
8. The machine list filters to the chosen category.
9. **Type of head is display-only**, read from the machine's mapping — the user cannot change it.
10. Then No. of machines · No. of print heads required.
11. Then Type of ink · **Ink selling price** (rename of "Ink price") · Ink credit terms.
12. "Dryer required" leaves section A entirely.

**D · Quotation form — a new Dryer details section, below Machine details**

13. Shown only when the machine's **category** says a dryer is required; hidden otherwise.
14. **Dryer category**, then **Dryer name** filtered by that category.
15. Move in from the detail card
    ([QuotationForm.tsx:938-978](frontend/src/apps/ocpi/components/QuotationForm.tsx#L938-L978)): how many chambers ·
    **Heating medium** (rename of "Heating mode"). ⚠ **AMENDED by the third pointer — the dryer
    warranty does NOT come here.** It moves to *Warranty & service* instead; see **F** below. This
    point originally listed it, and the two would contradict each other.
16. Move the **Options included** block in as well
    ([QuotationForm.tsx:980-1008](frontend/src/apps/ocpi/components/QuotationForm.tsx#L980-L1008)).
17. New: **is the dryer part of the deal?** If it is not inclusive, ask for a **dryer price**.
18. The PDF money block reads in three lines — **machine total → dryer total → final total**.

**E · Commercial terms — the dollar position**  *(added 27-Aug-2026, second pointer)*

19. **High Seas is always a USD deal**, and its value is always exclusive of GST.
20. The **USD → INR rate belongs to any dollar deal**, High Seas or Others alike — not to one of them.
21. Wherever a deal is in USD, the papers show **both USD and INR**.

⚠ **MOSTLY ALREADY BUILT — the requirement is met everywhere except the form, where it fails
completely.** Checked in full on 27-Aug-2026:

- *Already correct:* High Seas ⇒ USD is **forced server-side** in `fms_ocpi_write_quotation`
  ([20261019120200:70-71](supabase/migrations/20261019120200_fms_ocpi_commercial_terms.sql#L70-L71)) — `case when v_transport = 'high_seas'
  then 'USD'` — with a comment saying it is forced rather than defaulted *"so a stale INR left on the
  row cannot survive the switch"*. High Seas carries no GST ([branching.ts:102](frontend/src/apps/ocpi/lib/branching.ts#L102), `gst_rate`
  null and not zero, both papers omitting the tax row). The value field already reads **"Total deal
  value (excluding GST)"**. The rate is **not** gated on deal type — [branching.ts:105](frontend/src/apps/ocpi/lib/branching.ts#L105) tests the
  currency alone. And both papers already print both currencies with the frozen rate beside them:
  summary [quotationPdf.ts:98-107](frontend/src/apps/ocpi/lib/quotationPdf.ts#L98-L107), detailed [ocPdf.ts:253-262](frontend/src/apps/ocpi/lib/ocPdf.ts#L253-L262). **Nothing to add
  for point 21.**
- 🔴 *The defect.* **The form never sets the draft's currency to USD when High Seas is picked.**
  `EMPTY_DRAFT.dealValueCurrency` is `"INR"`; the picker is `disabled={disabled || isHighSeas}`
  ([QuotationForm.tsx:631-638](frontend/src/apps/ocpi/components/QuotationForm.tsx#L631-L638)) but **nothing patches the value**, and there is no
  `useEffect` in the file at all. So a High Seas deal shows **Currency: INR**, greyed out, directly
  under a note reading *"A high seas sale is in US dollars … Both are set for you"* — and, because
  `show("fxRate")` tests `dealValueCurrency === "USD"`, **the USD → INR rate box never renders**.
  High Seas, the one deal type that is *always* a dollar deal, is the only one where the rate cannot
  be fetched or typed.

  **What that costs, end to end:** no rate is required anywhere — not in `missingForSubmit`
  ([fieldSpec.ts:600-630](frontend/src/apps/ocpi/lib/fieldSpec.ts#L600-L630)), not in the `fms_ocpi_complete_when_submitted` check constraint
  ([20261019120100:240-266](supabase/migrations/20261019120100_fms_ocpi_merged_form_writes.sql#L240-L266)) — so the deal submits happily. The server then
  forces the row to USD with `fx_rate` null, so `deal_value_inr` is null
  ([:126-127](supabase/migrations/20261019120200_fms_ocpi_commercial_terms.sql#L126-L127)), so `write_oc`'s `v_value` is null, so
  `machine_value_inr`, `gst_amount_inr` and `total_inr` are **all null**. Both papers take the USD
  branch and print **"Value in INR" blank and "Total Value INR" blank** — including the orange total
  strip on the detailed sheet. **A High Seas contract goes to a customer with no rupee total on it.**
  It self-corrects only if somebody saves, reloads, notices the rate box has appeared, and
  regenerates.

  **The fix is small and belongs in two places, not one:** coerce `dealValueCurrency` to `"USD"` when
  the deal type becomes High Seas (mirroring what the SQL already does, so form and server agree —
  the same two-engines trap as the dryer branch above), and make the rate **required to submit** on
  any USD deal, in `missingForSubmit` and in the check constraint. This is a **defect, not new
  work** — move it to [Fixes](#fixes) once it is repaired and stamped.


**F · Warranty & service — defaults per machine, and no post-warranty price**  *(added 27-Aug-2026, third pointer)*

The block at [QuotationForm.tsx:815-865](frontend/src/apps/ocpi/components/QuotationForm.tsx#L815-L865) today asks: printer warranty period ·
print-head warranty period · **head price after the warranty** · consumables supplier · the insurance
clause. It becomes the one place every warranty is asked.

22. **Add a spare-parts warranty** — a wholly new field; nothing like it exists on the deal today.
23. **Move the dryer warranty here**, out of the dryer questions. *(This is why point 15 above is
    amended: the dryer section takes chambers and heating medium only.)*
24. **Map a default warranty against each machine in the master** — printer, print head, spare parts
    and dryer, each *where applicable*. **The client will supply the default values per machine.**
25. Selecting a machine **pre-fills all four** from its mapping.
26. The user **may overwrite** any of them and pick another option.
27. **An overridden warranty must be highlighted at approval**, so the Directors can see the default
    was departed from.
28. **Remove "Head price after the warranty" entirely.** No price after the warranty anywhere.

⚠ **Point 28 is not a field deletion — it leaves a ruled blank inside a live contract clause.**
`{{post_warranty_head_price}}` is embedded in the **PRINT HEAD POLICY PROGRAM** section body of **four
machines in the live database** — *Homer K24, Homer K32, P8D and P8S* (checked 27-Aug-2026: 4 of 82
machine sections; `{{dryer_warranty}}` is used by **none**, so point 23 is token-safe). The clause
reads:

> *"…After that period a New Print Head will be priced at INR {{post_warranty_head_price}} plus GST, on
> the new machine, first time installed head."*

An unresolved token renders as a **ruled blank**, deliberately ([tokens.ts](frontend/src/apps/ocpi/lib/tokens.ts) — so a wrong token name
degrades to "somebody must fill this in" rather than leaking braces). Delete the field alone and those
four contracts print *"priced at INR ______ plus GST"*. **The four clause bodies must be reworded as
live data** through the Machine template screen — the seed migration is history and editing it changes
nothing — and the token retired from `tokensFor` and `TOKEN_HELP`. The `post_warranty_head_price`
column itself **stays** (additive-only); it simply stops being asked and written. This is CLAUDE.md's
container rule again: removing the control is the easy half.

⚠ **Point 27 has nowhere obvious to go, and the reason is deliberate.** `ApprovalPanel`'s own header
states the rule: *"THE DOCUMENTS ARE RENDERED, NOT SUMMARISED — approving here issues a contract; doing
it from a list of field values would mean confirming something nobody had read."* There is no field
table on that screen to highlight in. So the override notice has to be a **callout above the rendered
papers** — an annotation beside the documents, not a substitute for reading them — naming each
overridden warranty, the value chosen and the machine's default. Printing it on the paper itself would
put an internal control note on a customer's contract; do not.

✅ **The pattern to copy already exists in this module: `fxRateOverridden`.** A boolean on the deal,
set by the form the moment a person replaces a fetched value, frozen onto the revision, and carrying a
`FIELD_LABEL` ("Rate entered by hand") so it also surfaces in the revision diff. Four warranty
overrides should take exactly that shape — one flag each, set on change, labelled, frozen. Do not
invent a second mechanism.

**Other things this touches**

- The warranty option lists are **code constants**, not masters — `WARRANTY_MONTHS` and
  `PRINTER_WARRANTY` ([fieldSpec.ts:278-289](frontend/src/apps/ocpi/lib/fieldSpec.ts#L278-L289)). A default held on the machine master must
  draw from the same vocabulary, or the two will drift — which is the exact failure `fieldSpec.ts`'s
  own header describes for the head/ink/dryer lists that were promoted to masters. Decide before
  building whether these become masters too, or whether the master field is a `select` bound to the
  constants.
- **Spare-parts warranty is a new column**, so it needs: a nullable column on `fms_ocpi_deals`, an
  entry in `payloadFromDraft` **and** `FIELD_LABEL` (or the revision diff shows a raw key), a place in
  the **part-B key-sniff array** in `fms_ocpi_save_draft`, and a line in `fms_ocpi_write_oc`. Same four
  places every new field in this entry needs.
- A `{{spare_warranty}}` token is worth adding alongside `{{machine_warranty_months}}` and
  `{{head_warranty_months}}` if any template should quote it.
- Moving the dryer warranty out of the dryer block means the **branch rule changes**: `dryerWarranty`
  is currently gated on `hasDryer` in [branching.ts:89](frontend/src/apps/ocpi/lib/branching.ts#L89) *and* nulled by `fms_ocpi_write_oc`. In
  Warranty & service it should still only be asked when the machine's category carries a dryer — so it
  keeps a branch, but on the new category mapping, **in both engines**.


**G · Delete the "Delivery & tax" block from Document details**  *(added 27-Aug-2026, fourth pointer)*

29. **Delivery days** moves out of Document details into **Commercial terms**.
30. **Delivery term** (`tradeTerm`) is **removed** — the client's reading is that Commercial terms
    already covers it.
31. The **Delivery & tax** block itself then goes.

🔴 **THE BLOCK HOLDS THREE CONTROLS AND THE POINTER NAMED TWO. The third is GST %.**
[QuotationForm.tsx:867-900](frontend/src/apps/ocpi/components/QuotationForm.tsx#L867-L900) is Delivery days · Delivery term · **GST %** — the last
hidden on a High Seas sale, which is why it is easy to miss when reading the screen. **GST % must move
to Commercial terms with the delivery days, not go with the block.** It is the rate that produces
`gst_amount_inr` and `total_inr` on every *Others* deal. Delete it and nothing breaks, nothing fails to
compile, and every deal is quoted at 18% forever — `EMPTY_DRAFT.gstRate` is `"18"` and `draftFromDeal`
falls back to `"18"`, so the value keeps being sent, silently, with no way to change it. That is the
[FIX-4](#fixes) signature exactly: the trigger removed, everything behind it intact, the build green.
Commercial terms is where it belongs anyway — it is tax on a price, and the price is already there.

⚠ **"Already covered in commercial terms" is true for High Seas and false for Others.** `TRADE_TERMS`
is `Ex-Work Surat · CIF · FOB · EX Factory`. Commercial terms carries **High seas delivery via**
(`CIF · EX Factory · FOB`) — but [branching.ts:91](frontend/src/apps/ocpi/lib/branching.ts#L91) shows it **only on a High Seas deal**. An
*Others* deal gets only *Local delivery cost borne by*, which is a **cost bearer, not a delivery term**.
So after this change an Others deal would carry no delivery term at all. Either widen the high-seas
field to every deal type, or accept that Others deals stop stating one. **Worth putting back to the
client before building.**

⚠ **`{{trade_term}}` is in a live clause on ALL TEN templates that exist.** Checked 27-Aug-2026:
10 of 10 machines with a template carry it in **SALE CONDITIONS OF THE SUPPLY**, which reads:

> Delivery Terms: `{{trade_term}}`
> Delivery Days: `{{delivery_days}}`
> Payment terms: `{{payment_terms}}`
> Insurance: Product Insurance borne by Customer.

Unresolved tokens print as ruled blanks, so removing the field puts **"Delivery Terms: ______" on every
detailed sheet the module can produce**. The line must be deleted from all ten section bodies as **live
data**, through the Machine template screen. (`{{delivery_days}}` is unaffected — that field survives,
it only moves.) This is the second time in this entry that removing a field would blank a contract
clause; see also point 28.

**The orphan sweep for this one** — per CLAUDE.md, every control accounted for:

| In the block | Where it goes |
|---|---|
| Delivery days | → Commercial terms (point 29) |
| Delivery term | → removed (point 30) |
| **GST %** | → **Commercial terms** — *not named by the client, must not be dropped* |

And what `tradeTerm` leaves behind once the field is gone:
- `missingForDetailSheet` warns when it is blank ([fieldSpec.ts:653](frontend/src/apps/ocpi/lib/fieldSpec.ts#L653)) — **remove that check too**, or the
  salesperson is warned that a field they cannot see is empty.
- The Deal Register's **"Delivery term"** column ([exportRegister.ts:71](frontend/src/apps/ocpi/lib/exportRegister.ts#L71)) — keep it for deals
  raised before the change, or drop it; a decision, not an oversight.
- The `trade_term` token in `tokensFor` and its `TOKEN_HELP` entry ([tokens.ts:68,137](frontend/src/apps/ocpi/lib/tokens.ts#L68)) — retire
  both once the ten clause bodies no longer reference it, and **in that order**.
- The `trade_term` column **stays** (additive-only), and so does its key in `payloadFromDraft` and the
  part-B sniff array until the writers stop setting it.


**H · WHERE the mapped data lives — master, or template?**  *(design decision, 27-Aug-2026)*

The client asked this directly, wanting the machine master not to be loaded up unnecessarily. The
answer is **all of it in the masters, none of it in the template — but split across two masters, not
piled onto one.**

**The test that decides it.** Both screens edit *the same table* — `fms_ocpi_machines` carries the
identity columns *and* the template columns, with `fms_ocpi_machine_sections` as its child. So this is
not a schema question, it is a question of what the value **does**:

> **Does it drive the form, or does it appear as prose in the document?**
> Drives the form → **master** (read live, every time the form renders).
> Appears in document prose → **template** (frozen onto each version at generate time).

Every item across batches 1–3 — category, type of head, dryer-required, the four warranty defaults,
the billing name — **drives the form**. None of them is document prose. So none belongs in the
template.

**Three reasons the template is not merely a worse home but a wrong one:**

1. **The template is frozen per version, by design.** `MachineTemplate.tsx`'s own header: *"editing here
   changes what future documents say, not past ones — every finalised quotation freezes the resolved
   template into its own version row."* A default read out of frozen text would be the default as of
   the last generation, not the one in force now.
2. **It holds prose, not values.** A warranty written into a clause body is a sentence. It cannot
   prefill a `Combobox`, and — fatally for point 27 — there is **nothing to compare against** to detect
   that the salesperson overrode it.
3. **18 of the 28 machines have no template at all** (checked 27-Aug-2026: 28 machines, 10 with a
   template, 18 without, all 28 active). Those 18 are fully quotable today — a machine with no template
   still issues the summary sheet. Put the mapping in the template and **two thirds of the catalogue
   cannot be mapped**.

**The proposed split**

| Where | What it holds | Why |
|---|---|---|
| **Machine category master** *(new, a handful of rows)* | category name · sort order · **dryer required** | Already settled: dryer-required is a category property. Anything constant across a category belongs here — one edit covers every machine in it. |
| **Machine master** *(28 rows)* | **billing name** · category *(FK)* · **type of head** *(FK)* · warranty defaults **only if they vary machine by machine** | Identity and the per-model facts the form reads. |
| **Machine template** | unchanged — spec rows, composition, clause bodies | Document text only. |

**This is also the answer to "don't load up the machine master".** The way to keep it light is not to
move data to the template — it is to push whatever is *constant per category* up to the category
master. If the four warranties are the same for every machine in a category, that is **~6 categories ×
4 values ≈ 24 entries instead of 28 machines × 4 ≈ 112**, and one correction fixes a whole family.
Where a single machine genuinely differs, it overrides — the same category-default-plus-override shape
the warranties already need for the salesperson.

**What the Excel sheet decides** *(client is sending it)*: whether each warranty is constant per
category or genuinely per machine — which is the only open input to the table above; how many
categories there actually are; whether *type of head* is truly one per machine or one per category; and
which machines have no dryer/spare warranty at all, since the client said *"if applicable"*. Nothing
else in this entry is blocked on it, so the sheet can arrive whenever it is ready.

⚠ Whatever the sheet says, the **28 existing machines still need back-filling** before a
category-filtered picker returns anything — already on the discuss list.


**I · The head and the centering device get sections of their own**  *(added 27-Aug-2026, fifth pointer)*

The form's order becomes **Machine details → Dryer details → Head → Centering device**, and the three
equipment sections share one shape: *how it ships*, and *whether it is invoiced separately*.

32. **Move "The head" out of Document details** ([QuotationForm.tsx:902-936](frontend/src/apps/ocpi/components/QuotationForm.tsx#L902-L936)) into its own
    section, placed **after** the Dryer section.
33. **Reword it** so the section covers both the shipment questions and the invoice question, rather
    than reading as shipping alone.
34. **The Dryer section gains the same pair** — *how to ship the dryer* and *separate invoice for the
    dryer* — and its wording likewise covers both. *(Confirmed 27-Aug-2026.)*
35. **A new, small Centering device section** after the head: *how to ship* and *separate invoice for
    the centering device*. Two questions, as specified.
36. The centering section applies to the **K64 only**.
37. **The "External centering system" tick stays where it is** — it travels with the other three
    *Options included* ticks into the Dryer section (point 16). *(Confirmed 27-Aug-2026: "that is a
    separate option, and this is a separate thing".)* The new section does **not** branch on it.

🔴 **THESE ANSWERS CURRENTLY PRINT NOWHERE — ON EITHER PAPER.** Swept 27-Aug-2026: `head_ship_mode`,
`head_ship_via` and `head_separate_invoice` appear in the form, the field spec, the branch rules, the
fetch mapping and both SQL writers — and in **neither** [quotationPdf.ts](frontend/src/apps/ocpi/lib/quotationPdf.ts) nor
[ocPdf.ts](frontend/src/apps/ocpi/lib/ocPdf.ts), in no template token, and in no register column. They are asked, stored,
and frozen onto every revision, and then no document ever says what was agreed. Giving them a section
of their own makes them **more** prominent on screen while they remain invisible on the contract.
**Decide where they print before building this** — most likely a shipment/invoicing block on the
detailed sheet, alongside the money rows. The same decision covers the new dryer and centering
answers, which would otherwise join them.

⚠ **K64 has no template**, so it issues the summary sheet alone (10 of 28 machines have a template;
K64 is one of the 18 without). Even once the above is fixed, a centering answer with nowhere to print
on a *detailed* sheet still prints nowhere for the one machine the section exists for — unless it goes
on the **summary** sheet, or K64 gets a template. This is the sharper half of the finding.

🔴 **DO NOT HARD-CODE `machine.name === "K64"`.** Section **H** settled the principle and it applies
directly: this is a **machine-master flag**, not a name check. A literal name breaks the moment the row
is renamed, a variant is added, or a second machine gets a centering device. Add one nullable boolean
to the machine master — *centering device applicable* — false by default, true on K64, and the rule
becomes data the client can maintain. One column, no code change ever again.

⚠ **The master row is named `K64`, not "Homer K64".** The client said *"Hammer K64"*; the live row is
bare **`K64`** — `has_template = false`, `sort_order = 900`, active — while its siblings are **"Homer
K24"** and **"Homer K32"**. Confirm this is the right row, and consider renaming it *Homer K64* for
consistency. (With the flag above, a rename is harmless; with a name check it would silently disable
the feature — which is the argument for the flag in one sentence.)

**What this costs in the four usual places.** Four new nullable columns —
`dryer_ship_mode`, `dryer_separate_invoice`, `centering_ship_mode`, `centering_separate_invoice` —
each needing its column, an entry in `payloadFromDraft` **and** `FIELD_LABEL`, a place in the part-B
key-sniff array, a line in `fms_ocpi_write_oc`, and a branch rule **in both engines**. Plus the one
machine-master flag.

**Reuse, do not re-declare.** `HEAD_SHIP_MODES` (*With the machine* / *Separate shipment*) and
`HEAD_SHIP_VIA` are code constants in [fieldSpec.ts](frontend/src/apps/ocpi/lib/fieldSpec.ts). The dryer and the centering device should
read the **same** lists rather than gaining parallel copies — three lists of one vocabulary is the
exact drift `fieldSpec.ts`'s own header warns about.

**Branching that must move with the block.** The head questions are gated on `incl_head = true` in
[branching.ts:79-84](frontend/src/apps/ocpi/lib/branching.ts#L79-L84) *and* nulled again by `fms_ocpi_write_oc`. Moving the block changes where
it renders, not what governs it — **both** engines keep the rule. The new sections need the same
treatment: the dryer pair gated on the machine category carrying a dryer, the centering pair on the
new machine flag.

⚠ **Centering is now asked about in two places on one form** — the *Options included* tick in the
Dryer section, and this section. That is the client's explicit decision, recorded here so it reads as
intended rather than as a duplication somebody later "tidies up". Note the tick alone drives the
printed **"External Centring Device"** composition line ([ocPdf.ts:57-64](frontend/src/apps/ocpi/lib/ocPdf.ts#L57-L64)); the new section
drives nothing printed at all until the finding above is settled.


**J · Special remarks — one box, entered point-wise**  *(added 27-Aug-2026, sixth pointer)*

38. **Remove "Remarks — balance heads to be sold later"** (`headBalanceRemarks`).
39. **Remove "Any other commitments on charges made by us"** (`otherCommitments`).
40. **Keep "Special remarks"** and tell the user, prominently, to enter every remark **point-wise** —
    a stronger hint on the field and a placeholder that shows the shape.

**The orphan sweep** — per CLAUDE.md, the card holds **four** controls, not three:

| In the Special remarks card | Outcome |
|---|---|
| Special remarks (`remarks`) | stays, with point-wise guidance |
| Balance heads to be sold later | removed (point 38) |
| Any other commitments | removed (point 39) |
| **Dollar-exchange clause + "Agreed with the customer"** (`dollarClauseAgreed`) | **stays** — shown on USD deals only ([QuotationForm.tsx:779-786](frontend/src/apps/ocpi/components/QuotationForm.tsx#L779-L786)) |

The client's wording was precise and the fourth control is safe; it is listed because proving it is the
rule, not because it was in doubt.

🔴 **THE FIELD'S OWN HINT IS ALREADY A FALSE PROMISE, AND THIS MAKES IT WORSE.** Special remarks is
labelled `hint="prints on both sheets"` — and the **detailed sheet prints no remarks at all**. There is
no code path for it in [ocPdf.ts](frontend/src/apps/ocpi/lib/ocPdf.ts) and **no `{{remarks}}` token exists**, so no machine template can
reference it either (swept 27-Aug-2026). It prints on the summary sheet only. This pointer makes
Special remarks the *sole* surviving free-text box and asks to give it more prominence, so the
salesperson is being pushed to put more into a field that reaches half the places the form claims.
**Either print remarks on the detailed sheet, or correct the hint** — but not neither.

✅ **Point-wise text will survive onto the summary sheet — verified.** `wrapText` calls
`pdf.splitTextToSize`, which honours `\n`, and `safeText` only substitutes specific glyphs (arrows, Δ,
fullwidth brackets) — it does **not** strip newlines ([pdfBrand.ts:125](frontend/src/shared/lib/pdfBrand.ts#L125)). So one point per line
renders as one line per point. No renderer change is needed for the format itself.

⚠ **But a long point-wise block can run off the page.** A row's height is `max(17, 7 + lines × 10)`
and the page-break check moves the **whole row** to a fresh page — it never *splits* a row
([quotationPdf.ts:296-317](frontend/src/apps/ocpi/lib/quotationPdf.ts#L296-L317)). A remarks block taller than the body area therefore overflows the
bottom silently. Today that is unreachable in practice because the box is three rows and people write
a sentence; **encouraging point-wise entry is exactly what makes it reachable.** Either cap the input,
or teach the renderer to split a tall row across pages. Worth doing at the same time.

⚠ **This partly reverses OCPI-2's point 5**, which deliberately *gathered* the master form's three
scattered remark boxes — Q23 (balance heads), Q43 (other commitments), Q46 (remarks) — into one group
so a salesperson no longer had to remember which heading a note belonged under. Two of the three now
go away entirely. That is a legitimate change of mind, but **the comment at
[QuotationForm.tsx:737-742](frontend/src/apps/ocpi/components/QuotationForm.tsx#L737-L742) explains the gathering and would be left describing a form that
no longer exists** — rewrite it, do not leave it.

**What else moves**

- **Section D of the summary sheet drops to one row.** [quotationPdf.ts:137-145](frontend/src/apps/ocpi/lib/quotationPdf.ts#L137-L145) builds it from
  three; the balance-heads row and its `inclHead === true` guard go with the field.
- **A branch rule is orphaned.** `headBalanceRemarks: (d) => d.inclHead === true`
  ([branching.ts:82](frontend/src/apps/ocpi/lib/branching.ts#L82)) becomes a visibility rule for a field nobody can see — remove it there
  **and** the matching null in `fms_ocpi_write_oc`, the usual pair.
- **Both columns stay** (additive-only), as do their keys in `payloadFromDraft` and the part-B sniff
  array until the writers stop setting them. Deals already raised keep their text, and their **stored**
  papers are untouched — but a re-render of an old deal would silently drop those two rows, since
  `sectionRows` builds from the live row. Acceptable; worth knowing before somebody regenerates one.


**K · The machine sheet — what it gives us**  *(27-Aug-2026)*

Source: `Misc/Bushra Reports/OCPI/OCPI Machine Templates.xlsx`, sheet **Machines**, 28 rows × 20
columns. ⚠ An older copy sits at the repo root — the OCPI-folder one is live.

✅ **All 28 machine names match the live master exactly**, so it imports by name.

| Sheet column | Fills | Coverage |
|---|---|---|
| PRODUCT NAME - AS PER INVOICE | billing name (point 1) | 21 of 28 |
| TYPE OF MACHINE | category (point 2) | 28 — Direct 10 · Sublimation 12 · Other 4 · "JAY" 2 |
| DRYER | dryer required (point 4) | 28 — yes on 11, no on 17 |
| TYPE OF HEAD | print heads (point 3) | 22 of 28 |
| MACHINE / HEAD WARRANTY | — | 5 of 28 — **now irrelevant, see M** |

🟢 **A good idea nobody asked for.** The four extras — air blade, external centering, ink dust
exhauster, chilling system — are given per machine as **Yes / No / Optional**. That third value says
*whether to ask at all*: No = the machine cannot carry it, never show the question; Optional = ask.
Today all four are asked on every deal regardless. **Adopted.**

Also present, not requested: **SUPPLIER NAME** (11 distinct) and **HEAD DPI**, which overlaps TYPE OF
HEAD. **CHAMBER · HEATING MEDIA · PLATTE** appear as machine columns but are blank for every machine
that has a dryer, so they give no defaults and stay deal-level questions.

🔴 **The sheet overturned the category-level dryer flag.** *Other* is split — Position Printer needs a
dryer, the three Pengdas do not. **Settled: the flag goes on each machine.** Point 4 is amended.

🔴 **The centering device is not K64-only.** It is *Optional* on Homer K24, K32, K64 and JP7, and *Yes*
on JPK — five machines. Point 36 is amended: drive it from the machine's capability, never a name check.

**Data to tidy in the sheet:** "JAY" is not a machine type (it is the category on Label Printer and
Book Printer); 6 machines have no head; 7 have no billing name; the three Fab Pro rows are empty from
the extras onward; Yes/No values vary in case and padding, so the import must trim and case-fold.

⚠ **The sheet claims 21 templates; the system has 10**, and the eleven missing decks are not in the
folder either. This names them for OCPI-1's standing question: **K64, JP7, JPK, Fab Pro 1I, Fab Pro 2I,
Position Printer, KoloRado Alpha 3 (12 heads), KoloRado Alpha 3.2 (8 heads), Pengda PD-1700XD-800,
Pengda PD-1800XD-800, Rocket.**

✅ **RESOLVED 31-Aug-2026 for nine of the eleven.** Bushra supplied the decks in
`Misc/Bushra Reports/OCPI/31-08-2026/` and they were imported under **OCPI-4** — the system now has
**19 templates, not 10**. Only **Pengda PD-1700XD-800** and **Pengda PD-1800XD-800** remain missing
from this list.

**L · Print heads are many-per-machine, and the name mapping**  *(settled 27-Aug-2026)*

41. **A machine may carry several heads**, and the quotation shows **all** of them. Point 3 assumed one;
    it is amended. Machine→heads becomes a link table; the deal keeps storing the names as joined text,
    so old quotations still read correctly and the revision diff is unaffected.

The sheet and `fms_ocpi_head_types` share **no** common value. The mapping below is mine, proposed at
the client's request; the supplier column supports it — every "EX600 RC Katan" machine is a Han Glory
machine, and the system's Katana and RC rows are both Hanglory.

| Sheet value | Machines | Becomes | In the system? |
|---|---|---|---|
| I3200 | 9 Kolorado + Foil | Epson I3200 | ✅ *EPSON PRINTHEAD I 3200* |
| 300 DPI KYOCERA | P8D | Kyocera 300 | ✅ *300DPI - KJ4B* (KJ4B is Kyocera) |
| EX600 RC KATAN & KYOCERA | P8S | Katana 600 **+** Kyocera 600 | ✅ both |
| EX600 RC KATAN & HOMER | Homer K24, K32, K64 | Katana 600 **+** Homer | ✅ Katana · ❌ **Homer new** |
| MS & KYOCERA BOTH | JP7, JPK | MS **+** Kyocera 600 | ❌ **MS new** · ✅ KJ4B |
| MS HEAD | Mini Lario | MS | ❌ **MS new** |
| EX600 RC & KYOCERA | Rocket | RC 600 **+** Kyocera | ✅ both |
| RICHO HEAD | Fab Pro 1I/2I/3I | Ricoh | ✅ *RICOH GEN 6 HEAD* ("Richo" = Ricoh) |
| "NO" / blank | 3 Pengdas, Position, Label, Book | none | — |

**All six existing rows are used; only two new ones are needed — "MS" and "Homer".**

⚠ Three doubts, all data corrections rather than build changes: is **"Homer"** a head or the machine
brand written into the head column; is the Fab Pro's Ricoh really a **Gen 6**; and **Rocket** says
"EX600" in the head column but **300** in the DPI column — which is right?

**M · What the later pointers changed — read this before building A–J**

Six conversations amended earlier sections. The current shape is:

- **Warranties are FIXED, not mapped** — machine **12 months**, head **18 months**, **no** dryer or
  spare-parts warranty. No dropdown, no per-machine default, **no override highlight at approval**.
  An exception is written into Special remarks. Section **F** points 22–27 are withdrawn; only point
  28 (remove the post-warranty price) survives. The periods become **settings**, like quotation
  validity. 🔴 The machine-warranty placeholder is in **all ten** templates and the head-warranty one
  in **four** — re-point them at the settings *before* removing the fields, or every detailed sheet
  prints a blank warranty.
- **Shipment and invoice become ONE section**, not questions scattered per item. Sections **D** and
  **I**'s separate Head and Centering sections collapse into it. A row per item that is in the deal —
  **head · dryer · spare parts · centering device** — each asking how it ships, the route when
  separate, whether it is separately invoiced, and **if yes, quantity and total amount excluding tax**.
  Spare parts gain shipment and invoicing for the first time.
- **The shipping and billing block prints on the DETAILED paper** *(settled)* — which answers the open
  question about answers that were collected and never printed.
- **The dryer flag is per machine**, not per category (section K).
- **A machine may have several heads** (section L).
- **All data in the system is dummy**, confirmed by the client, so no change here has to protect live
  customer work.

**Settled with the client 27-Aug-2026**, recorded as decisions rather than questions: dryer-required is
mapped on the **category**, not the machine; **both** names print, and the existing master value *is*
the code and is left untouched; the money block is machine total · dryer total · final total.

**What this reaches beyond the form.** Five findings from the audit, each of which loses data silently
if it is missed:

- **There are two branch engines and they must change together.** `hasDryer` lives in
  [branching.ts:56](frontend/src/apps/ocpi/lib/branching.ts#L56) *and again in SQL*, in `fms_ocpi_write_oc`
  ([20261019120200:197-202](supabase/migrations/20261019120200_fms_ocpi_commercial_terms.sql#L197-L202)), both keyed on the
  string `dryer_type = 'Not Applicable'`. The server **nulls `dryer_chambers`, `heating_mode` and
  `dryer_warranty` on every write** it believes is dryer-less. Move the condition to the category
  mapping in TypeScript alone and the server erases the answers on save. `branching.ts`'s own header
  says it: *"delete it here AND in the matching SQL writer — they must not disagree."*
- **`fms_ocpi_save_draft` sniffs for part-B keys by name** —
  [20261019120100:112-120](supabase/migrations/20261019120100_fms_ocpi_merged_form_writes.sql#L112-L120) lists 26 literal keys and calls
  `write_oc` only when one of them is present. Every new dryer field must join that array, or a payload
  carrying only them never reaches the writer.
- **The money is derived server-side and has no room for a second price.** `write_oc` computes
  `machine_value_inr`, `gst_amount_inr` and `total_inr = value + gst`; the browser never holds them. A
  dryer price needs its own column and a new derived grand total, in that function.
- **The frozen payload is enumerated by hand, in two places** — `payloadFromDraft` and `FIELD_LABEL`
  ([fieldSpec.ts](frontend/src/apps/ocpi/lib/fieldSpec.ts)). [revisionDiff.ts](frontend/src/apps/ocpi/lib/revisionDiff.ts) takes both its
  labels **and its display order** from `FIELD_LABEL` by camel→snake. A field missing from either shows
  in the revision history as a raw `dryer_price`, or not at all.
- **`machine_name` is frozen onto each version at generate time**
  ([useQuotationDraft.ts:149](frontend/src/apps/ocpi/pages/deals/useQuotationDraft.ts#L149)). If the billing name prints it must be
  frozen alongside — and every version generated before this change carries only the code, so the
  renderer needs a fallback rather than a blank.

**Smaller things the build should not have to rediscover.** The options-included ticks are **machine**
options in the printed document — `optionalExtras()` ([ocPdf.ts:57-64](frontend/src/apps/ocpi/lib/ocPdf.ts#L57-L64)) appends them to the
machine's *composition* list, so moving the block changes where it is asked, not where it prints.
`OcpiMasterType` is a four-value union mirrored in **six** places (the type, two SQL `check`
constraints, the `elsif` chain in `fms_ocpi_resolve_master_request`, Settings → Master owners, and
`RequireMasterOwner`), so making the two new masters *requestable* touches all six and making them
admin-only touches none. `fms_ocpi_machines.name` is `unique` and referenced `on delete restrict` — the
new name column must **not** be unique, since two machines may share a billing name. `MasterCrud` has
no boolean field type, so "dryer required" is a Yes/No `select`, and the category-filtered dryer picker
is a `custom` field — whose `render` already receives sibling values and a `setField` to clear a choice
its narrowing has invalidated. Master import/export columns derive from `fields` automatically, so the
client's own `OCPI Machine Templates.xlsx` will be a column short. And per CLAUDE.md's container rule:
moving the head-type Combobox out of the form was checked — its master-request path survives via
[MasterRequests.tsx:173](frontend/src/apps/ocpi/pages/MasterRequests.tsx#L173) — but the same check is owed to `dryer_type` when its
Combobox moves.

**Supabase stays additive-only.** New nullable columns and new tables; never a rename of `dryer_type`,
`heating_mode` or `ink_price`. The labels move, the columns do not.

**To discuss with the client**

- [ ] **Does the dryer price attract GST**, and is the "final total" before or after tax? Three lines
      were specified; where GST sits among them was not.
- [ ] **Where should the options-included ticks print?** They are asked in the dryer section now but
      print under the machine's composition. Moving the printing is a second change.
- [ ] **Are machine-category and dryer-name requestable masters**, or admin-only? Requestable costs six
      touch points; admin-only costs none.
- [ ] **Who back-fills the 28 machines** with a category and a head mapping? Until somebody does, a
      category-filtered machine picker shows nothing.
- [ ] **What happens to deals already raised** whose `head_type` was typed free-hand and no longer
      matches the machine's mapping — read-only history, or re-derived on the next revision?
- [ ] **The default warranty values per machine** — printer, print head, spare parts, dryer. The
      client said they would share these; nothing can be mapped until they arrive.
- [ ] **How the four warranty clauses should read once the post-warranty price is gone.** Removing the
      field leaves a ruled blank mid-sentence on Homer K24, Homer K32, P8D and P8S — somebody has to
      supply the replacement wording, and it is contract text, not a code decision.
- [ ] **Do the warranty option lists become masters**, or stay as code constants the machine master
      selects from? Two copies of one vocabulary will drift.
- [ ] **Is the GST % meant to survive?** It sits inside the Delivery & tax block being deleted and was
      not named. It must move to Commercial terms, or every *Others* deal is pinned at 18% with no way
      to change it.
- [ ] **Does an *Others* deal still need a delivery term?** Removing `trade_term` leaves High Seas
      covered (via *High seas delivery via*) and Others with nothing but a cost bearer.
- [ ] **The replacement wording for "Delivery Terms:" on all ten templates** — the line has to be
      removed from *SALE CONDITIONS OF THE SUPPLY*, and that is contract text.
- [ ] 🔴 **Where should the shipment and separate-invoice answers PRINT?** Head, dryer and centering
      are all captured and stored today and appear on **neither** paper. A section of their own makes
      them prominent on screen and still invisible on the contract.
- [ ] **K64 has no template**, so it issues the summary sheet only — the centering answers have no
      detailed sheet to print on even once the above is decided. Summary sheet, or give K64 a template?
- [ ] **Is the master row `K64` the right machine**, and should it be renamed *Homer K64* to match
      Homer K24 / K32?
- [ ] **Should Special remarks print on the detailed sheet?** The field's hint already claims it prints
      on both; it does not, and there is no token for it. Now that it is the only remark box, decide:
      add it to the detailed sheet, or correct the hint.

### OCPI-4 · The 31-08-2026 template batch — nine of the eleven missing decks  `[x]`  — imported, applied and render-verified 31-Aug-2026
*Raised 2026-08-31 · Source: `Misc/Bushra Reports/OCPI/31-08-2026/` (12 files → 9 machines)*

Bushra has supplied **nine of the eleven decks** OCPI-3 §K named as missing. Every one maps onto a
master row that already exists with `has_template = false`, so this is an **update, not a new machine**.
Only **Pengda PD-1700XD-800** and **Pengda PD-1800XD-800** remain outstanding after this.

Takes the module from **10 of 28** machines printing a detailed contract to **19 of 28**.

| Deck | Machine row |
|---|---|
| `K64.pptx` (+ `.docx`) | `K64` |
| `POSITIONAL  PRINTER.pptx` | `Position Printer` |
| `ALPHA  3  12 PH.pptx` | `KoloRado Alpha 3 — 12 heads` |
| `ALPHA  2  3.2 - 8.pptx` | `KoloRado Alpha 3.2 — 8 heads` |
| `FABPRO 1I.pptx` (+ `.docx`) | `Fab Pro 1I` |
| `Fab Pro 2I.pptx` | `Fab Pro 2I` |
| `JP7.pptx` | `JP7` |
| `JP K EVO.pptx` | `JPK` |
| `ROCKET  MACHINE  OC.docx` (+ `ROCKET MACHINE.docx`) | `Rocket` |

**Baseline before any write (31-Aug-2026):** 28 machines · 10 templates · 82 sections · 19 deals.
Two of those deals are **real** (AARNAV FASHIONS, `QT-M0037` / `QT-M0038`) and sit on Homer K32 and
Kolorado Alpha 15 — both already templated, so **no live deal changes behaviour**. The six deals on
this batch's machines are all `ZZ TEST`.

#### Phase-wise checklist

**Phase 0 · Baseline and safety net**
- [x] 0.1 Record counts and a per-template md5 of the existing ten, to prove afterwards they were not touched
- [x] 0.2 Confirm which existing deals sit on the nine machines, and that none is real
- [x] 0.3 Check whether PowerPoint / Word are already running before touching COM

**Phase 1 · Render the decks (never transcribe from raw OOXML — see the finding below)**
- [x] 1.1 Export every slide of the 8 `.pptx` to PNG via PowerPoint COM
- [x] 1.2 Export `ROCKET  MACHINE  OC.docx` (and the three Performas, for cross-check) to PDF via Word COM
- [x] 1.3 Read every render; reconcile against the structured XML walk used for the audit

**Phase 2 · Transcribe, one machine at a time**
- [x] 2.1 K64 · [x] 2.2 Position Printer · [x] 2.3 Alpha 3 — 12 heads · [x] 2.4 Alpha 3.2 — 8 heads
- [x] 2.5 Fab Pro 1I · [x] 2.6 Fab Pro 2I · [x] 2.7 JP7 · [x] 2.8 JPK · [x] 2.9 Rocket

**Phase 3 · The migration**
- [x] 3.1 Machine header updates (`intro_text`, `machine_model_no`, `supply_description`, `spec_rows`, `composition`, `header_fields`, `signoff_style`, `has_template`), each guarded `where name = … and has_template = false`
- [x] 3.2 Sections in a `do $seed$` block, one loop per family, skipping any machine that already has sections
- [x] 3.3 Master gaps the decks answer — model numbers, and `Fab Pro 1I` sign-off → `checked_by`

**Phase 4 · Apply and verify**
- [x] 4.1 Apply to `icutjkrqkbzwvmnfbzpr`
- [x] 4.2 SQL: 19/28 templates; all nine non-zero on specs + composition + sections; **the ten baseline fingerprints unchanged**
- [x] 4.3 Token sweep — every `{{…}}` is in `TOKEN_HELP`; zero `post_warranty_head_price` / `dryer_warranty`
- [x] 4.4 `cd frontend && npm run build`
- [x] 4.5 Browser: each of the nine in *Machine template*, no "placeholders not recognised" warning
- [x] 4.6 End-to-end render — **all nine** rendered through the app's own `buildOcPdf`, 4–7 pages each, **0 render errors, 0 ruled blanks, 0 unresolved `{{…}}`**. No test deal was raised and **no quotation number was burned**: the nine were rendered by importing the module against live store data, and JP7 was additionally seen on a real deal page.
- [x] 4.7 The `ZZ TEST` JP7 deal at `awaiting_customer_sign` now shows a **Detailed sheet tab it never had**, banner "Rebuilt from the template — the approved file could not be found". Renders correctly and `{{head_count}}` resolved to the deal's **4**, not the deck's 16. Behaviour change confirmed, and honest on its face.

**Phase 5 · Record**
- [x] 5.1 `OCPI.md` — new 31-08-2026 entry; Phase 3's counts and the "who supplies the missing templates" open item are now stale
- [x] 5.2 `WORKLIST.md` — tick this entry, correct §K's "the eleven decks are not in the folder either", and file the findings below
- [x] 5.3 Memory — 19 of 28 templated, and the render-don't-parse rule now has evidence

#### What the audit turned up

⚠ **Raw OOXML text is unusable for four of the nine decks — now proven, not suspected.** Both Alpha
decks and both Fab Pro decks extract with words fused (`Followingupyourkind order`,
`THEMACHINEISCOMPOSEDASFOLLOWS`). K64, JP7, JPK and Position Printer read cleanly, which is why the
problem was missed the first time. Transcription is from a **render**, always.

🔴 **`FABPRO 1I.pptx` is a filled-in live contract, not a blank template.** It carries customer
**PRINTING PARADISE**, their Tirupur address, **GST 33AAPFP8156P1ZD**, and the price
**₹40,00,000 + ₹7,20,000 GST = ₹47,20,000** with payment terms *25% Advance and remain in 8 equal PDC*.
Transcribed verbatim it would put **another customer's name, GST number and price on every future Fab
Pro contract.** Stripped to tokens on import.

🔴 **The retired head-price token appears five more times.** K64, Position Printer, Fab Pro 1I/2I
(*"1.75 lacs plus GST"*) and Rocket (*"INR 1,50,000.00 to 1,80,000.00 plus GST"*) all carry the
post-warranty print-head price sentence. `{{post_warranty_head_price}}` no longer resolves and would
print a **ruled blank in a signed contract**. All five take the reworded sentence already live on
K24/K32/P8D/P8S.

🔴 **Machine-warranty conflict.** Config is fixed at machine 12 / head 18 months. The decks say
Position Printer 12, Fab Pro 1I 12, JPK *"12 and no longer than 15"*, K64 blank — and **Rocket 24**.
Using the token prints **12 on Rocket, whose deck promises 24**. Proceeding with the token, because
OCPI-3 §F made warranties fixed company policy; **listed for Ritesh Bhai** below.

🟢 **A real dryer name, at last.** `JP K EVO.pptx` slide 3 carries a full Dryer Information block naming
**POWER-D Dryer (ELECTRIC)** — electrical heating H18, third passage H18, folder H18. Six placeholders
are standing in for exactly this; since OCPI-8 they no longer carry the `[SAMPLE]` prefix, so nothing
marks them out. See the *Waiting for* row on real dryer names.

🔴 **F18 · `{{machine_model_no}}` does not read the machine master, and Homer K24 is live with it.**
The token resolves from `deal.machineModelNo` — a free-text box the salesperson types on the quotation
form, which is **never prefilled from the machine**. K64, Position Printer and Rocket were first written
with the token and all three then rendered *"Model No: ________"* against a real deal; caught in the
render sweep, they now carry the literal model number, which is what their decks state anyway.
**Homer K24's live supply line still reads `(Model No: {{machine_model_no}})`**, so any K24 contract
raised without that box filled prints a ruled blank on a signed document. Not changed here — it is
existing contract text and outside this batch. The Machines form's hint *"Available in templates as
`{{machine_model_no}}`"* is misleading for the same reason.

🔴 **F16 · Position Printer's contract says it is a Homer K32.** Its deck's composition reads *"Printing
unit model Homer K32 to print from 4 to 8 colors"* — a copy-paste leftover from the K32 deck, carried
across verbatim under the deck-verbatim rule. **First thing for the proof-read.** The same deck also
carries a "Manufacture" label with no value and no token behind it, which was dropped rather than printed
as a dangling label. And the Alpha 3.2 deck's composition says *"model KoloRado alpha III"*.

🔴 **F17 · The two new Alpha decks state different commercial terms from their five siblings.** Not
wording drift — three substantive differences: NOT INCLUDED says *"Transportation Charges will be bear by
us"* where the five say local transportation is the customer's; WARRANTY says *"AMC charges will be
applicable"* where the five say **no** AMC applies if the customer uses Orange ink; and CANCELLATION opens
with *"Once order is placed; it will not be cancelled"*. Transcribed as the decks read, so seven Alpha
machines now carry two different sets of terms. Worth a decision.

#### Follow-up the same day — two siblings copied, 19 become 21

`20261023130000_seed_fms_ocpi_machine_templates_batch2b.sql`. **Fab Pro 3I ← Fab Pro 2I** and
**Kolorado Alpha 16 ← Kolorado Alpha 15**, asked for as "copy the sibling, change the model code".
Neither has a deck, so ⚠ **this content is not transcribed from a source document** — it is a sibling's
text with the model name changed, on the instruction that the specs are otherwise the same. Both clause
sets were checked to mention no model name or head count, then copied in SQL rather than retyped. Both
render clean (4 and 3 pages, 0 errors, 0 unresolved tokens, 0 ruled blanks, no stale "2i"/"15" left).

🔴 **Confirm Fab Pro 3I's rows and installable heads.** It carries 2I's figures verbatim — *Two* rows,
*16 Heads* installable, *(16H)* in the composition — but the family scales 1i = one row / 8 heads,
2i = Two / 16, so a 3i would normally be **Three rows / 24 heads**. Three figures on that contract are
wrong if so. Left as instructed. What the customer buys is safe either way: that row is `{{head_count}}`.

⚠ On **Alpha 16**, "15"/"16" is the model designation, **not a head count** — Alpha 15's own head row is
already `{{head_count}}`, so no head figure is fixed anywhere.

**Held deliberately (7 of 28 still without a template):**
- 🔴 **`PENGDA 800 DIA.pptx` cannot supply the two 800 machines** — fingerprinted 31-Aug-2026. Slides 1
  and 3 are **byte-identical** to the 1000 deck; slides 2 and 4 differ only by two boilerplate typos.
  Its spec table reads **Model: Pengda PD-1700XD-1000, Drum Diameter: 1000 mm** — no 800 data at all.
  Reading the naming as **PD-{working width}XD-{drum diameter}**, what is missing is the dimensions,
  initial power and voltage; the 1000's (2750×1750×2250 mm, 71 KW, 42 KW) will not fit an 800 drum.
  **A real 800 spec sheet is still needed.**
- **`KoloRado Alpha 3.2 — 16 heads`** — there is no "3.2 — 15 heads" to copy from, and the two that
  exist differ materially: 8 heads is 1800 | 2200 mm, 1000 Meter roll, no front dryer; 24 heads is
  3200 mm, 10000 Meter roll, with front dryer. **Client is supplying the detail.**
- `Mini Lario`, `Foil Machine`, `Label Printer`, `Book Printer` — never had a deck.

**Module gaps the decks expose, none blocking this import:**
- **JPK is priced in EURO.** The module supports **INR and USD only**. A JPK deal cannot be quoted in
  its own currency today.
- **Rocket's layout drawing cannot be reproduced** — a 2.9 MB JPEG in the OC document, referenced by its
  "Layout :" line. `fms_ocpi_machine_sections` is text and the renderer draws no images.
- **JPK's spec table has no *No. of Machine Supply* and no *installed printing heads* row**, so
  `{{machine_count}}` / `{{head_count}}` have nowhere to sit — unlike all 27 other machines. Both rows
  are being added, since the deal genuinely varies them.
- **JP7 cites a document not in the folder** — *"Printheads warranty: Please refer enclosed Policy
  document for Printheads."*
- **Sign-off shapes the renderer cannot express** — JPK closes with a two-party *Signature / Position /
  Date and place* block, Rocket with a Director signature. Cosmetic.


### OCPI-5 · The template comparison workbook — one tab per machine category  `[x]` — 02-Sep-2026
*Raised 2026-08-31 · Asked for by Ritesh Bhai · **BUILT 02-09-2026**, see [OCPI.md](OCPI.md) at the foot*

> 🟢 **Done.** Build green; the file was produced from the real button and opened in Excel, where the
> freeze, the fills, the wrapping and the empty answer column were all read back and asserted.
> **Direct: 126 lines — 4 identical, 12 differ, 35 missing on some, 75 on only one or two.**
> **Sublimation: 49 lines — 9 identical, 13 differ, 8 missing on some, 19 on only one or two.**
> Other and POD carry a written explanation instead of an empty grid, as specified.
>
> 🔴 **Found while building: `ws["!freeze"]` writes NOTHING, in every export this repo has ever
> produced.** The community `xlsx-js-style` writer emits a self-closing `sheetView` with no `pane`
> child. So no spreadsheet from `exportXlsx.ts` has ever had a frozen header row, and four modules'
> comments say it does. Fixed HERE ONLY, opt-in via `freezeCols`, so no existing export changed —
> see **PF-15** for the rest.

**The question this answers.** Twenty-one machines each carry a template transcribed from its own
PowerPoint deck, written by different people over several years. Nobody has ever seen them side by side.
So nobody knows which clauses every machine says identically, which say the same thing in different
words, which a machine is simply missing, and which one machine carries alone. Reading twenty-one
templates one screen at a time cannot answer that — the eye cannot hold twenty-one wordings.

**What it is.** One `.xlsx` download, one tab per machine category.

#### 🔴 RE-CHECKED 02-09-2026 — the shape has changed since this was written, in two ways that matter

**There are now FOUR categories, not three.** OCPI-14 added **POD**. And the templated counts have moved:

| Category | Machines | With a template | Not templated |
|---|---|---|---|
| **Direct** | 11 | **10** | Mini Lario |
| **Sublimation** | 12 | **10** | Foil Machine, KoloRado Alpha 3.2 — 16 heads |
| **Other** | 3 | **1** | Pengda PD-1700XD-800, Pengda PD-1800XD-800 |
| **POD** | 2 | **0** | Book Printer, Label Printer |

🔴 **ONLY TWO TABS CAN ACTUALLY BE COMPARED.** A diff needs at least two columns. **Other has ONE**
templated machine (Position Printer moved to Direct in OCPI-14) and **POD has NONE**. So:

- **Direct (10) and Sublimation (10)** are the real work, and they are what Ritesh Bhai actually wants.
- **Other** renders as a single column with nothing to compare it against — every row is trivially
  "unique". Emit the tab, but **say at the top that a comparison needs two machines and this has one.**
- **POD** has nothing at all. **Emit the tab with a one-line explanation, not an empty grid** — a blank
  sheet reads as a bug, and someone will re-run the export thinking it failed.

Tell Ritesh Bhai this before building, in case he would rather have two tabs and a footnote than four.

🟢 **The parked Label Printer / Book Printer question is answered by the data.** OCPI-14 put both in
**POD**. Nothing to decide.

Within a tab:

| | Homer K24 | Homer K32 | Homer K64 | … |
|---|---|---|---|---|
| *(pointer)* | *(that machine's value)* | | | |

- **Columns are the machines** of that category, in master sort order. Column A is the pointer name,
  and it freezes so a reader scrolled across to the twelfth machine can still see which line they are on.
- **Rows are the pointers** — the UNION of every pointer any machine in that tab carries, so a line
  only one machine has still gets a row, with blanks across the rest. That blank IS the finding.
- Rows are **banded by where the pointer lives** in the template, since a missing spec row and a
  missing clause are not the same kind of gap:

  | Band | Source | Pointer = |
  |---|---|---|
  | Header | `doc_title`, `intro_text`, `machine_model_no`, `supply_description`, `signoff_style` | the field name |
  | Header fields | `header_fields[]` | each field label |
  | Specification | `spec_rows[]` | the row **label**; the cell is its **value** |
  | Composition | `composition[]` | the bullet itself; the cell is ✓ / blank |
  | Sections | `fms_ocpi_machine_sections` | the section **title** (keyed on `key`); the cell is the **body** |

**The highlighting — the whole point of the sheet.** Fixed content stays quiet; variable content shouts.

| Case | Treatment |
|---|---|
| Every machine in the tab carries it, all values identical | **no fill** — settled boilerplate, leave it alone |
| Every machine carries it, values differ | **amber** on the cells that differ from the tab's most common value |
| Some machines carry it, some do not | **red** on the empty cells — *missing* |
| Only one or two machines carry it | **blue** on the cells that have it — *additional* |

⚠ **Comparison is on normalised text, not raw text** — trim, collapse runs of whitespace, case-fold and
strip trailing punctuation before deciding "same". Otherwise `Ex-works Ahmedabad` and
`Ex-Works, Ahmedabad ` colour amber and the sheet reports a difference that does not exist. The cell
still prints the **original** text; only the equality test is normalised.

⚠ **`{{tokens}}` are compared as tokens, never as resolved values.** Two machines both saying
`{{head_count}}` are identical even though every deal prints a different number there. Resolving first
would make every templated machine differ from every other and the sheet would be all amber.

A leading **summary block** on each tab, above the grid: machines in this tab, pointers in the union,
how many are common / differing / partial / unique. That is the number the sheet exists to produce —
"how far apart are these documents" — and it should not have to be counted by eye.

**Where the button goes.** OCPI → Reports, beside the Deal Register, and on the Machines master. Not a
screen: the ask is explicitly a spreadsheet with tabs, and a nineteen-column diff grid is a
spreadsheet's job, not a table's.

⚠ **`exportSheetsToXlsx` styles by ROW, not by CELL.** `rowStyle` in `shared/lib/exportXlsx.ts` calls
`styleRow`, which paints the whole width. This sheet needs one fill on one cell. Add an optional
`cellStyle?: (row, colIndex) => object | undefined` beside `rowStyle` — `xlsx-js-style` already supports
per-cell fills, so it is a helper change, not a new library. Column A must also **wrap**, since a section
body is a paragraph; set row heights or the grid is unreadable.

⚠ **Freeze panes are inert in this codebase.** `!freeze` writes nothing, so "column A freezes" needs the
pane/view keys or it silently does not happen — and this is the one export where an unfrozen first
column makes the sheet useless. Verify by opening the file, never by reading the code.

#### Sequencing and scope

🟢 **The OCPI-4 gate is cleared** — the 31-08 batch is in, so **19 of 28** machines carry a template and
there is something real to compare. Had this been built a day earlier, against the previous 10, nine of
the columns would not have existed and the sheet would have reported a hundred pointers as "missing"
that were merely not imported yet. Worth remembering if another template batch is ever pending: run the
comparison **after** the import, never across it.

🔴 **Machines with `has_template = false` are excluded, and the tab says so by name.** An untemplated
machine is not a machine that disagrees with the others — it is a machine with nothing to compare.
Included as an all-blank column it would drown every real finding in false red. List them under the
grid: *"Not compared — no template imported: Pengda PD-1700XD-800, Pengda PD-1800XD-800."*

#### Phase-wise checklist

**Phase 0 · Settle the shape**
- [x] 0.1 Confirmed against the live database 02-09: **four** categories, and OCPI-14 already put both
      JAY machines in **POD**. Nothing was left to decide
- [x] 0.2 Inactive machines are excluded and named under the grid on their own line, separately from
      the untemplated ones — "switched off" and "never written" are different sentences for a reader.
      ⚠ **All 28 machines are active today**, so this changes nothing yet; it is built so the sheet
      stays true the day one is deactivated
- [x] 0.3 **The fill is never the only carrier of a finding.** Every row states its verdict in WORDS in
      a `Status` column — `Same`, `Differs (3 of 10)`, `Missing on 4 of 10`, `Only 2 of 10` — and
      within a row the marked cells are then self-evident: on `Differs` every cell has text and only
      the odd ones are amber; on `Missing` the marked cells are the empty ones; on `Only 1–2` the
      non-empty ones. A legend row on each tab says exactly that

**Phase 1 · The diff**
- [x] 1.1 `lib/templateDiff.ts` — pure, no XLSX. **Checked by eye on Homer K24 vs K32 before it was
      trusted on ten**: hand-predicted 32 same / 8 differ / 0 missing / 6 unique across 46 lines, and
      the code returned exactly that. It caught a real typo nobody had seen — K24 says
      "Tension-adjustable **continuous**", K32 "**continous**"
- [x] 1.2 Sections match on `key`. Where a key's titles disagree the sheet emits a second `↳ its heading`
      row carrying each machine's wording — the difference is SHOWN rather than splitting one clause
      into two half-empty rows. Fires on exactly three keys in Direct (`installation`, `pc_spec`,
      `warranty`) and none in Sublimation, which matches the database
- [x] 1.3 Spec rows match on normalised label. Direct's union is 36 labels across 10 machines, 21 of
      them carried by a single machine

**Phase 2 · The workbook**
- [x] 2.1 `cellStyle` on `ExportSheet`, plus `preamble`, `rowHeights`, `headerStyle` and `freezeCols`.
      All optional, all no-ops when absent; the three existing `exportSheetsToXlsx` callers and the
      eight `exportRowsToXlsx` ones were each opened and confirmed, not assumed
- [x] 2.2 `lib/exportTemplateComparison.ts` — **four** tabs (the entry predates POD), summary line,
      legend, per-band breakdown and excluded-machines footer. Button on OCPI → Reports beside the
      Deal Register
- [x] 2.3 "About this export" carries all three, plus each tab's counts and the row-height cap

**Phase 3 · Verify**
- [x] 3.1 `npm run build` green
- [x] 3.2 **Opened in Excel via COM and asserted, not eyeballed**: `FreezePanes=True`,
      `SplitColumn=4`, `SplitRow=4`; all four fills present (81 blue, 126 amber, 135 red);
      `WrapText=True` on the line name, the answer column and the machine cells; row heights varying
      16–91pt; tab names Direct / Sublimation / Other / POD / About this export; the
      agreed-wording column blank on all 144 rows and filled on none
- [x] 3.3 Spot-checked cell by cell against the raw table, both tabs. Direct `Sign-off wording` ambers
      exactly the three Fab Pros (the `checked_by` minority against seven `approved_by`); Direct
      `Model no.` reds exactly Homer K32, the one machine with none; Sublimation `Model no.` blues
      exactly P8D and OT-1908A, the only two that carry one; Sublimation `Sign-off wording` ambers
      exactly the four `approved_by` against six `checked_by`. Every fill was where it should be
- [x] 3.4 Proved by stripping every section off Fab Pro 2I and rebuilding: 10 columns before, 10 after,
      absent on all 19 section rows, its other bands untouched. The columns come from the MACHINE
      list, never from the pointers, so this cannot regress silently

#### Open questions
- [x] ✅ **SETTLED 01-09-2026 — this sheet is the INPUT TO A CLEAN-UP, not a one-off read.** Ritesh Bhai
      intends to decide a single agreed wording for each line that differs, and have the templates
      updated to match. **So the grid needs a blank *"Agreed wording"* column beside each banded group**,
      wide and wrapped, for him to write into. Without it he would be marking up a sheet with nowhere to
      put the answer, and the whole exercise would need regenerating.
      ⚠ **The applying is a SEPARATE, LATER TASK** — rewriting the agreed wording into the templates is
      editing the words that print on signed contracts, across up to 19 machines. Do not let it get
      folded into the workbook build. Raise it as its own entry when the filled-in sheet comes back.
- [ ] Should the sheet also carry a fourth tab of **all machines**, ignoring category, for the clauses
      that ought to be identical company-wide (payment terms, warranty, jurisdiction) regardless of
      what the machine is?
- [ ] Where do **Label Printer** and **Book Printer** belong — Other, or a category of their own?
      ⚠ **DEFERRED by Ritesh Bhai, 01-09-2026** — he will decide later. Do **not** block the workbook on
      it: build the three tabs from whatever category those two actually carry today, and if that leaves
      them somewhere odd, say so in the sheet's footer rather than guessing a home for them.

### OCPI-6 · The machine master cannot be read for active vs inactive  `[x]` — 01-Sep-2026
*Raised 2026-08-31 · Reported by Ritesh Bhai as "creating quite a confusion" · **BUILT 01-09-2026**,
portal-wide in `MasterCrud`, see [OCPI.md](OCPI.md) at the foot*

> 🟢 **Done.** Build green, verified in the browser on the Machines master AND on Organisation →
> Departments (23 rows, 11 inactive — the segment reads `All · 23 / Active · 12 / Inactive · 11`).
> Status moved from the twelfth column to the second: measured, the table is **1748px wide in an
> 836px window**, so the badge is now visible unscrolled where its old position is not.

Activate / Deactivate works, and every part of it is present — and yet the screen is unreadable, because
the three pieces sit as far apart as the layout allows.

🔴 **The Status badge is the LAST of twelve columns, on the widest master in the app.** Machines carries
ten columns of its own (Machine code, Billing name, Category, Print heads, Dryer, Centering, Document
heading, Model no., Template, Sign-off) plus `MasterCrud`'s Actions and Status. Status sits **off the
right edge** of the `ScrollableTable`, so on a normal screen "is this one active" cannot be answered
without scrolling sideways.

🔴 **The button is at the far LEFT and its result at the far RIGHT.** *Deactivate* lives in the Actions
column; the badge that confirms it lives twelve columns away, out of view. You click, nothing you can
see changes, so you click again. That is the confusion, exactly.

🔴 **The Status filter has the same problem.** `MasterCrud` does render a searchable Active/Inactive
filter — in the last cell of the filter row, off-screen with the badge. So the control being asked for
**already exists and cannot be found**, which is worse than it not existing.

🔴 **Nothing on the screen says what deactivating a machine DOES.** It is not a delete and it is not
cosmetic: `QuotationForm.tsx:290` filters the model dropdown to `m.active || m.id === draft.machineId`
— an inactive machine **stops being quotable**, while a draft already sitting on one keeps it. That is
the entire meaning of the switch, and the master never mentions it, so nobody can tell whether
deactivating will break an open deal. (It will not. The screen should say so.)

⚠ **Default sort already puts live rows first** (`MasterCrud.tsx:371`), but only *within* the sort — with
28 rows across two pages, inactive machines still interleave into the page the reader is on, and there
is no count anywhere of how many of each there are.

#### What to build

- [x] 1 **A status segment at the top of the master — All · Active · Inactive, each with its count.**
      Built as a `PillToggle` first in the toolbar row, above the `Card` so it stays reachable when the
      body is empty. It holds **no state of its own** — it reads and writes the very same
      `colFilters.__status` the column dropdown does, proved bidirectionally in the browser (picking
      *Active* in the dropdown moves the segment, and the reverse). Counts come from the existing
      `narrow(searched, "__status")` pass, so they cascade with the search and the other columns and cost
      no extra walk over the rows.
- [x] 2 **Default the segment to Active**, with *"N inactive hidden"* beside it. On Departments it reads
      *"11 inactive hidden"*. A **constant**, never seeded from `rows` — the FMS stores load
      asynchronously, so a lazy initialiser would run against an empty array. Filtered-empty keeps the
      header, the filter row and *Clear all filters*, and the segment stays on screen throughout.
- [x] 3 **Status moved to the second column**, immediately left of the master's first column, plus a
      muted band and a 3px grey leading rule on inactive rows (transparent when live, so nothing shifts).
      ⚠ Deliberately **not** `opacity` — that would fade the *Activate* link on exactly the rows somebody
      opened the screen to switch back on.
- [x] 4 **The badge now sits beside the button**, measured at 0px between the two cells.
      ⚠ **One consequence worth knowing:** on the default *Active* view, deactivating a row makes it
      **leave the table** rather than show its new badge — it no longer matches the filter. The feedback
      is real and immediate (the segment counts move and *"1 inactive hidden"* appears), but the badge
      itself is only watchable from *All* or *Inactive*.
- [x] 5 **Said once, under the toolbar.** `statusNote` prop; Machines passes the wording above, and every
      other master gets a generic default that is true of all of them ("An inactive department cannot be
      picked on new records. Anything already using it is unaffected.").
- [x] 6 **Portal-wide, confirmed with the client before building.** Lands on ~50 `MasterCrud` call sites.
- [x] 7 Verified: build green; Machines and Organisation → Departments both checked; segment and column
      filter proved to agree in both directions; a `Book Printer` deactivate → activate round trip left
      the row `active = true`, confirmed in SQL. **A defect was found by this check and fixed** — see the
      `statusOptions` note in OCPI.md.

**Not in scope:** the Activate/Deactivate mechanism itself, which works. This is legibility only.

### OCPI-7 · Deal inclusions — when it is NOT included, ask whether it is offered at a rate  `[x]`
*Raised 2026-08-31 · Asked for by Ritesh Bhai · **BUILT 31-08-2026**, see [OCPI.md](OCPI.md) at the foot*

> 🟢 **Done.** Migration `20261024120000_fms_ocpi_a_no_may_still_carry_a_rate.sql` applied, build green,
> truth table and money guard proved in SQL, form checked in the browser on a `ZZ TEST` deal.
> **Narrowed mid-build to ink and head only** — spare parts keeps today's behaviour, a No ends it.
> The second question reads **"Offered at a subsidized rate?"**, prints on the **quotation only**, and
> prints **the final price alone**.

**What is being added.** Section B asks three questions — *Deal includes ink · spare parts · head* —
and today a **No** ends the conversation. It should not. "Not included in the machine price" is not the
same as "not being sold": the customer still buys ink, still buys spares, still buys heads, and the
rate is usually agreed at the same table as the machine. Today that agreement lives nowhere, so it is
re-negotiated later from memory.

**The branch, on each of the three items:**

```
Deal includes ink?                    ── Yes ──▶ Quantity of ink included        (unchanged)
                                      └─ No  ──▶ Offered at an agreed rate?
                                                   ├─ No  ──▶ nothing further
                                                   └─ Yes ──▶ Quantity · Rate · Sub-total
```

- **Sub-total is derived, never typed** — `quantity × rate`, read-only, recalculating as either changes.
  A typed sub-total that disagrees with its own two factors is a contradiction printed on a contract.
- Identically for **ink**, **spare parts** and **heads** — three items, the same three fields each.
- The pattern already exists in this form: *Shipment & invoice* asks the same four questions of four
  items rather than four bespoke blocks. Build this the same way — **one small component, three callers**,
  not three copies (`QuotationForm.tsx:105` is the precedent and says so).

#### The traps

🔴 **Every branch rule in this module shows on `true`. These show on `false`.** `branching.ts:125–129`
reads `d.inclInk === true`, and all eight of the form's rules plus the five of our own are the same
shape. `=== false` is new, and `null` (unanswered) must show **nothing** — the third state is real here,
since an unanswered inclusion must not present a rate question as though the answer were already No.

🔴 **The server clears hidden fields, and it will clear these too — with the wrong condition.**
`fms_ocpi_write_quotation` / `fms_ocpi_write_oc` null every column their branches hide, on *every*
write: `ink_qty_included = case when v_incl_ink is distinct from true then null else … end`. The new
columns need the **inverted** guard (`is distinct from false`) *and* a second guard on the rate Yes/No.
Get it wrong and either the rate silently vanishes on the next save, or a rate agreed while the answer
was No survives a change to Yes and prints on the contract beside "Inclusive of Ink: Yes". The
migration comment calls this clearing "the backstop" — it is, and it is also the thing most likely to
eat this feature.

⚠ **The write RPCs have been redefined five times** (`20260929120400`, `20261019120100`,
`20261019120200`, `20261021140000`, …). Base the new migration on the **live** definition pulled from
the database, not on whichever file grep finds first, or an older revision's body is silently restored
over four later changes.

🔴 **Do NOT reuse the `*InvoiceQty` / `*InvoiceAmount` fields.** `headInvoiceQty` / `sparesInvoiceQty`
already exist and mean something different: a head that **is** included but is billed on a separate
invoice. The new fields are for an item that is **not** included at all. Same words, opposite meaning,
and they are mutually exclusive by construction — `inclHead = true` can only have the invoice pair,
`inclHead = false` only the rate pair. Name them so a reader cannot confuse them
(`headRateQty` / `headRate` / `headRateSubtotal`, or similar) and never let both be non-null on one row.

🔴 **The currency question has to be answered before anything is built.** The deal carries
`dealValueCurrency` (INR / USD only — JPK's EURO gap is already logged under OCPI-4). A rate must
follow the deal's currency, not carry one of its own, or the sheet shows two money columns with no way
to tell them apart. And if a USD deal's rate is to appear in rupees, it has to use the deal's
**frozen** `fxRate` — never a rate looked up again at print time (`types/index.ts:127` — *"FROZEN,
NEVER RE-DERIVED"*).

#### Every place a Section B field is touched — all of them, or the feature half-lands

| File | What has to change |
|---|---|
| `types/index.ts` | six or nine new nullable fields on `OcpiDeal` |
| `lib/fieldSpec.ts` | draft type (~l.64), `EMPTY` defaults (~l.202), **`FIELD_LABEL`** (~l.497), `fromDeal` (~l.607), the snake_case row payload (~l.714), and the missing-fields list (~l.829) |
| `lib/branching.ts` | the new show-on-`false` rules |
| `lib/quotationPdf.ts` | Section B prints today at l.275–279 — decide whether the rate lines print, and where |
| `supabase/migrations/` | additive nullable columns + both write RPCs' clearing and completeness predicate |
| `lib/revisionDiff.ts` | **nothing** — it iterates `FIELD_LABEL` (l.50), so a label is all a field needs to appear in the revision diff. Noted so it is not done twice |

⚠ **The completeness gate is in SQL as well as in the form.** `20261019120100:251–255` carries
`incl_ink is not null and (incl_ink is not true or ink_qty_included is not null)` — the server's own
"is this deal ready to submit". If the rate fields are required when shown, they join that predicate
too, or the form will let a deal through that the RPC then refuses, with no message a salesperson can act on.

#### Phase-wise checklist

**Phase 0 · Settle**
- [x] 0.1 The shape — sub-total outside the deal value, one rate per item, ink in litres *(see Settled, below)*
- [x] 0.2 Final wording — **"Offered at a subsidized rate?"**
- [x] 0.3 **Quotation only, never the OC — and only the FINAL PRICE prints.** Quantity and rate are
      captured and appear in the revision diff, but the paper shows one figure per item
- [x] 0.4 **Heads are a plain count.** Spares needed no answer in the end — see the narrowing below
- [x] 0.5 ⚠ **The currency question is answered: the rate follows the deal's own
      `deal_value_currency`.** No second currency column and nothing is converted, so the frozen-FX
      hazard the trap warned about never arises. Proved live on a USD deal, which rendered `$ 4,50,450`

**Phase 1 · SQL, additive**
- [x] 1.1 Eight nullable columns, one migration, nothing altered or dropped
      (`20261024120000_fms_ocpi_a_no_may_still_carry_a_rate.sql`)
- [x] 1.2 🔴 **ONE writer, not both — the plan here was wrong.** Section B is part A, so only
      `fms_ocpi_write_quotation` was re-issued, from its **live** body (which did differ from the
      newest file: two comments, every executable line identical). `fms_ocpi_write_oc` was
      deliberately left alone — their column separation is what stops saving one from blanking the
      other, and it sits one revision ahead of the file that last defined both. Leaving it alone is
      also what makes the invoice/offer exclusion *structural* rather than a convention
- [x] 1.3 Completeness predicate extended in step with the form's — **but only where it is vacuous on
      existing rows.** Requiring an *answer* to the rate question was rejected: a CHECK is
      re-validated on every UPDATE, so it would have made the four deals already answering No to head
      un-updatable, and every approval or signature stamp on them would throw

**Phase 2 · Form**
- [x] 2.1 One `RateOffer` component, **two** callers, sub-total read-only and derived — and empty
      rather than `₹ 0` while either factor is blank
- [x] 2.2 Branch rules for the `false` case; `null` shows nothing
- [x] 2.3 All six `fieldSpec.ts` touch-points — ⚠ **plus `data/ocpiFetch.ts`'s `mapDeal`**, which the
      table above omits and which fails *silently* if missed (`r` is `any`, so the column simply
      arrives as null)

**Phase 3 · Documents**
- [x] 3.1 The quotation prints the final price alone, in the deal's currency, on a row that appears
      only when the rate question was actually answered — so a deal saved before this existed still
      prints exactly the six rows it always did

**Phase 4 · Verify**
- [x] 4.1 `cd frontend && npm run build` — green
- [x] 4.2 Browser on `ZZ TEST Saraswati Fabrics` (**nothing saved; the row is unchanged**): unanswered
      inclusion → nothing at all; No → the question alone; No → rate Yes → three fields.
      `4 × 125,000` → `$ 5,00,000` live, `$ 5,20,000` when the rate changed, **empty** when the
      quantity was cleared. Ink toggled to No → the litres block appeared and *Quantity of ink
      included* vanished with it. Integer guard strips `.` and letters; the decimal one keeps `500.5`
- [x] 4.2b 🔴 **The switch-back, proved in SQL against the live writer** rather than through the
      screen — a stronger test than the one asked for here. Rate stored, then the inclusion flipped to
      Yes **with the rate still in the payload**: all four columns came back **null**, and the
      Yes-branch details (`200 litres`, `2`) returned. The whole truth table was run the same way,
      including *inclusion unanswered + rate answers sent* → stores nothing
- [x] 4.3 The two factors carry `FIELD_LABEL` entries (*"Ink — subsidized rate (per litre)"*), placed
      positionally so the diff sorts them beside their own question. `revisionDiff.ts` needed nothing
- [x] 4.4 An older deal still opens and prints **identically** — both flags are null on every deal on
      record, so nothing is pushed into Section B and it is the same six rows
- [x] 4.5 🔴 **The money guard — passed.** Both blocks filled with large round rates and `write_oc`
      re-run: `deal_value_amount`, `deal_value_inr`, `machine_value_inr`, `gst_rate`, `gst_amount_inr`,
      `total_inr`, `dryer_value_inr`, `dryer_gst_inr` and `grand_total_inr` all **byte-identical**.
      It is guarded three ways beyond that test: the sub-total carries no `_inr` suffix, it is not in
      rupees at all, and the migration's own assertion **fails the deploy** if `fms_ocpi_write_oc`
      ever so much as mentions one of the eight columns. The new Deal Register columns sit at the far
      end of the sheet, away from the deal-value block, so no contiguous numeric range sweeps them up
- [x] 4.6 The completeness gate, all three ways: a subsidized Yes with no figures is **refused**
      (hard-asserted, not merely observed); accepted once the figures are given; and an unanswered
      rate question does not block submission

#### Settled  *(answered by Ritesh Bhai, 31-08-2026)*

🔴 **The sub-total does NOT form part of the deal value, and must never be added to it.** The reasoning
is the branch's own: this question is only ever asked when the item is **not** inclusive of the deal, so
its money cannot be part of the deal's money. Concretely — `deal_value_amount` is untouched, the GST
derivation is untouched, the frozen FX conversion is untouched, and the quotation's headline figure stays
the machine price. The rate is agreed alongside, quoted separately, invoiced when they actually order.

⚠ **This is a rule to defend, not merely a decision to record.** Three sub-totals sitting on the same row
as a deal value are an obvious thing for a later "grand total" to sweep up, and a contract that adds an
un-ordered ink rate into the machine price is a commercial error, not a display bug. Every place that
sums money on a deal — the PDF total, the Deal Register's numeric columns, any future dashboard roll-up —
must exclude these three by construction. Say so in the column comments, so the next person reads it
before they add it up.

- 🔴 **INK AND HEAD ONLY — spare parts is NOT part of this** *(narrowed by Ritesh Bhai mid-build,
  31-08-2026)*. Spare parts keeps today's behaviour: a No ends the conversation. That removed a whole
  column family and the description field spares would otherwise have needed, and it is why the
  component has **two** callers rather than three. The paragraph above still says "three sub-totals";
  read it as two. Everything else in it stands unchanged.
- **One rate per item, not a list.** Two fixed field-groups — ink and head — one quantity/rate/sub-total
  each. No repeatable line-item grid. This is what makes it flat columns per item rather than a child
  table, and it settled Phase 1's shape.
- **Ink quantity is in LITRES.** So the rate is *per litre* and the field is **numeric** — not free text
  like the existing *Quantity of ink included* beside it — and the unit is stated so nobody has to infer
  it.
- [x] **Units settled: heads are a plain count** (`headsIncluded` next door already is), rate per head.
      Spare parts became moot when the client dropped them from this feature.
- ⚠ **"Label both with the unit" turned out to be half-wrong, and the data is why.** The new numeric
  field says litres because the client fixed it there. The old free-text `ink_qty_included` does **not**,
  because of the 17 deals carrying a value, 15 say litres and two say **"25 Kgs"** and **"3000kg"**.
  `FIELD_LABEL` is also the revision diff's heading, so labelling it *(litres)* would restate two real
  deals in a unit they never agreed to. Its hint asks the salesperson to **state the unit** instead of
  asserting one — which answers the original worry (two fields measuring the same substance three rows
  apart) without printing a claim that is not true.
#### Three more answers, same day *(31-08-2026, after the first version shipped)*

- ✅ **`ink_price` and the subsidized rate are separate things** and both stay. The question logged
  here is closed.
- 🔴 **The subsidized rate is ALWAYS IN RUPEES — this reverses 0.5 above.** It no longer follows the
  deal's currency: a machine may be sold in dollars, but ink and heads are bought here and are rated
  in rupees regardless. A High Seas sheet now shows a **dollar machine price and a rupee ink price on
  one page**, each with its own symbol. Nothing is converted, so `fxRate` still never enters this
  block. Comments-only migration `20261024130000`; no data or arithmetic changed, because the stored
  figures were never converted in the first place.
  ⚠ **This removed one of the money guard's defences and it is worth knowing which.** The first
  version argued the sub-total could not join `total_inr` partly *because it was not in rupees* —
  an ~85× error announces itself. It is now the same unit as the money path, so a wrong sum would
  look plausible. The **migration assertion that fails the deploy if `fms_ocpi_write_oc` mentions an
  offer column** is now the load-bearing guard. Do not weaken it.
- ✅ **A rate now carries the quantity it is bounded by.** `SUBSIDIZED_RATE_NOTE`, beside the existing
  `DOLLAR_CLAUSE` and `INSURANCE_CLAUSE`. Shown **on the form under the rate as it is typed** — so the
  salesperson sees the commitment before writing the figure — and printed on the quotation:
  *"This is a subsidized rate, agreed for 500 litres and valid for that quantity only. Any further
  quantity will be charged at the rate prevailing at the time of that order."*
  ⚠ **The printed sentence names the quantity, which bends "the final price only" on purpose.** A note
  reading *"valid for the stated quantity"* is empty when the quantity appears nowhere on the page. It
  goes inside the sentence rather than into a ruled row, so the sheet still shows one price per item.

### OCPI-8 · Dryer details — hide them on "Not Applicable", buttons for the category, and drop the `[SAMPLE]` prefix  `[x]` — 01-Sep-2026
*Raised 2026-08-31 · Asked for by Ritesh Bhai · three changes to one card*

#### 1 · "Not Applicable" must hide the dryer detail fields

Today the whole *Dryer details* card appears when the **machine** takes a dryer (`show("dryerType")`,
11 of 28 machines) and everything inside it then shows regardless of the category chosen. Pick **Not
Applicable** and *Dryer · chambers · heating medium · included in the deal · dryer price* all stay on
screen, all unfillable, and the completeness warning keeps asking for a dryer name that cannot be given.

Keep the **category** selector visible; hide everything below it unless the category is **Indian** or
**Chinese**.

🟢 **This closes a known open question rather than opening one.** OCPI.md already records it: *"Picking
it on a machine that needs a dryer leaves the name unfillable and the completeness warning standing.
That guides rather than blocks — but somebody will report it as a fault. Whether a dryer machine should
be offered Not Applicable at all is a business decision."* Somebody has now reported it, and the
business decision is made: **Not Applicable stays on offer, and it means no dryer details.**

🔴 **The server clears hidden fields too, and it does not know about this rule.** `fms_ocpi_write_oc`
nulls every dryer column off the machine's `needs_dryer` flag. It must now *also* null them when the
category is Not Applicable — otherwise a chamber count and a dryer price typed before the salesperson
switched to Not Applicable stay on the row and print on the contract, under a card the form no longer
shows. Same trap as OCPI-7; same fix, in the same two RPCs.

🔴 **`missingForDetailSheet` has to stop asking for a dryer name.** It is what makes the deal
incomplete today. If the field is hidden and the check still demands it, the deal becomes
**un-submittable** rather than merely untidy — a worse bug than the one being fixed.

⚠ **The branch has to key on something more durable than the word "Not Applicable".** `dryer_type` on
the deal is **TEXT — the category's name**, frozen into every revision payload (that is why the column
kept its name through OCPI-3's relabel). Match the literal string and renaming the category in Masters
silently switches the branch off, with no error anywhere. Resolve the name back to its master row and
branch on the row, or accept that this category name can never be edited and say so on the Masters screen.

#### 2 · The dryer category becomes click buttons, not a dropdown

Three options — Indian · Chinese · Not Applicable. A searchable Combobox for three values is more
clicks than reading them, and this is the field that now decides whether half a card exists, so it
should be visible at a glance rather than folded into a closed dropdown.

⚠ **Account for what the Combobox carries before replacing it** — CLAUDE.md's container rule, and this
control has three things buried in it:

| On the Combobox today | Survives as buttons? |
|---|---|
| `searchable` | not needed at three options — genuinely goes away |
| `clearable` | **decide** — buttons need an explicit way back to "not chosen", or the first click is irreversible |
| `onCreate` + `setAsk({ type: "dryer_type" })` | **a real feature**: a salesperson can type a category that does not exist, it is kept on the deal, and the master is asked to grow. Buttons remove the only route to it |

If the "request a new category" path still matters, it needs a **+ Other** button opening the same ask.
If it does not, say so deliberately — do not let it disappear because the dropdown did.

⚠ **Render the buttons from the live master (`s.dryerTypes`), never from a hardcoded three.** Hardcode
them and a category added on the Masters screen never appears on the form, and the two screens disagree
with no clue why.

#### 3 · Drop the `[SAMPLE]` prefix from the dryer names

The six placeholder dryers read `[SAMPLE] …` today — three Indian, three Chinese: *2-Chamber Electric*,
*3-Chamber Thermic Fluid*, *4-Chamber Gas Fired*. Remove the prefix on both categories and use the name
alone. Rename, do not delete — `fms_ocpi_deals.dryer_name` stores the **text**, so the rows can be
renamed in place without touching any saved quotation.

🔴 **Raising the risk once, because it prints on a customer's paper.** The prefix is not clutter; it was
put there on purpose and OCPI.md says why: *"a dryer name **prints on the customer's quotation**, so
accidental use shows on the paper instead of passing silently."* Strip it and *3-Chamber Thermic Fluid*
reads on a signed contract exactly like a real product name — and the real names are **still
outstanding** (see *Waiting for*). Two further consequences:

- The documented removal statement stops working. `delete from fms_ocpi_dryers where name like
  '[SAMPLE]%'` is how the placeholders were to be cleared when the real list arrived; afterwards
  nothing distinguishes a placeholder from a real dryer, in the master or on a deal.
- **One real name already exists** — `JP K EVO.pptx` named **POWER-D Dryer (ELECTRIC)**. So the real
  list is not entirely unknown, and it may be quicker to replace the six than to de-label them.

Proceeding as asked. If the prefix should stay until the real names land, or if the six should simply be
replaced by the real ones now, say so and this becomes a smaller change.

⚠ Read as **Indian**, not Italian — the three live categories are Indian · Chinese · Not Applicable, and
there is no Italian one. Correct me if a fourth category is actually wanted.

#### Phase-wise checklist

- [x] 1.1 Branch: dryer detail fields shown only for a real category; category selector always visible.
      `hasDryerDetails` in `branching.ts`. ⚠ **The five fields were NOT individually gated in the form** —
      only `dryerPrice` was — and `clearHidden` iterates every rule regardless, so adding the rules
      alone would have blanked the answers on save while leaving the boxes on screen. One group guard;
      three now-unreachable affordances removed with it
- [x] 1.2 ⚠ **ONE write RPC, not both, and that is a decision.** `fms_ocpi_write_quotation` owns exactly
      one dryer column — `dryer_type` — and that *is* the answer; nulling it would erase the choice.
      `fms_ocpi_write_oc` narrows its existing gate in three lines, which covers the detail columns,
      the price and its derived rupee figures, and the six shipment columns
- [x] 1.3 `missingForDetailSheet` no longer demands a dryer name. ⚠ **It is the ONLY place that did** —
      neither `fms_ocpi_complete_when_submitted` nor `fms_ocpi_submit_oc` names a dryer column, so the
      deal was untidy rather than un-submittable
- [x] 1.4 **NEW — the branch keys on a marker, not the name.** `fms_ocpi_dryer_types.means_no_dryer`
      (nullable, additive); the literal name survives in exactly one place, the migration's one-time
      `update`. A trigger refuses to rename a flagged row, since deals store the category as text
- [x] 1.5 **NEW — the Dryer row hides from Shipment & invoice too** (client, 01-Sep). One variable
      governs every dryer clearing in the RPC, so leaving the row visible would have been a
      form/server disagreement
- [x] 2.1 Category as a button row from `s.dryerTypes`, reusing `ChoiceButtons`. **`clearable` KEPT**
      (the field is required by neither completeness check, so it is optional). `searchable` genuinely
      goes. ⚠ Deliberate exception to `ChoiceButtons`' "never a master list" rule — recorded in OCPI.md
- [x] 2.1a **`+ Other` built, then REMOVED at Ritesh Bhai's instruction on sight (01-Sep).** It was
      added so the "request a new category" path would not vanish with the dropdown; he removed it
      because **the three categories are the whole vocabulary and a fourth is an admin decision**, not
      something a salesperson invents mid-quotation. Head / ink / machine keep their `onCreate` — those
      lists genuinely grow. ⚠ The capability survives on the **Master Requests** page; only the
      shortcut from this field is gone. Its `onRequested` handler went with the button (orphan rule)
- [x] 2.2 **NEW — the summary sheet stops printing four ruled blanks** under a category that says there
      is no dryer. Optional `noDryerCategory` on `QuotationDocInput`; a half-filled *real* category
      still prints its blanks, which is deliberate
- [x] 3.1 `update fms_ocpi_dryers set name = …` — renamed in place, both categories, no deletes
- [x] 3.2 OCPI.md's removal note rewritten — **the `LIKE '[SAMPLE]%'` statement no longer matches
      anything** and is replaced by a delete-by-name, with the warning that nothing now distinguishes a
      placeholder from a real dryer. *Waiting for* row re-worded
- [x] 4.1 `cd frontend && npm run build` — green
- [x] 4.2 Browser on **K64**: *Indian* → the five fields appeared; filled a dryer name, chambers 4,
      heating Thermic Fluid, included *No*, price ₹1,25,000, plus a separate dryer invoice 3 × ₹40,000.
      Saved → the row held all of it plus `dryer_value_inr` / `dryer_gst_inr` / `dryer_invoice_subtotal`.
      Switched to **Not Applicable and saved** → **every dryer column null except `dryer_type`**,
      shipment columns included. **Gone, not hidden.** Re-opened after a reload: category still shown,
      warning names 3 lines with no dryer, **Generate enabled**. Counterfactual: back to *Indian*
      returned all five fields, the shipment row, and the 4th warning line
- [x] 4.3 QT-M0026's stored 25-Aug paper still prints `Dryer Required | Indian` under the pre-stage-E
      label, served as stored. The **new** NA deal's PDF, read with pdf.js, prints `Dryer Category`
      alone — no chambers, no heating medium, no ruled blanks
- [x] 4.4 The rename is refused on screen; buttons follow the master (a temporary 4th category appeared
      and went). `+ Other` was verified opening the request modal locked to *Dryer type*, then removed
      the same day — see 2.1a. Test data deleted, zero residue

### OCPI-9 · Blank values cannot be filtered for — on the machines master and every other grid  `[x]` — 01-Sep-2026
*Raised 2026-08-31 · Reported by Ritesh Bhai · shipped with **OCPI-6** · **BUILT 01-09-2026**, see
[OCPI.md](OCPI.md) at the foot*

> 🟢 **Done.** Blanks are a first-class filter value in both shared grids, defined once in
> `shared/lib/blankFilter.ts`. On the machines master *Billing name → (Blank)* returns **exactly the
> 6 machines** SQL says have none — by name, not just by count. ⚠ **WORKLIST said seven; it is six**
> (Fab Pro 2I, Fab Pro 3I, JP7, JPK, KoloRado Alpha 3 — 12 heads, Mini Lario).

"Which machines have no billing name?" is unanswerable from the machines master today. There is no
**(Blank)** entry in any filter dropdown, so the rows that are missing a value are the ones you cannot
select for — and they are usually the rows you are looking for, because a blank is a gap to be filled.

**The cause is one line.** `MasterCrud.tsx:244` ends the value extraction with `.filter(Boolean)`, so a
row with no value yields an **empty array**. Two things follow, and the second is worse than the first:

1. The blank contributes nothing to `filterOptions`, so no **(Blank)** option is ever offered.
2. `narrow` matches with `.some(x => want.has(x))` (l.300) — and `.some` on an empty array is always
   `false`. So the moment you pick *any* value in that column, every blank row disappears. They are not
   just unselectable; they are actively excluded.

⚠ **Three of the machines master's columns are affected and one is not, which is the real lesson.**
*Billing name*, *Print heads* and *Model no.* all return `""` for a blank and vanish. *Dryer* does not —
its `filter.get` returns the literal `"Not set"` for null, so it works. One author remembered to handle
the blank case and three did not, which is exactly why **the fix belongs in the shared component, not in
each column**. Left per-column, the next new column will get it wrong again.

**What to build**
- [x] 1 `MasterCrud`'s `colValue` no longer ends `.filter(Boolean)` — a row with nothing left carries a
      `BLANK_VALUE` sentinel, so it offers **(Blank)** and picking it returns exactly those rows.
      `narrow` needed **no change**: `.some` was always false on the empty array, which is what made
      blanks unselectable *and* silently excluded; the sentinel fixes both halves at once.
- [x] 2 **Cascades**, because the options are built from `narrow(searched, header)`, which already
      excludes the column's own filter. Proved: Category → *Other* (4 machines, none blank) makes
      **(Blank) disappear** from Billing name. And picking a normal value no longer drops rows blank in
      a *different* column — two rows with no Model no. survived a Category filter.
- [x] 3 **Pinned last, deliberately**, by `sortFilterOptions`, matching MasterCrud's existing
      "blanks last in BOTH directions" sort rule.
- [x] 4 Same treatment in `QueueTable` (`selectOptions`, `matches`, the dropdown labels and the export's
      About sheet). ⚠ **The note here was half right and the correction matters:** `QueueTable` has **no
      `nodeText` fallback** — a column with no `filter` gets no filter box at all — so only `MasterCrud`
      derives values from rendered text, and only there is an em-dash *invented*. Settled with the
      client: **"" / null / undefined → (Blank) in both components**, an em-dash the component invented
      is stripped, and an em-dash an **author wrote** is left alone (77 sites; on a few it means
      something else entirely — Dispatch's hold column reads "On hold" / "—" where the dash means NOT
      held). Verified outside OCPI on Dispatch → Orders: the authored `—` is still spelled `—`, still
      selects, and returns 58 of 921 orders — matching SQL exactly.
- [x] 5 **Dryer's hand-rolled `"Not set"` dropped**, so all four affected columns on that table read
      **(Blank)**. ⚠ Unobservable on today's data and said plainly rather than claimed: all 28 machines
      carry a dryer answer (`needs_dryer is null` = 0), so that column has no blank to show either way.
      The literal "Not set" is gone from the dropdown, which is what was checked.
- [x] 6 Verified: build green; Billing name → (Blank) cross-checked against SQL **by row name**; the
      cascade proved by making the option disappear; one queue outside OCPI checked. **Audit finding
      folded in:** the sentinel would have silently broken blanks-last sorting on every column with no
      explicit `sortValue` — caught before shipping, fixed, and re-proved in the browser ascending *and*
      descending.

### OCPI-10 · Section B becomes seven pointers plus Others — the four extras move in and stop being gated  `[x]` — 31-Aug-2026
*Raised 2026-08-31 · Asked for by Ritesh Bhai · **sequence AFTER OCPI-7** — same card, same file*

**What is being asked.** *Deal inclusions* (section B) today asks three questions — ink, spare parts,
head. The four **Options included** — *Air blade · External centering system · Ink dust exhauster ·
Chilling system* — live in a different card entirely (*Document details*, `QuotationForm.tsx:1460`,
block at l.1588). Move them into section B, so it reads as **seven pointers**, and add an eighth
free-text **Others** for anything not on the list.

The four are **plain Yes/No capture — nothing follows either answer.** They do *not* get OCPI-7's
"offered at an agreed rate?" branch. Only the original three do.

⚠ **Which means section B will hold seven questions that behave in two different ways.** Three open a
rate follow-up on No; four do nothing. That is what was asked for and it is defensible — a chilling
system is not sold by the litre — but a salesperson will notice it within a day. Worth grouping the
two kinds visually so the difference reads as intentional rather than as a bug.

#### 1 · Show THREE of the four always — the gating goes, except on centering

🔴 **This deliberately reverses OCPI-3 stage E**, and the reversal should be made with the original
reasoning in view. All four *used* to be asked on every deal. The client's own machine sheet then
mapped them per model as **no / optional / yes**, and WORKLIST recorded it as *"A good idea nobody
asked for… Adopted."* `no` means the machine physically cannot carry it, so the question was hidden.
**Only 7 of the 28 machines can carry any extra at all** — so always-on means asking about a chilling
system on 21 machines that cannot have one, and a salesperson answering No to a question that was
never a question. Proceeding as asked; flagging it because it undoes a decision that came from the
client's own sheet, and if the intent is only *"stop hiding them so section B reads consistently"*
there is a middle option: show all four, but grey the ones the machine cannot carry with the reason.

🔴 **THE SERVER WILL SILENTLY DISCARD THE ANSWER. This is the one that makes the feature do nothing.**
`fms_ocpi_write_oc` carries:

```sql
air_blade = case when coalesce(v_air, 'no') = 'no' then null else (p->>'air_blade')::boolean end
```

— and the same for the other three. The capability is read off the **machine**, so on any machine
whose sheet says `no`, the salesperson's answer is nulled on save no matter what the form shows. Ship
the form change alone and the questions appear, accept a click, and lose it on the next save, on most
machines, with no error anywhere. **The RPC clearing must go in the same migration as the form change.**

🔴 **CENTERING IS THE EXCEPTION TO "SHOW ALL FOUR" — settled 31-08-2026.** `optExternalCentering` gates
two things (`types/index.ts:393`, `QuotationForm.tsx:1583-1586`) and **BOTH keep their machine gate.**
Ritesh Bhai's words: the centering system follows the dryer's logic — *if it is backed by the machine,
show it; otherwise do not* — and **both** centering controls are covered by that, not just the shipment
block.

| Pointer | Gated by | Appears on |
|---|---|---|
| Air blade | nothing — always shown | all 28 |
| Ink dust exhauster | nothing — always shown | all 28 |
| Chilling system | nothing — always shown | all 28 |
| **External centering — the tick** | **the machine's capability** | **5** — Homer K24, K32, JP7, JPK, K64 |
| **External centering — shipment questions** | **the machine's capability** | **the same 5** |

✅ **This settles the parked question in *To discuss* — "whether the two centering questions should hide
together". They DO. They always did, and they stay that way.**

⚠ So section B holds **seven pointers on most deals and six on the other 23 machines**, because the
centering row is absent there. That is the intended behaviour, not a rendering fault — do not "fix" it
by always rendering the row.

⚠ **The centering work is therefore NO CHANGE at all.** Nothing about centering is being ungated,
moved or rewired beyond relocating the tick into section B with the other three. `branching.ts`'s
`externalCentering` rule and the RPC's `external_centering` clearing both stay exactly as they are —
only the air blade, ink dust exhauster and chilling system lose their gates.

⚠ **Three machines are gated by a DATA GAP, not a decision.** `opt_external_centering` is **blank** on
Fab Pro 1I, 2I and 3I — the client's sheet was empty on those rows from the extras column onward — and
blank is read as "no". So they are hidden because nobody answered, not because the machine cannot carry
one. The same three are blank for air blade, ink dust exhauster and chilling system. Worth confirming
with Bushra rather than baking the gap in, since the shipment block now depends on this column alone.

⚠ **Decide what the machine master's four columns are FOR afterwards.** `optAirBlade`,
`optExternalCentering`, `optInkDustExhauster`, `optChillingSystem` are edited on the Machines master
and would no longer hide anything. Either they keep driving the *"standard on this machine"* hint —
which is worth keeping — or they become a master field that does nothing, which is how a screen starts
lying. Do not leave that undecided.

⚠ **The hint must NOT become a pre-selected answer.** `standardHint` (l.99) shows *"standard on this
machine"* for `yes` and deliberately does not tick the box; the comment above it says why —
*"Answering it for them would put a value on the deal nobody entered."* That reasoning survives this
change intact.

⚠ **Moving a block leaves the old one.** After the move, grep all four field names and **count the
renders** — the repo has been bitten by exactly this before. `anyExtra` (l.467) exists only to hide the
whole block and becomes an orphan once nothing is hidden; `show("airBlade")` and the four rules at
`branching.ts:215` likewise. `noUnusedLocals` is **false**, so none of this fails the build. Run the
orphan sweep from CLAUDE.md over `apps/ocpi` afterwards.

#### 2 · The "Others" free-text box

🟢 **`otherCommitments` is NOT in the way — it is a retired field with no input.** It exists on the deal
and still prints (`quotationPdf.ts:209-210`), but `QuotationForm.tsx:1397-1421` renders it **read-only
and labelled "retired"**, and only on old deals that already carry a value; a new quotation shows
nothing at all. There is no box to type it into and has not been for some time. So the new Others is
not competing with it, and reusing that column would mean un-retiring a field the module deliberately
withdrew. **Add a new field.**

⚠ **The real overlap is with `remarks` — *Special remarks*, section D — which IS live.** It is the field
`otherCommitments` was retired *in favour of*: the retirement notice on screen reads *"to change any of
it, write the new wording into Special remarks above."* So the module has already decided once that
free text about a deal belongs in Special remarks, and this adds a second box in section B that means
something adjacent. That is defensible — *what else is included in the deal* is a narrower question than
*anything else about this deal* — but the labels have to make the split obvious, or salespeople will use
whichever box their eye lands on first and the two will drift into meaning the same thing. Decide the
wording deliberately, and consider a hint on each pointing at the other.

- [x] Does Others take the OCPI-7 rate follow-up? Reading the ask as **no** — it is a note, not a
      priced line — but say so, since the three above it will have one.

#### Sequencing

🔴 **Do not run this alongside OCPI-7.** Both rewrite the same card in the same file
(`QuotationForm.tsx`, *Deal inclusions*), both add columns to the same table, and both touch the same
two write RPCs. Land OCPI-7 first, verify it, then start this. Two sessions in section B at once will
collide, and the RPC is the kind of file where a collision is resolved by silently restoring an older
body over newer work.

> 🟢 **OCPI-7 LANDED 31-08-2026 — this is now clear to start.** Three things it leaves you:
> **(1)** `fms_ocpi_write_quotation`'s live body is now migration
> `20261024120000_fms_ocpi_a_no_may_still_carry_a_rate.sql`, **not** `20261021140000`. Base anything on
> the body you pull from the database, and note that the live body was *already* found to differ from
> the newest file before OCPI-7 touched it. **(2)** OCPI-7 changed **one** RPC, not two — Section B is
> part A. Your dryer columns are part **B**, so yours is `fms_ocpi_write_oc`, which OCPI-7 deliberately
> did not touch. **(3)** Section B's card now holds two `RateOffer` blocks between the inclusion rows;
> `QuotationForm.tsx` line numbers have moved.

#### Phase-wise checklist

- [x] 0.1 Settle the four questions below
- [x] 1.1 Move all four `YesNo` blocks from *Document details* into *Deal inclusions*; delete the old
      block and prove nothing else rendered them. The centering one moves too — it just keeps its gate
- [x] 1.2 Drop the capability gating for **air blade, ink dust exhauster and chilling system** only
      (`branching.ts:215`). ⚠ **Leave the `externalCentering` rule untouched.** `anyExtra` (l.467) can no
      longer hide the block, but centering still needs `show("externalCentering")` on its own row —
      re-check what is genuinely orphaned rather than deleting all four gates together
- [x] 1.3 Keep `standardHint` — hint only, never a default answer
- [x] 2.1 The Others field — new, not the retired `otherCommitments` — plus its six `fieldSpec.ts`
      touch-points
- [x] 3.1 **Migration in step with the form**: remove the `case when … = 'no' then null` clearing for
      `air_blade`, `ink_dust_exhauster` and `chilling_system` in both write RPCs, from the LIVE bodies.
      ⚠ **`external_centering` keeps its clearing** — it is still a gated field
- [x] 3.2 Centering — **no change of any kind.** Both its tick and its shipment questions keep the
      machine gate. ⚠ Do not "tidy" centering into matching the other three; the difference is deliberate
- [x] 4.1 `cd frontend && npm run build`
- [x] 4.2 🔴 **The persistence test, on a machine whose sheet says `no` for an extra** (21 of 28 qualify):
      answer all four, save, re-open, and **read the row in SQL**. All four answers must still be there.
      This is the test that catches the clearing trap, and no other test does
- [x] 4.3 `ocPdf.ts:119` prints an extra only when true, so a No prints nothing — confirm that is still
      wanted now that No is a deliberate answer rather than a hidden question
- [x] 4.4 An older deal, saved while the gating existed, still opens and still prints

#### Built — 31-Aug-2026

Migration `20261025120000_fms_ocpi_extras_stop_being_gated.sql` (applied, 7 machine checks pass) plus
seven frontend files. Full write-up in **OCPI.md**. Three corrections to what this entry assumed:

1. **"Both write RPCs" was one.** Only `fms_ocpi_write_oc` carried the clearing. `fms_ocpi_save_draft`
   names the four in its part-B **key-sniff array**, not a clearing — it needed the new
   `other_inclusions` key added, which is a different job.
2. **`v_centering` had to survive.** `v_air`/`v_exhauster`/`v_chilling` were read only on the three
   gate lines, but `v_centering` is read **six** times — the tick plus the five centering shipment
   clearings this entry says not to touch. Removing all four would have broken that block silently.
3. 🔴 **The quotation paper was not in scope and had to be.** `quotationPdf.ts` prints a boxed
   *B. Deal Inclusions* — with **No as well as Yes** — and the four extras appeared on **no** quotation
   at all, only on the order confirmation and only when true. Left alone, section B would have asked
   seven questions and printed three. Ritesh Bhai, 31-Aug: print all seven on the quotation, Yes and
   No; keep the OC as it is (a Yes adds a bullet, a No prints nothing); Other inclusions on both.

Settled with the client the same day: label is **"Other inclusions"**; always-on rather than
grey-with-reason; the machine master's four columns keep the hint on all four and the gate on
centering alone, and the Machines master hints were reworded to say exactly that.

⚠ **Still open — the only thing this did not settle:** Fab Pro 1I / 2I / 3I are **blank** for all four
extras and blank reads as "no", so their centering shipment block can never appear. A data gap, not a
decision. *(For Bushra.)*

#### Questions
- [x] **Grey-with-reason, or genuinely always-on?** Showing all four but marking the ones the machine
      cannot carry keeps section B consistent without asking anyone to answer an impossible question.
- [x] **How does Others differ from *Special remarks*?** Settled that it is a NEW field (the old
      `otherCommitments` is retired with no input). But Special remarks is live and adjacent, so the two
      labels have to draw a line a salesperson in a hurry will actually see.
- [ ] **Are Fab Pro 1I / 2I / 3I really "no" for all four extras, or just unanswered on the sheet?**
      They are blank, and blank is read as no — so the centering shipment block will never appear on
      them. A data gap, not a decision. *(For Bushra.)*
- [x] **Should the four print on the documents when the answer is No?** Today only the Yeses print.

### OCPI-11 · Shipment & invoice becomes a table, gains an Ink row, and calculates a sub-total  `[x]` — built, verified and DEPLOYED 31-Aug-2026
*Raised 2026-08-31 · Asked for by Ritesh Bhai · **sequence LAST** — after OCPI-7 and OCPI-10*

**Live on master as `dfc230a`.** Migration `20261026120000_fms_ocpi_shipment_becomes_a_table.sql`
applied to `icutjkrqkbzwvmnfbzpr` before the frontend shipped, so the database was ahead throughout.
Ten new columns, ten assertions, Vercel deploy green.

**What is being asked.** *Shipment & invoice* today stacks each item as its own box, one under another
(`QuotationForm.tsx:1180-1270`, four `ShipmentRow` callers). Three changes:

1. **Add Ink**, and make sure **Head** is there — ordered Head, … Dryer, … Centering device.
2. **Lay it out as a table** — items down the left, the questions across the top — instead of stacked boxes.
3. **Auto-calculate a sub-total** from quantity × amount, as OCPI-7 does in section B.

Target shape:

| | How it ships | Ship via | Separate invoice | Qty | Amount | Sub-total |
|---|---|---|---|---|---|---|
| Print head | | | | | | *(calculated)* |
| Ink | | | | | | |
| Dryer | | | | | | |
| Spare parts | | | | | | |
| Centering device | | | | | | |

#### What is actually there today

⚠ **Head is already built — it is hidden, not missing.** `ShipmentRow title="Print head"` exists at
l.1189 and shows when `inclHead === true` (`branching.ts:203`). It was absent on the deal being looked
at because that deal does not include a head. **Ink is the only genuinely new row.**

🔴 **Ink has NO shipment columns at all.** The other four each carry five fields
(`*ShipMode`, `*ShipVia`, `*SeparateInvoice`, `*InvoiceQty`, `*InvoiceAmount`). Ink carries none. So this
is five new nullable columns, five `fieldSpec.ts` touch-points, new branch rules and new RPC handling —
not a layout change. It is the largest single piece of this entry.

#### The traps

🔴 **Every row rule has a twin in the RPC that nulls what the form hides.** The section's own comment
says it: *"Every rule here has its twin in `fms_ocpi_write_oc`, which nulls what it hides on every
save."* Change which rows show without changing the RPC and the answers are silently discarded on save.
Third time this trap appears in one day (OCPI-7, OCPI-10, here) — it is the module's defining hazard.

🔴 **The sub-total must NOT feed `total_inr`.** The section already states the rule: *"AMOUNTS ARE
EXCLUSIVE OF TAX… nothing here is added to `total_inr`, which is derived server-side from the deal value
alone."* A new calculated column sitting in a table is exactly the thing a later "grand total" sweeps
up. Same defence as OCPI-7 — say it in the column comment.

🔴 **After OCPI-7 there will be TWO quantity/amount pairs for ink, and two for the head.** Section B
will ask *quantity and rate* for ink that is **not** included; this section asks *quantity and amount*
for ink that **is** included and separately invoiced. Same words, opposite meaning, both on one form,
now both in grid form with a calculated sub-total. Without clearly different labels a salesperson will
fill the wrong one, and the contract will carry a price for something the deal did not include.
**This is the strongest argument for doing OCPI-7 first and looking at it on screen before laying this
out.**

⚠ **Each row has THREE nested conditions, not one.** Taking the head as the pattern
(`branching.ts:203-206`): the row shows when the deal includes a head; **Ship via** only when the mode
is *separate*; **Qty / Amount** only when *separate invoice* is Yes. In stacked boxes those simply
vanish. In a table they become cells that appear and disappear mid-grid, which reads as broken. Decide
deliberately: greyed and disabled with a reason on hover, or genuinely blank. Do not let it emerge from
the markup.

⚠ **The centering row stays machine-gated** — per OCPI-10, settled today. So the table has **five rows
on 5 machines and four rows on the other 23**. Intended, not a fault.

⚠ **A table inside a form needs `ScrollableTable`**, and per CLAUDE.md any custom dropdown trigger
inside one needs the arrow-key `stopPropagation` guard that `Combobox`/`MultiSelect` carry — or ↓
scrolls the table instead of opening the menu. Six columns of controls on a narrow screen is the real
design risk here; a table that scrolls sideways to reach the Amount field is worse than the boxes it
replaced.

⚠ **`anyShipment` gates the whole card** and `ShipmentRow`'s `why` prop explains each row's condition in
words. Both may be orphaned by this. Per CLAUDE.md's container rule, account for them rather than
deleting the component wholesale — and run the orphan sweep over `apps/ocpi` afterwards.

#### Phase-wise checklist

- [x] 0.1 Answer the three questions below
- [x] 1.1 SQL: five new nullable ink shipment columns; both write RPCs handle them, from the LIVE bodies
      — and a **third** function nobody had listed, `fms_ocpi_save_draft`, whose part-B key array gates
      whether `write_oc` runs at all. Migration `20261026120000_fms_ocpi_shipment_becomes_a_table.sql`,
      applied 31-Aug-2026 with 10 assertions.
- [x] 1.2 `types/index.ts` + the six `fieldSpec.ts` touch-points + `branching.ts` rules for ink
- [x] 2.1 The sub-total — derived in `fms_ocpi_write_oc`, read-only, per row; the form shows the same
      product live as a preview only. **Ten** new columns, not five: five ink shipment + five sub-totals,
      because printing the stored figure is what stops screen and paper disagreeing (OCPI-7's rule).
- [x] 3.1 Rebuilt as a table; every per-row condition intact; cells that do not apply show a greyed dash
      with the reason on hover rather than a blank, which in a grid reads as "nobody filled this in".
      `ScrollableTable` + `table-fixed`.
- [x] 3.2 Row order per 0.1 — Head · Ink · Dryer · Spare parts · Centering device
- [x] 4.1 `cd frontend && npm run build` — clean
- [x] 4.2 Browser: ZZ TEST Suryodaya Prints (Homer K24, head + ink + dryer + spares) — all five rows,
      all three nested conditions toggling, sub-totals recomputing live, blank rather than ₹ 0
- [x] 4.3 🔴 The money guard: 62.35 lakh of sub-totals filled across the grid; deal value 52,00,000,
      GST 9,36,000 and total 61,36,000 all unchanged, before and after the form save
- [x] 4.4 Saved through the form and re-read in SQL — the ink answers persist and the sub-total is the
      server's own product (175 × 4200 = 7,35,000)
- [x] 4.5 An older deal (QT-M0026) still opens and still prints; `ocPdfBlob` regenerates at 245 KB with
      the seven-column table

#### Questions
- [x] **Where do Ink and Spare parts sit in the order?** ANSWERED 31-Aug-2026: **Head · Ink · Dryer ·
      Spare parts · Centering device**, as assumed — ink beside the head it feeds, and the three the
      client named keep their stated sequence.
- [x] **Do all rows now show always, or still only the parts the deal carries?** ANSWERED 31-Aug-2026:
      **only the parts the deal carries**, as assumed. So the table has five rows on the 5
      centering-capable machines and four on the other 23, fewer again without a head or spares — and
      the RPC's clearing stays honest, because no question is asked whose answer it would discard.
- [x] **Does the sub-total print, and where?** ANSWERED 31-Aug-2026: **yes, as a seventh column on the
      OC contract**, printed from the stored column rather than recomputed. The quotation prints no
      shipment section today and does not start. The caption gained a sentence saying the sub-totals are
      not included in the totals above — a rupee column a customer cannot account for reads as an
      unexplained charge.

#### What was found while building it
- 🔴 **A third write function nobody had listed.** `fms_ocpi_save_draft` calls `write_oc` only when the
      payload carries one of ~46 literal key names — its own comment calls this *"the easiest thing in
      this module to miss"*. The five ink keys were added to that array.
- ✅ **Trap 3 is structurally closed, not merely mitigated.** OCPI-7's ink offer fires on
      `inclInk === false` and this row on `inclInk === true`, so the two quantity/amount pairs can never
      be on screen together and no deal can hold both. Labels still differ ("invoice" against
      "subsidized") because a missing-fields list shows the label and nothing else.
- ✅ **Trap 6 was width only.** `ChoiceButtons`, `Combobox` and `ScrollableTable` already carry the
      arrow-key guards between them, so no new keyboard wiring was needed. The two pickers became
      Comboboxes purely to keep the table inside a laptop screen.
- ⚠ **`table-fixed` is load-bearing.** Under auto layout a `<th>` width is only a hint, and because
      `ChoiceButtons` wraps internally its minimum is ONE button — so the Separate-invoice column
      collapsed below ~1400px and every row went from 73px to 138px. A `min-w` on the cell does not fix
      it; fixed layout does.
- 📋 **Existing deals that include ink now show an Ink row with blanks.** Correct, not a regression: the
      question did not exist when they were filled. 17 of the 19 deals on record include ink.

### OCPI-12 · Does everything the salesperson types actually reach the paper? A K64 print audit  `[x]` — audited, reported and torn down 02-Sep-2026
*Raised 2026-09-01 · Asked for by Ritesh Bhai · **do LAST**, after OCPI-5, 6 and 9*

**The question.** A salesperson fills in something over a hundred fields. Two documents come out — the
summary sheet (`quotationPdf.ts`) and the detailed order confirmation (`ocPdf.ts`). Nobody has ever
checked, field by field, that what goes in comes out. Some fields are screen-only **on purpose**; the
audit is to establish which, and to find the ones that are screen-only **by accident**.

🔴 **This is overdue rather than speculative — four features landed in 48 hours, all of them adding
fields to the form**: OCPI-7 (subsidized rates), OCPI-8 (dryer), OCPI-10 (seven pointers + Others),
OCPI-11 (the shipment table with its calculated sub-totals). Every one of them added something a
customer may need to see, and the print path is the least-exercised part of this module.

🔴 **A gap of exactly this kind is already on record and still unfixed.** *High Seas prints no rupee
total* — the form leaves currency on INR, the rate box never shows, and the contract prints blank rupee
figures. That is one bug found by accident. This audit is the systematic version of how it was found.

#### Why K64

Ritesh Bhai's reason — highest-selling, most permutations — is borne out by its configuration. Checked
live 01-09-2026:

| | K64 |
|---|---|
| `has_template` | **true** — 13 spec rows, 13 composition lines, 9 sections, so **BOTH papers print** |
| `needs_dryer` | **true** — the whole dryer card applies, including OCPI-8's new Not Applicable branch |
| `opt_external_centering` | **optional** — one of only **5 of 28** machines where the centering questions appear at all |
| air blade · ink dust exhauster · chilling system | all **yes** — all three carry the *"standard on this machine"* hint |
| `doc_title` | ORDER CONFIRMATION |

No other machine has this many branches live at once. A field that prints correctly on K64 has been
exercised through nearly every conditional in the module.

#### Part 1 · The trace — every field, where it goes

🅿️ **READ OCPI-23 BEFORE STARTING THIS PART.** Ritesh Bhai asked separately for a durable *field →
document* map and then parked it here, because this walk produces exactly that analysis. OCPI-23 holds
the thinking already done — chiefly that **the long form is per-machine**, so "does this field print?"
has a COUNT as its answer (`{{delivery_date}}` is in 21 of 28 machines, `{{consumables_supplier}}` in 12)
and a yes/no map would be actively wrong. **When this part is finished, decide with Ritesh Bhai whether
the output is kept as a maintained map or discarded as working notes, then close OCPI-23 either way.**

Walk `FIELD_LABEL` in `fieldSpec.ts` (it is the module's own list of every question) and classify each:

| Verdict | Meaning |
|---|---|
| **Prints** | reaches `quotationPdf.ts`, `ocPdf.ts`, or both — say which |
| **Screen-only, deliberate** | there is a reason, and the reason is written down somewhere |
| **Screen-only, undocumented** | ← **the finding.** Captured, stored, never printed, and nobody decided that |

⚠ **Do the trace in code, but do NOT conclude from it.** A field can be referenced in `ocPdf.ts` and
still not appear on the page — inside a branch that never fires, in a section the machine has no rows
for, or rendered into a column that overflows. The code trace produces the *checklist*; the rendered
PDFs produce the *verdict*. Same lesson OCPI-4 paid for: **render, don't parse.**

#### Part 2 · The variations — cover every FIELD, not every combination

⚠ **"All permutations" is not achievable and should not be attempted.** Two currencies × two deal types
× three ink states × three head states × spares × four options × three dryer categories × the shipment
grid runs to thousands of documents. **The target is coverage: every field filled, and every branch
taken, in at least one deal.** Roughly six K64 deals will do it. Sketch — refine before building:

1. **Everything included, INR, Others** — ink/spares/head all Yes, all four options Yes, dryer Indian
   and included, no separate invoices. The maximal "nothing is missing" paper.
2. **Nothing included, INR, with subsidized rates** — ink and head both No → both offered at a rate with
   quantity, rate and sub-total. Spares No (a No ends it, per OCPI-7's narrowing).
3. **USD + High Seas** — exercises the FX freeze, the dollar clause, and ⚠ **the known rupee-total bug**.
   Confirm it or close it.
4. **Dryer = Not Applicable** — OCPI-8's new branch. The dryer block must be absent from both papers,
   and no orphaned dryer wording may survive.
5. **The shipment table, fully loaded** — all five rows, separate invoices on each, every quantity /
   amount / sub-total filled. OCPI-11's grid has never been printed at volume.
6. **The long-text deal** — Others, Special remarks and spare-part details all long enough to wrap or
   overflow. Truncation is a silent failure and only a rendered page shows it.

#### The traps

🔴 **CHECK THE OCPI EMAIL SWITCH BEFORE TOUCHING ANYTHING.** FMS module email is live in this portal and
browser-testing a flow has sent real mail before. Confirm OCPI's own switch is off, or six test deals
walking through approval will email real people.

🔴 **THREE REAL deals exist on this module as of 01-09-2026** — AARNAV FASHIONS `QT-M0037` (awaiting
quotation approval) and `QT-M0038` (draft), plus **`QT-M0040` AADESH DIGITAL PRINTS** (draft), which is
new and is NOT in OCPI-4's older "two real deals" count. Re-run the count before any cleanup rather than
trusting this line — the module is in live use now and a fourth may appear. Do not touch them,
do not re-render them, and do not include them in any cleanup statement.

⚠ **Name every test deal `ZZ TEST`**, the module's existing convention, and **tear them down afterwards
— storage before SQL**, in that order, or the generated PDFs are orphaned in the bucket with no row
pointing at them.

⚠ **A quotation's paper is FROZEN per revision.** Re-rendering an old deal does not re-derive it, so an
old deal cannot prove a new field prints. Every one of the six must be a **fresh** deal raised after the
current code is live.

⚠ **Read the PDFs, do not trust the checklist.** The deliverable is a table of findings backed by the
rendered pages, plus the six PDFs kept somewhere Ritesh Bhai can open them.

#### Phase-wise checklist — DONE 02-09-2026

- [x] 0.1 OCPI email switch confirmed **off** (`ocpi.enabled = false`, unchanged since 22-Aug-2026), and
      still off afterwards. Nothing to restore
- [x] 0.2 Baseline **28 deals**, every id recorded before a single row was written. A 28th appeared
      mid-audit — a live draft by another user — and was left alone
- [x] 1.1 The trace, **generated rather than written**: `frontend/scripts/ocpi-field-map.mjs` →
      `OCPI-FIELD-MAP.md`, `npm run field-map`. 103 fields, **18 reaching no document**, 8 live tokens,
      denominator **21**. This is also OCPI-23's deliverable
- [x] 2.1 Five variations agreed with Ritesh Bhai before anything was raised — including the fifth, on
      **Kolorado Alpha 15**, because K64's template does not use `{{consumables_supplier}}` and OCPI-19's
      line could not otherwise be seen on any page
- [x] 2.2 Five `ZZ TEST` deals raised — deal 1 **filled field by field through the real form**, deal 3
      driven through the Deal type control, the rest seeded through the module's own
      `payloadFromDraft(clearHidden(...))` → `saveDraft` path
- [x] 3.1 **All ten PDFs read with pdf.js**, every extraction control-checked. Reconciled against the map
- [x] 3.2 OCPI-7, 8, 10, 11, 18, 19 and 20 all verified on rendered pages — see OCPI.md
- [x] 3.3 🔴 **The High Seas rupee-total bug is CLOSED.** Picking High Seas flips the currency to USD, the
      rate box appears, and **Generate stays disabled** — *"Still needed: USD to INR rate"* — so the
      blank-figure contract can no longer be produced at all
- [x] 4.1 Findings in OCPI.md; ten PDFs + `README.md` in `Misc/Bushra Reports/OCPI/print-audit/`, written
      to disk **at render time** so the teardown could not take them
- [x] 4.2 Raised as **OCPI-31** (a no-dryer contract still sells a dryer), **OCPI-32** (the dryer warranty
      is silently lost), **OCPI-33** (the forex clause on rupee contracts) and **OCPI-34** (five
      screen-only questions needing a decision). **Nothing was fixed during the audit**
- [x] 4.3 Torn down — storage first (12 objects), then the rows, then the orphaned activity and
      notification rows that carry no FK. Verified back to **28 deals, the baseline set exactly**

#### What the audit had to change about its own brief
- 🔴 **The approved pair could not be captured.** The sole owner of `quotation_approval` is Ritesh, and
  self-approval is refused by BOTH the panel and the SQL. These are the **quotation-stage** papers —
  same renderers, same resolved sections, same frozen revision, differing only in the title bar and the
  absent OC number. Auditing the approved pair needs a second account
- ⚠ **Centering is category-gated now** (11 Direct machines), not `opt_external_centering` (5) — OCPI-14
  moved it. And the token denominator is **21**, not 28: seven active machines have no template at all
- ⚠ **Counters burned, by decision:** quotation 46 → 52. `oc:2627` untouched, since nothing was approved

#### Questions
- [x] **Do you want the five variations agreed with you first?** ANSWERED 02-09-2026: yes, agreed before
      raising, and the agreement is what caught that K64 cannot show OCPI-19's consumables line
✅ **Where the PDFs go — settled 01-09-2026: a folder on disk**, `Misc/Bushra Reports/OCPI/print-audit/`,
beside the machine decks this module was built from. Ritesh Bhai opens them there whenever he likes, and
they survive the test-deal teardown — which the storage bucket does not, since deleting the deals takes
their papers with them.

🔴 **`Misc/` IS GITIGNORED** (`.gitignore:65`). So the files are **local to the machine that runs this
audit** and will never be committed or pushed. Two consequences the executing session must respect:
- **Run this audit locally, not in a cloud session.** A cloud sandbox would write twelve PDFs into a
  folder that is thrown away when the session ends, and Ritesh Bhai would see nothing.
- Do not "fix" the gitignore to commit them. Twelve rendered PDFs do not belong in the repository; the
  folder being untracked is correct, it just dictates where the work is done.

Name them so the variation is readable without opening the file — e.g.
`K64-2-nothing-included-subsidized-rates-summary.pdf` / `…-oc.pdf`, one pair per variation, plus a short
`README.md` in the folder saying what each one was testing.
---

### OCPI-13 · The Salesperson list comes from the users, not from what somebody typed last  `[x]` — built, browser-verified and DEPLOYED 01-Sep-2026
*Raised 2026-09-01 · Asked for by Yash Agarwal · shipped the same day*

**The question, asked of a screenshot:** the Salesperson box on the quotation form offered exactly two
names — `Afrin Saiyed` and `Yash Agarwal`. Where were they coming from?

**Nowhere but the deals themselves.** `QuotationForm.tsx` built the list by scanning `s.deals` for
distinct `salesperson_name` values. There was no master, no `profiles` read and no Tally list: the
vocabulary was whatever had been typed before, and both names were seeded test data. Three things
followed, all of them live:

- **The list was RLS-scoped.** `fms_ocpi_deals` select is limited to admins, coordinators, module
  viewers, step owners and `raised_by = auth.uid()`, so a plain salesperson opening the form saw a
  list of roughly their own name.
- 🔴 **The prefill put the WRONG PERSON on a customer's quotation.** `useQuotationDraft` seeded the
  box from `profiles.receivables_salespersons` — the Outstanding Dashboard's **visibility scope**, not
  an identity (the same trap RC-5 records). Ten users carry exactly one tag, so it fired for all ten:
  UMESHKUMAR SOLANKI was prefilled as **`UMESH JI`**, KHURSHID ALAM as `KHURSHID JI`, and VIJAY of
  collections as **`NAKUL JI`** — a different person, because Vijay's one tag is Nakul's book. That
  string prints at the head of the customer's copy (`quotationPdf.ts:496`).
- **"My deals" could never match.** It tested `tags.has(d.salespersonName)` — Tally strings
  (`UMESH JI`) against portal names (`Yash Agarwal`). Two vocabularies that never met, so the screen
  was empty for everyone whose deals they had not personally raised.

**Also deleted: a column comment describing a design that was never built.** `salesperson_name` claimed
it was *"Sourced from ext_ledger_tags via fetchSalespersonNames()"*. That function is imported nowhere
in `apps/ocpi`.

#### What shipped

**The roster is the user directory, filtered on one condition — `department = Sales`** (13 people),
grouped by sub-department with designation beneath each name, then the names already on deals under a
**Not a portal user** heading. Free text stays: a name can still be typed, and says so under the field.

Which departments count is **config, not code** — `fms_ocpi_config.salesperson_departments`, seeded to
Sales and editable in **Setup › Salespeople**, so an admin can widen it (Management, where both
Directors carry a book) without a deploy. Empty offers nobody, deliberately: falling back to "everyone"
would put all 63 users, warehouse included, on a customer's quotation.

The deal now stores **`salesperson_user_id` beside the name**. The name is still what prints and what
all ten read sites filter on; the id answers *whose deal is it*. It is nullable — null means "typed" —
and is deliberately NOT in `fms_ocpi_complete_when_submitted`, which still asks for the name alone.

#### Four things this ran into that are worth keeping

- **`profiles` is RLS'd to self + downline + same department**, so a client-side read shows a Sales
  roster only to somebody already in Sales — and the two non-admins holding OCPI access are in
  Accounting & Finance and Administration. Both would have seen **nobody**. New definer function
  **`list_org_people_detail()`**, additive beside `list_org_people` rather than widening it (that one
  has four consumers and adding an OUT column needs drop+create). Verified as Riya: 13 rows.
- ⚠ **The picker is keyed on the NAME, not the user id.** `Combobox` renders its trigger as
  `options.find(o => o.value === value)?.label ?? placeholder`, so a value with no matching option makes
  a filled field look **empty** — which keying on the id would have done to all 19 existing deals and to
  every render before the roster query resolves. Same hazard `masterOpts` exists for.
- ⚠ **`fms_ocpi_write_quotation` had to be re-issued, and the live body is `20261024120000` (OCPI-7)** —
  not the `20261019120100` several file headers still point at. Dumped from `pg_get_functiondef`, one
  line added, then **checksum-proved**: stripping the five new lines from the new definition reproduces
  the old md5 exactly (`5bdfd997…`), so OCPI-7's six inverted guards are untouched. Worth copying as a
  method the next time this function is edited.
- `salesperson_user_id` joins `customer_id` / `company_id` / `location_id` in **`revisionDiff`'s skip
  list**. It can change on its own — when a typed name is later picked from the roster — and would
  otherwise report a change to a deal that did not change.

#### Verified

Migration applied first, then the frontend. `npm run build` green. In the browser, OCPI email confirmed
**off** before starting: picked UMESHKUMAR SOLANKI → row stored his name *and* his user id, with
`raised_by` correctly someone else; typed a non-user over it → id cleared to null, note shown; reopened
a pre-change deal → reads `Afrin Saiyed`, **not blank**. Test draft deleted.

- [ ] **"My deals" is not proven end to end.** The id arm is in and type-checks, but exercising it needs
      a *submitted* deal, which burns a number off a series nobody has confirmed. Check on the first
      real submission.
- [ ] **Notifications still key on `raised_by`, not the salesperson.** When a coordinator raises a deal
      for a rep, the rep is not told about decisions on it. `salesperson_user_id` is what makes this
      fixable; it was deliberately not changed here.
- [ ] Eleven `StepOwnersSection.tsx` copies filter `useDirectory().profiles` by department — the
      RLS-scoped read, so a non-admin sees a short list there for the same reason this entry exists.
      `list_org_people_detail()` is what would fix them.

### OCPI-14 · The machine TYPE decides what is asked, not the machine  `[x]`
*Raised 2026-09-01 · Asked for by Ritesh Bhai · **CLOSED 03-09-2026 — shipped.** Verified in the
code, not from notes: **72 `OCPI-14` markers** across the module. `branching.ts` RULE 8 states it
outright — *"THERE IS NO CONNECTION TO THE DEAL INCLUSIONS ANY MORE"* — and the other asks are all
there too: the centering device as a deal inclusion in its own right (`QuotationForm.tsx`), per-model
warranties (`ocpiMachineWrites.ts`), and category-driven branching (`ocpiFetch.ts`). · plan:
`right-now-the-shipment-eventual-stallman.md`*

**What is being asked.** Three things the form decides today from the wrong place:

1. **Shipment & invoice is wired to Deal inclusions.** Head / Ink / Spare parts rows appear only when
   the deal *includes* that item (`branching.ts` RULE 8). There should be **no connection** — how a
   thing ships and whether it is billed on its own is not the same question as whether it sits inside
   the machine price.
2. **A per-machine tick decides the Dryer and the Centering device**, so nothing appears until an
   actual machine row is picked. It must react to the **machine category** alone.
3. **The centering device is not a deal inclusion at all** — only a bare tick in *Also included*. It
   becomes a full question, shaped like spare parts.

The rule: **Direct → all five** (ink · spare parts · head · dryer · centering device).
**Sublimation / Other / POD → three** (ink · spare parts · head).

Plus: the **dryer price** question goes (all pricing is already asked in Shipment & invoice); a
**two-option print head** becomes the salesperson's choice; and **warranty** moves from one global
setting to three per-machine values.

**The source of truth is a new sheet** — `Misc/Bushra Reports/OCPI/OCPI Machine Templates - 01-09.xlsx`,
28 machines, column G = type of head, M–P = the four extras, Q/R/S/T = the warranties.

#### The sheet disagrees with the live master, and one of those disagreements is load-bearing

| | Sheet | Database (checked 01-Sep-2026) |
|---|---|---|
| **Position Printer** | **Direct** | **Other** — the ONE machine that breaks the category rule |
| Label Printer, Book Printer | **POD** — a 4th type | no category at all |
| MP5000 | present · Direct · EX600 | absent; **JP7** is present and absent from the sheet |
| Mini Lario, Rocket — centering | OPTIONAL | `no` |
| Fab Pro 1I / 2I / 3I — centering | No | **blank** — the data gap logged under OCPI-10 |
| Type of head | 7 machines read **"EX600 or RC"** | names unrecognisable (`Homer`, `KATANA 600 DPI - HANGLORY`) |
| Warranty | machine / head / dryer, **per machine**; head is **NA on 15 of 28 models**, 10 of them sublimation | one global `warranty_periods` `{machine 12, head 18}` for everybody |

🟢 **The sheet is what makes the rule true.** With Position Printer moved to Direct,
`needs_dryer = true` ⟺ *category is Direct* holds for **all 28 machines**. It does not hold today —
which is why the master refresh has to land BEFORE anything branches on the category, not after.

🔴 **`opt_external_centering` is currently `no` on Mini Lario and Rocket and BLANK on the three Fab
Pros.** Under the new rule all five show the centering questions anyway, because the category decides.
Three of those blanks were already recorded as *"a data gap, not a decision"* (OCPI-10).

#### The traps

🔴 **The machine category is UI state that is never stored.** `QuotationForm.tsx:549` is a `useState`
filter with a comment at `:885` saying it is deliberately NOT on the draft and NOT on the deal. The
write RPCs null every column the form hides on **every save** and can only see the row — so branching
on a value the server cannot see means the server erases answers the form is still showing. **This is
why the change is not a one-line edit:** `fms_ocpi_deals.machine_category_id` has to exist first.

🔴 **Never match the literal name "Direct".** OCPI-8 paid for this with `dryer_type` = `"Not
Applicable"`. Three marker flags on `fms_ocpi_machine_categories` instead — `shows_dryer`,
`shows_centering`, `shows_extras` — the same shape as `means_no_dryer`.

🔴 **The three extras were deliberately UNGATED four days ago** (OCPI-10, 31-Aug) and are being
re-gated now. Their clearing was removed **by name** in
`20261025120000_fms_ocpi_extras_stop_being_gated.sql`; it has to come back — and this time defaulting
to **`false`, not `null`**, because the client asked for a definite No. `clearHidden` blanks hidden
booleans to `null`, so that needs an explicit exception on both sides or the two disagree on save.

🔴 **The migrations carry `do $check$` assertions that grep the function body.** `20261026120000` and
`20261027120000` assert exact substrings and counts — *"expected 7 `coalesce(v_centering` guards"*.
Re-gating changes those counts and the migration fails on apply unless they are re-derived.

⚠ **Base the new RPC bodies on the LIVE definitions**, pulled with `pg_get_functiondef`. They have been
redefined six times and the files diverge from the database.

⚠ **Do NOT add a conjunct to `fms_ocpi_complete_when_submitted`.** A CHECK is re-validated on every
UPDATE, so requiring `incl_centering` would make all 20 existing deals un-updatable and every approval
or signature stamp on them would throw. OCPI-7 hit this and rejected it. The form carries the
requirement; the constraint does not.

🟢 **Removing the dryer price needs NO SQL.** Once the form stops sending the key, `p->>'dryer_price'`
is null and `grand_total_inr` collapses to `total_inr` through guards that already exist. Verified
safe four ways: **0 of 20** deals carry a `dryer_price`, **0** answer *dryer not included*,
`grand_total_inr` = `total_inr` on all 4 deals that have one, and **no machine template body references
`{{dryer_price}}`** — so this is not the OCPI-3 section F trap that would leave a ruled blank in a
signed contract.

#### Phase-wise checklist

**Phase 0 · Freeze the ground — nothing is changed yet**
- [x] 0.1 Capture the **live** bodies of `fms_ocpi_write_quotation`, `write_oc` and `save_draft`. Every
      later phase bases its `create or replace` on this capture. Also the rollback artefact
- [x] 0.2 Snapshot `fms_ocpi_machines`, `_machine_categories`, `_head_types`, `_machine_head_types` as
      replayable statements — the master refresh is the only part of this work that is not additive
- [x] 0.3 The full 28-row sheet-vs-database diff, written down, so the refresh can be audited
- [x] 0.4 **Rehearse the rollback.** A rollback that has only been read is not a rollback

**Phase 1 · Schema — additive only, nothing reads it**
- [x] 1.1 Nine nullable columns: `fms_ocpi_deals` (`machine_category_id`, `incl_centering`,
      `centering_details`) · `_machine_categories` (three `shows_*` flags) · `_machines` (three
      warranties). ⚠ `fms_ocpi_complete_when_submitted` untouched
- [x] 1.2 `warranty_note` into `fms_ocpi_config`

**Phase 2 · Master data — fills the new columns, still nothing reads them**
- [x] 2.1 POD category; the three flags on all four categories
- [x] 2.2 Position Printer → Direct; Label + Book Printer → POD; **JP7 renamed MP5000**
- [x] 2.3 `needs_dryer` / the four `opt_*` corrected; head types re-mapped from column G; warranties
      written; billing names filled
- [x] 2.4 **Back-fill `machine_category_id` on all 20 existing deals** — this is what lets Phase 3
      carry ONE rule instead of a permanent old-deal shim
- [x] 2.5 ✅ **Checkpoint: prove `needs_dryer = true` ⟺ Direct for all 28** before anything reads it.
      If it does not hold, Phase 3 is not safe to apply

**Phase 3 · The RPCs — the server switches to the category**
- [x] 3.1 `write_quotation` gains the three deal columns + category-driven clearing; `write_oc`
      re-points its dryer and centering gates and re-gates the three extras with `else false`;
      ⚠ `fms_ocpi_save_draft`'s ~53-key sniff array gains the two new part-B keys
- [x] 3.2 The `do $check$` assertions re-derived, or the migration fails on apply
- [ ] 3.3 ⚠ The old-form/new-server window: dryer is identical, centering is strictly wider, only the
      extras differ. Apply immediately before the Phase 4 deploy, not the day before

**Phase 4 · Frontend, in dependency order**
- [x] 4.1 `machineCategoryId` becomes a draft field; `chooseMachine` snaps the category
- [x] 4.2 `branching.ts` — RULE 7 and RULE 8 onto the flags; the `false`-not-`null` exception
- [x] 4.3 `fieldSpec.ts` all six touch-points (⚠ `FIELD_LABEL` **position** is the revision-diff row
      order) + `types/index.ts` + `ocpiFetch.ts` (⚠ `r` is `any` — a missed column is silently null)
- [x] 4.4 Section B: centering in, the *External centering* tick out. ⚠ Container removal — account for
      its rule, its RPC clearing, its printed line and its PDF bullet one at a time
- [x] 4.5 Shipment table re-gated + the subsidized-rate carry-over. ⚠ `anyShipment` becomes a gate that
      can never close; all five `why` strings start describing the wrong rule
- [x] 4.6 Dryer price out — form, rule, draft/payload keys, register column, token. No SQL
- [x] 4.7 Head `ChoiceButtons` where ≥2 are mapped, plus the read-out for a legacy value that matches
      no button. ⚠ A second deliberate exception to `ChoiceButtons`' "never a master list" rule
- [x] 4.8 Three warranties, hidden on NULL, prefilled from the machine, plus the `warranty_note` line
- [x] 4.9 Machines master (warranty fields, `needs_dryer` no longer required, hints reworded to say the
      `opt_*` ticks no longer gate anything) and the category flags on Masters
- [x] 4.10 Orphan sweep over `apps/ocpi`

**Phase 5 · Documents and exports**
- [x] 5.1 `quotationPdf.ts` — ⚠ `showsDryer` at `:296` reads `machine?.needsDryer` and must move
- [x] 5.2 `ocPdf.ts` — bullets, shipment lines, the money block, warranty + note
- [x] 5.3 `exportRegister.ts` — drop *Dryer price*; add centering and the three warranties
- [x] 5.4 `tokens.ts` — drop `dryer_price`; add the warranty tokens

**Phase 6 · Verify**
- [x] 6.1 `cd frontend && npm run build`
- [x] 6.2 **The switch-back test in SQL against the live writer** — Direct filled, switch to
      Sublimation, confirm the server cleared **exactly** what the form hid, stored the extras as
      `false`, and left head / ink / spares shipment answers untouched. Then switch back
- [x] 6.3 The money guard — `total_inr` and friends byte-identical
- [x] 6.4 **React to the category alone** — pick *Direct* with NO machine selected and confirm
      everything appears. This is the request in one test
- [x] 6.5 Browser on K64 (Direct, 2 heads), P8S (Sublimation, 2 heads), Pengda (Other, no heads)
- [x] 6.6 The carry-over fills, and never overwrites a typed value
- [x] 6.7 An older deal still opens and prints; a legacy `head_type` shows as a read-out, not blank
- [x] 6.8 Read the PDFs with **pdf.js**, never by string-searching jsPDF output
- [x] 6.9 Test data deleted, versions first, zero residue

#### Phase 6a · Two bugs the BROWSER found that nothing else could  `[x]` — 01-Sep-2026

Both survived a green build, a clean `tsc`, and the SQL switch-back test — none of
which look at what the form actually renders.

- [x] 6a.1 🔴 **The Dryer warranty box showed on a Sublimation deal.** `dryerWarranty` had no
      rule in `PART_A_VISIBILITY`, so `isVisible` returned true for it — while
      `fms_ocpi_write_oc` has nulled `dryer_warranty` on `not v_has_dryer` since stage E. Typing a
      value would have had it silently erased on save. The field was OFF the form between OCPI-3
      stage D and OCPI-14, so the rule was never missed until the question came back.
      Fixed: `dryerWarranty: hasDryerDetails`.
- [x] 6a.2 🔴 **Direct showed FOUR shipment rows, not five — reported by Ritesh Bhai on sight.**
      The Dryer row shared `hasDryerDetails`, which waits for a DRYER category to be picked. That
      wait is right for the details (you cannot name a dryer inside no category) and wrong for the
      shipment row (how it travels is answerable the moment the deal is known to carry one).
      ⚠ **I had seen this in testing and wrongly called it correct-by-design.**

      Split into two gates, in BOTH engines — `hasDryerShipment` in `branching.ts` and
      `v_dryer_ships` in `fms_ocpi_write_oc`, migration
      `20261101120000_fms_ocpi_dryer_ships_on_the_category_alone.sql`:

      | State | Dryer row |
      |---|---|
      | Direct, no dryer category yet | **shown** ← the fix |
      | Direct, "Not Applicable" | hidden — OCPI-8 item 1.5 preserved |
      | Direct, Indian / Chinese | shown |
      | Sublimation / Other / POD | hidden |

      ⚠ **The migration TRANSFORMS the live body rather than retyping it** — reads
      `pg_get_functiondef`, asserts each of 8 anchors appears exactly once, substitutes, asserts
      the result. A hand-copied 400-line function is how a body drifts from what is running.
- [x] 6a.3 Proved in SQL on live data: Direct + no dryer category **keeps** all six shipment
      columns (₹12,50,000 sub-total) while still clearing the detail columns; Direct + Not
      Applicable clears both; Sublimation clears both. Test deal deleted, zero residue.
- [x] 6a.4 Re-verified in the browser: Direct alone → five rows; Not Applicable → four; Chinese → five.

#### Phase 6b · Two on-sight corrections from Ritesh Bhai  `[x]` — 01-Sep-2026

- [x] 6b.1 **The "asked because …" line under every Shipment & invoice item is gone.** It
      explained each row's branch in words — useful while the rows appeared and vanished on five
      different conditions, noise now that they follow one rule the salesperson picks themselves
      at the top of the form. Three lines of grey text under every item was burying the names.
      ⚠ Removed the `why` PROP and all five callers, not just the render — and `categoryName`,
      which existed only to word two of those sentences, went with it. A prop nobody renders is
      the orphan this repo keeps writing down as a fault. `RateOffer` keeps its own `why`: it
      explains a whole block that appears conditionally, which is a different job.
- [x] 6b.2 **The three warranties are read-outs, not text boxes.** They were editable for one
      afternoon and should not have been: the warranty is a property of the MODEL, mapped once on
      the Machines master. An editable box invites a salesperson to promise 24 months on a machine
      the company warrants for 12, on a document the customer signs, with nothing downstream to
      question it. ⚠ The VALUE still travels — set by `chooseMachine`, sent in the payload, frozen
      onto the revision — so a deal stays a record of what was quoted. Only the keyboard is gone.
      ⚠ A read-out, NOT a `disabled` input: greyed-out reads as temporarily unavailable and
      somebody will ask why they cannot type in it. The exception route is Special remarks, as it
      was when the warranty was a fixed setting. Admins still edit them on the Machines master.
- [x] 6b.3 Browser-verified: the ITEM column shows five bare names; the warranty card reads
      "Machine warranty · from the machine master · 12 Months" with ZERO editable warranty inputs.

**Phase 7 · Ship**
- [ ] 7.1 Migration applied **before** the frontend goes live
- [ ] 7.2 `OCPI.md` — the second `ChoiceButtons` exception; the `opt_*` columns are now informational
- [ ] 7.3 **Closes open question 7** (*"should both centering questions disappear together?"*) and
      answers **OCPI-5's open 0.1** — the two JAY machines sit in **POD**, so the comparison workbook
      gains a fourth tab
- [ ] 7.4 **OCPI-12 (the K64 print audit) must run AFTER this**, not before — this changes K64's form
      substantially and an audit of the old shape would be wasted

### OCPI-15 · Nothing is mandatory until Send for approval — and then say plainly what is missing  `[x]`
*Raised 2026-09-01 · Asked for by Ritesh Bhai*

**The ask.** A salesperson should be able to work on a quotation without being blocked by unanswered
questions. Completeness should be enforced at **Send for approval** and nowhere earlier — and at that
moment the screen should make it obvious which fields are mandatory and which of them are still empty,
so they can be filled without hunting.

#### First, what is actually blocked today — it is NOT Save

⚠ **`Save draft` already enforces nothing.** `useQuotationDraft.ts`'s `save()` has no completeness check
at all; it writes whatever is on the form. The card on screen even says *"You can save it as a draft in
the meantime."* So the thing being described as "saving the quotation" is almost certainly
**Generate quotation** — the button that produces the actual document. Reading it that way:

| Step | Gated on today | Should be |
|---|---|---|
| Save draft | nothing | nothing — **already correct** |
| **Generate quotation** | **`missingForSubmit(draft).length === 0`** (`QuotationEditor.tsx:43`) — the block | **nothing, or a warning** |
| Send for approval | only that a document exists (`alreadyIssued`) | **the completeness gate moves here** |

So this is one move, not a rewrite: take the gate off Generate and put it on Send for approval.

⚠ **If "saving" really did mean `Save draft`, say so and this entry shrinks to nothing** — that path is
already free. Proceeding on the Generate reading.

#### What that gate is holding back

`missingForSubmit` (`fieldSpec.ts:1023`) requires **~24 things**, including: customer name, salesperson,
machine, how many machines; the three inclusion answers and their follow-ups; OCPI-7's subsidized
quantity and rate; deal type; **currency**; **total deal value**; the USD rate on a dollar deal;
**payment type and terms**; **delivery date**.

🔴 **So the sharp question is whether a quotation may be GENERATED with no deal value, no payment terms
and no delivery date.** Generate produces a **customer-facing PDF**. Today those fields cannot be blank
on it, by design. Move the gate and they can be — and a quotation reaching a customer without a price
is worse than a salesperson being nagged for one.

There is already a two-tier model on this screen that points at the answer:
- `missingForSubmit` — **blocks**. Things a quotation cannot go out without.
- `missingForDetailSheet` — **warns only**, in a yellow card naming exactly which lines will print
  ruled-blank. Its comment says why: *"A WARNING, NEVER A BLOCK. The detail fields are optional on
  purpose — a quotation goes out mid-negotiation, often before the warranty and delivery terms are
  settled."*

**The natural shape of this change is to move most of `missingForSubmit` into that second tier** — warn
loudly at Generate, block only at Send for approval — rather than deleting the concept. Which fields, if
any, stay hard blocks at Generate is the one thing to settle with Ritesh Bhai. My suggestion: keep
**customer name and machine** as hard blocks (a document addressed to nobody, for nothing, is not a
draft of anything) and let everything else warn.

🔴 **THE SERVER ENFORCES THIS TOO, AND IT IS THE SAME PREDICATE.** `fms_ocpi_write_quotation` carries its
own completeness check in SQL — e.g. `incl_ink is not null and (incl_ink is not true or ink_qty_included
is not null)`. Relax the client alone and Generate will be offered, then refused by the database with a
message no salesperson can act on. Client and server move **in the same migration**, and the RPCs have
been redefined many times — pull the LIVE bodies.

#### Part 2 · Make the mandatory fields findable

Today the missing list is a comma-separated sentence in a card at the top of the page
(`QuotationEditor.tsx:156-165`). It names the fields in prose — *"the total deal value, the type of
payment…"* — but it does not say **where** they are, does not link to them, and the form itself gives no
sign which fields are required. On a form of this length that is a hunt.

- [x] 1 **Mark mandatory fields in the form itself.** `FieldLabel` already takes a `required` prop —
      `MasterCrud` uses it. The quotation form largely does not. Wire it from the same rule set that
      `missingForSubmit` uses, so the asterisk and the blocker can never disagree.
- [x] 2 **Make the missing list clickable** — each entry scrolls to and focuses its field. The list
      already knows the fields; today it only knows their prose names.
      ⚠ This needs a field **key** alongside the sentence. `missingForSubmit` returns plain strings
      today (*"the total deal value"*), which cannot be linked to anything. It has to return
      `{ key, label }` — a small refactor, and the one piece of real work in Part 2.
- [x] 3 **Show it at Send for approval**, since that is where the block now lives — as a dialog or an
      inline panel listing what is still needed, not a bare disabled button. A disabled button with no
      reason is the bug being fixed, moved down the page.
- [x] 4 Keep the **existing yellow "will print N blank lines"** warning working alongside it. Two
      different messages — *"cannot send"* and *"will print blank"* — must stay visually distinct or the
      screen contradicts itself, which has happened here before.

#### Phase-wise checklist

**Phase 0 · Settled before a line was written**  `[x]`
- [x] 0.1 Confirmed the reading: it is **Generate**, not Save, that blocks. `useQuotationDraft.save()`
      carries no completeness check at all, and the card on screen already says so.
- [x] 0.2 ~~SETTLED — only the CUSTOMER NAME and the MACHINE still block Generate.~~
      🔴 **SUPERSEDED BY THE USER, 01-09-2026, during planning.** *"The price should definitely be
      compulsory. A quotation cannot be generated without the pricing — otherwise we already have the
      save draft option."* The price therefore **returns to the Generate tier**, and the red
      "this will print with no price" callout has no subject any more. Final tiers:
      · **Blocks Generate** — customer name, salesperson, machine, no. of machines, currency, total
        deal value, and the USD→INR rate on a dollar / high-seas deal (without it the RUPEE total
        prints blank on both papers — the same fault, one indirection away).
      · **Warns at Generate, blocks Send for approval** — type of head, the four inclusion answers and
        their detail boxes, the ink / head subsidized quantity + rate, deal type and its cost-bearer
        follow-ups, terms of payment, tentative delivery date.
- [x] 0.3 🔴 **THE BRIEF WAS WRONG ABOUT WHERE THE SERVER GATE LIVES.** `fms_ocpi_write_quotation` does
      NOT carry a completeness predicate — pulled live with `pg_get_functiondef`, it is a plain
      `UPDATE`. The two real gates are **`fms_ocpi_generate_quotation`** (a six-item list) and the
      CHECK **`fms_ocpi_complete_when_submitted`**, which is written `status = 'draft' OR (…)` and so
      ALREADY enforces nothing while the deal is a draft and everything the moment it is submitted —
      exactly what OCPI-15 asks for. It needs no change, which is just as well.
- [x] 0.4 Live-data check: all 5 USD / high-seas deals of 26 already carry an `fx_rate` (`no_fx = 0` on
      every USD row, every status), so adding that conjunct to Generate blocks nothing that exists.

**Phase 1 · `lib/completeness.ts` — the two tiers get one home**
- [x] 1.1 New module `frontend/src/apps/ocpi/lib/completeness.ts`.
      ⚠ IT CANNOT LIVE IN `fieldSpec.ts`. The rule table must ask `isVisible`, and `branching.ts`
      already imports `isUsdDeal` FROM `fieldSpec.ts` — putting it there is a circular import.
- [x] 1.2 One authored `REQUIREMENTS` table: `{ key, tier, label?, extra? }`.
      ⚠ "Is this field asked?" is answered by **`isVisible`, not a second copy of the rules**.
      `PART_A_VISIBILITY` already carries every gate `missingForSubmit` hand-rolls — checked line by
      line: `inkQtyIncluded`, `spareDetails`, `headsIncluded`, the six `ink/headOffer*` show-on-`false`
      rules, `inclCentering`, `centeringDetails`, `highSeasVia`, `highSeasCostBy`, `localCostBy`,
      `fxRate`. `extra` exists only for what `isVisible` cannot know — `headType`'s head count.
- [x] 1.3 `missingForSubmit(d, deal, headOptions)` returns `MissingField[]` — `{ key, label }` instead
      of prose. ⚠ **KEEPS ITS NAME AND ITS THREE ARGUMENTS**; "submit" IS Send for approval here
      (`submitQuotation` → `fms_ocpi_submit_quotation`) and OCPI-14's head-count rule rides on the
      third argument.
- [x] 1.4 `missingForGenerate(…)` — the `tier: "generate"` subset.
- [x] 1.5 `requiredKeys(…)` — every ASKED key, filled or not. This is what puts the asterisks on the
      form, from the same table, so an asterisk and a blocker cannot disagree.
- [x] 1.6 `FIELD_ANCHOR(key)` and `focusField(key)` — the contract between the panel and the form.
- [x] 1.7 `missingForDetailSheet` moves across too, so the two tiers stay in one file that
      cross-references itself. Its dryer gate is a hand-copy of `hasDryerDetails` and becomes
      `isVisible("dryerName", …)`. ⚠ It stays `string[]` and stays UNCLICKABLE, deliberately: four of
      its entries are ship-mode answers living in `<td>`s inside `ShipmentRow`, not `FieldLabel`s, so
      they have no anchor to jump to — and half a clickable list is worse than none.
- [x] 1.8 Update every comment in `fieldSpec.ts` and `QuotationForm.tsx` that points at the two moved
      functions by name. ⚠ The "moving a block leaves the old one" rule — grep, do not assume.
      ⚠ `FIELD_LABEL` is READ, never edited: its key order is `revisionDiff.ts`'s row order.

**Phase 2 · The gate moves**
- [x] 2.1 `useQuotationDraft` returns BOTH lists — `missing` (approval, name unchanged) and
      `missingToGenerate`. It already holds the draft, the store, `dealFacts(…)` and `s.headsFor(…)`.
- [x] 2.2 `canGenerate = q.missingToGenerate.length === 0`.
- [x] 2.3 **Send for approval stays CLICKABLE** (the user's call — a greyed button answers nothing).
      `onSubmit` **saves first**, then refuses when `q.missing` is non-empty: no RPC call, scroll to
      the panel, flash it.
      🔴 THE SAVE IS NOT OPTIONAL. The client list is computed from the DRAFT and the CHECK reads the
      ROW; without saving first, unsaved edits pass the form and get refused by the database.
- [x] 2.4 Four cards on a deliberate **severity ladder**, because this screen has contradicted itself
      before: neutral = "still needed before a quotation can be generated"; **red** = "the customer
      will see a blank" (`transportTerms` / `paymentTerms` / `deliveryDate` leave four rows blank on
      the customer's own summary sheet — `quotationPdf.ts` :160, :236, :240, :241); orange = "not
      ready to send" with the complete clickable list; **yellow = the existing detail-sheet warning,
      untouched**. The last three are gated on `canGenerate`, as the yellow one already is, so the
      neutral card never stacks with them.

**Phase 3 · Make the mandatory fields findable**
- [x] 3.1 `FieldLabel` gains an optional `anchor` → `<label id={anchor} className="block scroll-mt-24">`.
      Additive; `MasterCrud`'s use of `required` is untouched. 96px clears the sticky 68px `Topbar`.
- [x] 3.2 `.ocpi-field-flash` keyframe in `index.css` — real CSS, not Tailwind classes toggled from a
      `.ts` file, which would depend on the JIT content scanner finding a class literal.
- [x] 3.3 `QuotationForm` computes `requiredKeys(…)` once and passes `required` + `anchor` on ~24
      labels. The seven that say `required` by hand today become driven by it so they cannot drift.
      `YesNo` and `RateOffer` gain the two pass-through props; both already wrap `FieldLabel`.
- [x] 3.4 `CustomerPicker` — anchor on the already-`required` "Customer / party name" label.
- [x] 3.5 `focusField` **falls back to scrolling the form into view when an anchor is absent**, so no
      entry in the list is ever a dead click.
      ⚠ The asterisk means MANDATORY, not "blocks Generate" — a field required only at the approval
      tier still carries one, and the panels say when. Record it, or somebody will "fix" it.

**Phase 4 · Migration** — `20261103120000_fms_ocpi_the_gate_moves_to_send_for_approval.sql`
- [x] 4.1 `fms_ocpi_generate_quotation` — add the fx-rate conjunct to its missing-list array.
- [x] 4.2 `fms_ocpi_submit_quotation` — a completeness pre-check before the `update`, raising
      *"Still needed before this can be sent for approval: …"* with the field names, so a
      client/server disagreement stops being a raw Postgres violation naming nothing.
      ⚠ It **mirrors the CHECK conjunct for conjunct, NEVER stricter** — stricter would refuse what
      the CHECK permits. It stays looser on `head_type` and `incl_centering`, which the CHECK has
      never carried.
- [x] 4.3 ⚠ **BOTH ARE TRANSFORMS OF THE LIVE BODY, NOT RETYPED COPIES** — read `pg_get_functiondef`,
      assert the anchor appears exactly once, substitute, assert the result.
- [x] 4.4 ⚠ **DO NOT TOUCH `fms_ocpi_complete_when_submitted`**, `fms_ocpi_write_quotation` or
      `fms_ocpi_save_draft`. A CHECK is re-validated on every UPDATE, so tightening it makes all 26
      deals on record un-updatable and throws on every approval and signature stamp. OCPI-7 and
      OCPI-14 both hit this and both rejected it.
- [x] 4.5 **Rehearse the rollback on live data** — apply, roll back, confirm both bodies match the
      originals, re-apply. Run it; do not merely write it.
- [x] 4.6 Applied **before** the frontend goes live.

**Phase 5 · Verify**
- [x] 5.1 `cd frontend && npm run build` — no test runner in this repo; the build is the gate.
- [x] 5.2 Audit: every `REQUIREMENTS` key resolves to an anchor that exists in the rendered form.
- [x] 5.3 ⚠ **Check the FMS module email switch BEFORE the browser test** — Send for approval calls
      `fms_ocpi_announce` and OCPI mail is live. Use the `ZZ TEST` deals.
- [x] 5.4 A deal with **customer + machine only**: Generate refused; the card names salesperson, no. of
      machines, currency and total deal value; each name jumps to and focuses its box.
- [x] 5.5 Fill the price only → **Generate produces both papers.** Confirm nothing crashes on null
      `transportTerms`, `paymentTerms`, `deliveryDate`, the inclusion answers or `headType` — the old
      "null deal value" case is unreachable now that the price blocks.
- [x] 5.6 Read the generated PDF with **pdf.js**, not by string-searching jsPDF output.
- [x] 5.7 **Send for approval on that same deal is REFUSED**, names every missing field, and each name
      jumps to its field.
- [x] 5.8 Fill them, send, confirm it goes through — **and that the SQL does not refuse what the form
      allowed.** The client/server agreement test.
- [x] 5.9 Force the disagreement: null `payment_terms` on a draft directly in SQL, submit through the
      UI on stale form state, and confirm the new message NAMES THE FIELD.
- [x] 5.10 An already-issued quotation being **revised** behaves the same way throughout.
- [x] 5.11 An older deal still opens, still prints, and can still be approved and stamped — proof the
      CHECK was not touched.
- [x] 5.12 FIX-4 orphan sweep over `apps/ocpi`; confirm nothing still renders the old prose `q.missing`.

**Phase 6 · Record**
- [x] 6.1 `OCPI.md` — the two tiers; that the server predicate lives in `fms_ocpi_generate_quotation`
      and NOT in `fms_ocpi_write_quotation`; that the CHECK was already status-gated; why
      `completeness.ts` could not live in `fieldSpec.ts`; the asterisk convention; `FIELD_ANCHOR`.
- [x] 6.2 Tick this checklist as each phase lands.
- [x] 6.3 ⚠ Stage only my own hunks — `WORKLIST.md`, `OCPI.md` and `index.css` are shared with other
      sessions and the tree already carries OCPI-18's uncommitted work.

#### Questions
- [x] **What still blocks Generate** — settled, then **changed by the user**: customer name, salesperson,
      machine, machine count, currency, total deal value, and the USD rate on a dollar deal. See 0.2.
- [ ] **Does the approver need to see anything different**, now that a deal can reach them having been
      generated with gaps that were filled later? *(Not asked yet — raise it when the panel is built and
      there is something to look at.)*

### OCPI-16 · Name the steps after what you actually do, and say it in one line when the step opens  `[x]`
*Raised 2026-09-01 · Asked for by Ritesh Bhai · **BUILT AND VERIFIED 02-09-2026***

> ✅ **DONE.** Both steps renamed, the one-liner added and rendered, and `OcpiStepper`'s second
> hardcoded label list deleted — the stages are now derived from `LIVE_STEPS`, so the rail cannot
> drift from the sidebar again. Verified live: sidebar, breadcrumb, queue heading, Control Center,
> Settings → Step Owners and Settings → Due Dates all read the new titles; the rail and the Dashboard
> tiles read the new `short`s; a fresh quotation PDF still prints "Customer Signature". Full write-up
> in [OCPI.md](OCPI.md).
>
> ⚠ **The rail now captions with `short`, not `title`** — decided 02-09-2026 because a rail circle
> truncates to one line and "Upload Customer Signed Copy" does not fit. That also shortened the four
> steps nobody asked to rename ("Approve Quotation" → "Qtn Appr", "Hand Over to Finance" →
> "To Finance") and the two retired ones ("Order Confirmation" → "OC (old)"). Accepted knowingly; the
> full title is shown under the rail instead.
>
> ⚠ **`STATUS_LABEL` was NOT renamed** (`lib/format.ts`) — a deal page still reads *Status: Awaiting
> customer signature* above *Upload Customer Signed Copy*. Both are true and they answer different
> questions (what the deal is waiting on / what our side does about it), so it was left alone rather
> than widened past the settled scope. Same for the two queues' Excel `exportTitle`s, which name the
> rows rather than the step. Raise a new entry if either should follow.

**The ask.** Two steps are named after a *person signing*, when the work is *uploading a copy somebody
has already signed on paper*:

| Step | Reads today | What the person actually does |
|---|---|---|
| `customer_signoff` | **Customer Signature** | upload the copy the **customer** signed |
| `management_signoff` | **Management Signature** | upload the copy **management** signed, and hand the final signed copy to Finance |

Rename them to describe the action, and give every step a **one-liner** shown when it is opened, so
somebody landing on the queue knows what is expected without asking.

#### The real finding — the label already exists in three places and they already disagree

| Where | Customer step | Management step |
|---|---|---|
| `lib/steps.ts` `STEPS.title` — drives the **sidebar** | "Customer Signature" | "Management Signature" |
| `lib/steps.ts` `STEPS.short` — drives the **rail** | "Cust Sign" | "Mgmt Sign" |
| `components/OcpiStepper.tsx:31-33` — a **second hardcoded copy** | "Customer Signature" | "Management Signature" |
| The queue page `<h1>` — a **third, different wording** | *"Out for customer signature"* | *"Countersign order confirmations"* |

So the sidebar, the stepper and the page heading are three separate strings for the same step, and the
page heading is already saying something else. **Rename in one place only and two of the three will
silently keep the old wording.** Fold the stepper's copy into `STEPS` while doing this — one source, or
this drifts again the next time somebody is asked to reword it.

🔴 **`quotationPdf.ts:716` also contains the string "Customer Signature" — DO NOT TOUCH IT.** That is
the **signature block printed on the customer's quotation**, beside "Salesperson Signature" and
"Authorised Signatory". It is not a step name; it only looks like one. A find-and-replace across the
repo would rename the signature line on every quotation that goes out.

#### The wording — SETTLED 01-09-2026, use exactly this

| Step | New name | Short | One-liner |
|---|---|---|---|
| `customer_signoff` | **Upload Customer Signed Copy** | Cust Copy | *"Upload the scanned copy the customer has signed."* |
| `management_signoff` | **Upload Management Signed Copy** | Mgmt Copy | *"Upload the copy signed by management."* |

✅ **STEPS 4 AND 5 STAY SEPARATE.** The management one-liner **stops at the upload** and does NOT mention
Finance. There is already a step 5, *"Hand Over to Finance"*, immediately after it — a one-liner on step
4 describing step 5's work would leave a reader asking why the process has both. Ritesh Bhai chose this
wording knowing that; do not "improve" it by adding the handover back.

✅ **ONLY THESE TWO STEPS GET A ONE-LINER.** Quotation, Approve Quotation, Hand Over to Finance and
Finance Receipt get **none** — their names already say what they are. `blurb` is therefore **optional**
on `STEPS`, and the renderer must simply show nothing when it is absent rather than reserving an empty
line and leaving a gap under four of the six headings.

✅ **Only these two steps are RENAMED.** The other four keep the names they have.

⚠ **`short` has a length constraint** — it sits on the stage rail, where a long label wraps or clips.
"Cust Copy" / "Mgmt Copy" match the width of today's "Cust Sign" / "Mgmt Sign"; do not lengthen them.

#### What to build

- [x] 1 Add an **optional `blurb`** field to `STEPS` in `lib/steps.ts`, set on `customer_signoff` and
      `management_signoff` only. The other four have none, by decision — the renderer must show nothing
      at all when it is absent, not an empty line that leaves a gap under four of the six headings
- [x] 2 Render it wherever a step is opened: the queue page, under the heading, and on the deal page's
      step panel. One place decides the wording; every screen reads it.
- [x] 3 Retitle `customer_signoff` and `management_signoff` per the wording agreed in 0.1
- [x] 4 **Delete `OcpiStepper.tsx`'s hardcoded label list** and read `STEPS` instead. It carried FOUR
      things, not one — labels, order, a synthetic `closed` node with `step: null`, and a `key` used as
      both React key and rail node key. Derived rather than deleted; all four survive.
- [x] 5 Bring the two queue-page `<h1>`s in line, or delete them in favour of the step title — both now
      read `stepByKey(...).title`, and the hand-written sentence under each was replaced by the blurb
- [x] 6 Sweep for anything that MATCHES on the title string rather than the step key. **Zero hits** —
      grepped `title ===` / `.title ==` and all four old literals across `frontend/src`, and all of
      `supabase/`. Every lookup is on `step_key`. The only surviving "Customer Signature" is
      `quotationPdf.ts`'s signature block, untouched.

#### Verify

- [x] `cd frontend && npm run build` — tsc strict + vite, clean
- [x] Sidebar, breadcrumb, queue heading, Control Center, Settings → Step Owners (numbered 1–6) and
      Settings → Due Dates all read the new titles; the rail and the Dashboard tiles read the new
      `short`s. Zero occurrences of the four old strings anywhere on screen.
- [x] The one-liner appears on steps 3 and 4 — and on QT-M0037 (`quotation_approval`) the rail card
      ends at the rail with **no paragraph element at all**, so there is no gap
- [x] 🔴 **Quotation PDF re-rendered fresh via `ApprovedOcPreview` and read back with pdf.js** — still
      prints `Salesperson Signature | Customer Signature | Authorised Signatory`, and no step name
      leaked into it
- [x] QT-M0026 (parked at `customer_signoff`) shows correctly. QT-M0033 (`on_hold`, parked at the same
      step) shows the rail and the hold chip and **no blurb** — a parked deal is not told to go and
      upload something. Control Center and Deal Register both name the step sensibly.
- [ ] ⚠ **The retired-chain rail is unexercised** — no deal in the database has ever travelled it
      (`oca_at` is null on all of them), so the two spliced nodes could not be seen. Their captions
      now come from `STEPS[].short`: *OC (old)* / *OC Appr (old)*, where the old hardcoded list said
      *Order Confirmation* / *Approve OC*.

#### Questions

None open. Every decision was taken on 01-09-2026 and is recorded in *The wording* above: the two names,
the two one-liners, that steps 4 and 5 stay separate, that only these two steps carry a one-liner, and
that only these two are renamed. **This entry is ready to build as written.**

### OCPI-17 · Two small form fixes — the machine category order, and Platter loses "Not Applicable"  `[x]`
*Raised 2026-09-01 · Asked for by Ritesh Bhai, from two screenshots*

#### 1 · Machine category — the order in the dropdown

✅ **SETTLED 01-09-2026: POD moves to the very end.** Confirmed by Ritesh Bhai. Re-space all four to
round numbers so the next insertion has somewhere to go:

| Category | `sort_order` now | → becomes |
|---|---|---|
| Direct | 10 | **10** |
| Sublimation | 20 | **20** |
| Other | 30 | **30** |
| **POD** | 25 *(a half-step — it was inserted between two rows rather than placed)* | **40** |

Resulting dropdown order: **Direct · Sublimation · Other · POD**.

⚠ **POD's `sort_order = 25` is the tell that it was inserted between two existing rows** rather than
placed. Whatever is decided, re-space all four to 10 / 20 / 30 / 40 so the next insertion has somewhere
to go without another half-step.

⚠ **This is master DATA, not code.** The dropdown reads `fms_ocpi_machine_categories` in sort order, so
the fix is an `update` on `sort_order` — no frontend change, and it can be done from the Masters screen
if that screen exposes ordering. Check before writing SQL.

#### 2 · Platter — remove "Not Applicable", keep With and Without

`PLATTER_OPTIONS` (`lib/fieldSpec.ts:552`) is
`["With Platter", "Without Platter", "Not Applicable"]`. Drop the third.

🟢 **Nothing is lost by removing it.** The control is `ChoiceButtons` with `clearable`, so the **×**
already means "no answer" — which is what "Not Applicable" was standing in for. After the change the
field reads With / Without / cleared, which is the same three states with one fewer button.

🔴 **ONE REAL, LIVE DEAL ALREADY HOLDS THIS VALUE.** `QT-M0040` — **AADESH DIGITAL PRINTS**, status
`awaiting_quotation_approval` — has `platter_details = 'Not Applicable'` right now. It is a genuine deal
sitting at an approval gate, not a `ZZ TEST` row. Counts across all deals: With Platter 14 · null 6 ·
**Not Applicable 1**.

So before removing the option:
- [ ] **Do not migrate or blank that row.** Its quotation is frozen and already says what it says;
      rewriting the stored value would put the deal and its issued paper out of step.
- [ ] **Check what `ChoiceButtons` does with a value that is no longer in its options.** It must show
      the deal as-is and must not silently blank it on the next save. If it cannot display an unknown
      value, the deal loses an answer the moment anybody opens and saves it — and that is a live deal at
      an approval gate.
- [ ] Decide what happens if somebody edits QT-M0040: they will have to pick With, Without, or clear.
      That is acceptable, but it should be a known consequence rather than a surprise.

⚠ **Platter is the one field in this section NOBODY ASKED FOR.** The code comment on it says so — it
appears in no pointer and nowhere in the work list, and *"its home is still an open question with the
client"*. It was moved into Machine details because the form and `fms_ocpi_write_oc` disagreed about it,
and partly **because "Not Applicable" was one of its own options**. Removing that option removes one of
the stated reasons it sits where it sits. Not a blocker — but if Platter is ever revisited, that comment
now overstates the case and should be corrected at the same time.

#### Checklist

- [x] 0.1 SETTLED — POD moves to the end; all four re-spaced to 10 / 20 / 30 / 40
- [x] 1.1 Re-space all four categories to 10 / 20 / 30 / 40 in the agreed order — **no SQL and no code
      needed.** The Masters screen already exposes Sort order (`Masters.tsx:160`, on all four tabs), and
      only POD actually moved: the other three were already 10 / 20 / 30. Done through the UI
- [x] 2.1 `PLATTER_OPTIONS` → `["With Platter", "Without Platter"]`
- [x] 2.2 Verify `ChoiceButtons` renders QT-M0040's stored "Not Applicable" without blanking it —
      **it does not blank it, but it did not SHOW it either**, and one arrow key silently replaced it.
      Fixed with `optsWithCurrent` (the fixed-vocabulary twin of the existing `masterOpts`), which feeds
      the deal's own value back in as an option. It now renders as a lit third button, so the value is
      visible AND the arrow-key index is real. No shared component was touched
- [x] 2.3 Correct the Platter comment in `QuotationForm.tsx` — it cites "Not Applicable" as a reason
      the field lives in Machine details
- [x] 3.1 `cd frontend && npm run build`
- [x] 3.2 Browser: the category dropdown reads in the agreed order; Platter shows two buttons and the ×
- [x] 3.3 🔴 Open **QT-M0040**, confirm its Platter answer is still shown and still stored, then leave it
      alone — shown as a lit button with a note; left untouched. ⚠ **Its "Save draft" is refused
      anyway** — `fms_ocpi_save_draft` raises *"already been submitted — use Edit instead"* for any
      non-draft, which is pre-existing. The save round-trip was proved on a `ZZ TEST` draft instead:
      `platter_details` survived byte-identically across open → save
- [x] 3.4 ⚠ **THE COUNT IN THIS ENTRY IS WRONG AND STILL RISING.** It says one deal holds
      "Not Applicable". At the time of building there were **three** — QT-M0040, QT-M0041 and QT-M0042 —
      all real, all at `awaiting_quotation_approval`. A new one appeared *during* the session, because
      the option stays pickable until this ships. All three render correctly

### OCPI-18 · Commercial terms — drop two fields, and put the delivery date on the contract with its condition  `[x]`
*Raised 2026-09-01 · Asked for by Ritesh Bhai, from the commercial-terms screenshot*

Four changes to one block. Two are removals, and **one of the two cannot simply be deleted** — read the
Delivery days section before touching anything.

#### 1 · Remove "Type of payment" (Any Advance / On Credit)

- Form: `QuotationForm.tsx:2091`. Field `paymentType`, column `payment_type`.
- ⚠ **It PRINTS on the summary sheet today** — `quotationPdf.ts:212` renders it as *"Any Advance"* /
  *"On Credit"*. Removing the field removes a line from a customer-facing document. That is the intent,
  but it should be a decision, not a side effect.
- ⚠ **It is MANDATORY today** — `fieldSpec.ts:1145`, `missingForSubmit`. Remove it there too, and from
  the matching SQL completeness predicate, or the form stops asking for something the database still
  demands and nothing can be submitted.
- 🟢 *Terms of payment* (`paymentTerms`, the free-text box below it) is a **different field and stays.**
  It carries the real answer — *"30 % advance and rest PDC cheque"* — and prints on both papers. Do not
  confuse the two while removing one.
- Keep the column; do not drop it. Additive-only, and existing deals keep what they recorded.

#### 2 · Remove "Delivery days" — 🔴 NOT A SIMPLE DELETION

🔴 **`{{delivery_days}}` IS A TEMPLATE TOKEN, LIVE ON 21 OF THE 28 MACHINES.** It sits inside the
**SALE CONDITIONS OF THE SUPPLY** section — the contract's own terms — reading:

```
Transport Terms: {{trade_term}}
Delivery Days: {{delivery_days}}
Payment terms: {{payment_terms}}
Insurance: Product Insurance borne by Customer.
```

Delete the form field alone and every one of those 21 contracts prints **`Delivery Days: ` followed by a
ruled blank**, in the delivery clause of a signed document. The 21: Homer K24, Homer K32, K64, P8D, P8S,
MP5000, JPK, Rocket, Position Printer, Fab Pro 1I/2I/3I, Pengda PD-1700XD-1000, Kolorado Alpha 15/16,
KoloRado Alpha II ×3, KoloRado Alpha 3 — 12 heads, KoloRado Alpha 3.2 — 8 / 24 heads.

🟢 **The fix and change 4 are the same edit.** Replace that line on all 21 sections:

```
-  Delivery Days: {{delivery_days}}
+  Tentative Machine Delivery Date: {{delivery_date}}
+  Applicable from the date of signing of this contract.
```

That removes Delivery days from the contract **and** puts the delivery date there, which is exactly what
was asked for. One migration, 21 sections, no blank lines left behind.

Also to clear up:
- `tokens.ts:181` and `:253` — remove `delivery_days` from the resolver and from `TOKEN_HELP`, so the
  Machine template screen stops offering a token nothing fills.
- `exportRegister.ts:223` — the Deal Register has a **"Delivery days"** column. Remove it, or it exports
  a column that can only ever be blank from here on.
- `fieldSpec.ts:1178` — it is in `missingForDetailSheet`, the "will print blank lines" warning. Remove.

#### 3 · "Machine delivery date" → "Tentative machine delivery date", with a remark under it

✅ **ALL THREE SETTLED 01-09-2026.** Build exactly this:

| | |
|---|---|
| Label | **Tentative machine delivery date** |
| Existing hint *"tentative, committed to the customer"* | **REMOVED** — the new label and remark say it better, and three tentative-ish notes on one field read as a mistake |
| Remark, below the input | **"Applicable from the date of signing of this contract."** |

⚠ **That remark wording is confirmed and PRINTS ON A SIGNED CONTRACT** — it is also what goes into the
21 SALE CONDITIONS sections in change 2. Use the same sentence in both places, to the character, or the
form and the contract will say the delivery condition slightly differently.
- ⚠ The field stays **mandatory** (`fieldSpec.ts:1180`) unless OCPI-15 moves it. These two entries touch
  the same completeness list — whichever lands second must not undo the first.

#### 4 · Show the date and the remark on the contract

- Handled by the section rewrite in change 2 above — that is where it lands.
- 🔴 **A `{{delivery_date}}` TOKEN DOES NOT EXIST.** `tokens.ts` has `delivery_days`, `payment_terms` and
  `trade_term`, but no delivery date. It must be **added to the resolver and to `TOKEN_HELP`**, formatted
  `dd-mm-yyyy` like every other date in this module, **before** the 21 sections are rewritten to use it —
  or the migration lands a token that resolves to nothing and prints the very blank it was meant to fix.
- The summary sheet already prints *"Machine Delivery Date"* (`quotationPdf.ts:214`). Relabel it to match
  the new wording, and decide whether the remark prints there too or only on the contract.

#### Checklist

- [x] 0.1 SETTLED — *"Applicable from the date of signing of this contract."*, label **Tentative machine
      delivery date**, old hint removed
- [x] 0.2 Summary sheet: relabelled, and the REMARK PRINTS THERE TOO — as a `Delivery Condition` row
      directly beneath, and only where there is a date (the rule the warranty note already follows).
      ⚠ **It did crowd the sheet, and the fix was the row width, not the wording.** In a half-width cell
      the new label wrapped to *"Tentative Machine"* / *"Delivery Date"* / *"30 Sept 2026"* — three lines
      for one field, read off the rendered PDF. Both rows are `wide` now and each reads on one line. The
      row LABEL `Delivery Condition` is the one word not settled in the brief; the renderer's rows need
      a label and this mirrors `Warranty Note`
- [x] 1.1 Add the `delivery_date` token to `tokens.ts` + `TOKEN_HELP` — done first, before the migration
- [x] 1.2 Migration `20261102120000_fms_ocpi_delivery_date_on_the_contract.sql`, applied 01-Sep-2026.
      21 sections rewritten, asserted at 21. 🔴 **THE GUARD IN THIS ENTRY WOULD HAVE FAILED** — see the
      correction below; it matches the TOKEN, not the heading
- [x] 2.1 `paymentType` out of the form, `quotationPdf.ts`, `missingForSubmit` and the SQL predicate
- [x] 2.2 `deliveryDays` out of the form, `tokens.ts`, `TOKEN_HELP`, `missingForDetailSheet` and the
      Deal Register export
- [x] 2.3 Both COLUMNS kept. Proved, not assumed: a draft holding both was saved through the real form
      and both values came back byte-identical
- [x] 3.1 Relabelled, old hint dropped, remark added; the two half-empty grids merged into one holding
      the date and the delivery term
- [x] 4.1 `cd frontend && npm run build`
- [x] 4.2 🔴 **K64 contract rendered and read with pdf.js** — SALE CONDITIONS reads *"Transport Terms:
      CIF / Tentative Machine Delivery Date: 30 Sept 2026 / Applicable from the date of signing of this
      contract."* No `Delivery Days:` line, no ruled blank from this change. **The other four heading
      families were rendered too** (Fab Pro 1I, JPK, Position Printer, MP5000) — all five correct. The
      two blanks left on the K64 paper are `{{head_count}}` and `{{consumables_supplier}}`, both unanswered
      on QT-M0040 itself and unrelated to this
- [x] 4.3 Token sweep across all **180** sections: 11 tokens in use, `delivery_date` among them,
      **0 unknown**, `delivery_days` nowhere
- [x] 4.4 A frozen deal is untouched — 23 of the 30 stored payloads still say *"Delivery Days"*, none say
      the new wording, all 30 still carry `payment_type`, and 23 still serve a stored PDF from storage
- [x] 4.5 🔴 **Submitted for real, with `payment_type` NULL**, through the form and the live RPC on a
      `ZZ TEST` draft. Accepted; before this it would have raised the CHECK. Restored afterwards, and
      the activity row and notification deleted — counter unmoved, **no email queued** (OCPI mail is off)

#### 🔴 Two corrections to this entry, found in the live database

**1 · The 21 sections do not share a heading — there are FIVE.** This entry described every one as
`Delivery Days: {{delivery_days}}` and asked the migration to match that literal text and assert 21.
It would have rewritten **14** and failed:

| Heading | Count | Machines |
|---|---|---|
| `Delivery Days:` | 14 | Homer K24/K32, K64, P8D, P8S, Pengda, Kolorado Alpha 15/16, KoloRado Alpha II ×3, Alpha 3 — 12 heads, Alpha 3.2 — 8/24 heads |
| `Delivery Terms:` | 3 | Fab Pro 1I / 2I / 3I |
| `Delivery:` | 2 | JPK, Rocket |
| `Shipment Terms:` | 1 | Position Printer |
| `Shipment:` | 1 | MP5000 |

All 21 were normalised to the settled wording — confirmed with the client before building. That also
corrects the three Fab Pro decks, which labelled delivery DAYS as *"Delivery Terms"*, a heading their
own `{{trade_term}}` line already uses on the same page. The migration matches the **token**.

**2 · A second SQL gate names delivery days, and it is dead.** `fms_ocpi_submit_oc` raises
*"Still needed on the order confirmation: the delivery days"*. That reads like a blocker for every deal
raised from here on, and is not one: the order-confirmation wrappers were retired at revision stage F
(`data/ocpiWrites.ts:215`), nothing in the app calls it, and no deal is parked at that step. **Left
untouched deliberately** — it is what historical rows at the retired step were written by.

#### One thing found while verifying, outside the ask

`{{delivery_date}}` was first written against `format.ts`'s `dmy`, and the contract renderer uses its
own private copy of a near-identical formatter — as does the summary sheet. Three copies, and this
would have been a fourth. They were consolidated onto one `paperDate` in `format.ts`. ⚠ **Nothing was
printing wrongly**: `en-GB` and `en-IN` were checked month by month and agree on all twelve, so the
copies had not drifted. `format.ts`'s comment claiming *"dd-mm-yyyy"* was corrected — it has never
produced that, and it is the comment this entry's *"dd-mm-yyyy like every other date"* was written from.
⚠ **Sequence with OCPI-15 and OCPI-14.** All three edit the same commercial-terms block and the same
completeness rules. Do not run two of them at once.

### OCPI-19 · "Consumables to be bought from" stops being a question and becomes a statement  `[x]`
*Raised 2026-09-01 · Asked for by Ritesh Bhai*

**The ask.** The field is a free-text box today (`QuotationForm.tsx:2387`). The answer is always the same
company, so stop asking and simply **show** it: *Consumables to be bought from Orange O Tec Private
Limited.*

🟢 **The live data proves the point.** All **14** deals that carry a value carry the same company — typed
**two different ways**: `Orange O Tec Pvt Ltd` and `Orange O Tec Pvt. Ltd.` A field whose only answer is
one company, spelled inconsistently on customers' contracts, should not be a text box.

#### 🔴 The spelling has to be settled once — there are already THREE, and this would make a FOURTH

| Where | Spelling |
|---|---|
| Deals, variant 1 (some of the 14) | `Orange O Tec Pvt Ltd` |
| Deals, variant 2 (the rest) | `Orange O Tec Pvt. Ltd.` |
| **`fms_ocpi_company_profiles.legal_name`** — what prints as the **selling entity** on the paper | **`M/s ORANGE O TEC PVT LTD.`** |
| Asked for here | `Orange O Tec Private Limited` |

⚠ **The last two land on the SAME PAGE.** The letterhead and signature block carry the legal name from
the company profile; the consumables clause would carry this one. A contract naming its own seller two
different ways in two places is the kind of thing a customer's lawyer notices.

**Decide before building:** either use the company profile's `legal_name` so the two can never diverge,
or fix an explicit constant and accept the difference knowingly. My recommendation is to read
`legal_name`, since it is already the module's single answer to "what is this company called" — but that
prints *"M/s ORANGE O TEC PVT LTD."*, which is not the wording asked for. **Ritesh Bhai's call.**

⚠ Also confirm: is the consumables supplier **always Orange O Tec**, or should it follow the deal's
**selling entity**? Only one company profile exists today, so the two are indistinguishable — but the
module supports several, and the answer decides whether this is a constant or a lookup.

#### 🔴 It is a template token on 12 machines

`{{consumables_supplier}}` (`tokens.ts:154`, `:246`) resolves from the deal and is used in **12** machine
templates. So the field cannot simply be deleted — the safest shape is:

- Keep the **column** and keep the **token resolving from the deal**, exactly as now. Nothing in the 12
  templates changes, and every frozen paper stays valid.
- On the form, replace the text box with **read-only text** showing the settled wording.
- Set the constant onto the draft so every new deal stores it, and the token keeps resolving.

That way this is a **form change plus a default**, not a token migration — much smaller, and the 12
templates are never touched.

⚠ Do NOT rewrite the 14 existing deals' values. Their papers are frozen and already print what they
print; changing the stored text would put a deal and its issued document out of step.

⚠ There is a comment directly above this field describing a *different* field that was removed, and it
notes *"Zero templates use the token now; verified before this field was removed."* That is about the
head-price field, **not** this one — this token has 12 users. Do not read that comment as applying here.

#### Checklist

- [x] 0.1 **SETTLED 01-09-2026 — the wording is exactly `Orange O Tec Pvt Ltd`.** A fixed constant, NOT
      read from `company_profiles.legal_name`. It matches the spelling most of the 14 existing deals
      already use, so nothing on record looks odd beside it.
      ⚠ **Chosen knowingly in spite of the mismatch flagged above**: the letterhead and signature block
      will still print `M/s ORANGE O TEC PVT LTD.` from the company profile, so the same contract names
      its seller two ways. Ritesh Bhai was shown both and picked this. **Do not "harmonise" the two.**
- [x] 0.2 Always Orange O Tec — a constant, not a lookup on the deal's selling entity
- [x] 1.1 Form: read-only text in place of the input, wording per 0.1 — a read-out, **not** a disabled
      input, following `WarrantyReadout`'s stated rule in the same file
- [x] 1.2 The value is written onto every new deal so `{{consumables_supplier}}` keeps resolving —
      `EMPTY_DRAFT` (new drafts) **and** `draftFromDeal` (a deal that stored nothing). ⚠ The second half
      is not in this entry and the change is broken without it: `EMPTY_DRAFT` alone would have let an
      older deal display the company name while saving back NULL, printing `M/s ` and a ruled blank
- [x] 1.3 Leave the column, the token, the 12 templates and the 14 existing deals alone
- [x] 2.1 `cd frontend && npm run build`
- [x] 2.2 Render a contract on one of the 12 and confirm the consumables line reads correctly and is
      **not blank** — MP5000, read back with pdf.js: *"Consumable items: To be purchased directly from
      M/s Orange O Tec Pvt Ltd."* No ruled blank
- [x] 2.3 Open one of the 14 older deals and confirm it still shows and prints its original wording —
      shows and prints `Orange O Tec Pvt. Ltd.`, unchanged
- [x] 2.4 🔴 **A REAL DEAL ANSWERED THIS FIELD `customer`.** QT-M0042 (SHAN TEXTILES, awaiting
      quotation approval) holds `consumables_supplier = 'customer'`, so its contract will print
      *"purchased directly from M/s customer."* The field is now read-only, so **nobody can correct that
      from the form** — it needs a person and an SQL update, or a revision. Not fixed here: rewriting a
      live deal's stored value was explicitly out of scope. ⚠ It also contradicts this entry's premise
      that the answer is always Orange O Tec

### OCPI-20 · Show the salesperson the expected format for payment terms  `[x]`
*Raised 2026-09-01 · Asked for by Ritesh Bhai · **scope cut on the same day** — free text with a visible
format, NOT structured fields. Dropdowns deferred; see "Later" at the foot.*

**The ask, as settled.** Keep *Terms of payment* a free text box. Just **show the expected format in it**,
so the salesperson writes it the house way without being forced to. No dropdowns, no structured fields,
no new columns — those can come later if this is not enough.

#### ⚠ Read this first — a placeholder already exists, and it has not worked

`QuotationForm.tsx:2189` already carries `placeholder="e.g. 25% advance, 75% before delivery"`. So
"put the format in the box" is **the current state**, and the box still produced six different wordings
across 18 deals — including one deal whose payment terms are the word **`na`**.

Two reasons it fails, and the fix is to correct both rather than to re-add a placeholder:

1. 🔴 **A placeholder disappears the moment anybody types.** It is guidance for an empty box, and this box
   is rarely empty for long — a salesperson editing a saved draft never sees it at all. **The format has
   to be a persistent hint that stays visible while typing**, not placeholder text.
2. 🔴 **The placeholder does not match house style.** It says *"25% advance, 75% before delivery"*. The
   wording actually used on 13 of the 18 deals is *"25% advance with the order, 75% against the shipping
   documents."* The example is teaching a format nobody uses.

#### What to build

✅ **THE APPROVED SENTENCE, settled 01-09-2026** — one string, used in all three places below, identical
to the character:

> **25% advance with the order, 75% against the shipping documents.**

It is the wording 13 of the 18 existing deals already carry, so nothing on record looks odd beside it.
Define it **once as a constant** — the hint, the placeholder and the button must never drift apart.

- [ ] 1 **A persistent hint under the box**, always visible **while typing**, showing that sentence.
      Visible on a saved draft being edited, not only on an empty box — that is the whole point.
- [ ] 2 **Correct the placeholder** from today's `e.g. 25% advance, 75% before delivery` to the same
      approved sentence, so the empty state and the hint agree.
- [ ] 3 ✅ **A "Use this format" button — CONFIRMED, build it.** One click drops the sentence into the
      box so the salesperson edits the numbers rather than writing the line from memory. That is what
      makes the house wording actually get used.
      ⚠ **It must never silently overwrite text already typed.** A salesperson three-quarters through a
      negotiated term, clicking to see what the format was, must not lose it — confirm first, or disable
      the button while the box has content, or append rather than replace. Decide which, and say so.

**Deliberately NOT in scope:** dropdowns, an advance-% field, a PDC-cheque count, derived balance
percentages, or any new column. `payment_terms` stays exactly as it is — one free-text column holding one
sentence.

#### Why this stays safe

🟢 **Nothing about the data or the documents changes.** `{{payment_terms}}` is a template token live in
the SALE CONDITIONS section of ~21 machines (`Payment terms: {{payment_terms}}`), and it keeps resolving
from the same column exactly as today. No migration, no template edits, no risk to a frozen paper. This
is a hint and a placeholder — the smallest possible version of the idea.

#### Checklist

- [x] 0.1 SETTLED — *"25% advance with the order, 75% against the shipping documents."*
- [x] 0.2 SETTLED — the **"Use this format" button is wanted**. Build it, with the overwrite guard above.
- [x] 1.1 Persistent hint + corrected placeholder — both from one constant, `PAYMENT_TERMS_FORMAT`
- [x] 1.2 The overwrite guard is **confirm before replacing** (the entry asked for a choice). An empty
      box fills on the first click; a box with anything in it arms an inline *"Replace what is typed?
      Replace / Cancel"* on the button itself. Not *disable*, which would lock the button out of exactly
      the deal that needs it most — the one whose terms are the word `na`; and not *append*, which would
      put two payment sentences into one clause on a signed contract
- [x] 2.1 `cd frontend && npm run build`
- [x] 2.2 Browser: the hint is visible **while typing**, not only when the box is empty
- [x] 2.3 Nothing else moved — open a saved deal and confirm its stored terms are untouched. Cancel
      leaves typed text byte-identical (checked by string equality, not by eye)

#### Separately — one live deal needs correcting by a person, not by code

🔴 **A real deal has `payment_terms = 'na'`**, and that prints on the contract's payment clause. It is a
live defect, not an illustration. Surface it to whoever owns that deal. No format hint fixes a row that
is already wrong.

#### Later, if the hint is not enough

The 18 deals show every real answer has the same shape — a percentage up front, and a balance settled
some way (*against shipping documents* · *before dispatch* · *PDC cheques*, with a cheque count). If drift
continues, the structured version is: advance % + balance method + cheque count, composing into the
sentence, with the balance percentage **derived** rather than typed, and an "Other — type it" escape so
an unusual deal does not end up recorded in Special remarks. Stored in new additive columns beside
`payment_terms`, which would keep holding the composed sentence so the token is unaffected.
**Not being built now — recorded so the analysis is not redone.**

### OCPI-21 · `ChoiceButtons` still loses a value it cannot match — Print head is the one left exposed  `[x]`
*Raised 2026-09-01, found while building OCPI-17 · **FIXED AND VERIFIED 02-09-2026***

> ✅ **DONE, locally — the shared component was not touched.** Print head's strip now feeds the deal's
> own value back in as an option, the same way OCPI-17 did for Platter. Verified live on **QT-M0035**
> (draft · Rocket · offers *EX600* / *RC* · holds *KATANA 600 DPI - HANGLORY*): three buttons, the
> stored one lit with `aria-checked="true"` and `tabIndex=0`, so Tab lands on IT and changes nothing.
> Saved without touching the field and re-read in SQL — `head_type` unchanged.
>
> ⚠ **`optsWithCurrent`, not `masterOpts`.** `masterOpts` filters on `active`, and `headsFor` in
> `store.tsx` deliberately does not ("a machine mapped to a head somebody has since retired should
> still say so"). All 13 head types are active today so the two behave identically; the difference
> bites the day one is deactivated.
>
> ⚠ **It makes the loss VISIBLE, not impossible.** ↓ still moves off the lit button and the retired
> option then disappears — the documented one-way door `optsWithCurrent` already carries. Confirmed
> that is what happens, and confirmed as the wanted behaviour on 02-09-2026.
>
> 🔴 **A SECOND divergence in the same field was found and fixed** — see OCPI-24 below.

`shared/components/ui/ChoiceButtons.tsx` is fully controlled and never writes back on mount, so a
stored value that matches no option **survives a save**. But it shows as nothing at all: no button
lights, `aria-checked` is false on every one, and the field reads as unanswered.

🔴 **Worse, one keystroke replaces it silently.** With nothing matched, `index` is `-1`, so
`onKeyDown` computes `from = -1` and a single ↓ on a tabbed-to strip fires
`onChange(options[0].value)` — a recorded answer gone with no click and nothing on screen to show it
happened.

**OCPI-17 closed this for Platter** without touching the shared component, using `optsWithCurrent`
in `QuotationForm.tsx` (the fixed-vocabulary twin of the existing `masterOpts`): feed the deal's own
value back in as an option, and the value is both visible and index-addressable, so the arrow keys
behave normally.

⚠ **Print head is still exposed.** It is fed from `mappedHeads`, and 22 of the 28 machines changed
their mapping in the 01-09 refresh, so an older deal can easily hold a head that maps to nothing.
`QuotationForm.tsx:1187` renders an explanatory read-out — so the value is at least *visible* — but
it does **not** stop the keystroke, because the strip itself still has `index === -1`.

The fix is either `masterOpts` at that call site too, or generic unknown-value handling inside
`ChoiceButtons`. ⚠ The shared component has **26 call sites across 10 apps** and there is no test
runner, so the local fix is the cheaper one. If it is done centrally, Print head's bespoke read-out
must be reconciled or it will double-report.

### OCPI-22 · A live deal says its consumables come from "customer", and the field can no longer be edited  `[x]` — closed 01-09-2026, no action needed
*Raised 2026-09-01, found while building OCPI-19*

> ✅ **CLOSED — both deals are dummies.** Ritesh Bhai confirmed **QT-M0042** and **QT-M0045** are throwaway
> quotations despite carrying real customer names and no `ZZ TEST` prefix. Nothing to correct, and the
> read-only field introduced by OCPI-19 is doing its job for everything raised from here on.
>
> ⚠ **Worth knowing for OCPI-12 and for any future data check: `ZZ TEST` IS NOT A RELIABLE MARKER of
> test data on this module any more.** Two real-looking, real-named deals at `awaiting_quotation_approval`
> turned out to be disposable. Never infer "this is a live deal" from the absence of the prefix — ask,
> as was done here. The K64 print audit's teardown step in particular must not assume the inverse either.

🔴 **TWO real deals, not one — re-checked 01-09-2026.** Both are non-test, both sit at
`awaiting_quotation_approval`, and both have nonsense in a contract clause:

| Quotation | Customer | Stored value | The contract prints |
|---|---|---|---|
| **QT-M0042** | SHAN TEXTILES PRIVATE LIMITED- MACHINE | `customer` | *"purchased directly from M/s **customer**."* |
| **QT-M0045** | SWAMI TEXTILES PVT. LTD (UNIT-II) | `0` | *"purchased directly from M/s **0**."* |

The 12 templated machines render
`Consumable items: To be purchased directly from M/s {{consumables_supplier}}.`

⚠ **`0` is not a commercial term** — it is somebody typing into a box they did not understand, which
settles the question this entry raised about whether `customer` was deliberate. At least one of the two
is plainly a mistake, and both are one approval away from reaching a customer.

🔴 **OCPI-19 made that field read-only, so nobody can correct it from the form.** Fixing it now takes
an SQL update or a revision. Rewriting a live deal's stored value was explicitly out of scope for
OCPI-19, so it was left alone deliberately.

⚠ It also contradicts OCPI-19's premise that the answer is always Orange O Tec — this is the first
deal that answered otherwise. Worth asking whether it was a genuine commercial term or somebody
misreading the box, because that decides whether the read-only field is right.

🔴 Same shape as the `payment_terms = 'na'` deal noted under OCPI-20: **the form can stop new bad
answers, but it cannot repair the ones already recorded.**

### OCPI-23 · A field-to-document map — which answer lands where on the short form and the long form  `[x]` — delivered by OCPI-12, 02-Sep-2026
*Raised 2026-09-01 · Asked for by Ritesh Bhai · **PARKED 01-09-2026 — do not start this on its own***

> ✅ **DONE — and kept as a MAINTAINED MAP, not thrown away.** OCPI-12 ran on 02-09-2026 and its
> Part 1 produced this, generated rather than hand-written: **`frontend/scripts/ocpi-field-map.mjs`**,
> run with **`cd frontend && npm run field-map`**, emitting **`OCPI-FIELD-MAP.md`** at the repo root.
>
> It reads the five sources this entry named — `FIELD_LABEL`, `quotationPdf.ts`, `ocPdf.ts`, `tokensFor`
> and the live `fms_ocpi_machine_sections` — and answers the per-machine problem the way this entry
> insisted it must: the two long-form routes are **separate columns**, and the token column carries a
> **count** (`{{delivery_date}}` 21/21, `{{consumables_supplier}}` 12/21), never a tick.
>
> **The denominator is 21, not 28** — seven active machines have no template and print no long form at
> all; they are named in the map rather than counted as gaps.
>
> **103 fields, 18 of which reach no document.** Most are documented-deliberate; the five that nobody
> had decided are **OCPI-34**. The verdicts were checked against ten rendered PDFs, so they are no
> longer the unverified claims this entry warned about.
>
> Everything below is the original thinking, kept because it is what shaped the generator.
>
> 🅿️ **PARKED, DELIBERATELY.** Ritesh Bhai's decision: **OCPI-12 (the K64 print audit) covers this
> ground, so do it there.** When OCPI-12 runs, its Part 1 walk of `FIELD_LABEL` produces exactly this
> analysis — at that point decide whether the output is kept as a durable map or thrown away as
> working notes, and close this entry either way.
>
> Everything below is the thinking already done, kept so it is not redone: the per-machine problem, why
> it must be generated rather than hand-written, and the four sources it can be generated from. **Read
> it when OCPI-12 starts. Do not schedule it as a task of its own.**

**The ask.** For every field captured on the quotation form, be able to see **where it comes out** — on
the **short form** (the summary sheet, `quotationPdf.ts`) and on the **long form** (the detailed order
confirmation, `ocPdf.ts` plus the machine's own template sections). A reference you can look at, not a
one-off investigation.

The scale, checked 01-09-2026: **103 fields** in `FIELD_LABEL` and **28 documented tokens**. Nobody
holds that in their head, and roughly fifteen of those fields were added in the last three days.

#### ⚠ Its relationship to OCPI-12 — read this before starting either

**OCPI-12 (the K64 print audit) already contains this analysis as its Part 1.** It walks `FIELD_LABEL`
and classifies each field *Prints / Screen-only deliberate / Screen-only undocumented*. The difference:

| | OCPI-12 | This entry |
|---|---|---|
| Purpose | **find what is broken** | **be able to look it up afterwards** |
| Output | a list of findings | a **durable map** |
| Lifespan | one afternoon | maintained |

**Do not do the walk twice.** Either run this first and let OCPI-12 verify the map against real rendered
PDFs, or run OCPI-12 and keep its Part 1 output as the map. **Running this first is better** — it gives
OCPI-12 a checklist to verify against instead of a blank page.

#### 🔴 The thing that makes this harder than it looks: the long form is PER MACHINE

A field reaches the long form **two different ways**, and only the first is answerable once:

1. **Rendered directly** by `ocPdf.ts` — same for every deal.
2. **Through a `{{token}}` inside a machine's template section** — and **each machine has its own
   sections**. `{{delivery_date}}` is in **21 of 28** machines. `{{consumables_supplier}}` is in **12**.

So *"does this field print on the long form?"* has no single answer. It has a **count**: on how many of
the 28 machines. A map that answers yes/no is wrong, and would be worse than none — it would say a field
prints when it prints on twelve machines and vanishes on sixteen.

⚠ **A machine with `has_template = false` prints no long form at all** — it issues the summary sheet
alone. Those machines are neither "prints" nor "missing"; they have no long form to appear on. Say so
explicitly rather than counting them as gaps.

#### 🔴 Generate it, do not hand-write it

A hand-written map goes stale the first time somebody adds a field — and this module added ~15 fields in
three days, across OCPI-7, 10, 11, 14, 18. **A stale map is worse than no map**, because it will be
trusted.

Write a **script that produces the map** from the four sources that already exist:

| Source | Gives |
|---|---|
| `fieldSpec.ts` → `FIELD_LABEL` | the 103 fields and their labels — the module's own list |
| `quotationPdf.ts` | what the short form renders |
| `ocPdf.ts` | what the long form renders directly |
| `tokens.ts` → `tokensFor` + `TOKEN_HELP` | which fields are exposed as tokens |
| `fms_ocpi_machine_sections` (live DB) | which machines' templates actually use each token |

Proposed shape — one row per field:

| Field | Section | Short form | Long form (direct) | Long form (via token) | Verdict |
|---|---|---|---|---|---|
| Customer name | A | ✓ header | ✓ header | — | prints |
| Ink — subsidized rate | B | ✓ | — | — | short form only |
| Tentative delivery date | C | ✓ | — | `{{delivery_date}}` · **21/28** | prints |
| Platter | A | — | — | — | **screen only — is that deliberate?** |

The last column is the one that earns the map: **a field captured, stored, and printed nowhere, that
nobody decided should be invisible.**

⚠ **Static analysis alone will not settle it.** A field can be referenced in `ocPdf.ts` and still never
appear — inside a branch that never fires, or a section the machine has no rows for. The generated map
is a **claim**; OCPI-12's rendered PDFs are the **proof**. Mark generated verdicts as unverified until
OCPI-12 confirms them.

#### Checklist

- [ ] 0.1 Decide where the map lives: a generated `OCPI-FIELD-MAP.md` in the repo, a page in the app, or
      a sheet like OCPI-5's. ⚠ It must be **regenerable in one command**, wherever it goes
- [ ] 0.2 Confirm with Ritesh Bhai that per-machine counts (21/28) are what he wants to see, rather than
      a plain yes/no
- [ ] 1.1 The generator: walk the four code sources + the live sections table
- [ ] 1.2 Handle the two-route problem — direct render vs token — as separate columns, never merged
- [ ] 1.3 Exclude `has_template = false` machines from the denominator and say which they are
- [ ] 2.1 Produce the map; read it; every "screen only" row is a question for Ritesh Bhai, not a bug
- [ ] 2.2 Hand the map to OCPI-12 as its Part 1 checklist
- [ ] 3.1 `cd frontend && npm run build` if anything shipped in `src/`

#### Questions
- [ ] **Where do you want to read this** — a document in the repo, a screen in the app, or an Excel sheet
      like the template comparison workbook?
- [ ] **Is a field that prints on only some machines a problem to fix, or just a fact to see?** It
      changes whether the map is a report or a to-do list.

### OCPI-24 · Print head: the screen showed the MACHINE's head while the paper printed the DEAL's  `[x]`
*Found 2026-09-02 while building OCPI-21 · **FIXED AND VERIFIED THE SAME DAY***

> ✅ **DONE.** Fixed in the same field, in the same session, on Ritesh Bhai's instruction.

The same class of defect as OCPI-21 — a stored value that matches no option, shown as something else —
but in the branch that has **no buttons**, so no keystroke was involved and nothing was ever lost. It
was quieter than OCPI-21 and arguably worse, because the wrong value was on the screen rather than
missing from it.

Where a machine maps **exactly one** print head, the field is shown and not chosen (OCPI-14). That
read-only box printed `mappedHeads[0].name` **unconditionally** — so a deal quoted before the 01-09
mapping refresh showed the machine's current head, while `quotationPdf.ts` went on printing the deal's
frozen `head_type`. **Screen and paper disagreed.**

Six live deals were in that state on 02-09-2026:

| Quotation | Machine | Machine maps | Deal holds — and prints |
|---|---|---|---|
| **QT-M0026** | Kolorado Alpha 15 | I3200 | **KYOCERA KJ4B** |
| **QT-M0027** | MP5000 | EX600 | **RICOH GEN 6 HEAD** |
| **QT-M0028** | KoloRado Alpha II — 1.8 m | I3200 | **KYOCERA KJ4B** |
| **QT-M0032** | Fab Pro 1I | RICOH GEN 6 | **RICOH GEN 6 HEAD** |
| **QT-M0034** | JPK | KJ4B | **RICOH GEN 6 HEAD** |
| **QT-M0038** | Kolorado Alpha 15 | I3200 | **EPSON PRINTHEAD I 3200** |

⚠ Note QT-M0032 and QT-M0038: the two strings are the *same head under a different name*. The master
holds thirteen head types of which several are near-duplicates (`RICOH GEN 6` / `RICOH GEN 6 HEAD`,
`I3200` / `EPSON PRINTHEAD I 3200`, `KJ4B` / `KYOCERA KJ4B` / `600 DPI - KJ4B` / `300DPI - KJ4B`).
Only six of the thirteen are mapped to any machine at all. **Worth a de-duplication pass on the head
master** — not attempted here, and not required by the fix.

**The fix.** `soleHeadAgrees` in `QuotationForm.tsx`: where one head is mapped and the deal holds
something else, show what the deal holds — which is what prints — and add a grey line naming what the
machine maps today. No data was changed and no migration was needed.

**Verified 02-09-2026.** QT-M0026 opened live: the box now reads *KYOCERA KJ4B* with *"The machine
master now lists I3200 for this model. This deal was quoted on the head above, and that is what
prints."* — and the freshly rendered summary PDF, read back with pdf.js, prints
`Type of Head  KYOCERA KJ4B`. Screen and paper now agree.


### OCPI-25 · 🟢 Selling entity — show a clean alias, and pick it with buttons rather than a dropdown  `[ ]`
*Raised 2026-09-02 · Asked for by Ritesh Bhai*

**The ask.** *Selling entity* shows the raw Tally company name with its financial-year suffix —
`ORANGE O TEC PRIVATE LIMITED (01-04-25TO31-03-27)`. It should read as the company:
**Orange O Tec Private Limited** and **Orange O Tec Enterprise Private Limited**. Add an **alias** on the
master, show the alias on the form, and replace the dropdown with the same **`ChoiceButtons`** strip used
elsewhere in the module.

#### 🔴 The reason only ONE option shows today is NOT the naming

`mst_companies` holds **five** rows, and the picker lists only those with an **active OCPI company
profile**. Exactly one has one:

| Tally company | OCPI profile? |
|---|---|
| ORANGE O TEC PRIVATE LIMITED (01-04-25TO31-03-27) | ✅ **the only one that appears** |
| ORANGE O TEC PRIVATE LIMITED-NOIDA-(from 1-Apr-25) | ❌ |
| ORANGE O TEC ENTERPRISES PVT LTD(F.Y.2026-27) | ❌ |
| ORANGE O TEC ENTERPRISES PRIVATE LIMITED-NOIDA -FY 26-27 | ❌ |
| COLORIX DIGITAL PRINTING SOLUTIONS LLP - (from 1-Apr-20) | ❌ |

**So aliases alone will not produce the two buttons Ritesh Bhai expects.** A profile carries the legal
name, bank account, IFSC, letterhead and ex-works city that print on the paper — without one the module
cannot issue a document for that entity, which is why `companyOptions` skips it. **Creating the
Enterprises profile is a DATA task and a prerequisite**, not part of this build, and it needs the real
bank details. ⚠ Raise it with Ritesh Bhai before building: the second button cannot exist until it does.

#### 🔴 Aliases COLLIDE — this is the design decision, and it must be made first

Five Tally rows collapse onto about three real entities, because Tally splits by **branch** and by
**financial year**:

- Orange O Tec Private Limited → **2 rows** (main + Noida)
- Orange O Tec Enterprises Private Limited → **2 rows** (main + Noida)
- Colorix → 1 row

Give both Orange O Tec PVT rows the alias *"Orange O Tec Private Limited"* and the strip shows **two
identical buttons**, which is worse than the raw names. So decide:

| Option | What it means |
|---|---|
| **A · Alias is a label only** | Each row keeps its own button; the alias just strips the FY suffix. Noida still needs distinguishing — *"Orange O Tec Private Limited — Noida"*. Honest, no ambiguity, but more than two buttons. |
| **B · Alias groups rows** | One button per alias, and picking it stores **one specific** `company_id`. ⚠ Then something must decide WHICH — and `company_id` drives the bank account that prints. Getting it wrong prints the wrong account on a contract. |

**Recommend A.** The deal stores `company_id`, and one button that could mean two companies is exactly
the kind of ambiguity that ends up on a customer's paper. Ritesh Bhai's "just two names" is achievable
under A if only the two main-branch entities get profiles — which is probably what he actually means.

#### The build

- [ ] 0.1 Settle A vs B, and confirm which entities genuinely need to be quotable
- [!] 0.2 🔴 **BLOCKED 02-09-2026 — WAITING ON RITESH BHAI FOR THE BANK DETAILS.** Creating the OCPI
      company profile for **Orange O Tec Enterprises Private Limited** needs its legal name, bank name,
      branch, account number, IFSC, letterhead and ex-works city. He has been asked and will send them.
      **Until they arrive the second button cannot exist**, because the bank account prints on the
      contract and the picker skips any company without a profile. This is data, not code — no amount of
      frontend work unblocks it. ⚠ Do not invent or copy across a bank account to make the button appear.
- [ ] 1.0 ⚠ **OCPI-35 NOW HARDCODES SURAT / NOIDA TOO, and this entry is where the two reconcile.**
      Its *Ex-factory location* strip (`DELIVERY_FACTORY_CITIES` in `lib/fieldSpec.ts`) carries the same
      two cities as the entities here. It was hardcoded deliberately on 02-09-2026 rather than read from
      `fms_ocpi_company_profiles`, because **exactly one profile is active**, so reading from the
      branches would have rendered a one-button strip with Noida unreachable — and this entry is blocked
      on the Enterprises bank details. **When 0.2 unblocks and the second profile exists, decide whether
      that strip should read from here**, and delete the constant if so. Do not add a third copy.
- [ ] 1.1 Additive nullable `alias` (or `display_name`) column. ⚠ **On `fms_ocpi_company_profiles`, NOT
      on `mst_companies`** — the company master is CENTRAL and shared with every other module, and an
      OCPI-only label does not belong there. It also keeps this additive on a table OCPI owns.
- [ ] 1.2 Editable wherever the profile is maintained, so it does not need a developer to change
- [ ] 2.1 `companyOptions` prefers `alias` and falls back to `c.name` — never a blank button
- [ ] 2.2 Swap the `Combobox` for `ChoiceButtons`. ⚠ **Account for what the Combobox carries first**
      (CLAUDE.md's container rule): `searchable` — fine to lose at 2–3 options; `clearable` — **blank is
      a LEGITIMATE answer here**, the code comment at `QuotationForm.tsx:1109` says Tally leaves ~10 of
      1,888 customers with no company, so the strip MUST keep a way back to unset; and the **`sublabel`**
      showing *"M/s ORANGE O TEC PVT LTD. · AXIS BANK · Ex-Works Surat"*, which exists so the salesperson
      can see what will actually print. A bare button loses that — **keep it, under the strip, for the
      selected entity.**
- [ ] 2.3 ⚠ `ChoiceButtons` shows an unknown value as **nothing at all** (OCPI-21). An older deal on a
      company that no longer has a profile must still display — use the `masterOpts` pattern, feeding the
      deal's own value back in as an option.

#### Verify

- [x] `cd frontend && npm run build`
- [ ] The strip shows the alias, not the Tally name; the sublabel still says what will print
- [ ] Clearing the selection still works — blank is legitimate
- [ ] 🔴 **Raise a deal on each entity and render both papers.** The letterhead, legal name and BANK
      ACCOUNT must match the button that was pressed. This is the one failure that reaches a customer
- [ ] An older deal still opens with its company shown, and prints unchanged
- [ ] ⚠ Nothing outside OCPI reads a renamed company — the alias is on the OCPI profile, so confirm
      `mst_companies.name` was not touched

#### Questions
- [ ] **Which entities should actually be quotable?** Two, as asked — or do the Noida branches need to
      raise their own OCPIs?
- [ ] **Is Colorix ever a selling entity for OCPI**, or deliberately out?

### OCPI-26 · Type of ink AND Delivery term become buttons, not dropdowns  `[x]`
*Raised 2026-09-02 · Asked for by Ritesh Bhai (both, same day) · sibling of OCPI-25 (selling entity)*

**The ask.** Two `Combobox` controls become `ChoiceButtons` strips. Few options each, so buttons are
fewer clicks and show every answer without opening anything.

#### 🟢 They are NOT the same job — one is safe, one needs a decision

| | Source | Verdict |
|---|---|---|
| **Delivery term** (`QuotationForm.tsx:2436`) | `TRADE_TERMS` — **a fixed list in code** (`fieldSpec.ts:645`): Ex-Work Surat · CIF · FOB · EX Factory | ✅ **Exactly what `ChoiceButtons` is for.** No rule bent, nothing buried in the control but `clearable`. Do this one first — it is a clean swap |
| **Type of ink** (`QuotationForm.tsx:1401`) | `fms_ocpi_ink_types` — **a MASTER** | ⚠ Breaks the component's own rule, and the dropdown carries a real feature. See below |

⚠ **Delivery term prints on the contract** — `{{trade_term}}` is live in the SALE CONDITIONS clause
(`Transport Terms: {{trade_term}}`) on the same ~21 machines as the delivery date. This task only changes
the CONTROL; the stored value and the token must be untouched. ⚠ There is also history worth not
re-treading: the field was **asked to be removed once before** and could not go, because that clause
depends on it (`QuotationForm.tsx:2771`). It is not being removed now either — only re-rendered.

#### The ink half — the part that needs a decision

*Type of ink* has three options today:

| Ink type | sort |
|---|---|
| Sublimation Ink | 10 |
| Reactive Ink | 20 |
| Pigment | 30 |

#### 🔴 This is the THIRD exception to `ChoiceButtons`' own rule — make it deliberately

`ChoiceButtons.tsx:19` says it plainly: *"ONLY FOR A FIXED VOCABULARY DECLARED IN CODE — never a master
list, however short."* Ink types are a **master** (`fms_ocpi_ink_types`), editable on the Masters screen.
The rule exists because **a strip sized to today's data breaks the first time somebody adds a row**, and
nobody connects the broken layout to the master they just edited.

OCPI-8 made the first exception (dryer category), OCPI-14 the second (print head), OCPI-25 proposes a
third (selling entity). This is a fourth. **The exception is becoming the rule**, so either:

- accept it and **say so in the component's comment**, with the criterion — a short master that in
  practice never grows — so the next author knows the boundary; or
- **make the strip wrap gracefully** past N options, so a fourth ink type degrades instead of breaking.

The second is better and would retire the whole question. Decide, do not drift into it.

#### 🔴 The Combobox carries a real feature the buttons would delete

Per CLAUDE.md's container rule, account for every control before replacing it:

| On the Combobox today | Survives? |
|---|---|
| `searchable` | not needed at three options — genuinely goes away |
| `clearable` | **decide** — buttons need an explicit way back to "not chosen" |
| `masterOpts(s.inkTypes, draft.inkType)` | **KEEP.** It feeds the deal's own value back in so an ink type since deactivated still shows. `ChoiceButtons` renders an unknown value as NOTHING (OCPI-21) and a single ↓ then overwrites it — this is the guard against that |
| **`onCreate` + `setAsk({ type: "ink_type" })`** | 🔴 **A REAL FEATURE.** The placeholder reads *"Search or add…"*: a salesperson can type an ink that does not exist, it is KEPT ON THE DEAL, and the master is asked to grow. Buttons remove the only route to it |

✅ **SETTLED 02-09-2026 — `onCreate` GOES, deliberately. No "+ Other" button, no request path.**
Ritesh Bhai: the ink list is fixed by the master. If a new ink is ever needed it is **added on the
Masters screen and appears on the form by itself** — a salesperson does not get to invent one mid-deal.

So remove `onCreate` and `setAsk({ type: "ink_type" })` at this call site. ⚠ **This is a deletion made on
purpose, not an oversight** — it is exactly the kind of thing CLAUDE.md's container rule exists to catch,
so this note is the record that it was accounted for and chosen.

⚠ **This makes rendering from the live master non-negotiable.** With no way to type an ink, a master
addition that does not reach the form leaves a salesperson with no route at all. Never hardcode the three.
⚠ Check whether `setAsk` / the `ink_type` master-request path is still used by any OTHER field before
deleting shared machinery — Master Requests is a real screen and other masters use it.

⚠ **Render the buttons from the live master (`s.inkTypes`), never a hardcoded three**, or an ink added on
the Masters screen never appears on the form and the two screens disagree with no clue why.

#### Checklist

- [x] 0.1 SETTLED — no "+ Other", no request path. The master is the vocabulary; see above
- [x] 0.2 `clearable` KEPT on both. Neither field is required — ink stays optional under OCPI-27, and
      the delivery term is a `DETAIL_SHEET_FIELDS` warning, never a block — so `ChoiceButtons`' own
      rule (clearable for optional fields only) permits it, and without it a first click is final
- [x] 0.3 DECIDED: **the strip already wraps**, so no component behaviour changed. The radiogroup is
      `flex flex-wrap gap-2`, which makes the old rule's premise — "a strip sized to today's data
      breaks the first time somebody adds a row" — simply untrue. The header ⚠ is rewritten to allow a
      SHORT master whose growth is an admin decision, and to state the real boundary: **a strip cannot
      be searched**, so anything that can run to dozens stays a `Combobox`. `optsWithCurrent`'s comment,
      which quoted the old rule, was reconciled with it
- [x] 1.1 Delivery term done FIRST. 🔴 **BUT NOT THE CLEAN SWAP THIS ENTRY PROMISED** — one deal on
      record carries **`CIF Jebel Ali`**, which is not one of the four. `opts(TRADE_TERMS)` would have
      rendered it as nothing selected and a single ↓ would have overwritten a term that prints on a
      signed contract. It uses **`optsWithCurrent(TRADE_TERMS, draft.tradeTerm)`**. Verified in the
      browser: the 5-button strip wraps to 2 lines and does not overflow down to a 200px column
- [x] 1.2 Type of ink done, `masterOpts` kept — and load-bearing: **5 deals carry `Pigment Ink` while
      the master says `Pigment`**. `onCreate` + `setAsk({type:"ink_type"})` removed deliberately;
      orphan sweep clean — `setAsk` still serves the Machine picker, and the `ink_type` request path
      is still live on the Master Requests page
- [x] 2.1 `npm run build` — tsc strict + vite, clean
- [x] 2.2 Browser: four delivery terms, three inks, both as strips; picking stores; ✕ clears both and
      then disappears (nothing left to clear)
- [x] 2.3 🔴 PASSED on the `CIF Jebel Ali` deal and a `Pigment Ink` deal: the off-master value renders
      as a lit extra button and **carries the roving `tabIndex=0`**, so the arrow keys start from a
      real index instead of -1. Saved the deal and re-read the row — the stored value survived
- [x] 2.4 Added a fourth ink type and it appeared on the form by itself; strip wrapped to 2 lines, no
      overflow, and the deal's own retired value stayed selected. Test row removed afterwards
- [x] 2.5 🔴 PASSED, verified with pdf.js on the rendered contract. ⚠ The clause is **worded per
      machine** and this entry's "Transport Terms:" is not what it says on either deck checked —
      Position Printer prints `Trade Terms (Machine): Ex-Work Surat`, Homer K24 prints
      `Delivery Terms: CIF`. What matters is that `{{trade_term}}` resolves, and it does, on both. No
      `{{token}}` left unresolved anywhere in either paper

### OCPI-27 · Machine category and No. of print heads become mandatory  `[x]`
*Raised 2026-09-02 · Asked for by Ritesh Bhai*

**The ask.** In *Machine details* (section A), two fields carry no asterisk and are not required:

| Field | Key | Today | Wanted |
|---|---|---|---|
| **Machine category** | `machineCategoryId` | optional | **mandatory** |
| **No. of print heads required** | `headCount` | optional | **mandatory** |

✅ **Ink type and Platter stay optional** — confirmed correct as they are. Do not touch them.

#### Where the change goes

OCPI-15 replaced the old hand-written checks with a declarative list: `REQUIREMENTS` in
`lib/completeness.ts`, each entry a key plus a `tier` of `"generate"` or `"approval"`. Neither of these
two keys is in that list at all. So this is **two rows added to one array** — plus the asterisk, which
the same list already drives, so the form and the blocker cannot disagree.

⚠ **`REQUIREMENTS` order is the FORM's reading order**, deliberately — somebody working down the missing
panel works down the page. Both keys belong in section A, near `machineId` / `machineCount`, **not
appended at the end**. (Separately: `FIELD_LABEL`'s order is the revision-diff row order and must not be
disturbed — different list, different rule.)

#### Which tier — and an honest note on the category

**`headCount` → `approval`.** It can genuinely be blank, it prints on the contract as the number of heads
supplied, and OCPI-15 settled that only the barest identity blocks Generate.

**`machineCategoryId` → `approval` as well**, but with eyes open:

🟢 **Choosing a machine already sets the category** — `chooseMachine` snaps it (OCPI-14), and all 24
existing deals were back-filled. So a deal that has a machine always has a category, and a deal with no
machine is already blocked on `machineId`. **The rule will therefore almost never fire on its own.**

That is not a reason to skip it. The value Ritesh Bhai is actually asking for here is **the asterisk** —
the screen saying this field matters — plus a guard against a future path that sets a machine without a
category. Both are worth having. Just do not expect it to catch anything today, and do not let anyone
"simplify" it away later on the grounds that it never fires; the note above is why it exists.

#### Checklist

- [x] 1.1 Two entries added to `REQUIREMENTS` in `lib/completeness.ts`, in FORM order within section A —
      `machineCategoryId` before `machineId`, `headCount` after `machineCount`. Neither needs a `label`
      override: `FIELD_LABEL` already matches the form's captions exactly
- [x] 1.2 Asterisks confirmed on screen. ⚠ They were NOT automatic, and that is worth recording: both
      `FieldLabel`s were missing `required={req.has(…)}` **and** `anchor={FIELD_ANCHOR(…)}` altogether,
      so the field could not be marked or jumped to. Not a second source — simply never wired
- [x] 2.1 Pulled live with `pg_get_functiondef`. **Neither `fms_ocpi_submit_quotation` nor the CHECK
      carries either column, and NO SQL CHANGE WAS MADE.** The RPC's own header says it mirrors the
      CHECK conjunct-for-conjunct and is *never stricter*, and that the FORM is deliberately stricter
      already in two places (print head, centering inclusion) so it refuses first, by field name. These
      two make it four — the documented, intended direction, not a disagreement
- [x] 2.2 ⚠ CHECK constraint untouched, as required
- [x] 3.1 `npm run build` — clean
- [x] 3.2 Browser: clearing head count moved the gate to *"2 answers are still needed"*, and clearing
      the category made the panel name **"Machine category"** and **"No. of print heads required"** in
      form order. The customer-copy card correctly names only the head count (see 3.5)
- [x] 3.3 🔴 **COUNTED BEFORE APPLYING — it is 7, not zero, and it was put to Ritesh Bhai, who said
      ship both rules anyway.** Four are already past the gate at `awaiting_quotation_approval` and are
      blocked only if sent back for rework — **AADESH DIGITAL PRINTS**, **LOTUS FIVE DIGITAL
      WORLD-MACHINE**, **SWAMI TEXTILES PVT. LTD (UNIT-II)** and `ZZ TEST OCPI-15 gate move`. Three are
      drafts: **LOTUS FIVE DIGITAL WORLD** (the one real deal blocked today), `Growth Saga` (already
      blocked on `machineId`) and `ZZ TEST Kesari Textile Mills`. Someone should fill the head count on
      those. Blank `machine_category_id` is 2 deals, both already blocked on the machine
- [x] 3.4 Ink type and Platter still optional — no asterisk, no block. Confirmed on screen
- [x] 3.5 🟢 **ONE THING THIS ENTRY DID NOT ANTICIPATE.** `quotationPdf.ts` prints *"No. of Print Heads
      Required"* on every summary sheet, blank when null — so making it required qualifies it for
      `CUSTOMER_FACING` in `QuotationEditor.tsx`, the card that warns what the customer will see blank.
      It is added. **Machine category is NOT**, deliberately: it prints on no paper, so warning about
      it would name a blank that does not exist
- [x] 3.6 ⚠ **`0` IS A LEGAL ANSWER, and it has to be.** 5 machines have no head type mapped at all —
      the three Pengda models, Label Printer, Book Printer — so a machine that genuinely carries none is
      answered with a zero. The box takes digits, `isAnswered` reads `"0"` as answered, and the column's
      CHECK allows `>= 0`. Exactly one deal sits on such a machine and it is already in the list above,
      so the rule blocks no additional deal

### OCPI-28 · The real dryer list from Bushra — exactly what to ask for  `[!]`
*Raised 2026-09-02 · Asked for by Ritesh Bhai · **blocked on Bushra** · the standing [Waiting for](#waiting-for) row is line 48*

**Why this exists.** The *Waiting for* row has said "the REAL dryer names" since 29-Aug, and nothing has
come back. This entry is the row made **answerable** — a precise list Bushra can work through, rather
than a request she has to interpret.

#### What is in the system today — all six are invented

| Category | Dryers on file |
|---|---|
| **Chinese** | Chinese 2-Chamber Dryer — Electric · Chinese 3-Chamber Dryer — Thermic Fluid · Chinese 4-Chamber Dryer — Gas Fired |
| **Indian** | Indian 2-Chamber Dryer — Electric · Indian 3-Chamber Dryer — Thermic Fluid · Indian 4-Chamber Dryer — Gas Fired |
| Not Applicable | none, correctly |

🔴 **These are placeholders and NOTHING ON SCREEN SAYS SO ANY MORE.** They carried a `[SAMPLE]` prefix
until OCPI-8 removed it on 01-Sep at the client's instruction. The prefix existed precisely because
**a dryer name prints on the customer's quotation** — it made accidental use visible on the paper
instead of passing silently. Today *"Chinese 2-Chamber Dryer — Electric"* reads on a signed contract
exactly like a real product. **11 of the 28 machines take a dryer**, so this is live on every Direct deal.

🟢 **One real name is already known.** The `JP K EVO` deck names **POWER-D Dryer (ELECTRIC)** — electrical
heating H18, third passage H18, folder H18. So the list is not starting from nothing.

#### The ask for Bushra — five questions, in order of what unblocks most

- [ ] 1 **The Indian dryer models actually sold** — the exact names as they should print on a contract.
- [ ] 2 **The Chinese dryer models actually sold** — same.
- [ ] 3 **Is "POWER-D Dryer (ELECTRIC)" one of them, and which category?** It is on the JP K EVO deck, so
      it is real; we just do not know where it belongs.
- [ ] 4 **Are "number of chambers" and "heating medium" properties of the DRYER MODEL, or per deal?**
      They are free-text per deal today. ⚠ The client's own machine sheet has **CHAMBER · HEATING MEDIA**
      columns and they are **blank for every machine that takes a dryer** (recorded under OCPI-3 §K), so
      nobody has ever answered this. If they belong to the model, they should prefill from the master and
      stop being typed by hand on every quotation.
- [ ] 5 **Should a dryer machine be offered "Not Applicable" at all?** It is currently a valid choice and
      OCPI-8 made it hide the whole dryer block. Fine as a deliberate answer; worth confirming it is one.

#### What happens when the answer arrives

- [ ] 6 Replace the six placeholders — **rename in place where a real model corresponds, insert/deactivate
      otherwise.** ⚠ `fms_ocpi_deals.dryer_name` stores the **text, not an id**, so renaming cannot break a
      saved quotation — but a **frozen revision keeps printing whatever it froze.** Any deal already
      issued on a placeholder name keeps that name on its paper for ever. **Check for those before
      renaming and tell Ritesh Bhai the list.**
- [ ] 7 If the answer to Q4 is "the model", add the two columns to `fms_ocpi_dryers` (additive) and
      prefill the deal fields from the chosen dryer — leaving them editable, since a deal can vary.
- [ ] 8 Close the *Waiting for* row at line 48, and correct OCPI.md's note that the placeholders are
      removable with `delete … where name like '[SAMPLE]%'` — **that statement no longer matches anything.**

⚠ **Until this lands, there is no way to tell a placeholder from a real dryer** — not in the master, not
on a deal, not on a contract. That is the cost of dropping the prefix, and it was accepted knowingly;
it just makes this the most time-sensitive of the outstanding data asks.

### OCPI-29 · GST % comes off the form — it is company policy, not a per-deal question  `[x]`
*Raised 2026-09-02 · Asked for by Ritesh Bhai*

**The ask.** The deal value is entered excluding GST, and the **GST %** box beside it is always 18. Asking
it on every quotation invites a typo into a tax figure and adds nothing. Remove the input.

🟢 **The data agrees.** Of 28 deals, **21 carry `gst_rate = 18.00` and not one carries anything else.**

#### 🔴 It is 18 **or nothing** — never 0, and that distinction is load-bearing

The other **7 deals carry NULL**, and that is correct, not missing: `branching.ts:442` hides the field on
a **High Seas** deal, the server stores NULL, and `quotationPdf.ts:176` omits the GST row from the paper
entirely. The comment there says why:

> *"HIGH SEAS SALE ATTRACTS NO GST AT ALL, and a row reading `0% GST — ₹ 0` is a different claim from no
> row at all."*

So this task removes **a question**, not **a value**. After it:

| Deal type | `gst_rate` | The paper |
|---|---|---|
| Others | **18**, from config, never typed | `GST @ 18%` with the amount |
| **High Seas** | **NULL**, as today | **no GST row at all** |

⚠ **Do not "simplify" the High Seas branch away with the input.** Deleting the field and defaulting
everything to 18 would put an 18% tax line on a High Seas contract that legally attracts none.

#### 🟢 The single place to set it already exists

`fms_ocpi_config` holds **`default_gst_rate`**, read at `ocpiFetch.ts:543` with a fallback of 18. So the
rate is already configurable without a developer — the form field is a second, redundant way to set the
same thing. Removing the input leaves the config as the one source, which is the right shape.

- [x] ✅ **SETTLED 02-09-2026 — DEVELOPER-ONLY, and that is the chosen answer.** Ritesh Bhai: *"I don't
      think that will change. If it will change in the future, then the developer will change this."*
      So `fms_ocpi_config.default_gst_rate` is the single source and nobody needs a screen for it. **No
      admin UI is in scope** — do not build one.

      ⚠ **Then the config row must be the ONLY place the number lives.** Today `"18"` is also hardcoded
      in `EMPTY_DRAFT` (`fieldSpec.ts:408`) and in `fromDeal` (`:1007`), plus a `?? 18` fallback at
      `ocpiFetch.ts:543`. Four copies of a tax rate is exactly how a "developer will change it" turns into
      a rate changed in three places and still wrong in the fourth. **Collapsing them is the substance of
      this task, not a tidy-up** — the removed form field is the easy half.

#### 🟢 Nothing in any template depends on it

`{{gst_rate}}` is a documented token (`tokens.ts:285`) but **ZERO machine templates use it** — verified.
So unlike `delivery_days` (OCPI-18), removing the input leaves no ruled blank in any contract. Keep the
token registered; it costs nothing and the summary sheet still resolves the rate.

#### The build

- [x] 1.1 Input removed, and the layout twin's condition with it — `sm:col-span-2` is now unconditional,
      so the value field always fills the two remaining columns. ⚠ A one-line hint was ADDED to that
      field: the caption says *"excluding GST"* and the rate is no longer visible anywhere, so it now
      reads *"GST at 18% is added on the papers"* — **read from the config row, so it is not a fifth
      copy**, and suppressed on a High Seas deal by the same `show("gstRate")` the box used
- [x] 1.2 Collapsed to **one config row + one shared TS constant**, `DEFAULT_GST_RATE`. `EMPTY_DRAFT`,
      `draftFromDeal` (which now takes the config rate as an argument) and `ocpiFetch`'s `?? 18` all
      read it. ⚠ It had to be declared **above `EMPTY_DRAFT`**, beside `CONSUMABLES_SUPPLIER` — the
      object literal reads it at module load, so anywhere lower is a temporal-dead-zone error
- [x] 1.3 `branching.ts` rule and comment untouched
- [x] 2.1 🔴 **PULLED LIVE, AND IT CHANGED THE BUILD.** `fms_ocpi_write_oc` derives the tax from the
      **PAYLOAD**, not from the config — `nullif(p->>'gst_rate','')::numeric` — so a form that stopped
      sending the key would have derived a null amount, dropped the tax row from both papers and
      understated every Others total by 18%, silently. **The draft still carries `gstRate` and the
      payload still sends `gst_rate`**, and a `withGstRate` normaliser in `useQuotationDraft` fills it
      from config before `clearHidden` on both payload builders, so an Others deal can never send blank
- [x] 2.2 ⚠ CONFIRMED ON LIVE DATA, three ways. Saved an Others deal through the GST-less form:
      `gst_rate 18.00`, `gst_amount_inr 207,000.00`, `total_inr 1,357,000.00` — **byte-identical** to the
      figures recorded before the change. Saved a High Seas deal: `gst_rate` still NULL, total unchanged.
      Created a brand-new deal (the other seeding path) and it saved with `gst_rate 18.00` and a correctly
      derived `180,000` / `1,180,000`
- [x] 2.3 ⚠ **BOTH RENDERERS, NOT ONE.** This entry cites `quotationPdf.ts:176`; `ocPdf.ts:429` does the
      same on the detailed sheet, and its own comment records the bug it fixed — it used to read
      `gstRate === null ? 18 : gstRate` and printed *"+ 18% GST Value INR"* with a blank figure on
      exactly the deals that carry no tax. Both were checked

#### Verify

- [x] `cd frontend && npm run build` — tsc strict + vite, clean
- [x] 🔴 **PASSED, both papers, verified with pdf.js.** Others (ZZ TEST Meridian Fabrics): the summary
      prints `GST @ 18%  ₹ 2,07,000` and `Total Value (INR)  ₹ 13,57,000`; the detailed sheet prints
      `+ 18% GST Value INR  ₹ 2,07,000` and `Total Value INR  ₹ 13,57,000`. Identical to the figures
      recorded before the change
- [x] 🔴 **PASSED.** High Seas: the only occurrence of "GST" on the summary is the customer's `GST No. :`
      label — **no rate row, and no zero row** — and the detailed sheet has none either. Totals
      unchanged (₹ 71,30,663.2 and ₹ 41,96,400)
- [x] An older deal opens and prints exactly as before; no `{{token}}` left unresolved on either paper
- [x] The GST box is gone and the field beside it fills the row correctly

### OCPI-30 · More than one house format for payment terms, with blanks to fill  `[x]`
*Raised 2026-09-02 · Asked for by Ritesh Bhai · extends OCPI-20, which shipped ONE format and the button*

**The ask.** OCPI-20 gave *Terms of payment* a single house format and a **Use this format** link. One
format does not cover the deals actually being written. Offer the **five to seven** shapes the business
really uses, each insertable, with **blanks where the numbers go**.

#### What the deals actually say — 24 deals, 12 distinct wordings

| Stored | Deals |
|---|---|
| `25% advance with the order, 75% against the shipping documents.` | **13** *(the seeded house format)* |
| `30% with order, 70% against shipping documents` | 1 |
| `50% advance with order, 50% before dispatch` | 1 |
| `50% with order, 50% before dispatch` | 1 |
| `30 % advance and rest PDC cheque` | 1 |
| `30% ADVANCE REST 10 PDC CHEQUE` | 1 |
| `40% and GST advance and  balance 60% in equal 4 PDC` | 1 |
| `Rs .5,00,000.00 Advance & Balance 6 Equal Installment after delivery` | 1 |
| `Rs .5,00,000.00 Advance & Balance 6 Equal Instalment.after delivery` | 1 |
| `Rs.5,16,380/- advance and balance  Rs.7,71,000/-in equal 3 PDC (2,57,000 x 3)` | 1 |
| `Payment in 3 equal monthly installment (June ,July & August)` | 1 |
| **`na`** | **1** — a live defect, see the foot of this entry |

⚠ Strip the seeded 13 and **every remaining deal is worded differently from every other.** Two pairs
differ only by a typo — *Installment* vs *Instalment*, `50% advance with order` vs `50% with order` —
which is the clearest possible evidence that people are retyping from memory.

#### The six formats the data actually contains

Blanks are `______`, deliberately **not** `{{token}}` syntax. The module's own reasoning
(`tokens.ts:8-17`) is that a printed `________` reads as *a blank someone must fill*, whereas a stray
`{{x}}` reads as *software that broke*. If a salesperson inserts a format and forgets to complete it, an
underscore run is the failure that gets noticed and corrected.

| # | Format | Seen as |
|---|---|---|
| **1** | `___% advance with the order, ___% against the shipping documents.` | the current house format · 14 deals |
| **2** | `___% advance with the order, ___% before dispatch.` | 2 deals |
| **3** | `___% advance with the order, balance ___% in ___ equal PDC cheques.` | 3 deals |
| **4** | `___% plus GST advance with the order, balance ___% in ___ equal PDC cheques.` | 1 deal — the GST-on-advance variant, kept separate because it changes what the advance covers |
| **5** | `₹______ advance with the order, balance in ___ equal instalments after delivery.` | 2 deals — a **rupee** advance, not a percentage |
| **6** | `₹______ advance with the order, balance ₹______ in ___ equal PDC cheques (₹______ × ___).` | 1 deal |
| **7?** | `Payment in ___ equal monthly instalments (______).` | 1 deal — months named, no advance at all |

- [x] ✅ **APPROVED 02-09-2026 — all seven formats, as worded in the table above.** Ritesh Bhai reviewed
      the list derived from the 24 deals and accepted it. Build exactly those seven, to the character.
- [x] ✅ **SETTLED 02-09-2026 — SEVEN FORMATS, no eighth.** "100% advance" was offered and declined for
      now: *"just seven options are good to go for now."* It appears in no deal on record either. **Do not
      add it.** The field stays free text, so a full-advance deal can still be typed by hand — and if it
      turns out to be common, an eighth format is a one-line addition to the constant.

✅ **SETTLED 02-09-2026 — ALWAYS `₹`, ON EVERY DEAL INCLUDING USD.** Ritesh Bhai: *"in the USD we are
always going to show the conversion, so we can just show the rupee amount there."* A dollar deal already
carries a **frozen** FX rate and its rupee equivalent (`fxRate` / `dealValueInr`), and both print — so
payment terms stated in rupees are consistent with the rest of the paper, not a mismatch.

🟢 **This makes the formats plain strings.** No currency placeholder, no substitution, nothing to resolve
at insertion time, and — the reason this matters — **no bug when a salesperson switches the deal's
currency after inserting a format.** Had the symbol followed the deal, an INR sentence typed before a
switch to USD would have been left saying the wrong thing, with a silent rewrite of a typed commercial
term as the only "fix". That whole class of problem does not arise. Hardcode `₹` in formats 5, 6 and 7.

#### How to offer them

- [x] The single **Use this format** link is now the seven sentences printed IN FULL as one-click rows
      under the box. Full sentences rather than a menu because one click is what made OCPI-20 work and a
      menu costs a second — and because the wordings being *visible* is the actual fix for people
      retyping from memory. Verified: an empty box fills on the first click
- [x] ⚠ Overwrite guard kept and generalised. State went from a boolean to `pendingFormat: string | null`
      — with seven formats the answer to "replace with what?" is the format itself, and a boolean would
      have made Replace insert whichever one the code happened to name. The confirm appears **in the row
      that was clicked**, so the sentence being offered stays in front of the person deciding. Verified:
      clicking a format with text typed left the box untouched until Replace was pressed, and then
      inserted the right one; typing clears the pending state
- [x] ⚠ Field is still a free-text `TextArea`
- [x] ⚠ One exported constant, `PAYMENT_TERMS_FORMATS`. The old `PAYMENT_TERMS_FORMAT` is gone rather
      than kept as an alias; the placeholder is `PAYMENT_TERMS_FORMATS[0]`
- [x] The hint names no format — it reads *"Common formats — click one to insert, then fill the
      blanks."* Verified in the browser that all seven render to the character, `₹` included

#### Still outstanding from OCPI-20 — a person, not code

🔴 **One deal still has `payment_terms = 'na'`**, and that prints in the payment clause of its contract.
Formats stop new bad answers; they cannot repair a row already written. It needs correcting by whoever
owns that deal. Same shape as the consumables values closed under OCPI-22.
---

### OCPI-31 · A contract for a machine with NO DRYER still sells a dryer  `[x]`
*Found 2026-09-02 by OCPI-12's print audit · **on a document the customer signs***

🔴 **The deal says Not Applicable and the contract still sells a dryer.** OCPI-8 gated the deal-derived
dryer block correctly — on `dryer_type = Not Applicable` the four dryer rows are gone from both papers,
verified on a rendered page. What is **not** gated is the MACHINE TEMPLATE'S OWN WORDING, which is where
the dryer is actually described. `K64-4-no-dryer-long-text-oc.pdf` prints, on a deal with no dryer:

- spec row — `Dryer: AC380V three phase | 16 kW | 50Hz/60Hz`
- spec row — `Dryer   Oil + Electric`
- and, in the line above the signature block, under **TOTAL NET AMOUNT OF THE SUPPLY**:
  `DIGITAL TEXTILE PRINTING MACHINE WITH STANDARD ACCESSORIES WITH 64 PRINTHEADS AND CENTERING SYSTEM
  & DRYER (Model No: HM1800B-TK64-A1)`

The third one is the commercial problem: the customer signs for a supply that names a dryer the deal
does not include.

#### How wide it is — counted live, 02-09-2026

| | Machines |
|---|---|
| name a dryer in `supply_description` | **9 of 21** — and **all 9 are Direct**, the only category where "Not Applicable" can be chosen |
| name a dryer in their spec rows | **10 of 21** |
| name a **centering system** in `supply_description` | **2 of 21** — K64 and Homer K32 |

#### 🔴 Recounted on the day it was built, and three of those figures were wrong

- **Only 7 of the 9 SELL a dryer.** JPK says `(Without Dryer)` and MP5000 says `without dryer` —
  unconditionally, so a Direct deal that *does* include a dryer denies one. The mirror defect, fixed in
  the same pass with `[[if !dryer]]`. JPK's one live deal has an Indian dryer.
- **Spec rows are 11, not 10** (9 Direct + P8D/P8S), and they come in **two shapes**: five whole `Dryer`
  rows, and eight dryer LINES buried inside a multi-line `Electrical Voltage` value. A whole-row rule
  would have missed eight of them.
- **The centering count of 2 is right, and the recount that said 1 was wrong** — it searched only
  `centering`. K64 says CENTERING SYSTEM and **Homer K32 says CENTRING DEVICE**. The same trap the entry
  flags for the forex clause, one line above, in the other spelling.

#### 🔴 And the three sites named above are FIVE

Beyond `supply_description` and `spec_rows`, the same defect lives in a **composition bullet** (Rocket's
`Dryer System`) and inside a **section body** (Rocket's `SCOPE OF SUPPLY`, a `Dryer System` heading and a
paragraph describing four drying chambers and oil heating). **Both Rocket deals on record are
`dryer_type = 'Not Applicable'` and one has been issued** — so this was already live on a signed
contract, in a place this entry never looked. JPK's whole 14-line `DRYER INFORMATION` section is the
sixth and is deliberately left: it wants section-level visibility, which is a different mechanism.

#### 🔴 THE DATABASE IS NOW AHEAD OF THE DEPLOYED FRONTEND — DEPLOY

The migration ran on 02-09-2026 while the parser was still only on `daily-reports`. `[` and `]` are not
in `pdfBrand`'s `GLYPH_FALLBACK` and Poppins carries both, so **until `master` is deployed, an order
confirmation generated in production prints `[[if dryer]] & DRYER[[/if]]` on the page** for the 11
machines the migration touched. It was applied on instruction, in a quiet window — the last deal activity
was three hours old — with the rollback rehearsed first.

**Until the deploy lands, the way back is one command**, proved on live data before it was needed:

```
node flip.mjs old     # restores all 15 rows byte-for-byte to the pre-migration text
```

It was run for real — rollback, byte-identical comparison against the frozen baseline, then re-apply —
so this is a rehearsed procedure rather than a written intention.

⚠ Separately: `replaceSections` is a delete-then-reinsert of whatever the Machine template screen is
holding, and that screen seeds its state once and never re-seeds. **An admin who had that tab open across
the migration and presses "Save template" silently reverts it for that machine** — sections, spec rows and
supply description alike. The assertion block is re-runnable as a standalone `select` for exactly this
reason; run it again the next morning. It must read **11 / 5 / 8 / 1 / 2 / 4** with 0 stray markers.

The centering half is the same defect: `incl_centering = false` still prints "AND CENTERING SYSTEM".

#### The traps

⚠ **This is TEMPLATE CONTENT, not a renderer bug.** `ocPdf.ts` prints `spec_rows` and
`supply_description` verbatim, which is correct — they are the machine's own description. The fix has to
decide *where* the condition lives: a token, a conditional section, or two supply descriptions per
machine.

⚠ **A token is the cheap route and it has a cost.** `{{dryer_clause}}` resolving to "& DRYER" or "" would
fix the supply line without touching the renderer — but it needs a migration over 9 machine rows, and
`tokens.ts` warns that a template using a token the resolver does not know prints a ruled blank. The
token must exist before the migration runs. Same ordering OCPI-18 had to respect.

⚠ **The spec rows are a different question from the supply line.** A dryer's electrical draw on the spec
sheet of a machine that CAN take a dryer is arguably correct even when this deal has none. Settle with
the client whether all three go or only the supply line.

#### Checklist
- [x] 0.1 Asked and answered 02-09-2026: **everything the deal would have supplied** goes — the supply
      line, the spec rows, the composition bullet and Rocket's section block. JPK's whole `DRYER
      INFORMATION` section stays (it wants section-level visibility, and JPK's only deal has a dryer)
- [x] 1.1 **An inline `[[if dryer]]…[[/if]]` in the template text**, resolved by `lib/conditions.ts` in
      the same pass as `{{tokens}}`. A token cannot do it — `resolve()` prints a ruled blank for an
      empty value, so it could not resolve to nothing without changing `resolve()` anyway. Reasoning in
      full in OCPI.md and in the file's own header
- [x] 1.2 **APPLIED 02-09-2026** —
      `20261104120000_fms_ocpi_the_deal_decides_what_the_template_sells.sql`. 15 rows, 24 fields: 11
      supply-line wraps across 9 machines, 5 whole `Dryer` spec rows, 8 dryer lines inside multi-line
      spec values, 1 composition bullet, 2 section lines, 4 forex clauses. Every count asserted against
      the rows afterwards, and 0 unbalanced markers anywhere
- [x] 2.1 Rendered headlessly through the real `buildOcPdf` from the live rows and read back with
      pdf.js: on a no-dryer Homer K32, K64 and Rocket the dryer words are gone from the supply line,
      the spec table, the composition and SCOPE OF SUPPLY
- [x] 2.2 And the with-dryer page on the same machine is **byte-identical to today** — checked on Homer
      K32 (Chinese) and on the real K64 USD deal

---

### OCPI-32 · The dryer warranty is silently lost, and the screen says it does not exist  `[x]`
*Found 2026-09-02 by OCPI-12's print audit*

🔴 **Fill the form in the natural order and the dryer warranty disappears.** Pick the machine, save the
draft, come back and choose the dryer category — and the warranty that `chooseMachine` prefilled from the
machine master is gone for good.

The chain:

1. `chooseMachine` prefills `dryerWarranty: m?.dryerWarranty ?? ""`.
2. `branching.ts` shows `dryerWarranty` only when `hasDryerDetails` — which needs a dryer category.
3. **`clearHidden` drops it on save**, because at that moment no category is picked.
4. Choosing the category afterwards reveals the read-out again and **nothing re-fills it**. Only
   re-picking the same machine does, and nothing tells anybody that.

**Two consequences, and the first is worse.** The read-out then reads **"Not applicable"** — an
assertion, not a blank — on a K64 whose master says **12 Months**. And the summary sheet's *Dryer
Warranty* row vanishes, because `quotationPdf.ts` filters warranty rows with an empty value.

Proved both ways, 02-09-2026: the read-out said "Not applicable"; re-picking the same machine restored
"12 Months" instantly. `K64-1-everything-included-summary.pdf` has no Dryer Warranty row; deals 2 and 3,
which carried the value, print one.

#### The traps

⚠ **"Not applicable" is the right words for the wrong reason.** `WarrantyReadout` renders it for an
empty value, which IS correct on the 15 models with no head warranty. Here the same words state
something false. Whatever the fix, the read-out must be able to tell *"this model offers none"* from
*"we lost it"*.

⚠ **Do NOT fix it by removing the field from `clearHidden`.** The rule that a hidden question stores no
answer is the module's defining invariant and has a twin in `fms_ocpi_write_oc`. The fix belongs on the
re-fill side: prefill when the dryer category is chosen, the way `chooseMachine` does when the machine is.

⚠ **The same shape may exist for the other two warranties.** They are not gated on a dryer category so
they survive today — but check before assuming.

#### Checklist
- [x] 1.1 The dryer-category `onChange` fills `dryerWarranty` from the machine master **when the box is
      empty** — `carry`'s rule — and does it in the SAME patch that sets the category, which is what
      makes `clearHidden` keep it. The pattern is `CustomerPicker`'s `gstNo` + `gstAvailable`.
      `clearHidden` is untouched
- [x] 1.2 `WarrantyReadout` takes the master value and has three states: the value · "Not applicable"
      when the model genuinely offers none · **"Not on this deal — the model says 12 Months"** when it
      was lost. ⚠ It is `text-orange`: `text-ryg-amber` was the obvious class and **there is no amber in
      the palette**, so it would have emitted no rule and rendered as ordinary navy text
- [x] 1.3 Checked, not assumed: `printerWarranty` and `headWarranty` have **no entry in
      `PART_A_VISIBILITY`**, so `clearHidden` never reaches them and `fms_ocpi_write_oc:471-472` writes
      them unconditionally. `headType` — the third thing `chooseMachine` prefills — is ungated too.
      Proved on the live server: after the save that loses the dryer warranty, both still hold their
      master values
- [x] 2.1 ⚠ **Not via the browser** — its profile was in use by the user's own Chrome. Done instead
      through the app's own `clearHidden` / `dealFacts` / `payloadFromDraft` / `draftFromDeal` against
      the **real `fms_ocpi_save_draft` RPC**, which tests the claim that actually matters: the value is
      in the ROW, not just on the screen. The old handler was run too, so the difference is attributable
      rather than asserted. Throwaway deal deleted
- [x] 2.2 The row holds `12 Months` after the round trip, so `quotationPdf`'s
      `.filter(r => r.value.trim() !== "")` keeps the row: 3 warranty rows print, Dryer Warranty
      among them

#### ⚠ Two live deals still carry the loss

Counted 02-09-2026: **2 deals** whose machine master has a dryer warranty, whose dryer category is real,
and whose own column is empty. The fix stops new ones; it does not repair a row already written — and it
deliberately does not, because re-picking the machine is how a person takes the master's answer. They
need somebody to reopen them. Same shape as OCPI-20's stranded `payment_terms = 'na'`.

---

### OCPI-33 · The forex clause prints on rupee contracts  `[x]`
*Found 2026-09-02 by OCPI-12's print audit*

**The summary sheet was fixed for this and the contract was not.** `quotationPdf.ts` prints the dollar
clause on a USD deal alone, and says why: *"A rupee customer used to be shown, and asked to agree to, a
term that could not apply to them."*

The **order confirmation** still carries it on every deal, because it is literal text inside the
machine's own SALE CONDITIONS section rather than something the renderer decides. All three INR K64
contracts rendered in the audit print *"Forex Impact Clause: If payment terms exceed 3 months with equal
instalments, the Dollar exchange difference will be adjusted via Debit Note/Credit Note"*.

**4 of the 21** templated machines carry it. So the two papers of one rupee deal disagree on exactly the
point the summary was corrected for.

⚠ **Same shape as OCPI-31** — a condition the renderer knows about, expressed as unconditional template
text. If both are fixed, fix them the same way, or the next one will be a third mechanism.

#### Checklist
- [x] 0.1 Confirmed 02-09-2026 — USD deals only, matching the summary sheet
- [x] 1.1 The same mechanism as OCPI-31: `[[if usd]]…[[/if]]`. `isUsdDealRow` is now one exported
      predicate read by the OC's money rows, the summary's dollar clause and this condition, so the
      clause and the money printed inches apart on one page cannot disagree about the currency
- [x] 1.2 **APPLIED 02-09-2026** — in the same migration as OCPI-31. **Exactly 4**,
      asserted by the migration itself, and each keeps its own wording: two say *"Forex Impact Clause:"*,
      KoloRado Alpha 3 says *"Forex Clause Impact:"*, and Position Printer's is an unlabelled sentence
      with no "forex" in it at all — which is why searching for one phrase finds two of four
- [x] 2.1 Rendered INR and USD on the SAME machine (Rocket) through the real renderer and read both with
      pdf.js: the clause is on the dollar page only, and the rest of SALE CONDITIONS is intact on both.
      Position Printer checked separately — its clause is the LAST line of its section, so it exercises
      the trailing-blank trim rather than the mid-body one

---

### OCPI-34 · Five questions asked on screen that reach no document — decisions needed  `[!]`
*Found 2026-09-02 by OCPI-12's print audit · **questions for Ritesh Bhai, not defects***

The audit's field→document map (`OCPI-FIELD-MAP.md`, regenerate with `cd frontend && npm run field-map`)
found **18 fields that reach no document at all**. Most are documented-deliberate — `paymentType` and
`deliveryDays` were retired by OCPI-18 with the reasoning written down, `externalCentering` is frozen
history, `postWarrantyHeadPrice` had its token retired, and the identity columns were never meant to
print. These five were not decided by anybody.

1. 🔴 **`insuranceClauseAgreed` — agreed on screen, printed nowhere.** The clause TEXT prints as standing
   terms at the foot of the summary; the salesperson's Yes/No appears on neither paper. Meanwhile
   `dollarClauseAgreed` prints **"Clause Agreed: Yes"** on the same sheet. Two clauses, two treatments,
   one page. **Should the insurance agreement print beside its clause?**
2. 🔴 **The subsidized rates never reach the contract.** OCPI-7's figures print on the summary in full —
   *"Subsidized Ink Price ₹ 5,00,000"* with a note bounding it to 400 litres — and the order confirmation
   carries neither. A price promise, bounded to a quantity, on the quotation and not on the paper the
   customer signs. **Should it print on the contract too?**
3. **`customerEmail` and `customerMobile`** are captured on every deal and print nowhere. Plausibly
   right — the Attn line names the person — but nobody wrote it down.
4. **"Manufacturer's model no." claims a prefill that does not happen.** The hint reads *"pre-filled from
   the machine's template"*; nothing fills it, so the box is empty on every new deal. Harmless on paper
   only because **0 of 21** templates use `{{machine_model_no}}` — but the frozen document payload
   separately records the machine's own value, so screen and snapshot already disagree. That is the
   OCPI-24 shape, currently without consequences. **Fix the hint, or add the prefill?**
5. **`fms_ocpi_machines.doc_title` is never read by either renderer.** It is a REQUIRED choice on the
   Machines master, and both papers head from `docHeading(deal)` — ORDER CONFIRMATION / ORDER QUOTATION,
   from the OC number alone. So MP5000's **"OFFER QUOTE"** can never print. **Either the field drives the
   heading or it should come off the master.**

Also unresolved, lower stakes: `locationId` is neither asked nor printed, and the three FX provenance
columns (`fxRateAt`, `fxRateSource`, `fxRateOverridden`) are screen-only with no note saying so.

#### Checklist
- [ ] 0.1 Walk items 1–5 with Ritesh Bhai
- [ ] 1.1 Whatever is decided, write the reason next to the field — the map re-reads the code each time,
      so a documented "screen only" stops being a finding on the next run
- [ ] 1.2 Anything that should print becomes its own entry; this one is the decision, not the build

---

### OCPI-35 · One delivery question instead of two, with the detail each answer needs  `[x]`
*Raised 2026-09-02 · Asked for by Ritesh Bhai*

#### ⚠ OCPI-26 already converted this field — and this entry removes it

**OCPI-26 shipped before this was raised**, so *Delivery term* is **already a `ChoiceButtons` strip**
(`QuotationForm.tsx:2524`, reading `optsWithCurrent(TRADE_TERMS, draft.tradeTerm)`). That work is not
wasted — the control is exactly what the merged question needs — but **the separate field it lives in is
what goes.** Read this as *"fold the existing Delivery-term strip into the delivery question"*, not
*"build a new one"*. Nothing to undo; one control absorbs the other.

#### What is being asked

1. **The delivery options (CIF · EX Factory · FOB) show on *Others* too**, not only High Seas.
2. **The separate *Delivery term* dropdown goes** — it asks the same question twice.
3. **CIF → ask which port.**
4. **EX Factory → ask Surat or Noida.**
5. **High Seas + cost borne by Customer → ask whether it is end-to-end (factory to customer location)
   or port to port.**

#### The duplication is real, and the data proves it

Two fields ask the same thing with overlapping vocabularies:

| Field | Values | Shown when |
|---|---|---|
| `high_seas_via` | CIF · EX Factory · FOB | High Seas only (`branching.ts:431`) |
| `trade_term` | Ex-Work Surat · CIF · FOB · EX Factory | **both** deal types |

Live data, 28 deals:

| transport | `high_seas_via` | `trade_term` | deals |
|---|---|---|---|
| local | — | **Ex-Work Surat** | 16 |
| high_seas | CIF | CIF | 2 |
| high_seas | CIF | **NULL** | **2** |
| high_seas | CIF | **CIF Jebel Ali** | 1 |
| local | — | CIF | 1 |
| *(unanswered)* | — | — | 6 |

Three things fall out of that table:

🔴 **`trade_term` is NULL on two High Seas deals — so `Transport Terms: ________` is ALREADY PRINTING A
RULED BLANK on those contracts today.** That is a live defect, not a risk this task introduces. It exists
because the field is optional while the clause that consumes it is not.

🟢 **One deal already reads `trade_term = "CIF Jebel Ali"`.** Somebody typed the port into the trade term
because there was nowhere else to put it. **The feature being asked for is already being improvised by
hand** — the strongest possible case for asking for the port properly.

🟢 **A *local* deal already carries `trade_term = CIF`.** So Others deals genuinely do use CIF, which is
exactly why the options should not be gated to High Seas.

#### 🔴 The constraint that shapes the whole design

`{{trade_term}}` is live in the SALE CONDITIONS clause — `Transport Terms: {{trade_term}}` — on **~21 of
the 28 machines**. Delete the field and every one of those contracts prints a ruled blank. Same trap as
`{{delivery_days}}` in OCPI-18.

**So `trade_term` must remain the stored, printed answer.** The right shape is:

- **ONE delivery question**, shown on **both** deal types, retiring `high_seas_via` as an input.
- Its answer, **plus its detail**, composes into `trade_term` — which keeps feeding the token, so **no
  template migration and no ruled blank.**
- `high_seas_via` keeps its column (additive-only) but stops being asked.

Composed examples: `CIF Jebel Ali` · `EX Factory Surat` · `FOB`. ⚠ Note the first is **exactly what one
deal already has typed by hand** — evidence the composition matches how people actually write it.

⚠ **Store the parts as well as the composed string.** New nullable columns for the port and the factory
location. Keeping only the sentence means re-opening a deal cannot re-populate the controls and the
salesperson is back to editing free text — the mistake OCPI-30 exists to undo elsewhere.

#### The 16 "Ex-Work Surat" deals — NO MIGRATION

- [x] ✅ **SETTLED 02-09-2026 — leave them alone.** Ritesh Bhai: *"don't worry about the data or the
      existing deals because most of them are just dummy data."* **No back-fill, no rewrite of
      `trade_term`, no data task at all.** Old deals keep their stored text and their frozen papers, and
      re-opening one simply shows the value as-is.
      ⚠ Which makes the **unknown-value guard non-optional**: a deal holding `Ex-Work Surat` will not
      match any new button. Use the `optsWithCurrent` / `masterOpts` pattern (OCPI-21) or the strip shows
      nothing and one ↓ keystroke destroys the answer.

- [x] ✅ **SETTLED 02-09-2026 — it prints `Ex factory surat`.** Ritesh Bhai chose the new phrasing over
      the old `Ex-Work Surat`, so `Transport Terms:` on every future contract reads
      **`Ex factory surat`** / **`Ex factory noida`**.
      ⚠ **Confirm the exact capitalisation before shipping.** He typed it lower-case mid-sentence; the
      button says `EX Factory` and today's stored values are title-case (`Ex-Work Surat`). The composed
      string goes on a signed contract, so pick one casing deliberately — **`Ex Factory Surat`** is the
      likeliest intent and is consistent with everything else on the page. **Do not ship a mix.**
      ⚠ `Ex-Work Surat` therefore disappears from the vocabulary for new deals. Old deals keep it as
      stored text — which is exactly why the unknown-value guard above is required.

#### The three new conditional questions

| Answer | Then ask | Notes |
|---|---|---|
| **CIF** | **Which port** | ✅ **FREE TEXT** — settled 02-09-2026. No master, no picklist. Only one port has ever been used (*Jebel Ali*, typed by hand into `trade_term`), so there is no list to seed and inventing one would constrain a field nobody has mapped. ⚠ Give it a placeholder (*"e.g. Jebel Ali"*) — it composes into a printed clause, so a blank or a typo lands on the contract |
| **EX Factory** | **Surat or Noida** | Two buttons. ⚠ These are the same two cities as the company branches (OCPI-25) — check whether it should read from there rather than a second hardcoded pair |
| **High Seas + cost by Customer** | **"From manufacturer port to customer premises"** or **"From Indian port to customer premises"** | ✅ Wording settled 02-09-2026, Ritesh Bhai's own. 🔴 Asked **ONLY** when the bearer is **Customer** — settled: *"when we select a company, we don't have to ask this thing."* A third nested condition |

⚠ **These print, or they are pointless.** Decide for each whether it joins `trade_term`, gets its own
line on the papers, or is screen-only. **A field captured and never printed is the exact defect OCPI-12
exists to find** — do not create three more.

#### Checklist  — **BUILT AND VERIFIED 02-09-2026.** Live log: [OCPI.md](OCPI.md)

- [x] 0.1 ✅ **SETTLED — `Ex Factory Surat` / `Ex Factory Noida`, title case.** The BUTTON still reads
      `EX Factory`, because that exact string is what `fms_ocpi_deals_high_seas_via_check` allows and
      what the derived mirror writes; only the PRINTED term is title-cased. The form shows the composed
      value under the strip so the two cannot be mistaken for each other. Composed examples:
      `CIF Jebel Ali` · `Ex Factory Surat` · `FOB` ·
      `CIF Jebel Ali, from Indian port to customer premises`.
- [x] 0.2 ✅ **SETTLED — Customer only, and the two options are worded exactly:**
      **"From manufacturer port to customer premises"** · **"From Indian port to customer premises"**.
      When the **Company** bears the cost the question is **not asked at all**. ⚠ Note these are two
      *starting points*, not "everything vs part" — the difference is WHICH PORT the customer's leg
      begins from, so do not relabel them as end-to-end / port-to-port. ⚠ Both mention *customer
      premises*, so the field is dead on a Company-borne deal; the RPC nulls it there.
- [x] 0.3 ✅ SETTLED — the port is a FREE TEXT box, not a master. See the table above
- [x] 0.4 ✅ **SETTLED — the leg answer PRINTS, appended to the delivery term.** It therefore reaches
      all 21 contracts and the summary sheet with no template migration and no new token. A token would
      have printed nowhere until all 21 decks were rewritten — the OCPI-12 defect, created fresh.
- [x] 0.5 ✅ **SETTLED — Surat / Noida is a HARDCODED pair, and the drift is recorded rather than
      denied.** OCPI-25 wants the same two from `fms_ocpi_company_profiles`, but exactly one profile is
      active, so reading from the branches would render a one-button strip with Noida unreachable.
      Cross-referenced from OCPI-25, which is where the two lists reconcile.
- [x] 1.1 **FOUR additive nullable columns, not three** — `delivery_via`, `delivery_port`,
      `delivery_factory_city`, `delivery_leg`. The fourth is the base answer itself, and it is needed
      because `fms_ocpi_transport_coherent` forbids `high_seas_via` on an Others deal, and because
      without it *FOB* and *not answered yet* are indistinguishable. `high_seas_via` KEPT.
      ⚠ **Named `delivery_leg`, NOT `delivery_scope`** — that name is already a machine-template section
      key on 20 machines ("NOT INCLUDED IN OUR DELIVERY SCOPE").
- [x] 1.2 The composer → `trade_term`. **No template migration, no token change**, asserted in the
      migration: section count, section bytes and the count carrying `{{trade_term}}` all unchanged.
- [x] 2.1 One delivery control on both deal types, at the HEAD of section C; the old *Delivery term*
      dropdown removed. Container rule discharged item by item — its `clearable` (now conditional on the
      field being required, per `ChoiceButtons`' own rule), its `optsWithCurrent` guard and comment, its
      hint (now the composed read-out), its `FIELD_LABEL` entry (kept, relabelled in place because that
      key order is revision-diff history) and `TRADE_TERMS`, the list it was the only caller of, deleted
      with it. **Orphan sweep: 58 files, 0 candidates.**
- [x] 2.2 The three conditional follow-ups, with the nesting — the leg appears only on
      **High Seas AND cost by Customer**.
- [x] 3.1 ⚠ **ONE write RPC, not both — and that is a correction to this entry.** `fms_ocpi_write_oc`
      already writes `trade_term` unconditionally and `'trade_term'` is already in
      `fms_ocpi_save_draft`'s part-B key gate; the four new columns are **part A**, and
      `fms_ocpi_write_quotation` runs unconditionally. Only it changed, as a **transform of the live
      body** (`pg_get_functiondef`, anchor asserted unique, `replace`, assert, `execute`).
- [x] 3.2 🔴 **`high_seas_via` had to keep being WRITTEN, not merely retained** — a trap this entry did
      not list and the sharpest thing the build found. **Three constraints and one RPC demand it**, and
      `fms_ocpi_complete_when_submitted` is one of them: stop writing it and **no High Seas deal could
      ever be sent for approval again**, as a raw constraint violation naming no field. It is now
      derived from the merged answer in `payloadFromDraft`. **No CHECK was touched.**
- [x] 3.3 Applied **before** the frontend, with the **rollback rehearsed on live data** — down to
      baseline and back up, both verified by md5 of `pg_get_functiondef`.
- [x] 4.1 `cd frontend && npm run build` — clean.
- [x] 4.2 🔴 **14 PDFs rendered through the real renderers and read back with pdf.js** — 7 combinations
      × both papers. `Trade Terms:` is never blank, including the long composed terms; the contract
      wraps rather than truncates. **The two blank High Seas deals were FIXED** (QT-M0038, a real
      customer, and QT-M0036) from their own `high_seas_via`, asserted to exactly 2 rows.
      ⚠ **QT-M0037 and QT-M0046 could NOT be**, and the reason is recorded rather than guessed: they are
      `local` deals, and a local deal has no `high_seas_via` to derive from. **They need a person.**
- [x] 4.3 Older deals open and print unchanged — proved on all 30 live deals in SQL:
      `compose(hydrate(deal)) = deal.trade_term`, **30 of 30 MATCH**, including the 17 `Ex-Work Surat`
      and the hand-typed `CIF Jebel Ali`, whose port is recovered back into its own box.
- [x] 4.4 Deal type and cost bearer switched against the live RPC in a rolled-back transaction: the
      server cleared **exactly** what the form hides and nothing more, on all five rules. Money
      byte-identical.
- [ ] 4.5 ⚠ **NOT DONE — the form was never driven in a browser.** The Playwright profile was locked by
      another session's live Chrome and killing it was not on. Everything needing a rendered page was
      proved by running the real renderers headlessly instead; what is unclicked is the *interaction* —
      that the strip lights a retired value and that ↓ on the tabbed-to strip does not destroy it.
      Same mechanism OCPI-26 verified in a browser on this exact deal. **Worth one pass by hand.**


### OCPI-36 · The Performa Invoice — a third document, and the one every deal actually has  `[x]`
*Raised 2026-09-02 · Asked for by Ritesh Bhai · source folder:
`Misc/Bushra Reports/OCPI/2026.27 OC&PI` (27 real deals, 101–127) · read with pdf.js, not parsed*

**The ask.** The module issues two papers — **Summary** and **Detailed sheet**. Bushra's real deals issue
**three**. The missing one is the **Performa Invoice (PI)**, and the tabs should read, in this order:

> **1. Summary · 2. PI · 3. OC**

Then *Download both* becomes **Download all**, with a tick against each paper, **all three ticked by
default**, so a person can take one, two or three.

#### ✅ Every open question was answered on 02-09-2026 — this entry is READY TO BUILD

| | Decision |
|---|---|
| **Pages** | All three — letter · sales page · invoice. **8 of the sales pages already exist** and are lifted from the current PIs; ~6 families await Bushra |
| **Number format** | **Bushra's** — `OTPL/OC/128/26-27`. 🔴 This changes `ocNumber()` and the OC too |
| **When minted** | **At quotation generation**, not at approval. 🔴 One serial serves PI and OC |
| **Split item PIs** | **No** — one PI per deal. Ink and dryer are rows, not papers |
| **HSN · MFG · origin** | Three optional boxes on the machine master; **print only when filled** |
| **Delivery line** | The **same tentative date the contract prints**. `delivery_days` does not come back |
| **`QT-M####`** | **Internal only.** All three papers carry `OTPL/OC/…` and nothing else |

🔴 **The two riskiest are the numbering ones, and they are the same edit.** Moving `oc_no` earlier breaks
`docHeading()`, which decides whether a paper says ORDER QUOTATION or ORDER CONFIRMATION purely by asking
whether the number exists. **Fix that test before moving the number**, or every quotation issues itself as
a signed contract. Details under Q2 and Q3.

⚠ **A wording correction, because it changes what gets built.** The ask said *"the detailed one is the PI
document."* It is not. The module's *Detailed sheet* is `ocPdf.ts`, headed **ORDER CONFIRMATION /
ORDER QUOTATION**, drawn from each machine's transcribed deck — that is the **OC**. The PI is a
different, shorter paper that does not exist in the module at all. The requested tab order (Summary · PI ·
OC) is what confirms it. **Nothing is being renamed; a third renderer is being added.**

#### 🟢 The PI is the document that ALWAYS goes out — the OC often does not

Counted across the 27 folders:

| | Folders |
|---|---|
| Hold a **PI** | **25 of 27** |
| Hold an **OC** | **12 of 27** |
| Hold a **PI and no OC** | **14** |

⚠ The two exceptions name their files after the folder rather than the paper, so the true PI figure is
25–27. Either way: **the module has been shipping the rarer document and not the universal one.** That is
the finding that makes this bigger than "add a third tab" — 14 real customers received a PI and no OC.

#### What the paper actually is — read off 6 rendered PIs

Two shapes, and the module needs both:

**A · The MACHINE PI — three pages.** 101, 102, 120, 124, 127 all take this form.
1. **Cover letter** on the letterhead — *To,* block (name · address · GST), *Dear Sir,* and a fixed
   four-line company paragraph (*"We are Orange O Tec Pvt Ltd. A Surat based leading digital solutions
   provider…"*), closing **For Orange O Tec Pvt Ltd / Authorized Signatory**.
2. **"Key Benefits of `<machine>`"** — a marketing page: a tagline (*"Detailed, Different, Diverse"*,
   *"Suave. Slick. Sturdy"*, *"Revolutionary. Reputable. Robust"*), a paragraph, and bulleted
   **Applications · Productivity · Advantages**.
3. **The invoice page** — repeats the header and *To,* block, then `Subject: Model No: …`, the table, the
   money block, `Note:`, `Terms & Conditions:` and the bank block.

**B · The ITEM PI — one page.** Folder 107 (Pankaj Fashions) raised **three separate PIs on one deal** —
`MACHINE`, `INK`, `DRYER`. The item ones are the invoice page alone: no cover letter, no benefits page.
🔴 **So a PI is not necessarily one-per-deal.** See the numbering finding below.

#### 🔴 The numbering does not match what the module mints — three separate problems

Every real PI is headed **`Performa No. OTPL/OC/127/26-27`**.

1. 🔴 **The format is inverted.** `format.ts:142` mints `OTPL/OC/2627/0009` — financial year first, serial
   padded to four. The real papers read `OTPL/OC/<serial>/<26-27>` — serial first, unpadded, year
   hyphenated. **Every OC the module has issued carries a number Bushra's filing does not recognise.**
   That is a finding about the OC, not only the PI, and it needs deciding before a PI prints one.
2. 🔴 **The number exists too early for the module to have it.** `format.ts:48` is explicit that
   `oc_no` is minted **at the Directors' approval**. The real PI carries its number from the day it is
   raised — the folder is opened at PI time. So a PI rendered today would print **no number at all**, or
   a ruled blank where `Performa No.` goes.
3. **Item PIs take a sub-number.** `OTPL/OC/107-1/26-27` (ink), `OTPL/OC/107-2/26-27` (dryer). Nothing in
   the module mints a `-1` / `-2`.

#### The invoice page, field by field

| On the paper | Where it comes from today |
|---|---|
| *To,* name · address · GST | 🟢 `customer_name`, `customer_address`, `gst_no` — all exist |
| `K/a: Mr. Shan Moondra-9660518900` (102) | 🟢 `customer_attn`, `customer_mobile` — **and this is the one place they print**, which answers OCPI-34 item 3 |
| `Subject: Model No: HOMER K64(With 64 Heads)` | ⚠ `machine_model_no` is **NULL on 16 of 28 machines** |
| `(HM1800B-TK64-A1)  HSN CODE: 84433910` | 🔴 **No HSN column anywhere** |
| `MFG: HAN GLORY (HONG KONG) LIMITED` | 🔴 **No manufacturer column anywhere** |
| `Country of Origin: HONG KONG , CHINA` | 🔴 **No column anywhere** |
| Quantity column (`3`, `2`, `1`) | 🟢 `machine_count` exists |
| Bank block | 🟢 `fms_ocpi_company_profiles` already holds bank/branch/account/IFSC |

#### 🔴 The table is a LINE-ITEM table, not one fixed row

Folder **124 (Clothera)** settles this — two rows and four money lines:

```
Quantity | Description                                        | Amount
   2     | Digital Sublimation Printing Machine
         | KoloRado Alpha III (With 16 print heads)
  30     | Epson Print heads
                                    Machine Value INR      46,50,000.00
                                    Print Heads Value INR  21,00,000.00
                                    +18% GST INR           12,15,000.00
                                    Total INR              79,65,000.00
```

🟢 **OCPI-11 already captures exactly this.** The Shipment & invoice table stores
`head_invoice_qty / _amount`, and the same pair for ink, dryer, spares and centering, each with its own
sub-total. **The PI's extra rows are those rows.** Do not invent a second way to say it.

#### The money block has three shapes — and the third one is a legal distinction

| Deal | Prints |
|---|---|
| **INR** (127, 101, 102) | `Machine Value INR` · `+18% GST Value INR` · `Total Value INR` |
| **INR, multi-item** (124) | one value line per item, then `+18% GST INR` · `Total INR` |
| **USD / High Seas** (107 ink, 107 dryer, 120) | `Machine Value USD 3,85,000.00` · `@ 96 (Fluctuated Rate)` · `Total Value INR 3,69,60,000.00` — **and NO GST LINE** |

🔴 **The no-GST rule is the same one OCPI-29 protected on the summary sheet** — a High Seas sale attracts
no GST, and a `0%` row is a different claim from no row. Build the PI's money block on the same rule, and
reuse `quotationPdf.ts`'s existing test rather than writing a second one that can drift.

⚠ The rate line is worded **two ways** in real papers — *"(Fluctuate Rate)"* (107) and *"(Fluctuated
Rate)"* (120). **Use `(Fluctuated Rate)`** — it is the grammatical one and the one on the larger, more
recent K64 deal. Not worth a question; flag it to Ritesh Bhai when the first PI is shown to him.

#### `Terms & Conditions:` — the bullets, and which the module already holds

| Bullet | Seen in | Source |
|---|---|---|
| **Payment Terms** | all | 🟢 `payment_terms` (OCPI-30's seven formats) |
| **Trade Terms** | all | 🟢 `trade_term` — **exactly what OCPI-35 just rebuilt**, and the real papers prove it: *"CIF NHAVA SHEVA"*, *"CIF NHAVA SHEVA PORT (Under EPCG License)"*, *"Ex-Work Surat Factory (Transportation bear by Customer)"* |
| **Delivery Terms** / **Shipment Terms** | varies by deal | ⚠ *"30 Days after Order Confirmation"* — this is `delivery_days`, **retired by OCPI-18**. See the trap below |
| **Insurance** | most | 🟢 `insurance_clause_agreed` — and this is where it prints, answering **OCPI-34 item 1** |
| **Country of Origin** | 120 only | 🔴 no column |
| **Bank Details** | all | 🟢 company profile |

🔴 **THE DELIVERY-DAYS TRAP — ✅ SETTLED 02-09-2026: THE PI PRINTS THE SAME DATE AS THE CONTRACT.**
OCPI-18 removed *Delivery days* and replaced it with a **tentative delivery date** plus a remark, because
a day-count told the customer nothing about when. The real PIs still say *"30 Days after Order
Confirmation"* — **that wording does not come back.** The PI's delivery bullet resolves from
`deliveryDate`, the same value `{{delivery_date}}` already puts in the SALE CONDITIONS clause of 21 decks:

> `Delivery : Tentative delivery 15-Oct-2026, from the date of signing`

⚠ **DO NOT RESTORE `delivery_days`** — not the column, not the field, not a PI-only variant. Two papers
carrying two different delivery promises on one deal is the failure this avoids.
⚠ `deliveryDate` is **optional today**. A PI with no date must omit the bullet, not print
`Delivery : ________` — see the same empty-means-omit reasoning recorded under Q5.
⚠ Format it with the **papers'** formatter (`paperDate`), not the screen's — the identical note is on
`{{delivery_date}}` at `tokens.ts:198`, and it is there because the two disagree.

#### Two things that have no home yet

- 🔴 **The "Key Benefits" page.** Per-machine marketing copy — tagline, paragraph, Applications,
  Productivity, Advantages. `intro_text` is **not** it (it holds the OC's opening line, *"Following up
  your kind order…"*), and neither is `composition`. **This needs new per-machine content for all 28
  machines, and nobody has written it.** ⚠ It is the single largest piece of work in this task and it is
  **content, not code** — check with Ritesh Bhai whether the PI must carry it at all, or whether pages 1
  and 2 are optional. **An item PI proves they can be dropped.**
- **The cover letter's company paragraph** is identical across every folder — that one is a constant, not
  a data ask.

#### 🔴 Questions for Ritesh Bhai — the first three change the build

- [x] **Q1 · ✅ SETTLED 02-09-2026 — ALL THREE PAGES.** Ritesh Bhai: *"Ideally, we want all three pages."*

      🟢 **And it is far less work than this entry first claimed.** Swept **both** financial-year folders
      — `2025.26 OC&PI` (20 deals, 78–98) and `2026.27 OC&PI` (27 deals, 101–127), ~60 PDFs, all
      **rendered with pdf.js**. **Twelve sales pages already exist** and can be lifted straight out:

      | Sales page, as it is headed on the paper | Covers |
      |---|---|
      | `Key Benefits of HOMER K24` | Homer K24 |
      | `Key Benefits of HOMER K32` | Homer K32 |
      | `Key Benefits of K64` *(also typed `K 64`)* | K64 |
      | `Key Benefits of HOMER ROCKET MACHINE` | Rocket |
      | `Key Benefits of Position Printer` | Position Printer |
      | `Key Benefits of Fab Pro 2i` | Fab Pro 2I *(1I / 3I unverified)* |
      | `Key Benefits of Sub Pro II+` | P8S *(P8D unverified)* |
      | `Key Benefits of Alpha II` | Alpha II **1.8 · 1.9 · 2.2** |
      | `Key Benefits of KoloRado ALPHA III` | Alpha 3 / 3.2 — **8 · 16 · 24 heads** |
      | `Key Benefits of ALPHA 12` | Alpha 3 — 12 heads |
      | `Advantages of KOLORADO ALPHA 15` **and** `Advantages of FEDAR 15` | Kolorado Alpha 15 — **two different pages for one machine, see below** |
      | `Advantages of Heat Transfer Machine 800 Dia` | Pengda — its productivity block quotes **600 / 800 / 1000 mm**, so one page plausibly covers all three variants |

      🟢 **ONE PAGE SERVES A WHOLE FAMILY** — the single *Alpha II* page covers three machines, *ALPHA III*
      covers three or four. The unit is the **family**, not the machine, so 12 pages already cover
      roughly **20 of the 28**.

      🔴 **THE HEADING IS NOT ALWAYS `Key Benefits of …`.** Four pages are headed **`Advantages of …`**,
      and the first sweep of this entry missed all of them by searching for the wrong phrase. **Do not
      key the extraction on the heading text.** Take page 2 of each PI whole, whatever it is called.

      🔴 **Alpha 15 has TWO different pages under two different names** — `KOLORADO ALPHA 15` (2026-27)
      and `FEDAR 15` (2025-26), and their bodies differ, not just their titles. *FEDAR* is the OEM brand.
      **Ask Bushra which one is current** before seeding either; the wrong choice puts an obsolete
      brochure page in front of a customer.
      ⚠ `ALPHA 12` may be the *ALPHA III* page under another name, or a genuinely separate one. Compare
      the two bodies before storing both.

      ⚠ **Still missing — a Bushra ask, not a build task:** **MP5000 · JPK · Mini Lario · Kolorado
      Alpha 16 · Foil Machine · Label Printer · Book Printer**, plus confirmation on **Fab Pro 1I / 3I**
      and **P8D**. No deal has ever been raised on these, which is exactly why no page exists. The POD and
      Foil machines may never need one.

      ⚠ **The item PI (ink / dryer) still has no sales page and must not print one** — folder 107 proves
      the 1-page form is correct there. The renderer needs both shapes regardless of this answer.
      ⚠ `K 64` and `K64` are the same page typed two ways. Store one; do not seed the typo.
- [x] **Q2 · ✅ SETTLED 02-09-2026 — BUSHRA'S FORMAT WINS.** `OTPL/OC/<serial>/<YY-YY>` — serial first and
      **unpadded**, year hyphenated. Deal 9 is `OTPL/OC/9/26-27`, not `OTPL/OC/2627/0009`.

      🔴 **THIS IS NOT A PI CHANGE — IT CHANGES `ocNumber()` AT `format.ts:142` AND THEREFORE THE OC.**
      The SQL default quoted in that file's own comment
      (`'OTPL/OC/' || fy_code(current_date) || '/' || lpad(next_seq(...), 4, '0')`) mints the same wrong
      shape server-side, so **the client helper and the column default must move together** — exactly the
      client/server pairing that is this module's defining hazard.
      ⚠ **Do NOT rewrite `oc_no` on deals already issued.** A frozen paper keeps the number it printed;
      rewriting the row would put the record and the customer's copy out of step. New numbers only.
      ⚠ `lpad(…, 4, '0')` goes. Confirm nothing sorts or matches on the fixed width before removing it.
- [x] **Q3 · ✅ SETTLED 02-09-2026 — THE NUMBER IS MINTED WHEN THE QUOTATION IS GENERATED.** One number
      serves the PI and the OC, exactly as folder 127 does. Ritesh Bhai accepted that a deal which never
      closes still consumes a serial — the same thing a folder that never closes already does.

      🔴 **THIS MOVES `oc_no` EARLIER IN THE LIFECYCLE, AND `oc_no` IS LOAD-BEARING.**
      `format.ts:52` reads:
      > `return deal.ocNo ? "ORDER CONFIRMATION" : "ORDER QUOTATION";`

      and its comment says *"`oc_no` is therefore the only test"*. **Mint it at quotation time and every
      quotation instantly heads itself ORDER CONFIRMATION** — a document that says it is a signed contract
      while it is still an offer. `quotationPdf.ts:601` and `ocPdf.ts:408` also both print the number the
      moment it is non-null.
      **So the stage test must stop being "does `oc_no` exist" BEFORE the number moves.** Use the approval
      timestamp (`oca_at` / `oc_at`) or the status, not the presence of a number. ⚠ Search for every
      `ocNo ?` and every `oc_no is not null` — in the client, the RPCs and the queue derivations — before
      changing when it is written. This is the single riskiest part of OCPI-36.
      ⚠ `queues.ts:41` labels a deal `d.ocNo ?? d.quotationNo ?? …`, so every queue row's title changes
      too. Probably fine — check it reads sensibly on a deal that has not been approved.
      ✅ **`QT-M####` SURVIVES, BUT STOPS BEING A CUSTOMER-FACING NUMBER** — settled 02-09-2026.
      All three papers carry **`OTPL/OC/<serial>/<YY-YY>` and nothing else**; `QT-M####` stays internal,
      for the deal screen, the register, search and file names. One number the customer quotes back,
      matching how folder 127 is filed.
      🔴 **`quotationPdf.ts:615` prints `["Quotation No. :", deal.quotationNo …]` on the summary sheet
      today** — that row changes to the new number. It is a customer-facing edit to a paper this task was
      not otherwise touching, so verify the summary renders before and after.
      ⚠ `quotationPdf.ts:863` and `:730` build **file names** from `quotationNo` / `ocNo`. Those are
      internal, so they may keep `QT-M####` — but the two must not silently diverge from what the page
      prints. Decide once and note it.
      ⚠ The `DRAFT — not yet issued` fallback at `:615` still matters: a draft has no serial either, so
      the summary must keep saying so rather than printing an empty `OTPL/OC//26-27`.
- [x] **Q4 · ✅ SETTLED 02-09-2026 — ONE PI PER DEAL. Separate item PIs are OUT OF SCOPE.**
      Folder 107 is the only one of 27 that split, so the line-item table carries ink and dryer as extra
      **rows**, not extra papers. No `-1` / `-2` counter, no picker, no variable number of tabs.

      ⚠ **The 1-page shape is still needed, and not because of this.** The renderer must skip the cover
      letter and sales page whenever the deal has no machine sales page to show — a Pengda or POD deal
      today. Do not delete the 1-page path on the strength of this answer.
      ⚠ If splitting is asked for later it is a **new entry**, not a reopening of this one: it needs the
      sub-serial, a chooser for what lands on which paper, and storage for an unbounded set of papers.
- [x] **Q5 · ✅ SETTLED 02-09-2026 — ADD THE THREE BOXES, PRINT ONLY WHEN FILLED.**
      Three nullable columns on `fms_ocpi_machines` and three optional fields on the Machines master. A
      machine with nothing filled prints **nothing** — not a label, not a ruled blank.

      🟢 **The data says this is the right shape.** Of 34 real PI files: **4 carry an HSN code, 2 carry a
      country of origin, 1 carries a manufacturer, and 30 carry none of the three.** They appear on the
      **imported** machines (K64 — `HSN CODE: 84433910`, `MFG: HAN GLORY (HONG KONG) LIMITED`,
      `Country of Origin: HONG KONG , CHINA`) and never on the Surat-built ones.
      ⚠ **This is the one place in the PI where empty means "omit", not "blank".** Everywhere else in this
      module an unanswered token prints a ruled underscore run on purpose (`tokens.ts:8-17`), because the
      gap is a thing somebody must fill. Here the gap is *correct* — a Homer K24 has no country of origin
      to state. Write that reason next to the code or the next person makes it consistent with the rest
      and puts three blanks on every domestic invoice.

#### Build

- [x] 1.1 **Additive nullable columns.** `fms_ocpi_machines`: `hsn_code`, `manufacturer`,
      `country_of_origin`, and whatever the Key Benefits page needs if Q1 says yes.
      `fms_ocpi_quotation_versions`: **`pi_pdf_path`**, mirroring `pdf_path` / `oc_pdf_path`.
      `fms_ocpi_deals`: **`pi_pdf_path`**, mirroring `oc_summary_pdf_path` for the approved stage.
- [~] 1.2 ⚠ Fill `machine_model_no` on the **16 machines where it is NULL** — the PI's subject line reads
      `Model No: …` and would print a blank. **Data ask, from the machine sheet.**
- [x] 2.1 `lib/piPdf.ts` — a **third renderer**. Reuse `letterhead.ts`, `pdfBrand`, and
      `quotationPdf.ts`'s existing GST / USD rules. **Do not re-derive the money.**
- [x] 2.2 The line-item table, fed from OCPI-11's invoice quantities and amounts.
- [x] 2.3 The bank block from the company profile. ⚠ The four entities with **no profile** already warn by
      name on every screen that produces a document — the PI joins that list, or it prints Orange O Tec's
      account on a Colorix contract.
- [x] 3.1 Store and re-read the PI everywhere the other two are: the generate path, the version row, and
      the approved-OC path.
- [x] 4.1 **`PaperSet.tsx` — the tab order becomes Summary · PI · OC**, in **all three** call sites:
      `IssuedPapers.tsx:96`, `ApprovalPanel.tsx:244`, `ApprovedOcPreview.tsx:117`.
      ⚠ `PaperSet` auto-lands on `papers[0]`, so the order is not cosmetic.
      ⚠ A paper that does not exist is still a tab, and says why — 7 of 28 machines have no OC template
      and the PI must not inherit that note.
- [x] 4.2 **Download all.** *Download both* (`PaperSet.tsx:168`) becomes a **Download all** control with a
      tick per paper, all ticked by default.
      🔴 **KEEP THE 400 ms STAGGER** (`PaperSet.tsx:138`). Chrome cancels a second programmatic download
      fired in the same tick, so a naive three-file loop hands over **one** file and reports success —
      exactly the failure that comment exists to record. It gets worse with three, not better.
      ⚠ Only papers that actually exist may be tickable, and the control hides when fewer than two do.

#### Verify

- [ ] `cd frontend && npm run build`
- [x] 🔴 Render a PI for **each money shape** and read it with **pdf.js**: an INR single-machine deal, the
      Clothera multi-item shape, and a **USD High Seas deal — which must carry NO GST line.**
- [x] Compare a generated PI **side by side with folder 127's real one** (Sumati Prints, Alpha II, 3
      machines, INR, 18% GST). It is the cleanest specimen and matches a shape the module can already
      produce end to end.
- [x] 🔴 `Performa No.` is never a ruled blank — on a deal before approval as well as after.
- [x] Download all with all three ticked delivers **three files**; with one ticked, one. Test in Chrome.
- [x] An older deal opens and its Summary and OC print unchanged — the PI tab simply says it has none.


#### 🔴 Built 02-09-2026 — three corrections to this entry, found by rendering

1. **The money block does NOT price OCPI-11 line items.** Swept all 42 real PIs: **41 carry exactly one
   priced line (the machine) and one table row**; only Clothera (124) has two. Where ink or heads are
   mentioned they sit in the `Note:` in words, never as invoice rows. The entry’s assumption printed
   ₹62.35L of item lines above a Total of ₹61.36L that excluded every one of them — those columns are
   *separately invoiced* and excluded from every stored total by design. **Clothera’s shape is not
   reproduced:** charging an extra needs a total that includes it, and no such figure is stored.
   🔴 **A decision for Ritesh Bhai** — store a PI total server-side, or leave it as it is.
2. **Alpha 15’s two pages are body-identical.** `Advantages of KOLORADO ALPHA15` and
   `Advantages of FEDAR 15` differ only in the heading — rendered and compared word for word. The
   obsolete-brochure risk this entry guarded against does not exist, so the page **is** seeded, under
   the Kolorado heading. ALPHA 12 vs ALPHA III *was* a real difference; both are stored.
3. **A fourth PI consumer the entry does not list:** `RevisionHistory.tsx` + `revisionDiff.ts` link the
   papers per revision. Without the third, every archived revision offers two of its three.

⚠ **Before the next real quotation is generated:** the OC counter stands at **9** and the paper book for
   26-27 runs to **127**. Move it in Settings → Order confirmation numbering. Deliberately left until
   after testing so the serials testing burned are discarded by the jump rather than left as gaps.
⚠ **Deploy `master` promptly** — the migrations are applied and the deployed `docHeading` still tests
   `oc_no`, so a quotation generated on production before the deploy would head itself ORDER
   CONFIRMATION. The frontend is safe ahead of the migration; the migration is not safe ahead of it.
⚠ **For Bushra:** the Alpha 15 heading (Kolorado vs FEDAR, and `ALPHA15` prints without a space);
   whether Fab Pro 1I / 3I share the 2i page and P8D shares Sub Pro II+; and the seven machines with no
   page at all. Full write-up in OCPI.md.

### OCPI-37 · Does our OC match the OC Bushra actually sends? An input↔output audit against the real papers  `[x]`
*Raised 2026-09-02 · Asked for by Ritesh Bhai · **ground truth:** `Misc/Bushra Reports/OCPI/2025.26 OC&PI`
and `2026.27 OC&PI` — **25 real order confirmations as PDF***

**The ask, in his words.** *"Whatever format we are generating for OC right now, is that format matching
the actual OC format? Are all the fields that are getting captured?"* Two directions, one audit:

> **INPUT** — does the form capture everything the final OC needs?
> **OUTPUT** — does the OC print everything the real one prints?

#### ⚠ This is NOT a repeat of OCPI-12, and the difference is the whole point

| | OCPI-12 (done) | **OCPI-37 (this)** |
|---|---|---|
| Compared | the **form** against **our own PDFs** | **our PDF** against **Bushra's real OC** |
| Answered | "does what I typed reach the paper?" | **"is the paper the right paper?"** |
| Could not find | a clause nobody ever transcribed | exactly that |
| Coverage | K64 only | **10 machines that have a real OC on file** |

OCPI-12 proved the plumbing. It could never have found a section missing from the template, because it
only ever compared the module to itself. **This one has an external answer key.**

#### 🔴 The audit has already found one, before it was even written

**`HOMER K32 CONSUMABLES PARTS LIST WHICH NOT COVER UNDER WARRANTY` — in 4 real OCs, in ZERO templates.**
Verified against every `fms_ocpi_machine_sections` row: no section carries this title, and no body
contains `consumable…parts list`, `not cover under warranty` or `PIPE WILL NOT BE COVERED`.

It is a **warranty-limiting** clause — eleven named parts plus two notes:

```
HOMER K32 CONSUMABLES PARTS LIST WHICH NOT COVER UNDER WARRANTY
 1. SPONGE ROLL COVER          7. DEGASSING
 2. WASHING BRUSH              8. SPONGE ROLL BEARING
 3. SQUEZEE RUBBER             9. INK MAIL CONNECTOR
 4. HEAD WIPER                10. INK FEMALE CONNECTOR
 5. WASHING BRUSH BEARING     11. INK PIPE
 6. INK FILTER
Notes:
 1) PHYSICALLY DAMAGED PARTS ARE NOT COVER UNDER WARRANTY PERIOD.
 2) ANY AIR PRESSURE-RELATED PART DAMAGED DUE TO THE WATER ENTERING THE AIR PIPE
    WILL NOT BE COVERED UNDER WARRANTY PERIOD.
```

🔴 **A K32 contract issued from the module today gives away eleven consumables the real contract
excludes.** That is the exact class of defect this task exists to find, and finding one inside ten
minutes is the argument for running the whole thing properly.

#### 🟢 The good news, so the scope is honest

Homer K24 was compared end to end against folder 123's real OC. **It matches — structurally, section for
section:**

| Real OC | Our template |
|---|---|
| header: Attn · Date · Address · GST | `header_fields = [attn, date, address]` ✅ |
| spec table, 13 rows | `spec_rows`, 13 rows, same labels ✅ |
| `THE MACHINE IS COMPOSED AS FOLLOWS` | `composition` ✅ |
| supply line + money block | `supply_description` + derived ✅ |
| 9 body sections, in order | 9 sections, same titles, same order ✅ |
| `Dryer：AC380V…` only when a dryer is sold | `[[if dryer]]` — **OCPI-31's fix, already in** ✅ |

So the transcription work of OCPI-3 / OCPI-4 was largely right. **This audit is looking for the
exceptions, not rebuilding the templates.**

#### 🔴 Two divergences that are DELIBERATE — the audit must not "fix" them

An audit that flags these as defects will get them reverted by the next person.

1. **`Shipment Terms: 30 Days after Order Confirmation` → `Tentative Machine Delivery Date: …`**
   OCPI-18, on the client's instruction. **Every real OC still shows the old wording.** Expected
   difference. Do not restore `delivery_days`.
2. **`After 18 months New Print Head price will be @ INR 2,35,000 plus GST` → the sentence was rewritten
   to need no figure.** Stage J.1 retired `{{post_warranty_head_price}}` because an unfilled placeholder
   printed a ruled blank on four machines. **Our OC states no head price. The real one does.** That was a
   decision; confirm it still is, and record it either way.

⚠ **Every difference the audit finds must be classified into one of three buckets, never left as a raw
diff:** **(a) a gap to fix · (b) a deliberate divergence with the reason quoted · (c) wording drift too
small to matter.** A list of 400 undifferentiated differences is not a finding, it is a second problem.

#### What can and cannot be compared

**10 machines have a real OC PDF on file** — Homer K24 · Homer K32 · K64 · P8S · Fab Pro 1I · Fab Pro 2I ·
Kolorado Alpha 15 · KoloRado Alpha II (1.8 and 1.9) · KoloRado Alpha III · Pengda 800.

⚠ **11 of the 21 templated machines have NO real OC to check against** — MP5000, JPK, Rocket, Position
Printer, P8D, Fab Pro 3I, Alpha 16, Alpha II 2.2, Alpha 3 12h, Alpha 3.2 8h/24h. **Say so in the report.**
An audit that silently covers half the estate and reports "no issues" is worse than one that reports its
own blind spot. Some of these transcribe from a `.pptx` deck with no OC ever issued — note which.
⚠ One real OC is **filed in the wrong folder**: `21-Parmatma Industries - Fabpro 1I - OC…pdf` sits inside
`2025.26 OC&PI/83-MONALISSA…/81-Swati…/`. Find files by content, not by folder name.

#### Method

- [x] 1.1 **Render every real OC with pdf.js.** 🔴 **Never parse the `.pptx`/`.docx`, and never
      string-search jsPDF output.** Four of the source decks fuse words in OOXML — the whole template
      effort renders rather than parses for this reason. `pdfjs-dist` is already in
      `frontend/node_modules`.
- [x] 1.2 **Render OUR OC for the same machine**, driving `buildOcPdf` headlessly with deal facts copied
      from the real paper — same head count, same dryer choice, same currency. ⚠ A dryer/no-dryer
      mismatch will read as a template gap when it is only a different deal.
- [x] 1.3 **Diff structurally, not as free text**: section titles and their order · spec-row labels and
      order · the composition list · the supply line · the money block · the sign-off block.
- [x] 2.1 **The INPUT direction.** For every value the real OC states that varies by deal, name the field
      that supplies it — or record that **nothing does**. Reuse `OCPI-FIELD-MAP.md`
      (`cd frontend && npm run field-map`), which OCPI-12 built and which re-reads the code each run.
- [x] 2.2 ⚠ **A hardcoded value is an input finding too.** `spec_rows` carries plenty of literal numbers
      that are correct for every deal (`Max. Printing width: 1900 mm`) — right. But a value that SHOULD
      vary and is baked in is a defect wearing the same clothes. Judge each, do not pattern-match.

#### The deliverable

- [x] 3.1 One report — **`OCPI-OC-AUDIT.md`, or a workbook in the shape of OCPI-5's**, which already
      solved the "one tab per machine, colour the differences" problem. Reuse it rather than inventing a
      second format.
- [x] 3.2 Per machine: **matches · in the real OC only · in ours only · worded differently**, each row
      tagged (a) / (b) / (c) per the bucket rule above.
- [x] 3.3 A front page listing, in order of seriousness, **only the (a) rows** — the things to fix.
      Every one that changes a signed contract gets 🔴.
- [x] 3.4 ⚠ Anything found becomes its **own WORKLIST entry**. This one is the audit; it must not quietly
      turn into an unbounded template-repair job halfway through.

#### Verify the audit itself

- [x] 4.1 Re-run it on **Homer K24** and confirm it reports **no (a) findings** — the manual comparison
      above says it matches. An audit that flags a clean machine is miscalibrated and everything else it
      says is untrustworthy.
- [x] 4.2 Confirm it **does** find the K32 consumables section. That is the known-positive control.
- [x] 4.3 Confirm it reports the two deliberate divergences as **(b)**, with the reason quoted, not as
      defects.

#### ✅ DONE 03-09-2026 — the harness, the report and the one fix

`cd frontend && npm run oc-audit` → **`OCPI-OC-AUDIT.md`** at the repo root, generated and never
hand-edited. Working files (the parse of each real contract, our rendered PDFs, the facts each was
driven with, the deck renders) in `Misc/Bushra Reports/OCPI/oc-audit/`, with a README saying what each
proves.

**Seven specimens — five from `2026.27`, which is the answer key, plus a K32 from `2025.26` and the
untemplated Pengda 800.** 35 gaps, grouped into **9 fix batches**. No deal raised and no number burned:
the module's own `buildOcPdf` is driven against live masters, so the run costs nothing and is undone by
doing nothing.

🔴 **Four premises in this entry were wrong, and each would have put a false statement in the report:**

| It said | The papers say |
|---|---|
| "10 machines have a real OC … **K64** …" | **K64 has no order confirmation anywhere.** Every PDF *and* every Word/PowerPoint file in both years was swept: K64 appears in folders 109 and 120 only, and both are Performa Invoices with no contract body. Our best seller has never been checked against a signed contract |
| the misfiled Parmatma Fab Pro 1I paper | is headed **`OFFER QUOTE`**, not ORDER CONFIRMATION, and reads "Colorix Fabpro 1i" — a different selling entity. A detector keyed on "ORDER CONFIRMATION" drops the very file this entry says to go and find |
| K32's clause goes between 70 and 80 | the rendered page puts it **after CANCELLATION, immediately before the sign-off** — `sort_order` **100**, confirmed identical on all three K32 contracts (78, 82, 83) |
| "Only the **Homer** machines carry a head price" | **P8S carries one too** — folder 126 states INR 2,25,000 from the 19th month. The B-02 exemption is deliberately scoped to the three Homers, so the Sub Pro sentence is reported rather than excused. Ritesh Bhai's decision covered the Homer sentence; this one has not been put to him |

**Q1 is applied.** Migration `20261106130000_fms_ocpi_k32_consumables_not_covered` — one additive,
idempotent INSERT, `sort_order` 100. Verified three ways: read back off a **rendered** K32 OC with
pdf.js (page 4, all 11 parts, both notes, immediately before the sign-off); rendered again **in the
running app** through the console route, which reports 10 sections with the clause last, 0 unresolved
tokens and 0 ruled blanks; and the frozen revision proved untouched — QT-M0031's payload md5 is
byte-identical and still carries 9 sections.
⚠ **QT-M0037 (AARNAV FASHIONS, real, at `quotation_approval`, not yet frozen) WILL gain the clause**
when its OC is generated. That is correct, and Ritesh Bhai is told rather than left to find out.

**The check proves it can still see a gap.** The K32 clause was the known-positive control, and fixing
it consumed the control. It is replaced by a permanent **self-test**: a clause is deleted from our side
of a live comparison and the comparator must report it. The run **throws rather than reporting a
partial result** — specimen counts must reconcile, every finding must carry a bucket, every exemption a
quoted reason, and the self-test must catch its own planted gap.

**Homer K24 — the clean control — shows 0 structural gaps**, which is what the hand check actually
proved: same header fields, same 13 specification labels in the same order, same composition, same 9
clauses under the same titles in the same order. ⚠ It never compared clause **bodies**, and two real
differences inside them turned up on K24 anyway.

#### The 9 fix batches — nothing applied, each is its own job

Full detail and the exact contract wording for every one is in `OCPI-OC-AUDIT.md`.

- ✅ **F-01a · the included-ink note — DONE 03-09-2026 (OCPI-38).** Ritesh Bhai, on reading the
  audit: *"the number is already being captured, it never reaches the paper, so why is it not reaching
  the paper? Go ahead and print that on the paper."* **Why it did not:** the figure printed on the
  SUMMARY sheet only, and no `{{token}}` for it existed, so no template could have printed it on the
  contract. Now drawn by `ocPdf.ts` between the priced line and the money, exactly where the real
  contracts put it, on all 21 machines at once with no template edited. ⚠ A token was refused
  deliberately — an unanswered one rules a blank, which would print *"Note: ________ included in above
  value"* on every contract WITHOUT ink. ✅ A bare number is completed to **Kgs** (Ritesh Bhai, 03-09) — ink is
  always sold by weight, and every real deal that states a unit says Kgs; the 14 `litres` values were all
  test seeds. A value that names its own unit is printed untouched.
- ✅ **F-01b · the model number and the HSN code — DONE 03-09-2026 (OCPI-39).** Ritesh Bhai: *"I believe
  we already have a model number in the machine master, so you can pick up the model number from there.
  If it is blank, then we will add the model number, or if you have the model number from the actual
  contract, then you can just go ahead and add that to the master."* Both now come off
  `fms_ocpi_machines` — `machine_model_no` and `hsn_code`, the same two columns the PI already prints —
  drawn by `machineDetailLine` in `ocPdf.ts` under the priced line, with a **fold-and-contains guard** so
  the five decks that already carry the text (K24, P8D via the token; K64, Rocket as literals; MP5000
  inline) do not print it twice. Migration `20261107130000_fms_ocpi_model_numbers_and_hsn` fills K32
  `HM1800B-TK32-B1` and P8S `HM1800R-P8S-A1` off their own signed contracts, plus Pengda 800
  `PD-1700XD-800`.
  🔴 **AND IT UNCOVERED A LIVE DEFECT THE AUDIT'S SWEEP COULD NOT SEE.** `{{machine_model_no}}` resolved
  from the **deal**, whose model box is free text nothing prefills — **blank on all 30 live deals** — so
  Homer K24 and P8D contracts were printing *"(Model No: ________)"* on the line the customer signs
  under. `docContext` now falls back to the master; the deal still wins where it has an answer, so a
  frozen revision is unaffected. The audit missed it because its own sweep supplied the master value.
  ⚠ **The audit's comparator had to be extended too** — `machine_detail_line` added to the supply
  comparison, and the model/HSN matched **folded** rather than word-diffed, or a line stating the same
  two facts read as four missing words.
- 🔴 **F-02 · `head_policy` drops two sentences** — K24, K32, P8S, and K64 by inheritance. The real
  contracts say *"New print head bought post 18 months shall carry warranty 12 months from the date of
  installation"* and *"…in case of any Physical damage, new print head to be purchase from Orange O
  Tec"*. Ours says neither. **This is warranty duration and a purchase obligation.**
- 🔴 **F-03 · the Alpha `warranty` clause drops AMC and the chargeable technician** — all three Alphas.
  *"AMC charges will be applicable as per real time terms and conditions of the company"* and
  *"…technician cost will also be chargeable and invoice will be generated for same."*
- 🔴 **F-04 · a non-refundable cancellation term our document never prints** — Alpha II ×2 and P8S.
  *"Once order is placed it will not be cancelled. In unavoidable situation… any kind of payment made
  will not be refundable or adjustable."*
- 🔴 **F-05 · Insurance is a literal that varies contract to contract** — ours always says *"Product
  Insurance borne by Customer"*; the real ones say *"is at our care till Port"* (K32, a high-seas sale)
  and *"is at Customer care"* (Alpha 15). A literal that disagrees with the deal is worse than a blank.
  Needs a field or an `[[if usd]]` pair, and Ritesh Bhai picks the house position.
- 🔴 **F-06 · Alpha 15 is missing a whole PC-specification clause.**
- ✅ **F-07 · the customer's GST number — DONE 03-09-2026 (OCPI-39).** Ritesh Bhai: *"if we already have
  the GST, then why are we not printing it? The system already holds it, so go ahead and fix this and
  print this. It's quite simple."* It is now a header line drawn by `ocPdf.ts` directly under the
  address, which is where all six real contracts put it (*"GST:24AASCA8419N1Z0"*). ⚠ **Not added to
  `header_fields`** — all 28 machines already declare `address`, so drawing it beside that lands it on
  every contract with no row updated and no template edited. Nothing prints when the deal has no GSTIN
  (a high seas sale, an unregistered buyer), which is the whole reason it is drawn rather than
  tokenised. Frozen onto the payload as `customer_gstin`. Closed all 6 specimen findings — the audit
  went 31 → 25 gaps.
- 🟠 **F-08 · specification rows differ** — 4 machines.  🟠 **F-09 · a composition bullet** — P8S.

#### The two decks added 02-09-2026 — read, reported, NOT built

- **`PENGDA 1000XD 800.pptx` is `Pengda PD-1700XD-800`**, identified from the slide and not from the
  file name — the name would have sent it to the 1000, which is the one Pengda that IS templated and
  has never been sold. The 800 has **three real contracts** (87, 89, 94) and no template.
  🔴 The deck carries a **live price** — `INR 17,00,000.00 / 3,06,000.00 / 20,06,000.00` — which must be
  stripped before anything is built from it. The `FABPRO 1I.pptx` trap exactly.
- **`S  MINI LARIO 1-OC.pptx` is `Mini Lario`** — 16 slides, no real contract on file, headed
  **`OFFER QUOTE`**, which can never print because `docHeading` derives the title from the OC number
  (OCPI-12 finding 5 / OCPI-34).
  🔴 It carries **`MARKEM-IMAJE`** — another manufacturer — inside its limited-warranty,
  limitation-of-liability, indemnity, data-privacy and governing-law clauses. Transcribed as they
  stand, an Orange contract would offer a third party's terms and bind the customer to their dispute
  resolution. **A person decides which of those Orange intends to offer** before any of it becomes a
  template.
- ⚠ **`Pengda PD-1800XD-800` still has no deck at all.**

#### Coverage, stated rather than implied

7 machines checked against a real contract · K64 by inheritance + deck + PIs · the other 13 templated
machines by an estate-wide sweep that renders each and asserts **0 unresolved `{{tokens}}` and 0 ruled
blanks** — all 21 pass. **7 active machines carry no template at all** and print no order confirmation:
Mini Lario, KoloRado Alpha 3.2 — 16 heads, both Pengda 800s, Foil Machine, Label Printer, Book Printer.

⚠ **Two real OCs are image-only scans** with no text layer (`MK FASHIONS SCAN & SIGNED OC`,
`VAAHO … SCAN & SIGNED .OC`). Each duplicates a text OC in the same folder, so coverage does not
suffer — but a scan cannot be audited, and that is worth knowing before anyone relies on one.

#### Questions for Ritesh Bhai — neither blocks the audit

- [x] **Q1 · ✅ SETTLED 02-09-2026 — PUT THE K32 CONSUMABLES CLAUSE BACK.** Ritesh Bhai: *"Yes, add it."*
      It limits what Orange O Tec must replace under warranty, so its absence costs money on every K32
      sold. **This is a template fix — a new `fms_ocpi_machine_sections` row on Homer K32 — not code.**
      ⚠ Transcribe it from a **rendered** page (folder 78, 82 or 83), never from the `.pptx`.
      ⚠ **Where does it sit?** In the real OC it follows the warranty sections and precedes the sign-off.
      Give it a `sort_order` between `PRINT HEAD POLICY PROGRAM` (70) and
      `WORKS AT CUSTOMER'S CARE AND EXCLUSIONS` (80) — check against a rendered real OC before choosing.
      ⚠ **Frozen revisions do not change.** Any K32 already issued keeps the contract it printed. If a
      live K32 deal is mid-flight, tell Ritesh Bhai rather than assuming a re-render fixes it.
      🔴 **STILL OPEN, and it is a Bushra ask, not his:** do the OTHER machines need an equivalent list?
      K32 may simply be the only one where somebody wrote it down — in which case every K24, K64, P8S and
      Alpha contract has the same hole. Added to *Waiting for*.

- [x] **Q2 · ✅ SETTLED 02-09-2026 — LEAVE THE PRINT-HEAD PRICE OUT.** Ritesh Bhai chose this **after**
      being shown that the figure is typed per deal and disagrees with itself:

      | Contract | Machine | Price |
      |---|---|---|
      | 91 · B.K Fashion | Homer K24 | **₹2,25,000** |
      | 123 · Amarasha | Homer K24 | **₹2,35,000** |
      | 93 · Cromatex · 95 · Microjet | Homer K24 | **₹2,50,000** |
      | 78 · Jay Chemical · 82, 83 · Monalissa | Homer K32 | ₹2,50,000 |

      **Three different prices on the same machine**, written by different people at different times.
      🟢 **So stage J.1 was right and stays.** `{{post_warranty_head_price}}` remains retired, the field
      stays off the form, and the sentence keeps its no-figure wording.
      ⚠ **The audit must report this as a (b) deliberate divergence, quoting this decision.** Eight real
      OCs state a price and ours will not — that difference is now on record as intended, so nobody
      "restores" it.
      ⚠ Only the **Homer** machines carry this clause at all; the Alpha and Sub Pro decks have a plain
      *WARRANTY* section with no head price. Do not go looking for the sentence on machines that never
      had it.

### OCPI-40 · Typing the real deals in — 13 findings the document audit could not see  `[~]`
*🔵 **IN PROGRESS in a separate session** (confirmed 03-09-2026) — driving the real deals into the
quotation form with Playwright and comparing the generated Performa Invoices against the client’s
real PDFs. Not to be picked up here.*


Ritesh Bhai, 03-Sep-2026, after OCPI-37 reported on documents only:
*"Now I also want you to spin up playwright and try to insert these actual records via the interface
and let's see what issues we have there."*

**Three real 2026-27 deals entered through the live form, click by click** — 123 Amarasha (Homer K24),
124 Clothera (KoloRado Alpha 3, the two-machine deal with 30 separately-priced heads) and 126 Prabal
(P8S with 300 Kgs ink). All three went in; **nothing crashed**. Produced `QT-M0055`, `QT-M0056`,
`QT-M0057`. Plain-language write-up: artifact `e793d6ed`.

⚠ **OCPI email was OFF before anything was typed** (`email_module_settings.ocpi.enabled = false`).
Check it again before the next UI run — the switch is per-module and someone else may arm it.

#### 🔴 The five that matter

- **U-01 · Generating a QUOTATION also mints an ORDER-CONFIRMATION number.** The three test
  quotations consumed `OTPL/OC/10`, `/11` and `/12` of 26-27 while still `status = draft` and never
  approved; with the parallel PI session's two, **10–14 are all gaps**.
  🟢 **NOT A DEFECT — THIS IS RITESH BHAI'S OWN DECISION OF 02-09**, recorded at item **0b** above:
  the mint moved from approval to Generate deliberately, on the reasoning that a paper folder which
  never closes already consumes its number. I reported it as a finding before reading 0b; it is not
  one, and it is corrected here rather than left standing.
  ⚠ **What the observation is still worth** is the size of the consequence, which 0b anticipated and
  nobody had measured: five serials in one afternoon of testing, none recoverable, because
  `fms_ocpi_delete_draft` does not give the number back (U-01a). That is the argument for doing the
  0b jump BEFORE any further UI testing, not after — every test run between now and then widens the
  discard.
  🟢 **CLOSED 03-09-2026, and RE-VERIFIED against live data before closing.** Ritesh Bhai asked
  whether the number is re-minted on every save. It is not, and the guard is proven three ways:
  `fms_ocpi_generate_quotation` reads `oc_no` into `v_oc` and mints only `if v_oc is null`;
  `fms_ocpi_decide_quotation` keeps its mint only as the pre-OCPI-36 fallback, on the same null
  test; and **QT-M0054 carries `quotation_version_no = 2` against ONE number**,
  `OTPL/OC/9/26-27`. A draft that is merely SAVED mints nothing at all. **Dropped from the
  OCPI-40 artifact at his instruction** — "that is not the big issue for me right now". U-02 dropped
  with it; the counter still has to be set, and that is item 0b, not a finding.
- 🔴 **U-02 · The OC counter is 115 behind the real register.** `fms_ocpi_counters.oc:2627` = 12; the
  real 2026-27 folders run to **127**. The next contract issued carries a number a customer already
  holds. The New Quotation screen warns about exactly this in an orange banner — this is that warning,
  measured. **Settings → Order confirmation numbering, before the first real contract.** One minute.
- **U-03 · The finished contract downloads before anyone approves it.** On a deal at stage 1, status
  Draft, the Revision-history row offers Summary / PI / **OC**; the OC link returns a complete 4-page
  order confirmation carrying the OC number, the customer's GSTIN, the price and every clause. It
  heads itself *ORDER QUOTATION* rather than *ORDER CONFIRMATION*, which is the only thing separating
  it from the real document. **A salesperson can send a customer a contract with no approval at all.**
  ✅ **FIXED 03-09-2026, AND THE DOWNLOAD ITSELF STAYS.** Ritesh Bhai: *"before the approval the
  finished contract can be downloaded, but it should not show as order confirmation. It should just
  show as order quotation, and the number should also be of the quotation only … it should mention
  the quotation number till it is not approved."* The heading was already right; the NUMBER was not —
  ORDER QUOTATION printed over `OTPL/OC/10/26-27`, which is what made it read as a contract.
  New `paperNo(deal)` in `lib/format.ts`, paired with `docHeading` on the same `oc_at` test:
  `QT-M####` before the approval, `OTPL/OC/…` after. Applied to the contract title bar
  (`ocPdf.ts`) and to the summary sheet's title bar AND its header cell, whose label now switches
  `Quotation No.` → `Confirmation No.` with it (`quotationPdf.ts`). Frozen as `paper_no` on the
  revision payload.
  ⚠ **THE PI IS DELIBERATELY UNTOUCHED.** `piPdf.ts` prints `Performa No. <ocNo>` at every stage,
  which is exactly what all 27 real folders do — folder 127 is headed `Performa No.
  OTPL/OC/127/26-27` months before any contract exists.
  ⚠ **NO APPROVED DOCUMENT CHANGES.** `oc_at` is set at approval and never cleared, so every paper
  ever headed ORDER CONFIRMATION keeps its number, frozen revisions included.
  **Proved with `scripts/oc-audit/verifyPaperNo.mjs`** — 22 checks, both papers × both states,
  rendered and read back with pdf.js. Each asserts the wrong number is absent from the WHOLE
  document, not merely that the right one is present: a check that only looks for what it expects
  passes on a paper carrying both.
- 🔴 **U-04 · A separately-priced item is excluded from the contract total.** Clothera's real paper:
  machine ₹46,50,000 + 30 print heads ₹21,00,000 + 18% GST = **₹79,65,000**. Ours stored
  **₹54,87,000** — the heads are not in it. **Understated by ₹24,78,000.** There is one deal-value
  box, and the Shipment & invoice section states in its own words that its figures are "not added to
  the deal value or its total". **There is no way to enter this deal correctly**, and 124 is a real
  signed contract, not a hypothetical.
  🔎 **ROOT CAUSE, traced 03-09-2026 at Ritesh Bhai's asking.** The price boxes are gated on the
  wrong answer: `branching.ts:299` reads `headInvoiceQty: (d) => d.headSeparateInvoice === true`, and
  the cell itself says *"Asked only when this item is billed on its own invoice."* So a price can be
  typed **only** for an item leaving on a DIFFERENT invoice — and that money is then correctly kept
  out of this contract's total. An item that is priced separately but billed on **this** contract, as
  Clothera's 30 heads are, has no box to go in at all. The exclusion is right; the gate is wrong.
  💡 **THE FIX IS ONE ANSWER WIDER, NOT A NEW TABLE.** Ask qty and rate whenever the item is part of
  the deal, then let the Yes/No already on the row decide where the money lands:
  **Separate invoice = No → the line prints in the priced block and ADDS to `total_inr`**;
  **Yes → exactly today's behaviour**, printed and excluded. Touches `branching.ts` (five gates),
  `fms_ocpi_write_oc` (the same five, plus the two totals), and the priced block in `ocPdf.ts`.
  ⚠ The three column comments in `20261026120000` and the `ink_offer_subtotal` ones in
  `20261024120000/130000` all state "MUST NEVER BE ADDED" as an unconditional rule; each has to be
  re-worded to the conditional it is about to become, or the next reader will "fix" this back.
  ⚠ **The ink/head OFFER rate is a different thing and stays excluded** — it is asked only when the
  consumable is NOT part of the deal, settled with the client 31-Aug-2026.
  🩹 **Until then, the stop-gap works and costs nothing:** type the combined figure in the deal-value
  box (₹46,50,000 + ₹21,00,000 = ₹67,50,000) and the GST and total come out right at ₹79,65,000. The
  contract then prints one lump sum instead of itemising the heads, which is the only thing lost.
- 🔴 **U-05 · "Amount" is a unit rate, and nothing on screen says so.** Entering the real paper's own
  figures — qty `30`, amount `21,00,000` — produced a sub-total of **₹6,30,00,000**.
  `lineSubtotal = qty × amount` (`QuotationForm.tsx:258`) is right; the labels are not. The column
  header reads **Amount**, the input's `aria-label` reads **"invoice amount, excluding tax"**, and the
  section blurb says "Amounts exclude tax". The only place the word *rate* appears is the stacked
  layout's `hint="quantity × rate"`, which the table layout never shows. **Rename the column to
  "Rate each" and the aria-label with it.**
  ✅ **FIXED 03-09-2026** — Ritesh Bhai: *"this is an easy fix that you can do at your own end only."*
  Column heading `Amount` → **`Rate each`**; the input's aria-label → *"rate for one, excluding tax"*;
  and the section blurb now leads with **"Rate is the price of one"**, before tax, and says the
  sub-total multiplies it by the quantity. Words only — `lineSubtotal` and the SQL that derives the
  stored figure are untouched, because the arithmetic was never wrong.

#### 🟠 Questions the form asks that it should not

- **U-06 · It asks how the ink ships on a deal with no ink.** The Shipment table promises "only the
  parts this deal actually carries are listed". After answering **No** to ink, spare parts and
  centering device, all three stayed — and then counted as missing answers that would print blank
  lines. 🔴 **`branching.ts` gates `dryerShipMode` on the deal's own answer (OCPI-8, 01-Sep) and gives
  `headShipMode`, `inkShipMode` and `sparesShipMode` NO RULE AT ALL**; `centeringShipMode` follows
  `f.showsCentering`, the machine's capability, not `inclCentering`. The comment describing the dryer
  fix describes this bug exactly — it was never applied to the other four rows. **Fix: the same
  predicate shape, one line each, plus their twins in `fms_ocpi_write_oc`.**
- **U-07 · "Pre-filled from the machine's template" — it is not.** *Manufacturer's model no.* stayed
  empty after picking Homer K24, whose master holds `HM1800B-TK24`. The printing half is fixed
  (OCPI-39 falls back to the master), so this is now only a false promise on the form — but it is the
  promise that hid the ruled blank for months. **Either prefill it or change the hint.**
- **U-08 · The same salesperson is offered twice.** Searching "Nakul" returns **Nakuleshwar Sharma**
  (roster) and **Nakul Sir** (free-typed on an older deal, under *NOT A PORTAL USER*). Both pickable;
  whichever is chosen, that person's deals split across two identities in every report. The
  off-roster group is deliberate (OCPI, `salespersonOptions`) and correct in general — this is one
  stale value to retire, not a design fault.

#### 🟠 Findable-afterwards problems

- **U-09 · A generated quotation does not appear in "My deals".** `MyDeals.tsx:29` filters
  `d.status !== "draft"`, and generating leaves the status at `draft` until it is sent for approval.
  All three new quotations were absent; they are only under **Drafts**.
- **U-10 · The Drafts screen contradicts itself.** Its subtitle reads *"No quotation number is issued
  until one is finalised"* while every row has one, and the **Reference** column shows the
  **contract** number (`OTPL/OC/12/26-27`), not `QT-M0057` — so the quotation number appears nowhere
  on its own row. ⚠ The other session has since corrected the delete-draft dialog's version of the
  same stale claim; this subtitle is the remaining one.
- **U-01a · Deleting a draft orphans its PDFs.** `fms_ocpi_delete_draft` is a bare delete: versions
  cascade, **storage objects do not** (3 PDFs per deal — Summary, PI, OC), `fms_ocpi_activity` has no
  FK to deals at all, and the OC serial is never returned. Found by the parallel PI session; measured
  here at 9 stored PDFs across the three test deals.
  🔴 **AND THE SERIAL IS THE PART RITESH BHAI CARES ABOUT — see U-14, his answer to it.**

#### 🆕 Asked for on 03-09-2026 — not built

- 🔴 **U-14 · A deal should be CANCELLED, never erased.** Ritesh Bhai, 03-09-2026, on being shown
  that a deleted draft takes its contract number with it: *"whenever we delete this, ideally we want
  to add this feature so that it should not be permanently deleted. There should just be an option
  for the user so that the number can be cancelled. That's it."*
  **Measured, so the leak is not theoretical:** `fms_ocpi_counters.oc:2627` stands at **14** while
  the highest surviving `oc_no` is **12** — two drafts were generated and deleted, and 13 and 14
  went with them. The quotation series shows the same shape: counter 59, highest `QT-M0057`.
  **The shape of the fix** — replace the hard delete with a cancellation: the deal row stays, marked
  cancelled, keeping `quotation_no` and `oc_no`, so the register can print `OTPL/OC/13/26-27 —
  CANCELLED` and a gap in the series always has a reason beside it. This also disposes of U-01a for
  free: nothing is deleted, so no storage object is orphaned and no activity row is left dangling.
  ⚠ **Do NOT rewind the counter instead.** Returning the serial is only safe when it was the last
  one issued; anything else re-issues a number in the middle of a live series, which is the one
  failure `fms_ocpi_set_oc_series`'s forward-only rule exists to prevent.
  ⚠ `status` already has a `cancelled` value in use (QT-M0034 sits there), so this is a route
  into an existing state from the draft stage, not a new state — check `fms_ocpi_delete_draft`'s
  callers and the Drafts screen's delete dialog together.

#### 🟡 Smaller

- **U-11 · The selling entity reads like a data error** — `ORANGE O TEC PRIVATE LIMITED
  (01-04-25TO31-03-27)`, Tally's company name with its financial year attached. What PRINTS is
  correct (`M/s ORANGE O TEC PVT LTD.`, from `own.legalName`) and the sublabel already says so, but
  the label is what a salesperson reads. Cosmetic, and one `label:` away.
- **U-12 · Trade-term wording differs from the papers** — ours `Ex Factory Surat`, the real 123 says
  `Ex-Work Surat (Transportation cost bear by customer)`. **Same root cause as the PI session's
  `composeTradeTerm` finding**; one decision from Ritesh Bhai closes it on both documents. See 0c.
- **U-13 · `KoloRado Alpha 3 — 12 heads` has no billing name** — the only machine in the picker with
  no "Bills as" line under it, and it is the row a **16**-head contract (124) must use. Head count is
  a deal field so the row is correct; the NAME is what misleads.

#### ✅ What worked, and is worth not breaking

The Tally picker returned Amarasha with the right GSTIN. The "still needed" panel names exactly what
is missing and jumps to it. Questions appear only when they apply — the dryer block appeared on
choosing a Homer. Typing an unknown machine offers **"Ask for …"** (a master request) rather than
silently creating one. And the *"the detailed sheet will print N blank lines"* warning, with the list,
is better than most systems manage.

**Both OCPI-39 fixes were re-proved on a contract produced through the real screen**, not headlessly:
`GST: 24AASCA8419N1Z0` under the address, and `(Model No: HM1800B-TK24)` where a ruled blank used to be.

### OCPI-41 · The re-audit — one finding withdrawn, two understated, and the fix he asked for was already built  `[x]` — 03-Sep-2026

Ritesh Bhai, after reading the OCPI-40 list: *"I wanted to re-audit so that there are no loose ends
and then accordingly give you the finalized action plan."*

Three read-only sweeps — every read of the contract number, every screen keyed on draft status, and
the 25 shipment fields against their SQL twins — plus a live-data pass. **The re-audit changed the
answer.**

#### 🔴 Corrections to OCPI-40 itself

- **C-1 · U-06 IS WITHDRAWN. It is your decision, not a defect.** I reported that `branching.ts`
  "gives head / ink / spares NO RULE AT ALL" and that the dryer fix "was never applied to the other
  four rows". The file says the opposite, as RULE 8 (`branching.ts:254-297`): **OCPI-14, 01-Sep-2026,
  deliberately severed** them from `inclHead`/`inclInk`/`inclSpares` — *"⚠ HEAD, INK AND SPARES HAVE
  NO ENTRY BELOW, and that absence IS the change."* The live `fms_ocpi_write_oc` was read back with
  `pg_get_functiondef`: **frontend and SQL agree on all 25 fields.** No drift exists.
  🔴 **Second time in this audit I reported a deliberate decision as a defect** — U-01 was the first.
  ⚠ **And my proposed fix would have destroyed live data:** gating centering on `inclCentering === true`
  would hide-and-null the row on the **19 deals where `incl_centering IS NULL`**, 3 of which hold
  centering answers. Head / ink / spares would have nulled 1 + 1 + 2 more.
  ✅ **What was real is narrower and is now fixed** — see N-5.
- **C-2 · U-13 — six machines, not one.** I found "the only machine with no billing name" by querying
  `name ilike '%alpha%'` — a sweep keyed on the answer I expected, which is the trap OCPI-36 wrote
  down. Unfiltered: **`Fab Pro 2I` · `Fab Pro 3I` · `JPK` · `KoloRado Alpha 3 — 12 heads` ·
  `Mini Lario` · `MP5000`.** Only Alpha 3 had a sibling pattern to copy; the other five are a
  Waiting-for.
- **C-3 · U-08 — 18 deals to re-attribute, not 3, plus 9 the audit missed entirely.**
  `Afrin Saiyed` **13** · `Nakul Sir` 3 · `KARAN SIR` 1 · `UMESH BHAI` 1 match no roster row at all.
  Separately, `Yash Agarwal` (7) and `Khurshid Alam` (2) carried a correct roster name and **no
  `salesperson_user_id`**, so they never matched the id route in My deals.

#### 🔴 What the sweeps found that the audit missed

- 🔴 **N-1 · "Cancel instead of delete" ALREADY EXISTED — two obsolete guards switched it off.**
  `fms_ocpi_cancel` keeps the row, keeps both numbers, demands a written reason, announces it. It
  refused a draft, above this comment: *"A draft is deleted, not cancelled: it burned no number and
  nobody has seen it."* **Both halves were overturned by OCPI-36 on 02-09.** The same `!isDraft` test
  hid Cancel and Hold in `LifecyclePanel`. So a quotation whose customer went quiet could only be left
  in Drafts or DELETED — the deletion that loses the serial and orphans the PDFs (U-01a).
- 🔴 **N-1b · AND THE GUARD CHANGE ALONE DID NOT DELIVER IT — found by TESTING, not reading.** The
  first run against QT-M0057 failed on `fms_ocpi_complete_when_submitted`: the CHECK exempts only
  `status = 'draft'`, so cancelling drops an incomplete row into the full 20-field completeness test.
  **Demanding a deal be COMPLETED before it can be ABANDONED is backwards** — and it is exactly the
  unfinished deal somebody needs to write off.
- 🔴 **N-1c · AND THE BUTTON WOULD HAVE BEEN UNREACHABLE.** `LifecyclePanel` renders only on
  `DealDetail`, and `DealsTable:60` routes every draft to `/edit` instead. The FIX-4 trap in reverse:
  a control built and never routed to.
- 🔴 **N-2 · The U-03 fix covered the papers and stopped.** `dealRef` (`lib/queues.ts:41`) was
  `ocNo ?? quotationNo` — ungated, feeding **9 screens**, including the **Quotation approval queue**,
  whose whole point is that the deal is not approved yet.
- 🔴 **N-4 · The approval-request EMAIL called a quotation by its contract number.**
  `fms_ocpi_email_payload` never consulted `oc_at`: subject *"Approval needed - quotation
  OTPL/OC/13/26-27"*, a fact row labelled *Order confirmation* on an unapproved deal, and rejections
  named the same way. 🟢 Latent — OCPI email is off — so it was fixed before go-live, not after.
- **N-3 · Pre-approval downloads are NAMED after the contract**, and so are the storage keys
  (`paperFileBase` → `ocpiWrites.ts:120`). ⚠ **Deliberately left** — the bucket uses `upsert: true`
  with the name as identity, so gating the stem RENAMES a deal's papers at approval and orphans the
  pre-approval objects. A storage decision, documented in place. **Held.**
- **N-6 · Six user-visible strings still described the pre-OCPI-36 world**, two outright false:
  `ApprovalPanel` told the approver *"no order-confirmation number is used up"*, and `SetupWarnings`
  said approving *mints* it — in the file whose own comment 80 lines above explains that it does not.
- **N-7 · A generated quotation was invisible almost everywhere** — All deals, My deals, the Dashboard
  tiles, every queue and every SLA surface. ⚠ The queue half needs a new bucket (`steps.ts:106` marks
  the quotation step `noQueue`), so it is **held and raised separately**.
- **N-8 · `{{oc_no}}` bypasses `paperNo` into any template body.** 🟢 Swept the live database: no
  section, intro, supply description or spec row uses it. Latent.
- **N-9 · The model-number fix holds** — `ocPdf.ts:273` spreads `tokensFor` then overrides at `:303`,
  verified — but `tokens.ts:156` has no fallback and `Machines.tsx:222` misdescribes the token.

#### ✅ Built, and how each was proved

| Stage | What | Proof |
|---|---|---|
| **A** | `dealRef` follows `oc_at`; `DealDetail` labels an unapproved serial *"Reserved for the contract"*; `fms_ocpi_email_payload` gated; 6 strings + 6 stale comments corrected | `fms_ocpi_email_payload` called on a live unapproved, a pre-OCPI-36 and an approved deal: `Approval needed - quotation QT-M0057` / `Reserved for the contract` / `Order confirmation` |
| **B** | Cancel + Hold turn on `quotation_no`, not `status`; the completeness CHECK exempts `cancelled`; `LifecyclePanel` mounted on the editor so a draft can reach it | Live RPC test in a **rolled-back** transaction: a generated draft cancels and **keeps both numbers**; a never-generated one is still refused; hold likewise. QT-M0057 confirmed unchanged afterwards |
| **C** | Alpha 3 billing name; 9 `salesperson_user_id` backfilled; selling-entity label; Drafts / My deals / All deals copy and filters; the model-number hint | Re-queried: Alpha 3 filled; **9 linked, the 18 ambiguous untouched** |
| **D** | The blank-lines warning fires only when the row will actually print; `shipmentLines`' false guarantee corrected | `npm run build` green; `verifyPaperNo` 22/22 and `verifyHeaderAndModel` 18/18 |

⚠ **Three migrations transform the LIVE function bodies** via `pg_get_functiondef` with anchor
assertions, then re-read and prove the result — the files on disk diverge from what runs.
⚠ **The completeness CHECK was WIDENED, never narrowed**, so no existing row could be invalidated.

#### Held — not mine to decide

The five machines with no billing name · the 18 salesperson re-attributions · **N-3** (the file-name /
storage decision) · **N-7's queue bucket** · and the PI still carrying `OTPL/OC/…` pre-approval, which
all 27 real folders do and which is worth re-confirming now that the contract no longer does.

---

### OCPI-45 · A dollar deal is never taxed, and the invoice names what ships  `[x]` — 04-Sep-2026

Ritesh Bhai on the OCPI-44 findings: *"a dollar deal should never be taxed. If it is getting taxed in
our scenario, that is wrong. The dollar deal should just be the amount multiplied by the conversion
rate. Can you please fix this?"* and, on the second, *"if you think you can fix this, then fix this if
that's a small fix."* The third (the EPCG wording) he moved to the discussion list — **not built**.

#### ✅ N-15 · A DOLLAR DEAL CARRIES NO GST

**One line, and it is a widening.** `fms_ocpi_write_oc` derived the rate as
`case when v_transport = 'high_seas' then null else …`; it now reads
`case when v_transport = 'high_seas' or v_currency = 'USD' then null else …`. A High Seas deal is
always USD, so the new disjunct is a superset and **nothing about High Seas changes**. What changes is
the "Others" deal quoted in dollars.

Its twin is **RULE 5** in `branching.ts`, now `d.transportTerms !== "high_seas" && !isUsdDeal(d)` — so
the GST question is hidden, `clearHidden` blanks it, and the payload never carries a rate. The form's
*"GST at 18% is added on the papers"* caption disappears with it, since it was already gated on
`show("gstRate")`.

**PROVED on the paper, regenerated through the live screen:**

| | Real folder 121 | Ours, after |
|---|---|---|
| Machine Value | `USD 11,50,000.00` | `USD 11,50,000.00` |
| Rate | `@96 (Fluctuate Rate)` | `@ 96 (Fluctuated Rate)` |
| Total | `INR 11,04,00,000.00` | **`INR 11,04,00,000.00`** |

The rupee deal is untouched: `QT-M0067` still prints `+ 18% GST Value INR 34,20,000.00` and
`Total Value INR 2,24,20,000.00`, matching folder 119 to the rupee.

⚠ **NO DATA WAS MIGRATED**, and one live deal is affected. **`QT-M0040` (AADESH DIGITAL PRINTS,
$1,00,000 @95, `awaiting_quotation_approval`)** still holds `gst_rate 18`, `gst_amount_inr 17,10,000`
and `total_inr 1,12,10,000`. It sheds them the moment anyone saves it — **it needs one re-save before
approval**, and that is a commercial figure on a live quotation, so it was reported rather than
rewritten. Frozen revisions keep whatever they printed either way.

#### ✅ N-16 · THE INVOICE'S PRICED LINE NAMES THE DRYER AND THE CENTRING DEVICE

`billing_name` is now rendered through **the same token and condition engine** the contract's
`supply_description` already uses, so it may carry `[[if dryer]]`, `[[if centering]]` and
`{{head_count}}`. 🟢 **A billing name with no markers renders byte-identically** — 18 of the 23 carry
none and their invoices do not change by one character.

**Five machines gained the condition**, and every fragment is **lifted verbatim from that machine's own
`supply_description`** — already-approved contract text that already prints on its order confirmation:

| Machine | Appended |
|---|---|
| Fab Pro 1I | `[[if dryer]] & WITH DRYER[[/if]]` |
| Homer K24 | `[[if dryer]] AND CHINES DRYER[[/if]]` |
| Homer K32 | `[[if dryer]] WITH DRYER[[/if]][[if centering]] WITH CENTRING DEVICE[[/if]]` |
| K64 | `[[if centering]] AND CENTERING SYSTEM[[/if]][[if dryer]] & DRYER[[/if]]` |
| Rocket | `[[if dryer]] WITH DRYER[[/if]]` |

🔴 **DO NOT TIDY THOSE INTO ONE HOUSE STYLE.** "AND CHINES DRYER" on K24, "& DRYER" on K64,
"WITH DRYER" on K32 — they are transcriptions of five different decks, not five spellings of one
phrase.

**PROVED on the paper:**

> `LARGE FORMAT INKJET PRINTER WITH 32 HEADS WITH STD. ACCESSORIES WITH DRYER WITH CENTRING DEVICE`
> — `QT-M0067`, against folder 119's *"…WITH 32 PRINTHEAD WITH DRYER WITH CENTRING DEVICE"*
>
> `STANDARD DIGITAL DIRECT TO FABRIC TEXTILE PRINTING MACHINE WITH STD. ACC WITH 224 PRINTHEADS WITH DRYER`
> — `QT-M0066`, against folder 121's *"…KYOCERA EX600 RC PRINTHEAD WITH DRYER"*

⚠ **`PiDocInput.facts` IS REQUIRED, NOT OPTIONAL, AND THAT IS DELIBERATE.** `NO_DEAL_FACTS` is the
*open* default — every flag true — so a caller that forgot it would print "WITH DRYER" on a machine
that has none, silently, on an invoice. Making it required meant `tsc` named all four call sites
(`ApprovalPanel` ×2, `ApprovedOcPreview`, `useQuotationDraft`) instead of one of them being missed.
Each already computed `factsForDeal(...)` for the contract a few lines away.

🔴 **DEPLOY ORDER: THE FRONTEND MUST GO FIRST OR TOGETHER.** The markers are inert until `piPdf.ts`
renders them; a database-ahead deploy prints the literal `[[if dryer]]` on a customer's invoice. The
migration says so in its own header.

#### 🔴 AND THE BILLING-NAME HALF WAS ROLLED BACK THE SAME HOUR

**I applied a migration whose own header said "the frontend must go first or together", and then did
not deploy.** The markers went into a column that the ORDER CONFIRMATION prints through a line that
does not render:

```
ocPdf.ts   if (machine.billingName) header.push(["Product:", machine.billingName]);
```

Read back off a freshly generated contract with pdf.js:

> `Product: STANDARD DIGITAL DIRECT TO FABRIC TEXTILE PRINTING MACHINE WITH STD. ACC WITH 224 PRINTHEADS[[if`

🟢 **No customer document was touched** — every paper generated in the 35-minute window was one of the
three test deals (`QT-M0065`–`67`), checked in SQL by `generated_at`.

**Rolled back** by `fms_ocpi_the_billing_markers_can_come_back_later` — all five billing names are plain
text again and the assertion proves no marker survives anywhere.

**Two code fixes went in so it cannot recur:**

- `ocPdf.ts`'s **Product header now renders** the billing name through the same tokens and conditions.
- `resolvedOcDocument` freezes the **rendered** name, not the raw one — otherwise the frozen record
  would claim `[[if dryer]]` was the document's own wording.

🔴 **TO RE-APPLY, AND ONLY WITH THE DEPLOY.** The five fragments are recorded in
`fms_ocpi_the_billing_name_can_say_what_ships`; re-run it **in the same release** that ships piPdf.ts
and the ocPdf header. Until then the invoices keep omitting the dryer and the centring device, which
is the state every issued paper has always been in.

⚠ **THE LESSON, AND IT IS NOT "RENDER HARDER".** Two places print one column. Teaching one of them to
render is not adding a capability to `billing_name`; it is leaving a trap in the other. Before putting
a marker into any master string, grep EVERY read of that column and prove each one renders.

#### Held — N-17, his decision

The EPCG / High Seas Agreement tail (`(Under EPCG License)`, `(UNDER HIGH SEAS SALES AGREEMENT)`) is
**not built**. Ritesh Bhai, 04-09: *"that third point also, I am not able to understand. You can just
add this to the points to discuss with Ritesh bhai."* It is the whole of standing item **0c** and
question 8 on the artifact.

#### Files

`lib/branching.ts` (RULE 5) · `lib/piPdf.ts` (`PiDocInput.facts`, `itemRows` renders the billing name) ·
`components/ApprovalPanel.tsx` · `components/ApprovedOcPreview.tsx` · `pages/deals/useQuotationDraft.ts`.
Migrations `fms_ocpi_a_dollar_deal_is_never_taxed` (live-body transform, anchor-asserted) and
`fms_ocpi_the_billing_name_can_say_what_ships` (guarded, idempotent, 5 rows). `npm run build` passes.

---

### OCPI-44 · The three deal shapes the first eight never covered  `[ ]` — 04-Sep-2026

Ritesh Bhai: *"let's try on these deals one by one. Do the high seas one that we have in the current
financial year, and do the [dollar] deals … and let's see what we come up with."*

The eight deals entered on 03-09 and 04-09 were **all the same shape** — local delivery, rupees, one
printer, stopped at draft. Every folder in both years was re-read to find what that missed. Three
shapes had never been entered once, and all three were driven through the live form:

| | Folder | Shape | Ours |
|---|---|---|---|
| High Seas | **106** Noor Dyeing, Position Printer | CIF Nhava Sheva under High Seas Sales Agreement + EPCG · USD 1,70,000 @95 | `QT-M0065` |
| Dollar, not High Seas | **121** Modi Dyeing, Rocket | CIF Nhava Sheva Port under EPCG · USD 11,50,000 @96 · ₹11.04 cr | `QT-M0066` |
| Dryer + centring device | **119** Modi Dyeing, Homer K32 | Ex-Work Surat · ₹1,90,00,000 + 18% GST | `QT-M0067` |

⚠ OCPI email re-verified OFF first. Three more OC serials consumed (20–22), still below the 128 jump.

#### 🔴 N-14 · MY OWN OCPI-43 CHANGE WAS WRONG ON A CIF DEAL — found by folder 121, and fixed

Folder 121 is an **Others** deal delivered **CIF Nhava Sheva Port**. The transport-bearer parenthetical
added yesterday appended itself to it:

> `CIF NHAVA SHEVA PORT (Transportation bear by Customer)` — ours, before the fix
> `CIF NHAVA SHEVA PORT (Under EPCG License)` — the real contract

🔴 **EVERY ONE of the counted parentheticals sits after `Ex-Work Surat`, and not one after a CIF or FOB
term** — because CIF already states who pays freight and insurance to the port, so naming a bearer
beside it *contradicts* the incoterm rather than completing it. The question itself says so: it is
titled **"LOCAL delivery cost borne by"**.

**Fixed:** the bearer is appended only to a term beginning `Ex-Work`. The test is on the COMPOSED TERM,
not on `deliveryVia`, so it also covers a legacy deal hydrated with the retired literal `Ex-Work Surat`
without a second condition to keep in step. Re-proved on the paper: 121 now reads `CIF NHAVA SHEVA
PORT`, 119 reads `Ex-Work Surat (Transportation bear by Customer)`.

⚠ **This is exactly why a shape has to be ENTERED, not reasoned about.** Yesterday's change was
verified on two local deals and a unit check, and both were the shape it happened to be right for.

#### 🔴 N-15 · A DOLLAR DEAL IS TAXED 18%, AND THE PERFORMA INVOICE THEN DOES NOT ADD UP

Folder 121, real paper: `Machine Value USD 11,50,000.00 · @96 (Fluctuate Rate) · Total Value INR
11,04,00,000.00`. **11,50,000 × 96 = 11,04,00,000 exactly — no tax line, and none needed.**

Ours prints the same first two lines and then **`Total Value INR 13,02,72,000.00`**, a difference of
**₹1,98,72,000**, with **no line on the page accounting for it**.

Two independent decisions collide:

1. **GST is decided by deal type alone** — `high_seas` ⇒ null, `local` ⇒ 18%. An "Others" deal quoted
   in dollars is `local`, so it is taxed. Written before any dollar "Others" deal existed; there is
   exactly **one** on record.
2. **The PI's dollar layout carries no tax line at all**, deliberately — `piPdf.ts` says so and names
   folder 120 as the specimen.

Each is defensible alone. Together they print a page whose own figures do not reconcile.

🟢 **THE EVIDENCE IS SIX PAPERS, ALL EXACT, NONE TAXED:** 105 (1,80,000 × 96 = 1,72,80,000) · 106
(1,70,000 × 95 = 1,61,50,000) · 107 · 109 (6,250 × 96 = 6,00,000) · 120 (94,063 × 96 = 90,30,048) ·
121 (11,50,000 × 96 = 11,04,00,000).

⚠ **NOT CHANGED.** Whether a dollar import bears GST is a tax classification, not a layout choice —
the same reasoning that left the HSN code alone. **Needed from accounts / Ritesh Bhai:** does a deal
quoted in dollars ever carry GST on the Performa Invoice? If no, the rule is currency-driven, not
deal-type-driven, and it is one line. 🟢 The **summary sheet** shows the full breakdown correctly
(`₹11,04,00,000 · GST @ 18% ₹1,98,72,000 · Total ₹13,02,72,000`), so the two papers already disagree.

#### 🔴 N-16 · THE PERFORMA INVOICE'S PRICED LINE OMITS THE DRYER AND THE CENTRING DEVICE

Folder 119 is sold **with both**, and its priced line says so:

> `LARGE FORMAT INKJET PRINTER WITH STANDARD ACCESSORIES WITH 32 PRINTHEAD WITH DRYER WITH CENTRING
> DEVICE MODEL (HM1800B- TK32-B1) (HSN CODE 84433910)`

Ours: `LARGE FORMAT INKJET PRINTER WITH 32 HEADS WITH STD. ACCESSORIES` — **the dryer and the centring
device are absent from the line the customer signs under**, though the deal records both
(`incl_centering = true`, dryer answered).

🟢 **THE CONTRACT GETS IT RIGHT** — read back with pdf.js, `QT-M0067`'s OC supply line reads
`STANDARD ACCESSORIES WITH 32 PRINTHEADS WITH DRYER WITH CENTRING DEVICE.` **So this is PI-only**, and
the cause is that the PI draws its description from `fms_ocpi_machines.billing_name`, a fixed master
string that cannot vary by deal.

⚠ **SAME ROOT CAUSE AS N-10, FROM THE OTHER SIDE.** N-10 prints heads that are NOT sold; this omits a
dryer and a centring device that ARE. One static line, two opposite errors.

#### 🔴 N-17 · THE EPCG / HIGH SEAS AGREEMENT TAIL CANNOT BE EXPRESSED — now proven on two papers

| Folder | Real paper | Ours |
|---|---|---|
| 106 | `CIF, NHAVA SHEVA (UNDER HIGH SEAS SALES AGREEMENT) (UNDER EPCG License)` | `CIF NHAVA SHEVA, from Indian port to customer premises` |
| 121 | `CIF NHAVA SHEVA PORT (Under EPCG License)` | `CIF NHAVA SHEVA PORT` |

This is the remainder of standing item **0c** — no longer an inference from folder 106's text, but two
papers generated side by side. Also on 120 (`CIF Hazira Port (Under EPCG License)`). The recommendation
in 0c stands: a typed field defaulted to the composed value.

#### 🔴 N-18 · OUR INSURANCE CLAUSE CONTRADICTS ALL THREE CURRENT-YEAR PAPERS

| | Wording |
|---|---|
| 106, 119 (and 121 omits it) | `Insurance : Insurance will Borne by Customer.` |
| Ours | `Insurance coverage up to the point of loading will be the responsibility of the company, while any coverage required during unloading will be the responsibility of the customer.` |

We take on a liability the real papers place wholly on the customer. ⚠ This is standing question 4,
raised from the 2025-26 K32 contract (folder 78, *"at our care till Port"*) — **now confirmed on
current-year papers and on two more machines**, so it is not a one-contract quirk. Three different
wordings across the estate; one of them is what Orange means.

#### 🟠 N-19 · "Shipment Terms" is replaced by a date — a third confirmation

106 `Shipment Terms : 30 to 45 Days from Order confirmation.` · 119 `Shipment Terms : 30 Days after
Order Confirmation.` · 121 `Delivery Terms : 30 Days After Order confirmation`. All three print DAYS;
ours prints `Delivery : Tentative delivery 24 Sept 2026`. Standing question 6.

#### 🟠 N-20 · The Special remarks field invites double numbering

Its placeholder demonstrates numbered lines — *"1. Installation within 15 days of dispatch"* — and the
PI renderer then prefixes its own. Typing the hint verbatim produced

> `1) 1. 500 Kgs Ink Included in Above value`

on `QT-M0065`. The summary sheet does not number, so the same text is right there and wrong on the PI.
Either the placeholder drops its numbers or the renderer stops adding them.

#### 🟡 N-21 · Two questions on one form both labelled "Agreed with the customer"

One under **Special remarks · section D** (the dollar-exchange clause) and one under **Document
details** (the insurance clause). ⚠ **CHECKED BEFORE REPORTING — they are two different fields**
(`dollarClauseAgreed`, `insuranceClauseAgreed`), not a block rendered twice. But the labels are
identical, the sections are far apart, and the missing-answers panel would name both the same way.
The dollar one appears **only on a USD deal**, which is why eight rupee deals never showed it.

#### 🟡 N-22 · The customer on folder 106 is not in the Tally master

Searching `NOOR` returns only `NOOR HAND DYEING`, with no GST number. The real contract is for
`NOOR DYEING`, GST `24DFPPA9070F1ZF`. Entered as a new lead, which is the normal path — noted because
it is the second Tally-master gap this week (see N-12).

#### 🟡 N-23 · Rocket's print-head list splits a name the real paper writes as one

The master offers **`EX600`** and **`RC`** as two choices; folder 121 writes
`KYOCERA EX600 RC PRINTHEAD`, and folder 120's spec row reads `KYOCERA RC MODEL EX600RC`. Either these
are two heads and the paper names one of them loosely, or it is a single model split in two. `EX600`
was picked and the contract prints correctly either way — but the master should say which.

#### ✅ What these three PROVED

- **Money matched exactly on 106 and 119** — `USD 1,70,000 @95 → ₹1,61,50,000` and
  `₹1,90,00,000 + 18% GST ₹34,20,000 = ₹2,24,20,000`, to the rupee. 121 differs only by N-15's GST.
- **High Seas renders end to end** — no GST row anywhere, deal type, dollar value, rate and the
  customer's delivery leg all on both papers. Never once exercised before today.
- **The dollar-exchange clause appears and is answerable** — it had never been seen on screen.
- All three contracts: headed `ORDER QUOTATION QT-M00xx`, **no contract number**, **zero ruled blanks**.
- `verifyPaperNo.mjs` 22/22 after the N-14 fix.

#### Still never tested

**The approval half.** All eleven deals stop at a generated draft. Nothing has gone approval →
contract issued → customer signature → management signature. ⚠ It cannot be done from one account —
the module refuses self-approval in both the panel and the SQL. **Needs a second login.**

---

### OCPI-43 · Who bears the transport reaches the paper, and the Tally picker names the GST  `[x]` — 04-Sep-2026

Ritesh Bhai, on the OCPI-42 findings: *"who pays the transport? Ask store printed nowhere, so I think
you can go ahead and fix this point. You can just print this at the right place in the order
confirmation based on the order confirmation output files that we already have"* and *"for the two
identical customers in Tally, one without GST, what you can do is, when we search for any customer,
you, along with the customer name, can also show the GST number there."*

**N-10 (printheads) was NOT touched** — on his instruction it stays in the artifact and moves into the
list of points to settle with him, because the replacement sentence is contract text on ten templates.

#### ✅ N-11 · The local transport bearer now composes into the printed delivery term

`composeTradeTerm` (`lib/fieldSpec.ts`) gains `localCostBy` and a `sellerName`, and appends the
bearer to the term on a **local** deal — exactly as the customer's delivery leg is already appended on
a High Seas one, and for the same reason: **a new token prints nowhere until all 21 decks are
rewritten**. Appending reaches the contract's SALE CONDITIONS clause, the PI's `Trade Terms :` line
and the summary sheet with no template change.

🔴 **THE WORDING IS THE PAPERS' OWN, COUNTED, NOT CHOSEN.** Every parenthetical in the parsed real
contracts:

| wording | occurrences |
|---|---|
| `(Transportation bear by customer)` | 4 |
| `(Transportation bear by Customer)` | 3 |
| `( Transportation Bear by Customer)` | 2 |
| `( Transportation Bear by Orange O Tec Pvt / Ltd)` | 1 |
| `(Transportation cost bear by customer)` | 1 |

Hand-typed, so it drifts in case and spacing. `Transportation bear by` is the form the majority carry
and is what was settled on. ⚠ **"bear by" is not a typo to correct** — it is how every one of these
contracts words it.

⚠ **THE COMPANY IS NAMED, NOT CALLED "COMPANY"** — the real paper writes
`( Transportation Bear by Orange O Tec Pvt / Ltd)`. The name comes from the selling entity's
**profile legal name**, never Tally's company name, which carries the financial year in the string
(`ORANGE O TEC PRIVATE LIMITED (01-04-25TO31-03-27)`) — that is the U-11 defect, and this would have
put it inside a contract clause rather than on a dropdown. The generic word survives only as a floor
so the term can never read `bear by )`.

🔴 **TWO CONTROLS HAD TO START RECOMPOSING, NOT ONE.** `patchDelivery` was documented as excluding the
local bearer because it "feeds nothing the term prints" — true, and that WAS the defect. **The selling
entity had to join it too**: a Company-borne term names the entity, so changing the entity after
answering the bearer would leave the wrong party's name on a contract, invisible until the PDF.
Seven controls now recompose.

⚠ **THE SUMMARY SHEET STOPPED SAYING IT TWICE.** That sheet has always printed its own
`cost by Customer` segment; beside the new parenthetical it would read *"Local Delivery · Ex Factory
Surat (Transportation bear by Customer) · cost by Customer"*. `quotationPdf.ts` now suppresses its own
segment when the stored term already carries the mark — **tested on the STRING, not on a date**, so
every deal raised before today keeps its segment and a frozen revision re-rendered years from now
behaves the same way.

⚠ **NO MIGRATION, AND NONE POSSIBLE.** `trade_term` is composed in TypeScript only — the RPCs write
`p->>'trade_term'` straight through, and `draftFromDeal` never recomposes. So the 17 deals holding
`Ex-Work Surat` and the one holding `CIF Jebel Ali` are untouched unless somebody edits them.

**PROVED END TO END, on papers produced through the real screen and read back with pdf.js:**

| Deal | Entered | Contract now prints |
|---|---|---|
| `QT-M0063` · 122 Vijay Laxmi | borne by **Customer** | `Delivery Terms: Ex Factory Surat (Transportation bear by Customer)` |
| `QT-M0064` · 101 Yashasvi | borne by **Company** | `Delivery Terms: Ex Factory Surat (Transportation bear by M/s ORANGE O TEC PVT LTD.)` |
| `QT-M0062` · 108 MK Fashion | untouched since OCPI-42 | summary keeps `· cost by Customer`, term unchanged — the legacy path |

Both headings still read `ORDER QUOTATION QT-M00xx`, the contract number is on neither, zero ruled
blanks. `verifyPaperNo.mjs` re-run: **all 22 checks pass.**

⚠ Only the FIRST half of the term is still open: we print `Ex Factory Surat`, folders 101, 122 and 127
all write `Ex-Work Surat`. That is the remainder of item **0c**, narrowed.

#### ✅ N-12 · The customer picker names the GST, and says when there is none

`CustomerPicker.tsx` passed the bare GSTIN as a sublabel, so the two `AKLAVYA INDUSTRIES PVT.LTD.`
rows differed by *a number under one of them and blank space under the other* — which reads as one row
that happens to be taller, not as a difference. Now:

```
AKLAVYA INDUSTRIES PVT.LTD.  |  no GST number in Tally
AKLAVYA INDUSTRIES PVT.LTD.  |  GST 24AAGCS6274F1ZA
```

⚠ **AND IT SURVIVES THE PICK.** `Combobox` renders a sublabel in the open list and **nowhere else** —
the trigger shows the label alone — so the fact that told the two apart vanished the moment one was
chosen. The GSTIN is repeated under the field, and a ledger with none says so in amber.

Verified in the live UI on `QT-M0060`, both rows read back out of the open menu.

#### ✅ And the term itself now reads `Ex-Work Surat` — his reversal, same day

Ritesh Bhai, later on 04-09: *"you can fix the trade term wording. Instead of X factory surat, you can
do X work surat."* 🔴 **This REVERSES his own decision of 02-09-2026**, which set `Ex Factory Surat` in
title case — recorded as such in `composeTradeTerm`'s header, and now recorded as a reversal rather
than quietly overwritten.

`composeTradeTerm` composes `Ex-Work <city>`; **the BUTTON still reads `EX Factory`**, because that
exact string is what `high_seas_via`'s CHECK allows and what the mirror writes. The answer and the
printed term are deliberately different strings, and the strip's "Prints on the contract as …" line is
what keeps that from reading as a bug.

🟢 **IT NOW AGREES WITH THE 17 LEGACY DEALS INSTEAD OF DIVERGING FROM THEM.** Those hold a free-text
`Ex-Work Surat` from before OCPI-35; a new deal composes the same words. **No migration, and none
wanted** — nothing stored was touched.

Migration `fms_ocpi_the_printed_term_reads_ex_work` is **comments only**: `delivery_factory_city`'s
comment stated the old format, and `trade_term` had none at all and now records the whole composition
rule including OCPI-43's bearer.

Read back off the regenerated PDFs: `Delivery Terms: Ex-Work Surat (Transportation bear by Customer)`
and `… (Transportation bear by M/s ORANGE O TEC PVT LTD.)`. `verifyPaperNo.mjs`: 22 of 22 pass.

#### Files

`lib/fieldSpec.ts` (`composeTradeTerm`, new `TRANSPORT_BEARER_MARK`, `Ex-Work`) · `lib/tokens.ts` ·
`lib/exportRegister.ts` · `components/QuotationForm.tsx`
(`patchDelivery`, new `sellerNameFor`, the local-bearer and selling-entity controls) ·
`lib/quotationPdf.ts` (summary de-duplication) · `components/CustomerPicker.tsx`.
`npm run build` passes. **No SQL, no migration, no template change.**

---

### OCPI-42 · Five more real contracts typed in — two defects the first three could not show  `[ ]` — 04-Sep-2026

Ritesh Bhai: *"I believe you just tried the front-end testing with just two of the documents, so I want
you to try five more from the 26-27 folder … automatically opening up a playwright."*

**Five more real 2026-27 contracts driven through the live form**, click by click, covering four
machines the first run did not: **117 Aklavya** (Kolorado Alpha 15) · **111 VPS Textile** (Alpha II
1.8) · **108 MK Fashion** (Alpha II 1.9, sold WITHOUT printheads) · **122 Vijay Laxmi** (P8S) ·
**101 Yashasvi** (P8S, and the one real paper carrying NO GST number). Produced `QT-M0060`–`QT-M0064`.

⚠ **OCPI email re-verified OFF before anything was typed.** ⚠ Five more OC serials consumed (15–19);
the counter now stands at **19**, still below the 128 jump, so they are discarded by it.

#### ✅ Every total matched the real paper to the rupee

| Contract | Machine | Real paper | Ours |
|---|---|---|---|
| 117 Aklavya | Alpha 15 | ₹27,73,000 | **₹27,73,000** |
| 111 VPS | Alpha II 1.8 | ₹15,34,000 | **₹15,34,000** |
| 108 MK Fashion | Alpha II 1.9 | ₹7,90,600 | **₹7,90,600** |
| 122 Vijay Laxmi | P8S | ₹35,40,000 | **₹35,40,000** |
| 101 Yashasvi | P8S | ₹44,26,180 | **₹44,26,180** |

#### 🔴 N-10 · A machine sold WITHOUT printheads still prints "With 8 printheads"

**108 MK Fashion is a real signed contract for a machine supplied without heads** — its own
composition reads `WITH STANDARD ACCESSORIES (Without printheads)`. Entered exactly that way:
*Deal includes head → No*. The row stored it correctly (`incl_head = false`).

**The contract prints the opposite**, read back off the stored PDF with pdf.js:

> `WITH STANDARD ACCESSORIES (With 8 printheads)`

🔴 **ROOT CAUSE — THE PRINT HEAD IS THE ONE INCLUSION A TEMPLATE CANNOT BRANCH ON.** Ten of the
twenty-one templates assert it unconditionally as `WITH {{head_count}} PRINTHEADS`, while the dryer
and the centring device beside it ARE guarded — `[[if dryer]]`, `[[if centering]]`. There is no
`[[if head]]` to write: `conditions.ts` exposes only `dryer`, `centering` and `usd`, so the guard does
not exist even for an author who wanted it.

**Affected:** Fab Pro 1I / 2I / 3I · Homer K32 · K64 · all three KoloRado Alpha IIs · P8S · Rocket.

**The fix is two halves, and only the first is mine.** Adding a `head` condition
(`deal.inclHead === true`) to `conditions.ts` and its SQL twin is additive and safe. **Re-wording ten
templates is contract text and is NOT ours to invent** — the real paper's own phrasing
(`(Without printheads)`) is the obvious candidate, but it goes to Bushra.

⚠ `head_count` is the machine's CAPACITY, not what is being sold; `heads_included` is what is sold and
was correctly `null` here. The template reads the wrong one of the two.

#### 🔴 N-11 · The transport-cost answer is captured and printed nowhere — now measured on two deals that differ

Deliberately entered as opposites, from the real papers:

| | Entered | Real paper says | Ours prints |
|---|---|---|---|
| 122 Vijay Laxmi | borne by **Customer** | `Ex-Work Surat ( Transportation Bear by Customer)` | `Ex Factory Surat` |
| 101 Yashasvi | borne by **Company** | `Ex-Work Surat ( Transportation Bear by Orange O Tec Pvt Ltd)` | `Ex Factory Surat` |

**Two contracts with opposite commercial terms print the identical line.** The answer is asked, stored
(`local_cost_by` = `customer` / `company`) and reaches no document. This is the standing item **0c**
question 7, no longer an inference — it is two deals.

#### 🟠 N-12 · Two identical customers in the Tally picker, one with no GST

Searching `AKLAVYA` returns **two** rows both reading `AKLAVYA INDUSTRIES PVT.LTD.` — one carrying
`24AAGCS6274F1ZA`, one carrying nothing. Nothing on screen distinguishes them beyond the GST line.
Pick the wrong one and the contract goes out with no GST number, which the OCPI-39 fix made visible on
the paper. Not our data — it is the Tally master — but the picker could show only the GST-bearing row,
or mark the other.

#### 🟡 N-13 · The frozen record says the paper carried no number, when it carried one

`oc_document_payload.paper_no` and `trade_term` are **null on all five**, while the PDFs correctly
print `QT-M0060` and `Ex Factory Surat`.

**Because `resolvedOcDocument` is called one line too early.** `useQuotationDraft.ts:286` freezes from
`saved`; `generateWrite` then mints the numbers and composes the trade term in SQL; only afterwards is
the row re-read into `rendered`, which is what the PDFs are drawn from — and the re-read's own comment
says it "carries the quotation number the RPC just minted, which the form state does not."

So **every server-derived value is missing from the frozen record**: both numbers, the trade term, the
GST and totals. The document is right; the record of it is not — and `revisionDiff` reads that record.

#### ✅ What this run PROVED, on papers produced through the real screen

- **U-03** — all four contracts read back with pdf.js are headed `ORDER QUOTATION QT-M00xx`, carry the
  quotation number, and **the contract number appears nowhere on any of them**. Zero ruled blanks.
- **Stage B** — *Put on hold* and *Cancel the deal* now appear on a generated draft, with the new
  wording. Unreachable before 03-09.
- **Stage D** — answering No to ink and spares no longer lists them as blank lines that will print.
- **U-05 / U-07 / U-11** — the column reads *Rate each*, the model-number hint tells the truth, and the
  selling entity reads `M/s ORANGE O TEC PVT LTD.` with Tally's name beneath it.
- ⚠ The stored file name is still `OTPL-OC-17-26-27 - M K Fashions - OC.pdf` on a draft — **N-3**,
  deliberately left, and now seen on five more files.

**Harness:** `node scripts/oc-audit/readIssuedPapers.mjs QT-M0060 …` downloads each stored paper and
reads it with pdf.js — heading, which number is on the page, the supply line, the trade term and any
ruled blank. Use it after every UI run; the PDF is the ground truth, not the payload and not the row.

---

#### Housekeeping — awaiting a word from Ritesh Bhai

- **The three test deals still exist** — `QT-M0055` (Amarasha), `QT-M0056` (Clothera), `QT-M0057`
  (Prabal), holding `OTPL/OC/10`, `/11`, `/12` of 26-27 and 9 stored PDFs. Not deleted: deleting does
  not return the serials, so the counter reset (U-02) is the part that matters either way.
- 🔴 **A live access/refresh token was found being served at the web root** —
  `frontend/public/__tmp_session.json`, left from earlier browser testing, and Vite serves `public/`
  publicly. **Deleted 03-Sep-2026.** If that trick is used again, delete the file in the same step
  that reads it.


---

## HR  *(two new modules)*

*(cross-ref: **PF-13** — Recruitment's HOD / probation / `hr_head_approval` / `final_decision` and Exit's `hr_head_approval` / `fnf_approve` all rest on one person; **PF-14** — Travel Desk's director, advance and finance steps have nobody configured at all)*

### EX-1 · 🟢 HR Exit module — built and deployed, never launched. Do we launch it?  `[ ]`
*Raised 2026-09-03 · 🟢 **Low priority** · **Status: NOT LAUNCHED** — this is a decision, not a build*

**The module is finished and live on the server, and nobody has ever used it.** Measured 03-09-2026:

| Checked | Found |
|---|---|
| Code | `hrExitApp` is registered on `master`; the manifest reads `status: "live"` |
| Who can see it | **5 `hr-exit` grants** exist in `app_access` — so it is not hidden, people have it |
| Ever used | **0 exit cases.** Not one has been raised since it shipped |

So unlike Travel Desk (**TR-1**, deliberately on hold with zero grants), this one was handed to
people and simply never picked up. **The question is whether it is wanted at all.**

**To decide:**
- [ ] **Launch it, drop it, or leave it dormant?** If it is wanted, it needs an owner and a walkthrough
      with HR — five grants and no cases usually means nobody was told what it was for.
- [ ] If it IS launched, two things come with it: `email_module_enabled('hr-exit')` is **false**, so
      nothing it sends will actually go out until that is flipped; and **PF-14**’s step-owner gap does
      NOT affect it (Exit has owners configured) — but **PF-13**, the reassign port, was dropped, so
      an approval that lands on the wrong person cannot be handed on.

⚠ **Do not confuse this with the exit data itself.** Zero cases means the module is unused, not that
nobody has left the company — those exits were handled outside the portal, so there is no history in
here to migrate or report on.

### KB-1 · 🟢 HR knowledge base — a second brain over the HR documents  `[~]`
*Raised 2026-08-20 · **🟢 Low priority, IN PROGRESS (03-09-2026).** A demo has already been built and
shown; what remains is turning it into something live. ⚠ The permissions question below must be
settled BEFORE anything is indexed — retro-fitting who-may-read-what after the fact means
re-indexing the whole corpus.*

There are a lot of HR documents. Build a **second-brain** over them so people can search and get
answers out of them — a **vector database with a RAG** system behind it.

**Notes:** the hard part here is not the retrieval, it is that **no vector storage exists yet** —
nothing in the repo uses pgvector or embeddings. That piece is genuinely new.

What is *not* new is the AI plumbing, and it is worth copying rather than reinventing. Six Edge
Functions already call models server-side — `score-candidate`, `parse-jd`, `parse-resume`,
`extract-card`, `transcribe-voice`, `analyze-receivables` — and they share a deliberate contract:
the browser sends **one id and nothing else**, and the function fetches everything the model reads
server-side using the caller's own JWT. That exists because a key must never reach the browser (the
receivables AI chat was deliberately left unported for exactly that reason). A RAG endpoint follows
the same shape.

**Worth settling before building:**
- [ ] Which documents are in scope, where they live now, and who keeps them current.
- [ ] Permissions — HR documents are not uniformly readable. Does retrieval filter by who is
      asking, or is the whole corpus open to anyone with the module? This has to be decided before
      indexing, not after.
- [ ] Does an answer cite the document it came from? Without a citation nobody can check it, and an
      HR answer that cannot be checked is worse than no answer.
- [ ] pgvector inside the identity project, or a separate store?
- [ ] How re-indexing is triggered when a document changes.

### TR-1 · 🟢 Travel reimbursement module (Travel Desk) — built, ON HOLD  `[!]`
*🟢 **Low priority · ON HOLD at Karan Bhai’s request** (recorded 03-09-2026). The module is
**substantially built and deployed** — all ten phases done, `travelDeskApp` is on `master`, and the
database holds **22 trips** from the build. It is being held back deliberately, not because anything
is broken.*

⚠ **Two things to know when it comes off hold:** `app_access` holds **ZERO `travel-desk` grants**, so
today nobody but an admin can open it; and go-live still waits on **H1**, the band → travel-category
contradiction in the policy (§2 has two tables that disagree, affecting 23 of 59 employees). Neither
is new work — both are recorded in detail below and in [TRAVEL-DESK.md](TRAVEL-DESK.md).

*Raised 2026-08-20 · Unblocked 2026-08-20 · **Built 23–24 Aug 2026.** Ten phases, each verified
against the live database and the running app before the next started. Live log:
[TRAVEL-DESK.md](TRAVEL-DESK.md).*

Delivered as **Travel Desk** ([frontend/src/apps/travel-desk/](frontend/src/apps/travel-desk/)) —
the whole trip lifecycle, not only the reimbursement half: request → band entitlement → approval →
advance → booking → travel → claim → daily allowance → HOD review → Finance verification →
settlement. One trip carries all of it, with many legs.

**Every question this entry asked has an answer, and it is a setting rather than code:**

| Asked | Answered |
|---|---|
| What the entitlement slabs key off | **Band → travel category → city tier.** The band comes from the org masters; the mapping and every rate live on an effective-dated **rate card** a Director confirms, so January's revision is a new card and not a deploy |
| Who approves, in how many stages | **Reporting manager for bands 1–5; manager + Director for bands 6–9** (§3.2), configurable in Settings → Approval matrix. The claim is approved again by the manager, then verified by Finance |
| Whether bills must be attached | **Per expense category**, with a receipt threshold and a self-declaration limit on each. §15's non-reimbursable list is carried as categories that refuse **by the category** — alcohol, fines and personal entertainment cannot be claimed or paid, and Finance cannot override that |
| How it settles, and whether it hands off to payroll | **It stops at Finance-marked Paid** — amount, date, mode and reference recorded — per the confirmed scope. Nothing writes to Tally or payroll: the ConnectWave mirror is read-only and there is no payroll integration. Where money comes *back*, the recovery is recorded against hr-exit's existing **Advance Recovery** deduction head |
| Whether an advance can be drawn before travel | **Yes**, capped at 90% of the estimate (§11.1), due **before departure** — the one deadline in the portal that counts backwards — and §11.2's "no second advance while one is unreconciled" is now enforceable, because Outstanding Advances can finally answer who owes what |

**Two things it does that were not asked for and are worth knowing about:**
- **GST input credit register** — §11.3 wants the credit on travel invoices; nothing in the business
  could list it, so nobody claimed it. The tax is apportioned to the settled share of each line.
  The company GSTIN is still unknown (**H8**) and the screen says so rather than printing a
  placeholder — until Finance confirms it, hotels bill employees personally and the credit is lost
  at source.
- **Policy exceptions** — §16 asks for a periodic review of exceptions and there was no list to
  review. Every capped line, every one Finance settled higher, every one settled lower, with the
  reason and whether §7.3's evidence and HOD approval are both on file.

**The hand-off this module makes possible:** hr-exit's `travel_advance` clearance row was a tick
from memory, because nothing could answer whether a leaver still owed travel advance. It now demands
evidence and can read the live figure by employee code — which matters, since exit cases carry a
nullable user id and plenty of staff never had a login.

**Not built, deliberately:** group travel (§11 is entirely per-employee, so two people travelling
together raise two trips), push notifications (the portal has no push infrastructure of any kind),
and any write to Tally or payroll.

**⚠ BUILT, NOT LIVE. Two things gate go-live, and both are HR's to answer:**
- **H1 — the policy contradicts itself on band → travel category.** §2 contains two tables, one
  after the other, that disagree: Band 8 is TC-A *and* TC-B; Band 3 is TC-D *and* TC-C. On live
  headcount that is **23 of 59 employees**, and Band 3 is the largest band and the field staff who
  travel most. Every cap, rate and class rule keys off it. Both readings are seeded on the draft
  card; confirming the card is what makes caps enforce rather than advise.
- **~30 figures marked `[⚠ CONFIRM]`** in the source, and Annexure C says no rate is final until
  both Directors sign off.

Six further contradictions (**H2**–**H7**) are recorded in [TRAVEL-DESK.md](TRAVEL-DESK.md) with the
reading taken for each. **H2 — the half-DA rule, which is impossible as written** — is resolved by
reading rather than guessing, and every threshold behind it is config, so a correction is a settings
change plus a recompute.

**Email notifications ship OFF.** Turning them on in Settings is a live send, and this module mails
people about their own pay.

---

## New Recruitment

*(cross-ref: **PF-13** — the MRF approvals get a reassign, and `fms_hr_can_act`'s hiring-manager branch `return`s with no fall-through)*

The live recruitment FMS — [frontend/src/apps/hr-recruitment/](frontend/src/apps/hr-recruitment/),
id `hr-recruitment`, tables `fms_hr_*`, shown in the portal as **New Recruitment**. The two entries
under **HR** above are separate *new* modules and do not belong here.

### The HR change list  *(opened 2026-09-02)*

A running list of the changes wanted on this module, in the order they were raised. Each gets its
own **NR-n** entry below; this table is the index, so the list can be read without scrolling.

| # | Raised | What | Entry | Status |
|---|---|---|---|---|
| 1 | 2026-09-02 | A management pipeline dashboard — every position's pipeline on one screen, with the candidate's own detail readable from it | **NR-2** | `[ ]` |
| 2 | 2026-09-02 | Map one or more HODs to a position so they own it exactly as if they had raised the MRF — today the picker cannot even show them. **Part B:** a Setup → Department HODs master that pre-fills it | **NR-3** | `[ ]` |
| 3 | 2026-09-02 | HR must have full pipeline control — today they cannot action the seven HOD steps on a position a head raised, and **Settings cannot grant it** | **NR-4** | `[ ]` |
| 4 | 2026-09-03 | Edit, delete and re-upload the videos and documents HR attaches — today every one is write-once, and the RPCs structurally cannot clear a value | **NR-5** | `[ ]` |
| 5 | 2026-09-03 | The EA board shows *4 · 2 in play* for 2 people — the same candidates were entered twice, and the duplicate check cannot catch a CV with no email or phone. Filed as a **fault**, not a task, so it sits in [Fixes](#fixes) | **FIX-5** | `[x]` |
| 6 | 2026-09-03 | A cancelled position shows no reason, no date and no person — though all three are stored. Show them, on the page and on hover, for every stopped state. **Plus:** the Completed tabs of all five HR queues named a department and never the position | **NR-6** | `[x]` |
| 7 | 2026-09-03 | The Positions grid's **Close** button actually **cancels** — five real vacancies were cancelled through it. Filed as a **fault**, so it sits in [Fixes](#fixes) | **FIX-6** | `[x]` |

*More points are expected on this list, and **nothing is being built until they are all in** — the
client wants them gathered first so they can be sequenced together. Add each here as it comes in,
then write its entry.*

🔴 **ALL FIVE POINTS WERE HIGH PRIORITY** *(client, 03-09-2026)* — NR-2, NR-3, NR-4, NR-5 and
FIX-5. **FIX-5 shipped 05-09-2026**; the remaining four are still the highest-priority block on the
whole list.

⚠ **Build order is NOT list order, and getting it wrong makes things worse:**

1. **NR-4 first** (or with NR-3). NR-3 hands 17 positions to real HODs, and on today’s rules that
   TAKES the seven HOD steps away from HR on every one of them. NR-4 is what keeps HR able to work
   them. NR-3 alone is a regression.
2. **NR-3 next** — its Part B (Setup → Department HODs) also unblocks RC-style per-user scoping and
   fixes NR-1’s thin Round-2 interviewer picker at source.
3. **NR-2 and NR-5** are independent of each other and of the above. (**FIX-5** was too, and is
   done — though NR-5 should re-read its `fms_hr_update_candidate` note: that RPC is now guarded
   against duplicates, so wiring it to an Edit control no longer reopens FIX-5.)

⚠ **Points 5 and 7 are FIXES, not NRs.** They were faults somebody hit rather than changes somebody
asked for, so by this file's own rule they live in [Fixes](#fixes) as **FIX-5** and **FIX-6**. They are
indexed here anyway, because the list must show everything that was raised — otherwise seven points
look like five.

⚠ **Points 6 and 7 were built immediately, OUT of the parked batch.** The rest of this list is
deliberately waiting so it can be sequenced together; these two were asked for directly on
2026-09-03 and shipped the same day. Nothing else moved.

### NR-6 · A stopped requisition says why, who and when  `[x]` — built and applied 2026-09-03

*Raised 2026-09-03 by Ritesh Bhai, alongside **FIX-6** — "whenever we close or cancel anything we ask
for the reason; I want to show the reason somewhere, the date and time, and who". Audited against the
live database, not the migration files. Migration applied to `icutjkrqkbzwvmnfbzpr`; frontend green.*

**The ask.** Cancelling asks for a reason. Show it — plus when, and by whom.

#### What made it worth doing today

`cancel_reason` has been written since the module shipped and was **rendered on no screen anywhere in
the application**. Five live vacancies were carrying it:

| MRF | Reason | When | By |
|---|---|---|---|
| MRF-2627-0010 | Its Sales Co-ordinator not Service Co-ordinator | 11-Aug-2026 | Riya Kumari |
| MRF-2627-0011 | Please Upload the JD and Location | 13-Aug-2026 | Riya Kumari |
| MRF-2627-0014 | not the right position | 21-Aug-2026 | Riya Kumari |
| MRF-2627-0016 | Upload JD properly | 25-Aug-2026 | Riya Kumari |
| MRF-2627-0018 | Rejected | 03-Sep-2026 | Karan Toshniwal |

🔴 **Read them: they are instructions to the requester.** "Please Upload the JD and Location" is not a
record, it is a message — and the raiser sees only a grey CANCELLED pill on their own dashboard
(`myRequisitions` is unfiltered by status). **Cancel was being used where Send back was meant**,
because the reason never reached anybody. That is the cost, and it is why this was not cosmetic.

#### What was already there, and what was missing

| State | Reason | When | Who |
|---|---|---|---|
| Cancelled | `cancel_reason` ✅ | `closed_at` ✅ | `decided_by` ✅ — **but never mapped into the frontend** |
| Rejected | `reject_reason` ✅ | `rejected_at` ✅ | `decided_by` ✅ |
| Sent back | `sent_back_reason` ✅ | `sent_back_at` ✅ | `decided_by` ✅ |
| On hold | `hold_reason` ✅ | `hold_at` ✅ | **nothing — no actor column at all** |
| Closed | *"all N seats filled"* | `closed_at` ✅ | the system |

So three of the four needed **no migration** — only a mapper line. Hold needed a column.

#### ⚠ Two traps that shaped it

**`decided_by` is one shared slot, not a per-event actor.** Reject, send-back and cancel all write it.
It is trustworthy *only* read against the CURRENT status, because each write coincides with the status
it explains. **Reading it for a hold would name whoever last sent the requisition back** — so hold got
its own `held_by`.

**`fms_hr_announce` with no recipient array writes the activity row and nothing else.** `p_user_ids`
defaults to `'{}'` so the bell loop never runs, and its email arm is scoped to `master_request` /
`candidate.interview_*`, so a `requisition` row cannot reach `email_outbox` even with the switch on.
That is what let the trail be added without the notification change `20260713120000` explicitly
refused ("quietly starting to would be a behaviour change nobody asked for").

#### Built

- **Migration `20261107160000_fms_hr_hold_and_cancel_are_recorded.sql`** — adds `held_by`; re-issues
  `fms_hr_hold_requisition` (stamps and clears `held_by`, announces `held` / `resumed`) and
  `fms_hr_cancel_requisition` (announces `cancelled`, accepted-hire guard preserved verbatim); backfills
  one activity row per existing cancellation. Signatures unchanged, so `create or replace` kept the
  execute grants — dropping would have revoked them.
- **`components/StateNote.tsx`** — one banner for all five end-states, replacing three hand-rolled
  copies in MrfDetail that had no fourth for `cancelled`. Exports `stateNoteText()` so the tooltips
  cannot drift from the banner.
- **Tooltips** on the state badge in Positions, Requisitions, the Control Center's held chips, and —
  the one that matters — the raiser's own **Dashboard** list.
- **`personName` replaces `profileById`** in MrfDetail. The directory is RLS-scoped to the reader's
  department, so the canceller, the approvers and the raiser all rendered as **"Unknown"** to anyone
  outside it. Five renders, including the History card this migration just started populating.
- MrfStepper's bare red "CANCELLED" chip removed — the banner sits 8px below it and says the same word
  plus the reason.
- Two raw-enum leaks fixed: `PositionPipeline` ("This position is cancelled") and `reqTerminalBar`.

#### 🔴 The backfill's `created_at` was load-bearing

`master_report_snapshot` runs an **unfiltered** `max(created_at)` and a 7-day
`count(distinct actor_id)` over the whole of `fms_hr_activity`. Had the five backfilled rows taken the
default `now()`, the next Master Report would have reported New Recruitment's last activity as the
migration timestamp and inflated its active-user count for a week. They are stamped from `closed_at`.
There is no unique index on that table, so the `not exists` predicate *is* the idempotency.

#### Follow-up the same day — the Completed tabs named a department and never the position

*Raised 2026-09-03 by Ritesh Bhai, from the same screen: "in the MRF approvals we just see the
department, we don't see the position." Built the same day.*

The screen has two tabs and **only one had the gap**:

| Tab | Columns | Position? |
|---|---|---|
| Pending — "waiting on your decision" | MRF · Department · **Position** (+ seats) · Raised by · Salary · Waiting on · Due | ✅ already there |
| Completed — "decisions you have made" | MRF · **Department** · Step · Done on · By · Edited | ❌ **no job title at all** |

⚠ **Why Pending looked broken too, and is not.** Its tab is **empty**: all 23 requisitions are past
both gates — 18 `sourcing`, 5 `cancelled`, **nothing at `hr_review` or `mgmt_review`**. There is no row
to see the column on. Do not "fix" Pending; it would render Position twice.

⚠ **`columnPicker` was ruled out as a cause** — `QueueTable` can hide columns and remember it in
`localStorage`, but *"no menu ⇒ nothing may be hidden"* (`QueueTable.tsx:310`) and **neither table opts
in**. Nothing on this screen can be hidden by anyone. Recorded so nobody re-investigates it.

**The fix: one column in [components/CompletedTable.tsx](frontend/src/apps/hr-recruitment/components/CompletedTable.tsx),
which backs FIVE queue screens** — MRF Approvals, Job Posting, Interviews, Onboarding, Probation.

**The three candidate-side queues gained more than the one that prompted it.** A completed interview
read `Purvi Upadhyay · Sales` and never said which vacancy she was seen for.

No plumbing was needed. Every one of the six `StageEntry` builders (`store.tsx:1070-1161`) already
carries a real `requisitionId`, and `departmentId` is likewise carried as an **id** that the table
resolves to a name — so Position takes the identical shape, and because `deptOfReq` derives the
department from that same requisition, the two columns cannot disagree. `filter: select`, matching
Department / Step / By in the same table.

**Checked and clear:** the Decide dialog already names the position (via `MrfRecap`); notifications read
*"Requisition raised: {jobTitle}"* — they name the position and omit the department, the opposite gap,
and they **do** fire (22 `submitted` + 66 `approve` rows live — the store writes them, not SQL, so a
migrations-only search wrongly concludes nothing fires); Control Center, MrfList and MrfDetail all name
it; there is no MRF email and no requisition PDF.

**Offered and NOT built — one line, whenever it is wanted.** **My Work Today** shows an approver
`MRF-2627-0012` and nothing else — no department, no position. `WorkItem.detail`
(`core/workspace/mywork/types.ts:39`) is the second line that **travel-desk, order-to-dispatch and
asset-maintenance all populate and the HR provider never sets** (`mywork/items/hr.ts:101-114`). It is
the screen an approver starts their day on, so it arguably matters more than the Completed tab.

#### Noted, not fixed

- **The Master Report counts a held vacancy as OPEN** (`closed_statuses` = `{closed,cancelled,rejected}`
  in `20260830120000:176`) while the module's own `isOpenRequisition` counts it as closed. Pre-existing
  disagreement; nobody has complained; left alone deliberately.
- **Six other FMS modules hand-roll the same reason banner** — `hr-exit`, `asset-maintenance`,
  `sampling`, `travel-desk`, `order-to-dispatch`, `import` — and none of them shows a person or a date
  either. A shared `shared/components/ui/` primitive would fix all six. Not done here; the ask was New
  Recruitment.
- **A Reason column** on the Positions grid (sortable, filterable, in the Excel export) was offered and
  not taken, so the reason is screen-only — an export of cancelled positions still reads just
  "Cancelled". One column whenever it is wanted.

---

### NR-2 · 🔴 A management pipeline dashboard — every pipeline on one screen  `[ ]`
*Raised 2026-09-02 · Audited the same day against the live database and the running code · Scoped,
decided and **parked on purpose** — the client wants the rest of the HR points gathered before any
of them is built, so they can be sequenced together. Nothing is blocking it.*

**The ask.** Management should not have to open each position in turn to see who is in its pipeline.
Give them **one screen** carrying every pipeline, and let them open **the candidate's detail — the
one already built — from that same screen.**

**The friction is real and it is measurable** (live database, 02-Sep-2026):

| Measured | Found |
|---|---|
| Live positions (`status = 'sourcing'`) | **19** — so "look at the pipeline" is 19 page-opens today |
| Candidates on them | **119**, of which **96 are still in play** |
| Sitting at Interview R3 — Director, i.e. management's own round | **12**, spread across several positions with no one screen that lists them |
| Sitting at R2 — HOD | **20** |
| Positions carrying 10+ candidates | **6** (ASM 18, Design Engineer 17, Finance Manager 16, Marketing Executive 11, Service Engineer 10, Spare Parts 10) |
| Offers out | **1** |

#### What already exists — and precisely where it stops

Three screens each answer part of this, and none answers it whole:

- **[Positions](frontend/src/apps/hr-recruitment/pages/positions/PositionsList.tsx)** — 19 rows,
  with a candidate count and a seats-filled meter per row. It says *how many*; it never says
  **where they are**. Reading a stage breakdown means opening the position.
- **[PositionPipeline](frontend/src/apps/hr-recruitment/pages/positions/PositionPipeline.tsx)** —
  the ten-column board, **one vacancy at a time**, deliberately: `PipelineSummary`'s own header
  records that a summary spanning every vacancy was built once and cut, because *"17 people are
  interviewing" across unrelated jobs answers nothing anyone asks*. That reasoning holds for a
  **summed strip** and does not hold for a **matrix** — the shape proposed below keeps every row
  attached to its own position, so nothing is summed across jobs that have nothing to do with
  each other.
- **[CandidatesList](frontend/src/apps/hr-recruitment/pages/candidates/CandidatesList.tsx)** — the
  closest thing that exists: every candidate across every vacancy, sortable and filterable on
  Position, Stage, AI fit, Source, Due. **It is already one screen.** What it is not is a
  *pipeline* — a flat table cannot be read as "this position is top-heavy and that one is at
  offer" — and clicking a candidate **navigates away** to a full page.

So the gap is two specific things, not a whole new app: **(a)** no position × stage view anywhere,
and **(b)** the candidate detail costs a page transition.

#### What to build

**One route — `/hr-recruitment/pipeline`, "Pipeline" in the sidebar — master/detail, three bands:**

1. **The numbers, once.** Open positions · seats unfilled · in play · at offer · overdue. Reuse
   the shared `Kpi`; every figure comes from `lib/analytics.ts` and `store.queueEntries`, never a
   second calculation (the dashboard's own header states this rule).
2. **The matrix — the actual answer to the ask.** One row per position, one column per board
   stage (the ten in `BOARD_COLUMNS`), each cell a count. Nineteen rows by ten columns replaces
   nineteen page-opens, and top-heavy vs about-to-close reads straight down the columns. Cells
   carry the one-hue `PHASE_FILL` ramp already used by the board, the strip and the fit bar — so
   the encoding is learned once and no legend is needed. **Clicking a cell narrows the list
   below to that position + stage.**
3. **The list, then the detail.** Under the matrix, the candidate rows. Selecting one opens the
   **existing candidate detail in place** — right-hand pane on a wide screen, full-width below on
   a narrow one — with ‹ › walking **the rows currently on screen**.

**The detail panel is an extraction, not a rebuild.** Checked: all six panels
(`ResumeViewer`, `CandidateDocuments`, `CandidateTimeline`, `CandidateMeetings`, `CandidateFit`,
`CandidateDetailsCard`) take a `candidate` prop and use **no router hooks at all**. So the body of
`CandidatePage` lifts cleanly into `<CandidateDetail candidate={c} />`, and both the route and the
new panel render the same component.

#### The traps — every one of these is live today

- 🔴 **"Management" is not a predicate in this module, and the two people who would use this are
  admins — so a broken gate will look like it works.** Live: `mgmt_approval` is owned by **Aayush
  Rathi, Karan Toshniwal, Riya Kumari**; `interview_3` (Director) by **Aayush Rathi, Karan
  Toshniwal, Nakuleshwar Sharma**. Aayush and Karan are portal **admins**, so they see every screen
  by the admin bypass and *not* by any management rule. **Test as a non-admin or the gate is
  untested.**
- 🔴 **`canSeeBoard` refuses a management approver.**
  [lib/access.ts](frontend/src/apps/hr-recruitment/lib/access.ts) admits the sourcing, interview,
  decision and onboarding step owners, the coordinator, and anyone with their own requisitions —
  **`mgmt_approval`, `hr_head_approval` and `job_posting` are all absent.** The server disagrees:
  `fms_hr_is_recruitment_staff()` grants candidate read to the owner of **any step except `mrf`**,
  so a management approver passes RLS and is then refused by the frontend. It bites nobody today
  only because all three approvers happen to own another step. Add the arm in the same change, or
  the dashboard is invisible to precisely the person it is for.
- 🔴 **Nakuleshwar Sharma owns R3 and cannot open the module** — `role = hod`, **no
  `hr-recruitment` row in `app_access` at all**. He is booked on Director rounds and has no way in.
  One edit in the admin User form, no code. (Same shape as the four heads already listed under
  NR-1.)
- 🟡 **Offered CTC is NOT on this screen — decided 02-09-2026.** Leave it out for now. Worth
  knowing why it would not have worked anyway: `canViewSalary` is admin, or a named person, or an
  allowed department, and the `salary_viewers` config row **has never existed in the live table**
  (only `min_cvs_to_share`, `probation_sla`, `process_coordinators` do) — so every non-admin would
  have seen a dash. If it is ever wanted, it is a Setup entry rather than code. Keep the existing
  property that the column is *not built at all* without the right, so it cannot leak through the
  column picker or the Excel export.
- 🟡 **The ‹ › pager cannot be copied across.** `CandidatePage`'s siblings are *the same board
  column of the same requisition*, oldest CV first. On a cross-position screen that set is wrong —
  it would page to a candidate not on screen. The pager must walk the dashboard's own filtered rows.
- 🟡 **`useRailWhileMounted()`** folds the sidebar for `CandidatePage`'s three columns. A master/
  detail screen needs the same width; decide once whether the new route folds the rail, rather than
  inheriting it by accident from the extracted component.
- 🟡 **Extraction must MOVE, not copy.** If `CandidateDetail` is lifted out, `CandidatePage` renders
  it — it does not keep its own copy of the three-column grid. Two renderers of the same fields is
  how a field gets fixed in one place and stays broken in the other.
- 🟡 **Grid conventions apply to the list band** — sort and a searchable multi-select filter on
  every column, cascading options, flat (no `groupBy`), and an empty *result* keeps the table and
  its filters standing. `QueueTable` does all of this already; the matrix is not a grid and is
  exempt.
- 🟡 **`QueueTable` has no row expansion** (checked — no `renderDetail` / `expand` of any kind), so
  the master/detail split is a layout around the table, not a feature added to it.
- 🟡 **PII.** Names, phones, CVs and expected salary. This screen must widen *layout*, never the
  read gate — RLS stays the authority, and the rows it hands over scope themselves, exactly as the
  dashboard's header notes.

#### Phase-wise checklist

- [ ] **P0a · SQL first.** New `fms_hr_config` key (`pipeline_viewers`: `person_ids`), and
      `fms_hr_is_pipeline_viewer(uuid)` OR'd into `fms_hr_can_read_requisition()`. Additive only.
      **Applied before the frontend ships**, or the first person added meets an empty screen.
      Rehearse the rollback rather than reading it.
- [ ] **P0b · Setup section.** "Pipeline dashboard access" beside Salary Visibility and
      Coordinators, which it copies. Seed it with the Directors. Word it as a **PII grant** — the
      people on it can read every candidate's name, phone, CV and expected salary.
- [ ] **P0c · The frontend gate.** `canSeePipeline = isAdmin || isPipelineViewer || canSeeBoard(s)`,
      enforced on the route and used for the sidebar link so the two agree. While here, add the
      missing `mgmt_approval` / `hr_head_approval` / `job_posting` arm to `canSeeBoard` — RLS
      already allows those owners and the frontend refuses them.
- [ ] **P0d · One live grant, no code.** Give `hr-recruitment` to **Nakuleshwar Sharma** (owns R3,
      cannot open the app). No `salary_viewers` row — CTC is deliberately off this screen.
- [ ] **P1 · Extract `<CandidateDetail candidate={c} />`** from `CandidatePage`'s body; the route
      re-renders it, with its own header, back-target and pager kept in the page. `npm run build`
      green, and the existing candidate route walked once by hand — it is the module's busiest page.
- [ ] **P2 · The matrix.** One row per position × **five phase columns** (`PHASE_OF` / `PHASE_FILL`,
      already in lib/board.ts — no new vocabulary). Cell click narrows the list to that position +
      phase; the list's Stage filter drills the rest of the way. Closed positions off by default
      with a toggle, matching the Positions list's own treatment.
- [ ] **P3 · List, then detail** — **two modes on one route**: the matrix and KPIs hold their
      place while the list area swaps to the full-width detail, breadcrumb back to the same list.
      ‹ › walks **the dashboard's filtered rows**, and the selection is held in the URL so a link
      to "this candidate, in this view" survives a paste.
- [ ] **P4 · The actions.** Reuse the existing gated components — `MoveModal`,
      `InterviewResultModal`, `HodDecisionModal`, `ScheduleInterviewModal` — so nothing new is
      permitted and no second authority test is written. Buttons gated, rows not.
- [ ] **P5 · Sidebar + route** on the P0c predicate.
- [ ] **P6 · Walk it in the browser** as a **non-admin on the Setup list who owns no step** (the
      case that proves the SQL arm), then as a Director. Confirm every cell matches the position
      board it came from.

#### Settled — 02-09-2026, the same day it was raised

| Asked | Answered |
|---|---|
| Who counts as "management" | **Nobody, by name, in code.** Build the report, and make the permission a **list in Setup** — an admin adds whichever users should have it. Seed it with the Directors. |
| Matrix width | **Five phases** — Screening · Interviewing · Offer · Hired · Dropped. Fits one screen with no sideways scroll; a cell click still drills to the exact stage. |
| Read-only or actionable | **Actionable, gated exactly as everywhere else.** Record an R3 result, make an offer, disqualify — the buttons appear only where the rules already allow. Nothing new is permitted; it saves the trip. |
| Where the candidate detail opens | **Two modes on one route.** The matrix stays put; the list area below it swaps to the detail at full width, with a breadcrumb back to the exact list you had. A permanent side-by-side split was ruled out — the detail is already three columns and folds the sidebar to fit them. |

#### ⚠ A Setup list does NOT grant the read — this is the trap that will waste a day

Making the permission a config list is the right call and it follows two precedents already in this
module (`process_coordinators`, `salary_viewers` — both `fms_hr_config` rows edited from Setup). But
a frontend list decides **which screen renders**, not **which rows arrive**. Candidate read is gated
in SQL by `fms_hr_can_read_requisition()`, whose arms are: admin · `fms_hr_is_coordinator()` ·
`fms_hr_is_recruitment_staff()` (owns any step **except** `mrf`) · or being that requisition's own
requester / hiring manager / reporting-to.

**So a person added to a Setup-only list who owns no recruitment step sees the new screen, and it is
empty.** Not an error — nineteen positions, zero candidates, no explanation. The same shape as
PC-1's "view, not edit" trap, and it will read as a broken build rather than a missing grant.

The fix is one additive migration alongside the config row: `fms_hr_is_pipeline_viewer(uuid)`
reading that key, OR'd into `fms_hr_can_read_requisition()`. Two things follow from it and both
should be said out loud before it ships:

- **It widens candidate PII** — names, phones, CVs, expected salary — to whoever is on the list.
  That is the intent, but the list is then a PII grant and should be described as one in Setup, not
  as a display toggle.
- **Deploy ordering.** The migration goes in **before** the frontend, per the repo rule; otherwise
  the first person added gets the empty screen described above.

**Offered CTC is not on this screen** (decided 02-09-2026). It stays on its own separate gate
(`salary_viewers`) — being able to read the pipeline is not being able to read what we offered —
and that config row has never existed, so it would have shown a dash to every non-admin regardless.

#### The layout — decided: two modes on one route

The candidate detail is **already a three-column layout that folds the sidebar to buy width**:
`CandidatePage` calls `useRailWhileMounted()` and then lays out CV viewer · discussion/meetings/fit ·
facts card. There is no spare width to put a candidate list beside it. A rail narrow enough to fit
would squeeze out the facts column, which is the half management actually reads.

**Chosen: two modes on one route.** The matrix and the KPI strip stay where they are; the candidate
list swaps to the detail at full width, and a breadcrumb returns you to the exact list you had. It
reads as one screen because the pipeline is still above you while you read the person. The overlay
is the runner-up and the fallback if the page turns out too tall in practice. Both are genuinely
"one screen" in the sense that matters — **you never lose your place, your filters, or your
position in the list:**

- **Two modes on one route.** Matrix + list is the default. Picking a person swaps the list area for
  the detail **at full width**, with a breadcrumb back and ‹ › walking the rows you had filtered.
  One URL, no page transition, no cramming.
- **Full-width overlay.** The detail comes up over the dashboard, closes back to it untouched.
  Nearly the same experience; it covers the matrix while open, which costs nothing since you are
  reading a person at that moment.

Either way ‹ › walks **the dashboard's filtered rows**, never `CandidatePage`'s board-column
siblings — that set would page to somebody not on screen.

#### To settle

- [ ] Does this screen replace Positions for management, or sit beside it? Positions is also where a
      vacancy is held or closed.
- [ ] Should closed and cancelled positions appear in the matrix? Four are cancelled today.

### NR-3 · 🔴 Map one or more HODs to a position, and let them own it as if they had raised it  `[ ]`
*Raised 2026-09-02 · Audited the same day against the live database and the running code · Parked
with the rest of the HR list*

⚠ **Do not ship this without NR-4.** Today HR is the accidental hiring manager on 17 of 19 live
positions, which is the only reason they can still work those pipelines. This task hands all 17 to
real heads — and on the module's current rules that **takes the seven HOD steps away from HR on every
one of them.** NR-4 is what keeps HR able to work them. Sequence NR-4 first, or ship the two together.

**The ask.** When HR raises a position on a department's behalf, the department's HOD gets nothing —
they cannot see the vacancy, the CVs or the pipeline, because they did not raise the MRF. Let a
position **name one or more HODs**, at creation or by editing it later, and give those HODs
**exactly the authority they would have had if they had raised the MRF themselves.** *Raised by*
still shows who actually raised it.

#### The good news: this permission model already exists and already works

Nothing new has to be invented. `hiring_manager_ids` on the requisition is **already** the "acts as
the HOD" field, and it is already wired through every layer:

| Layer | Where | What it already does |
|---|---|---|
| Server authority | `fms_hr_is_natural_step_owner()` | The seven HOD steps — HOD shortlist, Interview R2, probation M1/M2/M3, the probation decision and the extension — resolve to `hiring_manager_ids`, not to the requester |
| Server read gate | `fms_hr_can_read_requisition()` | `p_uid = any(r.hiring_manager_ids)` grants the whole requisition: candidates, CVs, interviews, scores, onboardings, probations |
| Client mirror | [store.tsx:810](frontend/src/apps/hr-recruitment/store.tsx#L810) `canActOn` | Same rule, same seven steps |
| Board access | `ownsRequisition` → `myRequisitions` → `canSeeBoard` | Puts Positions and Candidates in their sidebar |
| Queues | [store.tsx:1012](frontend/src/apps/hr-recruitment/store.tsx#L1012) | HOD-step queue entries are owned by the hiring managers |
| Notifications | `fms_hr_notify_hod_pending()`, the transition fan-out | Already loops `hiring_manager_ids` |
| Handover | `reassignCandidates` | A mapped HOD can hand their step on, and pull it back |
| R2 interviewer picker | `lib/interviewers.ts` | Reads `hiring_manager_ids ∪ reporting_to_ids` — which is exactly **NR-1**'s complaint, fixed at its source |

So this task is **not a new permission model. It is making an existing one settable.**

#### Why it is not happening today — three causes, all measured (02-Sep-2026)

**1. 🔴 The picker cannot show the HODs. This is the real root cause.**
The field exists on the MRF form — *"Who will manage this hire?"*, [MrfForm.tsx:843-852](frontend/src/apps/hr-recruitment/components/MrfForm.tsx#L843-L852) — and its options come from `s.profiles`, the **RLS-scoped** directory. The `profiles_select` policy is `id = auth.uid() OR is_admin OR is_hod_of OR same_department`.

> **Saloni Rathod sees 5 of 64 people** — the whole of Human Resources and nobody else. Every HOD she would need to map **is not in the dropdown at all.**

She is not skipping the field. She cannot fill it.

**2. 🔴 So it silently defaults to the raiser, and it has, nearly every time.**
`fms_hr_submit_mrf` does accept `hiring_manager_ids`; when the array is empty it writes `array[v_uid]`.

| Measured across all 23 requisitions | Found |
|---|---|
| Live positions whose hiring manager **defaulted to the raiser** | **17 of 19** |
| Live positions where **Saloni Rathod is the sole hiring manager** | **14** — she personally owns HOD shortlist, Interview R2 and all four probation steps on every one |
| Live positions naming anyone else | **2** — MRF-0012 (Gorakh Pawar + Murlidhar panda) and MRF-0019, the `ZZ TEST` row |
| Requisitions with **no** *reporting to* at all | **15 of 23** |

That is 96 in-play candidates whose HOD shortlist and Round 2 sit with HR by accident.

**3. 🔴 And it can never be corrected — there is no edit path, for anyone.**
- `fms_hr_resubmit_mrf` **does not write `hiring_manager_ids` at all**, and only runs on a
  `sent_back` requisition, by the requester. Every live position is `sourcing`.
- **No other RPC writes the column.** Checked all 63 `fms_hr_*` functions: `fms_hr_submit_mrf`'s
  INSERT is the only write in the database.
- The table's only non-SELECT policy is `fms_hr_requisitions_write_admin` (`is_admin`), so a direct
  PostgREST patch is refused for everyone else — and no screen offers one anyway.

**The one edit button that exists** — *Edit & resubmit* on [MrfDetail.tsx:224](frontend/src/apps/hr-recruitment/pages/requisitions/MrfDetail.tsx#L224) — is `status === "sent_back"` and requester-only, and would not write the field even if it were reachable. **On all 19 live positions the hiring manager is frozen forever, including for an admin, short of hand-written SQL.**

#### What to build

**One new RPC, one picker fix, two places to call it from.**

1. **`fms_hr_set_hiring_managers(p_req uuid, p_ids uuid[], p_note text)`** — SECURITY DEFINER,
   additive. Authorised to admins, process coordinators, the requester, and the current hiring
   managers (so a head can hand their own vacancy to the right person). Refuses a cancelled
   requisition, refuses an **empty array** (see the traps), writes an `fms_hr_activity` row naming
   who changed it and from whom to whom, and pings the people added and removed.
2. **Fix the picker at its source** — `list_org_people()` instead of the RLS-scoped directory, the
   same one-line swap [orgPeople.ts](frontend/src/core/platform/orgPeople.ts) already exists for and
   that **NR-1** flagged for the R1/R3 interviewer lists. Do all of them together.
3. **On the MRF form** — keep the field where it is, but stop calling it optional-with-a-shrug.
   Re-label it as what it decides (*"Which HOD owns this vacancy?"*), and say plainly what the
   mapping grants. It is the difference between the right person getting the work and HR holding it.
4. **On the position, after the fact** — a *Hiring team* / *Change HOD* control on
   `PositionPipeline`'s header and on the `MrfDetail` page, both calling the one RPC. The user asked
   for it on the position; the requisition page is where the field is already displayed, so both
   should reach it and **neither may write the column directly.**

*Raised by* needs no work — [MrfDetail.tsx:397](frontend/src/apps/hr-recruitment/pages/requisitions/MrfDetail.tsx#L397), `MrfRecap.tsx:117` and the MRF list column already show the requester, and the requester never changes.

#### The traps

- 🔴 **An empty `hiring_manager_ids` orphans seven steps.** `fms_hr_is_natural_step_owner` returns
  `p_uid = any(v_managers)` with **no fall-through** to the global step-owner table — so clearing
  the array leaves HOD shortlist, Round 2 and all four probation steps owned by **nobody** except
  admins and coordinators, on a vacancy that is otherwise running normally. The RPC must refuse an
  empty array outright. (This no-fall-through is the same shape as the `fms_hr_can_act` defect
  cross-referenced from **PF-13**.)
- 🔴 **Removing a HOD revokes their candidate read.** The read gate is the same array, so dropping
  someone mid-review takes away the CVs and the pipeline they were looking at, with no warning.
  Show what is being taken away before the write, not after.
- 🔴 **Mapping is a PII grant.** Names, phones, CVs, expected salary. Whoever is named can read
  every candidate on that vacancy. That is the intent — say so on the control, the way **NR-2**'s
  Setup list must.
- 🔴 **A mapped HOD without the module grant gets nothing.** Live: **13 of 14 HODs** hold
  `hr-recruitment`, but only **1 of 11 sub-HODs** and **2 of 35 employees**. Nakuleshwar Sharma is
  the one HOD without it. The RPC should not refuse them — the mapping is still correct — but the
  picker should warn, and the grant is one edit in the admin User form.
- 🟡 **A per-step handover beats the mapping, and does so silently.** `fms_hr_can_act__ungated`
  checks `fms_hr_step_assignees` **first**, and a holder is exclusive — *"deliberately NOT an OR
  with the natural owner"*. So if a step has been handed to someone on that requisition, adding a
  hiring manager does **not** give them that step. Zero handovers exist today, so nothing is
  affected yet; decide the rule now rather than discovering it later.
- 🟡 **`reassign_pool` has no config row**, so `fms_hr_can_receive_reassignment` is always false and
  a step can only be handed to a natural step owner. Unrelated to this build, but it means the
  handover escape hatch is narrower than it looks.
- 🟡 **Two call sites, one write.** The MRF page and the position page must both go through the RPC.
  Two writers of one column is how they drift.
- 🟡 **The notification is a bell only.** `email_module_enabled('hr-recruitment')` is **false**
  (confirmed in `email_module_settings`), so "you have been made the HOD for this vacancy" enqueues
  and does not send. Fine, but do not promise HR an email.
- 🟡 **`hiring_manager_ids` is `uuid[]` with no FK.** A deleted user leaves a dangling id that
  renders blank. Existing condition, worth not making worse — validate ids in the RPC.

#### Part B · Setup → Department HODs — so HR never hands anyone a list  *(added 02-09-2026)*

**Decided 02-09-2026.** Do not ask HR which head owns which of the 19 positions. **Give them a
Setup screen and let them state it once per department**, then have every position inherit it.

**Setup → Department HODs.** One row per department, one or more people on each. It does two jobs:

1. **It is the default, and it fills BOTH people boxes** *(decided 02-09-2026)*. Raising a
   requisition for *Supply Chain* pre-fills **both** *Who will manage this hire?* (the authority
   field) **and** *Who will they report to?* with Supply Chain's heads. HR no longer has to know,
   remember, or find them in a dropdown — which is the whole failure this task exists to fix.
   Both stay editable before saving: the two are the same person in most cases, not all.
   ⚠ Filling the second box is not cosmetic — *reporting to* is empty on **15 of 23** requisitions
   today, and `lib/interviewers.ts` builds the **Round 2 interviewer list** from
   `hiring_manager_ids` ∪ `reporting_to_ids`. Leaving it blank is half of why that picker offers
   almost nobody (**NR-1**).
2. **It is the backfill.** Once the master is filled, the 19 live positions can be set from it in
   one pass instead of nineteen conversations.

The per-position override from Part A stays exactly as it is. The master answers *"who normally
owns this department's hiring"*; the position answers *"who owns THIS vacancy"*, and a vacancy that
is genuinely someone else's still says so.

#### ⚠ There is no department → HOD anywhere in this portal, and `user_hods` is not it

Worth being explicit, because it looks as though the data already exists and it does not:

- **`departments` has no `hod_id` column.** Confirmed. `lib/steps.ts` says as much in prose — *"'the
  HOD' is not a portal concept — there is no departments.hod_id"* — and that absence is the whole
  reason this module routes HOD steps through `hiring_manager_ids` in the first place.
- **`user_hods` is a REPORTING LINE, not a department head**, and it cannot be aggregated into one.
  Measured 02-09-2026:

  | Department | Staff | Distinct people named as their HOD |
  |---|---|---|
  | Accounting & Finance | 17 | **5** — Aayush Rathi, Dimple, Karan Toshniwal, Ritesh Tulsyan, Vivek Boid |
  | Supply Chain | 7 | **4** |
  | Sales | 13 | **3** |
  | After Sales service | 5 | 2 |
  | Ink Manufacturing | 4 | 2 |
  | **13 of 23 departments** | — | **0 — nobody named at all** |

  Deriving "the department's HOD" from that would pick one of five arbitrarily, or nothing. It has
  to be stated, which is what the Setup screen is for.

#### Where it lives — HR-local, not the shared master

⚠ **`fms_hr_requisitions.department_id` points at `public.departments`, the SHARED org master**
(confirmed FK), which several modules and the org-masters operation read. Adding `hod_id` to it is a
platform-wide change with a blast radius well beyond recruitment, and it forces one answer for every
module that might later want a different one.

**So: a new HR-scoped table, `fms_hr_department_hods` (`department_id`, `hod_ids uuid[]`)** —
additive, module-local, and it leaves the shared master alone. If another module ever needs the same
idea, promoting it later is a smaller change than un-picking a shared column.

The Setup section sits beside Step Owners, Coordinators and Salary Visibility, which it copies —
admin-only, same shape, same writes. Its people picker needs the **same `list_org_people()` swap as
Part A**, or Setup reproduces the exact bug it exists to fix.

#### Extra traps this part brings

- 🔴 **A default is not a lock.** Pre-fill the hiring managers from the master, then let the raiser
  change them on that requisition. If the master overwrote the field, a genuinely-someone-else's
  vacancy could never be recorded.
- 🔴 **Changing the master must NOT retro-write live positions.** A department changing head next
  March must not silently move HOD shortlist and Round 2 on eleven vacancies that are mid-pipeline.
  The master is the default for NEW requisitions; moving an existing one is Part A's explicit,
  audited, notifying write. Offer it as a prompt — *"3 open positions still name the old head —
  move them too?"* — never as a side effect.
- 🟡 **A department with no row falls back to today's behaviour** (defaults to the raiser). That is
  correct, and the Setup screen should show which departments are unset rather than looking complete.
  Thirteen are unset on the org side today.
- 🟡 **Seed it from the live requisitions where they disagree with nothing** — MRF-0012 names Gorakh
  Pawar + Murlidhar panda for Supply Chain, MRF-0013 HARIOMSHARAN DAVE for Sales. Worth offering as
  a starting point for HR to correct, not as truth.

#### What this changes in the checklist

- [ ] **P0 · The master.** `fms_hr_department_hods` + its RPC, and **Setup → Department HODs**.
      Admin-only, `list_org_people()` picker, shows unset departments plainly. SQL before frontend.
- [ ] **P3a · Default from the master** when a requisition's department is chosen — pre-filled and
      editable, never locked.
- [ ] **P6 · The backfill** now runs off the master rather than off a list from HR: fill Setup, then
      apply to the 19 open positions in one reviewed pass.

#### Then there is a backfill, and it is not small

The feature does not fix the 19 live positions; somebody has to sit down and set them. **17 need a
hiring manager, 14 of them currently sitting with Saloni**, across 96 in-play candidates. Until that
is done every HOD shortlist and every Round 2 is still HR's. Two ways to do it, and the choice
should be deliberate:

- **Through the new screen, one position at a time**, once the RPC is live — auditable, notifies
  each HOD, and is the same path used from then on.
- **A one-off SQL backfill**, if the mapping is already known — faster, but it writes no activity
  row and pings nobody unless the script does it explicitly.

⚠ Either way somebody has to say **which HOD owns which of the 19**. **Part B is how they say it:**
HR fills Setup → Department HODs once, and the backfill reads the master instead of a list mailed
over. Nothing here is answered by the data — `user_hods` names five different heads for Accounting &
Finance alone — but it is now answered by a screen rather than by a conversation.

#### Phase-wise checklist

- [ ] **P1 · The RPC.** `fms_hr_set_hiring_managers` — authorisation, empty-array refusal, id
      validation, activity row, add/remove pings. Applied **before** any frontend that calls it.
      Rollback rehearsed on live data, not read.
- [ ] **P2 · The picker.** Swap the people source to `list_org_people()` on the MRF form, and do
      the R1/R3 interviewer lists in the same pass (**NR-1**'s open item). Prove it as **Saloni** —
      she is the person the bug is about, and she currently sees 5 of 64.
- [ ] **P3 · The MRF form.** Re-label the field, state what the mapping grants, keep the
      default-to-raiser behaviour for a head raising their own vacancy.
- [ ] **P4 · Change it later.** The control on `PositionPipeline` and `MrfDetail`, both through the
      RPC. Show who gains and who loses access before writing.
- [ ] **P5 · Walk it in the browser.** Raise as HR naming a HOD from another department; sign in as
      that HOD and confirm they get the board, the CVs, the HOD-shortlist queue entry, Round 2 and
      the probation reviews — and that the requester still reads as HR.
- [ ] **P6 · The backfill**, once HR supplies the position→HOD list.

#### To settle

- [x] ~~Which HOD owns each of the 19 live positions?~~ **Answered 02-09-2026: not our question to
      ask.** HR states it once per department in Setup → Department HODs (Part B), and the backfill
      reads that master.
- [x] ~~Should mapping a HOD also set *reporting to*?~~ **Answered 02-09-2026: yes, fill BOTH.**
      The department's HOD pre-fills *who will manage this hire* AND *who will they report to*, both
      editable before saving. They are the same person in most cases, and *reporting to* is empty on
      **15 of 23** requisitions today — which is also why the Round 2 interviewer picker is thin,
      since it reads both arrays.
- [ ] **Who may change the mapping after the fact** — coordinator and admin only, or the requester
      and the current HODs too? Letting a head hand their own vacancy on is convenient and is also
      how a vacancy quietly leaves the right person's queue.
- [ ] **What happens to an existing per-step handover when the HOD changes** — cleared, or left
      standing? Zero exist today, so this is free to decide now.

### NR-4 · 🔴 HR cannot work seven pipeline steps on a position a HOD raised  `[ ]`
*Raised 2026-09-02 · Audited the same day against the live database and the running code · Parked
with the rest of the HR list*

**The ask.** HR should have **full pipeline control**. Today, when a HOD raises a position, HR
cannot action several of its stages. That should not happen.

#### The answer to "can Settings do this, or does it need code?" — checked properly

**Settings cannot do it the right way. One Settings lever does work, and it is the wrong instrument.**

There are exactly two levers, and here is what each actually does:

**1. Setup → Step Owners — CANNOT reach these steps. Double-locked.**

The seven HOD steps (HOD shortlist, Interview R2, probation M1/M2/M3, the probation decision, the
extension) are locked in **two independent places**, so neither a UI change nor a hand-written config
row would be enough on its own:

- **The screen refuses.** [StepOwnersSection.tsx](frontend/src/apps/hr-recruitment/pages/settings/StepOwnersSection.tsx)
  renders those rows greyed with the word **"Automatic"** and **no Edit button** — by design, and the
  file says so.
- **The database would ignore it anyway.** `fms_hr_is_natural_step_owner()` handles the seven HOD
  steps in an `if` block that **`return`s before ever reaching `fms_hr_is_step_owner()`**. So even a
  row inserted straight into `fms_hr_step_owners` for `hod_shortlist` would be **completely inert** —
  no error, no effect. (Confirmed: no such rows exist today, so nobody has hit this yet.)

**2. Setup → Process Coordinators — WORKS today, no code. And it over-grants badly.**

`fms_hr_can_act__ungated()` opens with `if is_admin(p_uid) or fms_hr_is_coordinator(p_uid) then
return true`. So adding HR to Setup → Coordinators gives them every step on every requisition
immediately. It also gives them things nobody asked for:

> 🔴 **It hands the same person BOTH approval gates.** `fms_hr_decide_mrf` authorises through
> `fms_hr_can_act`, and it contains **no self-approval check** — nothing compares `auth.uid()` to
> `requester_id`. **Saloni Rathod raised 16 of the 23 requisitions on record.** As a coordinator she
> could approve her own MRF at the HR Head stage *and* again at the Management stage. Two signatures
> collapse into one person. (Contrast OCPI, which explicitly refuses to let you approve your own
> deal.)

It is also not a small switch: `isProcessCoordinator` is `return true` as the **first arm** of ~15
predicates across this module — the same pattern **PC-1** documents and warns about.

**So: this needs a code change, and it is a small one.** Full pipeline control is the right outcome;
"make HR a coordinator" is the wrong way to buy it.

#### What is actually blocked, measured (02-Sep-2026)

Saloni Rathod is `employee`, not an admin, and **not** a process coordinator (Riya Kumari is the only
one). She owns `mrf`, `resume_upload`, `hr_shortlist`, `telephonic_screening`, `interview_1`,
`job_posting` and `onboarding` — so on a position she is not the hiring manager of, she is locked out
of exactly the seven HOD steps.

| Position | Raised by | Its HOD | Candidates stuck at HOD shortlist, which HR cannot action |
|---|---|---|---|
| MRF-2627-0012 · Spare Parts Executive | Gorakh Pawar | Gorakh Pawar, Murlidhar panda | **6** |
| MRF-2627-0017 · Electrical & Panel Technician | Rajneesh Kumar | Rajneesh Kumar | **4** |
| MRF-2627-0018 · Executive Assistant (E.A.) | Karan Toshniwal | Karan Toshniwal | **2** |
| MRF-2627-0019 · `ZZ TEST` — HR Executive | Saloni Rathod | Riya Kumari | **1** |
| | | | **13 candidates, right now** |

⚠ **This gets much bigger the moment NR-3 lands.** Today only 2 of 19 live positions name a real
HOD, because the picker cannot show one — so HR is accidentally the hiring manager on the other 17
and the problem is largely hidden. **NR-3 fixes that, and in doing so hands every one of those 17
positions to a real HOD — at which point HR loses the HOD steps on all of them.** These two tasks
must ship together, or NR-3 makes NR-4 dramatically worse.

#### The fix — one line of authority, then the plumbing around it

**Make the HOD-step rule additive: `hiring manager OR configured step owner`, instead of `hiring
manager` only.** Nobody loses a step; HR gains one.

1. **SQL.** In `fms_hr_is_natural_step_owner()`, replace the early `return` with
   `return (p_uid = any(v_managers)) or public.fms_hr_is_step_owner(p_step_key, p_uid);`
   That single change reaches **every** blocked action at once, because everything routes through it:
   `fms_hr_move_candidate` (every transition), `fms_hr_hod_decide`,
   `fms_hr_record_probation_review`, `fms_hr_decide_probation`, `fms_hr_decide_extension` and
   `fms_hr_reassign_step` all authorise via `fms_hr_can_act`.
2. **The client mirror**, in lockstep — [store.tsx:810](frontend/src/apps/hr-recruitment/store.tsx#L810)
   `canActOn` and `isNaturalStepOwner` just below it. `lib/steps.ts` already carries the standing
   warning for this pair: *"Change one list, change the other."*
3. **Unlock the seven rows in Setup → Step Owners** so HR can be named on them, and rewrite the
   "Automatic" copy to say what it now means: *the hiring manager always owns these, plus anyone
   named here.*

**There is already a precedent for exactly this override in the codebase**, which is a good sign the
shape is right: `fms_hr_move_candidate` carries a special branch letting HR disqualify a card sitting
at `hr_shortlisted` even though the pending step is the HOD's — *"HR must keep the ability to drop a
CV they themselves just shortlisted in error."* NR-4 generalises that instinct instead of bolting on
a ninth exception.

#### The authority/workload split — decided: OVERRIDE, not co-ownership

Being **allowed** to act and being **given the work** are different things, and the module models
them separately (authority = `fms_hr_can_act`; workload = `queueOwnerIds` and the notification
fan-out, which both read `isHodStep(step) ? r.hiringManagerIds : ownerIdsOf(step)`).

**Chosen 02-09-2026: OVERRIDE.** HR gets the button on every position; the queue entry, the bell and
the daily digest **stay with the HOD**. HR steps in when a head stalls, and accountability stays
where it belongs. HR finds the stuck cards through Positions and the **NR-2** pipeline dashboard,
both of which already show every card whether or not it is owed to you.

The rejected alternative, and why: **co-ownership** would also put the work in HR's queue and
notifications. Truer to the words "full control", but on today's data it drops **96 in-play
candidates' worth of other people's work** into HR's *"On you right now"* — burying the handful
of things that genuinely are theirs, and making the dashboard useless for the person it was built
for.

**What that means in code:** change `canActOn` / `isNaturalStepOwner` (authority) and **leave the
four workload sites exactly as they are** — `store.tsx` **1012** (`queueOwnerIds`), **855**
(`reassignCandidates`), **1489** and **1674** (notification fan-out), which all carry the same
`isHodStep ? hiringManagerIds : …` shape. Authority and workload deliberately diverge here, so say
so in a comment on both sides — the next reader will read it as a bug and "fix" it.

#### The traps

- 🔴 **This deliberately overrides a documented design decision.** `StepOwnersSection`'s own comment
  says naming people on HOD steps globally *"would send every department's candidates to one person,
  which is exactly the bug this design avoids."* That is a fair objection to **replacing** the
  hiring manager. It is not an objection to **adding** to them, which is why the rule must be `OR`
  and never a swap. Write the reasoning into the code, or someone reverts this in six months.
- 🔴 **Naming anyone on a HOD step makes them recruitment staff — i.e. every candidate's PII.**
  `fms_hr_is_recruitment_staff()` is "owns any step except `mrf`", and it is the read gate for
  candidates, CVs, interviews, scores, onboardings and probations. For Saloni this changes nothing
  (she already owns `hr_shortlist`). For anyone else added it is a full PII grant, and the Setup
  screen should say so.
- 🟡 **A per-step handover still beats both.** `fms_hr_can_act__ungated` checks
  `fms_hr_step_assignees` **first** and a holder is exclusive — *"deliberately NOT an OR with the
  natural owner"*. Zero handovers exist today; the rule is unchanged by this task, but do not be
  surprised by it later.
- 🟡 **Do not fix this by making HR a coordinator "just for now".** It is one dropdown in Setup and
  it silently grants both approval signatures. If it is ever done as a stopgap, write down that it
  was, because nothing on screen will show it.
- 🟡 **`final_decision` is a separate question.** Making the offer is owned by Riya Kumari alone
  today — that one IS configurable in Setup and needs no code, so if HR should also make offers it
  is a settings edit, not part of this task.

#### Phase-wise checklist

- [ ] **P1 · SQL.** The `OR` in `fms_hr_is_natural_step_owner`, applied **before** the frontend.
      Additive; the rollback is the old function body, and it must be rehearsed on live data.
- [ ] **P2 · The client mirror** — `canActOn` and `isNaturalStepOwner` **only**. Do NOT touch
      `queueOwnerIds`, `reassignCandidates` or the two fan-out sites: the override decision is that
      the work stays in the HOD's queue. Comment both sides so the divergence reads as deliberate.
- [ ] **P3 · Setup → Step Owners** — unlock the seven rows, rewrite the "Automatic" copy, and state
      the PII consequence on the screen.
- [ ] **P4 · Walk it in the browser as Saloni** on **MRF-2627-0012** (Gorakh Pawar's, 6 CVs waiting
      at HOD shortlist): shortlist one, book Round 2, record a probation review. Then confirm Gorakh
      Pawar has lost nothing.
- [ ] **P5 · Ship with NR-3**, or sequence NR-4 first. NR-3 alone makes this worse on 17 positions.

#### To settle

- [x] ~~Override or co-owner?~~ **Answered 02-09-2026: override.** HR can act on any position; the
      work stays in the HOD's queue and the HOD keeps the reminders.
- [ ] **Should HR also own *Make the Offer* (`final_decision`)?** Riya Kumari alone owns it today.
      Pure settings, no code, but worth deciding in the same conversation.
- [ ] **Does "full pipeline control" stop at the pipeline, or include the two approval gates?**
      It should stop — HR raises most requisitions, and there is no self-approval check anywhere in
      `fms_hr_decide_mrf`.

### NR-5 · 🔴 Nothing HR uploads can ever be edited, replaced or deleted  `[ ]`
*Raised 2026-09-03 · Audited the same day against the live database, the live storage bucket and the
running code · Parked with the rest of the HR list*

**The ask.** Videos and every other resource HR uploads are write-once. Give them **edit, delete and
re-upload**.

#### It is worse than "no delete button" — the RPCs structurally cannot clear a value

Every attachment in this module is written with `coalesce(new, old)`. **That expression can replace a
value and can never null one**, so a "remove" is not merely missing from the UI: passing an empty
value to any of these today is a **silent no-op**. Verified in the live function bodies:

| Resource | Written by | Clause | Replace | Remove |
|---|---|---|---|---|
| Resume / CV | `fms_hr_update_candidate` | `resume_path = coalesce(nullif(p->>'resume_path',''), resume_path)` | yes | **impossible** |
| Interview **video link** | `fms_hr_record_interview_result` | `video_url = coalesce(nullif(trim(p_video_url),''), video_url)` | yes | **impossible** |
| Interview feedback form | `fms_hr_record_interview_result` | `document_path = coalesce(p_doc_path, document_path)` | yes | **impossible** |
| Onboarding document / link | `fms_hr_toggle_onboarding_check` | `v_file := coalesce(nullif(p_file_path,''), v_file)` | yes | **impossible** |
| Probation review form | `fms_hr_record_probation_review` | `file_path = coalesce(excluded.file_path, …)` | yes | **impossible** |
| Job description | `fms_hr_set_requisition_jd` | `jd_path = nullif(trim(p_path),'')` | yes | **yes — the only one** |

**And no file is ever removed from storage.** There is not one `storage.remove()` call in
hr-recruitment. The whole portal has exactly one, in receivables-hub
([customerWrites.ts:382](frontend/src/apps/receivables-hub/data/customerOnboarding/customerWrites.ts#L382))
— a working pattern to copy rather than invent.

#### 🔴 The one path that CAN replace a CV is not called by any screen

`updateCandidate` is imported into the store ([store.tsx:35](frontend/src/apps/hr-recruitment/store.tsx#L35)),
typed on the interface (`:445`), implemented (`:1334`) and wired to a live RPC — and **grepping every
`.tsx` in the codebase finds zero callers.** It is a complete, working, unreachable feature: exactly
the orphan shape **FIX-4** in [CLAUDE.md](CLAUDE.md) warns about, and invisible because
`noUnusedLocals` is `false`, so it never fails the build.

So today a wrong CV cannot be replaced — not because the capability is missing, but because nothing
renders a button for it.

#### 🔴 An interview attachment cannot be fixed once the candidate moves on

`fms_hr_record_interview_result` opens with `if v_stage <> v_want then raise exception 'This
candidate is not at % (they are at %)'`. The moment a "selected" result advances someone to the next
round, **their previous round is sealed** — a wrong video link or a missing feedback form on Round 1
can never be corrected while they sit at Round 3.

⚠ **And the only workaround is destructive.** Dragging the card back clears the stage timestamps and
runs `delete from fms_hr_interviews where round > …`, so recovering a Round-1 link would **destroy
the Round-2 and Round-3 records**. `InterviewResultModal` also opens with `videoUrl` as `""` — it
never pre-fills the existing value, so even a permitted re-record silently blanks nothing and
re-types everything.

#### Where the module stands, measured (03-Sep-2026)

| | |
|---|---|
| Files in `fms-hr-docs` | **133** — 119 resumes (28 MB) + 14 JDs (933 kB) |
| Orphaned files (in the bucket, referenced by nothing) | **0** |
| Interview **video links** live | **18** — none correctable, none removable |
| Interview feedback forms | 0 uploaded so far |

⚠ **Zero orphans is not good hygiene — it is proof the replace paths have never once been used.**
The storage leak begins the day "replace" ships without "remove".

✅ **One thing is already in place: the storage DELETE policy exists.** `"fms hr docs delete"` on
`storage.objects` admits `fms_hr_is_coordinator(auth.uid()) OR fms_hr_is_any_step_owner(auth.uid())`.
**No storage migration is needed** — the bucket has been ready the whole time and nothing calls it.

#### What to build

1. **Teach the five RPCs to clear.** `coalesce` cannot express "set to null", so each needs an
   explicit signal — a `p_clear boolean`, or a reserved sentinel — rather than relying on an empty
   string, which today means "leave it alone". **This is the crux of the task**; everything else is
   UI.
2. **One attachment service, not six.** A single client-side helper that: writes the new row →
   removes the superseded object from storage → records an activity line. Every screen calls it;
   nothing calls `supabase.storage.remove` directly.
3. **Put the controls where the files already are.** [CandidateDocuments.tsx](frontend/src/apps/hr-recruitment/components/kanban/CandidateDocuments.tsx)
   already gathers every file and recording for one person into one list, grouped Application /
   Interviews / Onboarding / Probation. It is read-only today — every row is an "open" button. Give
   each row **Replace** and **Remove**, gated per row, and this task is largely done in one place.
   The JD gets the same treatment on the requisition page.
4. **Decouple "fix the attachment" from "re-record the result".** A small
   `fms_hr_set_interview_media(p_candidate, p_round, …)` that changes only the video link and the
   feedback form, with no stage test — so Round 1 stays fixable at Round 3 without dragging a card
   backwards and destroying two rounds.
5. **Resolve the orphan**: wire `updateCandidate` to a real Edit-candidate control, or delete it.
   Leaving a reachable-looking write with no trigger is what FIX-4 is about.

#### The traps

- 🔴 **`coalesce` cannot clear — and it fails SILENTLY.** If Remove is built by passing `""` or
  `null` to the existing RPCs, every button will appear to work and change nothing. Anyone testing
  by clicking will report success. Test by re-reading the row.
- 🔴 **Delete order matters.** Clear the database reference **first**, then remove the storage object
  best-effort. The reverse leaves a dangling path — a visible, broken link the UI will keep
  rendering — whereas a leftover object is invisible and harmless, and the operation stays safe to
  retry.
- 🔴 **Removing evidence from a completed onboarding must be refused, not reversed.** A ticked item
  with `requires_file` may already have driven `fms_hr_try_complete_onboarding` — which fills a seat,
  can close the vacancy and opens a probation. Silently untying that from a Remove button is far
  worse than saying no. Same for a probation review once `outcome` is set: those already refuse
  re-recording, and removing the form underneath a decision rewrites the basis of a decision.
- 🔴 **A delete on personal data needs a trail.** These are CVs, phone numbers, interview
  recordings. Deletion is arguably right (erasure requests) and it is also unrecoverable — the
  bucket has no versioning. Every remove writes an `fms_hr_activity` row: who, what, when.
- 🟡 **The storage policy is broader than the workflow.** `"fms hr docs delete"` admits **any step
  owner** — so a telephonic screener passes the bucket check for a probation review form. Storage
  policies cannot see the requisition, so the RPC must be the real gate: authorise a remove with the
  same `fms_hr_can_act` rule as the step that produced the file, plus HR and coordinators. Do not
  let the storage policy be the only test.
- 🟡 **One delete path, not five.** The same file is rendered on `CandidateDocuments`, `PriorRounds`,
  `CandidateMeetings` and `ResumeViewer`. If Remove is added to more than one of them, every one
  must route through the single service — or the next fix lands in one place and not the others.
- 🟡 **Ship with NR-4, or HR still cannot use it on a HOD's position.** `fms_hr_set_requisition_jd`
  is **admin-or-requester only** — not HR, not a coordinator, not even the hiring manager — so HR
  cannot replace the JD on a position a head raised. The probation and interview attachments sit
  behind `fms_hr_can_act` on HOD steps, which is exactly what **NR-4** unlocks.

#### Phase-wise checklist

- [ ] **P1 · SQL.** Add explicit clear semantics to the five RPCs, plus `fms_hr_set_interview_media`.
      Additive; no storage migration needed. Applied before the frontend, rollback rehearsed.
      ⚠ Verify each clear by re-reading the row — a `coalesce` left in place fails silently.
- [ ] **P2 · The attachment service** — one helper: write, then remove the superseded object, then
      record the activity line. Copy receivables-hub's `storage.remove` pattern.
- [ ] **P3 · The Documents tab** gains per-row **Replace** and **Remove**, gated per row, with a
      confirm that names the file. The JD gets the same on the requisition page.
- [ ] **P4 · Resolve the `updateCandidate` orphan** — give it a control or remove it.
- [ ] **P5 · Guards** — refuse removal on a completed onboarding and on a decided probation; require
      admin/coordinator for anything already decided.
- [ ] **P6 · Walk it in the browser.** Replace a CV and confirm the **old object is gone from the
      bucket**, not merely unreferenced. Fix a Round-1 video link while the candidate sits at Round 3.
      Re-run the orphan count — it should still be 0.

#### Settled — 03-09-2026, the same day it was raised

| Asked | Answered |
|---|---|
| Does "videos" mean uploaded video FILES, or the links we store today? | **The LINKS.** All 18 live videos are URLs typed into a box on the interview result form. Editing and clearing `video_url` is in scope. **Video-file upload is explicitly OUT** — nothing in the module accepts video, and nothing needs to. If it is ever wanted it needs its own entry: size limits, a MIME allow-list, a player, and storage cost (one 30-minute recording can outweigh all 119 resumes put together). |
| Should a CV be deletable, or only replaceable? | **Both.** Replace is the everyday action; Delete exists for an erasure request. |

⚠ **Deleting a CV orphans its AI fit score, and the screen must say so.** `CandidateFit` disables its
Run button on `!c.resumePath`, so once the CV is gone the score cannot be recomputed. Keep the score
— it is a real historical reading — but state plainly that the document behind it has been removed.
The confirm dialog should say it before the delete, not after.

#### To settle

- [ ] **Who may remove** — the step's own owner, or HR and coordinators only? The storage policy is
      already broader than either.

### NR-1 · Round 2 offers every head set up to raise an MRF, and can be handed over  `[x]`
*Raised 2026-08-25 · **Live 2026-08-26, 08:17 IST** on `master` at `adea51c` · SQL applied to
`icutjkrqkbzwvmnfbzpr` (`20261020130000`, `20261020130100`) BEFORE the frontend, and the rollback
rehearsed rather than read · **Not walked through in the running app** — the Playwright browser
profile was locked by an open Chrome session, so the picker, the handover and the outgoing-head ping
were proven against the database and by `npm run build`, but never clicked. Worth one pass by hand ·
Plan of record: `C:\Users\Admin\.claude\plans\now-in-this-the-groovy-cherny.md`*

Booking **Interview R2 — HOD** offers one name, and it is usually not a head of department. On
MRF-2627-0009 (Krishan Pal, Design Engineer) the only option was *Saloni Rathod · Executive* — the
person who raised the requisition.

**Root cause:** R1 resolves against the HR department and R3 against anyone designated Director, but
R2 alone reads the *requisition* — `hiring_manager_ids ∪ reporting_to_ids`
([interviewers.ts:42-45](frontend/src/apps/hr-recruitment/lib/interviewers.ts#L42-L45)) — and
`fms_hr_submit_mrf` defaults that to whoever raised the MRF. The stage has always been *labelled*
"HOD" while the picker delivered the raiser.

**Measured on live data:**

| Checked | Found |
|---|---|
| Requisitions naming any HOD / sub-HOD | **4 of 16** — so 12 of 16 R2 pickers offer no head at all |
| People assigned "Raise the MRF" in Setup → Step owners | **20** — the President, two Directors, the CFO, the HR Head, the Plant Head, the GMs and DGMs |
| Of those 20, holding no `hr-recruitment` module grant | **4** — Dimple, Khushi Soni, Nakuleshwar Sharma, Sourabh Rakesh Nagpal |

**What was decided:** the R2 list becomes the 20 people set up to raise an MRF, plus this
requisition's own hiring managers and reporting-to. A booked round gains a **Change interviewer**
button. The assigned head and the hiring manager **both** own the round, and the head is told by
bell, by the daily work email and by an immediate mail.

**⚠ It is not just a dropdown.** "The HOD" is hard-wired to `hiring_manager_ids` in five more
places — the RLS read gate `fms_hr_can_read_requisition`, the act gate `fms_hr_can_act`, its client
mirror in `store.tsx`, My Work and the daily digest in `items/hr.ts`, and the bell fan-out. Widening
only the picker books a head who cannot see the candidate, cannot record the result, and is never
told. Two further defects were found while auditing this: the queue calling an unbooked round
"Booked" (**FIX-3**, already affecting live rows) and panel names vanishing for anyone outside the
reader's own department.

**Email ships OFF.** `email_module_enabled('hr-recruitment')` is `false`; the rows enqueue and
nothing sends. Turning it on also releases the master-request mail already built behind the same
switch.

**Worth settling before it goes live:**
- [ ] **Redeploy `send-email` before the email switch is ever turned on.** The renderer change is
      committed but NOT deployed: `supabase/functions/send-email/index.ts` now knows that a
      `hr-recruitment_interview_*` kind is a panel notice, not master-data governance. Left
      undeployed deliberately — the running copy serves five modules that DO have email on, and
      hand-uploading 1,261 lines to fix a footer that cannot render while the HR switch is off is
      the wrong risk. Deploy it in the same change that flips the switch:
      `supabase functions deploy send-email --project-ref icutjkrqkbzwvmnfbzpr`.
- [ ] Grant `hr-recruitment` to the four heads above, or accept that booking them notifies someone
      who cannot open the app. Four edits in the admin User form, no code.
- [ ] Whether the R1 and R3 lists should be repaired at the same time — both silently drop a
      cross-department interviewer today, and it is the same one-line source swap.
- [ ] Whether HR wants the *named* hiring manager corrected on live requisitions. It is effectively
      immutable after submit — only `fms_hr_resubmit_mrf` writes it, requester-only, sent-back only.

---

## Asset Maintenance  *(service & maintenance)*

### AM-1 · Walk the module with Bushra and list the changes  `[x]`
*Raised 2026-08-20 · **CLOSED 04-09-2026 — the module has been checked and nothing further came out
of it.** The walkthrough proper now happens against the real register rather than seeded rows, once
Ritesh Bhai's sheet is in and punched — carried into **AM-4**.*

The service and maintenance module is already built and live. Go through it **together with
Bushra**, note down every change it needs, and then make them.

**Notes:** this is a review task, not a build task — the outcome is a list, and that list gets
filed back under this heading as AM-2, AM-3 and so on. The module is
[asset-maintenance](frontend/src/apps/asset-maintenance/) and is the odd one out among the FMS:
its entity is **permanent**. Assets and their dated tracks live for years, a service *job* is
raised off a track when it falls due, and closing the job rolls the track forward. Nightly
`pg_cron` opens the jobs and pushes the reminders. Worth having that model in mind during the
walkthrough, because a change that reads as small on another FMS can cut across it here.

Screens to cover so nothing is skipped: Dashboard, Calendar, Assets, Jobs, Queues, Monitoring,
Reports, Masters, Master Requests, Settings, System.

**Also worth raising in the same session** (both already on this list, both touch this module):
- **PE-1** — calibration. Asset Maintenance already treats calibration as a service type on an
  asset. Does the factory's daily QC calibration belong here, or standalone in Production?
- **PC-1** — the coordinator's single approval queue. This module has its own Master Requests and
  its own per-FMS `process_coordinators` list.

### AM-2 · Load the real asset register from the field  `[x]`
*Raised 2026-08-29 · **CLOSED 04-09-2026 — everything on our side is built, verified and sent.**
What is left is not work, it is the filled sheet. That wait is tracked on its own as **AM-4**.*

The register holds 10 rows, 9 of them seeded `[TEST DATA]`. Until the real assets are in, the
module reminds nobody about anything. Ritesh Bhai asked for a sheet to fill in, so the collection
template is the deliverable and the bulk importer is how it comes back.

**Done:**
- `Asset Data Collection Template.xlsx` at the repo root (untracked). Four tabs — Data Entry
  (blank, dropdowns, frozen header), Read Me, Sample (filled), Picklists. Regenerate with
  `npm run asset-template`; the generator is
  [build-asset-template.mjs](frontend/scripts/build-asset-template.mjs) and it **asserts its
  columns against `IMPORT_COLUMNS`**, so it cannot drift from the importer.
- The importer gained a **`Reading as on`** column (a meter reading with no date is a guess) and
  now **skips wholly blank rows** — without that the 2000-row validated grid opens the preview
  with a screen of red. [importAssets.ts](frontend/src/apps/asset-maintenance/lib/importAssets.ts).
- The in-app **Download template** button now emits the same four tabs off the live masters
  ([importTemplate.ts](frontend/src/apps/asset-maintenance/lib/importTemplate.ts)). It had been
  shipping a worked example whose Location was `"Head Office"` — not a master, so anyone who
  followed the example got a row the importer rejected.
- Verified: `npm run build` clean; the real `buildImportPlan` against the real file with live
  masters gives **3 assets, 7 tracks, 0 rejected**, unchanged with 200 blank rows appended.
  Nothing was committed to the register.

**Round one is vehicles, IT equipment and air conditioners only** — Vehicle, Computer & IT, Air
Conditioner. Sheet sent to Ritesh Bhai on 2026-08-29.

### AM-3 · Round two: the remaining four asset categories  `[x]`
*Raised 2026-08-29 · **CLOSED 04-09-2026 — folded into AM-4.** Nothing here ever needed building:
the workbook, the 27 columns and the importer already cover all seven categories, so round two is a
covering note rather than a task. The two half-hour edits it recommended are carried into **AM-4**
so they are not lost.*

Machinery, Electrical, Furniture and Safety Equipment. Deliberately held back so the first ask
stays small: a short sheet gets filled and returned, and we find out whether the format survives
contact with a field team before anyone is asked to list everything the company owns.

**Nothing new to build.** Same workbook, same 27 columns, same importer. The Picklists tab already
carries all seven categories, so a machine filled in today would load perfectly well — the only
thing scoping round one to three categories is the covering note and which examples the Sample tab
happens to show.

**The one change worth making first:** swap two Sample rows to a machine instead of the laptop.
Machinery meters in **Hours** rather than KM and carries **Calibration** and **Statutory
Inspection** tracks, none of which round one's examples demonstrate. That is an edit to `SAMPLE` in
[build-asset-template.mjs](frontend/scripts/build-asset-template.mjs) and to `sampleRows()` in
[importTemplate.ts](frontend/src/apps/asset-maintenance/lib/importTemplate.ts), then
`npm run asset-template`. Half an hour, not a rebuild.

**Do this before sending round two, not after:** re-run the masters query in the generator's header
comment and refresh the `PICKLISTS` snapshot. Round one will have added makes, locations and
vendors through the "Values we do not have yet" box, and a stale snapshot would send the teams a
dropdown that is missing values we have only just created.

**Two traps the Read Me warns about, because neither gives a usable error:**
- A serial number identifies one physical unit. Give two different assets the same one and the
  second is absorbed as a track on the first, its details discarded silently.
- `Warranty months` + a purchase date auto-creates the Warranty Expiry track
  (`fms_asset_submit_asset`). Adding a Warranty Expiry row as well breaks the
  `unique (asset_id, schedule_type_id)` key, and the importer swallows that in a bare `catch`.

**When the sheets come back:** add any new makes / locations / vendors as masters *first*, then
upload — the importer resolves masters by name and rejects anything it does not already hold.
Note the preview undercounts tracks: the auto-created Warranty Expiry ones never appear in it.

**Before the first real load, two decisions that are not mine to take:**
- The 9 `[TEST DATA]` assets and their 20 tracks. Removal is destructive and constrained by
  `on delete restrict` from schedules and jobs.
- **PF-14** — `fms_asset_step_owners` still holds 0 rows, so a loaded register would have nobody
  able to action its jobs except an admin.

---

### AM-4 · Waiting on Ritesh Bhai for the asset details  `[!]`
*Raised 2026-09-04 · **The module's only open item.** Everything buildable is built; AM-1, AM-2 and
AM-3 all close into this one. Blocked on **Ritesh Bhai** since 2026-08-29.*

**Where it stands.** The module is built and has been checked. The collection template is built,
verified and was sent to Ritesh Bhai on **2026-08-29**. **Nothing further gets built until the
filled sheet comes back** — the register holds 10 rows of which **9 are seeded `[TEST DATA]`**
(only `ASSET-0001`, a laptop, is real), so until then the module reminds nobody about anything.

**What happens when it arrives, in this order:**
1. Add any new **makes, locations and vendors** as masters **first**. The importer resolves masters
   by name and rejects a row naming one it does not already hold.
2. **Punch the assets in** through the bulk importer.
3. **Then walk the module**, against real rows rather than seeded ones. Screens to cover so nothing
   is skipped: Dashboard, Calendar, Assets, Jobs, Queues, Monitoring, Reports, Masters, Master
   Requests, Settings, System.

**Two decisions to take before the first real load** — neither is mine:
- 🔴 **The 9 `[TEST DATA]` assets and their 20 tracks.** Removal is destructive and constrained by
  `on delete restrict` from schedules and jobs, so it needs a decision rather than a delete.
- 🔴 **PF-14** — `fms_asset_step_owners` still holds **0 rows**, so a loaded register would remind
  people about work **nobody but an admin can action**. Only **2 accounts** have
  `asset-maintenance` access today.

**Carried over from AM-3, for whenever round two is sent** (Machinery, Electrical, Furniture,
Safety Equipment — same workbook, same 27 columns, same importer, no new build):
- Swap two Sample rows to a **machine** rather than the laptop. Machinery meters in **Hours** not
  KM and carries **Calibration** and **Statutory Inspection** tracks, none of which round one's
  examples demonstrate. Edit `SAMPLE` in
  [build-asset-template.mjs](frontend/scripts/build-asset-template.mjs) and `sampleRows()` in
  [importTemplate.ts](frontend/src/apps/asset-maintenance/lib/importTemplate.ts), then
  `npm run asset-template`. Half an hour.
- **Refresh the `PICKLISTS` snapshot before sending.** Round one will have added makes, locations
  and vendors through the "Values we do not have yet" box, and a stale snapshot would hand the
  field team a dropdown missing values we had only just created.

**The two traps that give no usable error**, worth re-reading on the day of the load:
- **A serial number identifies one physical unit.** Give two different assets the same one and the
  second is absorbed as a *track* on the first, its details discarded silently.
- **`Warranty months` + a purchase date auto-creates the Warranty Expiry track**
  (`fms_asset_submit_asset`). Adding a Warranty Expiry row as well breaks the
  `unique (asset_id, schedule_type_id)` key, and the importer swallows that in a bare `catch`. The
  preview also **undercounts tracks**, because those auto-created ones never appear in it.

---

## Admin / Masters

*(cross-ref: **PC-1** above — master approvals need to reach a non-admin coordinator)*

---

### MS-2 · Credit terms in the masters are half-filled, and the ₹1 flag is stale  `[x]`
*Raised 2026-08-29 · **CLOSED 04-09-2026 — handed to Accounts, closed on our side.** The report that
shows them where to look is **RC-8**, live since 29-08. Filling the values in Tally is Accounts'
work, not a build, and it is not tracked here any more.*

⚠ **Closed as HANDED OVER, not as clean.** Re-measured on `mst_parties` the day it was closed, so
nobody later reads this as "the data was checked and is fine":

| Measured 04-09-2026 (7,913 rows, last sync 06:00 UTC) | |
|---|---|
| Carry a real credit limit | **755** |
| Carry the ₹1 *blocked* flag | **182** — 175 stored as **−1**, 7 as **+1** |
| Nothing at all | **6,976** |
| Credit days set | **918** · blank **6,995** |

🔴 **Tally stores a debtor's credit limit as a NEGATIVE (Cr) amount, and it catches every reader.**
A `credit_limit > 0` test finds 116 rows and calls 814 real limits blank; a `= 1` test finds 7 of the
182 flags. This trap was already written down in **RC-8**'s trap 2 and was walked into again on the
day of closure. **Test on `abs(credit_limit)`, always.**

🟡 **Two more things found on the way out, neither of which blocks anything:**
- **Credit period is free text, and it is spelled 31 different ways.** `30 Days` (252) but also bare
  `30` (20); `60 Days` (239) and `60` (43); `45 Days` (173) and `45` (7). **87 rows are bare
  numbers**, 2 are neither shape, and 17 read `1 Days`. Anything that groups or compares these
  treats `60` and `60 Days` as two different terms.
- **Nothing in the portal enforces a credit limit.** `mst_parties.credit_limit` and `credit_period`
  are read by exactly one screen — Admin → Masters → Parties
  ([liveMasters.ts:384](frontend/src/core/platform/liveMasters.ts#L384)) — where credit period is
  `readOnly: true` ([Masters.tsx:727](frontend/src/core/admin/Masters.tsx#L727)) and **credit limit
  is not shown at all**. No FMS checks either. The receivables Credit Terms report reads
  **ConnectWave's own copy**, a separate sync of the same Tally data, so the two mirrors can drift
  apart and no screen would show it.

**If it is ever picked up again**, these were the questions for Accounts:
- **Is blank always wrong?** A book that never sells to a party needs no limit. VAIBHAV ENTERPRISES
  argues for weighting by activity: the book holding ₹16 lakh overdue matters, the one holding −₹92
  does not.
- **Do different limits in different books mean deliberate per-company exposure, or drift?**
- **The 182 rows flagged ₹1** — only 12 overlap the Red Mark master. Clean them so ₹1 means
  something again, or leave them and teach every reader to ignore ₹1?
- **May the portal ever hold a credit term of its own**, or is Tally always the only source?

---

## FMS Control Center

*(cross-ref: **PC-1** above — decide whether this stays alongside the new dashboard)*

### CC-1 · Ranking on the master control center  🟢  `[ ]`
*Raised 2026-08-20 · **Low priority, confirmed 04-09-2026.** Nothing depends on it and it is a real
build — a person dimension threaded through all nine adapters, not a widget. Park it.*

Add a gamification layer to the master control center: **a user sees their ranking** and
understands where they stand against everyone else using the Orange One hub.

**Notes:** the board has **no person dimension at all** today, and that is the size of this job.
[MasterControlCenter.tsx](frontend/src/apps/fms-control-center/pages/MasterControlCenter.tsx) is
process-shaped — one row per FMS — and every adapter returns an `FmsSnapshot` of totals plus
step/stage breakdowns, counts only, nobody's name in it
([adapters/types.ts](frontend/src/apps/fms-control-center/adapters/types.ts)). So a ranking means
threading a per-person dimension through all nine adapters, not adding a widget to existing data.

The raw material does exist per FMS: steps stamp who completed them and when (Order to Dispatch
carries `actorId` per step, Production stamps `mhAt` / `qcAt` / `pkAt` and the rest), and every FMS
carries a step-SLA model, so **on-time vs late per person** is derivable rather than invented.
Nothing ranks anyone today — no leaderboard, no score, anywhere in the codebase. The nearest
existing per-user read is the Master Report's `UserAccess` page, but that is access and last-seen,
not throughput.

**Worth settling before building:**
- [ ] What the rank actually measures — steps closed, steps closed **on time**, or something that
      cannot be won by picking easy work. Counting volume alone rewards whoever handles the
      fastest steps, not whoever keeps the process moving.
- [ ] Ranked across everyone, or within a department / module / role? Comparing a dispatch clerk
      with a QC checker on one ladder may not mean anything.
- [ ] Does everyone see the full table, or only their own position and the top few?
- [ ] Over what window — this week, this month, rolling?
- [ ] Does this belong on the existing board, or on **PC-1**'s new coordinator dashboard? Both
      screens are in play at once.

---


## Order to Dispatch

**Four open: OD-12, OD-1, OD-5 and OD-7.**
🔴 **OD-12 is the priority** (raised 04-09) — the LOT number should come **live from Tally** instead of
being typed by hand at Check Material Status. ⚠ It cannot start yet: **no Tally view we consume
carries a batch**, so ConnectWave has to expose batch-wise stock first — see [Waiting for](#waiting-for).
**OD-2 and OD-10 are CLOSED**, both verified live on master 04-09-2026. Customer and item can no
longer be requested from Dispatch at all, which shrinks **OD-5** to a cleanup of **11 historic rows**.
**OD-1** still wants a word with Bushra. **OD-7** (sale type *stored on* the order) is a decision to
take, not a blockage — its Step 0 is done (**MS-1**), and its intake-filter half shipped as **OD-10**.
(**OD-3 · OD-4 · OD-6 · OD-8 · OD-9 · OD-11** are done — see [Done](#done).)

*(cross-ref: **PF-1** — Save Draft lands here second, after Production · **PF-6** — this module is the pilot for opening view-only access, and **PF-7** ships with it · **PF-13** was dropped on 03-09; see the [tombstone](#dropped--pf-12-and-pf-13-03-09-2026-clients-call))*

### OD-1 · Internal transfer / Others on a dispatch  `[ ]`
*Raised 2026-08-20 · **Unblocked 2026-08-22** — the scope is settled and this is queued for build. The
four internal ledgers already carried in the masters are the ones to tag.*

There is no such option today. Add it:

1. The user picks whether this is an **Internal transfer** or **Others**.
2. For an internal transfer, **only the companies tagged internal / related** are offered.

**Update 2026-08-20 — the plumbing landed; only the TAG is still open.** Our own branches were
invisible everywhere: a ledger under Tally's `Branch / Divisions` is neither a debtor nor a
creditor, so `masters-sync` set both role flags false and the row appeared on no tab and in no
picker. The sync now reads the trade registers as well as the group chain, so four internal
ledgers are customers of their own book and are ticked into Dispatch with their catalogues
([CENTRAL-MASTERS.md](CENTRAL-MASTERS.md), items 23–24). So an internal transfer can now be
raised as an ordinary order against the right branch. What is still missing is exactly what this
task is about: **nothing marks those four as internal/related**, so the picker cannot offer
"only internal companies" and no downstream step can behave differently. The four are
ORANGE O TEC PVT. LTD.(SURAT BRANCH), ORANGE O TEC PRIVATE LIMITED(NOIDA),
ORANGE O TEC ENTERPRISES PVT LTD (NOIDA) and ORANGE O TEC ENTERPRISES-(SURAT) — a ready-made
answer to "which ones count as internal", if Bushra agrees the definition is "a Branch /
Divisions ledger that trades".

**Notes:** the company tag does not exist yet — that is the bulk of the job, not the dropdown.
Nothing on `Customer` or the company master carries an internal / related flag today. Note also
that the existing `dispatchType` is `"local" | "transport"` — a *how it ships* axis. Internal
transfer vs Others is a *what this order is* axis, so it is almost certainly a new field rather
than two more values on that one; worth confirming rather than assuming.

**To discuss with Bushra:**
- [ ] Everything that has to be updated to carry the internal tag — which master holds it
      (`mst_companies`? `mst_parties`?), who maintains it, and whether it comes from Tally or is
      ours.
- [ ] Is "internal" one flag, or internal *and* related as separate tags? (Receivables already
      reports a "RELATED PARTY" book, so the concept exists in the business.)
- [ ] Does Internal transfer change anything downstream — credit check, sales bill, gate-out — or
      only who appears in the picker?
- [ ] What happens to orders already raised for internal movement under the current options.

### OD-2 · Stop creating customer and item masters inside Orange One  `[x]`
*Raised 2026-08-20 · Answered 2026-08-21 · **LIVE — verified on master 04-09-2026.**
`REQUESTABLE_DISPATCH_MASTER_TYPES` is now filtered to `customer_item` and `company_location` only
([types/index.ts:232](frontend/src/apps/order-to-dispatch/types/index.ts#L232)), so **customer and
item can no longer be requested from Order to Dispatch at all.** They come from Tally, and nowhere
else. Shipped alongside **OD-9**.*

**What a user gets instead of a dead end.** The item they could not find is nearly always merely
*unmapped*, and **OD-9** lets them map it themselves on the spot. Only an item that exists nowhere in
Tally now stops them, and the modal says so.

**The requests already raised, for the record** (measured 04-09-2026): 7 customers and 6 items were
approved through the old route, 3 and 15 rejected. **None is pending** — the queue is empty, so
closing the route stranded nothing.

⚠ **One thing was dropped rather than done, deliberately:** how loudly a portal-created master is
flagged *inside* Dispatch. The plumbing exists — every central master row carries `source`
(`"tally" | "portal"`) plus `tally_guid` / `tally_synced_at`, and the **admin** Masters grid already
has an "In Tally" column — but Dispatch does not surface it. With the route closed, no new
portal-made master can appear, so this is now about **11 historic rows** (see **OD-5**), not an
ongoing leak. Reopen it if those rows cause trouble.

**✅ ANSWERED: remove them.** "Request a new customer" and "request a new item" come out of Order to
Dispatch entirely — they come from Tally only. That is built as part of
**[OD-9](#od-9--the-user-maps-a-customer-to-an-item-themselves-)**, which also answers what a user
sees instead of a dead end: the item they could not find is nearly always merely *unmapped*, and OD-9
lets them map it themselves. Only an item that exists nowhere in Tally now stops them, and it says so.

**Still open here:** how loudly a portal-created master is flagged *inside Dispatch*, and what happens
to the ones already sitting there. The admin Masters grid already carries the tag; Dispatch does not
surface it.

*(cross-ref: **OD-5** — if the request stays, the company it is raised for is the missing half)*

On refresh, **Customer Master and Item Master must come from Tally only.** We should never create a
new customer or item directly in Orange One — it is created in Tally first, and only then appears
here. Down the line, disable that option. And if anyone does create one here, it must be **clearly
highlighted and tagged** so it is obvious at a glance.

**Notes:** the tagging half largely exists already. Every central master row carries `source`
(`"tally" | "portal"`), plus `tally_guid` and `tally_synced_at`
([liveMasters.ts](frontend/src/core/platform/liveMasters.ts)), and the admin Masters grid already
has an **"In Tally"** column that flags anything whose `tally_synced_at` predates the last
successful sync as *Not in last sync*, filterable like any other column. Portal-only rows are a
known quantity too — the Phase 1 cutover recorded 15 Dispatch customers with no Tally ledger
([CENTRAL-MASTERS.md](CENTRAL-MASTERS.md)). So this is mostly about **enforcement in Order to
Dispatch and surfacing the tag there**, not new plumbing.

What is open is the disabling. Today *all five* master types are requestable from the module —
`REQUESTABLE_DISPATCH_MASTER_TYPES` spreads the full list, `customer` and `item` included — via
[RequestMasterModal.tsx](frontend/src/apps/order-to-dispatch/components/RequestMasterModal.tsx).

**To discuss with Bushra:**
- [ ] Remove "request a new customer / new item" from Order to Dispatch **entirely**, to avoid
      confusion? (This is the question to put to her.)
- [ ] If not removed: does the request still get approved here, or does it become "go create it in
      Tally and wait for the sync"?
- [ ] What a user should see when the customer or item genuinely isn't there yet — a dead end is
      worse than a request queue.
- [ ] How loudly a portal-created master should be flagged in Dispatch, and what happens to the
      ones already sitting there.

### OD-3 · Who maps customer to item  `[x]` *(decision — build is OD-9)*
*Raised 2026-08-20 · **Answered 2026-08-21***

**✅ THE USER DOES IT, DIRECTLY. No approval, and no request.** The mapping stops being something you
ask for and becomes something you do, in place, while raising the order.

**Why it was never really a gate:** of the 122 master requests ever raised in this module, **85 are
customer-item mappings and only 5 of those were rejected** — 94% approved. Nobody was being protected
by the wait; a person mid-order was simply blocked.

**Guard:** the same one that already decides who may raise the order — `fms_dispatch_can_raise`. The
mapping owners are still named, and still told when one is created, but for information only; there is
nothing to approve. **The build is [OD-9](#od-9--the-user-maps-a-customer-to-an-item-themselves-).**

Customer-to-item mapping depends entirely on Tally today. When a mapping is missing, the user
raises a request and the PC has to approve it. Give the user the option instead — or, now that we
have a process coordinator, let the PC own this properly.

**Notes:** the mapping is `customer_item` → `mst_party_items`, the one *nameless* master
(`NAMELESS_MASTERS`), already requestable inline from the order lines grid with the customer and
item pre-filled ([OrderLinesGrid.tsx:82](frontend/src/apps/order-to-dispatch/components/OrderLinesGrid.tsx#L82)).
So the flow exists; the question is purely **who is allowed to complete it**. Note the tension with
OD-2: mapping is the one master here that is arguably ours rather than Tally's, so the answer need
not match.

**To discuss with Bushra:**
- [ ] Does the user create the mapping directly, or does the PC keep approving it?
- [ ] If the user: any guard at all, or a free hand? (A wrong mapping puts the wrong item on a
      customer's order.)
- [ ] Does this connect to **PC-1** — should these approvals land in the coordinator's single
      queue?

### OD-4 · SO-2627-0413 names the wrong copy of SPECTRUM DIGITAL  `[x]`
*Raised 2026-08-20 · **Cleared 2026-08-22** — the call came back and this is closed. What was decided
still has to be written in here, then the entry moves to Done.*

*(cross-ref: **OD-5** — the companyless approved customer is why this pair could form)*

**Left exactly as it is** on purpose — logged here rather than fixed, pending her call.

A customer exists once per Tally book, so SPECTRUM DIGITAL is three rows: Colorix — Surat,
Enterprise — Surat and O-tec — Surat. Only the **O-tec — Surat** row is ticked into Dispatch.
Five orders have been raised against the firm, all billed by **O-tec — Surat**, and four of them
use that O-tec row. **SO-2627-0413** (raised 2026-08-19, still at `awaiting_dispatch_confirm`)
uses the **Enterprise — Surat** row instead.

**Effect if left:** the order dispatches normally — nothing is blocked. The consequence is on the
paperwork: the sales bill would name the Enterprise — Surat ledger while O-tec — Surat is billing,
so the invoice and the Tally posting disagree about which ledger the sale belongs to.

**Probably nobody's mistake.** `customersForCompany()` deliberately offers a customer with **no**
company under *every* company — the newly-approved-customer case. That Enterprise row most likely
had no `company_id` when the order was raised, and the Tally sync filled it in afterwards, which
is what makes the pair look wrong today.

**How it was found:** comparing every order's billing company against the company its customer row
belongs to. 67 of 437 orders differ; all but this one are explained by rows that had no company at
the time. Re-run any time with the query in
[CENTRAL-MASTERS.md](CENTRAL-MASTERS.md) under the company-scoped masters note.

**To discuss with Bushra:**
- [ ] Repoint SO-2627-0413 at the O-tec — Surat row, or leave it and let the bill go out as is?
- [ ] Should an order whose customer row later gains a *different* company be flagged anywhere, or
      is this rare enough to handle one at a time?
- [ ] The other 66: leave them alone (they are closed or cancelled), or sweep them once?

### OD-5 · A requested customer / item is born with no company  `[ ]`
*Raised 2026-08-20 · **not blocked** — the behaviour is decided; only the details at the foot are ours to settle*

Whenever a user raises **request a new customer** or **request a new item** from the intake form,
**no company is picked** — the form never asks, so the request carries none and the approved row
lands companyless. It should ride along by default: the company the user already chose **at the top
of the sales order form** is the company the request is raised for.

**It breaks in three places, and all three have to move together.**

1. **The modal is never told.** The customer picker prefills `{ name }` only
   ([SalesOrderFields.tsx:197](frontend/src/apps/order-to-dispatch/components/SalesOrderFields.tsx#L197)).
   The pattern already exists twelve lines up — a new *location* prefills
   `{ name, company_id: f.form.companyId }` ([:158](frontend/src/apps/order-to-dispatch/components/SalesOrderFields.tsx#L158)).
   The item side is the same omission plus one more step: `raiseFor` prefills `{ name }`
   ([OrderLinesGrid.tsx:89](frontend/src/apps/order-to-dispatch/components/OrderLinesGrid.tsx#L89))
   and the grid is handed `customerId` but **not** the company, so the intake form has to pass it in.
2. **The form has no slot to put it in.** Neither the `customer` nor the `item` arm of
   [masterFields.ts](frontend/src/apps/order-to-dispatch/lib/masterFields.ts) renders a company
   field, and neither value bag carries a `company_id` key. ⚠ Those keys **are** the write payload
   and the Excel round trip (`emptyValuesFor`'s own warning), so a new key means the column must
   exist on every save path that reads the bag, not just in the modal.
3. **Approval throws it away.** The live resolver inserts `mst_parties` with **no** `company_id`
   and then ticks the new party into **every active company** via `mst_party_companies`
   ([phase2/01_cutover.sql:542](supabase/phase2/01_cutover.sql#L542)); `item` does the same into
   `mst_item_companies`. So even a company sent from the form would be dropped on the floor today.

**Why it is worth doing — this is the mechanism behind OD-4.**
With `company_id` null, `customersForCompany()` treats *no company* as *every company*
([store.tsx:718](frontend/src/apps/order-to-dispatch/store.tsx#L718)), so a freshly approved
customer appears under all five books and can be ordered under the wrong one. The wrong ledger does
not stop at the order — it flows into the sales bill and the Tally posting. Stamping the company at
request time is what removes the guess.

**⚠ It must land on `mst_parties.company_id` — not on `mst_party_companies`.** Migration
[20260921130000](supabase/migrations/20260921130000_revert_dispatch_gate_to_company_id.sql) reverted
a widening that read that table as permission to bill: central masters keeps **one party row per
Tally book**, so *which book may bill this row* has exactly one answer, and it is `company_id`.

**One thing this does NOT change:** an item's company is informational and deliberately does not
narrow the item picker — the customer↔item mapping is the authority there
([types/index.ts](frontend/src/apps/order-to-dispatch/types/index.ts)). Stamping it on a requested
item is record-keeping, so nobody should expect the picker to behave differently afterwards.

**Precedent to match:** Customer Onboarding already asks the company **first**, before the GSTIN,
and refuses to submit without it ([20260918120000](supabase/migrations/20260918120000_add_fms_customer_company.sql),
[20260918120200](supabase/migrations/20260918120200_fms_customer_require_company_and_salesperson.sql)).

**Sequencing:** overlaps **OD-2** — if Bushra removes "request a new customer / new item" from
Dispatch outright, this dies with it for those two types. The prefill half is cheap and safe either
way; do the resolver half once OD-2 is answered.

**Open, for us to settle:**
- [ ] Default-and-editable, or fixed to the order's company? (The same firm legitimately needs a
      ledger in more than one book, but the requester is mid-order under exactly one.)
- [ ] Once the company is stated, does the resolver stop blanket-ticking every active company into
      `mst_party_companies` / `mst_item_companies`, or is that tick still wanted as the sibling map?
- [ ] Show the company on the approver's modal too, so the owner sees which book they are creating
      the ledger in — and can correct it before it exists.
- [ ] The rows already approved companyless: sweep them once, or leave them to the Tally sync (which
      is what produced OD-4)?

### OD-7 · Sale type on the sales order, and the item list follows it  `[ ]`
*Raised 2026-08-21 · **not blocked** — the behaviour is asked for; what is ours to settle is where an
item's sale type comes from*

The intake form gains a **Sale type**, and the item picker then offers only the items of that type.

**✅ Step 0 is DONE — every item carries its correct type, from the sheet.** That was **MS-1**,
shipped 2026-08-21; see [Done](#done) for the numbers, the loader and the two questions it left open.
The field and the filter now have something real to read, so the rest of OD-7 is unblocked. The
group-name reading below is only a sizing exercise showing why guessing does not work; it is
superseded by the sheet and kept for the record.

**What MS-1 settled, and what it means for the rest of OD-7:**
- **It lists items, not stock groups** — 11,431 item names. So the type lives on **`mst_items`**, and
  the `mst_items` vs `mst_item_groups` question below is answered: `mst_items`.
- **The vocabulary does NOT match the five words.** The sheet uses 16, normalised to **13**. The five
  existing keys keep their spelling and each of the 13 carries the bucket it maps down to, so a sales
  order can still be lined up against what it became on the ledger — the filter reads the 13, the
  join reads the 5.
- **Items the sheet does not name (608) keep whatever they carry** — not blanked, not parked under
  Other.
- **The load is re-runnable**: a staging table plus one script, additive-only.

**There is no sale type anywhere in this module today.** Nothing in
[order-to-dispatch/](frontend/src/apps/order-to-dispatch/) mentions one, and `fms_dispatch_orders`
carries 87 columns without it. The only thing shaping the item list is the customer's own mapping —
`itemsForCustomer` ([store.tsx:732](frontend/src/apps/order-to-dispatch/store.tsx#L732)), fed by
`mst_party_items`: **8,025 active mappings, 789 customers, 1,693 distinct items — 10.2 items per
customer on average, but up to 219 on one.** Sale type is the second cut that long list needs.

**It lands in five places.**

1. **The field.** The intake header
   ([SalesOrderFields.tsx](frontend/src/apps/order-to-dispatch/components/SalesOrderFields.tsx)) —
   ⚠ read its layout comment first: Customer must stay immediately before Customer location, and the
   pairing only holds while Customer's position is odd **and** not a multiple of three. It is 5th
   today. Inserting a field re-counts every position, and it breaks on tablet only.
2. **The filter.** `allowedItems` in
   [OrderLinesGrid.tsx:66](frontend/src/apps/order-to-dispatch/components/OrderLinesGrid.tsx#L66)
   narrows further by type — but the `includeIds` escape hatch must survive it. That argument is
   what keeps a line's own item in its picker; drop it and switching the sale type on an order that
   already has lines blanks those rows on the next edit.
3. **The payload.** `OrderInput` / `orderPayload`
   ([dispatchWrites.ts:40](frontend/src/apps/order-to-dispatch/data/dispatchWrites.ts#L40)),
   `fms_dispatch_submit_order` + `fms_dispatch_update_order`, and a new **nullable** `sale_type` on
   `fms_dispatch_orders` (additive-only). The RPC re-checks the customer↔item rule server-side; it
   has to re-check this one too, or a stale row walks an off-type item through.
4. **The Orders grid.** A new column means a sort toggle and a cascading filter under it — the
   default, not a decision.
5. **Where an item's sale type actually comes from.** Answered by Step 0's sheet; the sizing below
   is why it has to be a sheet and not a rule.

**The vocabulary is already fixed, and it is not ours to invent.** Receivables types every rupee on
five buckets — `ink · spare_parts · machine · head · other`
([SaleTypeMultiSelect.tsx:6](frontend/src/apps/receivables-hub/components/SaleTypeMultiSelect.tsx#L6),
[agingReport.ts:55](frontend/src/apps/receivables-hub/lib/agingReport.ts#L55)) — resolved by
ConnectWave's `resolve_sale_type`. Dispatch must use the same five words or an order can never be
lined up against what it became on the ledger.

**And this is the first time the type would be known *before* the invoice.** ConnectWave can only
read a sale type off the voucher type or the bill-name prefix — i.e. after the bill exists, which is
exactly why the SPARE/ and HEAD/ series fell into Other until
[sale_type_rules_spare_head_prefixes.sql](supabase/connectwave/sale_type_rules_spare_head_prefixes.sql)
taught it those prefixes (**RC-1** notes). Stating the type on the order states it up front.

**Sizing the mapping — map the GROUP, not the item.** Every item already carries its Tally stock
group (`mst_items.group_id` → `mst_item_groups`): **14,264 of 14,267 items are grouped**, and the
1,693 orderable ones sit in just **217 group rows — 167 distinct names**, since Tally files the same
group separately in each company book. So typing them is ~167 decisions, not 14,000.
⚠ It cannot be guessed from the name: matching on ink/head/spare/part/machine types 98 of the 167 and
leaves **69 names, 524 orderable items, in Other** — and they are not fringe. REACTIVE H SERIES,
NOVACRON HD and DIGISTAR (BIB) are inks; CHEMICALS, DIRECT TO FABRIC and ELECTRICAL say nothing
either way; and several groups are named after the supplier (ELYSIUM INDUSTRIES INDIA PVT LTD, 41
items). Somebody types those once, and only a person who knows the product can — which is exactly
what the Step 0 sheet is.

**Open, for us to settle:**
- [ ] Is the sale type a property of the **order** (one type, the whole order) or of the **line**?
      One-per-order is the simpler filter and matches how a bill is raised — but it means an order
      for ink *and* a spare part becomes two orders. Confirm before enforcing it.
- [x] Does the type live on `mst_item_groups` or on `mst_items`? — **`mst_items`.** The Step 0 sheet
      names items, one by one, so the type is exact per item rather than inherited from a group whose
      contents do not all bill on one ledger. Settled by MS-1.
- [ ] Untyped items — hidden from every sale type, or shown under **Other**? Hiding them makes an
      unmapped group silently unorderable, which is the failure nobody can diagnose from the screen.
      **608 items are in this position** after MS-1, plus 55 that carry no type at all.
- [ ] Does the sale type also decide the **sales ledger at the bill step**, or is it only a filter on
      intake? If it is only a filter, the order and the invoice can still disagree.
- [ ] The 478 orders already raised (91 still live): leave them untyped, or backfill from the items
      they carry? Untyped history is fine for a filter, and wrong the moment a report groups on it.

**To discuss with Bushra:**
- [ ] Can one order mix sale types, or is a mixed order meant to be split?
- [ ] Who owns the group → sale type map once it exists — the same owner as the item master?

---

### OD-10 · Item type on the sales order, and the item list follows it  `[x]`
*Raised 2026-08-21 · **LIVE 2026-08-21** — `e919da9` *"The sales order asks what kind of item, and the
list follows it"*, on master, Vercel green · **CLOSED 04-09-2026**, verified on master.*

⚠ **This entry said "on localhost only, not pushed" for two weeks after it had in fact shipped.** It
went to master the same day it was written and the note was never updated. Checked on the branch:
the Item type field is live in
[SalesOrderFields.tsx:265](frontend/src/apps/order-to-dispatch/components/SalesOrderFields.tsx#L265)
and the mapping modal's filter in
[MapCustomerItemModal.tsx:124](frontend/src/apps/order-to-dispatch/components/MapCustomerItemModal.tsx#L124).
**This is OD-7's intake-filter half only**; see the boundary below.

**Where it stands.** Written, `npm run build` passes, **not pushed**. No migration and no database
change — this is entirely frontend, so there is nothing to apply ahead of the deploy.

What landed:
- **Item type**, 7th on the intake header, single-select, cascading to the types that customer
  actually holds. Ink preselected when they have it, blank when they do not.
- The item lines narrow to it, **with the escape hatch** — an item already on a line stays in its own
  picker whatever the type says, so switching the type on an order that has lines cannot blank a row.
- Changing the type does **not** clear the lines (changing the customer still does).
- The mapping modal's type filter became the same single-select, also defaulting to Ink — 1,119 items
  on open for O-tec — Surat instead of 8,340.
- **All four grey help lines removed** from the intake form. The red `noAssignment` line under Billing
  company stayed — it is an error, not a hint. The Remarks box stayed.
- ⚠ The layout rule held: the form went from 7 grid children to 8 and **Customer is still 5th**.

The intake form gains an **Item type**, sitting after Customer location, and the item lines below
offer only that type. **One type at a time** — a single-select, not the multi-picker every table
filter uses. **Ink is the default.** The same field is added to the mapping modal, also defaulting to
Ink. And every grey help line comes off the form.

**⚠ THIS IS NOT OD-7, and the two must not be conflated.** OD-7 is about **sale type** — the five
receivables buckets (`ink · spare_parts · machine · head · other`) — *stored on the order*, re-checked
by the RPC, reported on, and reconciled against what the invoice became. This is a **filter on the
intake picker and nothing else**: no column, no migration, nothing persisted, nothing to backfill on
the 478 orders already raised. Settled with the user on 2026-08-21 — they asked for the item list to
narrow, not for the order to remember. OD-7 still owns the stored half and its open questions
(one type per order or per line? does it decide the sales ledger?).

It also reads **`mst_items.item_type`** — MS-1's 13-word vocabulary — not the five sale-type buckets.
The two line up (`ITEM_TYPES` carries each one's `saleType`), so OD-7 can join through it later
without this being redone.

**Decided:**

| | |
|---|---|
| How many types at once | **One.** Single-select. |
| Default | **Ink** |
| Customer has no ink | **Leave the field blank** and let the user choose — do not auto-pick something else |
| Stored on the order | **No.** Filter only |
| Mapping modal | Same field, also defaulting to Ink |
| The grey help lines | **All removed** from the intake form |

**Ink is unambiguous, checked before building.** MS-1's vocabulary holds three ink words —
`ink`, `provision_ink`, `other_ink` — but **not one mapped item uses the other two**, so "Ink"
means `ink` and nothing has to be decided about ink families.

**The blank case is real and it is why the field cascades.** Of the 789 customers with any mapping,
**677 have ink and 112 (14%) have none at all** — they buy spare parts, heads or paper only. So the
type dropdown must offer **only the types that customer actually has mapped**, the cascading rule
every grid here already follows; Ink is then selected when it is on offer and left blank when it is
not, with no dead options in between. What the customers actually hold: ink 677 · spare_parts 306 ·
head 156 · machine 52 · paper 11 · raw_material 2 · packing_material 2 · other 2 · software 1.
Every mapped item carries a type — **zero untyped** — so nothing falls through the filter.

**Where it lands.**

1. **The field.** [SalesOrderFields.tsx](frontend/src/apps/order-to-dispatch/components/SalesOrderFields.tsx),
   **7th**, after Customer location and before Customer PO no.
   ⚠ Read that file's layout note first — Customer must stay immediately before Customer location, and
   the pairing only holds while Customer's position is **odd and not a multiple of three**. It is 5th
   today and **stays 5th** with the new field inserted at 7, so this particular insert is safe. It
   would not be if the field went in above Customer, and it breaks on tablet only.
2. **The item list carries no type yet.** `Item` has no `itemType`
   ([types/index.ts](frontend/src/apps/order-to-dispatch/types/index.ts)) and `COLS.items` does not
   select `item_type` ([dispatchFetch.ts](frontend/src/apps/order-to-dispatch/data/dispatchFetch.ts)).
   Both have to gain it — one narrow text column on the catalogue query. `CompanyItem` already
   carries it (OD-9), which is the shape to copy.
3. **The filter.** `allowedItems` in
   [OrderLinesGrid.tsx](frontend/src/apps/order-to-dispatch/components/OrderLinesGrid.tsx) narrows by
   type. **⚠ The `includeIds` escape hatch must survive it.** That argument is what keeps a line's own
   item in its own picker; drop it and switching the type on an order that already has lines blanks
   those rows on the next edit — the same trap OD-7 flags.
4. **Changing the type must NOT clear the lines.** Changing the *customer* does, deliberately (the
   mapping changes). Changing the type does not: it is a view over the same customer's items, and the
   rows already chosen stay valid and stay visible through `includeIds`.
5. **The mapping modal.** [MapCustomerItemModal.tsx](frontend/src/apps/order-to-dispatch/components/MapCustomerItemModal.tsx)
   swaps its multi-select type filter for the same single-select, defaulting to Ink with an
   "All types" escape. For O-tec — Surat that is 1,119 items on open instead of 8,340.
6. **The help lines.** Four grey `<p>` hints come off the intake form (Dispatch type, Dispatch
   location, Customer, Customer location). ⚠ **Keep the red one** — the `noAssignment` error under
   Billing company is a failure message, not a hint, and it is the only thing telling somebody why
   their company list is empty. The **Remarks box stays**; only the help text goes.

---

### OD-12 · The LOT number should come live from Tally, not be typed by hand  🔴  `[ ]`
*Raised 2026-09-04 · asked with a screenshot of **Check Material Status** on SO-2627-0828 ·
**High priority** · audited the same day against the code and the live data*

**The ask.** At **Check Material Status** the storekeeper types the LOT no. into a free text box, one
per item line. It should instead **offer the real lot numbers, read live from Tally**, and the user
picks.

#### What is there today

A plain text input, placeholder *"as marked on the stock"*
([ShipLinesGrid.tsx:122](frontend/src/apps/order-to-dispatch/components/ShipLinesGrid.tsx#L122)),
saved to `fms_dispatch_round_items.lot_no` (`text`). **Nothing validates it and nothing requires
it** — a round saves fine with the box empty. The value then travels: the round panel
([OrderRefPanel.tsx:255](frontend/src/apps/order-to-dispatch/components/OrderRefPanel.tsx#L255)),
the order detail, and the **Order Register export**, where a line's lots are joined with commas.

#### What hand-typing has actually produced

| Measured 04-09-2026 on `fms_dispatch_round_items` | |
|---|---|
| Shipped lines | **3,475** |
| Distinct lot values typed | **653** |
| Lines with **no lot at all** | **71** |
| Lines whose box holds **more than one lot** (`,` `/` `&`) | **82** |
| Junk in the lot box | **25 lines / 8 values** — `NA` · `na` · `NIL` · `NILL` · `Nill` · `nill` · **`10 DISCOUNT`** · **`10% DISCOUNT`** |
| One physical lot, several spellings | 6 groups — e.g. **`Hm25111264co` / `HM25111264co` / `HM25111264CO`**, and `F 22604302903` / `F22604302903` |

⚠ **`10% DISCOUNT` in the LOT column is the whole argument.** A free box gets used for whatever the
person needs to say, and nothing downstream can tell that apart from a real lot.

#### 🔴 The blocker: Tally's batch data is NOT in the mirror

Everything the portal reads from Tally comes through the **ConnectWave** mirror. The complete list of
what we consume today: `v_company` · `v_ledger_detail` · `v_master_stock_item` ·
`v_clevel_stock_item` · `v_clevel_stock_group_summary` · `v_voucher_type_nature` · `v_fs_line` ·
`v_fs_company` · `v_non_bill_ref` · `rpt_sales_register` · `rpt_purchase_item`. **Not one of them
carries a batch or a lot.** `v_master_stock_item` gives `guid · item · stock_group · base_unit`;
`v_clevel_stock_item` gives closing qty and value **per item**, not per batch.

**So there is nothing to read yet, and that is the first action** — ask ConnectWave whether they can
expose **batch-wise closing stock**: company × item × godown × **batch** × quantity, ideally with the
batch's manufacturing/expiry dates.

⚠ **Read off our code, not off their database.** This lists what we *consume*; ConnectWave may
already hold more. It could not be checked directly — the ConnectWave MCP needs an authorisation
this session did not have.

#### 🟡 We already mint lot numbers ourselves, and they overlap

Production Entry stamps a finished-goods lot on a production request: `fms_production_requests.fg_lot_no`,
**40 filled** of 163 — `LANYU-26062514`, `LANYU-26062481`, and some parenthesised as
`(LANYU-26062441)`, itself a sign of hand-entry. (`lot_no` and `batch_card_no` on that table are
empty on every row.)

🔴 **And the two sources already meet.** `100770526` appears as a production `fg_lot_no` **and** as a
typed dispatch `lot_no` on **54 lines**. So before any picker is built, decide **which is the
authority** — Tally's batch, or our own production lot. Building against the wrong one means doing it
twice.

#### What to build, once a source exists

- [ ] Replace the text box with a **searchable picker** (`Combobox`, as every form field here uses),
      scoped to **that item line** and the round's **dispatch location**, showing **available qty per
      lot** so the storekeeper picks the right one rather than recalling it.
- [ ] ⚠ **Keep a way to type it anyway.** The first lot that is real on the floor but missing from
      the mirror must not stop a dispatch. Recommendation: picker first, free text behind a
      deliberate click, and mark those rows so the gap is visible instead of silent.
- [ ] 🔴 **One line can ship from more than one lot — 82 lines already do.** A single text column
      cannot hold that honestly. Either model it properly (lot + qty per line, a child table) or
      accept concatenation and say so on the screen. This is the one decision that is expensive to
      change later.
- [ ] **Warn, do not block**, when the quantity shipped exceeds what the chosen lot holds. The mirror
      lags the floor; a hard stop would strand real dispatches.
- [ ] Decide whether the lot becomes **required** once picking is easy. 71 lines say it is skippable
      today.

#### To settle

- [ ] **Which is the authority — Tally's batch, or Production Entry's `fg_lot_no`?**
- [ ] **Can ConnectWave expose batch-wise stock at all?** Nothing is buildable until this is answered.
      *(Waiting-for row added 04-09-2026.)*
- [ ] **How fresh must it be?** "Live from Tally" through a mirror means as fresh as the last sync,
      not to the second. Say so on the screen or someone will read a stale list as wrong.
- [ ] **Multiple lots on one line** — modelled properly, or one per line?
- [ ] **The 653 values already typed** — leave them as history (recommended), or normalise the six
      spelling groups and the 25 junk rows?

---

## Production Entry

*(cross-ref: **PF-1** — Save Draft lands here FIRST)*

### PE-1 · Calibration screen  `[!]`
*Raised 2026-08-20 · From the factory visit · **Blocked:** waiting on the calibration sheets*

A calibration module inside Production: **the machines on one side, the QC team's daily calibration
of each one captured against them.** The factory is sharing the Excel report they keep today; the
view gets built from that.

**Notes:** nothing production-side does calibration now. The nearest existing thing is
[asset-maintenance](frontend/src/apps/asset-maintenance/), which already treats calibration as a
service type on an asset, with dated tracks, jobs opened by nightly `pg_cron`, and meter
`readings` — but that model is built for *periodic renewals on a permanent asset*, not a **daily**
QC log. Worth deciding whether this rides on that or stands alone in Production; the daily rhythm
suggests the latter.

**To confirm once the sheets arrive:** what one calibration record holds per machine; which
machines are in scope and whether they are already a master somewhere; whether a day's calibration
is pass/fail, a set of readings, or both; who signs it off; and whether a missed calibration should
raise a queue item the way other FMS steps do.

### PE-2 · Lot-wise and stage-wise production cycle-time report  `[~]`
*Raised 2026-08-20 · From the factory visit · **Unblocked 2026-08-25**, scope agreed ·
built 2026-08-25, first-read fixes 2026-08-26 · **awaiting a look on screen before it ships***

Two screens under Production Entry → Reports, both gated on `canMonitor` (the same flag that
already opens the Control Center):

- **Lot Cycle Time** — one row per lot: when it started, how long it has spent at each stage, and
  how long the whole lot has taken. Finished stages show a duration; the stage the lot is sitting
  in right now shows age-so-far.
- **Stage Cycle Time** — one row per stage: average, median, P90, fastest, slowest, and what share
  came in inside the target. So "this stage takes this long on average" has an answer.

**Decided 2026-08-25:**
- Durations run on the **system timestamps** (`*_at`) — the only stamps carrying a time of day.
- Time is counted as **plain clock time**, nights and Sundays included, **plus** a late/on-time
  verdict against the step SLA already configured in Setup → Due Dates.
- **Both granularities**: the 5 rolled-up `STAGES` by default, expandable to all 11 steps.
- **In-flight lots are included** — they have to be; see the caveat below.

**Why it is no longer blocked on the step list.** Everything derives from `STEPS` / `STAGES` in
[steps.ts](frontend/src/apps/production-entry/lib/steps.ts) and the `AT` / `ANCHOR_AT` maps in
[queues.ts](frontend/src/apps/production-entry/lib/queues.ts) — the same four places any new step
has to be added anyway. When the factory's additional steps land, both reports widen on their own
with no report code changed. The step list is still wanted; it is no longer a gate.

**Notes:** the timing data was already there — every step stamps its own completion time on the job
card (`mhAt`, `rmtAt`, `qcAt`, `aisAt`, `tsAt`, `peAt`, `mcAt`, `pmtAt`, `pkAt`, `rtdAt`, `fgAt`,
plus `submittedAt` / `closedAt`), and `ANCHOR_AT` already says which stamp starts each step's clock,
so a stage's duration is `AT[step] − ANCHOR_AT[step]`. **No migration, no new column, no new table.**

**⚠ What the first version cannot tell you, and says so on screen.** Checked against live data on
25-Aug: 125 job cards, **none closed**, nothing ever stamped at M/C Testing or FG Transfer — so
every total reads "so far" until the first card clears. More importantly, much of the current
spread is **data-entry cadence, not floor time**: eight cards share `RM Transfer → Quality = 26.6h`
to the decimal, and `Log Book → Production` reads under a minute on most cards because both are
saved in the same second. The report renders those as `<1m` rather than `0h` and states the caveat,
instead of presenting them as a fast stage. **That gap is itself a finding for the factory** and
worth raising separately from this build.

**Known under-counts, latent rather than live** (no lot is affected today): a QC-rejected lot that
loops back through Additional Issue Slip keeps its *first* handover timestamps, because every step
stamps `coalesce(x_at, now())`; and a hold has `hold_at` but no resume stamp, so a held lot's
current stage silently includes the hold. Both are surfaced as columns, not hidden.

**Changed after the first read, 2026-08-26.** Two things came back on Lot Cycle Time:

- **Every stage column now shows.** Six of the eleven step columns had been put behind the
  Columns menu (RM Transfer, Add'l Issue Slip, M/C Testing, PM Transfer, Ready to Dispatch, FG
  Transfer), so the table opened on five and read as though the chain stopped there. A report
  whose subject is time-per-stage must not hide stages. ⚠ The picker's storage key had to be
  bumped as well (`production-lot-cycle-v2`): `QueueTable` seeds visibility as `stored ??
  defaults`, and a remembered choice beats the default permanently — so for anyone who had
  opened that menu once, dropping the flag alone would have changed nothing.
- **A graphical lot view.** `components/LotStageChart.tsx` — one horizontal bar per lot, split
  into the five stages, in days, twenty slowest first with the cut stated on screen. A stage the
  lot is still sitting in is drawn paler, because every lot in the book has one and a bar that
  mixed measured with in-progress time would overstate what has actually been measured. Colour
  is fixed **per stage, never by rank**, so filtering never repaints the survivors; the five hues
  come from the palette hr-exit and hr-recruitment already share and were run through a
  colour-vision validator rather than eyeballed.

Two limits worth knowing before anyone asks: the chart stays at **five stages even when the
table is toggled to eleven steps** (eight fixed hues in the palette; eleven segments cannot be
told apart), and it follows the **filter card, not the per-column filters inside the table** —
`QueueTable` filters its own rows internally and does not report that back out. Both are said on
the screen itself.

**Still to do before this moves to Done:** open both screens and look at them. Everything so far
is verified by `npm run build` (green) and by running the real `cycleTime` module against real
job cards, but nobody has yet seen the chart render.

**To discuss with Bushra:** which steps are missing and where they sit in the existing chain
(Handover & QC → Log Book & Production → M/C Testing → Packing → Dispatch) — the report widens to
fit them automatically, so this is now about completeness of the record, not about unblocking.

---

### PE-3 · COA at the QC step — enter the details, generate the customer and internal copies  `[~]`
*Raised 2026-08-20 · **Unblocked 2026-09-01** by the shared sheet
(`Misc/Bushra Reports/Daily Quality Monitoring Sheet OOT QC FMT 002 (1).xlsx` → tab **COA (Both)**) ·
**built and verified 2026-09-01** · migration `20260901120000_fms_production_coa.sql` **applied** ·
frontend on `daily-reports` and **deliberately NOT being deployed** — the client has asked that
nothing go to the live server until the production team has audited it (01-Sep-2026)*

A **Certificate of Analysis** raised against a lot once its Quality Check is **approved**, printed in
two audiences off one entry: a **customer** copy and an **internal** copy. Same header, same table,
different parameter list — five parameters on the customer copy, nine on the internal.

⚠ **The scope changed when the sheet arrived.** The original entry assumed we would *import* the
team's Excel and render it. The tab is not data, it is a **form**: the parameters are a controlled
list, the standards belong to that list, and the only thing anyone types per lot is the **Observed**
column. So this became two masters plus an entry form, and nothing is imported.

**What a user sees now**

- **Masters → COA Parameters** — a new tab: parameter name, **Standard**, an **optional** Test
  Equipment mapping, **Prints on** (Both / Customer only / Internal only), an **Order** and the
  Active flag. Seeded with the nine parameters off the sheet.
- **Masters → Test Equipment** — a new plain master. Seeded PHS-3C, FE30K, K6, BROOKFIELD, TU1810,
  Pycnometer.
- **A *Certificate of Analysis* card on the job card**, and an **Issue COA** action on the Quality
  Checking queue's Completed tab — both only on an **approved** lot. Product Name (the FG item) and
  Lot No (the Lot/Batch Card number) are read off the card; Issue Date defaults to today and may be
  **back-dated but never post-dated**. Then one row per active parameter: the Standard pre-filled
  from the master and editable here, the **Observed** value typed, the equipment shown read-only.
- **Two download rows — Customer copy and Internal copy** — each offering PDF, Excel or both per a
  new **Setup → COA** setting. Print is always there.
- **All three outputs reproduce the factory's own sheet**, not the portal's report chrome: the Orange
  O Tec wordmark top-left, company and address to its right, a centred *Certification of Analysis*,
  the three label/value rows, the four-column grid whose **first header cell is blank** (as on the
  sheet — the parameter column is unlabelled), the conclusion row, then the two signature rules. The
  PDF is drawn plainly in black on white rather than through `headerBand`/`drawTable`, so the PDF,
  the Excel and the printer produce the same piece of paper. *(The .xlsx carries the letterhead as
  text only — SheetJS cannot embed an image.)*
- **COA Register** under Reports — every certificate issued, newest first, sortable and filterable
  on every column, with an *Observed n/9* column so a half-filled certificate is visible from the
  list.

**Decisions taken (01-Sep-2026, with the client)**

1. **Not a step in the chain.** QC approve/reject advances the card to the Log Book exactly as
   before; the COA hangs off the approved card and blocks nothing. No new status, no queue, no SLA.
   A **repackaging card never gets one** — it bypasses Quality Check entirely.
2. **The standard is a master default that is editable per COA**, and what was typed is stored.
3. **One COA per lot, edited in place** by the Quality Checking owners, the coordinators and admins.
4. **"Both" is the common case, not "Customer".** The five customer parameters print on the internal
   copy as well — the sheet's two blocks are nested, not disjoint. Reading them as two disjoint
   lists is the easy mistake and would have produced a four-row internal copy.

⚠ **What was printed is FROZEN onto the certificate.** Each line snapshots the parameter name,
standard and equipment as they read when it was saved. Verified on live data: a standard changed in
the master afterwards left the issued certificate untouched. Without this, correcting a standard next
month would silently rewrite a certificate already in a customer's hands.

**Six things the audit caught before they shipped** — each cost a build cycle if missed:

1. **Two `master_type` CHECK constraints** (`fms_production_master_managers`,
   `fms_production_master_requests`) hard-list the types; assigning an owner to a new master fails
   until both are widened.
2. **`fms_production_email_payload` needs a `test_equipment` label arm**, or those requests email as
   *"category"* — the same omission that already shipped once for `packaging_item`.
3. **`masterFields()`'s label chain ends in `: "Unit name"`**, so a new master type with no arm is
   labelled *"Unit name"* in two modals.
4. **Order was not editable in ANY Production master** — `MasterCrud` shows the column but renders
   no input, so every other master can only be re-ordered through the Excel round trip. This master
   declares its own Order field.
5. **The PDF truncated the longest parameter.** `drawTable` ellipsizes, and *"10% Ink Solution in
   Water Foam Volume in Millilitre (1 g ink + 9 g water)"* printed as *"…(1 g…"* — a certificate
   abbreviating the name of the test. Names now wrap onto continuation rows. Caught by extracting
   the text of a generated PDF, not by reading the code.
6. **Greek `μ` (U+03BC) is missing from the embedded Poppins**, checked against the shipped cmap.
   The micro sign `µ` (U+00B5) and `³` that the seeded names actually use are both present and both
   render — but the master is free text, and a symbol-picker mu would print as a **silent blank** on
   a certificate. `GLYPH_FALLBACK` in [pdfBrand.ts](frontend/src/shared/lib/pdfBrand.ts) now maps it.

**Verified on live data (01-Sep-2026), then removed.** A COA was issued against an approved lot,
both copies generated, and the row plus its activity deleted afterwards — the observed values were
invented, and fabricated lab measurements must not sit against a real lot. Confirmed: 5 customer rows
vs 9 internal; the server refuses a future issue date, an unapproved lot and a repackaging card
independently of the client; back-dating accepted; the standard freeze holds; PDF and Excel both
carry `µ` and `³`; the Setup setting removes the Excel button rather than greying it.

✅ **THE THREE SAMPLE COAs ARE GONE, 02-Sep-2026** — lots **2608-1344**, **2608-1342** and
**2608-1339**, seeded 01-Sep-2026 so the client could look at the screens before the frontend
shipped. They hung off REAL approved lots with **every observed value invented**, marked only by the
conclusion (`[ZZ TEST DATA - DO NOT SEND] Pass / Qualified`, which printed on **both** copies).
Deleted on the client's instruction once the frontend went live, keyed on that marker so a genuine
certificate could not be caught by the statement.

**They are recoverable.** The rows were copied first into `public._coa_test_backup_20260902` — same
column list, RLS enabled with no policies, so PostgREST cannot read it:

```sql
insert into public.fms_production_coas select * from public._coa_test_backup_20260902;
-- and when nobody wants them back:  drop table public._coa_test_backup_20260902;
```

They had been inserted directly rather than through `fms_production_save_coa`, so no activity rows
were written and there was nothing else to clean; the master standards were confirmed still blank
and the storage bucket confirmed empty of COA files before deleting. The nine parameters and six
test equipments are **not** test data — they came with the migration and stay.

⚠ **ONE CERTIFICATE REMAINS AND IT IS REAL.** Lot **2608-1333** (EPN Sublimation Ink Black), issued
02-Sep-2026 16:56 IST by Vivek.Boid@orangeotec.com on a live card still sitting at quality check —
with **0 of 9 readings filled in**. It is what prompted the client to ask about the samples at all.
See **PE-7**: the form lets a certificate save with every reading blank.

**Still to confirm with the factory / Bushra** — none of it blocks use:

1. The sheet misspells two parameters — *"Surface Tention"* and *"Mililiter"* (the Daily QC tab
   spells the first correctly). Both are seeded corrected; confirm, since one prints on a
   customer-facing document.
2. **Analyst / Q.C. Head** — currently ruled lines to sign by hand, as on the paper form. Print the
   recorded user's name instead?
3. Does the customer copy need a **document number / revision / ISO line** the way the Daily QC sheet
   carries `OOT-QA-FMT-004 · ISO 9001-2015`? The COA tab carries none.
4. Units live **inside** the parameter names ("Conductivity (ms/cm)") — keep, or split a Unit column?
5. Should the customer copy ever be **emailed** from the system, or is downloading it enough?
   (Out of scope as built. The COA save deliberately writes no notification, so it sends no mail.)

---

### PE-5 · The COA moves into the quality check itself — filled standards, a COA per test round, and Print COA on the completed row  `[~]`
*Raised 2026-09-02 · from the client, walking the Record quality check screen · builds on **PE-3**,
which is built and verified but **deliberately not deployed** pending the production team's audit.
This lands on the same `daily-reports` branch and ships with it.*

**ALL EIGHT ITEMS ARE BUILT AND VERIFIED, 02-Sep-2026 — except B, which is not code.** Two
migrations, both **applied** to the live database:
`20260902120000_fms_production_coa_per_round.sql` (A and F's per-round half) and
`20260902130000_fms_production_coa_remarks_and_signed_copy.sql` (D, C and F's upload half).
E, H and G are frontend only. The frontend sits on `daily-reports` and, as with PE-3, is
**deliberately NOT deployed**. What shipped is recorded inside each item below.

**Still open: B alone** — the nine standard values, which QC has to state. It is data entry, not
code, and everything around it works: the form pre-fills from the master, and item C now lets QC
type them once on a certificate and push them up.

The COA exists (PE-3) but it hangs *beside* the quality check rather than being part of it: the
action is a button on the Completed tab, the form opens cold, and once a certificate is saved there
is nowhere on that screen to print it. This entry moves it inside the step and closes the loop —
issue, print, re-test, re-issue — and drops the testing attachment once the certificate is doing
that job.

**Eight items. They are not equally sized: B, E and H are small, F changes the schema.**

**A · Issue COA inside the Record quality check form, before Approve or Reject**

Today the action is `rowExtra` on the Quality Checking queue's Completed tab
([QualityQueue.tsx:24-33](frontend/src/apps/production-entry/pages/queues/QualityQueue.tsx#L24-L33)),
rendered only when `r.qcStatus === "approved"`. It is wanted in the step form itself — the
`isQuality` arm of [StepModal.tsx](frontend/src/apps/production-entry/components/StepModal.tsx),
above the Approve / Reject pair, so the certificate is entered as part of recording the test rather
than remembered afterwards.

⚠ **This collides with the server guard, not just with the layout.** `fms_production_save_coa`
refuses outright unless `qc_status = 'approved'`
([migration L529-531](supabase/migrations/20260901120000_fms_production_coa.sql#L529-L531)) — and
before the user has pressed Approve, `qc_status` is `null` on a first round and `rejected` on a
re-test. So "issue the COA *before* approving" cannot be saved through the RPC as it stands. Two
readings, and they are materially different:

**DECIDED 02-Sep-2026 — relax the guard. The COA is saved even when the round is REJECTED, it
prints, and the paper says the lot failed.** The client was asked twice, plainly, and chose this
both times.

The reasoning is sound and worth writing down, because the code will look wrong to whoever reads it
next: **the COA form is the test-results record, not only the certificate.** The observed values on
a failed lot are real measurements and are the evidence for the rejection. Throwing them away
because the verdict went the other way loses the lab's actual work.

What it costs:

- ⚠ **The server guard comes out** —
  `if coalesce(v_qc,'') <> 'approved' then raise` in
  [fms_production_save_coa](supabase/migrations/20260901120000_fms_production_coa.sql#L529-L531).
  **The repackaging refusal directly above it STAYS** — a repackaging card runs no quality check at
  all, so it has no test to record. Do not remove both because they sit together.
- ⚠ **The QC result must be stamped ONTO the certificate**, per round, at save — the same freeze
  rule as the standards. Re-reading `qc_status` at print time would relabel an old certificate when
  a later round changes the verdict.
- **All three outputs carry the verdict**: the PDF, the Excel and the browser print. It belongs
  where a reader cannot miss it — next to the conclusion, not in a corner — and it touches
  [coaVm.ts](frontend/src/apps/production-entry/lib/coaVm.ts),
  [coaPdf.ts](frontend/src/apps/production-entry/lib/coaPdf.ts),
  [coaXlsx.ts](frontend/src/apps/production-entry/lib/coaXlsx.ts) and
  [printCoa.ts](frontend/src/apps/production-entry/lib/printCoa.ts) together.
- **The COA Register needs a Result column**, or a failed certificate is indistinguishable from a
  passed one in the list it is most likely to be found from.

**The marking is a WATERMARK — decided 02-Sep-2026.** `REJECTED` printed large and pale across the
page, behind the text, the way a DRAFT stamp works. The client was shown the alternatives (a red
band at the top, or one line beside the Conclusion) and chose this.

⚠ **The Excel copy CANNOT do this, and must not be left unmarked.** SheetJS embeds no images and has
no watermark layer — the same limit that already forces the .xlsx to carry the letterhead as text
only (PE-3). The PDF gets a rotated grey string and the browser print gets a CSS overlay, but the
Excel needs a **plain text fallback** stating the rejection, placed where it cannot be scrolled past.
Left to itself, the one output that silently loses the marking is the one people forward as an
attachment.

⚠ **A pale watermark is the weakest of the three against a bad photocopy or a low-toner printer** —
this was raised and the client chose it anyway, which is their call. Worth pairing with the result on
the Conclusion line so there is a plain-text statement underneath the visual, and worth printing one
real page on the factory's own printer before this ships rather than judging it on screen.


---

**✅ BUILT 02-Sep-2026 — what item A actually shipped**

- **A *Certificate of Analysis · Test n* block sits in the `isQuality` arm, directly above the
  Approve / Reject pair.** It names its own round, says whether that test has a certificate, and
  opens `CoaModal` — rendered as a **sibling** of the dialog with `stacked`, never a child (a
  stacked modal inside a read-only `<fieldset disabled>` comes up inert).
- **The Test history rows now show which earlier rounds carry a certificate**, and open it. That is
  where the rounds are already listed, so it is where one-per-round becomes visible to the user.
- **The server guard came out; the repackaging refusal stayed** — and a third refusal replaced the
  one that went: *a card that has not reached quality checking has no test to certify*. Dropping
  the approved-only guard with nothing in its place would have let a certificate be issued against
  a lot nobody had tested.
- **The verdict is stamped per round by TWO writers that agree**: `fms_production_save_coa` reads
  that round's own record at save (null when the certificate is entered first), and
  `fms_production_record_quality` stamps the round it has just recorded. That is what makes "fill
  the certificate, then press Reject" come out labelled.
- **All four outputs carry it.** `coaVm.ts` gained `result` / `resultText` / `watermark`; the PDF
  draws a pale rotated stamp *before* each page's content, the print view a rotated CSS overlay at
  `z-index:-1`, and the .xlsx — which can do neither — a **bold red banner row directly under the
  title**. A **Result :** row prints under the Conclusion on **both copies** in all three.
- **The COA Register grew Test and Result columns** (sort + filter on each, per the repo default).

⚠ **A CERTIFICATE WITH NO VERDICT YET IS MARKED TOO — decided 02-Sep-2026.** The COA can now be
saved before Approve/Reject is pressed, so there is a window in which it is printable and the lot
has not been passed. It prints `NOT VERIFIED` and reads *"Result : Not yet recorded (Test n)"*.
Printing it clean would have read as a pass. The form says so before you save it, too.

⚠ **A REJECTED LOT IS NOT ON THE QUEUE'S COMPLETED TAB, AND CANNOT BE — the finding that changed
this item's shape.** `completedFor` keys on `qcAt`, and `qc_at` is stamped **only in the approved
branch** of `fms_production_record_quality`. So a lot whose test was rejected has `qcAt = null` and
sits in the **Pending** tab as a tracking row while its top-up loop runs. The step form is
therefore not a convenience for the rejected case — **it is the only route to it**, alongside the
job card. (The comment in `QualityQueue.tsx` claimed otherwise and has been corrected.)

⚠ **Two rounds legitimately disagree inside the quality form, and both are right.** On a blocked
tracking row the heading reads *"Test 2 — retest"* (the test ahead) while the certificate belongs
to **Test 1** (the test that just failed). The COA block therefore always names its own round
rather than inheriting the heading — see `lib/coaRound.ts`, which states the rule once and mirrors
the server.

⚠ **Still to do before this is judged:** print one real page on the factory's own printer. The
watermark was checked by rendering the PDF and reading it back, and it is pale by design — that is
a screen judgement, not a paper one. **The exact wording on a customer-facing certificate for a
failed lot is still open** (question 2 below).

---

**B · The standards open blank — diagnosed, and it is data, not code**

The prefill is correct. `seedRows` copies `p.standard ?? ""` off the master for every active
parameter ([CoaModal.tsx:80-108](frontend/src/apps/production-entry/components/CoaModal.tsx#L80-L108)).
The reason every row is empty is that **the seed never wrote a standard**: the insert lists
`(name, test_equipment_id, appears_on, sort_order)` and no `standard` column
([migration L602](supabase/migrations/20260901120000_fms_production_coa.sql#L602)), so all nine
parameters carry `standard = NULL`.

Nothing needs rewriting, and ⚠ **the values are not in the QC sheet — checked against the workbook,
02-Sep-2026.** It has a **Standard Specs.** tab holding exactly one cell — *"We will enter manually
afterwards for our internal reference (No relsation with software)"* — and the **COA (Both)** tab
leaves the Standard column empty for all nine parameters. The seed omitted the column because the
sheet it was built from omitted it too. So there is no import to write and no file to wait for:
**QC has to state the nine standards, and someone types them into Masters → COA Parameters once**
(or a follow-up `update` migration ships them with the module).

⚠ **Read that sheet cell before treating this as settled.** The factory's own position was that
standards are internal reference with *"no relation with software"*. The client's 02-Sep ask — that
the COA form pre-fill them from the master — is the opposite of that, so the standards are now in
scope where they deliberately were not. Worth confirming once with QC rather than assumed.

Everything downstream — the freeze, the per-COA override, both printed copies — already works and
was verified on live data on 01-Sep; it has simply had nothing to pre-fill *with*.

**C · An edited standard offers to go back to the master**

New. When a row's Standard is changed away from the master default, offer to save the new value to
the master too — a per-row tick, or one line at the foot of the table ("3 standards differ from the
master — update the master as well?"). Unticked, behaviour is exactly what it is today: the change
lives on this certificate only.

⚠ **It must not reach certificates already issued, and does not** — `lines` is a frozen `jsonb`
snapshot per COA and is never re-read from the masters (PE-3, and verified on live data). Saying so
here so that nobody later "helpfully" back-fills the issued rows to match a corrected master.

**DECIDED 02-Sep-2026 — anyone who may issue a COA may also push the standard to the master.** The
tick is offered to Quality Checking owners, coordinators and admins alike. The client's reasoning:
the people running the test are the people who know the right value, and a wrong standard should be
correctable at the moment it is noticed rather than queued behind whoever owns the master.

⚠ **It is still a MASTER edit made from a step form, so it must be recorded like one.** This is now
the only place in the module where a master changes without going through Masters or a master
request. Write an activity row naming who changed which standard, from what to what — without it,
a standard that quietly drifts has no trail and the next argument about a certificate has no answer.

⚠ **The write needs its own path, and PostgREST will refuse a lazy one.** Updating one parameter's
`standard` must be fully qualified on the row id; an unqualified update is rejected outright, and a
rollback-wrapped SQL test will never show it.

**✅ BUILT 02-Sep-2026.** One line at the foot of the table with a single tick, unticked by default
and never remembered between openings — *"1 standard differs from the master — update the master as
well?"*, naming which. The per-row tick was the alternative and was not taken: **every master
standard is still null (item B)**, so the ordinary case for months is somebody typing all nine and
wanting all nine kept, and nine separate ticks would be worst at exactly the job this does most.

⚠ **IT COULD NOT BE A TABLE WRITE, and the reason is worth keeping.** Two separate refusals stop
the obvious `db.from('fms_production_coa_parameters').update(...)`: RLS on that table admits only
an admin or a `coa_parameter` **master manager** — and the decision is that anyone who may ISSUE a
COA may push, which a Quality Checking step owner is neither — and `fms_production_activity` is
**admin-write only**, so the trail could not be written from the browser at all. Both now run
inside `fms_production_save_coa`, under the `fms_production_can_act('quality_check', …)` check that
is *precisely* `is_admin OR is_coordinator OR is_step_owner`. The update is fully qualified on the
parameter row id.

The push runs **after** the certificate is written, so a save that fails for any other reason
cannot leave a master edited behind it; it skips a value that already matches the master, so a
change that did not happen leaves no trail; and each real change writes
`type = 'coa_standard_updated'` with a human note — *Standard for "PH" updated in the master:
(blank) → 6.5 - 8.5*.

**Verified on live data, then reversed:** the master moved, the activity row named who/which/
from/to, and — the thing this item most needed to prove — **the three issued certificates' `lines`
were byte-identical before and after** (md5 of the jsonb, compared). Two further saves with the
tick untouched wrote no second activity row.

**D · Remarks, alongside Conclusion**

The form ends in a single free-text Conclusion
([CoaModal.tsx:271-279](frontend/src/apps/production-entry/components/CoaModal.tsx#L271-L279)).
Add **Remarks** under it. One nullable `remarks` column on `fms_production_coas` (additive), a
`TextArea` in the modal, and the register gains a column.

**DECIDED 02-Sep-2026 — Remarks print on the INTERNAL copy only, never on the customer copy.** The
reason is the one that makes the field usable at all: staff must be able to write plainly about a
batch without a customer reading it. ⚠ **This makes Remarks the first field whose audience is fixed
in CODE rather than by the parameter master's `appears_on`** — every other difference between the
two copies is data-driven. Put it behind the same audience switch the line rows already use, not a
second mechanism, or the two copies start diverging in two places at once.

It touches
[coaVm.ts](frontend/src/apps/production-entry/lib/coaVm.ts),
[coaPdf.ts](frontend/src/apps/production-entry/lib/coaPdf.ts),
[coaXlsx.ts](frontend/src/apps/production-entry/lib/coaXlsx.ts) and
[printCoa.ts](frontend/src/apps/production-entry/lib/printCoa.ts) together, because all three
outputs must stay the same piece of paper.

**✅ BUILT 02-Sep-2026.** Nullable `remarks` on `fms_production_coas`, a `TextArea` under Conclusion
in `CoaModal`, and a sortable + text-filterable **Remarks** column in the register. Shown on the job
card's certificate block too, when present, so nobody thinks the field was lost.

⚠ **The audience switch is `showsOn`, the same one the line rows use.** `coaVm.ts` declares a single
`REMARKS_AUDIENCE = "internal"` and feeds it through that function; `buildCoaDocument` then returns
`remarks: null` on the customer copy and **all three renderers simply omit the row when it is
null** — none of them re-checks `audience`. That is the whole point: a second mechanism is how the
two copies start diverging in two places at once.

**Verified:** on the internal copy the Remarks row prints in the PDF (pdf.js extraction, with a
control string), in the .xlsx and in the print HTML; on the customer copy it is absent from all
three, and `buildCoaDocument(...).remarks` is null.

⚠ **Two Remarks fields now sit on adjacent screens and they are NOT the same thing.** `qcRemarks`
on the quality step form is the TEST's remark; this one belongs to the CERTIFICATE. Nothing is
wired between them, both carry a comment saying so, and the step form's label now reads *"the
TEST's remark — the certificate has its own, in the COA form"*.

**E · Download and print from the quality check screen, once the COA is issued**

The control already exists and needs no design:
[CoaExports.tsx](frontend/src/apps/production-entry/components/CoaExports.tsx) is the two labelled
rows — **Customer copy** and **Internal copy** — each with PDF / Excel / Print per Setup → COA. It
is mounted in the register ([CoaRegister.tsx:149](frontend/src/apps/production-entry/pages/CoaRegister.tsx#L149))
and on the job card ([RequestDetail.tsx:530](frontend/src/apps/production-entry/pages/requests/RequestDetail.tsx#L530)),
and in **`CoaModal` it is not mounted at all**. Mounting it there — visible once a COA exists on the
lot — is the whole of this item.

**✅ BUILT 02-Sep-2026** — mounted in `CoaModal`, visible once that round's certificate exists,
labelled *Download or print — Test n* and carrying the signed copy's link beside it.

⚠ **IT HAD A TRAP IN IT, and it is the one this item was most likely to fail on.** `CoaModal` in
read-only mode wraps its body in `<fieldset disabled>` — so exports mounted in the body would be
**inert for exactly the person E is for**: a viewer who opened a certificate to print it. `Modal`'s
`readOnlyHeader` renders above the body and outside the fieldset, and its own doc comment says it
exists for precisely this.

⚠ **And the obvious fix renders it TWICE.** `Modal`'s read-only branch emits `readOnlyHeader` *and*
its children — not one or the other — so mounting in both places unguarded gives a viewer two
copies, one live above and one dead below. The body copy is therefore guarded on `!readOnly`, and
the block is a single `const` rendered in exactly one of the two places.

**F · Round two asks for a COA again, and a signed COA can be uploaded**  🔴 *the schema one*

⚠ **This reverses a decision taken on 01-Sep.** `fms_production_coas.request_id` is **unique**
([migration L160](supabase/migrations/20260901120000_fms_production_coa.sql#L160)), deliberately —
*"a COA is EDITED IN PLACE, never re-issued as a new row"* (PE-3, decision 3). But Quality Checking
is multi-round: a rejected lot loops through the Additional Issue Slip and returns as Test 2, and
the rounds are already stored and rendered as **Test history**
([StepModal.tsx:1035-1050](frontend/src/apps/production-entry/components/StepModal.tsx#L1035-L1050)).
Asking for a COA again on the re-test means one of two things:

**DECIDED 02-Sep-2026 — one COA per (lot, test round). Both certificates are kept.** Test 1 keeps
what it issued; Test 2 gets its own. The client's reason is the right one: a certificate that may
already be in a customer's hands must not be silently overwritten by a later test.

What that costs, and none of it is optional:

- Drop the unique key on `request_id`; add a `round` column and make the pair unique instead.
- `coaForRequest()` becomes one-of-several. The job-card COA card, the queue button, the register
  row and the modal's "already issued" subtitle all currently assume a single certificate.
- **Which round a COA belongs to must be stamped at save**, from the card's round count, not chosen
  by the user — otherwise two certificates can claim the same test.
- The register grows a Round column, and the "Observed n/9" completeness column now reads per round.
- ⚠ **The existing three sample COAs and any real one carry no round.** Back-fill them to round 1
  in the same migration, or they sort and group as an unlabelled fourth thing.

**Plus:** *upload* a COA — a signed or scanned copy attached to the row. Two nullable columns (`attachment_path`, `attachment_name`) and
the storage path the step attachments in this module already use; no new pattern.


**✅ BUILT 02-Sep-2026 — the per-round half** (the upload half followed the same day; see below).

Every cost listed above was paid:

- `request_id`'s unique key is gone and **`(request_id, round)` is unique instead** — as a unique
  *index*, which is what `on conflict (request_id, round)` needs. ⚠ The old constraint was dropped
  by its **column list, not by a guessed name**: it was created implicitly by `request_id ... unique`,
  so its name was a Postgres convention rather than something this repo chose.
- **All three existing certificates were back-filled to round 1** — the samples on lots 2608-1344 /
  2608-1342 / 2608-1339 (since deleted, 02-Sep-2026). ⚠ **`qc_result` was back-filled too**, from each card's own
  round record and *not* from `qc_status`; left null they would print `NOT VERIFIED`, and they are
  exactly what the production team is about to audit.
- **`coaForRequest()` is gone**, replaced by `coasForRequest()` (a list, oldest test first) and
  `coaForRound()`. All four call sites moved: the job card now renders **one block per certificate**
  (Test n · verdict · issue date · conclusion · downloads · Edit), the queue button and the step
  form open the current round, and the register's Edit carries the row's own round.
- **The round is stamped by the server, never sent.** When an existing certificate is corrected the
  client sends `coa_id` and the server keeps that row's round — which is what stops "correct Test 1
  while Test 2 is open" from silently minting a duplicate.
- **The register grew Test and Result columns**; `Observed n/9` already read per row, so it now
  reads per round for free.

⚠ **A NEW ROUND'S CERTIFICATE SEEDS FROM THE PREVIOUS ROUND'S** — parameters, standards and
equipment copied forward, **Observed deliberately blank**, because that is the one thing the new
test measures. Without it a Test 2 form opens completely empty (all nine master standards are null
— item B), so QC would retype every standard they typed an hour earlier. It reads a frozen
snapshot and writes a new row, so it cannot reach back and alter what Test 1 issued. *This was a
judgement call taken inside the ask, not a client decision — say so if it is wrong.*

⚠ **NOT EXERCISED ON LIVE DATA: no lot in the book has ever reached a second test round** (125 job
cards, one rejected round in the whole history, and that card was cancelled). The schema half was
proved instead by a rolled-back probe — two rounds coexist on one card, a duplicate `(request_id,
round)` is refused — and the rejected-round save was proved end to end on the real card. **The
previous-round seeding is verified by construction only**; it will meet its first real re-test on
the floor.

**✅ THE UPLOAD HALF IS BUILT TOO, 02-Sep-2026.** Two nullable columns
(`attachment_path`, `attachment_name`) and a `FileCapture` in `CoaModal` — the same control the log
book uses, which suits this because a signed COA is a scan or a phone photo of a signed sheet.
Stored through the existing `uploadStepDocument(requestId, "coa", file)` under
`<request_id>/coa/`, and opened through the existing `StepDocLink`, which mints its own signed URL.
No storage migration was needed: the bucket's policies are bucket-wide with no folder predicate.

⚠ **THE COLUMNS ARE KEYED ON PRESENCE, NOT ON VALUE** — `case when p ? 'attachment_path'` — so an
edit that uploads no new file keeps the stored one. The client simply omits the keys (an
`undefined` disappears in `JSON.stringify`), the same rule the step payloads follow and the same
one `fms_production_update_quality` already uses. **Verified on live data:** a file was uploaded,
the row saved again with nothing new picked, and the path survived.

⚠ **There is no way to REMOVE a signed copy once attached.** Not asked for, and storage here is
additive-only. Worth knowing before someone attaches the wrong file.

**⚠ The multi-round display WAS proved after all** (the note above stands for the *seeding*): a
marked second-round row was inserted against lot 2608-1344, the queue's Print COA panel listed both
Test 1 (Approved) and Test 2 (Rejected) each with its own Customer/Internal rows, and the row was
deleted immediately. Only the previous-round **seeding** remains unexercised.

**G · "Attachment of testing" goes once the COA is in place**

It is rendered **hardcoded in the `isQuality` arm**
([StepModal.tsx:1083-1092](frontend/src/apps/production-entry/components/StepModal.tsx#L1083-L1092)),
not through config. Worth knowing before anyone goes looking: `hasAttachment` is declared on
`StepCfg` ([stepConfig.ts:42](frontend/src/apps/production-entry/lib/stepConfig.ts#L42)) and is
**set by no step**, so the generic block at `StepModal.tsx:1638` and the `StepDocLink` at `:535` are
already unreachable and are not what is on screen.

**DECIDED 02-Sep-2026 — the upload box goes for everyone, and every file already attached STAYS
readable.** No cut-off date, no per-lot condition.

**Why removing it outright is safe, which was not obvious before today's other decisions.** The
worry was that a round with no COA would be left with no evidence at all. Decision A removes that:
the COA is now enterable on **every** round, rejected ones included, so there is no longer any test
whose only record could have been an attached file. The box has nothing left to do.

⚠ **FIX-4 applies — this is a deletion, so list what goes with it before cutting.** The save path
that uploads the file and writes `qc_attachment_path` / `qc_attachment_name`
([StepModal.tsx:455-462](frontend/src/apps/production-entry/components/StepModal.tsx#L455-L462));
and the `qcFile` state and its setter. **What must STAY, and this is now an explicit client
instruction rather than an inference:** the per-round attachment links inside Test history
([:1046](frontend/src/apps/production-entry/components/StepModal.tsx#L1046)). Live cards already
carry files against earlier rounds, they were somebody's evidence for a test that really happened,
and they must keep opening. The columns stay too (additive-only) — nothing is deleted from storage.

⚠ **This is the FIX-4 trap in its exact classic form**: the upload input, the save path and the
history links all read the same two columns, and only the first two are going. Deleting the pair
"because the attachment feature is being removed" would take the history links with them, and
nothing would fail — not the build, not `tsc` — until someone went looking for a file that no
longer had a way to be opened.

**✅ BUILT 02-Sep-2026 — three things went, and only three:** the `FieldLabel` upload block in the
quality arm, the `if (qcFile) { uploadStepDocument(…) }` in the save path, and the `qcFile` state
with its reset. A comment stands where the block was, saying why it went and what did not.

**What stayed, checked one at a time:** the M/C Testing arm's identical-looking block (a different
step, and it keeps its own `setMcFile` and `StepDocLink`); the per-round links in Test history; the
generic block behind `cfg.hasAttachment`, which no step sets and which was already unreachable; both
DB columns; and every stored file. The orphan sweep afterwards flagged only `setLogFile` and
`setSignedFile`, both the documented false-positive shape — a setter handed to `FileCapture` as a
prop.

⚠ **The quality save now sends NO attachment keys at all, and that is safe in both directions.** On
a new round there is nothing to send; on an EDIT, `fms_production_update_quality` keys those two
columns on presence, so a round recorded before this change keeps its file and its Test history link
keeps working.

⚠ **AND THE FIX-4 WORRY TURNED OUT TO BE EMPTY IN FACT, THOUGH IT WAS RIGHT IN PRINCIPLE.** Checked
against live data: of 77 job cards carrying recorded test rounds, **not one has ever had a quality
attachment** — zero at round level, zero at card level. The control being removed had never been
used, so nothing could be stranded by it. That also means the "file still opens" check could not be
run on real data; the history link is conditional on `r.attachmentPath` and is code this change did
not touch.

⚠ **`RequestDetail`'s Progress panel was the other place to check, and it was already right**:
`stageAttachments()` prefers the per-round files and falls back to the card-level column only for
legacy cards with no rounds at all.

**H · Print COA on a completed quality check**

The completed row today shows one ghost button reading `Issue COA` or `COA`, and it opens the entry
form ([QualityQueue.tsx:26-33](frontend/src/apps/production-entry/pages/queues/QualityQueue.tsx#L26-L33))
— there is no way to print from the queue at all. Add a second action, **Print COA**, rendered only
when the row has a certificate (`s.coaForRound(r.id, currentCoaRound(r))` — `coaForRequest` no longer exists, see F), opening the same block the register uses: the
panel at [CoaRegister.tsx:141-151](frontend/src/apps/production-entry/pages/CoaRegister.tsx#L141-L151)
wrapping `<CoaExports />`.

⚠ **Wording:** the ask says *"internal and company"*. The two copies are **Customer** and
**Internal**, "company" here meaning the customer-facing one. Keep the existing labels — which copy
you are downloading is the single most consequential thing on that control, and it is the reason
they are two labelled rows rather than a toggle.

**✅ BUILT 02-Sep-2026.** A second `rowExtra` action, **Print COA**, on any completed row whose lot
carries a certificate, opening a panel below the queue in the register's own shape. Labels kept:
Customer copy / Internal copy, two labelled rows per round.

⚠ **IT LISTS EVERY ROUND, which is the whole reason this item was flagged.** Each certificate gets
its own heading — *Test n*, its frozen verdict, its issue date — and its own export rows, so a lot
rejected at Test 1 and approved at Test 2 offers both and neither can be printed in the belief that
it is the other. **Verified**: a marked second-round row was inserted against lot 2608-1344, the
panel listed both with the right verdicts and exactly one Customer/Internal pair each, and the row
was removed. Rows with no certificate offer no Print COA at all; on live data that is 3 of 25.

**~~Sequence to build in~~ — all of it is built, 02-Sep-2026.** A and F's per-round half went
first, against the planned order, because the client asked for them by name and both carried the
decisions (server guard, schema) that everything else would have had to be rebuilt around. Then E,
H, D, C, G and F's upload half followed in one pass. **Only B is left, and B is not code** — the
nine standard values, which QC has to state.

⚠ **Two things the build changed about B's shape, worth knowing before it is done.** C now lets QC
type the nine values on a certificate and tick them up to the master, so B no longer needs anybody
to open Masters at all — the first COA of the day can populate it. And the sheet's own line that
standards are internal-only with *"no relation with software"* still stands unresolved against the
02-Sep ask; that is a question for QC, not a data-entry task.

**✅ Removed after this entry, 02-Sep-2026:** the three sample COAs on lots **2608-1344**,
**2608-1342** and **2608-1339** were deleted on the client's instruction once the frontend was live
(backup: `public._coa_test_backup_20260902` — see PE-3). Verified at the end of this build, while
they still existed: their `lines` were byte-identical to what they had been before it, and no master
standard was left set.

**To discuss with the client / Bushra:**

1. **The nine standard values.** Not a file request — they are not in the QC sheet and never were
   (see B). QC has to state them. Note the sheet's own line that standards are internal-only, with
   *"no relation with software"*, which the 02-Sep ask reverses.
2. ~~Can a COA be issued before Approve?~~ **Decided 02-Sep-2026: yes — saved even on Reject, and
   it prints, with the failure stated on the paper.** Recorded in A. **Still open: the exact
   wording** that appears on a customer-facing certificate for a failed lot.
3. ~~One COA per lot, or one per test round?~~ **Decided 02-Sep-2026: one per test round, both
   kept.** Recorded in F.
4. ~~Who may push an edited standard back to the master?~~ **Decided 02-Sep-2026: anyone who may
   issue a COA.** Recorded in C, along with the activity trail it now needs.
5. ~~Does Remarks print, and on which copy?~~ **Decided 02-Sep-2026: internal copy only.**
   Recorded in D.
6. ~~When the testing attachment is removed, does it go for everyone at once?~~ **Decided
   02-Sep-2026: yes, for everyone — and every file already attached stays readable.** Recorded in G.
7. **The wording on a failed customer copy** *(now live code, so it has a default rather than a
   blank)*: the paper reads **`Result : Rejected — this lot failed the quality test (Test n)`** with
   `REJECTED` across it. Confirm the phrasing, since it is what a customer would read.
8. **Should a certificate be printable before the verdict is recorded at all?** As built, yes — it
   prints `NOT VERIFIED`, on the reasoning that an unmarked print would read as a pass. The
   alternative (refuse the download until the test is saved) was offered and not taken; say if that
   is preferred.
9. **A cancelled job card can still be certified.** It could before this change too (PE-3 never
   guarded on it), and it is out of scope here — but it is the sort of thing that reads as a defect
   the first time someone notices it. Worth a decision either way.
10. **A signed COA cannot be un-attached.** Attaching the wrong scan is a one-way action today;
    correcting it means attaching the right one over the top, and the wrong file stays in storage.
    Say if a Remove is wanted (F did not ask for one).
11. **Nobody has ever attached a quality-test file** — 77 cards with recorded rounds, zero files, at
    either level. Item G removed a control that had never been used, which is reassuring, but it
    also raises the question the other way: was the lab meant to be attaching reports and simply
    not doing it? If so the COA now has to carry that weight, and the signed-copy upload (F) is the
    place for it.

---

### PE-6 · Separate owners for Production and Repackaging on the last four steps  `[ ]`
*Raised 2026-09-02 · from the client · four decisions taken the same day, recorded below ·
**the shape is already built and running in Order to Dispatch** — this is that migration applied to
a different dimension, not a new idea*

A job card is raised as **Production** or **Repackaging**, and from **Packing Material Transfer**
onward both types sit in the same four queues. The people who handle repacking are not the people
who handle production, and today they see each other's work. Assign owners **per step per card
type**, and a person then sees only the cards of the type they were given.

The four steps, and they are the only ones that can mean anything here:
`pm_transfer` · `packing_entry` · `ready_to_dispatch` · `fg_transfer`
([steps.ts](frontend/src/apps/production-entry/lib/steps.ts)). The other seven are in
`REPACK_BYPASSED_STEPS` — a repackaging card is raised straight into `awaiting_pm_transfer` and
never touches them — so a "repackaging owner of Quality Checking" would be an owner-set that can
never match a card. **Keep the type split to these four**, and let the CHECK constraint say so.

**Decided 2026-09-02, with the client**

1. **Queue-level, not a database boundary.** The four queues show only the owner's type. The
   Control Center, the reports, the registers and the job-card page keep showing every card.
2. **Everyone already assigned becomes an "all types" owner on apply**, so nothing changes on the
   day it ships. The split starts biting only when an admin adds a type-specific row.
3. **A type row overrides the general row for its own type only.** Give PM Transfer a Repackaging
   owner and the existing general owner keeps every production card. Assigning one type never
   silently strips the other.
4. **Notifications and email follow the type.** A repackaging card reaching PM Transfer notifies and
   emails the repackaging owners only. ⚠ **This module's email is live** — a wrong fan-out here
   sends real mail to the wrong person.

**⚠ Why decision 1 and not a real boundary.** The obvious move is to copy Dispatch exactly and put
the boundary in Postgres. It does not transfer. Location partitions the *business* — a Vapi owner
has no business seeing an Ahmedabad order at any point in its life. Card type partitions only the
*tail of one chain*: a production card runs all twelve steps, so withholding production cards from a
repackaging-only user would empty their Control Center, their reports and every register, not just
the four queues. The rows still reach the browser, so this is a **work-assignment boundary, not a
secrecy one** — say so plainly rather than letting anyone believe otherwise.

---

**The shape — copy `20260820120000_fms_dispatch_location_scoped_ownership.sql` line for line**

That migration did precisely this for Dispatch: one owner-set per step became one per
(step × location), with `null` meaning "everywhere" — the fallback grant. Read it before writing a
line of this one; it already carries the traps, and its header is the argument for decision 2.

[`fms_production_step_owners`](supabase/migrations/20260725120000_add_fms_production_foundations.sql#L60-L69)
gains a nullable **`card_type`** column. `null` = all types = the fallback. Then:

```sql
-- one owner-set per step gives way to one per (step, card_type)
alter table public.fms_production_step_owners
  drop constraint if exists fms_production_step_owners_step_key_key;
```

⚠ **TWO partial indexes, not one composite unique — the same trap Dispatch documented.** Postgres
treats NULLs as distinct, so `unique (step_key, card_type)` alone would happily accept five fallback
rows for one step, i.e. five different answers to "who owns this by default".

```sql
create unique index ... on public.fms_production_step_owners (step_key, card_type)
  where card_type is not null;
create unique index ... on public.fms_production_step_owners (step_key)
  where card_type is null;
```

Plus a CHECK that a typed row only exists on the four steps, alongside the existing
`step_key <> 'issue_slip'` one. It is one line to widen later if more steps ever split.

**The good news: the two functions that decide this already take the argument and throw it away.**

- **Server** — `fms_production_can_act(p_step_key, p_req, p_uid)` accepts a request id and
  [never references it](supabase/migrations/20260725120100_add_fms_production_requests.sql#L168-L178).
  It becomes: read `card_type` off that request, pass it down. **The signature does not change, so
  not one of its ~25 call sites moves.**
- **`fms_production_is_step_owner(p_step_key, p_uid)`** gains a third **defaulted** argument
  `p_card_type text default null`, exactly as Dispatch did — so every existing call keeps compiling
  and keeps meaning *"owns this step for any type"*.
- **Frontend** — `canActOn` is declared
  [`(stepKey: QueueStep, _r: ProductionRequest)`](frontend/src/apps/production-entry/store.tsx#L362).
  The underscore is the whole story: the card is already in hand and deliberately ignored. Drop the
  underscore and read `r.cardType`.

**And because `myQueue` already filters on `canActOn`, the pending half of every one of the four
queues comes right for free** —
[store.tsx:492-498](frontend/src/apps/production-entry/store.tsx#L492-L498), and `trackingFor`
directly below it. `StageQueue` and the four page components are untouched.

**🔴 But the Completed tab is NOT free, and this is what would ship half-done.**
`completedFor` is [`completedForPure(snapshot, stepKey)`](frontend/src/apps/production-entry/store.tsx#L630)
— a pure function of the snapshot with **no ownership filter at all**. Every card that has ever
passed the step is listed, for everyone. The pending tab would split and the Completed tab beside it
would keep showing the other type's cards, on the same screen, under the same header. It needs the
filter added explicitly. Decide at the same time whether a repackaging owner should still see
production cards they can no longer act on in **history** — the honest default is no, matching the
tab next to it.

**⚠ `canSeeQueue` must stay type-blind, and this is not an oversight.** It answers *"may this person
open the page"* and has no card to look at
([store.tsx:373-374](frontend/src/apps/production-entry/store.tsx#L373-L374)). A repackaging owner
of PM Transfer must still be able to open PM Transfer. The defaulted third argument gives this for
free — leave it alone, and say so in the code, or someone will "fix" it into a 403.

---

**🔴 The latent bug that fires the moment the first type-specific owner is assigned**

[`fms_production_step_owner_ids(p_step_key)`](supabase/migrations/20260725120000_add_fms_production_foundations.sql#L209-L220)
is a **scalar subquery** over a table that has, until now, had exactly one row per step:

```sql
select coalesce(
  (select o.employee_ids from public.fms_production_step_owners o where o.step_key = p_step_key),
  '{}'::uuid[]
);
```

A second row for the same `step_key` makes it raise **`more than one row returned by a subquery used
as an expression`** — at runtime, inside the RPC, so the *entire step write rolls back*. Not a
notification that goes missing: the packing entry itself fails to save. Dispatch hit exactly this
and rewrote it as `array_agg(distinct e)` over `unnest`.

⚠ **It must be fixed in the same migration that adds the column.** Ship the column first and the
first thing an admin does in Setup breaks four live queues.

**Threading the type through the fan-out (decision 4).** Give it a defaulted second argument —
**the request id, not the card type**: `fms_production_step_owner_ids(p_step_key text, p_req uuid
default null)`, which looks the type up itself. Every announce site already has the request in scope
and already passes `req_no` in its meta, so it is a one-token edit each, and it reads properly at
the call site. **Omitting it falls back to "both types"** — over-notify, never under-notify, which
is the safe direction and the current behaviour.

⚠ **Find the LIVE definition of each RPC, not the first one.** These functions are `create or
replace`d across ~25 migrations; the last one wins. `fms_production_step_owner_ids` alone is called
from 50+ places across the file history, and most of those lines are superseded. Read the live
bodies out of the database (`pg_get_functiondef`) and edit from those — Dispatch's migration ends
with a `do $check$` assertion block that does exactly this, and it is worth copying too. Only the
sites announcing at the four steps need the request threaded.

---

**The rest of the frontend**

- `StepOwner` + `mapStepOwner` gain `cardType`
  ([productionFetch.ts](frontend/src/apps/production-entry/data/productionFetch.ts#L517)).
- `stepOwnerFor(stepKey)` → `stepOwnerFor(stepKey, cardType)`. Dispatch's is
  `stepOwnerFor(step, locationId)` — same signature, same semantics.
- `setStepOwner` gains the type; a **`deleteStepOwner(step, cardType)`** is new, to remove an
  override and fall back to the general row. ⚠ **PostgREST refuses an unqualified write** — the
  delete must key on both `step_key` and `card_type`, and a rollback-wrapped SQL test will not
  reveal the problem.
- **Setup → Step Owners** ([StepOwnersSection.tsx](frontend/src/apps/production-entry/pages/settings/StepOwnersSection.tsx)):
  the four steps gain sub-rows — *All types* / *Production* / *Repackaging*. Dispatch's version is
  the template down to the details worth stealing: the cell that says **"inherits"** rather than
  "Unassigned" when no override exists (its line 118), and the delete-the-override button (line 260).
- [ProductionStepper.tsx:73](frontend/src/apps/production-entry/components/ProductionStepper.tsx#L73)
  calls `stepOwnerFor(st.step)` to name the owner of each step on the job card. It has the card in
  hand, so it should name the owner for *that card's* type — otherwise it tells a repackaging card's
  reader that a production owner is handling it.

**Two downstream consumers that are easy to miss**

1. **The work-snapshot email** reads `fms_production_step_owners`
   ([workSnapshot.bundle.js:3288](supabase/functions/_shared/workSnapshot.bundle.js#L3288)) and
   bundles the app's own queue logic rather than re-implementing it in SQL. Untouched, it will keep
   emailing a repackaging-only owner about production cards they can no longer see — a *daily* wrong
   mail, which is worse than a one-off. The bundle has to be **regenerated and the function
   redeployed**; that is a deploy step, not a code change, and it is the one most likely to be
   forgotten.
2. **`pc_step_owner_contacts()`** — the Process Coordinator dashboard's owner directory
   ([migration](supabase/migrations/20261012120300_add_pc_step_owner_contacts.sql#L84)). It unions
   every module's owners into a uniform shape and its header states plainly that
   *"`fms_dispatch_step_owners` is **the one table** with several rows per step"*. **That comment
   stops being true**, and production-entry will start returning two rows per step where the caller
   expects one. Re-read it against the new shape and correct the comment either way.

**Not changing, and worth stating so nobody adds it:** admins and the process coordinator keep
seeing and acting on everything; `issue_slip` stays untyped (raising a card is the same act for both
types, and the CHECK already bars owning it); RLS on `fms_production_requests` stays
`using (true)`; and no queue gains a Card Type *filter* as part of this — every grid already sorts
and filters on every column, and `CardTypePill` is already a column on these queues.

**Build order.** Migration first, with the scalar-subquery fix and the two partial indexes in the
same file — it is inert on apply, because every existing row becomes an all-types grant (decision 2).
Then `can_act` and `is_step_owner`. Then the frontend read model and `canActOn`. Then the Completed
tab filter. Then Setup. Then the fan-out and the work-snapshot rebuild — last, because that is the
half that sends mail, and it should not go live until the queues it describes are already correct.

**To confirm with the client / Bushra:**

1. **Who actually owns what** — the real names for Production and Repackaging on each of the four
   steps. Nothing is testable end-to-end without them, and the module ships inert until they are set.
2. Should a repackaging owner still see the other type's cards in the **Completed tab** of those
   four steps (history they cannot act on), or should Completed split the same way as Pending?
3. Is the split ever needed on a **fifth step**, or is Packing Material Transfer genuinely where the
   two teams part company? The CHECK is one line to widen, but the answer decides whether it is
   written at all.

---

### PE-7 · A certificate can be saved — and printed — with every reading blank  `[ ]`

**Found in the wild, 02-Sep-2026, the day the COA went live.** Lot **2608-1333** (EPN Sublimation
Ink Black) carries a Certificate of Analysis issued at 16:56 IST by Vivek.Boid@orangeotec.com with
**0 of 9 observed values**. The card is still sitting at quality check. Nothing was wrong with what
he did — he opened the new form and saved it — and nothing stopped him.

What that produces is a document headed *Certificate of Analysis*, with the letterhead, the lot
number, the nine parameter names, the standards, the test equipment, the conclusion **Pass /
Qualified**, and the Observed column empty top to bottom. All four outputs render it: the PDF, the
Excel, the browser print and the on-screen block. It can be handed to a customer exactly as it is.

⚠ **The fix is NOT simply "refuse to save until all nine are filled".** A part-filled certificate is
a legitimate working state — readings arrive as the tests finish, and PE-3 deliberately built the
register's **Observed n/9** column so a half-done certificate is visible as half-done. One of the
three sample COAs was seeded at 6/9 for exactly that reason. Blocking the save turns a normal
morning into a wall.

**The gate belongs on issuing, not on saving.** Three parts, and they are separable:

1. **Nothing prints while a reading is missing.** `CoaExports`' six buttons (Customer / Internal ×
   PDF / Excel / Print) go disabled while `observed` is blank on any line that `appears_on` that
   copy — note the audience: a customer copy that omits four internal-only rows should not be held
   hostage by them. The strip says why: *"3 readings still to enter."*
2. **The conclusion should not read Pass on an empty certificate.** It defaults to *Pass /
   Qualified* today regardless. Either default it blank until every reading is in, or leave it and
   let (1) do the work — but the current combination, a confident conclusion over an empty grid, is
   the part that would actually mislead somebody.
3. **The save stays open**, with a count on the form and in the register, so the working state is
   still a working state.

**Do not put this in the RPC alone.** `fms_production_save_coa` must keep accepting a part-filled
certificate — that is the working state. If a server-side refusal is wanted it belongs on a separate
"issue" action, which does not exist today; the certificate has no issued/draft distinction, and
adding one is a bigger change than this entry needs.

**Vivek's row stays** — it is real data, and deleting a real user's save to tidy a screen is how
history goes missing. He can fill it in or the QC team can decide what to do with it.

---

## Purchase RM Domestic

*(nothing yet — **PD-1** shipped 2026-08-27, see [Done](#done))*

---

## Purchase RM Import

*(nothing yet — **IM-1** shipped 2026-08-27, see [Done](#done))*

---

## Task Management

*(nothing yet)*

---

## Outstanding Dashboard (Receivables)

The Zero-Collection report itself is built. Live handover doc:
[RECEIVABLES-SCHEDULED-EMAIL.md](RECEIVABLES-SCHEDULED-EMAIL.md).

*(**RC-1**, grouping the bill-wise details by sale type, is done — see [Done](#done).)*

---

### RC-13 · Disputed bills — a master of the bills in dispute, and the screen that works it  `[ ]`
*Raised 2026-09-03 · Audited the same day against the code and the supplied sheet ·
Source: [Misc/Jayshree/DISPUTE & REDMARK.xlsx](Misc/Jayshree/DISPUTE%20&%20REDMARK.xlsx), tab **DISPUTE***

⚠ **Sibling of RC-12, and it should be built with it.** Clear/uncleared, the three-way toggle, the
default view, editable remarks and who-may-clear are the *same* decisions, already taken there.
Building them twice is how the two screens end up behaving differently.

**The ask.** Hold the disputed **bills** in a list of their own — customer, date, invoice amount,
pending amount, what has been received or credit-noted against it, type, the invoice reference, and
remarks. Then: **clear an entry** when it is settled (default view shows only uncleared), **edit the
remarks**, and **add a bill** by picking a customer, seeing their overdue invoices, ticking one and
writing a remark.

#### Master or report? It is both, and the module already has the pattern

Red Mark is exactly this shape and answers the question: a hand-kept **master** (`ext_redmark`) that
stores *only* what a human types, plus a **report page** (`RedMarkCustomersReport`) that joins it to
live Tally figures at read time. Nothing about a customer's money is copied into the master.

**Do the same here.** The master stores the dispute; the numbers stay live. Concretely:

| Field | Where it comes from |
|---|---|
| Customer name | **live** — `Customer.name` |
| Date | **live** — `Invoice.date` |
| **Invoice amount** | **live** — `Invoice.amount` ✅ *(the sheet does not even have this column)* |
| Pending amount | **live** — `Invoice.pending` |
| **Received / credit note** | **live** — `Invoice.receiptAdj`, `creditNoteAdj` (see the trap below) |
| Sale type | **live** — `Invoice.voucherType` |
| Invoice reference | the key — `Invoice.billRefName` |
| **Remarks** | **typed, stored** |
| **Cleared / cleared when / by / why** | **typed, stored** |

✅ **Everything on the left except remarks and the clear status is already loaded in the browser.**
`CustomerDetail.invoices` is fetched by `useAppData` today and carries all of it, which is also what
makes the "pick a customer → show their overdue invoices" add-flow essentially free.

The closest existing precedent for the table itself is **`ext_other_payments`** — the one muster that
is **per-transaction rather than per-ledger**, with its own `id` plus a `ledger_id` saying whose money
it is, and add / edit / delete in the Muster Editor. A disputed *bill* is the same shape.

#### 🔴 The invoice number is NOT unique, and the sheet proves it

`Ref. No.` **`SPARE/26-27/110`** appears **twice** in the 38 rows — once on **SWASTIK DIGITAL**
(₹34,152) and once on **PANORAMMA PRINT** (₹6,55,490). Two different customers, two different
amounts, one reference.

**So the key is `(ledger_id, bill_ref)`**, never the reference alone — which is exactly how
`collection_invoice_snapshot` is keyed (`tenant_id, ledger_id, bill_ref`). Keying on the number would
have merged those two bills, and the ₹6.55 L one is the second largest on the list.

#### The sheet — 38 rows, and it is already trying to do this by hand

Columns: `Sales Person · Party's Name · Date · Ref. No. · Pending · type · Remarks`.

| Measured 03-09-2026 | |
|---|---|
| Rows | **38** across **4 salespeople** (NAKUL JI 25, AAYUSH SIR 8, MANMOHAN JI 3, UMESH 2) |
| Customers | 20 · **Pending total ₹35.6 L** |
| `type` filled | **19 of 38** — and it holds an **item description**, not a sale type (see below) |
| `Remarks` filled | 17 of 38 |
| Rows whose remark is being used as a **status** | **at least 3** — `"CLEAR"`, `"NO DISPUTE"`, `"Dispute resolved…"` |

⚠ **That last row is the whole argument for the Clear field.** People are already writing the status
into the free-text column because there is nowhere else to put it — so it cannot be filtered, counted
or defaulted away. `PANORAMMA PRINT` (₹6.55 L) says `CLEAR` and still sits on the list.

#### 🔴 `type` in the sheet is an item description, and we do not hold it

The sheet's `type` reads *"TX027-BYHX HEAD DRIVE BOARD"*, *"KYOCERA 300 DPI - STANDARD"*,
*"SMPS 27V/DC POWER SUPPLY FOR K32"* — the **stock item**, i.e. what is actually being disputed.

**The receivables data has no item detail per bill.** `collection_invoice_snapshot` carries
`bill_ref, bill_date, amount, pending, due_date, overdue_days, sale_type` and nothing item-level. The
only item data in the hub (`stockAnalysis`, `stockSummary`) is stock reporting and is not joined to a
bill reference.

Three options, and it needs a decision: **(a)** carry `Invoice.voucherType` instead (Ink / Spare /
Head / Machine — available, but coarser than what the sheet records); **(b)** keep the item
description as a **typed** field beside remarks, since it is only filled on half the rows anyway; or
**(c)** investigate joining the sales voucher lines by voucher number — a real piece of work, not a
column.

#### What to build

**Part A — the master**
- [ ] `ext_dispute` in ConnectWave: own `id`, plus `ledger_id` + `bill_ref` (the bill it is about),
      `remarks`, `cleared` / `cleared_at` / `cleared_by` / `clear_note`, and the usual
      `checked · match_status · source · updated_at · updated_by`. Modelled on `ext_other_payments`.
- [ ] ⚠ Store **no amounts, no dates, no customer name** except a `tally_name` display fallback. They
      are live figures; copying them is how a report starts disagreeing with the dashboard.

**Part B — the screen**
- [ ] A Disputed Bills page: the eight columns above, **default filtered to Uncleared**, with
      All / Cleared / Uncleared beside it — identical to RC-12, and ideally the same component.
- [ ] **Edit remarks inline.** It is the field that changes weekly.
- [ ] **Clear / Reopen**, with the note, on the same rules RC-12 settled: always allowed, note
      required, collection team on their own customers plus admins.
- [ ] **Add a bill:** pick a customer → list their open bills (overdue first, `CustomerDetail.invoices`
      is already in memory) → tick one or more → type a remark → save. No typing of amounts or dates.
- [ ] Export to Excel, with the same as-on date the other reports carry.

**Part C — seed it**
- [ ] Load the 38 rows. ⚠ Same problem as **RC-11**: the sheet has **no Ledger ID**, and bill_ref
      alone is ambiguous. Match on `(customer name → ledger_id) + bill_ref`, report every row that
      does not match rather than guessing, and hand the unmatched back for correction.

#### The traps

- 🔴 **A settled bill DISAPPEARS from the snapshot.** When Tally knocks the bill off, its row leaves
  `collection_invoice_snapshot` — and the dispute row is then pointing at nothing. It must not vanish
  silently: show it, mark it *bill no longer open*, and prompt to clear it. The Muster Editor already
  has this concept for Red Mark (`isOrphan = !snapByGuid.has(ledger_id)`); reuse the treatment.
  **This is also the most likely way a dispute gets resolved**, so it is the normal path, not an edge
  case.
- 🔴 **"Received or credit note" is not two numbers, it is five.** `Invoice` carries `receiptAdj`,
  `creditNoteAdj`, `debitNoteAdj`, `journalAdj` **and** `otherPaymentAdj`. Show only the first two and
  `amount − pending` will not reconcile, and someone will report the report as broken. Either show one
  **Settled** figure with the breakdown on hover, or show all five.
- 🟡 **Bill-wise totals do not tie to the dashboard, and never will.** `customerCategory.ts` records
  the measurement: bill-wise overdue reads **~7.8% above** the dashboard's ledger-column overdue
  (₹38.00 cr vs ₹35.26 cr). This screen is bill-wise. Put the note on the page rather than letting
  someone discover it.
- 🟡 **Scope it like everything else** — salesperson today, Collection Team once **RC-11** lands. A
  collector should see the disputes on their own customers.
- 🟡 **Do not let a bill be added twice.** `(ledger_id, bill_ref)` unique, and the add-dialog should
  grey out bills already on the list rather than failing on save.
- 🟡 **The remark is the most valuable column and the easiest to lose.** 17 of 38 are filled and
  several are genuinely load-bearing (*"This is a rate difference matter"*, *"Nakul ji will clear
  dispute within this weekend"*). Preserve them exactly on the seed load.

#### Assumed, so the plan is not blocked — challenge either of these

- **"Fetch against this invoice" = the invoice REFERENCE NUMBER** (`Ref. No.`). *Assumed 03-09-2026.*
  Every other field in the client's list maps onto a sheet column; `Ref. No.` is the only one left
  unmapped, and it is also the identifying key, so a list without it could not address a row. The
  rival reading — *what has been recovered against it* — is already covered by the
  received-or-credit-note column. **Build with the reference number in; if the intent was something
  else it is an added column, not a rework.**
- **`type` shows the SALE TYPE we already hold** (Ink / Spare / Head / Machine / Paper / Other).
  *Assumed 03-09-2026.* The sheet's `type` is a stock-item description and **we do not have item
  detail per bill** — see above. Sale type is live, needs no typing and can be filtered. ⚠ It is
  genuinely coarser than what the sheet records: *"TX027-BYHX HEAD DRIVE BOARD"* becomes *"Spare"*.
  If the item description is what makes the row actionable, it becomes a typed field beside remarks
  (option **b**) — cheap to add later, and honest about being hand-kept.

#### To settle

- [ ] **Where does the screen live** — its own report page under Reports, a tab in the Muster Editor,
      or both (master tab for bulk edits, report page for daily work, as Red Mark does)?
- [ ] **Should a dispute carry an owner or a target date?** Almost every remark names a person and a
      deadline (*"Nakul Sir … by this week"*). Those are two columns that could be filtered and chased
      instead of read.

### RC-12 · Red Mark — a Clear status on the master, and the report management actually reads  `[ ]`
*Raised 2026-09-03 · Audited the same day against the code, the live musters and the supplied sheet ·
Source: [Misc/Jayshree/DISPUTE & REDMARK.xlsx](Misc/Jayshree/DISPUTE%20&%20REDMARK.xlsx), tab **REDMARK***

⚠ **Sequence RC-11 first.** Letting the collection team clear their own customers (decided below)
needs collection_team loaded and the per-user tags set — otherwise the server cannot tell whose
customer a ledger is. Everything else in RC-12 is independent.

**The ask, in two halves.**
1. The Red Mark master gains a **Clear** status — mark a customer cleared when the money comes in.
   **Default view shows only UNCLEARED**; the user can switch to All / Cleared / Uncleared. Clearing
   must also be possible through the export/import.
2. A **Red Mark report** carrying salesperson · customer · company · **total outstanding as on the
   day it is run** · **receipts for the last three months** · and **sales this month, flagged when it is not
   zero** — a red-marked customer should not be being supplied at all.

#### What exists today

`ext_redmark` in ConnectWave, keyed by Tally GUID, one row per red-marked ledger — and **the row's
presence IS the flag** ([musterApi.ts:81](frontend/src/apps/receivables-hub/lib/musterApi.ts#L81)).
Columns: `tally_name · company · location · salesperson · reason · checked · match_status · source ·
updated_at · updated_by`.

| Surface | State |
|---|---|
| **Muster Editor → Red Mark tab** | Add, edit and **delete** all work (`AddRedMarkDialog`, `saveRedMark`, `deleteRedMark`) |
| **Excel export / import** | Works, but **cannot add or remove a red mark** — its own note says so. Editable columns: **Salesperson, Reason, Checked** |
| **The `blocked` flag** | `connectwaveFetcher:328` builds a set of every `ext_redmark` ledger and sets `customer.blocked` from membership |
| **A Red Mark report** | **Already exists** — `RedMarkCustomersReport.tsx`, with customer, salesperson, category, company, location, outstanding, overdue, max overdue days and reason |

So half 2 is an **extension of an existing report**, not a new one, and half 1 is one new field plus
the places that read it.

#### 🔴 Do NOT reuse `checked` for this

`checked` already means something, and it is not "paid". Every muster is *"seeded from the finance
Google Sheets and topped up on every sync with unchecked **stub** rows for brand-new customers …
this screen is where a steward corrects those and ticks them off"* — it is a **data-stewardship**
flag meaning *a human has verified this row*. Overloading it with *the customer has paid* breaks
both meanings at once and cannot be untangled afterwards. **Clear is a new field.**

Suggested shape, additive: `cleared boolean default false`, `cleared_at`, `cleared_by`,
`clear_note` (how it was settled — full payment, part payment plus write-off, legal settlement).

#### 🔴 Clear and Delete are different, and both must stay

Today the **only** way off the red-mark list is `deleteRedMark`, which throws the record away.

- **Delete** = *this should never have been red-marked* — a mistake, correcting the list.
- **Clear** = *they paid; the case is closed* — and the record is exactly what you want to keep.
  Who was red-marked, why, for how long, and how it ended is the history this whole master exists
  to build. Deleting on payment destroys it.

#### 🔴 The consequence nobody would expect: `blocked` moves on 6 screens

`customer.blocked` is derived from **row presence**, so a cleared customer keeps showing as Red Mark
everywhere unless the fetcher is changed to ignore cleared rows. That one line moves:

| Reads `blocked` | Effect once Clear ships |
|---|---|
| `connectwaveFetcher:331` | the source of all of the below |
| **Dashboard** KPI tile + its Risk Register link (`?redmark=1`) | count drops to uncleared |
| **Customer Risk Register** `redmark` filter | same |
| **Credit Terms Report** — the Red Mark column and badge | same |
| **`ZCFilters.blockedOnly`** ("Red Mark only") — **on the screen AND in the scheduled Collection email** | same, including a live send |
| **Red Mark Customers Report** itself | same |

**DECIDED 03-09-2026: cleared removes the Red Mark EVERYWHERE.** All six surfaces above. The record
stays in the master marked Cleared — who, when and why — but the customer stops counting as
red-marked across the app.

⚠ **That includes the scheduled Collection email**, which mails itself weekly and carries a
`blockedOnly` option. Its numbers will move the first time anything is cleared. Ship this knowing
that, and tell whoever reads that mail — a count dropping on its own looks like a fault.

#### The sheet — 56 rows, and what it says the report should be

Tab **REDMARK**, columns: `Main (salesperson) · Particulars (customer) · Company · Total outstanding ·
DUE AS ON · Total Received · Percentage · received JUN · received JULY · received Aug ·` and an
unheaded final column carrying a free-text remark.

| Measured 03-09-2026 | |
|---|---|
| Rows | **56** (`ext_redmark` holds ~54 ledgers — close, worth a reconcile) |
| Grain | **customer × company** — e.g. GOPAL HOME FURNISHING appears 4× (Ent Noida, Ent Surat, Otec Noida, Otec Surat). ✅ **Same grain as `ext_redmark`**, which is per-ledger |
| `Total Received` column | **empty on every single row** — only the month columns are filled |
| `Percentage` | filled (0, 0.10, 0.14, 0.44, 0.59, 1.00 …) but its basis is not derivable from the other columns |
| Free-text remarks | ~20 rows, and genuinely useful — *"Legal"*, *"9l cheque received"*, *"customer will pay 2.5l this month"*. This is the `reason` field |

**The month columns are hand-typed and hand-added** (JUN, JULY, Aug — one new column per month).
In the app this must be **computed**, not typed: `MonthFacts.receipts` already gives receipts per
customer per month and is what the Collection reports read, so "Received this month" is a derived
column that can never go stale or be forgotten.

#### What to build

**Part A — the master**
- [ ] `cleared` + `cleared_at` + `cleared_by` + `clear_note` on `ext_redmark` (additive migration).
- [ ] Muster Editor: a **Clear / Reopen** action per row, a status column, and a **default filter of
      Uncleared** with All / Cleared / Uncleared beside it.
- [ ] Keep Delete, and make the two visibly different actions — Clear is routine, Delete is a
      correction.

**Part B — export / import**
- [ ] Add **Cleared** (and the clear note) to `redMarkIo`'s export columns and `buildPlan`, so a
      batch can be cleared from Excel the way Salesperson/Reason/Checked already are.
- [ ] ⚠ Import still **cannot add or remove** a red mark — that is deliberate today. Adding a
      *Cleared* column does not change it, and clearing-by-import is exactly the safe middle
      ground: it settles a case without letting a spreadsheet flag or unflag customers wholesale.

**Part C — the report**
- [ ] Extend `RedMarkCustomersReport` rather than building a second one. Add the **Clear status** and
      the **as-on date**, stated on the page and carried into the export — an outstanding figure with
      no date on it is unreadable a week later.
- [ ] **Received — last THREE months, not one** *(decided 03-09-2026)*. This month plus the two before
      it, from `MonthFacts.receipts`. The columns roll forward on their own; nobody hand-adds a month
      the way the sheet does with its JUN / JULY / Aug. One number cannot tell a first miss from a
      long silence, which is the whole question on a red-marked customer.
- [ ] 🔴 **Sales this month, and FLAG IT WHEN IT IS NOT ZERO** *(added by the client 03-09-2026)*.
      A red-marked customer should not be being supplied. If we billed them anything this month the
      row must shout — that is a control, not a statistic.
      ✅ The data is already there and the codebase already says why: `MonthFacts.sales` is documented
      as *"Billed in the month — the 'are we still supplying a non-payer' signal"*. It has been sitting
      unused for exactly this.
      Worth a KPI tile too: **N red-marked customers were billed this month**. That is the number
      management will act on, and nothing in the app can answer it today.
- [ ] **Percentage = received ÷ due**, computed. Never imported — see To settle.
- [ ] Default the report to **uncleared** too, matching the master, with the same three-way toggle.
- [ ] Keep the existing columns; they already cover the sheet's Total outstanding and DUE AS ON
      (`outstanding` and `overdue`).

#### The traps

- 🟡 **"Total outstanding as on that day" is the live snapshot, not a historical balance.** The hub
  reads the current ConnectWave snapshot — there is no as-of-date replay. So the report is always
  "as on today", and it must **print the date** rather than implying it can be back-dated. If
  management wants a true as-on-date figure, that is a different and much larger build.
- 🟡 **Received-this-month is GROSS.** `MonthFacts.receipts` is *"receipt vouchers + manual Other
  Payments … GROSS — see trap 1"*, and cheque returns are tracked separately. A red-mark customer
  whose only payment bounced would read as having paid. Show cheque returns beside it, or net them
  and say so.
- 🟡 **Consolidated vs ledger grain.** The sheet and `ext_redmark` are both per-ledger, but the
  dashboard's customer lists are *consolidated* across companies. One consolidated customer can hold
  a cleared ledger and an uncleared one. Decide what the consolidated row shows — recommendation:
  uncleared wins, since any open case keeps the customer red-marked.
- 🟡 **The report is salesperson-scoped already** (`allCustomers` comes from `useAppData`), so it
  will also be Collection-Team-scoped once **RC-11** lands. Worth confirming that is wanted — a
  collector should probably see red marks for their own customers only.
- 🟡 **The free-text remarks are the most valuable column in the sheet and the easiest to lose.**
  They map to `reason`, which the export already carries. Make sure the load preserves them rather
  than overwriting with a generic note.

#### To settle

- [x] ~~What does `Percentage` mean in the sheet?~~ **Answered 03-09-2026: received versus due.**
      A **derived** column: received ÷ due. **Compute it, never import it.**
      **Denominator assumed: DUE AS ON** — the client said "received versus *due*", and `DUE AS ON`
      is the sheet’s own column of that name. ⚠ It is NOT the same as Total outstanding: the two
      differ on 6 of the 56 rows (KALAHANSH reads ₹9.90 L outstanding against ₹8.04 L due), so the
      report must **label which one it divided by**. An unlabelled percentage is the thing nobody
      can check a month later.
      ⚠ **Do not try to reconcile against the sheet’s own values** — they do not tie, because
      `Total Received` was never filled in. Checked 03-09-2026: LOTUS CREATION reads 1.00 and does
      tie (₹2,00,000 of ₹2,00,000), but CLOTHIFY reads 0.44 where received ÷ due is 0.15, and
      CROSSA CREATION reads 0.59 where it is 0.84. The typed figures are stale, not a different
      formula.
- [x] ~~Does *cleared* remove the Red Mark everywhere, or only close it on this report?~~
      **Answered 03-09-2026: EVERYWHERE.** Dashboard KPI, risk register, credit terms, the report,
      and the "Red Mark only" filter in the scheduled Collection email.
- [x] ~~Should a partly-paid case be clearable?~~ **Answered 03-09-2026: YES, always allowed.**
      No balance check of any kind — a settlement or a write-off must be closeable. The clear note
      carries the why ("settled at 9L"). ⚠ Then the note is not optional: without it a cleared row
      with money still owed against it is unexplainable a month later. Require it.
- [x] ~~Who may clear?~~ **Answered 03-09-2026: the collection team, on their OWN customers** —
      plus admins on anyone. Jayshree views all, so she can clear all.
      🔴 **This is the one part of RC-12 that is not a small change.** Every muster write goes through
      the `muster-write` Edge Function, which today re-verifies the caller is an **Orange One admin**
      and then writes to ConnectWave with its service key — that admin check is the only thing standing
      between the browser and another project's data. Clearing needs a **second, narrower path**: a
      caller who is on the collection team may set ONLY the `cleared` fields, and ONLY on a ledger whose
      `collection_team` matches their own tag. Not a widening of the existing admin check — a new
      action beside it, with its own rule.
      ⚠ **It therefore depends on RC-11**: collection_team has to be loaded and the per-user tags
      set before the server can tell whose customer a ledger is. Sequence RC-11 first.
- [x] ~~Last 3 months' receipts, or only the running month?~~ **Answered 03-09-2026: LAST THREE
      MONTHS**, rolling automatically.
- [x] ~~Should SALES also show three months, or only the current one?~~ **Assumed 03-09-2026:
      THREE**, matching receipts. The same `MonthFacts` rows are already in memory, so it costs
      nothing, and one month cannot tell a final delivery from a supply relationship that never
      stopped — which is the actual question on a red-marked customer. ⚠ The FLAG stays keyed on the
      **current** month, as asked: three columns to read, one column that shouts.

---

⚠ **The DISPUTE tab of the same workbook is specced separately, as [RC-13](#rc-13--disputed-bills--a-master-of-the-bills-in-dispute-and-the-screen-that-works-it--).**
It is a different shape — **bill-level, 38 rows**, one row per disputed invoice rather than per
customer. **Build the two together**: Clear/uncleared, the default view, the three-way toggle and
who-may-clear are the same decisions, and implementing them twice is how the two screens end up
behaving differently.


### RC-11 · Collection Team — fill it, filter on it, and scope each collector to their own customers  `[ ]`
*Raised 2026-09-03 · Audited the same day against the code, the muster masters and the supplied
sheet · Source file: [Misc/Jayshree/UPDATED MASTER SHEET.xlsx](Misc/Jayshree/UPDATED%20MASTER%20SHEET.xlsx)*

**The ask, in two halves.**
1. Load the **Collection Team** against each customer from Jayshree's sheet, and let the dashboard
   **filter** by it.
2. Add Collection Team to the **user setup**, so a collector signing in sees **only their own
   customers** — exactly the way the salesperson scope already works. **Jayshree sees everything;
   Mohta ji, Nitesh and Vijay see only theirs.**

#### ✅ Most of half 1 already exists. The column is built, editable, and then thrown away.

This was the surprise. `collection_team` is **already a real column** on `ext_ledger_group` in
ConnectWave, and the whole editing surface is already shipped:

| Already built | Where |
|---|---|
| The column, keyed by Tally GUID | `ext_ledger_group.collection_team` |
| Read into the app | [musterApi.ts:140](frontend/src/apps/receivables-hub/lib/musterApi.ts#L140) |
| **Editable by hand**, with a datalist of existing teams | [MusterEditor.tsx:546](frontend/src/apps/receivables-hub/pages/MusterEditor.tsx#L546) |
| **Excel export AND import**, with a "Collection Team" column | [musterIo.ts:150](frontend/src/apps/receivables-hub/lib/musterIo.ts#L150), `buildPlan` at `:165` |
| Searchable in the muster | `MusterEditor.tsx:454` |

🔴 **And then it stops dead.** [connectwaveFetcher.ts:300](frontend/src/apps/receivables-hub/lib/connectwaveFetcher.ts#L300)
selects `ledger_id, tally_name, group_name` from `ext_ledger_group` — **`collection_team` is not in
the select list.** So the value is captured, stored, exported and re-imported, and **never once
reaches the dashboard.** Nothing reads it: not `types`, not any filter, not any report, not scoping.
Confirmed by grep — every reference in the codebase is inside the muster editor and its import/export.

**So half 1 is: add one column to a select, carry it through the model, and put a filter on it.**

#### The sheet — 722 rows, clean, and missing the one column that matters

`Misc/Jayshree/UPDATED MASTER SHEET.xlsx`, sheet **Collection**, columns A–H:
`Level · Salesperson · Customer Category · Customer Group · Customer · Company · Location · Collection Team`

| Measured 03-09-2026 | |
|---|---|
| Data rows | **722** (row 724 is a `Grand Total` footer — must be dropped on import) |
| Distinct customers | **481** · distinct groups **407** · salespeople **12** |
| Blank Collection Team | **0** — the column is fully filled |
| Customers assigned to **conflicting** teams | **0** — every customer maps to exactly one team |

**The teams, and the counts:**

| Team | Rows |
|---|---|
| Mohta ji | 228 |
| Jayshree | 224 |
| Nitesh | 156 |
| **Vijay** | **114** — but stored as `Vijay` (102) **and** `vijay` (12) |

⚠ **`Vijay` and `vijay` are two different strings, and this app does not normalise case.**
`scopeParties.ts` states the rule explicitly: *"Matching is exact and case-sensitive … 'OTHERS' and
'Others' are two different scopes."* Left as-is, Vijay would be scoped to 102 of his 114 customers
and 12 would be invisible to everyone. **Fix the casing in the sheet before loading it**, not in code
— lower-casing in code would silently merge genuinely distinct tags elsewhere.

🔴 **The sheet cannot be imported as it stands: it has no Ledger ID column.** The muster importer
keys every row on `Ledger ID` (the Tally GUID) and its own note says *"Import updates existing rows
only. Rows whose key is blank or unrecognised are skipped, not added."* Importing this file directly
would skip **all 722 rows** and report them as unmatched.

✅ **There is already a workflow that avoids the problem entirely** — and it needs no code:
**Muster Editor → export the Customer Groups master** (it exports `Ledger ID · Customer · Company ·
Location · Group · Collection Team · Outstanding · Checked`) → paste the team into the exported
file → **import it back**. The GUIDs are already in the file, so nothing has to be name-matched.

⚠ Name-matching Jayshree's sheet instead would be fragile for a reason the codebase has already been
bitten by: the same customer name repeats across companies and FY-split books (`connectwaveFetcher`
notes *"387 names repeat across companies"*, and the reconciliation notes record *"89 customers
becoming 206 rows"*). The sheet's own grain is **Customer × Company × Location** — 722 rows for 481
customers — which is why 481 names cannot key 722 rows. Use the GUID export.

#### Half 2 — the per-user scope. There is a template to copy, and it is a good one.

The salesperson scope is already built end to end, and Collection Team should be its twin, not a
new invention:

| Salesperson scope (exists) | Collection Team (to build) |
|---|---|
| `profiles.receivables_salespersons` (identity project) | `profiles.receivables_collection_teams` — new nullable column, additive |
| Tagged in **Admin → User form** ([UserForm.tsx:724](frontend/src/core/admin/UserForm.tsx#L724)), chips sourced from `fetchSalespersonNames()` | Same block, chips sourced from the distinct teams on `ext_ledger_group` |
| `lib/scope.tsx` → `restrictToSalespersons` | `restrictToCollectionTeams`, same file |
| `lib/scopeParties.ts` → GUID-joined party list, with the empty-list trap solved | The same module, second scope — **reuse it, do not fork it** |
| `useAppData` filters `allCustomers` + `customerDetail` + `alerts` | The same chokepoint |

**⚠ Read `scopeParties.ts` before writing a line of this.** It documents three traps that were paid
for once already and would otherwise be re-hit: an empty scope must mean *nothing*, never
*everything* (hence the tagged union, not `string[]`); the scope must **fail closed while loading**
or the whole book paints before the scope arrives; and the join is **by GUID, not by name**.

**How the two scopes combine is a decision, not a detail.** A user could carry both tags. The safe
reading is **intersection** — both filters narrow, neither widens — which is what
`composePartyFilter` already does for a user-chosen filter against a scope. Anything else lets one
tag reveal customers the other was meant to hide.

**Jayshree "sees all" is just an empty tag list** on a non-admin, the way an untagged salesperson
user works today — **except that today an empty list means *nothing*, not *everything***. So her
grant is either the portal admin role, or an explicit "all teams" state. ⚠ Do not express it as
"leave it blank": on the existing convention that shows her an empty dashboard.

#### Where the filter has to appear

**15 pages carry a salesperson filter** — Dashboard, Aging, Overdue Aging, DSO, Credit Terms,
Customer Category, Risk Register, Top Exposure, Red Mark, Other Payments, Collection Performance,
Salesperson Analysis, Salesperson Collection Report, Alerts, and the share dialog. A Collection Team
filter belongs beside it on the collection-facing ones at least. **Decide the list deliberately** —
adding it to all 15 is a bigger job than half 1, and some of those reports are sales-facing, where
a collections split means nothing.

Also: `ZCFilters` in [collectionScope.ts](frontend/src/apps/receivables-hub/lib/collectionScope.ts)
is the Collection report's filter shape, and it is read by **both the screen and the scheduled
email**. Adding a team filter there means the **scheduled send can be split by collector** — which
is very likely wanted, and is worth confirming rather than discovering later.

#### The traps

- 🔴 **`collection_team` lives on `ext_ledger_group`, but the group master's grain is the LEDGER,
  not the group.** One row per ledger GUID. A "customer" in the dashboard is a *consolidated*
  customer spanning several ledgers across companies — so a consolidated customer can inherit two
  different teams. The sheet says that never happens today (0 conflicts), but nothing enforces it.
  Decide now what the UI shows when it does: the dominant team, all of them, or a flagged conflict.
  `ConsolidatedCustomer` already carries `categories: string[]` (plural) for exactly this reason —
  follow that precedent, not the singular `category`.
- 🔴 **Case sensitivity, again.** `Vijay`/`vijay` today. Whatever loads the sheet must normalise, or
  the muster must be cleaned first. Both scopes match exactly.
- 🔴 **This is UI-level scoping only.** `scope.tsx` says so plainly: the raw data still reaches the
  browser and a technical user can read other rows in DevTools. A collections split is arguably
  more sensitive than a sales one. It does not block this task, but do not describe it to the
  client as data isolation.
- 🟡 **New customers arrive untagged.** The muster tops up with stub rows on every sync. An untagged
  customer belongs to no team, so under an intersecting scope **nobody sees them** — including the
  collector who should be chasing them. The muster needs an "untagged" view and the dashboard an
  explicit "Not assigned" filter value, the way `platformEffectiveness` carries "Not recorded"
  rather than dropping rows.
- 🟡 **The four team names are people, but they are strings.** Same shape as the salesperson tags:
  no foreign key to `profiles`, so "Mohta ji" in ConnectWave and the user's portal account are
  linked only by an admin typing the tag correctly. Live consequence measured on the HR side of the
  portal already; here it means a typo silently empties someone's dashboard.
- 🟡 **`ext_ledger_group` writes go through the `muster-write` Edge Function on the identity
  project**, which re-verifies the caller is an Orange One **admin**. So bulk-loading the teams is
  an admin action, and a collector cannot re-assign their own customers. That is probably right —
  confirm it is intended.

#### Phase-wise checklist

- [ ] **P1 · Clean and load the data.** Fix `vijay` → `Vijay`, drop the `Grand Total` row, then
      **export the Customer Groups master, paste the team column in against the GUIDs, import it
      back.** No code. Report how many of the 722 rows matched and what was left untagged.
- [ ] **P2 · Carry the value into the app.** Add `collection_team` to the `ext_ledger_group` select
      in `connectwaveFetcher`, onto `Customer`, and as `collectionTeams: string[]` on
      `ConsolidatedCustomer` (following `categories`).
- [ ] **P3 · The filter**, on the agreed pages, with an explicit "Not assigned" value.
- [ ] **P4 · The scope.** `profiles.receivables_collection_teams` (migration **before** the
      frontend), the chips in the Admin user form, `scope.tsx`, and a second scope through
      `scopeParties.ts` — reused, not forked. Intersect with the salesperson scope.
- [ ] **P5 · Walk it in the browser** as Nitesh (should see only his), then as Jayshree (all), then
      as a user carrying **both** a salesperson tag and a team tag — the intersection is the case
      most likely to be wrong.
- [ ] **P6 · The scheduled Collection email** — decide whether it splits by team, and if so add the
      field to `ZCFilters` so the screen and the send cannot diverge.

#### To settle

- [ ] **Which pages get the Collection Team filter?** All 15 that carry a salesperson filter, or
      only the collection-facing ones?
- [ ] 🔴 **What happens to the salesperson tags already set on these three?** *(for **Jayshree** and
      Ritesh Bhai — written up in [To discuss](#to-discuss-with-ritesh-bhai))* Salesperson and team
      are separate ideas but they are **not separate settings** — both limit the same account.
      Measured 03-09-2026: **Jayshree 13 tags, Nitesh 8, Vijay just 1 (NAKUL JI)**. If Vijay keeps
      it and gains team Vijay, he sees only the **overlap** — likely a handful, not his **114**.
- [ ] **How is "Jayshree sees all" expressed** — portal admin, or an explicit "all teams" tag?
      ⚠ It cannot be an empty list; that currently means "sees nothing". Note she **already** sees
      everything: the sheet holds 11 salespeople and her 13 tags cover all 11.
- [ ] **Should the scheduled Collection report split by collector**, the way it can by salesperson?
- [ ] **Are the four names the final list?** All four have logins. ⚠ **BENI MADHAV MOHTA has NO
      Outstanding Dashboard access at all** — one edit in Admin → Module Access, but confirm he is
      meant to have it.
- [ ] **Who may edit the team assignment** — admins only (as today, via `muster-write`), or should a
      collections lead be able to re-assign?

### RC-9 · The Saturday send was missed — GitHub's clock stopped  🔴  `[x]`
*Raised and fixed 2026-08-29 · **Live 2026-08-29, 11:00 IST** · migration
`20261022120000_collections_report_kick.sql`, `send-email` v30*

**What happened.** The 08:00 IST slot on Saturday 29-Aug **did not go out**, and nobody was told.
Nothing was misconfigured: replaying the gate at 08:05 returns `due:true`, **63 mails** (4 book + 59
rep copies), 0 unclaimed. GitHub's `schedule` trigger simply stopped — ticks/day against 48 expected:
40 → 39 → 29 → 31 → 18 → **3** → **2** → **1**. The last tick before the slot was 06:53 IST; the next
never came, so the 120-minute grace expired at 10:00 IST with **zero** opportunities.

**The comparison that settled it.** pg_cron's `master-report-daily` is set for **the same minute**
and fired at `08:00:00 IST` (±40 ms) on nine consecutive days including that one. Same building, two
clocks; only one keeps time.

**The fix — the waking moved, the deciding did not.** `collections_report_due()` is still the single
answer. `collections-report-kick` (`*/15`) asks it and, only if due, pokes GitHub's
`workflow_dispatch` API over `pg_net`. The runner still draws and sends — it must, at ~40s CPU
against a 2s Edge ceiling. GitHub's own `*/30` cron is **left in place** as a free backstop; it
cannot double-send.

**The silent-success trap, now closed.** Every run exits *success* — "not due" is a success — and a
dropped tick creates no run at all, so a missed slot was invisible. `collections-report-watchdog`
(`*/30`) now queues an alert once the window closes unserved. ⚠ A new outbox `kind` alone is not
enough: `send-email` ends in `markSkipped(…"unknown kind")` and `receivables_` is not in its generic
prefix list — the very first alert **was itself silently dropped** until the renderer shipped in v30.

**Proved on live data, nothing at stake:** `dispatch('dry-run')` → GitHub **204**, run built 4 files,
posted nothing. `dispatch('sample','e.techie4@gmail.com')` → 2 mails, `sent`, PDF + workbook, nobody
else. Watchdog alert requeued → `sent`. Gate simulated at 05-Sep 07:59 / 08:00 / 08:15 / Fri →
`not yet` / **due, 63** / due / `not a send day`.

**Deploying `send-email` also carried three other people's undeployed changes live** — OCPI emails
(committed 23-Aug), HR interview round 2 (26-Aug) and Travel Desk (uncommitted). All additive, none
had ever queued a mail. Done on the user's explicit go-ahead; the mailer had been two commits behind
`master` since 22-Aug.

**⚠ Still open: the 29-Aug slot was never served.** It is deliberately **not** claimed — the send log
still ends at 22-Aug — because other fixes are pending first. Sending it later needs
`grace_minutes` widened, since the gate reads `missed` and `entry.ts` returns on `due:false`.

---

### RC-10 · The reports are Customer-wise; the dashboard is Customer Group-wise  🔴  `[x]`
*Raised 2026-08-29 · called critical · **built and verified against live data 2026-08-29** · in the
working tree, not yet merged to `master`*

**Proved by running the real builder locally in `MODE=dry-run` — 0 mails queued.** Not a mock: the
same `entry.ts` the runner executes, against live ConnectWave, writing the actual PDF and workbook.

| Check | Result |
|---|---|
| `npm run build` | clean (`tsc` strict + vite) |
| Totals vs the screen | **236 customers · ₹23.57 Cr · ₹14.40 Cr overdue** — identical |
| Whole book | 236 customers → **225 group rows**, 9 holding >1 ledger |
| **NAKUL JI** vs the screen's `NAKUL JI (64)` | **64 group rows** from 67 customers — exact |
| NAKUL JI figures | 67 · ₹6.40 Cr · ₹3.43 Cr overdue · ₹49.12 L On Account — identical |
| Workbook header | `Salesperson · Customer Group · Customers · …` |
| PDF header + suffix | "Customer Group"; `DASS DIGITAL (3)`, `SHREE RAMANUJ … (2)` |
| Multi-ledger bill page | Ledger column separates `DASS EMBROIDER…` from `DASS DIGITAL` |
| Single-ledger bill page | **no** Ledger column (K3 FABRIC HUB) — the conditional holds |
| **The tripwire** | NAKUL JI's extract built without throwing — the whole point |

⚠ **`MODE=dry-run` draws one rep's extract** (`firstRepIn(ctx)` in `entry.ts`), which is why a local
dry-run exercises the per-rep tripwire at all. A run that only built the book would have proved
nothing about the guard.

**Round 2 — the bill page, off the first sample (29-Aug).** Grouping the rows by customer group
made a group's bill page span several ledgers, and banding it only by sale type interleaved them:
46 INK bills from three accounts in one run, told apart by a repeated Ledger column. That page
cannot be worked — chasing is done one ACCOUNT at a time. So the **ledger opens the section and its
sale types sit inside it**, with the ledger's own figures carried ON its band (which is what avoids
a third tier of subtotal rows):

```
DASS DIGITAL        ₹84.19 L      INK · Subtotal 20 · SPARE PARTS · Subtotal 3 · HEAD · Subtotal 2
M/S. DASS PRINTS    ₹37.75 L      INK …
DASS EMBROIDERY     ₹4.57 L       INK …
```

- **`ledger` is a new `RowKind`** in the shared `pdfBrand` — there was one band weight and this
  needs two. Same ground as a subtotal but opened by an orange rail rather than closed by a navy
  rule, which is what tells them apart when a subtotal sits immediately above the next ledger.
- **The Sale Type column is GONE and paid for the rest.** It repeated its own band on every row —
  under INK every cell said "Ink", under SPARE PARTS every cell said "Spare Par…", ellipsized
  because the width it needed was spent restating the heading eight rows above it. Its 13 went to
  the two date columns (clipping to `03-07-2…`; a truncated date is not a shorter date) and to
  Bill No, which now also holds a ledger name. **Fixed on width, not by shrinking the type.**
- **A blank row between a closed section and the next heading** — subtotal and band are both filled
  rows, so back to back they abutted into one grey slab.
- A **single-ledger page is unchanged**: no ledger band, no removed column beyond Sale Type, bands
  where they were.

Verified on the regenerated book: `DASS DIGITAL ₹84.19 L → INK/SPARE PARTS/HEAD → M/S. DASS PRINTS
→ DASS EMBROIDERY → On Account → TOTAL`, full `dd-mm-yyyy` dates throughout. Samples to
`e.techie4@gmail.com` at 06:55 and 07:19 IST — book + NAKUL JI, all `sent`, **slot still
unclaimed** (log still ends 22-Aug).

**Round 3 — a heading may use the empty cells beside it.** `DASS EMBROIDERY PRIVATE LIMIT…` was
ellipsizing inside its 28/100 column while the three date columns to its right sat **empty on that
very row** — the name was being lost to nothing at all. New `PdfColumn.span` (shared `pdfBrand`)
lets a cell say how many columns it occupies ON THIS ROW, so a heading measures against the space
it actually has. The span stops at Amount, because every heading row here — ledger band, sale-type
band, subtotal, TOTAL — carries figures in the last three columns; a bill row spans nothing, its
dates being the point. Verified: the full ledger name prints and **no ellipsis remains** on those
pages, with bill dates and the band's own figures both intact.

⚠ **Round 1's sample run failed once on `upload` with an empty error message**, after the book had
already been mailed — the retry succeeded unchanged, so it was transient. But there is **no retry
around `upload`**, so one flaky storage call aborts a live send partway through. The slot is still
claimed in a `finally` when anything was queued, so it will not re-send to people who already have
it — the rest simply never get it, and only the watchdog would notice. Worth a retry (**RC-11**).

**The mismatch, and it is mislabelled rather than merely different.** The dashboard's default view is
**Salesperson → Customer Group**. Every artefact that leaves the building is **Salesperson →
Customer** — and prints "Salesperson → Customer Group" at the top of itself anyway.

| Path | Grouped by | Heading printed |
|---|---|---|
| Dashboard | **Customer Group** | — |
| **Export** button | Customer | "Salesperson → Customer Group" |
| Email report dialog | Customer | "Salesperson → Customer Group" |
| Per-salesperson dialog | Customer | "Salesperson → Customer Group" |
| Scheduled Saturday mail | Customer | "Salesperson → Customer Group" |

**One hardcoded line causes all four.** `reportSpec.ts` correctly asks for
`groupBy: ["salesperson","group"]`, but `collectionsExport.ts` **ignores `req.groupBy`** and uses its
own `EXPORT_DIMS = ["salesperson","customer"]`. Every caller passes a *scope* only, never dims — so
the one line fixes all four paths together.

**What does NOT change.** Only non-paying ledgers are grouped: the table only ever holds customers
who paid nothing, and grouping buckets *those* rows rather than pulling in the rest of a group —
exactly what the dashboard does. Grand total stays 236 customers / ₹23.57 Cr. The KPI cards keep
counting **customers**, not groups, because the screen does too (236 customers above 64 group rows).
Nothing renders blank: `groupNameOf()` resolves by Tally ledger **GUID** — 387 ledger names repeat
across companies — and falls back to the ledger's own name when unmapped.

**⚠ The tripwire, which is why steps 1-3 cannot ship alone.** `collectionsExport.ts:371-378` guards a
rep's file against another rep's customer by comparing printed names against `r.customer.name`. Once
leaves are groups the first multi-ledger group throws and **nothing is sent**. It must be rebuilt
from `r.group` in the same edit. It is not weakened: it is the second of two independent leak guards
(`assertOnlyTheirs` checks rows going in, this checks what comes out).

**Two gaps the audit found, without which the change is technically done and practically worse:**
- The PDF has **no Customers column** (screen and Excel both do), so a 4-ledger group would look
  identical to a 1-ledger one. Rendered as an `ABC GROUP (3)` suffix, shown only when > 1 — the
  Customer column is already tight and a truncated ledger name is the worst thing on that page. The
  suffix must be added by the **renderer**, never baked into the row name, or it breaks the tripwire.
- A group's **bill page merges bills from several ledgers with no way to tell them apart**.
  `PdfBillRow` carries no ledger identity though `InvoiceDrillRow.customerName` already has it.

**Decided:** ledger names stay in the Excel bill-by-bill sheet (which already carries `customerName`
*and* `groupName` per row); the PDF shows group names only, so it does not grow past its 101 pages.

**Behaviour that shifts at group grain** — all inherited from the screen, so matching it keeps mail
and dashboard in agreement: `Last Receipt ₹` becomes a **sum** of different receipts while
`Last Receipt` is the **latest** date; `daysSinceLastReceipt` takes the worst member;
`neverPaid` / `stillBuying` become "**any** ledger in this group"; the Still Buying appendix lists
groups while its sentence counts customers; the send-log note still counts ledgers.

**Verify:** `npm run build`, then `collections_report_dispatch('dry-run')` (builds the real files,
sends nothing). ⚠ **A whole-book dry-run does not exercise the tripwire** — it fires only on a
per-rep file, so prove it with `collections_report_dispatch('sample','e.techie4@gmail.com')`, which
mails one address and does **not** claim the slot.

Frontend-only: no migration, no Edge Function redeploy; Vercel picks it up on merge to `master`.

---

### RC-8 · Credit days and credit limit are not set for most customers, and differ book to book  `[x]`
*Raised 2026-08-29 · **LIVE 2026-08-29** — `40ebc05` on master, Vercel green ·
**CLOSED 04-09-2026**, verified on master the day it was closed · off a check on VAIBHAV ENTERPRISES ·
cross-ref **MS-2** (the data half — handed to Accounts and closed with it)*

**Where it is.** Outstanding Dashboard → **Reports** → **Credit Terms Not Set**, at
`reports/credit-terms` ([CreditTermsReport.tsx](frontend/src/apps/receivables-hub/pages/CreditTermsReport.tsx),
routed at [ReceivablesHubApp.tsx:223](frontend/src/apps/receivables-hub/ReceivablesHubApp.tsx#L223)).

🔴 **Closed as BUILT, and it currently reaches NOBODY.** `profiles.receivables_allowed_reports` is an
allow-list, so a new report is invisible until an admin ticks it. Checked live 04-09-2026: **one
account in the whole directory holds any report grant at all** (Bushra, and it is `zero-collections`,
a different report). So today only admins can open Credit Terms Not Set. **One tick per finance user
in Admin → User form is all it needs** — the report itself is finished and deployed. The two
questions at the foot of this entry are what is left, and neither is code.

**VAIBHAV ENTERPRISES** was checked: credit days and credit limit filled in for one company, blank
for the others. It is one ledger in four books, and only the smallest carries a term.

| Company | Credit limit | Credit days | Outstanding |
|---|---|---|---|
| O-tec — Noida | ₹40,000 | **15 Days** | ₹28,792 |
| Enterprise — Noida | ₹16,51,000 | — | **₹16,01,201, all overdue** |
| Enterprise — Surat | ₹1 *(a flag, not a limit)* | — | ₹0 |
| O-tec — Surat | ₹1 *(flag)* | — | −₹92 |
| O-tec — Surat · `VAIBHAV ENTERPRISES MACHINE` | ₹1 *(flag)* | — | ₹4,00,000 |

The book holding **₹16 lakh, all of it overdue**, has no credit days at all — so no rule can call
anything there late.

**It is not one party.** Measured on the source the report reads — `collection_customer_snapshot`,
all 1,854 customer rows, one per ledger per book, resolved to companies through `ext_company_map`:

| Company — Location | Rows | Neither set | Days missing | Limit missing | Set on the bills | Complete |
|---|---|---|---|---|---|---|
| O-tec — Surat | 1,189 | **604** | 68 | 144 | 93 | 280 |
| Enterprise — Surat | 303 | 53 | 2 | 41 | 20 | 187 |
| O-tec — Noida | 176 | 36 | 10 | 26 | 7 | 97 |
| Enterprise — Noida | 105 | 15 | 1 | 31 | 8 | 50 |
| Colorix — Surat | 81 | 23 | 10 | 16 | 14 | 18 |
| **Total** | **1,854** | **731** | **91** | **258** | **142** | **632** |

**The genuinely uncontrolled money is ₹1.42 Cr**, not the ₹24 Cr a ledger-only reading gives — see
the bill-wise trap below, which is the single most important thing on this entry. And the Vaibhav
pattern: 391 customer names appear in more than one book, and **206 records** are missing a term the
same customer already holds in another book — ₹5.33 Cr outstanding, ₹2.10 Cr of it overdue. Those
are demonstrably an oversight rather than a deliberate no-credit book, and they are one filter click.

**It is Tally's data, not our sync** — confirmed row-for-row against the mirror's `v_ledger_detail`.
Fixing the data is **MS-2**; this entry is the report that shows Finance where to look.

**What we are building.** *Credit Terms Not Set* — Outstanding Dashboard → Reports → Receivables, at
`reports/credit-terms`. Two panels: a **company-wise** summary (one row per company + location, with
the counts above and the money owed with nothing set) and the **customer-wise** list beneath it,
every column sorting and filtering, filters cascading, 25 a page, Excel out in two sheets.
**Filters by sale type** — Ink / Paper / Spare Parts / Machine / Head / Other, a customer matching on
open outstanding or sales, with the mix shown per row: Spare Parts alone is 355 customer records, 80%
of them fully set up. A **Has outstanding** toggle drops the 1,131 ledgers sitting at exactly
zero — 1,080 rows become 140, which is the list somebody can actually work through — and a **Last
activity** column (newest receipt or bill; dormant ledgers read "—") says whether a gap is worth
chasing at all. **Every figure in the company panel is a drill-down**: click a count and the
list below becomes exactly those customers (604 -> 604 rows), click it again to come back. Clicking
the money column also switches the balance filter to *owes money*, because that column sums positive
balances only — without that the ₹82.47 L cell landed on a list whose own total read −₹3.42 Cr,
having dragged back in the credit balances the figure deliberately excludes. A zero count is inert:
it could only ever land on an empty table. The five status columns are mutually exclusive and add up to Customers; the panel
says so, and each Customers cell carries the sum as a tooltip so a future change cannot break it
quietly. Default view is the gaps, sorted by outstanding, so the largest exposure with
no terms is the first line; one
click on the filter chip widens it to the full customer list. Reads `useAppData().allCustomers` — no
new fetcher, no migration, no schema change.

**⚠ Four traps, all of which bite a naive reading of this data.**
1. **🔴 CREDIT DAYS LIVE IN TWO PLACES, AND THE LEDGER IS ONLY ONE OF THEM.** A bill carries its own
   `BILLCREDITPERIOD` — "45 Days", or an explicit date like "5-May-26" — typed at invoice entry;
   61,410 such values are stored. **142 ledgers here hold no master credit period while their open
   bills each carry a due date.** Reading the ledger alone called every one of them "Days missing".
   BISHEN DYEING (MACHINE) — 44 open bills, ₹4.62 Cr, a machine instalment schedule due 15-Apr,
   15-May, 15-Jun — was the report's number-one offender and is perfectly controlled. Correcting
   this took "owed with nothing set" from **₹24.32 Cr to ₹1.42 Cr**: the ledger-only reading
   overstated the problem by seventeen times. They now carry their own status, **Set on the bills**,
   which is visible but deliberately outside the default gap view. *(Caught in review on 29-08-2026, after the
   report had already been built and verified — the ledger-only reading looked entirely plausible.)*
2. **Tally stores a debtor's credit limit as a NEGATIVE (Cr) amount.** 817 of `mst_parties`' rows are
   negative against 123 positive. A `credit_limit > 0` test calls 817 real limits "blank".
3. **A limit of ₹1 is a flag, not a limit** — 184 rows. Tally reads 0/blank as *no credit control at
   all*, so Accounts used ₹1, the smallest figure that any sale breaches, to mean "blocked". It once
   drove the Red Mark badge; `ext_redmark` replaced it and now holds 54 ledgers, **only 12 of which
   overlap the 184**. So on Live a ₹1 row is NOT a Red Mark customer and must never be labelled one.
   The report treats `creditLimit <= 1` as not set and shows a "₹1 flag (Tally)" chip, never a rupee.
4. **Money owed must sum POSITIVE balances only.** Netting credit balances in flips a whole company:
   Colorix reads +₹0.83 Cr owed against a net of −₹4.03 Cr. An advance is not negative exposure.

**⚠ A new report reaches nobody until an admin grants it.** `profiles.receivables_allowed_reports` is
an allow-list — the opposite polarity to the menu deny-list, deliberately: *a new menu reaches
everyone until it is hidden, a new report reaches no one until it is granted*
([reportAccess.ts](frontend/src/apps/receivables-hub/lib/reportAccess.ts)). After deploy, tick
**Credit Terms Not Set** for each finance user in Admin → User form. Admins see it at once.

**To discuss:**
- [ ] Who on the finance team gets the grant.
- [ ] Should this go out on a schedule, like the Collection report? Not wired — `emailable` is only
      set in the same commit that wires an Email action and someone has actually read the output.

---

### RC-6 · Spare and Head bills read as "Other" on the salesperson report  🔴  `[x]`
*Raised 2026-08-21 · Feedback from Ritesh Bhai · **Applied live 2026-08-21, 13:54 IST** — four rules
in (ids 40–43) and the snapshot rebuilt. Moves to [Done](#done) at the next tidy-up.*

**Live result, measured after the rebuild:** Spare Parts 74 → **731** bills · Head 138 → **208** ·
Machine 385 → **386** · Other 1,219 → **491**. Exactly the 728 bills predicted, and **zero** `SPARE/`
or `HEAD/` bills are still typed `other`. `INK/`, `HD/HG/` and `HG/SPARE/` re-checked unchanged.

⚠ **The rebuild takes ~2.5 min and Supabase's HTTP gateway cuts at 2 min, so `collection_refresh()`
over PostgREST ALWAYS returns 504** — but the transaction keeps running server-side and commits
anyway. Do not read that 504 as a failure and do not retry: a retry hits the `pg_try_advisory_lock`
overlap guard and answers *"another run in progress; skipped"*, which reads like a stuck lock and is
not one. Poll `collection_meta` instead. Note `refreshed_at` is `now()` = **transaction start**, so
it stamps ~5 min before the data actually appears.

On the zero-collection report a customer's bill page groups the open bills by sale type, and the
spare-parts and print-head bills were sitting in the **OTHER** band:

| Bill | Reads as | Should be |
|---|---|---|
| `HEAD/26-27/40`, `HEAD/26-27/41` | Other | **Head** |
| `SPARE/26-27/384`, `SPARE/25-26/2103`, `SPARE/26-27/563` | Other | **Spare Parts** |
| `SPARE/EN/2627/5`, `SPARE/EN/2627/6` | Other | **Spare Parts** |

**It is not the report — it is the classification, and it is upstream of us.** The report prints
`collection_invoice_snapshot.sale_type` verbatim and the snapshot genuinely says `other`. The
ConnectWave mirror types an **open** bill from its bill NAME alone —
`resolve_sale_type(acct, '', bill_ref)`, with the voucher type passed **empty**, because
`bill_outstanding()` hands back a bill ref and no voucher. So on the open-bill path only the
`voucher_no_prefix` rules can ever fire and every `voucher_type` rule is dead code. The seeded
prefix vocabulary was `INK/ SP/ HD/ MC/ H/ HG/SPARE/` — five series read off the *opening* bills
back when that was the only case it had to cover. The current sales series `SPARE/`, `SPARE/EN/`
and `HEAD/` are in none of them, so every one of those bills fell to the `other` default.

The same snapshot row contradicts itself as a result: FY **sales** by type *are* resolved from the
real voucher type, so a customer can show spare-parts sales and zero spare-parts outstanding.

**The fix** — [sale_type_rules_spare_head_prefixes.sql](supabase/connectwave/sale_type_rules_spare_head_prefixes.sql),
four `voucher_no_prefix` rules. Prefixes are safe to key on here because Tally numbers each voucher
type on its own series: checked across all 22,070 lines of `rpt_sales_register`, no prefix maps to
two sale types. `SPARE/` → `GST SALES - SPARE PARTS` ×1296, `HEAD/` → `GST SALES - HEAD` ×128, and
each of those voucher types already has a rule pointing at the same bucket — the new rows only teach
the open-bill path what the voucher path already knew. They also type the handful of *opening* bills
on these series, which no voucher lookup could reach at all.

**⚠ `HEAD/M/` is load-bearing, not tidiness.** `HEAD/M/24-25/11` (₹16.52 L, an opening balance) is a MACHINE deal
(`GST SALES - HEAD(MACHINE)`). `HEAD/` without it would move that bill from one wrong answer to
another. The resolver breaks a priority tie on `length(match_value) desc`, so `HEAD/M/` beats
`HEAD/` and `SPARE/EN/` beats `SPARE/` — the same mechanism that already makes `HG/SPARE/` beat
`HD/`.

**What it moves** (measured against the live snapshot, refreshed 2026-08-21 10:30 IST):

| Prefix | Open bills | Pending | Other → |
|---|---:|---:|---|
| `SPARE/` | 654 | ₹2,18,40,030 | Spare Parts |
| `HEAD/` | 70 | ₹2,10,73,297 | Head |
| `SPARE/EN/` | 3 | ₹4,976 | Spare Parts |
| `HEAD/M/` | 1 | ₹16,52,000 | Machine |

**Done:**
- [x] Rules inserted into `sale_type_rule` on **ConnectWave** (`ieeefdnyhzgrroifiqbb`) — ids 40–43.
- [x] `select public.collection_refresh();` — committed 2026-08-21 08:29 UTC.
- [x] Resolver spot-checked on every series, including the controls that must NOT move
      (`M/C ADV`, `HAND/…` → `other`; `INK/`, `HD/HG/`, `HG/SPARE/` unchanged).

**Left to eyeball:** open a customer page on the Collection Report and confirm the Spare Parts and
Head bands render. The data is right; this is only confirming the screen.

**`PAPER/` — done too, as its own category.** *(Ritesh Bhai reversed the "leave it in Other" call the
same day: paper is too big to sit in a catch-all.)* 117 open bills, ₹1.05 Cr, its own Tally voucher
type. See [sale_type_paper_bucket.sql](supabase/connectwave/sale_type_paper_bucket.sql) — a new
`paper` bucket plus **two** rules, because the open-bill path and the sales path read different
signals: `voucher_no_prefix 'PAPER/'` types the outstanding bills (that path sees no voucher), and
`voucher_type 'GST SALES-PAPER'` types the sales (that path does). One without the other is the same
split-brain that started RC-6 — right outstanding, wrong sales.

Unlike Spare/Head this is a NEW product line, so the frontend gained a `paper` member in all 20
places that enumerate sale types — the `SaleType` union, the filters, the labels, the card and
reading orders, the aging record and the empty-record builders. `npm run build` (strict `tsc`) and
the collections-report email bundle both pass. Its chart colour is `hsl(165,85%,31%)`, chosen by
running the palette validator rather than by eye: it clears the chroma floor and separates from Ink
orange at ΔE 9.4 under protanopia (the obvious green failed at 8.0).

Two things stayed out: `OTPL/` is a delivery challan, not a sale, so it raises no bill; `NOTPL/`
(2 bills, ₹5.10 L) *looks* like a Nashik paper series but has no voucher to confirm it, and guessing
is what put `SPARE/` in Other for a year.

⚠ `core/platform/liveMasters.ts` has its own `ItemType` union with the same five names. It is the
Central Masters **item** type, a different thing — deliberately NOT extended.

**Still deliberately left out — each needs its own call:**
- `SER/ SER/N/ RENT/ AMC/ JOB/` — ~52 bills, ₹70 L. Income, but not a product line; the mirror has a
  `non_product` bucket the receivables screens already fold back into Other. Not yet asked.
- `CN/ DN/ G/SR/` — credit notes, debit notes, sales returns. Adjustments that belong to the bill
  they offset, not to a product line of their own.
- `HAND/ NOTPL/ PM/ MS/H/` — ~₹36 L, four series with no matching voucher anywhere in the mirror.
  `HAND/25-26/103` is on the screenshot that raised this. **Ritesh Bhai, 2026-08-21: `HAND/` is
  almost certainly a mis-typed `HEAD/`, so it belongs in Head — but leave it in Other for now.**
  Worth fixing at source in Tally rather than adding a rule that blesses the typo: a rule would
  quietly make the misspelling permanent, and any future `HAND/` bill would look correct while
  still being wrong in the books.

Everything still reading `other` after this is genuinely other: advances, on-account, TDS/TCS,
journals, round-off.

**The durable fix, not done here:** type a non-opening bill from its **origin voucher** and fall
back to the prefix only for true opening balances. That is a change to `collection_refresh()` in the
ConnectWave project, so it wants its own sitting — the prefix rules above are complete for every
bill on a numbered series, which is all of them today.

---

### RC-7 · An advance we PAID OUT is listed as an overdue bill  `[ ]`
*Raised 2026-08-21 · Feedback from Ritesh Bhai · Found on VAMA (NAKUL JI) while checking RC-6*

VAMA shows **1 open past-due bill** — bill no `ADV`, Due Days 25, Amount ₹8.50 L,
**Received −₹8.50 L**, Pending ₹17.00 L. A negative Received is the tell: nothing was received at
all, and this is not an invoice.

**The ₹17 L is real — do not "fix" the figure.** Checked against the mirror: VAMA's Tally ledger
closes at **₹17,00,000 Dr** (`v_ledger_detail`), and behind it sit two genuine `BANK PAYMENT`
vouchers, 27-07-2026, ₹8.5 L each, out of AXIS BANK (CC A/C), with different RTGS UTRs (12:44 and
14:55). Money went **out** to VAMA. The mirror and the report are faithful.

**Why it appears as a bill.** Both payments were tagged in Tally to a bill reference literally named
`ADV`. Tally's outstanding statement lists anything carrying a bill reference, and there is no field
saying "this is an advance, not an invoice" — the name is whatever the accountant typed. The report
mirrors Tally.

**Why the columns look broken.** From `ledger_bill_allocs_by_id`:

| Voucher | Bill type | Amount | |
|---|---|---:|---|
| …0002**4304** | `New Ref` | ₹8,50,000 Dr | creates reference `ADV` |
| …0002**432a** | `Agst Ref` | ₹8,50,000 Dr | *settles* reference `ADV` |

An **Agst Ref** is meant to CLEAR a reference, so it should carry the OPPOSITE sign. Both are Dr, so
the second payment **doubled** the reference instead of clearing it. `bill_outstanding()` then
reports `amount` = the New Ref only (₹8.5 L) and `pending` = the whole reference (₹17 L), and
`buildDrillRows` computes `received = amount − pending` ([collections.ts](frontend/src/apps/receivables-hub/lib/collections.ts))
— hence −₹8.5 L.

**Two separate problems. Do not conflate them.**

1. **A Tally entry error.** The second RTGS is a second advance, not a settlement of the first. It
   wants its own New Ref (`ADV-2`), or the two want to be one voucher. **This is the actual defect**
   and it is fixed in Tally, not here.
2. **A report question.** Even with Tally correct, an advance we PAID OUT is not a bill anyone is
   late on. There is no credit period, so due date = bill date and "Due Days 25" is merely age. It
   also drags VAMA onto the zero-collection list with "Last receipt Never" — technically true, and
   still not what that list is for.

**Rare, so do not over-build for it.** Of **3,493** open past-due bills, **7** have a negative
Received (₹71.68 L). Largest is `MC/26-27/45` (a different flavour — the New Ref is itself a credit
of −₹1.5 Cr against ₹53 L pending), then this `ADV` at ₹17 L. The rest are under ₹7 L.

**Decided 2026-08-21 (Ritesh Bhai): nothing changes in Tally. The fix is ours.**

**Do NOT key it on the reference NAME.** `ADV`, `M/C ADV`, `On Account`, `Journal`, `TDS` — a
name-matching rule is a guess, and a wrong guess **hides real money**, which is the opposite of RC-6
and the worse failure of the two.

**Key it on the VOUCHER TYPE that created the reference**, which is a fact rather than a guess.
`ADV` was raised by a `BANK PAYMENT` — it is not a bill and never was.
`ledger_bill_allocs_by_id` already returns `voucher_type` alongside `bill_ref`, so the signal
exists; it simply is not carried into `collection_invoice_snapshot`.

**⚠ DRY RUN, 2026-08-21 — the obvious version of this rule is UNSAFE. Measured, not reasoned.**
Ran against all 3,493 open past-due bills (₹53.32 Cr) by pulling the `New Ref` allocation behind
every one (42,155 voucher lines over the 590 ledgers that carry a past-due bill).

*Attempt 1 — "keep it only if a SALES voucher raised it, drop the rest."* Would have removed **72
bills, ₹1.66 Cr**, and **₹76 L of that was real money**:
- **60 paper invoices, ₹63.78 L**, because the voucher type `GST SALES- PAPER` is **missing from
  `v_voucher_type_nature`**. The classification view has holes, and a drop-by-default rule reads a
  hole as "not a sale". This is precisely the failure mode this task exists to avoid.
- **5 debit notes, ₹12.29 L** (`GST DEBIT NOTE`). A debit note is a genuine charge to the customer.

*Attempt 2 — invert it: drop ONLY when the creating voucher is a MONEY voucher* (chain root
`Receipt` / `Payment` / `Contra` — vouchers that move cash and cannot raise a receivable), keep
everything else including anything unclassifiable. **Default = keep = never hide money.**

*Attempt 3 — the second dry run, widened from the past-due bills to the WHOLE snapshot, caught the
one that mattered.* "Raised by cash" is true of DEBITS and CREDITS alike, and only the debits are
phantoms. Of the 30 references the rule matches, **19 are CREDITS totalling −₹94,02,878** —
`M/C ADV`, `REC 20.06.2026`, `ON ACCOUNT`, all raised by a `BANK RECEIPT`. Those are advances the
customer genuinely **paid us**. Removing them would have raised **17 customers' Outstanding by
₹94 L** and un-credited money sitting in our bank. So the rule acts on **`pending > 0` only**:
a debit with no invoice behind it overstates what we are owed; a credit with no invoice behind it is
real money that already has a home ("On Account (paid, tagged to no bill)").

**Final effect — verified against the LIVE view after it was applied, 21-08-2026**, read through the
anon key the app itself uses (850 view rows, 49 matching a snapshot bill):

| | |
|---|---|
| Bills removed | **14 · ₹1,22,07,282 off Outstanding · 14 customers** |
| Of those, past due | **10 · ₹1,01,34,928 off Overdue** |
| Credits matched but **kept** | 35 · −₹1,91,49,520 |
| Customers whose Outstanding rises | **0** — impossible by construction |
| Sales-raised references in the view | **none** |
| Paper invoices removed | **0 of 116** |

Biggest: `MC/26-27/45` ₹53.00 L, `On Account` ₹20.00 L, `ADV` ₹17.00 L (VAMA), two `BANK PAYMENT`
at ₹10.00 L each, `24.09.2026` ₹8.00 L. Every one raised by `BANK RECEIPT`, `BANK PAYMENT` or
`BANK PAYMENT-CHQ.R`.

*The pre-apply dry run predicted 11 bills / ₹1.19 Cr — within 2.5% of the live 14 / ₹1.22 Cr. The
gap is coverage, not logic: the dry run could only read allocations for the 720 ledgers that carry a
snapshot bill, while the view scans every ledger in the mirror.*

⚠ `INK/N/26-27/410` (₹1,416) and `HD/HG/26-27/95` (₹295) carry real sales bill NUMBERS but their
`New Ref` came from a `BANK RECEIPT` that over-applied. ₹1,711 between them, so the rule's only
judgement call costs nothing today. Worth re-checking if it ever grows.

**Adopt attempt 3. Do not adopt 1 or 2.**

**This is the SAME missing link as RC-6's root cause** — `collection_refresh()` calls
`resolve_sale_type(acct, '', bill_ref)` with the voucher type empty, because `bill_outstanding()`
returns a bill ref and no voucher. Carry the originating voucher type into the snapshot once and
both are fixed: sale type stops depending on the bill-name prefix, and non-sales references stop
counting as overdue bills. Do them together.

**BUILT 2026-08-21 — not yet live. Two pieces, and the SQL must land first.**

1. [non_bill_refs_view.sql](supabase/connectwave/non_bill_refs_view.sql) — a new **additive**
   view `public.v_non_bill_ref`, granted to `anon`. Deliberately NOT a change to
   `collection_refresh()`: that function is 999 lines, several repo files each redefine it, and the
   live version is none of them for certain — a `create or replace` from a stale copy would silently
   revert the overdue cap, the voucher-class work and the group-GUID migration. A new view touches
   nothing that already exists.
2. [liveNonBillRefs.ts](frontend/src/apps/receivables-hub/lib/liveNonBillRefs.ts) — reads the view
   and strips the matching DEBIT lines out of the live snapshot in place, adjusting `outstanding`,
   `overdue`, `overdueGross`, the aging buckets, the per-type splits, `maxOverdueDays`,
   `utilization` and `risk`. Modelled on `liveOtherPayments.ts` and wired into
   `connectwaveFetcher` immediately after it. `npm run build` passes, and the bundle for the
   emailed report picks it up automatically (it compiles `connectwaveFetcher` itself), so the
   scheduled PDF and the screen cannot disagree.

**⚠ It runs AFTER the Other Payments pass, not before.** That pass settles bills FIFO and must see
the same bill list Tally does; removing lines first would let a manual payment cascade onto a
different bill than it settles in the pipeline, and Live and pipeline mode would stop agreeing.

**Fail-soft on purpose.** If the view is absent the reader logs
`[liveNonBillRefs] DEGRADED` and changes nothing — the report reads exactly as it does today. So
shipping the frontend before the SQL is inert rather than broken. Still apply the SQL first.

**Status:**
- [x] `non_bill_refs_view.sql` applied to **ConnectWave** by Ritesh Bhai, 2026-08-21. No refresh
      needed — it is a view, not a snapshot column, so it went live on creation.
- [x] Verified through the **anon** key (not the service key): 850 rows, readable, and the guard
      query for sales-raised references returns zero.
- [ ] Deploy the frontend. Console should read `removed 14 non-bill reference(s)`, never `DEGRADED`.
- [ ] Open VAMA: it should be gone from the report entirely.

**Shape of the change, for the record** (ConnectWave, then frontend):
- `bill_outstanding()` / `bill_outstanding_by_id()` gain an `origin_voucher_type` column, taken from
  the `New Ref` allocation. Additive — existing callers select columns explicitly.
- `collection_invoice_snapshot` gains the column; `collection_refresh()` fills it.
- The report treats a bill raised by a MONEY voucher as **not overdue**: it keeps its money in
  Outstanding but moves to its own line, exactly as genuine On Account credits already do
  ([collections.ts `buildDrillRows`](frontend/src/apps/receivables-hub/lib/collections.ts)).
- ⚠ `v_voucher_type_nature` is the classifier, but **it has holes** (see the dry run). Only ever ask
  it "is this a money voucher?", never "is this a sale?" — an unknown type must fall through to
  *keep*.

**Found while dry-running this — SQL written, waiting to be applied.** *(Go-ahead from Ritesh Bhai,
2026-08-21.)* The paper sales voucher has **two spellings** in Tally, one per book, and the rule
added with the Paper bucket (id 45) matches only the first — so paper *sales* on the NOIDA book
still resolve to Other. Open bills are unaffected in either direction: `collection_refresh()` types
them with the voucher type passed empty, so only the `PAPER/` prefix rule (44) can fire there.

**⚠ The spelling recorded here was wrong, and it would have shipped a rule that never fires.** This
entry read `GST SALES- PAPER` (one space, after the dash). No such string exists in the mirror.
Read off `v_voucher_type_nature` on 2026-08-21, the three sales-side paper rows are:

| Voucher type | Reserved class | Book |
|---|---|---|
| `GST SALES-PAPER` | GST SALES | COLORIX DIGITAL PRINTING SOLUTIONS LLP |
| `GST SALES-PAPER` | Sales Accounts-HSS | ORANGE O TEC PRIVATE LIMITED (01-04-25 to 31-03-27) |
| **`GST SALES - PAPER`** | Sales | **ORANGE O TEC PRIVATE LIMITED-NOIDA (from 1-Apr-25)** |

Spaces on **both** sides of the dash. Rule 45 is `match_mode='exact'`, `case_sensitive=true`, so the
retyped version would have inserted cleanly, changed nothing, and read as fixed. The value in the
file is copied from the view, not typed. (The 49 / 473 line counts alongside the old spelling came
from the same reading and are equally unverified — `rpt_sales_register` holds 92 `GST SALES-PAPER`
lines for the current FY, and the NOIDA book's are on an older one. The counts don't change the fix.)

Same shape as spare parts, which has carried two spellings as two rows since the start (ids 24-25:
`GST SALES - SPARE PARTS` and `GST SALE- SPARE PARTS`).

**[sale_type_paper_voucher_type_variant.sql](supabase/connectwave/sale_type_paper_voucher_type_variant.sql)** — one
row, plus three verification blocks. **No `collection_refresh()`:** the snapshot stores no voucher
type, `v_sales_voucher` is a view, and `connectwaveFetcher` applies `sale_type_rule` in the browser
— so it lands on the next page load and a refresh would be 2.5 minutes for no change.

- [x] **Applied to ConnectWave by Ritesh Bhai, 2026-08-21** — landed as rule id **46**, active.
- [x] Verify 2 run through the live resolver on the **anon** key: `GST SALES-PAPER` → `paper`,
      `GST SALES - PAPER` → `paper`, and the two controls hold — `GST PURCHASE - PAPER` → `other`,
      `DELIVERY CHALLAN-PAPER` → `other`. A purchase and a challan are not sales.
- [x] Verify 3: open bills unmoved — `PAPER/126/25-26` and `PAPER/26-27/12` → `paper`,
      `OTPL/001` → `other`. Confirms the open-bill path never saw this rule, as intended.
- [ ] Open a NOIDA-book customer and confirm paper sales leave the Other band. Data is right; this
      is only confirming the screen. No `collection_refresh()` — the rule applies at read time.

**Second, cheaper guard, worth having either way:** a negative Received (`pending > amount`) is
impossible for a genuine bill. Catches all 7 rows today regardless of voucher type, and needs no
schema change.

**Decided 2026-08-21 (Ritesh Bhai) — one rule, and it settles both questions:**

> **If there is an outstanding BILL, show it. If there is no bill, show nothing.**
> Never an outstanding figure with no bill behind it — that mismatch is what made this look broken.

So a removed reference leaves **Overdue AND Outstanding**, not just Overdue. VAMA has no invoice at
all — its ledger holds two bank payments and nothing else, opening balance ₹0 — so VAMA drops off
the report entirely rather than showing ₹17 L against zero bills.

⚠ **Accept the consequence knowingly:** the ₹17 L Orange paid VAMA then appears **nowhere** on this
report. It is real money out of the door and Tally still carries it at ₹17,00,000 Dr. If it is ever
to be chased from here it needs its own place to live — that is a separate ask, not this one.

---

### RC-4 · Remove the legacy receivables connection — ConnectWave only  🟢  `[ ]`
*Raised 2026-08-20 · Found while building RC-2 · **Decided 2026-08-20:** rip it out. Low priority —
nothing is waiting on it, so it can be picked up alongside whatever else is running.*

The hub's **Live (Tally)** switch has two positions. Live — the default — reads the ConnectWave
mirror and works. Turning it **off** selects the legacy pipeline project `lkwtvcpeamkzzqkfnkuc`, and
**that project no longer exists**: its hostname does not resolve at all. The external Python pipeline
that fed it (the separate "Orange Receivables Hub" repo) is out of the picture too.

**The call: the legacy source goes away entirely.** Not "fail with a readable message" — deleted.
ConnectWave is the only receivables backend. The dead path is not merely unused, it actively
**conflicts**, and that is the reason to spend the time rather than leave it dormant.

**Where it already costs us — three kinds of conflict, all real today:**

- **A silent-empty bug it already caused.** In
  [CustomerDetail.tsx:846](frontend/src/apps/receivables-hub/pages/CustomerDetail.tsx#L846) a local
  named `source` once *shadowed* the active source, so the Live path queried the legacy project with
  ConnectWave ledger GUIDs, matched nothing, and returned an empty set **with no error**. It is fixed,
  but the shape of the mistake only exists because two backends are reachable from one screen.
- **Every screen carries a fork.** `source === "connectwave" ? … : …` appears ~20 times across
  [useAppData.ts](frontend/src/apps/receivables-hub/lib/useAppData.ts), CustomerDetail,
  CustomerRiskRegister, LedgerVoucherList and LedgerVoucherStatement — separate cache keys, a Red Mark
  fallback, a whole second alerts story. Each fork is a place the two sources can disagree.
- **The Collections report has to actively fence it out.** `build.mjs` installs an esbuild resolve
  hook whose only job is to make sure nothing in the graph imports `receivablesSupabase`
  ([build.mjs:86](supabase/collectionsreport/build.mjs#L86)). That guard exists solely because the
  dead module is still importable.

**The removal surface** (all of it, so nothing is left half-connected):

| What | Where |
|---|---|
| The toggle + its permission | [liveMode.tsx](frontend/src/apps/receivables-hub/lib/liveMode.tsx), the topbar switch at [UserLayout.tsx:187](frontend/src/apps/receivables-hub/layouts/UserLayout.tsx#L187) |
| `profiles.receivables_allow_pipeline` | the column, `Profile.receivablesAllowPipeline`, its row in [MenuPermissions.tsx](frontend/src/apps/receivables-hub/components/MenuPermissions.tsx), and every seed in [data.ts](frontend/src/core/platform/data.ts) |
| The dead fetchers | `supabaseFetcher.ts`, `receivablesSupabase.ts`, `loadFromSupabase` in useAppData |
| The env vars | `VITE_RECEIVABLES_SUPABASE_URL` / `_ANON_KEY` / `VITE_DATA_SOURCE`, in Vercel and in `.env.local` |
| The forks | the ~20 `source === "connectwave"` branches collapse to their Live arm |
| `sourceContext.tsx` | with one source left, `ReceivablesSource` is a single value — keep `useHubBase()`, drop the union |
| The esbuild fence | the `receivablesSupabase` resolve hook in `build.mjs` can go once the module does |
| The stored preference | `receivables.source.v2` in localStorage — a browser holding `"pipeline"` must land on Live, not on nothing |

**⚠ Do NOT drop the column in the same breath.** The repo rule is additive-only on Supabase: stop
*reading* `receivables_allow_pipeline`, leave the column in place.

**Nobody loses anything when this ships — checked against the live database 2026-08-20.**
`receivables_allow_pipeline` is set on **0 of 60 profiles**, so no non-admin can reach the legacy
view at all. The only people who can still flip the switch are the **5 admins**, who get it from
`isAdmin` rather than the column. So there is no user to warn and no migration path to plan: the
removal is pure deletion.

**Open, minor:**
- [ ] Does the static-JSON (`local`) source go the same way? "ConnectWave only" reads as yes, and
      `loadFromJson` plus the `public/` fixtures would go with it — but it is also the only offline
      dev path, so worth a moment's thought rather than deleting on momentum.
- [ ] Anything in the legacy project worth exporting before the Supabase account is tidied up? (The
      project is unreachable, so the honest answer may be that this question is already closed.)
- [ ] Update [CLAUDE.md](CLAUDE.md) when it lands — the "two separate Supabase projects" section and
      the receivables-hub data-flow notes both still describe the legacy path as live.

---

### RC-5 · Who receives a salesperson's copy  `[x]` *(decision — no build)*
*Raised 2026-08-20 · **Decided 2026-08-21 (Ritesh Bhai)** · no longer blocks **RC-2***

**The decision: everyone who can see a salesperson's book receives that salesperson's report.**
Option 1 of the three below — and it is what the code already does, so nothing was built and
nothing changed.

**Why it was a question.** `profiles.receivables_salespersons` is a **visibility scope**, not an
identity. It answers *"whose figures may this person see"*, not *"who is this salesperson"*, so a
name does not resolve to one inbox. `UMESH JI` is carried by six people: Umesh, his HOD Nakul, and
four in credit control. Five accounts carry more than one name:

| Account | Email | Names carried |
|---|---|---|
| Bushra | `PC@orangeotec.com` | **13** |
| Jayshree Patil | `collection@orangeotec.com` | **13** |
| Ritesh Tulsyan | `ritesh@orangeotec.com` | **13** |
| Nitesh Prajapati | `nitesh@orangeotec.com` | 8 |
| Nakuleshwar Sharma | `nakul@orangeotec.com` | 5 |

**The volume this accepts, stated plainly:** with all 13 names scheduled, those three 13-name
accounts each receive **thirteen separate emails per send**. **Accepted 2026-08-21: the report goes
out weekly, on Saturday, so thirteen mails a week is fine.** It would be worth revisiting only if
the schedule ever moves to daily.

**⚠ It follows that arming is now a one-way door on volume.** Nothing else gates it. If the day or
frequency changes later, this decision was made against *Saturday*, not against the schedule in
general.

**The two options NOT taken**, recorded so the same ground is not walked twice:
2. Send to the rep only, and give oversight the whole-book copy instead.
3. Choose the address per name, via a chosen **user id** on `report_email_recipients`.

Option 2 turned out to *require* option 3: nothing in the data says who "the rep" is. A HOD's tag
list is his own name plus his team's — Nakul carries himself, Umesh, Dhananjay, Purav and Abhishek;
Manmohan carries himself and Khurshid — so "carries exactly one tag" identifies a plain salesperson
but not a manager. Option 3 was built on 2026-08-21 (an `owner_user_id` column, the resolver and a
picker) and **reverted the same day, unused**, when the answer came back as option 1. The database
was returned to its prior state — column, constraint and index dropped, both functions restored.
Nothing shipped and the frontend was never touched.

**Three tag problems found while checking this.** Independent of the decision above, fixable in
Admin → Users, and none of them blocks anything. The live data holds 13 salesperson names
(`OTHERS` 703 ledgers, `MANMOHAN JI` 300, `NAKUL JI` 292, `UMESH JI` 132, `KHURSHID JI` 116,
`KARAN SIR` 70, `AAYUSH SIR` 62, `DHANANJAY` 42, `PURAV SHAH` 37, `SUHEL` 27, `RELATED PARTY` 24,
`ABHISHEK` 7, `HARI OM` 2):

- **`MAYANK`** is tagged on all three 13-name accounts and **no ledger carries it**. Dead.
- **`Others`** (lower case) sits on Jayshree and Ritesh *alongside* the real `OTHERS`. Dead, and it
  is why their count reads 13 when only 11 names are live — they are also missing `RELATED PARTY`,
  which Bushra has.
- **`HARI OM`** exists in the data but **nobody is tagged with it**. It is HARIOMSHARAN DAVE
  (`hariomdave@orangeotec.com`), who has an account carrying no tags. Scheduling the name as it
  stands would report "nobody to send to". The same is true of **`AAYUSH SIR`** (Aayush Rathi) and
  **`KARAN SIR`** (Karan Toshniwal) — both have accounts, neither is tagged, so those two reports
  would reach only credit control.

- [ ] Delete `MAYANK` and the lower-case `Others`; add `RELATED PARTY` to Jayshree and Ritesh.
- [ ] Decide whether Aayush, Karan and Hariom should be tagged with their own names before the
      first send, or whether credit control receiving those three is the intent.

---

### RC-3 · Planned / Gap to plan reads wrong — weekly plan against a monthly report  `[!]`
*Raised 2026-08-20 · Feedback from Ritesh Bhai · **Blocked:** needs a decision from Ritesh Bhai ·
**Pulled off the weekly client report 2026-08-22** — it stays open here, but nobody is being asked
for the decision any more, so it will not move until someone puts it back in front of him.*

On the Salesperson Collection Report, the **Planned (Aug-26)** and **Gap to plan** columns don't
show properly. The team **plans weekly**, but the report — sales, received, outstanding, everything
— is **monthly**. So one weekly-shaped number sits in a row of monthly ones and the gap misleads.

Three ways out, and they are mutually exclusive:

1. **A period tab at the top** — view the whole report weekly or monthly. Note this means *all* the
   data moves to a weekly basis, not just the plan column.
2. **Drop Gap to plan** (and Planned with it) rather than leave one weekly figure among monthly
   ones causing confusion.
3. **Enter the plan monthly**, so it matches everything else on the report.

**Notes:** the stored plan is **already monthly** — one row per `(month, entity)`, keyed
`month:type:name`, with the modal literally setting "the planned collection for ONE customer in ONE
month" ([collectionPlanTypes.ts](frontend/src/apps/receivables-hub/lib/collectionPlanTypes.ts),
[CollectionPlanModal.tsx](frontend/src/apps/receivables-hub/components/CollectionPlanModal.tsx)).
So option 3 is the smallest change by far — it is a data-entry habit, not a schema change. Option 1
is the largest: it needs a week dimension through the whole report, and `month` is a *label*
("MMM-YY") threaded through the plan store, the trend and `lib/months.ts`. `gap` is simply
planned − received, computed in the report and not a stored field
([SalespersonCollectionReport.tsx:107](frontend/src/apps/receivables-hub/pages/SalespersonCollectionReport.tsx#L107)).

**To discuss with Ritesh Bhai:**
- [ ] Weekly or monthly — which is the real planning rhythm the report should follow?
- [ ] If weekly: is the team willing to read *every* column weekly (sales, received, outstanding,
      collection %), or only the plan?
- [ ] If monthly: can the salespeople enter a monthly plan figure instead, or do they need to keep
      planning weekly and have the system roll the weeks up into a month?
- [ ] If neither settles: is dropping Planned + Gap to plan acceptable in the meantime?
- [ ] Does the same answer apply to the emailed PDF/workbook, or only the on-screen report?


---

## Fixes

Bugs found and repaired, **newest first**. This is not the same thing as [Done](#done): Done holds
tasks somebody *asked for*, this holds faults somebody *hit*. A fix has no open entry above — it was
never on the list, because nobody planned it.

Three rules:

- **Stamp the date and time it went live**, in IST, and name the commit. Same rule as Done.
- **Lead with what the person saw**, not with the cause. "The item was missing from the dropdown" is
  what will be searched for a year from now; the tied-timestamp explanation is the second line.
- **Say what else was at risk.** A fault is rarely alone — if the same mistake sits in other code,
  write down where, so the next reader does not have to find it twice.

### FIX-7 · Order to Dispatch sat on "Loading…" for twenty seconds  `[x]`
*Order to Dispatch · Found 2026-09-05, raised by Ritesh Bhai — "when any user is loading an order to
dispatch, it is just showing loading, and it's taking quite some time" · **Fixed the same day**,
migration `20261111120000_od13_p3b_orders_policy_costs_once_again`, applied 05-09-2026 11:48 IST*

**What was seen.** Every screen in the module — the dashboard, New Sales Order, the queues — showed
"Loading…" for twenty seconds or more before any data appeared. It affected every user. Nothing was
wrong with the data; it always arrived eventually.

**One RLS policy was being evaluated once per row instead of once per query.**
`20261110110000_od13_p2_raise_and_read.sql` (OD-13 P2, commit `cd50847`, 04-09) rewrote
`fms_dispatch_orders_select` to add the customer-login arm. It added that arm correctly — the two
caller-side lookups inside it *are* wrapped, and its header explains at length why they must be. What
it did not notice is that it retyped **the four arms above it** from the text `pg_policies` prints
back, and **`pg_policies` prints the `(select …)` wrapping away**:

| `20260925130000` (fast) | `20261110110000` (what shipped) |
|---|---|
| `(select auth.uid())` | `auth.uid()` |
| `(select is_admin((select …)))` | `is_admin(auth.uid())` |
| `(select fms_dispatch_is_coordinator(…))` | `fms_dispatch_is_coordinator(auth.uid())` |
| `(select module_is_viewer(…))` | `module_is_viewer(auth.uid(), 'order-to-dispatch')` |

Unwrapped, each is a STABLE SECURITY DEFINER call in a per-row `Filter` rather than an InitPlan.
`EXPLAIN` on live data showed `loops=1128` — one scan of `fms_dispatch_step_owners` per order.

**It was not one table.** `order_items`, `rounds`, `round_items` and `activity` each read
`exists (select 1 from fms_dispatch_orders o where o.id = …)`, so all four re-ran the whole predicate
per row (`round_items` twice, through `rounds`). Measured as an ordinary step owner:

| | orders | order_items | rounds | round_items |
|---|---|---|---|---|
| Before the regression | 134 ms | 142 ms | — | 136 ms |
| Broken | **1,397 ms** | **1,189 ms** | **1,181 ms** | **1,207 ms** |
| After the fix | 19 ms | 14 ms | 9 ms | 16 ms |

Every table the module reads that does *not* touch this policy answered in 1–12 ms throughout, which
is why the `is_staff` sweep from the same day was not the cause. `pg_stat_statements` had those four
tables at **89,517 s — 49% of all database execution time on the project**, worst single call 7,964 ms.
End to end, signed in as Jyoti over the real API: **753 ms for all 14 requests**, in parallel.

**The fix** restores the wrapping and hoists the one arm that could not simply be re-wrapped — the
step-owner `EXISTS` is correlated on `location_id`, so it splits into `fms_dispatch_sees_every_order()`
(the location-free half, row-independent) and `fms_dispatch_my_step_locations()` (an InitPlan array
tested with `= any(…)`). Same rule, same rows: asserted over every `(profile, order)` pair, and the
per-identity visible-row counts are unchanged for all 15 affected users (1,129 / 937 / 192 / 2 / 0).

**What else was at risk.**

- **`fms_dispatch_can_see_order()` was NOT touched, and that is deliberate.** It judges one row at a
  time and is what actually governs attachments (`fms_dispatch_can_see_doc` → the `fms-dispatch-docs`
  storage read policy) and `fms_dispatch_announce`'s recipients. Because this change moves no row, the
  two spellings stay the same rule. **Any future change here that *does* move a row must move the
  function in the same migration** — `20260925130000:39-41` says so.
- **The fix nearly caused its own outage.** As first written, the 7-second equivalence assertion ran
  *after* `alter policy`, which holds ACCESS EXCLUSIVE until COMMIT. Moving it above the ALTER cut the
  lock window from ~7 s to **12 ms**. `set local lock_timeout = '5s'` was added too — the server
  default is 0, i.e. wait forever.
- **The rollback would have thrown when it was needed.** Its guard used `pg_get_functiondef()`, which
  raises `42809 "array_agg" is an aggregate function` the moment the planner reaches a non-plain
  function — and a `nspname` qual is **not** a barrier, since Postgres promises no evaluation order
  between a qual and a function call in the same scan. Reproduced twice. Now reads `pg_proc.prosrc`,
  a plain column that cannot throw.
- **`fms_dispatch_step_assignees_write` is scoped to role `{public}` with an unwrapped
  `is_admin(auth.uid())`.** Not a hole (the predicate still requires admin) and free today (0 rows),
  but it sits outside the six-table guard and becomes a per-row cost if that table ever fills.
- **`KRITIKA SHARMA` holds `edit` on the module and can see 0 orders**, because she owns no step. That
  follows the documented ownership rule (`20260925130000` — a *view* grant reads the whole module, an
  editor sees what their ownership says), but it may not be what was intended operationally. Worth
  putting to Ritesh Bhai.
- **The general lesson, now in the migration header:** never rewrite a policy from `pg_policies` or the
  dashboard — always from the previous migration's source. And measure a policy change as a
  **non-admin**: an admin short-circuits on the first `is_admin` arm, so every arm behind it stays free
  and the regression is invisible.

### FIX-6 · The button said "Close" and cancelled the vacancy  `[x]`
*New Recruitment · Found 2026-09-03, raised by Ritesh Bhai asking what the difference between hold,
close, open and cancel actually is · **Fixed the same day**, with **NR-6***

**What was seen.** The Positions grid offers `Pipeline · Hold · Close`. Filter the State column to
Cancelled and five positions come back. Nobody remembers cancelling five positions.

**They pressed "Close".** [PositionsList.tsx:331](frontend/src/apps/hr-recruitment/pages/positions/PositionsList.tsx#L331)
rendered the label `Close` but passed `mode: "cancel"` → `fms_hr_cancel_requisition` →
`status = 'cancelled'`. The same action on the requisition page was, correctly, labelled **Cancel**.

**And the label named a state no human can reach.** `closed` is written *only* by
`fms_hr_sync_requisition_fill` when the last seat is filled — a success, which un-sets itself if a hire
falls through. There is no RPC anywhere that lets a person close a requisition. Live counts at the time
of the fix: **23 requisitions · 5 cancelled · 0 ever closed · 0 ever held.** Every cancellation in the
system's history came through a button that said Close.

The difference the three words actually carry:

| | Set by | Reversible | Means |
|---|---|---|---|
| **On hold** | a person, with a reason | **yes** — Reopen | paused where it stands; resumes at the same step |
| **Cancelled** | a person, with a reason | **no** | abandoned; it will not be filled |
| **Closed** | the **system**, automatically | yes, automatically | every seat filled — a success |

**The fix.** `Close` → `Cancel`.

🔴 **And a second one the rename created.** The confirm dialog is titled *"Cancel this requisition"* and
its dismiss button was itself labelled **`Cancel`**, beside `Confirm`. Once the grid button also said
Cancel, the button a user reaches for to go through with it is the one that backs out. Relabelled
**"Go back"** ([MrfModals.tsx:346](frontend/src/apps/hr-recruitment/components/MrfModals.tsx#L346)).

**What else was at risk.**

- **The same page printed raw enum values.** `PositionPipeline` read *"This position is cancelled"* only
  because that token happens to be a word; `sent_back` would have shown as `sent_back`. Same leak in
  `reqTerminalBar`, which surfaces as a lock reason on the Completed tab. Both now use
  `REQ_STATUS_LABEL`.
- **`on_hold` and `cancelled` share an identical grey** in `REQ_STATUS_CLASS`, and the Positions grid
  greyed `closed` with them — so a vacancy that filled every seat looked exactly like an abandoned one.
  Closed now keeps its green there. This is most of why the three words were confusable in the first
  place.
- **The reason was never shown**, which is what let a mislabelled button go unnoticed for months and is
  fixed under **NR-6**.

### FIX-5 · 🔴 The same candidate can be added to a vacancy twice, and the pipeline counts them twice  `[x]`
*New Recruitment · Found 2026-09-03, raised by Ritesh Bhai from the Executive Assistant board ·
**Guard built and applied 2026-09-05**, migration live on `icutjkrqkbzwvmnfbzpr`, frontend green,
driven end-to-end in the browser on MRF-2627-0019 · **The 7 existing duplicate rows are still
untouched** — that cleanup remains blocked on Saloni's answer (see below)*

**What was seen.** The Executive Assistant position reads **"4 · 2 in play"** on the Positions list.
Only **two people** have ever applied for it, and both were rejected.

**The count is right. The data is wrong.** There really are four candidate rows, because both people
were entered **twice**:

| Candidate no | Name | Stage | Added (IST) | CV file |
|---|---|---|---|---|
| CAN-2627-0065 | Purvi Upadhyay | disqualified | 31-Aug 11:45 | `Purvi Upadhyay - EA.pdf` |
| CAN-2627-0066 | Manali Desai | disqualified | 31-Aug 11:45 | `Manali Desai_CV.pdf` |
| CAN-2627-0098 | Purvi Upadhyay   EA | **Shortlisted by HR** | **02-Sep 11:06** | `Purvi Upadhyay - EA.pdf` |
| CAN-2627-0097 | Manali Desai | **Shortlisted by HR** | **02-Sep 11:06** | `Manali Desai_CV.pdf` |

Both were disqualified on 31-Aug with the same note — *"As discussed out of budget and not so
active."* The **same two CVs were uploaded again on 02-Sep at 11:06** by Saloni Rathod, creating two
fresh records that started over at Shortlisted by HR. Those two are the "2 in play".

Same people, provably: identical CV filenames on both pairs, and Manali's **email and phone match
exactly** across her two rows. (The newer Purvi row is named `Purvi Upadhyay   EA` because the parser
took the name from the filename.)

#### Why the duplicate warning did not stop it — it half-fired, and half could not

The module *does* warn. `duplicatesOf` in [store.tsx:1205](frontend/src/apps/hr-recruitment/store.tsx#L1205)
matches **on phone or email only**, and `AddCandidatesModal` shows the result as an advisory line:

- **Manali Desai** has both an email and a phone, so the warning **did** appear. It is a warning and
  not a block, so it can be clicked straight past.
- **Purvi Upadhyay** has **no email and no phone on either row** — her CV never yielded contact
  details — so `duplicatesOf` returns `[]` on its first line (`if (!ph && !em) return []`).
  **No warning was possible.** The one signal that would have caught her — the identical CV filename
  — is not compared at all.

⚠ **And nothing stops it server-side.** `fms_hr_add_candidates` has **no duplicate check of any
kind**, and `fms_hr_candidates` carries **no unique constraint** on (requisition, email) or
(requisition, phone) — the `email` and `phone` indexes exist but are **non-unique**, built for
lookup. The RPC inserts whatever it is handed.

#### It is not only the EA board — 3 positions, 7 extra rows

Re-measured 2026-09-05. **Two more pairs than the 03-Sep count**, one of them added *after* this
entry was first written:

| Position | Person | Rows | What the old check could see |
|---|---|---|---|
| MRF-2627-0018 · Executive Assistant | Purvi Upadhyay | ×2 | **nothing** |
| MRF-2627-0018 · Executive Assistant | Manali Desai | ×2 | email + phone |
| MRF-2627-0006 · Marketing Executive | Harsha Jain | ×2 | email + phone |
| **MRF-2627-0015 · Finance manager** | **Kajal Bhalerao** | **×3** | email + phone |
| MRF-2627-0015 · Finance manager | Sunil Sharma | ×2 | **nothing** |
| **MRF-2627-0015 · Finance manager** | **CA Vandit Mehta** | **×2** | **nothing** |

🔴 **Two of these can cause real harm, not one.** Kajal Bhalerao exists three times on Finance
manager at once (CAN-2627-0051 at Interview R3, -0054 at Telephonic, -0057 disqualified). And
**CA Vandit Mehta — added twice on 02-Sep, 16:01 and 18:08 — has BOTH rows sitting at Interview
Round 3 simultaneously** (CAN-2627-0118 and -0119). Either way two people can book the same person
for two rounds without seeing each other.

⚠ **Sunil Sharma and CA Vandit Mehta are caught by neither phone nor email nor filename-as-written.**
They are why the fix needed five signals rather than the two the 03-Sep write-up proposed.

#### What this quietly distorts

Every count that walks candidate rows is affected, because none of them can know two rows are one
person: the Positions list's candidate column and "in play", `PipelineSummary`, the Candidates list
KPIs, and — worst — the **pipeline funnel and platform effectiveness** reports on the dashboard,
where one person counted twice at CV stage and once at interview reads as a conversion rate that
never happened.

#### What was built  `[x]` 2026-09-05

Migration `20260905120000_fix5_candidate_duplicate_guard.sql` (+ its rollback), one new client
module `lib/duplicates.ts`, and the two screens that read it.

- [x] **Five signals, not two.** `duplicatesOf` now compares the **file's SHA-256**, email, phone,
      the **normalised CV filename** and the **normalised name**. Measured against the live rows:
      email/phone alone catches 3 of the 6 groups, filename 4, name 4 — **only all five together
      catch all six.** `lib/duplicates.ts` holds the normalisers and `fms_hr_norm_*` mirrors them.
- [x] **A CV fingerprint** — `fms_hr_candidates.resume_sha256`, computed in the browser with
      `crypto.subtle`, no library. Every case that slipped through undetected was literally the same
      PDF re-uploaded; this is the one signal that is proof rather than inference. Existing rows stay
      null on purpose and fall back to the other four.
- [x] **Two tiers.** Same file / email / phone on the SAME vacancy → **blocked**, with an
      "Add anyway" that demands a written reason and records a `duplicate_override` activity row.
      Same filename or name → a tick. A different vacancy → context only, never blocked.
- [x] **Guarded server-side**, in `fms_hr_add_candidates`. ⚠ The **signature is unchanged** and the
      ack/hash ride inside the jsonb element — a defaulted third argument would have created a
      Postgres *overload*, leaving the old two-arg function callable and the guard bypassable by the
      very stale tab it exists to stop.
- [x] **🔴 The other way in, closed too.** `fms_hr_update_candidate` sets email and phone
      unconditionally, so editing one candidate's details onto another's re-creates the duplicate
      through the back door. It has no callers *today* — but **NR-5 plans to wire it to an Edit
      control**, which would have reopened this the moment it shipped. Same guard, added now.
- [x] **The in-batch case**, found only by driving the real browser: two identical CVs dropped in
      *one* go are invisible to a store-based check, because neither row exists yet. The server does
      catch it — but only after every file in the batch is already in storage, which nothing in this
      module can remove. Now caught before the upload loop.
- [x] **The upload ordering.** Duplicates are evaluated **before** `uploadResume`, not inside the
      loop. Verified: every blocked attempt left the bucket at exactly 133 objects, 0 orphans.
- [x] **The name mangling at source.** `AddCandidatesModal:131` turned `"Purvi Upadhyay - EA.pdf"`
      into the name `Purvi Upadhyay   EA` — verbatim what CAN-2627-0098 is called — because the
      hyphen became a third space. Three of the four mangled names live have this shape, and it is
      what stopped the name matching its own twin. One line.
- [x] **No unique constraint**, deliberately — `(requisition_id, lower(email))` would refuse a
      legitimate re-application after a rejection, which is exactly what may have happened here. The
      RPC guard plus a recorded override is the right shape.

#### 🔴 And the thing that removes the CAUSE — "Reconsider this person"

In all three real cases HR's intent was *look at this person again*; a second row was never what
they wanted. `fms_hr_reconsider_candidate` returns a dropped candidate to the stage they had
reached, keeps every interview, and writes the original rejection reason into the activity trail
before clearing it. Surfaced on the candidate page and pointed at from the duplicate card.

⚠ **NOT wired to `fms_hr_move_candidate`, and that matters.** Dragging a card back out of
Disqualified already worked — and its backward branch runs
`delete from fms_hr_interviews where round > greatest(-1, v_to_rank - 5)`, so reopening someone
dropped at Round 3 would have **destroyed all three of their interview records** on the way.

#### 🔴 Follow-up, found by testing as a REAL non-admin HR user  `[x]` 2026-09-05

Migration `20260905130000_fix5_reconsider_authz_mirrors_disqualify.sql`. The whole feature above was
verified as an **admin**, which hid two faults with one root cause — a **flat** authorisation check
on Reconsider. Re-tested signed in as **Saloni Rathod** (`recruitment@orangeotec.com`, role
`employee`, natural owner of `resume_upload` + `hr_shortlist`):

- [x] **🔴 The button was INVISIBLE to the one person it was built for.** A disqualified card has no
      pending step (`STAGE_PENDING_STEP.disqualified = null`), so `canActOnCandidate` fell through to
      `return isAdmin || isProcessCoordinator` — Saloni saw *"Only HR or the decision-maker can bring
      a dropped candidate back."* She is the person whose CV re-uploads created the duplicate rows
      this fix exists to prevent, and the alternative to re-uploading was hidden from her.
- [x] **The server was too permissive in the opposite direction.** `final_decision OR hr_shortlist`
      let the HR owner resurrect someone a HOD had dropped at **Round 2, Round 3 or Final decision** —
      restoring them into a stage HR could never have dropped them from.
- [x] **One rule fixes both: authorise by DESTINATION.** Whoever could have *disqualified* them from
      stage X may bring them back *to* X — the same branch `fms_hr_move_candidate` already uses,
      evaluated against the restored stage. New `reconsiderTargetStage()` in `lib/queues.ts` mirrors
      the SQL `CASE`; new `canReconsiderCandidate()` in `store.tsx` replaces `canActOnCandidate` on
      this control only. Proved both ways in a rolled-back transaction: early stage **allowed**,
      Round 3 **refused** — *"Not authorized to bring this candidate back to Interview R3 — Director"*.

Also confirmed under her (non-admin) JWT: the blocked/override/clean rows behave as designed, the
bucket stayed at 133 while rows were blocked, a direct RPC call without the ack is refused, a plain
payload still works, and `fms_hr_add_candidates` has exactly **one** overload. All five test rows,
both storage objects and every activity row were removed afterwards; the CAN counter was rolled back
119 → 119 and every baseline count matches.

✅ **No bells were sent this run** — `announce` for `cvs_added` targets the `hr_shortlist` owner, who
was also the actor, so she was excluded from her own notification. The earlier admin run wrote 3 to
her precisely because the actor was somebody else.

⚠ **A second trap, caught before it shipped:** `interviewN_at` is stamped when a round is *held*,
not when the card is moved into it. Deriving the return stage from timestamps alone sent a candidate
dropped at "R2 booked, not yet held" all the way back to the HR shortlist. It now reads the
interview rows too.

⚠ **It cannot help the EA board yet.** MRF-2627-0018 is `cancelled` (one of FIX-6's five), and both
add and reconsider refuse a cancelled requisition.

#### How it was proved

Applied to the live project, then driven through the real UI on **MRF-2627-0019 (ZZ TEST)** with
generated CVs: identical file blocked · same email blocked · `9825000002` matched
`+91 98250 00002` · no-contact CV caught on filename alone (**the Purvi case**) · a clean CV saved
with no friction · override recorded with its reason · reconsider returned a candidate to Telephonic
with the interview intact · a direct RPC call from the console refused. Every guard branch also
asserted in rolled-back transactions, and **the rollback was rehearsed for real** — applied, rolled
back, plain two-key payload confirmed still working, re-applied.

**All 5 test rows and their 5 storage objects were removed afterwards**, the CAN-2627 counter rolled
back 124 → 119, and every table returned to its pre-test count (119 / 24 / 472 / 282 / 111 / 133).
The client's ZZ TEST position and its 3 candidates were left exactly as they were.

⚠ Testing through the UI put **3 `cvs_added` bells in Saloni Rathod's feed**; those were deleted
with the rest. Worth knowing before anyone browser-tests this module again — the 01-Sep seed avoided
it by going through SQL, which UI testing cannot.

#### The cleanup — 7 extra rows, and it is STILL BLOCKED on a question

**Nothing has been deleted or changed.** Which row is the truth depends on intent, and only HR knows:

- **If the 02-Sep re-uploads were a mistake** — the two new EA rows should go, leaving 2 candidates,
  both disqualified, and the board reads "2 · 0 in play" as expected.
- **If they were deliberate** (reconsidering both after the "out of budget" call) — the new rows are
  correct and the *old* disqualified rows are the noise. The EA position genuinely has 2 people back
  in play, and the board is already right.

⚠ Note there is currently **no way to delete a candidate row at all** — see **NR-5**. Whichever
answer comes back, the cleanup needs either that capability or a one-off SQL statement.

**Waiting on:** Saloni Rathod — were the 02-Sep EA re-uploads deliberate? Then the same question for
Harsha Jain (Marketing Executive), Kajal Bhalerao and Sunil Sharma (Finance manager) — and
**CA Vandit Mehta, who was not on the original list and whose two rows are both at Interview R3**.
Ask about him first; he is the one that can waste a director's time.

⚠ **The guard does not touch these seven.** It stops the next one being created; it cannot decide
which of two existing rows is the real person. That is still a judgement only HR can make.

### FIX-4 · A requisition could not be cancelled once sourcing had begun  `[x]`
*Purchase RM Domestic · RM Import · **Fixed 2026-08-25, 13:35 IST** · Live on `master` at `3c71504`*

**What was seen:** PR-2627-0034 — ₹19,82,400, one line approved and sitting in the PO pool, no PO
raised — needed to be cancelled, and there was no button anywhere to do it. Not on the requisition,
not on the line, not in the PO workbench. The server even told the user to *"Cancel the individual
lines instead"*, pointing at a control that no longer existed.

**What was wrong:** `d6c9f65` (20-Jul-2026) removed the per-line **Actions** column from Request
Detail in both purchase apps, reasoning that *"whole-requisition actions already live in the
header"*. That was true of Source and Approve, which had moved there in `03e2389` — and false of
**Cancel**, which had never been in the header. The header's *Cancel request* is gated pre-sourcing
only, so deleting the column left no cancel path at all from the first sourcing action onwards.

**Why it went unnoticed for five weeks:** nothing broke. The commit removed the *trigger* and left
everything it fed — the state, the handler, the whole "Cancel line" modal, `s.cancelLine`, both
RPCs. `setCancelling` was only ever called with `null`, which is legal TypeScript, and
`noUnusedLocals` is `false` in this repo, so the build stayed green. There is no test runner. The
screen looked complete because the dialog was still there; only the way in was gone. It surfaced
the day someone actually needed to cancel something.

**The fix:** a **Cancel line(s)** header button opening a picker — tick lines, one shared reason —
matching how Source / Approve / Generate PO already work, rather than reinstating the column that
was deliberately removed. It is offered for every status the RPC accepts (`sourcing`, `approval`,
`on_hold`, `approved_pending_po`), which is wider than the control it replaces. Permission is
unchanged: admin, or the `po` / `sourcing` step owner. Both `cancel_line` RPCs now also stamp
`edited_at`/`edited_by` in-transaction and roll the request header to `cancelled` once no live line
remains — a requisition emptied one line at a time used to sit at `open` forever, so the red "This
request was cancelled" banner never appeared and the Dashboard counted it as open indefinitely.

**What else was at risk:** the same commit hit **both** apps, and in Import it took a second path
with it — the per-line **Source / Re-source**, whose `SourcingModal` takes a line. Its `sourcing`
state sat there for five weeks, likewise only ever set to `null`. The dead code is now removed;
whether the stage is retired or rebuilt is **FIX-4a** below. The general lesson is the one worth
keeping: **a cleanup that removes a container must account for each thing inside it, one by one.**
Removing the container and orphaning its contents compiles, ships, and looks fine.

**Still open — to settle with whoever owns Import:**
- [ ] **FIX-4a ·** Retire Import's sourcing stage (drop `SourcingModal` + `SourcingQueue`), or
      rebuild it request-scoped the way RM Domestic was? Import lines are born at `approval`, Import
      approval carries no rate or value, and **no `sourcing` step owner is configured**, so the
      stage feeds nothing Import currently routes on — which argues for retiring it. Rebuilding
      needs a new request-scoped RPC.
- [ ] **Production Entry's step "status" field is UNREACHABLE.** `StepFieldKind` in
      [stepConfig.ts](frontend/src/apps/production-entry/lib/stepConfig.ts) declares `"status"`, and
      [StepModal.tsx](frontend/src/apps/production-entry/components/StepModal.tsx) renders a
      `STATUS_OPTIONS` dropdown (Completed / Pending / Not Applicable) for it — but **no field
      anywhere declares `kind: "status"`**, so the branch has never run. Found 29-Aug-2026 while
      sweeping short dropdowns for the buttons change; it was deliberately NOT converted, because
      converting a control nobody can reach only hides the question. **Decide: wire it up to the
      steps that were meant to have it, or delete the kind, the branch and `STATUS_OPTIONS`
      together.** Classic FIX-4 shape — everything behind the trigger is intact and the trigger was
      never built. `noUnusedLocals` is false, so it fails nothing.
- [ ] `importWrites.ts`'s `announce` doc still says recipients equal to the actor are skipped
      server-side; untrue since `20260726150000`. The RM Domestic twin was corrected in `3c71504`;
      Import's was left out of that commit because the file also held an unrelated in-flight change
      (`fetchFxRate` moving to `shared/lib/fx.ts`) whose new file was not yet in git. Fix it once
      that lands.

---

### FIX-3 · An interview nobody was assigned showed as "Booked"  `[x]`
*New Recruitment · Found 2026-08-25 while auditing **NR-1** · **Fixed 2026-08-26, 08:17 IST** ·
Live on `master` at `adea51c`, shipped with **NR-1***

**What was seen:** in the Interviews queue, rounds with no interviewer and no date read **Booked**
and offered **Record result**. There was no way to book them from that screen at all — the **Book
it** button never appeared for them.

**Root cause:** passing a round auto-advances the candidate and inserts a *stub* interview row for
the next round — no panel, no date, `status = 'scheduled'`
([20260816120100:542-544](supabase/migrations/20260816120100_add_fms_hr_hired_stage.sql#L542-L544)).
The board tests for a real booking — `!iv?.interviewerIds.length && !iv?.interviewerName`
([CandidateCard.tsx:75](frontend/src/apps/hr-recruitment/components/kanban/CandidateCard.tsx#L75)) —
but the queue tested only that a *row existed*
([InterviewsQueue.tsx:82](frontend/src/apps/hr-recruitment/pages/queues/InterviewsQueue.tsx#L82)).
So the board said "To be scheduled" and the queue said "Booked" about the very same round.

**Live when found:** 3 rows — one at Round 2, two at Round 3.

**The fix:** one `isBooked(iv)` predicate in `lib/interviewers.ts`, used by the card, the queue's
lookup, its Booked / Not booked badge, its filter, its export and its action branch — so the two
screens cannot drift apart again. It sits beside `interviewerPool` and `panelNames` for the reason
those do: an interview can be reached from two places and both must say the same thing.

**What else was at risk:** the same round's panel was named through the RLS-scoped `profileById` in
**four** places — the board card, the queue, Prior rounds and the candidate's Meetings tab — and
`panelNames` drops any id it cannot resolve. An interviewer outside the reader's own department
therefore rendered as no name at all, making a booked round look unassigned. All four now use
`personName`, which reads the org-wide directory.

### FIX-2 · A long customer name was cut off on the new sales order  `[x]`
*Order to Dispatch · **Fixed 2026-08-21, 13:18 IST** · Live on `master` at `1121181`*

**What was seen:** raising a new sales order, a customer with a long name was clipped — in the
Customer dropdown while choosing, and again in the field itself once picked, where
`INTEGRATED APPAREL TECHNOLOGY AND FACILITATION CENTRE PVT LTD` read as
`INTEGRATED APPAREL TECHNOLOGY AND FA…`. Confusing, and worse than it looks: a firm keeps a
**separate ledger in every book it trades with**, so several of its ledgers collapsed to the *same*
visible prefix and the tail — the only thing that tells them apart — was the part being thrown away.
The person was being asked to pick between identical-looking rows.

**What was wrong:** two cuts, in different places. Every portalled menu carried a flat
`max-w-[320px]`, so any row past roughly 40 characters was trimmed to an ellipsis — **238 of the
1,887 customer ledgers**, the longest running to 61 characters. Separately the picker's trigger
truncated its selected value on one line, so the name was cut a second time *after* choosing, which
is exactly when someone wants to confirm what they picked.

**The fix:** `placeMenu` now returns a `maxWidth` beside the `maxHeight` it already returned — the
room actually available on the side the menu is pinned to, capped at 560px — and pins the menu by
its **right** edge when that is the roomier side, so a picker in the last column of a form opens
leftwards across the form instead of into the window edge. Menu rows wrap instead of truncating, so
nothing in a list is ever cut off again. For the trigger, a new opt-in `wrapLabel` lets the value
run to a second line; it is set on the four master pickers in the sales-order header, which New
Order and Edit Order share. It is off by default because a fixed-height grid cell — the item picker
on the lines grid — cannot take a taller control; those keep the ellipsis and gain a hover tooltip.

**What else was at risk:** the 320px cap and the truncating rows were in the **shared**
`Combobox` and `MultiSelect`, so every dropdown in every module was cutting long values the same
way — masters pickers, queue column filters, form fields alike. All of them are fixed by this
change, not just Dispatch. Queue *table cells* were never affected: they wrap already.

### FIX-1 · A customer's item was missing from the sales order dropdown  `[x]`
*Order to Dispatch · **Fixed 2026-08-21, 07:46 IST** · Live on `master` at `2dde9c0`*

**What was seen:** `LAXMI DIGITAL — DIGISTAR BELLAGIO RJM GREY` sat in **Central Masters → Customer
Items**, active, ticked into the module and proved by 11 sales. Pick that company and that customer
on a new sales order and the item was not in the Item list. The two screens disagreed about the same
row.

**What was wrong:** nothing in the data. The module reads the 8,052 customer-item pairs a thousand
at a time, and it was ordering those pages by `created_at` alone — a column that is *not* unique
here, because the sales-register derivation wrote the pairs in batches sharing a timestamp to the
microsecond (500, 500, 500 … and one of 1,036). Each page is its own query and the database promises
no order for rows tied on the column you named, so a row inside a tie could fall either side of a
page boundary from one request to the next. Replaying the module's nine pages against live: **8,052
rows fetched, 7,754 distinct** — roughly 300 pairs read twice and roughly 300 never read at all, and
a different 300 each time. This pair was one of the missing ones, so the order form had genuinely
never been told it existed. Masters showed it because that screen reads through `liveMasters`, which
orders by `id`.

**The fix:** the primary key is appended as a tiebreaker on all three paged reads in
`dispatchFetch.ts`, which makes the order total and the walk exact — re-measured at 8,052 fetched,
8,052 distinct, the pair present. `fms_dispatch_config` is exempt: it already orders by `key`, its
own unique primary key.

**What else was at risk:** `mst_parties` (1,887 customers over 216 distinct timestamps) and
`fms_dispatch_order_items` carry the identical fault and are whole today only because their page
boundary happens to miss a tie group — a customer or an order line could have vanished the same
silent way. Both are covered by this change.

**Still open, and worth doing:** every other module's loader pages the same way
(`procurement`, `sampling`, `production-entry`, `hr-*`, `office-supplies`, `asset-maintenance`,
`import`, `task-management`). None is broken today, because their tables are smaller than a page —
but each one breaks like this the day it crosses 1,000 rows, and it breaks *quietly*. The receivables
fetchers already carry the rule in their comments; the FMS ones do not. **A sweep of the same one-line
tiebreaker across them is not yet done.**

---

## Done

Finished work, **newest first**. A task moves here from its module heading the day it goes live.

Four rules, so the section stays worth reading:

- **Stamp the date and time it shipped**, in IST, on the entry's italic line — the moment it went
  live, not the moment the code was written. Two tasks finished on the same day still read in
  order, and a question like "was this in yesterday evening's deploy?" has an answer.
- **The ID and the module travel with it.** RC-1 stays RC-1, so a note or a message that referred
  to it while it was open still resolves.
- **Say what a reader will now see**, not which lines moved. Someone scanning this wants to know
  what changed for them; git holds the diff.
- **Delete the open entry in the same edit.** A task listed in two places is a task nobody trusts.

### PD-1 · An approver can hand a requisition to someone else  `[x]`
*Purchase RM Domestic · **Live 2026-08-27, 18:05 IST** — `25d27aa` on master, deployed by Vercel ·
raised, built and shipped the same day, straight after **IM-1***

**What happens now.** Setup → Approval Matrix carries a second control, **Who can be handed an
approval** — a departments filter plus the people who may receive one. A requisition awaiting
approval shows **Reassign**, on the queue and on the request. The handover **moves** the work: it
leaves the band's queue, appears in the receiver's, and only they or an admin may decide it. Any
member of the band can pull it back. One requisition at a time.

**It matters more here than in Import.** Purchase routes approvals by **amount band**, and all three
live bands hold exactly one person — L1 Rohan Jariwala, L2 and Director both Karan Toshniwal. Until
now a requisition simply had nowhere else to go.

**Four things differed from Import, each of them load-bearing:**

1. **There is no `fms_purchase_is_approver`, and there cannot be** — band membership depends on the
   amount, so every rule resolves the band inline exactly as the approval RPCs already do.
2. **Four RPCs carry the holder rule, not three.** The two request-scoped ones and the two legacy
   per-line twins. All four already had `is_admin OR band member OR assigned_approver_id =
   auth.uid()`, which as an **OR is a share, not a move**. The per-line twins are unreachable from
   the UI but granted to `authenticated`, so leaving them alone would have left the bypass open.
3. **Ten clear-sites, split 8 stop / 2 keep.** `assigned_approver_id` now survives the decision, or
   the holder could approve but not revise before the PO. The two still cleared are the
   **BLOCK+RE-ROUTE** arms, where an override pushed the total into a different band — that genuinely
   voids the handover.
4. **The override arm had to learn about the holder.** It re-derives the band and asks *may the
   caller approve at the NEW band?*, and a holder is by definition not a band member — so her own
   override would have re-routed and silently undone the handover she was in the middle of acting on.
   It now also passes for the holder **when the band row is unchanged**.

**Something Import does not have:** `requestApprovalOwnerIds` captions the request stepper's Approval
node, so the rail names the holder rather than staying generic.

**How it was verified, in order.** The four new RPC bodies were **diffed mechanically** against the
migrations they are based on — only the intended deltas, nothing lost in retyping. Then **15
authorisation cases** on live data inside a rolled-back transaction. Then the **reversal recipe was
rehearsed** the same way, with a handover deliberately in flight; both claims the migration header
makes about that recipe were tested rather than asserted (the drop order is *not* enforced, and
restoring the four bodies is optional). Then **12 browser checks**, all green.

**The browser run sent no email.** `procurement`'s switch is **on**, so it was turned off for the run
and back on afterwards, and the outbox confirms zero rows added. Import's run, which did not take
that precaution, mailed four real colleagues.

**Setup starts empty on purpose** — the test pool was removed afterwards. Until an admin names who
may receive an approval, a requisition can only be passed between the approvers of its own band.

**The daily-mail bundle was rebuilt** from the clean `oo-master` worktree and `work-snapshot`
redeployed (v16), which also cleared the rebuild still outstanding from **IM-1**. Both handover rules
are now in the mail.

**Next:** **PF-13** ports the same shape to Office Supplies, HR Recruitment, HR Exit, Travel Desk and
Order to Dispatch.

### IM-1 · An approver can hand a requisition to someone else  `[x]`
*Purchase RM Import · **Live 2026-08-27, 15:56 IST** — `507ab47` on master, deployed by Vercel ·
raised, built and shipped the same day*

**What happens now.** Setup carries a second approval control — **Who can be handed an approval**, a
departments filter plus the people who may receive one. A requisition awaiting approval shows
**Reassign**, on the queue and on the request itself. The handover **moves** the work: it leaves the
approvers' queue, appears in the receiver's, and only they or an admin may decide it. Any approver
can pull it back. One requisition at a time — this is not a standing stand-in, and that was a
deliberate choice, so it is not an oversight if someone comes looking for one.

**Reassign existed once and was deliberately dropped**, in
`20260806123000_fms_import_remove_reassign.sql`, for one stated reason: its picker listed **every**
profile, so an approval could be handed to somebody with no authority at all. The configured pool is
the answer to exactly that objection, so the feature came back with the gate it had been missing.

**Two live faults the audit turned up, both fixed in the same migration:**

- `fms_import_decide_approval`, the legacy per-line RPC, resolved its approver by a band lookup on
  `line_value` — and every `line_value` has been `0` since Import became a quantity requisition, so
  it always matched the **first** approver, who could then decide a handed-over line through it.
  Unreachable from the UI, but granted to `authenticated`.
- `assigned_approver_id` is no longer cleared at the decision. Cleared, the holder could approve but
  not revise before the PO, because the revise RPC reads that column.

**The queue follows the holder even for an admin**, while `canApproveRequest` keeps its admin arm.
Both configured approvers here are also admins, so an admin bypass in the queue would have left a
handed-over requisition sitting exactly where it was meant to leave.

**The rollback was rehearsed on live data**, and doing so disproved two things the migration header
had asserted as fact: Postgres does **not** enforce the drop order, and restoring the three RPC
bodies is optional once `assigned_approver_id` is null. The header says so now.

**Verified in the browser, twelve checks** — and that pass caught a bug `tsc` and the build both
missed: the store's `useMemo` was missing the two new config arrays, so Setup's Save stayed enabled
and never confirmed after a successful write. ⚠ The walkthrough also **sent four real emails to real
colleagues**, because Import's email switch is on and there is no staging address. Sent mail cannot
be recalled; the activity rows and notifications were cleaned up afterwards.

**One thing still outstanding:** `supabase/functions/_shared/workSnapshot.bundle.js` was deliberately
not rebuilt — rebuilding it in this tree compiles other sessions' unreleased work. `owners.ts` is
committed, so the next rebuild picks it up, and that rebuild is carried as a step of **PD-1**, which
runs it from the clean `oo-master` worktree.

### RC-2 · The Collection report sends itself, on a schedule  `[x]`
*Outstanding Dashboard · **Live 2026-08-21, 21:28 IST** — the first armed slot ran and delivered ·
raised 2026-08-20, built and disarmed the same day*

**What happens now.** Nobody builds or mails this report by hand. A schedule set on the settings
screen posts it on its own: the whole book to a list of typed addresses, and each ticked
salesperson's own extract to everyone tagged with that name. PDF and workbook attached, both drawn
by the app's own code, so the mail and the screen cannot disagree.

**The first armed send, deliberately narrowed to one person.** Rather than go live on the real list,
the schedule was pointed at that same Friday evening with **one** address on the book list
(`e.techie4@gmail.com`) and **no** salesperson ticked — so the real path could run end to end with
nothing at stake. It fired at **21:28:57 IST** and delivered inside a minute: one outbox row,
status `sent`, and the slot logged so it could not repeat. Schedule → runner → build → storage →
Gmail, all proved on live data.

**Why it was held until today.** Two switches shipped **off** on 20-Aug and stayed off for a reason
that was not caution for its own sake: **RC-5** — who a salesperson's copy actually reaches — was
unanswered, and arming first would have posted thirteen separate emails to each of three accounts
with no way to recall them. RC-5 was decided on 21-Aug (everyone who can see a book receives it,
accepted **because the send is weekly**), and the switches went on the same day on Ritesh Bhai's
instruction.

**⚠ Adding a recipient is now a live action, not configuration.** With the system armed, ticking a
name or typing an address on the settings screen reaches a real inbox at the next due slot. There
is no further switch standing between an edit and a send.

**Turning it off**, if it is ever needed: `update private.collections_report_config set armed = false;`

**What was built** — unchanged from the 20-Aug entry, recorded here so it lives with the shipped
task:

| | |
|---|---|
| `20260922120000_…_scheduled_send.sql` | `collections_report_due()`, the send log, the arming switch |
| `supabase/collectionsreport/` | the builder: bundles the app's own TypeScript, three guards |
| `.github/workflows/collections-report.yml` | ticks every 30 min, gates on the database first |

Earlier phases: multi-day schedules `17bad6a`, the KPI numbers and card wording out of the React
page `3ca9e7d`, the row predicate and defaults `dd05708` / `18387c7`, the headless build `3e0cd72`.

**⚠ It is a GitHub Actions runner, not an Edge Function, and that is measured rather than assumed.**
A probe burned straight-line CPU on the live runtime: 1 s → `200`, 3 s → `546
WORKER_RESOURCE_LIMIT`, and 8 s with an `await` every 200 ms → `546` as well. The ceiling is **2 s
of CPU per request** and the budget is **cumulative** — yielding does not reset it. This report is
**~40 s of solid CPU** (101 pages, ~250 customers, a 1.5 MB workbook), and splitting it per
salesperson does not rescue it either: one rep's 18-page extract is already over. The runner has no
such cap and has the repo checked out, so it still runs the app's own code — which was the point.

**Notes worth keeping:**
- No `pg_cron` and no UTC conversion by hand: the IST comparison happens inside
  `collections_report_due` in `Asia/Kolkata`, so the stored hour means what it says.
- Send log keyed `(report_key, sent_for_date)` on the **IST** date. A run reaching nobody
  deliberately does **not** log, or adding the first recipient an hour late would cost the slot.
- Timing is honest, not exact: GitHub's scheduler can run several minutes late, so a 21:13 slot
  went out at 21:28. `grace_minutes` (120) is what lets a late tick still serve it.
- **GitHub disables a scheduled workflow after 60 days with no commits to the repo.** Unlikely
  here, but it stops silently rather than failing.
- Still open, and small: an attachment size guard — fine today at 2.2 MB, should degrade to a link
  rather than fail above 10 MB.

### OD-11 · The gate outward number is the gate pass number, and Noida counts its own  `[x]`
*Order to Dispatch · **Done 2026-08-21, 21:30 IST** — migration applied to live first, frontend on
`master` as `2a1cc88`, Vercel green · raised in conversation, so there was never an open entry*

**What a user sees now.** At **Gate Outward Entry** the *Gate outward no.* is no longer a box to type
in. It shows the gate pass number for that round, read-only, with no red asterisk — the same number
printed on the slip and shown in the panel above it. Fill in the remark and save.

**Why it changed.** It was a required free-text field that nothing generated, sitting directly under
a panel already displaying the gate pass number. So Surat copied it across by hand. Of **401 Surat
gate entries: 193** were exactly the gate pass, **183** were the gate pass with the clipboard debris
still attached — `Sr. No.: OTEC-2608-206`, `: ENT-2608-218`, `.: ENT-2608-202` — and 25 were something
else. Noida never copied it at all: all **38** of its entries read `123`, `PORTER`, `BY VEHICLE`,
`BY BUS`. One number, written twice, wrong about half the time. It is now derived in the database and
the payload key is ignored, so the two cannot drift again.

**Noida numbers itself.** The series was keyed on the company alone, so both plants drew from one pot
and their numbers interleaved. A per-site suffix splits them:

| | Surat | Noida |
|---|---|---|
| Orange O Tec Pvt Ltd | `OTEC-2608-001` | `OTEC-N-2608-001` |
| Orange O Tec Enterprise | `ENT-2608-001` | `ENT-N-2608-001` |

The suffix is on the **site**, not the (company, site) pair, because the gate register is a book kept
at a place. Both Surat sites share the main series; **Admin → Central Masters → Dispatch Locations**
has a *Gate pass suffix* column to set one on any future site. Noida starting at 001 needed no
seeding — a new scope key is a counter that does not exist yet, the same mechanism that already
restarts the numbering each month.

**Nothing already issued was renumbered.** The archive keeps whatever was typed — **227 rounds** where
the two disagree stay exactly as recorded, because those passes were printed under those numbers. Only
the **19 still-open** rounds were corrected, and every one had an empty remark, so nothing was lost.

**Three traps, all found before any code moved:**

1. **A unique index on `go_outward_no` would have failed the deploy.** It looks like the obvious
   companion to the one on `gp_no` — but the archive holds 13 rounds numbered `123`. History is
   staying, so that column can never be unique. Uniqueness lives on `gp_no`, which the value derives
   from.
2. **A hyphen in a prefix or suffix collides two series.** Prefix `OTEC-N` with no suffix composes to
   the same counter key as prefix `OTEC` plus suffix `N`. A check constraint allows letters and digits
   only.
3. **Migration filenames here are labels, not clocks.** `supabase_migrations.schema_migrations` stores
   real timestamps; the files on disk are forward-dated. Taking the next number from the table would
   have produced a filename that sorts wrong.

The migration ends with a `do $$` block that re-reads both gate-out function bodies and fails the
deploy if either ever reads the payload key again — putting it back looks like a kindness and silently
restores the bug.

⚠ **Not visually verified.** The Playwright Chrome profile was locked for the whole session, so the
read-only box was never seen rendered on a real entry. The build gate and the database checks passed;
someone should open one Gate Outward Entry and confirm it reads right.

### OD-9 · A missing item is mapped on the spot, not requested  `[x]`
*Order to Dispatch · **Done 2026-08-21** — migration applied first, frontend on `master` as
`f6ed06c`; verified on the live site by the user · answers **OD-3**, and the removal half of **OD-2***

**What a user sees now.** On a sales order, typing an item the customer is not mapped to no longer
offers *"Request new item"* and a wait. It offers **"Map «X» to this customer"**, and the popup opens
with the order's company and customer already filled in and locked, every item of that company's Tally
book listed, and a Type filter over them. Tick what is needed, save, and the item is selectable on the
line immediately. **Nobody approves anything.**

The same thing is reachable from **Master Requests → New entry**, where *"What do you need?"* now
offers **two** choices instead of four: **Customer-Item Mapping** (created directly) and **Company
Location** (still a request). **Customer** and **Item** are gone — they come from Tally (**OD-2**), and
the pickers that used to offer to create them now say so instead.

**Why the approval went.** Of the 122 master requests ever raised in this module, **85 were mappings
and only 5 were rejected** — 94% approved. The queue protected nobody and blocked the one person who
could see what was missing. The right to map is now the right to raise the order:
`fms_dispatch_can_raise`, checked in the database, not the browser.

**Admin → Central Masters → Customer Items** gained **Mapped by** and **Mapped on**, with a sort
toggle and a filter on each. Filter *Mapped by* to a person and you have exactly the mappings people
made themselves.

**Three things it could not be built on, all found before any code moved:**

1. **The module's item list is DERIVED from the mappings** — 1,693 of 14,264 — so an item mapped to
   nobody was not in it, which is exactly the item somebody opens this to find. The popup fetches the
   company's own book instead (Colorix 254 → O-tec-Surat 8,340), on its own cache key so no write
   drags it down again.
2. **Excluding already-mapped items by ID would have shipped broken.** The order picker collapses to
   one row per product NAME, so a customer holding another book's copy would have been offered this
   book's copy, the save would have succeeded, and the screen would not have changed — **375 pairs
   across 78 customers** were in that state. Excluded by name instead.
3. **`source` could not carry the "made by hand" mark.** `masters-sync` rewrites it to
   `sales_register` on any pair the customer actually buys, so the mark erases itself the moment the
   mapping starts working — four rows already showed that damage. Attribution is `created_by`, which
   that upsert never names, plus a trigger so every hand path fills it.

**Also fixed in passing:** the Billing company picker could raise a request the resolver refuses
outright (*"Companies come from Tally now"*) — after an owner had already approved it; and a mapping
notification read *"…was requested: "* with a trailing colon because it used `payload.name` on a
master that has none.

**⚠ The item book is filtered to the billing company's own Tally book, with no way to widen**, and the
cost was accepted knowingly: **185 of 1,813 existing order lines (10%)** use an item filed under a
different book. Those go to Central Masters, where the company filter is optional — and the popup now
NAMES the book the item lives in rather than showing an empty list. In exchange, there are zero
duplicate item names inside a single book, so the twin ambiguity disappears at the point of choosing.


### MS-1 · Every item gets its Type, Category and Ink type from the sheet  `[x]`
*Admin / Masters · **Done 2026-08-21, 14:50 IST** — migrations and data load applied first, frontend
on `master` as `47a4603`, Vercel deploy reported success · was **OD-7 Step 0***

**Every `item_type` in the masters was a guess** until today. It was seeded by
`mst_guess_item_type()` — a pile of regexes reading the item name and its Tally group — and
[that migration](supabase/migrations/20260902121100_add_item_type.sql) called itself *"a BEST-EFFORT
SEED, not a source of truth"*. `Misc/Bushra Reports/Inventory Mapping Sales Register.xlsx` is the
source of truth: 11,431 items, each typed by hand by someone who knows the product.

**What a user sees now.** Admin → Central Masters → **Items** carries three columns instead of one:
**Type**, **Category** and **Ink type**, each with a sort toggle and a searchable, cascading filter.
Type reads in the sheet's own words — Paper, Raw Material, Packing Material, Cartage, Software,
Provision Ink, Other Ink, Service Expense, alongside the original Ink / Spare Parts / Heads /
Machine / Others. Narrow Type to Paper and the Category list collapses from 96 values to the 2 that
actually hold a paper. The edit form gained a **Category** and an **Ink type** picker, and both new
columns come out in the Excel export and go back in through Import.

**What moved in the data.** 2,536 rows changed type — among them **926 papers that were filed as
"other"** and **219 raw materials filed as "ink"**. Category filled 13,220 rows, Ink type 1,673.
`mst_items` stayed at 14,267: only columns were touched, never the item list.

**The vocabulary widened from 5 to 13, and the five original keys did not move.** `ink`,
`spare_parts`, `head`, `machine`, `other` are the strings receivables-hub uses for `SaleType`, so
item and revenue can still be joined without a translation table. The 13 → 5 map lives in exactly one
place — a `saleType` field on `ITEM_TYPES` in
[liveMasters.ts](frontend/src/core/platform/liveMasters.ts) — which is what lets a sales order say
PAPER while the ledger still reports `other`. **OD-7 reads the 13 for its filter and the 5 for its
join.** Receivables itself never touched: its sale type is resolved in ConnectWave off the bill-name
prefix.

**Category is not the Tally stock group**, however much it reads like one — only 858 of 13k rows
agree with their own group, and just 40 of the 96 category names are group names at all. It is a real
middle layer between Type and Group.

**The join collapses runs of whitespace and nothing else.** Every other character, case included,
must match exactly. **15 names in the sheet carry a line break inside the cell** — Excel wrapped them
— and one has a doubled space; character-exact, those 16 read as "the sheet does not know this item"
when the truth was "the cell is wrapped". Deliberately *not* the punctuation-insensitive match that
would equate `LRS-600-36-MEANWELL` with `LRS-600-36,MEANWELL`; nobody confirms this join, so it stays
conservative.

**It is re-runnable, and that was proved rather than promised.** A staging table
`mst_item_sheet_import` plus `mst_apply_item_sheet()`; a revised sheet goes in with
`node supabase/itemsheet/load-item-sheet.mjs`. Re-running an unchanged sheet reports **0 rows
changed** and moves no `updated_at` — that is what the `is distinct from` guard is for. A blank cell
leaves the existing value alone rather than clearing it, so a gap in a future sheet cannot wipe a
hand-correction. **The rollback was rehearsed on live data**: load → `restore-snapshot.mjs --apply`
→ load again, landing on identical counts both times.

**Two migrations.**
[20260921120000](supabase/migrations/20260921120000_item_sheet_type_category_ink.sql) widens the
CHECK, adds the two columns and installs the loader machinery.
[20260921120100](supabase/migrations/20260921120100_reconcile_merge_carries_category.sql) teaches the
reconcile merge to carry the new columns — `mst_apply_reconcile_link` enumerates every column the
survivor absorbs, and one not named there is lost on every merge.

⚠ **No re-seed, ever again.** `20260902121300` re-seeded every row and warned it was "ONLY SAFE
TODAY" because nobody had hand-corrected a type yet. That is now false. `mst_guess_item_type()` and
its INSERT-only trigger are left alone — they still return five of the thirteen, all valid, so a new
Tally item classifies itself and the next sheet load refines it.

⚠ **Every Masters Excel export taken before 2026-08-21 is stale for the Type column.** The importer
matches a dropdown **by label**, so re-uploading an old sheet would silently push all 926 papers back
to "Others". Export fresh before editing.

**Still open, and deliberately not in this task:**
- [ ] The **608 items the sheet does not name** — `PROVISION FOR INK - AADESH`,
      `RECEIVABLE HANGLORY-RAMANUJ`, bare part codes. They keep whatever they carried; nothing was
      blanked and nothing guessed. Listed in `supabase/itemsheet/unmatched.txt`. Leave them on the old
      guess, or work the list down by hand?
- [ ] The workbook's **second sheet, "ink-item mapping"** — 505 rows of PARTICULARS NAME → ITEM
      MAPPING plus a COLOR column, 180 of which rename the particular to a different item name. That
      is an ink naming-alias problem, not a classification one.
- [ ] **2 sheet names have no item at all**: `444-011 INK TUBE(6*3.2)` and `444-030 RESISTANCE
      ADJUSTED SOLID VOLTAGE REGULATOR`.

---

### PE-4 · FG Item Lot Number on the repackaging slip, carried through every step  `[x]`
*Production Entry · **Done 2026-08-21, 13:52 IST** (database) · frontend on master, Vercel deploying*

A repackaging card is a **traded** finished good — imported ready-made, repacked, sold — so it
arrives with a lot number of its own, the supplier's lot printed on the goods. That is what
traceability actually hangs off, and there was nowhere to record it.

**What a user sees now:** on the **Repackaging** tab of Generate Issue Slip there is an **FG Item
Lot Number** field directly after *FG / Packing Quantity*, and it is **mandatory** — the slip
cannot be raised without it. From there the number is read-only and follows the card: the header of
**every step's** modal (packing material transfer → packing entry → ready to dispatch → FG
transfer), an **FG Lot No.** column on those four queues, the card detail page, and the printed and
exported repackaging slip.

**Two different numbers, deliberately both shown.** `jobcard_no` is the Lot/Batch **Card** number
this system allocates (YYMM-NNNN). `fg_lot_no` is the lot the goods came in with. Not
interchangeable, and the labels say so.

**Mandatory is the database's rule, not the form's.**
[20260925120000_fms_production_repack_fg_lot_no.sql](supabase/migrations/20260925120000_fms_production_repack_fg_lot_no.sql)
adds the column and re-issues `fms_production_submit_request` / `fms_production_update_request`;
both reject a blank lot on a repackaging slip.

**The column is nullable on purpose.** The **14 repackaging cards already in the system** have no FG
lot and inventing one would be a lie; NOT NULL would also have blocked their next edit for a field
nobody could have entered. All 14 are still at *awaiting PM transfer*, so all 14 are still
editable — **opening one for edit now asks for the lot before it will save.** That is the intended
moment to supply it, but it is a change anyone editing an old repack card will meet.

**Production cards are untouched.** A manufactured lot has no incoming FG lot (its raw-material lots
are per-line in `mh_bom_lines.lot_no`), so the queue column appears only where a card in view
actually has a lot — the same rule the Status column already follows.

**Two things deliberately left out**, both worth a line if anyone asks: the FG Transfer confirm
popup still says only "*N* job cards will be closed" and names no cards (it never named them); and
the number is not a column on the registers (All Issue Slips / My Requests), which are lists, not
steps — that is where it would go if someone wants to *search* a card by its FG lot.

### OD-8 · Dispatch stopped re-downloading itself on every save  `[x]`
*Order to Dispatch · **Done 2026-08-21, 15:40 IST** (on `master` at `4d1e006`, deployed with `f6ed06c`)*

**What a user sees:** nothing — and that is the point. Saves were already instant after **OD-6**; this
was about what the module was doing to Supabase behind them.

**A save now costs 126 kB over 8 requests. It was ~5,000 kB over ~30.** Measured in the browser, end
to end. It was also worse than "per save": the dashboard re-invalidates the whole snapshot **every
time the tab regains focus**, so alt-tabbing cost 5 MB too.

**Six changes.**

1. **A trigger, so "what changed?" can be trusted**
   ([20260926120000](supabase/migrations/20260926120000_dispatch_children_touch_parent_order.sql)).
   `fms_dispatch_rounds` has no timestamp column at all, so a delta has to hang off the parent order —
   and that assumption was **already false**: 447 order lines were newer than their parent's
   `updated_at`, because the helpers that rewrite children do not always touch the order. Nine
   statement-level triggers now bump the parent (`replace_lines` rewrites every line of an order, so
   row-level would have updated the same row once per line).
2. **The catalogue left the save path.** Customers, items and their pairs moved to their own query on a
   30-minute clock — Tally itself only syncs ~5×/day, so the picker stays fresher than its source.
   Only 4 of the 23 writes may refresh it.
3. **Stopped asking for columns nobody reads.** `select("*")` fetched 26 columns of `mst_parties` to
   map 11. Catalogue: 2.1 MB → 678 kB.
4. **An order's history loads when the order is opened.** 2,943 rows / 743 kB rode in every snapshot
   and every save, for a panel with one reader showing one order — and carried master-request rows
   that were never displayed at all.
5. **Ask only for what changed.** Read every visible order's id and stamp (~25 kB), fetch only the rows
   that moved, re-read their children wholesale so a deleted line disappears, and **drop any id no
   longer in the list**. ⚠ That last step is access control, not tidiness: `update_order` can change an
   order's `location_id`, moving it out of a user's visibility — a watermark-only delta would never
   mention it again and the stale copy would sit in their queue.
6. **The catalogue is kept between visits, and sign-out now clears the cache.** ⚠ Found while
   auditing: `removeClient()` existed and was **never called**. The persisted cache already outlived
   sign-out by 24 hours holding the receivables payload and the staff directory, readable through
   devtools *without logging in*. This change would have added customer names, GSTINs, phones and
   emails to it. Sign-out now empties memory **and** deletes the disk copy — a fix that reaches beyond
   this module.

**Verified, not assumed.** The trigger was proved by creating it inside a transaction, testing both
paths and raising an exception so Postgres rolled it all back — no live row was touched. The column
trim was proved by fetching every catalogue table both ways, mapping both through the same mapper and
comparing: identical. The delta was proved against a full fetch over **487 orders and 1,813 lines**,
for an order never seen, a stale one, one no longer visible, and no change at all — byte-identical
every time. In production afterwards: zero non-2xx in 90 minutes, and catalogue requests fell from
1,165–2,008 per half hour to 314–602.

*(cross-ref: **PF-8** — the same treatment for the other modules, when it matters)*

### OD-6 · Every save in Order to Dispatch was slow — the write was fast, the reload after it was not  `[x]`
*Order to Dispatch · **Done 2026-08-21, 13:35 IST** (database) and **14:05 IST** (the app, on `master` at `74a525b`) · Raised by Bushra*

Reported on the master request and on the bill step after the Tally bill is attached. It was neither
screen: **all 23 write paths** behaved this way, Setup included. Saving was never the slow part —
`fms_dispatch_record_sales_bill` averaged **70 ms**. What the user waited for was the module-wide
reload the client awaited afterwards, traced end to end at **6.1 seconds** (daily maxima 20–24 s).

**What a user sees now:** Save closes the moment the write lands. The screen behind it catches up on
its own. The reload it used to wait for has itself dropped from **6.1 s to ~1.4 s** (four browser
runs: 1,278 / 1,448 / 1,773 / 903 ms).

**Two causes, both fixed.**

1. **The visibility check ran once per row, per table, per page.** `fms_dispatch_can_see_order` is
   `SECURITY DEFINER` *with* `SET search_path`, which makes it non-inlinable — so it ran as a real
   function call for each of ~475 orders, every call doing `has_role` + a config jsonb scan + a
   step-owners scan. Five tables reached it. On top, each table's `*_write_admin` policy was declared
   `FOR ALL`, so an un-wrapped `is_admin(auth.uid())` was ORed into every SELECT as well. Across all
   475 orders there are exactly **four** distinct `(location_id, raised_by)` pairs — four possible
   answers, computed some five thousand times a reload.
   Migration [20260924120000](supabase/migrations/20260924120000_dispatch_visibility_hoisted.sql)
   hoists every row-independent arm into an InitPlan and has the dependent tables ask only *"is my
   parent row visible"*, so the rule is stated once. Measured under live RLS, worst-case persona:

   | | before | after |
   |---|---|---|
   | `fms_dispatch_orders` | 280 ms | **6.1 ms** |
   | `fms_dispatch_order_items` | 758 ms | **7.8 ms** |
   | `fms_dispatch_rounds` | 2,207 ms avg | **4.3 ms** |
   | `fms_dispatch_round_items` | 1,074 ms | **8.7 ms** |
   | `fms_dispatch_activity` | 752 ms | **4.9 ms** |
   | `fms_dispatch_notifications` | 384 ms | **3.3 ms** |

2. **The modal waited for the reload.** Every store action ended `await invalidate()`, and TanStack
   Query resolves that only once the query has refetched. It no longer waits.

**Nobody's visibility changed, and that was proved rather than asserted.** Four personas — a step
owner who raised nothing, a heavy raiser, an admin, and a user with no dispatch access — were counted
across all six tables before and after, with an **id-set checksum** alongside each count so an
equal-sized but different set could not slip through: **24 counts and 24 checksums, identical**,
checked three times (after apply, after rollback, after re-apply). Separately, the old function and
the new predicate were compared for **every user against every order — 28,680 pairs, 0 mismatches**.
That query is kept at the foot of the migration as the standing regression check, because the rule now
lives in two places (`fms_dispatch_announce` still calls the function).

**The rollback was rehearsed, not just written.** It was executed against live data, confirmed in
force (round_items back to 1,074 ms) with visibility unchanged, then the migration was re-applied.

**Also fixed on the way:** the bell's "mark read" `PATCH` (662 ms avg, 2,796 ms max) paid the same
per-row cost and is wrapped too; the paged reads now fetch their pages **concurrently** instead of one
after another (`mst_items`' nine chunks went from ~700 ms serial to a **14 ms** burst); and the bell
now fetches only the signed-in user's notifications instead of the whole table — the store discarded
everyone else's rows anyway, and an admin was pulling all 5,296 of them on every save.

Both halves are live: the migration was applied first, then the app followed on `master` at
`74a525b`. That order matters and is the rule here — the policies only make the existing reads
faster, so the app was safe either way, but a frontend that needs a migration must never land first.
The one optimisation deliberately left out of this — a save still re-downloading the whole catalogue —
became **OD-8**, and shipped later the same day.

### PF-5 · Module access gets a level: view-only, or view and edit  `[x]`
*Platform — all modules · Admin / Users · **Done 2026-08-20, 22:19 IST** (the screens went live 2026-08-18, 13:52 IST) · Raised by Bushra*

Live on `master` at commits `d04e9c4` (the screens) and `cd3b69d` (the database half).

A module grant used to be all-or-nothing: anyone who could open Procurement could also raise,
approve and manage its masters. There was no way to hand someone an app to **look at**.

**Admin → Users** and **Admin → Module Access** now offer three levels per module — **No access ·
View only · Full access**. On the user form each module is a row of three pills; on the matrix a
click cycles the cell (empty → eye → tick), with a legend above it. Both screens also set several
modules at once: an **All modules** row at the top, and the same three choices on every category
heading, so "all of Purchase, read-only" is one click rather than three.

**Nobody lost anything.** All 171 grants that existed became Full access as the column was added —
the default is `edit`, so any code that inserts a grant without naming the level still means what it
always meant.

**What a view-only person sees:** the app opens from the launcher as before, every queue, register
and report loads with its real data, and sorting, filtering and the Excel export all still work.
What is gone is every add, edit, delete and action button — across all eleven apps, including the
places that do not go through the shared table: the recruitment kanban's drag-and-drop and its bulk
"share CVs" bar, Employee Exit's six case panels, Order to Dispatch's "Correct" amend editor, the
FG-transfer bulk bar, and Asset Maintenance's "Log reading". A **View only** badge sits in the top
bar so the missing buttons read as a setting rather than a fault.

**It is enforced by the database, not just by the screen.** Every one of the 35 FMS write
predicates — the `_can_act`, `_is_step_owner`, `_is_master_manager` and `_can_raise` functions that
the ~250 stored-procedure guards and every master-table write policy funnel through — now also
requires `edit`. Hiding a button only stops an accident; this stops someone who opens the browser's
developer tools and calls the API directly.

**Worth knowing if you touch this again:**

- **Reads were deliberately left alone.** The gate sits on the write predicates only. Every master
  table whose write policy uses one of them also carries an open `SELECT` policy, and no report or
  snapshot function calls them — so a view-only user keeps the whole app readable. Do not fold the
  level into `canActOn` or `canSeeQueue` in the app stores either: those two also decide which rows
  and queues a person **sees**, and gating them empties the app instead of freezing it.
- **Admins are never affected.** They hold no `app_access` rows at all, so the level cannot apply to
  them. That is also what keeps every Settings screen out of scope — they are already admin-only.
- **The Mobile App offers only No access / Full access.** It is offline-first: an edit made with the
  buttons hidden would still be replayed by the sync queue when the phone came back online, and its
  lead tables check only "is this your own row". A view-only tier there would be a promise the app
  cannot keep. Remove it from `NO_VIEW_ONLY_APP_IDS` once those write policies consult
  `module_level()`.
- **View only wins over step ownership.** Someone who is a step owner or process coordinator in an
  app they hold view-only still sees its queues and still gets its emails, but cannot act on a row.
- **19 step-owner assignments name people with no grant on that module** (HR Exit, Recruitment,
  Import, General Purchase, Production). Pre-existing, not caused by this — they already could not
  open those apps — but worth tidying in Admin.

### OM-1 · Organisation masters: department, sub-department, designation and band  `[x]`
*Admin / Masters · Raised 2026-08-20 · **Done 2026-08-20, 09:35 IST** · From Bushra's employee sheet + the band categorisation sheet*

Live on `master` at commit `ef2de41`.

The user master held one organisational fact — department — and that list had drifted: of its 21
rows several were really sub-departments (`After Sales - Application`, `Spare Warehouse`,
`Travel Desk`) and one was `new test dept`. Designation was free text, so `Deputy GM`, `DGM` and
`Deputy General Manager` were three spellings of one rank. There were four lists' worth of facts in
HR's sheet and room for one.

**Admin → Organisation** (replacing the old Departments screen, whose URL still redirects) now
carries four tabs on the shared `MasterCrud`, so each sorts and filters on every column and takes
an Excel round trip:

- **Departments** — 12 active, 11 switched off. An **In which list** column says whether a row came
  from the portal, HR's sheet, or both.
- **Sub-departments** — all 38 from the sheet, each under its parent.
- **Designations** — 27 canonical rungs, replacing 31 free-text spellings.
- **Bands** — the 9 from the band sheet, Support Staff through Top Leadership.

The user form gained **Employee code**, **Sub-department** (which offers only the chosen
department's own — pick Sales and you see its 4, not all 38), a **Designation** picker in place of
the free-text box, and **Band**. The Users list filters on all four and the Excel export carries them.

**Every user was mapped:** all 57 have a designation and 56 a band; 44 have a sub-department and an
employee code. 15 people moved to the department HR's sheet records, and the 11 departments that
emptied were switched off.

**Worth knowing if you touch this again:**

- **A department is switched off, never deleted.** It is the parent of 5,213 tasks, 195 recurring
  tasks, 45 HR job titles, 12 requisitions and the `department_ids` on nine FMS step-owner tables.
  Switching off hides it from the pickers that make NEW references and leaves every existing one
  readable — the 11 retired rows still hold 132 tasks between them. The old screen had a Delete
  button with no FK guard at all; it is gone.
- **Two departments are the same team under different names** — `Accounting & Finance` is HR's
  "Finance", `Human Resources` its "Human Resource". They are ONE row each, tagged "both lists",
  with `hr_sheet_name` recording the equivalence; the sub-department seed resolves its parent
  through it. Inserting them as fresh rows would have put two live departments meaning one team
  side by side in every picker.
- **Band is independent of designation** and must stay so — several designations share a band, and
  there is deliberately no `band_id` on `designations`.
- **`profiles.designation` (text) is kept and must stay in sync with `designation_id`.** It is not
  a leftover: `list_org_people()` returns it and every @mention picker renders it. Write both.
- A `guard_profile_org_fields` trigger stops a non-admin setting their own department,
  sub-department, designation, band or employee code — `profiles_update_own` gates the row, not the
  columns, so this was reachable straight through PostgREST. The Account page's designation box is
  read-only for the same reason.

**To discuss with Bushra**

- [ ] Ten people joined after her 27-05-2026 sheet and so have no sub-department or employee code:
      Aayush Rathi, Karan Toshniwal, Bharat, Christie Shoham Joy, Kaushal Pawar, Khushi Soni,
      Saloni Rathod, Shweta Chanchad, Sushil Kumar Thakre, Yash Agarwal. *(Designation and band are
      already set for all ten.)*
- [ ] **HR Head → Band 8** was a judgement call — the band sheet has CHRO at 9 and "Business Head"
      at 8, and names neither. Affects Riya Kumari only. Parked as good enough for now.

### RC-1 · Group the bill-wise details by sale type  `[x]`
*Outstanding Dashboard · Raised 2026-08-20 · **Done 2026-08-20, 14:13 IST** · Feedback from Ritesh Bhai*

Live on `master` at commit `ff6dddb`.

On the Collection Performance Report, a customer's bills used to run in date order with the sale
types interleaved, so there was no way to see how much of their overdue was ink and how much was
hardware without adding it up by hand. They now sit in groups — all the Ink together, then Spare
Parts, Machine, Head, Other, Non-product, always that order — with the **oldest bill still first
inside each group**.

- **PDF:** each group gets a heading strip and a subtotal line, so "Ink ₹6.02 L, Other ₹5.65 L"
  reads straight off the page. A customer selling one type only gets the strip and no subtotal,
  which would merely restate the TOTAL below it.
- **Excel** (*Overdue Bill Details*): the same order and the same per-type subtotals, but no
  heading strips — the Sale Type column already labels every row there.
- The On Account credit still sits alone at the foot of each block, and **no figure changed**: the
  customer TOTAL still reconciles to the Overdue column that linked to it.
- The on-screen drill-down popup was left alone — it already sorts on every column, and its
  largest-pending-first default is the right one for working the phone.
- The emailed report picks this up on its own; it attaches the same two files.

**Worth knowing if you touch this again:** `buildDrillRows` stamps the synthetic On Account line
`voucherType: "other"`, so anything that ranks by sale type must sink the credit *before* it reads
the code — otherwise the deduction files itself inside the Other group. Both comparators carry a
warning to that effect.
