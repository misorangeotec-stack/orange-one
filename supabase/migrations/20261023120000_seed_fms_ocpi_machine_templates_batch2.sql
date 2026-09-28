-- ============================================================================
-- OCPI · the 31-08-2026 machine-template batch (WORKLIST OCPI-4)
--
-- Nine of the eleven decks WORKLIST OCPI-3 §K named as missing arrived in
-- `Misc/Bushra Reports/OCPI/31-08-2026/`. Every one maps onto a master row that
-- ALREADY EXISTS with has_template = false, so this file UPDATES rows; it
-- inserts no machine. Takes the module from 10 of 28 templated to 19 of 28.
--
-- ⚠ THE EXISTING TEN MUST NOT MOVE. Two REAL deals are live (AARNAV FASHIONS,
--   QT-M0037 / QT-M0038) on Homer K32 and Kolorado Alpha 15. Every update below
--   is guarded `and has_template = false`, and the sections block skips any
--   machine that already has sections, so a re-run is a no-op and the ten
--   cannot be touched even by accident.
--
-- ⚠ TRANSCRIBED FROM RENDERS, NOT FROM THE XML. Both Alpha decks and both Fab
--   Pro decks extract with words fused ("Followingupyourkind order"), so every
--   deck was exported slide-by-slide through PowerPoint/Word COM and read as an
--   image. The XML walk was kept only as a numeric cross-check.
--
-- ⚠ THIS CONTENT IS AWAITING BUSHRA'S PROOF-READ, exactly as the first ten are.
--   Deck typos are carried across deliberately ("regural", "continous").
--
-- Three deliberate departures from "the deck's own wording":
--   1. Fab Pro 1I's deck is a FILLED-IN LIVE CONTRACT — customer PRINTING
--      PARADISE, their GST number, and ₹40,00,000. All of it is stripped to
--      tokens; transcribing it would put another customer on every future
--      Fab Pro contract.
--   2. The post-warranty head-price sentence (K64, Position Printer, Fab Pro
--      1I/2I, Rocket) uses the REWORDED text already live on K24/K32/P8D/P8S.
--      {{post_warranty_head_price}} was retired and would print a ruled blank.
--   3. Literal warranty months become {{machine_warranty_months}} /
--      {{head_warranty_months}}, which are fixed company config (12 / 18).
--      ⚠ Rocket's deck says 24 months and will therefore print 12 — raised
--      with the client under OCPI-4 rather than hard-coded here.
-- ============================================================================

-- ── K64 ─────────────────────────────────────────────────────────────────────
update public.fms_ocpi_machines set
  intro_text = 'Following up your kind order, we are glad to confirm the supply of Homer K64 Digital Printing Machine at the under mentioned conditions',
  machine_model_no = 'HM1800B-TK64-A1',
  supply_description = 'DIGITAL TEXTILE PRINTING MACHINE WITH STANDARD ACCESSORIES WITH {{head_count}} PRINTHEADS AND CENTERING SYSTEM & DRYER (Model No: HM1800B-TK64-A1)',
  spec_rows = $j$[
    {"label":"No. of Machine Supply","value":"{{machine_count}}"},
    {"label":"Model","value":"Homer K64"},
    {"label":"Number of installable rows","value":"8"},
    {"label":"Number of installed printing heads","value":"{{head_count}}"},
    {"label":"Number of installable printing heads","value":"64"},
    {"label":"Max. Printing width","value":"1800 mm"},
    {"label":"Max. Fabric width","value":"1800 mm"},
    {"label":"Electrical Voltage","value":"Printer：AC220V single phase｜6.5kW｜50Hz/60Hz\nBelt Heater：AC220V single phase｜6 kW｜50Hz/60Hz\nDryer：AC380V three phase｜16 kW｜50Hz/60Hz"},
    {"label":"Compressed Air consumption","value":"0.6 Mpa｜0.15m³/hr (Dry, No Oil or Water)"},
    {"label":"Water Consumption","value":"0.6 Mpa | 0.4m³/hr"},
    {"label":"Installed electrical power","value":"30 KW"},
    {"label":"Rip software","value":"Neostampa"},
    {"label":"Dryer","value":"Oil + Electric"}
  ]$j$::jsonb,
  composition = $j$[
    "Ink feeding system complete with in-line filters and Degassing units.",
    "Driven unwinding unit with expanding shaft to support fabric rolls on cardboard cores having max. Diameter of 400 mm.",
    "Fabric tensioning bars with adjustable incidence to control fabric tension during unwinding. It is equipped with a spreading roll and a bent bar that can be used alternatively by the operator according to the fabric being processed.",
    "Adjustable pressure of the fabric pressing cylinder- up to 0.6 MPA Printing unit model Homer K64 to print from 4 to 8 colors. Height adjustment of the printing carriage over the blanket Built-in electrical cabinet",
    "Operator interface controlling all machine operative parameters",
    "Blanket washing unit with driven brush and cleaning/drying sponges and wipers to remove water residues.",
    "Presence of Moving Roll for to obtain better results on thin(low GSM fabric).",
    "Ink Circulation : When we give cleaning or fill up then inks go back to primary tank instead of getting waste.",
    "Auto Purging System : When head is at capping position, it keeps firing at regural interval, so nozzle remains moist.",
    "Large flow and high-speed degassing device",
    "Automatic negative pressure system",
    "Large memory Industrial server",
    "Tension-adjustable continous unwinding/rewinding control technology"
  ]$j$::jsonb,
  header_fields = '["attn","date","ref","address"]'::jsonb,
  signoff_style = 'approved_by',
  doc_title = 'ORDER CONFIRMATION',
  has_template = true
where name = 'K64' and has_template = false;

-- ── Position Printer ────────────────────────────────────────────────────────
-- ⚠ THE DECK'S COMPOSITION SAYS "Printing unit model Homer K32". That is a
--   copy-paste leftover from the K32 deck, not a typo, and it is carried across
--   verbatim under the deck-verbatim rule — which means a Position Printer
--   contract currently states it is a K32. FIRST thing for Bushra's proof-read;
--   raised as OCPI-4 finding F16.
-- ⚠ The deck's sale-conditions table carries a "Manufacture" label with no
--   value and no token behind it. Dropped rather than printed as a dangling
--   label; also F16.
update public.fms_ocpi_machines set
  intro_text = 'Following up your kind order, we are glad to confirm the supply of POSITION PRO Machine at the under mentioned conditions',
  machine_model_no = 'DA188SLP',
  supply_description = '1 - Positional Printer for Textile Printing with Standard Accessories (for Industrial use)',
  spec_rows = $j$[
    {"label":"No. of Machine Supply","value":"{{machine_count}}"},
    {"label":"Model","value":"POSITION PRINTER (MODEL NO. DA188SLP)"},
    {"label":"Number of installable rows","value":"2"},
    {"label":"Number of installed printing heads","value":"{{head_count}}"},
    {"label":"Number of installable printing heads","value":"16"},
    {"label":"Max. Printing width","value":"1850 mm"},
    {"label":"Max. Fabric width","value":"1900 mm"},
    {"label":"Electrical Voltage","value":"Printer：AC380V three-phase｜15kW｜50Hz/60Hz\nBelt Heater：AC380V three phase｜15 kW｜50Hz/60Hz\nDryer：AC380V three phase｜16 kW｜50Hz/60Hz"},
    {"label":"Compressed Air consumption","value":"0.6 Mpa｜1m³/hr (Dry, No Oil or No Vapour)"},
    {"label":"Water Consumption","value":"0.6 Mpa | 0.4m³/hr"},
    {"label":"Installed electrical power","value":"15 KW"},
    {"label":"Rip software","value":"Neostampa"},
    {"label":"Dryer","value":"Electric and Gas"}
  ]$j$::jsonb,
  composition = $j$[
    "Ink feeding system complete with in-line filters and Degassing units.",
    "Driven unwinding unit with expanding shaft to support fabric rolls on cardboard cores having max. Diameter of 400 mm.",
    "Fabric tensioning bars with adjustable incidence to control fabric tension during unwinding. It is equipped with a spreading roll and a bent bar that can be used alternatively by the operator according to the fabric being processed.",
    "Adjustable pressure of the fabric pressing cylinder- up to 0.6 MPA Printing unit model Homer K32 to print from 4 to 8 colors. Height adjustment of the printing carriage over the blanket Built-in electrical cabinet",
    "Operator interface controlling all machine operative parameters",
    "Blanket washing unit with driven brush and cleaning/drying sponges and wipers to remove water residues.",
    "Presence of Moving Roll for to obtain better results on thin(low GSM fabric).",
    "Ink Dust Exhauster",
    "Ink Circulation : When we give cleaning or fill up then inks go back to primary tank instead of getting waste.",
    "Auto Purging System : When head is at capping position, it keeps firing at regural interval, so nozzle remains moist.",
    "Large flow and high-speed degassing device",
    "Automatic negative pressure system",
    "Large memory Industrial server",
    "Tension-adjustable continous unwinding/rewinding control technology",
    "External Centring Device",
    "Air Blade"
  ]$j$::jsonb,
  header_fields = '["attn","date","ref","address"]'::jsonb,
  signoff_style = 'approved_by',
  doc_title = 'ORDER CONFIRMATION',
  has_template = true
where name = 'Position Printer' and has_template = false;

