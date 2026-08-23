-- ===========================================================================
-- OCPI FMS — seed the machine master and the ten real order-confirmation
-- templates.
--
-- WHERE THIS CONTENT COMES FROM
--   The eleven PowerPoint decks in Misc/Bushra Reports/OCPI, read in READING
--   ORDER (shapes sorted by position, tables reconstructed as label/value pairs)
--   rather than in XML order — an earlier pass that trusted XML order wrongly
--   concluded two decks were abbreviated when they are in fact the longest.
--
-- ⚠ TEN TEMPLATES, NOT ELEVEN. `PENGDA 800 DIA.pptx` is an unedited COPY of the
--   1000 deck: diffing them leaves three differences, all fill-in blanks, and
--   both declare `Pengda PD-1700XD-1000`, drum diameter 1000 mm. The 800 variant
--   is seeded as a MODEL WITHOUT A TEMPLATE rather than given the 1000's specs,
--   because inventing specifications for a machine is how a wrong number reaches
--   a customer's contract. Bushra owns the real 800 figures (OCPI.md).
--
-- ⚠ "Alpha 2 - 8 Heads machine" BECOMES THREE MACHINES. The Microsoft form has
--   one option; the folder has three decks — KoloRado Alpha II at 1.8 m, at
--   1.9 m (whose model is actually OT-1908A) and at 2.2 m. The form cannot tell
--   them apart because it has no width dimension. Splitting them here is the
--   whole reason the machine master IS the model list.
--
-- ⚠ THE OTHER 15 FORM MODELS ARE SEEDED WITH has_template = false. They are
--   quotable immediately and blocked at the order-confirmation step with a
--   message naming what is missing, so they surface as a task rather than a
--   crash. Nobody has to invent their content to make the module work.
--
-- ⚠ EVERY BLANK IN THE DECKS IS NOW A TOKEN. "warranty of _______months"
--   becomes {{machine_warranty_months}}; the print-head price blank becomes
--   {{post_warranty_head_price}}; the bank block becomes {{bank_block}} so it
--   follows the selling company instead of being hardcoded to Axis Sachin. An
--   unresolved token renders as a ruled blank, never as literal braces — see
--   frontend/src/apps/ocpi/lib/tokens.ts.
--
-- ⚠ THIS CONTENT IS AWAITING BUSHRA'S PROOF-READ. It is a faithful transcription
--   of what the decks say, including their typos ("CHINES DRYER", "regural"),
--   which are left alone deliberately: silently correcting a customer-facing
--   contract is not a transcription decision. Everything here is editable in
--   Administration → Machines without a deploy.
--
-- Idempotent: every insert is `on conflict (name) do nothing`, and sections are
-- only seeded for a machine that has none. Re-running changes nothing.
--
-- Reversal:
--   delete from public.fms_ocpi_machine_sections;
--   delete from public.fms_ocpi_machines;
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. THE MODELS WITH NO TEMPLATE YET — the Microsoft form's options that no
--    deck covers. Quotable now; blocked at the order confirmation.
-- ---------------------------------------------------------------------------
insert into public.fms_ocpi_machines (name, has_template, sort_order) values
  ('K64',                          false, 900),
  ('JP7',                          false, 901),
  ('JPK',                          false, 902),
  ('Mini Lario',                   false, 903),
  ('Fab Pro 1I',                   false, 904),
  ('Fab Pro 2I',                   false, 905),
  ('Fab Pro 3I',                   false, 906),
  ('Position Printer',             false, 907),
  ('KoloRado Alpha 3 — 12 heads',  false, 908),
  ('Kolorado Alpha 16',            false, 909),
  ('KoloRado Alpha 3.2 — 8 heads', false, 910),
  ('KoloRado Alpha 3.2 — 16 heads',false, 911),
  ('Pengda PD-1700XD-800',         false, 912),
  ('Pengda PD-1800XD-800',         false, 913),
  ('Rocket',                       false, 914),
  ('Foil Machine',                 false, 915),
  ('Label Printer',                false, 916),
  ('Book Printer',                 false, 917)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- 2. THE TEN MACHINES THAT HAVE A TEMPLATE
