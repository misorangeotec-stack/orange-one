-- ===========================================================================
-- Email Alerts — Asset Maintenance FMS rollout (enqueue + server-side content).
--
-- Every workflow event fans through ONE RPC, public.fms_asset_announce. This
-- re-issues it to ALSO drop an email_outbox row per recipient, so email goes
-- exactly where a new bell goes. Content is authored HERE in SQL by
-- fms_asset_email_payload() — the sampling / supplies / production / dispatch
-- pattern — so there is no frontend emailMeta wiring at all.
--   kind = 'asset-maintenance_' || p_type
--   GATE: email_module_enabled('asset-maintenance'), seeded OFF below.
--   Corrections (`%edited`) stay bell-only, matching the other FMS apps.
--
-- ⚠ THE REMINDER TYPES ARE WHY THIS MODULE NEEDS EMAIL MORE THAN THE OTHERS.
--   Elsewhere an alert says "your turn". Here `job_due_soon` / `job_overdue` are
--   the product: a bell nobody logs in to see is exactly the failure the module
--   was built to end. They are still gated OFF on install — see the go-live
--   sequence, which says to run the first generation with mail off so a backlog
--   import cannot mass-mail the company.
--
-- ⚠ These two types are ALSO the only ones announced with auth.uid() = NULL,
--   because pg_cron has no session user. actor_id is null, the renderer prints
--   no "by X" line, and that reads correctly — the reminder is from the system.
--
-- Requires supabase/functions/send-email/index.ts to list the
-- 'asset-maintenance_' prefix in its generic FMS renderer, else these rows are
-- composed by the fallback and lose their branding.
--
-- Additive + reversible: re-apply 20260805120000_add_fms_asset_foundations.sql to
-- restore the un-enqueuing announce body; delete the seeded settings row to
-- remove the gate; drop the payload function.
-- ===========================================================================

insert into public.email_module_settings (module_id, enabled)
values ('asset-maintenance', false)
on conflict (module_id) do nothing;

