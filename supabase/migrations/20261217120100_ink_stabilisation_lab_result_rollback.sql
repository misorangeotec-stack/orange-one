-- ============================================================================
-- Rollback for 20261217120100_ink_stabilisation_lab_result.sql
--
-- ⚠ DROPS EVERY RECORDED LAB VERDICT AND LAB PERSON. Export first if wanted:
--   \copy (select id, result, lab_person from public.ink_stab_tests) to 'ink_stab_results.csv' with (format csv, header);
--
-- Restores ink_stab_submit exactly as 20261217120000 created it.
-- ============================================================================

begin;

-- Plant: submit (or re-submit) one test with remarks. Returns the test id, which the
-- client then uploads attachments under.
create or replace function public.ink_stab_submit(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_id     uuid;
  v_status text;
  v_remarks text := nullif(btrim(p->>'remarks'), '');
begin
  if not public.ink_stab_can('plant', v_uid) then
    raise exception 'Only the Plant can submit a retest.' using errcode = '42501';
  end if;
  if v_remarks is null then
    raise exception 'Remarks are required.';
  end if;
  if coalesce((p->>'test_no')::int, 0) not between 1 and 3 then
    raise exception 'Test number must be 1, 2 or 3.';
  end if;

  select id, status into v_id, v_status from public.ink_stab_tests
   where company_guid = p->>'company_guid' and stock_item = p->>'stock_item'
     and lot_no = p->>'lot_no' and test_no = (p->>'test_no')::smallint
   for update;

  if v_status = 'closed' then
    raise exception 'This test is already closed by Management.';
  end if;

  if v_id is null then
    insert into public.ink_stab_tests (company_guid, stock_item, lot_no, test_no, due_date, production_date,
                                       ink_family, qty, uom, status, plant_remarks, submitted_by, submitted_at)
    values (p->>'company_guid', p->>'stock_item', p->>'lot_no', (p->>'test_no')::smallint,
            (p->>'due_date')::date, (p->>'production_date')::date, p->>'ink_family',
            nullif(p->>'qty', '')::numeric, p->>'uom', 'submitted', v_remarks, v_uid, now())
    returning id into v_id;
  else
    update public.ink_stab_tests
       set status = 'submitted', plant_remarks = v_remarks, submitted_by = v_uid, submitted_at = now()
     where id = v_id;
  end if;

  insert into public.ink_stab_activity (test_id, action, remarks, actor) values (v_id, 'submitted', v_remarks, v_uid);
  return v_id;
end;
$$;

revoke all on function public.ink_stab_submit(jsonb) from public, anon;
grant execute on function public.ink_stab_submit(jsonb) to authenticated;

alter table public.ink_stab_tests drop column if exists lab_person;
alter table public.ink_stab_tests drop column if exists result;

commit;