-- ---------------------------------------------------------------------------
insert into public.fms_ocpi_machines
  (name, doc_title, intro_text, machine_model_no, supply_description,
   spec_rows, composition, header_fields, signoff_style, has_template, sort_order)
values
  -- ── Homer belt printers ────────────────────────────────────────────────
  ('Homer K24', 'ORDER CONFIRMATION',
   'Following up your kind order, we are glad to confirm the supply of Homer K24 Digital Printing Machine at the under mentioned conditions',
   'HM1800B-TK24',
   'LARGE FORMAT INKJET PRINTER WITH STANDARD ACCESSORIES WITH {{head_count}} PRINT HEADS AND CHINES DRYER (Model No: {{machine_model_no}})',
   $j$[
     {"label":"No. of Machine Supply","value":"{{machine_count}}"},
     {"label":"Model","value":"Homer K24"},
     {"label":"Number of installable rows","value":"3"},
     {"label":"Number of installed printing heads","value":"{{head_count}}"},
     {"label":"Number of installable printing heads","value":"24"},
     {"label":"Max. Printing width","value":"1900 mm"},
     {"label":"Max. Fabric width","value":"1920 mm"},
     {"label":"Electrical Voltage","value":"AC220V~240V +- 10% single phase｜Printer 34A (7.4 kW) + Belt Drying 25A (5.2 Kw)｜50Hz/60Hz\nDryer：AC380V +- 10% three phase｜25A (15.9 Kw)｜50Hz/60Hz"},
     {"label":"Compressed Air consumption","value":"0.6 Mpa｜0.15m³/hr (Dry, No Oil or Water)"},
     {"label":"Water Consumption","value":"0.6 Mpa | 0.4m³/hr"},
     {"label":"Installed electrical power","value":"30 KW"},
     {"label":"Rip software","value":"Neostampa"},
     {"label":"Dryer","value":"Electric"}
   ]$j$::jsonb,
   $j$[
     "Ink feeding system complete with in-line filters and Degassing units.",
     "Driven unwinding unit with expanding shaft to support fabric rolls on cardboard cores having max. Diameter of 400 mm.",
     "Fabric tensioning bars with adjustable incidence to control fabric tension during unwinding. It is equipped with a spreading roll and a bent bar that can be used alternatively by the operator according to the fabric being processed.",
     "Adjustable pressure of the fabric pressing cylinder- up to 0.6 MPA Printing unit model Homer K24 to print from 4 to 8 colors. Height adjustment of the printing carriage over the blanket Built-in electrical cabinet",
     "Operator interface controlling all machine operative parameters",
     "Blanket washing unit with driven brush and cleaning/drying sponges and wipers to remove water residues.",
     "Presence of Moving Roll for to obtain better results on thin(low GSM fabric).",
     "Ink Circulation : When we give cleaning or fill up then inks go back to primary tank instead of getting waste.",
     "Auto Purging System : When head is at capping position, it keeps firing at regural interval, so nozzle remains moist.",
     "Large flow and high-speed degassing device",
     "Automatic negative pressure system",
     "Large memory Industrial server",
     "Tension-adjustable continuous unwinding/rewinding control technology"
   ]$j$::jsonb,
   '["attn","date","address"]'::jsonb, 'approved_by', true, 10),

  ('Homer K32', 'ORDER CONFIRMATION',
   'Following up your kind order, we are glad to confirm the supply of Homer K32 Digital Printing Machine at the under mentioned conditions',
   null,
   'STANDARD ACCESSORIES WITH {{head_count}} PRINTHEADS WITH DRYER WITH CENTRING DEVICE.',
   $j$[
     {"label":"No. of Machine Supply","value":"{{machine_count}}"},
     {"label":"Model","value":"Homer K32"},
     {"label":"Number of installable rows","value":"4"},
     {"label":"Number of installed printing heads","value":"{{head_count}}"},
     {"label":"Number of installable printing heads","value":"32"},
     {"label":"Max. Printing width","value":"1900 mm"},
     {"label":"Max. Fabric width","value":"1920 mm"},
     {"label":"Electrical Voltage","value":"Printer：AC220V single phase｜6.5kW｜50Hz/60Hz\nBelt Heater：AC220V single phase｜6 kW｜50Hz/60Hz\nDryer：AC380V three phase｜16 kW｜50Hz/60Hz"},
     {"label":"Compressed Air consumption","value":"0.6 Mpa｜0.15m³/hr (Dry, No Oil or Water) 7 Bar"},
     {"label":"Water Consumption","value":"0.6 Mpa | 0.4m³/hr"},
     {"label":"Installed electrical power","value":"30 KW"},
     {"label":"Rip software","value":"Neostampa"},
     {"label":"Dryer","value":"Dual Dryer"}
   ]$j$::jsonb,
   '[]'::jsonb,
   '["attn","date","ref","address"]'::jsonb, 'approved_by', true, 11),

  -- ── Paper printers ─────────────────────────────────────────────────────
  ('P8S', 'ORDER CONFIRMATION',
   'Following up your kind order, we are glad to confirm the supply of P8S (With 8 Head) Digital Printing Machine at the under mentioned conditions',
   null,
   'LARGE FORMAT INKJET PRINTER WITH STANDARD ACCESSORIES WITH {{head_count}} PRINTHEADS.',
   $j$[
     {"label":"No. of Machine Supply","value":"{{machine_count}}"},
     {"label":"Model","value":"P8S"},
     {"label":"Number of installable rows","value":"Two"},
     {"label":"Number of installed printing heads","value":"{{head_count}}"},
     {"label":"Number of installable printing heads","value":"8 Heads"},
     {"label":"Max. Printing width","value":"1900 mm"},
     {"label":"Max. Media width","value":"1950 mm"},
     {"label":"Electrical Voltage","value":"Printer：AC 380V Three phase｜7 kW｜50Hz/60Hz\nDryer：AC380V three phase｜9 kW｜50Hz/60Hz"},
     {"label":"Compressed Air consumption","value":"0.6 Mpa｜0.15m³/hr (Dry, No Oil or Water)"},
     {"label":"Installed electrical power","value":"16 KW"},
     {"label":"Rip software","value":"Neostampa"}
   ]$j$::jsonb,
   '[]'::jsonb,
   '["attn","date","ref","address"]'::jsonb, 'approved_by', true, 20),

  -- ⚠ P8D's deck is headed OFFER QUOTE, not ORDER CONFIRMATION. Left as it is:
  --   whether that is deliberate or drift is a question for Bushra, and quietly
  --   "fixing" the heading on a customer-facing contract is not a transcription
  --   decision.
  ('P8D', 'OFFER QUOTE',
   'Following up your kind order, we are glad to confirm the supply of P8D (8H) Digital Printing Machine at the under mentioned conditions',
   'HM1800R-P8D-A1',
   'Large Format Inkjet printer With Standard Accessories With {{head_count}} Print Heads ({{machine_model_no}})',
   $j$[
     {"label":"No. of Machine Supply","value":"{{machine_count}}"},
     {"label":"Model","value":"P8D"},
     {"label":"Number of installable rows","value":"Two"},
     {"label":"Number of installed printing heads","value":"{{head_count}}"},
     {"label":"Number of installable printing heads","value":"8 Heads"},
     {"label":"Max. Printing width","value":"1900 mm"},
     {"label":"Max. Media width","value":"1950 mm"},
     {"label":"Electrical Voltage","value":"Printer：AC 380V Three phase｜5 kW｜50Hz/60Hz\nDryer：AC380V three phase｜16 kW｜50Hz/60Hz"},
     {"label":"Compressed Air consumption","value":"0.6 Mpa｜0.15m³/hr (Dry, No Oil or Water)"},
     {"label":"Installed electrical power","value":"25 KW"},
     {"label":"Rip software","value":"Neostampa"}
   ]$j$::jsonb,
   $j$[
     "Ink feeding system complete with in-line filters and Degassing units.",
     "Driven unwinding unit with expanding shaft to support paper rolls on cardboard cores having max. Diameter of 400 mm or have max weight 200kg.",
     "Roll to Roll feeding system",
     "Printing unit model P8D to print from 4 to 8 colors.",
     "Built-in electrical cabinet.",
     "Operator interface controlling all machine operative parameters.",
     "Effective Drafting with the help of fans.",
     "Bottom Dryer for uniform drying."
   ]$j$::jsonb,
   '["attn","date","ref","address"]'::jsonb, 'approved_by', true, 21),

  -- ── Kolorado / KoloRado Alpha ──────────────────────────────────────────
  ('Kolorado Alpha 15', 'ORDER CONFIRMATION',
   'Following up your kind order, we are glad to confirm the supply of Kolorado Alpha - 15 Digital Printing Machine at the under mentioned conditions',
   null,
   'Digital Sublimation Printer Kolorado Alpha 15 with Standard Accessories (With {{head_count}} heads)',
   $j$[
     {"label":"No. of Machine Supply","value":"{{machine_count}}"},
     {"label":"Model","value":"Kolorado Alpha 15"},
     {"label":"Number of print heads","value":"{{head_count}} Heads (Epson i3200)"},
     {"label":"Max. Printing width","value":"1800 mm | 1900 mm"},
     {"label":"Max. Media width","value":"1800 mm | 1900 mm"},
     {"label":"Electrical Voltage","value":"Printer: VAC 210-230, 15.5KW"}
   ]$j$::jsonb,
   '[]'::jsonb,
   '["attn","date","ref","address"]'::jsonb, 'approved_by', true, 30),

  ('KoloRado Alpha II — 1.8 m, 8 heads', 'ORDER CONFIRMATION',
   'Following up your kind order, we are glad to confirm the supply of KoloRado alpha II Digital Printing Machine at the under mentioned conditions',
   null,
   'WITH STANDARD ACCESSORIES (With {{head_count}} printheads)',
   $j$[
     {"label":"No. of Machine Supply","value":"{{machine_count}}"},
     {"label":"Model","value":"KoloRado alpha II (1.8 Meter)"},
     {"label":"Number of print heads","value":"{{head_count}} Heads (Epson i3200)"},
     {"label":"Max. Printing width","value":"1800 mm | 2200 mm"},
     {"label":"Max. Media width","value":"1830 mm | 2230 mm"},
     {"label":"Electrical Voltage","value":"Printer：AC 220V +- 10%, 50/60 HZ"}
   ]$j$::jsonb,
   '[]'::jsonb,
   '["attn","date","ref","address"]'::jsonb, 'checked_by', true, 31),

  -- ⚠ The 1.9 m deck's Model line reads OT-1908A, not "Alpha II". Kept as the
  --   deck has it; the machine's NAME here carries both so a salesperson can
  --   find it either way.
  ('KoloRado Alpha II — 1.9 m, 8 heads (OT-1908A)', 'ORDER CONFIRMATION',
   'Following up your kind order, we are glad to confirm the supply of KoloRado alpha II Digital Printing Machine at the under mentioned conditions',
   'OT-1908A',
   'WITH STANDARD ACCESSORIES (With {{head_count}} printheads)',
   $j$[
     {"label":"No. of Machine Supply","value":"{{machine_count}}"},
     {"label":"Model","value":"OT-1908A (1.9 Meter)"},
     {"label":"Number of print heads","value":"{{head_count}} Heads (Epson i3200)"},
     {"label":"Max. Printing width","value":"1900 mm | 2200 mm"},
     {"label":"Max. Media width","value":"1830 mm | 2230 mm"},
     {"label":"Electrical Voltage","value":"Printer：AC 220V +- 10%, 50/60 HZ"}
   ]$j$::jsonb,
   '[]'::jsonb,
   '["attn","date","ref","address"]'::jsonb, 'checked_by', true, 32),

  ('KoloRado Alpha II — 2.2 m, 8 heads', 'ORDER CONFIRMATION',
   'Following up your kind order, we are glad to confirm the supply of KoloRado alpha II 2.2 meter with 8 heads Digital Printing Machine at the under mentioned conditions',
   null,
   'WITH STANDARD ACCESSORIES (With {{head_count}} printheads)',
   $j$[
     {"label":"No. of Machine Supply","value":"{{machine_count}}"},
     {"label":"Model","value":"KoloRado alpha II (2.2 Meter) - 8 Heads"},
     {"label":"Number of print heads","value":"{{head_count}} Heads (Epson i3200)"},
     {"label":"Max. Printing width","value":"1800 mm | 2200 mm"},
     {"label":"Max. Media width","value":"1830 mm | 2230 mm"},
     {"label":"Electrical Voltage","value":"Printer：AC 220V +- 10%, 50/60 HZ"}
   ]$j$::jsonb,
   '[]'::jsonb,
   '["attn","date","address"]'::jsonb, 'checked_by', true, 33),

  ('KoloRado Alpha 3.2 — 24 heads', 'ORDER CONFIRMATION',
   'Following up your kind order, we are glad to confirm the supply of KoloRado alpha 3.2 Digital Printing Machine at the under mentioned conditions',
   null,
   'Digital Sublimation Printing Machine KoloRado Alpha 3.2 (with {{head_count}} heads)',
   $j$[
     {"label":"No. of Machine Supply","value":"{{machine_count}}"},
     {"label":"Model","value":"KoloRado alpha 3.2"},
     {"label":"Number of print heads","value":"{{head_count}} Heads"},
     {"label":"Max. Printing width","value":"3200 mm"},
     {"label":"Max. Media width","value":"3200 mm"},
     {"label":"Electrical Voltage","value":"Printer：AC 220V +- 10%, 50/60 HZ"}
   ]$j$::jsonb,
   $j$[
     "10000 Meter Roll Support",
     "Roll to Roll feeding system",
     "Printing unit model KoloRado alpha 3.2 to print from 4 to 8 colors.",
     "Built-in electrical cabinet.",
     "Operator interface controlling all machine operative parameters.",
     "Effective Drafting with the help of fans.",
     "Front Dryer",
     "Including INK if any, Custom Duty & Transportation charges will be paid by Customer."
   ]$j$::jsonb,
   '["attn","date","address"]'::jsonb, 'checked_by', true, 34),

  -- ── Calender ───────────────────────────────────────────────────────────
  ('Pengda PD-1700XD-1000', 'ORDER CONFIRMATION',
   'Following up your kind order, we are glad to confirm the supply of Pengda Calender Machine at the under mentioned conditions',
   'PD-1700XD-1000',
   'TOTAL NET AMOUNT OF THE SUPPLY PENGDA',
   $j$[
     {"label":"No. of Machine Supply","value":"{{machine_count}}"},
     {"label":"Model","value":"Pengda PD-1700XD-1000"},
     {"label":"Drum Diameter","value":"1000 mm"},
     {"label":"Working width","value":"1700 mm"},
     {"label":"Heating","value":"Oil Heating"},
     {"label":"Max. Media width","value":"2750mm x 1750mm x 2250mm"},
     {"label":"Initial Power","value":"71 KW 3 Phase 4 Wire System, 380 v / 50 Hz"},
     {"label":"Voltage","value":"42 KW"}
   ]$j$::jsonb,
   '[]'::jsonb,
   '["attn","date","ref","address"]'::jsonb, 'approved_by', true, 40)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- 3. THE SECTIONS, BY FAMILY
