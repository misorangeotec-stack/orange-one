-- ===========================================================================
-- L&D · TRAINING CALENDAR — upload, Internal/External, the 3-day Teams-style
-- mail, cancel (+ cancel mail), the Complete pop-up, and the 24-hour target.
--
-- Source: HR's six changes of 14-10-2026, compared line by line in
-- LND-Changes-Current-vs-New.pdf (decisions D1–D10 taken as suggested).
--
-- WHAT IT ADDS, NOTHING REMOVED:
--   • fms_ld_sessions: category, source, description, trainer_user_id,
--     external_trainer_name, cancelled_*, completed_*, invite/cancel mail stamps,
--     ics_sequence. fms_ld_nominations: invite_mailed_at.
--   • Setup: config `calendar_managers` (who may add / upload / edit / cancel /
--     complete), `targets.hours_per_head_year` 10 → 24.
--   • RPCs: fms_ld_save_calendar_session, fms_ld_bulk_save_calendar,
--     fms_ld_cancel_session, fms_ld_complete_session.
--   • Mail: fms_ld_queue_training_mail + daily cron fms_ld_send_due_training_mails
--     (09:00 IST) — invite 3 days before, "updated" on change, "cancelled" only to
--     people who already had the invite.
--
-- ⚠ D1 — A CALENDAR TRAINING SKIPS THE REQUEST CHAIN. It is born `source =
--   'calendar'` with no request_id; the year calendar counts as approved. The
--   request → approvals → scheduling path is untouched for ad-hoc needs.
--
-- ⚠ D3 — CALENDAR ATTENDEES ARE CONFIRMED, NOT INVITED-TO-ANSWER. They are
--   inserted as approved nominations with rsvp = 'accepted', like being put on a
--   Teams meeting. The .ics lets them respond in Outlook if they want to.
--
-- ⚠ D10 — MAIL STAYS OFF. email_module_settings('learning-development') is
--   already `false` on live and this file does not touch it. With the switch
--   off, nothing is queued AND nothing is stamped as mailed — so the cancel rule
--   ("mail only if the invite went out") stays true the day it is switched on.
--
-- Rollback: 20270125120000_ld_training_calendar_rollback.sql
-- ===========================================================================

do $pre$
begin
  if to_regclass('public.fms_ld_sessions') is null then
    raise exception 'LD calendar: the L&D tables are missing';
  end if;
  if to_regprocedure('public.email_module_enabled(text)') is null then
    raise exception 'LD calendar: public.email_module_enabled(text) is missing';
  end if;
end $pre$;

begin;

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.fms_ld_sessions
  add column if not exists category              text,
  add column if not exists source                text not null default 'request',
  add column if not exists description           text,
  add column if not exists trainer_user_id       uuid references public.profiles(id) on delete set null,
  add column if not exists external_trainer_name text,
  add column if not exists cancelled_at          timestamptz,
  add column if not exists cancelled_by          uuid references auth.users on delete set null,
  add column if not exists completed_at          timestamptz,
  add column if not exists completed_by          uuid references auth.users on delete set null,
  add column if not exists invite_mail_sent_at   timestamptz,
  add column if not exists cancel_mail_sent_at   timestamptz,
  add column if not exists ics_sequence          integer not null default 0;

alter table public.fms_ld_sessions drop constraint if exists fms_ld_sessions_category_chk;
alter table public.fms_ld_sessions add constraint fms_ld_sessions_category_chk
  check (category is null or category in ('internal','external'));
alter table public.fms_ld_sessions drop constraint if exists fms_ld_sessions_source_chk;
alter table public.fms_ld_sessions add constraint fms_ld_sessions_source_chk
  check (source in ('request','calendar'));