-- ---------------------------------------------------------------------------
-- Email content, authored from the job / asset / master-request row.
-- ---------------------------------------------------------------------------
drop function if exists public.fms_asset_email_payload(text, uuid, text, text, jsonb);
create or replace function public.fms_asset_email_payload(
  p_entity_type text,
  p_entity_id   uuid,
  p_type        text,
  p_text        text,
  p_meta        jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b text := '/asset-maintenance';
  r  record;
  ar record;
  mr record;
  v_eyebrow text; v_headline text; v_action text; v_subject text;
  v_cta_label text; v_cta_path text;
  v_rows jsonb;
  v_label text; v_name text;
  v_next_label text; v_next_queue text;
  v_days integer;
  v_asset_label text;
begin
  -- ---- master-data governance ----
  if p_entity_type = 'master_request' then
    select * into mr from public.fms_asset_master_requests where id = p_entity_id;
    if not found then return jsonb_build_object('headline', p_text); end if;
    v_label := replace(coalesce(p_meta->>'master_type', mr.master_type), '_', ' ');
    v_name  := coalesce(mr.proposed_payload->>'name', 'entry');
    if p_type = 'master_requested' then
      return jsonb_build_object(
        'subject', 'New ' || v_label || ' requested - "' || v_name || '"',
        'eyebrow', 'Master request',
        'headline', 'A new ' || v_label || ' was requested',
        'action', 'requested a new ' || v_label,
        'rows', jsonb_build_array(jsonb_build_object('label','Name','value', v_name)),
        'ctaLabel', 'Review master requests', 'ctaPath', b || '/master-requests');
    else
      return jsonb_build_object(
        'subject', case when p_type = 'master_approved'
                        then 'Your ' || v_label || ' was approved - "' || v_name || '"'
                        else 'Your ' || v_label || ' request was rejected' end,
        'eyebrow', case when p_type = 'master_approved' then 'Master approved' else 'Master rejected' end,
        'headline', case when p_type = 'master_approved'
                         then 'Your new ' || v_label || ' was approved'
                         else 'Your ' || v_label || ' request was rejected' end,
        'action', case when p_type = 'master_approved' then 'approved a ' || v_label else 'rejected a ' || v_label end,
        'rows', jsonb_build_array(jsonb_build_object('label','Name','value', v_name)),
        'ctaLabel', 'Open master requests', 'ctaPath', b || '/master-requests')
      || case when coalesce(btrim(mr.review_note),'') <> ''
              then jsonb_build_object('note', jsonb_build_object('label','Note','text', mr.review_note))
              else '{}'::jsonb end;
    end if;
  end if;

  -- ---- the asset register itself (added / edited / retired) ----
  if p_entity_type = 'asset' then
    select a.*, c.name as category_name, l.name as location_name
      into ar
      from public.fms_asset_assets a
      left join public.fms_asset_categories c on c.id = a.category_id
      left join public.fms_asset_locations  l on l.id = a.location_id
     where a.id = p_entity_id;
    if not found then return jsonb_build_object('headline', p_text); end if;

    return jsonb_build_object(
      'subject',  case when p_type = 'asset_retired'
                       then 'Asset retired - ' || ar.asset_no || ' ' || ar.name
                       else 'Asset added - ' || ar.asset_no || ' ' || ar.name end,
      'eyebrow',  case when p_type = 'asset_retired' then 'Asset retired' else 'Asset register' end,
      'headline', ar.asset_no || ' ' || ar.name
                  || case when p_type = 'asset_retired' then ' has been retired' else ' was added to the register' end,
      'action',   case when p_type = 'asset_retired' then 'retired an asset' else 'added an asset' end,
      'docLabel', ar.asset_no,
      'rows', jsonb_build_array(
        jsonb_build_object('label','Asset','value', ar.asset_no || ' - ' || ar.name),
        jsonb_build_object('label','Category','value', coalesce(ar.category_name,'-')),
        jsonb_build_object('label','Location','value', coalesce(ar.location_name,'-')),
        jsonb_build_object('label','Serial no.','value', coalesce(ar.serial_no,'-'))),
      'ctaLabel', 'Open the asset',
      'ctaPath',  b || '/assets/' || ar.id::text)
    || case when coalesce(btrim(p_text),'') <> ''
            then jsonb_build_object('note', jsonb_build_object('label','Update','text', p_text))
            else '{}'::jsonb end;
  end if;

  -- ---- a service job ----
  select j.*, a.asset_no, a.name as asset_name, a.serial_no,
         c.name as category_name, l.name as location_name,
         st.name as type_name, st.kind as type_kind,
         v.name as vendor_name
    into r
    from public.fms_asset_jobs j
    join public.fms_asset_assets a on a.id = j.asset_id
    left join public.fms_asset_categories c on c.id = a.category_id
    left join public.fms_asset_locations  l on l.id = a.location_id
    left join public.fms_asset_schedule_types st on st.id = j.schedule_type_id
    left join public.fms_asset_vendors v on v.id = coalesce(j.sd_vendor_id, j.sc_vendor_id)
   where j.id = p_entity_id;
  if not found then return jsonb_build_object('headline', p_text); end if;

  v_asset_label := r.asset_no || ' ' || r.asset_name;
  v_days := case when r.due_date is null then null
                 else r.due_date - public.fms_asset_today_ist() end;

  v_rows := jsonb_build_array(
    jsonb_build_object('label','Job no.','value', r.job_no),
    jsonb_build_object('label','Asset','value', v_asset_label),
    jsonb_build_object('label','What is due','value', coalesce(r.type_name,'Service')),
    jsonb_build_object('label','Due on','value',
      case when r.due_date is null then '-' else to_char(r.due_date, 'DD-MM-YYYY') end),
    jsonb_build_object('label','Location','value', coalesce(r.location_name,'-'))
  );
  if coalesce(r.serial_no,'') <> '' then
    v_rows := v_rows || jsonb_build_array(jsonb_build_object('label','Serial no.','value', r.serial_no));
  end if;
  if r.sc_planned_date is not null then
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'label','Planned for','value', to_char(r.sc_planned_date, 'DD-MM-YYYY')));
  end if;
  if coalesce(r.vendor_name,'') <> '' then
    v_rows := v_rows || jsonb_build_array(jsonb_build_object('label','Vendor','value', r.vendor_name));
  end if;
  if r.sd_cost is not null then
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'label','Cost','value', 'Rs. ' || trim(to_char(r.sd_cost, 'FM99,99,99,990.00'))));
  end if;

  v_next_label := case r.current_step
                    when 'schedule'     then 'Schedule Service'
                    when 'service_done' then 'Record Service'
                    when 'verify_close' then 'Verify & Close'
                    else 'the next step' end;
  v_next_queue := case r.current_step
                    when 'schedule'     then '/queues/schedule'
                    when 'service_done' then '/queues/service'
                    when 'verify_close' then '/queues/verify'
                    else '/jobs/' || r.id::text end;

  v_eyebrow := case p_type
                 when 'job_raised'    then 'Service due'
                 when 'job_due_soon'  then 'Reminder'
                 when 'job_overdue'   then 'Overdue'
                 when 'job_scheduled' then 'Service scheduled'
                 when 'job_serviced'  then 'Service recorded'
                 when 'job_rework'    then 'Sent back'
                 when 'job_closed'    then 'Closed'
                 when 'job_held'      then 'On hold'
                 when 'job_resumed'   then 'Resumed'
                 when 'job_cancelled' then 'Cancelled'
                 when 'job_skipped'   then 'Skipped'
                 else 'Asset maintenance' end;

  -- The reminder types get their own voice: the urgency IS the message, so the
  -- subject line leads with the countdown rather than the step name.
  if p_type in ('job_due_soon','job_overdue') then
    if coalesce(v_days, 0) < 0 then
      v_subject  := 'OVERDUE ' || abs(v_days)::text || 'd - ' || coalesce(r.type_name,'Service')
                    || ' for ' || v_asset_label;
      v_headline := coalesce(r.type_name,'Service') || ' for ' || v_asset_label || ' is overdue';
    elsif coalesce(v_days, 0) = 0 then
      v_subject  := 'DUE TODAY - ' || coalesce(r.type_name,'Service') || ' for ' || v_asset_label;
      v_headline := coalesce(r.type_name,'Service') || ' for ' || v_asset_label || ' is due today';
    else
      v_subject  := 'Due in ' || v_days::text || 'd - ' || coalesce(r.type_name,'Service')
                    || ' for ' || v_asset_label;
      v_headline := coalesce(r.type_name,'Service') || ' for ' || v_asset_label
                    || ' is due in ' || v_days::text
                    || case when v_days = 1 then ' day' else ' days' end;
    end if;
    v_action    := 'is waiting on ' || v_next_label;
    v_cta_label := 'Open ' || v_next_label;
    v_cta_path  := b || v_next_queue;

  elsif r.status = 'closed' then
    v_headline  := r.job_no || ' is closed';
    v_action    := 'closed a service job';
    v_cta_label := 'Open the asset';
    v_cta_path  := b || '/assets/' || r.asset_id::text;
    v_subject   := 'Closed - ' || coalesce(r.type_name,'Service') || ' for ' || v_asset_label;

  elsif r.status in ('on_hold','cancelled','skipped') then
    v_headline  := r.job_no || ' is ' || replace(r.status, '_', ' ');
    v_action    := replace(r.status, '_', ' ') || ' a service job';
    v_cta_label := 'Open the asset';
    v_cta_path  := b || '/assets/' || r.asset_id::text;
    v_subject   := initcap(replace(r.status, '_', ' ')) || ' - ' || r.job_no || ' (' || v_asset_label || ')';

  else
    v_headline  := r.job_no || ' is ready for ' || v_next_label;
    v_action    := 'moved a service job to ' || v_next_label;
    v_cta_label := 'Open ' || v_next_label;
    v_cta_path  := b || v_next_queue;
    v_subject   := v_next_label || ' due - ' || coalesce(r.type_name,'Service') || ' for ' || v_asset_label;
  end if;

  return jsonb_build_object(
    'subject',  v_subject,
    'eyebrow',  v_eyebrow,
    'headline', v_headline,
    'action',   v_action,
    'docLabel', r.job_no,
    'rows',     v_rows,
    'ctaLabel', v_cta_label,
    'ctaPath',  v_cta_path
  )
  || case when coalesce(btrim(p_text),'') <> ''
          then jsonb_build_object('note', jsonb_build_object('label','Update','text', p_text))
          else '{}'::jsonb end;