--
--    Machines within a family share their boilerplate; the differences between
--    families are real and documented in the fms_ocpi_machines migration header
--    (the print-head clause has three wordings, the Alpha warranty differs in
--    substance, Pengda has no print-head policy at all).
--
--    Seeded only for a machine that has NO sections yet, so a re-run never
--    overwrites an edit made in the app.
-- ---------------------------------------------------------------------------
do $seed$
declare
  v_id uuid;
  v_name text;

  -- Shared across Homer + P8 + Alpha
  c_installation text := 'Installation process will take place under the supervision of a specially trained engineer. All the product manuals and service manuals, diagrams and drawing and other literature will be available in English language.';
  c_not_included text := 'Lodging, boarding and local transportation charges are not included, and it is to be bare by client/customer or need to paid extra at actual.

Our technician must be supported by your personnel according to our requirements. Utilities connection works at your care and charge.

Before the installation can start the customer has to have finished the foundation works according to our Plan, the supply of electric energy, water, compressed air etc.';
  c_delivery_scope text := 'As applicable to above equipment specification the prices do not include. Compressor, UPS, AC and Humidifier.

Customer is also responsible to provide all equipment necessary for the unloading and keeping machine at the required place.

Hardware: NOT INCLUDED: at customer care and charge.';
  c_pc_spec text := 'One PC - configuration:
Windows 10
Mother board Intel core I7, 64 bit
16gb RAM
Graphic card
Extra PCI slot for Ethernet card
HDD: 7200rpm at least 200Gbyte
USB 2.0 Port
At least one serial port RS232 on motherboard
Graphic Video adapter AGP or PCI Ex not on motherboard ATI or NVidia with at least 128MByte ram
Mainboard with one free LAN SLOT, CPU Intel i7-3770K or higher, RAM 16GB

To avoid any possible problem please send us an email with the complete list of components to be checked for compatibility. Please also inform in any case you have any problem to find above mentioned components.';
  c_machine_warranty text := 'Machine Warranty period will be of {{machine_warranty_months}} months from the date of installation, where damaged parts will be replaced free of cost subject to damage not caused due to the below mentioned reasons:

Machine environment does not meet the requirement of machine as guidelines given
Dismantling or refitting without our permission
Destruction by external forces
If daily maintenance is not carried out for more than 2 times as per maintenance sheet provided by Orange (Warranty will Lapse)
Spare parts used in machine, which are not supplied by "Orange O Tec Pvt. Ltd"
Other human errors';
  c_head_policy text := 'Orange O Tec offers a Print Head Warranty of {{head_warranty_months}} months starting from shipping date from China. After that period a New Print Head will be priced at INR {{post_warranty_head_price}} plus GST, on the new machine, first time installed head.

