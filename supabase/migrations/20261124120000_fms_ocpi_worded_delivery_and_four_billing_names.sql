-- OCPI · Two answers from the client, 14-Sep-2026, taken one question at a time.
--
-- 1 · A WORDED DELIVERY PERIOD PRINTS ALONE ON THE CONTRACT
--
--   R1 made the delivery promise a period with a fixed suffix. All 22 machine
--   decks carry the suffix as LITERAL text:
--
--       Shipment Terms: {{delivery_days}} Days from the date of confirmation
--
--   so QT-M0041 (Skymidtown Textiles), answered "Immediately", printed
--   "Shipment Terms: Immediately Days from the date of confirmation" on the
--   contract. The invoice and the summary sheet already dropped the suffix for a
--   worded answer; a token cannot, because the suffix is not inside it. Client's
--   call: fix the contract rather than retype the deal.
--
--   The suffix is wrapped in a condition the frontend answers:
--
--       Shipment Terms: {{delivery_days}}[[if periodInDays]] Days from the date of confirmation[[/if]]
--
--   `periodInDays` (lib/conditions.ts) is true on a number of days AND on an
--   unanswered period — "________ Days from the date of confirmation" says what
--   the gap is asking — and false only on a worded answer.
--
--   🟢 SAFE IN EITHER DEPLOY ORDER. A browser tab running the old bundle does not
--      know `periodInDays`; an unknown condition FAILS OPEN, which prints the
--      suffix — exactly today's wording. Nothing can print worse than now.
--   🟢 FROZEN PAPERS DO NOT MOVE. `oc_document_payload` stores resolved text.
--   ⚠ The marker is one line and not nested — `conditions.ts` blocks are
--     line-local and nesting strips every marker and keeps every word.
--
-- 2 · FOUR BILLING NAMES (B2)
--
--   Client's answer: copy each machine's own existing wording, invent nothing.
--     Fab Pro 2I, Fab Pro 3I  →  Fab Pro 1I's billing name, with the head count
--                                taken from the deal ({{head_count}}) instead of
--                                1I's hardcoded 8, and the R4 heads pair kept.
--     JPK                     →  "MS JPK EVO V4", from its contract's supply line.
--     MP5000                  →  "INK-JET PRINTING MACHINE MODEL MS-JP7", from its
--                                contract's supply line.
--   Mini Lario stays NULL — it has no wording anywhere. A NULL billing name is
--   not an empty line: the invoice falls back to the machine name.
--
--   🟢 Both changes were rendered through the app's own buildOcPdf / buildPiPdf
--      with this data applied in memory, and read back with pdf.js, BEFORE this
--      file was written.

begin;

do $pre$
declare v_n int;
begin
  select count(*) into v_n from public.fms_ocpi_machine_sections
   where body like '%Shipment Terms: {{delivery_days}} Days from the date of confirmation%';
  if v_n <> 22 then raise exception 'pre 1: expected 22 sections with the literal suffix, found %', v_n; end if;

  select count(*) into v_n from public.fms_ocpi_machine_sections
   where body like '%Shipment Terms: {{delivery_days}} Days from the date of confirmation%'
     and (key <> 'sale_conditions'
          or (length(body) - length(replace(body, 'Shipment Terms: {{delivery_days}}', ''))) / length('Shipment Terms: {{delivery_days}}') <> 1);
  if v_n <> 0 then raise exception 'pre 2: % section(s) are not sale_conditions or carry the line more than once', v_n; end if;

  select count(*) into v_n from public.fms_ocpi_machine_sections where body ilike '%periodindays%';
  if v_n <> 0 then raise exception 'pre 3: % section(s) already name periodInDays — this has run before', v_n; end if;

  select count(*) into v_n from public.fms_ocpi_machines
   where name in ('Fab Pro 2I', 'Fab Pro 3I', 'JPK', 'MP5000') and billing_name is null;
  if v_n <> 4 then raise exception 'pre 4: expected 4 blank billing names, found % — someone filled one by hand', v_n; end if;
end $pre$;

update public.fms_ocpi_machine_sections
   set body = replace(body,
         'Shipment Terms: {{delivery_days}} Days from the date of confirmation',
         'Shipment Terms: {{delivery_days}}[[if periodInDays]] Days from the date of confirmation[[/if]]'),
       updated_at = now()
 where body like '%Shipment Terms: {{delivery_days}} Days from the date of confirmation%';

update public.fms_ocpi_machines
   set billing_name = 'LARGE FORMAT INKJET PRINTER[[if heads]] WITH {{head_count}} HEADS[[/if]][[if noHeads]] (WITHOUT PRINTHEADS)[[/if]] WITH STD. ACCESSORIES',
       updated_at = now()
 where name in ('Fab Pro 2I', 'Fab Pro 3I') and billing_name is null;

update public.fms_ocpi_machines set billing_name = 'MS JPK EVO V4', updated_at = now()
 where name = 'JPK' and billing_name is null;

update public.fms_ocpi_machines set billing_name = 'INK-JET PRINTING MACHINE MODEL MS-JP7', updated_at = now()
 where name = 'MP5000' and billing_name is null;

do $post$
declare v_n int;
begin
  select count(*) into v_n from public.fms_ocpi_machine_sections
   where body like '%Shipment Terms: {{delivery_days}} Days from the date of confirmation%';
  if v_n <> 0 then raise exception 'post 1: % section(s) still carry the bare suffix', v_n; end if;

  select count(*) into v_n from public.fms_ocpi_machine_sections
   where body like '%Shipment Terms: {{delivery_days}}[[if periodInDays]] Days from the date of confirmation[[/if]]%';
  if v_n <> 22 then raise exception 'post 2: expected 22 wrapped lines, found %', v_n; end if;

  -- flat, closed pairs on every line of every section and every billing name
  select count(*) into v_n from (
    select l from public.fms_ocpi_machine_sections s, regexp_split_to_table(s.body, E'\n') l
    union all
    select billing_name from public.fms_ocpi_machines where billing_name is not null
  ) x
  where regexp_replace(l, '\[\[if\s+!?\s*[a-z0-9_]+\s*\]\][^\n\[]*?\[\[/if\]\]', '', 'gi') ~ '\[\[|\]\]';
  if v_n <> 0 then raise exception 'post 3: % line(s) carry an unpaired or nested marker', v_n; end if;

  select count(*) into v_n from public.fms_ocpi_machines
   where name in ('Fab Pro 2I', 'Fab Pro 3I', 'JPK', 'MP5000') and billing_name is null;
  if v_n <> 0 then raise exception 'post 4: % of the four billing names are still blank', v_n; end if;

  select count(*) into v_n from public.fms_ocpi_machines where billing_name is null;
  if v_n <> 1 then raise exception 'post 5: expected exactly 1 blank billing name (Mini Lario), found %', v_n; end if;
end $post$;

commit;
