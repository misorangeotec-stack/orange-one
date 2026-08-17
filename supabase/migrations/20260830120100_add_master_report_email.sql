-- ===========================================================================
-- MASTER REPORT — the "email this snapshot now" door.
--
-- WHY THIS CANNOT REUSE public.queue_report_email (20260829120000)
--   That function hard-codes three receivables-specific things: the outbox kind
--   'receivables_collections_report', the 'outstanding-dashboard' module gate,
--   and a profiles.receivables_admin_menus check. All three are wrong here.
--   Everything else about it IS right, so this is a deliberate structural copy
--   — including the attachment-path ownership loop, which is the security-
--   critical part.
--
-- ⚠ THE ATTACHMENT PATH CHECK IS NOT OPTIONAL.
--   The storage policy stops a caller WRITING outside their own uid prefix; it
--   does not stop them NAMING someone else's path here and having the
--   service-role sender fetch it for them. Every path must start with the
--   caller's uid and must actually exist.
--
-- ⚠ THE NUMBERS ARE COMPUTED SERVER-SIDE, NOT ACCEPTED FROM THE CALLER.
--   The body of the mail is rendered by send-email from the snapshot this
--   function takes itself. A client can choose WHO to mail and attach its own
--   rendered PDF, but it cannot post fabricated counts to a director.
--
-- The kind is the same 'master_report_daily' the cron job uses, so send-email
-- needs one branch, not two. The manual send simply carries attachments and an
-- optional covering note; the automated one carries neither.
--
-- Reversal:
--   drop function if exists public.queue_master_report_email(text, text, text, text, jsonb);
-- ===========================================================================

create or replace function public.queue_master_report_email(
  p_to_email    text,
  p_to_name     text    default null,
  p_subject     text    default null,
  p_body        text    default null,
  p_attachments jsonb   default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_allowed  boolean;
  v_att      jsonb;
  v_path     text;
  v_snapshot jsonb;
  v_date     date := (now() at time zone 'Asia/Kolkata')::date;
  v_id       uuid;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  select public.is_admin(v_uid)
      or exists (select 1 from public.app_access a
                  where a.user_id = v_uid and a.app_id = 'master-report')
    into v_allowed;
  if not coalesce(v_allowed, false) then
    raise exception 'you do not have access to the Master Report';
  end if;

  -- Raise rather than return quietly, so the UI can tell an admin to go and
  -- switch it on instead of reporting a success that never happened.
  if not public.email_module_enabled('master-report') then
    raise exception 'email is switched off for the Master Report';
  end if;

  if nullif(btrim(coalesce(p_to_email, '')), '') is null then
    raise exception 'a recipient address is required';
  end if;

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

  v_snapshot := public.master_report_snapshot(30);

  insert into public.email_outbox (kind, to_user_id, to_email, to_name, actor_id, subject, payload)
  values (
    'master_report_daily',
    null,
    btrim(p_to_email),
    nullif(btrim(coalesce(p_to_name, '')), ''),
    v_uid,
    coalesce(nullif(btrim(coalesce(p_subject, '')), ''),
             'Orange One — module snapshot, ' || to_char(v_date, 'DD Mon YYYY')),
    jsonb_build_object(
      'snapshot',    v_snapshot,
      'for_date',    v_date,
      -- ALSO in the payload, not just the column: send-email composes the real
      -- subject from the payload and never reads email_outbox.subject, so a
      -- custom subject stored only in the column would be silently dropped.
      'subject',     nullif(btrim(coalesce(p_subject, '')), ''),
      'body',        nullif(btrim(coalesce(p_body, '')), ''),
      'bucket',      'report-exports',
      'attachments', coalesce(p_attachments, '[]'::jsonb)
    )
  )
  returning id into v_id;

  return v_id;
end $$;

revoke all on function public.queue_master_report_email(text, text, text, text, jsonb) from public, anon;
grant execute on function public.queue_master_report_email(text, text, text, text, jsonb) to authenticated;

comment on function public.queue_master_report_email(text, text, text, text, jsonb) is
  'Queues one Master Report email, optionally with a PDF already uploaded to report-exports/<uid>/. Counts are taken server-side, never accepted from the caller.';
