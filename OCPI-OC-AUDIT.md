# OCPI · does our order confirmation match the real one?

> **Generated — do not edit by hand.** Regenerate with `cd frontend && npm run oc-audit`.
> Produced 2026-09-03 by driving the module's own `buildOcPdf` with the facts read off each
> real contract, then comparing the two documents band by band. No deal was raised and no
> quotation or OC number was burned.

**`2026.27` is the answer key** — it holds the latest contracts. Where both years cover a machine
the newer paper decides; an older-only difference is historical drift, not a gap in the template.

## Is this check trustworthy?

Two controls, and the answer is worthless without both.

| Control | Expected | Result |
|---|---|---|
| **Homer K24** (123 · Amarasha · 2026.27) — hand-verified as structurally matching | no missing clause, spec row or bullet | ✅ **0 structural gaps** |
| **Self-test** — one clause deleted from our side of a real comparison | the comparison reports it missing | ✅ **caught** (`INSTALLATION AND START-UP` on Homer K24) |

Both controls pass: the check sees a real difference and does not invent one.

The original positive control was the **Homer K32 consumables list** — eleven parts and two notes,
on four real contracts and in no template.
This run **no longer finds it, because it has been added** — migration
`20261106130000_fms_ocpi_k32_consumables_not_covered`, `sort_order` 100, read back off a rendered
page. A control that disappears the moment it succeeds is not a control, so the proof is now the
**self-test** above: a clause is deleted from our side of a live comparison and the comparison has
to notice. It depends on no live defect and fails loudly if the matching is ever weakened.

⚠ **What the hand check on K24 actually proved, and what it did not.** It compared the two
documents' *shape* — the same header fields, the same 13 specification labels in the same order,
the same composition list, the same nine clauses under the same titles in the same order. It never
compared the clause bodies word for word. So a difference **inside** a clause both documents carry
is not a control failure; it is a finding the hand check could not have made. K24 has 1 such
difference(s) below, and at least one of them changes what the warranty says.

## Coverage — every contract in 2026.27

🔴 **The folder holds 27 deals and only 10 order confirmations.** Every PDF was opened and
classified on its own heading and clause body, never on its filename — which lies: `106- NOOR
DYEING ….pdf` carries no OC/PI marker at all, and `109- … 25 aug.pdf` reads as a contract and is a
Performa Invoice. **The other 17 deals produced an invoice and no contract**, so for two thirds of
the year there is no signed contract to check anything against.

| # | Deal | Machine | Identified by |
|---|---|---|---|
| ALPHA15 | `125 -AKLAVYA INDUSTRIES PVT.LTD ALPHA  15 NAKUL SIR` | Alpha 15 | hand-picked specimen |
| ALPHA2-1.8 | `111 -  VPS TEXTILE PRINTERS ALPHA 2 1.8  - Dhananjay Patel` | Alpha II 1.8m | hand-picked specimen |
| ALPHA2-1.9 | `110 -Vaaho Industries Private Limited ALPHA 2 1.9 - Khurshid Alam` | Alpha II 1.9m | hand-picked specimen |
| K24 | `123 - AMARASHA DIGITAL PRINTS PRIVATE LIMITED k24 NAKUL SIR` | Homer K24 | hand-picked specimen |
| OC101 | `101 - YASHASVI DIGITAL FABRIC STUDIO P8S NAKUL SIR` | P8S | model code HM1800R-P8S-A1 + 7 spec row(s) matched exactly |
| OC108 | `108-MK FASHION ALPHA 2 1.9 - Khurshid Alam` | Alpha II 1.9m | model code OT-1908A + 4 spec row(s) matched exactly + name + 1.9 m |
| OC117 | `117- AKLAVYA INDUSTRIES PVT.LTD ALPHA 15 NAKUL SIR` | Alpha 15 | 4 spec row(s) matched exactly + name |
| OC122 | `122 - VIJAY LAXMI P8S NAKUL SIR` | P8S | model code HM1800R-P8S-A1 + 7 spec row(s) matched exactly |
| OC124 | `124 - CLOTHERA PRIVATE LIMITED 1.9 16 PH  NAKUL SIR` | KoloRado Alpha 3 | 4 spec row(s) matched exactly |
| P8S | `126- PRABAL DIGITAL FABRIC STUDIO  P8S  NAKUL SIR` | P8S | hand-picked specimen |

⚠ **2 more contract(s) exist only as a PowerPoint with no PDF beside them**, and are NOT read —
parsing a deck is how words get fused into a customer contract. Export them to PDF to include them:
- `102-Nayodra private limited-K24 with 16 heads - Hemant Kumar` → `102-Nayodra private limited-K24 with 16 heads - OC.pptx`
- `127 -SUMATI PRINTS PVT.LTD ALPHA 2 1.9 MTR - NAKUL SIR` → `127 -SUMATI PRINTS PVT.LTD ALPHA 2 1.9 MTR - OC.pptx`

## The final list — 24 pointers

⚠ **44 raw differences across 12 papers reduce to 24 distinct things to fix.** The same clause
missing from three P8S contracts is one pointer, not three; where it is also missing from the Alpha
decks it is still one, because it is one migration. **The paper count is the evidence** — a pointer
proved by five contracts is a house-wide omission, one proved by a single paper may be that
customer's own negotiated wording.

