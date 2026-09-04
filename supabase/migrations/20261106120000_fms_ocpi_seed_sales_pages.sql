-- OCPI-36 · Stage 3 — the twelve sales pages, lifted out of the real invoices.
--
-- ── THESE ARE TRANSCRIPTIONS. NOBODY AUTHORED THEM HERE. ───────────────────
--
-- Every page below was rendered with pdf.js out of a Performa Invoice a real
-- customer has already been sent, across both financial-year folders
-- (`2025.26 OC&PI`, 20 deals, and `2026.27 OC&PI`, 27 deals). Rewording one is a
-- decision for Bushra, not a tidy-up for whoever reads this next.
--
-- 🔴 THE HEADING IS NOT ALWAYS "Key Benefits of …". Eight read that; FOUR read
--    "Advantages of …" — Pengda, Kolorado Alpha 15, and the FEDAR variant. The
--    first sweep of this work searched for the wrong phrase and missed them
--    entirely, which is why the heading is a stored field and page 2 was taken
--    whole rather than matched on a pattern.
--
-- ── FOUR TRANSCRIPTION DECISIONS, EACH MADE AGAINST THE RENDERED PAGE ──────
--
--   1. WRAPPED LINES ARE REJOINED. The source PDFs break mid-sentence and even
--      mid-word — "…printhead self-" / "cleaning system (First in Class)". Stored
--      as two lines they would print a hard break in the middle of a word,
--      because this renderer wraps to its own column width. Rejoined into one
--      logical line each.
--
--   2. 🔴 PENGDA'S HEADINGS ARE DE-SPACED. Its deck bakes letter-spacing into the
--      content stream as real characters: the tagline is literally stored as
--      "S p e e d y . S u p r e m e ." in a single text item, and the two
--      sub-headings as "P r o d u c t iv it y" and "A d v a n t a g e s" — note
--      the irregular "iv"/"it" pairs, which is what proves it is tracking rather
--      than deliberate spaces. Transcribed verbatim they would print exactly like
--      that on a customer's invoice. Stored as the words.
--
--   3. "Productivity" IS A BULLET ON THREE DECKS AND A SUB-HEADING ON A FOURTH,
--      and both are kept as printed. On K24, K32 and Rocket it sits at the bullet
--      indent inside the Applications list; on Sub Pro II+ it is a sub-heading
--      with its figure beneath. That inconsistency is in the source papers. It is
--      transcribed, not corrected — flagged to Bushra instead.
--
--   4. `K 64` AND `K64` ARE THE SAME PAGE TYPED TWO WAYS. One row, headed `K64`;
--      the typo is not seeded.
--
-- ── ALPHA 15: TWELVE HEADINGS, ONE BODY ────────────────────────────────────
--
-- 🟢 THE WORKLIST ENTRY SAID THE TWO ALPHA 15 PAGES HAD DIFFERENT BODIES. THEY
--    DO NOT. `Advantages of KOLORADO ALPHA15` (folders 117, 125) and
--    `Advantages of FEDAR 15` (folder 86) were both rendered and compared: they
--    are identical word for word, bullet for bullet, and only the heading
--    differs. So the "obsolete brochure page" risk the entry was guarding against
--    does not exist, and the page is seeded rather than held back. Ritesh Bhai
--    chose the Kolorado heading, 02-09-2026.
--
-- ⚠ `ALPHA15` IS PRINTED WITHOUT A SPACE ON BOTH 2026-27 PAPERS, so it is stored
--   that way. It is consistent across the folders rather than a one-off slip,
--   which is why it is not treated like the `K 64` typo above. Worth one question
--   to Bushra alongside the Kolorado-vs-FEDAR one, and a one-word edit if she
--   wants it changed.
--
-- ── WHAT IS DELIBERATELY NOT HERE ──────────────────────────────────────────
--
-- Ten of the 28 machines get no page: MP5000, JPK, Mini Lario, Kolorado Alpha 16,
-- Foil Machine, Label Printer and Book Printer have never had one — no deal has
-- ever been raised on them, which is exactly why — and Fab Pro 1I / 3I and P8D
-- await Bushra's confirmation that they share their siblings' page. Their
-- invoices print the 2-page form, which folder 107 proves is correct.
--
-- ⚠ ADDITIVE AND RE-RUNNABLE. `on conflict do nothing` on the insert, and the
--   mapping only fills a machine whose `sales_page_id` is still null — so this
--   never overwrites a choice somebody made on the Machines master afterwards.
--
-- ⚠ IT RAISES IF A MACHINE NAME DOES NOT RESOLVE. A renamed machine would
--   otherwise silently map nothing and the fault would surface months later as a
--   PI missing its page. Better to fail here.

