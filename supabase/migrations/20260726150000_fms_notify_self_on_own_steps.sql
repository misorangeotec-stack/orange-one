-- Notify the actor even for their own steps (all 5 email-enabled FMS apps).
--
-- WHY
--   Every FMS announce RPC skipped the actor when the actor also happened to be a
--   recipient (`u = v_actor`), so a user who assigned the next step to themselves
--   got NO bell and NO email — the system assumed they already knew. Per request,
--   the actor should now be notified for their own steps too.
--
-- CHANGE
--   Remove ONLY the `u = v_actor` clause from the per-recipient skip in each of the
--   five email-enabled announce RPCs. The null-guard and the `seen` de-dup stay, so
--   there are still no duplicate notifications within a single announce call.
--   Bodies are otherwise byte-for-byte identical to the current live definitions.
--
--   Applies to: procurement, import, sampling, office-supplies, production-entry.
--   HR (fms_hr_announce) and Exit (fms_exit_announce) have no email path and are
--   intentionally left unchanged.
--
-- Additive + reversible: re-add `u = v_actor or` to each skip line to restore the
-- previous self-skip behaviour.

-- 1. Procurement (RM Domestic)
create or replace function public.fms_purchase_announce(
  p_entity_type text, p_entity_id uuid, p_type text, p_text text,
  p_user_ids uuid[] default '{}'::uuid[], p_meta jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_actor uuid := auth.uid();
  u uuid;
  seen uuid[] := '{}';
  v_email_on boolean := public.email_module_enabled('procurement');
  v_email text;
begin
  insert into public.fms_purchase_activity (entity_type, entity_id, type, actor_id, note, meta)
  values (p_entity_type, p_entity_id, p_type, v_actor, nullif(p_text, ''), coalesce(p_meta, '{}'::jsonb));

  if p_user_ids is not null then
    foreach u in array p_user_ids loop
      if u is null or u = any(seen) then continue; end if;
      seen := seen || u;
      insert into public.fms_purchase_notifications (user_id, type, entity_type, entity_id, text, actor_id)
      values (u, p_type, p_entity_type, p_entity_id, p_text, v_actor);

      if v_email_on then
        begin
          v_email := coalesce(
            (select nullif(btrim(p.email), '') from public.profiles p where p.id = u),
            (select nullif(btrim(au.email), '') from auth.users  au where au.id = u)
          );
          insert into public.email_outbox (kind, to_user_id, to_email, actor_id, entity_id, payload)
          values ('procurement_' || p_type, u, v_email, v_actor, p_entity_id,
                  coalesce(p_meta, '{}'::jsonb)
                    || jsonb_build_object('text', p_text, 'entity_type', p_entity_type));
        exception when others then null;
        end;
      end if;
    end loop;
  end if;
end $function$;

-- 2. Import
create or replace function public.fms_import_announce(
  p_entity_type text, p_entity_id uuid, p_type text, p_text text,
  p_user_ids uuid[] default '{}'::uuid[], p_meta jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_actor uuid := auth.uid();
  u uuid;
  seen uuid[] := '{}';
  v_email_on boolean := public.email_module_enabled('import');
  v_email text;
begin
  insert into public.fms_import_activity (entity_type, entity_id, type, actor_id, note, meta)
  values (p_entity_type, p_entity_id, p_type, v_actor, nullif(p_text, ''), coalesce(p_meta, '{}'::jsonb));

  if p_user_ids is not null then
    foreach u in array p_user_ids loop
      if u is null or u = any(seen) then continue; end if;
      seen := seen || u;
      insert into public.fms_import_notifications (user_id, type, entity_type, entity_id, text, actor_id)
      values (u, p_type, p_entity_type, p_entity_id, p_text, v_actor);

      if v_email_on then
        begin
          v_email := coalesce(
            (select nullif(btrim(p.email), '') from public.profiles p where p.id = u),
            (select nullif(btrim(au.email), '') from auth.users  au where au.id = u)
          );
          insert into public.email_outbox (kind, to_user_id, to_email, actor_id, entity_id, payload)
          values ('import_' || p_type, u, v_email, v_actor, p_entity_id,
                  coalesce(p_meta, '{}'::jsonb)
                    || jsonb_build_object('text', p_text, 'entity_type', p_entity_type));
        exception when others then null;
        end;
      end if;
    end loop;
  end if;
end $function$;

-- 3. Sampling
create or replace function public.fms_sampling_announce(
  p_entity_type text, p_entity_id uuid, p_type text, p_text text,
  p_user_ids uuid[] default '{}'::uuid[], p_meta jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_actor uuid := auth.uid();
  u uuid;
  seen uuid[] := '{}';
  v_email_on boolean := public.email_module_enabled('sampling');
  v_email text;
begin
  insert into public.fms_sampling_activity (entity_type, entity_id, type, actor_id, note, meta)
  values (p_entity_type, p_entity_id, p_type, v_actor, nullif(p_text, ''), coalesce(p_meta, '{}'::jsonb));

  if p_user_ids is not null then
    foreach u in array p_user_ids loop
      if u is null or u = any(seen) then continue; end if;
      seen := seen || u;
      insert into public.fms_sampling_notifications (user_id, type, entity_type, entity_id, text, actor_id)
      values (u, p_type, p_entity_type, p_entity_id, p_text, v_actor);

      if v_email_on then
        begin
          v_email := coalesce(
            (select nullif(btrim(p.email), '') from public.profiles p where p.id = u),
            (select nullif(btrim(au.email), '') from auth.users  au where au.id = u)
          );
          insert into public.email_outbox (kind, to_user_id, to_email, actor_id, entity_id, payload)
          values ('sampling_' || p_type, u, v_email, v_actor, p_entity_id,
                  coalesce(p_meta, '{}'::jsonb)
                    || jsonb_build_object('text', p_text, 'entity_type', p_entity_type));
        exception when others then null;
        end;
      end if;
    end loop;
  end if;
end $function$;

-- 4. Office Supplies (rich payload builder)
create or replace function public.fms_supplies_announce(
  p_entity_type text, p_entity_id uuid, p_type text, p_text text,
  p_user_ids uuid[] default '{}'::uuid[], p_meta jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_actor uuid := auth.uid();
  u uuid;
  seen uuid[] := '{}';
  v_email_on boolean := public.email_module_enabled('office-supplies');
  v_email text;
  v_payload jsonb;
begin
  insert into public.fms_supplies_activity (entity_type, entity_id, type, actor_id, note, meta)
  values (p_entity_type, p_entity_id, p_type, v_actor, nullif(p_text, ''), coalesce(p_meta, '{}'::jsonb));

  if v_email_on and p_type not like '%edited' then
    v_payload := public.fms_supplies_email_payload(p_entity_type, p_entity_id, p_type, p_text, coalesce(p_meta, '{}'::jsonb));
  end if;

  if p_user_ids is not null then
    foreach u in array p_user_ids loop
      if u is null or u = any(seen) then continue; end if;
      seen := seen || u;
      insert into public.fms_supplies_notifications (user_id, type, entity_type, entity_id, text, actor_id)
      values (u, p_type, p_entity_type, p_entity_id, p_text, v_actor);

      if v_email_on and v_payload is not null then
        begin
          v_email := coalesce(
            (select nullif(btrim(p.email), '') from public.profiles p where p.id = u),
            (select nullif(btrim(au.email), '') from auth.users  au where au.id = u)
          );
          insert into public.email_outbox (kind, to_user_id, to_email, actor_id, entity_id, payload)
          values ('office-supplies_' || p_type, u, v_email, v_actor, p_entity_id, v_payload);
        exception when others then null;
        end;
      end if;
    end loop;
  end if;
end $function$;

-- 5. Production Entry (rich payload builder)
create or replace function public.fms_production_announce(
  p_entity_type text, p_entity_id uuid, p_type text, p_text text,
  p_user_ids uuid[] default '{}'::uuid[], p_meta jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_actor uuid := auth.uid();
  u uuid;
  seen uuid[] := '{}';
  v_email_on boolean := public.email_module_enabled('production-entry');
  v_email text;
  v_payload jsonb;
begin
  insert into public.fms_production_activity (entity_type, entity_id, type, actor_id, note, meta)
  values (p_entity_type, p_entity_id, p_type, v_actor, nullif(p_text, ''), coalesce(p_meta, '{}'::jsonb));

  if v_email_on and p_type not like '%edited' then
    v_payload := public.fms_production_email_payload(p_entity_type, p_entity_id, p_type, p_text, coalesce(p_meta, '{}'::jsonb));
  end if;

  if p_user_ids is not null then
    foreach u in array p_user_ids loop
      if u is null or u = any(seen) then continue; end if;
      seen := seen || u;
      insert into public.fms_production_notifications (user_id, type, entity_type, entity_id, text, actor_id)
      values (u, p_type, p_entity_type, p_entity_id, p_text, v_actor);

      if v_email_on and v_payload is not null then
        begin
          v_email := coalesce(
            (select nullif(btrim(p.email), '') from public.profiles p where p.id = u),
            (select nullif(btrim(au.email), '') from auth.users  au where au.id = u)
          );
          insert into public.email_outbox (kind, to_user_id, to_email, actor_id, entity_id, payload)
          values ('production-entry_' || p_type, u, v_email, v_actor, p_entity_id, v_payload);
        exception when others then null;
        end;
      end if;
    end loop;
  end if;
end $function$;
