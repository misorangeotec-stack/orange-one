-- R1 · The delivery PERIOD replaces the delivery DATE, on the form and on the
--      contract - reversing OCPI-18 (20261102120000) on the client's instruction.
--
-- WHY THIS REVERSES A DELIBERATE DECISION
--   OCPI-18 (01-Sep-2026, Ritesh Bhai) retired `delivery_days` ON PURPOSE so that
--   a deal's invoice and its contract could never carry two different delivery
--   promises, and OCPI-OC-AUDIT.md B-01 carries an explicit
--   "Do not restore `delivery_days`". THIS FILE RESTORES IT KNOWINGLY.
--
--   The counted evidence went the other way. Across all 36 real Performa Invoices
--   in the 26-27 folder: 28 state a number of DAYS, 0 state a date, 8 say nothing.
--   Across the 11 re-entered contracts: 0 of 11 matched. Read back off real papers
--   with pdf.js while writing this:
--
--       folder 109 (Laxmipati)  Delivery Terms : 30 Days from the date of confirmation
--       folder  81 (Swati)      Delivery Terms : 30 Days After Order Confirmation.
--
--   THE PROPERTY OCPI-18 WAS PROTECTING IS KEPT. One field still feeds the
--   invoice, the summary sheet and every contract deck, from one column. Only its
--   SHAPE changed, from a date to a duration. The two papers still cannot disagree.
--
-- THE LABEL IS `Shipment Terms`
--   The plurality across the real invoices - 16 of 36, against 12 for
--   `Delivery Terms`. It also avoids a collision: the three Fab Pro decks already
--   print `{{trade_term}}` under a `Delivery Terms:` heading on the same page.
--
-- TWO LINES BECOME ONE
--   OCPI-18 turned one delivery line into two (the date, then its condition). This
--   turns them back into one, because the condition now rides inside the sentence.
--   The suffix is a SECOND COPY of `DELIVERY_PERIOD_SUFFIX` in lib/fieldSpec.ts and
--   has to be - a migration cannot import a TypeScript const. Change one and change
--   the other, or the form and the paper state the period differently.
--
-- DEPLOY ORDER, AND IT IS NOT NEGOTIABLE
--   `lib/tokens.ts` MUST SHIP BEFORE THIS FILE RUNS. `tokensFor` did not emit
--   `delivery_days` at all; a deck rewritten to use a token the resolver does not
--   know resolves to `undefined`, which `resolve()` prints as `________` - a ruled
--   blank in the delivery clause of a document a customer signs. OCPI-18's own
--   header records learning this in the other direction.
--
--   The shipped frontend emits BOTH tokens during the overlap. `delivery_date` is
--   removed from `tokensFor` in a FOLLOW-UP commit, after this has been applied.
--
-- 22 SECTIONS, NOT 21. OCPI-18 rewrote 21; B8 (20261114120001) has since split K64
--   into two build widths, and the clone carries the same clause.
--
-- TWO DEALS MUST BE FILLED BEFORE THE CHECK CONSTRAINT IS TIGHTENED - QT-M0037
--   (AARNAV FASHIONS, real) and QT-M0046 (ZZ TEST). Both hold a delivery date and
--   no period. A CHECK is re-validated against every row when added, so it would
--   abort on them. The constraint change is therefore NOT in this file; it is a
--   separate step once those two are answered through the form. A delivery promise
--   is not derivable from a date and must not be backfilled.

begin;

do $assert$
declare v_date int; v_cond int; v_days int; v_mach int; v_once int;
begin
  select count(*) into v_date from public.fms_ocpi_machine_sections
   where body like '%Tentative Machine Delivery Date: {{delivery_date}}%'
     and key='sale_conditions' and active;
  if v_date <> 22 then raise exception 'R1 pre 1: expected 22 active sale_conditions with the date line, found %', v_date; end if;

  select count(distinct machine_id) into v_mach from public.fms_ocpi_machine_sections
   where body like '%{{delivery_date}}%';
  if v_mach <> 22 then raise exception 'R1 pre 2: expected 22 distinct machines, found %', v_mach; end if;

  select count(*) into v_cond from public.fms_ocpi_machine_sections
   where body like '%Applicable from the date of signing of this contract.%';
  if v_cond <> 22 then raise exception 'R1 pre 3: expected 22 condition lines, found %', v_cond; end if;

  select count(*) into v_days from public.fms_ocpi_machine_sections where body like '%delivery_days%';
  if v_days <> 0 then raise exception 'R1 pre 4: the days token is already in use (%) - this has run before', v_days; end if;

  select count(*) into v_once from public.fms_ocpi_machine_sections
   where body like '%{{delivery_date}}%'
     and (length(body)-length(replace(body,'{{delivery_date}}','')))/length('{{delivery_date}}') = 1;
  if v_once <> 22 then raise exception 'R1 pre 5: expected 22 bodies holding the token exactly once, found %', v_once; end if;
end $assert$;

-- Matched on the TOKEN and its condition line, never on the surrounding prose -
-- the lesson OCPI-18 recorded when five different headings turned out to exist.
update public.fms_ocpi_machine_sections
   set body = replace(body,
         E'Tentative Machine Delivery Date: {{delivery_date}}\nApplicable from the date of signing of this contract.',
         'Shipment Terms: {{delivery_days}} Days from the date of confirmation'),
       updated_at = now()
 where body like '%Tentative Machine Delivery Date: {{delivery_date}}%';

do $post$
declare v_date int; v_cond int; v_days int; v_once int;
begin
  select count(*) into v_date from public.fms_ocpi_machine_sections where body like '%delivery_date%';
  if v_date <> 0 then raise exception 'R1 post 1: delivery_date survives in % section(s)', v_date; end if;

  select count(*) into v_cond from public.fms_ocpi_machine_sections
   where body like '%Applicable from the date of signing of this contract.%';
  if v_cond <> 0 then raise exception 'R1 post 2: % condition line(s) survive', v_cond; end if;

  select count(*) into v_days from public.fms_ocpi_machine_sections
   where body like '%Shipment Terms: {{delivery_days}} Days from the date of confirmation%'
     and key='sale_conditions' and active;
  if v_days <> 22 then raise exception 'R1 post 3: expected 22 new delivery lines, found %', v_days; end if;

  select count(*) into v_once from public.fms_ocpi_machine_sections
   where body like '%{{delivery_days}}%'
     and (length(body)-length(replace(body,'{{delivery_days}}','')))/length('{{delivery_days}}') = 1;
  if v_once <> 22 then raise exception 'R1 post 4: expected the token exactly once in 22 bodies, found %', v_once; end if;
end $post$;

commit;
