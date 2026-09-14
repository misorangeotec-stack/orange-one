-- ============================================================================
-- OCPI · two sibling templates modelled on machines that already have one
-- (WORKLIST OCPI-4, follow-up to 20261023120000)
--
--   Fab Pro 3I        ← Fab Pro 2I
--   Kolorado Alpha 16 ← Kolorado Alpha 15
--
-- Both were asked for as "copy the sibling and change the model code". Neither
-- has a deck of its own — the client sheet marks both "Template available: No"
-- and there is no file for either in Misc/Bushra Reports/OCPI/. So unlike the
-- nine in 20261023120000, THIS CONTENT IS NOT TRANSCRIBED FROM A SOURCE
-- DOCUMENT; it is a sibling's text with the model name changed, on the client's
-- instruction that the specs are otherwise the same.
--
-- Takes the module from 19 of 28 templated to 21 of 28.
--
-- ⚠ Guarded `and has_template = false`, and sections are skipped when any
--   exist, so a re-run is a no-op and no existing template can be touched.
--
-- ⚠ THE CLAUSE SETS ARE COPIED IN SQL, NOT RETYPED. Checked first: not one of
--   Fab Pro 2I's nine bodies nor Kolorado Alpha 15's eight mentions a model
--   name, a head count or "2i"/"15", so they carry across unchanged. Copying
--   the rows is what the app's own `copyTemplate` does and it cannot drift.
--
-- 🔴 ONE THING TO CONFIRM ON Fab Pro 3I. The client said "all the specs remain
--    the same", so this carries Fab Pro 2I's figures verbatim — including
--    "Number of installable rows: Two" and "Number of installable printing
--    heads: 16 Heads", and "(16H)" in the composition. But the family scales
--    1i = one row / 8 heads, 2i = Two rows / 16 heads, so a 3i would normally
--    read Three rows / 24 heads. If it does, three figures on this contract are
--    wrong. Left exactly as instructed and raised in OCPI-4.
--    (Head count itself is safe either way — the spec row that states what the
--    customer is buying is {{head_count}}, off the deal.)
--
-- ⚠ On Kolorado Alpha 16, "15"/"16" is the MODEL designation, not a head count:
--   Alpha 15's own "Number of print heads" row is already {{head_count}}. So the
--   change is the model name throughout, and no head figure is fixed anywhere.
-- ============================================================================

-- ── Fab Pro 3I ← Fab Pro 2I ─────────────────────────────────────────────────
update public.fms_ocpi_machines set
  intro_text = 'Following up your kind order, we are glad to confirm the supply of Fabpro 3i Large Format Inkjet Printer Machine at the under mentioned conditions',
  machine_model_no = 'Fab Pro 3i',
  supply_description = 'DIRECT TO FABRIC INKJET PRINTER WITH STANDARD ACCESSORIES WITH {{head_count}} PRINTHEADS & WITH DRYER (LARGE FORMAT INKJET PRINTER)',
  spec_rows = $j$[
    {"label":"No. of Machine Supply","value":"{{machine_count}}"},
    {"label":"Model","value":"Fab Pro 3i"},
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
    "Adjustable pressure of the fabric pressing cylinder- up to 0.6 MPA Printing unit model Colorix Fab Pro 3i (16H) to print from 4 to 8 colors.",
    "Height adjustment of the printing carriage over the blanket Built-in electrical cabinet",
    "Operator interface controlling all machine operative parameters",
    "Blanket washing unit with driven brush and cleaning/drying sponges to remove water residues.",
    "Presence of Pinching Roll for to obtain better results on thin(low GSM fabric."
  ]$j$::jsonb,
  header_fields = '["attn","date","ref","address"]'::jsonb,
  signoff_style = 'checked_by',
  doc_title = 'ORDER CONFIRMATION',
  has_template = true
where name = 'Fab Pro 3I' and has_template = false;

-- ── Kolorado Alpha 16 ← Kolorado Alpha 15 ───────────────────────────────────
update public.fms_ocpi_machines set
  intro_text = 'Following up your kind order, we are glad to confirm the supply of Kolorado Alpha - 16 Digital Printing Machine at the under mentioned conditions',
  supply_description = 'Digital Sublimation Printer Kolorado Alpha 16 with Standard Accessories (With {{head_count}} heads)',
  billing_name = 'SUBLIMATION PRINTER KOLORADO ALPHA 16 WITH STANDARD ACCESSORIES (LARGE FORMAT PRINTERS FOR INDUSTRIAL USE)',
  spec_rows = $j$[
    {"label":"No. of Machine Supply","value":"{{machine_count}}"},
    {"label":"Model","value":"Kolorado Alpha 16"},
    {"label":"Number of print heads","value":"{{head_count}} Heads (Epson i3200)"},
    {"label":"Max. Printing width","value":"1800 mm | 1900 mm"},
    {"label":"Max. Media width","value":"1800 mm | 1900 mm"},
    {"label":"Electrical Voltage","value":"Printer: VAC 210-230, 15.5KW"}
  ]$j$::jsonb,
  composition = $j$[
    "1000 Meter Roll Support",
    "Roll to Roll feeding system",
    "Printing unit model Kolorado 16 to print from 2 to 4 colors.",
    "Built-in electrical cabinet.",
    "Operator interface controlling all machine operative parameters.",
    "Effective Drafting with the help of fans.",
    "Front Dryer"
  ]$j$::jsonb,
  header_fields = '["attn","date","ref","address"]'::jsonb,
  signoff_style = 'approved_by',
  doc_title = 'ORDER CONFIRMATION',
  has_template = true
where name = 'Kolorado Alpha 16' and has_template = false;

-- ── Sections, copied off each sibling ───────────────────────────────────────
do $seed$
declare
  v_src uuid;
  v_dst uuid;
begin
  select id into v_src from public.fms_ocpi_machines where name = 'Fab Pro 2I';
  select id into v_dst from public.fms_ocpi_machines where name = 'Fab Pro 3I';
  if v_src is not null and v_dst is not null
     and not exists (select 1 from public.fms_ocpi_machine_sections where machine_id = v_dst) then
    insert into public.fms_ocpi_machine_sections (machine_id, key, title, body, sort_order)
    select v_dst, s.key, s.title, s.body, s.sort_order
      from public.fms_ocpi_machine_sections s where s.machine_id = v_src;
  end if;

  select id into v_src from public.fms_ocpi_machines where name = 'Kolorado Alpha 15';
  select id into v_dst from public.fms_ocpi_machines where name = 'Kolorado Alpha 16';
  if v_src is not null and v_dst is not null
     and not exists (select 1 from public.fms_ocpi_machine_sections where machine_id = v_dst) then
    insert into public.fms_ocpi_machine_sections (machine_id, key, title, body, sort_order)
    select v_dst, s.key, s.title, s.body, s.sort_order
      from public.fms_ocpi_machine_sections s where s.machine_id = v_src;
  end if;
end $seed$;

-- Verified 31-Aug-2026 by rendering both through the app's own buildOcPdf
-- against live data: Fab Pro 3I 4 pages / 9 sections / 11 spec rows,
-- Kolorado Alpha 16 3 pages / 8 sections / 6 spec rows; 0 render errors,
-- 0 unresolved {{…}}, 0 ruled blanks, and no stale "Fab Pro 2i" / "Alpha 15"
-- string left in either resolved document.
