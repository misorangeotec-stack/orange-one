-- R4 (tail) · Rocket's SCOPE OF SUPPLY stops listing 224 print heads on a deal
--             sold without them.
--
-- WHY IT WAS LEFT OUT OF 20261114120012
--   That file gated the priced supply line, the invoice description, the spec
--   row, the opening sentence, the print-head warranty clause and Rocket's
--   composition bullet. Rendering all three states afterwards showed one thing
--   still speaking: Rocket's `scope_of_supply` clause carries a two-line block
--
--       Printing Head Module
--       The machine is equipped with high-performance industrial printheads.
--       Model: KYOCERA RC MODEL EX600RC. … Total Heads: 224 pcs (1515mm). …
--
--   which is a SUPPLY CLAIM — it says what is in the box — and it printed
--   unchanged on a headless render.
--
-- 🔴 ONLY LINES 13 AND 14. The same clause mentions printheads three more times
--    (lines 17, 20, 23) describing the printing CARRIAGE, the ink circulation
--    system and the degassing unit. Those are machine features that exist
--    whether or not heads are fitted, and gating them would delete real content
--    from a contract to fix a claim they never made. Matched on their opening
--    text, never on the word "head".
--
-- ⚠ TWO LINES, TWO SEPARATE `[[if]]` PAIRS. A block is LINE-LOCAL
--   (`conditions.ts:80`), so one pair cannot span the heading and its paragraph.
--   Both empty together on a headless deal; the surrounding clause keeps
--   printing, so no section is lost.
--
-- 🟢 NO LIVE DEAL IS AFFECTED TODAY — none of the ten `incl_head = false` deals
--    is a Rocket, and a single-pass machine is rarely sold without its heads.
--    Done anyway because the claim is wrong when it is wrong, and the render
--    proved it reachable.

begin;

do $assert$
declare v_n int;
begin
  select count(*) into v_n from public.fms_ocpi_machine_sections s
    join public.fms_ocpi_machines m on m.id = s.machine_id
   where m.name = 'Rocket' and s.key = 'scope_of_supply' and s.active
     and s.body like '%Printing Head Module%'
     and s.body like '%The machine is equipped with high-performance industrial printheads.%';
  if v_n <> 1 then raise exception 'R4 tail pre: expected 1 Rocket scope_of_supply with the head block, found %', v_n; end if;

  /*
    🟢 THE CLAUSE ALREADY CARRIES MARKERS, AND THEY ARE THE PRECEDENT FOR THIS.
       Lines 31-32 are `[[if dryer]]Dryer System[[/if]]` and its paragraph,
       wrapped one pair per line by OCPI-31 — exactly the shape used below. The
       first draft of this file refused to run because it checked the WHOLE
       clause for a marker; what matters is only that the two TARGET lines carry
       none, or the wrap would nest and `flatAndClosed` would keep every word.
  */
  select count(*) into v_n from public.fms_ocpi_machine_sections s
    join public.fms_ocpi_machines m on m.id = s.machine_id,
         lateral unnest(string_to_array(s.body, E'\n')) as l
   where m.name = 'Rocket' and s.key = 'scope_of_supply' and s.active
     and l like '%[[%'
     and (btrim(l) = 'Printing Head Module'
          or l like 'The machine is equipped with high-performance industrial printheads.%');
  if v_n <> 0 then raise exception 'R4 tail pre: a target line already holds a marker — wrapping would NEST'; end if;
end $assert$;

update public.fms_ocpi_machine_sections s
   set body = (
         select string_agg(
           case
             when btrim(l) = 'Printing Head Module'
               or l like 'The machine is equipped with high-performance industrial printheads.%'
             then '[[if heads]]' || l || '[[/if]]'
             else l
           end, E'\n' order by n)
           from unnest(string_to_array(s.body, E'\n')) with ordinality as t(l, n)),
       updated_at = now()
  from public.fms_ocpi_machines m
 where m.id = s.machine_id and m.name = 'Rocket' and s.key = 'scope_of_supply' and s.active;

do $post$
declare v_n int;
begin
  select count(*) into v_n from public.fms_ocpi_machine_sections s
    join public.fms_ocpi_machines m on m.id = s.machine_id,
         lateral unnest(string_to_array(s.body, E'\n')) as l
   where m.name = 'Rocket' and s.key = 'scope_of_supply' and s.active
     and l like '[[if heads]]%[[/if]]';
  if v_n <> 2 then raise exception 'R4 tail post 1: expected exactly 2 wrapped lines, found %', v_n; end if;

  -- 🔴 AND THE DRYER PAIR MUST SURVIVE — it shares this clause, and a wrap that
  --    caught the wrong lines would show up here before anywhere else.
  select count(*) into v_n from public.fms_ocpi_machine_sections s
    join public.fms_ocpi_machines m on m.id = s.machine_id,
         lateral unnest(string_to_array(s.body, E'\n')) as l
   where m.name = 'Rocket' and s.key = 'scope_of_supply' and s.active
     and l like '[[if dryer]]%[[/if]]';
  if v_n <> 2 then raise exception 'R4 tail post 1b: the dryer pair was disturbed — % line(s) remain', v_n; end if;

  /*
    ⚠ ONE, NOT THREE — AND THE ASSERTION IS WHAT CORRECTED ME. The header of
      this file first said three feature lines mention printheads, counted off a
      `%head%` sweep that had also matched "height" in the carriage line and a
      "heating" line. Counted properly, the clause names printheads exactly
      twice: line 14, which IS the supply claim and is wrapped above, and line
      20 — the ink circulation system, which keeps ink moving across the heads
      and describes plumbing that exists whether or not heads are fitted.

      So exactly ONE printhead line must survive unwrapped. If that ever becomes
      two, a real feature line has been swallowed by the wrap.
  */
  select count(*) into v_n from public.fms_ocpi_machine_sections s
    join public.fms_ocpi_machines m on m.id = s.machine_id,
         lateral unnest(string_to_array(s.body, E'\n')) as l
   where m.name = 'Rocket' and s.key = 'scope_of_supply' and s.active
     and l ilike '%printhead%' and l not like '[[%';
  if v_n <> 1 then raise exception 'R4 tail post 2: expected 1 untouched printhead feature line (ink circulation), found %', v_n; end if;

  select count(*) into v_n from public.fms_ocpi_machine_sections s
    join public.fms_ocpi_machines m on m.id = s.machine_id
   where m.name = 'Rocket' and s.key = 'scope_of_supply' and s.active
     and (length(s.body) - length(replace(s.body, '[[if', '')))/4
      <> (length(s.body) - length(replace(s.body, '[[/if]]', '')))/7;
  if v_n <> 0 then raise exception 'R4 tail post 3: the clause is left with an unbalanced marker'; end if;
end $post$;

commit;
