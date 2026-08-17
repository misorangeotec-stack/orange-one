-- ===========================================================================
-- Emailing a report is switched on PER REPORT, not per module.
--
-- WHY THIS REPLACES THE MODULE-WIDE SWITCH ADDED HOURS EARLIER (20260829120000)
--   The house convention is one email switch per module (email_module_settings)
--   and it is right for an FMS, where the mails are step notifications that
--   belong to the workflow as a whole. It is wrong for a report catalogue. The
--   Outstanding Dashboard carries ~30 reports of very different sensitivity, and
--   they will be given emailing one at a time. A single switch means turning on
--   "Customers with Zero Collections" also arms every future report the moment
--   its send path is written.
--
--   So the gate moves to the report's own catalogue id — the SAME id that
--   already decides who may open it (profiles.receivables_allowed_reports, see
--   lib/reportCatalog.ts). One vocabulary for "which report", used by both
--   access and emailing, so the two screens cannot drift.
--
-- ⚠ ONE GATE, DELIBERATELY, NOT TWO.
--   queue_report_email no longer consults email_module_enabled at all. Keeping a
--   module switch above the per-report ones would mean an admin switches a
--   report ON and nothing sends, with the reason on a different screen — exactly
--   the silent no-op that 20260829120000 exists to prevent. The
--   'outstanding-dashboard' row is left in place (harmless, and a future
--   non-report mail from this module may want it) but nothing reads it today.
--
-- ⚠ NO ROW MEANS OFF, AND NOTHING IS SEEDED.
--   Same polarity as the report grants: a new report reaches nobody, and mails
--   nobody, until an admin says so. This is also the hard stop the owner asked
--   for on 14-Aug-2026 — no report may mail a salesperson until they switch that
--   report on themselves. The asserts at the foot of this file fail the
--   migration if anything arrives switched on.
--
-- Additive: one new table, two new functions, one function signature widened.
--
-- Reversal:
--   drop function if exists public.queue_report_email(text, text, text, text, text, text, jsonb);
--   drop function if exists public.set_report_email_enabled(text, boolean);
--   drop function if exists public.report_email_enabled(text);
--   drop table if exists public.report_email_settings;
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The per-report switches
-- ---------------------------------------------------------------------------
create table if not exists public.report_email_settings (
  report_key text primary key,
  enabled    boolean     not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid        references auth.users(id) on delete set null
);

comment on table public.report_email_settings is
  'One row per report that may be emailed. report_key is the reportCatalog id (e.g. zero-collections). No row = off. Written only through set_report_email_enabled.';

alter table public.report_email_settings enable row level security;

-- Readable by any signed-in user, like email_module_settings: the export menu
-- needs to explain an inert Email action before somebody presses it. Writes go
-- through the SECURITY DEFINER function below, so there is no update policy.
drop policy if exists report_email_settings_read on public.report_email_settings;
create policy report_email_settings_read on public.report_email_settings
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 2. Read + write
-- ---------------------------------------------------------------------------
create or replace function public.report_email_enabled(p_report_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select enabled from public.report_email_settings where report_key = p_report_key),
    false
  );
$$;

comment on function public.report_email_enabled(text) is
  'Is this report allowed to be emailed? False when it has no row, so a new report is inert until an admin switches it on.';