-- ⚠ RE-RUNNABLE WITHOUT A UNIQUE CONSTRAINT. `on conflict do nothing` would
--   NOT have deduped here: nothing in the table is unique, so a second run
--   would have inserted twelve more rows and every machine would still point
--   at the first set. The `where not exists` on the name is what makes this
--   safe to apply twice.

insert into public.fms_ocpi_sales_pages (name, heading, blocks, sort_order)
select v.name, v.heading, v.blocks, v.sort_order
  from (values
  ('Homer K24', 'Key Benefits of HOMER K24', '[{"kind":"tagline","text":"Suave. Slick. Sturdy"},{"kind":"para","text":"HOMER K24 by Colorix offers HIGH SPEED DIRECT TO FABRIC PRINTING that provides best Price to Performance Ratio and Superior Product Quality."},{"kind":"subhead","text":"Applications"},{"kind":"para","text":"HOMER K24 creates new standards in direct to fabric printing. It is useful for printing various kinds of designs on fabrics with varied types of finishes and textures."},{"kind":"bullet","text":"Sportswear & Apparel"},{"kind":"bullet","text":"Fashion"},{"kind":"bullet","text":"Gifts & Merchandising"},{"kind":"bullet","text":"Interior Decoration"},{"kind":"bullet","text":"Sport Accessories"},{"kind":"bullet","text":"Soft Signage"},{"kind":"bullet","text":"Productivity"},{"kind":"bullet","text":"Upto 260 Linear Meter/Hr"},{"kind":"subhead","text":"Advantages"},{"kind":"bullet","text":"Efficient belt cleaning system"},{"kind":"bullet","text":"De-wrinkle system (Best in Class)"},{"kind":"bullet","text":"Moving Roll (First in Class)"},{"kind":"bullet","text":"Specialized conveyor belt for digital printing"},{"kind":"bullet","text":"Anti-scratch printhead protection design"},{"kind":"bullet","text":"Magnetic linear motor and steel rail beam"},{"kind":"bullet","text":"Intelligent constant-moisturizing capping system and Creative auto-wiping printhead self-cleaning system (First in Class)"}]'::jsonb, 10),
  ('Homer K32', 'Key Benefits of HOMER K32', '[{"kind":"tagline","text":"Suave. Slick. Sturdy"},{"kind":"para","text":"HOMER K32 by Colorix offers LARGE FORMAT INKJET PRINTING MACHINE that provides best Price to Performance Ratio and Superior Product Quality."},{"kind":"subhead","text":"Applications"},{"kind":"para","text":"HOMER K32 creates new standards in large format inkjet printing. It is useful for printing various kinds of designs on fabrics with varied types of finishes and textures."},{"kind":"bullet","text":"Sportswear & Apparel"},{"kind":"bullet","text":"Fashion"},{"kind":"bullet","text":"Gifts & Merchandising"},{"kind":"bullet","text":"Interior Decoration"},{"kind":"bullet","text":"Sport Accessories"},{"kind":"bullet","text":"Soft Signage"},{"kind":"bullet","text":"Productivity"},{"kind":"bullet","text":"Upto 375 Linear Meter/Hr"},{"kind":"subhead","text":"Advantages"},{"kind":"bullet","text":"Efficient belt cleaning system"},{"kind":"bullet","text":"De-wrinkle system (Best in Class)"},{"kind":"bullet","text":"Moving Roll (First in Class)"},{"kind":"bullet","text":"Specialized conveyor belt for digital printing"},{"kind":"bullet","text":"Anti-scratch printhead protection design"},{"kind":"bullet","text":"Magnetic linear motor and steel rail beam"},{"kind":"bullet","text":"Intelligent constant-moisturizing capping system and Creative auto-wiping printhead self-cleaning system (First in Class)"}]'::jsonb, 20),
  ('K64', 'Key Benefits of K64', '[{"kind":"tagline","text":"Advanced Technology and Superior Performance"},{"kind":"bullet","text":"Exceptional Precision"},{"kind":"bullet","text":"Ink Chilling System"},{"kind":"bullet","text":"Ink Misting Control"},{"kind":"bullet","text":"Air Blade Technology"},{"kind":"para","text":"The K64 is a game-changer in the industry. This machine sets a new benchmark for high-quality, efficient fabric printing, meeting the dynamic demands of today''s textile landscape."},{"kind":"para","text":"Efficient Media Handling The K64 is equipped with a variety of features for efficient media handling, including adjustable tension unwind, cloth trolley and pair side feeding (optional). These features ensure smooth and consistent fabric feeding, preventing wrinkles and tension issues"},{"kind":"bullet","text":"Effective Drying Options"},{"kind":"bullet","text":"User-Friendly Operation"},{"kind":"bullet","text":"Robust and Reliable Performance"},{"kind":"bullet","text":"Comprehensive After-Sales Support"}]'::jsonb, 30),
  ('Rocket', 'Key Benefits of HOMER ROCKET MACHINE', '[{"kind":"tagline","text":"Suave. Slick. Sturdy"},{"kind":"para","text":"HOMER Rocket Machine by Colorix offers HIGH SPEED DIRECT TO FABRIC PRINTING that provides best Price to Performance Ratio and Superior Product Quality."},{"kind":"subhead","text":"Applications"},{"kind":"para","text":"HOMER Rocket Machine creates new standards in direct to fabric printing. It is useful for printing various kinds of designs on fabrics with varied types of finishes and textures."},{"kind":"bullet","text":"Sportswear & Apparel"},{"kind":"bullet","text":"Fashion"},{"kind":"bullet","text":"Gifts & Merchandising"},{"kind":"bullet","text":"Interior Decoration"},{"kind":"bullet","text":"Sport Accessories"},{"kind":"bullet","text":"Soft Signage"},{"kind":"bullet","text":"Productivity"},{"kind":"bullet","text":"Upto 260 Linear Meter/Hr"},{"kind":"subhead","text":"Advantages"},{"kind":"bullet","text":"Efficient belt cleaning system"},{"kind":"bullet","text":"De-wrinkle system (Best in Class)"},{"kind":"bullet","text":"Moving Roll (First in Class)"},{"kind":"bullet","text":"Specialized conveyor belt for digital printing"},{"kind":"bullet","text":"Anti-scratch printhead protection design"},{"kind":"bullet","text":"Magnetic linear motor and steel rail beam"},{"kind":"bullet","text":"Intelligent constant-moisturizing capping system and Creative auto-wiping printhead self-cleaning system (First in Class)"}]'::jsonb, 40),
  ('Position Printer', 'Key Benefits of Position Printer', '[{"kind":"tagline","text":"Swifter. Smarter. Superhero"},{"kind":"para","text":"Industrial high-speed conveying-belt direct-to-textile digital printer with Outstanding printing speed and precision, excellent reliability and stability. Equipped with Advanced industrial design, high-efficiency data processing technology, it is a cost-effective machine that brings customers more profit and return."},{"kind":"subhead","text":"Applications"},{"kind":"para","text":"position printer creates new standards in direct to fabric printing. It is useful for printing various kinds of designs on fabrics with varied types of finishes and textures."},{"kind":"bullet","text":"Sport Accessories"},{"kind":"bullet","text":"Soft Signage"},{"kind":"bullet","text":"Fashion"},{"kind":"bullet","text":"Gifts & Merchandising"},{"kind":"bullet","text":"Sportswear & Apparel"},{"kind":"bullet","text":"Interior Decoration"},{"kind":"subhead","text":"Advantages"},{"kind":"para","text":"Big carriage size provides enough space and reduce error making it convenient for maintenance of carriage and to find faults in electronics and faults in ink pipes for inlet and outlet of heads."},{"kind":"para","text":"Accelerating + De-accelerating motion of carriage allows smoother motion of carriage which reduces the misprints at border of the images."},{"kind":"para","text":"Mounted Centering Device on the feeding side of machine provides more precision in controlling the left right motion of fabric providing higher tension to the fabric movement."},{"kind":"para","text":"Washing unit consisting of 2 squeezing units and 2 water absorbing sponge along with a brush roll equipped with motor provides efficient cleaning of the ink from blanket providing best printing result."}]'::jsonb, 50),
  ('Fab Pro 2i', 'Key Benefits of Fab Pro 2i', '[{"kind":"bullet","text":"Efficient Ink Supply System: Sufficient ink supply to prevent ink starvation."},{"kind":"bullet","text":"Wrinkle Control System: High precise sensor prevent wrinkle coming from feeder system."},{"kind":"bullet","text":"5 Stage squeeze system for water resistant: for easy belt wash & jet cleaning, with no blockage due to lint or dust."},{"kind":"bullet","text":"Dryer: The Dryer unit offers customizable temperature control system."},{"kind":"bullet","text":"Lapp Wire: The Lapp wire is being used in the complete control panel in machine."},{"kind":"bullet","text":"Capping & Wiping System Used: To keep inks from drying in the print head & remove wastages."}]'::jsonb, 60),
  ('Sub Pro II+', 'Key Benefits of Sub Pro II+', '[{"kind":"tagline","text":"Revolutionary. Reputable. Robust"},{"kind":"para","text":"It is a High Speed Sublimation Printing Machine. This Sub Pro II+ machine uses lesser amount of print head and gives increased production. it can print up to *8000 meter in a single day and can work more efficiently with few worker and lesser cost."},{"kind":"subhead","text":"Applications"},{"kind":"para","text":"Sub Pro II takes digital printing to next level and helps you print your creative designs on various kinds of media and material, for equally myriad ideas."},{"kind":"bullet","text":"Sportswear & Apparel"},{"kind":"bullet","text":"Fashion"},{"kind":"bullet","text":"Gifts & Merchandising"},{"kind":"bullet","text":"Interior Decoration"},{"kind":"bullet","text":"Sport Accessories"},{"kind":"bullet","text":"Soft Signage"},{"kind":"subhead","text":"Productivity"},{"kind":"para","text":"Upto 400 linear Meter/Hr"},{"kind":"subhead","text":"Advantages"},{"kind":"bullet","text":"Print heads staggering in 2 rows"},{"kind":"bullet","text":"Intelligent constant-moisturizing capping system and creative auto-wiping printhead self-cleaning system"},{"kind":"bullet","text":"Tension-adjustable continuous winding/unwinding control technology"},{"kind":"bullet","text":"Adjustable vacuum system"},{"kind":"bullet","text":"Industrial ink supply system: Peristaltic-pump ink supplies Automated negative pressure monitoring & adjusting system efficient ink degassing"},{"kind":"bullet","text":"Separate medial entry unit (Optional)"}]'::jsonb, 70),
  ('Alpha II', 'Key Benefits of Alpha II', '[{"kind":"tagline","text":"Detailed, Different, Diverse"},{"kind":"bullet","text":"Alpha II is a Dye Sublimation Printer that uses piezoelectric Inject printing technology. It ensures bulk printing with high-quality and high-speed."},{"kind":"subhead","text":"Advantages"},{"kind":"bullet","text":"Double High-precision mute rail."},{"kind":"bullet","text":"Front expander."},{"kind":"bullet","text":"Media retraction tension Bar."},{"kind":"bullet","text":"Inflatable take up and feed media shaft."},{"kind":"bullet","text":"Stable 5L bulk system ensure amazing printing speed."},{"kind":"bullet","text":"Rear media balance bar."},{"kind":"bullet","text":"Jumbo media roll maximum 1000m media load."},{"kind":"bullet","text":"Frequency motor ensure more stable material loading and take-up."}]'::jsonb, 80),
  ('KoloRado Alpha III', 'Key Benefits of KoloRado ALPHA III', '[{"kind":"tagline","text":"Detailed, Different, Diverse"},{"kind":"bullet","text":"Alpha III is a Dye Sublimation Printer that uses piezoelectric Inject printing Technology. It ensures bulk printing with high-quality and high-speed."},{"kind":"subhead","text":"Advantages"},{"kind":"bullet","text":"Double High-precision mute rail."},{"kind":"bullet","text":"Front expander."},{"kind":"bullet","text":"Media retraction tension Bar."},{"kind":"bullet","text":"Inflatable take up and feed media shaft."},{"kind":"bullet","text":"Stable 5L bulk system ensure amazing printing speed."},{"kind":"bullet","text":"Rear media balance bar."},{"kind":"bullet","text":"Jumbo media roll maximum 1000m media load."},{"kind":"bullet","text":"Frequency motor ensure more stable material loading and take-up."}]'::jsonb, 90),
  ('Alpha 12', 'Key Benefits of ALPHA 12', '[{"kind":"bullet","text":"CAPPING STATION:"},{"kind":"para","text":"This Fedar Digital Printer uses a special design four heads capping station for good quality output and the high speed print."},{"kind":"bullet","text":"CARRIAGE:"},{"kind":"para","text":"Fedar FD5198E Sublimation printer has as industrial carriage design that can adjust carriage height for different paper and also has as anti-collision system to protect the head safely."},{"kind":"bullet","text":"INK TANK:"},{"kind":"para","text":"Digital Textile Printer uses 4L big ink tank which can reduce fill ink times."},{"kind":"bullet","text":"MOTOR :"},{"kind":"para","text":"Fedar Printer with industrial motors for taking and feeding material system to increase its lifetime."},{"kind":"bullet","text":"STRIP ROLLER:"},{"kind":"para","text":"Special tension rubber roller can reduce dark color job thin paper wrinkle effect."},{"kind":"bullet","text":"MIRROR:"},{"kind":"para","text":"Fedar FD5198E Sublimation printer has a big Mirror that can be checking head surface better."},{"kind":"bullet","text":"PLATFORM:"},{"kind":"para","text":"Advance platform sucking design and aluminum body to improve print accuracy."}]'::jsonb, 100),
  ('Kolorado Alpha 15', 'Advantages of KOLORADO ALPHA15', '[{"kind":"bullet","text":"INDUSTRIAL GRADE SPEED:"},{"kind":"para","text":"610m2/h"},{"kind":"bullet","text":"HIGH-PRECISION MACHINED PRINTER BEAM"},{"kind":"bullet","text":"IMPORTED THK MUTE GUIDE RAIL"},{"kind":"bullet","text":"INDUSTRIAL SERVO DRIVE REDUCER"},{"kind":"subhead","text":"NEW DESIGNED:"},{"kind":"bullet","text":"CARRIAGE PLATE"},{"kind":"para","text":"Carriage is driven by linear motor, cooperative with maglev guide rail, more stable and accurate during printing."},{"kind":"para","text":"Special designed paper transmission roller, which is for thin paper printing, 20-30g paper can be printed perfectly without wrinkle."},{"kind":"para","text":"Fluoro rubber pinch roller imported from the United States, which can prevent static electricity and ink flying. Printing size is more accurate. Each pinch roller is independent and able to be lifted up separately to avoid wrinkle during printing."},{"kind":"para","text":"New upgrade of the carriage plate, staggered head arrangement, 15head is divided into three groups, 1 pass equals to 3 pass, high speed and high quality."}]'::jsonb, 110),
  ('Pengda', 'Advantages of Heat Transfer Machine 800 Dia', '[{"kind":"tagline","text":"Speedy. Supreme. Successful"},{"kind":"para","text":"Pengda Technology is a multifunctional machine for Heat transfer or digital print transfer. It does both pieces and rolls that as well with minimal operators and high consistency. It is convenient with pre-cut pieces as well. This technology allows us to present you with an overall solution for all your digital printing needs."},{"kind":"subhead","text":"Productivity"},{"kind":"para","text":"600mm: 120-180m/hour | 800mm: 500m/hour | 1000mm: 775m/hour"},{"kind":"subhead","text":"Advantages"},{"kind":"bullet","text":"Touch Panel to Set Timer to Start & Off the Machine"},{"kind":"bullet","text":"See Real Time Speed"},{"kind":"bullet","text":"Checkout Actual Paper Transfer Time"},{"kind":"bullet","text":"Speed 7000 to up to 18600 Meter Per Day"}]'::jsonb, 120)
) as v(name, heading, blocks, sort_order)
 where not exists (select 1 from public.fms_ocpi_sales_pages s where s.name = v.name);

