-- ===========================================================================
-- ROLLBACK for 20261225120000_hd11_help_desk_email.sql
--
-- ⚠ IT RESTORES HD-1'S fms_help_announce RATHER THAN DROPPING IT. Every RPC in
--   the module calls that function; dropping it would break raising, resolving,
--   replying and closing all at once. What comes back is HD-1's body — the bell
--   without the email arm.
--
-- ⚠ AND IT LEAVES THE master_report_modules ROW ALONE unless you ask for it.
--   Removing it drops Help Desk out of the director's daily adoption report,
--   which is a decision about a report other people read, not a side effect of
--   undoing an email change. The DELETE is below, commented, so it is a choice.
-- ===========================================================================

begin;

delete from public.email_module_settings where module_id = 'help-desk';

-- HD-1's version, verbatim.
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
as $$
declare
  v_actor uuid := auth.uid();
  u uuid;
  seen uuid[] := '{}';
begin
  insert into public.fms_help_activity (entity_type, entity_id, type, actor_id, note, meta)
  values (p_entity_type, p_entity_id, p_type, v_actor, nullif(p_text, ''), coalesce(p_meta, '{}'::jsonb));

  if p_user_ids is not null then
    foreach u in array p_user_ids loop
      if u is null or u = any(seen) or u = v_actor then continue; end if;
      seen := seen || u;
      insert into public.fms_help_notifications (user_id, type, entity_type, entity_id, text, actor_id)
      values (u, p_type, p_entity_type, p_entity_id, p_text, v_actor);
    end loop;
  end if;
end $$;

-- Uncomment deliberately, if Help Desk should also leave the adoption report:
-- delete from public.master_report_modules where app_id = 'help-desk';

do $rb$
begin
  if exists (select 1 from public.email_module_settings where module_id = 'help-desk') then
    raise exception 'rollback left the Help Desk email gate standing';
  end if;
  if to_regprocedure('public.fms_help_announce(text,uuid,text,text,uuid[],jsonb)') is null then
    raise exception 'rollback dropped fms_help_announce — every RPC in the module calls it';
  end if;
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'fms_help_announce') like '%email_outbox%' then
    raise exception 'rollback did not restore HD-1''s announce (it still queues email)';
  end if;
end $rb$;

commit;