| # | Sev | Machines | Papers | Where | What the real contract says and ours does not |
|---|---|---|---|---|---|
| **P-01** | 🔴 | Homer K24, Homer K32, P8S | **5** — K24 · K32 · P8S · OC101 · OC122 | `head_policy` clause drops wording | will be for 12 months or balance warranty whichever is higher new print head bought post 18 months shall carry warranty 12 months from the date of installation any print head replaced under  … |
| **P-02** | 🔴 | Alpha 15, Alpha II 1.8m, Alpha II 1.9m | **5** — ALPHA15 · OC117 · ALPHA2-1.8 · ALPHA2-1.9 · OC108 | `warranty` clause drops wording | reason like physical damage mishandling environmental reason and improper setup in such case technician cost will also be chargeable and invoice will be generated for |
| **P-03** | 🔴 | Alpha II 1.8m, Alpha II 1.9m | **3** — ALPHA2-1.8 · ALPHA2-1.9 · OC108 | `warranty` clause drops wording | amc charges will be applicable as per real time terms and conditions of the company amc not available and not needed for this machine 1 year service will be provided by us and then after acc … |
| **P-04** | 🔴 | Alpha 15 | **2** — ALPHA15 · OC117 | priced supply line is missing what the real one states | TOTAL NET AMOUNT OF THE SUPPLY Digital Sublimation Printer Kolorado Alpha 15 with Standard Accessories (With 15 heads) Model No: |
| **P-05** | 🔴 | Alpha 15 | **2** — ALPHA15 · OC117 | a commercial term differs from the real contract | Insurance: Product Insurance is at Customer care. |
| **P-06** | 🔴 | Alpha II 1.9m | **2** — ALPHA2-1.9 · OC108 | wording on the real contract that our document never prints | 1 large format inkjet printer 1 9 meter with standard accessories without printheads |
| **P-07** | 🔴 | Homer K32 | **1** — K32 | priced supply line is missing what the real one states | DIGITAL TEXTILE PRINTING MACHINE WITH STANDARD ACCESSORIES WITH 32 PRINTHEADS AND DRYER. MODEL (HM1800B- TK32-B1) (HSN CODE 84433910) |
| **P-08** | 🔴 | Homer K32 | **1** — K32 | a commercial term differs from the real contract | Insurance: Product Insurance is at our care till Port. |
| **P-09** | 🔴 | KoloRado Alpha 3 | **1** — OC124 | priced supply line is missing what the real one states | TOTAL NET AMOUNT OF THE SUPPLY 1)Digital Sublimation Printing Machine KoloRado Alpha III (with 16 heads i3200) 2) 30 PCS Epson Print heads 30 Print Heads Value INR 21,00,000.00 18% GST INR 1 … |
| **P-10** | 🔴 | P8S | **1** — P8S | `head_policy` clause drops wording | date of shipment of machine 19th month onwards head price will be inr 2 25 000 00 gst freight with 12 months warranty |
| **P-11** | 🔴 | P8S | **1** — OC101 | `head_policy` clause drops wording | date of shipment of machine 19th month onwards head price will be inr 2 20 000 gst freight with 12 months warranty |
| **P-12** | 🔴 | P8S | **1** — OC101 | priced supply line is missing what the real one states | LARGE FORMAT INKJET PRINTER WITH STANDARD ACCESSORIES WITH 8 PRINTHEADS. HM1800R-P8S-A1 Note: 1) 200 Kgs ink included in above value. 2) If the Customer fails to provide the GST Number withi … |
| **P-13** | 🔴 | P8S | **1** — OC101 | wording on the real contract that our document never prints | if the customer fails to provide the gst number within one month orange o tec pvt ltd will not be responsible for any loss penalty tax or compliance related issue arising during this period  … |
| **P-14** | 🔴 | P8S | **1** — OC122 | `head_policy` clause drops wording | date of shipment of machine 19th month onwards head price will be in 2 20 000 00 gst freight with 12 months warranty |
| **P-15** | 🟠 | P8S | **3** — P8S · OC101 · OC122 | a specification row differs | Electrical Voltage: Printer：AC 380V Three phase｜7 kW｜50Hz/60Hz |
| **P-16** | 🟠 | P8S | **3** — P8S · OC101 · OC122 | a specification row differs | Compressed Air consumption: Dryer：AC380V three phase｜9 kW｜50Hz/60Hz 0.6 Mpa｜0.15m³/hr (Dry, No Oil or Water) |
| **P-17** | 🟠 | Alpha 15 | **2** — ALPHA15 · OC117 | a specification row differs | Electrical Voltage: Printer: VAC 210- 230, 15.5KW |
| **P-18** | 🟠 | P8S | **2** — P8S · OC122 | a specification row differs | Number of installed printing heads: 8 Heads |
| **P-19** | 🟠 | P8S | **2** — P8S · OC101 | a composition bullet is missing |  Driven unwinding unit with expanding shaft to support paper rolls on cardboard cores having max. |
| **P-20** | 🟠 | Homer K32 | **1** — K32 | a specification row differs | Electrical Voltage: Printer：AC220V single phase｜6.5kW｜50Hz/60Hz Belt Heater：AC220V single phase｜6 kW｜50Hz/60Hz |
| **P-21** | 🟠 | Homer K32 | **1** — K32 | a specification row differs | Compressed Air consumption: Dryer：AC380V three phase｜16 kW｜50Hz/60Hz 0.6 Mpa｜0.15m³/hr (Dry, No Oil or Water) 7 Bar |
| **P-22** | 🟠 | Homer K32 | **1** — K32 | a specification row differs | Dryer: Dual Dryerr (OIL & ELECTRIC) |
| **P-23** | 🟠 | KoloRado Alpha 3 | **1** — OC124 | a header line the machine does not declare | Date: 29/08/2026 |
| **P-24** | 🟠 | Alpha II 1.8m | **1** — ALPHA2-1.8 | a specification row differs | Model: KoloRado alpha II(1.8 Meter) |

## Where two real contracts for the same machine disagree

🔴 **7 place(s) where Bushra's own contracts for one machine do not match each other.** This only
becomes visible once every contract in the year is read instead of one per machine, and it matters:
**there is no single correct template until somebody says which paper is current.** Copying one of
them silently is how a template ends up carrying a term the company has abandoned.

| Machine | On | Not on | The wording |
|---|---|---|---|
| P8S | P8S | OC101 · OC122 | date of shipment of machine 19th month onwards head price will be inr 2 25 000 00 gst freight with 12 months warranty |
| P8S | P8S · OC122 | OC101 | Number of installed printing heads: 8 Heads |
| P8S | P8S · OC101 | OC122 |  Driven unwinding unit with expanding shaft to support paper rolls on cardboard cores having max. |
| P8S | OC101 | P8S · OC122 | date of shipment of machine 19th month onwards head price will be inr 2 20 000 gst freight with 12 months warranty |
| P8S | OC101 | P8S · OC122 | LARGE FORMAT INKJET PRINTER WITH STANDARD ACCESSORIES WITH 8 PRINTHEADS. HM1800R-P8S-A1 Note: 1) 200 Kgs ink included in … |
| P8S | OC101 | P8S · OC122 | if the customer fails to provide the gst number within one month orange o tec pvt ltd will not be responsible for any lo … |
| P8S | OC122 | P8S · OC101 | date of shipment of machine 19th month onwards head price will be in 2 20 000 00 gst freight with 12 months warranty |

## Every difference, paper by paper

Most serious first. 🔴 changes a signed contract · 🟠 changes what is stated · 🟡 cosmetic.

### 🔴 A-01 · Homer K24 — a contract clause

*inside PRINT HEAD POLICY PROGRAM — wording on the real contract that carries a figure or a duty, and is not in ours*  ·  evidence: `123 - AMARASHA DIGITAL PRINTS PRIVATE LIMITED k24 OC.pdf` (2026.27)

**The real contract carries these words and ours does not** *(normalised for comparison — the sentence as printed is in `oc-audit/parsed/`)*

> will be for 12 months or balance warranty whichever is higher new print head bought post 18 months shall carry warranty 12 months from the date of installation any print head replaced under the program of 12 months will have repetitive warranty any print head replaced under the warranty program of 12 months in case of any physical damage new print head to be purchase

**Ours** carries the `head_policy` clause and the wording around this, but not this.

**Fix** · *additive migration* — Amend `fms_ocpi_machine_sections.body` for `Homer K24` / `head_policy` so the sentence is carried. Additive UPDATE on one row; frozen revisions keep what they printed.

### 🔴 A-02 · Homer K32 — a contract clause

*inside PRINT HEAD POLICY PROGRAM — wording on the real contract that carries a figure or a duty, and is not in ours*  ·  evidence: `78-JAY Chemical - K32 (H32)  - OC.pdf` (2025.26)

**The real contract carries these words and ours does not** *(normalised for comparison — the sentence as printed is in `oc-audit/parsed/`)*

> will be for 12 months or balance warranty whichever is higher new print head bought post 18 months shall carry warranty 12 months from the date of installation any print head replaced under the program of 12 months will have repetitive warranty any print head replaced under the warranty program of 12 months in case of any physical damage new print head to be purchase

**Ours** carries the `head_policy` clause and the wording around this, but not this.

**Fix** · *additive migration* — Amend `fms_ocpi_machine_sections.body` for `Homer K32` / `head_policy` so the sentence is carried. Additive UPDATE on one row; frozen revisions keep what they printed.

### 🔴 A-03 · Homer K32 — the priced supply line

*the priced line the customer signs under states things ours does not: digital textile printing machine and*  ·  evidence: `78-JAY Chemical - K32 (H32)  - OC.pdf` (2025.26)

**The real contract says**

> DIGITAL TEXTILE PRINTING MACHINE WITH STANDARD ACCESSORIES WITH 32 PRINTHEADS AND DRYER. MODEL (HM1800B- TK32-B1) (HSN CODE 84433910)

**Ours says**

> STANDARD ACCESSORIES WITH 32 PRINTHEADS WITH DRYER. (Model No: HM1800B-TK32-B1)  (HSN Code: 84433910)

**Fix** · *additive migration* — Correct `fms_ocpi_machines.supply_description` for `Homer K32`. This is the line the customer signs under TOTAL NET AMOUNT OF THE SUPPLY, so a difference here is a difference in what was sold.

### 🔴 A-04 · Homer K32 — a commercial term

