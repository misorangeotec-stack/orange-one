-- ===========================================================================
-- Email Alerts — HR Exit: MASTER REQUESTS ONLY.
--
-- The Employee Exit twin of 20260814120000 (New Recruitment). Same shape, same
-- deliberate narrowness: the enqueue arm is guarded on
-- `p_entity_type = 'master_request'`, so turning the Exit switch on mails the
-- master-data governance loop and nothing else — assets signed, HR verified,
-- step skipped and withdrawal stay bell-only. Widening it later means dropping
-- the entity-type guard and authoring payload content for those types.
--
-- WHO GETS WHAT (recipients come from the client in p_user_ids; unchanged here):
--   master_requested          → the master type's assigned owners, or the admins
--                               when that master is unassigned.
--   master_approved/_rejected → the person who raised the request.
--   The announce's existing self-skip still applies.
--
-- GATE: email_module_enabled('hr-exit'), seeded OFF below.
-- kind = 'hr-exit_' || p_type, rendered by send-email's shared FMS template.
--
-- NOTE on master types: clearance_item is absent from the request table's CHECK
--   (it feeds no dropdown and is keyed on a slug), so it can never reach this
--   function — it is mapped below only so a future relaxation reads sensibly
--   rather than falling through to "entry".
--
-- Additive + reversible: re-apply 20260714120000_add_fms_exit_foundations.sql to
--   restore the un-enqueuing announce body; drop the payload function; delete
--   the seeded settings row to remove the gate.
-- ===========================================================================

insert into public.email_module_settings (module_id, enabled)
values ('hr-exit', false)
on conflict (module_id) do nothing;

-- ---------------------------------------------------------------------------
-- Master-request email content, read off the request row.
-- ---------------------------------------------------------------------------
drop function if exists public.fms_exit_master_request_email_payload(uuid, text, text, jsonb);
create or replace function public.fms_exit_master_request_email_payload(
  p_entity_id uuid,
  p_type      text,
  p_text      text,
  p_meta      jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  b  text := '/hr-exit';
  mr record;
  v_label text;
  v_name  text;
begin
  select * into mr from public.fms_exit_master_requests where id = p_entity_id;
  if not found then return jsonb_build_object('headline', p_text); end if;

  v_label := case coalesce(p_meta->>'masterType', mr.master_type)
               when 'reason'         then 'exit reason'
               when 'asset_type'     then 'asset type'
               when 'document_type'  then 'document type'
               when 'payroll_head'   then 'payroll head'
               when 'clearance_item' then 'clearance item'
               else 'entry'
             end;
  v_name := coalesce(nullif(btrim(mr.proposed_payload->>'name'), ''), 'entry');

  if p_type = 'master_requested' then
    return jsonb_build_object(
      'subject',   'New ' || v_label || ' requested - "' || v_name || '"',
      'eyebrow',   'Master request',
      'headline',  'A new ' || v_label || ' was requested',
      'action',    'requested a new ' || v_label,
      'rows',      jsonb_build_array(jsonb_build_object('label', 'Name', 'value', v_name)),
      'ctaLabel',  'Review master requests',
      'ctaPath',   b || '/master-requests');
  end if;

  return jsonb_build_object(
    'subject',  case when p_type = 'master_approved'
                     then 'Your ' || v_label || ' was approved - "' || v_name || '"'
                     else 'Your ' || v_label || ' request was rejected' end,
    'eyebrow',  case when p_type = 'master_approved' then 'Master approved' else 'Master rejected' end,
    'headline', case when p_type = 'master_approved'
                     then 'Your new ' || v_label || ' was approved'
                     else 'Your ' || v_label || ' request was rejected' end,
    'action',   case when p_type = 'master_approved'
                     then 'approved a ' || v_label
                     else 'rejected a ' || v_label end,
    'rows',     jsonb_build_array(jsonb_build_object('label', 'Name', 'value', v_name)),
    'ctaLabel', 'Open master requests',
    'ctaPath',  b || '/master-requests')
  || case when coalesce(btrim(mr.review_note), '') <> ''
          then jsonb_build_object('note', jsonb_build_object('label', 'Note', 'text', mr.review_note))
          else '{}'::jsonb end;
end $$;

grant execute on function public.fms_exit_master_request_email_payload(uuid, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Re-issue fms_exit_announce: unchanged activity + bell writes, plus an
-- email_outbox row per recipient for master-request events only.
-- ---------------------------------------------------------------------------
drop function if exists public.fms_exit_announce(text, uuid, text, text, uuid[], jsonb);
create or replace function public.fms_exit_announce(
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
  v_email_on boolean := p_entity_type = 'master_request'
                        and p_type in ('master_requested', 'master_approved', 'master_rejected')
                        and public.email_module_enabled('hr-exit');
  v_payload jsonb;
  v_email text;
begin
  insert into public.fms_exit_activity (entity_type, entity_id, type, actor_id, note, meta)
  values (p_entity_type, p_entity_id, p_type, v_actor, nullif(p_text, ''), coalesce(p_meta, '{}'::jsonb));

  if v_email_on then
    v_payload := public.fms_exit_master_request_email_payload(p_entity_id, p_type, p_text, coalesce(p_meta, '{}'::jsonb));
  end if;

  if p_user_ids is not null then
    foreach u in array p_user_ids loop
      if u is null or u = v_actor or u = any(seen) then continue; end if;
      seen := seen || u;
      insert into public.fms_exit_notifications (user_id, type, entity_type, entity_id, text, actor_id)
      values (u, p_type, p_entity_type, p_entity_id, p_text, v_actor);

      -- (new) email the same recipient. Wrapped so a mail problem can never
      -- roll back the bell notification or the caller's write.
      if v_email_on then
        begin
          v_email := coalesce(
            (select nullif(btrim(p.email), '') from public.profiles p where p.id = u),
            (select nullif(btrim(au.email), '') from auth.users  au where au.id = u)
          );
          insert into public.email_outbox (kind, to_user_id, to_email, actor_id, entity_id, payload)
          values ('hr-exit_' || p_type, u, v_email, v_actor, p_entity_id,
                  coalesce(v_payload, '{}'::jsonb)
                    || jsonb_build_object('text', p_text, 'entity_type', p_entity_type));
        exception when others then null;
        end;
      end if;
    end loop;
  end if;
end $$;

grant execute on function public.fms_exit_announce(text, uuid, text, text, uuid[], jsonb) to authenticated;
