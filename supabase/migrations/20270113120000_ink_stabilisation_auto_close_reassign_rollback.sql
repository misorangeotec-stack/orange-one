-- Reverses 20270113120000_ink_stabilisation_auto_close_reassign.sql: puts back the
-- submit/review functions of 20261217120100 / 20261217120000 (send-back included), drops
-- reassign. Rows auto-closed or reassigned meanwhile keep their status; 'reassigned'
-- activity rows are deleted so the old action check can return.

begin;

drop function if exists public.ink_stab_reassign(uuid, uuid, text);

create or replace function public.ink_stab_submit(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_id      uuid;
  v_status  text;
  v_remarks text := nullif(btrim(p->>'remarks'), '');
  v_result  text := nullif(btrim(p->>'result'), '');
  v_person  text := nullif(btrim(p->>'lab_person'), '');
begin
  if not public.ink_stab_can('plant', v_uid) then
    raise exception 'Only the Plant can submit a retest.' using errcode = '42501';
  end if;
  if v_result is null or v_result not in ('approved', 'rejected') then
    raise exception 'Choose Approve or Reject.';
  end if;
  if v_person is null then
    raise exception 'Enter the lab person who ran the test.';
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
                                       ink_family, qty, uom, status, result, lab_person,
                                       plant_remarks, submitted_by, submitted_at)
    values (p->>'company_guid', p->>'stock_item', p->>'lot_no', (p->>'test_no')::smallint,
            (p->>'due_date')::date, (p->>'production_date')::date, p->>'ink_family',
            nullif(p->>'qty', '')::numeric, p->>'uom', 'submitted', v_result, v_person,
            v_remarks, v_uid, now())
    returning id into v_id;
  else
    update public.ink_stab_tests
       set status = 'submitted', result = v_result, lab_person = v_person,
           plant_remarks = v_remarks, submitted_by = v_uid, submitted_at = now()
     where id = v_id;
  end if;

  insert into public.ink_stab_activity (test_id, action, remarks, actor)
  values (v_id, 'submitted', initcap(v_result) || ' by ' || v_person || ' — ' || v_remarks, v_uid);
  return v_id;
end;
$$;

create or replace function public.ink_stab_review(p_id uuid, p_action text, p_remarks text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_remarks text := nullif(btrim(p_remarks), '');
begin
  if not public.ink_stab_can('review', v_uid) then
    raise exception 'Only Management can review a retest.' using errcode = '42501';
  end if;
  if p_action not in ('close', 'return') then
    raise exception 'Action must be close or return.';
  end if;
  if p_action = 'return' and v_remarks is null then
    raise exception 'Say why it is being sent back.';
  end if;

  select status into v_status from public.ink_stab_tests where id = p_id for update;
  if v_status is null then
    raise exception 'Test not found.';
  end if;
  if v_status <> 'submitted' then
    raise exception 'Only a submitted test can be reviewed (this one is %).', v_status;
  end if;

  update public.ink_stab_tests
     set status = case p_action when 'close' then 'closed' else 'returned' end,
         review_remarks = v_remarks, reviewed_by = v_uid, reviewed_at = now()
   where id = p_id;

  insert into public.ink_stab_activity (test_id, action, remarks, actor)
  values (p_id, case p_action when 'close' then 'closed' else 'returned' end, v_remarks, v_uid);
end;
$$;

drop function if exists public.ink_stab_may_review(uuid, uuid);

delete from public.ink_stab_activity where action = 'reassigned';
alter table public.ink_stab_activity drop constraint if exists ink_stab_activity_action_check;
alter table public.ink_stab_activity
  add constraint ink_stab_activity_action_check check (action in ('submitted', 'returned', 'closed'));
alter table public.ink_stab_activity drop column if exists to_user;

alter table public.ink_stab_tests
  drop column if exists assign_note,
  drop column if exists assigned_at,
  drop column if exists assigned_by,
  drop column if exists assigned_to;

revoke all on function public.ink_stab_submit(jsonb)            from public, anon;
revoke all on function public.ink_stab_review(uuid, text, text) from public, anon;
grant execute on function public.ink_stab_submit(jsonb)            to authenticated;
grant execute on function public.ink_stab_review(uuid, text, text) to authenticated;

commit;