*the term is named on both, but the real contract's wording is not on ours*  ·  evidence: `78-JAY Chemical - K32 (H32)  - OC.pdf` (2025.26)

**The real contract says**

> Insurance: Product Insurance is at our care till Port.

**Ours says** *nothing* — the whole thing is absent.

**Fix** · *additive migration + possibly one field* — Carry this term in the `sale_conditions` clause for `Homer K32`. If its value varies by deal it needs a field and a token, not a literal — a literal that disagrees with the deal is worse than a blank.

### 🔴 A-05 · Kolorado Alpha 15 — a contract clause

*inside WARRANTY — wording on the real contract that carries a figure or a duty, and is not in ours*  ·  evidence: `125 -AKLAVYA INDUSTRIES PVT.LTD ALPHA  15 OC.pdf` (2026.27)

**The real contract carries these words and ours does not** *(normalised for comparison — the sentence as printed is in `oc-audit/parsed/`)*

> reason like physical damage mishandling environmental reason and improper setup in such case technician cost will also be chargeable and invoice will be generated for

**Ours** carries the `warranty` clause and the wording around this, but not this.

**Fix** · *additive migration* — Amend `fms_ocpi_machine_sections.body` for `Kolorado Alpha 15` / `warranty` so the sentence is carried. Additive UPDATE on one row; frozen revisions keep what they printed.

### 🔴 A-06 · Kolorado Alpha 15 — the priced supply line

*the priced line the customer signs under states things ours does not: total net amount the supply model*  ·  evidence: `125 -AKLAVYA INDUSTRIES PVT.LTD ALPHA  15 OC.pdf` (2026.27)

**The real contract says**

> TOTAL NET AMOUNT OF THE SUPPLY Digital Sublimation Printer Kolorado Alpha 15 with Standard Accessories (With 15 heads) Model No:

**Ours says**

> Digital Sublimation Printer Kolorado Alpha 15 with Standard Accessories (With 15 heads)

**Fix** · *additive migration* — Correct `fms_ocpi_machines.supply_description` for `Kolorado Alpha 15`. This is the line the customer signs under TOTAL NET AMOUNT OF THE SUPPLY, so a difference here is a difference in what was sold.

### 🔴 A-07 · Kolorado Alpha 15 — a commercial term

*the term is named on both, but the real contract's wording is not on ours*  ·  evidence: `125 -AKLAVYA INDUSTRIES PVT.LTD ALPHA  15 OC.pdf` (2026.27)

**The real contract says**

> Insurance: Product Insurance is at Customer care.

**Ours says** *nothing* — the whole thing is absent.

**Fix** · *additive migration + possibly one field* — Carry this term in the `sale_conditions` clause for `Kolorado Alpha 15`. If its value varies by deal it needs a field and a token, not a literal — a literal that disagrees with the deal is worse than a blank.

### 🔴 A-08 · Kolorado Alpha 15 — a contract clause

*inside WARRANTY — wording on the real contract that carries a figure or a duty, and is not in ours*  ·  evidence: `117- AKLAVYA INDUSTRIES PVT.OC.pdf` (2026.27)

**The real contract carries these words and ours does not** *(normalised for comparison — the sentence as printed is in `oc-audit/parsed/`)*

> reason like physical damage mishandling environmental reason and improper setup in such case technician cost will also be chargeable and invoice will be generated for

**Ours** carries the `warranty` clause and the wording around this, but not this.

**Fix** · *additive migration* — Amend `fms_ocpi_machine_sections.body` for `Kolorado Alpha 15` / `warranty` so the sentence is carried. Additive UPDATE on one row; frozen revisions keep what they printed.

### 🔴 A-09 · Kolorado Alpha 15 — the priced supply line

*the priced line the customer signs under states things ours does not: total net amount the supply model*  ·  evidence: `117- AKLAVYA INDUSTRIES PVT.OC.pdf` (2026.27)

**The real contract says**

> TOTAL NET AMOUNT OF THE SUPPLY Digital Sublimation Printer Kolorado Alpha 15 with Standard Accessories (With 15 heads) Model No:

**Ours says**

> Digital Sublimation Printer Kolorado Alpha 15 with Standard Accessories (With 15 heads)

**Fix** · *additive migration* — Correct `fms_ocpi_machines.supply_description` for `Kolorado Alpha 15`. This is the line the customer signs under TOTAL NET AMOUNT OF THE SUPPLY, so a difference here is a difference in what was sold.

### 🔴 A-10 · Kolorado Alpha 15 — a commercial term

*the term is named on both, but the real contract's wording is not on ours*  ·  evidence: `117- AKLAVYA INDUSTRIES PVT.OC.pdf` (2026.27)

**The real contract says**

> Insurance: Product Insurance is at Customer care.

**Ours says** *nothing* — the whole thing is absent.

**Fix** · *additive migration + possibly one field* — Carry this term in the `sale_conditions` clause for `Kolorado Alpha 15`. If its value varies by deal it needs a field and a token, not a literal — a literal that disagrees with the deal is worse than a blank.

### 🔴 A-11 · KoloRado Alpha 3 — 12 heads — the priced supply line

*the priced line the customer signs under states things ours does not: total net amount the supply heads i3200) pcs epson print heads print heads value inr 21,00,000.00 18% gst inr 12,15,000.00 total inr 79,65,000.00 sales conditions*  ·  evidence: `124 - CLOTHERA PRIVATE LIMITED 1.9 16 PH   OC 31 AUG.pdf` (2026.27)

**The real contract says**

> TOTAL NET AMOUNT OF THE SUPPLY 1)Digital Sublimation Printing Machine KoloRado Alpha III (with 16 heads i3200) 2) 30 PCS Epson Print heads 30 Print Heads Value INR 21,00,000.00 18% GST INR 12,15,000.00 Total INR 79,65,000.00 Sales Conditions:

**Ours says**

> Digital Sublimation Printing Machine KoloRado Alpha III WITH ALL STANDARD ACCESSORIES (1.8 Meter) (with 16 heads)

**Fix** · *additive migration* — Correct `fms_ocpi_machines.supply_description` for `KoloRado Alpha 3 — 12 heads`. This is the line the customer signs under TOTAL NET AMOUNT OF THE SUPPLY, so a difference here is a difference in what was sold.

### 🔴 A-12 · KoloRado Alpha II — 1.8 m, 8 heads — a contract clause

*inside WARRANTY — wording on the real contract that carries a figure or a duty, and is not in ours*  ·  evidence: `VPS TEXTILE PRINTERS ALPHA 2 1.8  - Dhananjay Patel OC.pdf` (2026.27)

**The real contract carries these words and ours does not** *(normalised for comparison — the sentence as printed is in `oc-audit/parsed/`)*

> amc charges will be applicable as per real time terms and conditions of the company amc not available and not needed for this machine 1 year service will be provided by us and then after according to need engineer will visit at your place machine warranty will be 1 year

**Ours** carries the `warranty` clause and the wording around this, but not this.

**Fix** · *additive migration* — Amend `fms_ocpi_machine_sections.body` for `KoloRado Alpha II — 1.8 m, 8 heads` / `warranty` so the sentence is carried. Additive UPDATE on one row; frozen revisions keep what they printed.

### 🔴 A-13 · KoloRado Alpha II — 1.8 m, 8 heads — a contract clause

*inside WARRANTY — wording on the real contract that carries a figure or a duty, and is not in ours*  ·  evidence: `VPS TEXTILE PRINTERS ALPHA 2 1.8  - Dhananjay Patel OC.pdf` (2026.27)

**The real contract carries these words and ours does not** *(normalised for comparison — the sentence as printed is in `oc-audit/parsed/`)*

> reason like physical damage mishandling environmental reason and improper setup in such case technician cost will also be chargeable and invoice will be generated for

**Ours** carries the `warranty` clause and the wording around this, but not this.

