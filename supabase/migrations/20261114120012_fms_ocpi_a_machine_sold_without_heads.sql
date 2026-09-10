-- R4 · A machine sold WITHOUT print heads stops saying it has them.
--
-- THE DEFECT, ON A REAL SIGNED PAPER
--   Folder 108, M K Fashion, bought a KoloRado Alpha II with no print heads.
--   Their own contract reads `ALPHA II (WITHOUT PRINTHEADS)`. Ours would print
--   `LARGE FORMAT INKJET PRINTER WITH 8 HEADS WITH STD. ACCESSORIES` — promising
--   eight heads the customer never bought — because the phrase is fixed text on
--   the machine master and no deal could vary it.
--
--   SEVEN REAL QUOTATIONS ARE WRONG TODAY: QT-M0037 Aarnav (32), QT-M0042 and
--   QT-M0044 Shan Textiles (15 each), QT-M0038 Aarnav, QT-M0062 M K Fashions,
--   QT-M0041 Skymidtown, QT-M0036 test. Three more print a ruled
--   `WITH ________ PRINTHEADS`.
--
-- 🔴 PHASE 1 MUST ALREADY BE LIVE. `heads` / `noHeads` were added to
--    `conditionsFor` AND `CONDITION_HELP` in commit 0b58fd8, and an EMPTIED
--    SECTION is dropped whole in the follow-up. An unknown condition FAILS OPEN
--    (`conditions.ts:181-184`), so against an older bundle every deal would
--    print BOTH branches — `WITH 24 HEADS (WITHOUT PRINTHEADS)` — on the priced
--    line of a document a customer signs. The pre-flight cannot check the
--    browser; the deploy order is the control.
--
-- TWO POSITIVE NAMES, NEVER A NEGATION
--   `heads` is `incl_head = true`, `noHeads` is `incl_head = false`. They are not
--   opposites: both are false while the question is unanswered, so silence can
--   never assert "(WITHOUT PRINTHEADS)". `[[if !heads]]` would have printed that
--   promise out of nothing on seven deals.
--
-- ⚠ `incl_head = false` MEANS "NOT IN THE MACHINE PRICE", NOT "NO HEADS"
--   (branching.ts:207-235). A deal may still buy heads separately. That does not
--   change the PRICED SUPPLY LINE, which describes what the machine price
--   covers. It would change the spec row — but no live deal has
--   `head_offer_agreed = true`, and the fix if one ever does is to key that row
--   on `head_offer_qty`. Recorded, not guessed at.
--
-- SEVEN PHRASINGS, NOT SIX — the docket and an earlier note both miscounted.
-- Grouped by the exact fragment around `{{head_count}}`, never by prose, and
-- each group asserts its own count. The model number and the HSN literal stay
-- OUTSIDE every marker: `ocPdf.ts` · `machineDetailLine` suppresses its own line
-- when the description already says them, and P8D is the one machine where the
-- model sits immediately after the head phrase.

begin;

do $assert$
declare v_n int;
begin
  select count(*) into v_n from public.fms_ocpi_machines
   where coalesce(supply_description,'') like '%[[if heads]]%'
      or coalesce(billing_name,'') like '%[[if heads]]%';
  if v_n <> 0 then raise exception 'R4 pre 1: markers already present on % machine(s) — this has run before', v_n; end if;

  select count(*) into v_n from public.fms_ocpi_machines where supply_description ~ '\{\{head_count\}\}';
  if v_n <> 18 then raise exception 'R4 pre 2: expected 18 tokenised descriptions, found %', v_n; end if;

  select count(*) into v_n from public.fms_ocpi_machine_sections where key='head_policy' and active;
  if v_n <> 11 then raise exception 'R4 pre 3: expected 11 head_policy sections, found %', v_n; end if;

  select count(*) into v_n from public.fms_ocpi_machine_sections
   where key='head_policy' and active and body like '%[[%';
  if v_n <> 0 then raise exception 'R4 pre 4: % head_policy section(s) already hold a marker — wrapping would NEST', v_n; end if;
end $assert$;

-- ───────────────────────────────── 1 · the priced supply line, 7 phrasings ──
do $supply$
declare
  r record;
  v_total int := 0;
begin
  for r in
    select * from (values
      (' WITH {{head_count}} PRINTHEADS',      7),
      (' WITH {{head_count}} PRINT HEADS',     1),
      (' With {{head_count}} Print Heads',     1),
      (' (With {{head_count}} heads)',         2),
      (' (with {{head_count}} heads)',         3),
      (' (With {{head_count}} printheads)',    3),
      ('-{{head_count}} PRINTING HEADS',       1)
    ) as t(frag, expect)
  loop
    -- The leading space rides INSIDE the marker, or a false condition leaves a
    -- double space where the phrase was.
    update public.fms_ocpi_machines
       set supply_description = replace(
             supply_description, r.frag,
             '[[if heads]]' || r.frag || '[[/if]][[if noHeads]] (WITHOUT PRINTHEADS)[[/if]]'),
           updated_at = now()
     where position(r.frag in coalesce(supply_description,'')) > 0;
    get diagnostics v_total = row_count;
    if v_total <> r.expect then
      raise exception 'R4 supply: phrasing % changed % rows, expected %', r.frag, v_total, r.expect;
    end if;
  end loop;