Under the premise that the buyer uses the ink provided by the seller, the seller shall provide the print head warranty. The buyer and the seller shall keep the print head testing bar signed by both parties on the day of installation completion. In case of print head damage not caused by the buyer during the warranty period, the damaged print head can be replaced free of charge (the old replaced print head shall be returned to the seller). However, the warranty on the first replaced print head will be for 12 months or the balance warranty, whichever is higher. Any print head replaced under the 12-month programme will have repetitive warranty. In case of any physical damage, a new print head is to be purchased from Orange O Tec.

The print head should be operated under print head specification requirement according to the machine maintenance list. Damage that is the buyer''s responsibility includes (but is not limited to) the following:
1. Modification or disassembling on print head.
2. Mechanical shock applied to the print head.
3. Liquid contact on terminals of connectors.
4. Print head operation under harsh environment.
5. Physical contact on nozzle plane with contaminated materials.
6. Using of the ink which is uncertified by seller.
7. Congealed ink clogged the nozzles.
8. In case of any accident happened or dent found on head.

Working condition requirements:
The working environment must be air conditioned as KYOCERA heads work properly and give better results within a temperature range of 22 to 28 degrees Celsius and relative humidity between 50 and 60%.

Atmosphere should not be dusty and temperature changes should not be excessive. It may cause irreversible damage to the print head.