**Fix** · *additive migration* — Amend `fms_ocpi_machine_sections.body` for `KoloRado Alpha II — 1.8 m, 8 heads` / `warranty` so the sentence is carried. Additive UPDATE on one row; frozen revisions keep what they printed.

### 🔴 A-14 · KoloRado Alpha II — 1.9 m, 8 heads (OT-1908A) — a contract clause

*inside WARRANTY — wording on the real contract that carries a figure or a duty, and is not in ours*  ·  evidence: `Vaaho Industries Private Limited ALPHA 2 1.9 - Khurshid Alam OC.pdf` (2026.27)

**The real contract carries these words and ours does not** *(normalised for comparison — the sentence as printed is in `oc-audit/parsed/`)*

> amc charges will be applicable as per real time terms and conditions of the company amc not available and not needed for this machine 1 year service will be provided by us and then after according to need engineer will visit at your place machine warranty will be 1 year

**Ours** carries the `warranty` clause and the wording around this, but not this.

**Fix** · *additive migration* — Amend `fms_ocpi_machine_sections.body` for `KoloRado Alpha II — 1.9 m, 8 heads (OT-1908A)` / `warranty` so the sentence is carried. Additive UPDATE on one row; frozen revisions keep what they printed.

### 🔴 A-15 · KoloRado Alpha II — 1.9 m, 8 heads (OT-1908A) — a contract clause

*inside WARRANTY — wording on the real contract that carries a figure or a duty, and is not in ours*  ·  evidence: `Vaaho Industries Private Limited ALPHA 2 1.9 - Khurshid Alam OC.pdf` (2026.27)

**The real contract carries these words and ours does not** *(normalised for comparison — the sentence as printed is in `oc-audit/parsed/`)*

> reason like physical damage mishandling environmental reason and improper setup in such case technician cost will also be chargeable and invoice will be generated for

**Ours** carries the `warranty` clause and the wording around this, but not this.

**Fix** · *additive migration* — Amend `fms_ocpi_machine_sections.body` for `KoloRado Alpha II — 1.9 m, 8 heads (OT-1908A)` / `warranty` so the sentence is carried. Additive UPDATE on one row; frozen revisions keep what they printed.

### 🔴 A-16 · KoloRado Alpha II — 1.9 m, 8 heads (OT-1908A) — a clause our document never prints

*on the real contract and nowhere in our rendered document — the clause walk did not place it*  ·  evidence: `Vaaho Industries Private Limited ALPHA 2 1.9 - Khurshid Alam OC.pdf` (2026.27)

**The real contract carries these words and ours does not** *(normalised for comparison — the sentence as printed is in `oc-audit/parsed/`)*

> 1 large format inkjet printer 1 9 meter with standard accessories without printheads

**Ours says** *nothing* — the whole thing is absent.

**Fix** · *additive migration* — This wording is on the real contract and appears nowhere in our rendered document. Read it against `KoloRado Alpha II — 1.9 m, 8 heads (OT-1908A)`'s clauses in `fms_ocpi_machine_sections` and either carry it — as a new row or inside the clause it belongs to — or record why it was dropped. Where the value varies per deal (an included quantity, a price, a period) it needs a field and a token, never a literal.

### 🔴 A-17 · KoloRado Alpha II — 1.9 m, 8 heads (OT-1908A) — a contract clause

*inside WARRANTY — wording on the real contract that carries a figure or a duty, and is not in ours*  ·  evidence: `MK FASHION ALPHA 2 1.9 - Khurshid Alam OC.pdf` (2026.27)

**The real contract carries these words and ours does not** *(normalised for comparison — the sentence as printed is in `oc-audit/parsed/`)*

> amc charges will be applicable as per real time terms and conditions of the company amc not available and not needed for this machine 1 year service will be provided by us and then after according to need engineer will visit at your place machine warranty will be 1 year

**Ours** carries the `warranty` clause and the wording around this, but not this.

**Fix** · *additive migration* — Amend `fms_ocpi_machine_sections.body` for `KoloRado Alpha II — 1.9 m, 8 heads (OT-1908A)` / `warranty` so the sentence is carried. Additive UPDATE on one row; frozen revisions keep what they printed.

### 🔴 A-18 · KoloRado Alpha II — 1.9 m, 8 heads (OT-1908A) — a contract clause

*inside WARRANTY — wording on the real contract that carries a figure or a duty, and is not in ours*  ·  evidence: `MK FASHION ALPHA 2 1.9 - Khurshid Alam OC.pdf` (2026.27)

**The real contract carries these words and ours does not** *(normalised for comparison — the sentence as printed is in `oc-audit/parsed/`)*

> reason like physical damage mishandling environmental reason and improper setup in such case technician cost will also be chargeable and invoice will be generated for

**Ours** carries the `warranty` clause and the wording around this, but not this.

**Fix** · *additive migration* — Amend `fms_ocpi_machine_sections.body` for `KoloRado Alpha II — 1.9 m, 8 heads (OT-1908A)` / `warranty` so the sentence is carried. Additive UPDATE on one row; frozen revisions keep what they printed.

### 🔴 A-19 · KoloRado Alpha II — 1.9 m, 8 heads (OT-1908A) — a clause our document never prints

*on the real contract and nowhere in our rendered document — the clause walk did not place it*  ·  evidence: `MK FASHION ALPHA 2 1.9 - Khurshid Alam OC.pdf` (2026.27)

**The real contract carries these words and ours does not** *(normalised for comparison — the sentence as printed is in `oc-audit/parsed/`)*

> 1 large format inkjet printer 1 9 meter with standard accessories without printheads

**Ours says** *nothing* — the whole thing is absent.

**Fix** · *additive migration* — This wording is on the real contract and appears nowhere in our rendered document. Read it against `KoloRado Alpha II — 1.9 m, 8 heads (OT-1908A)`'s clauses in `fms_ocpi_machine_sections` and either carry it — as a new row or inside the clause it belongs to — or record why it was dropped. Where the value varies per deal (an included quantity, a price, a period) it needs a field and a token, never a literal.

### 🔴 A-20 · P8S — a contract clause

*inside PRINT HEAD POLICY PROGRAM — wording on the real contract that carries a figure or a duty, and is not in ours*  ·  evidence: `126- PRABAL DIGITAL FABRIC STUDIO  P8S OC.pdf` (2026.27)

**The real contract carries these words and ours does not** *(normalised for comparison — the sentence as printed is in `oc-audit/parsed/`)*

> date of shipment of machine 19th month onwards head price will be inr 2 25 000 00 gst freight with 12 months warranty

**Ours** carries the `head_policy` clause and the wording around this, but not this.

**Fix** · *additive migration* — Amend `fms_ocpi_machine_sections.body` for `P8S` / `head_policy` so the sentence is carried. Additive UPDATE on one row; frozen revisions keep what they printed.

### 🔴 A-21 · P8S — a contract clause

*inside PRINT HEAD POLICY PROGRAM — wording on the real contract that carries a figure or a duty, and is not in ours*  ·  evidence: `126- PRABAL DIGITAL FABRIC STUDIO  P8S OC.pdf` (2026.27)

**The real contract carries these words and ours does not** *(normalised for comparison — the sentence as printed is in `oc-audit/parsed/`)*

> will be for 12 months or balance warranty whichever is higher new print head bought post 18 months shall carry warranty 12 months from the date of installation any print head replaced under the program of 12 months shall carry the balance warranty from the date of replaced print head installation

**Ours** carries the `head_policy` clause and the wording around this, but not this.

**Fix** · *additive migration* — Amend `fms_ocpi_machine_sections.body` for `P8S` / `head_policy` so the sentence is carried. Additive UPDATE on one row; frozen revisions keep what they printed.

### 🔴 A-22 · P8S — a contract clause

*inside PRINT HEAD POLICY PROGRAM — wording on the real contract that carries a figure or a duty, and is not in ours*  ·  evidence: `101 - YASHASVI DIGITAL FABRIC STUDIO P8S OC.pdf` (2026.27)

