-- Email Alerts — Production Entry FMS rollout (enqueue + server-side content).
--
-- WHY
--   Production Entry fans every workflow transition through ONE RPC,
--   public.fms_production_announce (server-side for each step, client-side for the
--   two master-governance calls). This re-issues that RPC to ALSO drop an
--   email_outbox row per recipient — so email goes exactly where a new Production
--   Entry bell goes, inheriting the self-skip + de-dup.
--
--   The job card is a SINGLE entity and every step alert is server-side, so the
--   rich per-step content is authored HERE in SQL by fms_production_email_payload()
--   (reads the request / master-request row). No frontend emailMeta / store wiring.
--   Rendered by the send-email function's shared FMS template.
--   kind = 'production-entry_' || p_type.
--
-- GATE: only fires when email_module_enabled('production-entry'); seeded OFF below.
-- Corrections (`%edited` types) stay bell-only, matching the other FMS apps.
--
-- Additive + reversible: re-apply 20260725120000_add_fms_production_foundations.sql
-- to restore the un-enqueuing body; delete the seeded row to remove the gate.

insert into public.email_module_settings (module_id, enabled)
values ('production-entry', false)
on conflict (module_id) do nothing;

-- ---------------------------------------------------------------------------
-- Per-step email content, authored from the job-card / master-request row.
-- Keys off the row's current_step (which already points at the NEXT due step
-- when the alert fires) for the headline + CTA; status='closed' ends the line.
-- ---------------------------------------------------------------------------
drop function if exists public.fms_production_email_payload(text, uuid, text, text, jsonb);
create or replace function public.fms_production_email_payload(
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
  b text := '/production-entry';
  r record;
  mr record;
  v_doc text;
  v_subject text; v_eyebrow text; v_headline text; v_action text;
  v_cta_label text; v_cta_path text;
  v_rows jsonb;
  v_note jsonb := '{}'::jsonb;
  v_label text;
  v_name text;
  v_next_label text;
  v_next_queue text;
  v_qty text;
begin
  -- ---- master-data governance ----
  if p_entity_type = 'master_request' then
    select * into mr from public.fms_production_master_requests where id = p_entity_id;
    if not found then return jsonb_build_object('headline', p_text); end if;
    v_label := case coalesce(p_meta->>'masterType', mr.master_type)
                 when 'raw_material' then 'raw material'
                 when 'fg_item' then 'FG item'
                 when 'unit' then 'unit'
                 else 'category' end;
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
        'ctaLabel', 'Open masters', 'ctaPath', b || '/master-requests')
      || case when coalesce(btrim(mr.review_note),'') <> ''
              then jsonb_build_object('note', jsonb_build_object('label','Note','text', mr.review_note))
              else '{}'::jsonb end;
    end if;
  end if;

  -- ---- production job card ----
  select req.*,
         cat.name as category_name,
         rm.name  as raw_material_name,
         fg.name  as fg_item_name,
         un.name  as unit_name
    into r
    from public.fms_production_requests req
    left join public.fms_production_categories    cat on cat.id = req.category_id
    left join public.fms_production_raw_materials  rm on rm.id  = req.raw_material_id
    left join public.fms_production_fg_items       fg on fg.id  = req.fg_item_id
    left join public.fms_production_units          un on un.id  = req.unit_id
   where req.id = p_entity_id;
  if not found then return jsonb_build_object('headline', p_text); end if;

  v_doc := 'Job card #' || r.req_no;
  v_qty := case when r.required_qty is null then '-'
                else trim(to_char(r.required_qty, 'FM999999990.###')) ||
                     case when coalesce(r.unit_name,'') <> '' then ' ' || r.unit_name else '' end end;

  v_rows := jsonb_build_array(
    jsonb_build_object('label','Job card no.','value', coalesce(nullif(btrim(r.jobcard_no),''), r.req_no)),
    jsonb_build_object('label','Category','value', coalesce(r.category_name,'-')),
    jsonb_build_object('label','Raw material','value', coalesce(r.raw_material_name,'-')),
    jsonb_build_object('label','Required qty','value', v_qty),
    jsonb_build_object('label','FG item','value', coalesce(r.fg_item_name,'-'))
  );

  -- Map the row's next due step -> friendly label + queue path.
  v_next_label := case r.current_step
                    when 'material_handover' then 'Material Handover'
                    when 'transfer_slip'     then 'Transfer Slip & Batch Card'
                    when 'production_entry'  then 'Production Entry'
                    when 'quality_check'     then 'Quality Checking'
                    when 'mc_testing'        then 'M/C Testing'
                    when 'pm_handover'       then 'Packing Material Handover'
                    when 'pm_transfer'       then 'Packing Material Transfer'
                    when 'packing_entry'     then 'Packing Entry'
                    when 'fg_transfer'       then 'FG Transfer'
                    else 'the next step' end;
  v_next_queue := case r.current_step
                    when 'material_handover' then '/queues/material-handover'
                    when 'transfer_slip'     then '/queues/transfer-slip'
                    when 'production_entry'  then '/queues/production'
                    when 'quality_check'     then '/queues/quality'
                    when 'mc_testing'        then '/queues/mc-testing'
                    when 'pm_handover'       then '/queues/pm-handover'
                    when 'pm_transfer'       then '/queues/pm-transfer'
                    when 'packing_entry'     then '/queues/packing'
                    when 'fg_transfer'       then '/queues/fg-transfer'
                    else '/requests/' || r.id::text end;

  -- Eyebrow = what just happened (the announced/completed step).
  v_eyebrow := case p_type
                 when 'raised' then 'New job card'
                 when 'material_handover' then 'Handover confirmed'
                 when 'transfer_slip' then 'Transfer slip done'
                 when 'production_entry' then 'Production recorded'
                 when 'quality_check' then 'Quality checked'
                 when 'mc_testing' then 'M/C tested'
                 when 'pm_handover' then 'PM handed over'
                 when 'pm_transfer' then 'PM transferred'
                 when 'packing_entry' then 'Packing recorded'
                 when 'fg_transfer' then 'Closed'
                 else 'Production Entry' end;

  if r.status = 'closed' then
    v_action := 'recorded the FG transfer';
    v_headline := 'Job card closed - FG transferred to Hojiwala';
    v_subject := 'Job card closed - ' || v_doc;
    v_cta_label := 'Open the job card'; v_cta_path := b || '/requests/' || r.id::text;
    if r.final_qty is not null then
      v_rows := v_rows || jsonb_build_array(jsonb_build_object('label','Final qty','value', trim(to_char(r.final_qty,'FM999999990.###'))));
    end if;
    if coalesce(btrim(r.fg_remarks),'') <> '' then
      v_note := jsonb_build_object('note', jsonb_build_object('label','Remarks','text', r.fg_remarks));
    end if;
  else
    v_action := case p_type when 'raised' then 'raised a job card' else 'completed a production step' end;
    v_headline := 'Ready for ' || v_next_label;
    v_subject := 'Ready for ' || v_next_label || ' (' || v_doc || ')';
    v_cta_label := 'Open ' || v_next_label || ' queue'; v_cta_path := b || v_next_queue;
  end if;

  return jsonb_build_object(
    'subject', v_subject, 'eyebrow', v_eyebrow, 'headline', v_headline,
    'action', v_action, 'docLabel', v_doc,
    'rows', v_rows,
    'ctaLabel', v_cta_label, 'ctaPath', v_cta_path
  ) || v_note;
