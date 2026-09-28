-- ROLLBACK for 20261114120012 — every head phrase goes back to unconditional.
--
-- 🔴 THE PAPERS GO BACK TO ASSERTING HEADS ON A HEADLESS DEAL. That is the
--    defect this migration existed to fix, and undoing it puts it back on seven
--    real quotations. Run this only to escape a worse problem, never to tidy up.
--
-- 🟢 THE FRONTEND MAY STAY. `heads` / `noHeads` simply stop appearing in any
--    template; `conditionsFor` still supplies them and nothing reads them. The
--    empty-section skip in `ocPdf.ts` likewise becomes unreachable — all 190
--    active sections hold a non-empty body again. Neither needs reverting, and
--    reverting them is the more dangerous act.
--
-- ⚠ FROZEN PAPERS ARE UNTOUCHED either way — `oc_document_payload` stores
--   resolved text, so an issued contract keeps the wording it went out with.
--
-- ⚠ THE INVERSE IS MECHANICAL, which is why the forward file wrapped each
--   fragment rather than rewriting whole sentences: every edit is
--   `[[if heads]]<frag>[[/if]][[if noHeads]] …[[/if]]` → `<frag>`.

begin;

do $guard$
declare v_n int;
begin
  select count(*) into v_n from public.fms_ocpi_machines where supply_description like '%[[if heads]]%';
  if v_n = 0 then raise exception 'R4 rollback: no conditional descriptions found — nothing to undo'; end if;
end $guard$;

-- 🔴 THE UNWRAP IS A REGEX, NOT A BLIND `replace`, AND THE FIRST DRAFT OF THIS
--    FILE GOT IT WRONG. `replace(body, '[[/if]]', '')` strips EVERY closing
--    marker — including the ones belonging to `[[if dryer]]`, `[[if centering]]`
--    and `[[if !dryer]]`, which were there long before R4. That leaves nine
--    descriptions with an OPEN marker and no close, and `flatAndClosed` then
--    keeps every word on every deal: a contract promising a dryer to a customer
--    who never bought one. The pair is matched and removed together instead.

-- ─────────────────────────────────────────────── the priced supply line ──
update public.fms_ocpi_machines
   set supply_description = regexp_replace(
         regexp_replace(supply_description, '\[\[if noHeads\]\].*?\[\[/if\]\]', '', 'g'),
         '\[\[if heads\]\](.*?)\[\[/if\]\]', '\1', 'g'),
       updated_at = now()
 where supply_description like '%[[if heads]]%';

-- ────────────────────────────────────────── the invoice item description ──
update public.fms_ocpi_machines
   set billing_name = regexp_replace(
         regexp_replace(billing_name, '\[\[if noHeads\]\].*?\[\[/if\]\]', '', 'g'),
         '\[\[if heads\]\](.*?)\[\[/if\]\]', '\1', 'g'),
       updated_at = now()
 where billing_name like '%[[if heads]]%';

-- ───────────────────────────────────────────────── the opening sentence ──
update public.fms_ocpi_machines
   set intro_text = regexp_replace(
         regexp_replace(intro_text, '\[\[if noHeads\]\].*?\[\[/if\]\]', '', 'g'),
         '\[\[if heads\]\](.*?)\[\[/if\]\]', '\1', 'g'),
       updated_at = now()
 where intro_text like '%[[if heads]]%';

-- ──────────────────────────────────────────────────── the spec table row ──
update public.fms_ocpi_machines m
   set spec_rows = (
         select jsonb_agg(
           case when e->>'value' like '[[if heads]]%'
                then jsonb_set(e, '{value}', to_jsonb(
                       regexp_replace(e->>'value', '\[\[if heads\]\](.*?)\[\[/if\]\]', '\1', 'g')))
                else e end order by ord)
           from jsonb_array_elements(m.spec_rows) with ordinality as t(e, ord)),
       updated_at = now()
 where m.spec_rows::text like '%[[if heads]]%';

-- ───────────────────────────────────── the print-head warranty clause ──
-- Every line was wrapped separately, so every line is unwrapped separately.
update public.fms_ocpi_machine_sections
   set body = regexp_replace(body, '\[\[if heads\]\](.*?)\[\[/if\]\]', '\1', 'g'),
       updated_at = now()
 where key = 'head_policy' and active and body like '%[[if heads]]%';

-- ──────────────────────────────────────────── Rocket's supply bullet ──
update public.fms_ocpi_machines
   set composition = (
         select jsonb_agg(
           case when e #>> '{}' = '[[if heads]]Printing Head Module[[/if]]'
                then to_jsonb('Printing Head Module'::text)
                else e end order by ord)
           from jsonb_array_elements(composition) with ordinality as t(e, ord)),
       updated_at = now()
 where name = 'Rocket' and composition::text like '%[[if heads]]Printing Head Module%';

do $post$
declare v_n int;
begin
  select count(*) into v_n from public.fms_ocpi_machines
   where coalesce(supply_description,'') like '%[[if heads]]%'
      or coalesce(billing_name,'') like '%[[if heads]]%'
      or coalesce(intro_text,'') like '%[[if heads]]%'
      or coalesce(spec_rows::text,'') like '%[[if heads]]%'
      or coalesce(composition::text,'') like '%[[if heads]]%';
  if v_n <> 0 then raise exception 'R4 rollback: markers survive on % machine(s)', v_n; end if;

  select count(*) into v_n from public.fms_ocpi_machine_sections where body like '%[[if heads]]%';
  if v_n <> 0 then raise exception 'R4 rollback: markers survive in % section(s)', v_n; end if;

  -- The pre-R4 shape, restored exactly: 18 tokenised descriptions and no stray
  -- "(WITHOUT PRINTHEADS)" left behind by a partial undo.
  select count(*) into v_n from public.fms_ocpi_machines where supply_description ~ '\{\{head_count\}\}';
  if v_n <> 18 then raise exception 'R4 rollback: expected 18 tokenised descriptions, found %', v_n; end if;

  select count(*) into v_n from public.fms_ocpi_machines
   where coalesce(supply_description,'') || coalesce(billing_name,'') like '%WITHOUT PRINTHEADS%';
  if v_n <> 0 then raise exception 'R4 rollback: % machine(s) still say WITHOUT PRINTHEADS', v_n; end if;

  -- The dryer / centering / usd markers that were there BEFORE R4 must survive:
  -- the unwrap strips `[[/if]]` globally, so this is the check that matters most.
  select count(*) into v_n from public.fms_ocpi_machines
   where (length(coalesce(supply_description,'')) - length(replace(coalesce(supply_description,''),'[[if','')))/4
      <> (length(coalesce(supply_description,'')) - length(replace(coalesce(supply_description,''),'[[/if]]','')))/7;
  if v_n <> 0 then raise exception 'R4 rollback: % description(s) left with an UNBALANCED marker — the dryer/centering pairs were damaged', v_n; end if;

  select count(*) into v_n from public.fms_ocpi_machines where supply_description like '%[[if dryer]]%';
  if v_n < 8 then raise exception 'R4 rollback: the pre-existing dryer markers were destroyed — only % remain', v_n; end if;
end $post$;

commit;
