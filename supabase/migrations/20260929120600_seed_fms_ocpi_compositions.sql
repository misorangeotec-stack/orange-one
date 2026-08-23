-- ===========================================================================
-- OCPI FMS — the remaining "THE MACHINE IS COMPOSED AS FOLLOWS" lists.
--
-- 20260929120500 seeded composition for the three decks whose list was
-- unambiguous. This fills the rest, read from the decks in reading order.
-- Pengda is deliberately absent: its deck has no composition list at all.
--
-- ⚠ FOUR ITEMS ARE DELIBERATELY LEFT OUT OF THE K32 LIST — "Ink Dust
--   Exhauster", "External Centring Device", "Air Blade" and "Head Cooling
--   System". They appear in that deck because THAT DEAL included them, not
--   because a K32 always has them: the Microsoft form asks about each one
--   separately (Air Blade, External Centering System, Ink Dust Exhauster,
--   Chilling System — questions 34 to 37), and those answers live on the deal.
--   Baking them into the machine would print "Air Blade" on the contract of a
--   customer who did not buy one. The order-confirmation renderer appends the
--   options a deal actually includes (phase 7); the machine keeps only what is
--   always true of it.
--
-- ⚠ TRANSCRIPTION NOTE FOR BUSHRA: the 1.9 m deck's own composition block is
--   headed "1 LARGE FORMAT INKJET PRINTER(1.8 Meter)" — the 1.8 m deck's line,
--   left behind when the 1.9 m variant was copied from it. Not reproduced here.
--   Recorded in OCPI.md; the width in the spec table (1900 mm) is used instead.
--
-- Idempotent: only fills a composition that is still empty.
--
-- Reversal:
--   update public.fms_ocpi_machines set composition = '[]'::jsonb
--    where name in (…the seven names below…);
-- ===========================================================================

begin;

update public.fms_ocpi_machines set composition = $j$[
  "Ink feeding system complete with in-line filters and Degassing units.",
  "Driven unwinding unit with expanding shaft to support fabric rolls on cardboard cores having max. Diameter of 400 mm.",
  "Fabric tensioning bars with adjustable incidence to control fabric tension during unwinding. It is equipped with a spreading roll and a bent bar that can be used alternatively by the operator according to the fabric being processed.",
  "Adjustable pressure of the fabric pressing cylinder- up to 0.6 MPA Printing unit model Homer K32 to print from 4 to 8 colors. Height adjustment of the printing carriage over the blanket Built-in electrical cabinet",
  "Operator interface controlling all machine operative parameters",
  "Blanket washing unit with driven brush and cleaning/drying sponges and wipers to remove water residues.",
  "Presence of Moving Roll for to obtain better results on thin(low GSM fabric).",
  "Ink Circulation : When we give cleaning or fill up then inks go back to primary tank instead of getting waste.",
  "Auto Purging System : When head is at capping position, it keeps firing at regural interval, so nozzle remains moist.",
  "Large flow and high-speed degassing device",
  "Automatic negative pressure system",
  "Large memory Industrial server",
  "Tension-adjustable continous unwinding/rewinding control technology"
]$j$::jsonb
where name = 'Homer K32' and composition = '[]'::jsonb;

update public.fms_ocpi_machines set composition = $j$[
  "Ink feeding system complete with in-line filters and Degassing units.",
  "Driven unwinding unit with expanding shaft to support paper rolls on cardboard cores having max. Diameter of 400 mm or have max weight 200kg.",
  "Roll to Roll feeding system",
  "Printing unit model P8S to print from 4 to 8 colors.",
  "Built-in electrical cabinet.",
  "Operator interface controlling all machine operative parameters.",
  "Effective Drafting with the help of fans.",
  "Bottom Dryer for uniform drying."
]$j$::jsonb
where name = 'P8S' and composition = '[]'::jsonb;

update public.fms_ocpi_machines set composition = $j$[
  "1000 Meter Roll Support",
  "Roll to Roll feeding system",
  "Printing unit model Kolorado 15 to print from 2 to 4 colors.",
  "Built-in electrical cabinet.",
  "Operator interface controlling all machine operative parameters.",
  "Effective Drafting with the help of fans.",
  "Front Dryer"
]$j$::jsonb
where name = 'Kolorado Alpha 15' and composition = '[]'::jsonb;

update public.fms_ocpi_machines set composition = $j$[
  "1000 Meter Roll Support",
  "Roll to Roll feeding system",
  "Printing unit model KoloRado alpha II to print from 2 to 4 colors.",
  "Built-in electrical cabinet.",
  "Operator interface controlling all machine operative parameters.",
  "Effective Drafting with the help of fans.",
  "Front Dryer"
]$j$::jsonb
where name in (
  'KoloRado Alpha II — 1.8 m, 8 heads',
  'KoloRado Alpha II — 1.9 m, 8 heads (OT-1908A)'
) and composition = '[]'::jsonb;

update public.fms_ocpi_machines set composition = $j$[
  "1000 Meter Roll Support",
  "Roll to Roll feeding system",
  "Printing unit model KoloRado alpha II to print from 2 to 4 colors.",
  "Built-in electrical cabinet.",
  "Operator interface controlling all machine operative parameters.",
  "Effective Drafting with the help of fans.",
  "Front Dryer",
  "Including INK if any, Custom Duty & Transportation charges will be paid by Customer."
]$j$::jsonb
where name = 'KoloRado Alpha II — 2.2 m, 8 heads' and composition = '[]'::jsonb;

commit;
