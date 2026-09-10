-- R8 (part one) · The Homer K24's customs heading, read off the client's own
--                  papers — and the ONLY code in the whole archive that our
--                  master did not already hold.
--
-- THE SWEEP, AND WHY IT FOUND SO LITTLE
--   Every PDF, .docx, .pptx and .xlsx under `Misc/Bushra Reports/OCPI` in both
--   the 2025.26 and 2026.27 folders was searched for a customs heading. The
--   whole archive holds exactly TWO distinct codes:
--
--     84433910  x14   Homer K32 (78, 82, 83, 119) · K64 1.8 m (120) ·
--                     K64 3.2 m (109) · Position Printer (105, 106) ·
--                     Rocket (121)                      ← ALREADY IN THE MASTER
--     84433250  x4    Homer K24 (107 x3, 114)           ← THIS FILE
--
--   That is the entire evidence base. Nothing else in either year states one.
--
-- 🔴 THE FIRST SWEEP MISSED THIS CODE, AND THE REASON IS THE POINT. It matched
--    on the string `HSN`, which is what 14 of the 18 occurrences say. The K24
--    papers say `HS CODE:84433250` — no N, no space before the colon:
--
--      folder 107  (MODEL - HM1800B-TK24-A1) (HS CODE:84433250)
--      folder 114  (MODEL - HM1800B-TK24-A1) (HS CODE:84433250)
--
--    Anchoring on one spelling of a label is the same trap `20261102120000`
--    recorded for delivery headings. Match the CODE's shape, not its caption.
--
-- ⚠ A DIFFERENT HEADING FROM THE K32, DELIBERATELY RECORDED AS SUCH. Both are
--   large-format inkjet textile printers built on the same line, and it would be
--   easy to assume one heading covers both. The papers say otherwise, four times
--   across two unrelated customers (Pankaj Fashions and Ventura Creations) with
--   no disagreement, so the difference is transcribed rather than reconciled.
--   ⚠ Worth putting to the client at some point — but a customs heading is not
--     ours to harmonise, and 84433250 is what the K24 has actually shipped under.
--
-- 🟢 THE TWO UNREADABLE PAPERS HIDE NOTHING. Folders 108 and 110 are image-only
--    scans ("SCAN & SIGNED"), so no text can be pulled from them. Both carry a
--    readable twin in the same folder — the pre-signature PDF and a .docx — and
--    neither twin states a heading. The gap is closed, not assumed away.
--
-- 🟢 NO CODE PRINTS ANYWHERE IT DID NOT BEFORE. The heading is omitted entirely
--    when blank, on both papers, so filling one machine adds a line to the K24's
--    invoice and contract and changes nothing else.
--
-- 🔴 R8 IS NOT CLOSED BY THIS FILE. 23 machines still have no heading, and no
--    paper in the archive supplies one. They remain a client ask.
--
-- ⚠ SEPARATE FINDING, NOT ACTED ON HERE: those same K24 papers print the model
--   as `HM1800B-TK24-A1`, while `fms_ocpi_machines.machine_model_no` holds
--   `HM1800B-TK24` with no `-A1`. That is a different column and a different
--   decision; raised, not changed.

begin;

do $assert$
declare v_n int; v_k24 text;
begin
  select count(*) into v_n from public.fms_ocpi_machines where hsn_code is not null;
  if v_n <> 5 then raise exception 'R8a pre 1: expected 5 machines already coded, found %', v_n; end if;

  select count(*) into v_n from public.fms_ocpi_machines
   where hsn_code is not null and hsn_code <> '84433910';
  if v_n <> 0 then raise exception 'R8a pre 2: % existing code(s) are not 84433910 — re-read the papers', v_n; end if;

  select hsn_code into v_k24 from public.fms_ocpi_machines where name = 'Homer K24';
  if not found then raise exception 'R8a pre 3: no machine named Homer K24'; end if;
  if v_k24 is not null then raise exception 'R8a pre 4: Homer K24 already carries % — this has run before', v_k24; end if;
end $assert$;

update public.fms_ocpi_machines
   set hsn_code = '84433250', updated_at = now()
 where name = 'Homer K24' and hsn_code is null;

do $post$
declare v_n int; v_k24 text;
begin
  select hsn_code into v_k24 from public.fms_ocpi_machines where name = 'Homer K24';
  if v_k24 <> '84433250' then raise exception 'R8a post 1: Homer K24 reads %', coalesce(v_k24, 'NULL'); end if;

  select count(*) into v_n from public.fms_ocpi_machines where hsn_code is not null;
  if v_n <> 6 then raise exception 'R8a post 2: expected 6 coded machines, found %', v_n; end if;

  select count(*) into v_n from public.fms_ocpi_machines where hsn_code = '84433910';
  if v_n <> 5 then raise exception 'R8a post 3: the five 84433910 machines were disturbed — % remain', v_n; end if;

  select count(*) into v_n from public.fms_ocpi_machines where hsn_code is null;
  if v_n <> 23 then raise exception 'R8a post 4: expected 23 still uncoded, found %', v_n; end if;

  -- A heading is 8 digits and nothing else; a stray space would print onto a paper.
  select count(*) into v_n from public.fms_ocpi_machines
   where hsn_code is not null and hsn_code !~ '^\d{8}$';
  if v_n <> 0 then raise exception 'R8a post 5: % code(s) are not 8 bare digits', v_n; end if;
end $post$;

commit;