end $supply$;

-- ⚠ ROCKET HAS NO TOKEN — its head is prose, so it gets its own guarded edit.
update public.fms_ocpi_machines
   set supply_description = replace(
         supply_description, ' KYOCERA EX600 RC PRINTHEAD',
         '[[if heads]] KYOCERA EX600 RC PRINTHEAD[[/if]][[if noHeads]] (WITHOUT PRINTHEADS)[[/if]]'),
       updated_at = now()
 where name = 'Rocket' and supply_description like '% KYOCERA EX600 RC PRINTHEAD%';

-- ─────────────────────────────────────── 2 · the invoice item description ──
-- The count here is PROSE mid-sentence, so `WITH STD. ACCESSORIES` must survive
-- on a headless deal — the cell is the only place the invoice names the product.
do $billing$
declare r record; v_n int;
begin
  for r in
    select * from (values
      (' WITH 8 HEADS', 7), (' WITH 24 HEADS', 2), (' WITH 64 PRINTHEADS', 2),
      (' WITH 224 PRINTHEADS', 1), (' WITH 12 HEADS', 1), (' WITH 32 HEADS', 1),
      (' WITH 16 HEADS', 1)
    ) as t(frag, expect)
  loop
    update public.fms_ocpi_machines
       set billing_name = replace(
             billing_name, r.frag,
             '[[if heads]]' || r.frag || '[[/if]][[if noHeads]] (WITHOUT PRINTHEADS)[[/if]]'),
           updated_at = now()
     where position(r.frag in coalesce(billing_name,'')) > 0;
    get diagnostics v_n = row_count;
    if v_n <> r.expect then
      raise exception 'R4 billing: phrasing % changed % rows, expected %', r.frag, v_n, r.expect;
    end if;
  end loop;
end $billing$;

-- ──────────────────────────────────────────────── 3 · the opening sentence ──
-- Three, not two: P8D reads `(8H)` and carries no word "head" at all, so a
-- `~* 'head'` sweep misses it. The literal is wrapped, never tokenised — adding
-- `{{head_count}}` where there was none would rule a blank on the one live deal
-- with heads and no count.
update public.fms_ocpi_machines
   set intro_text = replace(intro_text, ' (With 8 Head)',
         '[[if heads]] (With 8 Head)[[/if]][[if noHeads]] (Without Print Heads)[[/if]]'),
       updated_at = now()
 where name = 'P8S' and intro_text like '% (With 8 Head)%';

update public.fms_ocpi_machines
   set intro_text = replace(intro_text, ' (8H)',
         '[[if heads]] (8H)[[/if]][[if noHeads]] (Without Print Heads)[[/if]]'),
       updated_at = now()
 where name = 'P8D' and intro_text like '% (8H)%';

update public.fms_ocpi_machines
   set intro_text = replace(intro_text, ' with 8 heads',
         '[[if heads]] with 8 heads[[/if]][[if noHeads]] without print heads[[/if]]'),
       updated_at = now()
 where name = 'KoloRado Alpha II — 2.2 m, 8 heads' and intro_text like '% with 8 heads%';

-- ──────────────────────────────────────────────────── 4 · the spec table row ──
-- 🔴 THE WHOLE VALUE IS WRAPPED, EDGE TO EDGE. `renderSpecRows` drops a row only
--    when a condition EMPTIES it; wrapping just the token would leave
--    " Heads (Epson i3200)" — non-empty, so the row survives reading
--    "Number of print heads | Heads (Epson i3200)".
-- ⚠ CHOSEN BY THE VALUE HOLDING `{{head_count}}`, never by a label regex:
--   "Number of INSTALLABLE printing heads" is a machine capacity that stays true
--   with no heads fitted, and several machines carry both rows.
update public.fms_ocpi_machines m
   set spec_rows = (
         select jsonb_agg(
           case when e->>'value' like '%{{head_count}}%'
                then jsonb_set(e, '{value}',
                       to_jsonb('[[if heads]]' || (e->>'value') || '[[/if]]'))
                else e end
           order by ord)
           from jsonb_array_elements(m.spec_rows) with ordinality as t(e, ord)),
       updated_at = now()
 where m.spec_rows::text like '%{{head_count}}%';

-- ──────────────────────────────────── 5 · the print-head warranty clause ──
-- Client decision, 10-Sep-2026: it does not print on a headless deal.
-- ⚠ EVERY NON-BLANK LINE IS WRAPPED SEPARATELY, because a `[[if]]` block is
--   LINE-LOCAL (`conditions.ts:80`) and cannot span a newline. Blank lines are
--   left alone — `applyConditions` keeps an already-blank line, so the body
--   resolves to whitespace on a headless deal and the section is dropped WHOLE,
--   heading and all, by the skip added to `ocPdf.ts` in the same release.
update public.fms_ocpi_machine_sections s
   set body = (
         select string_agg(
           case when btrim(l) = '' then l else '[[if heads]]' || l || '[[/if]]' end,
           E'\n' order by n)
           from unnest(string_to_array(s.body, E'\n')) with ordinality as t(l, n)),
       updated_at = now()
 where s.key = 'head_policy' and s.active;

