-- ===========================================================================
-- HELP DESK FMS — EMAIL, AND THE PLATFORM REGISTRATIONS (HD-11).
--
-- Three things:
--   1. email_module_settings — the kill switch, installed OFF.
--   2. master_report_modules — the director's adoption report, installed ON
--      (fms_help_tickets exists now; see the ⚠ below for why that matters).
--   3. fms_help_announce is re-issued to ALSO drop an `email_outbox` row per
--      recipient, gated on that switch.
--
-- ⚠⚠ THE MAIL WILL NOT ACTUALLY SEND YET, AND THAT IS NOT A BUG IN THIS FILE.
--
--    `supabase/functions/send-email/index.ts` carries a HARD-CODED list of
--    module prefixes, and a kind matching none of them falls through to
--    `markSkipped(row, "unknown kind …")`. It does not error, it does not retry,
--    and the outbox row looks handled — so a module can queue mail correctly and
--    deliver nothing with no failure anywhere to notice. PF-18's announcements
--    hit exactly this.
--
--    The prefix edit is in this branch. THE DEPLOY IS NOT DONE, deliberately:
--    that file is shared by every module and the copies on `master` and
--    `daily-reports` disagree by ~115 lines, so deploying from here would ship
--    another session's unfinished mailer. Checked 28-09-2026 — the DEPLOYED copy
--    knows `complaint_` but not `travel_`, not `learning-development_` and not
--    `help-desk_`, so Travel Desk and L&D are in the same state. All three have
--    email OFF, so nothing is being lost today.
--
--    Reconciling those copies and deploying deliberately is the remaining work,
--    and it is not this module's to do alone.
--
-- ⚠ INSTALLED OFF. A module that starts mailing the day it deploys tells people
--   about a process they have not been trained on. Turning it on is a decision,
--   made in Setup, after HR have used the desk.
--
-- ⚠ THE MAILER HAS NO Cc AND NO Bcc. `buildRaw()` composes From / To / Reply-To
--   / Subject only, and `email_outbox` has no column for one. Several recipients
--   means ONE ROW EACH, which is what the loop below does.
--
-- ⚠ AN EMAIL FAILURE MUST NEVER ROLL BACK THE WORK IT REPORTS. Every outbox
--   insert is wrapped: a mail problem cannot undo a resolution.
--
-- ⚠ THE MASTER REPORT ROW GOES IN ENABLED, and that is only safe because
--   fms_help_tickets already exists. `master_report_snapshot()` builds dynamic
--   SQL over `head_table` for every enabled row, so an enabled row pointing at a
--   missing table would break THE DIRECTOR'S DAILY REPORT for all fourteen other
--   modules. The assertion at the foot proves the table is there.
--
-- ⚠ `due_column` IS NULL, so this module reports `tracks_due = false` and
--   contributes nothing to the overdue total. Help Desk due dates are derived at
--   read time from the CATEGORY's TAT and five categories are deliberately
--   untimed — a zero here would read as "nothing is late" when the truth is "not
--   measurable from SQL".
--
-- Additive. Rollback: 20261225120000_hd11_help_desk_email_rollback.sql
-- ===========================================================================

do $pre$
begin
  if to_regclass('public.fms_help_tickets') is null then
    raise exception 'HD-11: apply the HD-2 migration first';
  end if;
  if to_regprocedure('public.email_module_enabled(text)') is null then
    raise exception 'HD-11: public.email_module_enabled(text) is missing';
  end if;
end $pre$;

begin;

-- 1. The kill switch. OFF.
insert into public.email_module_settings (module_id, enabled)
values ('help-desk', false)
on conflict (module_id) do nothing;

-- 2. The director's adoption report.
--
-- Anchored on `raised_at` — correct for an adoption report, whose question is
-- "did somebody use this today".
--
-- ⚠ closed_statuses IS A DENY-LIST: anything not named counts as OPEN, so a
--   status added later is never silently dropped from the report. `on_hold` is
--   NOT among them — a held ticket is still open, and hiding it is how a parked
--   one is never chased.
insert into public.master_report_modules
  (app_id, label, head_table, created_column, status_column, closed_statuses,
   extra_filter, activity_table, actor_column, detail_path, enabled, sort_order)
values
  ('help-desk', 'Help Desk', 'fms_help_tickets', 'raised_at', 'status',
   array['closed', 'cancelled'], null,
   'fms_help_activity', 'raised_by', '/help-desk/monitoring', true, 160)
on conflict (app_id) do nothing;