-- ── KoloRado Alpha 3.2 — 8 heads ────────────────────────────────────────────
-- ⚠ THESE TWO ALPHA DECKS DIFFER MATERIALLY FROM THE FIVE ALPHAS ALREADY IN
--   THE SYSTEM, so their clause bodies are transcribed fresh rather than reused:
--     · NOT INCLUDED — "Transportation Charges will be bear by us" (the five say
--       local transportation is NOT included and is the customer's)
--     · WARRANTY — "AMC charges will be applicable as per real time terms and
--       conditions" (the five say NO AMC applies if the customer uses Orange ink)
--     · CANCELLATION — opens with "Once order is placed; it will not be
--       cancelled" and closes with the loading/unloading insurance line
--   Two Alpha machines will therefore state different commercial terms from
--   their five siblings. OCPI-4 finding F17.
-- ⚠ Composition says "model KoloRado alpha III" on the 3.2 deck — carried
--   verbatim; see F16.
update public.fms_ocpi_machines set
  intro_text = 'Following up your kind order, we are glad to confirm the supply of KoloRado alpha 3.2 Digital Printing Machine at the under mentioned conditions',
  supply_description = 'Digital Sublimation Printing Machine KoloRado Alpha 3.2 (with {{head_count}} heads)',
  spec_rows = $j$[
    {"label":"No. of Machine Supply","value":"{{machine_count}}"},
    {"label":"Model","value":"KoloRado ALPHA 3.2"},
    {"label":"Number of print heads","value":"{{head_count}} Heads (Epson i3200)"},
    {"label":"Max. Printing width","value":"1800 mm | 2200 mm"},
    {"label":"Max. Media width","value":"1830 mm | 2230 mm"},
    {"label":"Electrical Voltage","value":"Printer：AC 220V +- 10%, 50/60 HZ"}
  ]$j$::jsonb,
  composition = $j$[
    "1000 Meter Roll Support",
    "Roll to Roll feeding system",
    "Printing unit model KoloRado alpha III to print from 2 to 4 colors.",
    "Built-in electrical cabinet.",
    "Operator interface controlling all machine operative parameters.",
    "Effective Drafting with the help of fans.",
    "Including INK if any, Custom Duty & Transportation charges will be paid by Customer."
  ]$j$::jsonb,
  header_fields = '["attn","date","address"]'::jsonb,
  signoff_style = 'checked_by',
  doc_title = 'ORDER CONFIRMATION',
  has_template = true
where name = 'KoloRado Alpha 3.2 — 8 heads' and has_template = false;

-- ── KoloRado Alpha 3 — 12 heads ─────────────────────────────────────────────
-- ⚠ The deck prints NO Date line — header_fields is attn + address only.
-- ⚠ Its composition carries "Front Dryer" while the master has
--   needs_dryer = false, which makes the whole Dryer details section
--   unreachable for this model. Raised as OCPI-4 finding F5; the flag is NOT
--   changed here.
update public.fms_ocpi_machines set
  intro_text = 'Following up your kind order, we are glad to confirm the supply of KoloRado alpha III Digital Printing Machine at the under mentioned conditions',
  supply_description = 'Digital Sublimation Printing Machine KoloRado Alpha III WITH ALL STANDARD ACCESSORIES (1.8 Meter) (with {{head_count}} heads)',
  spec_rows = $j$[
    {"label":"No. of Machine Supply","value":"{{machine_count}}"},
    {"label":"Model","value":"KoloRado alpha III"},
    {"label":"Number of print heads","value":"{{head_count}} Heads (Epson i3200)"},
    {"label":"Max. Printing width","value":"1800 mm | 2200 mm"},
    {"label":"Max. Media width","value":"1830 mm | 2230 mm"},
    {"label":"Electrical Voltage","value":"Printer：AC 220V +- 10%, 50/60 HZ"}
  ]$j$::jsonb,
  composition = $j$[
    "1000 Meter Roll Support",
    "Roll to Roll feeding system",
    "Printing unit model KoloRado alpha II to print from 2 to 4 colors.",
    "Built-in electrical cabinet.",
    "Operator interface controlling all machine operative parameters.",
    "Effective Drafting with the help of fans.",
    "Front Dryer",
    "Including INK if any, Custom Duty & Transportation charges will be paid by Customer."
  ]$j$::jsonb,
  header_fields = '["attn","address"]'::jsonb,
  signoff_style = 'checked_by',
  doc_title = 'ORDER CONFIRMATION',
  has_template = true
where name = 'KoloRado Alpha 3 — 12 heads' and has_template = false;

-- ── Fab Pro 1I ──────────────────────────────────────────────────────────────
-- 🔴 THE SOURCE DECK IS A FILLED-IN LIVE CONTRACT, NOT A BLANK TEMPLATE. It
--    carries customer PRINTING PARADISE, their Tirupur address, GST
--    33AAPFP8156P1ZD, the date 10/4/20206, the price ₹40,00,000 + ₹7,20,000 GST
--    = ₹47,20,000, and payment terms "25% Advance and remain in 8 equal PDC".
--    NONE of it is transcribed — it would put another customer's name, GST
--    number and price on every future Fab Pro contract. The customer, the money
--    and the terms all come from the deal. OCPI-4 finding F1.
-- ⚠ The deck's bank block is Orange O Tec ENTERPRISES / ICICI Noida-Sector 63,
--   and Fab Pro 2I's is ENTERPRISES / ICICI Athwalines — two different accounts
--   under one legal name, and neither entity has a company profile, so both Fab
--   Pros are unquotable until Finance supplies one. Not transcribed either way;
--   {{bank_block}} comes from the selling entity. Finding F12.
update public.fms_ocpi_machines set
  intro_text = 'Following up your kind order, we are glad to confirm the supply of Fabpro 1i Large Format Inkjet Printer Machine at the under mentioned conditions',
  machine_model_no = 'Fab Pro 1i',
  supply_description = 'DIRECT TO FABRIC INKJET PRINTER WITH STANDARD ACCESSORIES WITH {{head_count}} PRINTHEADS & WITH DRYER (LARGE FORMAT INKJET PRINTER)',
  spec_rows = $j$[
    {"label":"No. of Machine Supply","value":"{{machine_count}}"},
    {"label":"Model","value":"Fab Pro 1i"},
    {"label":"Number of installable rows","value":"one"},
    {"label":"Number of installed printing heads","value":"{{head_count}} Heads (Ricoh Gen 6)"},
    {"label":"Number of installable printing heads","value":"8 Heads"},
    {"label":"Max. Printing width","value":"1800 mm"},
    {"label":"Max. Blanket width","value":"1900 mm"},
    {"label":"Max. Media width","value":"1850 mm"},
    {"label":"Electrical Voltage","value":"AC220V~240V +- 10% single phase｜Printer (10 kW) + Belt Drying 1 belt + fins heater.\nDryer：AC 380V+-10% Three Phase 25A(10 Kw)"},
    {"label":"Compressed Air consumption","value":"0.6 Mpa｜3.5 m³/hr (Dry, No Oil or Water)"},
    {"label":"Rip software","value":"Neostampa"}
  ]$j$::jsonb,
  composition = $j$[
    "Ink feeding system complete with in-line filters and Degassing units.",
    "Driven unwinding unit with expanding shaft to support fabric rolls on cardboard cores having max. Diameter of 400 mm.",
    "Fabric tensioning bars with adjustable incidence to control fabric tension during unwinding. It is equipped with a spreading roll that can be used alternatively by the operator according to the fabric being processed.",
    "Adjustable pressure of the fabric pressing cylinder- up to 0.6 MPA Printing unit model Colorix Fab Pro 1i (8H) to print from 4 to 8 colors.",
    "Height adjustment of the printing carriage over the blanket Built-in electrical cabinet",
    "Operator interface controlling all machine operative parameters",
    "Blanket washing unit with driven brush and cleaning/drying sponges to remove water residues.",
    "Presence of Pinching Roll for to obtain better results on thin(low GSM fabric."
  ]$j$::jsonb,
  header_fields = '["attn","date","address"]'::jsonb,
  signoff_style = 'checked_by',
  doc_title = 'ORDER CONFIRMATION',
  has_template = true
where name = 'Fab Pro 1I' and has_template = false;

-- ── Fab Pro 2I ──────────────────────────────────────────────────────────────
update public.fms_ocpi_machines set
  intro_text = 'Following up your kind order, we are glad to confirm the supply of Fabpro 2i Large Format Inkjet Printer Machine at the under mentioned conditions',
  machine_model_no = 'Fab Pro 2i',
  supply_description = 'DIRECT TO FABRIC INKJET PRINTER WITH STANDARD ACCESSORIES WITH {{head_count}} PRINTHEADS & WITH DRYER (LARGE FORMAT INKJET PRINTER)',
  spec_rows = $j$[
    {"label":"No. of Machine Supply","value":"{{machine_count}}"},
    {"label":"Model","value":"Fab Pro 2i"},
    {"label":"Number of installable rows","value":"Two"},
    {"label":"Number of installed printing heads","value":"{{head_count}} Heads (Ricoh Gen 6)"},
    {"label":"Number of installable printing heads","value":"16 Heads"},
    {"label":"Max. Printing width","value":"1800 mm"},
    {"label":"Max. Blanket width","value":"1900 mm"},
    {"label":"Max. Media width","value":"1850 mm"},
    {"label":"Electrical Voltage","value":"AC220V~240V +- 10% single phase｜Printer (10 kW) + Belt Drying 1 belt + fins heater.\nDryer：AC 380V+-10% Three Phase 25A(10 Kw)"},
    {"label":"Compressed Air consumption","value":"0.6 Mpa｜3.5 m³/hr (Dry, No Oil or Water)"},
    {"label":"Rip software","value":"Neostampa"}
  ]$j$::jsonb,
  composition = $j$[
    "Ink feeding system complete with in-line filters and Degassing units.",
    "Driven unwinding unit with expanding shaft to support fabric rolls on cardboard cores having max. Diameter of 400 mm.",
    "Fabric tensioning bars with adjustable incidence to control fabric tension during unwinding. It is equipped with a spreading roll that can be used alternatively by the operator according to the fabric being processed.",
    "Adjustable pressure of the fabric pressing cylinder- up to 0.6 MPA Printing unit model Colorix Fab Pro 2i (16H) to print from 4 to 8 colors.",
    "Height adjustment of the printing carriage over the blanket Built-in electrical cabinet",
    "Operator interface controlling all machine operative parameters",
    "Blanket washing unit with driven brush and cleaning/drying sponges to remove water residues.",
    "Presence of Pinching Roll for to obtain better results on thin(low GSM fabric."
  ]$j$::jsonb,
  header_fields = '["attn","date","ref","address"]'::jsonb,
  signoff_style = 'checked_by',
  doc_title = 'ORDER CONFIRMATION',
  has_template = true
where name = 'Fab Pro 2I' and has_template = false;

-- ── JP7 ─────────────────────────────────────────────────────────────────────
-- ⚠ HEADED "OFFER QUOTE", like P8D. doc_title no longer drives the printed
--   heading (docHeading(deal) does, from the stage) but the Machines grid and
--   the template editor both show it, so it is recorded truthfully.
-- ⚠ The deck's supply line says "without dryer" while the master has
--   needs_dryer = true. The flag means "can take one"; not changed. Finding F6.
-- ⚠ Its warranty clause ends "Printheads warranty : Please refer enclosed
--   Policy document for Printheads" — that enclosure is NOT in the source
--   folder, so the sentence references a document nobody has. Finding F13.
update public.fms_ocpi_machines set
  doc_title = 'OFFER QUOTE',
  intro_text = 'Following up your kind request, we are glad to confirm you the following machinery at the terms and conditions specified below:-',
  machine_model_no = 'MS JP7',
  supply_description = 'INK-JET PRINTING MACHINE MODEL MS-JP7 -{{head_count}} PRINTING HEADS without dryer– Printing width 180cm, complete with the following accessories.',
  spec_rows = $j$[
    {"label":"No. of Machine Supply","value":"{{machine_count}}"},
    {"label":"Model","value":"MS JP7"},
    {"label":"Number of installed rows","value":"2"},
    {"label":"Number of installable rows","value":"2"},
    {"label":"Number of installed printing heads","value":"{{head_count}}"},
    {"label":"Number of installable printing heads","value":"16"},
    {"label":"Max. Printing width","value":"1800 mm"},
    {"label":"Max. Fabric width","value":"1800 mm"},
    {"label":"Electrical Voltage","value":"380 Volts - 50 Hz – III"},
    {"label":"Compressed Air consumption","value":"approx.150 lts/min @six bars"},
    {"label":"Water Consumption","value":"approx. max. consumption 200 lts/hour"},
    {"label":"Installed electrical power","value":"39 KVA"},
    {"label":"Software","value":"Neo Stampa Software Included"},
    {"label":"Manufacturer of the Machine","value":"MS Printing Solutions S.r.l.\nVia Bergamo, 1910 – 21042,\nCaronno Pertusella (VA) – IT\nT: +39.02.9650169 | F: 9.02.9656218\nwww.msitaly.com"}
  ]$j$::jsonb,
  composition = $j$[
    "Ink feeding system complete with in-line filters and Degassing units.",
    "Driven unwinding unit with expanding shaft to support fabric rolls on cardboard cores having max. Diameter of 400 mm.",
    "Fabric tensioning bars with adjustable incidence to control fabric tension during unwinding. It is equipped with a spreading roll and a bent bar that can be used alternatively by the operator according to the fabric being processed.",
    "Adjustable pressure of the fabric pressing cylinder.-",
    "Printing unit model MS JP7 to print from 4 to 8 colors.",
    "Height adjustment of the printing carriage over the blanket.-",
    "Built-in electrical cabinet.",
    "Operator interface controlling all machine operative parameters.-",
    "Blanket washing unit with driven brush and cleaning/drying squeegees to remove water residues.",
    "Tangential winding on drive rubber-covered cylinders at the outlet of the dryer to wind fabrics on paper cardboards. Tension control by compensating device."
  ]$j$::jsonb,
  header_fields = '["attn","date","ref","address"]'::jsonb,
  signoff_style = 'approved_by',
  has_template = true
where name = 'JP7' and has_template = false;

-- ── JPK ─────────────────────────────────────────────────────────────────────
-- ⚠ THE DECK'S SPEC TABLE HAS NEITHER "No. of Machine Supply" NOR an "installed
--   printing heads" ROW — the only one of the 28 without them. Both are ADDED
--   here as tokens, because the deal genuinely varies both and every other
--   machine states them. Finding F11.
-- ⚠ The deck prices in EURO. The module supports INR and USD only, so a JPK
--   deal cannot be quoted in its own currency today. Finding F9 — a module gap,
--   not a template one; nothing about the currency is transcribed.
-- ⚠ Its supply line says "(Without Dryer)" while slide 3 carries a full Dryer
--   Information block naming POWER-D Dryer (ELECTRIC). Finding F7.
update public.fms_ocpi_machines set
  intro_text = 'Following up your kind request, we are glad to offer you the following machinery at the terms and conditions specified below:-',
  machine_model_no = 'MS-JPK-evo V4',
  supply_description = 'Total amount of the supply MS JPK EVO V4 (Without Dryer)',
  spec_rows = $j$[
    {"label":"No. of Machine Supply","value":"{{machine_count}}"},
    {"label":"Model","value":"MS-JPK-evo V4"},
    {"label":"Number of installable rows","value":"4"},
    {"label":"Number of installed printing heads","value":"{{head_count}}"},
    {"label":"Number of installable printing heads","value":"32"},
    {"label":"Number of colors","value":"8"},
    {"label":"Max. printing width","value":"1800 mm"},
    {"label":"Max. fabric width","value":"1820 mm"},
    {"label":"Electrical Voltage","value":"400 V - 50 Hz-Ill"},
    {"label":"Compressed Air consumption","value":"approx. max 150 l/min - 7 bar"},
    {"label":"Water Consumption","value":"clean and filtered — approx. max.\nConsumption 200-800 I/h — 2 bar-"},
    {"label":"Installed electrical power","value":"40 kVA for the printer\n50 kVA for the dryer"},
    {"label":"RIP software","value":"Included"},
    {"label":"Designing software","value":"Not Included"},
    {"label":"PC for the rip","value":"Not Included"}
  ]$j$::jsonb,
  composition = $j$[
    "Driven unwinding unit with expanding shaft to support rolls on cardboard cores 50mm diameter having max. roll diameter of 400 mm. The cardboard core must have internal diameter of 50 mm / 2 inches.",
    "Support tensioning bars with adjustable incidence to control tension during unwinding.",
    "It is equipped with a spreading roll and a bent bar that can be used alternatively by the operator according to the support processed.",
    "Adjustable pressure and heated cylinder for the support to be printed; non-stop function synchronized with the blanket movement.",
    "High speed printing group model MS-JPK-evo with 4 rows in line.",
    "Ink feeding system complete with in-line filters and degassing units.",
    "Automatically cleaning system for printing heads; each colour can be selected individually",
    "Height adjustment of the printing carriage up to 25 mm over the printing blanket.",
    "Built-in electrical cabinet.",
    "Operator interface with touch screen display, controlling all machine operative parameters.",
    "Double anti-crash sensor to avoid eventual crash of the printing carriage with the support being printed in case of wrinkles or bad made seams or else.",
    "Roomy heads-maintenance area on the right side of the machine, granting comfortable access to the printing heads for cleaning, check-up and maintenance operation.",
    "Blanket washing unit with driven brush and cleaning/drying squeegees to remove water residue.",
    "Ink drust exhauster",
    "Heated driven movable pressure roll",
    "Winder for heated movable pressure roll",
    "Washing unit spong group",
    "Air Blade",
    "Axial Finding device from (E+L)",
    "Brushes device for unwinding"
  ]$j$::jsonb,
  header_fields = '["attn","date","ref","address"]'::jsonb,
  signoff_style = 'approved_by',
  doc_title = 'ORDER CONFIRMATION',
  has_template = true
where name = 'JPK' and has_template = false;

-- ── Rocket ──────────────────────────────────────────────────────────────────
-- Source: ROCKET  MACHINE  OC.docx (14 pages) for everything below, plus the
-- priced description from ROCKET MACHINE.docx.
-- ⚠ TRANSCRIBED FROM THE WORD XML, NOT A PAGE RENDER, and that is safe here:
--   the fusing problem is a PowerPoint shape/run artefact. In a .docx, document
--   order IS reading order and the text extracted with its spacing intact.
-- ⚠ Its OC is headed "Quotation". doc_title stays ORDER CONFIRMATION — the TS
--   union and the Machines form offer only two values, and doc_title no longer
--   drives the printed heading. Finding F14.
-- ⚠ The document carries a 2.9 MB machine LAYOUT DRAWING behind its "Layout :"
--   line. fms_ocpi_machine_sections is text and the renderer draws no images,
--   so the drawing and that line are left out. Finding F10.
-- ⚠ Its MACHINE WARRANTY says 24 months. {{machine_warranty_months}} is fixed
--   company config at 12, so this contract will print 12. Raised, not
--   hard-coded. Finding F2.
update public.fms_ocpi_machines set
  intro_text = 'We take this opportunity to thank you for your interest shown in our offered Homer’s Rocket hybrid single pass &rotary screen printing machine and are please to submit this order confirmation as per below-mentioned details and specification mentioned in rest of the document.',
  machine_model_no = 'HMSINGLEPASS 1800-ROCKET-K',
  supply_description = 'STANDARD DIGITAL DIRECT-TO-FABRIC TEXTILE PRINTING MACHINE WITH STANDARD ACCESSORIES KYOCERA EX600 RC PRINTHEAD WITH DRYER (MODEL: HMSINGLEPASS 1800-ROCKET-K) (HSN Code: 84433910)',
  spec_rows = $j$[
    {"label":"No. of Machine Supply","value":"{{machine_count}}"},
    {"label":"Model Number","value":"HMSINGLEPASS 1800-ROCKET-K"},
    {"label":"Printing Width","value":"1515 mm"},
    {"label":"Working width","value":"1800 MM"},
    {"label":"Fabric Width","value":"1800 MM"},
    {"label":"Production Speed","value":"40 to 80 MPM"},
    {"label":"Fabric type","value":"Woven, 80-300 GSM"},
    {"label":"Print Ink Material","value":"Reactive"},
    {"label":"Dryer","value":"Heating by Thermic Oil"},
    {"label":"Working temperature","value":"20 to 26 C"},
    {"label":"Humidity","value":"45-60 % (No condensation)"},
    {"label":"Number of installed printing heads","value":"{{head_count}} for 1515 mm printing width"},
    {"label":"Max. Accuracy","value":"1200*2400DPI"},
    {"label":"Number of installable printing heads","value":"272"},
    {"label":"Printing Head","value":"Industrial-grade piezoelectric nozzle (Kyocera, Japan)"},
    {"label":"Number of installable rows","value":"4 module 8 Colours"},
    {"label":"Rotary attachment","value":"Jilong, 4 rotary attachment."},
    {"label":"RIP software","value":"Neostampa"},
    {"label":"Install Power","value":"145 Kw ( Dryer & rotary110 Kw)\nAC380V±10%, 3-Phrase| 50Hz/60 Hz"},
    {"label":"Water","value":"0.5 to 1 m3/Hr"},
    {"label":"Air","value":"0.15 m3/Hr"}
  ]$j$::jsonb,
  composition = $j$[
    "Motorized Winder and Unwinder",
    "Fabric Opening Device",
    "Conveyor Belt System",
    "Fabric Pressing Cylinder",
    "Printing Head Module",
    "Height Adjustment of Printing Carriage",
    "Ink Circulation System",
    "Degassing & Negative Pressure System",
    "Ink Supply System",
    "Rotary Printing Attachment",
    "Dryer System",
    "Electronic Parts"
  ]$j$::jsonb,
  header_fields = '["attn","date","ref","address"]'::jsonb,
  signoff_style = 'approved_by',
  doc_title = 'ORDER CONFIRMATION',
  has_template = true
where name = 'Rocket' and has_template = false;


-- ============================================================================
-- SECTIONS
--
-- Every loop below skips a machine that already has sections, so a re-run is a
-- no-op and the existing ten are untouchable.
--
-- ⚠ THE HOMER-LINEAGE CLAUSES ARE COPIED FROM Homer K24 IN SQL, NOT RETYPED.
--   K64's and Position Printer's decks carry, word for word, the same seven
--   clauses as K24's — installation, not included, delivery scope, PC spec,
--   machine warranty, print-head policy and customer's care. Copying the rows
--   is what the app's own `copyTemplate` does; it guarantees byte-identical
--   text, and it means the reworded head-price sentence (client-approved
--   29-Aug-2026) is inherited rather than re-keyed and possibly re-broken.
--   Only the two clauses that genuinely differ per deck — sale conditions and
--   cancellation — are written out.
-- ============================================================================

do $seed$
declare
  v_id uuid;
  v_src uuid;
  v_name text;
begin
  select id into v_src from public.fms_ocpi_machines where name = 'Homer K24';
  if v_src is null then
    raise exception 'Homer K24 not found - cannot copy the Homer-lineage clauses';
  end if;

  foreach v_name in array array['K64','Position Printer'] loop
    select id into v_id from public.fms_ocpi_machines where name = v_name;
    if v_id is null then continue; end if;
    if exists (select 1 from public.fms_ocpi_machine_sections where machine_id = v_id) then continue; end if;

    insert into public.fms_ocpi_machine_sections (machine_id, key, title, body, sort_order)
    select v_id, s.key, s.title, s.body, s.sort_order
      from public.fms_ocpi_machine_sections s
     where s.machine_id = v_src
       and s.key in ('installation','not_included','delivery_scope','pc_spec',
                     'machine_warranty','head_policy','customer_care');
  end loop;

  -- K64 · its own sale conditions (the Forex clause rides on the Insurance row)
  select id into v_id from public.fms_ocpi_machines where name = 'K64';
  if v_id is not null and not exists (
    select 1 from public.fms_ocpi_machine_sections where machine_id = v_id and key = 'sale_conditions'
  ) then
    insert into public.fms_ocpi_machine_sections (machine_id, key, title, body, sort_order) values
      (v_id, 'sale_conditions', 'SALE CONDITIONS OF THE SUPPLY',
       'Transport Terms: {{trade_term}}' || chr(10) ||
       'Delivery Days: {{delivery_days}}' || chr(10) ||
       'Payment terms: {{payment_terms}}' || chr(10) ||
       'Insurance: Product Insurance borne by Customer.' || chr(10) ||
       'Forex Impact Clause: If payment terms exceed 3 months with equal instalments, the Dollar exchange difference will be adjusted via Debit Note/Credit Note' || chr(10) || chr(10) ||
       'Bank Details:' || chr(10) || '{{bank_block}}', 10),
      (v_id, 'cancellation', 'CANCELLATION',
       'Our offer and quotation is valid for {{quotation_validity_days}} days only. This contract will enter into validity only when we receive duly signed order by you as an acceptance within validity period of the quotation.' || chr(10) || chr(10) ||
       'All the dates and timelines mentioned in proposal are indicative and usual tolerance are admitted.' || chr(10) || chr(10) ||
       'We hope this offer meets your desires. Please do not hesitate to contact us for any additional questions.' || chr(10) || chr(10) ||
       'Thanking you and assuring you of best services and co-operations at all time.' || chr(10) || chr(10) ||
       'We request you to submit the copy of duly signed order confirmation by you to us for acceptance.' || chr(10) || chr(10) ||
       'Once again thanking you and please feel free to revert for any kind of queries or clarification from our end.' || chr(10) || chr(10) ||
       'Loading & Unloading of Machine at Customers Premises, Insurance will be bare by Customer.', 90);
  end if;

  -- Position Printer · its own sale conditions; cancellation also carries Forex
  select id into v_id from public.fms_ocpi_machines where name = 'Position Printer';
  if v_id is not null and not exists (
    select 1 from public.fms_ocpi_machine_sections where machine_id = v_id and key = 'sale_conditions'
  ) then
    insert into public.fms_ocpi_machine_sections (machine_id, key, title, body, sort_order) values
      (v_id, 'sale_conditions', 'SALE CONDITIONS OF THE SUPPLY',
       'Trade Terms (Machine): {{trade_term}}' || chr(10) ||
       'Shipment Terms: {{delivery_days}}' || chr(10) ||
       'Payment Terms: {{payment_terms}}' || chr(10) ||
       'Insurance: Insurance will borne by Customer.' || chr(10) || chr(10) ||
       'Bank Details:' || chr(10) || '{{bank_block}}', 10),
      (v_id, 'cancellation', 'CANCELLATION',
       'Our offer and quotation is valid for {{quotation_validity_days}} days only. This contract will enter into validity only when we receive duly signed order by you as an acceptance within validity period of the quotation.' || chr(10) || chr(10) ||
       'All the dates and timelines mentioned in proposal are indicative and usual tolerance are admitted.' || chr(10) || chr(10) ||
       'We hope this offer meets your desires. Please do not hesitate to contact us for any additional questions.' || chr(10) || chr(10) ||
       'Thanking you and assuring you of best services and co-operations at all time.' || chr(10) || chr(10) ||
       'We request you to submit the copy of duly signed order confirmation by you to us for acceptance.' || chr(10) || chr(10) ||
       'Once again thanking you and please feel free to revert for any kind of queries or clarification from our end.' || chr(10) || chr(10) ||
       'Loading & Unloading of Machine at Customers Premises, Insurance will be bare by Customer.' || chr(10) || chr(10) ||
       'If payment terms exceed 3 months with equal instalments, the Dollar exchange difference will be adjusted via Debit Note/Credit Note.', 90);
  end if;
end $seed$;


-- ── Alpha pair · fresh bodies, because these decks differ from the five ──────
-- See finding F17 on the machine block above.
-- ⚠ "maximum 13 months from the invoice date" is the 3.2-8 deck's own qualifier
--   and is kept beside {{machine_warranty_months}}. Config is 12 today, so it
--   prints exactly what the deck says. If the company warranty period is ever
--   changed, THIS SENTENCE STOPS MAKING SENSE ("24 months, maximum 13 months")
--   — the same trap tokens.ts records for the old warranty dropdown. Flagged
--   rather than silently dropped, because the qualifier is contract content.
do $seed$
declare
  v_id uuid;
  v_name text;
  c_install text := $b$Installation process will take place under the supervision of a specially trained engineer. All the product manuals and service manuals, diagrams and drawing and other literature will be available in English language.$b$;
  c_not_incl text := $b$Lodging and boarding charges are not included, and it is to be bare by client/customer or need to paid extra at actual. Transportation Charges will be bear by us.

Our technician must be supported by your personnel according to our requirements. Utilities connection works at your care and charge.

Before the installation can start the customer has to have finished the foundation works according to our Plan, the supply of electric energy, compressed air etc.$b$;
  c_scope text := $b$As applicable to above equipment specification the prices do not include. Compressor, UPS, AC and Humidifier.

Customer is also responsible to provide all equipment necessary for the unloading and keeping machine at the required place.

Hardware: NOT INCLUDED: at customer care and charge.$b$;
  c_pc text := $b$One PC - Configuration:
Windows 7
Mother board Intel Core I5 or I7, 64 Bit
16 Gb RAM
HDD: 1 TB
250Gb SSD
USB 2.0 Port

To avoid any possible problem please send us an email with the complete list of components to be checked for compatibility. Please also inform in any case you have any problem to find above mentioned components.$b$;
  c_warranty_tail text := $b$After completion of warranty, AMC charges will be applicable as per real time terms and conditions of the company.

Orange will be responsible to deliver or replace only those parts which are supplied by Orange.

In case technical intervention is necessary, company will bear technician cost only while lodging and boarding shall be bear by client/customer.

Company will not be responsible for any damage due to non-technical reason like physical damage, mishandling, environmental reason, and improper setup. In such case technician cost will also be chargeable and invoice will be generated for same.

Our Service Person can visit the Digital Printer Room anytime during the Working Hours with Your Supervisor

Consumable Items are not considered under warranty

Consumable items: To be purchased directly from M/s {{consumables_supplier}} only.

Working condition requirements:
The working environment: Operating temperature range of 20 degree to 24 degree Celsius & Operating humidity between 40% to 60%.

Atmosphere should not be dusty and temperature changes should not be excessive. It may cause irreversible damage to Machine & Print head.

Outside of these conditions is not possible to ensure the proper functioning of machine, ink, other parts and consumable.

It’s also recommended to verify the level of adhesion of the carpet before you start printing, bringing it to the operating temperature to prevent detachment of textile with probable damage to the print heads.

Request you to have camera installed on machines which covers the whole carriage area when machine is in use.in case if camera is not installed or not working, unfortunately we won’t be able to take responsibility of the Print heads in case of any mishap

Keep the power supply of the machine and compressor ON, take the test draw timely and even run a full density test for 15 to 20 meters in the time interval of two hours failing to do it could result in clogged nozzles of heads which are not even acceptable by Kyocera also.$b$;
  c_care text := $b$Masonry works and excavations external connections to the machine and between interactive systems (Electrical lines, Compressed Air, etc.) according to our technical specifications; any exhausts and outgoing air conduits; any lifting equipment and means of transportation necessary for assembly; Possible walkways and grids; Possible voltage stabilizer for tension oscillations +/-5% over the declared value; All liabilities related to the assessment of static capacity and dynamics of the building's structure, in the machine's installation area and all legal procedures (whenever requested by local authorities) for the installation and activation of the system; Anything not mentioned in the a.m. offer text.- Inks, Consumables, etc in general.$b$;
  c_cancel text := $b$Once order is placed; it will not be cancelled. In unavoidable situation or in particular case it required to cancel, any kind of payment made will not be refundable or adjustable.

Our offer and quotation is valid for {{quotation_validity_days}} days only. This contract will enter into validity only when we receive duly signed order by you as an acceptance within validity period of the quotation.

All the dates and timelines mentioned in proposal are indicative and usual tolerance are admitted.

We hope this offer meets your desires. Please do not hesitate to contact us for any additional questions.

Thanking you and assuring you of best services and co-operations at all time

We request you to submit the copy of duly signed order confirmation by you to us for acceptance.

Once again thanking you and please feel free to revert for any kind of queries or clarification from our end.

Loading & Unloading of Machine at Customers Premises, Insurance will be bare by Customer.$b$;
begin
  foreach v_name in array array['KoloRado Alpha 3.2 — 8 heads','KoloRado Alpha 3 — 12 heads'] loop
    select id into v_id from public.fms_ocpi_machines where name = v_name;
    if v_id is null then continue; end if;
    if exists (select 1 from public.fms_ocpi_machine_sections where machine_id = v_id) then continue; end if;

    insert into public.fms_ocpi_machine_sections (machine_id, key, title, body, sort_order) values
      (v_id, 'sale_conditions', 'SALE CONDITIONS OF THE SUPPLY',
        'Transport Terms: {{trade_term}}' || chr(10) ||
        'Delivery Days: {{delivery_days}}' || chr(10) ||
        'Payment Terms: {{payment_terms}}' || chr(10) ||
        case when v_name = 'KoloRado Alpha 3 — 12 heads'
             then 'Forex Clause Impact: If payment terms exceed 3 months with equal instalments, the Dollar exchange difference will be adjusted via Debit Note/ Credit Note' || chr(10)
             else '' end ||
        'Insurance: Product Insurance is Borne by Customer.' || chr(10) || chr(10) ||
        'Bank Details:' || chr(10) || '{{bank_block}}', 10),
      (v_id, 'installation',   'INSTALLATION AND START-UP', c_install, 20),
      (v_id, 'not_included',   'NOT INCLUDED', c_not_incl, 30),
      (v_id, 'delivery_scope', 'NOT INCLUDED IN OUR DELIVERY SCOPE', c_scope, 40),
      (v_id, 'pc_spec',        'FOR THE GOOD OPERABILITY OF THE MACHINE, WE SUGGEST THE FOLLOWING SET UP OR SIMILAR', c_pc, 50),
      (v_id, 'warranty',       'WARRANTY',
        case when v_name = 'KoloRado Alpha 3.2 — 8 heads'
             then 'Warranty period will be of {{machine_warranty_months}} months, maximum 13 months from the invoice date., except print head and consumables, from the date of installation and it will be treated as onsite warranty.'
             else 'Warranty period will be of {{machine_warranty_months}} months, except print head and consumables, from the date of installation and it will be treated as onsite warranty.'
        end || chr(10) || chr(10) || c_warranty_tail, 60),
      (v_id, 'customer_care',  'WORKS AT CUSTOMER''S CARE AND EXCLUSIONS', c_care, 70),
      (v_id, 'cancellation',   'CANCELLATION', c_cancel, 80);
  end loop;
end $seed$;


-- ── Fab Pro pair · its own clause set (Enterprises entity, Ricoh heads) ──────
-- ⚠ THE HEAD-PRICE SENTENCE IS REWORDED, NOT TRANSCRIBED. Both decks say "In
--   case of any Physical damage, new print head to be purchased at a price of
--   1.75 lacs plus GST". {{post_warranty_head_price}} is retired, and a literal
--   1.75 lacs would freeze a price into every future contract. The clause opens
--   with the client-approved wording already live on K24/K32/P8D/P8S instead.
--   Finding F3.
-- ⚠ Fab Pro 2I's sale-conditions labels read only "Terms:" and "Delivery:".
--   Fab Pro 1I's fuller labels are used for both, since the bare ones name no
--   term at all. The values are tokens either way.
do $seed$
declare
  v_id uuid;
  v_name text;
  c_install text := $b$Installation process will take place under the supervision of a specially trained engineer. All the product manuals and service manuals, diagrams and drawing and other literature will be available in English language.$b$;
  c_not_incl text := $b$Lodging, boarding and local transportation charges are not included, and it is to be bare by client/customer or need to paid extra at actual.

Our technician must be supported by your personnel according to our requirements. Utilities connection works at your care and charge.

Before the installation can start the customer has to have finished the foundation works according to our Plan, the supply of electric energy, water, compressed air etc.$b$;
  c_scope text := $b$As applicable to above equipment specification the prices do not include. Compressor, UPS, AC and Humidifier.

Customer is also responsible to provide all equipment necessary for the unloading and keeping machine at the required place.

Hardware: NOT INCLUDED: at customer care and charge.$b$;
  c_pc text := $b$One PC - configuration:
Windows 10
Mother board Intel core I7, 64 bit, clocked @ 4 GHZ
32gb RAM
Graphic card
Gbyte HDD: 7200rpm at least 200Gbyte + 120GB SSD
LAN 2.0 Port

To avoid any possible problem please send us an email with the complete list of components to be checked for compatibility. Please also inform in any case you have any problem to find above mentioned components.$b$;
  c_mwarranty text := $b$Machine Warranty period will be of {{machine_warranty_months}} months from the date of installation, where damaged parts will be replaced free of cost subject to damage not caused due to the below mentioned reasons:

Machine environment does not meet the requirement of machine as guidelines given
Dismantling or refitting without our permission
Destruction by external forces
If daily maintenance is not carried out for more than 2 times as per maintenance sheet provided by Orange
Spare parts used in machine, which are not supplied by "Orange O Tec Enterprises Pvt Ltd."
Other human errors$b$;
  c_head text := $b$Orange O Tec offers a Print Head Warranty of {{head_warranty_months}} months starting from shipping date from China. After that period, replacement print heads will be supplied at the prices prevailing at the time of purchase.

Under the premise that the buyer uses the ink provided by the seller, the seller shall provide the print head warranty. The buyer and the seller shall keep the print head testing bar signed by both parties on the day of installation completion.

In case of print head damage not caused by the buyer during the warranty period, the damaged print head can be replaced free of charge (the old replaced print head shall be returned to the seller). However, the warranty on the first replaced print will be for 12 months or balance warranty whichever is Higher.

New print head bought post 18 months shall carry warranty 12 months from the date of installation.

Any print head replaced under the program of balance warranty shall carry the balance warranty from the date of replaced print head installation.

The print head should be operated under print head specification requirement according to the machine maintenance list. The damage reason belong to the buyer's responsibility includes (but is not limited to) the following:
1. Modification or disassembling on print head.
2. Mechanical shock applied to the print head.
3. Liquid contact on terminals of connectors.
4. Print head operation under harsh environment.
5. Physical contact on nozzle plane with contaminated materials.
6. Using of the ink which is uncertified by seller.
7. Congealed ink clogged the nozzles.

Please consider the below points for print head to be replaced under warranty:
Do not use Inks which is uncertified by seller.
Do not apply hard mechanical shock or impact to the print head.
Do not disassemble or modify the Print Head.
Do not operate Print Head under harsh environment like dusty or humid climate or direct sunlight.
Do not adhere liquid and foreign material onto the area where it can enter inside the print head
Clogged nozzle due to dry Inks.
Do not touch Nozzle plane with any contaminated materials.

After completion of warranty, AMC charges will be applicable as per real time terms and conditions of the company.

Orange will be responsible to deliver or replace only those parts which are supplied by Orange.

In case technical intervention is necessary, company will bear technician cost only while lodging, boarding, and travelling charges shall be bear by client/customer.

Company will not be responsible for any damage due to non-technical reason like physical damage, mishandling, environmental reason, and improper setup. In such case technician cost will also be chargeable and invoice will be generated for same.

During warranty period spar parts replacement is considered at Orange site only. Delivery to client site, import duty and other charges, taxation and any other handling charges are supposed to be bear by client/customer.

Our Service Person can visit the Digital Printer Room anytime during the Working Hours with Your Supervisor

Consumable Items are not considered under warranty

Exclusions: Ricoh Printing Heads subject to normal wear & tear.

Consumable items: To be purchased directly from M/s {{consumables_supplier}} only.

Working condition requirements:
The working environment must be air conditioned as Ricoh heads work properly and give better results within temperature range of 22 degree to 28 degree Celsius and relative humidity between 50 to 60%.

Atmosphere should not be dusty and temperature changes should not be excessive. It may cause irreversible damage to print head.

Outside of these conditions is not possible to ensure the proper functioning of machine, ink, other parts and consumable.

It’s also recommended to verify the level of adhesion of the carpet before you start printing, bringing it to the operating temperature to prevent detachment of textile with probable damage to the print heads.

Request you to have camera installed on machines which covers the whole carriage area when machine is in use.in case if camera is not installed or not working, unfortunately we won’t be able to take responsibility of the Print heads in case of any mishap$b$;
  c_care text := $b$Masonry works and excavations external connections to the machine and between interactive systems (electrical lines, gas, water, compressed air, steam and oil, etc.) according to our technical specifications; any exhausts and outgoing air conduits; any lifting equipment and means of transportation necessary for assembly; Possible walkways and grids; Possible voltage stabilizer for tension oscillations +/-5% over the declared value; All liabilities related to the assessment of static capacity and dynamics of the building's structure, in the machine's installation area and all legal procedures (whenever requested by local authorities) for the installation and activation of the system; Anything not mentioned in the a.m. offer text.- Blanket adhesives, chemicals, inks, and consumables in general.$b$;
  c_cancel text := $b$Once order is placed; it will not be cancelled. In unavoidable situation or in particular case it required to cancel, any kind of payment made will not be refundable or adjustable.

Our offer and quotation is valid for {{quotation_validity_days}} days only. This contract will enter into validity only when we receive duly signed order by you as an acceptance within validity period of the quotation.

All the dates and timelines mentioned in proposal are indicative and usual tolerance are admitted.

We hope this offer meets your desires. Please do not hesitate to contact us for any additional questions.

Thanking you and assuring you of best services and co-operations at all time

We request you to submit the copy of duly signed order confirmation by you to us for acceptance.

Once again thanking you and please feel free to revert for any kind of queries or clarification from our end.$b$;
begin
  foreach v_name in array array['Fab Pro 1I','Fab Pro 2I'] loop
    select id into v_id from public.fms_ocpi_machines where name = v_name;
    if v_id is null then continue; end if;
    if exists (select 1 from public.fms_ocpi_machine_sections where machine_id = v_id) then continue; end if;

    insert into public.fms_ocpi_machine_sections (machine_id, key, title, body, sort_order) values
      (v_id, 'sale_conditions', 'SALE CONDITIONS OF THE SUPPLY',
        'Trade Terms: {{trade_term}}' || chr(10) ||
        'Delivery Terms: {{delivery_days}}' || chr(10) ||
        'Payment terms: {{payment_terms}}' || chr(10) ||
        'Insurance: Insurance will be borne by customer.' || chr(10) || chr(10) ||
        'Bank Details:' || chr(10) || '{{bank_block}}', 10),
      (v_id, 'installation',     'INSTALLATION AND START-UP', c_install, 20),
      (v_id, 'not_included',     'NOT INCLUDED', c_not_incl, 30),
      (v_id, 'delivery_scope',   'NOT INCLUDED IN OUR DELIVERY SCOPE', c_scope, 40),
      (v_id, 'pc_spec',          'FOR THE GOOD OPERABILITY OF THE MACHINE, WE SUGGEST THE FOLLOWING SET UP OR SIMILAR', c_pc, 50),
      (v_id, 'machine_warranty', 'MACHINE WARRANTY', c_mwarranty, 60),
      (v_id, 'head_policy',      'PRINT HEAD POLICY PROGRAM', c_head, 70),
      (v_id, 'customer_care',    'WORKS AT CUSTOMER''S CARE AND EXCLUSIONS', c_care, 80),
      (v_id, 'cancellation',     'CANCELLATION', c_cancel, 90);
  end loop;
end $seed$;


-- ── JP7 · the MS Italy clause set ───────────────────────────────────────────
-- Introduces `working_environment`, a key no existing machine uses. The
-- renderer draws whatever the machine declares in its own order, so a new key
-- needs no code change.
do $seed$
declare
  v_id uuid;
begin
  select id into v_id from public.fms_ocpi_machines where name = 'JP7';
  if v_id is null then return; end if;
  if exists (select 1 from public.fms_ocpi_machine_sections where machine_id = v_id) then return; end if;

  insert into public.fms_ocpi_machine_sections (machine_id, key, title, body, sort_order) values
    (v_id, 'sale_conditions', 'SALE CONDITIONS OF THE SUPPLY',
      'Terms: {{trade_term}}' || chr(10) ||
      'Shipment: {{delivery_days}}' || chr(10) ||
      'Payment Terms: {{payment_terms}}' || chr(10) ||
      'Insurance: Covered by customer.' || chr(10) || chr(10) ||
      'Bank Details:' || chr(10) || '{{bank_block}}', 10),
    (v_id, 'installation', 'INSTALLATION AND START-UP',
      $b$For the supervision of the installation we provide one specially trained engineer. Operation manuals, maintenance books and electric diagrams are in English language.$b$, 20),
    (v_id, 'not_included', 'NOT INCLUDED',
      $b$At your charge: board and lodging + local transportation.

Our technician must be supported by your personnel according to our requirements.

Utilities connection works at your care and charge.

Before the installation can start the customer has to have finished the foundation works according to our plan, the supply of electric energy, water, compressed air etc.$b$, 30),
    (v_id, 'delivery_scope', 'NOT INCLUDED IN OUR DELIVERY SCOPE',
      $b$As applicable to above equipment specification the prices do not include. Compressor, UPS, AC and Humidifier.

Customer is also responsible to provide all equipment necessary for the unloading and keeping machine at the required place.

Hardware: NOT INCLUDED: at customer care and charge.

Ethernet Card and Cable: [MYRICOM OPTICAL DATA TRANSFER BOARD 10GBE + TRANSCEIVER FTLX8571D3BCL for MYRICOM OPTICAL DATA TRANSFER BOARD + OPTICAL FIBER CABLE L=25Mt].$b$, 40),
    (v_id, 'pc_spec', 'FOR THE GOOD OPERABILITY OF THE MACHINE, WE SUGGEST THE FOLLOWING SET UP OR SIMILAR',
      $b$One PC - configuration: Windows OS, mother board Intel core I7, 64 bit, 32gb RAM, graphic card, Extra PCI slot for Ethernet card. Gbyte HD: 7200rpm at least 200Gbyte.- USB 2.0 Port. At least one serial port RS232 on mother board. Graphic Video adapter AGP or PCI Ex not on mother board, ATI or NVidia with at least 128MByte ram.

Mainboard with 1 free PCIe slot (not for video card) at speed 8x. CPU Intel i7-3770K or higher, RAM 16GB.

NB: NO SIMILAR CHARACTERISTICS ARE ACCEPTABLE.

To avoid any possible problem please send us an email with the complete list of components to be checked for compatibility. Please also inform in any case you have any problem to find above mentioned components.$b$, 50),
    (v_id, 'warranty', 'WARRANTY',
      $b$Machine warranty will be {{machine_warranty_months}} months from start-up date and AMC charges applicable for service after completion of first year, as per the future T&C. MS is bound only to deliver all faulty parts and only those supplied by us. We shall not be held responsible for indirect and consequential damages. Should a technical intervention be necessary, we will bear technician costs, while at your charge would remain air ticket, board and lodging. Should the fault be found to be due to operator misuse and/or carelessness or to causes not due to MS, you shall be invoiced also for the technician’s costs. In case of spare parts supply during the warranty period, delivery charges, import charges are on customer’s account.

Printheads warranty: Please refer enclosed Policy document for Printheads.

Exclusions: Kyocera Printing Heads subject to normal wear & tear.

Consumable items: To be purchased directly from M/s {{consumables_supplier}}.$b$, 60),
    (v_id, 'working_environment', 'WORKING ENVIRONMENT',
      $b$Until KYOCERA heads can work properly the working environment must be air-conditioned. MS printers are designed and projected to produce in an environment with temperatures between 22 and 28 Celsius degrees with a relative humidity between 50% and 60%, looking that changes of temperature shouldn’t be excessive and avoid dusty conditions that would cause irreversible damage to the same print head. Outside of these conditions isn’t possible to ensure the proper functioning of the inks used for the correct use of all components, including consumables such as inks, cleaner products and preparations, which must be kept in the same air conditioned environment.

It’s also recommended to verify the level of adhesion of the carpet before you start printing, bringing it to the operating temperature to prevent detachment of textile with probable damage to the print heads.$b$, 70),
    (v_id, 'customer_care', 'WORKS AT CUSTOMER''S CARE AND EXCLUSIONS',
      $b$Masonry works and excavations; External connections to the machine and between interactive systems (electrical lines, gas, water, compressed air, steam and oil, etc.) according to our technical specifications; any exhausts and outgoing air conduits; any lifting equipment and means of transportation necessary for assembly; Possible walkways and grids; Possible voltage stabilizer for tension oscillations +/-5% over the declared value; All liabilities related to the assessment of static capacity and dynamics of the building's structure, in the machine's installation area and all legal procedures (whenever requested by local authorities) for the installation and activation of the system; Anything not mentioned in the a.m. offer text.- Blanket adhesives, chemicals, inks, and consumables in general.$b$, 80),
    (v_id, 'cancellation', 'CANCELLATION',
      $b$If the Order/Contract is been cancelled due to any reason than the advance given is not refundable.

This Contract will enter into validity only after receipt from our part of a copy of the same duly signed by you for acceptance.

All date started in this offer are indicative and usual tolerances are admitted. We hope this offer meets your desires. Please do not hesitate to contact us for any additional questions.

Thanking you and assuring you of best services and co-operations at all time.

While thanking you once again for your order we kindly ask you to send us back a copy of the present order confirmation duly signed by you for acceptance on each page. In the meantime we remain at your best disposal.

The parties declare to approve expressly all above mentioned articles and clauses.$b$, 90);
end $seed$;


-- ── JPK · the MS Italy clause set, richer ───────────────────────────────────
-- Introduces `accessories_optionals`, `dryer_information` and `governing_law`.
-- 🟢 The dryer block names a REAL dryer — POWER-D Dryer (ELECTRIC) — while
--    fms_ocpi_dryers still holds six [SAMPLE] placeholders. Finding F7.
do $seed$
declare
  v_id uuid;
begin
  select id into v_id from public.fms_ocpi_machines where name = 'JPK';
  if v_id is null then return; end if;
  if exists (select 1 from public.fms_ocpi_machine_sections where machine_id = v_id) then return; end if;

  insert into public.fms_ocpi_machine_sections (machine_id, key, title, body, sort_order) values
    (v_id, 'sale_conditions', 'SALE CONDITIONS OF THE SUPPLY',
      'Delivery Terms: {{trade_term}}' || chr(10) ||
      'Delivery: {{delivery_days}}' || chr(10) ||
      'Payment Terms: {{payment_terms}}' || chr(10) ||
      'Erection and start-up: Included' || chr(10) ||
      'Software: INCLUDED' || chr(10) ||
      'PC RIP: INCLUDED' || chr(10) ||
      'Training for software: NOT INCLUDED' || chr(10) || chr(10) ||
      'Bank Details:' || chr(10) || '{{bank_block}}', 10),
    (v_id, 'accessories_optionals', 'ACCESSORIES AND OPTIONALS INCLUDED IN THE SUPPLY',
      $b$Unwinding unit at the entry.

N.1 Expansion module for big rolls through axial motor on pedestal with support to floor fixing, cardanic transmission joint with quick coupling system to the A frame with big rolls, selectable bidirectional rotation and security device.

N.1 Speed regulation module with oscillating cylinder with pneumatic control to regulate the unwinding fabric tension, ready for the speed control of the unwinding group.

Centering group for unwinder axial for fabric.

Equipped with spreading selvedges.

Ink dust exhauster.

Air blade.

Qwizard pc, JPK EVO. Qwizard has been developed specifically to improve the design management on the industrial machine series "Impress" powered by MS. Thanks to Qwizard the operator will be supported by simple and clear functions able to increase significantly the workflow efficiency.$b$, 20),
    (v_id, 'dryer_information', 'DRYER INFORMATION',
      $b$MS range: POWER-D Dryer (ELECTRIC)
Drying width: 1800 mm
Drying Media: Fabric
Heating System: Electrical heating system H18
Dryer belt: Standard belt H18
Single/Third Passage: Third Passage H18
Folder: Folder H18
Valve: Not Included
Burner: Not Included
Transformer for UL burner: Not Included
Big Roll Winder: Not Included
Protect paper unw for big roll: Not Included
Autotransformer: Not Included
Configuration is complete: Yes$b$, 30),
    (v_id, 'installation', 'INSTALLATION AND START-UP',
      $b$Erection and start-up included.

At your charge: board and lodging + local transportation. Our technician must be supported by your personnel according to our requirements. Utilities connection works at your care and charge. Operation manuals, maintenance books and electric diagrams are in English language.

Note: the departure of the MS technician for the installation will not take place before 15 days from receipt of the machine by the customer (the machine needs to be at the customer's place) and all the installation forms duly filled in, together with pictures of the facilities showing that you are ready for the start-up working and that you have fabric or paper plus inks.$b$, 40),
    (v_id, 'working_environment', 'WORKING ENVIRONMENT',
      $b$In order to have KYOCERA heads work properly the working environment must be air-conditioned. MS printers are designed and projected to produce in an environment with temperatures about 25 Celsius degrees with a relative humidity between 60% and 65%. Changes of temperature shouldn't be excessive; avoid dusty conditions that would cause irreversible damage to the same print head. In different environment conditions it is not possible to ensure the proper functioning of the inks used for the correct use of all components, including consumables such as inks, cleaner products, and preparations. The consumables must be kept in the same air conditioned environment.

It's also recommended to verify the level of adhesion of the carpet before you start printing, bringing it to the operating temperature to prevent detachment of textile with probable damage to the print heads.

Without the above mentioned environmental conditions, we do not guarantee the inks and consumer products correct function. Inks and consumer products must be stored in the same environmental conditions as per the machine.$b$, 50),
    (v_id, 'warranty', 'GUARANTEE',
      $b${{machine_warranty_months}} months from start-up date and no longer than 15 months from notification of equipment ready for delivery. MS is bound only to replace the faulty parts supplied by us. We shall not be held responsible for indirect and consequential damages. Should a technical intervention be necessary, MS PRINTING SOLUTIONS will bear technician costs, while at your charge would remain air ticket, board and lodging. Should the fault be found to be due to operator misuse and/or carelessness or to causes not due to MS, you shall be invoiced also for the technician's costs. In case of spare parts supplied during the warranty period, delivery charges are on MS PRINTING SOLUTIONS.

Exclusions: printing heads, parts in contact with inks and parts subject to normal wear and tear.$b$, 60),
    (v_id, 'customer_care', 'WORKS AT CUSTOMER''S CARE AND EXCLUSIONS',
      $b$Masonry works and excavations;
External connections to the machine and between interactive systems (electrical lines, gas, water, compressed air, steam and oil, etc.) according to our technical specifications;
Any exhausts and outgoing air conduits;
Any lifting equipment and means of transportation necessary for assembly;
Possible walkways and grids;
Possible voltage stabilizer for tension oscillations +/-5% over the declared value;
All liabilities related to the assessment of static capacity and dynamics of the building's structure, in the machine's installation area and all legal procedures (whenever requested by local authorities) for the installation and activation of the system;
Anything not mentioned in this document is expressly excluded;
Blanket adhesives, chemicals, inks, and consumables in general.$b$, 70),
    (v_id, 'governing_law', 'CONTROVERSY AND APPLICABLE LAW',
      $b$For any controversy the Laws of the Italian Republic are the sole applicable and Busto Arsizio (VA) ITALY is the sole competent court of jurisdiction.

MS PRINTING SOLUTIONS SRL, a Dover Corporation Company, is committed to observing the highest level of professional and ethical standards in conducting business in Italy and in every country where it operates or engages in commerce. MS PRINTING SOLUTIONS SRL commitment includes taking steps to ensure compliance with all applicable laws and regulations, including, without limitation, those prohibiting private and public-sector bribery, money laundering, and other forms of corruption, as well as those governing import and export restrictions, customs, duties and taxes (collectively, "Applicable Laws"). MS PRINTING SOLUTIONS SRL is part of a global enterprise and, therefore, those Applicable Laws include, without limitation, the U.S. Foreign Corrupt Practices Act, the UK Bribery Act of 2010, the Money Laundering Control Act of 1986, the U.S. International Traffic in Arms and Export Administration Regulations, and other restrictions pertaining to sanctioned and embargoed nations as directed by the U.S. Office of Foreign Assets Control and the Organization for Economic Co-Operation and Development (OECD). In no event shall MS PRINTING SOLUTIONS SRL be obligated under this agreement to take any action or refrain from taking any action that MS PRINTING SOLUTIONS SRL believes, in good faith, would cause it to be in violation of any of the Applicable Laws.

Customer represents and warrants that it is not, and will not be, in violation of any Applicable Law by entering into this supply contract. Customer further agrees that, subsequent to the execution of this supply contract, Customer shall not take any action or enter into any other agreement that shall, whether directly or indirectly, cause any violation of any Applicable Law with respect to MS PRINTING SOLUTIONS SRL or MS PRINTING SOLUTIONS SRL's products, technologies or services. Upon request by MS PRINTING SOLUTIONS SRL, Customer shall certify, in writing, its compliance with the Applicable Laws.

MS PRINTING SOLUTIONS SRL reserves the right of assigning this contract to factoring societies, third financing parties and/or financing institutes.

This contract constitutes the entire agreement between the parties hereto with respect to the supply in reference and supersedes all previous agreements, covenants or understanding in respect thereof. No amendments or waiver will be effective unless in writing signed by both parties.$b$, 80),
    (v_id, 'cancellation', 'CANCELLATION',
      $b$This Contract will enter into validity only after receipt from our part of a copy of the same duly signed by you for acceptance.

While thanking you once again for your order we kindly ask you to send us back a copy of the present order confirmation duly signed by you for acceptance on each page. In the meantime we remain at your best disposal.

The parties declare to approve expressly all above mentioned articles and clauses.$b$, 90);
end $seed$;


-- ── Rocket · transcribed in full, including the narrative Scope of Supply ────
-- The client's instruction was to keep the twelve sub-headed paragraphs rather
-- than reduce them to bullets, so Rocket contracts print what the source
-- document actually promises. The short list on the following page is the
-- composition (on the machine row above); this is the long form.
-- ⚠ MACHINE WARRANTY: the deck says 24 months. {{machine_warranty_months}} is
--   fixed company config at 12, so this prints 12. Finding F2, raised not
--   hard-coded.
-- ⚠ HEAD PRICE: the deck says "INR 1,50,000.00 to 1,80,000.00 plus GST".
--   Replaced by the client-approved wording. Finding F3.
do $seed$
declare
  v_id uuid;
begin
  select id into v_id from public.fms_ocpi_machines where name = 'Rocket';
  if v_id is null then return; end if;
  if exists (select 1 from public.fms_ocpi_machine_sections where machine_id = v_id) then return; end if;

  insert into public.fms_ocpi_machine_sections (machine_id, key, title, body, sort_order) values
    (v_id, 'sale_conditions', 'SALE CONDITIONS OF THE SUPPLY',
      'Trade Terms: {{trade_term}}' || chr(10) ||
      'Delivery: {{delivery_days}}' || chr(10) ||
      'Terms of Payment: {{payment_terms}}' || chr(10) ||
      'Validity of Order Confirmation: {{quotation_validity_days}} days' || chr(10) ||
      'Insurance: Borne by the customer.' || chr(10) || chr(10) ||
      'Note: INK''S & HEAD''S, Custom Duty & Transportation charges will be paid by Customer.' || chr(10) || chr(10) ||
      'Forex Impact Clause: If payment terms exceed 3 months with equal instalments, the Dollar exchange difference will be adjusted via Debit Note/ Credit Note.' || chr(10) || chr(10) ||
      'Bank Details:' || chr(10) || '{{bank_block}}', 10),
    (v_id, 'scope_of_supply', 'SCOPE OF SUPPLY',
      $b$Motorized Winder and Unwinder
The machine is equipped with a fully motorized winder and unwinder system with synchronized drive control. It incorporates an advanced closed-loop tension control system, ensuring stable and uniform fabric tension at both entry and exit. This system supports handling of various fabric types (light to heavy GSM) without distortion, wrinkles, or elongation, ensuring smooth feeding into the printing zone.

Fabric Opening Device
The fabric opening system includes precision-engineered tension bars with adjustable incidence angles to control fabric tension dynamically. It is equipped with a spreading roller for uniform width control and a bent (banana) bar for wrinkle removal. The operator can switch between these based on fabric characteristics, ensuring proper alignment, crease removal, and consistent fabric presentation before printing.

Conveyor Belt System
The conveyor system is designed for high stability and precision fabric transport. Dryer conveyor length: 30–32 meters. Blanket length: 21.9 meters. Blanket width: 2100 mm. Make: Hebasit. Open jointed blanket for optimum fitting at sight; fitting will be done by a qualified engineer of Homer. The blanket is made of high-temperature-resistant material, ensuring durability and dimensional stability. The integrated blanket washing unit consists of a driven rotary brush system, cleaning and drying sponge rollers, and wipers for water residue removal. This ensures continuous cleaning, improved adhesion, and extended blanket life, which is critical for high-quality digital printing.

Fabric Pressing Cylinder
An adjustable pneumatic pressure system is provided for the fabric pressing cylinder. This ensures uniform fabric adhesion to the conveyor belt, elimination of air gaps between fabric and blanket, and stable fabric movement during high-speed printing. This directly improves print sharpness, registration, and consistency.

Printing Head Module
The machine is equipped with high-performance industrial printheads. Model: KYOCERA RC MODEL EX600RC. Max. Accuracy: 1200*2400DPI. Total Heads: 224 pcs (1515mm). Configuration: 4 stations, 8 colours. Heads distribution: 2 colours each station, 2 row heads each colour. Digital printing unit: the machine reserves an appropriate position for installing the digital printing unit. This space is sealed with a profile structure and equipped with two 5p air conditioners and high-power humidifiers (sealed space structure and humidifier, air conditioning at customer care). Advanced technology to achieve high-resolution output, high-speed production capability and precision drop control. The system supports variable drop technology for better colour gradation and ink efficiency.

Height Adjustment of Printing Carriage
The printing carriage includes an automated height adjustment mechanism to accommodate different fabric thicknesses. It ensures optimal head-to-fabric gap, prevention of head strikes, and consistent print quality across varying materials. The system is integrated with a centralized electrical control cabinet for precise operation and safety interlocks.

Ink Circulation System
A continuous ink circulation system is provided to maintain constant ink movement across the printheads. This system prevents pigment sedimentation, reduces nozzle clogging, and maintains uniform ink temperature and viscosity. It ensures consistent jetting performance and minimizes downtime.

Degassing & Negative Pressure System
The machine is equipped with a high-flow, high-speed degassing unit to remove micro air bubbles and an automatic negative pressure control system. This combination ensures a stable meniscus at nozzle level, accurate ink droplet formation, and prevention of ink leakage or air suction, resulting in consistent print quality and improved head life.

Ink Supply System
The machine includes standard 15-litre ink tanks for each colour and provision for a centralized bulk ink supply system up to 1-ton capacity. This allows continuous ink feeding without interruption, reduced manual refilling and improved production efficiency. The system is designed for compatibility with large-scale industrial operations.

Rotary Printing Attachment
The system is integrated with 4 rotary printing units from Jilong, a globally recognized brand, enabling hybrid printing capability: a total of 4 rotary stations, 3 magnetic rotary units and 1 squeeze bar unit (for metallic/foil applications like silver & gold). Configuration: 2 rotary units before digital printing and 2 rotary units after digital printing. Screen repeat options offered: 640 mm / 726 mm / 819 mm / 914 mm / 1018 mm / 1206 mm. Endring width: 62 mm. Screen + endring length: 2060 mm. Magnet rod and length: 1898 mm, small head smooth face. Colour type pump: JB76. This enables pre-treatment or base printing, special effects and foil applications, and enhanced design flexibility.

Dryer System
The machine is equipped with a multi-stage drying system: 4 independent drying chambers, an oil-based heating system for uniform temperature distribution, and a single conveyor with 3-pass fabric movement. This ensures efficient moisture evaporation, proper ink fixation and uniform drying across the fabric width. The multi-pass system increases drying efficiency without increasing machine footprint.

Electronic Parts
PLC: Siemens. Blanket servo driver: KEBA. Screen servo driver: KEBA. Blanket driving motor: DMT directly driving motor. Screen head driving motor: DMT directly driving motor. Pneumatic: imported international brand. Touch screen: Weview.

Other important technical specification
Open-style designed net support, magnetic scrape. The computer distributed control system based on CAN-BUS is adopted, and the circular network independent drive and automatic matching servo control system are adopted. Glue device: thermal glue device (1 pc φ20 magnet rod). Drive logical controlling: adopts SIEMENS PLC; fabric feeding, over feeding and dryer exit adopt frequency inverter driving. Adopts HMI operation table, display and file various information (speed, temperature, registration parameter, magnetic squeegee pressure, running status, etc.). Low-voltage equipment: France SCHNEIDER products.$b$, 20),
    (v_id, 'means_of_operation', 'REQUIREMENT TO MEANS OF OPERATION',
      $b$Optimum operation of the machine/range depends on the availability of appropriate means of operation at the customer's site. The means of operation stated in "Technical Data" have to conform to the criteria set out here under. Deviations from these data can affect proper operation of the machine/range or have a detrimental effect on the processing result.

Water
Pressure: 2.0 bis 2.5 bar at maximum
Temperature: 15°C to 20°C
Conductivity: ≥ 5µ S/cm ≤ 800µ S/cm
Hardness: 4°- 8° d
Inorganic salts: ≤ 0.5 g/l
Fe: ≤ 0.1 mg/l
General quality: Free of submicron particles

Air
According to DIN ISO 8753-1
Pressure: 6 bar
Solid state quantity: ≤ 0.1 mg/m³
Solid state size: ≤ 0.1µm

Water at condensation
Point +3°C: ≤ 5.95 g/m³
Oil: ≤ 0.1 mg/m³

If pressure remains below the minimum requirement, the machine/range is switched off automatically.

Electricity: According to VDE DIN 0100 Part 725
Nominal voltage: ± 5%
Nominal frequency: ± 2 Hz$b$, 30),
    (v_id, 'installation', 'INSTALLATION AND COMMISSIONING',
      $b$Installation process will take place under the supervision of a specially trained engineer. All the product manuals and service manuals, diagrams and drawing and other literature will be available in English language.$b$, 40),
    (v_id, 'not_included', 'NOT INCLUDED',
      $b$Lodging, boarding and local transportation charges are not included, and it is to be bare by client/customer or need to paid extra at actual.

Blanket need to joint on site and all expanses bare by customer.

Our technician must be supported by your personnel according to our requirements. Utilities connection works at your care and charge. Before the installation can start the customer has to have finished the foundation works according to our Plan, the supply of electric energy, water, compressed air etc.$b$, 50),
    (v_id, 'delivery_scope', 'NOT INCLUDED IN OUR DELIVERY SCOPE',
      $b$As applicable to above equipment specification the prices do not include. RIP pc, Compressor, UPS, AC and Humidifier.

Customer is also responsible to provide all equipment necessary for the unloading and keeping machine at the required place.$b$, 60),
    (v_id, 'pc_spec', 'FOR THE GOOD OPERABILITY OF THE MACHINE, WE SUGGEST CUSTOMER TO PROCURE THE FOLLOWING ITEMS',
      $b$One PC - configuration:
Windows 11
Mother board Intel core I9, 64 bit, clocked at 4ghz, octa core
32gb RAM
Graphic card 4gb
Extra PCI slot for Ethernet card
SSD for C drive 256gb
Gbyte HDD: 7200rpm at least 200 Gbyte
USB 2.0 Port
At least one serial port RS232 on mother board
Graphic Video adapter AGP or PCI Ex not on motherboard ATI or NVidia with at least 128MByte ram
Main board with one free LAN SLOT, CPU Intel i7-3770K or higher, RAM 16GB

To avoid any possible problem please send us an email with the complete list of components to be checked for compatibility. Please also inform in any case you have any problem to find above mentioned components.$b$, 70),
    (v_id, 'machine_warranty', 'MACHINE WARRANTY',
      $b$Machine Warranty period will be of {{machine_warranty_months}} months from the date of installation.

Warranty of the machine will lapse in following condition:
1. Machine environment does not meet the requirement of machine as guidelines given
2. Dismantling or refitting without our permission
3. Destruction by external forces
4. If daily maintenance is not carried out for more than 2 times as per maintenance sheet provided by Orange
5. Spare parts used in machine, which are not supplied by "Orange O Tec Pvt. Ltd"
6. Other human errors$b$, 80),
    (v_id, 'head_policy', 'PRINT HEAD POLICY PROGRAM',
      $b$Orange O Tec offers a Print Head Warranty of {{head_warranty_months}} months starting from shipping date from China. After that period, replacement print heads will be supplied at the prices prevailing at the time of purchase, on the new machine, first time installed head.

Under the condition that the buyer uses the ink provided by the seller, the seller shall provide the print head warranty. The buyer and the seller shall keep the print head testing bar signed by both parties on the day of installation completion. In case of print head damage not caused by the buyer during the warranty period, the damaged print head can be replaced free of charge (the old replaced print head shall be returned to the seller). However, the warranty on the first replaced print will be for 12 months or balance warranty whichever is Higher. New print head procured post 18 months shall carry warranty 12 months from the date of installation. Any print head replaced under the program of 12 months will have repetitive warranty.

Any print head replaced under the warranty program of 12 months, in case of any physical damage, new print head to be purchased from Orange O Tec. The print head should be operated under print head specification requirement according to the machine maintenance list. The damage reason belong to the buyer's responsibility includes (but is not limited to):
1. Modification or disassembling on print head.
2. Mechanical shock applied to the printhead.
3. Liquid contact on terminals of connectors.
4. Print head operation under harsh environment.
5. Physical contact on nozzle plane with contaminated materials.
6. Using of the ink which is uncertified by seller.
7. Congealed ink clogged the nozzles.
8. In case of any accident happened or dent found on head.

Working condition requirements:
The working environment must be air conditioned as KYOCERA heads work properly and give better results within temperature range of 22 degree to 28 degree Celsius and relative humidity between 50 to 60%.

Atmosphere should not be dusty and temperature changes should not be excessive. It may cause irreversible damage to print head.

Outside of these conditions is not possible to ensure the proper functioning of machine, ink, other parts and consumable.

It's also recommended to verify the level of adhesion of the carpet before you start printing, bringing it to the operating temperature to prevent detachment of textile with probable damage to the print heads.

Request customer to have camera installed on machines which covers the whole carriage area when machine is in use. In case if camera is not installed or not working, unfortunately we won't be able to take responsibility of the Print heads in case of any mishap.

We recommend the below point to be followed when the machine is on idle condition: keep the power supply of the machine and compressor ON, take the test draw timely and even run a full density test for 15 to 20 meters in the time interval of two hours. Failing to do it could result in clogged nozzles of heads which are not even acceptable by Kyocera Japan.$b$, 90),
    (v_id, 'customer_care', 'WORKS AT CUSTOMER''S CARE AND EXCLUSIONS',
      $b$Masonry works and excavations external connections to the machine and between interactive systems (electrical lines, gas, water, compressed air, steam and oil, etc.) according to our technical specifications.

Any exhausts and outgoing air conduits; any lifting equipment and means of transportation necessary for assembly; Possible walkways and grids; Possible voltage stabilizer for tension oscillations +/-5% over the declared value.

All liabilities related to the assessment of static capacity and dynamics of the building's structure, in the machine's installation area and all legal procedures (whenever requested by local authorities) for the installation and activation of the system; Anything not mentioned in the a.m. offer text.

Blanket adhesives, chemicals, inks, and consumables in general.$b$, 100),
    (v_id, 'cancellation', 'CANCELLATION',
      $b$This contract will enter into validity only when we receive duly signed order by you as an acceptance within the validity period of the quotation.

All the dates and timelines mentioned in proposal are indicative and usual tolerance are admitted.

We hope this offer meets your desires. Please do not hesitate to contact us for any additional questions.

Thanking you and assuring you of best services and co-operations at all time.

We request you to submit the copy of duly signed order confirmation by you to us for acceptance.

Once again thanking you and please feel free to revert for any kind of queries or clarification from our end.$b$, 110);
end $seed$;


-- ============================================================================
-- MASTER GAPS THE DECKS ANSWER
--
-- Only what a deck actually states. Deliberately NOT touched here:
--   · billing_name — blank on JP7, JPK, Fab Pro 2I and Alpha 3 — 12 heads. The
--     client's sheet is the authority for invoice naming, not the deck.
--   · category_id and the head links — already mapped for 8 of the 9. Position
--     Printer's head is blank in the sheet and its deck names none (F8).
--   · needs_dryer and the four opt_* flags — these drive fms_ocpi_write_oc and
--     null means "no", so a wrong guess silently erases a deal's answers.
--     Findings F4 (Position Printer prints three extras it is mapped 'no' for)
--     and F5 (Alpha 3 — 12 heads lists a Front Dryer while needs_dryer = false)
--     are RAISED for Bushra, not edited off a deck.
-- ============================================================================

-- Fab Pro 1I's deck closes "Prepared By / Checked By", not "Approved By".
-- Finding F15. Guarded on the current value so a later hand edit is not undone.
update public.fms_ocpi_machines
   set signoff_style = 'checked_by'
 where name = 'Fab Pro 1I' and signoff_style = 'approved_by';

-- ============================================================================
-- ⚠ WHY THE MODEL NUMBERS ABOVE ARE LITERALS, NOT {{machine_model_no}}
--
-- The token does NOT read the machine master. `tokensFor` resolves it from
-- `deal.machineModelNo` (tokens.ts), which is a free-text box the salesperson
-- types on the quotation form and which is NEVER prefilled from the machine
-- (fieldSpec.ts seeds it as ""). K64, Position Printer and Rocket were first
-- written with the token and every one of the three then rendered
-- "Model No: ________" against a real deal — caught in the render sweep.
--
-- These three decks state a FIXED model number that does not vary by deal, so
-- the literal is both correct and safer.
--
-- 🔴 THE SAME LATENT DEFECT IS LIVE ON Homer K24, whose supply line has read
--    "(Model No: {{machine_model_no}})" since the first seed. Any K24 contract
--    raised on a deal where nobody typed the model number prints a ruled blank.
--    NOT changed here — it is existing contract text and outside this batch.
--    Raised as OCPI-4 finding F18, together with the Machines form's hint
--    "Available in templates as {{machine_model_no}}", which is misleading for
--    the same reason.
-- ============================================================================
