-- ===========================================================================
-- THE BUSHRA SALES DASHBOARD, ON A SCHEDULE — what goes in the mail, and to whom.
--
-- The hub already knows WHEN to send (report_email_schedule), WHETHER it may
-- (report_email_settings) and WHO by address (report_email_recipients). Two
-- things are missing for a dashboard, as opposed to a report that is simply a
-- file:
--
--   1. WHICH BLOCKS go in it. A dashboard is nine sections; an 08:00 mail that
--      carries all of them is a wall, and different readers want different
--      parts. So the choice is stored per report_key.
--
--   2. WHO by PERSON rather than by address. RECEIVABLES-SCHEDULED-EMAIL.md §3
--      records this as the open item: an address on a list keeps mailing an
--      ex-employee and stops mailing someone who changed theirs. A chosen
--      profile id follows the person — their current email is read at send
--      time — and it also lets the sender REFUSE to mail a dashboard to
--      somebody who is not allowed to open it (see the check in the send gate).
--
-- Nothing here sends anything. It is storage plus two setters, both admin-only.
--
-- Reversal:
--   drop function if exists public.set_bushra_sales_mail_options(text, jsonb);
--   drop function if exists public.set_report_email_user_recipients(text, uuid[]);
--   drop table if exists public.report_email_user_recipients;
--   drop table if exists public.report_email_options;
-- ===========================================================================

-- ------------------------------------------------------------ what goes in --
create table if not exists public.report_email_options (
  report_key  text primary key,
  -- The section ids the mail carries, in the order the dashboard shows them.
  -- Empty means "everything", so a block added later is included by default
  -- rather than silently dropped from every existing schedule.
  blocks      text[]      not null default '{}',
  -- 'month' | 'quarter' | 'ytd' — the window the figures cover.
  period      text        not null default 'month'
              check (period in ('month', 'quarter', 'ytd')),
  attach_pdf  boolean     not null default true,
  updated_at  timestamptz not null default now(),
  updated_by  uuid        references auth.users on delete set null
);

comment on table public.report_email_options is
  'Per report: which dashboard blocks the scheduled mail carries, over what period, and whether the PDF is attached. No row = every block, this month, PDF attached.';

alter table public.report_email_options enable row level security;

-- Readable by anyone signed in (the settings screen shows it); written only by
-- an admin, like every other emailing control.
drop policy if exists report_email_options_read on public.report_email_options;
create policy report_email_options_read on public.report_email_options
  for select to authenticated using (true);

-- ------------------------------------------------------------- who gets it --
create table if not exists public.report_email_user_recipients (
  report_key  text        not null,
  user_id     uuid        not null references auth.users on delete cascade,
  added_at    timestamptz not null default now(),
  added_by    uuid        references auth.users on delete set null,
  primary key (report_key, user_id)
);

comment on table public.report_email_user_recipients is
  'Scheduled-mail recipients chosen as PEOPLE, not addresses: the sender reads their profile email at send time, so a change of address needs no edit here and a leaver stops receiving when their account goes.';

alter table public.report_email_user_recipients enable row level security;

drop policy if exists report_email_user_recipients_read on public.report_email_user_recipients;
create policy report_email_user_recipients_read on public.report_email_user_recipients
  for select to authenticated using (true);

-- ---------------------------------------------------------------- setters --
-- Both are SECURITY DEFINER and check is_admin themselves: the tables have no
-- write policy at all, so these functions are the only door.

create or replace function public.set_bushra_sales_mail_options(
  p_report_key text,
  p_options    jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_blocks text[];
  v_period text;
begin
  if not public.is_admin((select auth.uid())) then
    raise exception 'only an admin may change what a scheduled mail carries';
  end if;
  if coalesce(btrim(p_report_key), '') = '' then
    raise exception 'report key is required';
  end if;

  select coalesce(array_agg(value::text), '{}')
    into v_blocks
    from jsonb_array_elements_text(coalesce(p_options->'blocks', '[]'::jsonb)) as value;

  v_period := coalesce(p_options->>'period', 'month');
  if v_period not in ('month', 'quarter', 'ytd') then
    raise exception 'period must be month, quarter or ytd (got %)', v_period;
  end if;

  insert into public.report_email_options (report_key, blocks, period, attach_pdf, updated_at, updated_by)
  values (
    btrim(p_report_key),
    v_blocks,
    v_period,
    coalesce((p_options->>'attach_pdf')::boolean, true),
    now(),
    (select auth.uid())
  )
  on conflict (report_key) do update
    set blocks     = excluded.blocks,
        period     = excluded.period,
        attach_pdf = excluded.attach_pdf,
        updated_at = now(),
        updated_by = excluded.updated_by;
end;
$fn$;

create or replace function public.set_report_email_user_recipients(
  p_report_key text,
  p_user_ids   uuid[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if not public.is_admin((select auth.uid())) then
    raise exception 'only an admin may change who receives a scheduled mail';
  end if;
  if coalesce(btrim(p_report_key), '') = '' then
    raise exception 'report key is required';
  end if;

  -- Replace the list wholesale: the screen always sends the complete set, and a
  -- diff would leave a removed person receiving if one statement failed.
  delete from public.report_email_user_recipients where report_key = btrim(p_report_key);

  insert into public.report_email_user_recipients (report_key, user_id, added_by)
  select btrim(p_report_key), u, (select auth.uid())
    from unnest(coalesce(p_user_ids, '{}')) as u
   where u is not null
  on conflict do nothing;
end;
$fn$;

revoke all on function public.set_bushra_sales_mail_options(text, jsonb) from public, anon;
revoke all on function public.set_report_email_user_recipients(text, uuid[]) from public, anon;
grant execute on function public.set_bushra_sales_mail_options(text, jsonb) to authenticated;
grant execute on function public.set_report_email_user_recipients(text, uuid[]) to authenticated;

-- ============================================================== asserts ====
do $check$
begin
  if to_regclass('public.report_email_options') is null then
    raise exception 'bushra sales mail: report_email_options was not created';
  end if;
  if to_regclass('public.report_email_user_recipients') is null then
    raise exception 'bushra sales mail: report_email_user_recipients was not created';
  end if;
  -- Neither table may be writable without going through the setters.
  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename in ('report_email_options', 'report_email_user_recipients')
       and cmd <> 'SELECT'
  ) then
    raise exception 'bushra sales mail: a write policy exists; the setters must be the only door';
  end if;
end $check$;