-- 3. Announce, now with email.
--
-- ⚠ THE BODY IS THE HD-1 ONE WITH AN EMAIL ARM ADDED. The bell behaviour is
--   unchanged, including "never notify the actor" and the de-duplication.
create or replace function public.fms_help_announce(
  p_entity_type text,
  p_entity_id   uuid,
  p_type        text,
  p_text        text,
  p_user_ids    uuid[] default '{}',
  p_meta        jsonb  default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_actor uuid := auth.uid();
  u uuid;
  seen uuid[] := '{}';
  v_email_on boolean := false;
  v_email text;
  v_ticket public.fms_help_tickets%rowtype;
  v_cat public.fms_help_categories%rowtype;
  v_payload jsonb;
begin
  insert into public.fms_help_activity (entity_type, entity_id, type, actor_id, note, meta)
  values (p_entity_type, p_entity_id, p_type, v_actor, nullif(p_text, ''), coalesce(p_meta, '{}'::jsonb));

  -- ⚠ TWO EVENT TYPES ARE BELL-ONLY, FOR DIFFERENT REASONS.
  --   `comment` — a remark mails only the people named in it, and the bell is
  --     enough for a running conversation; mailing every note turns the desk
  --     into a mailing list nobody reads.
  --   `help_ticket_access_granted` — it carries an EMPTY recipient list anyway,
  --     but it is named here so that stays true if somebody ever passes one: it
  --     is an audit line about a confidential ticket, and putting its existence
  --     in an inbox is the opposite of the point.
  begin
    v_email_on := public.email_module_enabled('help-desk')
                  and p_type not in ('comment', 'help_ticket_access_granted');
  exception when others then v_email_on := false;
  end;

  if v_email_on and p_entity_type = 'ticket' then
    begin
      select * into v_ticket from public.fms_help_tickets where id = p_entity_id;
      select * into v_cat from public.fms_help_categories where id = v_ticket.category_id;

      -- ⚠⚠ A CONFIDENTIAL TICKET NEVER MAILS ITS SUBJECT. An inbox is the least
      --   controlled place in the company — forwarded, searched, read on a
      --   shared phone — and the whole of decision D4 is that a grievance is
      --   readable only in the hub, by named people. So the mail says a ticket
      --   needs them and links to it; the complaint stays behind the gate.
      v_payload := jsonb_build_object(
        'ticket_no', v_ticket.ticket_no,
        'category',  case when v_cat.confidential then 'Confidential' else v_cat.name end,
        'subject',   case when v_cat.confidential then null else v_ticket.subject end,
        'text',      case when v_cat.confidential
                          then v_ticket.ticket_no || ' needs you. Open it in Orange One to read it.'
                          else p_text end,
        'confidential', coalesce(v_cat.confidential, false),
        'path',      '/help-desk/tickets/' || p_entity_id
      );
    exception when others then v_payload := null;
    end;
  end if;

  if p_user_ids is not null then
    foreach u in array p_user_ids loop
      -- Never notify the person who just did the thing, and never twice.
      if u is null or u = any(seen) or u = v_actor then continue; end if;
      seen := seen || u;
      insert into public.fms_help_notifications (user_id, type, entity_type, entity_id, text, actor_id)
      values (u, p_type, p_entity_type, p_entity_id, p_text, v_actor);

      /* One outbox row per recipient — the mailer has no Cc. Isolated so a mail
         problem can never roll back the work it is reporting: a failed insert
         must not undo a resolution. */
      if v_email_on and v_payload is not null then
        begin
          v_email := coalesce(
            (select nullif(btrim(p.email), '') from public.profiles p where p.id = u),
            (select nullif(btrim(au.email), '') from auth.users au where au.id = u)
          );
          if v_email is not null then
            insert into public.email_outbox (kind, to_user_id, to_email, actor_id, entity_id, payload)
            values ('help-desk_' || p_type, u, v_email, v_actor, p_entity_id, v_payload);
          end if;
        exception when others then null;
        end;
      end if;
    end loop;
  end if;
end $fn$;

comment on function public.fms_help_announce(text, uuid, text, text, uuid[], jsonb) is
  'Record one Help Desk event: an activity row always, one notification per recipient, and - when email_module_enabled(''help-desk'') - one email_outbox row per recipient (the mailer has no Cc). Skips the actor and de-duplicates. A CONFIDENTIAL ticket never mails its subject: the mail says it needs you and links to it.';
grant execute on function public.fms_help_announce(text, uuid, text, text, uuid[], jsonb) to authenticated;


-- ── verification, inside the transaction ────────────────────────────────────
do $mig$
declare v_on boolean; v_n int;
begin
  select enabled into v_on from public.email_module_settings where module_id = 'help-desk';
  if v_on is null then
    raise exception 'HD-11: Help Desk did not register with the email gate';
  end if;
  if v_on then
    raise exception 'HD-11: Help Desk email installed ON; it must install OFF';
  end if;

  select count(*) into v_n from public.master_report_modules where app_id = 'help-desk';
  if v_n <> 1 then
    raise exception 'HD-11: Help Desk did not register with the Master Report';
  end if;

  -- ⚠ THE GUARD THAT MATTERS: an enabled row pointing at a table that does not
  --   exist breaks the snapshot for every other module.
  if exists (
    select 1 from public.master_report_modules m
     where m.enabled and to_regclass('public.' || m.head_table) is null
  ) then
    raise exception 'HD-11: a master_report_modules row is enabled but its head_table is missing';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'fms\_help\_%'
       and p.prosrc like '%module_can_edit%'
  ) then
    raise exception 'HD-11: a fms_help_* function gates on module_can_edit — help-desk is universal';
  end if;
end $mig$;

commit;