-- ───────────────────────────── 6 · Rocket's supply bullet and its paragraph ──
update public.fms_ocpi_machines
   set composition = (
         select jsonb_agg(
           case when e #>> '{}' = 'Printing Head Module'
                then to_jsonb('[[if heads]]Printing Head Module[[/if]]'::text)
                else e end order by ord)
           from jsonb_array_elements(composition) with ordinality as t(e, ord)),
       updated_at = now()
 where name = 'Rocket' and composition::text like '%Printing Head Module%';

do $post$
declare v_n int; v_bad text;
begin
  select count(*) into v_n from public.fms_ocpi_machines
   where supply_description like '%[[if heads]]%';
  if v_n <> 19 then raise exception 'R4 post 1: expected 19 conditional descriptions (18 + Rocket), found %', v_n; end if;

  select count(*) into v_n from public.fms_ocpi_machines where billing_name like '%[[if heads]]%';
  if v_n <> 15 then raise exception 'R4 post 2: expected 15 conditional billing names, found %', v_n; end if;

  select count(*) into v_n from public.fms_ocpi_machines where intro_text like '%[[if heads]]%';
  if v_n <> 3 then raise exception 'R4 post 3: expected 3 conditional intros, found %', v_n; end if;

  select count(*) into v_n from public.fms_ocpi_machines where spec_rows::text like '%[[if heads]]%';
  if v_n <> 21 then raise exception 'R4 post 4: expected 21 machines with a wrapped spec row, found %', v_n; end if;

  select count(*) into v_n from public.fms_ocpi_machine_sections
   where key='head_policy' and active and body like '%[[if heads]]%';
  if v_n <> 11 then raise exception 'R4 post 5: expected 11 wrapped head_policy sections, found %', v_n; end if;

  -- 🔴 EVERY WRAPPED SPEC VALUE MUST BE EDGE TO EDGE, or the row survives as a stub.
  select string_agg(m.name, ', ') into v_bad from public.fms_ocpi_machines m,
       jsonb_array_elements(m.spec_rows) e
   where e->>'value' like '%[[if heads]]%'
     and not (e->>'value' like '[[if heads]]%' and e->>'value' like '%[[/if]]');
  if v_bad is not null then raise exception 'R4 post 6: spec value not wrapped edge-to-edge on: %', v_bad; end if;

  /*
    🔴 BALANCE, CHECKED BY COUNTING THE PAIRS. `flatAndClosed` refuses a NESTED
       line by stripping every marker and KEEPING EVERY WORD — so a nest would
       print the heads phrase AND "(WITHOUT PRINTHEADS)" on every deal, silently,
       because `ocPdf.ts` discards `unbalanced`.

    ⚠ A REGEX FOR "AN OPEN INSIDE AN OPEN" CANNOT BE USED HERE: two SIBLING pairs
      — which is exactly what every edit above writes — match that shape too. So
      the test is that opens equal closes, and the real nesting guard is that the
      fragments replaced are single spans with no marker inside them (pre 1 and
      pre 4 prove none was there to begin with).
  */
  select string_agg(name, ', ') into v_bad from public.fms_ocpi_machines
   where (length(coalesce(supply_description,'')) - length(replace(coalesce(supply_description,''),'[[if','')))/4
      <> (length(coalesce(supply_description,'')) - length(replace(coalesce(supply_description,''),'[[/if]]','')))/7;
  if v_bad is not null then raise exception 'R4 post 7: unbalanced markers in supply_description on: %', v_bad; end if;

  select string_agg(name, ', ') into v_bad from public.fms_ocpi_machines
   where (length(coalesce(billing_name,'')) - length(replace(coalesce(billing_name,''),'[[if','')))/4
      <> (length(coalesce(billing_name,'')) - length(replace(coalesce(billing_name,''),'[[/if]]','')))/7;
  if v_bad is not null then raise exception 'R4 post 8: unbalanced markers in billing_name on: %', v_bad; end if;

  -- 🔴 NO DESCRIPTION MAY EMPTY ENTIRELY. `ocPdf.ts:763` is `if (supplyText)` — an
  --    emptied line prints NOTHING under TOTAL NET AMOUNT and the money block
  --    loses its subject. Every wrapped description must keep words outside the
  --    markers.
  select string_agg(name, ', ') into v_bad from public.fms_ocpi_machines
   where supply_description like '%[[if heads]]%'
     and btrim(regexp_replace(supply_description, '\[\[if [a-zA-Z!]+\]\][^\n]*?\[\[/if\]\]', '', 'g')) = '';
  if v_bad is not null then raise exception 'R4 post 9: description empties completely on: %', v_bad; end if;
end $post$;

commit;
