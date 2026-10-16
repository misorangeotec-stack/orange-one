-- Physical Verification — a separate REVIEW step (step 3) with its own people in Settings.
--
-- Until now the people who set dates (step 1) also reviewed the counts. Asked 14-10-2026: the
-- review is someone else's job, so Settings gets a third list.
--
--   Step 1 · set dates      scheduler_ids  (Master)
--   Step 2 · count          verifier_ids   (Physical count)
--   Step 3 · review         reviewer_ids   (Review — accept / send back for recount)  ← NEW
--
-- Review = admin, OR (edit grant AND listed in reviewer_ids). While the review list is still
-- EMPTY, the step 1 people keep reviewing — so the module behaves exactly as today until an
-- admin fills the new list, and no submitted count is ever left with nobody able to review it.
--
-- Additive: one column with a default, one new function, and pv_review re-created with the
-- same signature (only its rights check changes). Builds on 20270126120000.
-- Reversal: the _rollback.sql beside this file.

begin;

alter table public.pv_settings
  add column if not exists reviewer_ids uuid[] not null default '{}';

comment on table public.pv_settings is
  'Physical Verification: the one settings row — who sets dates (step 1), counts (step 2) and reviews (step 3). See 20270126120000, 20270128120000.';

-- Step 3: may this user review counts?
create or replace function public.pv_can_review(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin(p_uid)
      or (public.module_can_edit(p_uid, 'physical-verification')
          and exists (
            select 1 from public.pv_settings s
             where p_uid = any(s.reviewer_ids)
                -- No reviewers picked yet: step 1 keeps the review, as before this migration.
                or (cardinality(s.reviewer_ids) = 0 and p_uid = any(s.scheduler_ids))
          ));
$$;

-- Same signature and behaviour as 20270126120000; only the rights check moves to step 3.
create or replace function public.pv_review(p_ids uuid[], p_action text, p_remarks text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_remarks text := nullif(btrim(p_remarks), '');
  v_new     text;
  v_n       integer;
begin
  if not public.pv_can_review(v_uid) then
    raise exception 'You are not allowed to review counts.' using errcode = '42501';
  end if;
  if p_action not in ('accept', 'recount') then
    raise exception 'Action must be accept or recount.';
  end if;
  if p_action = 'recount' and v_remarks is null then
    raise exception 'Say why it needs a recount.';
  end if;
  v_new := case p_action when 'accept' then 'accepted' else 'returned' end;

  with done as (
    update public.pv_counts
       set status = v_new, review_remarks = v_remarks, reviewed_by = v_uid, reviewed_at = now()
     where id = any(p_ids) and status = 'submitted'
    returning id, physical_qty, closing_qty
  )
  insert into public.pv_activity (count_id, action, physical_qty, closing_qty, remarks, actor)
  select id, v_new, physical_qty, closing_qty, v_remarks, v_uid from done;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.pv_can_review(uuid) from public, anon;
grant execute on function public.pv_can_review(uuid) to authenticated;

commit;