Outside of these conditions it is not possible to ensure the proper functioning of machine, ink, other parts and consumables.

It is also recommended to verify the level of adhesion of the carpet before you start printing, bringing it to the operating temperature to prevent detachment of textile with probable damage to the print heads.

Request you to have a camera installed on machines which covers the whole carriage area when the machine is in use. In case the camera is not installed or not working, unfortunately we will not be able to take responsibility for the print heads in case of any mishap.

When the machine is idle: keep the power supply of the machine and compressor ON, take the test draw timely and even run a full density test for 15 to 20 meters at an interval of two hours. Failing to do so could result in clogged nozzles, which are not acceptable by Kyocera either.';
  c_customer_care text := 'Masonry works and excavations, external connections to the machine and between interactive systems (electrical lines, gas, water, compressed air, steam and oil, etc.) according to our technical specifications; any exhausts and outgoing air conduits; any lifting equipment and means of transportation necessary for assembly; possible walkways and grids; possible voltage stabilizer for tension oscillations +/-5% over the declared value; all liabilities related to the assessment of static capacity and dynamics of the building''s structure in the machine''s installation area and all legal procedures (whenever requested by local authorities) for the installation and activation of the system; anything not mentioned in the above offer text. Blanket adhesives, chemicals, inks, and consumables in general.';
  c_cancellation text := 'Our offer and quotation is valid for {{quotation_validity_days}} days only. This contract will enter into validity only when we receive a duly signed order from you as an acceptance within the validity period of the quotation.

All the dates and timelines mentioned in the proposal are indicative and usual tolerances are admitted.

We hope this offer meets your desires. Please do not hesitate to contact us for any additional questions.

