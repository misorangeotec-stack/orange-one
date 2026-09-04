-- OCPI-37 · The manufacturer's model number and the HSN code, filled from the
-- real signed contracts.
--
-- Ritesh Bhai, 03-Sep-2026: "we already have a model number in the machine
-- master, so you can pick up the model number from there. If it is blank, then
-- we will add the model number, or if you have the model number from the actual
-- contract, then you can just go ahead and add that to the master."
--
-- ⚠ ADDITIVE AND IDEMPOTENT. Every statement below is guarded on the column
--   being NULL or empty, so a value somebody has since typed by hand is never
--   overwritten and a re-run changes nothing. No column is added, altered or
--   dropped; no row is deleted.
--
-- ⚠ FROZEN REVISIONS ARE UNAFFECTED. An issued contract prints from
--   `fms_ocpi_deals.oc_document_payload`, not from this table, so nothing that
--   has already been signed changes wording.

-- ── Model numbers ────────────────────────────────────────────────────────────
--
-- Both are quoted off the priced supply line of real contracts, read by
-- rendering the PDF — never from the deck.
--
--   Homer K32  "MODEL (HM1800B- TK32-B1)"  · 9 papers agree — OC/PI 78, 82, 83
--              (2025.26) and 119 (2026.27). The space after "HM1800B-" is a
--              line-wrap artefact of the PowerPoint text box, not part of the
--              code; the PI for 119 prints it unwrapped.
--   P8S        "HM1800R-P8S-A1"             · all 6 P8S papers agree — OC and PI
--              for 101, 122 and 126 (2026.27). It mirrors P8D's existing
--              `HM1800R-P8D-A1`, which is already on the master.
--
-- ⚠ NO CODE IS INVENTED FOR THE REST. The Alphas, Alpha 15 and Alpha 16 carry
--   no manufacturer code on any real paper — contract 125 prints the label
--   "Model No:" with nothing after it — so their master cells stay NULL and the
--   renderer prints nothing rather than a blank.
--
-- 🔴 K64 IS DELIBERATELY NOT TOUCHED, and this is a question for Bushra rather
--    than a gap. Its two real Performa Invoices state DIFFERENT codes —
--    `HM3200B-TK64-A1` (109 Laxmipati) and `HM1800B-TK64-A1` (120 Modi) — which
--    reads as two build widths sold under one master row. The master holds the
--    1800 and that is left alone; guessing here would put the wrong code on the
--    best-selling machine's contract.

update fms_ocpi_machines
   set machine_model_no = 'HM1800B-TK32-B1', updated_at = now()
 where name = 'Homer K32'
   and coalesce(trim(machine_model_no), '') = '';

update fms_ocpi_machines
   set machine_model_no = 'HM1800R-P8S-A1', updated_at = now()
 where name = 'P8S'
   and coalesce(trim(machine_model_no), '') = '';

-- Untemplated, but the code is stated plainly on three real contracts (OC 87,
-- 89 and 94) and the sibling row already carries `PD-1700XD-1000`. Filling it
-- now means the template, when it is built, has the code waiting.
update fms_ocpi_machines
   set machine_model_no = 'PD-1700XD-800', updated_at = now()
 where name = 'Pengda PD-1700XD-800'
   and coalesce(trim(machine_model_no), '') = '';

-- ── HSN code ─────────────────────────────────────────────────────────────────
--
-- 🔴 IT IS THE SAME CODE ON EVERY PAPER THAT STATES ONE. Swept all 90 PDFs
--    across both years: 14 occurrences of an HSN, ONE value — 84433910 — with
--    no disagreement anywhere. It appears on four different machines across
--    three product families: Homer K32 (scanning), K64 (both PIs), Rocket
--    (single-pass) and the Position Printer. 8443.39.10 is the customs heading
--    for ink-jet printing machinery, which is what all four are.
--
-- ⚠ ONLY THOSE FOUR ARE FILLED. The KoloRado, Fab Pro and P8S papers state no
--   HSN at all, so there is no paper evidence for the other 17 — and an HSN on
--   a signed contract is a tax classification, not a label. Whether the same
--   code covers the whole range is one word from Ritesh Bhai; the column is
--   per-machine precisely so a machine that differs can hold its own.
--
-- ⚠ THE COLUMN ALREADY EXISTS AND ALREADY PRINTS. `hsn_code` was added for the
--   Performa Invoice, which renders it beside the model number
--   (`piPdf.ts` · machineDetailLines). It was NULL on all 28 rows, so the PI has
--   been printing neither. Filling it lights up both papers at once.

update fms_ocpi_machines
   set hsn_code = '84433910', updated_at = now()
 where name in ('Homer K32', 'K64', 'Rocket', 'Position Printer')
   and coalesce(trim(hsn_code), '') = '';
