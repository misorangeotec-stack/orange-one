-- ===========================================================================
-- Email Alerts — HR Recruitment: MASTER REQUESTS ONLY.
--
-- WHY
--   Every other FMS app already emails its master-request traffic; New
--   Recruitment was the one gap (its fms_hr_announce wrote bell notifications
--   and nothing else — there was no email_module_settings row for it at all).
--
-- DELIBERATELY NARROW. Unlike Import / General Purchase / Asset Maintenance,
--   this does NOT enqueue email for every announce. The enqueue arm is guarded
--   on `p_entity_type = 'master_request'`, so flipping the HR switch on mails
--   the master-data governance loop and nothing else — CVs added, shared with
--   HOD, offer confirmation and the rest stay bell-only. That is the agreed
--   scope; widening it later means dropping the entity-type guard below and
--   authoring payload content for the remaining ~7 types.
--
-- WHO GETS WHAT (recipients are computed client-side and passed in p_user_ids;
-- this migration does not change them):
--   master_requested            → the master type's assigned owners, or the
--                                 admins when that master is unassigned.
--   master_approved/_rejected   → the person who raised the request.
--   The announce's existing self-skip still applies: an owner approving their
--   own request is not mailed about it.
--
-- GATE: email_module_enabled('hr-recruitment'), seeded OFF below. Nothing sends
--   until an admin flips New Recruitment → Setup → Notifications.
--
-- Content is authored HERE in SQL (the supplies / production / asset pattern)
--   rather than in the frontend, so there is no emailMeta wiring in the HR store.
--   kind = 'hr-recruitment_' || p_type; rendered by the send-email function's
--   shared FMS template.
--
-- Additive + reversible: re-apply 20260712120000_add_fms_hr_foundations.sql to
--   restore the un-enqueuing announce body; drop the payload function; delete
--   the seeded settings row to remove the gate.
-- ===========================================================================

-- Seed the per-module gate row (OFF). email_module_enabled() defaults to false
-- when no row exists, but seed it explicitly so the Setup toggle has a row.
insert into public.email_module_settings (module_id, enabled)
values ('hr-recruitment', false)
on conflict (module_id) do nothing;

-- ---------------------------------------------------------------------------
-- Master-request email content, read off the request row.
-- Returns the payload shape the send-email shared FMS renderer expects:
-- subject / eyebrow / headline / action / rows / note / ctaLabel / ctaPath.
-- ---------------------------------------------------------------------------
drop function if exists public.fms_hr_master_request_email_payload(uuid, text, text, jsonb);
create or replace function public.fms_hr_master_request_email_payload(
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
  b  text := '/hr-recruitment';
  mr record;
  v_label text;
  v_name  text;
begin
  select * into mr from public.fms_hr_master_requests where id = p_entity_id;
  -- Row gone (or not readable) — fall back to the bell text so the mail is
  -- still coherent rather than empty.
  if not found then return jsonb_build_object('headline', p_text); end if;

  v_label := case coalesce(p_meta->>'masterType', mr.master_type)
               when 'job_platform'            then 'job platform'
               when 'job_type'                then 'job type'
               when 'location'                then 'location'
               when 'disqualification_reason' then 'disqualification reason'
               when 'onboarding_item'         then 'checklist item'
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

  -- master_approved / master_rejected — addressed to the requester.
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
  -- The reviewer's reason is the whole point of a rejection mail — carry it.
  || case when coalesce(btrim(mr.review_note), '') <> ''
          then jsonb_build_object('note', jsonb_build_object('label', 'Note', 'text', mr.review_note))
          else '{}'::jsonb end;
end $$;

grant execute on function public.fms_hr_master_request_email_payload(uuid, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Re-issue fms_hr_announce: unchanged activity + bell writes, plus an
-- email_outbox row per recipient for master-request events only.
-- ---------------------------------------------------------------------------
drop function if exists public.fms_hr_announce(text, uuid, text, text, uuid[], jsonb);
create or replace function public.fms_hr_announce(
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
  -- Evaluated once: the gate AND the narrow entity-type scope. Everything that
  -- is not a master request stays bell-only regardless of the switch.
  v_email_on boolean := p_entity_type = 'master_request'
                        and p_type in ('master_requested', 'master_approved', 'master_rejected')
                        and public.email_module_enabled('hr-recruitment');
  v_payload jsonb;
  v_email text;
begin
  insert into public.fms_hr_activity (entity_type, entity_id, type, actor_id, note, meta)
  values (p_entity_type, p_entity_id, p_type, v_actor, nullif(p_text, ''), coalesce(p_meta, '{}'::jsonb));

  -- Built once outside the loop — it is the same for every recipient.
  if v_email_on then
    v_payload := public.fms_hr_master_request_email_payload(p_entity_id, p_type, p_text, coalesce(p_meta, '{}'::jsonb));
  end if;

  if p_user_ids is not null then
    foreach u in array p_user_ids loop
      if u is null or u = v_actor or u = any(seen) then continue; end if;
      seen := seen || u;
      insert into public.fms_hr_notifications (user_id, type, entity_type, entity_id, text, actor_id)
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
          values ('hr-recruitment_' || p_type, u, v_email, v_actor, p_entity_id,
                  coalesce(v_payload, '{}'::jsonb)
                    || jsonb_build_object('text', p_text, 'entity_type', p_entity_type));
        exception when others then null;
        end;
      end if;
    end loop;
  end if;
end $$;

grant execute on function public.fms_hr_announce(text, uuid, text, text, uuid[], jsonb) to authenticated;