Thanking you and assuring you of our best services and co-operation at all times.

We request you to submit a copy of the duly signed order confirmation to us for acceptance.';
  c_bank text := 'Delivery Terms: {{trade_term}}
Delivery Days: {{delivery_days}}
Payment terms: {{payment_terms}}
Insurance: Product Insurance borne by Customer.

Bank Details:
{{bank_block}}';

  -- Alpha family: warranty differs in SUBSTANCE, not just wording
  c_alpha_warranty text := 'Warranty period will be of {{machine_warranty_months}} months, except print head and consumables, from the date of installation, and it will be treated as onsite warranty.

After completion of warranty, no AMC charges will be applicable if the customer uses Orange ink.

Orange will be responsible to deliver or replace only those parts which are supplied by Orange.

In case technical intervention is necessary, the company will bear the technician cost only, while lodging and boarding shall be borne by the client/customer.

The company will not be responsible for any damage due to non-technical reasons such as physical damage, mishandling, environmental reasons or improper setup. In such a case the technician cost will also be chargeable and an invoice will be generated for the same.

Our service person can visit the digital printer room at any time during working hours with your supervisor.

Consumable items are not considered under warranty.
Consumable items: to be purchased directly from M/s {{consumables_supplier}} only.

Working condition requirements:
Operating temperature range of 20 to 24 degrees Celsius and operating humidity between 40% and 60%.

Atmosphere should not be dusty and temperature changes should not be excessive. It may cause irreversible damage to the machine and print head.

Outside of these conditions it is not possible to ensure the proper functioning of machine, ink, other parts and consumables.';
  c_alpha_pc_spec text := 'One PC - configuration:
Windows 7
Mother board Intel Core i5 or i7, 64 bit
16 GB RAM
HDD: 1 TB
250 GB SSD
USB 2.0 Port

To avoid any possible problem please send us an email with the complete list of components to be checked for compatibility.';

  -- Pengda: warranty first, no print-head policy
  c_pengda_warranty text := 'Machine Warranty {{machine_warranty_months}} months from the date of installation, excluding quick-wear parts like felt, rubber roller and drum coating.

During warranty time, Orange covers the replacement of defective spare parts without shipping cost. Freight cost shall be undertaken by the client.

Cost price shall be charged after the warranty period.

After completion of the warranty, AMC charges will be applicable as per the real-time terms and conditions of the company.

Orange will be responsible to deliver or replace only those parts which are supplied by Orange.

In case technical intervention is necessary, the company will bear the technician cost only, while lodging and boarding shall be borne by the client/customer.

The company will not be responsible for any damage due to non-technical reasons such as physical damage, mishandling, environmental reasons or improper setup. In such a case the technician cost will also be chargeable and an invoice will be generated for the same.';
  c_pengda_not_included text := 'Lodging and boarding charges are not included, and it is to be borne by the client/customer or paid extra at actual. Transportation charges will be borne by us.

Our technician must be supported by your personnel according to our requirements. Utilities connection works at your care and charge.

Before the installation can start the customer has to have finished the foundation works according to our Plan, the supply of electric energy, compressed air etc.';
  c_pengda_scope text := 'As applicable to above equipment specification the prices do not include: Compressor, UPS, AC, Toughened Glass, Table stand and Humidifier.

Customer is also responsible to provide all equipment necessary for the unloading and keeping the machine at the required place.';
  c_pengda_cancellation text := 'Once an order is placed it will not be cancelled. In an unavoidable situation, or in a particular case where cancellation is required, any payment made will not be refundable or adjustable.

Our offer and quotation is valid for {{quotation_validity_days}} days only. This contract will enter into validity only when we receive a duly signed order from you as an acceptance within the validity period of the quotation.

All the dates and timelines mentioned in the proposal are indicative and usual tolerances are admitted.

We request you to submit a copy of the duly signed order confirmation to us for acceptance.';

