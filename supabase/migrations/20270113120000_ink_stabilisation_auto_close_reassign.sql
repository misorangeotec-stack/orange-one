-- Ink Stabilisation — approved retests close themselves; Management closes or REASSIGNS
-- the rejected ones (no more send-back); tests may belong to Otec Surat too.
--
-- WHAT CHANGES, AND WHY (asked 08-10-2026)
--   1. APPROVED AT THE PLANT = CLOSED. ink_stab_submit now closes a test the lab approved,
--      on the spot, with an automatic review note. Only a REJECTED test goes to Management.
--   2. NO SEND-BACK. "There is no other work that will be done over there — all the work is
--      done manually." ink_stab_review accepts 'close' only. Old 'returned' rows (none on
--      08-10-2026: the table was empty) stay readable and can still be re-submitted.
--   3. REASSIGN, like every other FMS. Management can hand a rejected test to someone else
--      to audit (ink_stab_reassign). While it is assigned, that person — and admins — are the
--      only ones who can close it or pass it on; null hands it back to the review owners.
--      The receiver needs the module's EDIT grant, or they could not open the app to act.
--   4. OTEC SURAT. The new "Closing Stock" pages submit Otec Surat lots with Otec's
--      company_guid. Nothing in the table restricted the company, so no change is needed
--      there — noted so nobody adds such a check later.
--
-- ADDITIVE: four nullable columns on ink_stab_tests, one on ink_stab_activity, a widened
-- action check, two functions replaced, one added. Apply in the identity project
-- (ref icutjkrqkbzwvmnfbzpr). Reversal: the _rollback.sql beside this file.

begin;

alter table public.ink_stab_tests
  add column if not exists assigned_to uuid references auth.users on delete set null,
  add column if not exists assigned_by uuid references auth.users on delete set null,
  add column if not exists assigned_at timestamptz,
  add column if not exists assign_note text;

comment on column public.ink_stab_tests.assigned_to is
  'Who Management handed this rejected test to for audit. While set, only they (and admins) may close or pass it on. See 20270113120000.';

alter table public.ink_stab_activity
  add column if not exists to_user uuid references auth.users on delete set null;

-- The action check gains 'reassigned'. Its name was generated, so find it rather than guess.
do $$
declare v_name text;
begin
  select conname into v_name from pg_constraint
   where conrelid = 'public.ink_stab_activity'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%action%';
  if v_name is not null then
    execute format('alter table public.ink_stab_activity drop constraint %I', v_name);
  end if;
end $$;
alter table public.ink_stab_activity
  add constraint ink_stab_activity_action_check
  check (action in ('submitted', 'returned', 'closed', 'reassigned'));

-- ------------------------------------------------------------------ submit --
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
  v_auto    text := 'Closed automatically — approved by the lab.';
  v_new     text;
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
    raise exception 'This test is already closed.';
  end if;

  -- Approved → closed now. Rejected → waits for Management.
  v_new := case v_result when 'approved' then 'closed' else 'submitted' end;

  if v_id is null then
    insert into public.ink_stab_tests (company_guid, stock_item, lot_no, test_no, due_date, production_date,
                                       ink_family, qty, uom, status, result, lab_person,
                                       plant_remarks, submitted_by, submitted_at,
                                       review_remarks, reviewed_at)
    values (p->>'company_guid', p->>'stock_item', p->>'lot_no', (p->>'test_no')::smallint,
            (p->>'due_date')::date, (p->>'production_date')::date, p->>'ink_family',
            nullif(p->>'qty', '')::numeric, p->>'uom', v_new, v_result, v_person,
            v_remarks, v_uid, now(),
            case when v_new = 'closed' then v_auto end, case when v_new = 'closed' then now() end)
    returning id into v_id;
  else
    update public.ink_stab_tests
       set status = v_new, result = v_result, lab_person = v_person,
           plant_remarks = v_remarks, submitted_by = v_uid, submitted_at = now(),
           review_remarks = case when v_new = 'closed' then v_auto else review_remarks end,
           reviewed_by    = case when v_new = 'closed' then null else reviewed_by end,
           reviewed_at    = case when v_new = 'closed' then now() else reviewed_at end,
           assigned_to = case when v_new = 'closed' then null else assigned_to end
     where id = v_id;
  end if;

  insert into public.ink_stab_activity (test_id, action, remarks, actor)
  values (v_id, 'submitted', initcap(v_result) || ' by ' || v_person || ' — ' || v_remarks, v_uid);
  if v_new = 'closed' then
    -- actor null = the system closed it, not a person.
    insert into public.ink_stab_activity (test_id, action, remarks, actor) values (v_id, 'closed', v_auto, null);
  end if;
  return v_id;