do $seed$
declare
  v_pairs text[][] := array[
    ['Homer K24', 'Homer K24'],
    ['Homer K32', 'Homer K32'],
    ['K64', 'K64'],
    ['Rocket', 'Rocket'],
    ['Position Printer', 'Position Printer'],
    ['Fab Pro 2I', 'Fab Pro 2i'],
    ['P8S', 'Sub Pro II+'],
    ['KoloRado Alpha II — 1.8 m, 8 heads', 'Alpha II'],
    ['KoloRado Alpha II — 1.9 m, 8 heads (OT-1908A)', 'Alpha II'],
    ['KoloRado Alpha II — 2.2 m, 8 heads', 'Alpha II'],
    ['KoloRado Alpha 3.2 — 8 heads', 'KoloRado Alpha III'],
    ['KoloRado Alpha 3.2 — 16 heads', 'KoloRado Alpha III'],
    ['KoloRado Alpha 3.2 — 24 heads', 'KoloRado Alpha III'],
    ['KoloRado Alpha 3 — 12 heads', 'Alpha 12'],
    ['Kolorado Alpha 15', 'Kolorado Alpha 15'],
    ['Pengda PD-1700XD-800', 'Pengda'],
    ['Pengda PD-1700XD-1000', 'Pengda'],
    ['Pengda PD-1800XD-800', 'Pengda']
  ];
  v_i int;
  v_hit int;
begin
  for v_i in 1 .. array_length(v_pairs, 1) loop
    update public.fms_ocpi_machines m
       set sales_page_id = p.id
      from public.fms_ocpi_sales_pages p
     where m.name = v_pairs[v_i][1]
       and p.name = v_pairs[v_i][2]
       and m.sales_page_id is null;
    get diagnostics v_hit = row_count;
    -- Already mapped counts as a hit; only a name resolving to NOTHING is a fault.
    if v_hit = 0 and not exists (
         select 1 from public.fms_ocpi_machines m2
          join public.fms_ocpi_sales_pages p2 on p2.id = m2.sales_page_id
          where m2.name = v_pairs[v_i][1] and p2.name = v_pairs[v_i][2]) then
      raise exception 'OCPI-36 seed: no machine named % for sales page %. Renamed?',
        v_pairs[v_i][1], v_pairs[v_i][2];
    end if;
  end loop;
end $seed$;