begin
  -- ── Homer + P8: the full set, including the print-head policy ──────────
  for v_name in select unnest(array['Homer K24','Homer K32','P8S','P8D']) loop
    select id into v_id from public.fms_ocpi_machines where name = v_name;
    if v_id is null then continue; end if;
    if exists (select 1 from public.fms_ocpi_machine_sections where machine_id = v_id) then continue; end if;
    insert into public.fms_ocpi_machine_sections (machine_id, key, title, body, sort_order) values
      (v_id, 'sale_conditions',  'SALE CONDITIONS OF THE SUPPLY',                                        c_bank,             10),
      (v_id, 'installation',     'INSTALLATION AND START-UP',                                            c_installation,     20),
      (v_id, 'not_included',     'NOT INCLUDED',                                                         c_not_included,     30),
      (v_id, 'delivery_scope',   'NOT INCLUDED IN OUR DELIVERY SCOPE',                                   c_delivery_scope,   40),
      (v_id, 'pc_spec',          'FOR THE GOOD OPERABILITY OF THE MACHINE, WE SUGGEST THE FOLLOWING SET UP OR SIMILAR', c_pc_spec, 50),
      (v_id, 'machine_warranty', 'MACHINE WARRANTY',                                                     c_machine_warranty, 60),
      (v_id, 'head_policy',      'PRINT HEAD POLICY PROGRAM',                                            c_head_policy,      70),
      (v_id, 'customer_care',    'WORKS AT CUSTOMER''S CARE AND EXCLUSIONS',                             c_customer_care,    80),
      (v_id, 'cancellation',     'CANCELLATION',                                                         c_cancellation,     90);
  end loop;

  -- ── Alpha: one combined warranty, its own PC spec, no print-head policy ─
  for v_name in select unnest(array[
      'Kolorado Alpha 15',
      'KoloRado Alpha II — 1.8 m, 8 heads',
      'KoloRado Alpha II — 1.9 m, 8 heads (OT-1908A)',
      'KoloRado Alpha II — 2.2 m, 8 heads',
      'KoloRado Alpha 3.2 — 24 heads']) loop
    select id into v_id from public.fms_ocpi_machines where name = v_name;
    if v_id is null then continue; end if;
    if exists (select 1 from public.fms_ocpi_machine_sections where machine_id = v_id) then continue; end if;
    insert into public.fms_ocpi_machine_sections (machine_id, key, title, body, sort_order) values
      (v_id, 'sale_conditions',  'SALE CONDITIONS OF THE SUPPLY',                                        c_bank,             10),
      (v_id, 'installation',     'INSTALLATION AND START-UP',                                            c_installation,     20),
      (v_id, 'not_included',     'NOT INCLUDED',                                                         c_not_included,     30),
      (v_id, 'delivery_scope',   'NOT INCLUDED IN OUR DELIVERY SCOPE',                                   c_delivery_scope,   40),
      (v_id, 'pc_spec',          'FOR THE GOOD OPERABILITY OF THE MACHINE, WE SUGGEST THE FOLLOWING SET UP OR SIMILAR', c_alpha_pc_spec, 50),
      (v_id, 'warranty',         'WARRANTY',                                                             c_alpha_warranty,   60),
      (v_id, 'customer_care',    'WORKS AT CUSTOMER''S CARE AND EXCLUSIONS',                             c_customer_care,    70),
      (v_id, 'cancellation',     'CANCELLATION',                                                         c_cancellation,     80);
  end loop;

  -- ── Pengda: warranty FIRST, shorter set, no print-head policy ──────────
  select id into v_id from public.fms_ocpi_machines where name = 'Pengda PD-1700XD-1000';
  if v_id is not null and not exists (select 1 from public.fms_ocpi_machine_sections where machine_id = v_id) then
    insert into public.fms_ocpi_machine_sections (machine_id, key, title, body, sort_order) values
      (v_id, 'warranty',        'WARRANTY TERMS',                      c_pengda_warranty,      10),
      (v_id, 'sale_conditions', 'SALE CONDITIONS OF THE SUPPLY',       c_bank,                 20),
      (v_id, 'installation',    'INSTALLATION AND START-UP',           c_installation,         30),
      (v_id, 'not_included',    'NOT INCLUDED',                        c_pengda_not_included,  40),
      (v_id, 'delivery_scope',  'NOT INCLUDED IN OUR DELIVERY SCOPE',  c_pengda_scope,         50),
      (v_id, 'cancellation',    'CANCELLATION',                        c_pengda_cancellation,  60);
  end if;
end $seed$;

commit;
