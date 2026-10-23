-- Physical Verification — Otec Surat Printing Ink: admin schedules items for a date, the
-- verifier counts them, admin accepts the count or sends it back for a recount.
--
-- WHAT THIS IS
--   The ITEMS and their Tally closing stock are not stored here: they are read live from
--   ConnectWave (rpt_stock_summary_item) — see
--   frontend/src/apps/physical-verification/lib/stock.ts. What this migration stores is one
--   row per item per verification ROUND:
--
--     scheduled   admin set a verification date and a verifier; not yet submitted
--                 (the verifier may already have saved a draft count on it)
--     submitted   the verifier entered the physical stock and submitted it
--     returned    admin sent it back for a recount, with a reason
--     accepted    admin accepted the count — final; the round is closed
--
--   An item has at most ONE open round (anything but 'accepted'). Scheduling it again after
--   acceptance starts a new row, so every past count stays in the history.
--
-- ⚠ THE TALLY CLOSING IS FROZEN ON THE ROW. Each time the verifier saves a count, the
--   closing qty/rate Tally held at that moment (and ConnectWave's built_at) are written beside
--   it, and `difference` = physical − that closing. Stock moving afterwards never changes a
--   count already taken (asked 14-10-2026). The browser supplies the figure — the database
--   cannot read ConnectWave — exactly as Ink Stabilisation copies its lot facts at submit.
--
-- ⚠ WRITES GO THROUGH RPCs ONLY. The tables carry SELECT policies and nothing else, so a
--   status can only move along the path the functions allow.
--
-- ACCESS — two steps, each with its own list in Settings (asked 14-10-2026)
--   read       any grant on the app ('view' or 'edit')
--   Step 1 · set dates   (Master + Review) admins, or listed in scheduler_ids with an edit grant
--   Step 2 · physical count   the row's assigned verifier (listed in verifier_ids) with an edit
--              grant, once its date has come. Admins may do both.
--   Settings   admins only
--
-- Purely ADDITIVE: three new tables, five functions. Nothing existing is altered. Reuses
-- public.set_updated_at(), public.module_level(), public.module_can_edit() and
-- public.is_admin(). Apply in the Orange One *identity* project (ref icutjkrqkbzwvmnfbzpr —
-- the VITE_SUPABASE_URL project). Reversal: the _rollback.sql beside this file.

begin;

-- ---------------------------------------------------------------- tables --

create table if not exists public.pv_settings (
  id           smallint primary key default 1 check (id = 1),
  -- Step 1: auth user ids who set verification dates and review the counts.
  scheduler_ids uuid[] not null default '{}',
  -- Step 2: auth user ids who may be given items to count.
  verifier_ids uuid[] not null default '{}',
  updated_by   uuid references auth.users on delete set null,
  updated_at   timestamptz not null default now()
);
comment on table public.pv_settings is
  'Physical Verification: the one settings row — who sets dates (step 1) and who counts (step 2). See 20270126120000.';
insert into public.pv_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.pv_counts (
  id              uuid primary key default gen_random_uuid(),
  company_guid    text not null,
  stock_item      text not null,
  primary_group   text,
  sub_group       text,
  stock_group     text,
  unit            text,
  verify_date     date not null,
  -- SET NULL, never RESTRICT: a pending count must not block deleting a user (HR exit).
  -- A row left with no verifier shows only to step 1 / admins, who give it to someone else.
  assigned_to     uuid references auth.users on delete set null,
  status          text not null default 'scheduled'
                  check (status in ('scheduled', 'submitted', 'returned', 'accepted')),
  -- Tally's closing at the moment of the last save (see header). Set at scheduling too, so
  -- the row is never blank, and overwritten by every count save.
  closing_qty     numeric,
  closing_rate    numeric,
  tally_as_at     timestamptz,
  physical_qty    numeric check (physical_qty is null or physical_qty >= 0),
  difference      numeric generated always as (physical_qty - closing_qty) stored,
  verifier_remarks text,
  counted_by      uuid references auth.users on delete set null,
  counted_at      timestamptz,
  submitted_at    timestamptz,
  review_remarks  text,
  reviewed_by     uuid references auth.users on delete set null,
  reviewed_at     timestamptz,
  scheduled_by    uuid references auth.users on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
comment on table public.pv_counts is
  'Physical Verification: one row per item per verification round. Items + live closing come from ConnectWave; the closing at count time is frozen here. See 20270126120000.';

-- At most one OPEN round per item.
create unique index if not exists pv_counts_one_open
  on public.pv_counts (company_guid, stock_item) where status <> 'accepted';
create index if not exists pv_counts_assignee_idx on public.pv_counts (assigned_to, status, verify_date);

drop trigger if exists trg_pv_counts_updated on public.pv_counts;
create trigger trg_pv_counts_updated
  before update on public.pv_counts
  for each row execute function public.set_updated_at();

-- The trail: every schedule, save, submit, send-back and accept, with the figures of the time.
create table if not exists public.pv_activity (
  id           bigint generated always as identity primary key,
  count_id     uuid not null references public.pv_counts on delete cascade,
  action       text not null check (action in ('scheduled', 'rescheduled', 'saved', 'submitted', 'returned', 'accepted')),
  physical_qty numeric,
  closing_qty  numeric,
  remarks      text,
  actor        uuid references auth.users on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists pv_activity_count_idx on public.pv_activity (count_id, created_at);

-- ------------------------------------------------------------------- RLS --

alter table public.pv_settings enable row level security;
alter table public.pv_counts   enable row level security;
alter table public.pv_activity enable row level security;

drop policy if exists pv_settings_select on public.pv_settings;
create policy pv_settings_select on public.pv_settings for select to authenticated
  using ((select public.module_level(auth.uid(), 'physical-verification')) <> 'none');

drop policy if exists pv_settings_write on public.pv_settings;
create policy pv_settings_write on public.pv_settings for update to authenticated
  using ((select public.is_admin(auth.uid())))
  with check ((select public.is_admin(auth.uid())));

drop policy if exists pv_counts_select on public.pv_counts;
create policy pv_counts_select on public.pv_counts for select to authenticated
  using ((select public.module_level(auth.uid(), 'physical-verification')) <> 'none');

drop policy if exists pv_activity_select on public.pv_activity;
create policy pv_activity_select on public.pv_activity for select to authenticated
  using ((select public.module_level(auth.uid(), 'physical-verification')) <> 'none');

-- ------------------------------------------------------------- functions --

-- Step 1: may this user set dates and review counts? Admin, or listed with an edit grant.
create or replace function public.pv_can_schedule(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin(p_uid)
      or (public.module_can_edit(p_uid, 'physical-verification')
          and exists (select 1 from public.pv_settings s where p_uid = any(s.scheduler_ids)));
$$;

-- Admin: give items a verification date and a verifier.
--   p_items: [{company_guid, stock_item, primary_group, sub_group, stock_group, unit, closing_qty, closing_rate, tally_as_at}]
-- An item with an open round that is not yet submitted is MOVED to the new date/verifier
-- (a draft count on it is kept). An item whose count is awaiting review is skipped.
-- Returns how many items were scheduled or moved.
create or replace function public.pv_schedule(p_items jsonb, p_date date, p_assignee uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_item jsonb;
  v_id   uuid;
  v_status text;
  v_n    integer := 0;
begin
  if not public.pv_can_schedule(v_uid) then
    raise exception 'You are not allowed to set verification dates.' using errcode = '42501';
  end if;
  if p_date is null then raise exception 'Pick a verification date.'; end if;
  if p_assignee is null then raise exception 'Pick who will verify.'; end if;
  if not exists (select 1 from public.pv_settings s where p_assignee = any(s.verifier_ids))
     and not public.is_admin(p_assignee) then
    raise exception 'That person is not a verifier — add them in Settings first.';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_id := null; v_status := null;
    select id, status into v_id, v_status from public.pv_counts
     where company_guid = v_item->>'company_guid' and stock_item = v_item->>'stock_item'
       and status <> 'accepted'
     for update;

    if v_status = 'submitted' then
      continue;
    elsif v_id is not null then
      update public.pv_counts
         set verify_date = p_date, assigned_to = p_assignee, scheduled_by = v_uid
       where id = v_id;
      insert into public.pv_activity (count_id, action, remarks, actor)
      values (v_id, 'rescheduled', to_char(p_date, 'DD-MM-YYYY'), v_uid);
    else
      insert into public.pv_counts (company_guid, stock_item, primary_group, sub_group, stock_group, unit,
                                    verify_date, assigned_to, closing_qty, closing_rate, tally_as_at, scheduled_by)
      values (v_item->>'company_guid', v_item->>'stock_item', v_item->>'primary_group', v_item->>'sub_group',
              v_item->>'stock_group', v_item->>'unit',
              p_date, p_assignee,
              nullif(v_item->>'closing_qty', '')::numeric, nullif(v_item->>'closing_rate', '')::numeric,
              nullif(v_item->>'tally_as_at', '')::timestamptz, v_uid)
      returning id into v_id;
      insert into public.pv_activity (count_id, action, closing_qty, remarks, actor)
      values (v_id, 'scheduled', nullif(v_item->>'closing_qty', '')::numeric, to_char(p_date, 'DD-MM-YYYY'), v_uid);
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Admin: take items off the list. Only rounds not yet submitted, and never one sent back
-- for recount (that is a count in progress). Returns how many were removed.
create or replace function public.pv_unschedule(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  if not public.pv_can_schedule(auth.uid()) then
    raise exception 'You are not allowed to remove verification dates.' using errcode = '42501';
  end if;
  delete from public.pv_counts where id = any(p_ids) and status = 'scheduled';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Verifier: save (and optionally submit) counts.
--   p_rows: [{id, physical_qty, closing_qty, closing_rate, tally_as_at, remarks}]
-- Each row must be assigned to the caller (or the caller is admin), its date must have come
-- (India time), and it must be scheduled or sent back. Submitting needs a physical qty.
create or replace function public.pv_save_counts(p_rows jsonb, p_submit boolean)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_admin boolean := public.is_admin(v_uid);
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_row   jsonb;
  v_c     public.pv_counts%rowtype;
  v_qty   numeric;
  v_n     integer := 0;
begin
  if not v_admin and not public.module_can_edit(v_uid, 'physical-verification') then
    raise exception 'You do not have edit access to Physical Verification.' using errcode = '42501';
  end if;

  for v_row in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    select * into v_c from public.pv_counts where id = (v_row->>'id')::uuid for update;
    if v_c.id is null then raise exception 'Item not found.'; end if;
    -- IS DISTINCT FROM, not <>: a row whose verifier was deleted (null) is nobody's to count.
    if v_c.assigned_to is distinct from v_uid and not v_admin then
      raise exception '% is not on your list.', v_c.stock_item using errcode = '42501';
    end if;
    if v_c.status not in ('scheduled', 'returned') then
      raise exception '% is already % — it cannot be changed.', v_c.stock_item, v_c.status;
    end if;
    if v_c.verify_date > v_today then
      raise exception '% is not due until %.', v_c.stock_item, to_char(v_c.verify_date, 'DD-MM-YYYY');
    end if;

    v_qty := nullif(v_row->>'physical_qty', '')::numeric;
    if p_submit and v_qty is null then
      raise exception 'Enter the physical stock for % before submitting.', v_c.stock_item;
    end if;
    if v_qty is not null and v_qty < 0 then
      raise exception 'Physical stock cannot be negative (%).', v_c.stock_item;
    end if;

    update public.pv_counts
       set physical_qty     = v_qty,
           closing_qty      = coalesce(nullif(v_row->>'closing_qty', '')::numeric, closing_qty),
           closing_rate     = coalesce(nullif(v_row->>'closing_rate', '')::numeric, closing_rate),
           tally_as_at      = coalesce(nullif(v_row->>'tally_as_at', '')::timestamptz, tally_as_at),
           verifier_remarks = nullif(btrim(v_row->>'remarks'), ''),
           counted_by       = v_uid,
           counted_at       = now(),
           status           = case when p_submit then 'submitted' else status end,
           submitted_at     = case when p_submit then now() else submitted_at end
     where id = v_c.id;

    insert into public.pv_activity (count_id, action, physical_qty, closing_qty, remarks, actor)
    select v_c.id, case when p_submit then 'submitted' else 'saved' end, c.physical_qty, c.closing_qty,
           c.verifier_remarks, v_uid
      from public.pv_counts c where c.id = v_c.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Admin: accept submitted counts, or send them back for a recount (reason required).
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
  if not public.pv_can_schedule(v_uid) then
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

revoke all on function public.pv_can_schedule(uuid)              from public, anon;
revoke all on function public.pv_schedule(jsonb, date, uuid)     from public, anon;
revoke all on function public.pv_unschedule(uuid[])              from public, anon;
revoke all on function public.pv_save_counts(jsonb, boolean)     from public, anon;
revoke all on function public.pv_review(uuid[], text, text)      from public, anon;
grant execute on function public.pv_can_schedule(uuid)           to authenticated;
grant execute on function public.pv_schedule(jsonb, date, uuid)  to authenticated;
grant execute on function public.pv_unschedule(uuid[])           to authenticated;
grant execute on function public.pv_save_counts(jsonb, boolean)  to authenticated;
grant execute on function public.pv_review(uuid[], text, text)   to authenticated;

-- ------------------------------------------------------------ assertions --
do $mig$
declare
  v_missing text;
begin
  select string_agg(t, ', ') into v_missing
    from unnest(array['pv_settings', 'pv_counts', 'pv_activity']) t
   where not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                     where n.nspname = 'public' and c.relname = t and c.relrowsecurity);
  if v_missing is not null then
    raise exception 'RLS is not enabled on: %', v_missing;
  end if;
  if not exists (select 1 from public.pv_settings where id = 1) then
    raise exception 'pv_settings row 1 is missing';
  end if;
end;
$mig$;

commit;

-- ---------------------------------------------------------------- verify --
--
--   select relname, relrowsecurity from pg_class where relname like 'pv\_%';
--   select policyname, cmd from pg_policies where tablename like 'pv\_%' order by 1;
--   select status, count(*) from public.pv_counts group by 1;