end;
$$;

-- ------------------------------------------------------------- who reviews --
-- The holder rule, used by close and reassign alike: an assigned test belongs to its
-- assignee (and admins); otherwise to the Management review owners.
create or replace function public.ink_stab_may_review(p_id uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.module_can_edit(p_uid, 'ink-stabilisation')
     and (
       public.is_admin(p_uid)
       or exists (select 1 from public.ink_stab_tests t where t.id = p_id and t.assigned_to = p_uid)
       or (not exists (select 1 from public.ink_stab_tests t where t.id = p_id and t.assigned_to is not null)
           and public.ink_stab_can('review', p_uid))
     );
$$;

-- ------------------------------------------------------------------ review --
-- Signature kept (p_action) so an old browser tab gets a clear message, not a 404.
create or replace function public.ink_stab_review(p_id uuid, p_action text, p_remarks text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_status  text;
  v_remarks text := nullif(btrim(p_remarks), '');
begin
  if p_action <> 'close' then
    raise exception 'Tests are no longer sent back — close it, or reassign it to someone to audit.';
  end if;
  select status into v_status from public.ink_stab_tests where id = p_id for update;
  if v_status is null then
    raise exception 'Test not found.';
  end if;
  if not public.ink_stab_may_review(p_id, v_uid) then
    raise exception 'Only the person this test is with (or Management, if it is with nobody) can close it.' using errcode = '42501';
  end if;
  if v_status <> 'submitted' then
    raise exception 'Only a test waiting for review can be closed (this one is %).', v_status;
  end if;

  update public.ink_stab_tests
     set status = 'closed', review_remarks = v_remarks, reviewed_by = v_uid, reviewed_at = now()
   where id = p_id;

  insert into public.ink_stab_activity (test_id, action, remarks, actor)
  values (p_id, 'closed', v_remarks, v_uid);
end;
$$;

-- ---------------------------------------------------------------- reassign --
-- p_to null hands it back to the Management review owners.
create or replace function public.ink_stab_reassign(p_id uuid, p_to uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_status text;
  v_note   text := nullif(btrim(p_note), '');
begin
  select status into v_status from public.ink_stab_tests where id = p_id for update;
  if v_status is null then
    raise exception 'Test not found.';
  end if;
  if not public.ink_stab_may_review(p_id, v_uid) then
    raise exception 'Only the person this test is with (or Management, if it is with nobody) can reassign it.' using errcode = '42501';
  end if;
  if v_status <> 'submitted' then
    raise exception 'Only a test waiting for review can be reassigned (this one is %).', v_status;
  end if;
  if p_to = v_uid then
    raise exception 'It is already yours to close.';
  end if;
  if p_to is not null and not public.module_can_edit(p_to, 'ink-stabilisation') then
    raise exception 'That person has no edit access to Ink Stabilisation — give them access first.';
  end if;

  update public.ink_stab_tests
     set assigned_to = p_to, assigned_by = v_uid, assigned_at = now(), assign_note = v_note
   where id = p_id;

  insert into public.ink_stab_activity (test_id, action, remarks, actor, to_user)
  values (p_id, 'reassigned', v_note, v_uid, p_to);
end;
$$;

revoke all on function public.ink_stab_submit(jsonb)                from public, anon;
revoke all on function public.ink_stab_review(uuid, text, text)     from public, anon;
revoke all on function public.ink_stab_reassign(uuid, uuid, text)   from public, anon;
revoke all on function public.ink_stab_may_review(uuid, uuid)       from public, anon;
grant execute on function public.ink_stab_submit(jsonb)              to authenticated;
grant execute on function public.ink_stab_review(uuid, text, text)   to authenticated;
grant execute on function public.ink_stab_reassign(uuid, uuid, text) to authenticated;
grant execute on function public.ink_stab_may_review(uuid, uuid)     to authenticated;

commit;