**The real contract carries these words and ours does not** *(normalised for comparison — the sentence as printed is in `oc-audit/parsed/`)*

> date of shipment of machine 19th month onwards head price will be inr 2 20 000 gst freight with 12 months warranty

**Ours** carries the `head_policy` clause and the wording around this, but not this.

**Fix** · *additive migration* — Amend `fms_ocpi_machine_sections.body` for `P8S` / `head_policy` so the sentence is carried. Additive UPDATE on one row; frozen revisions keep what they printed.

### 🔴 A-23 · P8S — a contract clause

*inside PRINT HEAD POLICY PROGRAM — wording on the real contract that carries a figure or a duty, and is not in ours*  ·  evidence: `101 - YASHASVI DIGITAL FABRIC STUDIO P8S OC.pdf` (2026.27)

**The real contract carries these words and ours does not** *(normalised for comparison — the sentence as printed is in `oc-audit/parsed/`)*

> will be for 12 months or balance warranty whichever is higher new print head bought post 18 months shall carry warranty 12 months from the date of installation any print head replaced under the program of 12 months shall carry the balance warranty from the date of replaced print head installation

**Ours** carries the `head_policy` clause and the wording around this, but not this.

**Fix** · *additive migration* — Amend `fms_ocpi_machine_sections.body` for `P8S` / `head_policy` so the sentence is carried. Additive UPDATE on one row; frozen revisions keep what they printed.

### 🔴 A-24 · P8S — the priced supply line

*the priced line the customer signs under states things ours does not: value. the customer fails provide the gst number within one month, orange tec pvt. ltd. will not responsible for any loss, penalty, tax, compliance-related issue arising during this period. all such responsibility will the yashasvi digital fabric studio. any installment cheque stopped not cleared the yashasvi digital fabric studio, the machine will stopped. the machine will started again after the pending payment fully cleared*  ·  evidence: `101 - YASHASVI DIGITAL FABRIC STUDIO P8S OC.pdf` (2026.27)

**The real contract says**

> LARGE FORMAT INKJET PRINTER WITH STANDARD ACCESSORIES WITH 8 PRINTHEADS. HM1800R-P8S-A1 Note: 1) 200 Kgs ink included in above value. 2) If the Customer fails to provide the GST Number within one month, Orange O Tec Pvt. Ltd. will not be responsible for any loss, penalty, tax, or compliance-related issue arising during this period. All such responsibility will be with the Yashasvi Digital fabric Studio. 3) If any installment or cheque is stopped or not cleared by the Yashasvi Digital Fabric Studio, the machine will be stopped. The machine will be started again after the pending payment is fully cleared.

**Ours says**

> LARGE FORMAT INKJET PRINTER WITH STANDARD ACCESSORIES WITH 8 PRINTHEADS. (Model No: HM1800R-P8S-A1) Note: 200 Kgs ink included in above value.

**Fix** · *additive migration* — Correct `fms_ocpi_machines.supply_description` for `P8S`. This is the line the customer signs under TOTAL NET AMOUNT OF THE SUPPLY, so a difference here is a difference in what was sold.

### 🔴 A-25 · P8S — a clause our document never prints

*on the real contract and nowhere in our rendered document — the clause walk did not place it*  ·  evidence: `101 - YASHASVI DIGITAL FABRIC STUDIO P8S OC.pdf` (2026.27)

**The real contract carries these words and ours does not** *(normalised for comparison — the sentence as printed is in `oc-audit/parsed/`)*

> if the customer fails to provide the gst number within one month orange o tec pvt ltd will not be responsible for any loss penalty tax or compliance related issue arising during this period all such responsibility will be with the yashasvi digital fabric studio if any installment or cheque is stopped or not cleared by the yashasvi digital fabric studio the machine will be stopped the machine will be started again after the pending payment is fully cleared trade

**Ours says** *nothing* — the whole thing is absent.

**Fix** · *additive migration* — This wording is on the real contract and appears nowhere in our rendered document. Read it against `P8S`'s clauses in `fms_ocpi_machine_sections` and either carry it — as a new row or inside the clause it belongs to — or record why it was dropped. Where the value varies per deal (an included quantity, a price, a period) it needs a field and a token, never a literal.

### 🔴 A-26 · P8S — a contract clause

*inside PRINT HEAD POLICY PROGRAM — wording on the real contract that carries a figure or a duty, and is not in ours*  ·  evidence: `VIJAYLAXMI DIGITAL PRINTS OC NAKUL SIR.pdf` (2026.27)

**The real contract carries these words and ours does not** *(normalised for comparison — the sentence as printed is in `oc-audit/parsed/`)*

> date of shipment of machine 19th month onwards head price will be in 2 20 000 00 gst freight with 12 months warranty

**Ours** carries the `head_policy` clause and the wording around this, but not this.

**Fix** · *additive migration* — Amend `fms_ocpi_machine_sections.body` for `P8S` / `head_policy` so the sentence is carried. Additive UPDATE on one row; frozen revisions keep what they printed.

### 🔴 A-27 · P8S — a contract clause

*inside PRINT HEAD POLICY PROGRAM — wording on the real contract that carries a figure or a duty, and is not in ours*  ·  evidence: `VIJAYLAXMI DIGITAL PRINTS OC NAKUL SIR.pdf` (2026.27)

**The real contract carries these words and ours does not** *(normalised for comparison — the sentence as printed is in `oc-audit/parsed/`)*

> will be for 12 months or balance warranty whichever is higher new print head bought post 18 months shall carry warranty 12 months from the date of installation any print head replaced under the program of 12 months shall carry the balance warranty from the date of replaced print head installation

**Ours** carries the `head_policy` clause and the wording around this, but not this.

**Fix** · *additive migration* — Amend `fms_ocpi_machine_sections.body` for `P8S` / `head_policy` so the sentence is carried. Additive UPDATE on one row; frozen revisions keep what they printed.

### 🟠 A-28 · Homer K32 — a specification row

*same row, different value*  ·  evidence: `78-JAY Chemical - K32 (H32)  - OC.pdf` (2025.26)

**The real contract says**

> Electrical Voltage: Printer：AC220V single phase｜6.5kW｜50Hz/60Hz
> Belt Heater：AC220V single phase｜6 kW｜50Hz/60Hz

**Ours says**

> Electrical Voltage: Printer：AC220V single phase｜6.5kW｜50Hz/60Hz
> Belt Heater：AC220V single phase｜6 kW｜50Hz/60Hz
> Dryer：AC380V three phase｜16 kW｜50Hz/60Hz

**Fix** · *master data* — Add or correct this row in `fms_ocpi_machines.spec_rows` for `Homer K32`. If the value varies per deal it must be a `{{token}}`, not a literal.

### 🟠 A-29 · Homer K32 — a specification row

*same row, different value*  ·  evidence: `78-JAY Chemical - K32 (H32)  - OC.pdf` (2025.26)

**The real contract says**

> Compressed Air consumption: Dryer：AC380V three phase｜16 kW｜50Hz/60Hz
> 0.6 Mpa｜0.15m³/hr (Dry, No Oil or Water) 7 Bar

**Ours says**

> Compressed Air consumption: 0.6 Mpa｜0.15m³/hr (Dry, No Oil or Water) 7 Bar

**Fix** · *master data* — Add or correct this row in `fms_ocpi_machines.spec_rows` for `Homer K32`. If the value varies per deal it must be a `{{token}}`, not a literal.

### 🟠 A-30 · Homer K32 — a specification row

*same row, different value*  ·  evidence: `78-JAY Chemical - K32 (H32)  - OC.pdf` (2025.26)

**The real contract says**

> Dryer: Dual Dryerr (OIL & ELECTRIC)

**Ours says**

> Dryer: Dual Dryer

