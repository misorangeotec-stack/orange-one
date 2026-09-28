-- PF-18 · Announcements: one message on every screen of the hub, with an optional email.
--
-- Decided by the user on 18-09-2026 (WORKLIST.md → PF-18):
--   • Who may post: admins, plus anyone an admin grants the new `announcements` module at
--     the EDIT level in Module Access. No new role.
--   • Audience: all staff by default, or the users of one or more modules. Admins count as
--     users of every module, which is exactly what the frontend's hasModule() says.
--   • It goes away for one person when they close it (✕), and for everyone on the end date
--     the poster sets, or at once through End now.
--   • A new joiner sees anything still running that is meant for them, and is never mailed
--     an old one: the email recipients are fixed at the moment of publishing.
--   • Email is a tick-box, off by default, and ships DISARMED: the email_module_settings row
--     'announcements' is inserted OFF. Asking for email while it is off RAISES; the request
--     is never silently dropped.
--
-- 🔴 STAFF ONLY. A customer login (profiles.is_external, OD-13) never sees, is counted for,
--   or is mailed an announcement. That rule lives in ONE place, in_announcement_audience(),
--   and every reader, the recipient count and the enqueue go through it.
--
-- No browser writes, and no direct reads either: RLS is on with no policies and the table
-- privileges are revoked, so everything goes through the SECURITY DEFINER functions below,
-- each of which checks its own caller.
--
-- IST. The database runs in UTC. An end date of 25-09 means the END of 25-09 in India:
--   ends_at = 26-09 00:00 Asia/Kolkata, and an announcement runs while now() < ends_at.
--
-- ADDITIVE ONLY: two new tables, new functions, one new switch row. Nothing that exists is
-- altered. Rollback: the _rollback.sql beside this.

do $$
begin
  if to_regclass('public.announcements') is not null then
    raise exception 'PF-18 is already applied: public.announcements exists';
  end if;
end $$;

-- ── 1. Tables ─────────────────────────────────────────────────────────────────

create table public.announcements (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  body             text,
  link_url         text,
  -- Empty = all staff. Otherwise the app ids whose users (and admins) it is for.
  audience_modules text[] not null default '{}'::text[],
  starts_at        timestamptz not null default now(),
  ends_at          timestamptz not null,
  email_requested  boolean not null default false,
  emailed_at       timestamptz,
  emailed_count    integer,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz,
  updated_by       uuid references public.profiles(id) on delete set null,
  ended_at         timestamptz,
  ended_by         uuid references public.profiles(id) on delete set null,
  constraint announcements_title_len check (title = btrim(title) and char_length(title) between 1 and 120),
  constraint announcements_body_len  check (body is null or char_length(body) between 1 and 4000),
  constraint announcements_link_http check (
    link_url is null
    or (char_length(link_url) <= 500 and link_url ~* '^https?://[^[:space:]<>"'']+$')
  ),
  constraint announcements_ends_after_start check (ends_at > starts_at)
);

comment on table public.announcements is
  'PF-18 · Hub-wide announcements. Read and written only through the announcement_* functions.';
comment on column public.announcements.audience_modules is
  'Empty = all staff. Otherwise app ids: holders of any of them (and admins) are the audience. Customers never are.';
comment on column public.announcements.ends_at is
  'Exclusive: the start of the day AFTER the chosen end date, in Asia/Kolkata. Running while now() < ends_at.';
comment on column public.announcements.emailed_count is
  'Rows queued in email_outbox at publish. Fixed then: a later audience member is never mailed.';

create index announcements_running on public.announcements (ends_at) where ended_at is null;