-- A calendar training needs its category and times — the hours read them.
-- The Teams link is OPTIONAL (HR, 14-10-2026: "when required we will upload");
-- adding it later sends an "Updated" mail to anyone who already had the invite.
alter table public.fms_ld_sessions drop constraint if exists fms_ld_sessions_calendar_complete_chk;
alter table public.fms_ld_sessions add constraint fms_ld_sessions_calendar_complete_chk
  check (source <> 'calendar' or (category is not null
                                  and start_time is not null and end_time is not null));

comment on column public.fms_ld_sessions.category is
  'Internal (run by our own people) or External (outside trainer/agency). Required on calendar trainings; null on older request-born sessions.';
comment on column public.fms_ld_sessions.source is
  '''calendar'' = added or uploaded on the Training Calendar (skips the request chain, decision D1); ''request'' = born from an approved training request.';
comment on column public.fms_ld_sessions.trainer_user_id is
  'Internal trainer as an Orange Hub user. They may press Complete on their own training.';
comment on column public.fms_ld_sessions.invite_mail_sent_at is
  'First time the Teams-style invitation mail was queued for this training. Null = no attendee has had it, so a cancel sends no mail.';
comment on column public.fms_ld_sessions.ics_sequence is
  'SEQUENCE of the calendar (.ics) invite. Bumped on every update / cancel mail so Outlook replaces the earlier invite instead of adding a second one.';

create index if not exists fms_ld_sessions_source_idx on public.fms_ld_sessions (source, session_date);

alter table public.fms_ld_nominations
  add column if not exists invite_mailed_at timestamptz;
comment on column public.fms_ld_nominations.invite_mailed_at is
  'When this attendee''s invitation mail was queued. A cancellation mails only the people stamped here.';

-- ---------------------------------------------------------------------------
-- 2. Config: calendar managers, 24-hour target, mail switch row
-- ---------------------------------------------------------------------------
insert into public.fms_ld_config (key, value)
values ('calendar_managers', jsonb_build_object('user_ids', '[]'::jsonb))
on conflict (key) do nothing;

update public.fms_ld_config
   set value = jsonb_set(coalesce(value, '{}'::jsonb), '{hours_per_head_year}', '24'::jsonb)
 where key = 'targets';
insert into public.fms_ld_config (key, value)
values ('targets', jsonb_build_object('hours_per_head_year', 24))
on conflict (key) do nothing;

insert into public.email_module_settings (module_id, enabled)
values ('learning-development', false)
on conflict (module_id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------------
-- Who may add / upload / edit / cancel / complete calendar trainings (D2).
create or replace function public.fms_ld_can_manage_calendar(p_uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_uid is not null and (
    public.fms_ld_is_coordinator(p_uid)
    or exists (
      select 1 from public.fms_ld_config c
       where c.key = 'calendar_managers'
         and (c.value->'user_ids') ? p_uid::text
    )
  );
$$;
grant execute on function public.fms_ld_can_manage_calendar(uuid) to authenticated;

-- A Microsoft Teams meeting address — work (teams.microsoft.com) or personal
-- (teams.live.com). Anything else is refused: the requirement is that the link
-- ALWAYS opens Teams.
create or replace function public.fms_ld_is_teams_link(p_link text)
returns boolean
language sql
immutable
as $$
  select coalesce(btrim(p_link), '') ~* '^https://teams\.(microsoft|live)\.com/\S+$';
$$;
grant execute on function public.fms_ld_is_teams_link(text) to authenticated;

-- "Now" on the clock HR reads, as a timestamp without zone.
create or replace function public.fms_ld_now_ist()
returns timestamp
language sql
stable
as $$ select (now() at time zone 'Asia/Kolkata'); $$;

-- Staff directory WITH emails and employee codes, for the bulk upload's
-- attendee matching. Calendar managers only — everyone else gets nothing, and
-- customer logins (is_external) are never in it.
create or replace function public.fms_ld_people_directory()
returns table (id uuid, name text, email text, employee_code text, department_id uuid, designation text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.name,
         lower(coalesce(nullif(btrim(p.email), ''), u.email)),
         nullif(btrim(p.employee_code), ''),
         p.department_id, p.designation
    from public.profiles p
    left join auth.users u on u.id = p.id
   where public.fms_ld_can_manage_calendar(auth.uid())
     and coalesce(p.is_external, false) = false
   order by p.name;
$$;
grant execute on function public.fms_ld_people_directory() to authenticated;

-- The trainer as one display string, whichever of the three ways it was given.
create or replace function public.fms_ld_trainer_label(p_session_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.name from public.profiles p where p.id = s.trainer_user_id),
    (select t.name || coalesce(' (' || nullif(t.agency, '') || ')', '')
       from public.fms_ld_trainers t where t.id = s.trainer_id),
    nullif(btrim(s.external_trainer_name), ''),
    '')
  from public.fms_ld_sessions s where s.id = p_session_id;
$$;

-- ---------------------------------------------------------------------------
-- 4. The mail queue
--
-- p_kind: 'invite' | 'updated' | 'cancelled'.
-- p_employee_ids: restrict to these attendees (late additions, removals);
--   null = every approved attendee the kind applies to.
--
-- ⚠ 'cancelled' GOES ONLY TO PEOPLE WHO HAD THE INVITE (requirement 4). An
--   attendee who never got the mail is not told about a cancellation of a
--   meeting they never heard of.
-- ⚠ ONE OUTBOX ROW PER PERSON — the mailer has no Cc.
-- ⚠ MAIL OFF ⇒ NOTHING QUEUED AND NOTHING STAMPED. See the header.
-- ---------------------------------------------------------------------------
create or replace function public.fms_ld_queue_training_mail(
  p_session_id   uuid,
  p_kind         text,
  p_employee_ids uuid[] default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.fms_ld_sessions%rowtype;
  v_on boolean := false;
  v_payload jsonb;
  v_n integer := 0;
  v_email text;
  v_org_name text;
  v_org_email text;
  rec record;
begin
  if p_kind not in ('invite','updated','cancelled') then
    raise exception 'Unknown training mail %', p_kind;
  end if;
  begin v_on := public.email_module_enabled('learning-development');
  exception when others then v_on := false; end;
  if not v_on then return 0; end if;

  select * into s from public.fms_ld_sessions where id = p_session_id;
  if s.id is null then return 0; end if;

  select p.name, coalesce(nullif(btrim(p.email), ''), (select u.email from auth.users u where u.id = p.id))
    into v_org_name, v_org_email
    from public.profiles p where p.id = coalesce(auth.uid(), s.created_by);

  v_payload := jsonb_build_object(
    'session_id',  s.id,
    'code',        s.code,
    'title',       s.title,
    'category',    s.category,
    'date',        s.session_date,
    'start',       to_char(s.start_time, 'HH24:MI'),
    'end',         to_char(s.end_time, 'HH24:MI'),
    'hours',       s.hours,
    'trainer',     public.fms_ld_trainer_label(s.id),
    'teams_link',  s.meeting_link,
    'description', s.description,
    'reason',      s.change_reason,
    'organiser',   v_org_name,
    'organiser_email', v_org_email,
    'sequence',    s.ics_sequence,
    'path',        '/learning-development/sessions/' || s.id
  );

  for rec in
    select n.id as nom_id, n.employee_id, p.name,
           coalesce(nullif(btrim(p.email), ''),
                    (select nullif(btrim(u.email), '') from auth.users u where u.id = p.id)) as email
      from public.fms_ld_nominations n
      join public.profiles p on p.id = n.employee_id
     where n.session_id = p_session_id
       and n.status = 'approved'
       and (p_employee_ids is null or n.employee_id = any(p_employee_ids))
       and case p_kind
             when 'invite'    then n.invited_at is not null and n.invite_mailed_at is null
             else                  n.invite_mailed_at is not null
           end
  loop
    v_email := rec.email;
    continue when v_email is null;
    begin
      insert into public.email_outbox (kind, to_user_id, to_email, to_name, actor_id, entity_id, payload)
      values ('learning-development_training_' || p_kind, rec.employee_id, v_email, rec.name,
              auth.uid(), p_session_id, v_payload);
      if p_kind in ('invite','updated') then
        update public.fms_ld_nominations set invite_mailed_at = coalesce(invite_mailed_at, now())
         where id = rec.nom_id;
      end if;
      v_n := v_n + 1;
    exception when others then null;   -- a mail problem never undoes the training write
    end;
  end loop;

  if v_n > 0 then
    if p_kind = 'invite' then
      update public.fms_ld_sessions set invite_mail_sent_at = coalesce(invite_mail_sent_at, now())
       where id = p_session_id;
    elsif p_kind = 'cancelled' and p_employee_ids is null then
      update public.fms_ld_sessions set cancel_mail_sent_at = now() where id = p_session_id;
    end if;
  end if;
  return v_n;
end $$;
revoke all on function public.fms_ld_queue_training_mail(uuid, text, uuid[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Save one calendar training (add or edit)
--
-- p_payload: { id?, title, category, session_date, start_time, end_time,
--   teams_link, description?, trainer_user_id?, trainer_id?,
--   external_trainer_name?, session_type_ids?, attendee_ids: [uuid] }
-- ---------------------------------------------------------------------------
create or replace function public.fms_ld_save_calendar_session(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_id    uuid := nullif(p_payload->>'id', '')::uuid;
  v_old   public.fms_ld_sessions%rowtype;
  v_cat   text := lower(btrim(coalesce(p_payload->>'category', '')));
  v_title text := btrim(coalesce(p_payload->>'title', ''));
  v_date  date := nullif(p_payload->>'session_date', '')::date;
  v_start time := nullif(p_payload->>'start_time', '')::time;
  v_end   time := nullif(p_payload->>'end_time', '')::time;
  v_link  text := nullif(btrim(coalesce(p_payload->>'teams_link', '')), '');
  v_tuser uuid := nullif(p_payload->>'trainer_user_id', '')::uuid;
  v_tid   uuid := nullif(p_payload->>'trainer_id', '')::uuid;
  v_text  text := nullif(btrim(coalesce(p_payload->>'external_trainer_name', '')), '');
  v_hours numeric;
  v_want  uuid[];
  v_have  uuid[];
  v_added uuid[];
  v_gone  uuid[];
  v_bad   integer;
  v_changed boolean := false;
  v_code  text;
  v_today date := public.fms_ld_now_ist()::date;
begin
  if not public.fms_ld_can_manage_calendar(v_uid) then
    raise exception 'You do not have the right to manage the training calendar';
  end if;

  if v_title = '' then raise exception 'A training title is required'; end if;
  if v_cat not in ('internal','external') then raise exception 'Category must be Internal or External'; end if;
  if v_date is null then raise exception 'A training date is required'; end if;
  if v_start is null or v_end is null then raise exception 'Start and end time are required'; end if;
  if v_end <= v_start then raise exception 'End time must be after the start time'; end if;
  -- Optional, but when given it must be a Teams link (requirement 5).
  if v_link is not null and not public.fms_ld_is_teams_link(v_link) then
    raise exception 'The joining link must be a Microsoft Teams meeting link (https://teams.microsoft.com/…)';
  end if;
  if v_cat = 'internal' then
    v_tid := null; v_text := null;
    if v_tuser is not null and not exists (select 1 from public.profiles where id = v_tuser) then
      raise exception 'Internal trainer not found';
    end if;
  else
    v_tuser := null;
    if v_tid is not null and not exists (select 1 from public.fms_ld_trainers where id = v_tid) then
      raise exception 'External trainer not found';
    end if;
  end if;
  v_hours := round(extract(epoch from (v_end - v_start)) / 3600.0, 2);

  -- Attendees: Orange Hub staff only (no customer logins), de-duplicated.
  select coalesce(array_agg(distinct x::uuid), '{}'::uuid[]) into v_want
    from jsonb_array_elements_text(coalesce(p_payload->'attendee_ids', '[]'::jsonb)) t(x)
   where nullif(x, '') is not null;
  if coalesce(array_length(v_want, 1), 0) = 0 then
    raise exception 'Add at least one attendee';
  end if;
  select count(*) into v_bad from unnest(v_want) a(id)
   where not exists (select 1 from public.profiles p
                      where p.id = a.id and coalesce(p.is_external, false) = false);
  if v_bad > 0 then raise exception '% attendee(s) are not Orange Hub staff users', v_bad; end if;

  if v_id is null then
    v_code := 'TRS-' || public.fms_ld_fy_code(v_date) || '-' ||
              lpad(public.fms_ld_next_seq('session:' || public.fms_ld_fy_code(v_date))::text, 4, '0');
    insert into public.fms_ld_sessions (
      code, source, category, title, description, session_type_ids, delivery_mode,
      trainer_id, trainer_user_id, external_trainer_name,
      session_date, start_time, end_time, hours, meeting_link, status, created_by
    ) values (
      v_code, 'calendar', v_cat, v_title, nullif(btrim(coalesce(p_payload->>'description', '')), ''),
      coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(
         coalesce(p_payload->'session_type_ids', '[]'::jsonb)) t(x)), '{}'::uuid[]),
      'online', v_tid, v_tuser, v_text,
      v_date, v_start, v_end, v_hours, v_link, 'scheduled', v_uid
    ) returning id into v_id;
    v_have := '{}';
  else
    select * into v_old from public.fms_ld_sessions where id = v_id for update;
    if v_old.id is null then raise exception 'Training not found'; end if;
    if v_old.source <> 'calendar' then
      raise exception 'Only trainings added on the calendar can be edited here';
    end if;
    if v_old.cancelled_at is not null or v_old.status = 'cancelled' then
      raise exception 'This training is cancelled';
    end if;
    if v_old.completed_at is not null then
      raise exception 'This training is already completed';
    end if;

    v_changed := v_old.session_date is distinct from v_date
              or v_old.start_time   is distinct from v_start
              or v_old.end_time     is distinct from v_end
              or v_old.meeting_link is distinct from v_link
              or v_old.title        is distinct from v_title;

    update public.fms_ld_sessions
       set category = v_cat, title = v_title,
           description = nullif(btrim(coalesce(p_payload->>'description', '')), ''),
           session_type_ids = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(
              coalesce(p_payload->'session_type_ids', '[]'::jsonb)) t(x)), '{}'::uuid[]),
           trainer_id = v_tid, trainer_user_id = v_tuser, external_trainer_name = v_text,
           session_date = v_date, start_time = v_start, end_time = v_end, hours = v_hours,
           meeting_link = v_link,
           ics_sequence = ics_sequence + case when v_changed then 1 else 0 end
     where id = v_id;

    select coalesce(array_agg(employee_id), '{}'::uuid[]) into v_have
      from public.fms_ld_nominations where session_id = v_id and status = 'approved';
  end if;

  select coalesce(array_agg(a), '{}'::uuid[]) into v_added from unnest(v_want) a where not (a = any(v_have));
  select coalesce(array_agg(a), '{}'::uuid[]) into v_gone  from unnest(v_have) a where not (a = any(v_want));

  -- Removed attendees who already had the invite are told it is off for them,
  -- then their row goes (nothing hangs off it before the training is completed).
  if array_length(v_gone, 1) is not null then
    perform public.fms_ld_queue_training_mail(v_id, 'cancelled', v_gone);
    delete from public.fms_ld_nominations
     where session_id = v_id and employee_id = any(v_gone)
       and not exists (select 1 from public.fms_ld_attendance a
                        where a.session_id = v_id and a.employee_id = fms_ld_nominations.employee_id);
  end if;

  if array_length(v_added, 1) is not null then
    insert into public.fms_ld_nominations
      (session_id, employee_id, source, status, nominated_by, approved_by, approved_at,
       invited_at, rsvp, rsvp_at)
    select v_id, a, 'hr', 'approved', v_uid, v_uid, now(), now(), 'accepted', now()
      from unnest(v_added) a
    on conflict (session_id, employee_id) do update
      set status = 'approved', approved_by = excluded.approved_by, approved_at = now(),
          invited_at = coalesce(fms_ld_nominations.invited_at, now()),
          rsvp = 'accepted', rsvp_at = now(), reject_reason = null;
    update public.fms_ld_sessions set invitations_sent_at = coalesce(invitations_sent_at, now())
     where id = v_id;

    perform public.fms_ld_announce('session', v_id, 'ld_calendar_added',
      'You are on a training: ' || v_title || ' — ' || to_char(v_date, 'DD-MM-YYYY') ||
      ' ' || to_char(v_start, 'HH24:MI'), v_added);
  end if;

  -- Date / time / link / title changed after people had the invite → "Updated".
  if v_changed then
    perform public.fms_ld_queue_training_mail(v_id, 'updated', null);
    perform public.fms_ld_announce('session', v_id, 'ld_calendar_updated',
      'Training updated: ' || v_title || ' — ' || to_char(v_date, 'DD-MM-YYYY') ||
      ' ' || to_char(v_start, 'HH24:MI'),
      (select coalesce(array_agg(employee_id), '{}'::uuid[]) from public.fms_ld_nominations
        where session_id = v_id and status = 'approved'));
  end if;

  -- Inside the 3-day window already (D4): invite now — this also covers
  -- attendees added after the invite went out, since only the un-mailed qualify.
  if v_date >= v_today and v_date <= v_today + 3 then
    perform public.fms_ld_queue_training_mail(v_id, 'invite', null);
  end if;

  return v_id;
end $$;
grant execute on function public.fms_ld_save_calendar_session(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Bulk upload — all rows or none. A bad row names its own row number.
-- p_rows: [ {…same shape as above…, row_no} ]
-- ---------------------------------------------------------------------------
create or replace function public.fms_ld_bulk_save_calendar(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  i integer := 0;
  v_ids uuid[] := '{}';
  v_msg text;
begin
  if not public.fms_ld_can_manage_calendar(auth.uid()) then
    raise exception 'You do not have the right to manage the training calendar';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Nothing to upload';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception 'Upload at most 500 trainings at a time';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    begin
      v_ids := v_ids || public.fms_ld_save_calendar_session(r - 'id');
    exception when others then
      get stacked diagnostics v_msg = message_text;
      raise exception 'Row %: %', coalesce(r->>'row_no', i::text), v_msg;
    end;
  end loop;

  return jsonb_build_object('created', coalesce(array_length(v_ids, 1), 0), 'ids', to_jsonb(v_ids));
end $$;
grant execute on function public.fms_ld_bulk_save_calendar(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Cancel (requirement 4)
-- ---------------------------------------------------------------------------
create or replace function public.fms_ld_cancel_session(p_session_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  s public.fms_ld_sessions%rowtype;
  v_mailed integer := 0;
  v_ids uuid[];
begin
  select * into s from public.fms_ld_sessions where id = p_session_id for update;
  if s.id is null then raise exception 'Training not found'; end if;
  if not (public.fms_ld_can_manage_calendar(v_uid)
          or public.fms_ld_can_act_session('conducted', p_session_id, v_uid)) then
    raise exception 'You do not have the right to cancel this training';
  end if;
  if s.status = 'cancelled' or s.cancelled_at is not null then
    raise exception 'This training is already cancelled';
  end if;
  if s.completed_at is not null or s.attendance_closed_at is not null
     or s.status in ('conducted','attendance_closed','in_review','closed') then
    raise exception 'This training has already run and cannot be cancelled';
  end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required to cancel'; end if;

  update public.fms_ld_sessions
     set status = 'cancelled', outcome = 'cancelled', change_reason = btrim(p_reason),
         cancelled_at = now(), cancelled_by = v_uid, ics_sequence = ics_sequence + 1
   where id = p_session_id;

  -- Only if the invite already went to somebody.
  if exists (select 1 from public.fms_ld_nominations
              where session_id = p_session_id and invite_mailed_at is not null) then
    v_mailed := public.fms_ld_queue_training_mail(p_session_id, 'cancelled', null);
  end if;

  select coalesce(array_agg(employee_id), '{}'::uuid[]) into v_ids
    from public.fms_ld_nominations where session_id = p_session_id and status = 'approved';
  perform public.fms_ld_announce('session', p_session_id, 'ld_session_cancelled',
    'Training cancelled: ' || s.title || ' — ' || btrim(p_reason), v_ids);

  return jsonb_build_object('cancel_mails', v_mailed);
end $$;
grant execute on function public.fms_ld_cancel_session(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Complete + Present/Absent (requirement 5)
-- p_rows: [{employee_id, status: 'present'|'absent'}] — one per attendee.
--
-- ⚠ NO 30-DAY HOD TASKS ARE CREATED HERE (D7: optional for calendar
--   trainings). fms_ld_close_attendance still does that for request-born ones.
-- ---------------------------------------------------------------------------
create or replace function public.fms_ld_complete_session(p_session_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  s public.fms_ld_sessions%rowtype;
  v_internal_trainer uuid;
  r jsonb;
  v_emp uuid;
  v_st text;
  v_missing integer;
  v_present integer := 0;
  v_absent integer := 0;
begin
  select * into s from public.fms_ld_sessions where id = p_session_id for update;
  if s.id is null then raise exception 'Training not found'; end if;

  select t.employee_id into v_internal_trainer
    from public.fms_ld_trainers t where t.id = s.trainer_id and t.trainer_type = 'internal';
  if not (public.fms_ld_can_manage_calendar(v_uid)
          or (s.trainer_user_id is not null and s.trainer_user_id = v_uid)
          or (v_internal_trainer is not null and v_internal_trainer = v_uid)
          or public.fms_ld_can_act_session('attendance', p_session_id, v_uid)) then
    raise exception 'Only the trainer or a calendar manager can complete this training';
  end if;
  if s.status = 'cancelled' or s.cancelled_at is not null then
    raise exception 'This training was cancelled';
  end if;
  if s.completed_at is not null or s.attendance_closed_at is not null then
    raise exception 'This training is already completed';
  end if;
  if public.fms_ld_now_ist() < (s.session_date + coalesce(s.start_time, time '00:00')) then
    raise exception 'The training has not started yet';
  end if;

  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_emp := (r->>'employee_id')::uuid;
    v_st  := r->>'status';
    if v_st not in ('present','absent') then raise exception 'Mark each attendee Present or Absent'; end if;
    if not exists (select 1 from public.fms_ld_nominations
                    where session_id = p_session_id and employee_id = v_emp and status = 'approved') then
      raise exception 'Somebody marked is not an attendee of this training';
    end if;
    insert into public.fms_ld_attendance (session_id, employee_id, status, minutes, marked_by)
    values (p_session_id, v_emp, v_st, null, v_uid)
    on conflict (session_id, employee_id) do update
      set status = excluded.status, minutes = null, marked_by = excluded.marked_by, marked_at = now();
    if v_st = 'present' then v_present := v_present + 1; else v_absent := v_absent + 1; end if;
  end loop;

  select count(*) into v_missing
    from public.fms_ld_nominations n
   where n.session_id = p_session_id and n.status = 'approved'
     and not exists (select 1 from public.fms_ld_attendance a
                      where a.session_id = n.session_id and a.employee_id = n.employee_id);
  if v_missing > 0 then
    raise exception '% attendee(s) are not marked Present or Absent', v_missing;
  end if;

  update public.fms_ld_sessions
     set outcome = 'conducted', status = 'attendance_closed', trainer_attended = true,
         actual_start = (s.session_date + s.start_time) at time zone 'Asia/Kolkata',
         actual_end   = (s.session_date + s.end_time)   at time zone 'Asia/Kolkata',
         attendance_closed_at = now(), completed_at = now(), completed_by = v_uid
   where id = p_session_id;

  perform public.fms_ld_announce('session', p_session_id, 'ld_session_completed',
    'Training completed: ' || s.title || ' — ' || v_present || ' present, ' || v_absent || ' absent',
    '{}'::uuid[]);

  return jsonb_build_object('present', v_present, 'absent', v_absent);
end $$;
grant execute on function public.fms_ld_complete_session(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Daily sender — 3 days before (requirement 3)
--
-- Every live training dated today … today+3 (IST) with an attendee who has not
-- had the invite yet. "today" is in the window so a run missed for a day still
-- catches up; dedup is the per-attendee invite_mailed_at stamp.
-- ---------------------------------------------------------------------------
create or replace function public.fms_ld_send_due_training_mails(
  p_date date default (now() at time zone 'Asia/Kolkata')::date
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer := 0;
  rec record;
begin
  if auth.uid() is not null and not public.is_admin(auth.uid()) then
    raise exception 'Not authorized';
  end if;
  for rec in
    select s.id from public.fms_ld_sessions s
     where s.session_date between p_date and p_date + 3
       and s.status not in ('cancelled','rescheduled','attendance_closed','in_review','closed')
       and s.completed_at is null and s.cancelled_at is null
       and exists (select 1 from public.fms_ld_nominations n
                    where n.session_id = s.id and n.status = 'approved'
                      and n.invited_at is not null and n.invite_mailed_at is null)
  loop
    v_n := v_n + public.fms_ld_queue_training_mail(rec.id, 'invite', null);
  end loop;
  return v_n;
end $$;
comment on function public.fms_ld_send_due_training_mails(date) is
  'Queues the Teams-style invitation mail for every training 0–3 days away whose attendees have not had it. Run daily by cron ld-training-mails (09:00 IST). No-op while email_module_settings(learning-development) is off.';
revoke all on function public.fms_ld_send_due_training_mails(date) from public, anon, authenticated;

-- cron is UTC: 03:30 UTC = 09:00 IST. Re-runnable (replaces by name).
do $cron$
begin
  if exists (select 1 from cron.job where jobname = 'ld-training-mails') then
    perform cron.unschedule('ld-training-mails');
  end if;
  perform cron.schedule(
    'ld-training-mails',
    '30 3 * * *',
    $job$set local statement_timeout = '110s'; select public.fms_ld_send_due_training_mails();$job$
  );
end $cron$;

-- ---------------------------------------------------------------------------
-- 10. Verify, inside the transaction
-- ---------------------------------------------------------------------------
do $verify$
begin
  if not exists (select 1 from information_schema.columns
                  where table_name = 'fms_ld_sessions' and column_name = 'ics_sequence') then
    raise exception 'LD calendar: sessions columns missing';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_name = 'fms_ld_nominations' and column_name = 'invite_mailed_at') then
    raise exception 'LD calendar: nominations column missing';
  end if;
  if not public.fms_ld_is_teams_link('https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0')
     or public.fms_ld_is_teams_link('https://meet.google.com/abc-defg-hij')
     or public.fms_ld_is_teams_link('https://teams.microsoft.com.evil.com/x') then
    raise exception 'LD calendar: Teams link check is wrong';
  end if;
  if (select (value->>'hours_per_head_year')::int from public.fms_ld_config where key = 'targets') <> 24 then
    raise exception 'LD calendar: hours target not 24';
  end if;
  if not exists (select 1 from cron.job where jobname = 'ld-training-mails') then
    raise exception 'LD calendar: cron job not scheduled';
  end if;
end $verify$;

commit;