**Fix** · *master data* — Add or correct this row in `fms_ocpi_machines.spec_rows` for `Homer K32`. If the value varies per deal it must be a `{{token}}`, not a literal.

### 🟠 A-31 · Kolorado Alpha 15 — a specification row

*same row, different value*  ·  evidence: `125 -AKLAVYA INDUSTRIES PVT.LTD ALPHA  15 OC.pdf` (2026.27)

**The real contract says**

> Electrical Voltage: Printer: VAC 210- 230, 15.5KW

**Ours says**

> Electrical Voltage: Printer: VAC 210-230, 15.5KW

**Fix** · *master data* — Add or correct this row in `fms_ocpi_machines.spec_rows` for `Kolorado Alpha 15`. If the value varies per deal it must be a `{{token}}`, not a literal.

### 🟠 A-32 · Kolorado Alpha 15 — a specification row

*same row, different value*  ·  evidence: `117- AKLAVYA INDUSTRIES PVT.OC.pdf` (2026.27)

**The real contract says**

> Electrical Voltage: Printer: VAC 210- 230, 15.5KW

**Ours says**

> Electrical Voltage: Printer: VAC 210-230, 15.5KW

**Fix** · *master data* — Add or correct this row in `fms_ocpi_machines.spec_rows` for `Kolorado Alpha 15`. If the value varies per deal it must be a `{{token}}`, not a literal.

### 🟠 A-33 · KoloRado Alpha 3 — 12 heads — a header line

*header line on the real contract, not declared on our machine*  ·  evidence: `124 - CLOTHERA PRIVATE LIMITED 1.9 16 PH   OC 31 AUG.pdf` (2026.27)

**The real contract says**

> Date: 29/08/2026

**Ours says** *nothing* — the whole thing is absent.

**Fix** · *master data* — Add the field to `fms_ocpi_machines.header_fields` for `KoloRado Alpha 3 — 12 heads`.

### 🟠 A-34 · KoloRado Alpha II — 1.8 m, 8 heads — a specification row

*same row, different value*  ·  evidence: `VPS TEXTILE PRINTERS ALPHA 2 1.8  - Dhananjay Patel OC.pdf` (2026.27)

**The real contract says**

> Model: KoloRado alpha II(1.8 Meter)

**Ours says**

> Model: KoloRado alpha II (1.8 Meter)

**Fix** · *master data* — Add or correct this row in `fms_ocpi_machines.spec_rows` for `KoloRado Alpha II — 1.8 m, 8 heads`. If the value varies per deal it must be a `{{token}}`, not a literal.

### 🟠 A-35 · P8S — a specification row

*same row, different value*  ·  evidence: `126- PRABAL DIGITAL FABRIC STUDIO  P8S OC.pdf` (2026.27)

**The real contract says**

> Number of installed printing heads: 8 Heads

**Ours says**

> Number of installed printing heads: 8

**Fix** · *master data* — Add or correct this row in `fms_ocpi_machines.spec_rows` for `P8S`. If the value varies per deal it must be a `{{token}}`, not a literal.

### 🟠 A-36 · P8S — a specification row

*same row, different value*  ·  evidence: `126- PRABAL DIGITAL FABRIC STUDIO  P8S OC.pdf` (2026.27)

**The real contract says**

> Electrical Voltage: Printer：AC 380V Three phase｜7 kW｜50Hz/60Hz

**Ours says**

> Electrical Voltage: Printer：AC 380V Three phase｜7 kW｜50Hz/60Hz
> Dryer：AC380V three phase｜9 kW｜50Hz/60Hz

**Fix** · *master data* — Add or correct this row in `fms_ocpi_machines.spec_rows` for `P8S`. If the value varies per deal it must be a `{{token}}`, not a literal.

### 🟠 A-37 · P8S — a specification row

*same row, different value*  ·  evidence: `126- PRABAL DIGITAL FABRIC STUDIO  P8S OC.pdf` (2026.27)

**The real contract says**

> Compressed Air consumption: Dryer：AC380V three phase｜9 kW｜50Hz/60Hz
> 0.6 Mpa｜0.15m³/hr (Dry, No Oil or Water)

**Ours says**

> Compressed Air consumption: 0.6 Mpa｜0.15m³/hr (Dry, No Oil or Water)

**Fix** · *master data* — Add or correct this row in `fms_ocpi_machines.spec_rows` for `P8S`. If the value varies per deal it must be a `{{token}}`, not a literal.

### 🟠 A-38 · P8S — the composition list

*composition bullet on the real contract, absent from ours*  ·  evidence: `126- PRABAL DIGITAL FABRIC STUDIO  P8S OC.pdf` (2026.27)

**The real contract says**

>  Driven unwinding unit with expanding shaft to support paper rolls on cardboard cores having max.

**Ours says** *nothing* — the whole thing is absent.

**Fix** · *master data* — Add this bullet to `fms_ocpi_machines.composition` for `P8S`, unless it is a per-deal inclusion — in which case it belongs on the form, not the template.

### 🟠 A-39 · P8S — a specification row

*same row, different value*  ·  evidence: `101 - YASHASVI DIGITAL FABRIC STUDIO P8S OC.pdf` (2026.27)

**The real contract says**

> Electrical Voltage: Printer：AC 380V Three phase｜7 kW｜50Hz/60Hz

**Ours says**

> Electrical Voltage: Printer：AC 380V Three phase｜7 kW｜50Hz/60Hz
> Dryer：AC380V three phase｜9 kW｜50Hz/60Hz

**Fix** · *master data* — Add or correct this row in `fms_ocpi_machines.spec_rows` for `P8S`. If the value varies per deal it must be a `{{token}}`, not a literal.

### 🟠 A-40 · P8S — a specification row

*same row, different value*  ·  evidence: `101 - YASHASVI DIGITAL FABRIC STUDIO P8S OC.pdf` (2026.27)

**The real contract says**

> Compressed Air consumption: Dryer：AC380V three phase｜9 kW｜50Hz/60Hz
> 0.6 Mpa｜0.15m³/hr (Dry, No Oil or Water)

**Ours says**

> Compressed Air consumption: 0.6 Mpa｜0.15m³/hr (Dry, No Oil or Water)

**Fix** · *master data* — Add or correct this row in `fms_ocpi_machines.spec_rows` for `P8S`. If the value varies per deal it must be a `{{token}}`, not a literal.

### 🟠 A-41 · P8S — the composition list

*composition bullet on the real contract, absent from ours*  ·  evidence: `101 - YASHASVI DIGITAL FABRIC STUDIO P8S OC.pdf` (2026.27)

**The real contract says**

>  Driven unwinding unit with expanding shaft to support paper rolls on cardboard cores having max.

**Ours says** *nothing* — the whole thing is absent.

**Fix** · *master data* — Add this bullet to `fms_ocpi_machines.composition` for `P8S`, unless it is a per-deal inclusion — in which case it belongs on the form, not the template.

### 🟠 A-42 · P8S — a specification row

*same row, different value*  ·  evidence: `VIJAYLAXMI DIGITAL PRINTS OC NAKUL SIR.pdf` (2026.27)

**The real contract says**

> Number of installed printing heads: 8 Heads

**Ours says**

> Number of installed printing heads: 8

**Fix** · *master data* — Add or correct this row in `fms_ocpi_machines.spec_rows` for `P8S`. If the value varies per deal it must be a `{{token}}`, not a literal.

### 🟠 A-43 · P8S — a specification row

*same row, different value*  ·  evidence: `VIJAYLAXMI DIGITAL PRINTS OC NAKUL SIR.pdf` (2026.27)

**The real contract says**

> Electrical Voltage: Printer：AC 380V Three phase｜7 kW｜50Hz/60Hz

**Ours says**

> Electrical Voltage: Printer：AC 380V Three phase｜7 kW｜50Hz/60Hz
> Dryer：AC380V three phase｜9 kW｜50Hz/60Hz