create or replace function public.set_report_email_enabled(
  p_report_key text,
  p_enabled    boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;
  -- Admin only, re-checked here rather than trusted from the screen. This switch
  -- decides whether a report full of other people's customer balances can leave
  -- the building.
  if not public.is_admin(v_uid) then
    raise exception 'only an admin can change report emailing';
  end if;
  if nullif(btrim(coalesce(p_report_key, '')), '') is null then
    raise exception 'a report is required';
  end if;

  insert into public.report_email_settings (report_key, enabled, updated_at, updated_by)
  values (btrim(p_report_key), coalesce(p_enabled, false), now(), v_uid)
  on conflict (report_key) do update
     set enabled    = excluded.enabled,
         updated_at = now(),
         updated_by = excluded.updated_by;
end $$;

revoke all on function public.set_report_email_enabled(text, boolean) from public, anon;
grant execute on function public.set_report_email_enabled(text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The enqueue, now keyed on the report
-- ---------------------------------------------------------------------------
-- The old 6-argument form is DROPPED rather than left beside this one. Two
-- overloads would mean a caller that forgets the report key silently gets the
-- ungated version, which is the whole thing this migration is closing.
drop function if exists public.queue_report_email(text, text, text, text, text, jsonb);

create or replace function public.queue_report_email(
  p_report_key  text,
  p_to_email    text,
  p_to_name     text,
  p_subject     text,
  p_headline    text,
  p_body        text,
  p_attachments jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_full  boolean;
  v_att   jsonb;
  v_path  text;
  v_id    uuid;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  -- The same gate the UI applies (useHubMenuAccess().hasFullAccess('reports')),
  -- enforced here so it is an access control rather than a hidden button.
  select public.is_admin(v_uid)
         or coalesce('reports' = any(p.receivables_admin_menus), false)
    into v_full
    from public.profiles p
   where p.id = v_uid;

  if not coalesce(v_full, false) then
    raise exception 'you do not have full access to Reports';
  end if;

  if nullif(btrim(coalesce(p_report_key, '')), '') is null then
    raise exception 'a report is required';
  end if;

  -- THE switch. Raise rather than return quietly: the caller shows the admin
  -- which report to turn on, instead of reporting a success that never happened.
  if not public.report_email_enabled(p_report_key) then
    raise exception 'emailing is switched off for this report (%)', p_report_key;
  end if;

  if nullif(btrim(coalesce(p_to_email, '')), '') is null then
    raise exception 'a recipient address is required';
  end if;

  -- Every attachment must be the caller's own upload in this bucket, and must
  -- actually exist. Without the prefix check a caller could name any path in the
  -- bucket and have the service-role sender fetch it for them — the storage
  -- policy stops them WRITING elsewhere, not naming elsewhere.
  for v_att in select * from jsonb_array_elements(coalesce(p_attachments, '[]'::jsonb))
  loop
    v_path := v_att ->> 'path';
    if v_path is null or split_part(v_path, '/', 1) <> v_uid::text then
      raise exception 'attachment path % is not yours', coalesce(v_path, '(null)');
    end if;
    if not exists (
      select 1 from storage.objects o
       where o.bucket_id = 'report-exports' and o.name = v_path
    ) then
      raise exception 'attachment % was not uploaded', v_path;
    end if;
  end loop;

  insert into public.email_outbox (kind, to_user_id, to_email, to_name, actor_id, payload)
  values (
    'receivables_collections_report',
    null,                        -- an external or ad-hoc recipient; to_email is what the sender reads
    btrim(p_to_email),
    nullif(btrim(coalesce(p_to_name, '')), ''),
    v_uid,
    jsonb_build_object(
      'report_key',  btrim(p_report_key),
      'subject',     p_subject,
      'headline',    p_headline,
      'body',        p_body,
      'bucket',      'report-exports',
      'attachments', coalesce(p_attachments, '[]'::jsonb)
    )
  )
  returning id into v_id;

  return v_id;
end $$;

revoke all on function public.queue_report_email(text, text, text, text, text, text, jsonb) from public, anon;
grant execute on function public.queue_report_email(text, text, text, text, text, text, jsonb) to authenticated;

comment on function public.queue_report_email(text, text, text, text, text, text, jsonb) is
  'Queues one report email with attachments already uploaded to report-exports/<uid>/. Requires Reports full access and that report''s own switch in report_email_settings.';

-- ============================================================== asserts ====
do $check$
begin
  if to_regclass('public.report_email_settings') is null then
    raise exception 'report email: report_email_settings was not created';
  end if;

  -- The old ungated overload must be gone, or a stale caller keeps working.
  if to_regprocedure('public.queue_report_email(text,text,text,text,text,jsonb)') is not null then
    raise exception 'report email: the 6-argument queue_report_email still exists';
  end if;
  if to_regprocedure('public.queue_report_email(text,text,text,text,text,text,jsonb)') is null then
    raise exception 'report email: the report-keyed queue_report_email was not created';
  end if;

  if has_function_privilege('anon', 'public.set_report_email_enabled(text, boolean)', 'execute') then
    raise exception 'report email: anon can change the switches';
  end if;

  -- The hard stop. Nothing may arrive switched on.
  if exists (select 1 from public.report_email_settings where enabled) then
    raise exception 'report email: a report is already switched ON; every switch must start OFF';
  end if;

  if public.report_email_enabled('zero-collections') then
    raise exception 'report email: zero-collections reports as enabled with no row';
  end if;
end $check$;
