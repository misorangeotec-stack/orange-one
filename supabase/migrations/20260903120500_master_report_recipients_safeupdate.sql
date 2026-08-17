-- Saving Master Report recipients silently failed: "DELETE requires a WHERE clause".
--
-- Supabase preloads the `safeupdate` library for the `authenticator` role — the role
-- PostgREST connects as — so every DELETE/UPDATE arriving through the REST API must
-- carry a WHERE, including statements inside a SECURITY DEFINER function. safeupdate
-- is a session-level guard, not a privilege check, so SECURITY DEFINER does not lift it.
-- Run the same function from the SQL editor (role `postgres`) and it works, which is
-- exactly why this was invisible until an admin clicked Save in the browser.
--
-- The consequence was worse than a failed save. The settings screen saves in two steps:
--   1. saveMasterReportSettings()    -> succeeded, wrote enabled = true
--   2. saveMasterReportRecipients()  -> threw here
-- So the report was switched ON with an empty recipient table, and the screen read its
-- recipient count from unsaved local state — reporting "live, 1 recipient" while the
-- table held none. Nothing would have sent, with no error the next morning to say so.
--
-- `where true` satisfies safeupdate and is exactly equivalent to the bare DELETE.
-- Everything else in this body is unchanged.

create or replace function public.set_master_report_recipients(p_recipients jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r       jsonb;
  v_uid   uuid;
  v_email text;
  v_name  text;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin only';
  end if;

  -- `where true`: see the header. A bare DELETE is rejected for the API role.
  delete from public.master_report_recipients where true;

  for r in select * from jsonb_array_elements(coalesce(p_recipients, '[]'::jsonb))
  loop
    v_uid := nullif(btrim(coalesce(r ->> 'user_id', '')), '')::uuid;

    if v_uid is not null then
      select lower(btrim(p.email)), p.name into v_email, v_name
        from public.profiles p where p.id = v_uid;
    else
      v_email := lower(nullif(btrim(coalesce(r ->> 'email', '')), ''));
      v_name  := nullif(btrim(coalesce(r ->> 'name', '')), '');
    end if;

    if v_email is null then
      continue;
    end if;

    insert into public.master_report_recipients (email, name, enabled, user_id)
    values (v_email, v_name, coalesce((r ->> 'enabled')::boolean, true), v_uid)
    on conflict (email) do update
      set name = excluded.name, enabled = excluded.enabled, user_id = excluded.user_id;
  end loop;
end $function$;