**Fix** · *master data* — Add or correct this row in `fms_ocpi_machines.spec_rows` for `P8S`. If the value varies per deal it must be a `{{token}}`, not a literal.

### 🟠 A-44 · P8S — a specification row

*same row, different value*  ·  evidence: `VIJAYLAXMI DIGITAL PRINTS OC NAKUL SIR.pdf` (2026.27)

**The real contract says**

> Compressed Air consumption: Dryer：AC380V three phase｜9 kW｜50Hz/60Hz
> 0.6 Mpa｜0.15m³/hr (Dry, No Oil or Water)

**Ours says**

> Compressed Air consumption: 0.6 Mpa｜0.15m³/hr (Dry, No Oil or Water)

**Fix** · *master data* — Add or correct this row in `fms_ocpi_machines.spec_rows` for `P8S`. If the value varies per deal it must be a `{{token}}`, not a literal.

## The fix plan — the same defects, grouped

Most of the rows above are one defect repeated across machines: the print-head warranty sentences
went missing in a single transcription pass, and so did the Alpha warranty clause. Grouped, this is
**8 things to decide and apply**, not 44 separate jobs.

| # | What | Machines | Findings | Shape |
|---|---|---|---|---|
| **F-01** | 🔴 the priced supply line is missing what the real one states | 4 — Homer K32, Alpha 15, KoloRado Alpha 3, P8S | A-03, A-06, A-09, A-11, A-24 | additive migration |
| **F-02** | 🔴 the `head_policy` clause drops wording the real contract carries | 3 — Homer K24, Homer K32, P8S | A-01, A-02, A-20, A-21, A-22, A-23, A-26, A-27 | additive migration |
| **F-03** | 🔴 the `warranty` clause drops wording the real contract carries | 3 — Alpha 15, Alpha II 1.8m, Alpha II 1.9m | A-05, A-08, A-12, A-13, A-14, A-15, A-17, A-18 | additive migration |
| **F-04** | 🔴 a commercial term differs from the real contract | 2 — Homer K32, Alpha 15 | A-04, A-07, A-10 | additive migration + possibly one field |
| **F-05** | 🔴 wording on the real contract that our document never prints | 2 — Alpha II 1.9m, P8S | A-16, A-19, A-25 | additive migration |
| **F-06** | 🟠 a specification row differs | 4 — Homer K32, Alpha 15, Alpha II 1.8m, P8S | A-28, A-29, A-30, A-31, A-32, A-34, A-35, A-36, A-37, A-39, A-40, A-42, A-43, A-44 | master data |
| **F-07** | 🟠 a header line the machine does not declare | 1 — KoloRado Alpha 3 | A-33 | master data |
| **F-08** | 🟠 a composition bullet is missing | 1 — P8S | A-38, A-41 | master data |

⚠ **Nothing here has been applied.** This task is the audit; the one exception is the K32
consumables clause, which was already decided. Each batch above becomes its own work item, and
the wording for every one of them is on the real contract quoted in its finding.

## Differences that are deliberate — do not "fix" these

An audit that lists these as defects gets them reverted by the next person who reads it.

### B-01 · Shipment / delivery term wording

| | |
|---|---|
| The real contract | Shipment Terms: 30 Days after Order Confirmation  (and 'Delivery terms: NN Days After Order Confirmation') |
| Ours | Tentative Machine Delivery Date: <date> / Applicable from the date of signing of this contract. |
| Why | OCPI-18, on the client's instruction — a counted-days term was replaced by a dated one. Every real OC still shows the old wording. Do not restore `delivery_days`. |
| Seen on | Homer K24, P8S, KoloRado Alpha II — 1.9 m, 8 heads (OT-1908A), KoloRado Alpha II — 1.8 m, 8 heads, Kolorado Alpha 15, Homer K32, P8S, KoloRado Alpha II — 1.9 m, 8 heads (OT-1908A), Kolorado Alpha 15, P8S, KoloRado Alpha 3 — 12 heads |

### B-02 · Post-warranty print-head price

| | |
|---|---|
| The real contract | After 18 months New Print Head price will be @ INR 2,35,000 plus GST |
| Ours | the same sentence, rewritten to need no figure |
| Why | Stage J.1 retired `{{post_warranty_head_price}}` because an unfilled placeholder printed a ruled blank. RE-CONFIRMED 02-09-2026 with the evidence in front of Ritesh Bhai: the figure is typed per deal and disagrees with itself — the same Homer K24 was quoted Rs 2,25,000 (folder 91), Rs 2,35,000 (123) and Rs 2,50,000 (93, 95). He chose to leave it out. |
| Seen on | Homer K24, Homer K32 |
| Excused only on | Homer K24, Homer K32, K64 — anywhere else this sentence is reported as a gap |

⚠ The work list says only the Homer machines carry a head price. **P8S carries one too** — its real contract states INR 2,25,000 from the 19th month — and because this exemption is scoped to the Homers, that sentence is reported as a gap rather than excused. Ritesh Bhai's decision covered the Homer sentence; the Sub Pro one has not been put to him.

## 🔴 K64 — the best seller, and there is no contract on file for it

Every PDF and every Word/PowerPoint file in both years was searched for K64 content. It appears
in two folders — **109 Laxmipati** and **120 Modi** — and **both are Performa Invoices** with no
contract body. The WORKLIST entry lists K64 among the machines with a real OC; it does not have
one, so it has never been checked against a signed contract.

Covered three ways instead, each labelled for what it is worth:

| Route | Covers | Strength |
|---|---|---|
| **Inheritance from Homer K24** — re-asserted at run time, not assumed | **7 of 9** clauses are byte-identical to K24's: `installation`, `not_included`, `delivery_scope`, `pc_spec`, `machine_warranty`, `head_policy`, `customer_care` | **strong** — K24 is checked against a real 2026.27 contract above |
| **The K64 deck** (`31-08-2026/K64.pptx`) | the 2 clause(s) that differ: `sale_conditions`, `cancellation`, plus spec rows and composition | medium — checks our transcription against its own source |
| **The two real PIs** | header, spec, money and terms against what customers were actually invoiced | medium — real papers, but a PI carries no contract clauses |

**What none of them can answer:** whether a real K64 contract carries a clause its deck omits.
That is exactly how the K32 consumables list went missing — it is on four contracts and in no
deck-derived template. **Ask Bushra for one signed K64 order confirmation.**

## The two decks added on 02-09-2026

Both land on master rows that carry **no template at all**, so nothing is overwritten and no
existing contract changes. Every slide was exported to PNG through PowerPoint and read from the
image — the counts below come from the file's XML as a cross-check only, because four of the nine
decks in the last batch fuse words in OOXML and fused text reads as prose with typos rather than
as corruption. Slides are in `Misc/Bushra Reports/OCPI/oc-audit/decks/`.

### Pengda PD-1700XD-800  ·  `PENGDA 1000XD 800.pptx`

| | |
|---|---|
| Slides | 4 |
| Master row | `Pengda PD-1700XD-800` — **no template**, 0 section rows today |
| Billing name today | `HEAT TRANSFER MACHINE` |
| Model no. today | `PD-1700XD-800` |
| Header fields today | attn, date, ref, address |
| Candidate clause headings | 6 — approximate, counted from the XML; the rendered slides are the authority |

**Headings the deck carries** — `ORDER CONFIRMATION OTPL/OC/` · `WARRANTY TERMS` · `INSTALLATION AND START-UP` · `NOT INCLUDED` · `NOT INCLUDED IN OUR DELIVERY SCOPE` · `CANCELLATION`

🔴 **Sweep before transcribing.**

- **a money figure** — `INR 17,00,000.00`, `INR 3,06,000.00`, `INR 20,06,000.00`
  **Strip it.** The renderer draws the money block from the deal, so a figure left in the template would print beside a different — and correct — total on the same page.
