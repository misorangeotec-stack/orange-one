-- ===========================================================================
-- MASTER REPORT — put the user-access data in the email payload too.
--
-- WHY
--   Section 2 (who can open what) was PDF-and-screen only, so the mail stopped
--   after the module summary. Reading the mail on a phone, that looks like the
--   report is half missing rather than deliberately short.
--
--   The mail cannot reproduce the 57 x 16 grid — sixteen columns is unreadable
--   in any mail client — so send-email renders a per-user digest instead:
--   department, role, last sign-in, and how many modules they hold. The full
--   grid stays in the PDF, where it has the width for it.
--
-- ⚠ COMPUTED SERVER-SIDE, like the snapshot. A client chooses WHO to mail; it
--   cannot post a fabricated access list to a director.
--
-- ⚠ master_report_access_matrix() lets a NULL auth.uid() through — that is the
--   trusted server path, and it is what makes this work under pg_cron, which
--   has no session user.
--
-- Reversal: re-apply the two function bodies from 20260830120100 / 20260830120700.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The daily cron send.
-- ---------------------------------------------------------------------------
create or replace function public.master_report_enqueue_daily(p_for_date date default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date     date := coalesce(p_for_date, (now() at time zone 'Asia/Kolkata')::date);
  v_enabled  boolean;
  v_snapshot jsonb;
  v_access   jsonb;
  v_count    int := 0;
  r          record;
begin
  select s.enabled into v_enabled from public.master_report_settings s where s.id;
  if not coalesce(v_enabled, false) then
    return 0;
  end if;

  if not public.email_module_enabled('master-report') then
    return 0;
  end if;

  if exists (select 1 from public.master_report_send_log l where l.sent_for_date = v_date) then
    return 0;
  end if;

  v_snapshot := public.master_report_snapshot(30);
  v_access   := public.master_report_access_matrix();

  for r in
    select coalesce(nullif(btrim(p.email), ''), rec.email) as email,
           coalesce(p.name, rec.name)                      as name
      from public.master_report_recipients rec
      left join public.profiles p on p.id = rec.user_id
     where rec.enabled
     order by 1
  loop
    if nullif(btrim(coalesce(r.email, '')), '') is null then
      continue;
    end if;

    insert into public.email_outbox (kind, to_email, to_name, subject, payload)
    values (
      'master_report_daily',
      r.email,
      r.name,
      'Orange One — module snapshot, ' || to_char(v_date, 'DD Mon YYYY'),
      jsonb_build_object(
        'snapshot',    v_snapshot,
        'access',      v_access,
        'for_date',    v_date,
        'attachments', '[]'::jsonb
      )
    );
    v_count := v_count + 1;
  end loop;

  if v_count > 0 then
    insert into public.master_report_send_log (sent_for_date, recipient_count)
    values (v_date, v_count)
    on conflict (sent_for_date) do nothing;
  end if;

  return v_count;
end $$;

revoke all on function public.master_report_enqueue_daily(date) from public, anon;

-- ---------------------------------------------------------------------------
-- 2. The "email this now" door. Only the payload changes; every check,
--    including the attachment-path ownership loop, is untouched.
-- ---------------------------------------------------------------------------
do $do$
declare
  v_src text;
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'queue_master_report_email';

  if v_src is null then
    raise exception 'queue_master_report_email not found';
  end if;

  -- Rewrite in place: declare the extra variable, fill it beside the snapshot,
  -- and add it to the payload. Doing it textually keeps the security checks
  -- byte-identical rather than restating them and risking a divergence.
  v_src := replace(v_src,
    '  v_snapshot jsonb;',
    '  v_snapshot jsonb;' || chr(10) || '  v_access   jsonb;');
  v_src := replace(v_src,
    '  v_snapshot := public.master_report_snapshot(30);',
    '  v_snapshot := public.master_report_snapshot(30);' || chr(10)
      || '  v_access   := public.master_report_access_matrix();');
  v_src := replace(v_src,
    '      ''snapshot'',    v_snapshot,',
    '      ''snapshot'',    v_snapshot,' || chr(10) || '      ''access'',      v_access,');

  if position('v_access   := public.master_report_access_matrix();' in v_src) = 0
     or position('''access'',      v_access,' in v_src) = 0 then
    raise exception 'could not patch queue_master_report_email — its body has changed shape';
  end if;

  execute v_src;
end $do$;
