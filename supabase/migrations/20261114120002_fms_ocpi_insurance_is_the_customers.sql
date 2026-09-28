-- R2 · Insurance is the CUSTOMER'S, in one wording, on every templated machine.
--
-- WHAT WAS WRONG
--   Our papers promised a SPLIT: the company covered up to the point of loading,
--   the customer covered unloading. Every real signed paper puts the whole risk on
--   the customer. This was logged as a defect in SIX places — WORKLIST N-18,
--   OCPI.md D-4, WORKLIST F-05, OCPI-OC-AUDIT A-04 / A-07 / A-10 — and no decision
--   anywhere defended it. It is NOT one of the two protected differences in
--   OCPI-OC-AUDIT.md ("do not fix these" holds B-01 and B-02 only).
--
--   Ritesh Bhai settled it 07-09-2026: transit insurance, borne by the customer.
--
-- SIX WORDINGS BECOME ONE
--   Counted live before writing this: 21 active `sale_conditions` sections carried
--   an insurance line, in SIX different wordings —
--     Insurance: Product Insurance borne by Customer.        (12)
--     Insurance: Insurance will be borne by customer.         (3)
--     Insurance: Product Insurance is Borne by Customer.      (2)
--     Insurance: Covered by customer.                         (1)
--     Insurance: Insurance will borne by Customer.            (1)
--     Insurance: Borne by the customer.                       (1)
--   All six already placed the cost on the customer, so this is a NORMALISATION,
--   not a change of promise. The promise changes on the INVOICE and the SUMMARY
--   SHEET, which read `INSURANCE_CLAUSE` in lib/fieldSpec.ts — the const and these
--   bodies must be changed together or the two papers disagree.
--
--   ⚠ MATCHED ON THE LINE, NOT THE PROSE. Anchoring on any one of the six would
--     have rewritten a fraction and left the rest — the lesson OCPI-18 recorded.
--
-- JPK GAINS THE LINE
--   JPK was the ONLY templated machine whose contract said nothing about insurance
--   at all. Ritesh Bhai's answer covers every machine, so it is appended rather
--   than left silent.
--
-- THE CANCELLATION CLAUSE: SPELLING ONLY
--   Five `cancellation` sections read "Insurance will be bare by Customer." That
--   clause is about LOADING AND UNLOADING responsibility, not transit cover, so its
--   meaning is untouched — only `bare` becomes `borne`.
--   ⚠ THE CLIENT'S OWN SIGNED PAPERS CARRY THE SAME SLIP. Correcting it is a
--     DEPARTURE from the originals, chosen knowingly on 07-09-2026 — deliberately
--     unlike 20261106130000, where the K32 contract's own `SQUEZEE` was kept.
--
-- 🔴 DEPLOY ORDER: ship lib/fieldSpec.ts FIRST. This file changes only literal
--    text — no token — so it is safe against any frontend; but until the new
--    INSURANCE_CLAUSE is deployed, the contract states the new promise while the
--    invoice still states the old one.

begin;

do $assert$
declare v_sale int; v_wordings int; v_cancel int; v_jpk int;
begin
  select count(*) into v_sale from public.fms_ocpi_machine_sections
   where key='sale_conditions' and active and body ilike '%insurance%';
  if v_sale <> 21 then raise exception 'R2 pre 1: expected 21 sale_conditions insurance lines, found %', v_sale; end if;

  select count(*) into v_wordings from (
    select distinct trim(regexp_replace(substring(body from '(?n)^.*[Ii]nsurance.*$'), '\s+',' ','g'))
      from public.fms_ocpi_machine_sections where key='sale_conditions' and active and body ilike '%insurance%') t;
  if v_wordings <> 6 then raise exception 'R2 pre 2: expected 6 distinct wordings, found %', v_wordings; end if;

  select count(*) into v_cancel from public.fms_ocpi_machine_sections
   where key='cancellation' and active and body like '%bare by Customer%';
  if v_cancel <> 5 then raise exception 'R2 pre 3: expected 5 cancellation "bare" lines, found %', v_cancel; end if;

  select count(*) into v_jpk from public.fms_ocpi_machine_sections s
    join public.fms_ocpi_machines m on m.id=s.machine_id
   where m.name='JPK' and s.key='sale_conditions' and s.active and s.body ilike '%insurance%';
  if v_jpk <> 0 then raise exception 'R2 pre 4: JPK already states insurance (%)', v_jpk; end if;
end $assert$;

update public.fms_ocpi_machine_sections
   set body = regexp_replace(body, '(?n)^.*[Ii]nsurance.*$',
              'Insurance: Transit insurance will be borne by the customer.', 'g'),
       updated_at = now()
 where key='sale_conditions' and active and body ilike '%insurance%';

update public.fms_ocpi_machine_sections s
   set body = s.body || E'\nInsurance: Transit insurance will be borne by the customer.',
       updated_at = now()
  from public.fms_ocpi_machines m
 where m.id = s.machine_id and m.name = 'JPK' and s.key = 'sale_conditions' and s.active;

update public.fms_ocpi_machine_sections
   set body = replace(body, 'Insurance will be bare by Customer.', 'Insurance will be borne by Customer.'),
       updated_at = now()
 where key='cancellation' and active and body like '%bare by Customer%';

do $post$
declare v_one int; v_left int; v_bare int; v_dupe int;
begin
  select count(*) into v_one from public.fms_ocpi_machine_sections
   where key='sale_conditions' and active
     and body like '%Insurance: Transit insurance will be borne by the customer.%';
  if v_one <> 22 then raise exception 'R2 post 1: expected 22 machines stating the clause, found %', v_one; end if;

  select count(*) into v_left from (
    select distinct trim(regexp_replace(substring(body from '(?n)^.*[Ii]nsurance.*$'), '\s+',' ','g'))
      from public.fms_ocpi_machine_sections where key='sale_conditions' and active and body ilike '%insurance%') t;
  if v_left <> 1 then raise exception 'R2 post 2: expected ONE wording, found %', v_left; end if;

  select count(*) into v_bare from public.fms_ocpi_machine_sections where body like '%bare by Customer%';
  if v_bare <> 0 then raise exception 'R2 post 3: % "bare" spelling(s) survive', v_bare; end if;

  select count(*) into v_dupe from public.fms_ocpi_machine_sections
   where key='sale_conditions' and active
     and (length(body)-length(replace(body,'Insurance: Transit insurance will be borne by the customer.','')))
         / length('Insurance: Transit insurance will be borne by the customer.') <> 1;
  if v_dupe <> 0 then raise exception 'R2 post 4: % section(s) carry the clause other than exactly once', v_dupe; end if;
end $post$;

commit;
