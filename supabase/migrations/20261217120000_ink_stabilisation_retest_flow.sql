-- Ink Stabilisation — the monthly retest flow: Plant submits, Management reviews and closes.
--
-- WHAT THIS IS
--   Every ink lot Enterprises Surat manufactures is retested at 3, 6 and 9 months from
--   production. The LOTS and their due dates are not stored here: they are read live from
--   ConnectWave (rpt_batch_line) and worked out in the browser — see
--   frontend/src/apps/ink-stabilisation/lib/schedule.ts. What this migration stores is
--   only what people DO about a test:
--
--     (no row)    Pending — the test is due; the Plant has not submitted it yet
--     submitted   the Plant has written remarks, attached the report and submitted
--     returned    Management sent it back to the Plant with a reason
--     closed      Management reviewed it and closed it — final, nothing changes after
--
--   A row is created the first time the Plant submits a test, so a month nobody touched
--   costs nothing and "pending" is simply "no row".
--
-- ⚠ A TEST IS (COMPANY, ITEM, LOT, TEST NO.). Tally's item name + batch name is the lot's
--   identity; the same lot name can recur under different items, so the item is part of
--   the key. The due date, production date and quantity are copied onto the row at submit
--   time so Management sees what the Plant saw even if Tally is later edited.
--
-- ⚠ WRITES GO THROUGH RPCs ONLY. The tables carry SELECT policies and nothing else, so a
--   status can only move along the path the functions allow — no client can write
--   'closed' onto a test Management never saw.
--
-- ACCESS
--   read          any grant on the app ('view' or 'edit')
--   Plant step    edit grant AND (admin, or listed under step 'plant', or nobody is listed)
--   Review step   edit grant AND (admin, or listed under step 'review', or nobody is listed)
--   Settings      admins only
--   An empty owner list means ANYONE with an edit grant, never nobody, so the module works
--   on the day it is switched on — the same rule Complaint uses for its raise step.
--
-- Purely ADDITIVE: four new tables, one private bucket with four policies, six functions.
-- Nothing existing is altered. Reuses public.set_updated_at(), public.module_level(),
-- public.module_can_edit() and public.is_admin(). Apply in the Orange One *identity*
-- project (ref icutjkrqkbzwvmnfbzpr — the VITE_SUPABASE_URL project). Reversal: the _rollback.sql beside this file.

begin;

-- ---------------------------------------------------------------- tables --

create table if not exists public.ink_stab_step_owners (
  step_key     text primary key check (step_key in ('plant', 'review')),
  -- auth user ids — the same ids every other FMS step-owner table holds.
  employee_ids uuid[] not null default '{}',
  updated_by   uuid references auth.users on delete set null,
  updated_at   timestamptz not null default now()
);
comment on table public.ink_stab_step_owners is
  'Ink Stabilisation: who may act on each step. An empty list means anyone with an edit grant on the app. See 20261217120000.';

create table if not exists public.ink_stab_tests (
  id              uuid primary key default gen_random_uuid(),
  company_guid    text not null,
  stock_item      text not null,
  lot_no          text not null,
  test_no         smallint not null check (test_no between 1 and 3),
  due_date        date not null,
  production_date date not null,
  ink_family      text,
  qty             numeric,
  uom             text,
  status          text not null check (status in ('submitted', 'returned', 'closed')),
  plant_remarks   text,
  submitted_by    uuid references auth.users on delete set null,
  submitted_at    timestamptz,
  review_remarks  text,
  reviewed_by     uuid references auth.users on delete set null,
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint ink_stab_tests_key unique (company_guid, stock_item, lot_no, test_no)
);
comment on table public.ink_stab_tests is
  'Ink Stabilisation: one row per retest the Plant has submitted. No row = pending. Lots and due dates come live from ConnectWave; this holds only remarks, status and review. See 20261217120000.';

create index if not exists ink_stab_tests_status_idx on public.ink_stab_tests (status, due_date);

drop trigger if exists trg_ink_stab_tests_updated on public.ink_stab_tests;
create trigger trg_ink_stab_tests_updated
  before update on public.ink_stab_tests
  for each row execute function public.set_updated_at();

