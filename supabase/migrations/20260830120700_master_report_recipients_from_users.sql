-- ===========================================================================
-- MASTER REPORT — pick recipients from the user master, not by typing an email.
--
-- WHY
--   Recipients were free-typed addresses. Two problems with that:
--     · a typo mails nobody, silently, forever — the outbox reports a send;
--     · when someone's address changes in Users, the report keeps mailing the
--       old one, because the copy here never hears about it.
--   Directors are already users in this portal, so the user master is the
--   source of truth for how to reach them.
--
-- HOW
--   `user_id` is added NULLABLE and the send resolves the address from
--   `profiles` when it is set, falling back to the stored `email` when it is
--   not. So existing rows keep working unchanged, and an external address (a
--   personal mailbox, an auditor) is still expressible — it simply has no
--   user_id.
--
-- ⚠ `email` STAYS NOT NULL AND STAYS UNIQUE. It is still what a fallback send
--   uses, and it is what stops the same person being added twice. For a
--   user-backed row it is a snapshot written at save time; the LIVE address
--   from profiles is what actually gets mailed.
--
-- Reversal:
--   alter table public.master_report_recipients drop column if exists user_id;
--   (then re-apply set_master_report_recipients and master_report_enqueue_daily
--    from 20260830120000 / 20260830120200)
-- ===========================================================================

alter table public.master_report_recipients
  add column if not exists user_id uuid references public.profiles(id) on delete cascade;

comment on column public.master_report_recipients.user_id is
  'The portal user this recipient IS, when they are one. The daily send reads their live address from profiles, so changing it in Users follows through here. Null means an external address that is not a user.';

create index if not exists master_report_recipients_user_idx
  on public.master_report_recipients (user_id);

-- ---------------------------------------------------------------------------
-- Save: carries user_id through.
-- ---------------------------------------------------------------------------
create or replace function public.set_master_report_recipients(p_recipients jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r       jsonb;
  v_uid   uuid;
  v_email text;
  v_name  text;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin only';
  end if;

  delete from public.master_report_recipients;

  for r in select * from jsonb_array_elements(coalesce(p_recipients, '[]'::jsonb))
  loop
    v_uid := nullif(btrim(coalesce(r ->> 'user_id', '')), '')::uuid;

    -- For a user-backed row, take the address from the user master rather than
    -- from whatever the browser posted: the client should not be able to point
    -- a named person's row at someone else's mailbox.
    if v_uid is not null then
      select lower(btrim(p.email)), p.name into v_email, v_name
        from public.profiles p where p.id = v_uid;
    else
      v_email := lower(nullif(btrim(coalesce(r ->> 'email', '')), ''));
      v_name  := nullif(btrim(coalesce(r ->> 'name', '')), '');
    end if;

    -- A user with no address on file cannot be a recipient. Skipping is right:
    -- inserting a null-email row would be a recipient that silently never sends.
    if v_email is null then
      continue;
    end if;

    insert into public.master_report_recipients (email, name, enabled, user_id)
    values (v_email, v_name, coalesce((r ->> 'enabled')::boolean, true), v_uid)
    on conflict (email) do update
      set name = excluded.name, enabled = excluded.enabled, user_id = excluded.user_id;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Send: resolve the LIVE address for user-backed recipients.
--
-- Same body as 20260830120200 except the recipient loop, which now joins
-- profiles. A user whose address was cleared in Users is skipped rather than
-- mailed at a stale one.
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