- **a bank account number** — `A/C no. 919030077980346`
  Orange's own account. Our templates resolve it from the company profile through `{{bank_block}}`, which is what lets a Colorix or Noida deal print its own bank. Do not hard-code it.
- **an IFSC code** — `UTIB0003360`
  As above — part of `{{bank_block}}`, not template text.

**What is missing:** everything — this machine has no `intro_text`, no `spec_rows`, no
`composition`, no `supply_description` and no `fms_ocpi_machine_sections` rows, so it prints no
order confirmation at all. Three real contracts exist for this machine — folders 87 (K3 Fabric), 89 (Jayswal) and 94 (Omkara) — and the module can produce none of them.

### Mini Lario  ·  `S  MINI LARIO 1-OC.pptx`

| | |
|---|---|
| Slides | 16 |
| Master row | `Mini Lario` — **no template**, 0 section rows today |
| Billing name today | **not set** |
| Model no. today | **not set** — the deck states one, so use the literal |
| Header fields today | attn, date, ref, address |
| Candidate clause headings | 32 — approximate, counted from the XML; the rendered slides are the authority |

**Headings the deck carries** — `OFFER QUOTE / OTPL/OC/` · `INK-JET PRINTING MACHINE` · `MS-MINI LARIO` · `ACCESSORIES AND OPTIONALS INCLUDED IN THE SUPPLY` · `DRYING UNIT` · `MS-POWERDRY` · `STEAM, GAS, ELECTRIC OR DIATHERMIC OIL` · `MS MINI LARIO` · `SALE CONDITIONS OF THE SUPPLY` · `INCLUDED PC RIP` · `NOT INCLUDED` · `GOVERNING PROVISION` · `ACCEPTANCE OF ORDER ` · `CANCELLATION` · `PRICES.QUOTATIONS` · `SAFETY COMPLIANCE` · `SOFTWARE AND SAAS PRODUCTS` · `RESPONSIBILITIES OF BUYER` · `LIMITED WARRANTY` · `PERFORMANCES` · `LIMITATION OF LIABILITY` · `PROPRIETARY RIGHTS ` · `CONFIDENTIAL INFORMATION ` · `DATA PRIVACY` · `MARKEM-IMAJE` · `FORCE MAJEURE` · `COMPLIANCE ` · `ASSIGNMENT` · `COMPLETENESS` · `GOVERNING LAW AND DISPUTE RESOLUTION` · `PREPARED BY` · `APPROVED BY`

🔴 **Sweep before transcribing.**

- **a bank account number** — `A/C no. 919030077980346`
  Orange's own account. Our templates resolve it from the company profile through `{{bank_block}}`, which is what lets a Colorix or Noida deal print its own bank. Do not hard-code it.
- **an IFSC code** — `UTIB0003360`
  As above — part of `{{bank_block}}`, not template text.
- **another company's name** — `MARKEM-IMAJE`, `markem-imaje`
  🔴 **A person decides this, not a transcriber.** The legal clauses around it — limited warranty, limitation of liability, indemnity, data privacy, governing law — read as another manufacturer's standard terms rather than Orange O Tec's. Carried across as they stand, an Orange contract would offer a third party's warranty disclaimer and bind the customer to their dispute resolution. Ritesh Bhai settles which of these clauses Orange actually intends to offer before any of it becomes a template.

**What is missing:** everything — this machine has no `intro_text`, no `spec_rows`, no
`composition`, no `supply_description` and no `fms_ocpi_machine_sections` rows, so it prints no
order confirmation at all. No real contract on file, so this deck is the only evidence. Its heading is OFFER QUOTE — and `doc_title` is read by neither renderer, because `docHeading(deal)` derives the title from the OC number alone, so that heading can never print (OCPI-12 finding 5 / OCPI-34).

⚠ **Neither template is built here.** You asked what is missing; building writes the words that
print on signed contracts, and it is raised as its own work item with these renders attached.
**`Pengda PD-1800XD-800` still has no deck at all** and remains a gap.

## Coverage — every machine gets a verdict

| Machine | Checked how | Sections | Unresolved tokens | Ruled blanks |
|---|---|---|---|---|
| Homer K24 | **against a real contract** (2026.27) | 9 | none | none |
| Homer K32 | **against a real contract** (2025.26) | 10 | none | none |
| P8S | **against a real contract** (2026.27) | 9 | none | none |
| P8D | template sweep only | 9 | none | none |
| Kolorado Alpha 15 | **against a real contract** (2026.27) | 8 | none | none |
| KoloRado Alpha II — 1.8 m, 8 heads | **against a real contract** (2026.27) | 8 | none | none |
| KoloRado Alpha II — 1.9 m, 8 heads (OT-1908A) | **against a real contract** (2026.27) | 8 | none | none |
| KoloRado Alpha II — 2.2 m, 8 heads | template sweep only | 8 | none | none |
| KoloRado Alpha 3.2 — 24 heads | template sweep only | 8 | none | none |
| Pengda PD-1700XD-1000 | template sweep only | 6 | none | none |
| K64 | inheritance + deck + PIs | 9 | none | none |
| MP5000 | template sweep only | 9 | none | none |
| JPK | template sweep only | 9 | none | none |
| Fab Pro 1I | template sweep only | 9 | none | none |
| Fab Pro 2I | template sweep only | 9 | none | none |
| Fab Pro 3I | template sweep only | 9 | none | none |
| Position Printer | template sweep only | 9 | none | none |
| KoloRado Alpha 3 — 12 heads | **against a real contract** (2026.27) | 8 | none | none |
| Kolorado Alpha 16 | template sweep only | 8 | none | none |
| KoloRado Alpha 3.2 — 8 heads | template sweep only | 8 | none | none |
| Rocket | template sweep only | 11 | none | none |

**7 active machines carry no template at all** and print no order confirmation: *Mini Lario*, *KoloRado Alpha 3.2 — 16 heads*, *Pengda PD-1700XD-800*, *Pengda PD-1800XD-800*, *Foil Machine*, *Label Printer*, *Book Printer*.

## The coverage net

A second, independent pass: the whole real contract against our whole **rendered PDF**, comparing
word runs rather than walking bands. It exists so that a mistake in the band walk cannot read as a
clean result — if the walk mis-files a clause, this still finds it.

**4 run(s)** the band walk did not surface. They are **already merged into the list
above** rather than parked here, because a difference found by the safety net is still a
difference. Listed again by machine so the net's own yield is visible:

- **KoloRado Alpha II — 1.9 m, 8 heads (OT-1908A)** — 1: *1 large format inkjet printer 1 9 meter with standard accessories without printheads*
- **Homer K32** — 1: *external centring device air blade head cooling system digital textile printing machine with standard accessories with 3 …*
- **P8S** — 1: *if the customer fails to provide the gst number within one month orange o tec pvt ltd will not be responsible for any lo …*
- **KoloRado Alpha II — 1.9 m, 8 heads (OT-1908A)** — 1: *1 large format inkjet printer 1 9 meter with standard accessories without printheads*
## Facts the paper did not state

Our render was driven with everything readable off each contract. These could not be read, so a
difference caused by one of them is **our missing input, not a gap in the template**.

- **KoloRado Alpha II — 1.9 m, 8 heads (OT-1908A)** — trade term
- **KoloRado Alpha II — 1.8 m, 8 heads** — trade term
- **Kolorado Alpha 15** — trade term
- **Homer K32** — machine value INR
- **Pengda PD-1700XD-800** — head count, machine value INR, trade term
- **KoloRado Alpha II — 1.9 m, 8 heads (OT-1908A)** — trade term
- **Kolorado Alpha 15** — trade term
- **KoloRado Alpha 3 — 12 heads** — payment terms, trade term

---

*Working files: `Misc/Bushra Reports/OCPI/oc-audit/` — `parsed/` is what the parser read from each
real contract, `ours/` is what we rendered and the facts each render was driven with. Read them
before trusting any single finding.*