create table if not exists public.ink_stab_docs (
  id          uuid primary key default gen_random_uuid(),
  test_id     uuid not null references public.ink_stab_tests on delete cascade,
  -- '<test id>/<ms>-<file name>' in bucket ink-stab-docs. The first segment is what the
  -- storage policies read; a path that does not start with its test's id is refused.
  path        text not null unique,
  name        text not null,
  mime        text,
  size_bytes  bigint,
  uploaded_by uuid references auth.users on delete set null,
  created_at  timestamptz not null default now(),
  constraint ink_stab_docs_path_is_under_test check (path like test_id::text || '/%')
);
create index if not exists ink_stab_docs_test_idx on public.ink_stab_docs (test_id);

-- The trail: every submit, send-back and close, so a test that went round twice shows why.
create table if not exists public.ink_stab_activity (
  id         bigint generated always as identity primary key,
  test_id    uuid not null references public.ink_stab_tests on delete cascade,
  action     text not null check (action in ('submitted', 'returned', 'closed')),
  remarks    text,
  actor      uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists ink_stab_activity_test_idx on public.ink_stab_activity (test_id, created_at);

-- ------------------------------------------------------------------- RLS --
-- Helper calls wrapped in a scalar sub-select so Postgres runs them once, not per row.

alter table public.ink_stab_step_owners enable row level security;
alter table public.ink_stab_tests       enable row level security;
alter table public.ink_stab_docs        enable row level security;
alter table public.ink_stab_activity    enable row level security;

drop policy if exists ink_stab_step_owners_select on public.ink_stab_step_owners;
create policy ink_stab_step_owners_select on public.ink_stab_step_owners for select to authenticated
  using ((select public.module_level(auth.uid(), 'ink-stabilisation')) <> 'none');

drop policy if exists ink_stab_step_owners_write on public.ink_stab_step_owners;
create policy ink_stab_step_owners_write on public.ink_stab_step_owners for all to authenticated
  using ((select public.is_admin(auth.uid())))
  with check ((select public.is_admin(auth.uid())));

drop policy if exists ink_stab_tests_select on public.ink_stab_tests;
create policy ink_stab_tests_select on public.ink_stab_tests for select to authenticated
  using ((select public.module_level(auth.uid(), 'ink-stabilisation')) <> 'none');

drop policy if exists ink_stab_docs_select on public.ink_stab_docs;
create policy ink_stab_docs_select on public.ink_stab_docs for select to authenticated
  using ((select public.module_level(auth.uid(), 'ink-stabilisation')) <> 'none');

drop policy if exists ink_stab_activity_select on public.ink_stab_activity;
create policy ink_stab_activity_select on public.ink_stab_activity for select to authenticated
  using ((select public.module_level(auth.uid(), 'ink-stabilisation')) <> 'none');

-- ------------------------------------------------------------- functions --

-- May this user act on this step? Gated on module_can_edit in its own body.
create or replace function public.ink_stab_can(p_step text, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.module_can_edit(p_uid, 'ink-stabilisation')
     and (
       public.is_admin(p_uid)
       or not exists (
         select 1 from public.ink_stab_step_owners o
         where o.step_key = p_step and cardinality(o.employee_ids) > 0
       )
       or exists (
         select 1 from public.ink_stab_step_owners o
         where o.step_key = p_step and p_uid = any(o.employee_ids)
       )
     );
$$;
comment on function public.ink_stab_can(text, uuid) is
  'Ink Stabilisation: may this user act on step plant|review? Edit grant required; empty owner list = anyone with edit.';

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

-- Management: close a submitted test, or send it back to the Plant.
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

-- Plant: record an attachment already uploaded to the bucket.
create or replace function public.ink_stab_add_doc(p_test uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id     uuid;
  v_status text;
begin
  if not public.ink_stab_can('plant', auth.uid()) then
    raise exception 'Only the Plant can attach files.' using errcode = '42501';
  end if;
  select status into v_status from public.ink_stab_tests where id = p_test;
  if v_status is null then raise exception 'Test not found.'; end if;
  if v_status = 'closed' then raise exception 'This test is closed.'; end if;

  insert into public.ink_stab_docs (test_id, path, name, mime, size_bytes, uploaded_by)
  values (p_test, p->>'path', p->>'name', p->>'mime', nullif(p->>'size_bytes', '')::bigint, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Plant: remove an attachment from a test that is not closed. Returns the storage path so
-- the client can delete the object too.
create or replace function public.ink_stab_delete_doc(p_doc uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_path   text;
  v_status text;
begin
  if not public.ink_stab_can('plant', auth.uid()) then
    raise exception 'Only the Plant can remove files.' using errcode = '42501';
  end if;
  select d.path, t.status into v_path, v_status
    from public.ink_stab_docs d join public.ink_stab_tests t on t.id = d.test_id
   where d.id = p_doc;
  if v_path is null then raise exception 'File not found.'; end if;
  if v_status = 'closed' then raise exception 'This test is closed.'; end if;
  delete from public.ink_stab_docs where id = p_doc;
  return v_path;
end;
$$;

revoke all on function public.ink_stab_can(text, uuid)       from public, anon;
revoke all on function public.ink_stab_submit(jsonb)         from public, anon;
revoke all on function public.ink_stab_review(uuid, text, text) from public, anon;
revoke all on function public.ink_stab_add_doc(uuid, jsonb)  from public, anon;
revoke all on function public.ink_stab_delete_doc(uuid)      from public, anon;
grant execute on function public.ink_stab_can(text, uuid)       to authenticated;
grant execute on function public.ink_stab_submit(jsonb)         to authenticated;
grant execute on function public.ink_stab_review(uuid, text, text) to authenticated;
grant execute on function public.ink_stab_add_doc(uuid, jsonb)  to authenticated;
grant execute on function public.ink_stab_delete_doc(uuid)      to authenticated;

-- --------------------------------------------------------------- storage --
-- Private bucket. Policy names are GLOBAL on storage.objects, so these are unique to
-- this module. Scoped from day one — never the bucket-id-only baseline that let any
-- signed-in user read any invoice (20260821120000).

insert into storage.buckets (id, name, public)
values ('ink-stab-docs', 'ink-stab-docs', false)
on conflict (id) do nothing;

drop policy if exists "ink stab docs read"   on storage.objects;
drop policy if exists "ink stab docs insert" on storage.objects;
drop policy if exists "ink stab docs update" on storage.objects;
drop policy if exists "ink stab docs delete" on storage.objects;

create policy "ink stab docs read" on storage.objects for select to authenticated
  using (bucket_id = 'ink-stab-docs'
         and (select public.module_level(auth.uid(), 'ink-stabilisation')) <> 'none');

create policy "ink stab docs insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'ink-stab-docs'
              and (select public.ink_stab_can('plant', auth.uid()))
              and exists (select 1 from public.ink_stab_tests t
                           where t.id::text = (storage.foldername(name))[1] and t.status <> 'closed'));

-- No update: an attachment is replaced by removing it and adding a new one.
create policy "ink stab docs update" on storage.objects for update to authenticated
  using (false) with check (false);

create policy "ink stab docs delete" on storage.objects for delete to authenticated
  using (bucket_id = 'ink-stab-docs'
         and (select public.ink_stab_can('plant', auth.uid()))
         and exists (select 1 from public.ink_stab_tests t
                     where t.id::text = (storage.foldername(name))[1] and t.status <> 'closed'));

-- ------------------------------------------------------------ assertions --
do $mig$
declare
  v_missing text;
begin
  select string_agg(t, ', ') into v_missing
    from unnest(array['ink_stab_step_owners', 'ink_stab_tests', 'ink_stab_docs', 'ink_stab_activity']) t
   where not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                     where n.nspname = 'public' and c.relname = t and c.relrowsecurity);
  if v_missing is not null then
    raise exception 'RLS is not enabled on: %', v_missing;
  end if;
  if exists (select 1 from storage.buckets where id = 'ink-stab-docs' and public) then
    raise exception 'ink-stab-docs must be a private bucket';
  end if;
end;
$mig$;

commit;

-- ---------------------------------------------------------------- verify --
--
--   select relname, relrowsecurity from pg_class
--    where relname in ('ink_stab_step_owners','ink_stab_tests','ink_stab_docs','ink_stab_activity');
--   select policyname, cmd from pg_policies where tablename like 'ink_stab_%' order by 1;
--   select policyname from pg_policies where tablename = 'objects' and policyname like 'ink stab docs%';
--   select status, count(*) from public.ink_stab_tests group by 1;