exception when others then
  return jsonb_build_object('headline', coalesce(nullif(btrim(p_text),''), 'Production Entry update'));
end $$;
grant execute on function public.fms_production_email_payload(text, uuid, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Re-issue the announce RPC (body verbatim from foundations) + email enqueue.
-- ---------------------------------------------------------------------------
drop function if exists public.fms_production_announce(text, uuid, text, text, uuid[], jsonb);
create or replace function public.fms_production_announce(
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
  v_email_on boolean := public.email_module_enabled('production-entry');
  v_email text;
  v_payload jsonb;
begin
  insert into public.fms_production_activity (entity_type, entity_id, type, actor_id, note, meta)
  values (p_entity_type, p_entity_id, p_type, v_actor, nullif(p_text, ''), coalesce(p_meta, '{}'::jsonb));

  -- Build the rich email payload once (corrections stay bell-only).
  if v_email_on and p_type not like '%edited' then
    v_payload := public.fms_production_email_payload(p_entity_type, p_entity_id, p_type, p_text, coalesce(p_meta, '{}'::jsonb));
  end if;

  if p_user_ids is not null then
    foreach u in array p_user_ids loop
      if u is null or u = v_actor or u = any(seen) then continue; end if;
      seen := seen || u;
      insert into public.fms_production_notifications (user_id, type, entity_type, entity_id, text, actor_id)
      values (u, p_type, p_entity_type, p_entity_id, p_text, v_actor);

      -- (new) email the same recipient, only when Production Entry email is enabled.
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
end $$;
grant execute on function public.fms_production_announce(text, uuid, text, text, uuid[], jsonb) to authenticated;
