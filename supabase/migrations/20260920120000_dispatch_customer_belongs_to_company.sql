-- ORDER TO DISPATCH — the customer must be one the billing company can bill.
--
-- The third of the three narrowings the sales order form now applies. Two were
-- already enforced server-side and this one was not:
--
--   company → dispatch site   enforced (mst_company_locations, since Phase 2)
--   customer → item           enforced (mst_party_items, in fms_dispatch_replace_lines)
--   company → customer        ← this file
--
-- WHY IT HAS TO BE HERE AS WELL AS IN THE PICKER. The payload is JSON. A tab
-- left open before the narrowing shipped, or an edit that changes the company
-- after the customer was chosen, would otherwise post a pair the form would no
-- longer offer — and the billing company is what goes on the invoice.
--
-- WHAT COUNTS AS "CAN BILL". Tally's own answer: a firm has a separate ledger
-- in every book it trades with, so mst_parties.company_id IS the mapping and no
-- second list is maintained. A customer with NO company book passes for every
-- company — not a loophole but the only workable rule for a customer the portal
-- has just created through a master request, which reaches Tally only after the
-- first invoice is raised.
--
-- ⚠ DEPLOY ORDER: THE FRONTEND MUST BE LIVE FIRST. 71 of the 303 orders raised
--   before this were billed by a company that is not the one on their
--   customer's ledger, because until now the picker offered one flat list of
--   328 names whatever company was chosen. Applying this while that picker is
--   still live would start refusing orders people are entitled to raise.
--
-- ⚠ AND EDITING AN OLD ORDER MUST STILL WORK. Those 71 are history and cannot
--   be re-decided; the update path therefore checks the pair ONLY when the
--   customer is actually being changed. Leaving a mismatched order's customer
--   alone stays legal; choosing a different one obeys today's rule.
--
-- ⚠ THE TWO FUNCTIONS ARE PATCHED BY SUBSTITUTION, NOT RETYPED, and that is on
--   purpose. Neither one's existing logic changes here — the credit-hold reset,
--   the location rules, the announce payloads all stay exactly as they are — so
--   re-declaring 90 lines of body to add four would put every one of those lines
--   at risk of a transcription slip that no test would catch. Each replace()
--   asserts its anchor appears EXACTLY once and the statement aborts if it does
--   not, which is the same technique the Phase 2 cutover used on five functions.
--
-- Additive: one new function, two bodies patched, no schema change, no data
-- touched. Re-runnable — each patch is skipped if it is already applied.
--
-- ✅ APPLIED 2026-08-18, after `550bd72` went live. Verified against the live
--    database in three shapes: a matching pair passes, a mismatched pair raises
--    "M/S COLOR N STYLE PVT LTD is not a customer of Enterprise - Surat", and a
--    customer sitting in no company book passes for every company.