create table public.announcement_dismissals (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  dismissed_at    timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

comment on table public.announcement_dismissals is
  'PF-18 · Who closed which announcement (✕). Hides it for that person only.';

create index announcement_dismissals_user on public.announcement_dismissals (user_id);

alter table public.announcements           enable row level security;
alter table public.announcement_dismissals enable row level security;
-- No policies, deliberately: nobody but the definer functions below reads or writes these.
revoke all on public.announcements, public.announcement_dismissals from anon, authenticated;

-- ── 2. The email switch, OFF ──────────────────────────────────────────────────

insert into public.email_module_settings (module_id, enabled)
values ('announcements', false)
on conflict (module_id) do nothing;

-- ── 3. Helpers: the rules, each in one place ──────────────────────────────────

-- Trim, drop blanks, de-duplicate and sort a module list, so '{}' always means all staff.
create or replace function public.announcement_modules_norm(p_modules text[])
returns text[]
language sql
immutable
set search_path = public
as $$
  select coalesce(array_agg(distinct m order by m), '{}'::text[])
    from (select btrim(x) as m from unnest(coalesce(p_modules, '{}'::text[])) as x) s
   where m <> '';
$$;

-- Admins, or staff holding the announcements module at the EDIT level. module_level()
-- already answers 'edit' for an admin.
create or replace function public.can_post_announcements(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_uid is not null
     and public.is_staff(p_uid)
     and public.module_level(p_uid, 'announcements') = 'edit';
$$;

-- 🔴 THE audience rule. Never a customer; then either everyone, or an admin, or a holder of
-- any picked module (at any level: a view-only grant still makes you that module's user).
create or replace function public.in_announcement_audience(p_modules text[], p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_uid is not null
     and public.is_staff(p_uid)
     and (   coalesce(cardinality(p_modules), 0) = 0
          or public.is_admin(p_uid)
          or exists (select 1 from public.app_access a
                      where a.user_id = p_uid and a.app_id = any (p_modules)));
$$;

-- The chosen end DATE → the exclusive end INSTANT: the next midnight in India.
create or replace function public.announcement_ends_at(p_ends_on date)
returns timestamptz
language sql
stable
set search_path = public
as $$
  select ((p_ends_on + 1)::timestamp at time zone 'Asia/Kolkata');
$$;

-- The end date back from the instant, for display and for the edit form.
create or replace function public.announcement_ends_on(p_ends_at timestamptz)
returns date
language sql
stable
set search_path = public
as $$
  select ((p_ends_at at time zone 'Asia/Kolkata') - interval '1 microsecond')::date;
$$;

-- Title, message and link, as the reader will see them. Raises a sentence a poster can act on.
create or replace function public.announcement_check_text(p_title text, p_body text, p_link text)
returns void
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_title is null or char_length(p_title) = 0 then
    raise exception 'Give the announcement a title.';
  end if;
  if char_length(p_title) > 120 then
    raise exception 'The title is % characters; keep it to 120.', char_length(p_title);
  end if;
  if p_body is not null and char_length(p_body) > 4000 then
    raise exception 'The message is % characters; keep it to 4000.', char_length(p_body);
  end if;
  if p_link is not null and (char_length(p_link) > 500 or p_link !~* '^https?://[^[:space:]<>"'']+$') then
    raise exception 'The link must be a web address starting with http:// or https://, with no spaces.';
  end if;
end $$;

-- An end date a poster may set now: today (India) at the earliest, a year ahead at the latest.
create or replace function public.announcement_check_end(p_ends_on date)
returns void
language plpgsql
stable
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if p_ends_on is null then raise exception 'Choose the date it should stop showing.'; end if;
  if p_ends_on < v_today then raise exception 'The end date is in the past.'; end if;
  if p_ends_on > v_today + 365 then raise exception 'The end date can be at most a year ahead.'; end if;
end $$;

-- Running / ended early / expired, from one expression every reader shares.
create or replace function public.announcement_status(p_ended_at timestamptz, p_ends_at timestamptz)
returns text
language sql
stable
set search_path = public
as $$
  select case when p_ended_at is not null then 'ended'
              when p_ends_at <= now()     then 'expired'
              else 'running' end;
$$;

-- ── 4. Readers ────────────────────────────────────────────────────────────────

-- The strip: what is running for the caller right now and they have not closed, newest
-- first. A customer (or anyone outside every audience) simply gets [] — the strip is
-- mounted in shells a customer can reach, so this must not raise for them.
create or replace function public.announcements_active()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', a.id, 'title', a.title, 'body', a.body, 'link_url', a.link_url,
             'starts_at', a.starts_at, 'ends_at', a.ends_at,
             'ends_on', public.announcement_ends_on(a.ends_at), 'created_at', a.created_at)
           order by a.created_at desc)
      from public.announcements a
     where a.ended_at is null
       and a.starts_at <= now()
       and a.ends_at > now()
       and public.in_announcement_audience(a.audience_modules, v_uid)
       and not exists (select 1 from public.announcement_dismissals d
                        where d.announcement_id = a.id and d.user_id = v_uid)), '[]'::jsonb);
