-- Ink Stabilisation — the lab's own verdict on a retest: Approve / Reject, and who tested it.
--
-- WHAT CHANGES, AND WHY
--   Asked 26-09-2026: the Plant's submit form should carry the lab's RESULT (approve or
--   reject the lot at this retest) and the LAB PERSON who did it, alongside the remarks.
--   The attachment becomes optional — it was only ever enforced in the browser, so no
--   database rule changes for that.
--
--   result      'approved' | 'rejected'  — the lab's verdict, required on every submit
--   lab_person  free text                — who ran the test; the form pre-fills the
--                                          logged-in user's name, but the lab tech is often
--                                          not the person clicking Submit, so it is text,
--                                          not a user id
--
-- ⚠ THIS IS NOT MANAGEMENT'S DECISION. Management still closes or sends back (status).
--   A lot can be 'rejected' by the lab and 'closed' by Management — that is Management
--   accepting the lab's rejection, not overturning it.
--
-- Purely ADDITIVE: two nullable columns (rows submitted before this have no result), and
-- ink_stab_submit replaced with a version that requires and stores them. Apply in the
-- identity project (ref icutjkrqkbzwvmnfbzpr). Reversal: the _rollback.sql beside this file.

begin;

alter table public.ink_stab_tests
  add column if not exists result text check (result in ('approved', 'rejected')),
  add column if not exists lab_person text;

comment on column public.ink_stab_tests.result is
  'The lab''s verdict at this retest: approved | rejected. Not Management''s decision — that is status. See 20261217120100.';
comment on column public.ink_stab_tests.lab_person is
  'Who ran the test, as typed on the submit form. Text, not a user id: the lab tech is often not the person submitting.';

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

  -- The trail keeps the verdict with the remarks, so a lot that went Reject → Approve
  -- across a send-back shows both.
  insert into public.ink_stab_activity (test_id, action, remarks, actor)
  values (v_id, 'submitted', initcap(v_result) || ' by ' || v_person || ' — ' || v_remarks, v_uid);
  return v_id;
end;
$$;

revoke all on function public.ink_stab_submit(jsonb) from public, anon;
grant execute on function public.ink_stab_submit(jsonb) to authenticated;

commit;
