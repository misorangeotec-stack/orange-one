-- ROLLBACK for 20261114120009 — the HSN goes back to being a fact about the
-- machine, with no per-deal choice.
--
-- 🔴 ROLL THE FRONTEND BACK WITH IT, OR ROLL IT BACK FIRST. `QuotationForm.tsx`
--    renders a picker bound to `draft.hsnCode` and `payloadFromDraft` sends
--    `hsn_code`. Against the restored SQL the key is simply ignored — no error —
--    so the picker would look like it works and silently discard every answer.
--    That is worse than not having it. Ship the frontend revert, then run this.
--
-- 🔴 ANSWERS ALREADY GIVEN ARE DESTROYED. Any deal where somebody chose a
--    heading loses it, and its papers fall back to the machine master's — which
--    for the K32 and both K64s is the value the SIGNED PAPERS state, not the one
--    Tally filed. List them before running:
--
--      select quotation_no, customer_name, hsn_code
--        from public.fms_ocpi_deals where hsn_code is not null;
--
--    The guard below refuses while any exist.
--
-- 🟢 FROZEN PAPERS ARE SAFE EITHER WAY. `oc_document_payload` snapshots an
--    issued document, so a paper already sent keeps the heading it went out
--    with regardless of this column.
--
-- 🟢 THE MACHINE MASTER IS NOT TOUCHED. Its 15 headings are the work of
--    20261114120007 and _120008 and survive this file untouched.
--
-- The two bodies are transformed back from pg_get_functiondef, the same way they
-- were transformed forward, and each asserts it changed something.

begin;

do $guard$
declare v_n int; v_who text;
begin
  select count(*), string_agg(coalesce(quotation_no, 'draft') || ' = ' || hsn_code, '; ')
    into v_n, v_who
    from public.fms_ocpi_deals where hsn_code is not null;
  if v_n > 0 then
    raise exception 'R8c rollback: % deal(s) hold a chosen heading and would lose it — %. Record them, then comment out this guard.', v_n, v_who;
  end if;
end $guard$;

do $fn$
declare v_src text; v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_ocpi_write_oc';
  v_new := replace(v_src, E'    hsn_code          = nullif(btrim(p->>''hsn_code''), ''''),\n', '');
  if v_new = v_src then raise exception 'R8c rollback: write_oc did not match'; end if;
  execute v_new;

  select pg_get_functiondef(p.oid) into v_src from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'fms_ocpi_save_draft';
  v_new := replace(v_src,
    E'''machine_model_no'', ''hsn_code'',', E'''machine_model_no'',');
  if v_new = v_src then raise exception 'R8c rollback: save_draft did not match'; end if;
  execute v_new;
end $fn$;

alter table public.fms_ocpi_deals drop column if exists hsn_code;

do $post$
declare v_n int;
begin
  select count(*) into v_n from information_schema.columns
   where table_schema='public' and table_name='fms_ocpi_deals' and column_name='hsn_code';
  if v_n <> 0 then raise exception 'R8c rollback: the column survives'; end if;

  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.prosrc like '%hsn_code%'
     and p.proname in ('fms_ocpi_write_oc','fms_ocpi_save_draft');
  if v_n <> 0 then raise exception 'R8c rollback: % function(s) still reference hsn_code', v_n; end if;

  select count(*) into v_n from public.fms_ocpi_machines where hsn_code is not null;
  if v_n <> 15 then raise exception 'R8c rollback: the machine headings were disturbed — found %', v_n; end if;
end $post$;

commit;