end $$;
grant execute on function public.fms_asset_email_payload(text, uuid, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Re-issue fms_asset_announce with the gated enqueue. Body is verbatim from
-- 20260805120000_add_fms_asset_foundations.sql plus the email block.
-- ---------------------------------------------------------------------------
drop function if exists public.fms_asset_announce(text, uuid, text, text, uuid[], jsonb);
create or replace function public.fms_asset_announce(
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
  v_email_on boolean := false;
  v_payload jsonb;
  v_email text;
begin
  insert into public.fms_asset_activity (entity_type, entity_id, type, actor_id, note, meta)
  values (p_entity_type, p_entity_id, p_type, v_actor, nullif(p_text, ''), coalesce(p_meta, '{}'::jsonb));

  -- Corrections are bell-only; they carry no new work for anyone.
  begin
    v_email_on := public.email_module_enabled('asset-maintenance') and p_type not like '%edited';
  exception when others then v_email_on := false;
  end;

  if v_email_on then
    begin
      v_payload := public.fms_asset_email_payload(p_entity_type, p_entity_id, p_type, p_text, coalesce(p_meta, '{}'::jsonb));
    exception when others then v_payload := null;
    end;
  end if;

  if p_user_ids is not null then
    foreach u in array p_user_ids loop
      if u is null or u = any(seen) then continue; end if;
      seen := seen || u;
      insert into public.fms_asset_notifications (user_id, type, entity_type, entity_id, text, actor_id)
      values (u, p_type, p_entity_type, p_entity_id, p_text, v_actor);

      -- Email the same recipient, only when this module's email gate is on.
      -- Isolated so a mail problem can never roll back the work — and, on the
      -- cron path, so one bad address cannot abort the whole nightly run.
      if v_email_on and v_payload is not null then
        begin
          v_email := coalesce(
            (select nullif(btrim(p.email), '') from public.profiles p where p.id = u),
            (select nullif(btrim(au.email), '') from auth.users  au where au.id = u)
          );
          insert into public.email_outbox (kind, to_user_id, to_email, actor_id, entity_id, payload)
          values ('asset-maintenance_' || p_type, u, v_email, v_actor, p_entity_id, v_payload);
        exception when others then null;
        end;
      end if;
    end loop;
  end if;
end $$;
grant execute on function public.fms_asset_announce(text, uuid, text, text, uuid[], jsonb) to authenticated;