end $$;

-- The history page: everything the caller was ever in the audience for, in any state.
-- Posters also get who posted it and what was mailed; everyone else gets nulls there.
create or replace function public.announcements_history()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_poster boolean;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  v_poster := public.can_post_announcements(v_uid);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', a.id, 'title', a.title, 'body', a.body, 'link_url', a.link_url,
             'audience_modules', to_jsonb(a.audience_modules),
             'starts_at', a.starts_at, 'ends_at', a.ends_at,
             'ends_on', public.announcement_ends_on(a.ends_at),
             'ended_at', a.ended_at, 'created_at', a.created_at,
             'status', public.announcement_status(a.ended_at, a.ends_at),
             'dismissed', exists (select 1 from public.announcement_dismissals d
                                   where d.announcement_id = a.id and d.user_id = v_uid),
             'posted_by',       case when v_poster then p.name end,
             'email_requested', case when v_poster then a.email_requested end,
             'emailed_at',      case when v_poster then a.emailed_at end,
             'emailed_count',   case when v_poster then a.emailed_count end)
           order by a.created_at desc)
      from public.announcements a
      left join public.profiles p on p.id = a.created_by
     where public.in_announcement_audience(a.audience_modules, v_uid)), '[]'::jsonb);
end $$;

-- The posting app's grid: EVERY announcement, whoever it was for, with what may be done to
-- it. Posters only.
create or replace function public.announcements_manage()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_admin boolean;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if not public.can_post_announcements(v_uid) then
    raise exception 'Only admins and people given the Announcements module can manage announcements.';
  end if;
  v_admin := public.is_admin(v_uid);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', a.id, 'title', a.title, 'body', a.body, 'link_url', a.link_url,
             'audience_modules', to_jsonb(a.audience_modules),
             'starts_at', a.starts_at, 'ends_at', a.ends_at,
             'ends_on', public.announcement_ends_on(a.ends_at),
             'ended_at', a.ended_at, 'ended_by', e.name,
             'created_at', a.created_at, 'created_by', a.created_by, 'posted_by', p.name,
             'updated_at', a.updated_at, 'updated_by', u.name,
             'status', public.announcement_status(a.ended_at, a.ends_at),
             'email_requested', a.email_requested, 'emailed_at', a.emailed_at,
             'emailed_count', a.emailed_count,
             'dismissed_count', (select count(*) from public.announcement_dismissals d
                                  where d.announcement_id = a.id),
             'can_edit', v_admin or a.created_by = v_uid)
           order by a.created_at desc)
      from public.announcements a
      left join public.profiles p on p.id = a.created_by
      left join public.profiles u on u.id = a.updated_by
      left join public.profiles e on e.id = a.ended_by), '[]'::jsonb);
end $$;