create or replace function public.fms_dispatch_assert_customer_of_company(
  p_customer uuid, p_company uuid
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_name text; v_co text;
begin
  if p_customer is null or p_company is null then return; end if;
  if exists (
    select 1 from public.mst_parties c
     where c.id = p_customer
       and c.is_customer
       and (c.company_id is null or c.company_id = p_company)
  ) then
    return;
  end if;

  -- Named, both halves. "Invalid customer" sends somebody hunting; the two
  -- names say which pair was refused and therefore what to change.
  select name into v_name from public.mst_parties where id = p_customer;
  select coalesce(nullif(trim(alias), ''), name) || coalesce(' - ' || location, '')
    into v_co from public.mst_companies where id = p_company;
  raise exception '% is not a customer of %. Pick a customer that company bills, or ask for the ledger to be opened in Tally.',
    coalesce(v_name, 'That customer'), coalesce(v_co, 'that company');
end $$;

comment on function public.fms_dispatch_assert_customer_of_company(uuid, uuid) is
  'Raises unless the customer sits in the billing company''s Tally book (or in none at all). Shared by submit and update so the two cannot drift.';


/* ---------------------------------------------------------------- intake -- */

do $patch$
declare
  v_def text;
  v_anchor text := E'  -- THE SITE THIS LEAVES FROM.';
  v_add text := E'  -- Unconditional on intake: a brand-new order has no history to protect,\n'
             || E'  -- and the picker only ever offered this company''s own customers.\n'
             || E'  perform public.fms_dispatch_assert_customer_of_company(v_cust, v_company);\n\n';
begin
  v_def := pg_get_functiondef('public.fms_dispatch_submit_order(jsonb)'::regprocedure);
  if position('fms_dispatch_assert_customer_of_company' in v_def) > 0 then
    raise notice 'fms_dispatch_submit_order already patched - skipping';
    return;
  end if;

  -- EXACTLY once. A second occurrence would mean the body has been reshaped
  -- since this was written, and blindly patching the first would put the check
  -- somewhere nobody intended.
  if (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'fms_dispatch_submit_order: expected exactly one "%" anchor', v_anchor;
  end if;

  execute replace(v_def, v_anchor, v_add || v_anchor);
end $patch$;


/* ------------------------------------------------------------------ edit -- */

do $patch$
declare
  v_def text;
  v_sel_old text := E'  select status, cc_at, raised_by, order_no, cc_status = ''credit_hold''\n'
                 || E'    into v_status, v_cc, v_raiser, v_no, v_held\n';
  v_sel_new text := E'  select status, cc_at, raised_by, order_no, cc_status = ''credit_hold'', customer_id\n'
                 || E'    into v_status, v_cc, v_raiser, v_no, v_held, v_cust_before\n';
  v_dec_old text := E'  v_cust uuid; v_company uuid; v_location uuid; v_held boolean;\n';
  v_dec_new text := E'  v_cust uuid; v_company uuid; v_location uuid; v_held boolean;\n'
                 || E'  v_cust_before uuid;\n';
  v_anchor text := E'  -- The same rule as intake, against whatever the row would end up holding:';
  v_add text := E'  -- DELIBERATELY CONDITIONAL. 71 of the 303 orders raised before the picker\n'
             || E'  --   narrowed hold a customer the billing company does not bill, because the\n'
             || E'  --   old picker offered one flat list whatever company was chosen. Those\n'
             || E'  --   orders are history: refusing to save them would mean an order that can\n'
             || E'  --   be opened and corrected but never put back. So the pair is tested only\n'
             || E'  --   when the CUSTOMER is being changed - keeping the stored one is always\n'
             || E'  --   allowed, choosing a different one obeys today''s rule.\n'
             || E'  if v_cust is distinct from v_cust_before then\n'
             || E'    perform public.fms_dispatch_assert_customer_of_company(v_cust, v_company);\n'
             || E'  end if;\n\n';
  v_probe text;
  n int;
begin
  v_def := pg_get_functiondef('public.fms_dispatch_update_order(uuid,jsonb)'::regprocedure);
  if position('fms_dispatch_assert_customer_of_company' in v_def) > 0 then
    raise notice 'fms_dispatch_update_order already patched - skipping';
    return;
  end if;

  foreach v_probe in array array[v_dec_old, v_sel_old, v_anchor] loop
    n := (length(v_def) - length(replace(v_def, v_probe, ''))) / length(v_probe);
    if n <> 1 then
      raise exception 'fms_dispatch_update_order: expected exactly one of "%", found %',
        left(v_probe, 60), n;
    end if;
  end loop;

  -- The stored customer has to be READ before it can be compared, so the
  -- declaration and the SELECT both move first; the guard itself goes in after
  -- the company has been resolved and validated.
  v_def := replace(v_def, v_dec_old, v_dec_new);
  v_def := replace(v_def, v_sel_old, v_sel_new);
  -- v_cust already coalesces to the stored value; now that v_cust_before holds
  -- it, read it from there rather than a second sub-select.
  v_def := replace(
    v_def,
    E'  v_cust := coalesce(nullif(p->>''customer_id'','''')::uuid,\n'
      || E'                     (select customer_id from public.fms_dispatch_orders where id = p_order));',
    E'  v_cust := coalesce(nullif(p->>''customer_id'','''')::uuid, v_cust_before);');
  v_def := replace(v_def, v_anchor, v_add || v_anchor);

  execute v_def;
end $patch$;


/* --------------------------------------------------------------- proofs -- */

do $check$
declare v_bad int;
begin
  -- Both bodies now call the guard.
  if position('fms_dispatch_assert_customer_of_company' in
      pg_get_functiondef('public.fms_dispatch_submit_order(jsonb)'::regprocedure)) = 0
   or position('fms_dispatch_assert_customer_of_company' in
      pg_get_functiondef('public.fms_dispatch_update_order(uuid,jsonb)'::regprocedure)) = 0 then
    raise exception 'patch did not take on one or both functions';
  end if;

  -- The edit path reads the stored customer, or the comparison is against null
  -- and the guard fires on every save of every order.
  if position('v_cust_before' in
      pg_get_functiondef('public.fms_dispatch_update_order(uuid,jsonb)'::regprocedure)) = 0 then
    raise exception 'fms_dispatch_update_order: v_cust_before missing';
  end if;

  -- And the standing check from Phase 1: no function body may name a retired
  -- master table. Patching by substitution cannot reintroduce one, but the
  -- proof is cheap and this file rewrites two bodies.
  select count(*) into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('fms_dispatch_submit_order','fms_dispatch_update_order')
     and pg_get_functiondef(p.oid) ~ 'fms_dispatch_(customers|items|customer_items)\M';
  if v_bad > 0 then
    raise exception 'a patched function references a retired master table';
  end if;
end $check$;
