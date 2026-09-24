-- ROLLBACK for 20261130120000_pf18_announcements.sql (PF-18 · announcements).
--
-- Removes only what that migration added. No existing table, column or row is touched.
-- ⚠ It DELETES every announcement and every dismissal. Take a copy of public.announcements
--   first if the history matters.
-- Left in place on purpose:
--   • email_outbox rows of kind 'announcement' — they are the record of mail actually sent.
--   • app_access rows for 'announcements' — harmless without the module, and they mean the
--     same thing again if this is re-applied.
-- Roll the frontend back FIRST (or at the same time): the strip calls announcements_active()
-- on every screen, and would log an error on each one once the function is gone.

drop function if exists public.announcement_dismiss(uuid);
drop function if exists public.announcement_end(uuid);
drop function if exists public.announcement_update(uuid, text, text, text, date);
drop function if exists public.announcement_publish(text, text, text, date, text[], boolean);
drop function if exists public.announcement_recipient_count(text[]);
drop function if exists public.announcements_manage();
drop function if exists public.announcements_history();
drop function if exists public.announcements_active();

drop function if exists public.announcement_status(timestamptz, timestamptz);
drop function if exists public.announcement_check_end(date);
drop function if exists public.announcement_check_text(text, text, text);
drop function if exists public.announcement_ends_on(timestamptz);
drop function if exists public.announcement_ends_at(date);
drop function if exists public.in_announcement_audience(text[], uuid);
drop function if exists public.can_post_announcements(uuid);
drop function if exists public.announcement_modules_norm(text[]);

drop table if exists public.announcement_dismissals;
drop table if exists public.announcements;

delete from public.email_module_settings where module_id = 'announcements';

do $check$
begin
  if to_regclass('public.announcements') is not null or to_regclass('public.announcement_dismissals') is not null then
    raise exception 'PF-18 rollback: a table is still there';
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and (p.proname like 'announcement%' or p.proname in ('can_post_announcements', 'in_announcement_audience'))) then
    raise exception 'PF-18 rollback: a function is still there';
  end if;
end $check$;