-- What the composer shows before Publish: how many staff it will show to, how many of them
-- would be mailed, and whether mail is switched on at all. Counts through the SAME audience
-- rule the publish enqueue uses, so the number on screen is the number of rows queued.
create or replace function public.announcement_recipient_count(p_modules text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_mods text[] := public.announcement_modules_norm(p_modules);
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if not public.can_post_announcements(v_uid) then
    raise exception 'Only admins and people given the Announcements module can post announcements.';
  end if;
  return (
    select jsonb_build_object(
             'shows_to',  count(*),
             'emails_to', count(*) filter (where coalesce(btrim(p.email), '') <> ''),
             'email_enabled', public.email_module_enabled('announcements'))
      from public.profiles p
     where public.in_announcement_audience(v_mods, p.id));
end $$;

-- ── 5. Writers ────────────────────────────────────────────────────────────────

-- Publish. Validates, inserts, and — only when email is asked for AND switched on — queues
-- one email_outbox row per staff member in the audience at this moment, all in one
-- transaction. Asking for email while the switch is off raises; it is never skipped.
create or replace function public.announcement_publish(
  p_title   text,
  p_body    text,
  p_link    text,
  p_ends_on date,
  p_modules text[],
  p_email   boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_title  text := btrim(coalesce(p_title, ''));
  v_body   text := nullif(btrim(coalesce(p_body, '')), '');
  v_link   text := nullif(btrim(coalesce(p_link, '')), '');
  v_mods   text[] := public.announcement_modules_norm(p_modules);
  v_email  boolean := coalesce(p_email, false);
  v_id     uuid;
  v_n      integer := 0;
  v_poster text;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if not public.can_post_announcements(v_uid) then
    raise exception 'Only admins and people given the Announcements module can post announcements.';
  end if;
  perform public.announcement_check_text(v_title, v_body, v_link);
  perform public.announcement_check_end(p_ends_on);
  if v_email and not public.email_module_enabled('announcements') then
    raise exception 'Email for announcements is switched off, so this cannot be emailed. Untick "Also email" to publish it on screen only.';
  end if;

  insert into public.announcements
    (title, body, link_url, audience_modules, ends_at, email_requested, created_by)
  values
    (v_title, v_body, v_link, v_mods, public.announcement_ends_at(p_ends_on), v_email, v_uid)
  returning id into v_id;

  if v_email then
    select name into v_poster from public.profiles where id = v_uid;
    insert into public.email_outbox (kind, to_user_id, to_email, to_name, actor_id, entity_id, subject, payload)
    select 'announcement', p.id, btrim(p.email), p.name, v_uid, v_id, v_title,
           jsonb_build_object(
             'subject',  v_title,
             'title',    v_title,
             'body',     v_body,
             'link',     v_link,
             'postedBy', v_poster,
             'endsOn',   to_char(p_ends_on, 'DD-MM-YYYY'),
             'url',      'https://orangeonehub.com/announcements')
      from public.profiles p
     where coalesce(btrim(p.email), '') <> ''
       and public.in_announcement_audience(v_mods, p.id)
     order by p.name;
    get diagnostics v_n = row_count;
    update public.announcements set emailed_at = now(), emailed_count = v_n where id = v_id;
  end if;

  return jsonb_build_object('id', v_id, 'emailed_count', v_n);
end $$;

-- Fix the title, message, link or end date. The poster, or an admin. Never re-sends mail,
-- and leaves every dismissal where it is. An announcement that was ended early stays ended:
-- its end date can no longer move.
create or replace function public.announcement_update(
  p_id      uuid,
  p_title   text,
  p_body    text,
  p_link    text,
  p_ends_on date
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_title text := btrim(coalesce(p_title, ''));
  v_body  text := nullif(btrim(coalesce(p_body, '')), '');
  v_link  text := nullif(btrim(coalesce(p_link, '')), '');
  v_row   public.announcements%rowtype;
  v_ends  timestamptz;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if not public.can_post_announcements(v_uid) then
    raise exception 'Only admins and people given the Announcements module can edit announcements.';
  end if;
  select * into v_row from public.announcements where id = p_id for update;
  if not found then raise exception 'That announcement no longer exists.'; end if;
  if v_row.created_by is distinct from v_uid and not public.is_admin(v_uid) then
    raise exception 'Only the person who posted it, or an admin, can edit this announcement.';
  end if;
  perform public.announcement_check_text(v_title, v_body, v_link);

  v_ends := v_row.ends_at;
  if p_ends_on is not null and p_ends_on is distinct from public.announcement_ends_on(v_row.ends_at) then
    if v_row.ended_at is not null then
      raise exception 'This announcement was ended early, so its end date can no longer change. Post a new one instead.';
    end if;
    perform public.announcement_check_end(p_ends_on);
    v_ends := public.announcement_ends_at(p_ends_on);
  end if;

  update public.announcements
     set title = v_title, body = v_body, link_url = v_link, ends_at = v_ends,
         updated_at = now(), updated_by = v_uid
   where id = p_id;
end $$;

-- End now, for everyone. The poster, or an admin.
create or replace function public.announcement_end(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.announcements%rowtype;
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  if not public.can_post_announcements(v_uid) then
    raise exception 'Only admins and people given the Announcements module can end announcements.';
  end if;
  select * into v_row from public.announcements where id = p_id for update;
  if not found then raise exception 'That announcement no longer exists.'; end if;
  if v_row.created_by is distinct from v_uid and not public.is_admin(v_uid) then
    raise exception 'Only the person who posted it, or an admin, can end this announcement.';
  end if;
  if v_row.ended_at is not null then raise exception 'This announcement has already been ended.'; end if;
  if v_row.ends_at <= now() then raise exception 'This announcement has already reached its end date.'; end if;
  update public.announcements set ended_at = now(), ended_by = v_uid where id = p_id;
end $$;

-- Close it for the caller only (✕). Refused for an announcement the caller could never see.
create or replace function public.announcement_dismiss(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_mods text[];
begin
  if v_uid is null then raise exception 'Not signed in'; end if;
  select audience_modules into v_mods from public.announcements where id = p_id;
  if not found or not public.in_announcement_audience(v_mods, v_uid) then
    raise exception 'That announcement no longer exists.';
  end if;
  insert into public.announcement_dismissals (announcement_id, user_id)
  values (p_id, v_uid)
  on conflict (announcement_id, user_id) do nothing;
end $$;

-- ── 6. Privileges ─────────────────────────────────────────────────────────────

-- Helpers are internal: in_announcement_audience(uid) would otherwise let anyone ask which
-- modules someone else holds.
revoke all on function public.announcement_modules_norm(text[])              from public, anon, authenticated;
revoke all on function public.can_post_announcements(uuid)                   from public, anon, authenticated;
revoke all on function public.in_announcement_audience(text[], uuid)         from public, anon, authenticated;
revoke all on function public.announcement_ends_at(date)                     from public, anon, authenticated;
revoke all on function public.announcement_ends_on(timestamptz)              from public, anon, authenticated;
revoke all on function public.announcement_check_text(text, text, text)      from public, anon, authenticated;
revoke all on function public.announcement_check_end(date)                   from public, anon, authenticated;
revoke all on function public.announcement_status(timestamptz, timestamptz)  from public, anon, authenticated;

revoke all on function public.announcements_active()                                        from public, anon;
revoke all on function public.announcements_history()                                       from public, anon;
revoke all on function public.announcements_manage()                                        from public, anon;
revoke all on function public.announcement_recipient_count(text[])                          from public, anon;
revoke all on function public.announcement_publish(text, text, text, date, text[], boolean) from public, anon;
revoke all on function public.announcement_update(uuid, text, text, text, date)             from public, anon;
revoke all on function public.announcement_end(uuid)                                        from public, anon;
revoke all on function public.announcement_dismiss(uuid)                                    from public, anon;

grant execute on function public.announcements_active()                                        to authenticated;
grant execute on function public.announcements_history()                                       to authenticated;
grant execute on function public.announcements_manage()                                        to authenticated;
grant execute on function public.announcement_recipient_count(text[])                          to authenticated;
grant execute on function public.announcement_publish(text, text, text, date, text[], boolean) to authenticated;
grant execute on function public.announcement_update(uuid, text, text, text, date)             to authenticated;
grant execute on function public.announcement_end(uuid)                                        to authenticated;
grant execute on function public.announcement_dismiss(uuid)                                    to authenticated;

-- ── 7. Check ──────────────────────────────────────────────────────────────────

do $check$
begin
  if public.email_module_enabled('announcements') then
    raise exception 'PF-18: the announcements email switch must ship OFF';
  end if;
  -- 25-09 ends at 26-09 00:00 IST = 25-09 18:30 UTC, and reads back as 25-09.
  if public.announcement_ends_at(date '2026-09-25') <> timestamptz '2026-09-25 18:30:00+00' then
    raise exception 'PF-18: end-of-day IST arithmetic is wrong';
  end if;
  if public.announcement_ends_on(timestamptz '2026-09-25 18:30:00+00') <> date '2026-09-25' then
    raise exception 'PF-18: ends_on does not read back';
  end if;
  if public.announcement_modules_norm(array[' sampling', '', 'import', 'sampling', null]) <> array['import', 'sampling'] then
    raise exception 'PF-18: module list normalisation is wrong';
  end if;
end $check$;
